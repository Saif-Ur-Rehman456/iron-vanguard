/**
 * Procedural texture library — still the zero-asset baseline (ADR-0006), now with
 * a full PBR set per surface (see `pbr.ts`).
 *
 * Every material asks for a *named* surface, never for a loose texture, so the M2
 * art pipeline can replace one surface with a scanned/KTX2 set without touching a
 * single call site. Nothing here is downloaded; the whole library is generated in
 * a few milliseconds at boot, which is why the single-file artifact has no
 * binaries to carry.
 */
import * as THREE from 'three';
import { surface, disposeSurface, type SurfaceMaps, type SurfaceOptions } from './pbr';
import { SURFACE_SPEC, type SurfaceClass } from './surfaces';

export type { SurfaceMaps } from './pbr';

/**
 * The `surface()` options a class's spec implies, so its numbers live in one place.
 *
 * Every recipe below calls this instead of restating its own roughness and relief: the
 * physical identity is `SURFACE_SPEC` (ADR-0020), and the recipe owns only the *drawing* —
 * what the surface is made of, at which scale.
 */
function optionsFor(key: SurfaceClass, extra: SurfaceOptions = {}): SurfaceOptions {
  const spec = SURFACE_SPEC[key];
  return {
    relief: spec.relief,
    roughness: spec.roughness,
    roughnessVariation: spec.roughnessVariation,
    roughnessField: spec.roughnessField,
    metalness: spec.metalness,
    // How strongly each of the recipe's three layers speaks. The recipe decides the *shape*
    // of a layer and the class decides its amplitude (ADR-0020), which is what keeps "sand's
    // story is large-scale" and "a painted panel has almost no grain" in one place.
    layers: spec.layers,
    ...extra,
  };
}

export interface SurfaceLibrary {
  /** Plaza paving stones. */
  ground: SurfaceMaps;
  /** Asphalt with painted markings bleeding through. */
  asphalt: SurfaceMaps;
  /** Wind-blown sand: compacted, drifted, and cut by traffic. */
  sand: SurfaceMaps;
  /** A car's painted panels: a clean coat, its dirt placed rather than tiled. */
  carPaint: SurfaceMaps;
  /** Poured concrete: walls, barriers, monuments. */
  concrete: SurfaceMaps;
  /** Plaster over masonry, stained and patched. */
  plaster: SurfaceMaps;
  /** Weathered stone / sandbagged blockwork. */
  stone: SurfaceMaps;
  /** Ammo crates: planked wood with banding. */
  wood: SurfaceMaps;
  /** Hessian sandbags, woven. */
  sandbag: SurfaceMaps;
  /** Painted steel, scratched to the primer. */
  steel: SurfaceMaps;
  /** Weapon-grade dark metal: fine machining marks, oiled. */
  gunmetal: SurfaceMaps;
  /** Injection-moulded polymer furniture, stippled. */
  polymer: SurfaceMaps;
  /** Tyre rubber with tread blocks. */
  rubber: SurfaceMaps;
  /** The same tyre's sidewall: smoother, moulded, and dusted. */
  tireSidewall: SurfaceMaps;
  /** Uniform ripstop fabric. */
  fabric: SurfaceMaps;
  /** Gloves and boots. */
  leather: SurfaceMaps;
  /** Exposed skin. */
  skin: SurfaceMaps;
  /** Corroded sheet metal. */
  rust: SurfaceMaps;
  dispose(): void;
}

export interface TextureLibrary {
  surfaces: SurfaceLibrary;
  buildings: SurfaceMaps[];
  soft: THREE.CanvasTexture;
  muzzleFlash: THREE.CanvasTexture;
  sky: THREE.CanvasTexture;
  decal: THREE.CanvasTexture;
  dispose(): void;
}

function canvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

