/**
 * HUD. It reads simulation state and writes DOM — never the other way round, and
 * never per-frame allocations (the prototype rebuilt DOM nodes every frame; here
 * everything is created once and only text/width/opacity change, with dirty
 * checks on the expensive fields).
 *
 * Element ids are stable because the Playwright suite asserts against them
 * (tests/e2e/game.spec.ts).
 */
import { currentObjective, type World } from '@iron/sim';
import { RAD2DEG } from '@iron/core';

interface CompassMarker {
  /** Bearing in the world compass frame, degrees, N = 0 and E = 90. */
  bearing: number;
  label: string;
  tone: 'objective' | 'extract';
}

export interface HudOptions {
  colorBlindCrosshair: boolean;
  showFps: boolean;
  motionScale: number;
}

interface ElementMap {
  root: HTMLElement;
  compass: HTMLCanvasElement;
  objLine: HTMLElement;
  waveLabel: HTMLElement;
  wavePips: HTMLElement;
  hostiles: HTMLElement;
  score: HTMLElement;
  fps: HTMLElement;
  killfeed: HTMLElement;
  banner: HTMLElement;
  bannerTitle: HTMLElement;
  bannerSub: HTMLElement;
  crosshair: HTMLElement;
  xhT: HTMLElement;
  xhB: HTMLElement;
  xhL: HTMLElement;
  xhR: HTMLElement;
  hitmarker: HTMLElement;
  dmgDir: HTMLElement;
  hpVal: HTMLElement;
  hpFill: HTMLElement;
  ammo: HTMLElement;
  reserve: HTMLElement;
  weaponName: HTMLElement;
  reloadWrap: HTMLElement;
  reloadBar: HTMLElement;
  grenades: HTMLElement;
  hint: HTMLElement;
  subtitles: HTMLElement;
  damageOverlay: HTMLElement;
  flash: HTMLElement;
  toast: HTMLElement;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  id: string,
  className?: string,
  html = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.id = id;
  if (className) node.className = className;
  if (html) node.innerHTML = html;
  return node;
}

export class Hud {
  private readonly e: ElementMap;
  private readonly ctx: CanvasRenderingContext2D | null;
  private lastAmmo = -1;
  private lastReserve = -1;
  private lastHealth = -1;
  private lastHostiles = -1;
  private lastScore = -1;
  private lastWave = -1;
  private lastReloadBucket = -1;
  /** Reused between frames: the HUD never allocates in `update`. */
  private readonly markers: CompassMarker[] = [];
  private markerCount = 0;
  private bannerTimer: number | null = null;
  private hitmarkerTimer: number | null = null;
  private subtitleTimer: number | null = null;
  private options: HudOptions;

  constructor(container: HTMLElement, options: HudOptions) {
    this.options = options;
    const root = el('div', 'hud');
    root.innerHTML = `
      <div id="compassWrap"><canvas id="compass" width="430" height="30"></canvas><div id="objLine"></div></div>
      <div id="topLeft">
        <div id="waveLabel" class="display">WAVE 1/5</div>
        <div id="wavePips"></div>
        <div id="hostiles">HOSTILES: 0</div>
      </div>
      <div id="topRight"><div id="score" class="display">0</div><div id="fps">-- FPS</div></div>
      <div id="killfeed"></div>
      <div id="banner"><div id="bannerTitle" class="display"></div><div id="bannerSub"></div></div>
      <div id="xhair"><i id="xh-t"></i><i id="xh-b"></i><i id="xh-l"></i><i id="xh-r"></i><span id="xh-dot"></span></div>
      <div id="hitmarker"><i id="hm1"></i><i id="hm2"></i><i id="hm3"></i><i id="hm4"></i></div>
      <div id="dmgDir"></div>
      <div id="bl">
        <div id="hpTag" class="hud-tag">SGT. VANCE — TASK FORCE 27</div>
        <div id="hpWrap"><div id="hpFill"></div></div>
        <div id="hpNum"><span id="hpVal">100</span><small>INTEGRITY</small></div>
      </div>
      <div id="br">
        <div id="ammoLine"><span id="ammo">30</span><span>/</span><span id="reserve">240</span></div>
        <div id="wname"></div>
        <div id="reloadWrap"><div id="reloadBar"></div></div>
        <div id="grenades"></div>
      </div>
      <div id="hint">W A S D MOVE · SHIFT SPRINT · RMB AIM · R RELOAD · G FRAG · ESC PAUSE</div>
      <div id="subtitles"></div>
    `;
    container.appendChild(root);

    const overlay = el('div', 'damageOv', 'iv-damage-overlay');
    const flash = el('div', 'flashWhite', 'iv-flash');
    const toast = el('div', 'toast', 'iv-toast');
    container.appendChild(overlay);
    container.appendChild(flash);
    container.appendChild(toast);

    this.e = {
      root,
      compass: root.querySelector<HTMLCanvasElement>('#compass')!,
      objLine: root.querySelector('#objLine')!,
      waveLabel: root.querySelector('#waveLabel')!,
      wavePips: root.querySelector('#wavePips')!,
      hostiles: root.querySelector('#hostiles')!,
      score: root.querySelector('#score')!,
      fps: root.querySelector('#fps')!,
      killfeed: root.querySelector('#killfeed')!,
      banner: root.querySelector('#banner')!,
      bannerTitle: root.querySelector('#bannerTitle')!,
      bannerSub: root.querySelector('#bannerSub')!,
      crosshair: root.querySelector('#xhair')!,
      xhT: root.querySelector('#xh-t')!,
      xhB: root.querySelector('#xh-b')!,
      xhL: root.querySelector('#xh-l')!,
      xhR: root.querySelector('#xh-r')!,
      hitmarker: root.querySelector('#hitmarker')!,
      dmgDir: root.querySelector('#dmgDir')!,
      hpVal: root.querySelector('#hpVal')!,
      hpFill: root.querySelector('#hpFill')!,
      ammo: root.querySelector('#ammo')!,
      reserve: root.querySelector('#reserve')!,
      weaponName: root.querySelector('#wname')!,
      reloadWrap: root.querySelector('#reloadWrap')!,
      reloadBar: root.querySelector('#reloadBar')!,
      grenades: root.querySelector('#grenades')!,
      hint: root.querySelector('#hint')!,
      subtitles: root.querySelector('#subtitles')!,
      damageOverlay: overlay,
      flash,
      toast,
    };
    this.ctx = this.e.compass.getContext('2d');
    this.e.crosshair.classList.toggle('cb', options.colorBlindCrosshair);
    this.e.fps.style.display = options.showFps ? '' : 'none';
    this.renderWavePips(1, 5);
    this.renderGrenades(2, 4);
  }

