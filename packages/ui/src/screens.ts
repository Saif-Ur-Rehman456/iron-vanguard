/**
 * Screens: menu, pause, settings, K.I.A. and mission debrief.
 * All copy comes from content (`MissionDef`), so localisation and mission select
 * do not require touching this file.
 */
import { DIFFICULTIES, type MissionDef, type RankDef } from '@iron/content';
import type { MissionStats, StoredSettings } from '@iron/sim';

/**
 * What each graphics tier actually buys, in the player's terms.
 *
 * Copy, not configuration: `packages/ui` does not import `@iron/render`, so the
 * numbers here are a summary of `QUALITY_PRESETS` for the person choosing. Their
 * point is that every tier is a *budget* — shadows, samples, particles — and that
 * the look (lighting ratios, the grade, bloom, the AO term) is identical on all of
 * them. That was not true before ADR-0014, and the panel is where a player finds out
 * rather than by guessing from a screenshot.
 */
const GRAPHICS_NOTES: Record<string, string> = {
  low: 'LIGHTEST FRAME — NO AMBIENT OCCLUSION, NO SHADOW ATLAS, FXAA, 1 LAMP LIGHT',
  medium: '1024² SHADOWS TO 55 m, FXAA, NO AO, 2 LAMP LIGHTS, 320 PARTICLES',
  high: '2 MSAA + SMAA, 1024² SHADOWS TO 70 m, 6 AO SAMPLES, 3 LAMP LIGHTS',
  cinematic: '4 MSAA + SMAA, 2048² SHADOWS TO 90 m, 8 AO SAMPLES, VOLUMETRIC FOG',
};

/**
 * The resolution choice, as the menu offers it.
 *
 * This row exists because the previous build made the choice *for* the player, and
 * silently: the adaptive controller's only lever is resolution, so a machine that was
 * a few frames short of 60 fps got a softer picture and the same frame rate. The
 * setting now says out loud what it does, and NATIVE — full resolution, sharp picture,
 * fewer effects when it has to — is the default (ADR-0017).
 */
const RESOLUTION_OPTIONS: { id: string; label: string }[] = [
  { id: 'native', label: 'NATIVE — SHARPEST, ALWAYS 100%' },
  { id: 'dynamic', label: 'DYNAMIC — TRADE SHARPNESS FOR FPS' },
];

/**
 * The two atmospheres, as the menu offers them.
 *
 * Both are the same plaza and the same simulation — a time of day is sky, key light,
 * haze and which lamps are on (level/timeOfDay.ts) — so the copy says so: a player
 * choosing MORNING is choosing a picture, not a difficulty.
 */
const TIME_OF_DAY_OPTIONS: { id: string; label: string }[] = [
  { id: 'dawn', label: 'MORNING — 0620' },
  { id: 'dusk', label: 'DUSK — 0437' },
];

export type ScreenName = 'menu' | 'pause' | 'settings' | 'dead' | 'win';

export interface ScreenCallbacks {
  onDeploy: (difficultyId: string) => void;
  onResume: () => void;
  onRestart: () => void;
  onQuit: () => void;
  onSettingsChange: (settings: StoredSettings) => void;
  /**
   * What the renderer is actually doing, for the settings panel's readout.
   *
   * The report that started ADR-0014 was a player moving the GRAPHICS setting and
   * concluding the game looked worse, with nothing on screen to tell them why. The
   * panel now states the tier's budget and the resolution the frame is really being
   * drawn at, live, so a resolution cut is visible as a resolution cut rather than
   * as the picture mysteriously getting softer.
   */
  getRenderInfo?: () => { tier: string; scale: number; fps: number } | null;
}

function div(id: string, className: string, html = ''): HTMLElement {
  const node = document.createElement('div');
  node.id = id;
  node.className = className;
  if (html) node.innerHTML = html;
  return node;
}

export class Screens {
  private readonly screens = new Map<ScreenName, HTMLElement>();
  private readonly difficulty: HTMLSelectElement;
  /** The pre-deploy atmosphere choice (the same field the settings panel edits). */
  private readonly timeOfDay: HTMLSelectElement;
  private readonly settingsFields: { key: keyof StoredSettings; input: HTMLInputElement | HTMLSelectElement }[] = [];
  private active: ScreenName | null = null;
  private graphicsNote: HTMLElement | null = null;
  private graphicsTimer: number | null = null;

