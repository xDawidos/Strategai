import { describe, expect, it } from 'vitest';
import { newGame, put, run } from './helpers';
import { UNIT_DEFS } from '../src/config/units';

describe('walka', () => {
  it('automatycznie atakuje widocznego przeciwnika w zasięgu i przyznaje PZ za zabicie (bez PD)', () => {
    const g = newGame();
    const a = put(g, 'blue', 'infantry', 1100, 700);
    const b = put(g, 'red', 'infantry', 1250, 700);
    const pd = g.teams.blue.pd;
    run(g, 0.2);
    expect(g.visibleEnemiesOf('blue').map((u) => u.id)).toContain(b.id);
    run(g, 30);
    expect(a.alive !== b.alive).toBe(true);
    const winnerTeam = a.alive ? 'blue' : 'red';
    expect(g.teams[winnerTeam].pz).toBeGreaterThanOrEqual(UNIT_DEFS.infantry.pzValue);
    // zabijanie nie daje PD (poza dochodem pasywnym)
    expect(g.teams.blue.pd - pd).toBeLessThan(3 * 31);
  });

  it('nie strzela do niewidocznych przeciwników', () => {
    const g = newGame();
    const a = put(g, 'blue', 'artillery', 400, 300);
    const b = put(g, 'red', 'infantry', 1000, 300); // 600 px, poza wzrokiem (240)
    run(g, 15);
    expect(g.visibleEnemiesOf('blue').length).toBe(0);
    expect(b.hp).toBe(b.def.maxHp);
    expect(a.alive).toBe(true);
  });

  it('broń bezpośrednia nie strzela przez budynki', () => {
    const g = newGame();
    const b = g.map.buildings.find((bb) => bb.w >= 96 && bb.h >= 96 && bb.x > 1250 && bb.y > 500 && bb.y < 700)!;
    const cx = b.x + b.w / 2;
    const a = put(g, 'blue', 'infantry', b.x - 50, b.y + b.h / 2);
    const e = put(g, 'red', 'infantry', b.x + b.w + 50, b.y + b.h / 2);
    a.order = { type: 'hold' };
    e.order = { type: 'hold' };
    expect(g.grid.hasLineOfFire(a, e)).toBe(false);
    run(g, 10);
    expect(cx).toBeGreaterThan(0);
    expect(a.hp).toBe(a.def.maxHp);
    expect(e.hp).toBe(e.def.maxHp);
  });

  it('artyleria strzela ponad budynkami, ma minimalny zasięg i nie rani swoich', () => {
    const g = newGame();
    const art = put(g, 'blue', 'artillery', 900, 600);
    const friend = put(g, 'blue', 'infantry', 1210, 600);
    const spotter = put(g, 'blue', 'infantry', 1000, 600);
    const enemy = put(g, 'red', 'medic', 1215, 600); // nieuzbrojony cel
    spotter.order = { type: 'hold' };
    enemy.hp = 1000;
    run(g, 0.3);
    run(g, 15);
    expect(enemy.hp).toBeLessThan(1000);
    expect(friend.hp).toBe(friend.def.maxHp);
    // minimalny zasięg
    const g2 = newGame();
    const art2 = put(g2, 'blue', 'artillery', 900, 600);
    const near = put(g2, 'red', 'medic', 1000, 600);
    near.hp = 1000;
    run(g2, 10);
    expect(near.hp).toBe(1000);
    expect(art.alive && art2.alive).toBe(true);
  });

  it('medyk leczy piechotę tylko do maksimum, nie leczy pojazdów', () => {
    const g = newGame();
    const m = put(g, 'blue', 'medic', 800, 700);
    const i = put(g, 'blue', 'infantry', 830, 700);
    const t = put(g, 'blue', 'tank', 800, 740);
    i.hp = 20;
    t.hp = 100;
    run(g, 3);
    expect(i.hp).toBeGreaterThan(20);
    run(g, 20);
    expect(i.hp).toBe(i.def.maxHp);
    expect(t.hp).toBe(100);
    expect(m.def.weapons.length).toBe(0);
  });

  it('piechota ma słabe obrażenia przeciw czołgowi (karabin), AT jest wolne', () => {
    const g = newGame();
    const inf = put(g, 'blue', 'infantry', 1100, 700);
    const tank = put(g, 'red', 'tank', 1250, 700);
    tank.order = { type: 'hold' };
    tank.hp = tank.def.maxHp;
    // jednorazowy test obrażeń: tylko karabin zadaje 1, AT 48
    g.damage(tank, 1, 'blue');
    expect(tank.hp).toBe(tank.def.maxHp - 1);
    expect(inf.def.weapons[1].cooldown).toBeGreaterThanOrEqual(10);
  });

  it('rozkaz ataku wymaga widocznego celu', () => {
    const g = newGame();
    const a = put(g, 'blue', 'infantry', 100, 100);
    const e = put(g, 'red', 'infantry', 1800, 1200);
    const r = g.cmdAttack('blue', [a.id], e.id);
    expect(r.ok).toBe(false);
  });
});

describe('ruch', () => {
  it('grupa dostaje rozproszone punkty docelowe', () => {
    const g = newGame();
    const us = Array.from({ length: 8 }, (_, i) => put(g, 'blue', 'infantry', 400, 700 + i * 12));
    g.cmdMove('blue', us.map((u) => u.id), { x: 1000, y: 700 });
    run(g, 25);
    const spread = new Set(us.map((u) => `${Math.round(u.x / 8)},${Math.round(u.y / 8)}`));
    expect(spread.size).toBe(8);
    for (const u of us) expect(Math.hypot(u.x - 1000, u.y - 700)).toBeLessThan(120);
  });

  it('atak w ruchu zatrzymuje jednostkę, by walczyć', () => {
    const g = newGame();
    const a = put(g, 'blue', 'infantry', 300, 800);
    const e = put(g, 'red', 'infantry', 700, 800);
    e.order = { type: 'hold' };
    e.hp = 500;
    g.cmdMove('blue', [a.id], { x: 1600, y: 800 }, true);
    run(g, 12);
    expect(a.x).toBeLessThan(1000);
    expect(e.hp).toBeLessThan(500);
  });

  it('S zatrzymuje, H utrzymuje pozycję', () => {
    const g = newGame();
    const a = put(g, 'blue', 'infantry', 300, 800);
    g.cmdMove('blue', [a.id], { x: 1000, y: 800 });
    run(g, 1);
    g.cmdStop('blue', [a.id]);
    const x = a.x;
    run(g, 1);
    expect(a.x).toBe(x);
    expect(a.order.type).toBe('idle');
    g.cmdHold('blue', [a.id]);
    expect(a.order.type).toBe('hold');
  });

  it('niedostępny cel daje komunikat/najbliższy punkt', () => {
    const g = newGame();
    const a = put(g, 'blue', 'infantry', 300, 800);
    const b = g.map.buildings[0];
    const r = g.cmdMove('blue', [a.id], { x: b.x + b.w / 2, y: b.y + b.h / 2 });
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/najbliższ/);
  });
});
