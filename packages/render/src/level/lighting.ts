/**
 * Lighting rig.
 *
 * Phase 02 (ADR-0013) split the rig into three roles, because a single wash is
 * what made every material read the same:
 *
 *   moon key   cool, directional, the only shadow caster. It decides *form* —
 *              which facade is lit, which is in shadow, how a car body turns.
 *   sky/ground broad, cool and soft. The sky half models moonlight scattered by
 *              the sky; the ground half is warm sand bounce, which is the
 *              cheeriest light in a desert but must stay *below* the key or the
 *              scene flattens.
 *   artificial warm, local, steeply falling off. Lamps, windows, the firepit and
 *              the muzzle flash. These are what make a night scene read as night:
 *              a lamp-lit pool inside a cool moonlit field.
 *
 * Two numbers were wrong before this pass and both were measurements waiting to
 * happen (docs/ART_BIBLE.md):
 *  - The key was a *sunset* light (warm, high, 4.6 lux) with a warm beige sky
 *    dome and a warm fog, so nothing in the frame could be cool.
 *  - The lamp lights were 12 cd with decay 2, i.e. ~0.4 lux on the pavement
 *    5.4 m below them — 25x too dim to be visible against the moon. The lamps
 *    were objects with a glow sprite, exactly as the art review described.
 *
 * The `SunLight` addon is r186's two-cascade shadow light: cascades spend the
 * shadow map where it is looked at, and the addon texel-snaps the near slice so
 * it does not crawl while the player walks. Its position sets the direction (it
 * shines from its position toward the origin).
 */
import * as THREE from 'three';
import { SunLight } from 'three/addons/lights/SunLight.js';
import type { MapDef } from '@iron/content';
import type { QualitySettings } from '../quality';
import {
  keyDirection,
  keyElevationDeg,
  skyTextureFor,
  timePreset,
  TIME_PRESETS,
  type TimeOfDay,
  type TimeOfDayPreset,
} from './timeOfDay';

/** Which light group a debug toggle or a probe is talking about. */
export type LightGroup = 'key' | 'ambient' | 'lamps' | 'windows' | 'fire' | 'reflections';

export interface LightingRig {
  sun: SunLight;
  hemi: THREE.HemisphereLight;
  fire: THREE.PointLight;
  lamps: THREE.PointLight[];
  /** Pool of window lights, snapped to the nearest lit windows each frame. */
  windowLights: THREE.PointLight[];
  muzzle: THREE.PointLight;
  boom: THREE.PointLight;
  skyDome: THREE.Mesh;
  moonSprite: THREE.Sprite;
  /** The atmosphere this rig is currently running (level/timeOfDay.ts). */
  readonly timeOfDay: TimeOfDay;
  /** Swap the atmosphere in place: sky, key, ambient and artificial sources. */
  applyTimeOfDay(next: TimeOfDay, quality: QualitySettings): void;
  applyQuality(quality: QualitySettings): void;
  /**
   * Move the window-light pool onto the nearest window anchors. Windows further
   * away than the pool stay emissive-only, which is what makes a lit skyline
   * cheap: no light that shades nothing.
   */
  updateWindowLights(anchors: THREE.Vector3[], x: number, z: number): void;
  /** Debug A/B switch for one group (the lighting probes drive this). */
  setEnabled(group: LightGroup, enabled: boolean): void;
  /** Live state, for `__IV__.renderDebug()`. */
  state(): LightingState;
}

export interface LightingState {
  timeOfDay: TimeOfDay;
  key: { intensity: number; color: string; shadows: boolean; elevationDeg: number };
  ambient: { intensity: number; sky: string; ground: string };
  reflections: number;
  lamps: { count: number; lit: number; sample: { intensity: number; range: number } | null };
  windows: {
    anchors: number;
    lit: number;
    sample: { intensity: number; range: number } | null;
    /** Where the nearest lit window is, so a probe can aim at one (null = none). */
    nearest: { x: number; y: number; z: number } | null;
  };
  fire: { intensity: number };
  enabled: Record<LightGroup, boolean>;
}

