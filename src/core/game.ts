import { DEFAULT_RULES, type Rules } from '../config/rules';
import { UNIT_DEFS } from '../config/units';
import { buildMap, inSpawnRect, type GameMap } from './map';
import { calcDamage, canWeaponHit, dist, targetScore } from './combat';
import { Fog } from './fog';
import { createZones, ownedCount, updateZones, type ZoneState } from './zones';
import {
  enemyOf, TEAMS,
  type CommandResult, type GameEvent, type Order, type Team, type Unit, type UnitType, type Vec, type WeaponDef,
} from './types';
import { AIController } from './ai';

export interface QueueItem {
  type: UnitType;
  remaining: number;
}

export interface TeamState {
  pd: number;
  pz: number;
  queue: QueueItem[];
  rally: Vec | null;
  kills: number;
}

export interface Projectile {
  x: number;
  y: number;
  tx: number;
  ty: number;
  speed: number;
  weapon: WeaponDef;
  team: Team;
  shooterId: number;
}

export interface GameOptions {
  zoneCount?: number;
  rules?: Partial<Rules>;
  /** Włącza przeciwnika AI (strona czerwona). */
  ai?: boolean;
  map?: GameMap;
}

export type Winner = Team | 'draw' | null;

const idleOrder = (): Order => ({ type: 'idle' });

export class Game {
  readonly rules: Rules;
  readonly map: GameMap;
  readonly zones: ZoneState[];
  readonly fog: Fog;
  readonly teams: Record<Team, TeamState>;
  units: Unit[] = [];
  readonly byId = new Map<number, Unit>();
  projectiles: Projectile[] = [];
  events: GameEvent[] = [];
  time = 0;
  status: 'running' | 'ended' = 'running';
  winner: Winner = null;
  ai: AIController | null = null;

  private nextId = 1;
  private fogTimer = 0;
  private visible: Record<Team, Unit[]> = { blue: [], red: [] };
  private accumulator = 0;
  private stepCount = 0;
  private pendingHits: { target: Unit; amount: number; source: Team }[] = [];

  constructor(opts: GameOptions = {}) {
    this.rules = { ...DEFAULT_RULES, ...(opts.rules ?? {}) };
    if (opts.zoneCount !== undefined) this.rules.zoneCount = opts.zoneCount;
    this.rules.zoneCount = Math.max(3, Math.min(6, this.rules.zoneCount));
    this.map = opts.map ?? buildMap(this.rules.zoneCount);
    this.zones = createZones(this.map.zones);
    this.fog = new Fog(this.map.width, this.map.height);
    this.teams = {
      blue: { pd: this.rules.startPD, pz: 0, queue: [], rally: null, kills: 0 },
      red: { pd: this.rules.startPD, pz: 0, queue: [], rally: null, kills: 0 },
    };
    if (opts.ai) this.ai = new AIController(this, 'red');
    for (const t of TEAMS) this.fog.explore(t, this.map.def.spawns[t]);
    this.fog.update(this.units);
  }

  get grid() {
    return this.map.grid;
  }

  // ---------------------------------------------------------------- pętla

  /** Wywoływane z pętli renderowania: rozdziela czas rzeczywisty na kroki stałe. */
  update(realDt: number) {
    this.accumulator += Math.min(realDt, 0.25);
    let guard = 0;
    while (this.accumulator >= this.rules.simStep && guard++ < 12) {
      this.accumulator -= this.rules.simStep;
      this.step();
    }
  }

  step() {
    if (this.status !== 'running') return;
    const dt = this.rules.simStep;
    this.time += dt;

    // Ekonomia i punkty zwycięstwa
    for (const team of TEAMS) {
      const owned = ownedCount(this.zones, team);
      this.teams[team].pd += this.income(team, owned) * dt;
      this.teams[team].pz += owned * this.rules.zonePZ * dt;
    }
    updateZones(this.zones, this.units, this.rules, dt);

    this.processQueues(dt);

    this.fogTimer -= dt;
    if (this.fogTimer <= 0) {
      this.fogTimer = 0.1;
      this.fog.update(this.units);
    }
    for (const team of TEAMS) {
      const set = this.fog.visibleEnemies[team];
      this.visible[team] = this.units.filter((u) => u.alive && u.insideId === null && u.team !== team && set.has(u.id));
    }

    this.ai?.update(dt);

    // Faza 1: rozkazy i ruch wszystkich jednostek. Faza 2: strzały (jednoczesne - obrażenia
    // są kolejkowane i zadawane razem), dzięki czemu kolejność jednostek nie faworyzuje żadnej strony.
    // Kolejność przetwarzania zmienia się co krok (parzysty/nieparzysty), by nie faworyzować żadnej strony.
    const order = this.stepCount++ % 2 === 0 ? this.units.slice() : this.units.slice().reverse();
    for (const u of order) if (u.alive) this.updateUnit(u, dt);
    for (const u of order) if (u.alive && u.insideId === null && u.def.weapons.length) this.fireWeapons(u);
    this.applyPendingHits();
    this.updateProjectiles(dt);
    this.separate();

    if (this.units.some((u) => !u.alive)) {
      this.units = this.units.filter((u) => u.alive);
      for (const [id, u] of this.byId) if (!u.alive && this.time - u.lastDamagedAt > 5) this.byId.delete(id);
    }
    if (this.events.length > 3000) this.events.splice(0, this.events.length - 3000);
    this.checkVictory();
  }

