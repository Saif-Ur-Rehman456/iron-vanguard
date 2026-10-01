/**
 * Pooled GPU particles.
 *
 * The prototype allocated a SpriteMaterial per particle (up to 480 live), so a
 * firefight cost hundreds of draw calls; the previous port kept that shape with a
 * pool. A sprite is one draw call *per particle* no matter how it is pooled.
 *
 * This version is two `THREE.Points` clouds — one additive, one alpha-blended —
 * each with a small shader that reads size, colour, opacity and roll per vertex.
 * All 480 particles in a frame now cost **two** draw calls, which is what pays for
 * the extra geometry detail elsewhere (see docs/PERF_BUDGET.md).
 */
import * as THREE from 'three';
import type { Vec3 } from '@iron/core';
import type { TextureLibrary } from '../materials/textures';

export interface ParticleOptions {
  position: Vec3;
  velocity?: Vec3;
  color?: number;
  size?: number;
  life?: number;
  grow?: number;
  gravity?: number;
  drag?: number;
  opacity?: number;
  additive?: boolean;
  flicker?: boolean;
  rotation?: number;
}

interface Slot {
  /** Index into the cloud's attribute buffers. */
  index: number;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  grow: number;
  gravity: number;
  drag: number;
  baseOpacity: number;
  flicker: boolean;
  live: boolean;
}