/**
 * The moon's direction. Lower than the prototype's sun (elevation 33° instead of
 * 47°) on purpose: a high key lights every roof equally and flattens the street,
 * while a lower one throws long shadow lines across it — that is the "scene form
 * is revealed by the key" requirement, and it is the same reason films shoot at
 * golden hour rather than noon. Azimuth is unchanged from the prototype, so every
 * shadow direction in the parity record still holds.
 */
export const MOON_POSITION = {
  x: TIME_PRESETS.dusk.key.position[0],
  y: TIME_PRESETS.dusk.key.position[1],
  z: TIME_PRESETS.dusk.key.position[2],
};

/**
 * The rig's colours and its one rule, as data.
 *
 * Exported because "cool environment, warm local sources" is the kind of decision
 * that quietly decays: someone warms the key light for one screenshot and the night
 * scene is back to a single brown wash. `tests/unit/lighting.test.ts` asserts the
 * relationship (the moon is cooler than the lamps, by a real margin) against these
 * numbers rather than against a paragraph in a document.
 */
export const LIGHTING = {
  /** Moonlight: cool, slightly cyan. */
  moonColor: 0xbdd0f0,
  /** Sky half of the broad ambient — the same cool family as the moon. */
  skyColor: 0x59709f,
  /** Ground half: warm sand bounce, deliberately much less saturated than a lamp. */
  bounceColor: 0x6a5636,
  /** Warm end of the per-lamp variation, and its cooler end. */
  lampWarm: 0xffa851,
  lampCool: 0xffc98d,
  /** Window glow: warm, but dimmer and less saturated than a street lamp. */
  windowWarm: 0xffb877,
  windowCool: 0xffd2a0,
  /** The muzzle flash and the firepit keep the prototype's warm orange. */
  muzzle: 0xffc46b,
  moonPosition: MOON_POSITION,
} as const;
export function createLighting(
  scene: THREE.Scene,
  map: MapDef,
  quality: QualitySettings,
  timeOfDay: TimeOfDay = 'dusk',
): LightingRig {
  /**
   * The atmosphere, as a switchable input (level/timeOfDay.ts).
   *
   * Everything below that used to read a module constant — the key's colour,
   * direction and strength, the ambient's two colours, the sky gradient, whether the
   * lamps and windows are on, whether there are stars — reads this instead. That is
   * the whole difference between "the game is set at night" and "the game is set at
   * a time the player chose".
   */
  let preset: TimeOfDayPreset = timePreset(timeOfDay);

  const enabled: Record<LightGroup, boolean> = {
    key: true,
    ambient: true,
    lamps: true,
    windows: true,
    fire: true,
    reflections: true,
  };

  // Broad, cool, soft — the sky half is moonlight scattered by the sky and the
  // ground half is what the sand reflects back up. Kept low relative to the key:
  // an ambient that rivals the key is what removes the shadow side and flattens
  // every surface into the same value.
  // The colours come from the preset (a cool moonlit sky at dusk, a bright blue one
  // in the morning) while the *intensity* comes from the tier — the split that lets
  // a morning be brighter without letting a quality tier change the look.
  const hemi = new THREE.HemisphereLight(
    preset.ambient.sky,
    preset.ambient.ground,
    quality.ambientIntensity * preset.ambient.scale,
  );
  scene.add(hemi);

  const sun = new SunLight(preset.key.color, quality.keyIntensity * preset.key.scale);
  sun.position.set(...preset.key.position);
  sun.castShadow = quality.shadows;
  sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
  // Clamps the cascade range. Smaller = a tighter near split = crisper contact
  // shadows, at the cost of long shadows beyond it (the haze hides most of that).
  sun.shadow.camera.far = quality.shadowFar;
  sun.shadow.radius = quality.shadowRadius;
  // Below 1 on purpose: a fully black shadow loses the edge and surface detail of
  // whatever sits in it, and the ask is explicit — dark stays dark, not detail-less.
  sun.shadow.intensity = quality.shadowIntensity;
  // Texels are ~3 cm here, so the bias is metres-scale-small but a lot larger than
  // the old 170 m box needed; normalBias is what keeps thin geometry from acneing.
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.035;
  scene.add(sun);

  // The firepit: warm, local, and the one place in the arena where light is
  // genuinely orange. Its position comes from the map, not from taste.
  const fire = new THREE.PointLight(0xff8c3a, 40, 30, 2);
  fire.position.set(map.ambient.fireLight[0], map.ambient.fireLight[1], map.ambient.fireLight[2]);
  // A burning barrel is on fire at any hour; it is the one local source that does
  // not depend on someone having switched a light on.
  fire.visible = enabled.fire && preset.artificial.fire;
  scene.add(fire);

  // ---- street lamps -------------------------------------------------------
  // One real light per lamp prop, warm, with physical inverse-square falloff.
  // Intensity and reach vary *deterministically* per lamp (index hash, not
  // Math.random): identical lamps read as a light rig, slightly different ones
  // read as a street. A 300 cd lamp is not a large number for a street light —
  // at 5.4 m its pool is ~10 lux, about five times the moon on the pavement.
  const lamps: THREE.PointLight[] = [];
  /** How many window anchors the pool was last offered (reported by `state()`). */
  let windowAnchorCount = 0;
  /** The anchor the pool currently sits on, for `state()`. */
  let nearestWindow: THREE.Vector3 | null = null;
  const lampProps = map.props.filter((prop) => prop.kind === 'lamp');
  lampProps.forEach((prop, index) => {
    const warm = hash01(index * 7.13 + 1.7);
    const color = new THREE.Color(LIGHTING.lampWarm).lerp(new THREE.Color(LIGHTING.lampCool), warm);
    const base = 260 + warm * 140;
    const light = new THREE.PointLight(color, base * preset.glow.lampLightScale, 22 + warm * 10, 2);
    // The unscaled intensity is kept so a time-of-day switch can rescale the pool
    // without recomputing the per-lamp hash (level/timeOfDay.ts).
    light.userData.baseIntensity = base;
    // Directly under the head, which is offset 0.6 m along the lamp's own yaw.
    const ry = prop.ry ?? 0;
    light.position.set(prop.x + Math.cos(ry) * 0.6, 5.35, prop.z - Math.sin(ry) * 0.6);
    light.visible = preset.artificial.lamps && index < quality.lampLightBudget;
    scene.add(light);
    lamps.push(light);
  });

  // ---- window lights ------------------------------------------------------
  // Real lights, but only for the windows nearest the player. A lit skyline needs
  // emissive glass; it does not need 60 point lights shading 40 buildings nobody
  // can reach. The pool is repositioned every few frames (see updateWindowLights).
  const windowLights: THREE.PointLight[] = [];
  for (let i = 0; i < quality.windowLightBudget; i++) {
    const warm = hash01(i * 3.7 + 11.3);
    const light = new THREE.PointLight(
      new THREE.Color(LIGHTING.windowWarm).lerp(new THREE.Color(LIGHTING.windowCool), warm),
      10 + warm * 8,
      6.5 + warm * 2.5,
      2,
    );
    light.userData.baseIntensity = 10 + warm * 8;
    light.visible = false;
    scene.add(light);
    windowLights.push(light);
  }

  /**
   * The window pool's visibility, in one place.
   *
   * Three conditions have to agree — the debug toggle, the pool's own count, the
   * time of day and whether this slot has been given a window — and they used to be
   * written out at each of the three call sites, which is how one of them ends up
   * missing a term.
   */
  const applyWindowVisibility = (next: QualitySettings): void => {
    windowLights.forEach((light, index) => {
      light.visible =
        enabled.windows &&
        preset.artificial.windows &&
        index < next.windowLightBudget &&
        light.userData.active === true;
    });
  };

  const muzzle = new THREE.PointLight(LIGHTING.muzzle, 0, quality.muzzleLightRange, 2);
  scene.add(muzzle);

  const boom = new THREE.PointLight(0xff9a3a, 0, 36, 2);
  scene.add(boom);

  const sky = createSky(scene, preset, quality);

  return {
    sun,
    hemi,
    fire,
    lamps,
    windowLights,
    muzzle,
    boom,
    skyDome: sky.dome,
    moonSprite: sky.body,
    get timeOfDay(): TimeOfDay {
      return preset.id;
    },
    /**
     * Change the atmosphere in place: sky, key, ambient, haze inputs, artificial
     * sources.
     *
     * In place rather than by rebuilding, because the two rigs are the same objects
     * with different numbers — which is also what keeps a switch from recompiling
     * every material in the scene.
     */
    applyTimeOfDay(next: TimeOfDay, quality: QualitySettings): void {
      preset = timePreset(next);
      const domeMaterial = sky.dome.material as THREE.MeshBasicMaterial;
      domeMaterial.map = skyTextureFor(preset.id);
      domeMaterial.needsUpdate = true;
      if (sky.stars) sky.stars.visible = preset.artificial.stars;
      sky.body.material.color.setHex(preset.key.body.color);
      sky.body.material.opacity = preset.key.body.opacity;
      sky.body.scale.setScalar(preset.key.body.scale);
      sky.body.visible = preset.key.body.glow > 0;

      hemi.color.setHex(preset.ambient.sky);
      hemi.groundColor.setHex(preset.ambient.ground);
      hemi.intensity = quality.ambientIntensity * preset.ambient.scale;

      sun.color.setHex(preset.key.color);
      sun.intensity = quality.keyIntensity * preset.key.scale;
      sun.position.set(...preset.key.position);
      // The shadow cascades were texel-snapped for the old direction; a new key
      // direction has to invalidate them or the first frames after a switch show the
      // previous sun's shadows.
      sun.shadow.needsUpdate = true;

      lamps.forEach((light, index) => {
        light.intensity = (light.userData.baseIntensity as number) * preset.glow.lampLightScale;
        light.visible = enabled.lamps && preset.artificial.lamps && index < quality.lampLightBudget;
      });
      // Window lights are on only at dusk (`preset.artificial.windows`), so the pool
      // keeps the intensity it was built with; the visibility pass below is what
      // switches them.
      windowLights.forEach((light) => {
        light.intensity = light.userData.baseIntensity as number;
      });
      fire.visible = enabled.fire && preset.artificial.fire;
      applyWindowVisibility(quality);
    },
    applyQuality(next: QualitySettings): void {
      hemi.intensity = next.ambientIntensity * preset.ambient.scale;
      sun.intensity = next.keyIntensity * preset.key.scale;
      sun.castShadow = next.shadows;
      if (sun.shadow.mapSize.width !== next.shadowMapSize) {
        sun.shadow.mapSize.set(next.shadowMapSize, next.shadowMapSize);
        sun.shadow.map?.dispose();
        sun.shadow.map = null;
      }
      sun.shadow.radius = next.shadowRadius;
      sun.shadow.intensity = next.shadowIntensity;
      sun.shadow.camera.far = next.shadowFar;
      lamps.forEach((light, index) => {
        light.visible = enabled.lamps && preset.artificial.lamps && index < next.lampLightBudget;
      });
      muzzle.distance = next.muzzleLightRange;
      // A tier change can grow or shrink the window pool; rebuild-free, by setting
      // visibility rather than adding and removing lights (each add recompiles
      // every material that sees it).
      while (windowLights.length < next.windowLightBudget) {
        const warm = hash01(windowLights.length * 3.7 + 11.3);
        const light = new THREE.PointLight(
          new THREE.Color(LIGHTING.windowWarm).lerp(new THREE.Color(LIGHTING.windowCool), warm),
          10 + warm * 8,
          6.5 + warm * 2.5,
          2,
        );
        light.visible = false;
        scene.add(light);
        windowLights.push(light);
      }
      applyWindowVisibility(next);
    },
    updateWindowLights(anchors: THREE.Vector3[], x: number, z: number): void {
      windowAnchorCount = anchors.length;
      if (!windowLights.length) return;
      // Nearest `budget` windows by squared distance. The anchor list is a few
      // dozen entries, so a full sort per update is cheaper than maintaining a
      // spatial index for a pool of four.
      const ranked = anchors
        .map((anchor, index) => ({ index, d: (anchor.x - x) ** 2 + (anchor.z - z) ** 2 }))
        .sort((a, b) => a.d - b.d)
        .slice(0, windowLights.length);
      windowLights.forEach((light, slot) => {
        const pick = ranked[slot];
        if (!pick) {
          light.userData.active = false;
          light.visible = false;
          return;
        }
        const anchor = anchors[pick.index]!;
        if (slot === 0) nearestWindow = anchor;
        light.position.copy(anchor);
        light.userData.active = true;
        light.visible = enabled.windows && preset.artificial.windows;
      });
    },
    setEnabled(group: LightGroup, on: boolean): void {
      enabled[group] = on;
      switch (group) {
        case 'key':
          sun.visible = on;
          break;
        case 'ambient':
          hemi.visible = on;
          break;
        case 'lamps':
          lamps.forEach((light, index) => {
            light.visible = on && preset.artificial.lamps && index < quality.lampLightBudget;
          });
          break;
        case 'windows':
          windowLights.forEach((light) => {
            light.visible = on && preset.artificial.windows && light.userData.active === true;
          });
          break;
        case 'fire':
          fire.visible = on && preset.artificial.fire;
          break;
        case 'reflections':
          scene.environmentIntensity = on ? quality.environmentIntensity : 0;
          break;
      }
    },
    state(): LightingState {
      return {
        timeOfDay: preset.id,
        key: {
          intensity: sun.intensity,
          color: `#${sun.color.getHexString()}`,
          shadows: sun.castShadow,
          elevationDeg: Number(keyElevationDeg(preset).toFixed(1)),
        },
        ambient: {
          intensity: hemi.intensity,
          sky: `#${hemi.color.getHexString()}`,
          ground: `#${hemi.groundColor.getHexString()}`,
        },
        reflections: scene.environmentIntensity,
        lamps: {
          count: lamps.length,
          lit: lamps.filter((light) => light.visible).length,
          sample: lamps[0] ? { intensity: lamps[0].intensity, range: lamps[0].distance } : null,
        },
        windows: {
          anchors: windowAnchorCount,
          lit: windowLights.filter((light) => light.visible).length,
          sample: windowLights[0]
            ? { intensity: windowLights[0].intensity, range: windowLights[0].distance }
            : null,
          // A snapshot, not a live handle: the debug API must not hand out an
          // object the renderer then moves (ADR-0009).
          nearest: nearestWindow
            ? { x: nearestWindow.x, y: nearestWindow.y, z: nearestWindow.z }
            : null,
        },
        fire: { intensity: fire.intensity },
        enabled: { ...enabled },
      };
    },
  };
}

