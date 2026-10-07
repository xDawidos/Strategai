import { describe, expect, it } from 'vitest';
import { buildMap } from '../src/core/map';
import { MAP } from '../src/config/map';

describe('mapa', () => {
  for (const count of [3, 4, 5, 6]) {
    it(`obie strony mają drogę do każdej z ${count} stref`, () => {
      const m = buildMap(count);
      expect(m.zones.length).toBe(count);
      for (const side of ['blue', 'red'] as const) {
        const s = MAP.spawns[side];
        const from = { x: s.x + s.w / 2, y: s.y + s.h / 2 };
        for (const z of m.zones) {
          expect(m.grid.isBlockedAt(z.x, z.y)).toBe(false);
          const res = m.grid.findPath(from, { x: z.x, y: z.y });
          expect(res, `${side} -> ${z.name}`).not.toBeNull();
          expect(res!.adjusted).toBe(false);
        }
      }
    });
  }

  it('wymiary mapy i obecność przeszkód', () => {
    const m = buildMap(5);
    expect(m.width).toBe(2400);
    expect(m.height).toBe(1600);
    expect(m.buildings.length).toBeGreaterThan(15);
    expect(m.trees.some((t) => t.blocking)).toBe(true);
    expect(m.trees.some((t) => !t.blocking)).toBe(true);
  });

  it('drogi i strefy przyjazdu nie są zablokowane', () => {
    const m = buildMap(6);
    for (let x = 60; x < 2340; x += 16) expect(m.grid.isBlockedAt(x, 800)).toBe(false);
    for (let y = 180; y < 1420; y += 16) expect(m.grid.isBlockedAt(1200, y)).toBe(false);
    for (const side of ['blue', 'red'] as const) {
      const s = MAP.spawns[side];
      for (let y = s.y; y < s.y + s.h; y += 16) for (let x = s.x; x < s.x + s.w; x += 16) expect(m.grid.isBlockedAt(x, y)).toBe(false);
    }
  });
});

describe('pathfinding', () => {
  it('omija budynki i nie wchodzi w przeszkody', () => {
    const m = buildMap(5);
    const res = m.grid.findPath({ x: 1000, y: 700 }, { x: 1500, y: 950 })!;
    expect(res).not.toBeNull();
    let prev = { x: 1000, y: 700 };
    for (const p of res.path) {
      expect(m.grid.lineWalkable(prev, p, 9)).toBe(true);
      prev = p;
    }
  });

  it('niedostępny cel (w budynku) kieruje do najbliższego wolnego punktu', () => {
    const m = buildMap(5);
    const b = m.buildings[0];
    const inside = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    const res = m.grid.findPath({ x: 1200, y: 800 }, inside)!;
    expect(res.adjusted).toBe(true);
    expect(m.grid.isBlockedAt(res.goal.x, res.goal.y)).toBe(false);
  });
});
