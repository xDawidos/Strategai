import type { Vec } from './types';

export interface PathResult {
  path: Vec[];
  /** Czy cel został przesunięty do najbliższego dostępnego punktu. */
  adjusted: boolean;
  goal: Vec;
}

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size() {
    return this.vals.length;
  }
  push(key: number, val: number) {
    const k = this.keys;
    const v = this.vals;
    let i = v.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop(): number {
    const k = this.keys;
    const v = this.vals;
    const top = v[0];
    const lk = k.pop()!;
    const lv = v.pop()!;
    if (v.length > 0) {
      k[0] = lk;
      v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < v.length && k[l] < k[m]) m = l;
        if (r < v.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}

const SQRT2 = Math.SQRT2;
const DIRS: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

/** Siatka nawigacyjna: przeszkody ruchu + osobna siatka blokująca linię strzału (budynki). */
export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  /** 1 = komórka niedostępna dla ruchu (budynek lub gęste drzewa). */
  readonly blocked: Uint8Array;
  /** 1 = komórka blokuje bezpośredni ostrzał (tylko budynki). */
  readonly sight: Uint8Array;
  region: Int32Array;

  constructor(readonly width: number, readonly height: number, readonly cell: number) {
    this.cols = Math.ceil(width / cell);
    this.rows = Math.ceil(height / cell);
    this.blocked = new Uint8Array(this.cols * this.rows);
    this.sight = new Uint8Array(this.cols * this.rows);
    this.region = new Int32Array(this.cols * this.rows);
  }

  idx(cx: number, cy: number) {
    return cy * this.cols + cx;
  }
  inBounds(cx: number, cy: number) {
    return cx >= 0 && cy >= 0 && cx < this.cols && cy < this.rows;
  }
  cellOf(v: number) {
    return Math.floor(v / this.cell);
  }
  center(cx: number, cy: number): Vec {
    return { x: (cx + 0.5) * this.cell, y: (cy + 0.5) * this.cell };
  }
  isBlockedCell(cx: number, cy: number) {
    return !this.inBounds(cx, cy) || this.blocked[this.idx(cx, cy)] === 1;
  }
  isBlockedAt(x: number, y: number) {
    return this.isBlockedCell(this.cellOf(x), this.cellOf(y));
  }
  /** Czy okrąg o promieniu r zachodzi na przeszkodę (test 8 punktów obwodu + środek). */
  blockedCircle(x: number, y: number, r: number) {
    if (this.isBlockedAt(x, y)) return true;
    const d = r * 0.72;
    return (
      this.isBlockedAt(x + r, y) || this.isBlockedAt(x - r, y) ||
      this.isBlockedAt(x, y + r) || this.isBlockedAt(x, y - r) ||
      this.isBlockedAt(x + d, y + d) || this.isBlockedAt(x - d, y + d) ||
      this.isBlockedAt(x + d, y - d) || this.isBlockedAt(x - d, y - d)
    );
  }

  blockRect(x: number, y: number, w: number, h: number, sight: boolean) {
    const c0 = Math.max(0, Math.floor(x / this.cell));
    const r0 = Math.max(0, Math.floor(y / this.cell));
    const c1 = Math.min(this.cols - 1, Math.ceil((x + w) / this.cell) - 1);
    const r1 = Math.min(this.rows - 1, Math.ceil((y + h) / this.cell) - 1);
    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        this.blocked[this.idx(cx, cy)] = 1;
        if (sight) this.sight[this.idx(cx, cy)] = 1;
      }
    }
  }

  /** Etykietuje spójne obszary (do wykrywania niedostępnych celów). */
  computeRegions() {
    this.region.fill(-1);
    let id = 0;
    const stack: number[] = [];
    for (let i = 0; i < this.region.length; i++) {
      if (this.blocked[i] || this.region[i] !== -1) continue;
      this.region[i] = id;
      stack.push(i);
      while (stack.length) {
        const cur = stack.pop()!;
        const cx = cur % this.cols;
        const cy = (cur / this.cols) | 0;
        for (let d = 0; d < 4; d++) {
          const nx = cx + DIRS[d][0];
          const ny = cy + DIRS[d][1];
          if (!this.inBounds(nx, ny)) continue;
          const ni = this.idx(nx, ny);
          if (this.blocked[ni] || this.region[ni] !== -1) continue;
          this.region[ni] = id;
          stack.push(ni);
        }
      }
      id++;
    }
  }

  regionAt(x: number, y: number) {
    const cx = this.cellOf(x);
    const cy = this.cellOf(y);
    return this.inBounds(cx, cy) ? this.region[this.idx(cx, cy)] : -1;
  }

  /** Najbliższa wolna komórka (opcjonalnie w danym regionie). */
  nearestFree(x: number, y: number, region = -1): Vec | null {
    const cx0 = this.cellOf(x);
    const cy0 = this.cellOf(y);
    const ok = (cx: number, cy: number) =>
      this.inBounds(cx, cy) && !this.blocked[this.idx(cx, cy)] &&
      (region < 0 || this.region[this.idx(cx, cy)] === region);
    if (ok(cx0, cy0)) return this.center(cx0, cy0);
    const maxR = Math.max(this.cols, this.rows);
    for (let r = 1; r < maxR; r++) {
      let best: Vec | null = null;
      let bestD = Infinity;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const cx = cx0 + dx;
          const cy = cy0 + dy;
          if (!ok(cx, cy)) continue;
          const c = this.center(cx, cy);
          const d = (c.x - x) ** 2 + (c.y - y) ** 2;
          if (d < bestD) {
            bestD = d;
            best = c;
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  /** Czy odcinek jest przejezdny dla jednostki o promieniu r. */
  lineWalkable(a: Vec, b: Vec, r = 9): boolean {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(len / 8));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (this.blockedCircle(a.x + dx * t, a.y + dy * t, r)) return false;
    }
    return true;
  }

  /** Linia strzału: blokują ją wyłącznie budynki. */
  hasLineOfFire(a: Vec, b: Vec): boolean {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(len / 8));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = this.cellOf(a.x + dx * t);
      const cy = this.cellOf(a.y + dy * t);
      if (this.inBounds(cx, cy) && this.sight[this.idx(cx, cy)]) return false;
    }
    return true;
  }

  /** A* na siatce (8 kierunków, bez ścinania rogów) z wygładzaniem trasy. */
  findPath(from: Vec, to: Vec, radius = 9): PathResult | null {
    const startRegion = this.regionAt(from.x, from.y);
    let sc = { cx: this.cellOf(from.x), cy: this.cellOf(from.y) };
    let region = startRegion;
    if (this.isBlockedCell(sc.cx, sc.cy)) {
      const f = this.nearestFree(from.x, from.y);
      if (!f) return null;
      sc = { cx: this.cellOf(f.x), cy: this.cellOf(f.y) };
      region = this.region[this.idx(sc.cx, sc.cy)];
    }

    let goal: Vec = { x: Math.max(0, Math.min(this.width - 1, to.x)), y: Math.max(0, Math.min(this.height - 1, to.y)) };
    let adjusted = false;
    const gcx0 = this.cellOf(goal.x);
    const gcy0 = this.cellOf(goal.y);
    const goalOk = !this.isBlockedCell(gcx0, gcy0) && this.region[this.idx(gcx0, gcy0)] === region;
    if (!goalOk) {
      const f = this.nearestFree(goal.x, goal.y, region);
      if (!f) return null;
      goal = f;
      adjusted = true;
    }
    const gcx = this.cellOf(goal.x);
    const gcy = this.cellOf(goal.y);
    const startIdx = this.idx(sc.cx, sc.cy);
    const goalIdx = this.idx(gcx, gcy);
    if (startIdx === goalIdx) return { path: [goal], adjusted, goal };

    const n = this.cols * this.rows;
    const g = new Float32Array(n).fill(Infinity);
    const parent = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const heap = new MinHeap();
    const h = (cx: number, cy: number) => {
      const dx = Math.abs(cx - gcx);
      const dy = Math.abs(cy - gcy);
      return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
    };
    g[startIdx] = 0;
    heap.push(h(sc.cx, sc.cy), startIdx);
    let found = false;
    while (heap.size) {
      const cur = heap.pop();
      if (closed[cur]) continue;
      closed[cur] = 1;
      if (cur === goalIdx) {
        found = true;
        break;
      }
      const cx = cur % this.cols;
      const cy = (cur / this.cols) | 0;
      for (const [dx, dy, cost] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (this.isBlockedCell(nx, ny)) continue;
        if (dx !== 0 && dy !== 0 && (this.isBlockedCell(cx + dx, cy) || this.isBlockedCell(cx, cy + dy))) continue;
        const ni = this.idx(nx, ny);
        if (closed[ni]) continue;
        const ng = g[cur] + cost;
        if (ng < g[ni]) {
          g[ni] = ng;
          parent[ni] = cur;
          heap.push(ng + h(nx, ny), ni);
        }
      }
    }
    if (!found) return null;

    const cells: Vec[] = [];
    for (let c = goalIdx; c !== -1 && c !== startIdx; c = parent[c]) {
      cells.push(this.center(c % this.cols, (c / this.cols) | 0));
    }
    cells.reverse();
    // Dokładny punkt docelowy, jeśli jest bezpieczny.
    const exact = goalOk && !this.blockedCircle(goal.x, goal.y, radius);
    if (exact) cells[cells.length - 1] = { x: goal.x, y: goal.y };

    const pts: Vec[] = [{ x: from.x, y: from.y }, ...cells];
    const out: Vec[] = [];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      while (j > i + 1 && !this.lineWalkable(pts[i], pts[j], radius)) j--;
      out.push(pts[j]);
      i = j;
    }
    return { path: out, adjusted, goal };
  }
}