function sprite(element: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(element);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

/** Plaza paving: 4x4 flags, mortar joints, worn traffic lanes. */
function paving(seed: number): SurfaceMaps {
  return surface(
    {
      seed,
      // 1024, not 512. This is the surface the player stands on and looks *down* at,
      // and `UV_DENSITY.plazaFloor` is 2.6 m per tile: at 512² that is 5.1 mm per
      // texel against ~2 mm per screen pixel at three metres, i.e. the ground was
      // 2.5x softer than the display could show. 1024² puts it at 2.5 mm and costs
      // 20 MB of texture, which is the cheapest sharpness in the build (ADR-0017).
      size: 1024,
      repeat: 8,
      // 16x, not 8: the plaza is 400 m of paving seen at a grazing angle, which is
      // the worst case for a mip chain — at 8 samples the fine flag grain still
      // shimmered into a speckle carpet as the player walked (the review's "the
      // ground looks like static").
      anisotropy: 16,
      draw: (s) => {
        s.fill(0x6f675a, 0.5);
        for (let row = 0; row < 4; row++) {
          for (let col = 0; col < 4; col++) {
            const shade = 0.86 + s.random() * 0.3;
            const tone = new THREE.Color(0x6f675a).multiplyScalar(shade);
            // Each flag sits a hair proud of its neighbours and is its own tone:
            // identical tiles are the fastest way to look computer-generated.
            s.rect(col / 4 + 0.006, row / 4 + 0.006, 0.238, 0.238, {
              color: tone.getHex(),
              relief: 0.54 + s.random() * 0.06,
            });
            s.speckles(24, { color: 0x8d8577, alpha: 0.06, radius: [0.004, 0.02], relief: 0.02 });
          }
        }
        s.seams('y', 0.25, { width: 0.01, depth: -0.3, color: 0x241f18 });
        s.seams('x', 0.25, { width: 0.01, depth: -0.3, color: 0x241f18 });
        // ---- macro: the plaza's own history (ADR-0020) --------------------------
        // Two kinds of large-scale story, and they move roughness the opposite way: the
        // polish that thousands of pairs of boots leave on the walking lines is
        // *smoother* and slightly lighter, and the weathering and staining between them
        // is rougher. That pair is why the floor no longer reads as one even surface.
        s.macro(7, { color: 0x8f8776, alpha: 0.07, rough: -0.22, relief: 0.02, radius: [0.22, 0.5] });
        s.macro(6, { color: 0x352f27, alpha: 0.1, rough: 0.3, relief: -0.02, radius: [0.18, 0.42] });
        s.cracks(4, { depth: 0.3 });
        // ---- mid: what collects *against* the joints ---------------------------
        s.mid(26, { color: 0x2a251e, alpha: 0.07, rough: 0.18, radius: [0.02, 0.08], power: 3 });
        // A flag at 65 cm is a surface things are dragged across, and a drag mark is a
        // directional smooth band rather than a random blotch.
        s.scuffs(6, { angle: 0.35, alpha: 0.1, rough: -0.12, width: 0.006, length: [0.15, 0.4] });
        s.streaks(10, { alpha: 0.16, relief: 0.05 });
        s.wearEdges({ smoother: 0.22, color: 0x9c9484, alpha: 0.18 });
        // Halved at 1024²: the grain is per-pixel, so doubling the resolution doubles
        // the frequency of the finest term. Kept as it was, a plaza floor would have
        // arrived at the review as *finer* static than before, which is the opposite
        // of what a higher-resolution surface is for (ADR-0017).
        s.micro(0.028, { relief: 0.02, rough: 0.05 });
      },
    },
    optionsFor('ground'),
  );
}

/**
 * Wet-ish asphalt: aggregate, patches, and a sheen on the polished wheel tracks.
 *
 * Two numbers in here were the whole of the eighth report's second image (*"zameen kaise
 * hai"* — a near-black road covered in a field of bright speckles): the surface was
 * drawing its aggregate *smaller than a texel*, and its albedo was half of real asphalt's.
 *
 *  - **1024, not 512.** At 512² over a 3 m tile one texel is 5.9 mm — about three screen
 *    pixels at the distance the player stands from it — and asphalt's stones are 5-15 mm,
 *    i.e. *sub-texel*. You cannot draw a stone smaller than the grid you are drawing on;
 *    what comes out is a per-texel spike. At 2.9 mm per texel the stones are 2-5 texels and
 *    can be drawn as stones. This is the same correction the paving got (ADR-0017) on the
 *    other surface the camera looks down at.
 *  - **The relief is a bulge, not a cliff.** The stones used to carry relief 0.06/-0.04 at
 *    1.5-5.6 px, which the normal map turns into a 30-45° tilt every ~2 texels: a field of
 *    miniature mirrors over a near-black surface. That is specular aliasing, and it measured
 *    as 4x the plaza's high-frequency energy and a glint on 4.3% of the road's pixels. A
 *    stone is read by its *colour*; its relief is a gentle bulge (0.02).
 */
function asphalt(seed: number): SurfaceMaps {
  return surface(
    {
      seed,
      size: 1024,
      repeat: 6,
      anisotropy: 16,
      draw: (s) => {
        // 0x2e2c29 is linear 0.027; real asphalt is 0.05-0.10, and a road sitting at 0.027
        // samples about 1% of the frame's light at dusk. That is the *black* half of the
        // report — and it amplifies the other half, because a specular glint on a near-black
        // surface is the highest-contrast event in the image. Dark, but not a hole.
        s.fill(0x3f3c36, 0.5);
        // The aggregate is a *mottle*, not confetti. At alpha 0.18 against a base this dark, an
        // individual stone was a 6% step in the albedo — which at 4-12 px is a speckle field the
        // eye reads as noise, and it was most of what was left of the road's high-frequency
        // energy after the relief came down. Real asphalt's stones are a value variation you
        // have to look for; the texture's *shape* comes from the patches and the cracks.
        s.speckles(3000, { color: 0x5a554e, alpha: 0.1, radius: [0.005, 0.014], relief: 0.012 });
        s.speckles(1800, { color: 0x272320, alpha: 0.14, radius: [0.006, 0.016], relief: -0.01 });
        // ---- macro: repairs and old asphalt --------------------------------
        // A patch of fresh bitumen is *darker, smoother and flatter* than the asphalt
        // around it, and traffic-polished lanes are darker again. Both are large-scale
        // statements; neither existed before, which is why a 124 m road read as one
        // carpet of aggregate at every distance.
        s.macro(5, { color: 0x1c1a18, alpha: 0.15, rough: -0.25, relief: -0.05, radius: [0.25, 0.6] });
        s.macro(4, { color: 0x4a443c, alpha: 0.08, rough: 0.28, radius: [0.2, 0.45] });
        // ---- mid: tar seams, cracked edges, aggregate loss -------------------
        s.cracks(6, { depth: 0.34, segments: 6 });
        s.mid(14, { color: 0x100e0c, alpha: 0.12, rough: 0.3, relief: -0.04, radius: [0.03, 0.12] });
        // ---- directional: the wheel tracks ----------------------------------
        // Asphalt is polished along the direction the traffic travels, so the wear is a
        // *direction*, not a texture. Long, smooth, slightly sunk bands; the road planes
        // are UV'd in metres, so these run with the road whatever its rotation.
        s.scuffs(22, { angle: 0, alpha: 0.16, rough: -0.3, relief: -0.03, width: 0.01, length: [0.3, 0.9] });
        s.streaks(6, { alpha: 0.2, relief: 0.04 });
        // Halved with the resolution, for the reason ADR-0017 gives: the grain is per-pixel,
        // so doubling the texture doubles the *frequency* of the finest term. At 0.05 this
        // one term was a 44° normal perturbation between neighbouring texels — the sparkle
        // field, isolated: the paving, which reads cleanly, carries 0.02 at a comparable
        // density. Fine sand is a grain in the *albedo* first and a bulge a distant second.
        s.micro(0.03, { relief: 0.016, rough: 0.06 });
      },
    },
    optionsFor('asphalt'),
  );
}

/**
 * Sand: a granular surface whose story is almost entirely *large* scale.
 *
 * The seventh report's point about sand was that it was beige with a grain on it, and the
 * fix is not a finer grain: it is compaction, drift and traffic. Macro patches of compacted
 * (darker, slightly smoother, flatter) sand against loose (lighter, rougher, puffed) sand;
 * mid-scale tracks across it; and the finest grain only as the last layer.
 */
function sand(seed: number): SurfaceMaps {
  return surface(
    {
      seed,
      size: 512,
      repeat: 4,
      anisotropy: 16,
      draw: (s) => {
        s.fill(0x8a7a5e, 0.5);
        // Compacted ground: where people and vehicles have been, the grains lock.
        s.macro(9, { color: 0x6b5d45, alpha: 0.16, rough: -0.3, relief: -0.06, radius: [0.2, 0.5] });
        // Loose drift: wind-blown, lighter, rougher, and a little prouder.
        s.macro(7, { color: 0xa89574, alpha: 0.14, rough: 0.22, relief: 0.06, radius: [0.16, 0.42] });
        // Ripples and tracks at the mid scale, running one way (the wind's, or a wheel's).
        s.mid(18, { color: 0x7a6b50, alpha: 0.09, rough: -0.1, relief: -0.02, radius: [0.03, 0.11], power: 3 });
        s.scuffs(14, { angle: 0.2, alpha: 0.12, rough: -0.2, relief: -0.04, width: 0.012, length: [0.2, 0.7] });
        // Coarse fraction: the grit and small stones that collect in the hollows.
        s.speckles(900, { color: 0x9c8a68, alpha: 0.1, radius: [0.002, 0.006], relief: 0.05 });
        s.speckles(160, { color: 0x4f4534, alpha: 0.14, radius: [0.002, 0.005], relief: -0.06 });
        s.micro(0.05, { relief: 0.05, rough: 0.07 });
      },
    },
    optionsFor('sand'),
  );
}

/** Poured concrete: form-board seams, tie holes, chipped corners, splash stains. */
function concrete(seed: number): SurfaceMaps {
  return surface(
    {
      seed,
      size: 512,
      repeat: 4,
      draw: (s) => {
        s.fill(0x6e6759, 0.5);
        // Macro: the pale bloom of a weathered pour and the dark water staining below it.
        // The two are the same event seen twice — water carries lime down a wall and
        // leaves it behind — so they get matching but opposite roughness.
        s.macro(8, { color: 0x8b8375, alpha: 0.09, rough: 0.06, relief: 0.03, radius: [0.2, 0.5] });
        s.macro(6, { color: 0x3b362e, alpha: 0.13, rough: 0.18, radius: [0.22, 0.5] });
        // Form boards leave horizontal seams; tie holes are the small dark dots.
        s.seams('x', 0.5, { width: 0.006, depth: -0.16, color: 0x3a352d });
        s.speckles(26, { color: 0x2b2721, alpha: 0.5, radius: [0.006, 0.01], relief: -0.12 });
        // Mid: localised grime and the granular loss at a chipped corner.
        s.mid(20, { color: 0x4a443a, alpha: 0.1, rough: 0.2, radius: [0.02, 0.09], power: 3 });
        s.cracks(5, { depth: 0.3 });
        s.streaks(12, { alpha: 0.28, relief: 0.06 });
        // Chipped proud edges: lighter, and *smoother* than the faces — an exposed aggregate
        // edge is a rubbed edge. Concretely: this is what gives a kerb or a barrier corner
        // a highlight instead of a flat silhouette (the review's "too texture-driven, not
        // material-driven").
        s.wearEdges({ smoother: 0.3, color: 0xb3a999, alpha: 0.22 });
        s.micro(0.05, { relief: 0.04, rough: 0.06 });
      },
    },
    optionsFor('concrete', { occlusion: 0.6 }),
  );
}

/** Painted plaster over masonry: patches, hairline cracks, more colour variation. */
function plaster(seed: number): SurfaceMaps {
  return surface(
    {
      seed,
      size: 512,
      repeat: 3,
      draw: (s) => {
        s.fill(0x8a7f6c, 0.5);
        // Macro: patches of later repaint, blurred into the wall by weather. A repaint is
        // *smoother* (it is fresh plaster) and slightly lighter, and it is large — this is
        // the layer that makes a wall read as a wall someone has maintained.
        s.macro(9, { color: 0x9c9280, alpha: 0.13, rough: -0.16, relief: 0.03, radius: [0.16, 0.42] });
        s.macro(7, { color: 0x5d5344, alpha: 0.12, rough: 0.2, radius: [0.18, 0.4] });
        s.cracks(9, { depth: 0.26, segments: 6 });
        // Mid: where the plaster has blown and come away — rougher and sunken.
        s.mid(22, { color: 0x6b6153, alpha: 0.16, rough: 0.25, relief: -0.06, radius: [0.02, 0.07], power: 3 });
        s.speckles(40, { color: 0x4f4738, alpha: 0.3, radius: [0.004, 0.016], relief: -0.1 });
        s.streaks(10, { alpha: 0.22, relief: 0.05 });
        s.wearEdges({ smoother: 0.2, color: 0xa89d88, alpha: 0.16 });
        s.micro(0.045, { relief: 0.035, rough: 0.05 });
      },
    },
    optionsFor('plaster'),
  );
}

/** Cut stone: ashlar courses with chiselled faces. */
function cutStone(seed: number): SurfaceMaps {
  return surface(
    {
      seed,
      size: 512,
      repeat: 3,
      draw: (s) => {
        s.fill(0x8a8172, 0.5);
        for (let row = 0; row < 6; row++) {
          const offset = row % 2 === 0 ? 0 : 0.083;
          for (let col = 0; col < 6; col++) {
            const tone = new THREE.Color(0x8a8172).multiplyScalar(0.85 + s.random() * 0.3);
            s.rect(col / 6 + offset + 0.004, row / 6 + 0.004, 0.158, 0.158, {
              color: tone.getHex(),
              relief: 0.53 + s.random() * 0.07,
            });
          }
        }
        s.seams('x', 1 / 6, { width: 0.012, depth: -0.34, color: 0x2b261d });
        s.seams('y', 1 / 6, { width: 0.012, depth: -0.34, color: 0x2b261d });
        s.speckles(60, { color: 0xb5ab97, alpha: 0.1, radius: [0.004, 0.014], relief: 0.03 });
        // Cut stone weathers course by course: whole bands of the wall are darker and
        // damper than their neighbours, which is a macroscale statement, and the chisel
        // marks inside a block are the mid one.
        s.macro(7, { color: 0x6b6355, alpha: 0.12, rough: 0.18, radius: [0.2, 0.46] });
        s.mid(18, { color: 0x9a9384, alpha: 0.12, rough: -0.14, relief: 0.03, radius: [0.02, 0.08], power: 3 });
        s.wearEdges({ smoother: 0.28, color: 0xb8b0a0, alpha: 0.2 });
        s.micro(0.05, { relief: 0.04, rough: 0.06 });
      },
    },
    optionsFor('stone'),
  );
}

/** Ammo crates: planks, steel banding, stencilled stencil paint. */
function planks(seed: number): SurfaceMaps {
  return surface(
    {
      seed,
      size: 512,
      repeat: 1,
      draw: (s) => {
        s.fill(0x7a5c34, 0.5);
        for (let i = 0; i < 7; i++) {
          const tone = new THREE.Color(0x7a5c34).multiplyScalar(0.82 + s.random() * 0.34);
          s.rect(0, i / 7 + 0.004, 1, 0.138, { color: tone.getHex(), relief: 0.5 + s.random() * 0.1 });
          // Grain lines along the plank.
          for (let k = 0; k < 14; k++) {
            s.rect(s.random(), i / 7 + 0.01 + s.random() * 0.12, s.range(0.1, 0.5), 0.004, {
              color: 0x513a1d,
              relief: -0.02,
              alpha: 0.4,
            });
          }
        }
        s.seams('y', 1 / 7, { width: 0.008, depth: -0.3, color: 0x241708 });
        s.rect(0, 0.42, 1, 0.03, { color: 0x4a4640, relief: 0.62 }); // steel band
        s.rect(0, 0.1, 1, 0.03, { color: 0x4a4640, relief: 0.62 });
        s.cracks(3, { depth: 0.2, color: 0x2a1c0c });
        s.grain(0.06, { relief: 0.05 });
        s.wash(0x1b1206, 0.12);
      },
    },
    { relief: 1.3, roughness: 0.84, roughnessVariation: 0.3 },
  );
}

/** Hessian: a woven grid with fraying and dust. */
function hessian(seed: number): SurfaceMaps {
  return surface(
    {
      seed,
      size: 256,
      repeat: 2,
      draw: (s) => {
        s.fill(0x8c7d55, 0.5);
        for (let i = 0; i < 64; i++) {
          s.rect(i / 64, 0, 0.008, 1, { color: 0x6f6440, relief: i % 2 ? 0.56 : 0.46, alpha: 0.7 });
          s.rect(0, i / 64, 1, 0.008, { color: 0x736844, relief: i % 2 ? 0.46 : 0.56, alpha: 0.7 });
        }
        s.speckles(500, { color: 0xa89669, alpha: 0.12, radius: [0.004, 0.01], relief: 0.03 });
        s.streaks(8, { alpha: 0.2, relief: 0.04 });
        s.grain(0.05, { relief: 0.04 });
      },
    },
    { relief: 0.9, roughness: 1, roughnessVariation: 0.15, occlusion: 0.45 },
  );
}

/** Painted steel: chipped to the primer, streaked with rust. */
function paintedSteel(seed: number, base: number): SurfaceMaps {
  return surface(
    {
      seed,
      size: 256,
      repeat: 1,
      draw: (s) => {
        s.fill(base, 0.5);
        // The paint is a *film over a conductor*, so the metalness field goes down across
        // the whole panel and comes back up only where the paint has gone. That is what
        // turns "chipped paint" from a lighter patch of colour into a change of material —
        // the chip reflects the sky, the paint around it does not (ADR-0020).
        s.rect(0, 0, 1, 1, { metal: -0.88, rough: 0.04 });
        s.macro(6, { color: 0x000000, alpha: 0.12, rough: 0.12, radius: [0.15, 0.42] });
        // Chips and stone strikes, both of which *remove* the film: rougher, and metal again.
        s.mid(26, { color: 0x6b3a22, alpha: 0.5, rough: 0.35, metal: 0.85, radius: [0.006, 0.022], power: 3 });
        s.mid(30, { color: 0xc9bfae, alpha: 0.22, rough: 0.2, metal: 0.8, radius: [0.004, 0.011], power: 3 });
        // Scratches run one way; the flecks of primer along them are the mid scale.
        s.scuffs(8, { angle: 0.1, alpha: 0.22, rough: 0.12, metal: 0.7, color: 0xd8d2c6, width: 0.003, length: [0.05, 0.25] });
        s.streaks(10, { color: 0x5a3a22, alpha: 0.3, relief: 0.03 });
        // Worn edges rub through first, and a rubbed edge is smoother than the panel: this
        // is where a painted gate or a lamp post gets its highlight instead of a flat panel.
        s.wearEdges({ smoother: 0.18, metallic: 0.9, color: 0xcfc7b8, alpha: 0.3 });
        s.micro(0.04, { relief: 0.03, rough: 0.04 });
      },
    },
    optionsFor('steel'),
  );
}

/** Weapon metal: fine machining marks, anodised, oiled highlights. */
function machinedMetal(seed: number, base: number, roughness: number): SurfaceMaps {
  return surface(
    {
      seed,
      // 512, not 256. The receiver is the most-inspected surface in the game — the
      // camera sits 40 cm from it for the whole mission — and its tile is 8 cm, so
      // 256² put a texel at 310 µm while the recipe below drew its machining marks
      // 0.4–1.3 texels tall. A feature smaller than the texel that draws it does not
      // render as a feature; it renders as noise, and (because the marks carried
      // relief) as a field of miniature mirrors — the stair-step banding on every
      // weapon close-up. It is the road's aggregate bug (ADR-0022) one surface
      // later, with the same cure: draw nothing smaller than ~2 texels, and put the
      // finest energy in per-pixel grain instead of geometry.
      size: 512,
      repeat: 1,
      draw: (s) => {
        s.fill(base, 0.5);
        // Lathe chatter: a receiver is cut in passes, but at game distance the marks
        // live in the *roughness* field and the sheen, not in wide albedo bands — a
        // hard dark band every few millimetres reads as corrugated cardboard, which
        // is what the first rewrite of this recipe did. So: many, thin (still above
        // the texel floor), faint in colour, and shallow in relief. The `scuffs`
        // below carry the visible directionality.
        for (let i = 0; i < 40; i++) {
          s.rect(0, s.random(), 1, s.range(0.003, 0.006), {
            color: s.pick([0x20242a, 0x282d33]),
            relief: s.range(-0.02, 0.02),
            alpha: 0.1,
          });
        }
        // Machining marks run one way because a cutter does, and the oil that keeps a weapon
        // proofed sits in the *recesses*: rougher there, and glossier on the high spots the
        // shooter's hands polish. A direction and two fields, and the metal stops being a
        // single grey value at any distance. The scuffs are wobble-stroked patches, so the
        // finest linear detail survives where a hard-edged rect would alias.
        s.scuffs(40, { angle: 0, alpha: 0.22, rough: -0.1, relief: 0.02, color: 0x878d95, width: 0.004, length: [0.3, 1] });
        s.macro(5, { color: 0x14171a, alpha: 0.18, rough: 0.22, radius: [0.18, 0.4] });
        s.mid(16, { color: 0x5a6068, alpha: 0.12, rough: -0.25, relief: 0.02, radius: [0.02, 0.07], power: 3 });
        s.speckles(48, { color: 0x8b9199, alpha: 0.14, radius: [0.003, 0.008] });
        s.micro(0.03, { relief: 0.04, rough: 0.05 });
      },
    },
    // Relief 0.28, not 0.4: the amplitude is applied per-texel, and a 512² field with
    // the old gain doubled the normal-map slope on everything the resolution made
    // sharper. The metal keeps its machining marks; the marks stop shouting.
    optionsFor('gunmetal', { relief: 0.28, roughness }),
  );
}

/** Stippled polymer: the pebbled grip texture on modern furniture. */
function stippledPolymer(seed: number, base: number): SurfaceMaps {
  return surface(
    {
      seed,
      // 512 for the same reason the weapon metal is: the grip sits under the player's
      // thumb at 40 cm, and 256² drew its pebbles 2 texels across at near-full relief —
      // speckle that reads as grit on the magazine rather than as moulded polymer.
      size: 512,
      repeat: 1,
      draw: (s) => {
        s.fill(base, 0.5);
        // A real pebble on a stippled grip is 1–2 mm; at 7 cm per tile and 512² that is
        // 7–15 texels, so each one is drawn as a *dome* (patch, soft falloff) rather
        // than as a 2 px hard-edged rect. Fewer, prouder, softer: that is what reads as
        // moulded texture under a thumb instead of as noise.
        for (let i = 0; i < 2600; i++) {
          const x = s.random();
          const y = s.random();
          s.patch(x, y, s.range(0.008, 0.016), {
            color: s.pick([0x1b1a18, 0x4a4741, 0x35322d]),
            relief: s.range(0.3, 0.5),
            alpha: 0.5,
            power: 2,
          });
        }
        s.grain(0.04, { relief: 0.04 });
      },
    },
    { relief: 0.7, roughness: 0.78, roughnessVariation: 0.15 },
  );
}

/** Tyre rubber: tread blocks across the crown. */
function tread(seed: number): SurfaceMaps {
  return surface(
    {
      seed,
      size: 256,
      repeat: 2,
      draw: (s) => {
        s.fill(0x141414, 0.5);
        // A tyre is two different surfaces: the crown's tread blocks, which are rougher and
        // full of road grit, and the sidewall, which is nearly smooth (see `tireSidewall`).
        // The blocks themselves are *crisp* — a tread edge is a moulded edge, not a bruise —
        // so they are rectangles, and the roughness field marks the grooves.
        for (let i = 0; i < 18; i++) {
          s.rect(0, i / 18 + 0.006, 1, 0.036, { color: 0x0a0a0a, relief: 0.58, rough: 0.12 });
          s.rect(0, i / 18, 1, 0.012, { color: 0x000000, relief: 0.34, rough: -0.1 });
        }
        // Road grit pressed into the rubber, and the wear line where the tread is polished
        // by the road: two mid-scale stories on a surface that had none.
        s.mid(22, { color: 0x3a3a3a, alpha: 0.14, rough: 0.15, relief: 0.03, radius: [0.02, 0.08], power: 3 });
        s.scuffs(10, { angle: Math.PI / 2, alpha: 0.12, rough: -0.2, width: 0.01, length: [0.15, 0.4] });
        s.speckles(300, { color: 0x3a3a3a, alpha: 0.14, radius: [0.004, 0.012], relief: 0.03 });
        s.micro(0.05, { relief: 0.05, rough: 0.06 });
      },
    },
    optionsFor('rubber'),
  );
}

/**
 * A tyre's sidewall: the other half of the same object, and a different surface.
 *
 * Nearly smooth (a moulded sidewall is glossier than any tread block), with the raised
 * lettering a mould leaves and the fine concentric lines of a spinning cast. Two materials
 * for one tyre is what the review asked for — "tyre sidewall aur tread ke roughness mein
 * slight difference rakho" — and it is also what stops a wheel reading as a black torus.
 */
function tireSidewall(seed: number): SurfaceMaps {
  return surface(
    {
      seed,
      size: 256,
      repeat: 2,
      draw: (s) => {
        s.fill(0x131313, 0.5);
        // Concentric moulding lines, running with the direction of the cast.
        for (let i = 0; i < 40; i++) {
          s.rect(0, i / 40 + 0.004, 1, 0.006, { color: 0x0a0a0a, relief: 0.54, rough: -0.06, alpha: 0.7 });
        }
        // Raised lettering and the buff marks around it.
        s.mid(10, { color: 0x2a2a2a, alpha: 0.2, rough: 0.12, relief: 0.16, radius: [0.04, 0.12], power: 3 });
        s.speckles(120, { color: 0x2f2f2f, alpha: 0.12, radius: [0.004, 0.01], relief: 0.02 });
        // Sidewalls are where the dust settles, and dust is rougher than rubber.
        s.macro(4, { color: 0x3d352a, alpha: 0.1, rough: 0.3, radius: [0.2, 0.45] });
        s.micro(0.035, { relief: 0.03, rough: 0.04 });
      },
    },
    optionsFor('rubber', { relief: 0.7, roughness: 0.88, roughnessVariation: 0.12 }),
  );
}

/**
 * Car paint: a clearcoat over a base coat over steel.
 *
 * The review's second complaint, and its cause was a *borrowed texture*: the wreck's hull
 * used `materials.dark`, which is the stippled polymer surface — 9,000 little stipple
 * rectangles intended for a rifle's furniture — so a car body arrived as high-contrast
 * noise and its shape was unreadable behind it.
 *
 * So this recipe starts from the other end: a clean, near-flat panel (relief 0.5, normal
 * 0.45 — the smoothest thing in the build after glass), then *localised* dirt and scuffs
 * where a car actually collects them (the field, for the arena to place), and fine orange
 * peel at the micro scale, because a sprayed panel is not a mirror.
 */
function carPaint(seed: number): SurfaceMaps {
  return surface(
    {
      seed,
      size: 512,
      repeat: 1,
      anisotropy: 8,
      draw: (s) => {
        s.fill(0x3f4a55, 0.5);
        // The paint film: a dielectric coat, so the field drops the metalness and the base
        // coat's flake keeps a little of it back (see the spec's `coating` mode).
        s.rect(0, 0, 1, 1, { metal: -0.7, rough: -0.05 });
        // Macro: an older panel is *duller* and warmer where the clearcoat has oxidised.
        s.macro(6, { color: 0x5a5347, alpha: 0.1, rough: 0.22, radius: [0.2, 0.5] });
        // Mid: the two kinds of damage a car accumulates — scuffs, which polish, and
        // chips/stone strikes, which remove the coat and expose the metal underneath.
        s.scuffs(14, { angle: 0.08, alpha: 0.2, rough: -0.2, color: 0x9aa4ad, width: 0.003, length: [0.06, 0.3] });
        s.mid(18, { color: 0x6b5a45, alpha: 0.24, rough: 0.3, metal: 0.7, radius: [0.006, 0.024], power: 3 });
        s.mid(9, { color: 0x2b2620, alpha: 0.16, rough: 0.35, radius: [0.05, 0.16], power: 2 });
        // Orange peel: the only micro detail a painted panel has, and it is *subtle*.
        s.micro(0.012, { relief: 0.02, rough: 0.03 });
      },
    },
    optionsFor('carPaint'),
  );
}

/** Ripstop uniform fabric: weave plus weave-lock squares. */
function ripstop(seed: number, base: number, weave: number): SurfaceMaps {
  return surface(
    {
      seed,
      // 512: the sleeve's 12 cm tile at 256² drew its 96 weave lines 1.28 texels
      // apart — sub-texel, so the forearm read as diagonal corrugation at 40 cm
      // (the same defect the weapon metal had). At 512² a thread is 2.5+ texels and
      // the weave finally renders as weave.
      size: 512,
      repeat: 1,
      draw: (s) => {
        s.fill(base, 0.5);
        for (let i = 0; i < 96; i++) {
          s.rect(i / 96, 0, 0.005, 1, { color: weave, relief: i % 2 ? 0.51 : 0.49, alpha: 0.4 });
          s.rect(0, i / 96, 1, 0.005, { color: weave, relief: i % 2 ? 0.49 : 0.51, alpha: 0.4 });
        }
        for (let i = 0; i < 32; i++) {
          s.rect((i % 8) / 8, Math.floor(i / 8) / 4, 0.01, 0.01, { relief: 0.54, alpha: 0.22, color: 0xffffff });
        }
        s.grain(0.035, { relief: 0.03 });
        s.wash(0x0a0906, 0.06);
      },
    },
    // Relief 0.5, not 0.7: the doubling-resolution rule (ADR-0017) — the weave is
    // per-pixel detail, so doubling the resolution doubles the finest term's frequency
    // and the amplitude has to come down with it.
    { relief: 0.5, roughness: 0.95, roughnessVariation: 0.12, occlusion: 0.4 },
  );
}

/** Leather: gloves and boots, scuffed flat at the wear points. */
function wornLeather(seed: number, base: number): SurfaceMaps {
  return surface(
    {
      seed,
      size: 256,
      repeat: 1,
      draw: (s) => {
        s.fill(base, 0.5);
        s.fbm(30, { color: 0x000000, alpha: 0.16, radius: [0.01, 0.05], relief: 0.04 });
        s.fbm(14, { color: 0xffffff, alpha: 0.06, radius: [0.02, 0.08] });
        s.cracks(14, { depth: 0.2, segments: 3, color: 0x1a1410 });
        s.grain(0.04, { relief: 0.03 });
      },
    },
    { relief: 0.9, roughness: 0.72, roughnessVariation: 0.3 },
  );
}

/** Skin: subtle pore grain, slight subsurface warmth in the colour map. */
function humanSkin(seed: number): SurfaceMaps {
  return surface(
    {
      seed,
      size: 256,
      repeat: 1,
      draw: (s) => {
        s.fill(0x9a7355, 0.5);
        s.fbm(24, { color: 0x86583c, alpha: 0.1, radius: [0.03, 0.12] });
        s.fbm(16, { color: 0xb08a68, alpha: 0.08, radius: [0.02, 0.1] });
        s.speckles(900, { color: 0x74492f, alpha: 0.1, radius: [0.002, 0.006], relief: 0.05 });
        s.grain(0.025, { relief: 0.05 });
      },
    },
    { relief: 0.5, roughness: 0.62, roughnessVariation: 0.2 },
  );
}

/** Corroded sheet: rust blooms over remaining paint. */
function corrosion(seed: number): SurfaceMaps {
  return surface(
    {
      seed,
      size: 256,
      repeat: 1,
      draw: (s) => {
        s.fill(0x5a3b22, 0.5);
        // Iron oxide is a *dielectric*, so the field takes the metalness down to nearly
        // nothing across the sheet and puts it back where the scale has flaked off. That is
        // the difference between rust and "dark grey metal" — the flakes are bare steel.
        s.rect(0, 0, 1, 1, { metal: -0.96, rough: 0.06 });
        // Macro: the bloom of corrosion spreads as a *patch*, and it is rougher than what
        // it eats while the metal around it stays darker and glossier.
        s.macro(9, { color: 0x2b1a10, alpha: 0.22, rough: 0.24, relief: 0.08, radius: [0.2, 0.5] });
        s.macro(6, { color: 0x8a5a2c, alpha: 0.2, rough: 0.1, relief: 0.06, radius: [0.16, 0.4] });
        // Mid: scale lifting, and the pits it leaves.
        s.mid(16, { color: 0x33241a, alpha: 0.28, rough: 0.3, relief: -0.1, radius: [0.02, 0.08], power: 3 });
        // Flakes that have fallen off expose bare metal: sharper, smoother, and metal again.
        s.mid(12, { color: 0x6a7076, alpha: 0.24, rough: -0.4, metal: 0.95, radius: [0.01, 0.04], power: 3 });
        s.streaks(14, { color: 0x3a1f10, alpha: 0.3, relief: 0.05 });
        s.micro(0.06, { relief: 0.08, rough: 0.08 });
      },
    },
    optionsFor('rust'),
  );
}

/**
 * Building wall: one storey of plaster over concrete, with the slab band at the top.
 *
 * Authored as *one floor per tile* — which is what the previous version's comment
 * claimed and its code did not do. It baked five rows of windows into a 256 px map
 * (four openings across, a "lit" one at random) and then left the mesh to decide how
 * many metres that covered: on a 20 x 12 m block the whole five-storey pattern was
 * stretched across the face, and the lit panes came out as flat orange rectangles of
 * facade rather than as lights behind glass. That is the review's "buildings are
 * blurry and the windows look painted on".
 *
 * Windows are geometry now (`arena.ts`, `buildWindowRow`): a recessed pane with a
 * proud sill and a reveal, lit or dark, so the sunlight rakes across the opening
 * instead of across a painted rectangle — and the storey slab line is geometry too.
 * What is left for the map is what a wall is *made of*: formwork stains, weathering,
 * spalling, at `UV_DENSITY.building` (1.2 m per tile, i.e. 2.3 mm per texel at 512²).
 *
 * Anisotropy 16 because a facade is nearly always seen at a grazing angle from
 * street level, which is exactly the case where 8 samples still leave the pattern
 * shimmering into noise as the player walks.
 */
function facade(seed: number, tone: number, weathering: number): SurfaceMaps {
  return surface(
    {
      seed,
      // 512, not 256, and the tile is `UV_DENSITY.building` = 1.2 m (ADR-0017).
      //
      // The arithmetic that produced the review's "the buildings are blurry": a 256²
      // map over a 3 m storey is 11.7 mm per texel, and a wall you stand two metres
      // from is ~1.7 mm per screen pixel — the wall was seven times softer than the
      // monitor, so what reached the frame was mottling rather than masonry. At 512²
      // over 1.2 m it is 2.3 mm, which is the same order as the screen at arm's
      // length. That is the fix; nothing else about a wall has to change.
      size: 512,
      repeat: 1,
      anisotropy: 16,
      draw: (s) => {
        s.fill(tone, 0.5);
        // Formwork and weather, at *large* radii: this map is now read at two metres,
        // where a 6 mm blotch is a visible feature and 34 of them are a rash. The
        // wall reads as a wall because it has few big marks, not many small ones.
        s.fbm(18, { color: 0x9d968b, alpha: 0.1 * weathering, radius: [0.08, 0.3], relief: 0.03 });
        s.fbm(14, { color: 0x4e483d, alpha: 0.1 * weathering, radius: [0.1, 0.34] });
        // (The storey slab band used to be drawn here. It is *geometry* now —
        // `arena.buildBuilding` puts a 0.22 m band on every storey line, which is
        // where a floor line belongs: it casts and catches shadow, it survives a UV
        // change, and it is the same band on every one of the three facade tones.)
        s.streaks(12, { alpha: 0.16 * weathering, relief: 0.04 });
        s.cracks(3, { depth: 0.2 });
        // Spalling: fewer, larger, and half the contrast it had. At 2.3 mm per texel
        // the old 0.22-alpha field of 6-20 mm dots measured as *grain* — the review's
        // "the wall is noise" — rather than as damage.
        s.speckles(26, { color: 0x453f35, alpha: 0.11 * weathering, radius: [0.012, 0.03], relief: -0.06 });
        // The three scales, on a wall. Macro is the weathering span (a storey-height of
        // wall that has been rained on differently from the one beside it), mid is where
        // the render has failed and a patch of it is *smoother* because the aggregate is
        // exposed, and micro is the grain that was always there.
        s.macro(6, { color: 0x413b32, alpha: 0.1, rough: 0.16, radius: [0.22, 0.5] });
        s.mid(14, { color: 0x5a5349, alpha: 0.1, rough: -0.2, relief: -0.03, radius: [0.03, 0.1], power: 3 });
        s.wearEdges({ smoother: 0.2, color: 0xa79f92, alpha: 0.14 });
        s.micro(0.018, { relief: 0.02, rough: 0.04 });
      },
    },
    optionsFor('building', { occlusion: 0.55 }),
  );
}

// ---------------------------------------------------------------------------
// Sprites
// ---------------------------------------------------------------------------

function softSprite(): THREE.CanvasTexture {
  const c = canvas(64, 64);
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return sprite(c);
}

function muzzleFlashSprite(): THREE.CanvasTexture {
  const c = canvas(128, 128);
  const g = c.getContext('2d')!;
  g.translate(64, 64);
  const grd = g.createRadialGradient(0, 0, 2, 0, 0, 60);
  grd.addColorStop(0, 'rgba(255,255,240,1)');
  grd.addColorStop(0.25, 'rgba(255,210,120,.9)');
  grd.addColorStop(1, 'rgba(255,140,40,0)');
  g.fillStyle = grd;
  g.beginPath();
  g.arc(0, 0, 60, 0, 7);
  g.fill();
  g.fillStyle = 'rgba(255,240,200,.85)';
  for (let i = 0; i < 4; i++) {
    g.rotate(Math.PI / 2);
    g.beginPath();
    g.moveTo(0, -6);
    g.lineTo(58, 0);
    g.lineTo(0, 6);
    g.fill();
  }
  return sprite(c);
}

function skyTexture(): THREE.CanvasTexture {
  const c = canvas(64, 512);
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, 512);
  grd.addColorStop(0, '#1c2733');
  grd.addColorStop(0.42, '#54514a');
  grd.addColorStop(0.66, '#8a7a5e');
  grd.addColorStop(0.78, '#c98a4a');
  grd.addColorStop(0.86, '#e0a55c');
  grd.addColorStop(1, '#9a8a70');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 512);
  return sprite(c);
}