/**
 * Deterministic 0..1 hash of a light index.
 *
 * Used instead of `Math.random` so a given lamp keeps its intensity between runs:
 * the art review has to see the same street twice, and a capture comparison must
 * not differ by the light rig re-randomising itself.
 */
function hash01(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * The night sky, as a gradient.
 *
 * Cooled from the prototype's sunset (legacy/PARITY_NOTES.md): the sky was the
 * single largest source of the warm wash, because it is both the background and
 * the image-based lighting every material reflects. A thin warm band survives
 * just above the horizon — that is city glow, and without it a night sky reads as
 * a flat blue-grey card.
 */
/**
 * The sky: a gradient dome, the stars, and the key's disc.
 *
 * All three come from the preset, and all three are returned so `applyTimeOfDay`
 * can switch them without rebuilding the scene. The stars are built at *every* tier
 * now — they used to be skipped on `low`, which made a tier change the look, which
 * is the one thing ADR-0014 forbids — and their visibility is the preset's business
 * (a morning has none).
 */
function createSky(
  scene: THREE.Scene,
  preset: TimeOfDayPreset,
  quality: QualitySettings,
): { dome: THREE.Mesh; stars: THREE.Points | null; body: THREE.Sprite } {
  const geometry = new THREE.SphereGeometry(470, 24, 16);
  const material = new THREE.MeshBasicMaterial({
    map: skyTextureFor(preset.id),
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
  });
  const dome = new THREE.Mesh(geometry, material);
  dome.renderOrder = -1;
  scene.add(dome);

  const positions: number[] = [];
  for (let i = 0; i < 320; i++) {
    const v = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 0.75 + 0.25, Math.random() * 2 - 1)
      .normalize()
      .multiplyScalar(440);
    positions.push(v.x, v.y, v.z);
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const stars = new THREE.Points(
    starGeometry,
    new THREE.PointsMaterial({
      color: 0xe8eeff,
      size: 1.7,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.7,
      fog: false,
      depthWrite: false,
    }),
  );
  stars.visible = preset.artificial.stars;
  scene.add(stars);

  const body = createKeyBody(scene, preset);

  void quality;
  return { dome, stars, body };
}

/**
 * The sun (or the moon): one sprite, along the key's direction.
 *
 * Along the direction rather than at a typed-in position, because the disc and the
 * shadow it casts have to agree: a moon on the left and shadows falling to the right
 * is the kind of thing nobody can describe but everybody notices.
 */
function createKeyBody(scene: THREE.Scene, preset: TimeOfDayPreset): THREE.Sprite {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: softDisc(),
      color: preset.key.body.color,
      transparent: true,
      opacity: preset.key.body.opacity,
      fog: false,
      depthWrite: false,
    }),
  );
  sprite.scale.setScalar(preset.key.body.scale);
  sprite.visible = preset.key.body.glow > 0;
  sprite.position.copy(keyDirection(preset).multiplyScalar(430));
  scene.add(sprite);
  return sprite;
}

