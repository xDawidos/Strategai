export type Team = 'blue' | 'red';
export const TEAMS: Team[] = ['blue', 'red'];
export const enemyOf = (t: Team): Team => (t === 'blue' ? 'red' : 'blue');

export interface Vec {
  x: number;
  y: number;
}

export type ArmorClass = 'infantry' | 'light' | 'heavy';
export type UnitType = 'infantry' | 'medic' | 'tank' | 'apc' | 'ifv' | 'artillery';
export const UNIT_TYPES: UnitType[] = ['infantry', 'medic', 'ifv', 'apc', 'tank', 'artillery'];

export interface WeaponDef {
  id: string;
  name: string;
  damage: number;
  /** Mnożnik obrażeń względem klasy celu (0 = nie może atakować). */
  mult: Record<ArmorClass, number>;
  range: number;
  /** Czas pomiędzy strzałami [s]. */
  cooldown: number;
  minRange?: number;
  /** Ogień pośredni: pocisk leci do punktu, ignoruje budynki, trafia obszarowo. */
  indirect?: boolean;
  projectileSpeed?: number;
  splash?: number;
  /** Czy broń może strzelać w ruchu (domyślnie tak). */
  canFireMoving?: boolean;
}

export interface UnitDef {
  type: UnitType;
  name: string;
  role: string;
  /** Krótka etykieta roli do panelu zakupu. */
  tag: string;
  description: string;
  armorClass: ArmorClass;
  maxHp: number;
  armor: number;
  speed: number;
  vision: number;
  radius: number;
  cost: number;
  /** PZ dla przeciwnika za zniszczenie. */
  pzValue: number;
  weapons: WeaponDef[];
  canCapture: boolean;
  heal?: { range: number; rate: number };
  transportCapacity?: number;
  /** Waga priorytetu celu wg typu (domyślnie 1). */
  priority: Partial<Record<UnitType, number>>;
}

export type OrderType = 'idle' | 'move' | 'attackMove' | 'attack' | 'hold' | 'board';

export interface Order {
  type: OrderType;
  target?: Vec;
  targetId?: number;
}

export interface Unit {
  id: number;
  team: Team;
  type: UnitType;
  def: UnitDef;
  x: number;
  y: number;
  hp: number;
  facing: number;
  alive: boolean;
  order: Order;
  path: Vec[];
  pathIdx: number;
  weaponCd: number[];
  /** Id transportera, w którym jednostka się znajduje. */
  insideId: number | null;
  passengers: number[];
  /** Aktualnie ścigany/atakowany cel. */
  targetId: number | null;
  lastKnown: Vec | null;
  anchor: Vec | null;
  lastDamagedAt: number;
  scanTimer: number;
  repathTimer: number;
  stuckTimer: number;
  stuckCount: number;
  lastCheckPos: Vec;
  movedThisTick: boolean;
  healTargetId: number | null;
  healFxTimer: number;
  /** Czy jednostka aktualnie walczy z celem (przerywa marsz w ataku w ruchu). */
  engaged: boolean;
  /** Końcowy punkt aktualnej trasy (do ponownego wyznaczenia). */
  goal: Vec | null;
}

export type GameEvent =
  | { kind: 'shot'; from: Vec; to: Vec; team: Team; weaponId: string; indirect: boolean }
  | { kind: 'explosion'; at: Vec; radius: number }
  | { kind: 'death'; at: Vec; unitType: UnitType; team: Team }
  | { kind: 'heal'; from: Vec; to: Vec }
  | { kind: 'hit'; at: Vec };

export interface CommandResult {
  ok: boolean;
  message?: string;
}