  constructor(
    private readonly container: HTMLElement,
    mission: MissionDef,
    private settings: StoredSettings,
    private readonly callbacks: ScreenCallbacks,
  ) {
    // ---- mission menu -----------------------------------------------------
    const menu = div('menu', 'iv-screen show');
    menu.innerHTML = `
      <div class="iv-scan"></div>
      <div class="iv-frame">
        <div class="iv-classified">CLASSIFIED</div>
        <div class="iv-kicker">${mission.chapter} // TASK FORCE 27 // GRID E7</div>
        <h1 class="display iv-title">IRON<br>VAN<span>GUARD</span></h1>
        <div class="iv-rule"></div>
        <div class="iv-cols">
          <div class="iv-brief">
            <div class="iv-tagline">SITREP — 0437 HOURS — ${'AL KADIM PLAZA'}</div>
            ${mission.brief.map((line, i) => `<p>${i === 0 ? `<b>${line}</b>` : line}</p>`).join('')}
          </div>
          <div class="iv-controls">
            <h3>FIELD MANUAL</h3>
            <div class="row"><span>Move</span><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span></div>
            <div class="row"><span>Sprint</span><span><kbd>SHIFT</kbd></span></div>
            <div class="row"><span>Aim down sights</span><span><kbd>RMB</kbd></span></div>
            <div class="row"><span>Fire (full-auto)</span><span><kbd>LMB</kbd></span></div>
            <div class="row"><span>Reload</span><span><kbd>R</kbd></span></div>
            <div class="row"><span>Frag grenade</span><span><kbd>G</kbd></span></div>
            <div class="row"><span>Weapons</span><span><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd></span></div>
            <div class="row"><span>Pause</span><span><kbd>ESC</kbd></span></div>
          </div>
        </div>
        <div class="iv-deploy-row">
          <button id="deployBtn" class="iv-btn">DEPLOY ▸</button>
          <button id="settingsBtn" class="iv-btn ghost">SETTINGS</button>
          <label class="iv-field" style="max-width:200px">
            DIFFICULTY
            <select id="difficulty">${DIFFICULTIES.map(
              (d) => `<option value="${d.id}">${d.displayName}</option>`,
            ).join('')}</select>
          </label>
          <label class="iv-field" style="max-width:230px">
            TIME OF DAY
            <select id="timeOfDay">${TIME_OF_DAY_OPTIONS.map(
              (t) => `<option value="${t.id}">${t.label}</option>`,
            ).join('')}</select>
          </label>
          <div class="iv-note">KEYBOARD + MOUSE REQUIRED · CLICK LOCKS POINTER</div>
        </div>
        <div class="iv-foot">IRON VANGUARD ENGINE v0.1 — WEBGL2 + BLOOM PIPELINE — DETERMINISTIC SIM</div>
      </div>
    `;
    this.container.appendChild(menu);
    this.screens.set('menu', menu);

    // ---- pause ------------------------------------------------------------
    const pause = div('pause', 'iv-screen');
    pause.innerHTML = `
      <div class="iv-scan"></div>
      <div class="iv-center">
        <h2 class="display">SIGNAL INTERRUPTED</h2>
        <p>OPERATION SUSPENDED — CLICK TO RE-ESTABLISH UPLINK</p>
        <div class="iv-deploy-row" style="justify-content:center">
          <button id="resumeBtn" class="iv-btn">RESUME ▸</button>
          <button id="pauseSettingsBtn" class="iv-btn ghost">SETTINGS</button>
          <button id="quitBtn" class="iv-btn ghost">ABORT MISSION</button>
        </div>
      </div>
    `;
    this.container.appendChild(pause);
    this.screens.set('pause', pause);

    // ---- settings ---------------------------------------------------------
    const settingsScreen = div('settings', 'iv-screen');
    settingsScreen.innerHTML = `
      <div class="iv-scan"></div>
      <div class="iv-center" style="width:min(900px,94vw)">
        <h2 class="display" style="font-size:32px;letter-spacing:.2em">FIELD CONFIGURATION</h2>
        <p>APPLIED IMMEDIATELY — STORED LOCALLY</p>
        <div class="iv-settings" id="settingsFields"></div>
        <div class="iv-deploy-row" style="justify-content:center;margin-top:26px">
          <button id="settingsBackBtn" class="iv-btn">BACK ▸</button>
        </div>
      </div>
    `;
    this.container.appendChild(settingsScreen);
    this.screens.set('settings', settingsScreen);

    // ---- failure ----------------------------------------------------------
    const dead = div('dead', 'iv-screen');
    dead.innerHTML = `
      <div class="iv-scan"></div>
      <div class="iv-center">
        <h2 class="display">K.I.A.</h2>
        <div class="iv-sub">TASK FORCE 27 — SIGNAL LOST</div>
        <div class="iv-stats">
          <div><div class="v" id="dKills">0</div><div class="k">KILLS</div></div>
          <div><div class="v" id="dWave">1</div><div class="k">WAVE REACHED</div></div>
          <div><div class="v" id="dAcc">0%</div><div class="k">ACCURACY</div></div>
          <div><div class="v" id="dScore">0</div><div class="k">SCORE</div></div>
        </div>
        <div class="iv-deploy-row" style="justify-content:center">
          <button id="respawnBtn" class="iv-btn">REDEPLOY ▸</button>
          <button id="deadQuitBtn" class="iv-btn ghost">MAIN MENU</button>
        </div>
      </div>
    `;
    this.container.appendChild(dead);
    this.screens.set('dead', dead);

    // ---- debrief ----------------------------------------------------------
    const win = div('win', 'iv-screen');
    win.innerHTML = `
      <div class="iv-scan"></div>
      <div class="iv-center">
        <h2 class="display">MISSION<br>ACCOMPLISHED</h2>
        <div class="iv-sub">EXTRACTION CONFIRMED — PLAZA HELD</div>
        <div id="rankBox">S</div>
        <div class="iv-stats">
          <div><div class="v" id="wKills">0</div><div class="k">KILLS</div></div>
          <div><div class="v" id="wHs">0</div><div class="k">HEADSHOTS</div></div>
          <div><div class="v" id="wAcc">0%</div><div class="k">ACCURACY</div></div>
          <div><div class="v" id="wTime">0:00</div><div class="k">MISSION TIME</div></div>
        </div>
        <div class="iv-deploy-row" style="justify-content:center">
          <button id="againBtn" class="iv-btn">PLAY AGAIN ▸</button>
          <button id="winQuitBtn" class="iv-btn ghost">MAIN MENU</button>
        </div>
      </div>
    `;
    this.container.appendChild(win);
    this.screens.set('win', win);

    // ---- wiring -----------------------------------------------------------
    this.difficulty = menu.querySelector<HTMLSelectElement>('#difficulty')!;
    this.difficulty.value = this.settings.difficultyId;
    this.difficulty.addEventListener('change', () => {
      this.settings = { ...this.settings, difficultyId: this.difficulty.value };
      this.callbacks.onSettingsChange(this.settings);
    });

    // The atmosphere is chosen *before* deploying — the review asked for both the
    // morning and the dusk scene and for the player to pick one — and it is also a
    // settings field, so the two controls are kept in step by `setSettings`.
    this.timeOfDay = menu.querySelector<HTMLSelectElement>('#timeOfDay')!;
    this.timeOfDay.value = this.settings.timeOfDay;
    this.timeOfDay.addEventListener('change', () => {
      this.settings = { ...this.settings, timeOfDay: this.timeOfDay.value as 'dawn' | 'dusk' };
      this.callbacks.onSettingsChange(this.settings);
    });

    menu.querySelector('#deployBtn')!.addEventListener('click', () => {
      this.callbacks.onDeploy(this.difficulty.value);
    });
    menu.querySelector('#settingsBtn')!.addEventListener('click', () => this.showSettings());
    pause.querySelector('#resumeBtn')!.addEventListener('click', () => this.callbacks.onResume());
    pause.querySelector('#pauseSettingsBtn')!.addEventListener('click', () => this.showSettings());
    pause.querySelector('#quitBtn')!.addEventListener('click', () => this.callbacks.onQuit());
    settingsScreen
      .querySelector('#settingsBackBtn')!
      .addEventListener('click', () => this.hideSettings());
    dead.querySelector('#respawnBtn')!.addEventListener('click', () => this.callbacks.onRestart());
    dead.querySelector('#deadQuitBtn')!.addEventListener('click', () => this.callbacks.onQuit());
    win.querySelector('#againBtn')!.addEventListener('click', () => this.callbacks.onRestart());
    win.querySelector('#winQuitBtn')!.addEventListener('click', () => this.callbacks.onQuit());

    this.buildSettingsFields(settingsScreen.querySelector('#settingsFields')!);
  }

