/**
 * GameRenderer — the single place where simulation state becomes pixels.
 *
 * It owns no gameplay state: `syncWorld` reads, `consumeEvents` reacts to the
 * tick's event list, `render` draws. Anything that needs to change game state
 * goes back through the command queue in apps/game, never through here.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { createLookPass, LOOK, type LookPass } from './post/look';
import { AoPass, type AoOptions, type AoOutput } from './post/ao';
import { lerp, shortestAngle, TICK_DT, type Vec3 } from '@iron/core';
import { getSurface, type MapDef, type WeaponDef } from '@iron/content';
import type { EnemyState, World } from '@iron/sim';
import { EnemyViewPool } from './characters/enemyView';
import { CameraRig } from './cameraRig';
import { buildArena, LAMP_GLOW_OPACITY, type ArenaRuntime } from './level/arena';
import {
  createLighting,
  createSkyEnvironment,
  LIGHTING,
  type LightGroup,
  type LightingRig,
} from './level/lighting';
import {
  WEATHERED_MATERIALS,
  applyWeathering,
  createMaterials,
  disposeMaterials,
  type Materials,
} from './materials/materials';
import type { Weathering } from './materials/surfaces';
import { DEFAULT_TIME_OF_DAY, TIME_PRESETS, timePreset, type TimeOfDay } from './level/timeOfDay';
import { createTextures, type TextureLibrary } from './materials/textures';
import { disposeGeometryCache } from './geometry';
import { emptyModelLibrary, type ModelLibrary } from './assets/models';
import { DecalSystem } from './fx/decals';
import { ExplosionFactory } from './fx/explosions';
import { ParticleSystem } from './fx/particles';
import { CasingSystem, TracerPool } from './fx/tracers';
import {
  AdaptiveResolution,
  DEFAULT_RESOLUTION_MODE,
  fullResPasses,
  postChain,
  QUALITY_PRESETS,
  SHARPEN_BELOW_SCALE,
  SHARPEN_STRENGTH,
  type QualitySettings,
  type QualityTier,
  type ResolutionMode,
} from './quality';
import { createViewModel, type ViewModel, type ViewModelPose } from './viewmodel';
import { createWeaponMaterials, type WeaponMaterials } from './materials/weapon';

interface Pose {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface RendererOptions {
  canvas: HTMLCanvasElement;
  map: MapDef;
  weapon: WeaponDef;
  quality: QualityTier;
  motionScale: number;
  fovScale: number;
  seed: number;
  /**
   * Which atmosphere to open in. Dusk when omitted: that is the rig the lighting
   * pass was tuned against, and the morning is a choice, not a new default.
   */
  timeOfDay?: TimeOfDay;
  /**
   * Whether the frame may trade resolution for frame rate. Native when omitted (see
   * `ResolutionMode`): a silent resolution cut is indistinguishable from a blurry game.
   */
  resolutionMode?: ResolutionMode;
  /** Optional downloaded models; the procedural baseline is used for any gap. */
  models?: ModelLibrary;
}

interface EnemyRenderPose {
  enemy: EnemyState;
  x: number;
  z: number;
  yaw: number;
}

export interface RendererInfo {
  drawCalls: number;
  triangles: number;
  programs: number;
  fps: number;
  frameMs: number;
  resolutionScale: number;
  particles: number;
  enemies: number;
  quality: QualityTier;
}

