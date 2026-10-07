import { describe, expect, it } from 'vitest';
import { AIController } from '../src/core/ai';
import { newGame } from './helpers';

describe('pełny mecz AI vs AI (test stabilności)', () => {
  it('symulacja jest stabilna: brak NaN, brak jednostek w przeszkodach, limity przestrzegane', () => {
    const g = newGame({ ai: true });
    const blueAI = new AIController(g, 'blue');
    const dt = g.rules.simStep;
    const t0 = Date.now();
    let maxUnits = 0;
    let combat = 0;
    for (let i = 0; i < 900 / dt && g.status === 'running'; i++) {
      blueAI.update(dt);
      g.step();
      if (i % 30 === 0) {
        for (const team of ['blue', 'red'] as const) {
          expect(g.unitCount(team)).toBeLessThanOrEqual(g.rules.unitCap);
          maxUnits = Math.max(maxUnits, g.unitCount(team));
        }
        for (const u of g.units) {
          expect(Number.isFinite(u.x) && Number.isFinite(u.y) && Number.isFinite(u.hp)).toBe(true);
          expect(u.hp).toBeGreaterThan(0);
          if (u.insideId === null) {
            expect(u.x).toBeGreaterThanOrEqual(0);
            expect(u.x).toBeLessThanOrEqual(g.map.width);
            expect(g.grid.isBlockedAt(u.x, u.y)).toBe(false);
          }
        }
      }
      combat += g.events.filter((e) => e.kind === 'death').length;
      g.events.length = 0;
    }
    const ms = Date.now() - t0;
    console.log(`mecz: czas gry ${g.time.toFixed(0)}s, wynik ${g.winner}, PZ ${g.teams.blue.pz.toFixed(0)}:${g.teams.red.pz.toFixed(0)}, zgony ${combat}, max jedn. ${maxUnits}, czas CPU ${ms} ms`);
    expect(g.status).toBe('ended');
    expect(combat).toBeGreaterThan(5);
    expect(ms).toBeLessThan(60000);
  }, 90000);
});
