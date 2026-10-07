import Phaser from 'phaser';
import './ui/styles.css';
import { BattleScene } from './render/BattleScene';
import { Hud } from './ui/hud';

const scene = new BattleScene();

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#0b0f14',
  pixelArt: true,
  antialias: false,
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  scene: [scene],
  input: { mouse: { preventDefaultWheel: true } },
  disableContextMenu: true,
});

new Hud(scene);

// Dostęp z konsoli (debug / testy ręczne).
(window as unknown as { __fs: unknown }).__fs = { game, scene };
