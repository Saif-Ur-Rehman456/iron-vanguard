/**
 * Procedural PBR surfaces.
 *
 * The zero-asset baseline has to look like weathered *material*, not painted
 * boxes, so every surface is generated from one height field and then split into
 * the maps a physically-based shader actually wants:
 *
 *   height  →  normal map   (bevels catch light along their edges)
 *           →  AO map       (crevices read dark: this is what kills "plastic")
 *           →  roughness    (worn edges are shinier than the flat middle)
 *           →  albedo       (grime settles in the same places the AO does)
 *
 * Deriving every map from one field is the whole trick: the maps agree with each
 * other, which is exactly what a hand-authored set does and a stack of unrelated
 * noise textures never does. Deterministic (seeded) so screenshots and the
 * devtools preview stay stable between runs.
 *
 * ## The three scales, and two more fields (ADR-0020)
 *
 * The seventh review's finding was not that the maps are wrong but that every surface
 * told its story at *one* scale: a wall was mottling, a car body was a stipple pattern,
 * a road was an even carpet of aggregate, and dirt was a tint rather than a physical
 * state. Real surfaces are read at three scales at once, so a recipe now paints all
 * three deliberately — `macro` (stains, polish, repairs, compaction), `mid` (scuffs,
 * panel wear, small damage) and `micro` (grain and pores) — and the amplitude of each
 * is declared in `SURFACE_SPEC` so it can be asserted rather than eyeballed.
 *
 * The two new *fields* are what make a material physical rather than painted:
 *
 *  - `rough` — a spatial roughness field. Dirt is rougher than what it sits on, a
 *    polished traffic lane is smoother than the asphalt beside it, and a worn edge is
 *    smoother than the middle it wore away from. Without this, roughness could only
 *    follow the height field, i.e. every bump was equally rough, which is exactly what
 *    "the materials all respond the same way" looks like.
 *  - `metal` — a spatial metalness multiplier. Paint over steel is a dielectric coating
 *    over a conductor, so a chip is a *change of material*, not a change of colour: the
 *    field goes from ~0.1 to 1.0 where the paint is gone.
 */
import * as THREE from 'three';
import { createRng, type Rng } from '@iron/core';
import type { SurfaceLayers } from './surfaces';

export interface SurfaceMaps {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  /** Absent for dielectrics — the material's own `metalness` value then rules. */
  metalnessMap: THREE.CanvasTexture | null;
  aoMap: THREE.CanvasTexture;
}

export interface SurfaceRecipe {
  /** Texture resolution. 256 is plenty for tiling detail; 512 for hero props. */
  size?: number;
  seed?: number;
  /** Tile repeat across the surface. */
  repeat?: number;
  /** Anisotropic filtering level (1 disables). */
  anisotropy?: number;
  aluminum?: boolean;
  /** Draws the surface: colour into `ctx`, relief into `height`. */
  draw: (sketch: Sketch) => void;
}

/**
 * Drawing surface handed to a recipe. Colour goes to a 2D canvas (comfortable,
 * antialiased, gradient-capable); relief goes to a float height field (exact
 * arithmetic, no 8-bit banding, and cheap to differentiate).
 */
/**
 * One patch of material: the primitive behind every scale layer.
 *
 * Colour, relief and *both fields* are painted together, which is this file's whole
 * philosophy — a stain that darkens but does not roughen is paint, and this is how the
 * maps stay in agreement (ADR-0020).
 */
export interface PatchOptions {
  color?: string | number;
  alpha?: number;
  /** Height offset: + pushes the surface out, - sinks it. */
  relief?: number;
  /** Roughness offset around the 0.5 neutral: + rougher, - glossier. */
  rough?: number;
  /** Metalness offset around the 1 neutral: -1 strips it to a bare dielectric. */
  metal?: number;
  /** Falloff tightness: 2 is a soft dome, 4+ is a spot with a long skirt. */
  power?: number;
  /** Radius range as a fraction of the tile, for the `count`-driven helpers. */
  radius?: [number, number];
}

export class Sketch {
  readonly ctx: CanvasRenderingContext2D;
  readonly height: Float32Array;
  /**
   * Spatial roughness: 0.5 is neutral, >0.5 is rougher, <0.5 is glossier.
   *
   * The field exists because roughness is the single most informative material
   * property after colour and it cannot be a constant: dirt, polish, wear and water
   * all move it, in different directions, in different places.
   */
  readonly rough: Float32Array;
  /**
   * Spatial metalness *multiplier*: 1 leaves the material's own value, 0 is a bare
   * dielectric. Paint, rubber and fabric go to 0 over steel; a chip goes back to 1.
   */
  readonly metal: Float32Array;
  readonly size: number;
  private readonly rng: Rng;

