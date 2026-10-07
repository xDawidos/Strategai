import { TEAMS, type Team, type Unit } from './types';

export const FOG_UNKNOWN = 0;
export const FOG_EXPLORED = 1;
export const FOG_VISIBLE = 2;

/** Mgła wojny: trzy stany pól + zbiór widocznych aktualnie wrogów dla każdej strony. */
export class Fog {
  readonly cols: number;
  readonly rows: number;
  readonly state: Record<Team, Uint8Array>;
  readonly visibleEnemies: Record<Team, Set<number>> = { blue: new Set(), red: new Set() };
  version = 0;

  constructor(readonly width: number, readonly height: number, readonly cell = 16) {
    this.cols = Math.ceil(width / cell);
    this.rows = Math.ceil(height / cell);
    this.state = {
      blue: new Uint8Array(this.cols * this.rows),
      red: new Uint8Array(this.cols * this.rows),
    };
  }

  update(units: Unit[]) {
    for (const team of TEAMS) {
      const st = this.state[team];
      for (let i = 0; i < st.length; i++) if (st[i] === FOG_VISIBLE) st[i] = FOG_EXPLORED;
      const vis = this.visibleEnemies[team];
      vis.clear();
      const own: Unit[] = [];
      for (const u of units) if (u.alive && u.team === team && u.insideId === null) own.push(u);
      for (const u of own) this.reveal(st, u.x, u.y, u.def.vision);
      for (const e of units) {
        if (!e.alive || e.team === team || e.insideId !== null) continue;
        for (const o of own) {
          const dx = o.x - e.x;
          const dy = o.y - e.y;
          const r = o.def.vision;
          if (dx * dx + dy * dy <= r * r) {
            vis.add(e.id);
            break;
          }
        }
      }
    }
    this.version++;
  }

  private reveal(st: Uint8Array, x: number, y: number, r: number) {
    const c = this.cell;
    const cx0 = Math.max(0, Math.floor((x - r) / c));
    const cx1 = Math.min(this.cols - 1, Math.floor((x + r) / c));
    const cy0 = Math.max(0, Math.floor((y - r) / c));
    const cy1 = Math.min(this.rows - 1, Math.floor((y + r) / c));
    const r2 = r * r;
    for (let cy = cy0; cy <= cy1; cy++) {
      const dy = (cy + 0.5) * c - y;
      for (let cx = cx0; cx <= cx1; cx++) {
        const dx = (cx + 0.5) * c - x;
        if (dx * dx + dy * dy <= r2) st[cy * this.cols + cx] = FOG_VISIBLE;
      }
    }
  }

  /** Oznacza prostokąt jako odkryty (np. własna strefa przyjazdu na starcie). */
  explore(team: Team, rect: { x: number; y: number; w: number; h: number }) {
    const st = this.state[team];
    for (let cy = Math.floor(rect.y / this.cell); cy <= Math.floor((rect.y + rect.h) / this.cell); cy++) {
      for (let cx = Math.floor(rect.x / this.cell); cx <= Math.floor((rect.x + rect.w) / this.cell); cx++) {
        if (cx >= 0 && cy >= 0 && cx < this.cols && cy < this.rows && st[cy * this.cols + cx] === FOG_UNKNOWN) st[cy * this.cols + cx] = FOG_EXPLORED;
      }
    }
  }

  stateAt(team: Team, x: number, y: number): number {
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return FOG_UNKNOWN;
    return this.state[team][cy * this.cols + cx];
  }
  isVisibleAt(team: Team, x: number, y: number) {
    return this.stateAt(team, x, y) === FOG_VISIBLE;
  }
  canSeeUnit(team: Team, u: Unit) {
    return u.team === team ? u.insideId === null : this.visibleEnemies[team].has(u.id);
  }
}