function damageCrackTexture(): THREE.CanvasTexture {
  const c = canvas(64, 64);
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grd.addColorStop(0, 'rgba(20,16,12,.9)');
  grd.addColorStop(0.6, 'rgba(20,16,12,.4)');
  grd.addColorStop(1, 'rgba(20,16,12,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return sprite(c);
}

/**
 * Build the procedural set once per renderer and share it across materials.
 * `seed` comes from the run seed so a screenshot of a given seed is reproducible.
 */
export function createTextures(seed = 1): TextureLibrary {
  const surfaces: SurfaceLibrary = {
    ground: paving(seed ^ 0x11),
    asphalt: asphalt(seed ^ 0x22),
    sand: sand(seed ^ 0x23),
    carPaint: carPaint(seed ^ 0x24),
    concrete: concrete(seed ^ 0x33),
    plaster: plaster(seed ^ 0x44),
    stone: cutStone(seed ^ 0x55),
    wood: planks(seed ^ 0x66),
    sandbag: hessian(seed ^ 0x77),
    steel: paintedSteel(seed ^ 0x88, 0x3c4044),
    gunmetal: machinedMetal(seed ^ 0x99, 0x23262b, 0.38),
    polymer: stippledPolymer(seed ^ 0xaa, 0x2c2a26),
    rubber: tread(seed ^ 0xbb),
    tireSidewall: tireSidewall(seed ^ 0xbc),
    fabric: ripstop(seed ^ 0xcc, 0x4a4a36, 0x2f2f22),
    leather: wornLeather(seed ^ 0xdd, 0x3a3a30),
    skin: humanSkin(seed ^ 0xee),
    rust: corrosion(seed ^ 0xff),
    dispose(): void {
      for (const value of Object.values(surfaces)) {
        if (typeof value === 'object' && value !== null && 'map' in value) {
          disposeSurface(value as SurfaceMaps);
        }
      }
    },
  };

  // Three wall tones, not three window patterns: a city block reads as a block
  // because the buildings are different colours, and the windows are geometry.
  const buildings = [
    facade(seed ^ 0x41, 0x5c564b, 1),
    facade(seed ^ 0x42, 0x6e6659, 0.55),
    facade(seed ^ 0x43, 0x514d45, 1.35),
  ];
  const library: TextureLibrary = {
    surfaces,
    buildings,
    soft: softSprite(),
    muzzleFlash: muzzleFlashSprite(),
    sky: skyTexture(),
    decal: damageCrackTexture(),
    dispose(): void {
      surfaces.dispose();
      for (const set of buildings) disposeSurface(set);
      library.soft.dispose();
      library.muzzleFlash.dispose();
      library.sky.dispose();
      library.decal.dispose();
    },
  };
  return library;
}