/**
 * Image-based lighting from the sky itself.
 *
 * This is the biggest realism lever in the renderer: with only analytic lights,
 * metal reflects nothing and reads as flat grey plastic. Baking the *night* sky
 * (plus the moon disc) into a PMREM cube means every metal surface picks up the
 * cool horizon ramp for free, and `envMapIntensity` per material decides how much
 * of it that surface is entitled to. It is also the honest answer to "bounce
 * light is missing": on a GPU budget measured in milliseconds, reflected sky is
 * the bounce, and it costs one cubemap.
 */
export function createSkyEnvironment(
  renderer: THREE.WebGLRenderer,
  timeOfDay: TimeOfDay = 'dusk',
): THREE.Texture {
  const preset = timePreset(timeOfDay);
  const generator = new THREE.PMREMGenerator(renderer);
  const capture = new THREE.Scene();
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(10, 32, 16),
    new THREE.MeshBasicMaterial({ map: skyTextureFor(preset.id), side: THREE.BackSide }),
  );
  capture.add(dome);
  // A small blob where the key is: a bare gradient gives metals no directional
  // highlight at all, which is what makes them look painted. Colour and strength
  // follow the body, so a morning metal reflects a sun and a night one a moon.
  const moon = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: softDisc(),
      color: preset.key.body.color,
      transparent: true,
      opacity: preset.key.body.opacity,
      depthWrite: false,
    }),
  );
  moon.scale.setScalar(5.5);
  // Same direction as the key light, so the highlight in a reflection agrees with
  // the shadow it casts.
  moon.position.copy(keyDirection(preset).multiplyScalar(10));
  capture.add(moon);

  const environment = generator.fromScene(capture, 0.02).texture;
  generator.dispose();
  dome.geometry.dispose();
  (dome.material as THREE.Material).dispose();
  (moon.material as THREE.Material).dispose();
  return environment;
}

/**
 * The dusk sky's body, kept as a named export for the debug surface.
 *
 * The rig creates its own body from the active preset (`createKeyBody`); this is the
 * moon on its own, which the parity record and the harness refer to by name.
 */
export function createMoonSprite(scene: THREE.Scene): THREE.Sprite {
  return createKeyBody(scene, TIME_PRESETS.dusk);
}

let discTexture: THREE.CanvasTexture | null = null;

/** A radial falloff disc, so the moon is a soft body rather than a hard sprite. */
function softDisc(): THREE.CanvasTexture {
  if (discTexture) return discTexture;
  const size = 64;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.85)');
  grd.addColorStop(0.7, 'rgba(255,255,255,0.22)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  discTexture = new THREE.CanvasTexture(c);
  discTexture.colorSpace = THREE.SRGBColorSpace;
  return discTexture;
}