  /**
   * How strongly each scale speaks, as a multiplier on what the recipe authored.
   *
   * Set from the surface class's `layers` (surfaces.ts, ADR-0020): the recipe decides the
   * *shape* of a layer and the class decides its amplitude, so "a painted panel has almost no
   * grain" and "sand's story is large-scale" are statements in one place that the maps obey.
   * 1 means the recipe's own numbers are used unchanged.
   */
  readonly layerGain: { macro: number; mid: number; micro: number };

  constructor(readonly canvas: HTMLCanvasElement, seed: number, layerGain?: SurfaceLayers) {
    this.size = canvas.width;
    this.ctx = canvas.getContext('2d')!;
    this.height = new Float32Array(this.size * this.size);
    this.rough = new Float32Array(this.size * this.size).fill(0.5);
    this.metal = new Float32Array(this.size * this.size).fill(1);
    this.rng = createRng(seed);
    const gain = layerGain ? layerGainToMultiplier(layerGain) : { macro: 1, mid: 1, micro: 1 };
    this.layerGain = gain;
  }

  /** Deterministic RNG shared by every helper in a recipe. */
  random(): number {
    return this.rng.next();
  }

  range(min: number, max: number): number {
    return this.rng.range(min, max);
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.rng.next() * items.length) % items.length]!;
  }

  /** Flat base: colour + relief level (0 = flat, 1 = proud), and both fields neutral. */
  fill(color: string | number, relief = 0.5): this {
    this.ctx.fillStyle = css(color);
    this.ctx.fillRect(0, 0, this.size, this.size);
    this.height.fill(relief);
    this.rough.fill(0.5);
    this.metal.fill(1);
    return this;
  }

  /**
   * A rectangle that paints colour, relief and both fields.
   *
   * A rectangle is what a *panel* is, which is why this one sets the fields rather than
   * nudging them the way `patch` does: "this whole plate is painted" is a statement about
   * an area, and a paint film over steel is the clearest example of it (ADR-0020).
   */
  rect(
    x: number,
    y: number,
    w: number,
    h: number,
    options: { color?: string | number; relief?: number; alpha?: number; rough?: number; metal?: number } = {},
  ): this {
    const px = x * this.size;
    const py = y * this.size;
    const pw = w * this.size;
    const ph = h * this.size;
    if (options.color !== undefined) {
      this.ctx.globalAlpha = options.alpha ?? 1;
      this.ctx.fillStyle = css(options.color);
      this.ctx.fillRect(px, py, pw, ph);
      this.ctx.globalAlpha = 1;
    }
    if (options.relief !== undefined) this.setHeight(px, py, pw, ph, options.relief);
    if (options.rough !== undefined || options.metal !== undefined) {
      const x0 = Math.max(0, Math.floor(px));
      const y0 = Math.max(0, Math.floor(py));
      const x1 = Math.min(this.size, Math.ceil(px + pw));
      const y1 = Math.min(this.size, Math.ceil(py + ph));
      for (let ry = y0; ry < y1; ry++) {
        for (let rx = x0; rx < x1; rx++) {
          const i = ry * this.size + rx;
          if (options.rough !== undefined) this.rough[i] = clamp01(this.rough[i]! + options.rough);
          if (options.metal !== undefined) this.metal[i] = clamp01(this.metal[i]! + options.metal);
        }
      }
    }
    return this;
  }

  /** Set (not add) the height across a rectangle — used for recessed panels. */
  setHeight(px: number, py: number, pw: number, ph: number, value: number): this {
    const x0 = Math.max(0, Math.floor(px));
    const y0 = Math.max(0, Math.floor(py));
    const x1 = Math.min(this.size, Math.ceil(px + pw));
    const y1 = Math.min(this.size, Math.ceil(py + ph));
    for (let y = y0; y < y1; y++) {
      const row = y * this.size;
      for (let x = x0; x < x1; x++) this.height[row + x] = value;
    }
    return this;
  }

  /** Soft radial blob: colour wash plus a height bulge. */
  blob(
    x: number,
    y: number,
    radius: number,
    options: { color?: string | number; relief?: number; alpha?: number } = {},
  ): this {
    const px = x * this.size;
    const py = y * this.size;
    const pr = radius * this.size;
    if (options.color !== undefined) {
      const gradient = this.ctx.createRadialGradient(px, py, pr * 0.15, px, py, pr);
      gradient.addColorStop(0, withAlpha(options.color, options.alpha ?? 0.5));
      gradient.addColorStop(1, withAlpha(options.color, 0));
      this.ctx.fillStyle = gradient;
      this.ctx.fillRect(px - pr, py - pr, pr * 2, pr * 2);
    }
    if (options.relief) this.embossCircle(px, py, pr, options.relief);
    return this;
  }

  private embossCircle(px: number, py: number, pr: number, amount: number): void {
    const x0 = Math.max(0, Math.floor(px - pr));
    const y0 = Math.max(0, Math.floor(py - pr));
    const x1 = Math.min(this.size, Math.ceil(px + pr));
    const y1 = Math.min(this.size, Math.ceil(py + pr));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const d = Math.hypot(x - px, y - py) / pr;
        if (d >= 1) continue;
        const falloff = Math.cos(d * Math.PI * 0.5) ** 2;
        this.height[y * this.size + x] = clamp01(this.height[y * this.size + x]! + amount * falloff);
      }
    }
  }

  /**
   * Paint one patch across all four channels — the primitive behind every scale layer.
   */
  patch(x: number, y: number, radius: number, options: PatchOptions = {}): this {
    const px = x * this.size;
    const py = y * this.size;
    const pr = Math.max(0.5, radius * this.size);
    if (options.color !== undefined) {
      const gradient = this.ctx.createRadialGradient(px, py, pr * 0.1, px, py, pr);
      gradient.addColorStop(0, withAlpha(options.color, options.alpha ?? 0.4));
      gradient.addColorStop(1, withAlpha(options.color, 0));
      this.ctx.fillStyle = gradient;
      this.ctx.fillRect(px - pr, py - pr, pr * 2, pr * 2);
    }
    const relief = options.relief ?? 0;
    const rough = options.rough ?? 0;
    const metal = options.metal ?? 0;
    if (!relief && !rough && !metal) return this;
    const power = options.power ?? 2;
    const x0 = Math.max(0, Math.floor(px - pr));
    const y0 = Math.max(0, Math.floor(py - pr));
    const x1 = Math.min(this.size, Math.ceil(px + pr));
    const y1 = Math.min(this.size, Math.ceil(py + pr));
    for (let y = y0; y < y1; y++) {
      for (let cx = x0; cx < x1; cx++) {
        const d = Math.hypot(cx - px, y - py) / pr;
        if (d >= 1) continue;
        const w = Math.cos(d * Math.PI * 0.5) ** power;
        const i = y * this.size + cx;
        if (relief) this.height[i] = clamp01(this.height[i]! + relief * w);
        if (rough) this.rough[i] = clamp01(this.rough[i]! + rough * w);
        if (metal) this.metal[i] = clamp01(this.metal[i]! + metal * w);
      }
    }
    return this;
  }

  /**
   * The macro scale: large, low-frequency variation.
   *
   * Stains, polish, repairs, compaction, weathering spans — the layer that tells the
   * player the surface has a *history* rather than a texture, and the one the seventh
   * review found missing on every material in the build (ADR-0020).
   */
  macro(count: number, options: PatchOptions = {}): this {
    const [minR, maxR] = options.radius ?? [0.18, 0.52];
    const scaled = scalePatch(options, this.layerGain.macro);
    for (let i = 0; i < count; i++) {
      this.patch(this.rng.next(), this.rng.next(), this.range(minR, maxR), scaled);
    }
    return this;
  }

  /** The mid scale: scuffs, repairs, panel wear, dirt with an edge you can find. */
  mid(count: number, options: PatchOptions = {}): this {
    const [minR, maxR] = options.radius ?? [0.03, 0.14];
    const scaled = scalePatch(options, this.layerGain.mid);
    for (let i = 0; i < count; i++) {
      this.patch(this.rng.next(), this.rng.next(), this.range(minR, maxR), scaled);
    }
    return this;
  }

  /** The micro scale: grain in colour *and* in roughness. */
  micro(amount: number, options: { alpha?: number; relief?: number; rough?: number } = {}): this {
    const gain = this.layerGain.micro;
    return this.grain(amount, {
      alpha: options.alpha === undefined ? undefined : options.alpha * gain,
      relief: (options.relief ?? 0) * gain,
      rough: (options.rough ?? 0) * gain,
    });
  }

  /**
   * Directional scuffs: scratches, brush marks, traffic wear.
   *
   * Directional on purpose. A scratch runs one way and a road is worn one way by the
   * traffic that uses it; the same marks in random directions read as noise, which is
   * what the car body in the seventh report looked like.
   */
  scuffs(
    count: number,
    options: PatchOptions & { angle?: number; length?: [number, number]; width?: number } = {},
  ): this {
    const angle = options.angle ?? 0;
    const [minL, maxL] = options.length ?? [0.08, 0.4];
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const width = options.width ?? 0.005;
    for (let i = 0; i < count; i++) {
      const length = this.range(minL, maxL);
      const steps = Math.max(4, Math.round((length * this.size) / 4));
      let x = this.rng.next();
      let y = this.rng.next();
      const stepX = (dx * length) / steps;
      const stepY = (dy * length) / steps;
      for (let k = 0; k <= steps; k++) {
        this.patch(x, y, this.range(width * 0.5, width * 1.6), {
          color: options.color,
          alpha: (options.alpha ?? 0.25) * 0.6,
          relief: options.relief,
          rough: options.rough,
          metal: options.metal,
          power: 3,
        });
        // A hand wobbles: the same line drawn straight reads as a stripe.
        x += stepX + this.range(-0.004, 0.004);
        y += stepY + this.range(-0.004, 0.004);
      }
    }
    return this;
  }

  /**
   * Worn high points: proud edges read smoother, and on metal they read as bare metal.
   *
   * The one layer driven by the height field rather than by the RNG, because wear follows
   * exposure — the part of a surface that gets rubbed is the part that sticks out. It is
   * also what gives a bevel its highlight: a chamfer catches the light because its edge is
   * smoother than the faces around it.
   */
  wearEdges(
    options: {
      /** Height above which the surface counts as proud (default 0.62). */
      threshold?: number;
      /** How much smoother the proud edges become, 0..1 of the roughness range. */
      smoother?: number;
      /** Metalness the proud edges gain, for paint worn back to steel. */
      metallic?: number;
      /** Colour to lighten the worn edge toward (bare metal, primer, dust). */
      color?: string | number;
      alpha?: number;
    } = {},
  ): this {
    const threshold = options.threshold ?? 0.62;
    const smoother = options.smoother ?? 0.25;
    const metallic = options.metallic ?? 0;
    const span = Math.max(0.001, 1 - threshold);
    const tint = options.color === undefined ? null : new THREE.Color(css(options.color));
    const alpha = options.alpha ?? 0;
    const image = tint && alpha > 0 ? this.ctx.getImageData(0, 0, this.size, this.size) : null;
    const data = image?.data;
    for (let p = 0; p < this.height.length; p++) {
      const proud = clamp01((this.height[p]! - threshold) / span);
      if (proud <= 0) continue;
      this.rough[p] = clamp01(this.rough[p]! - smoother * proud);
      if (metallic) this.metal[p] = clamp01(this.metal[p]! + metallic * proud);
      if (data && tint) {
        const i = p * 4;
        const w = alpha * proud;
        data[i] = clamp255(data[i]! + (tint.r * 255 - data[i]!) * w);
        data[i + 1] = clamp255(data[i + 1]! + (tint.g * 255 - data[i + 1]!) * w);
        data[i + 2] = clamp255(data[i + 2]! + (tint.b * 255 - data[i + 2]!) * w);
      }
    }
    if (image) this.ctx.putImageData(image, 0, 0);
    return this;
  }

  /**
   * Fine per-pixel grain: the difference between "painted" and "physical".
   *
   * The micro scale. `rough` jitters the roughness field with the same noise as the
   * colour, which is what stops a matte surface from reading as a flat *value*: a
   * mineral grain is rough in aggregate and glassy on a fresh fracture, and the two sit
   * a pixel apart.
   */
  grain(
    amount: number,
    options: { alpha?: number; relief?: number; rough?: number; scale?: number } = {},
  ): this {
    const image = this.ctx.getImageData(0, 0, this.size, this.size);
    const data = image.data;
    const alpha = options.alpha ?? 1;
    const relief = options.relief ?? 0;
    const rough = options.rough ?? 0;
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const n = (this.rng.next() - 0.5) * 2;
      const tint = 255 * n * amount * alpha;
      data[i] = clamp255(data[i]! + tint);
      data[i + 1] = clamp255(data[i + 1]! + tint);
      data[i + 2] = clamp255(data[i + 2]! + tint);
      if (relief) this.height[p] = clamp01(this.height[p]! + n * relief);
      if (rough) this.rough[p] = clamp01(this.rough[p]! + n * rough);
    }
    this.ctx.putImageData(image, 0, 0);
    return this;
  }

  /** Paint chips / stones / rivets: colour spots with a relief bump. */
  speckles(
    count: number,
    options: {
      color?: string | number;
      alpha?: number;
      radius?: [number, number];
      relief?: number;
      height?: [number, number];
    } = {},
  ): this {
    const [minR, maxR] = options.radius ?? [0.004, 0.014];
    const [minH, maxH] = options.height ?? [0.45, 0.55];
    for (let i = 0; i < count; i++) {
      const x = this.rng.next();
      const y = this.rng.next();
      const r = this.range(minR, maxR);
      if (options.color !== undefined) {
        this.ctx.globalAlpha = options.alpha ?? 0.5;
        this.ctx.fillStyle = css(options.color);
        this.ctx.beginPath();
        this.ctx.ellipse(x * this.size, y * this.size, r * this.size, r * this.size * this.range(0.6, 1.6), 0, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.globalAlpha = 1;
      }
      if (options.relief) this.embossCircle(x * this.size, y * this.size, r * this.size * 1.6, options.relief);
      if (options.height) {
        const value = this.range(minH, maxH);
        this.setHeight(x * this.size - r * this.size, y * this.size - r * this.size, r * 2 * this.size, r * 2 * this.size, value);
      }
    }
    return this;
  }

  /** Grout lines, planks, tiles: the relief that makes a wall read as masonry. */
  seams(
    axis: 'x' | 'y',
    spacing: number,
    options: {
      width?: number;
      depth?: number;
      color?: string | number;
      jitter?: number;
      offset?: number;
    } = {},
  ): this {
    const width = (options.width ?? 0.012) * this.size;
    const step = spacing * this.size;
    const jitter = options.jitter ?? 0;
    const offset = (options.offset ?? 0) * this.size;
    for (let at = ((offset % step) + step) % step; at <= this.size + step; at += step) {
      const wobble = jitter ? this.range(-jitter, jitter) * this.size : 0;
      const position = at + wobble;
      if (axis === 'y') {
        this.ctx.globalAlpha = 0.55;
        this.ctx.fillStyle = css(options.color ?? 0x1a1512);
        this.ctx.fillRect(0, position, this.size, width);
        this.ctx.globalAlpha = 1;
        this.shadeBand(0, position, this.size, width, -(options.depth ?? 0.25));
      } else {
        this.ctx.globalAlpha = 0.55;
        this.ctx.fillStyle = css(options.color ?? 0x1a1512);
        this.ctx.fillRect(position, 0, width, this.size);
        this.ctx.globalAlpha = 1;
        this.shadeBand(position, 0, width, this.size, -(options.depth ?? 0.25));
      }
    }
    return this;
  }

  /** Multiply a band of the height field — the primitive behind seams/panel lines. */
  shadeBand(px: number, py: number, pw: number, ph: number, amount: number): this {
    const x0 = Math.max(0, Math.floor(px));
    const y0 = Math.max(0, Math.floor(py));
    const x1 = Math.min(this.size, Math.ceil(px + pw));
    const y1 = Math.min(this.size, Math.ceil(py + ph));
    for (let y = y0; y < y1; y++) {
      const row = y * this.size;
      for (let x = x0; x < x1; x++) this.height[row + x] = clamp01(this.height[row + x]! + amount);
    }
    return this;
  }

  /** Hairline cracks with a matching dark line in the albedo. */
  cracks(count: number, options: { color?: string | number; depth?: number; segments?: number } = {}): this {
    const depth = options.depth ?? 0.35;
    for (let i = 0; i < count; i++) {
      let x = this.rng.next() * this.size;
      let y = this.rng.next() * this.size;
      const points: [number, number][] = [[x, y]];
      const segments = options.segments ?? 5;
      for (let k = 0; k < segments; k++) {
        x += this.range(-0.05, 0.05) * this.size;
        y += this.range(-0.05, 0.05) * this.size;
        points.push([x, y]);
      }
      this.ctx.globalAlpha = 0.5;
      this.ctx.strokeStyle = css(options.color ?? 0x120f0c);
      this.ctx.lineWidth = Math.max(1, this.size / 256);
      this.ctx.beginPath();
      for (const [px, py] of points) this.ctx.lineTo(px, py);
      this.ctx.stroke();
      this.ctx.globalAlpha = 1;
      for (const [px, py] of points) {
        this.embossCircle(px, py, this.size * 0.02, -depth);
      }
    }
    return this;
  }

  /** Vertical grime: rain streaks and soot running down a surface. */
  streaks(count: number, options: { color?: string | number; alpha?: number; width?: [number, number]; relief?: number } = {}): this {
    const [minW, maxW] = options.width ?? [0.004, 0.03];
    for (let i = 0; i < count; i++) {
      const x = this.rng.next() * this.size;
      const w = this.range(minW, maxW) * this.size;
      const top = this.rng.next() * this.size * 0.4;
      const gradient = this.ctx.createLinearGradient(0, top, 0, this.size);
      gradient.addColorStop(0, withAlpha(options.color ?? 0x0d0b09, (options.alpha ?? 0.35) * 0.9));
      gradient.addColorStop(0.6, withAlpha(options.color ?? 0x0d0b09, (options.alpha ?? 0.35) * 0.4));
      gradient.addColorStop(1, withAlpha(options.color ?? 0x0d0b09, 0));
      this.ctx.fillStyle = gradient;
      this.ctx.fillRect(x, top, w, this.size - top);
      if (options.relief) this.shadeBand(x, top, w, this.size - top, -options.relief);
    }
    return this;
  }

  /** Paint over the whole surface without touching relief (dust, burns, water). */
  wash(color: string | number, alpha: number): this {
    this.ctx.globalAlpha = alpha;
    this.ctx.fillStyle = css(color);
    this.ctx.fillRect(0, 0, this.size, this.size);
    this.ctx.globalAlpha = 1;
    return this;
  }

  /**
   * Deterministic fbm noise drawn as soft blotches — colour variation that keeps
   * a tiled surface from looking repeated.
   */
  fbm(count: number, options: { color?: string | number; alpha?: number; radius?: [number, number]; relief?: number } = {}): this {
    const [minR, maxR] = options.radius ?? [0.06, 0.22];
    for (let i = 0; i < count; i++) {
      this.blob(this.rng.next(), this.rng.next(), this.range(minR, maxR), {
        color: options.color,
        alpha: options.alpha ?? 0.18,
        relief: options.relief,
      });
    }
    return this;
  }
}

