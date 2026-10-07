import { UNIT_DEFS } from '../config/units';
import { UNIT_TYPES, type Unit, type UnitType } from '../core/types';
import type { Winner } from '../core/game';
import { PLAYER, type BattleScene } from '../render/BattleScene';
import { FOG_VISIBLE } from '../core/fog';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const ORDER_NAMES: Record<string, string> = {
  idle: 'Bezczynny',
  move: 'Ruch',
  attackMove: 'Atak w ruchu',
  attack: 'Atakuje cel',
  hold: 'Utrzymuje pozycję',
  board: 'Wsiada do pojazdu',
};

const fmtTime = (s: number) => {
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

export class Hud {
  private scene: BattleScene;
  private cards = new Map<UnitType, { btn: HTMLButtonElement; why: HTMLElement }>();
  private lastZoneCount = 5;
  private minimap = $<HTMLCanvasElement>('minimap');
  private mctx = this.minimap.getContext('2d')!;
  private timer = 0;
  private lastSelHtml = '';

  constructor(scene: BattleScene) {
    this.scene = scene;
    this.buildCards();
    this.bind();
    this.timer = window.setInterval(() => this.refresh(), 100);
  }

  private hooks = {
    toast: (text: string) => this.toast(text),
    onEnd: (w: Winner) => this.showEnd(w),
    onPauseChange: (p: boolean) => $('pause').classList.toggle('hidden', !p),
  };

  private startGame() {
    this.lastZoneCount = Number($<HTMLSelectElement>('zone-count').value);
    $('start').classList.add('hidden');
    $('end').classList.add('hidden');
    $('pause').classList.add('hidden');
    $('hud').classList.remove('hidden');
    this.scene.startMatch(this.lastZoneCount, this.hooks);
    $('limit').textContent = fmtTime(this.scene.sim!.rules.timeLimit);
    document.querySelectorAll('.win-pz').forEach((e) => (e.textContent = String(this.scene.sim!.rules.winPZ)));
  }

  private bind() {
    $('btn-start').onclick = () => this.startGame();
    $('btn-restart').onclick = () => this.startGame();
    $('btn-menu').onclick = () => {
      $('end').classList.add('hidden');
      $('hud').classList.add('hidden');
      $('start').classList.remove('hidden');
      this.scene.active = false;
    };
    $('btn-resume').onclick = () => this.scene.setPaused(false);
    $('btn-rally').onclick = () => this.scene.setMode(this.scene.mode === 'rally' ? 'none' : 'rally');
    $('btn-rally-clear').onclick = () => this.scene.command('clearRally');
    document.querySelectorAll<HTMLButtonElement>('#orders button').forEach((b) => {
      b.onclick = () => this.scene.command(b.dataset.cmd as 'stop');
    });
    // Menu kontekstowe wyłączone tylko w obszarze gry.
    $('app').addEventListener('contextmenu', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('#game') || t.closest('#minimap-wrap') || t.closest('#hud')) e.preventDefault();
    });
    const mm = this.minimap;
    const toWorld = (e: MouseEvent) => {
      const r = mm.getBoundingClientRect();
      const m = this.scene.sim!.map;
      return { x: ((e.clientX - r.left) / r.width) * m.width, y: ((e.clientY - r.top) / r.height) * m.height };
    };
    let dragging = false;
    mm.addEventListener('mousedown', (e) => {
      if (!this.scene.sim) return;
      const w = toWorld(e);
      if (e.button === 2) {
        const own = this.scene.ownSelected();
        if (own.length) {
          const r = this.scene.sim.cmdMove(PLAYER, own.map((u) => u.id), w, false);
          if (r.message) this.toast(r.message);
        }
        return;
      }
      dragging = true;
      this.scene.centerCamera(w.x, w.y);
    });
    window.addEventListener('mousemove', (e) => {
      if (dragging && this.scene.sim) {
        const w = toWorld(e);
        this.scene.centerCamera(w.x, w.y);
      }
    });
    window.addEventListener('mouseup', () => (dragging = false));
  }

  private buildCards() {
    const host = $('cards');
    for (const type of UNIT_TYPES) {
      const d = UNIT_DEFS[type];
      const maxRange = d.weapons.length ? Math.max(...d.weapons.map((w) => w.range)) : (d.heal?.range ?? 0);
      const el = document.createElement('div');
      el.className = 'card';
      el.title = d.role;
      const minR = d.weapons.find((w) => w.minRange)?.minRange;
      el.innerHTML = `
        <div class="head"><span class="name">${d.name}</span><span class="cost">${d.cost} PD</span></div>
        <div class="role">${d.tag}</div>
        <div class="stats">
          <span>HP ${d.maxHp}</span><span>Pancerz ${d.armor}</span><span>Pręd. ${d.speed}</span>
          <span>Zasięg ${maxRange || '–'}${minR ? ' (min ' + minR + ')' : ''}</span><span>Wzrok ${d.vision}</span><span>+${d.pzValue} PZ</span>
        </div>
        <div class="row"><button>Zamów</button><span class="why"></span></div>`;
      const btn = el.querySelector('button') as HTMLButtonElement;
      btn.onclick = () => this.scene.buy(type);
      host.appendChild(el);
      this.cards.set(type, { btn, why: el.querySelector('.why') as HTMLElement });
    }
  }

  toast(text: string) {
    const host = $('toasts');
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    host.appendChild(el);
    while (host.children.length > 4) host.firstChild?.remove();
    setTimeout(() => el.remove(), 3200);
  }

  private showEnd(w: Winner) {
    const sim = this.scene.sim!;
    const title = $('end-title');
    title.className = w === 'blue' ? 'win' : w === 'red' ? 'lose' : 'draw';
    title.textContent = w === 'blue' ? 'Zwycięstwo!' : w === 'red' ? 'Porażka' : 'Remis';
    $('end-text').textContent = `Wynik PZ: Niebiescy ${Math.floor(sim.teams.blue.pz)} – Czerwoni ${Math.floor(sim.teams.red.pz)}. Czas meczu: ${fmtTime(sim.time)}. Zniszczono wrogów: ${sim.teams.blue.kills}.`;
    $('end').classList.remove('hidden');
  }

  private refresh() {
    const sim = this.scene.sim;
    if (!sim || !this.scene.active) return;
    const win = sim.rules.winPZ;
    const b = sim.teams.blue;
    const r = sim.teams.red;
    $('pz-blue').textContent = String(Math.floor(b.pz));
    $('pz-red').textContent = String(Math.floor(r.pz));
    $('pzbar-blue').style.width = `${Math.min(100, (b.pz / win) * 100)}%`;
    $('pzbar-red').style.width = `${Math.min(100, (r.pz / win) * 100)}%`;
    $('clock').textContent = fmtTime(sim.time);
    $('pd').textContent = String(Math.floor(b.pd));
    $('income').textContent = `+${sim.income(PLAYER)}`;
    $('unitcount').textContent = `${sim.unitCount(PLAYER)}/${sim.rules.unitCap}` + (b.queue.length ? ` (+${b.queue.length} w drodze)` : '');

    for (const [type, c] of this.cards) {
      const reason = sim.buyBlockReason(PLAYER, type);
      c.btn.disabled = !!reason;
      c.why.textContent = reason ?? '';
    }
    const q = $('queue');
    q.innerHTML = b.queue.length ? '<div>W drodze:</div>' + b.queue.map((i) => `<div class="q"><span>${UNIT_DEFS[i.type].name}</span><span>${i.remaining.toFixed(1)} s</span></div>`).join('') : '';
    $('btn-rally').classList.toggle('active', this.scene.mode === 'rally');
    $('btn-rally').textContent = b.rally ? '⚑ Zmień punkt zbiórki' : '⚑ Punkt zbiórki';

    this.renderSelection();
    this.drawMinimap();
  }

  private renderSelection() {
    const sel = this.scene.selectedUnits();
    const own = sel.filter((u) => u.team === PLAYER);
    const info = $('selinfo');
    let html: string;
    if (!sel.length) {
      html = '<h4>Brak zaznaczenia</h4><div class="muted">LPM – wybierz jednostkę, przeciągnij LPM – zaznacz wiele. PPM – rozkaz.</div>';
    } else if (sel.length === 1) html = this.describeUnit(sel[0]);
    else {
      const counts = new Map<string, number>();
      let hp = 0;
      let max = 0;
      for (const u of sel) {
        counts.set(u.def.name, (counts.get(u.def.name) ?? 0) + 1);
        hp += u.hp;
        max += u.def.maxHp;
      }
      html = `<h4>Zaznaczono: ${sel.length}</h4><div class="muted">Łączne HP ${Math.round(hp)}/${max}</div><div class="chips">${[...counts].map(([n, c]) => `<span class="chip">${n} ×${c}</span>`).join('')}</div>`;
    }
    if (html !== this.lastSelHtml) {
      info.innerHTML = html;
      this.lastSelHtml = html;
    }
    const transports = own.filter((u) => u.def.transportCapacity);
    const set = (cmd: string, enabled: boolean, active = false) => {
      const b = document.querySelector<HTMLButtonElement>(`#orders [data-cmd="${cmd}"]`)!;
      b.disabled = !enabled;
      b.classList.toggle('active', active);
    };
    set('attackMove', own.some((u) => u.def.weapons.length > 0 || u.type === 'medic'), this.scene.mode === 'attackMove');
    set('stop', own.length > 0);
    set('hold', own.length > 0);
    set('load', transports.some((t) => t.passengers.length < t.def.transportCapacity!));
    set('unload', transports.some((t) => t.passengers.length > 0));
  }

  private describeUnit(u: Unit): string {
    const d = u.def;
    const sim = this.scene.sim!;
    const own = u.team === PLAYER;
    const hpPct = Math.max(0, (u.hp / d.maxHp) * 100);
    const weapons = d.weapons
      .map((w) => `${w.name}: ${w.damage} obr. co ${w.cooldown}s, zasięg ${w.range}${w.minRange ? ` (min ${w.minRange})` : ''}`)
      .join('<br>');
    let order = '';
    if (own) {
      let o = ORDER_NAMES[u.order.type] ?? u.order.type;
      if (u.order.type === 'attack' && u.order.targetId !== undefined) {
        const t = sim.byId.get(u.order.targetId);
        if (t) o += ` (${t.def.name})`;
      } else if (u.targetId !== null && u.order.type !== 'move') {
        const t = sim.byId.get(u.targetId);
        if (t && t.alive) o += ` – cel: ${t.def.name}`;
      }
      order = `<div>Rozkaz: <b>${o}</b></div>`;
    }
    const pass = d.transportCapacity ? `<div>Pasażerowie: <b>${u.passengers.length}/${d.transportCapacity}</b></div>` : '';
    const heal = d.heal ? `<div class="muted">Leczy ${d.heal.rate} HP/s w promieniu ${d.heal.range}</div>` : '';
    return `<h4 style="color:${u.team === 'blue' ? '#8db6ff' : '#ff9b91'}">${d.name}${own ? '' : ' (wróg)'}</h4>
      <div><span class="hp"><i style="width:${hpPct}%"></i></span>HP ${Math.ceil(u.hp)}/${d.maxHp} · Pancerz ${d.armor}</div>
      ${order}${pass}${heal}<div class="muted">${weapons || 'Nieuzbrojony'}</div>`;
  }

  private drawMinimap() {
    const sim = this.scene.sim!;
    const c = this.mctx;
    const W = this.minimap.width;
    const H = this.minimap.height;
    const m = sim.map;
    const sx = W / m.width;
    const sy = H / m.height;
    c.imageSmoothingEnabled = true;
    c.fillStyle = '#000';
    c.fillRect(0, 0, W, H);
    if (this.scene.terrainCanvas) c.drawImage(this.scene.terrainCanvas, 0, 0, W, H);
    if (this.scene.fogCanvas) c.drawImage(this.scene.fogCanvas, 0, 0, W, H);
    // strefy (własność publiczna)
    for (const z of sim.zones) {
      c.beginPath();
      c.arc(z.def.x * sx, z.def.y * sy, 7, 0, Math.PI * 2);
      c.fillStyle = z.owner === 'blue' ? 'rgba(76,141,255,0.8)' : z.owner === 'red' ? 'rgba(255,90,74,0.8)' : 'rgba(220,226,232,0.55)';
      c.fill();
      c.lineWidth = 2;
      c.strokeStyle = z.contested ? '#ffe14a' : '#0b0f14';
      c.stroke();
    }
    // jednostki: własne zawsze, wrogie tylko aktualnie widoczne
    for (const u of sim.units) {
      if (!u.alive || u.insideId !== null) continue;
      if (u.team !== PLAYER && !sim.fog.canSeeUnit(PLAYER, u)) continue;
      if (u.team !== PLAYER && sim.fog.stateAt(PLAYER, u.x, u.y) !== FOG_VISIBLE) continue;
      c.fillStyle = u.team === 'blue' ? '#7fb2ff' : '#ff6a5a';
      const s = u.def.transportCapacity || u.type === 'tank' || u.type === 'artillery' ? 4 : 3;
      c.fillRect(u.x * sx - s / 2, u.y * sy - s / 2, s, s);
    }
    const v = this.scene.viewRect();
    c.strokeStyle = '#ffffff';
    c.lineWidth = 1.5;
    c.strokeRect(v.x * sx, v.y * sy, v.w * sx, v.h * sy);
  }

  dispose() {
    clearInterval(this.timer);
  }
}