  private checkVictory() {
    const b = this.teams.blue.pz;
    const r = this.teams.red.pz;
    const win = this.rules.winPZ;
    if (b >= win || r >= win) {
      this.finish(b > r ? 'blue' : r > b ? 'red' : 'draw');
    } else if (this.time >= this.rules.timeLimit) {
      this.finish(b > r ? 'blue' : r > b ? 'red' : 'draw');
    }
  }

  private finish(w: Winner) {
    this.status = 'ended';
    this.winner = w;
  }

  income(team: Team, owned = ownedCount(this.zones, team)) {
    return this.rules.baseIncomePD + owned * this.rules.zoneIncomePD;
  }

  // ---------------------------------------------------------------- jednostki

  createUnit(team: Team, type: UnitType, x: number, y: number): Unit {
    const def = UNIT_DEFS[type];
    const u: Unit = {
      id: this.nextId++, team, type, def, x, y, hp: def.maxHp, facing: team === 'blue' ? 0 : Math.PI, alive: true,
      order: idleOrder(), path: [], pathIdx: 0, weaponCd: def.weapons.map(() => Math.random() * 0.3),
      insideId: null, passengers: [], targetId: null, lastKnown: null, anchor: { x, y },
      lastDamagedAt: -999, scanTimer: Math.random() * 0.25, repathTimer: 0, stuckTimer: 0, stuckCount: 0,
      lastCheckPos: { x, y }, movedThisTick: false, healTargetId: null, healFxTimer: 0, engaged: false, goal: null,
    };
    this.units.push(u);
    this.byId.set(u.id, u);
    return u;
  }

  unitsOf(team: Team) {
    return this.units.filter((u) => u.alive && u.team === team);
  }

  unitCount(team: Team) {
    return this.unitsOf(team).length + this.teams[team].queue.length;
  }

  spawnRect(team: Team) {
    return this.map.def.spawns[team];
  }

  inOwnSpawn(u: Unit) {
    return inSpawnRect(this.spawnRect(u.team), u.x, u.y);
  }

  /** Jednostki w swojej strefie przyjazdu są bezpieczne (nie otrzymują obrażeń i nie strzelają). */
  private isInvulnerable(u: Unit) {
    return this.inOwnSpawn(u);
  }

  canSee(team: Team, u: Unit) {
    return u.alive && this.fog.canSeeUnit(team, u);
  }

  // ---------------------------------------------------------------- posiłki

  /** Powód, dla którego nie można zamówić jednostki (albo null). */
  buyBlockReason(team: Team, type: UnitType): string | null {
    const def = UNIT_DEFS[type];
    if (this.status !== 'running') return 'Mecz zakończony';
    const cnt = this.unitCount(team);
    if (cnt >= this.rules.unitCap) return `Limit jednostek (${cnt}/${this.rules.unitCap})`;
    const pd = this.teams[team].pd;
    if (pd < def.cost) return `Brakuje ${Math.ceil(def.cost - pd)} PD`;
    return null;
  }

  buy(team: Team, type: UnitType): CommandResult {
    const reason = this.buyBlockReason(team, type);
    if (reason) return { ok: false, message: reason };
    const t = this.teams[team];
    t.pd -= UNIT_DEFS[type].cost; // PD pobierane dokładnie raz, przy zamówieniu
    t.queue.push({ type, remaining: this.rules.reinforceDelay });
    return { ok: true };
  }

  setRally(team: Team, p: Vec | null): CommandResult {
    if (!p) {
      this.teams[team].rally = null;
      return { ok: true, message: 'Punkt zbiórki usunięty' };
    }
    const f = this.grid.nearestFree(p.x, p.y, this.grid.regionAt(this.spawnRect(team).x + 20, this.spawnRect(team).y + 20));
    if (!f) return { ok: false, message: 'Nieprawidłowy punkt zbiórki' };
    this.teams[team].rally = f;
    return { ok: true };
  }

  private processQueues(dt: number) {
    for (const team of TEAMS) {
      const q = this.teams[team].queue;
      for (const item of q) item.remaining = Math.max(0, item.remaining - dt);
      for (let i = 0; i < q.length; ) {
        if (q[i].remaining > 0) {
          i++;
          continue;
        }
        const pos = this.findSpawnPos(team, q[i].type);
        if (!pos) {
          i++; // strefa przyjazdu zatłoczona - spróbujemy w następnym kroku
          continue;
        }
        const u = this.createUnit(team, q[i].type, pos.x, pos.y);
        q.splice(i, 1);
        const rally = this.teams[team].rally;
        if (rally) this.sendTo(u, rally, 'move');
      }
    }
  }