export class GameRenderer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly rig: CameraRig;

  private readonly textures: TextureLibrary;
  private readonly materials: Materials;
  /**
   * The view model's own material set: tiled per world metre, so the weapon's
   * density is a property of the weapon rather than of whatever mesh it lands on
   * (see materials/weapon.ts). Owned here because the renderer owns disposal.
   */
  private readonly weaponMaterials: WeaponMaterials;
  private readonly lighting: LightingRig;
  private readonly arena: ArenaRuntime;
  private readonly enemies: EnemyViewPool;
  private readonly particles: ParticleSystem;
  private readonly playerTracers: TracerPool;
  private readonly enemyTracers: TracerPool;
  private readonly casings: CasingSystem;
  private readonly decals: DecalSystem;
  private readonly explosions: ExplosionFactory;
  private viewModel: ViewModel;
  /** The reflected-sky cubemap (rebuilt when the atmosphere changes). */
  private environment: THREE.Texture;
  private readonly models: ModelLibrary;
  private quality: QualitySettings;
  private composer: EffectComposer | null = null;
  /** Grade pass (+ upscale compensation), kept for the debug A/B (`setGradeEnabled`). */
  private look: LookPass | null = null;
  private ao: AoPass | null = null;
  private aoOptions: AoOptions;
  /** Set by the adaptive controller; consumed at the top of the next frame. */
  private resolutionDirty = false;
  /** The upscale compensation currently applied by the look pass (0 = native). */
  private sharpenAmount = 0;
  private contextLost = false;
  /**
   * Captures need a stable weapon pose (ADS, mid-reload, sprint) on a frozen
   * simulation, so the render surface takes an explicit override. Null means
   * "follow the simulation". See docs/decisions/0009-debug-api-contract.md.
   */
  private viewModelOverride: Partial<ViewModelPose> | null = null;
  /** Deterministic seed for the muzzle flash, so captures reproduce frame for frame. */
  private flashSeed = 0x9e3779b9;

  private readonly adaptive = new AdaptiveResolution(16.7, 0.85, () => {
    this.resolutionDirty = true;
  });
  private readonly fovScale: number;

  private previous: Pose = { x: 0, z: 0, yaw: 0, pitch: 0 };
  private readonly previousEnemies = new Map<number, Pose>();
  private readonly pickupMeshes: THREE.Mesh[] = [];
  private readonly grenadeMeshes: THREE.Mesh[] = [];
  private muzzleTimer = 0;
  private boomTimer = 0;
  private fpsAccumulator = 0;
  private fpsFrames = 0;
  private fps = 0;
  private frameMs = 0;
  private ambientFireTimer = 0;
  private ambientSmokeTimer = 0;
  /**
   * Holds every renderer-side transient still (particles, tracers, casings,
   * decals, explosions, ambient fire and smoke) while captures are taken.
   *
   * Freezing the simulation is not enough to make two captures comparable: the
   * FX systems are driven by frame delta and by `Math.random`, so an effect A/B
   * measured with live particles differs by ~4.7 luma of moving ash and smoke
   * *independently of the effect being measured* — which is how a "70% darkening"
   * at a wall base almost got attributed to ambient occlusion.
   */
  private fxFrozen = false;
  private cameraLight: THREE.PointLight; // muzzle flash, attached to the camera
  /**
   * The view-model key light (ADR-0016).
   *
   * A first-person weapon sits 40-60 cm from the eye, inside a night scene lit by a
   * moon three hundred times further away than the object it is meant to reveal.
   * Left to the world rig, the receiver, both gloves and both sleeves measured as a
   * single black silhouette — the review's "there are no hands" report, which was a
   * lighting bug wearing a modelling bug's clothes. A short-reach light attached to
   * the camera is the standard answer, and `distance` is what keeps it honest: 2 m
   * of reach lights the weapon and the hands and nothing else in the frame.
   *
   * Intensity is candela, so 1.2 cd is ~6 lux on a handguard 0.45 m away — a stop
   * under the moonlight that falls on the street beyond it, i.e. a fill, not a lamp.
   */
  private readonly viewLight: THREE.PointLight;
  /** The atmosphere currently running (level/timeOfDay.ts). */
  private currentTimeOfDay: TimeOfDay;
  /** Whether the controller may trade resolution (`native` by default, ADR-0016). */
  private resolutionMode: ResolutionMode;
  /** The map's own haze density, before the atmosphere scales it. */
  private readonly fogDensity: number;
  /** Seconds until the window-light pool is re-ranked (see syncWorld). */
  private windowLightTimer = 0;
  private time = 0;

  constructor(options: RendererOptions) {
    this.quality = QUALITY_PRESETS[options.quality];
    this.aoOptions = aoOptionsFromQuality(this.quality);
    this.currentTimeOfDay = options.timeOfDay ?? DEFAULT_TIME_OF_DAY;
    this.resolutionMode = options.resolutionMode ?? DEFAULT_RESOLUTION_MODE;
    this.fogDensity = options.map.ambient.fogDensity;
    const atmosphere = timePreset(this.currentTimeOfDay);
    // The tier's floor has to be applied here as well as in `setQuality`, or the
    // starting tier runs at the previous tier's (or the default's) floor.
    this.adaptive.setFloor(this.quality.adaptiveFloor);
    // Applied here rather than only from `setResolutionMode`, because the starting
    // mode is the shipped one: native. Otherwise the first frames of a mission would
    // run with the controller free and could cut resolution before the app has said a
    // word about it.
    this.adaptive.lock(this.resolutionMode === 'native' ? 1 : null);
    this.fovScale = options.fovScale;
    this.models = options.models ?? emptyModelLibrary();

    this.renderer = new THREE.WebGLRenderer({
      canvas: options.canvas,
      // Canvas MSAA is *not* the answer here: every frame goes through the
      // composer, so geometry is drawn into its render target and a multisampled
      // default framebuffer never sees the scene. The MSAA lives on that target
      // instead (`buildComposer`), where it actually applies. This flag used to be
      // `quality.antialias === 'none'` — inverted, and pointless either way.
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace; // r152+: was outputEncoding
    // AgX over ACESFilmic: ACES desaturates and compresses warm midtones toward
    // the beige the art review kept flagging, and it has no shoulder for the
    // street lamps. AgX keeps highlight colour and shadow separation, and the look
    // pass (post/look.ts) prints it.
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = LOOK.exposure * atmosphere.exposureScale;
    this.renderer.shadowMap.enabled = this.quality.shadows;
    // r186 removed PCFSoftShadowMap: WebGLShadowMap coerces it to PCFShadowMap and
    // warns. The softness knob is `shadow.radius` (set in level/lighting.ts).
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    // Cooled and thinned from the prototype's warm beige (legacy/PARITY_NOTES.md):
    // the haze was doing most of the "everything is one brightness band" work.
    this.scene.fog = new THREE.FogExp2(
      atmosphere.fog.color,
      this.fogDensity * LOOK.fogDensityScale * atmosphere.fog.densityScale,
    );
    this.camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.08, 900);
    this.scene.add(this.camera);
    // Short reach on purpose: a muzzle flash that lights the far side of the
    // street is a bug, not drama. It is the brightest light per square metre in
    // the scene for about 40 ms, which is exactly how the reference behaves.
    this.cameraLight = new THREE.PointLight(LIGHTING.muzzle, 0, this.quality.muzzleLightRange, 2);
    this.camera.add(this.cameraLight);
    this.cameraLight.position.set(0.26, -0.12, -1.25);

    //
    // The intensity has now been wrong in both directions, which is why the number and
    // its arithmetic are written down here. 1.2 cd (ADR-0017's starting point) is 6 lux
    // on a handguard 45 cm away — a *fill*, and one that left the support glove reading
    // as part of the weapon. 2.6 cd fixed that and broke the other end: 17 lux on the
    // receiver is 6.5x the moon key (2.6 lux), so every highlight the light touched
    // clipped to white in the HDR buffer and then bloomed across the frame — the sixth
    // report's "washed out, glowing, the brightness spreads over the whole screen".
    //
    // **1.1 cd is 7 lux there, ~2.7x the key on the street behind it**: the knuckles,
    // the wrist and the sling loop still have their own value (which is what makes a
    // man holding a gun, and is what the previous fix was for), and a highlight is
    // light *on a surface* rather than brightness in the air. The tone curve and the
    // exposure are untouched — the fix is this number plus the weapon's specular lobe
    // (`materials/weapon.ts`), not a darker scene.
    this.viewLight = new THREE.PointLight(0xffe8cf, 1.1, 2.0, 2);
    // Just above and to the right of the receiver, i.e. from the shooter's own
    // shoulder: the direction that lets the optic's tube, the charging handle and
    // the glove's knuckles all read in one frame. One light, not two — the forward
    // renderer evaluates every light for every fragment of the whole scene, so a
    // second view light would cost the frame for the sake of one glove.
    this.viewLight.position.set(0.3, 0.18, 0.02);
    this.camera.add(this.viewLight);

    this.textures = createTextures(options.seed);
    this.materials = createMaterials(this.textures);
    this.lighting = createLighting(this.scene, options.map, this.quality, options.timeOfDay);
    // (the moon's sprite is created by createLighting, which owns the sky: a second
    // call here drew the same disc twice, twice as bright.)

    // Image-based lighting from the procedural sky: metals reflect the horizon
    // instead of a flat grey, which is most of what separates "realistic" from
    // "cartoon" in a scene lit like this. It is also the reflected-light term: on
    // this budget the bounce *is* the sky, measured in one cubemap rather than in
    // a second bounce pass (ADR-0013).
    this.environment = createSkyEnvironment(this.renderer, this.currentTimeOfDay);
    this.scene.environment = this.environment;
    this.scene.environmentIntensity =
      this.quality.environmentIntensity * atmosphere.environmentScale;
    this.arena = buildArena(options.map, this.materials, this.textures, this.quality, options.seed, this.models);
    this.scene.add(this.arena.group);
    // After the arena, not with the materials: the emissive props include the lamp
    // halo sprites the arena owns (see `applyGlow`).
    this.applyGlow();
    // The hour the build starts in has to weather the world too, not only a switch do it:
    // the default is the damp end of a night, and a player who never opens the settings
    // screen must still be standing on a road that holds a lamp's reflection (ADR-0020).
    applyWeathering(this.materials, atmosphere.weather);

    this.enemies = new EnemyViewPool(this.scene, this.textures, this.materials, this.models);
    this.particles = new ParticleSystem(this.textures, this.quality.maxParticles);
    this.scene.add(this.particles.group);
    this.playerTracers = new TracerPool(26, 0xffd98c); // parity
    this.enemyTracers = new TracerPool(40, 0xff6a3c); // parity
    this.scene.add(this.playerTracers.group, this.enemyTracers.group);
    this.casings = new CasingSystem(14); // parity
    this.scene.add(this.casings.group);
    this.decals = new DecalSystem(this.textures, this.quality.maxDecals);
    this.scene.add(this.decals.group);
    this.explosions = new ExplosionFactory(this.particles, this.decals, this.textures);
    this.explosions.onFlash = (pos, radius) => {
      this.lighting.boom.position.set(pos.x, pos.y + 1.5, pos.z);
      this.lighting.boom.intensity = 400 * (radius / 6);
      this.boomTimer = 0.5;
      this.rig.addShake(0.9);
    };
    this.scene.add(this.explosions.group);

    this.weaponMaterials = createWeaponMaterials(this.textures);
    this.viewModel = this.buildViewModel(options.weapon);
    this.rig = new CameraRig(this.camera, options.motionScale);

    // A lost context is a black screen until the browser restores it. Preventing
    // the default handler is what *allows* restoration, and rebuilding the
    // composer afterwards is what makes the recovery complete (the old render
    // targets belong to the dead context).
    options.canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.contextLost = true;
    });
    options.canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      const size = this.renderer.getSize(new THREE.Vector2());
      this.buildComposer();
      this.resize(size.x, size.y, window.devicePixelRatio || 1);
    });

    this.resize(
      options.canvas.clientWidth || 1280,
      options.canvas.clientHeight || 720,
      Math.min(window.devicePixelRatio || 1, this.quality.pixelRatioCap),
    );
  }

  // -- lifecycle ------------------------------------------------------------

  /** Build the view model for a weapon (the constructor and `setWeapon` share it). */
  private buildViewModel(def: WeaponDef): ViewModel {
    return createViewModel(def, this.camera, this.textures, this.weaponMaterials, this.models);
  }

  /**
   * Swap the first-person weapon, for the 1/2/3 loadout.
   *
   * The model is rebuilt rather than pre-built three times: a view model is a few
   * dozen small meshes, `weaponLayout` is pure arithmetic, and three weapons' worth
   * of geometry resident in the scene for the two that are not held is a cost paid
   * in every frame for a swap that happens a few times a mission.
   */
  setWeapon(def: WeaponDef): void {
    this.viewModel.dispose();
    this.viewModel = this.buildViewModel(def);
    this.viewModelOverride = null;
  }

  /** The weapon id the view model is currently built for. */
  get weaponId(): string {
    return this.viewModel.layout.id;
  }

  setQuality(tier: QualityTier): void {
    this.quality = QUALITY_PRESETS[tier];
    this.aoOptions = aoOptionsFromQuality(this.quality);
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.lighting.applyQuality(this.quality);
    // The atmosphere owns the environment intensity's scale and the exposure, so it
    // has to be re-applied after a tier change rather than set here.
    this.applyAtmosphere();
    this.cameraLight.distance = this.quality.muzzleLightRange;
    this.adaptive.setFloor(this.quality.adaptiveFloor);
    // Rebuilding the composer recompiles the pass chain, and the frames that
    // follow are the shader compiles, not the game. Without this the controller
    // read that window as a GPU bottleneck, cut resolution, and left it cut — so
    // "switch preset" looked like "switch to a blurrier game" (ADR-0014).
    this.adaptive.hold(3000);
    this.buildComposer();
    // Deferred, like the adaptive controller's changes: the drawing buffer is
    // only resized at the top of a frame.
    this.resolutionDirty = true;
  }

  /**
   * Change the time of day.
   *
   * The one place the renderer takes an atmosphere instead of an effect, and the
   * whole morning/dusk feature: the lighting rig swaps its sky, key and ambient in
   * place, the fog and exposure follow, and the emissive props change with them (a
   * street lamp's lens in daylight is a pale disc, and its window pools of light are
   * simply off). Only the environment cubemap is rebuilt — one small PMREM render —
   * because the reflected sky has to be the sky overhead.
   */
  setTimeOfDay(next: TimeOfDay): void {
    if (next === this.currentTimeOfDay) return;
    this.currentTimeOfDay = next;
    this.lighting.applyTimeOfDay(next, this.quality);
    this.environment.dispose();
    this.environment = createSkyEnvironment(this.renderer, next);
    this.scene.environment = this.environment;
    this.applyAtmosphere();
    // The cubemap is a shader input and the sky's own texture has changed, so the
    // frames either side of a switch are not the game's frames.
    this.adaptive.hold(300);
  }

  /** The atmosphere currently running. */
  get timeOfDay(): TimeOfDay {
    return this.currentTimeOfDay;
  }

  /**
   * Everything that follows the atmosphere: haze, exposure, sky light and the
   * emissive prop colours.
   *
   * Separate from `setQuality` because they answer different questions — a tier
   * decides how much of the look a machine may afford, the atmosphere decides what
   * the look *is* — and because both have to be re-applied when the other changes.
   */
  private applyAtmosphere(): void {
    const preset = timePreset(this.currentTimeOfDay);
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.setHex(preset.fog.color);
    fog.density = this.fogDensity * LOOK.fogDensityScale * preset.fog.densityScale;
    this.renderer.toneMappingExposure = LOOK.exposure * preset.exposureScale;
    this.scene.environmentIntensity =
      this.quality.environmentIntensity * preset.environmentScale;
    this.applyGlow();
    // The weather rides with the atmosphere, and it is the one part of a switch that the
    // *materials* have to hear: the sky, key and exposure are the rig's, but whether the
    // road holds a lamp's reflection is a property of the road (materials/materials.ts).
    // (The constructor applies it as well, from the same preset — see `applyWeathering`.)
    applyWeathering(this.materials, preset.weather);
  }

  /**
   * The emissive props' colours for the active atmosphere.
   *
   * A lamp lens, a lit pane and a kiosk sign are `MeshBasicMaterial`s — they are
   * sources, and their colour *is* their brightness. Which means the atmosphere has
   * to be allowed to change it: at dusk they are warm emitters and in the morning
   * they are pale glass, and a build that switched the lamp lights off in daylight
   * while leaving the bulbs glowing would be lit by a hundred lamps that are off.
   * The red signal lamps stay on: a gate lamp is a gate lamp at any hour.
   */
  private applyGlow(): void {
    const glow = timePreset(this.currentTimeOfDay).glow;
    this.materials.lampBulb.color.setHex(glow.bulb);
    this.materials.windowGlow.color.setHex(glow.window);
    this.materials.kioskSign.color.setHex(glow.sign);
    // The halo sprites are additive and unlit, so they are the one part of a lamp that
    // a switched-off light does not dim on its own: forty glowing halos over a morning
    // street is a night scene wearing daylight colours.
    for (const material of this.arena.lampGlows) {
      material.opacity = LAMP_GLOW_OPACITY * glow.lampGlow;
      material.visible = glow.lampGlow > 0;
    }
  }

  /**
   * Choose whether the frame may trade resolution for frame rate.
   *
   * This is the setting the second report of "laggy and blurry" produced. The
   * controller's only lever is resolution, so with it free a machine that is 5 fps
   * short of the target gets a *softer* picture and the same 5 fps — and from the
   * player's chair that is a blurry game, not a performance setting. `native` (the
   * default) locks it at 1.0 and answers the lag with the effect budget; `dynamic`
   * releases it for the player who would rather have the frames.
   */
  setResolutionMode(mode: ResolutionMode): void {
    this.resolutionMode = mode;
    this.adaptive.lock(mode === 'native' ? 1 : null);
    this.resolutionDirty = true;
  }

  get resolution(): ResolutionMode {
    return this.resolutionMode;
  }

  /**
   * Debug/A-B switch for the filmic grade (the "what did the grade actually do"
   * capture). Goes through the same debug surface as everything else: see
   * docs/decisions/0009-debug-api-contract.md.
   */
  setGradeEnabled(enabled: boolean): void {
    if (this.look) this.look.pass.enabled = enabled;
  }

  /**
   * Hold parts of the view model's pose still, for captures.
   *
   * The weapon is the one object a screenshot of this game always contains, and
   * the pose that matters (aiming, mid-reload, sprinting) is a consequence of the
   * simulation. Freezing the sim and overriding the pose is what makes two weapon
   * captures comparable instead of two samples of a swaying object.
   */
  setViewModelOverride(override: Partial<ViewModelPose> | null): void {
    this.viewModelOverride = override;
  }

  /**
   * Show or hide the weapon, its hands and the arms.
   *
   * A debug-only switch (reachable through `window.__IV__.viewModel()`), and the
   * reason it exists is measurement: the hands occupy a few percent of the frame
   * and the world behind them is full of horizontal and vertical edges, so a
   * shape statistic computed on the raw frame measures the plaza. Differencing a
   * frame against the same pose with the view model hidden isolates exactly the
   * pixels the hands are drawn on.
   */
  setViewModelVisible(visible: boolean, weaponToo = true): void {
    this.viewModel.setVisible(visible, weaponToo);
  }

  /**
   * The weapon as built and as posed: measured dimensions plus the rig's joints in
   * world space. Static evidence for the review's "is it a gun held by a man"
   * question, and the readout the capture checklist asks for.
   */
  get weaponDebug(): {
    id: string;
    archetype: string;
    receiverLength: number;
    totalLength: number;
    /** Rear lens (or rear notch) to eye at full ADS, metres — the optic's framing. */
    eyeRelief: number;
    /** The sight line's height over the bore: what the ADS solve aims the camera along. */
    opticHeight: number;
    partCount: number;
    metresPerTile: Record<string, number>;
    joints: Record<string, [number, number, number]>;
  } {
    const joints: Record<string, [number, number, number]> = {};
    const point = new THREE.Vector3();
    for (const [name, object] of Object.entries(this.viewModel.rig)) {
      object.getWorldPosition(point);
      joints[name] = [Number(point.x.toFixed(4)), Number(point.y.toFixed(4)), Number(point.z.toFixed(4))];
    }
    for (const [name, object] of [
      ['muzzle', this.viewModel.muzzleAnchor],
      ['eject', this.viewModel.ejectAnchor],
    ] as const) {
      object.getWorldPosition(point);
      joints[name] = [Number(point.x.toFixed(4)), Number(point.y.toFixed(4)), Number(point.z.toFixed(4))];
    }
    return {
      id: this.viewModel.layout.id,
      archetype: this.viewModel.layout.archetype,
      receiverLength: this.viewModel.layout.receiverLength,
      totalLength: this.viewModel.layout.totalLength,
      // The three numbers a report about the optic needs: how far the eye is from the
      // glass (which is what apparent size comes from), where the sight line sits, and how
      // many parts the build actually placed (a layout that silently dropped its optic
      // shows up here as a count, not as a mystery).
      eyeRelief: this.viewModel.layout.eyeRelief,
      opticHeight: this.viewModel.layout.anchors.optic.height,
      partCount: this.viewModel.layout.parts.length,
      metresPerTile: {
        gunmetal: this.weaponMaterials.gunmetal.metresPerTile,
        steel: this.weaponMaterials.steel.metresPerTile,
        polymer: this.weaponMaterials.polymer.metresPerTile,
        wood: this.weaponMaterials.wood.metresPerTile,
        leather: this.weaponMaterials.leather.metresPerTile,
        sleeve: this.weaponMaterials.sleeve.metresPerTile,
        skin: this.weaponMaterials.skin.metresPerTile,
      },
      joints,
    };
  }

  /**
   * Pin the adaptive resolution (null releases it).
   *
   * The capture probes need this: they compare frames with an effect off and on,
   * and without a lock the controller also changes the resolution between those
   * two frames — see `AdaptiveResolution.lock`.
   */
  setResolutionLock(scale: number | null): void {
    this.adaptive.lock(scale);
    this.resolutionDirty = true;
  }

  /** Debug switch for the AO pass, so a probe can capture with and without it. */
  setAoEnabled(enabled: boolean): void {
    if (this.ao) this.ao.enabled = enabled;
  }

  /**
   * Rebuild the composer with a different AO sample count (0 removes the pass and
   * its depth texture altogether).
   *
   * `setAoEnabled(false)` leaves the pass in the chain and the depth texture on
   * the scene target; this measures what *not having them at all* costs, which is
   * the honest baseline for both the image and the budget.
   */
  setAoQuality(samples: number): void {
    this.quality = { ...this.quality, aoSamples: Math.max(0, Math.round(samples)) };
    this.aoOptions = { ...this.aoOptions, samples: Math.max(1, Math.round(samples)) };
    this.buildComposer();
  }

  /** AO debug view (the term itself, or the depth/normal feeds it reconstructs from). */
  setAoOutput(mode: AoOutput): void {
    this.ao?.setOutput(mode);
  }

  /** Debug switch for the sun's shadow map, so a probe can diff grounded/ungrounded. */
  setShadowsEnabled(enabled: boolean): void {
    this.renderer.shadowMap.enabled = enabled;
    this.lighting.sun.castShadow = enabled;
  }

  /**
   * Debug A/B switch for one lighting group (key / ambient / lamps / windows /
   * fire / reflections).
   *
   * This is how a lighting claim becomes a measurement: turning the lamp pool off
   * and on at one frozen pose gives the lamp's own contribution at known world
   * points, which is what separates "the lamp grounds the pavement" from "the
   * pavement happens to be brighter there". The `lighting` probe in
   * apps/harness/src/shots.ts drives it.
   */
  setLightingEnabled(group: LightGroup, enabled: boolean): void {
    this.lighting.setEnabled(group, enabled);
  }

  /**
   * Debug switch: rebuild the composer with a different MSAA sample count, so the
   * AA contribution can be measured as a pair of frames instead of asserted.
   */
  setMsaaSamples(samples: 0 | 2 | 4): void {
    if (this.quality.msaaSamples === samples) return;
    this.quality = { ...this.quality, msaaSamples: samples };
    this.buildComposer();
  }

  /**
   * Live AO tuning: the sweep that chose the preset values runs through here, so
   * the numbers in `quality.ts` are the ones that measured best rather than the
   * ones that sounded plausible (see docs/ART_BIBLE.md).
   */
  setAoParams(params: Partial<AoOptions>): void {
    Object.assign(this.aoOptions, params);
    this.ao?.setParams(params);
  }

  /**
   * Where a world point lands on screen, in CSS pixels.
   *
   * The capture probes sample the pixel *at a world position* (a tyre's contact
   * patch, a wall's base) rather than a hand-picked screen rectangle, so a camera
   * tweak cannot quietly invalidate the measurement. The camera matrix is
   * refreshed first so the answer matches the pose that was just set.
   */
  projectToScreen(x: number, y: number, z: number): { x: number; y: number; visible: boolean } {
    this.camera.updateMatrixWorld(true);
    const point = new THREE.Vector3(x, y, z).project(this.camera);
    return {
      x: (point.x * 0.5 + 0.5) * window.innerWidth,
      y: (-point.y * 0.5 + 0.5) * window.innerHeight,
      visible: point.z > -1 && point.z < 1,
    };
  }

  setMotionScale(scale: number): void {
    this.rig.setMotionScale(scale);
  }

  /**
   * Resize the viewport.
   *
   * Sizes are clamped away from zero on purpose: a docked devtools panel or a
   * minimised window fires a resize with 0 height, and `aspect = w / 0` is
   * Infinity — the projection matrix becomes NaN and the game renders pure black
   * from then on. Guarding here is cheaper than debugging that in the wild.
   */
  resize(width: number, height: number, pixelRatio: number): void {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    const ratio = Math.min(pixelRatio > 0 ? pixelRatio : 1, this.quality.pixelRatioCap) * this.adaptive.value;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.syncParticleScale();
    // The composer is only rebuilt when the *passes* change (setQuality); a plain
    // resize just reallocates its render targets.
    if (!this.composer) this.buildComposer();
    else {
      this.composer.setPixelRatio(ratio);
      this.composer.setSize(w, h);
      this.syncAoDepthSize();
      this.syncSharpen();
    }
    // A resize reallocates every target in the chain, and the frames that follow a
    // drag of the window edge are not the game's frames (ADR-0014).
    this.adaptive.hold(400);
  }

  /**
   * Keep the depth textures the AO pass samples the same size as the drawing
   * buffer — *both* of the composer's targets, because they do not share one.
   *
   * `RenderTarget.setSize` resizes the colour textures but not the depth texture
   * attached to it, so this has to happen wherever the composer is resized — and
   * *before* the next render re-creates the framebuffer (the RT disposes itself on
   * a size change, which is exactly the hook this needs). A depth texture left at
   * the wrong size is not a subtle failure: the depth attachment is recreated
   * against a mismatched image and the AO term reads garbage or nothing.
   */
  private syncAoDepthSize(): void {
    if (!this.ao) return;
    const drawing = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const width = Math.max(1, Math.floor(drawing.x));
    const height = Math.max(1, Math.floor(drawing.y));
    for (const target of [this.composer?.renderTarget1, this.composer?.renderTarget2]) {
      const depth = target?.depthTexture;
      if (!depth) continue;
      if (depth.image.width === width && depth.image.height === height) continue;
      depth.image.width = width;
      depth.image.height = height;
      depth.needsUpdate = true;
    }
  }

  /**
   * Re-apply the adaptive resolution scale.
   *
   * Must only run *before* a frame is drawn: `setSize` reallocates the WebGL
   * drawing buffer, so calling it after `render()` throws away the frame we just
   * drew and the compositor shows a black canvas until the next one. That was the
   * intermittent black flash.
   */
  private applyResolution(): void {
    const size = this.renderer.getSize(new THREE.Vector2());
    const ratio =
      Math.min(window.devicePixelRatio || 1, this.quality.pixelRatioCap) * this.adaptive.value;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(size.x, size.y, false);
    this.composer?.setPixelRatio(ratio);
    this.composer?.setSize(size.x, size.y);
    this.syncAoDepthSize();
    this.syncParticleScale();
    this.syncSharpen();
  }

  /**
   * Turn the upscale compensation on only when the frame is being upscaled.
   *
   * It is compensation, not a filter: at native resolution there is nothing to
   * compensate for and sharpening there is how a renderer grows a halo on every
   * high-contrast edge. `SHARPEN_BELOW_SCALE` is the line, and it lives in quality.ts
   * next to the tier floors that decide the scale in the first place. Since ADR-0017
   * the term itself is a uniform of the look pass rather than a pass of its own.
   */
  private syncSharpen(): void {
    if (!this.look) return;
    const drawing = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const upscaled = this.adaptive.value < SHARPEN_BELOW_SCALE;
    this.sharpenAmount = upscaled ? SHARPEN_STRENGTH : 0;
    this.look.setSharpen(this.sharpenAmount, drawing.x, drawing.y);
  }

  /** Point sprites are sized in world units; the shader needs the viewport to do it. */
  private syncParticleScale(): void {
    const size = this.renderer.getSize(new THREE.Vector2());
    const ratio = this.renderer.getPixelRatio();
    this.particles.setProjection(size.y * ratio, this.camera.fov);
  }

  /**
   * The post chain, in the only order that makes sense:
   *
   *   RenderPass (MSAA, HDR, depth)
   *   → AO              contact + corner occlusion, needs the scene depth
   *   → UnrealBloom     wants HDR before the tone map
   *   → OutputPass      tone map (AgX) + output colour space
   *   → LookPass        filmic grade + upscale compensation, in display space
   *   → SMAA / FXAA     last, on the graded image
   *
   * Which of those stages exist is `postChain(quality)` in quality.ts, not an if-tree
   * here: the frame's pass count is then a stated, tested number rather than something
   * a reader has to count (`tests/unit/quality.test.ts`).
   *
   * Sized at the top of a frame by the caller (`resize`/`applyResolution`); this
   * method itself only ever runs from those two paths or from `setQuality`.
   */
  private buildComposer(): void {
    this.ao?.dispose();
    this.composer?.dispose();
    this.composer = null;
    this.look = null;
    this.ao = null;

    const size = this.renderer.getSize(new THREE.Vector2());
    const drawing = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const width = Math.max(1, Math.floor(drawing.x));
    const height = Math.max(1, Math.floor(drawing.y));

    // The scene target. HalfFloat keeps highlights above 1.0 alive for the bloom
    // pass, `samples` is the MSAA the canvas cannot provide behind a composer, and
    // the depth texture is what lets the AO pass reconstruct view positions instead
    // of drawing its own depth prepass (a second full-scene draw of every batched
    // mesh, for a term that only needs the depth buffer we already produce).
    // Cloning the target hands `renderTarget2` its own depth texture, which the AO
    // pass relies on: it samples the depth of whichever buffer the scene was drawn
    // into this frame (see post/ao.ts).
    // The chain is data (quality.ts `postChain`), and the depth texture exists because
    // an `ao` stage asked for it — one source of truth for both.
    const stages = postChain(this.quality);
    const depthTexture = stages.some((stage) => stage.name === 'ao')
      ? new THREE.DepthTexture(width, height)
      : null;
    const target = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      samples: this.quality.msaaSamples,
      depthBuffer: true,
      stencilBuffer: false,
      depthTexture,
    });
    target.texture.name = 'IronVanguard.scene';

    const composer = new EffectComposer(this.renderer, target);

    // Iterating the chain here is what keeps the renderer and the pass-count
    // assertions in the test suite from ever drifting apart.
    for (const stage of stages) {
      switch (stage.name) {
        case 'scene':
          composer.addPass(new RenderPass(this.scene, this.camera));
          break;
        case 'ao': {
          if (!depthTexture) break;
          // The AO pass runs at the drawing-buffer size (or a fraction of it, per
          // tier) straight off the scene depth — no G-buffer, no normal pass, so the
          // only cost is the sample loop itself.
          const ao = new AoPass(this.camera, depthTexture, width, height, this.aoOptions);
          composer.addPass(ao);
          this.ao = ao;
          break;
        }
        case 'bloom':
          // Threshold and radius come from the shared look rig: the threshold is the
          // highlight guard (bloom starts above it, so a lamp lens pools light instead
          // of clipping to a white disc, and a weapon highlight stays where it landed)
          // and the radius decides how far that pool spreads. The resolution is not a
          // tier's to change — see BLOOM_SCALE.
          composer.addPass(
            new UnrealBloomPass(
              new THREE.Vector2(width, height),
              this.quality.bloomStrength,
              this.quality.bloomRadius,
              this.quality.bloomThreshold,
            ),
          );
          break;
        case 'output':
          // Replaces the old GammaCorrectionShader: tone mapping plus output colour
          // space in one place (r152+).
          composer.addPass(new OutputPass());
          break;
        case 'look': {
          const look = createLookPass();
          composer.addPass(look.pass);
          this.look = look;
          break;
        }
        case 'aa':
          // Post AA last: MSAA cannot touch specular or alpha-tested edges, and the
          // grade steepens what is left, so this is the order that reads cleanest.
          // FXAA on the cheap tiers is one full-resolution pass to SMAA's three, and
          // the upscale compensation inside the look pass has already restored the
          // edge structure FXAA would otherwise be blurring.
          composer.addPass(stage.aa === 'smaa' ? new SMAAPass() : new FXAAPass());
          break;
      }
    }


    // ---- one multisampled target, and only one --------------------------------
    // EffectComposer clones the scene target for its write buffer, so every
    // fullscreen pass in the chain — bloom's composite, the grade and each of SMAA's
    // three — used to render into, and resolve out of, a 4x multisampled half-float
    // target. MSAA is a *geometry* antialiasing: there is no
    // geometry in a fullscreen pass for it to antialias, so all it bought was a
    // resolve per pass at the full drawing-buffer size (ADR-0016).
    if (composer.renderTarget2.samples > 0) {
      composer.renderTarget2.samples = 0;
      // Reallocates the framebuffer without the multisample renderbuffer; three
      // recreates it on next use. Setting `samples` alone would leave the existing
      // (multisampled) one attached.
      composer.renderTarget2.dispose();
    }

    composer.setPixelRatio(this.renderer.getPixelRatio());
    composer.setSize(size.x, size.y);
    this.composer = composer;
    this.syncAoDepthSize();
  }

  // -- per-tick wiring ------------------------------------------------------

  /** Snapshot the pose the player had before the current tick (for interpolation). */
  capturePrevious(world: World): void {
    this.previous = {
      x: world.player.pos.x,
      z: world.player.pos.z,
      yaw: world.player.yaw,
      pitch: world.player.pitch,
    };
    for (const enemy of world.enemies) {
      this.previousEnemies.set(enemy.id, {
        x: enemy.pos.x,
        z: enemy.pos.z,
        yaw: enemy.yaw,
        pitch: 0,
      });
    }
  }

  syncWorld(world: World, alpha: number, dt: number): void {
    this.time = world.tick * TICK_DT;

    // Player pose: interpolate between the previous tick and the current one.
    const pose: Pose = {
      x: lerp(this.previous.x, world.player.pos.x, alpha),
      z: lerp(this.previous.z, world.player.pos.z, alpha),
      yaw: this.previous.yaw + shortestAngle(this.previous.yaw, world.player.yaw) * alpha,
      pitch: lerp(this.previous.pitch, world.player.pitch, alpha),
    };
    this.rig.update(world, dt, pose, this.fovScale);

    // Interpolated render poses — the simulation state is read-only from here.
    const enemyPoses: EnemyRenderPose[] = [];
    for (const enemy of world.enemies) {
      const prev = this.previousEnemies.get(enemy.id);
      enemyPoses.push({
        enemy,
        x: prev ? lerp(prev.x, enemy.pos.x, alpha) : enemy.pos.x,
        z: prev ? lerp(prev.z, enemy.pos.z, alpha) : enemy.pos.z,
        yaw: prev ? prev.yaw + shortestAngle(prev.yaw, enemy.yaw) * alpha : enemy.yaw,
      });
    }
    this.enemies.sync(enemyPoses, this.time);

    // Barrels.
    for (let i = 0; i < world.barrels.length; i++) {
      const barrel = world.barrels[i]!;
      this.arena.setBarrelAlive(i, barrel.alive);
    }

    this.syncPickups(world);
    this.syncGrenades(world);
    // The window-light pool follows the player. Four times a second is
    // indistinguishable from every frame (the nearest lit window does not move
    // 4 m in 250 ms) and keeps a sort of the anchor list off the hot path.
    this.windowLightTimer -= dt;
    if (this.windowLightTimer <= 0) {
      this.windowLightTimer = 0.25;
      this.lighting.updateWindowLights(
        this.arena.windowAnchors,
        world.player.pos.x,
        world.player.pos.z,
      );
    }
    this.arena.update(world.player.pos.x, world.player.pos.z, this.time, dt);
    this.updateViewModel(world, dt);
    if (!this.fxFrozen) this.ambientFX(world, dt);
  }

  private syncPickups(world: World): void {
    while (this.pickupMeshes.length < world.pickups.length) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.4, 0.5),
        new THREE.MeshStandardMaterial({ color: 0x3b3222, roughness: 0.7 }),
      );
      mesh.castShadow = true;
      this.scene.add(mesh);
      this.pickupMeshes.push(mesh);
    }
    for (let i = 0; i < this.pickupMeshes.length; i++) {
      const mesh = this.pickupMeshes[i]!;
      const pickup = world.pickups[i];
      if (!pickup) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      mesh.position.set(pickup.pos.x, pickup.pos.y, pickup.pos.z);
      mesh.rotation.y += 0.02;
      const color = pickup.kind === 'medkit' ? 0x9dff57 : 0xffb043;
      (mesh.material as THREE.MeshStandardMaterial).color.setHex(
        pickup.kind === 'medkit' ? 0x2c3b24 : 0x3b3222,
      );
      mesh.userData.color = color;
    }
  }

  private syncGrenades(world: World): void {
    while (this.grenadeMeshes.length < world.grenades.length) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0x3c4526, roughness: 0.6 }),
      );
      mesh.castShadow = true;
      this.scene.add(mesh);
      this.grenadeMeshes.push(mesh);
    }
    for (let i = 0; i < this.grenadeMeshes.length; i++) {
      const mesh = this.grenadeMeshes[i]!;
      const grenade = world.grenades[i];
      if (!grenade) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      mesh.position.set(grenade.pos.x, grenade.pos.y, grenade.pos.z);
      const blink = Math.sin(grenade.fuseTicks * 0.35) > 0;
      (mesh.material as THREE.MeshStandardMaterial).emissive.setHex(blink ? 0x661a00 : 0x000000);
    }
  }

  /** Last tick's landing impulse, so the impact shake fires on the edge. */
  private lastLand = 0;

  private updateViewModel(world: World, dt: number): void {
    const p = world.player;
    this.viewModel.pose({
      adsT: p.adsT,
      ...(this.viewModelOverride ?? {}),
      sprintK: p.sprintK,
      bobPhase: p.bobPhase,
      bobX: 0,
      bobY: p.speed > 0.6 ? Math.sin(p.bobPhase * 2) * 0.018 * (1 - 0.7 * p.adsT) : 0,
      swayX: this.rig.state.swayX,
      swayY: this.rig.state.swayY,
      kick: this.rig.state.kick,
      reloadProgress: p.reloading ? 1 - p.reloadTicks / (world.weaponDef.reloadSeconds * 60) : 0,
      time: this.time,
      motionScale: 1,
      crouchK: p.crouchK,
      airborne: !p.grounded,
      land: p.landT,
    });

    // A landing is an impact, and the presentation is where it lands: the camera takes
    // a short shake whose size is the fall speed (`landT` is 1 at the end of a full
    // hop and a fraction of it after a step). Detected on the *edge*, so it fires once.
    if (p.landT > this.lastLand + 0.001) this.rig.addShake(0.5 * p.landT);
    this.lastLand = p.landT;

    if (this.muzzleTimer > 0) {
      this.muzzleTimer -= dt;
      if (this.muzzleTimer <= 0) this.viewModel.muzzleFlash.visible = false;
    }
    // Fast decay: the flash is a 40 ms event, so its light must be gone in about
    // that long or a burst reads as a permanent lamp on the barrel.
    this.cameraLight.intensity *= Math.exp(-34 * dt);
    if (this.boomTimer > 0) {
      this.boomTimer -= dt;
      this.lighting.boom.intensity *= Math.exp(-6 * dt);
    }
  }

  /** Fire, smoke columns and drifting ash — parity ambientFX. */
  private ambientFX(world: World, dt: number): void {
    // Muzzle/boom lights are held at full brightness while frozen so that a
    // capture pair taken during a firefight is comparable.
    this.ambientFireTimer -= dt;
    if (this.ambientFireTimer <= 0) {
      this.ambientFireTimer = 0.06;
      const fire = this.arena.fireLightAnchor;
      const colors = [0xffdf9a, 0xff9a3c, 0xff6a2a];
      this.particles.spawn({
        position: {
          x: fire.x + (Math.random() - 0.5) * 0.5,
          y: fire.y + Math.random() * 0.3,
          z: fire.z + (Math.random() - 0.5) * 0.5,
        },
        velocity: { x: (Math.random() - 0.5) * 0.6, y: 1.2 + Math.random(), z: (Math.random() - 0.5) * 0.6 },
        color: colors[(Math.random() * 3) | 0],
        size: 0.2 + Math.random() * 0.22,
        life: 0.3 + Math.random() * 0.25,
        grow: 0.5,
        additive: true,
      });
      this.particles.spawn({
        position: { ...fire },
        velocity: { x: (Math.random() - 0.5) * 1.6, y: 2 + Math.random() * 1.6, z: (Math.random() - 0.5) * 1.6 },
        color: 0xffb060,
        size: 0.06,
        life: 0.5 + Math.random() * 0.4,
        gravity: -2,
        additive: true,
        flicker: true,
      });
    }
    this.lighting.fire.intensity = 40 + Math.sin(this.time * 13) * 8 + Math.sin(this.time * 29) * 5;

    this.ambientSmokeTimer -= dt;
    if (this.ambientSmokeTimer <= 0) {
      this.ambientSmokeTimer = 0.15;
      for (const anchor of this.arena.smokeAnchors) {
        const shade = new THREE.Color(0x2a2622).lerp(new THREE.Color(0x55503f), Math.random());
        this.particles.spawn({
          position: {
            x: anchor.x + (Math.random() - 0.5) * 1.2,
            y: anchor.y,
            z: anchor.z + (Math.random() - 0.5) * 1.2,
          },
          velocity: { x: 0.2 + Math.random() * 0.4, y: 1.4 + Math.random() * 0.6, z: (Math.random() - 0.5) * 0.3 },
          color: shade.getHex(),
          size: 1.2 + Math.random() * 0.8,
          life: 3 + Math.random() * 1.5,
          grow: 1 + Math.random() * 0.6,
          opacity: 0.4,
        });
      }
    }
    void world;
  }

  /** Translate this tick's simulation events into audio-less visual FX. */
  consumeEvents(world: World): void {
    for (const event of world.events) {
      switch (event.type) {
        case 'shot': {
          this.playerTracers.fire(event.origin, event.end);
          this.viewModel.muzzleFlash.visible = true;
          this.muzzleTimer = 0.04;
          // A 12-18 cm burst, down from 24-42 cm, and deterministic: the same
          // burst every time makes a before/after capture comparable, and the
          // light at `quality.muzzleLightIntensity` lights the scene, not the blob.
          this.flashSeed = (this.flashSeed * 1664525 + 1013904223) >>> 0;
          this.viewModel.muzzleFlash.scale.setScalar(0.12 + ((this.flashSeed >>> 9) % 100) * 0.0006);
          this.viewModel.muzzleFlash.material.rotation = ((this.flashSeed >>> 3) % 360) * (Math.PI / 180);
          this.cameraLight.intensity = this.quality.muzzleLightIntensity;
          this.rig.setFovPunch(0.9); // parity
          this.rig.setKick(1);
          const right = new THREE.Vector3(
            Math.cos(world.player.yaw),
            0,
            -Math.sin(world.player.yaw),
          );
          const forward = new THREE.Vector3(Math.sin(world.player.yaw), 0, Math.cos(world.player.yaw)).negate();
          const ejectWorld = this.viewModel.ejectAnchor.getWorldPosition(new THREE.Vector3());
          this.casings.eject(ejectWorld, right, forward);
          this.particles.spawn({
            position: {
              x: event.origin.x + (event.end.x - event.origin.x) * 0.1,
              y: event.origin.y + (event.end.y - event.origin.y) * 0.1,
              z: event.origin.z + (event.end.z - event.origin.z) * 0.1,
            },
            velocity: { x: 0, y: 0.6, z: 0 },
            color: 0x9a938a,
            size: 0.12,
            life: 0.5,
            grow: 0.5,
            opacity: 0.5,
          });
          break;
        }
        case 'impact': {
          const surface = getSurface(event.surface);
          this.spawnImpact(event.point, event.normal, surface.impactColor);
          this.decals.addImpact(event.point, event.normal, surface);
          break;
        }
        case 'enemyShot':
          this.enemyTracers.fire(event.origin, event.end);
          this.rig.addShake(0.05);
          break;
        case 'explosion':
          this.explosions.spawn(event.pos, event.radius);
          break;
        case 'enemyKilled': {
          const pos = enemyPosition(world, event.enemyId);
          this.particles.spawn({
            position: { x: pos.x, y: 1, z: pos.z },
            color: 0x6b6152,
            size: 1.4,
            life: 0.8,
            grow: 1.5,
            opacity: 0.6,
          });
          this.rig.addShake(0.08);
          break;
        }
        case 'enemyDamaged': {
          const pos = enemyPosition(world, event.enemyId);
          for (let i = 0; i < 5; i++) {
            this.particles.spawn({
              position: { x: pos.x, y: 1.2, z: pos.z },
              velocity: {
                x: (Math.random() - 0.5) * 4,
                y: 1 + Math.random() * 2,
                z: (Math.random() - 0.5) * 4,
              },
              color: 0x8a1410, // parity blood spray
              size: 0.08 + Math.random() * 0.08,
              life: 0.2 + Math.random() * 0.2,
              gravity: 9,
            });
          }
          break;
        }
        default:
          break;
      }
    }
  }

  private spawnImpact(point: Vec3, normal: Vec3, color: number): void {
    // Impact FX come from the surface table, so a metal hit reads differently
    // from concrete without any per-mesh tuning.
    for (let i = 0; i < 4; i++) {
      this.particles.spawn({
        position: { ...point },
        velocity: {
          x: normal.x * (1 + Math.random() * 2) + (Math.random() - 0.5) * 4,
          y: Math.max(0, normal.y) * (1 + Math.random() * 2) + Math.random() * 2,
          z: normal.z * (1 + Math.random() * 2) + (Math.random() - 0.5) * 4,
        },
        color: 0xffdf9a,
        size: 0.05 + Math.random() * 0.05,
        life: 0.15 + Math.random() * 0.15,
        gravity: 12,
        additive: true,
      });
    }
    this.particles.spawn({
      position: { ...point },
      velocity: { x: normal.x * 0.8, y: normal.y * 0.8, z: normal.z * 0.8 },
      color,
      size: 0.14,
      life: 0.5,
      grow: 0.5,
      opacity: 0.5,
    });
  }

  // -- drawing --------------------------------------------------------------

  /** See `fxFrozen` — capture probes hold the frame still with this. */
  setFxFrozen(frozen: boolean): void {
    this.fxFrozen = frozen;
  }

  render(dt: number): void {
    const start = performance.now();
    const step = this.fxFrozen ? 0 : dt;
    // The composer renders through several passes and three resets `info` on every
    // `render()` call, so the default readout described the final fullscreen quad
    // ("1 draw call, 1 triangle"). Accumulating the whole frame is what makes the
    // numbers in docs/PERF_BUDGET.md mean something.
    this.renderer.info.autoReset = false;
    this.renderer.info.reset();
    if (this.resolutionDirty) {
      this.resolutionDirty = false;
      this.applyResolution();
    }
    this.playerTracers.update(step);
    this.enemyTracers.update(step);
    this.casings.update(step);
    this.particles.update(step, this.time);
    this.decals.update(step);
    this.explosions.update(step);

    if (this.composer) {
      try {
        this.composer.render();
      } catch {
        // Post-processing failure must never kill the frame (prototype parity).
        this.composer = null;
        this.renderer.render(this.scene, this.camera);
      }
    } else {
      this.renderer.render(this.scene, this.camera);
    }

    const elapsed = performance.now() - start;
    this.frameMs = elapsed;
    // The controller is fed the *frame delta*, not `elapsed`: `elapsed` is CPU
    // submit time, which stays flat on a GPU-bound frame. See quality.ts.
    this.adaptive.sample(dt * 1000);
    // Sampling may flag a scale change; it is applied at the top of the next
    // frame, never after this one has been drawn.
    this.fpsAccumulator += dt;
    this.fpsFrames++;
    if (this.fpsAccumulator >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsAccumulator);
      this.fpsAccumulator = 0;
      this.fpsFrames = 0;
    }
  }

  get budget(): {
    drawCalls: number;
    triangles: number;
    particleBudget: number;
  } {
    return {
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      particleBudget: this.quality.maxParticles,
    };
  }

  get info(): RendererInfo {
    const memory = this.renderer.info;
    return {
      drawCalls: memory.render.calls,
      triangles: memory.render.triangles,
      programs: memory.programs?.length ?? 0,
      fps: this.fps,
      frameMs: this.frameMs,
      resolutionScale: this.adaptive.value,
      particles: this.particles.liveCount,
      enemies: this.enemies.count,
      quality: this.quality.tier,
    };
  }

  /**
   * What the image pipeline is *actually* running, for the shots tool and the
   * e2e gate. The point is that it reports observed state (the GL context's real
   * sample count, the composed pass list) rather than the preset we asked for, so
   * a silently-ignored setting cannot pass a visual test.
   */
  get renderDebug(): {
    msaaSamplesRequested: number;
    msaaSamplesTarget: number;
    passes: string[];
    postAa: string;
    ao: {
      enabled: boolean;
      samples: number;
      contactRadius: number;
      ambientRadius: number;
      intensity: number;
      /** The occluder's minimum elevation, as a cosine — see `aoOptionsFromQuality`. */
      bias: number;
      /** Metres of slack beyond a sample's own distance. */
      thickness: number;
      scale: number;
      output: string;
    } | null;
    grade: boolean;
    shadow: { type: number; mapSize: number; radius: number; far: number; intensity: number };
    /**
     * The lighting rig as it is *actually* configured, for the lighting probes and
     * for a human reading devtools. Reported from the live objects (a lamp's real
     * intensity and range, how many are visible) rather than from the preset, so a
     * silently-ignored setting cannot pass a review.
     */
    lighting: ReturnType<LightingRig['state']> & {
      bloom: { strength: number; threshold: number; radius: number };
      muzzle: { peak: number; range: number };
      fogDensityScale: number;
    };
    toneMapping: number;
    exposure: number;
    fog: { color: string; density: number };
    resolutionScale: number;
    resolutionLocked: boolean;
    /** `native` = the frame is never upscaled; `dynamic` = the controller is free. */
    resolutionMode: ResolutionMode;
    /**
     * Whether the upscale compensation is on. Reported rather than assumed, because
     * the term is *conditional* (ADR-0016): it should read `false` at native
     * resolution, and a frame that is being upscaled without it is a blur somebody
     * can actually see.
     */
    sharpen: boolean;
    /**
     * Whole-buffer read/write count for this tier, from `postChain()` (ADR-0017).
     * The GPU-free half of "the frame is cheap": it is arithmetic, not a promise.
     */
    fullResPasses: number;
    /** The atmosphere in use, and which artificial sources it has lit. */
    timeOfDay: { id: TimeOfDay; keyColor: string; lamps: boolean; stars: boolean };
    /**
     * The material library as the frame is *actually* shading it (ADR-0020).
     *
     * Read from the live materials rather than from the recipe table, because the two can
     * differ: the atmosphere moves every outdoor surface's roughness and reflection, and the
     * whole point of that system is that a surface is a different surface after rain. A
     * number reported from `SURFACE_SPEC` would say what a road is made of; this says what a
     * road is doing in the frame in front of you, and whether a dry morning moved it back.
     */
    materials: {
      /** Both atmospheres' weather, so a probe can predict what a switch should do. */
      weather: Record<TimeOfDay, Weathering>;
      /** Live `roughness`/`metalness`/`envMapIntensity`, per library material. */
      live: Record<string, { surface: string; roughness: number; metalness: number; env: number }>;
    };
    pixelRatio: number;
    drawingBuffer: [number, number];
  } {
    const drawing = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const fog = this.scene.fog as THREE.FogExp2 | null;
    // The canvas framebuffer's own sample count is 0 by construction — the MSAA
    // lives on the composer's scene target, so that is what has to be reported
    // (a preset value would just repeat what we asked for, not what we got).
    const msaaSamplesTarget = this.composer?.renderTarget1.samples ?? 0;
    return {
      msaaSamplesRequested: this.quality.msaaSamples,
      msaaSamplesTarget,
      passes: this.composer ? this.composer.passes.map((pass) => pass.constructor.name) : [],
      postAa: this.quality.postAa,
      ao: this.ao
        ? {
            enabled: this.ao.enabled,
            samples: this.ao.params.samples,
            contactRadius: this.ao.params.contactRadius,
            ambientRadius: this.ao.params.ambientRadius,
            intensity: this.ao.params.intensity,
            // The two terms that are *not* a tier's to choose are still the two that
            // decide whether the term measures an occluder or the depth buffer's own
            // noise, so a probe has to be able to read them rather than infer them.
            bias: this.ao.params.bias,
            thickness: this.ao.params.thickness,
            scale: this.ao.params.scale,
            output: this.ao.outputMode,
          }
        : null,
      grade: this.look ? this.look.pass.enabled : false,
      shadow: {
        type: this.renderer.shadowMap.type,
        mapSize: this.lighting.sun.shadow.mapSize.width,
        radius: this.lighting.sun.shadow.radius,
        far: this.lighting.sun.shadow.camera.far,
        intensity: this.lighting.sun.shadow.intensity,
      },
      lighting: {
        ...this.lighting.state(),
        bloom: {
          strength: this.quality.bloomStrength,
          threshold: this.quality.bloomThreshold,
          radius: this.quality.bloomRadius,
        },
        muzzle: {
          peak: this.quality.muzzleLightIntensity,
          range: this.quality.muzzleLightRange,
        },
        fogDensityScale: LOOK.fogDensityScale,
      },
      toneMapping: this.renderer.toneMapping,
      exposure: this.renderer.toneMappingExposure,
      fog: fog ? { color: `#${fog.color.getHexString()}`, density: fog.density } : { color: 'none', density: 0 },
      resolutionScale: this.adaptive.value,
      resolutionLocked: this.adaptive.isLocked,
      resolutionMode: this.resolutionMode,
      sharpen: this.sharpenAmount > 0,
      fullResPasses: fullResPasses(this.quality),
      materials: { weather: weatherByHour(), live: liveMaterials(this.materials) },
      timeOfDay: {
        id: this.currentTimeOfDay,
        keyColor: `#${this.lighting.sun.color.getHexString()}`,
        lamps: timePreset(this.currentTimeOfDay).artificial.lamps,
        stars: timePreset(this.currentTimeOfDay).artificial.stars,
      },
      pixelRatio: this.renderer.getPixelRatio(),
      drawingBuffer: [drawing.x, drawing.y],
    };
  }

  /** Called between missions so nothing from the previous run leaks in. */
  resetTransient(): void {
    this.adaptive.reset();
    // A mission start compiles shaders, uploads textures and builds the first frames
    // of every effect, none of which says anything about the machine's steady state.
    this.adaptive.hold(1500);
    this.resolutionDirty = true;
    this.particles.clear();
    this.decals.clear();
    this.playerTracers.clear();
    this.enemyTracers.clear();
    this.casings.clear();
    this.explosions.clear();
    this.enemies.clear();
    this.previousEnemies.clear();
    this.rig.reset();
    // `reset()` clears the lock as well, so the mode has to be re-asserted: a mission
    // restart must not quietly hand the resolution back to the controller.
    this.adaptive.lock(this.resolutionMode === 'native' ? 1 : null);
  }

  dispose(): void {
    this.resetTransient();
    this.viewModel.dispose();
    this.weaponMaterials.dispose();
    this.enemies.clear();
    disposeMaterials(this.materials);
    this.textures.dispose();
    this.environment.dispose();
    disposeGeometryCache();
    this.renderer.dispose();
  }

  get devicePixelRatio(): number {
    return this.renderer.getPixelRatio();
  }

  /** True between a WebGL context loss and its restoration (the frame is blank). */
  get isContextLost(): boolean {
    return this.contextLost;
  }
}  /**
   * Every weathered material's live numbers, keyed by the library name a report can quote.
   *
   * Includes the classes the atmosphere *cannot* reach (a lit pane, a lamp lens) only
   * insofar as they are in the list, which they are not — so a probe that finds a `lampBulb`
   * row here has found a material the weather is touching that it should not.
   */
