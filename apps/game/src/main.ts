/**
 * Composition root.
 *
 * Wires the simulation, renderer, UI and audio together. The only rule that
 * matters here: the app reads simulation state and pushes commands in — it never
 * mutates the world directly, so replays and the golden tests stay meaningful.
 */
import '@iron/ui/theme.css';
import {
  CommandQueue,
  buildStats,
  createWorld,
  currentObjective,
  rankLabel,
  snapshotCheckpoint,
  spreadNow,
  stepWorld,
  type StoredSettings,
  type World,
} from '@iron/sim';
import { getMap, getMission, getWeapon } from '@iron/content';
import {
  GameRenderer,
  ModelLibrary,
  parseModelManifest,
  type QualityTier,
} from '@iron/render';
import assetManifest from '../../../assets/manifest.json';
import { Hud, Screens } from '@iron/ui';
import { AudioSystem } from '@iron/audio';
import { DEG2RAD, FixedStepClock, TICK_DT } from '@iron/core';
import { installDebugApi } from './debugApi';
import { InputManager } from './input';
import { PointerLockController } from './pointerLock';
import { readSettings, writeSettings } from './settings';

type GameState = 'menu' | 'playing' | 'paused' | 'dead' | 'victory';

const params = new URLSearchParams(window.location.search);
const MISSION_ID = params.get('mission') ?? 'm00_prologue';
const seedFromUrl = Number(params.get('seed'));
const SEED = Number.isFinite(seedFromUrl) && seedFromUrl > 0 ? seedFromUrl : (Date.now() % 100000) + 1;
const AUTOSTART = params.get('autostart') === '1';
const LOCK_DISABLED = params.get('lock') === 'off';

const settingsRef: { current: StoredSettings } = { current: readSettings() };
const mission = getMission(MISSION_ID);
const map = getMap(mission.mapId);
const weapon = getWeapon(mission.startingWeapon);

const appRoot = document.getElementById('app')!;
const uiRoot = document.getElementById('ui')!;
const canvas = document.createElement('canvas');
canvas.id = 'viewport';
appRoot.appendChild(canvas);

let currentSeed = SEED;
let world: World = createWorld({
  seed: currentSeed,
  missionId: mission.id,
  difficultyId: settingsRef.current.difficultyId,
});

// Optional downloaded models (docs/LICENSING.md). The manifest is bundled, the
// GLBs are fetched: a missing file logs and falls back to the procedural build, so
// the product never depends on a binary being deployed next to it.
const { manifest: modelManifest, issues: manifestIssues } = parseModelManifest(assetManifest);
const models = await ModelLibrary.load(modelManifest, import.meta.env.BASE_URL, {
  onIssue: (message) => console.warn(`[models] ${message}`),
});
if (manifestIssues.length > 0) console.warn('[models] manifest issues:', manifestIssues);

const renderer = new GameRenderer({
  canvas,
  map,
  weapon,
  quality: settingsRef.current.quality,
  motionScale: settingsRef.current.motionScale,
  fovScale: settingsRef.current.fovScale,
  timeOfDay: settingsRef.current.timeOfDay,
  resolutionMode: settingsRef.current.resolutionMode,
  seed: currentSeed,
  models,
});

const hud = new Hud(uiRoot, {
  colorBlindCrosshair: settingsRef.current.colorBlindCrosshair,
  showFps: settingsRef.current.showFps,
  motionScale: settingsRef.current.motionScale,
});
hud.setWeaponName(weapon.hudName);

const audio = new AudioSystem();
const queue = new CommandQueue();
const clock = new FixedStepClock();

let state: GameState = 'menu';
/**
 * Capture freeze: the simulation stops stepping while rendering continues.
 *
 * The image tools need a scene that holds perfectly still for a few frames, or a
 * probe samples a pixel that has already walked away (an enemy covers 2 m/s). Only
 * `window.__IV__` may set this (docs/decisions/0009-debug-api-contract.md).
 */
let simFrozen = false;
let lastCheckpoint: ReturnType<typeof snapshotCheckpoint> | null = null;
let lowHealthTimer = 0;
let ambientCueTimer = 3 + Math.random() * 4;
let errorShown = false;
let menuTime = 0;
let lastFrame = performance.now();

