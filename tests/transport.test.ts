import { describe, expect, it } from 'vitest';
import { newGame, put, run } from './helpers';
import { UNIT_DEFS } from '../src/config/units';

describe('transport', () => {
  it('ładuje tylko pobliskie jednostki, do limitu pojemności', () => {
    const g = newGame();
    const apc = put(g, 'blue', 'ifv', 800, 700);
    const near = [put(g, 'blue', 'infantry', 830, 700), put(g, 'blue', 'infantry', 800, 740), put(g, 'blue', 'medic', 770, 700)];
    const far = put(g, 'blue', 'infantry', 1500, 700);
    const r = g.cmdLoad('blue', apc.id);
    expect(r.ok).toBe(true);
    expect(apc.passengers.length).toBe(2); // BWP: 2
    expect(far.insideId).toBeNull();
    expect(near.filter((u) => u.insideId === apc.id).length).toBe(2);
  });

  it('pasażerowie nie strzelają, nie dają widoczności i nie są widoczni', () => {
    const g = newGame();
    const apc = put(g, 'blue', 'apc', 800, 700);
    const inf = put(g, 'blue', 'infantry', 820, 700);
    g.cmdLoad('blue', apc.id);
    const e = put(g, 'red', 'infantry', 800 + 270, 700);
    e.hp = 1000;
    e.order = { type: 'hold' };
    apc.order = { type: 'hold' };
    run(g, 0.3);
    // APC ma wzrok 280 - widzi, ale piechota w środku nie ma własnego zasięgu
    expect(inf.insideId).toBe(apc.id);
    expect(g.fog.visibleEnemies.blue.has(e.id)).toBe(true);
    // wróg widziany tylko dzięki pasażerowi nie byłby widoczny: odsuwamy poza wzrok APC (280), w zasięg piechoty (270)
    e.x = 800 + 285;
    run(g, 0.3);
    expect(g.fog.visibleEnemies.blue.has(e.id)).toBe(false);
  });

  it('wyładunek rozmieszcza na wolnych polach; brak miejsca nie usuwa pasażerów', () => {
    const g = newGame();
    const apc = put(g, 'blue', 'apc', 800, 700);
    for (let i = 0; i < 4; i++) put(g, 'blue', 'infantry', 800 + i * 5, 700 + 30);
    g.cmdLoad('blue', apc.id);
    expect(apc.passengers.length).toBe(4);
    const r = g.cmdUnload('blue', apc.id);
    expect(r.ok).toBe(true);
    expect(apc.passengers.length).toBe(0);
    const out = g.unitsOf('blue').filter((u) => u.type === 'infantry');
    for (const u of out) {
      expect(u.insideId).toBeNull();
      expect(g.grid.blockedCircle(u.x, u.y, u.def.radius)).toBe(false);
    }

    // Brak miejsca: transporter otoczony przeszkodami.
    const g2 = newGame();
    const b = g2.map.buildings.find((bb) => bb.w >= 96)!;
    const t = put(g2, 'blue', 'apc', b.x + b.w + 20, b.y + 20);
    const p = put(g2, 'blue', 'infantry', t.x, t.y);
    g2.cmdLoad('blue', t.id);
    // zablokuj całe otoczenie
    const grid = g2.grid;
    for (let dx = -200; dx <= 200; dx += 8) for (let dy = -200; dy <= 200; dy += 8) {
      if (Math.hypot(dx, dy) < 28) continue;
      const cx = grid.cellOf(t.x + dx);
      const cy = grid.cellOf(t.y + dy);
      if (grid.inBounds(cx, cy)) grid.blocked[grid.idx(cx, cy)] = 1;
    }
    const r2 = g2.cmdUnload('blue', t.id);
    expect(r2.message).toMatch(/Brak miejsca/);
    expect(t.passengers).toEqual([p.id]);
    expect(p.alive).toBe(true);
    expect(p.insideId).toBe(t.id);
  });

  it('zniszczenie transportera niszczy pasażerów, PZ dokładnie raz', () => {
    const g = newGame();
    const apc = put(g, 'blue', 'apc', 800, 700);
    for (let i = 0; i < 3; i++) put(g, 'blue', 'infantry', 805, 700 + i * 3);
    g.cmdLoad('blue', apc.id);
    const pz0 = g.teams.red.pz;
    g.kill(apc, 'red');
    g.kill(apc, 'red'); // powtórne zniszczenie nic nie zmienia
    const expected = UNIT_DEFS.apc.pzValue + 3 * UNIT_DEFS.infantry.pzValue;
    expect(g.teams.red.pz - pz0).toBe(expected);
    expect(g.unitsOf('blue').length).toBe(0);
    run(g, 0.5);
    expect(g.teams.red.pz - pz0).toBe(expected);
  });

  it('rozkaz wejścia: piechota podchodzi i wsiada', () => {
    const g = newGame();
    const apc = put(g, 'blue', 'apc', 800, 700);
    const inf = put(g, 'blue', 'infantry', 600, 700);
    const r = g.cmdBoard('blue', [inf.id], apc.id);
    expect(r.ok).toBe(true);
    run(g, 6);
    expect(inf.insideId).toBe(apc.id);
  });
});