const VERTEX_SHADER = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute float aRotation;
  attribute vec3 aColor;

  uniform float uScale;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vRotation;

  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vRotation = aRotation;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // Size is world units, so points stay the same physical size with distance.
    gl_PointSize = max(1.0, aSize * uScale / max(0.001, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uMap;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vRotation;

  void main() {
    if (vAlpha <= 0.002) discard;
    // Roll around the sprite centre: embers and smoke read as alive when they
    // are not all aligned, and it costs four instructions.
    vec2 uv = gl_PointCoord - 0.5;
    float s = sin(vRotation);
    float c = cos(vRotation);
    uv = vec2(uv.x * c - uv.y * s, uv.x * s + uv.y * c) + 0.5;
    vec4 texel = texture2D(uMap, uv);
    float alpha = texel.a * vAlpha;
    if (alpha <= 0.002) discard;
    gl_FragColor = vec4(vColor * texel.rgb, alpha);
  }
`;

class PointCloud {
  readonly points: THREE.Points;
  readonly slots: Slot[] = [];
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly sizes: Float32Array;
  private readonly alphas: Float32Array;
  private readonly rotations: Float32Array;
  private readonly positionAttribute: THREE.BufferAttribute;
  private readonly colorAttribute: THREE.BufferAttribute;
  private readonly sizeAttribute: THREE.BufferAttribute;
  private readonly alphaAttribute: THREE.BufferAttribute;
  private readonly rotationAttribute: THREE.BufferAttribute;
  private readonly material: THREE.ShaderMaterial;
  private cursor = 0;

  constructor(capacity: number, additive: boolean, texture: THREE.Texture) {
    this.positions = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 3);
    this.sizes = new Float32Array(capacity);
    this.alphas = new Float32Array(capacity);
    this.rotations = new Float32Array(capacity);
    const geometry = new THREE.BufferGeometry();
    this.positionAttribute = new THREE.BufferAttribute(this.positions, 3);
    this.colorAttribute = new THREE.BufferAttribute(this.colors, 3);
    this.sizeAttribute = new THREE.BufferAttribute(this.sizes, 1);
    this.alphaAttribute = new THREE.BufferAttribute(this.alphas, 1);
    this.rotationAttribute = new THREE.BufferAttribute(this.rotations, 1);
    geometry.setAttribute('position', this.positionAttribute);
    geometry.setAttribute('aColor', this.colorAttribute);
    geometry.setAttribute('aSize', this.sizeAttribute);
    geometry.setAttribute('aAlpha', this.alphaAttribute);
    geometry.setAttribute('aRotation', this.rotationAttribute);
    // Particles are placed in world space and are never culled: one missed
    // bounding sphere would drop the whole cloud.
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: texture },
        uScale: { value: 720 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });

    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 12 : 10;

    for (let i = 0; i < capacity; i++) {
      this.slots.push({
        index: i,
        velocity: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        grow: 0,
        gravity: 0,
        drag: 0,
        baseOpacity: 1,
        flicker: false,
        live: false,
      });
    }
  }

  /** Keep point size in world units at any viewport size / FOV / pixel ratio. */
  setProjectionScale(height: number, fovDegrees: number): void {
    const fov = (fovDegrees * Math.PI) / 180;
    this.material.uniforms.uScale!.value = height / (2 * Math.tan(fov / 2));
  }

  spawn(options: ParticleOptions): void {
    // Round-robin instead of scanning: when the pool is saturated, the oldest
    // particle is the right one to steal, and it is O(1).
    let slot: Slot | undefined;
    for (let i = 0; i < this.slots.length; i++) {
      const candidate = this.slots[(this.cursor + i) % this.slots.length]!;
      if (!candidate.live) {
        slot = candidate;
        this.cursor = (candidate.index + 1) % this.slots.length;
        break;
      }
    }
    if (!slot) {
      slot = this.slots[this.cursor]!;
      this.cursor = (this.cursor + 1) % this.slots.length;
    }

    const i = slot.index * 3;
    slot.live = true;
    slot.life = options.life ?? 1;
    slot.maxLife = slot.life;
    slot.grow = options.grow ?? 0;
    slot.gravity = options.gravity ?? 0;
    slot.drag = options.drag ?? 0;
    slot.baseOpacity = options.opacity ?? 1;
    slot.flicker = options.flicker ?? false;
    slot.velocity.set(options.velocity?.x ?? 0, options.velocity?.y ?? 0, options.velocity?.z ?? 0);
    this.positions[i] = options.position.x;
    this.positions[i + 1] = options.position.y;
    this.positions[i + 2] = options.position.z;
    this.sizes[slot.index] = options.size ?? 0.3;
    this.alphas[slot.index] = slot.baseOpacity;
    this.rotations[slot.index] = options.rotation ?? Math.random() * Math.PI * 2;
    const color = new THREE.Color(options.color ?? 0xffffff);
    this.colors[i] = color.r;
    this.colors[i + 1] = color.g;
    this.colors[i + 2] = color.b;
    this.markDirty();
  }

  private markDirty(): void {
    this.positionAttribute.needsUpdate = true;
    this.colorAttribute.needsUpdate = true;
    this.sizeAttribute.needsUpdate = true;
    this.alphaAttribute.needsUpdate = true;
    this.rotationAttribute.needsUpdate = true;
  }

  update(dt: number, time: number): void {
    let index = 0;
    for (const slot of this.slots) {
      index++;
      if (!slot.live) continue;
      slot.life -= dt;
      const i = slot.index * 3;
      if (slot.life <= 0) {
        slot.live = false;
        this.alphas[slot.index] = 0;
        continue;
      }
      if (slot.gravity !== 0) slot.velocity.y -= slot.gravity * dt;
      if (slot.drag > 0) slot.velocity.multiplyScalar(Math.max(0, 1 - slot.drag * dt));
      this.positions[i] = this.positions[i]! + slot.velocity.x * dt;
      this.positions[i + 1] = this.positions[i + 1]! + slot.velocity.y * dt;
      this.positions[i + 2] = this.positions[i + 2]! + slot.velocity.z * dt;
      if (slot.grow !== 0) this.sizes[slot.index] = Math.max(0, this.sizes[slot.index]! + slot.grow * dt);
      const k = slot.life / slot.maxLife;
      let opacity = slot.baseOpacity * k * k;
      if (slot.flicker) opacity *= 0.6 + 0.4 * Math.sin(time * 40 + index * 7);
      this.alphas[slot.index] = opacity;
    }
    this.markDirty();
  }

  clear(): void {
    for (const slot of this.slots) {
      slot.live = false;
      this.alphas[slot.index] = 0;
    }
    this.markDirty();
  }

  get liveCount(): number {
    let live = 0;
    for (const slot of this.slots) if (slot.live) live++;
    return live;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}

export class ParticleSystem {
  readonly group = new THREE.Group();
  private readonly additive: PointCloud;
  private readonly normal: PointCloud;

  constructor(textures: TextureLibrary, capacity: number) {
    this.group.name = 'particles';
    const half = Math.max(1, Math.ceil(capacity / 2));
    this.additive = new PointCloud(half, true, textures.soft);
    this.normal = new PointCloud(half, false, textures.soft);
    this.group.add(this.additive.points, this.normal.points);
  }

  /** Called on resize: keeps world-space particle sizes correct. */
  setProjection(height: number, fovDegrees: number): void {
    this.additive.setProjectionScale(height, fovDegrees);
    this.normal.setProjectionScale(height, fovDegrees);
  }

  get drawCalls(): number {
    return 2;
  }

  get liveCount(): number {
    return this.additive.liveCount + this.normal.liveCount;
  }

  spawn(options: ParticleOptions): void {
    (options.additive ? this.additive : this.normal).spawn(options);
  }

  update(dt: number, time: number): void {
    this.additive.update(dt, time);
    this.normal.update(dt, time);
  }

  clear(): void {
    this.additive.clear();
    this.normal.clear();
  }

  dispose(): void {
    this.additive.dispose();
    this.normal.dispose();
    this.group.clear();
  }
}