const screens = new Screens(uiRoot, mission, settingsRef.current, {
  onDeploy: (difficultyId) => startMission({ difficultyId }),
  onResume: () => {
    screens.hideAll();
    state = 'playing';
    hud.show();
    if (!LOCK_DISABLED) pointerLock.request();
  },
  onRestart: () => startMission({}),
  onQuit: () => {
    screens.hideAll();
    screens.showMenu();
    hud.hide();
    state = 'menu';
    renderer.resetTransient();
    pointerLock.exit();
  },
  onSettingsChange: (next) => applySettings(next),
  // The settings panel reports the *observed* resolution and frame rate rather
  // than the preset that was asked for, which is the point of the readout: if the
  // adaptive controller has traded resolution for frame rate, the panel says so.
  getRenderInfo: () => ({
    tier: renderer.info.quality,
    scale: renderer.info.resolutionScale,
    fps: renderer.info.fps,
  }),
});

const pointerLock = new PointerLockController({
  canvas,
  onLockLost: () => {
    if (state === 'playing') pauseMission();
  },
  onFallbackEntered: () => {
    if (state === 'playing') hud.feed('<b>FALLBACK</b> MOUSE-LOOK ACTIVE');
  },
});

const input = new InputManager({
  queue,
  getSettings: () => settingsRef.current,
  isActive: () => state === 'playing',
  shouldUsePointerLock: () => pointerLock.mode === 'fallback',
  onEscape: () => {
    if (state === 'playing') pauseMission();
    else if (state === 'paused') screens.showPause();
  },
  canvas,
});
input.attach();

canvas.addEventListener('click', () => {
  if (state === 'playing' && !LOCK_DISABLED && !pointerLock.locked) pointerLock.request();
});

window.addEventListener('resize', () => {
  renderer.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
});

window.addEventListener('error', (event) => {
  hud.toast(`ENGINE FAULT: ${event.message}`);
});

installDebugApi({
  getWorld: () => world,
  getRenderer: () => renderer,
  getGameState: () => state,
  getSeed: () => currentSeed,
  setQuality: (tier: QualityTier) => {
    applySettings({ ...settingsRef.current, quality: tier });
  },
  setTimeOfDay: (next) => applySettings({ ...settingsRef.current, timeOfDay: next }),
  setResolutionMode: (next) => applySettings({ ...settingsRef.current, resolutionMode: next }),
  restart: (options) => startMission({ seed: options?.seed }),
  setFrozen: (frozen: boolean) => {
    simFrozen = frozen;
  },
  getModels: () => models,
});

// ---------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------

function applySettings(next: StoredSettings): void {
  const previous = settingsRef.current;
  settingsRef.current = next;
  writeSettings(next);
  if (next.quality !== previous.quality) renderer.setQuality(next.quality);
  // The atmosphere is a scene rather than a budget, so it is applied to the renderer
  // the same way a tier is — and it can be changed from the settings panel mid-mission,
  // which is what makes "the morning plaza" something a player can look at without
  // reloading.
  if (next.timeOfDay !== previous.timeOfDay) renderer.setTimeOfDay(next.timeOfDay);
  // Same reason as the atmosphere: a resolution mode is a *renderer* setting, and the
  // settings object is the app's copy of it. Defaulting to native on the way in is what
  // keeps a saved profile from silently upscaling the game on a new machine.
  if (next.resolutionMode !== previous.resolutionMode) renderer.setResolutionMode(next.resolutionMode);
  // Settings can arrive from the debug API as well as from the panel, so reflect
  // them back into the panel's controls and its graphics readout.
  screens.setSettings(next);
  screens.refreshGraphicsNote();
  renderer.setMotionScale(next.motionScale);
  audio.applySettings({
    masterVolume: next.masterVolume,
    sfxVolume: next.sfxVolume,
    musicVolume: next.musicVolume,
  });
  hud.applyOptions({
    colorBlindCrosshair: next.colorBlindCrosshair,
    showFps: next.showFps,
    motionScale: next.motionScale,
  });
}