  private buildSettingsFields(host: HTMLElement): void {
    const add = (
      key: keyof StoredSettings,
      label: string,
      input: HTMLInputElement | HTMLSelectElement,
    ): void => {
      const field = document.createElement('label');
      field.className = 'iv-field';
      field.append(document.createTextNode(label), input);
      host.appendChild(field);
      this.settingsFields.push({ key, input });
      input.addEventListener('input', () => this.commitSettings());
      input.addEventListener('change', () => this.commitSettings());
    };

    const range = (key: keyof StoredSettings, min: number, max: number, step: number): HTMLInputElement => {
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.id = `set_${String(key)}`;
      const value = this.settings[key];
      input.value = String(typeof value === 'number' ? value : 1);
      return input;
    };

    const toggle = (key: keyof StoredSettings): HTMLInputElement => {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = `set_${String(key)}`;
      input.checked = Boolean(this.settings[key]);
      return input;
    };

    add('sensitivity', 'MOUSE SENSITIVITY', range('sensitivity', 0.2, 3, 0.05));
    add('fovScale', 'FIELD OF VIEW', range('fovScale', 0.8, 1.3, 0.05));
    add('motionScale', 'SCREEN MOTION (SHAKE / BOB)', range('motionScale', 0, 1.5, 0.05));
    add('masterVolume', 'MASTER VOLUME', range('masterVolume', 0, 1, 0.05));
    add('sfxVolume', 'SFX VOLUME', range('sfxVolume', 0, 1, 0.05));
    add('musicVolume', 'MUSIC VOLUME', range('musicVolume', 0, 1, 0.05));

    const quality = document.createElement('select');
    quality.id = 'set_quality';
    for (const tier of ['low', 'medium', 'high', 'cinematic']) {
      const option = document.createElement('option');
      option.value = tier;
      option.textContent = tier.toUpperCase();
      quality.appendChild(option);
    }
    quality.value = this.settings.quality;
    add('quality', 'GRAPHICS QUALITY', quality);

    // What the tier buys, and what the frame is actually costing right now. Both
    // lines exist because "turn it down" used to be a choice between identical
    // words with different pictures behind them (ADR-0014).
    const note = document.createElement('div');
    note.className = 'iv-graphics-note';
    note.id = 'graphicsNote';
    host.appendChild(note);
    this.graphicsNote = note;
    const paint = (): void => this.refreshGraphicsNote();
    quality.addEventListener('change', paint);
    quality.addEventListener('input', paint);

    const difficulty = document.createElement('select');
    difficulty.id = 'set_difficultyId';
    for (const def of DIFFICULTIES) {
      const option = document.createElement('option');
      option.value = def.id;
      option.textContent = def.displayName;
      difficulty.appendChild(option);
    }
    difficulty.value = this.settings.difficultyId;
    add('difficultyId', 'DIFFICULTY', difficulty);

    const timeOfDay = document.createElement('select');
    timeOfDay.id = 'set_timeOfDay';
    for (const option of TIME_OF_DAY_OPTIONS) {
      const node = document.createElement('option');
      node.value = option.id;
      node.textContent = option.label;
      timeOfDay.appendChild(node);
    }
    timeOfDay.value = this.settings.timeOfDay;
    add('timeOfDay', 'TIME OF DAY (SKY + KEY LIGHT)', timeOfDay);

    const resolutionMode = document.createElement('select');
    resolutionMode.id = 'set_resolutionMode';
    for (const option of RESOLUTION_OPTIONS) {
      const node = document.createElement('option');
      node.value = option.id;
      node.textContent = option.label;
      resolutionMode.appendChild(node);
    }
    resolutionMode.value = this.settings.resolutionMode;
    add('resolutionMode', 'RENDER RESOLUTION', resolutionMode);

    add('invertY', 'INVERT VERTICAL AIM', toggle('invertY'));
    add('subtitles', 'SUBTITLES', toggle('subtitles'));
    add('colorBlindCrosshair', 'HIGH-CONTRAST CROSSHAIR', toggle('colorBlindCrosshair'));
    add('showFps', 'SHOW FRAME COUNTER', toggle('showFps'));
  }