  private findSpawnPos(team: Team, type: UnitType): Vec | null {
    const r = this.spawnRect(team);
    const def = UNIT_DEFS[type];
    const cx = r.x + r.w / 2 + (team === 'blue' ? 20 : -20);
    const cy = r.y + r.h / 2;
    const cands: Vec[] = [];
    for (let y = r.y + 20; y < r.y + r.h - 10; y += 32) {
      for (let x = r.x + 20; x < r.x + r.w - 10; x += 32) cands.push({ x, y });
    }
    cands.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
    for (const c of cands) {
      if (this.grid.blockedCircle(c.x, c.y, def.radius)) continue;
      let free = true;
      for (const u of this.units) {
        if (!u.alive || u.insideId !== null) continue;
        if (Math.hypot(u.x - c.x, u.y - c.y) < u.def.radius + def.radius + 3) {
          free = false;
          break;
        }
      }
      if (free) return c;
    }
    return null;
  }

  // ---------------------------------------------------------------- rozkazy

  private ownedIds(team: Team, ids: number[]): Unit[] {
    const out: Unit[] = [];
    for (const id of ids) {
      const u = this.byId.get(id);
      if (u && u.alive && u.team === team && u.insideId === null) out.push(u);
    }
    return out;
  }

  /**
   * Rozproszone pozycje docelowe grupy: linia (kilka szeregów) prostopadła do kierunku marszu,
   * z uzupełnieniem pierścieniami, gdy teren blokuje część pól. Układ jest lustrzanie symetryczny
   * dla obu stron.
   */
  formationSlots(units: Unit[], center: Vec): Vec[] {
    const n = units.length;
    const maxR = units.reduce((m, u) => Math.max(m, u.def.radius), 9);
    const spacing = maxR * 2 + 8;
    const region = units.length ? this.grid.regionAt(units[0].x, units[0].y) : -1;
    const exactOk = !this.grid.blockedCircle(center.x, center.y, maxR) && this.grid.regionAt(center.x, center.y) === region;
    const origin = exactOk ? center : (this.grid.nearestFree(center.x, center.y, region) ?? center);
    const ok = (p: Vec) => !this.grid.blockedCircle(p.x, p.y, maxR) && this.grid.regionAt(p.x, p.y) === region;

    const cx = units.reduce((sum, u) => sum + u.x, 0) / Math.max(1, n);
    const cy = units.reduce((sum, u) => sum + u.y, 0) / Math.max(1, n);
    let dx = origin.x - cx;
    let dy = origin.y - cy;
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl;
    dy /= dl;
    const px = -dy;
    const py = dx;

    const width = Math.max(1, Math.ceil(Math.sqrt(n * 1.6)));
    const slots: Vec[] = [];
    for (let row = 0; slots.length < n && row < 12; row++) {
      for (let j = 0; j < width; j++) {
        const off = (j - (width - 1) / 2) * spacing;
        const p = { x: origin.x - dx * row * spacing + px * off, y: origin.y - dy * row * spacing + py * off };
        if (ok(p)) slots.push(p);
      }
    }
    for (let ring = 1; slots.length < n && ring < 14; ring++) {
      const rad = ring * spacing;
      const cnt = Math.max(6, Math.floor((2 * Math.PI * rad) / spacing));
      for (let i = 0; i < cnt && slots.length < n; i++) {
        const a = (i / cnt) * Math.PI * 2;
        const p = { x: origin.x + Math.cos(a) * rad, y: origin.y + Math.sin(a) * rad };
        if (ok(p)) slots.push(p);
      }
    }
    while (slots.length < n) slots.push({ ...origin });
    const chosen = slots.slice(0, n);
    // Dopasowanie bez przecinania się tras: sortowanie po współrzędnej poprzecznej.
    const across = (x: number, y: number) => x * px + y * py;
    const order = units.map((_, i) => i).sort((a, b) => across(units[a].x, units[a].y) - across(units[b].x, units[b].y));
    const sorted = chosen.slice().sort((a, b) => across(a.x, a.y) - across(b.x, b.y));
    const result: Vec[] = new Array(n);
    order.forEach((ui, k) => (result[ui] = sorted[k]));
    return result;
  }

  private sendTo(u: Unit, dest: Vec, type: 'move' | 'attackMove'): boolean {
    const res = this.grid.findPath(u, dest, u.def.radius);
    u.targetId = null;
    u.engaged = false;
    u.healTargetId = null;
    if (!res) {
      u.order = idleOrder();
      u.path = [];
      return false;
    }
    u.order = { type, target: { ...dest } };
    u.path = res.path;
    u.pathIdx = 0;
    u.goal = res.goal;
    u.stuckCount = 0;
    u.anchor = null;
    return true;
  }

