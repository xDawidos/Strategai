import { Game, type GameOptions } from '../src/core/game';
import type { Team, Unit, UnitType } from '../src/core/types';

export function newGame(opts: GameOptions = {}) {
  return new Game({ ai: false, ...opts });
}

export function run(g: Game, seconds: number) {
  const n = Math.round(seconds / g.rules.simStep);
  for (let i = 0; i < n; i++) g.step();
}

export function put(g: Game, team: Team, type: UnitType, x: number, y: number): Unit {
  const u = g.createUnit(team, type, x, y);
  u.anchor = { x, y };
  return u;
}