function startMission(options: { seed?: number; difficultyId?: string }): void {
  audio.init({
    masterVolume: settingsRef.current.masterVolume,
    sfxVolume: settingsRef.current.sfxVolume,
    musicVolume: settingsRef.current.musicVolume,
  });
  if (options.seed !== undefined) currentSeed = options.seed;
  if (options.difficultyId) settingsRef.current = { ...settingsRef.current, difficultyId: options.difficultyId };
  world = createWorld({
    seed: currentSeed,
    missionId: mission.id,
    difficultyId: settingsRef.current.difficultyId,
  });
  renderer.resetTransient();
  screens.hideAll();
  hud.show();
  // The weapon the *world* opened with, not the mission's declared one: the loadout is
  // content and the world builds it, so a mission that started on a different slot
  // would otherwise show the wrong name and the wrong gun.
  const opening = getWeapon(world.player.weapon.defId);
  renderer.setWeapon(opening);
  hud.setWeaponName(opening.hudName);
  queue.startRecording();
  state = 'playing';
  clock.reset();
  lastCheckpoint = null;
  hud.banner(mission.codename, mission.subtitle, false);
  hud.subtitle(mission.brief[0] ?? null);
  window.setTimeout(() => hud.fadeHint(), 9000);
  if (!LOCK_DISABLED) pointerLock.request();
  else pointerLock.enterFallback();
}

function pauseMission(): void {
  state = 'paused';
  screens.showPause();
  pointerLock.exit();
  queue.push(0, { type: 'fire', held: false });
  queue.push(0, { type: 'aim', held: false });
}

function endMission(outcome: 'dead' | 'victory'): void {
  // Idempotent on purpose: it can be reached from the event queue and from the
  // frame-loop check below, whichever notices first.
  if (state === 'dead' || state === 'victory') return;
  state = outcome;
  pointerLock.exit();
  hud.hide();
  const stats = buildStats(world);
  if (outcome === 'dead') {
    audio.play('stinger_failure');
    screens.showResults(stats, Math.max(1, world.wave));
    if (lastCheckpoint) hud.toast(`CHECKPOINT AVAILABLE — WAVE ${lastCheckpoint.wave}`);
  } else {
    audio.play('stinger_victory');
    screens.showVictory(stats, { id: rankLabel(stats), label: 'COMBAT RATING', minScore: 0, minAccuracy: 0 }, stats.elapsedTicks * TICK_DT);
  }
}

function objectiveText(): string {
  if (world.missionComplete) return 'MISSION COMPLETE — EXTRACTION CONFIRMED';
  if (!world.waveActive && world.intermissionTicks > 0 && world.wave > 0) {
    return `NEXT WAVE IN ${Math.ceil(world.intermissionTicks / 60)} — RESUPPLY RECEIVED`;
  }
  const objective = currentObjective(world);
  if (!objective) return '';
  if (objective.def.kind === 'survive') {
    return `WAVE ${Math.max(1, world.wave)}/${world.waves.length} — ${objective.def.hudText}`;
  }
  return `${objective.def.label} — ${objective.def.hudText}`;
}

// ---------------------------------------------------------------------------
// Event plumbing
// ---------------------------------------------------------------------------

function listenerPosition(): { x: number; z: number; yaw: number } {
  return { x: world.player.pos.x, z: world.player.pos.z, yaw: world.player.yaw };
}

function handleEvents(): void {
  for (const event of world.events) {
    switch (event.type) {
      case 'audio':
        audio.play(event.cue, event.pos, event.volume, listenerPosition());
        break;
      case 'shot':
        break;
      case 'weaponChanged': {
        // The one place the view model's weapon changes. The simulation owns *which*
        // weapon is in hand (packages/sim), this rebuilds the model for it, and the HUD
        // re-labels itself from the same content def — so the name on screen and the gun
        // on screen can never disagree.
        const def = getWeapon(event.weaponId);
        // Idempotent: the debug API's `equip` rebuilds the model itself (a capture can
        // swap weapons with the simulation frozen, where this handler never runs), so
        // the check is what keeps a swap from building the same model twice.
        if (renderer.weaponId !== def.id) renderer.setWeapon(def);
        hud.setWeaponName(def.hudName);
        hud.feed(`<b>${event.slot} ▸</b> ${def.displayName.toUpperCase()}`);
        break;
      }
      case 'enemyDamaged':
        hud.hitmarker(false);
        audio.play('hit_confirm', undefined, 1, listenerPosition());
        break;
      case 'enemyKilled': {
        const head = event.head ? ' <b>· HEADSHOT</b>' : '';
        hud.feed(`<b>YOU ▸</b> ${event.displayName}${head}  +${event.score}`);
        hud.hitmarker(true);
        audio.play('hit_kill', undefined, 1, listenerPosition());
        break;
      }
      case 'playerDamaged':
        // Small on purpose: under sustained fire a full-screen white flash fires
        // several times a second and washes the whole image out.
        hud.flash(0.12);
        break;
      case 'explosion':
        hud.flash(0.45);
        break;
      case 'resupply':
        hud.feed(`<b>RESUPPLY</b> AMMUNITION +${event.reserveAmmo} · FRAG +${event.grenades}`);
        break;
      case 'pickupCollected':
        hud.feed(
          event.kind === 'medkit'
            ? `<b>+${event.amount}</b> FIELD MEDKIT`
            : `<b>+${event.amount}</b> AMMUNITION`,
        );
        break;
      case 'banner':
        hud.banner(event.title, event.subtitle, event.small);
        break;
      case 'waveStart':
        hud.subtitle(event.subtitle);
        break;
      case 'objective':
        if (event.state === 'active' && settingsRef.current.subtitles) hud.subtitle(event.hudText);
        break;
      case 'checkpoint':
        lastCheckpoint = snapshotCheckpoint(world);
        hud.toast(`CHECKPOINT SAVED — WAVE ${event.wave}`);
        break;
      case 'missionComplete':
        endMission('victory');
        break;
      case 'playerDied':
        hud.banner('K.I.A.', 'TASK FORCE 27 — SIGNAL LOST', false);
        break;
      case 'missionFailed':
        endMission('dead');
        break;
      default:
        break;
    }
  }
}

