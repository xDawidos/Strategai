import { describe, expect, it } from 'vitest';
import { newGame, put, run } from './helpers';

describe('AI', () => {
  it('kupuje jednostki za te same PD i nie przekracza limitu', () => {
    const g = newGame({ ai: true });
    run(g, 120);
    const red = g.unitCount('red');
    expect(red).toBeGreaterThan(5);
    expect(red).toBeLessThanOrEqual(40);
    // budżet: start + dochód >= suma wydanych (PD nigdy ujemne)
    expect(g.teams.red.pd).toBeGreaterThanOrEqual(0);
  });

  it('wysyła piechotę do stref i zdobywa je', () => {
    const g = newGame({ ai: true });
    run(g, 240);
    expect(g.zones.some((z) => z.owner === 'red')).toBe(true);
  });

  it('nie zna ukrytych pozycji jednostek gracza', () => {
    const g = newGame({ ai: true });
    const hidden = put(g, 'blue', 'infantry', 900, 1500);
    run(g, 30);
    expect(g.ai!.knownEnemyIds()).not.toContain(hidden.id);
    expect(g.fog.visibleEnemies.red.has(hidden.id)).toBe(false);
  });

  it('mecz AI vs brak gracza kończy się poprawnie w limicie czasu', () => {
    const g = newGame({ ai: true, rules: { timeLimit: 400 } });
    run(g, 410);
    expect(g.status).toBe('ended');
    expect(g.winner).toBe('red');
  });
});
