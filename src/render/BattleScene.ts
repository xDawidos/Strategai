import Phaser from 'phaser';
import { Game, type Winner } from '../core/game';
import { FOG_EXPLORED, FOG_UNKNOWN } from '../core/fog';
import type { Unit, Vec } from '../core/types';
import { createUnitTextures, spriteKey } from './sprites';
import { renderTerrain } from './terrain';

export type CommandMode = 'none' | 'attackMove' | 'rally';
export const PLAYER = 'blue' as const;

export interface SceneHooks {
  toast(text: string): void;
  onEnd(winner: Winner): void;
  onPauseChange(paused: boolean): void;
}

interface Fx {
  kind: 'tracer' | 'explosion' | 'ping' | 'heal' | 'burst' | 'hit';
  x: number;
  y: number;
  x2?: number;
  y2?: number;
  t: number;
  ttl: number;
  color: number;
  size: number;
}

const COLORS = { blue: 0x4c8dff, red: 0xff5a4a };

export class BattleScene extends Phaser.Scene {
  sim: Game | null = null;
  hooks!: SceneHooks;
  selection = new Set<number>();
  mode: CommandMode = 'none';
  paused = false;
  active = false;
  terrainCanvas: HTMLCanvasElement | null = null;
  fogCanvas: HTMLCanvasElement | null = null;
  private fogHi: HTMLCanvasElement | null = null;

  private matchNo = 0;
  private sprites = new Map<number, Phaser.GameObjects.Image>();
  private overlay!: Phaser.GameObjects.Graphics;
  private fxGfx!: Phaser.GameObjects.Graphics;
  private zoneGfx!: Phaser.GameObjects.Graphics;
  private zoneTexts: { name: Phaser.GameObjects.Text; state: Phaser.GameObjects.Text }[] = [];
  private terrainImg: Phaser.GameObjects.Image | null = null;
  private fogImg: Phaser.GameObjects.Image | null = null;
  private fogVersion = -1;
  private fx: Fx[] = [];
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private dragStart: { sx: number; sy: number; wx: number; wy: number } | null = null;
  private dragNow: Vec | null = null;
  private lastClick = { t: 0, id: -1 };
  private groups = new Map<number, number[]>();
  private ended = false;
  /** Mnożnik prędkości symulacji (do testów/debugowania). */
  speed = 1;

  constructor() {
    super('battle');
  }

