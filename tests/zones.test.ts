import { describe, expect, it } from 'vitest';
import { newGame, put, run } from './helpers';

const Z = { x: 1200, y: 800 };

describe('przejmowanie stref', () => {
  it('jedna piechota przejmuje neutralną strefę w ~12 s', () => {
    const g = newGame();
    put(g, 'blue', 'infantry', Z.x, Z.y);
    run(g, 11.5);
    expect(g.zones[0].owner).toBeNull();
    run(g, 1);
    expect(g.zones[0].owner).toBe('blue');
  });

  it('dodatkowa piechota przyspiesza, maksymalnie dwukrotnie', () => {
    const g = newGame();
    for (let i = 0; i < 6; i++) put(g, 'blue', 'infantry', Z.x + i * 8, Z.y);
    run(g, 5.9);
    expect(g.zones[0].owner).toBeNull();
    run(g, 0.4);
    expect(g.zones[0].owner).toBe('blue'); // 12 / 2 = 6 s
  });

  it('medyk i pojazdy nie przejmują stref', () => {
    const g = newGame();
    put(g, 'blue', 'medic', Z.x, Z.y);
    put(g, 'blue', 'tank', Z.x + 30, Z.y);
    run(g, 20);
    expect(g.zones[0].owner).toBeNull();
  });

  it('wroga strefa: neutralizacja 12 s, potem przejęcie 12 s', () => {
    const g = newGame();
    g.zones[0].owner = 'red';
    put(g, 'blue', 'infantry', Z.x, Z.y);
    run(g, 12.2);
    expect(g.zones[0].owner).toBeNull();
    run(g, 11);
    expect(g.zones[0].owner).toBeNull();
    run(g, 1.5);
    expect(g.zones[0].owner).toBe('blue');
  });

  it('strefa sporna wstrzymuje postęp i dochód', () => {
    const g = newGame();
    g.zones[0].owner = 'blue';
    put(g, 'blue', 'infantry', Z.x, Z.y);
    put(g, 'red', 'medic', Z.x + 5, Z.y); // medyk nie blokuje
    run(g, 1);
    expect(g.zones[0].contested).toBe(false);
    put(g, 'red', 'ifv', Z.x + 40, Z.y + 10); // bojowa jednostka wroga
    g.units.forEach((u) => (u.def.weapons.length ? (u.hp = u.def.maxHp * 1000) : 0));
    const pz = g.teams.blue.pz;
    run(g, 0.2);
    expect(g.zones[0].contested).toBe(true);
    const pz2 = g.teams.blue.pz;
    expect(pz2 - pz).toBeLessThan(0.1);
  });

  it('pusta zdobyta strefa pozostaje własnością, niedokończony postęp powoli się cofa', () => {
    const g = newGame();
    const u = put(g, 'blue', 'infantry', Z.x, Z.y);
    run(g, 6);
    const p = g.zones[0].progress;
    expect(p).toBeGreaterThan(0.4);
    u.x = 100;
    u.y = 100; // opuszcza strefę
    run(g, 6);
    expect(g.zones[0].progress).toBeLessThan(p);
    expect(g.zones[0].progress).toBeGreaterThan(p - 0.2); // cofa się wolniej niż rośnie
    const g2 = newGame();
    g2.zones[0].owner = 'blue';
    run(g2, 30);
    expect(g2.zones[0].owner).toBe('blue');
  });

  it('jednostki w transporterze nie przejmują i nie blokują stref', () => {
    const g = newGame();
    const apc = put(g, 'blue', 'apc', Z.x, Z.y);
    const inf = put(g, 'blue', 'infantry', Z.x + 20, Z.y);
    g.cmdLoad('blue', apc.id);
    expect(inf.insideId).toBe(apc.id);
    const enemyInf = put(g, 'red', 'infantry', Z.x - 20, Z.y);
    enemyInf.hp = 1e6;
    run(g, 0.2);
    // w strefie jest transporter (uzbrojony) + piechota wroga -> sporna, ale pasażer nic nie zmienia
    expect(g.zones[0].contested).toBe(true);
    g.kill(apc, null);
    run(g, 13);
    expect(g.zones[0].owner).toBe('red');
  });
});