  cmdMove(team: Team, ids: number[], target: Vec, attackMove = false): CommandResult {
    const units = this.ownedIds(team, ids);
    if (!units.length) return { ok: false };
    const slots = this.formationSlots(units, target);
    const type = attackMove ? 'attackMove' : 'move';
    let failed = 0;
    let moved = 0;
    units.forEach((u, i) => {
      if (this.sendTo(u, slots[i], type)) {
        moved++;
        // Cel rozkazu - dokładny punkt slotu (po korekcie).
      } else failed++;
    });
    if (moved === 0) return { ok: false, message: 'Cel jest nieosiągalny' };
    const adj = this.grid.isBlockedAt(target.x, target.y) || this.grid.regionAt(target.x, target.y) !== this.grid.regionAt(units[0].x, units[0].y);
    if (failed > 0) return { ok: true, message: `${failed} jednostek nie znalazło drogi` };
    if (adj) return { ok: true, message: 'Cel niedostępny - kierowanie do najbliższego dostępnego punktu' };
    return { ok: true };
  }

  cmdAttack(team: Team, ids: number[], targetId: number): CommandResult {
    const target = this.byId.get(targetId);
    if (!target || !target.alive || target.team === team || !this.canSee(team, target)) {
      return { ok: false, message: 'Cel nie jest widoczny' };
    }
    const units = this.ownedIds(team, ids).filter((u) => u.def.weapons.some((w) => canWeaponHit(w, target.def)));
    if (!units.length) return { ok: false, message: 'Wybrane jednostki nie mogą zaatakować tego celu' };
    for (const u of units) {
      u.order = { type: 'attack', targetId };
      u.targetId = targetId;
      u.path = [];
      u.engaged = true;
      u.anchor = null;
      u.lastKnown = { x: target.x, y: target.y };
    }
    return { ok: true };
  }

  cmdStop(team: Team, ids: number[]): CommandResult {
    for (const u of this.ownedIds(team, ids)) this.setIdle(u);
    return { ok: true };
  }

  cmdHold(team: Team, ids: number[]): CommandResult {
    for (const u of this.ownedIds(team, ids)) {
      this.setIdle(u);
      u.order = { type: 'hold' };
    }
    return { ok: true };
  }

  /** Rozkaz wejścia do transportera (PPM na sojuszniczym transporterze). */
  cmdBoard(team: Team, ids: number[], transportId: number): CommandResult {
    const t = this.byId.get(transportId);
    if (!t || !t.alive || t.team !== team || !t.def.transportCapacity) return { ok: false, message: 'To nie jest transporter' };
    const units = this.ownedIds(team, ids).filter((u) => u.def.canCapture || u.type === 'medic');
    if (!units.length) return { ok: false, message: 'Tylko piechota i medycy mogą wsiadać' };
    if (t.passengers.length >= t.def.transportCapacity) return { ok: false, message: 'Transporter jest pełny' };
    for (const u of units) {
      u.order = { type: 'board', targetId: transportId };
      u.targetId = null;
      u.engaged = false;
      u.path = [];
      u.anchor = null;
    }
    return { ok: true };
  }

  /** Załadunek pobliskich jednostek do wybranego transportera. */
  cmdLoad(team: Team, transportId: number): CommandResult {
    const t = this.byId.get(transportId);
    if (!t || !t.alive || t.team !== team || !t.def.transportCapacity) return { ok: false, message: 'To nie jest transporter' };
    const free = t.def.transportCapacity - t.passengers.length;
    if (free <= 0) return { ok: false, message: 'Transporter jest pełny' };
    const cands = this.units
      .filter((u) => u.alive && u.team === team && u.insideId === null && (u.def.canCapture || u.type === 'medic') && dist(u, t) <= this.rules.loadRadius)
      .sort((a, b) => dist(a, t) - dist(b, t))
      .slice(0, free);
    if (!cands.length) return { ok: false, message: 'Brak piechoty w pobliżu transportera' };
    for (const u of cands) this.boardInto(u, t);
    return { ok: true, message: `Załadowano: ${cands.length}` };
  }

  private boardInto(u: Unit, t: Unit) {
    u.insideId = t.id;
    t.passengers.push(u.id);
    u.x = t.x;
    u.y = t.y;
    u.order = idleOrder();
    u.path = [];
    u.targetId = null;
    u.engaged = false;
    u.healTargetId = null;
  }

  /** Wyładunek na najbliższych wolnych polach. Nie usuwa pasażerów, gdy brak miejsca. */
  cmdUnload(team: Team, transportId: number): CommandResult {
    const t = this.byId.get(transportId);
    if (!t || !t.alive || t.team !== team || !t.def.transportCapacity) return { ok: false, message: 'To nie jest transporter' };
    if (!t.passengers.length) return { ok: false, message: 'Transporter jest pusty' };
    const placed: Vec[] = [];
    const remaining: number[] = [];
    const out: { u: Unit; p: Vec }[] = [];
    for (const pid of t.passengers) {
      const u = this.byId.get(pid);
      if (!u || !u.alive) continue;
      const p = this.findUnloadSpot(t, u, placed);
      if (p) {
        placed.push(p);
        out.push({ u, p });
      } else remaining.push(pid);
    }
    for (const { u, p } of out) {
      u.insideId = null;
      u.x = p.x;
      u.y = p.y;
      u.anchor = { x: p.x, y: p.y };
      u.order = idleOrder();
    }
    t.passengers = remaining;
    if (remaining.length) {
      return { ok: out.length > 0, message: `Brak miejsca do wyładunku (${remaining.length} jedn. pozostaje w pojeździe)` };
    }
    return { ok: true, message: `Wyładowano: ${out.length}` };
  }

