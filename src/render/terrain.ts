import type { GameMap } from '../core/map';
import { makeRng } from '../core/rng';

const px = (c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) => {
  c.fillStyle = color;
  c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
};

function shade(base: number[], amt: number) {
  return `rgb(${Math.max(0, Math.min(255, base[0] + amt))},${Math.max(0, Math.min(255, base[1] + amt))},${Math.max(0, Math.min(255, base[2] + amt))})`;
}

function tree(c: CanvasRenderingContext2D, x: number, y: number, r: number, dark: boolean) {
  const base = dark ? '#1f4a24' : '#3f7d3a';
  const mid = dark ? '#2b6330' : '#58a04a';
  const hi = dark ? '#3a7b3c' : '#79c062';
  // cień
  c.fillStyle = 'rgba(0,0,0,0.25)';
  c.fillRect(Math.round(x - r + 3), Math.round(y - r + 4), Math.round(r * 2), Math.round(r * 2));
  // sylwetka "pikselowego koła"
  const s = Math.round(r * 2);
  const q = Math.max(2, Math.round(r / 3));
  px(c, x - s / 2 + q, y - s / 2, s - 2 * q, s, base);
  px(c, x - s / 2, y - s / 2 + q, s, s - 2 * q, base);
  px(c, x - s / 2 + q * 1.5, y - s / 2 + q * 1.5, s - 3 * q, s - 3 * q, mid);
  px(c, x - s / 4, y - s / 3, s / 3, s / 4, hi);
  px(c, x + s / 8, y + s / 8, s / 5, s / 5, base);
}