/** Audio-only ambience; intentionally outside the simulation (not gameplay state). */
function ambientAudio(dt: number): void {
  const player = world.player;
  if (player.health > 0 && player.health < 25) {
    lowHealthTimer -= dt;
    if (lowHealthTimer <= 0) {
      lowHealthTimer = 1.1; // parity
      audio.play('player_heartbeat');
    }
  }
  ambientCueTimer -= dt;
  if (ambientCueTimer <= 0) {
    ambientCueTimer = 6 + Math.random() * 3;
    audio.play(Math.random() < 0.5 ? 'ambient_rumble' : 'enemy_radio', undefined, 0.5, listenerPosition());
  }
}

// ---------------------------------------------------------------------------
// Frame loop
// ---------------------------------------------------------------------------

function frame(now: number): void {
  const dt = Math.min((now - lastFrame) / 1000, 0.25);
  lastFrame = now;
  menuTime += dt;

  try {
    if (state === 'playing') {
      input.pumpMovement();
      if (simFrozen) {
        // Input is still drained (so queued commands cannot pile up) but the tick
        // loop is skipped: a capture probe needs the composition to hold still.
        queue.drain();
      } else {
        const steps = clock.advance(dt);
        for (let i = 0; i < steps; i++) {
          const { input: simInput, actions } = queue.drain();
          renderer.capturePrevious(world);
          stepWorld(world, simInput, actions);
          renderer.consumeEvents(world);
          handleEvents();
        }
      }
      // While frozen the render pose is snapped to the world pose (alpha 1): the
      // probe is capturing a still, not an interpolation of two ticks.
      renderer.syncWorld(world, simFrozen ? 1 : clock.alpha, dt);

      // Terminal state is polled as well as observed through events. Events only
      // exist for the tick that produced them, so anything that sets the flags
      // from outside the tick loop (the debug API, a future console command)
      // would otherwise leave the UI stuck on a dead player.
      if (world.missionFailed) endMission('dead');
      else if (world.missionComplete) endMission('victory');

      const cameraHeight = window.innerHeight;
      const spreadPx =
        (spreadNow(world) * (cameraHeight / 2)) /
        Math.tan(((renderer.camera.fov * DEG2RAD) / 2) || 0.5);
      hud.update(world, {
        fps: renderer.info.fps,
        spreadPx,
        objectiveText: objectiveText(),
        renderScale: renderer.info.resolutionScale,
      });
      ambientAudio(dt);
    } else if (state === 'menu') {
      const t = menuTime * 0.06;
      renderer.camera.position.set(Math.sin(t) * 36, 2.4, Math.cos(t) * 36);
      renderer.camera.lookAt(0, 1.6, 0);
    }
  } catch (error) {
    if (!errorShown) {
      errorShown = true;
      hud.toast(`RUNTIME FAULT (game continues): ${(error as Error).message}`);
    }
  }

  renderer.render(dt);
  audio.update(dt);
  window.requestAnimationFrame(frame);
}

renderer.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
screens.showMenu();
window.requestAnimationFrame(frame);
if (AUTOSTART) startMission({});
