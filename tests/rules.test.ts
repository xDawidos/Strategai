import { describe, expect, it } from 'vitest';
import { calcDamage } from '../src/core/combat';
import { UNIT_DEFS } from '../src/config/units';
import { newGame, put, run } from './helpers';

describe('formuła obrażeń', () => {
  it('max(1, obrażenia × mnożnik − pancerz)', () => {
    const rifle = UNIT_DEFS.infantry.weapons[0];
    expect(calcDamage(rifle, UNIT_DEFS.infantry)).toBeCloseTo(9);
    expect(calcDamage(rifle, UNIT_DEFS.tank)).toBe(1); // 1 - 12 -> min 1
    const cannon = UNIT_DEFS.tank.weapons[0];
    expect(calcDamage(cannon, UNIT_DEFS.tank)).toBeCloseTo(78);
    expect(calcDamage(UNIT_DEFS.infantry.weapons[1], UNIT_DEFS.infantry)).toBe(0); // AT nie bije piechoty
  });
});

describe('ekonomia i posiłki', () => {
  it('start 300 PD, dochód 3/s, +1/s za strefę', () => {
    const g = newGame();
    expect(g.teams.blue.pd).toBe(300);
    run(g, 10);
    expect(g.teams.blue.pd).toBeCloseTo(330, 0);
    g.zones[0].owner = 'blue';
    const before = g.teams.blue.pd;
    run(g, 10);
    expect(g.teams.blue.pd - before).toBeCloseTo(40, 0);
    expect(g.teams.blue.pz).toBeCloseTo(10, 0);
  });

  it('PD pobierane raz; jednostka pojawia się po 5 s w strefie przyjazdu', () => {
    const g = newGame();
    const r = g.buy('blue', 'infantry');
    expect(r.ok).toBe(true);
    expect(g.teams.blue.pd).toBeCloseTo(250, 3);
    run(g, 4.9);
    expect(g.unitsOf('blue').length).toBe(0);
    run(g, 0.3);
    expect(g.unitsOf('blue').length).toBe(1);
    const u = g.unitsOf('blue')[0];
    const sp = g.spawnRect('blue');
    expect(u.x).toBeGreaterThanOrEqual(sp.x);
    expect(u.x).toBeLessThanOrEqual(sp.x + sp.w);
    // 300 - 50 + 3*5.2 (dochód)
    expect(g.teams.blue.pd).toBeCloseTo(250 + 3 * 5.2, 0);
  });

  it('za mało PD blokuje zakup z wyjaśnieniem', () => {
    const g = newGame();
    g.teams.blue.pd = 10;
    expect(g.buyBlockReason('blue', 'tank')).toMatch(/Brakuje/);
    expect(g.buy('blue', 'tank').ok).toBe(false);
    expect(g.teams.blue.pd).toBe(10);
  });

  it('limit 40 jednostek obejmuje kolejkę', () => {
    const g = newGame();
    g.teams.blue.pd = 99999;
    for (let i = 0; i < 38; i++) put(g, 'blue', 'infantry', 600 + (i % 10) * 30, 100 + Math.floor(i / 10) * 30);
    expect(g.buy('blue', 'infantry').ok).toBe(true);
    expect(g.buy('blue', 'infantry').ok).toBe(true);
    expect(g.unitCount('blue')).toBe(40);
    const r = g.buy('blue', 'infantry');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Limit/);
  });

  it('punkt zbiórki kieruje nową jednostkę', () => {
    const g = newGame();
    g.setRally('blue', { x: 500, y: 800 });
    g.buy('blue', 'infantry');
    run(g, 5.5);
    const u = g.unitsOf('blue')[0];
    expect(u.order.type).toBe('move');
    run(g, 12);
    expect(Math.hypot(u.x - 500, u.y - 800)).toBeLessThan(40);
  });
});

describe('zwycięstwo', () => {
  it('1000 PZ kończy mecz', () => {
    const g = newGame();
    g.teams.blue.pz = 999.99;
    g.zones[0].owner = 'blue';
    run(g, 0.1);
    expect(g.status).toBe('ended');
    expect(g.winner).toBe('blue');
  });
  it('limit czasu: wyższy wynik wygrywa, równy daje remis', () => {
    const g = newGame({ rules: { timeLimit: 5 } });
    g.teams.red.pz = 20;
    run(g, 6);
    expect(g.winner).toBe('red');
    const g2 = newGame({ rules: { timeLimit: 5 } });
    run(g2, 6);
    expect(g2.winner).toBe('draw');
  });
  it('brak jednostek nie oznacza porażki', () => {
    const g = newGame();
    run(g, 30);
    expect(g.status).toBe('running');
  });
});