  create() {
    createUnitTextures(this);
    this.overlay = this.add.graphics().setDepth(20);
    this.fxGfx = this.add.graphics().setDepth(25);
    this.zoneGfx = this.add.graphics().setDepth(40);
    this.cameras.main.setBackgroundColor('#0b0f14');

    const kb = this.input.keyboard!;
    this.keys = kb.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,H,L,U,R,SPACE,ESC,SHIFT,CTRL') as Record<string, Phaser.Input.Keyboard.Key>;
    kb.addCapture('SPACE,UP,DOWN,LEFT,RIGHT');
    this.input.mouse?.disableContextMenu();
    this.game.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    kb.on('keydown', (e: KeyboardEvent) => this.onKey(e));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onPointerDown(p));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onPointerMove(p));
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.onPointerUp(p));
    this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (this.active) this.zoomAt(p.x, p.y, dy < 0 ? 1.15 : 1 / 1.15);
    });
    this.scale.on('resize', () => this.clampCamera());
  }

  // ------------------------------------------------------------------ start meczu

  startMatch(zoneCount: number, hooks: SceneHooks) {
    this.hooks = hooks;
    this.clearMatch();
    this.matchNo++;
    this.sim = new Game({ zoneCount, ai: true });
    const map = this.sim.map;

    this.terrainCanvas = renderTerrain(map);
    const tKey = `terrain_${this.matchNo}`;
    this.textures.addCanvas(tKey, this.terrainCanvas);
    this.terrainImg = this.add.image(0, 0, tKey).setOrigin(0, 0).setDepth(0);

    const fog = this.sim.fog;
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = fog.cols;
    this.fogCanvas.height = fog.rows;
    const fKey = `fog_${this.matchNo}`;
    // Mgła jest wygładzana ręcznie (4× większy canvas z interpolacją), bo pixelArt wymusza filtr NEAREST.
    this.fogHi = document.createElement('canvas');
    this.fogHi.width = fog.cols * 4;
    this.fogHi.height = fog.rows * 4;
    this.textures.addCanvas(fKey, this.fogHi);
    this.fogImg = this.add.image(0, 0, fKey).setOrigin(0, 0).setDepth(30).setDisplaySize(fog.cols * fog.cell, fog.rows * fog.cell);
    this.fogVersion = -1;

    for (const z of this.sim.zones) {
      const name = this.add.text(z.def.x, z.def.y - 136, z.def.name, {
        fontFamily: 'Trebuchet MS, Verdana, sans-serif', fontSize: '18px', color: '#ffffff', stroke: '#000000', strokeThickness: 4, fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(41).setResolution(2);
      const state = this.add.text(z.def.x, z.def.y - 113, '', {
        fontFamily: 'Trebuchet MS, Verdana, sans-serif', fontSize: '15px', color: '#ffffff', stroke: '#000000', strokeThickness: 4,
      }).setOrigin(0.5).setDepth(41).setResolution(2);
      this.zoneTexts.push({ name, state });
    }

    const cam = this.cameras.main;
    cam.setZoom(1);
    const sp = this.sim.spawnRect(PLAYER);
    cam.centerOn(sp.x + 560, sp.y + sp.h / 2);
    this.clampCamera();
    this.selection.clear();
    this.mode = 'none';
    this.paused = false;
    this.ended = false;
    this.active = true;
  }

  private clearMatch() {
    for (const s of this.sprites.values()) s.destroy();
    this.sprites.clear();
    for (const t of this.zoneTexts) {
      t.name.destroy();
      t.state.destroy();
    }
    this.zoneTexts = [];
    this.terrainImg?.destroy();
    this.fogImg?.destroy();
    this.terrainImg = this.fogImg = null;
    for (const k of [`terrain_${this.matchNo}`, `fog_${this.matchNo}`]) if (this.textures.exists(k)) this.textures.remove(k);
    this.fx = [];
    this.groups.clear();
    this.overlay?.clear();
    this.fxGfx?.clear();
    this.zoneGfx?.clear();
    this.sim = null;
    this.active = false;
  }

  setPaused(p: boolean) {
    if (!this.active || this.ended) return;
    this.paused = p;
    this.hooks.onPauseChange(p);
  }

  // ------------------------------------------------------------------ kamera

  private get minZoom() {
    const cam = this.cameras.main;
    const m = this.sim?.map;
    if (!m) return 0.3;
    return Math.max(0.3, cam.width / m.width, cam.height / m.height);
  }

  zoomAt(sx: number, sy: number, factor: number) {
    const cam = this.cameras.main;
    const before = cam.getWorldPoint(sx, sy);
    const z = Phaser.Math.Clamp(cam.zoom * factor, this.minZoom, 2.4);
    cam.setZoom(z);
    cam.scrollX = before.x - cam.width / 2 - (sx - cam.width / 2) / z;
    cam.scrollY = before.y - cam.height / 2 - (sy - cam.height / 2) / z;
    this.clampCamera();
  }

  clampCamera() {
    const cam = this.cameras.main;
    const m = this.sim?.map;
    if (!m) return;
    if (cam.zoom < this.minZoom) cam.setZoom(this.minZoom);
    const hw = cam.width / 2 / cam.zoom;
    const hh = cam.height / 2 / cam.zoom;
    let cx = cam.scrollX + cam.width / 2;
    let cy = cam.scrollY + cam.height / 2;
    cx = hw * 2 >= m.width ? m.width / 2 : Phaser.Math.Clamp(cx, hw, m.width - hw);
    cy = hh * 2 >= m.height ? m.height / 2 : Phaser.Math.Clamp(cy, hh, m.height - hh);
    cam.scrollX = cx - cam.width / 2;
    cam.scrollY = cy - cam.height / 2;
  }

  centerCamera(x: number, y: number) {
    this.cameras.main.centerOn(x, y);
    this.clampCamera();
  }

  /** Prostokąt widoku kamery w świecie (do minimapy). */
  viewRect() {
    const cam = this.cameras.main;
    const w = cam.width / cam.zoom;
    const h = cam.height / cam.zoom;
    return { x: cam.scrollX + cam.width / 2 - w / 2, y: cam.scrollY + cam.height / 2 - h / 2, w, h };
  }

  private world(p: Phaser.Input.Pointer): Vec {
    const w = this.cameras.main.getWorldPoint(p.x, p.y);
    return { x: w.x, y: w.y };
  }

  // ------------------------------------------------------------------ wejście

  selectedUnits(): Unit[] {
    const sim = this.sim;
    if (!sim) return [];
    const out: Unit[] = [];
    for (const id of this.selection) {
      const u = sim.byId.get(id);
      if (u && u.alive && sim.canSee(PLAYER, u)) out.push(u);
    }
    return out;
  }

  ownSelected(): Unit[] {
    return this.selectedUnits().filter((u) => u.team === PLAYER);
  }

  private onKey(e: KeyboardEvent) {
    if (!this.active) return;
    const k = e.key.toLowerCase();
    if (e.target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
    if (k === ' ') {
      this.setPaused(!this.paused);
      return;
    }
    if (k === 'escape') {
      if (this.mode !== 'none') this.setMode('none');
      else this.setPaused(false);
      return;
    }
    if (this.paused || this.ended) return;
    if (/^[1-9]$/.test(k)) {
      const n = Number(k);
      if (e.ctrlKey || e.metaKey) {
        this.groups.set(n, this.ownSelected().map((u) => u.id));
        this.hooks.toast(`Grupa ${n} zapisana`);
        e.preventDefault();
      } else if (this.groups.has(n)) {
        const ids = (this.groups.get(n) ?? []).filter((id) => this.sim!.byId.get(id)?.alive);
        this.selection = new Set(ids);
      }
      return;
    }
    if (e.shiftKey && (k === 'a' || k === 's')) return; // Shift+A/S przesuwa kamerę
    switch (k) {
      case 'a':
        if (this.ownSelected().length) this.setMode(this.mode === 'attackMove' ? 'none' : 'attackMove');
        break;
      case 's':
        this.command('stop');
        break;
      case 'h':
        this.command('hold');
        break;
      case 'l':
        this.command('load');
        break;
      case 'u':
        this.command('unload');
        break;
      case 'r':
        this.setMode(this.mode === 'rally' ? 'none' : 'rally');
        break;
    }
  }

  setMode(m: CommandMode) {
    this.mode = m;
    this.game.canvas.style.cursor = m === 'none' ? 'default' : 'crosshair';
    if (m === 'attackMove') this.hooks.toast('Atak w ruchu: kliknij LPM w miejscu docelowym (Esc anuluje)');
    if (m === 'rally') this.hooks.toast('Punkt zbiórki: kliknij LPM na mapie (Esc anuluje)');
  }

  /** Rozkazy z przycisków i klawiszy. */
  command(kind: 'stop' | 'hold' | 'load' | 'unload' | 'attackMove' | 'clearRally') {
    const sim = this.sim;
    if (!sim || !this.active || this.paused || this.ended) return;
    const own = this.ownSelected();
    switch (kind) {
      case 'stop':
        sim.cmdStop(PLAYER, own.map((u) => u.id));
        break;
      case 'hold':
        sim.cmdHold(PLAYER, own.map((u) => u.id));
        break;
      case 'attackMove':
        if (own.length) this.setMode('attackMove');
        break;
      case 'clearRally':
        sim.setRally(PLAYER, null);
        this.hooks.toast('Punkt zbiórki usunięty');
        break;
      case 'load':
      case 'unload': {
        const ts = own.filter((u) => u.def.transportCapacity);
        if (!ts.length) {
          this.hooks.toast('Zaznacz transporter lub BWP');
          break;
        }
        for (const t of ts) {
          const r = kind === 'load' ? sim.cmdLoad(PLAYER, t.id) : sim.cmdUnload(PLAYER, t.id);
          if (r.message) this.hooks.toast(r.message);
        }
        break;
      }
    }
  }

  buy(type: Parameters<Game['buy']>[1]) {
    if (!this.sim || !this.active || this.paused) return;
    const r = this.sim.buy(PLAYER, type);
    if (!r.ok && r.message) this.hooks.toast(r.message);
  }

  private pickUnit(w: Vec, wantEnemy: boolean): Unit | null {
    const sim = this.sim!;
    let best: Unit | null = null;
    let bd = Infinity;
    for (const u of sim.units) {
      if (!u.alive || u.insideId !== null) continue;
      if ((u.team !== PLAYER) !== wantEnemy) continue;
      if (u.team !== PLAYER && !sim.canSee(PLAYER, u)) continue;
      const d = Math.hypot(u.x - w.x, u.y - w.y);
      if (d <= u.def.radius + 8 && d < bd) {
        bd = d;
        best = u;
      }
    }
    return best;
  }

  private onPointerDown(p: Phaser.Input.Pointer) {
    if (!this.active || this.paused || this.ended || !this.sim) return;
    const w = this.world(p);
    if (p.rightButtonDown()) {
      if (this.mode !== 'none') {
        this.setMode('none');
        return;
      }
      this.rightClick(w);
      return;
    }
    if (!p.leftButtonDown()) return;
    if (this.mode === 'attackMove') {
      const own = this.ownSelected();
      const r = this.sim.cmdMove(PLAYER, own.map((u) => u.id), w, true);
      if (r.message) this.hooks.toast(r.message);
      this.addPing(w.x, w.y, 0xff8040);
      this.setMode('none');
      return;
    }
    if (this.mode === 'rally') {
      const r = this.sim.setRally(PLAYER, w);
      this.hooks.toast(r.ok ? 'Ustawiono punkt zbiórki' : r.message ?? 'Nie można ustawić punktu zbiórki');
      this.setMode('none');
      return;
    }
    this.dragStart = { sx: p.x, sy: p.y, wx: w.x, wy: w.y };
    this.dragNow = w;
  }

  private onPointerMove(p: Phaser.Input.Pointer) {
    if (this.dragStart && p.leftButtonDown()) this.dragNow = this.world(p);
  }

  private onPointerUp(p: Phaser.Input.Pointer) {
    if (!this.dragStart || !this.sim) return;
    const ds = this.dragStart;
    this.dragStart = null;
    this.dragNow = null;
    if (p.button !== 0) return;
    const w = this.world(p);
    const shift = this.keys.SHIFT.isDown;
    const moved = Math.hypot(p.x - ds.sx, p.y - ds.sy);
    if (moved < 6) {
      const own = this.pickUnit(w, false);
      const target = own ?? this.pickUnit(w, true);
      const now = this.time.now;
      if (own && this.lastClick.id === own.id && now - this.lastClick.t < 350) {
        // podwójne kliknięcie: wszystkie jednostki tego typu na ekranie
        const v = this.viewRect();
        const sel = new Set(shift ? this.selection : []);
        for (const u of this.sim.units) {
          if (u.alive && u.team === PLAYER && u.type === own.type && u.insideId === null && u.x >= v.x && u.x <= v.x + v.w && u.y >= v.y && u.y <= v.y + v.h) sel.add(u.id);
        }
        this.selection = sel;
        this.lastClick = { t: 0, id: -1 };
        return;
      }
      this.lastClick = { t: now, id: own?.id ?? -1 };
      if (target) {
        if (shift && own) {
          if (this.selection.has(own.id)) this.selection.delete(own.id);
          else this.selection.add(own.id);
        } else this.selection = new Set([target.id]);
      } else if (!shift) this.selection.clear();
      return;
    }
    const x0 = Math.min(ds.wx, w.x);
    const x1 = Math.max(ds.wx, w.x);
    const y0 = Math.min(ds.wy, w.y);
    const y1 = Math.max(ds.wy, w.y);
    const sel = new Set(shift ? [...this.selection].filter((id) => this.sim!.byId.get(id)?.team === PLAYER) : []);
    for (const u of this.sim.units) {
      if (u.alive && u.team === PLAYER && u.insideId === null && u.x >= x0 && u.x <= x1 && u.y >= y0 && u.y <= y1) sel.add(u.id);
    }
    this.selection = sel;
  }

  private rightClick(w: Vec) {
    const sim = this.sim!;
    const own = this.ownSelected();
    if (!own.length) return;
    const ids = own.map((u) => u.id);
    const enemy = this.pickUnit(w, true);
    if (enemy) {
      const r = sim.cmdAttack(PLAYER, ids, enemy.id);
      if (r.message) this.hooks.toast(r.message);
      if (r.ok) this.addPing(enemy.x, enemy.y, 0xff4040, 22);
      return;
    }
    const friend = this.pickUnit(w, false);
    if (friend && friend.def.transportCapacity && !ids.includes(friend.id)) {
      const r = sim.cmdBoard(PLAYER, ids, friend.id);
      if (r.message) this.hooks.toast(r.message);
      if (r.ok) this.addPing(friend.x, friend.y, 0x60ff80, 22);
      return;
    }
    const r = sim.cmdMove(PLAYER, ids, w, false);
    if (r.message) this.hooks.toast(r.message);
    if (r.ok) this.addPing(w.x, w.y, 0x60ff80);
  }

  private addPing(x: number, y: number, color: number, size = 14) {
    this.fx.push({ kind: 'ping', x, y, t: 0, ttl: 0.7, color, size });
  }

  // ------------------------------------------------------------------ pętla

  update(_time: number, delta: number) {
    const cam = this.cameras.main;
    const dt = delta / 1000;
    if (!this.active || !this.sim) return;

    // kamera
    const panSpeed = 900 / cam.zoom;
    let dx = 0;
    let dy = 0;
    if (this.keys.LEFT.isDown) dx -= 1;
    if (this.keys.RIGHT.isDown) dx += 1;
    if (this.keys.UP.isDown) dy -= 1;
    if (this.keys.DOWN.isDown) dy += 1;
    // WASD: klawisz A i S mają też rozkazy, więc kamera reaguje na nie tylko bez zaznaczenia jednostek
    const noSel = this.ownSelected().length === 0;
    if (this.keys.W.isDown) dy -= 1;
    if (noSel || this.keys.SHIFT.isDown) {
      if (this.keys.A.isDown) dx -= 1;
      if (this.keys.S.isDown) dy += 1;
    }
    if (this.keys.D.isDown) dx += 1;
    if (dx || dy) {
      cam.scrollX += dx * panSpeed * dt;
      cam.scrollY += dy * panSpeed * dt;
      this.clampCamera();
    }

    const sim = this.sim;
    if (!this.paused && !this.ended) sim.update(dt * this.speed);
    this.consumeEvents();
    this.syncSprites(dt);
    this.drawOverlay(dt);
    this.drawZones();
    this.updateFog();

    if (sim.status === 'ended' && !this.ended) {
      this.ended = true;
      this.hooks.onEnd(sim.winner);
    }
  }

  private syncSprites(_dt: number) {
    const sim = this.sim!;
    const alive = new Set<number>();
    for (const u of sim.units) {
      if (!u.alive) continue;
      alive.add(u.id);
      const vis = u.team === PLAYER ? u.insideId === null : sim.fog.canSeeUnit(PLAYER, u);
      let s = this.sprites.get(u.id);
      if (!s) {
        s = this.add.image(u.x, u.y, spriteKey(u.team, u.type)).setDepth(10).setScale(1.25);
        s.rotation = u.facing;
        this.sprites.set(u.id, s);
      }
      s.setVisible(vis);
      s.setPosition(u.x, u.y);
      s.rotation = Phaser.Math.Angle.RotateTo(s.rotation, u.facing, 0.3);
    }
    for (const [id, s] of this.sprites) {
      if (!alive.has(id)) {
        s.destroy();
        this.sprites.delete(id);
        this.selection.delete(id);
      }
    }
  }

  private visibleToPlayer(x: number, y: number) {
    return this.sim!.fog.isVisibleAt(PLAYER, x, y);
  }

  private consumeEvents() {
    const sim = this.sim!;
    for (const e of sim.events) {
      switch (e.kind) {
        case 'shot': {
          if (!this.visibleToPlayer(e.from.x, e.from.y) && !this.visibleToPlayer(e.to.x, e.to.y)) break;
          const heavy = e.weaponId === 'cannon' || e.weaponId === 'at' || e.weaponId === 'autocannon';
          if (e.indirect) {
            this.fx.push({ kind: 'burst', x: e.from.x, y: e.from.y, t: 0, ttl: 0.3, color: 0xdddddd, size: 22 });
          } else {
            this.fx.push({
              kind: 'tracer', x: e.from.x, y: e.from.y, x2: e.to.x, y2: e.to.y, t: 0, ttl: heavy ? 0.14 : 0.07,
              color: e.team === 'blue' ? (heavy ? 0xbfe0ff : 0x9fd0ff) : heavy ? 0xffd08a : 0xffb36b, size: heavy ? 3 : 1.5,
            });
          }
          break;
        }
        case 'explosion':
          if (this.visibleToPlayer(e.at.x, e.at.y)) this.fx.push({ kind: 'explosion', x: e.at.x, y: e.at.y, t: 0, ttl: 0.5, color: 0xffa040, size: e.radius });
          break;
        case 'death':
          if (this.visibleToPlayer(e.at.x, e.at.y)) {
            const big = e.unitType === 'tank' || e.unitType === 'apc' || e.unitType === 'ifv' || e.unitType === 'artillery';
            this.fx.push({ kind: 'burst', x: e.at.x, y: e.at.y, t: 0, ttl: big ? 0.8 : 0.45, color: big ? 0xff9030 : 0xcc3030, size: big ? 34 : 16 });
          }
          break;
        case 'heal':
          if (this.visibleToPlayer(e.to.x, e.to.y)) this.fx.push({ kind: 'heal', x: e.from.x, y: e.from.y, x2: e.to.x, y2: e.to.y, t: 0, ttl: 0.35, color: 0x60ff90, size: 2 });
          break;
        case 'hit':
          if (this.visibleToPlayer(e.at.x, e.at.y)) this.fx.push({ kind: 'hit', x: e.at.x, y: e.at.y, t: 0, ttl: 0.15, color: 0xffffff, size: 5 });
          break;
      }
    }
    sim.events.length = 0;
  }

  private drawOverlay(dt: number) {
    const g = this.overlay;
    const fx = this.fxGfx;
    const sim = this.sim!;
    g.clear();
    fx.clear();

    for (const u of sim.units) {
      if (!u.alive) continue;
      const vis = u.team === PLAYER ? u.insideId === null : sim.fog.canSeeUnit(PLAYER, u);
      if (!vis) continue;
      const r = u.def.radius;
      const col = COLORS[u.team];
      // oznaczenie frakcji
      g.lineStyle(2, col, 0.55);
      g.strokeEllipse(u.x, u.y + 2, r * 2.1, r * 1.5);
      const selected = this.selection.has(u.id);
      if (selected) {
        g.lineStyle(2, u.team === PLAYER ? 0x6dff8a : 0xff6a5a, 1);
        g.strokeCircle(u.x, u.y, r + 5);
      }
      const hurt = sim.time - u.lastDamagedAt < 4;
      if (selected || hurt || (u.hp < u.def.maxHp && u.team === PLAYER && sim.time - u.lastDamagedAt < 8)) {
        const w = Math.max(22, r * 2 + 8);
        const y = u.y - r - 11;
        const f = Math.max(0, u.hp / u.def.maxHp);
        g.fillStyle(0x000000, 0.7);
        g.fillRect(u.x - w / 2 - 1, y - 1, w + 2, 6);
        g.fillStyle(f > 0.55 ? 0x4cd964 : f > 0.28 ? 0xf2c230 : 0xe5483c, 1);
        g.fillRect(u.x - w / 2, y, w * f, 4);
      }
      if (u.def.transportCapacity && u.team === PLAYER) {
        for (let i = 0; i < u.def.transportCapacity; i++) {
          g.fillStyle(i < u.passengers.length ? 0xffffff : 0x333333, 1);
          g.fillRect(u.x - u.def.transportCapacity * 3 + i * 6, u.y + r + 4, 5, 4);
        }
      }
      // rozkazy zaznaczonych własnych jednostek
      if (selected && u.team === PLAYER) {
        const o = u.order;
        let tx: number | null = null;
        let ty: number | null = null;
        let color = 0x6dff8a;
        if ((o.type === 'move' || o.type === 'attackMove') && o.target) {
          tx = o.target.x;
          ty = o.target.y;
          color = o.type === 'attackMove' ? 0xff9a40 : 0x6dff8a;
        } else if (o.type === 'attack' && o.targetId !== undefined) {
          const t = sim.byId.get(o.targetId);
          if (t && t.alive && sim.canSee(PLAYER, t)) {
            tx = t.x;
            ty = t.y;
            color = 0xff4a40;
            g.lineStyle(2, color, 0.9);
            g.strokeCircle(t.x, t.y, t.def.radius + 8);
          }
        } else if (o.type === 'board' && o.targetId !== undefined) {
          const t = sim.byId.get(o.targetId);
          if (t) {
            tx = t.x;
            ty = t.y;
          }
        }
        if (tx !== null && ty !== null) {
          g.lineStyle(1, color, 0.35);
          g.lineBetween(u.x, u.y, tx, ty);
          g.lineStyle(2, color, 0.9);
          g.strokeRect(tx - 4, ty - 4, 8, 8);
        }
      }
    }

    // punkt zbiórki
    const rally = sim.teams[PLAYER].rally;
    if (rally) {
      g.lineStyle(2, 0x6dc0ff, 1);
      g.lineBetween(rally.x, rally.y, rally.x, rally.y - 30);
      g.fillStyle(0x4c8dff, 1);
      g.fillTriangle(rally.x, rally.y - 30, rally.x + 18, rally.y - 24, rally.x, rally.y - 18);
      g.strokeCircle(rally.x, rally.y, 8);
    }

    // pociski artyleryjskie
    for (const p of sim.projectiles) {
      if (!this.visibleToPlayer(p.x, p.y) && !this.visibleToPlayer(p.tx, p.ty)) continue;
      fx.fillStyle(0x000000, 0.35);
      fx.fillCircle(p.x + 3, p.y + 5, 4);
      fx.fillStyle(0xffe08a, 1);
      fx.fillCircle(p.x, p.y, 4);
      fx.lineStyle(1, 0xff6040, 0.35);
      fx.strokeCircle(p.tx, p.ty, p.weapon.splash ?? 60);
    }

    // zaznaczenie prostokątem
    if (this.dragStart && this.dragNow) {
      const x = Math.min(this.dragStart.wx, this.dragNow.x);
      const y = Math.min(this.dragStart.wy, this.dragNow.y);
      const w = Math.abs(this.dragNow.x - this.dragStart.wx);
      const h = Math.abs(this.dragNow.y - this.dragStart.wy);
      g.fillStyle(0x6dff8a, 0.12);
      g.fillRect(x, y, w, h);
      g.lineStyle(1.5, 0x6dff8a, 0.9);
      g.strokeRect(x, y, w, h);
    }

    // efekty
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const e = this.fx[i];
      e.t += dt;
      if (e.t >= e.ttl) {
        this.fx.splice(i, 1);
        continue;
      }
      const k = e.t / e.ttl;
      switch (e.kind) {
        case 'tracer':
          fx.lineStyle(e.size, e.color, 1 - k);
          fx.lineBetween(e.x, e.y, e.x2!, e.y2!);
          fx.fillStyle(0xfff2b0, 1 - k);
          fx.fillCircle(e.x, e.y, 3 + e.size);
          break;
        case 'heal':
          fx.lineStyle(2, e.color, 0.8 * (1 - k));
          fx.lineBetween(e.x, e.y, e.x2!, e.y2!);
          fx.fillStyle(e.color, 1 - k);
          fx.fillRect(e.x2! - 1, e.y2! - 8 - k * 10, 3, 9);
          fx.fillRect(e.x2! - 4, e.y2! - 5 - k * 10, 9, 3);
          break;
        case 'explosion':
          fx.fillStyle(0xffd070, (1 - k) * 0.8);
          fx.fillCircle(e.x, e.y, e.size * (0.4 + 0.6 * k));
          fx.lineStyle(3, 0xff6a30, 1 - k);
          fx.strokeCircle(e.x, e.y, e.size * (0.5 + 0.7 * k));
          break;
        case 'burst':
          fx.fillStyle(e.color, (1 - k) * 0.85);
          fx.fillCircle(e.x, e.y, e.size * (0.3 + 0.7 * k));
          fx.fillStyle(0x333333, (1 - k) * 0.5);
          fx.fillCircle(e.x, e.y - k * 14, e.size * 0.5);
          break;
        case 'hit':
          fx.fillStyle(e.color, 1 - k);
          fx.fillRect(e.x - 2 + (k * 6 - 3), e.y - 2 - k * 5, e.size * 0.6, e.size * 0.6);
          break;
        case 'ping':
          fx.lineStyle(2, e.color, 1 - k);
          fx.strokeCircle(e.x, e.y, e.size * (1 - k * 0.5));
          break;
      }
    }
  }

  private drawZones() {
    const sim = this.sim!;
    const g = this.zoneGfx;
    g.clear();
    const r = sim.rules.zoneRadius;
    const blink = Math.floor(this.time.now / 350) % 2 === 0;
    sim.zones.forEach((z, i) => {
      const ownerCol = z.owner ? COLORS[z.owner] : 0xcfd6dd;
      g.fillStyle(ownerCol, z.owner ? 0.16 : 0.09);
      g.fillCircle(z.def.x, z.def.y, r);
      g.lineStyle(4, z.contested ? (blink ? 0xffe14a : 0xff4a40) : ownerCol, z.contested ? 1 : 0.9);
      g.strokeCircle(z.def.x, z.def.y, r);
      // flaga
      g.fillStyle(0x222222, 1);
      g.fillRect(z.def.x - 1.5, z.def.y - 26, 3, 30);
      g.fillStyle(ownerCol, 1);
      g.fillRect(z.def.x + 1.5, z.def.y - 26, 20, 12);
      // postęp
      if (z.progress > 0 && z.progressTeam) {
        const pc = COLORS[z.progressTeam];
        g.lineStyle(7, pc, 0.95);
        g.beginPath();
        g.arc(z.def.x, z.def.y, r + 9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * z.progress, false);
        g.strokePath();
      }
      const t = this.zoneTexts[i];
      let label = z.owner === 'blue' ? 'Niebiescy' : z.owner === 'red' ? 'Czerwoni' : 'Neutralna';
      if (z.contested) label = 'SPORNA';
      else if (z.progress > 0 && z.progressTeam) {
        const who = z.progressTeam === 'blue' ? 'Niebiescy' : 'Czerwoni';
        label = `${z.stage === 'neutralize' ? 'Neutralizacja' : 'Przejmowanie'}: ${who} ${Math.round(z.progress * 100)}%`;
      }
      if (t.state.text !== label) t.state.setText(label);
      t.state.setColor(z.contested ? '#ffe14a' : z.owner === 'blue' ? '#9cc4ff' : z.owner === 'red' ? '#ffa89f' : '#ffffff');
    });
  }

  private updateFog() {
    const sim = this.sim!;
    if (!this.fogCanvas || sim.fog.version === this.fogVersion) return;
    this.fogVersion = sim.fog.version;
    const st = sim.fog.state[PLAYER];
    const ctx = this.fogCanvas.getContext('2d')!;
    const img = ctx.createImageData(this.fogCanvas.width, this.fogCanvas.height);
    for (let i = 0; i < st.length; i++) {
      const o = i * 4;
      img.data[o] = 6;
      img.data[o + 1] = 9;
      img.data[o + 2] = 14;
      img.data[o + 3] = st[i] === FOG_UNKNOWN ? 250 : st[i] === FOG_EXPLORED ? 120 : 0;
    }
    ctx.putImageData(img, 0, 0);
    const hi = this.fogHi!.getContext('2d')!;
    hi.imageSmoothingEnabled = true;
    hi.imageSmoothingQuality = 'high';
    hi.clearRect(0, 0, this.fogHi!.width, this.fogHi!.height);
    hi.drawImage(this.fogCanvas, 0, 0, this.fogHi!.width, this.fogHi!.height);
    const tex = this.textures.get(`fog_${this.matchNo}`);
    (tex as Phaser.Textures.CanvasTexture).refresh();
  }
}