  applyOptions(options: HudOptions): void {
    this.options = options;
    this.e.crosshair.classList.toggle('cb', options.colorBlindCrosshair);
    this.e.fps.style.display = options.showFps ? '' : 'none';
  }

  show(): void {
    this.e.root.classList.add('show');
  }

  hide(): void {
    this.e.root.classList.remove('show');
    // The damage vignette and the white flash live outside #hud and are driven by
    // `world.tick`. Once the simulation stops (death, victory, pause) the last value
    // would freeze on screen — and a frozen 0.4 vignette over the debrief reads as a
    // black screen, which is exactly the bug this reset exists to prevent.
    this.e.damageOverlay.style.opacity = '0';
    this.e.flash.style.opacity = '0';
  }

  get visible(): boolean {
    return this.e.root.classList.contains('show');
  }

  setWeaponName(name: string): void {
    this.e.weaponName.textContent = name;
  }

  setHint(text: string): void {
    this.e.hint.textContent = text;
  }

  fadeHint(): void {
    this.e.hint.style.opacity = '0';
  }

  /** Per-frame refresh; cheap fields update every frame, expensive ones on change. */
  update(
    world: World,
    view: { fps: number; spreadPx: number; objectiveText: string; renderScale?: number },
  ): void {
    const p = world.player;

    const gap = 6 + view.spreadPx * this.options.motionScale;
    const crosshairOpacity = p.adsT > 0.5 ? 0 : 0.95;
    this.e.xhT.style.transform = `translate(-1px,${-gap - 9}px)`;
    this.e.xhB.style.transform = `translate(-1px,${gap}px)`;
    this.e.xhL.style.transform = `translate(${-gap - 9}px,-1px)`;
    this.e.xhR.style.transform = `translate(${gap}px,-1px)`;
    this.e.xhT.style.opacity = String(crosshairOpacity);
    this.e.xhB.style.opacity = String(crosshairOpacity);
    this.e.xhL.style.opacity = String(crosshairOpacity);
    this.e.xhR.style.opacity = String(crosshairOpacity);

    if (p.weapon.ammo !== this.lastAmmo) {
      this.lastAmmo = p.weapon.ammo;
      this.e.ammo.textContent = String(p.weapon.ammo);
      this.e.ammo.className = p.weapon.ammo <= 5 ? 'low' : '';
    }
    if (p.weapon.reserve !== this.lastReserve) {
      this.lastReserve = p.weapon.reserve;
      this.e.reserve.textContent = String(p.weapon.reserve);
    }

    const health = Math.round(p.health);
    if (health !== this.lastHealth) {
      this.lastHealth = health;
      this.e.hpVal.textContent = String(health);
      this.e.hpFill.style.width = `${Math.max(0, health)}%`;
      this.e.hpFill.style.background =
        health > 55
          ? 'linear-gradient(90deg,#5f8f2f,#9dff57)'
          : health > 25
            ? 'linear-gradient(90deg,#c98a2e,#ffb043)'
            : 'linear-gradient(90deg,#a01f10,#ff4b3a)';
    }

    const hostiles = world.spawnQueue.length + world.enemies.filter((e) => e.alive).length;
    if (hostiles !== this.lastHostiles) {
      this.lastHostiles = hostiles;
      this.e.hostiles.textContent = `HOSTILES: ${hostiles}`;
    }

    if (p.score !== this.lastScore) {
      this.lastScore = p.score;
      this.e.score.textContent = String(p.score);
    }

    if (world.wave !== this.lastWave) {
      this.lastWave = world.wave;
      this.e.waveLabel.textContent =
        world.wave === 0 ? `WAVE 0/${world.waves.length}` : world.wave >= world.waves.length && world.wavesCleared >= world.waves.length ? 'EXTRACTION' : `WAVE ${world.wave}/${world.waves.length}`;
      this.renderWavePips(world.wavesCleared, world.waves.length);
    }

    this.e.objLine.textContent = view.objectiveText;
    // The frame counter is honest about what the frame *is*. The adaptive controller
    // trades resolution for frame rate, so a number that says "58 FPS" while
    // rendering at 82% and upscaling is a half-truth; the chip says both, and only
    // mentions resolution when it is actually being traded. (ADR-0014)
    const scale = view.renderScale;
    this.e.fps.textContent =
      scale !== undefined && scale < 0.995
        ? `${view.fps} FPS · ${Math.round(scale * 100)}% RES`
        : `${view.fps} FPS`;

    const reloadBucket = p.reloading
      ? Math.round(((1 - p.reloadTicks / (world.weaponDef.reloadSeconds * 60)) * 100) / 5)
      : -1;
    if (reloadBucket !== this.lastReloadBucket) {
      this.lastReloadBucket = reloadBucket;
      if (reloadBucket < 0) {
        this.e.reloadWrap.style.opacity = '0';
        this.e.reloadBar.style.width = '0%';
      } else {
        this.e.reloadWrap.style.opacity = '1';
        this.e.reloadBar.style.width = `${Math.min(100, reloadBucket * 5)}%`;
      }
      this.renderGrenades(p.grenades, 4);
    }

    this.e.dmgDir.style.opacity = String(p.damageIndicatorT);
    this.e.dmgDir.style.transform = `rotate(${p.damageIndicatorAngle}deg)`;

    this.updateCompassMarkers(world);

    // Damage indication has to *inform*, not blind. The old curve held the
    // vignette near full opacity for 1.5 s per hit, and with a squad shooting at
    // you that meant the screen was permanently dark red — it read as "the game
    // went black". This is a short punch that decays inside ~0.6 s, with the
    // dying-player cue kept as a faint edge breath instead of a wash.
    const lowHealthPulse = p.alive && p.health < 30 ? 0.1 + Math.sin(world.tick * 0.07) * 0.06 : 0;
    const sinceHit = world.tick - p.lastDamageTick;
    const hitFlash = p.lastDamageTick > 0 && sinceHit >= 0 ? Math.max(0, 1 - sinceHit / 36) ** 1.7 * 0.45 : 0;
    this.e.damageOverlay.style.opacity = String(Math.min(0.6, Math.max(hitFlash, lowHealthPulse)));

    this.drawCompass(p.yaw);
  }