function css(color: string | number): string {
  return typeof color === 'number' ? `#${color.toString(16).padStart(6, '0')}` : color;
}

function withAlpha(color: string | number, alpha: number): string {
  if (typeof color === 'string') return color;
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  return `rgba(${r},${g},${b},${alpha})`;
}

function clamp255(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

function canvas(size: number): HTMLCanvasElement {
  const element = document.createElement('canvas');
  element.width = size;
  element.height = size;
  return element;
}

function texture(element: HTMLCanvasElement, repeat: number, srgb: boolean, anisotropy: number): THREE.CanvasTexture {
  const map = new THREE.CanvasTexture(element);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = anisotropy;
  if (repeat !== 1) map.repeat.set(repeat, repeat);
  // Colour data is sRGB, everything else is linear — mixing this up is the most
  // common reason a PBR set looks washed out or too dark.
  map.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return map;
}

/** Sobel-differentiate the height field into a tangent-space normal map. */
function normalMapFrom(height: Float32Array, size: number, amplitude: number, repeat: number, anisotropy: number): THREE.CanvasTexture {
  const element = canvas(size);
  const ctx = element.getContext('2d')!;
  const image = ctx.createImageData(size, size);
  const data = image.data;
  const at = (x: number, y: number): number => height[(y & (size - 1)) * size + (x & (size - 1))]!;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * amplitude;
      const dy = (at(x, y + 1) - at(x, y - 1)) * amplitude;
      // Normalise (dx, dy, 1) into the 0..255 RGB encoding.
      const length = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      data[i] = clamp255(((dx / length) * 0.5 + 0.5) * 255);
      data[i + 1] = clamp255(((dy / length) * 0.5 + 0.5) * 255);
      data[i + 2] = clamp255(((1 / length) * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return texture(element, repeat, false, anisotropy);
}

/**
 * Ambient occlusion straight off the height field: a pixel is dark when it sits
 * below its neighbourhood. Cheap (one separable blur) and it is what gives
 * mortar, seams and panel gaps their shadow without any extra geometry.
 */
function ambientOcclusion(height: Float32Array, size: number, repeat: number, anisotropy: number): THREE.CanvasTexture {
  const radius = Math.max(2, Math.round(size / 48));
  const blurred = boxBlur(height, size, radius);
  const element = canvas(size);
  const ctx = element.getContext('2d')!;
  const image = ctx.createImageData(size, size);
  const data = image.data;
  for (let i = 0, p = 0; p < height.length; i += 4, p++) {
    const delta = (height[p]! - blurred[p]!) * 2.6;
    const value = clamp255((1 - Math.min(0.65, Math.max(0, delta))) * 255);
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return texture(element, repeat, false, anisotropy);
}

function boxBlur(source: Float32Array, size: number, radius: number): Float32Array {
  const horizontal = new Float32Array(source.length);
  const output = new Float32Array(source.length);
  for (let y = 0; y < size; y++) {
    const row = y * size;
    for (let x = 0; x < size; x++) {
      let sum = 0;
      let count = 0;
      for (let k = -radius; k <= radius; k++) {
        const sx = x + k;
        if (sx < 0 || sx >= size) continue;
        sum += source[row + sx]!;
        count++;
      }
      horizontal[row + x] = sum / count;
    }
  }
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      let sum = 0;
      let count = 0;
      for (let k = -radius; k <= radius; k++) {
        const sy = y + k;
        if (sy < 0 || sy >= size) continue;
        sum += horizontal[sy * size + x]!;
        count++;
      }
      output[y * size + x] = sum / count;
    }
  }
  return output;
}

/**
 * How much one texel's gloss *differs from its material's own value*, as a signed delta.
 *
 * Not an absolute roughness, and that distinction is a defect this file shipped: three
 * **multiplies** the material's `roughness` by the map's green channel
 * (`roughnessmap_fragment`), so a map carrying an absolute roughness is multiplied by an
 * absolute roughness — the surface's gloss *squared*. Every material with a map paid for it
 * at a rate set by its own smoothness: car paint authored at 0.34 shaded at 0.12, water at
 * 0.06 shaded at 0.004, and the view model's receiver authored at 0.56 shaded at 0.23, which
 * is a mirror and is why a weapon under a 45 cm light came back as a white smear. The map is
 * a statement about *where* a surface is glossier than its material; the material is the
 * value. `applySurfaceMaps` is the other half — it teaches the shader to add this instead.
 *
 * `variation` is how much the relief moves the gloss (a worn edge against a recessed pit) and
 * `fieldGain` is how much the *painted* field moves it (dirt against polish, water against
 * dry stone). Both are the class's, from `SURFACE_SPEC`.
 */
export function roughnessSwing(
  variation: number,
  fieldGain: number,
  height: number,
  field: number,
): number {
  return clamp(variation * (height - 0.5) + fieldGain * 2 * (field - 0.5), -1, 1);
}

/**
 * The channel value for a swing: 0.5 is "exactly the material's roughness".
 *
 * A texture channel cannot hold a negative number, so the swing is centred in the middle of
 * the range and the shader doubles the offset back out. The loss is 1/255 of a swing — one
 * part in 510 of the term — which is why this is a texture and not a vertex attribute.
 */
export function swingChannel(swing: number): number {
  return clamp01(swing * 0.5 + 0.5);
}

/**
 * The gloss of a surface, as the shader will compute it: the material's own roughness plus
 * the texel's swing, floored where three floors it.
 *
 * Exported because it is the *contract* between the map and the material, and this is the
 * only place a test can check it without a GPU: get this wrong and a surface is glossy by a
 * factor of its own smoothness, which is invisible in a number and obvious in a frame.
 */
export function effectiveRoughness(base: number, swing: number): number {
  return Math.max(clamp01(base + swing), 0.0525);
}

/**
 * Anisotropic roughness: worn edges (high relief) read smoother than recessed pits,
 * which is how real metal and stone age — plus the painted field, which is how dirt,
 * polish, water and wear say something the relief cannot.
 */
function roughnessMapFrom(
  height: Float32Array,
  rough: Float32Array,
  size: number,
  variation: number,
  fieldGain: number,
  repeat: number,
  anisotropy: number,
): THREE.CanvasTexture {
  const element = canvas(size);
  const ctx = element.getContext('2d')!;
  const image = ctx.createImageData(size, size);
  const data = image.data;
  for (let i = 0, p = 0; p < height.length; i += 4, p++) {
    const value = clamp255(swingChannel(roughnessSwing(variation, fieldGain, height[p]!, rough[p]!)) * 255);
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return texture(element, repeat, false, anisotropy);
}

/**
 * The metalness map is a *fraction*: how much of this texel is the metal.
 *
 * Same correction as the roughness map, in the other direction. The map used to bake
 * `metalness * field`, which three then multiplied by `material.metalness` — the class's value
 * counted twice, so a gunmetal surface at 0.95 shaded at 0.9. The field starts at 1 (the whole
 * texel is metal) and a recipe paints it *down* where paint, dirt or bare substrate takes over,
 * which is exactly the fraction the material then scales. The map says *where*, the material
 * says *how much* — and neither can silently override the other.
 */
function metalnessMapFrom(
  metal: Float32Array,
  base: number,
  size: number,
  repeat: number,
  anisotropy: number,
): THREE.CanvasTexture | null {
  if (base <= 0) return null;
  const element = canvas(size);
  const ctx = element.getContext('2d')!;
  const image = ctx.createImageData(size, size);
  const data = image.data;
  for (let i = 0, p = 0; p < metal.length; i += 4, p++) {
    const value = clamp255(clamp01(metal[p]!) * 255);
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return texture(element, repeat, false, anisotropy);
}

/**
 * Teach a material to read its roughness map as a swing rather than as a value.
 *
 * The alternative — baking an absolute roughness into the map — cannot work at all for the
 * case this build actually has: the *same* gunmetal map is used by a library material at 0.42
 * and by seven view-model parts whose authored roughnesses differ per part (that difference is
 * a checked feature, `tests/unit/weaponMaterials.test.ts`). One map, many materials is only
 * possible if the map carries the *variation* and each material carries the value, which is the
 * division of labour glTF intends and three cannot express through multiplication alone.
 *
 * Nine lines of shader replacement against per-material clones of every map (one extra GPU
 * upload per variant, ~30 MB of canvas in this build) is the trade, and the shader is the
 * smaller, more honest one: the map stays the surface's shape and the material stays its value.
 * `customProgramCacheKey` keeps three from handing this material the stock program — without it
 * the injected source is compiled once and never selected again.
 */
export function applySurfaceMaps(material: THREE.MeshStandardMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      `float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
  vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
  roughnessFactor = clamp( roughnessFactor + ( texelRoughness.g - 0.5 ) * 2.0, 0.0, 1.0 );
#endif`,
    );
  };
  material.customProgramCacheKey = () => 'iron-surface-swing';
}

/** Bake the AO into the albedo too: shading the crevices holds up at any distance. */
function bakeAoIntoAlbedo(albedo: THREE.CanvasTexture, height: Float32Array, size: number, amount: number): void {
  const ctx = albedo.image.getContext('2d')!;
  const image = ctx.getImageData(0, 0, size, size);
  const data = image.data;
  const blurred = boxBlur(height, size, Math.max(2, Math.round(size / 48)));
  for (let i = 0, p = 0; p < height.length; i += 4, p++) {
    const delta = (height[p]! - blurred[p]!) * 2.6;
    const shade = 1 - Math.min(amount, Math.max(0, delta) * amount);
    data[i] = clamp255(data[i]! * shade);
    data[i + 1] = clamp255(data[i + 1]! * shade);
    data[i + 2] = clamp255(data[i + 2]! * shade);
  }
  ctx.putImageData(image, 0, 0);
  albedo.needsUpdate = true;
}

export interface SurfaceOptions {
  /** Relief strength for the derived normal map. */
  relief?: number;
  /** Base roughness 0..1. */
  roughness?: number;
  /** Roughness swing across the height field. */
  roughnessVariation?: number;
  /**
   * How much the *painted* roughness field moves the map (ADR-0020).
   *
   * A separate term from `roughnessVariation` on purpose: the height field's slope is how
   * a worn edge ages, and the field is what a material *is* in one place and not another
   * — dirt, polish, standing water, bare metal. One number could not do both, which is
   * why every surface in the build used to respond the same way to the same light.
   */
  roughnessField?: number;
  /** Metalness 0..1; anything > 0 gets a metalness map. */
  metalness?: number;
  /** How strongly crevices darken the albedo (0 disables). */
  occlusion?: number;
  /**
   * The surface class's three-scale amplitudes (surfaces.ts), so the *recipe* does not have to
   * restate how large a part of this material each scale is.
   */
  layers?: SurfaceLayers;
}

/**
 * One layer's amplitude as a multiplier on the recipe's own numbers.
 *
 * Kept beside the class because it is the same normalisation `layerGain` documents, and it is
 * here rather than in the recipe because a recipe author should never have to think about it.
 */
function layerGainToMultiplier(layers: SurfaceLayers): {
  macro: number;
  mid: number;
  micro: number;
} {
  return { macro: layers.macro / 0.5, mid: layers.mid / 0.5, micro: layers.micro / 0.5 };
}

/** The colour/relief/roughness amplitudes of one patch, at a layer's gain. */
function scalePatch(options: PatchOptions, gain: number): PatchOptions {
  if (gain === 1) return options;
  return {
    ...options,
    alpha: options.alpha === undefined ? undefined : options.alpha * gain,
    relief: options.relief === undefined ? undefined : options.relief * gain,
    rough: options.rough === undefined ? undefined : options.rough * gain,
  };
}

/**
 * Build the full map set. One height field, five maps, all derived — the maps
 * cannot disagree with each other.
 */
export function surface(recipe: SurfaceRecipe, options: SurfaceOptions = {}): SurfaceMaps {
  const size = recipe.size ?? 256;
  const repeat = recipe.repeat ?? 1;
  const anisotropy = recipe.anisotropy ?? 8;
  const albedoCanvas = canvas(size);
  const sketch = new Sketch(albedoCanvas, recipe.seed ?? 1, options.layers);
  recipe.draw(sketch);

  const map = texture(albedoCanvas, repeat, true, anisotropy);
  const normalMap = normalMapFrom(sketch.height, size, (options.relief ?? 1.6) * 12, repeat, anisotropy);
  const roughnessMap = roughnessMapFrom(
    sketch.height,
    sketch.rough,
    size,
    options.roughnessVariation ?? 0.25,
    options.roughnessField ?? 0.5,
    repeat,
    anisotropy,
  );
  const aoMap = ambientOcclusion(sketch.height, size, repeat, anisotropy);
  bakeAoIntoAlbedo(map, sketch.height, size, options.occlusion ?? 0.55);
  const metalnessMap = metalnessMapFrom(sketch.metal, options.metalness ?? 0, size, repeat, anisotropy);
  return { map, normalMap, roughnessMap, aoMap, metalnessMap };
}

export function disposeSurface(set: SurfaceMaps): void {
  set.map.dispose();
  set.normalMap.dispose();
  set.roughnessMap.dispose();
  set.aoMap.dispose();
  set.metalnessMap?.dispose();
}