  private findUnloadSpot(t: Unit, u: Unit, placed: Vec[]): Vec | null {
    const r = u.def.radius;
    const region = this.grid.regionAt(t.x, t.y);
    for (let ring = 0; ring < 8; ring++) {
      const rad = t.def.radius + r + 6 + ring * (r * 2 + 4);
      const cnt = 12 + ring * 6;
      for (let i = 0; i < cnt; i++) {
        const a = (i / cnt) * Math.PI * 2;
        const p = { x: t.x + Math.cos(a) * rad, y: t.y + Math.sin(a) * rad };
        if (this.grid.blockedCircle(p.x, p.y, r)) continue;
        if (region >= 0 && this.grid.regionAt(p.x, p.y) !== region) continue;
        if (placed.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < r * 2 + 2)) continue;
        let clash = false;
        for (const o of this.units) {
          if (!o.alive || o.insideId !== null || o.id === u.id) continue;
          if (Math.hypot(o.x - p.x, o.y - p.y) < o.def.radius + r + 1) {
            clash = true;
            break;
          }
        }
        if (!clash) return p;
      }
    }
    return null;
  }

  private setIdle(u: Unit) {
    u.order = idleOrder();
    u.path = [];
    u.targetId = null;
    u.engaged = false;
    u.healTargetId = null;
    u.anchor = { x: u.x, y: u.y };
  }

  // ---------------------------------------------------------------- aktualizacja jednostki

  private updateUnit(u: Unit, dt: number) {
    u.movedThisTick = false;
    if (u.insideId !== null) {
      const t = this.byId.get(u.insideId);
      if (t) {
        u.x = t.x;
        u.y = t.y;
      }
      return;
    }
    for (let i = 0; i < u.weaponCd.length; i++) u.weaponCd[i] -= dt;
    u.scanTimer -= dt;
    u.repathTimer -= dt;
    u.healFxTimer -= dt;

    if (u.def.heal) this.medicTick(u, dt);
    else this.orderTick(u, dt);
  }

  private validTarget(u: Unit): Unit | null {
    if (u.targetId === null) return null;
    const t = this.byId.get(u.targetId);
    if (t && t.alive && t.insideId === null && this.canSee(u.team, t)) {
      u.lastKnown = { x: t.x, y: t.y };
      return t;
    }
    // Utrata widoczności: jednostka zna już tylko ostatnią pozycję.
    u.targetId = null;
    return null;
  }

  private acquireDist(u: Unit) {
    const indirect = u.def.weapons.find((w) => w.indirect);
    if (indirect) return indirect.range;
    return u.def.vision;
  }

  private findTarget(u: Unit, maxDist: number): Unit | null {
    let best: Unit | null = null;
    let bs = -Infinity;
    for (const e of this.visible[u.team]) {
      const d = dist(u, e);
      if (d > maxDist || this.isInvulnerable(e)) continue;
      let sc = -Infinity;
      for (const w of u.def.weapons) {
        if (!canWeaponHit(w, e.def)) continue;
        if (w.minRange && d < w.minRange) continue;
        sc = Math.max(sc, targetScore(u, w, e, d));
      }
      if (sc > bs) {
        bs = sc;
        best = e;
      }
    }
    return best;
  }

  private engageRange(u: Unit, t: Unit) {
    let r = 0;
    for (const w of u.def.weapons) if (canWeaponHit(w, t.def)) r = Math.max(r, w.range);
    return r;
  }

  private orderTick(u: Unit, dt: number) {
    const o = u.order;
    switch (o.type) {
      case 'move': {
        if (this.follow(u, dt)) this.setIdle(u);
        break;
      }
      case 'attackMove': {
        let t = this.validTarget(u);
        if (!t && u.scanTimer <= 0 && u.def.weapons.length) {
          u.scanTimer = 0.25;
          t = this.findTarget(u, this.acquireDist(u));
          if (t) u.targetId = t.id;
        }
        if (t) {
          if (!u.engaged) {
            u.engaged = true;
            u.path = [];
          }
          this.engage(u, t, dt);
          break;
        }
        if (u.engaged) {
          u.engaged = false;
          u.path = [];
        }
        if (u.path.length === 0 && o.target) {
          if (dist(u, o.target) < 26 || !this.repath(u, o.target)) {
            this.setIdle(u);
            break;
          }
        }
        if (this.follow(u, dt)) this.setIdle(u);
        break;
      }
      case 'attack': {
        const t = o.targetId !== undefined ? this.byId.get(o.targetId) : undefined;
        if (!t || !t.alive) {
          this.setIdle(u);
          break;
        }
        if (!this.canSee(u.team, t) || t.insideId !== null) {
          // Cel zniknął z widoku: idziemy tylko w ostatnie znane miejsce.
          const lk = u.lastKnown;
          u.targetId = null;
          if (lk && this.sendTo(u, lk, 'attackMove')) break;
          this.setIdle(u);
          break;
        }
        u.targetId = t.id;
        u.lastKnown = { x: t.x, y: t.y };
        this.engage(u, t, dt);
        break;
      }
      case 'board': {
        const t = o.targetId !== undefined ? this.byId.get(o.targetId) : undefined;
        if (!t || !t.alive || t.passengers.length >= (t.def.transportCapacity ?? 0)) {
          this.setIdle(u);
          break;
        }
        if (dist(u, t) <= this.rules.boardDistance) {
          this.boardInto(u, t);
          break;
        }
        if (u.repathTimer <= 0 || u.path.length === 0) {
          u.repathTimer = 0.6;
          this.repath(u, t);
        }
        this.follow(u, dt);
        break;
      }
      case 'idle':
      case 'hold': {
        const hold = o.type === 'hold';
        let t = this.validTarget(u);
        if (!t && u.scanTimer <= 0 && u.def.weapons.length) {
          u.scanTimer = 0.3;
          const maxD = hold ? Math.max(...u.def.weapons.map((w) => w.range)) : this.acquireDist(u);
          t = this.findTarget(u, maxD);
          if (t) u.targetId = t.id;
        }
        if (t && !hold) {
          const from = u.anchor ?? { x: u.x, y: u.y };
          if (!u.anchor) u.anchor = from;
          if (dist(u, from) > this.rules.leash && dist(u, t) > this.engageRange(u, t) * 0.95) {
            u.targetId = null; // zbyt daleko od posterunku
            t = null;
          } else {
            u.engaged = true;
            this.engage(u, t, dt);
            break;
          }
        }
        if (u.engaged && !hold) {
          u.engaged = false;
          u.path = [];
        }
        if (!hold && !t) this.returnToAnchor(u, dt);
        break;
      }
    }
  }

  private returnToAnchor(u: Unit, dt: number) {
    if (!u.anchor) return;
    if (u.path.length === 0 && dist(u, u.anchor) > 40 && u.repathTimer <= 0) {
      u.repathTimer = 1;
      this.repath(u, u.anchor);
    }
    if (u.path.length && this.follow(u, dt)) u.path = [];
  }

  /** Zbliż się do celu tak, by móc strzelać; zatrzymaj się, gdy cel jest w zasięgu i linii strzału. */
  private engage(u: Unit, t: Unit, dt: number) {
    const range = this.engageRange(u, t);
    const d = dist(u, t);
    const indirect = u.def.weapons.some((w) => w.indirect && canWeaponHit(w, t.def));
    const los = indirect || this.grid.hasLineOfFire(u, t);
    if (range > 0 && d <= range * 0.95 && los) {
      u.path = [];
      u.facing = Math.atan2(t.y - u.y, t.x - u.x);
      return;
    }
    if (u.order.type === 'hold') return;
    if (u.repathTimer <= 0 || u.path.length === 0) {
      u.repathTimer = 0.5;
      this.repath(u, t);
    }
    this.follow(u, dt);
  }

  private repath(u: Unit, dest: Vec): boolean {
    const res = this.grid.findPath(u, dest, u.def.radius);
    if (!res) {
      u.path = [];
      return false;
    }
    u.path = res.path;
    u.pathIdx = 0;
    u.goal = res.goal;
    return true;
  }

  /** Marsz po trasie. Zwraca true po dotarciu do końca. */
  private follow(u: Unit, dt: number): boolean {
    if (u.pathIdx >= u.path.length) {
      return u.path.length > 0;
    }
    const wp = u.path[u.pathIdx];
    const dx = wp.x - u.x;
    const dy = wp.y - u.y;
    const d = Math.hypot(dx, dy);
    const step = u.def.speed * dt;
    let nx: number;
    let ny: number;
    if (d <= step) {
      nx = wp.x;
      ny = wp.y;
    } else {
      nx = u.x + (dx / d) * step;
      ny = u.y + (dy / d) * step;
    }
    const r = u.def.radius;
    let moved = false;
    if (!this.grid.blockedCircle(nx, ny, r)) {
      u.x = nx;
      u.y = ny;
      moved = true;
    } else if (!this.grid.blockedCircle(nx, u.y, r)) {
      u.x = nx;
      moved = true;
    } else if (!this.grid.blockedCircle(u.x, ny, r)) {
      u.y = ny;
      moved = true;
    }
    if (moved) {
      u.movedThisTick = true;
      u.facing = Math.atan2(dy, dx);
    }
    if (d <= step && moved) {
      u.pathIdx++;
      if (u.pathIdx >= u.path.length) {
        u.path = [];
        u.pathIdx = 0;
        u.stuckCount = 0;
        return true;
      }
    }

    // Wykrywanie zablokowania (np. przez tłok jednostek).
    u.stuckTimer += dt;
    if (u.stuckTimer >= 1) {
      u.stuckTimer = 0;
      const moved1 = Math.hypot(u.x - u.lastCheckPos.x, u.y - u.lastCheckPos.y);
      u.lastCheckPos = { x: u.x, y: u.y };
      if (moved1 < u.def.speed * 0.25) {
        u.stuckCount++;
        const goal = u.goal;
        if (goal && dist(u, goal) < r * 3 + 24) {
          u.path = [];
          return true; // dotarliśmy "wystarczająco blisko" - zatłoczony cel
        }
        if (u.stuckCount === 2 && goal) this.repath(u, goal);
        else if (u.stuckCount >= 4) {
          u.path = [];
          u.stuckCount = 0;
          return true;
        }
      } else u.stuckCount = 0;
    }
    return false;
  }

  // ---------------------------------------------------------------- medyk

  private medicTick(u: Unit, dt: number) {
    const heal = u.def.heal!;
    // wybór pacjenta
    let patient = u.healTargetId !== null ? this.byId.get(u.healTargetId) : undefined;
    const okPatient = (p: Unit | undefined) =>
      !!p && p.alive && p.team === u.team && p.id !== u.id && p.insideId === null && p.hp < p.def.maxHp &&
      (p.def.canCapture || p.type === 'medic');
    if (!okPatient(patient) || dist(u, patient!) > heal.range) {
      patient = undefined;
      let best: Unit | null = null;
      let bestScore = Infinity;
      for (const p of this.units) {
        if (!okPatient(p)) continue;
        const d = dist(u, p);
        if (d > heal.range) continue;
        const sc = p.hp / p.def.maxHp + d * 0.0005;
        if (sc < bestScore) {
          bestScore = sc;
          best = p;
        }
      }
      patient = best ?? undefined;
      u.healTargetId = patient ? patient.id : null;
    }
    if (patient) {
      patient.hp = Math.min(patient.def.maxHp, patient.hp + heal.rate * dt);
      if (u.healFxTimer <= 0) {
        u.healFxTimer = 0.45;
        this.events.push({ kind: 'heal', from: { x: u.x, y: u.y }, to: { x: patient.x, y: patient.y } });
      }
    }
    const o = u.order;
    const canStay = patient && (o.type === 'idle' || o.type === 'hold' || o.type === 'attackMove');
    if (canStay) return;
    if (o.type === 'idle' && !patient) {
      // Podążanie za rannymi w pobliżu, potem powrót na posterunek.
      let chase = u.targetId !== null ? this.byId.get(u.targetId) : undefined;
      if (!okPatient(chase)) {
        chase = undefined;
        u.targetId = null;
      }
      if (!chase && u.scanTimer <= 0) {
        u.scanTimer = 0.5;
        let bd = Infinity;
        for (const p of this.units) {
          if (!okPatient(p)) continue;
          const d = dist(u, p);
          if (d <= u.def.vision && d < bd) {
            bd = d;
            chase = p;
          }
        }
        u.targetId = chase ? chase.id : null;
      }
      if (chase) {
        u.engaged = true;
        if (u.repathTimer <= 0 || u.path.length === 0) {
          u.repathTimer = 0.6;
          this.repath(u, chase);
        }
        this.follow(u, dt);
        return;
      }
      if (u.engaged) {
        u.engaged = false;
        u.path = [];
      }
      this.returnToAnchor(u, dt);
      return;
    }
    if (o.type === 'attack') {
      this.setIdle(u);
      return;
    }
    this.orderTick(u, dt);
  }

  // ---------------------------------------------------------------- walka

  private fireWeapons(u: Unit) {
    if (this.isInvulnerable(u)) return;
    const enemies = this.visible[u.team];
    if (!enemies.length) return;
    const pref = u.order.type === 'attack' && u.order.targetId !== undefined ? this.byId.get(u.order.targetId) : u.targetId !== null ? this.byId.get(u.targetId) : undefined;
    for (let i = 0; i < u.def.weapons.length; i++) {
      if (u.weaponCd[i] > 0) continue;
      const w = u.def.weapons[i];
      if (w.canFireMoving === false && u.movedThisTick) continue;
      let best: Unit | null = null;
      let bs = -Infinity;
      const consider = (e: Unit) => {
        if (!e.alive || e.insideId !== null || this.isInvulnerable(e)) return;
        if (!canWeaponHit(w, e.def)) return;
        const d = dist(u, e);
        if (d > w.range || (w.minRange && d < w.minRange)) return;
        const sc = targetScore(u, w, e, d) + (pref && e.id === pref.id ? 1000 : 0);
        if (sc <= bs) return;
        if (!w.indirect && !this.grid.hasLineOfFire(u, e)) return;
        bs = sc;
        best = e;
      };
      for (const e of enemies) consider(e);
      if (!best) continue;
      this.fire(u, w, i, best);
    }
  }

  private fire(u: Unit, w: WeaponDef, wi: number, t: Unit) {
    u.weaponCd[wi] = w.cooldown;
    u.facing = Math.atan2(t.y - u.y, t.x - u.x);
    const from = { x: u.x, y: u.y };
    if (w.indirect) {
      this.projectiles.push({
        x: u.x, y: u.y, tx: t.x, ty: t.y, speed: w.projectileSpeed ?? 250, weapon: w, team: u.team, shooterId: u.id,
      });
      this.events.push({ kind: 'shot', from, to: { x: t.x, y: t.y }, team: u.team, weaponId: w.id, indirect: true });
    } else {
      this.events.push({ kind: 'shot', from, to: { x: t.x, y: t.y }, team: u.team, weaponId: w.id, indirect: false });
      this.pendingHits.push({ target: t, amount: calcDamage(w, t.def), source: u.team });
    }
  }

  private applyPendingHits() {
    for (const h of this.pendingHits) this.damage(h.target, h.amount, h.source);
    this.pendingHits.length = 0;
  }

  damage(t: Unit, amount: number, source: Team | null) {
    if (!t.alive || amount <= 0 || this.isInvulnerable(t)) return;
    t.hp -= amount;
    t.lastDamagedAt = this.time;
    this.events.push({ kind: 'hit', at: { x: t.x, y: t.y } });
    if (t.hp <= 0) this.kill(t, source);
  }

  /** Niszczy jednostkę. PZ przyznawane dokładnie raz (flaga alive), pasażerowie giną razem z pojazdem. */
  kill(u: Unit, killer: Team | null) {
    if (!u.alive) return;
    u.alive = false;
    u.hp = 0;
    if (killer && killer !== u.team) {
      this.teams[killer].pz += u.def.pzValue;
      this.teams[killer].kills++;
    }
    if (u.insideId === null) this.events.push({ kind: 'death', at: { x: u.x, y: u.y }, unitType: u.type, team: u.team });
    for (const pid of u.passengers) {
      const p = this.byId.get(pid);
      if (p) {
        p.x = u.x;
        p.y = u.y;
        this.kill(p, killer);
      }
    }
    u.passengers = [];
    if (u.insideId !== null) {
      const t = this.byId.get(u.insideId);
      if (t) t.passengers = t.passengers.filter((id) => id !== u.id);
    }
  }

  private updateProjectiles(dt: number) {
    if (!this.projectiles.length) return;
    const keep: Projectile[] = [];
    for (const p of this.projectiles) {
      const dx = p.tx - p.x;
      const dy = p.ty - p.y;
      const d = Math.hypot(dx, dy);
      const step = p.speed * dt;
      if (d <= step) {
        this.explode(p);
      } else {
        p.x += (dx / d) * step;
        p.y += (dy / d) * step;
        keep.push(p);
      }
    }
    this.projectiles = keep;
  }

  private explode(p: Projectile) {
    const r = p.weapon.splash ?? 60;
    this.events.push({ kind: 'explosion', at: { x: p.tx, y: p.ty }, radius: r });
    for (const u of this.units) {
      if (!u.alive || u.insideId !== null || u.team === p.team) continue; // bez friendly fire
      const d = Math.hypot(u.x - p.tx, u.y - p.ty);
      if (d > r + u.def.radius * 0.5) continue;
      const falloff = 1 - 0.5 * Math.min(1, d / r);
      this.damage(u, calcDamage(p.weapon, u.def) * falloff, p.team);
    }
  }

  // ---------------------------------------------------------------- kolizje

  private separate() {
    const arr = this.units.filter((u) => u.alive && u.insideId === null);
    for (let i = 0; i < arr.length; i++) {
      const a = arr[i];
      for (let j = i + 1; j < arr.length; j++) {
        const b = arr[j];
        const min = a.def.radius + b.def.radius;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if (Math.abs(dx) > min || Math.abs(dy) > min) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        let d = Math.sqrt(d2);
        let ux: number;
        let uy: number;
        if (d < 0.001) {
          const ang = ((a.id * 7 + b.id * 13) % 360) * (Math.PI / 180);
          ux = Math.cos(ang);
          uy = Math.sin(ang);
          d = 0;
        } else {
          ux = dx / d;
          uy = dy / d;
        }
        const overlap = (min - d) * 0.5;
        // Poruszająca się jednostka jest odpychana mniej niż stojąca.
        const wa = a.movedThisTick && !b.movedThisTick ? 0.3 : 0.5;
        const wb = b.movedThisTick && !a.movedThisTick ? 0.3 : 0.5;
        this.nudge(a, -ux * overlap * (wa * 2) * 0.5, -uy * overlap * (wa * 2) * 0.5);
        this.nudge(b, ux * overlap * (wb * 2) * 0.5, uy * overlap * (wb * 2) * 0.5);
      }
    }
  }

  private nudge(u: Unit, dx: number, dy: number) {
    const r = u.def.radius;
    if (!this.grid.blockedCircle(u.x + dx, u.y + dy, r)) {
      u.x += dx;
      u.y += dy;
    } else if (!this.grid.blockedCircle(u.x + dx, u.y, r)) u.x += dx;
    else if (!this.grid.blockedCircle(u.x, u.y + dy, r)) u.y += dy;
  }

  // ---------------------------------------------------------------- zapytania dla UI / AI

  visibleEnemiesOf(team: Team): Unit[] {
    return this.visible[team];
  }

  zoneOwnerCount(team: Team) {
    return ownedCount(this.zones, team);
  }

  enemyTeam(team: Team) {
    return enemyOf(team);
  }
}
