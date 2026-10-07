/** Definicja jedynej, ręcznie przygotowanej mapy (współrzędne świata w px). */
export interface ZoneDef {
  id: string;
  name: string;
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RoadDef {
  /** Odcinki osiowe (poziome lub pionowe). */
  pts: [number, number][];
  width: number;
  dirt?: boolean;
}

export type AreaKind = 'urban' | 'village' | 'field' | 'forest';

/**
 * Mapa jest lustrzana względem osi pionowej (x = width / 2): `areas`, `forests`, `buildings`
 * i `clusters` opisują wyłącznie zachodnią połowę (lub obiekty symetryczne), a wschodnia powstaje
 * przez odbicie. Dzięki temu obie strony mają taki sam teren przy swoich strefach.
 */
export interface MapDef {
  width: number;
  height: number;
  cell: number;
  seed: number;
  spawns: { blue: Rect; red: Rect };
  /** Kolejność = kolejność doboru stref przy zoneCount 3..6 (symetria względem osi pionowej). */
  zones: ZoneDef[];
  roads: RoadDef[];
  areas: { kind: AreaKind; rect: Rect }[];
  /** Zwarte lasy: komórki blokujące (gęste) + dekoracja niezablokowana. */
  forests: { rect: Rect; density: number }[];
  /** Ręczne budynki. */
  buildings: Rect[];
  /** Generowane skupiska budynków. */
  clusters: { rect: Rect; cols: number; rows: number; w: number; h: number; jitter: number; skip: number }[];
}

export const MAP: MapDef = {
  width: 2400,
  height: 1600,
  cell: 32,
  seed: 20240607,
  spawns: {
    blue: { x: 32, y: 640, w: 192, h: 320 },
    red: { x: 2176, y: 640, w: 192, h: 320 },
  },
  zones: [
    { id: 'centrum', name: 'Centrum miasta', x: 1200, y: 800 },
    { id: 'wies', name: 'Wieś', x: 620, y: 440 },
    { id: 'las', name: 'Skraj lasu', x: 1780, y: 440 },
    { id: 'skrzyzowanie', name: 'Skrzyżowanie', x: 1200, y: 1280 },
    { id: 'gospodarstwo', name: 'Gospodarstwo', x: 1200, y: 300 },
    { id: 'kapliczka', name: 'Wzgórze z kapliczką', x: 1200, y: 1040 },
  ],
  roads: [
    { pts: [[40, 800], [2360, 800]], width: 96 },
    { pts: [[1200, 160], [1200, 1440]], width: 96 },
    { pts: [[620, 440], [620, 800]], width: 64, dirt: true },
    { pts: [[1780, 440], [1780, 800]], width: 64, dirt: true },
    { pts: [[480, 1280], [1920, 1280]], width: 80 },
  ],
  areas: [
    // Obiekty środkowe (symetryczne względem osi pionowej) oraz zachodnia połowa mapy.
    { kind: 'urban', rect: { x: 800, y: 520, w: 800, h: 560 } },
    { kind: 'field', rect: { x: 900, y: 120, w: 600, h: 380 } },
    { kind: 'village', rect: { x: 400, y: 240, w: 440, h: 440 } },
    { kind: 'field', rect: { x: 720, y: 1100, w: 200, h: 340 } },
    { kind: 'forest', rect: { x: 60, y: 120, w: 320, h: 520 } },
    { kind: 'forest', rect: { x: 60, y: 960, w: 460, h: 520 } },
  ],
  forests: [
    { rect: { x: 60, y: 120, w: 320, h: 520 }, density: 0.6 },
    { rect: { x: 60, y: 960, w: 460, h: 520 }, density: 0.6 },
    { rect: { x: 700, y: 1480, w: 500, h: 100 }, density: 0.5 },
    { rect: { x: 780, y: 60, w: 380, h: 110 }, density: 0.5 },
    { rect: { x: 520, y: 640, w: 120, h: 140 }, density: 0.4 },
  ],
  buildings: [
    // Gospodarstwo
    { x: 928, y: 176, w: 160, h: 96 },
    { x: 1056, y: 320, w: 64, h: 64 },
    // Wzgórze z kapliczką
    { x: 1056, y: 1024, w: 64, h: 64 },
    // Skrzyżowanie
    { x: 1024, y: 1152, w: 96, h: 64 },
    { x: 1024, y: 1344, w: 96, h: 64 },
    { x: 800, y: 1344, w: 128, h: 64 },
  ],
  clusters: [
    // Centrum miasta (zachodnie ćwiartki)
    { rect: { x: 760, y: 520, w: 360, h: 220 }, cols: 3, rows: 2, w: 96, h: 96, jitter: 0, skip: 0 },
    { rect: { x: 760, y: 860, w: 360, h: 220 }, cols: 3, rows: 2, w: 96, h: 96, jitter: 0, skip: 0 },
    // Wieś: rozproszone domy
    { rect: { x: 400, y: 260, w: 440, h: 420 }, cols: 4, rows: 4, w: 64, h: 64, jitter: 28, skip: 0.2 },
  ],
};
