import Phaser from 'phaser';
import type { Team, UnitType } from '../core/types';

const S = 2; // jeden piksel logiczny = 2 piksele świata

interface Palette {
  main: string;
  dark: string;
  light: string;
  vest: string;
  vestDark: string;
  hat: string;
  hatLight: string;
}

const PALETTES: Record<Team, Palette> = {
  blue: { main: '#3a68b8', dark: '#1f3d78', light: '#7aa8f0', vest: '#38b6e8', vestDark: '#1f7fae', hat: '#2f5fd0', hatLight: '#6f9bff' },
  red: { main: '#b8402f', dark: '#6e1f1c', light: '#f08a4a', vest: '#f08a2e', vestDark: '#b8561a', hat: '#c02a2a', hatLight: '#ff6a5a' },
};

type Ctx = CanvasRenderingContext2D;
const r = (c: Ctx, x: number, y: number, w: number, h: number, col: string) => {
  c.fillStyle = col;
  c.fillRect(x * S, y * S, w * S, h * S);
};

const SKIN = '#e8b890';
const BLACK = '#1b1b1f';
const GUN = '#34343a';

// Wszystkie sprite'y są narysowane z widokiem z góry, "przodem" w prawo (wschód).
function drawInfantry(c: Ctx, p: Palette) {
  r(c, 1, 4, 3, 6, '#3a3a2e'); // plecak
  r(c, 3, 3, 5, 8, p.vest);
  r(c, 3, 3, 5, 1, p.vestDark);
  r(c, 3, 10, 5, 1, p.vestDark);
  r(c, 7, 4, 3, 2, SKIN); // dłoń lewa
  r(c, 7, 8, 3, 2, SKIN);
  r(c, 8, 6, 6, 2, BLACK); // karabin
  r(c, 9, 8, 1, 2, BLACK);
  r(c, 13, 6, 1, 2, '#707078');
  r(c, 4, 5, 4, 4, p.hat); // beret / hełm
  r(c, 5, 6, 2, 2, p.hatLight);
}

function drawMedic(c: Ctx, p: Palette) {
  r(c, 1, 3, 3, 8, '#f2f2f0'); // plecak z krzyżem
  r(c, 2, 4, 1, 6, '#d02828');
  r(c, 1, 6, 3, 2, '#d02828');
  r(c, 3, 3, 5, 8, p.vest);
  r(c, 3, 3, 5, 1, p.vestDark);
  r(c, 3, 10, 5, 1, p.vestDark);
  r(c, 7, 4, 3, 2, SKIN);
  r(c, 7, 8, 3, 2, SKIN);
  r(c, 4, 5, 4, 4, '#f4f4f2');
  r(c, 5, 6, 2, 2, '#d02828');
}

function drawTank(c: Ctx, p: Palette) {
  r(c, 1, 0, 18, 3, '#26262a');
  r(c, 1, 11, 18, 3, '#26262a');
  for (let x = 2; x < 18; x += 3) {
    r(c, x, 0, 1, 3, '#3c3c42');
    r(c, x, 11, 1, 3, '#3c3c42');
  }
  r(c, 2, 3, 16, 8, p.main);
  r(c, 2, 3, 16, 1, p.light);
  r(c, 2, 10, 16, 1, p.dark);
  r(c, 15, 4, 3, 6, p.dark);
  r(c, 5, 4, 8, 6, p.dark);
  r(c, 6, 5, 6, 4, p.main);
  r(c, 7, 6, 2, 2, p.light);
  r(c, 12, 6, 8, 2, GUN);
  r(c, 19, 5, 1, 4, '#4a4a52');
}

function drawApc(c: Ctx, p: Palette) {
  for (const x of [3, 7, 11, 15]) {
    r(c, x, 0, 3, 2, '#26262a');
    r(c, x, 10, 3, 2, '#26262a');
  }
  r(c, 1, 2, 18, 8, p.main);
  r(c, 1, 2, 18, 1, p.light);
  r(c, 1, 9, 18, 1, p.dark);
  r(c, 15, 3, 4, 6, p.dark);
  r(c, 3, 3, 4, 2, p.dark);
  r(c, 3, 7, 4, 2, p.dark);
  r(c, 8, 4, 4, 4, p.dark);
  r(c, 9, 5, 2, 2, p.light);
  r(c, 12, 5, 5, 2, GUN);
}

function drawIfv(c: Ctx, p: Palette) {
  r(c, 1, 0, 17, 3, '#26262a');
  r(c, 1, 9, 17, 3, '#26262a');
  for (let x = 2; x < 17; x += 3) {
    r(c, x, 0, 1, 3, '#3c3c42');
    r(c, x, 9, 1, 3, '#3c3c42');
  }
  r(c, 1, 3, 17, 6, p.main);
  r(c, 1, 3, 17, 1, p.light);
  r(c, 14, 4, 4, 4, p.dark);
  r(c, 6, 3, 7, 6, p.dark);
  r(c, 7, 4, 5, 4, p.main);
  r(c, 8, 5, 2, 2, p.light);
  r(c, 12, 5, 8, 2, GUN);
  r(c, 3, 4, 2, 4, p.dark);
}

function drawArtillery(c: Ctx, p: Palette) {
  r(c, 1, 0, 16, 2, '#26262a');
  r(c, 1, 10, 16, 2, '#26262a');
  for (let x = 2; x < 16; x += 3) {
    r(c, x, 0, 1, 2, '#3c3c42');
    r(c, x, 10, 1, 2, '#3c3c42');
  }
  r(c, 1, 2, 16, 8, p.main);
  r(c, 1, 2, 16, 1, p.light);
  r(c, 13, 3, 4, 6, p.dark);
  r(c, 4, 3, 7, 6, p.dark);
  r(c, 5, 4, 5, 4, p.main);
  r(c, 9, 5, 15, 2, GUN);
  r(c, 22, 4, 2, 4, '#4a4a52');
  r(c, 5, 5, 2, 2, p.light);
}

const DRAW: Record<UnitType, { w: number; h: number; draw: (c: Ctx, p: Palette) => void }> = {
  infantry: { w: 14, h: 14, draw: drawInfantry },
  medic: { w: 14, h: 14, draw: drawMedic },
  tank: { w: 20, h: 14, draw: drawTank },
  apc: { w: 20, h: 12, draw: drawApc },
  ifv: { w: 20, h: 12, draw: drawIfv },
  artillery: { w: 24, h: 12, draw: drawArtillery },
};

export const spriteKey = (team: Team, type: UnitType) => `unit_${team}_${type}`;

export function createUnitTextures(scene: Phaser.Scene) {
  for (const team of ['blue', 'red'] as Team[]) {
    for (const type of Object.keys(DRAW) as UnitType[]) {
      const key = spriteKey(team, type);
      if (scene.textures.exists(key)) continue;
      const d = DRAW[type];
      const cv = document.createElement('canvas');
      cv.width = d.w * S;
      cv.height = d.h * S;
      d.draw(cv.getContext('2d')!, PALETTES[team]);
      scene.textures.addCanvas(key, cv);
    }
  }
  // drobna kropka pocisku / efekt
  if (!scene.textures.exists('dot')) {
    const cv = document.createElement('canvas');
    cv.width = 4;
    cv.height = 4;
    const c = cv.getContext('2d')!;
    c.fillStyle = '#fff';
    c.fillRect(0, 0, 4, 4);
    scene.textures.addCanvas('dot', cv);
  }
}