  private renderWavePips(done: number, total: number): void {
    const frag = document.createDocumentFragment();
    for (let i = 1; i <= total; i++) {
      const span = document.createElement('span');
      if (i <= done) span.className = 'done';
      frag.appendChild(span);
    }
    this.e.wavePips.replaceChildren(frag);
  }

  private renderGrenades(count: number, capacity: number): void {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < capacity; i++) {
      const span = document.createElement('span');
      span.className = `gp${i < count ? ' full' : ''}`;
      frag.appendChild(span);
    }
    this.e.grenades.replaceChildren(frag);
  }

  /**
   * Objective markers, one per active objective that names a place to be.
   *
   * A `survive` objective has nowhere to point at, so it gets no marker: a compass
   * bearing to nowhere is worse than an empty compass.
   */
  private updateCompassMarkers(world: World): void {
    this.markerCount = 0;
    const objective = currentObjective(world);
    const zone = objective?.def.params.zone;
    if (!objective || !zone) return;

    const p = world.player;
    const dx = zone.x - p.pos.x;
    const dz = zone.z - p.pos.z;
    const marker = (this.markers[0] ??= { bearing: 0, label: '', tone: 'objective' });
    // North is -Z (yaw 0 looks down -Z), so the bearing is atan2(east, north).
    marker.bearing = Math.atan2(dx, -dz) * RAD2DEG;
    marker.label = `${Math.round(Math.hypot(dx, dz))}m`;
    marker.tone = objective.def.kind === 'extract' ? 'extract' : 'objective';
    this.markerCount = 1;
  }

  /** Compass (parity: canvas ticks every 5 degrees, majors at 90). */
  private drawCompass(yaw: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const w = 430;
    const h = 30;
    ctx.clearRect(0, 0, w, h);
    let degrees = (-yaw * RAD2DEG) % 360;
    if (degrees < 0) degrees += 360;
    ctx.textAlign = 'center';
    for (let offset = -90; offset <= 90; offset += 5) {
      let d = degrees + offset;
      d = ((d % 360) + 360) % 360;
      const x = w / 2 + offset * (w / 130);
      const major = d % 90 === 0;
      const mid = d % 15 === 0;
      ctx.strokeStyle = major ? '#ffb043' : `rgba(236,230,214,${mid ? 0.6 : 0.28})`;
      ctx.lineWidth = major ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.lineTo(x, h - (major ? 14 : mid ? 9 : 5));
      ctx.stroke();
      if (major) {
        ctx.fillStyle = '#ffb043';
        ctx.font = '700 12px Rajdhani';
        const label = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[d as 0 | 90 | 180 | 270];
        ctx.fillText(label ?? '', x, 12);
      } else if (mid) {
        ctx.fillStyle = 'rgba(236,230,214,.5)';
        ctx.font = '600 9px Rajdhani';
        ctx.fillText(String(Math.round(d)), x, 12);
      }
    }

    // Markers ride the same 130-degrees-across-430-px scale as the ticks, so a
    // marker is placed by its bearing relative to the player's heading.
    for (let i = 0; i < this.markerCount; i++) {
      const marker = this.markers[i]!;
      const relative = (((marker.bearing - degrees) % 360) + 540) % 360 - 180;
      if (Math.abs(relative) > 88) continue;
      const x = w / 2 + relative * (w / 130);
      ctx.fillStyle = marker.tone === 'extract' ? '#9dff57' : '#ffb043';
      ctx.beginPath();
      ctx.moveTo(x, 7);
      ctx.lineTo(x + 5, 13);
      ctx.lineTo(x, 19);
      ctx.lineTo(x - 5, 13);
      ctx.closePath();
      ctx.fill();
      ctx.font = '700 8px Rajdhani';
      ctx.textAlign = 'left';
      ctx.fillText(marker.label, x + 8, 16);
      ctx.textAlign = 'center';
    }
  }

  banner(title: string, subtitle: string, small: boolean): void {
    this.e.banner.className = small ? 'small' : '';
    this.e.bannerTitle.textContent = title;
    this.e.bannerSub.textContent = subtitle;
    this.e.banner.style.opacity = '1';
    if (this.bannerTimer !== null) window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => {
      this.e.banner.style.opacity = '0';
    }, small ? 1200 : 2600);
  }

  feed(html: string): void {
    const node = document.createElement('div');
    node.className = 'kf';
    node.innerHTML = html;
    this.e.killfeed.appendChild(node);
    while (this.e.killfeed.children.length > 5) {
      this.e.killfeed.removeChild(this.e.killfeed.firstChild!);
    }
    window.setTimeout(() => node.classList.add('dead'), 3400);
    window.setTimeout(() => node.remove(), 4200);
  }

  hitmarker(kill: boolean): void {
    this.e.hitmarker.className = kill ? 'kill' : '';
    this.e.hitmarker.style.opacity = '1';
    if (this.hitmarkerTimer !== null) window.clearTimeout(this.hitmarkerTimer);
    this.hitmarkerTimer = window.setTimeout(() => {
      this.e.hitmarker.style.opacity = '0';
    }, 120);
  }

  flash(alpha: number): void {
    if (alpha <= 0) return;
    this.e.flash.style.transition = 'none';
    this.e.flash.style.opacity = String(Math.min(1, alpha));
    window.requestAnimationFrame(() => {
      this.e.flash.style.transition = 'opacity .35s';
      this.e.flash.style.opacity = '0';
    });
  }

  subtitle(text: string | null): void {
    if (this.subtitleTimer !== null) window.clearTimeout(this.subtitleTimer);
    if (!text) {
      this.e.subtitles.style.opacity = '0';
      return;
    }
    this.e.subtitles.textContent = text;
    this.e.subtitles.style.opacity = '1';
    this.subtitleTimer = window.setTimeout(() => {
      this.e.subtitles.style.opacity = '0';
    }, 3600);
  }

  toast(message: string): void {
    this.e.toast.style.display = 'block';
    this.e.toast.textContent = message;
  }

  get element(): ElementMap {
    return this.e;
  }
}