/** Rysuje całą statyczną warstwę mapy do jednego obrazu 2400×1600. */
export function renderTerrain(map: GameMap): HTMLCanvasElement {
  const { width, height, def } = map;
  const cv = document.createElement('canvas');
  cv.width = width;
  cv.height = height;
  const c = cv.getContext('2d')!;
  const rng = makeRng(def.seed ^ 0x9e3779b9);

  // Trawa
  const grass = [96, 142, 72];
  for (let y = 0; y < height; y += 16) {
    for (let x = 0; x < width; x += 16) {
      px(c, x, y, 16, 16, shade(grass, Math.floor((rng() - 0.5) * 14)));
      if (rng() < 0.12) px(c, x + rng() * 12, y + rng() * 12, 3, 3, shade(grass, 16));
      if (rng() < 0.08) px(c, x + rng() * 12, y + rng() * 12, 3, 3, shade(grass, -18));
    }
  }

  // Obszary
  for (const a of map.areas) {
    const { x, y, w, h } = a.rect;
    if (a.kind === 'urban') {
      for (let yy = y; yy < y + h; yy += 16) {
        for (let xx = x; xx < x + w; xx += 16) px(c, xx, yy, 16, 16, shade([132, 134, 138], Math.floor((rng() - 0.5) * 10)));
      }
    } else if (a.kind === 'village') {
      for (let yy = y; yy < y + h; yy += 16) {
        for (let xx = x; xx < x + w; xx += 16) {
          if (rng() < 0.55) px(c, xx, yy, 16, 16, shade([150, 135, 92], Math.floor((rng() - 0.5) * 12)));
        }
      }
    } else if (a.kind === 'field') {
      for (let yy = y; yy < y + h; yy += 16) {
        const row = Math.floor((yy - y) / 16) % 2 === 0;
        px(c, x, yy, w, 16, row ? '#c4b45c' : '#a99a47');
        for (let xx = x; xx < x + w; xx += 16) if (rng() < 0.25) px(c, xx + 4, yy + 4, 4, 4, row ? '#d6c870' : '#8f8238');
      }
      px(c, x, y, w, 4, '#6b5a2a');
      px(c, x, y + h - 4, w, 4, '#6b5a2a');
      px(c, x, y, 4, h, '#6b5a2a');
      px(c, x + w - 4, y, 4, h, '#6b5a2a');
    } else if (a.kind === 'forest') {
      for (let yy = y; yy < y + h; yy += 16) {
        for (let xx = x; xx < x + w; xx += 16) px(c, xx, yy, 16, 16, shade([62, 104, 58], Math.floor((rng() - 0.5) * 12)));
      }
    }
  }

  // Drogi
  for (const road of def.roads) {
    const base = road.dirt ? '#9d8657' : '#4c5057';
    const edge = road.dirt ? '#7d6a43' : '#6b6f75';
    for (let i = 0; i < road.pts.length - 1; i++) {
      const [ax, ay] = road.pts[i];
      const [bx, by] = road.pts[i + 1];
      const hw = road.width / 2;
      const x0 = Math.min(ax, bx) - (ax === bx ? hw : 0);
      const y0 = Math.min(ay, by) - (ay === by ? hw : 0);
      const w = ax === bx ? road.width : Math.abs(bx - ax);
      const h = ay === by ? road.width : Math.abs(by - ay);
      px(c, x0 - 4, y0 - 4, w + 8, h + 8, edge);
      px(c, x0, y0, w, h, base);
      if (!road.dirt) {
        // przerywana linia środkowa
        if (ay === by) for (let xx = x0; xx < x0 + w; xx += 48) px(c, xx, ay - 2, 24, 4, '#d8cc6a');
        else for (let yy = y0; yy < y0 + h; yy += 48) px(c, ax - 2, yy, 4, 24, '#d8cc6a');
      } else {
        for (let k = 0; k < (w * h) / 600; k++) px(c, x0 + rng() * w, y0 + rng() * h, 4, 4, '#b39a68');
      }
    }
  }
  // Plac w centrum miasta i skrzyżowania
  for (const z of map.zones) {
    px(c, z.x - 44, z.y - 44, 88, 88, 'rgba(60,64,70,0.0)');
  }

  // Strefy przyjazdu
  for (const side of ['blue', 'red'] as const) {
    const s = def.spawns[side];
    px(c, s.x, s.y, s.w, s.h, side === 'blue' ? 'rgba(60,110,200,0.28)' : 'rgba(200,70,60,0.28)');
    c.strokeStyle = side === 'blue' ? '#4c86e0' : '#e0584c';
    c.lineWidth = 4;
    c.setLineDash([16, 12]);
    c.strokeRect(s.x + 2, s.y + 2, s.w - 4, s.h - 4);
    c.setLineDash([]);
  }

  // Drzewa niebloujące (pod budynkami), potem budynki, potem drzewa blokujące
  for (const t of map.trees) if (!t.blocking) tree(c, t.x, t.y, t.size, false);

  const roofs = ['#a8483a', '#8b6a4a', '#5b6f8a', '#7a7a80', '#9a5a3a', '#6e7f5b'];
  map.buildings.forEach((b, i) => {
    const roof = roofs[(i * 7 + Math.floor(b.x / 32)) % roofs.length];
    px(c, b.x + 6, b.y + 8, b.w, b.h, 'rgba(0,0,0,0.3)');
    px(c, b.x, b.y, b.w, b.h, '#2a2a2e');
    px(c, b.x + 3, b.y + 3, b.w - 6, b.h - 6, roof);
    // pasy dachu
    const horiz = b.w >= b.h;
    c.fillStyle = 'rgba(0,0,0,0.18)';
    if (horiz) for (let xx = b.x + 8; xx < b.x + b.w - 6; xx += 12) c.fillRect(xx, b.y + 3, 3, b.h - 6);
    else for (let yy = b.y + 8; yy < b.y + b.h - 6; yy += 12) c.fillRect(b.x + 3, yy, b.w - 6, 3);
    c.fillStyle = 'rgba(255,255,255,0.18)';
    c.fillRect(b.x + 3, b.y + 3, b.w - 6, 4);
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.fillRect(b.x + 3, b.y + b.h - 7, b.w - 6, 4);
    px(c, b.x + b.w / 2 - 4, b.y + b.h / 2 - 4, 8, 8, '#44464c'); // komin / świetlik
  });

  for (const t of map.trees) if (t.blocking) tree(c, t.x, t.y, t.size, true);

  return cv;
}
