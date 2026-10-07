import type { Rules } from '../config/rules';
import type { ZoneDef } from '../config/map';
import { enemyOf, type Team, type Unit } from './types';

export interface ZoneState {
  def: ZoneDef;
  owner: Team | null;
  /** Postęp bieżącego etapu 0..1. */
  progress: number;
  /** Strona, która aktualnie buduje postęp. */
  progressTeam: Team | null;
  contested: boolean;
  /** Etap prowadzony przez progressTeam: neutralizacja wrogiej strefy albo przejęcie. */
  stage: 'neutralize' | 'capture' | null;
  /** Liczba piechoty przejmującej (do wyświetlania). */
  capturers: number;
}

export function createZones(defs: ZoneDef[]): ZoneState[] {
  return defs.map((def) => ({ def, owner: null, progress: 0, progressTeam: null, contested: false, stage: null, capturers: 0 }));
}

export function captureMultiplier(n: number, rules: Rules) {
  if (n <= 0) return 0;
  return Math.min(rules.captureMaxMult, 1 + (n - 1) * rules.captureMultPerUnit);
}

/** Aktualizuje stan wszystkich stref. Jednostki w transporterach (insideId) są ignorowane. */
export function updateZones(zones: ZoneState[], units: Unit[], rules: Rules, dt: number) {
  for (const z of zones) {
    const armed: Record<Team, number> = { blue: 0, red: 0 };
    const cap: Record<Team, number> = { blue: 0, red: 0 };
    const r2 = rules.zoneRadius * rules.zoneRadius;
    for (const u of units) {
      if (!u.alive || u.insideId !== null) continue;
      const dx = u.x - z.def.x;
      const dy = u.y - z.def.y;
      if (dx * dx + dy * dy > r2) continue;
      if (u.def.weapons.length > 0) armed[u.team]++;
      if (u.def.canCapture) cap[u.team]++;
    }
    z.contested = armed.blue > 0 && armed.red > 0;
    z.capturers = 0;
    if (z.contested) continue; // postęp wstrzymany

    const rate = dt / rules.captureTime;
    let actor: Team | null = null;
    if (cap.blue > 0 && armed.red === 0) actor = 'blue';
    else if (cap.red > 0 && armed.blue === 0) actor = 'red';

    if (actor && z.owner !== actor) {
      const mult = captureMultiplier(cap[actor], rules);
      z.capturers = cap[actor];
      if (z.progressTeam !== actor && z.progress > 0) {
        // Najpierw znosimy postęp przeciwnika.
        z.progress = Math.max(0, z.progress - rate * mult);
        if (z.progress === 0) z.progressTeam = null;
      } else {
        z.progressTeam = actor;
        z.stage = z.owner === null ? 'capture' : 'neutralize';
        z.progress += rate * mult;
        if (z.progress >= 1) {
          z.progress = 0;
          if (z.owner === null) {
            z.owner = actor;
            z.progressTeam = null;
            z.stage = null;
          } else {
            z.owner = null; // koniec neutralizacji, zaczyna się przejmowanie
            z.stage = 'capture';
          }
        }
      }
    } else if (actor && z.owner === actor) {
      // Właściciel wrócił: cofa postęp wroga.
      z.progress = Math.max(0, z.progress - rate * 2);
      if (z.progress === 0) {
        z.progressTeam = null;
        z.stage = null;
      }
    } else if (z.progress > 0) {
      // Nikt nie przejmuje: postęp powoli wraca do początku etapu.
      z.progress = Math.max(0, z.progress - rate * rules.captureDecay);
      if (z.progress === 0) {
        z.progressTeam = null;
        z.stage = null;
      }
    }
  }
}

export function ownedCount(zones: ZoneState[], team: Team) {
  let n = 0;
  for (const z of zones) if (z.owner === team && !z.contested) n++;
  return n;
}

export { enemyOf };
