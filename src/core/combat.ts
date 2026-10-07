import type { ArmorClass, Unit, UnitDef, WeaponDef } from './types';

/** obrażenia końcowe = max(1, obrażenia broni × mnożnik(klasa celu) − pancerz celu) */
export function calcDamage(weapon: WeaponDef, target: { armorClass: ArmorClass; armor: number }): number {
  const m = weapon.mult[target.armorClass];
  if (m <= 0) return 0;
  return Math.max(1, weapon.damage * m - target.armor);
}

export const canWeaponHit = (w: WeaponDef, def: UnitDef) => w.mult[def.armorClass] > 0;

export function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Wynik oceny celu dla broni: priorytet roli dominuje, potem oczekiwane obrażenia i bliskość. */
export function targetScore(shooter: Unit, w: WeaponDef, target: Unit, d: number): number {
  const prio = shooter.def.priority[target.type] ?? 1;
  return prio * 100 + calcDamage(w, target.def) - d * 0.05;
}