  /**
   * The live graphics readout: the tier's budget, the resolution in use, and the
   * frame rate that resolution is buying.
   */
  refreshGraphicsNote(): void {
    if (!this.graphicsNote) return;
    const tier = this.settings.quality;
    const note = GRAPHICS_NOTES[tier] ?? '';
    const info = this.callbacks.getRenderInfo?.() ?? null;
    const render = info
      ? `${Math.round(info.scale * 100)}% OF NATIVE${info.scale < 0.995 ? ' (DYNAMIC — RAISES WHEN THE FRAME HAS HEADROOM)' : ''} · ${info.fps} FPS`
      : '';
    this.graphicsNote.innerHTML = `
      <div class="iv-tier-note">${tier.toUpperCase()} — ${note}</div>
      <div class="iv-tier-live">${render}</div>
      <div class="iv-tier-note dim">EVERY LEVEL DRAWS AT 100% OF YOUR DISPLAY'S PIXELS. QUALITY BUYS SHADOWS, OCCLUSION, SAMPLES AND PARTICLES — NEVER SHARPNESS.</div>
    `;
  }

  private commitSettings(): void {
    const next: StoredSettings = { ...this.settings };
    for (const field of this.settingsFields) {
      const input = field.input;
      if (input instanceof HTMLInputElement && input.type === 'checkbox') {
        (next[field.key] as boolean) = input.checked;
      } else if (input instanceof HTMLInputElement && input.type === 'range') {
        (next[field.key] as number) = Number(input.value);
      } else {
        (next[field.key] as string) = input.value;
      }
    }
    next.version = this.settings.version;
    this.settings = next;
    this.difficulty.value = next.difficultyId;
    this.timeOfDay.value = next.timeOfDay;
    this.callbacks.onSettingsChange(next);
  }

