import { UNIT_DEFS } from '../config/units';
import { dist } from './combat';
import type { Game } from './game';
import type { Team, Unit, UnitType, Vec } from './types';

interface Sighting {
  x: number;
  y: number;
  type: UnitType;
  t: number;
}

/**
 * Prosta strategia AI, podejmowana okresowo. Zasady uczciwej gry:
 *  - te same koszty, dochody i limity (zakupy przez Game.buy),
 *  - wiedza o wrogu wyłącznie z własnej mgły wojny (Game.visibleEnemiesOf) + pamięć obserwacji,
 *  - brak odczytu ukrytych pozycji jednostek gracza.
 */
export class AIController {
  private timer = 0.5;
  private lastWave = 0;
  private buyIndex = 0;
  private sightings = new Map<number, Sighting>();
  /** Przydział piechoty do stref. */
  private assign = new Map<number, string>();

  private readonly buildOrder: UnitType[] = [
    'infantry', 'infantry', 'infantry', 'medic', 'infantry', 'ifv', 'infantry', 'infantry', 'tank',
    'infantry', 'medic', 'infantry', 'artillery', 'ifv', 'infantry', 'infantry', 'tank',
  ];

  constructor(private game: Game, readonly team: Team) {}

  update(dt: number) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = this.game.rules.aiInterval;
    this.think();
  }

  /** Obserwacje przeciwnika dostępne dla AI (do testów uczciwości). */
  knownEnemyIds(): number[] {
    return [...this.sightings.keys()];
  }

  private think() {
    const g = this.game;
    const now = g.time;
    // Pamięć obserwacji - tylko to, co AI aktualnie widzi.
    for (const e of g.visibleEnemiesOf(this.team)) this.sightings.set(e.id, { x: e.x, y: e.y, type: e.type, t: now });
    for (const [id, s] of this.sightings) if (now - s.t > 45) this.sightings.delete(id);

    this.buyUnits();
    this.commandUnits();
  }

  private recentEnemies(maxAge: number) {
    const now = this.game.time;
    return [...this.sightings.values()].filter((s) => now - s.t <= maxAge);
  }

  private buyUnits() {
    const g = this.game;
    const q = g.teams[this.team].queue;
    for (let guard = 0; guard < 6; guard++) {
      let type = this.buildOrder[this.buyIndex % this.buildOrder.length];
      const enemies = this.recentEnemies(40);
      const heavy = enemies.filter((s) => s.type === 'tank').length;
      const queuedTanks = q.filter((i) => i.type === 'tank').length + g.unitsOf(this.team).filter((u) => u.type === 'tank').length;
      if (heavy > queuedTanks && type !== 'tank' && type !== 'infantry') type = 'tank';
      const inf = g.unitsOf(this.team).filter((u) => u.type === 'infantry').length + q.filter((i) => i.type === 'infantry').length;
      if (inf < 4) type = 'infantry';
      if (g.buyBlockReason(this.team, type)) {
        // Jeśli drogi pojazd jest niedostępny, a PD jest sporo, nie blokuj się dłużej niż potrzeba.
        const cheap = g.teams[this.team].pd >= UNIT_DEFS.infantry.cost * 3 && UNIT_DEFS[type].cost > UNIT_DEFS.infantry.cost * 3;
        if (!cheap) break;
        type = 'infantry';
        if (g.buyBlockReason(this.team, type)) break;
      }
      if (g.buy(this.team, type).ok) this.buyIndex++;
      else break;
    }
  }

  private commandUnits() {
    const g = this.game;
    const mine = g.unitsOf(this.team).filter((u) => u.insideId === null);
    const infantry = mine.filter((u) => u.type === 'infantry');
    const zones = g.zones;
    const spawn = g.spawnRect(this.team);
    const home: Vec = { x: spawn.x + spawn.w / 2, y: spawn.y + spawn.h / 2 };
    // Punkt zbiórki fali ataku: na drodze, kawałek od strefy przyjazdu.
    const staging: Vec = { x: home.x + (g.map.width / 2 - home.x) * 0.22, y: home.y };
    const enemies = this.recentEnemies(25);

    for (const id of [...this.assign.keys()]) if (!g.byId.get(id)?.alive) this.assign.delete(id);

    // Potrzeby obrony: zdobyte strefy, w pobliżu których widziano wroga.
    const defendNeed = new Map<string, number>();
    for (const z of zones) {
      if (z.owner !== this.team) continue;
      const threatened = enemies.some((s) => Math.hypot(s.x - z.def.x, s.y - z.def.y) < 450);
      defendNeed.set(z.def.id, threatened ? 3 : 1);
    }
    const counts = new Map<string, number>();
    for (const id of this.assign.values()) counts.set(id, (counts.get(id) ?? 0) + 1);
    const attackZones = zones.filter((z) => z.owner !== this.team);

    const pending = new Map<string, Unit[]>();
    const place = (u: Unit, zoneId: string) => {
      this.assign.set(u.id, zoneId);
      counts.set(zoneId, (counts.get(zoneId) ?? 0) + 1);
      (pending.get(zoneId) ?? pending.set(zoneId, []).get(zoneId)!).push(u);
    };
    const queueReissue = (u: Unit, zoneId: string) => {
      (pending.get(zoneId) ?? pending.set(zoneId, []).get(zoneId)!).push(u);
    };

    const waiting: Unit[] = [];
    for (const u of infantry) {
      const cur = this.assign.get(u.id);
      const zone = cur ? zones.find((z) => z.def.id === cur) : undefined;
      if (zone) {
        const surplus = zone.owner === this.team && (defendNeed.get(zone.def.id) ?? 0) < (counts.get(zone.def.id) ?? 0);
        if (surplus && u.order.type === 'idle') {
          counts.set(zone.def.id, (counts.get(zone.def.id) ?? 1) - 1);
          this.assign.delete(u.id);
          waiting.push(u);
        } else if (zone.owner !== this.team && u.order.type === 'idle' && dist(u, zone.def) > 150) {
          queueReissue(u, zone.def.id); // marsz przerwany (np. po walce) - ponów rozkaz
        }
        continue;
      }
      // Brak przydziału: najpierw braki w obronie, w przeciwnym razie czeka na falę.
      let defend: string | null = null;
      let bestD = Infinity;
      for (const z of zones) {
        if (z.owner !== this.team) continue;
        if ((counts.get(z.def.id) ?? 0) >= (defendNeed.get(z.def.id) ?? 0)) continue;
        const d = dist(u, z.def);
        if (d < bestD) {
          bestD = d;
          defend = z.def.id;
        }
      }
      if (defend) place(u, defend);
      else waiting.push(u);
    }

    // Fala ataku: piechota rusza grupą do jednej strefy.
    const sinceWave = g.time - this.lastWave;
    const waveReady = waiting.length >= 5 || (waiting.length >= 3 && sinceWave > 20) || (waiting.length >= 2 && sinceWave > 45);
    if (waveReady && attackZones.length) {
      let best: string | null = null;
      let bestScore = Infinity;
      for (const z of attackZones) {
        const toHome = Math.hypot(z.def.x - home.x, z.def.y - home.y);
        const score = toHome + (counts.get(z.def.id) ?? 0) * 220 + (z.owner === null ? 0 : 150);
        if (score < bestScore) {
          bestScore = score;
          best = z.def.id;
        }
      }
      if (best) {
        for (const u of waiting) place(u, best);
        this.lastWave = g.time;
        waiting.length = 0;
      }
    }
    if (waiting.length) {
      const idle = waiting.filter((u) => u.order.type === 'idle' && dist(u, staging) > 110);
      if (idle.length) g.cmdMove(this.team, idle.map((u) => u.id), staging, true);
    }

    for (const [zoneId, units] of pending) {
      const z = zones.find((zz) => zz.def.id === zoneId)!;
      g.cmdMove(this.team, units.map((u) => u.id), { x: z.def.x, y: z.def.y }, true);
    }

    // Punkt ciężkości grupy ataku: strefa z największą liczbą przydzielonej piechoty.
    let focus: Vec | null = null;
    let focusCount = 0;
    for (const z of attackZones) {
      const c = counts.get(z.def.id) ?? 0;
      if (c > focusCount) {
        focusCount = c;
        focus = { x: z.def.x, y: z.def.y };
      }
    }
    const infCentroid = infantry.length
      ? { x: infantry.reduce((s, u) => s + u.x, 0) / infantry.length, y: infantry.reduce((s, u) => s + u.y, 0) / infantry.length }
      : null;

    for (const u of mine) {
      if (u.type === 'medic') {
        // Medycy podążają za najbliższą piechotą.
        let best: Unit | null = null;
        let bd = Infinity;
        for (const i of infantry) {
          const d = dist(u, i);
          if (d < bd) {
            bd = d;
            best = i;
          }
        }
        if (best && bd > 110 && (u.order.type === 'idle' || u.order.type === 'move')) {
          g.cmdMove(this.team, [u.id], { x: best.x, y: best.y }, false);
        }
      } else if (u.type === 'ifv' || u.type === 'tank' || u.type === 'apc') {
        // Pojazdy dołączają do ataku, gdy jest piechota do wsparcia; wcześniej czekają na punkcie zbiórki.
        if (u.order.type === 'idle') {
          if (focus) g.cmdMove(this.team, [u.id], focus, true);
          else if (dist(u, staging) > 130) g.cmdMove(this.team, [u.id], staging, true);
        }
      } else if (u.type === 'artillery') {
        const post = infCentroid ? { x: home.x + (infCentroid.x - home.x) * 0.55, y: home.y + (infCentroid.y - home.y) * 0.55 } : home;
        if (u.order.type === 'idle' && dist(u, post) > 140) g.cmdMove(this.team, [u.id], post, false);
        else if (u.order.type === 'idle') g.cmdHold(this.team, [u.id]);
        else if (u.order.type === 'hold' && dist(u, post) > 420) g.cmdMove(this.team, [u.id], post, false);
      }
    }
  }
}