function liveMaterials(materials: Materials): Record<
    string,
    { surface: string; roughness: number; metalness: number; env: number }
  > {
    const live: Record<string, { surface: string; roughness: number; metalness: number; env: number }> = {};
    for (const [cls, keys] of WEATHERED_MATERIALS) {
      for (const key of keys) {
        const value = materials[key] as
          | THREE.MeshStandardMaterial
          | THREE.MeshStandardMaterial[]
          | THREE.MeshBasicMaterial;
        const list = Array.isArray(value) ? value : [value];
        list.forEach((entry, index) => {
          if (!(entry instanceof THREE.MeshStandardMaterial)) return;
          live[list.length > 1 ? `${key}[${index}]` : key] = {
            surface: cls,
            roughness: Number(entry.roughness.toFixed(3)),
            metalness: Number(entry.metalness.toFixed(3)),
            env: Number(entry.envMapIntensity.toFixed(3)),
          };
        });
      }
    }
    return live;
  }

  /**
   * The AO tunables for a tier. `bias`/`thickness` are derived rather than exposed
 * per tier: they are properties of the depth buffer's precision and of what
 * "contact" means physically, not of a quality budget.
 *
 * `bias` is a cosine (the occluder must sit this far above the surface) and
 * `thickness` is metres of slack beyond a sample's own distance. Both replaced
 * metre-scale depth windows in ADR-0013: a window measured along the view ray
 * made a wall's screen footprint, not the sampling radius, decide how far a wall
 * base darkened.
 *
 * Both are now measured rather than argued (ADR-0022). Rendering the pass's own
 * `ao` term — which is possible because the pass has a debug output for it — put the
 * flat open road at **0.87**: the flattest, most exposed surface in the build was
 * being darkened by 13%, and its noise was the same term, because at a grazing angle
 * the depth-reconstructed normal is noisy enough to dip the sampling hemisphere below
 * the surface. A wall's screen footprint was not the only thing that could decide reach:
 * the *depth buffer's own slope* could too, and it was.
 *
 * At 0.06 a 3.4° normal error manufactures occlusion; at 0.25 an occluder has to sit
 * 14.5° above the surface, which no depth-reconstruction artefact reaches and every real
 * contact clears by a wide margin (a tyre on tarmac is 45°, a crate on the ground 90°).
 * `thickness` came down with it: 0.3 m of slack admits an occluder a third of a metre
 * past the sample's own distance, and on a grazing plane those are the samples' own
 * neighbours.
 */
/** Both atmospheres' weather, as data, for `renderDebug` and the capture probes. */
function weatherByHour(): Record<TimeOfDay, Weathering> {
  return { dawn: TIME_PRESETS.dawn.weather, dusk: TIME_PRESETS.dusk.weather };
}

function aoOptionsFromQuality(quality: QualitySettings): AoOptions {
  return {
    samples: quality.aoSamples,
    contactRadius: quality.aoContactRadius,
    ambientRadius: quality.aoAmbientRadius,
    intensity: quality.aoIntensity,
    power: quality.aoPower,
    bias: 0.25,
    thickness: 0.12,
    scale: quality.aoScale,
    blur: quality.aoBlur,
  };
}

/** Renderer-side lookup: events carry ids, not object references. */
function enemyPosition(world: World, enemyId: number): { x: number; z: number } {
  for (const enemy of world.enemies) {
    if (enemy.id === enemyId) return { x: enemy.pos.x, z: enemy.pos.z };
  }
  return { x: world.player.pos.x, z: world.player.pos.z };
}
