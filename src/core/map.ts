import { MAP, type MapDef, type Rect, type ZoneDef } from '../config/map';
import { NavGrid } from './grid';
import { makeRng } from './rng';

export interface Tree {
  x: number;
  y: number;
  /** Blokuje ruch (gęsty las) czy tylko dekoracja. */
  blocking: boolean;
  size: number;
}

export interface GameMap {
  def: MapDef;
  width: number;
  height: number;
  grid: NavGrid;
  zones: ZoneDef[];
  buildings: Rect[];
  trees: Tree[];
  /** Obszary terenu (wraz z odbiciem). */
  areas: MapDef['areas'];
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function rectDistToPoint(r: Rect, px: number, py: number) {
  const dx = Math.max(r.x - px, 0, px - (r.x + r.w));
  const dy = Math.max(r.y - py, 0, py - (r.y + r.h));
  return Math.hypot(dx, dy);
}

const rectsOverlap = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/**
 * Buduje mapę z definicji. Obiekty kolidujące z drogami, strefami lub strefami przyjazdu
 * są pomijane - dzięki temu drogi zawsze pozostają przejezdne.
 */
export function buildMap(zoneCount: number, def: MapDef = MAP): GameMap {
  const rng = makeRng(def.seed);
  const cell = def.cell;
  const grid = new NavGrid(def.width, def.height, cell);
  const zones = def.zones.slice(0, Math.max(3, Math.min(def.zones.length, zoneCount)));

  const nearRoad = (rect: Rect, margin: number) => {
    for (const road of def.roads) {
      for (let i = 0; i < road.pts.length - 1; i++) {
        const [ax, ay] = road.pts[i];
        const [bx, by] = road.pts[i + 1];
        const cx = rect.x + rect.w / 2;
        const cy = rect.y + rect.h / 2;
        const corner = Math.hypot(rect.w, rect.h) / 2;
        const d = distToSegment(cx, cy, ax, ay, bx, by);
        if (d > road.width / 2 + margin + corner) continue;
        // dokładniejszy test: najbliższy punkt prostokąta do osi
        let minD = Infinity;
        for (let sx = rect.x; sx <= rect.x + rect.w; sx += 8) {
          for (let sy = rect.y; sy <= rect.y + rect.h; sy += 8) {
            minD = Math.min(minD, distToSegment(sx, sy, ax, ay, bx, by));
          }
        }
        if (minD <= road.width / 2 + margin) return true;
      }
    }
    return false;
  };
  const nearZone = (rect: Rect, margin: number) =>
    def.zones.some((z) => rectDistToPoint(rect, z.x, z.y) < margin);
  const inSpawn = (rect: Rect) =>
    rectsOverlap(rect, grow(def.spawns.blue, 48)) || rectsOverlap(rect, grow(def.spawns.red, 48));
  const snap = (r: Rect): Rect => {
    const x0 = Math.floor(r.x / cell) * cell;
    const y0 = Math.floor(r.y / cell) * cell;
    const x1 = Math.ceil((r.x + r.w) / cell) * cell;
    const y1 = Math.ceil((r.y + r.h) / cell) * cell;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };
  const inBounds = (r: Rect) => r.x >= 0 && r.y >= 0 && r.x + r.w <= def.width && r.y + r.h <= def.height;

  const buildings: Rect[] = [];
  const tryBuilding = (raw: Rect) => {
    const r = snap(raw);
    if (!inBounds(r) || nearRoad(r, 12) || nearZone(r, 72) || inSpawn(r)) return;
    if (buildings.some((b) => rectsOverlap(grow(b, 0), r))) return;
    buildings.push(r);
  };
  def.buildings.forEach(tryBuilding);
  for (const c of def.clusters) {
    const cw = c.rect.w / c.cols;
    const ch = c.rect.h / c.rows;
    for (let j = 0; j < c.rows; j++) {
      for (let i = 0; i < c.cols; i++) {
        if (c.skip > 0 && rng() < c.skip) continue;
        const jx = (rng() - 0.5) * 2 * c.jitter;
        const jy = (rng() - 0.5) * 2 * c.jitter;
        tryBuilding({
          x: c.rect.x + i * cw + (cw - c.w) / 2 + jx,
          y: c.rect.y + j * ch + (ch - c.h) / 2 + jy,
          w: c.w,
          h: c.h,
        });
      }
    }
  }
  // Odbicie lustrzane zachodniej połowy.
  const mirror = (r: Rect): Rect => ({ x: def.width - r.x - r.w, y: r.y, w: r.w, h: r.h });
  for (const b of [...buildings]) {
    const m = mirror(b);
    if (!buildings.some((o) => rectsOverlap(o, m))) buildings.push(m);
  }
  for (const b of buildings) grid.blockRect(b.x, b.y, b.w, b.h, true);

  const trees: Tree[] = [];
  const cellRect = (cx: number, cy: number): Rect => ({ x: cx * cell, y: cy * cell, w: cell, h: cell });
  const clearCell = (cx: number, cy: number) => {
    const r = cellRect(cx, cy);
    return !nearRoad(r, 20) && !nearZone(r, 80) && !inSpawn(r);
  };
  const buildingCell = (cx: number, cy: number) => grid.blocked[grid.idx(cx, cy)] === 1;

  // Gęste lasy: część komórek blokuje, reszta to dekoracja.
  for (const f of def.forests) {
    const c0 = Math.floor(f.rect.x / cell);
    const r0 = Math.floor(f.rect.y / cell);
    const c1 = Math.ceil((f.rect.x + f.rect.w) / cell);
    const r1 = Math.ceil((f.rect.y + f.rect.h) / cell);
    for (let cy = r0; cy < r1; cy++) {
      for (let cx = c0; cx < c1; cx++) {
        if (!grid.inBounds(cx, cy) || buildingCell(cx, cy) || !clearCell(cx, cy)) continue;
        const roll = rng();
        const px = cx * cell + cell / 2 + (rng() - 0.5) * 6;
        const py = cy * cell + cell / 2 + (rng() - 0.5) * 6;
        if (roll < f.density * 0.62) {
          grid.blocked[grid.idx(cx, cy)] = 1;
          trees.push({ x: px, y: py, blocking: true, size: 15 + rng() * 3 });
        } else if (roll < f.density + 0.12) {
          trees.push({ x: px, y: py, blocking: false, size: 8 + rng() * 4 });
        }
      }
    }
  }
  for (const t of [...trees]) {
    const mx = def.width - t.x;
    const cx = grid.cellOf(mx);
    const cy = grid.cellOf(t.y);
    if (t.blocking) {
      if (grid.blocked[grid.idx(cx, cy)]) continue; // budynek w tym miejscu
      grid.blocked[grid.idx(cx, cy)] = 1;
    }
    trees.push({ ...t, x: mx });
  }
  // Rozproszone drzewa dekoracyjne po całej mapie (nie blokują ruchu).
  for (let i = 0; i < 260; i++) {
    const x = rng() * def.width;
    const y = rng() * def.height;
    const cx = grid.cellOf(x);
    const cy = grid.cellOf(y);
    if (!grid.inBounds(cx, cy) || grid.blocked[grid.idx(cx, cy)]) continue;
    if (nearRoad({ x: x - 8, y: y - 8, w: 16, h: 16 }, 4)) continue;
    const area = def.areas.find((a) => a.kind === 'urban' && x > a.rect.x && x < a.rect.x + a.rect.w && y > a.rect.y && y < a.rect.y + a.rect.h);
    if (area) continue;
    trees.push({ x, y, blocking: false, size: 7 + rng() * 5 });
  }

  grid.computeRegions();
  const areas = [...def.areas, ...def.areas.filter((a) => a.rect.x + a.rect.w <= def.width / 2 + 1).map((a) => ({ kind: a.kind, rect: mirror(a.rect) }))];
  return { def, width: def.width, height: def.height, grid, zones, buildings, trees, areas };
}

function grow(r: Rect, m: number): Rect {
  return { x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m };
}

export function inSpawnRect(rect: Rect, x: number, y: number) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}