  setSettings(settings: StoredSettings): void {
    this.settings = settings;
    // The menu's own copy of the atmosphere, which is edited outside the settings
    // field list (it is on the deploy row).
    if (this.timeOfDay.value !== settings.timeOfDay) this.timeOfDay.value = settings.timeOfDay;
    for (const field of this.settingsFields) {
      const value = settings[field.key];
      const input = field.input;
      if (input instanceof HTMLInputElement && input.type === 'checkbox') {
        input.checked = Boolean(value);
      } else {
        input.value = String(value);
      }
    }
    this.difficulty.value = settings.difficultyId;
  }

  hideAll(): void {
    this.stopGraphicsPoll();
    for (const screen of this.screens.values()) screen.classList.remove('show');
    this.active = null;
  }

  show(name: ScreenName): void {
    this.hideAll();
    this.screens.get(name)?.classList.add('show');
    this.active = name;
  }

  showMenu(): void {
    this.show('menu');
  }

  showPause(): void {
    this.show('pause');
  }

  showSettings(): void {
    this.settingsReturn = this.active === 'pause' ? 'pause' : 'menu';
    this.show('settings');
    this.refreshGraphicsNote();
    // Live while the panel is open, at 4 Hz: a readout that only updated on open
    // would miss exactly the change it exists to explain (the controller reacting to
    // the new preset).
    this.graphicsTimer = window.setInterval(() => this.refreshGraphicsNote(), 250);
  }

  hideSettings(): void {
    this.stopGraphicsPoll();
    this.show(this.settingsReturn);
  }

  private stopGraphicsPoll(): void {
    if (this.graphicsTimer !== null) {
      window.clearInterval(this.graphicsTimer);
      this.graphicsTimer = null;
    }
  }

  /** Which screen the settings panel returns to. */
  private settingsReturn: ScreenName = 'menu';

  showResults(stats: MissionStats, waveReached: number): void {
    this.show('dead');
    this.text('#dKills', String(stats.kills));
    this.text('#dWave', String(waveReached));
    this.text('#dAcc', `${Math.round(stats.accuracyPercent)}%`);
    this.text('#dScore', String(stats.score));
  }

  showVictory(stats: MissionStats, rank: RankDef, seconds: number): void {
    this.show('win');
    this.text('#rankBox', rank.id);
    this.text('#wKills', String(stats.kills));
    this.text('#wHs', String(stats.headshots));
    this.text('#wAcc', `${Math.round(stats.accuracyPercent)}%`);
    const minutes = Math.floor(seconds / 60);
    this.text('#wTime', `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`);
  }

  private text(selector: string, value: string): void {
    const node = this.container.querySelector(selector);
    if (node) node.textContent = value;
  }

  get isVisible(): ScreenName | null {
    return this.active;
  }
}
