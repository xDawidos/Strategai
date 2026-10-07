import { describe, expect, it } from 'vitest';
import { newGame, put, run } from './helpers';

describe('uczciwość walki', () => {
  it('lustrzana potyczka nie faworyzuje żadnej strony (kolejność przetwarzania nie ma znaczenia)', () => {
    const wins = { blue: 0, red: 0, draw: 0 };
    for (let k = 0; k < 16; k++) {
      const g = newGame();
      const bs = [];
      const rs = [];
      for (let i = 0; i < 5; i++) {
        bs.push(put(g, 'blue', 'infantry', 120 + (i % 2) * 30, 740 + i * 20));
        rs.push(put(g, 'red', 'infantry', 2280 - (i % 2) * 30, 740 + i * 20));
      }
      g.cmdMove('blue', bs.map((u) => u.id), { x: 1200, y: 800 }, true);
      g.cmdMove('red', rs.map((u) => u.id), { x: 1200, y: 800 }, true);
      run(g, 70);
      const b = g.unitsOf('blue').length;
      const r = g.unitsOf('red').length;
      wins[b > r ? 'blue' : r > b ? 'red' : 'draw']++;
    }
    // Żadna ze stron nie może wygrywać zawsze (wcześniejszy błąd: 20:0 dla strony przetwarzanej później).
    expect(wins.blue).toBeGreaterThan(2);
    expect(wins.red).toBeGreaterThan(2);
  });
});
