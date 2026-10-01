/**
 * Explosion presentation — the prototype's `explosion()` FX, ported: 14 flame
 * puffs, 16 smoke puffs, 16 sparks, an expanding additive ring, a ground scorch
 * and a big light flash that the renderer decays.
 */
import * as THREE from 'three';
import type { Vec3 } from '@iron/core';
import type { TextureLibrary } from '../materials/textures';
import type { DecalSystem } from './decals';
import type { ParticleSystem } from './particles';

interface Ring {
  mesh: THREE.Mesh;
  age: number;
  duration: number;
  radius: number;
}

export class ExplosionFactory {
  readonly group = new THREE.Group();
  private readonly rings: Ring[] = [];
  /** Set by the renderer so the boom light can be flashed. */
  onFlash: (pos: Vec3, radius: number) => void = () => {};

  constructor(
    private readonly particles: ParticleSystem,
    private readonly decals: DecalSystem,
    private readonly textures: TextureLibrary,
  ) {}

  spawn(pos: Vec3, radius: number): void {
    const flameColors = [0xfff3c0, 0xffc46b, 0xff8a3c];
    for (let i = 0; i < 14; i++) {
      this.particles.spawn({
        position: {
          x: pos.x + (Math.random() - 0.5) * 0.8,
          y: pos.y + Math.random() * 0.5,
          z: pos.z + (Math.random() - 0.5) * 0.8,
        },
        velocity: {
          x: (Math.random() - 0.5) * 8,
          y: 2 + Math.random() * 5,
          z: (Math.random() - 0.5) * 8,
        },
        color: flameColors[i % 3],
        size: 0.7 + Math.random() * 0.6,
        life: 0.3 + Math.random() * 0.2,
        grow: 3.4,
        drag: 3,
        additive: true,
      });
    }

    for (let i = 0; i < 16; i++) {
      const gray = new THREE.Color(0x3a342c).lerp(new THREE.Color(0x6b6152), Math.random());
      this.particles.spawn({
        position: {
          x: pos.x + (Math.random() - 0.5) * 1.6,
          y: pos.y + Math.random(),
          z: pos.z + (Math.random() - 0.5) * 1.6,
        },
        velocity: {
          x: (Math.random() - 0.5) * 5,
          y: 1.5 + Math.random() * 2.5,
          z: (Math.random() - 0.5) * 5,
        },
        color: gray.getHex(),
        size: 1 + Math.random() * 0.8,
        life: 1.4 + Math.random(),
        grow: 0.9 + Math.random() * 0.7,
        drag: 1.4,
        opacity: 0.85,
      });
    }

    for (let i = 0; i < 16; i++) {
      this.particles.spawn({
        position: { ...pos },
        velocity: {
          x: (Math.random() - 0.5) * 18,
          y: 3 + Math.random() * 8,
          z: (Math.random() - 0.5) * 18,
        },
        color: 0xffe9a8,
        size: 0.08 + Math.random() * 0.08,
        life: 0.3 + Math.random() * 0.25,
        gravity: 14,
        additive: true,
      });
    }

    const ringGeometry = new THREE.RingGeometry(0.9, 1.15, 28);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xffcf9a,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ringMesh = new THREE.Mesh(ringGeometry, ringMaterial);
    ringMesh.rotation.x = -Math.PI / 2;
    ringMesh.position.set(pos.x, 0.06, pos.z);
    this.group.add(ringMesh);
    this.rings.push({ mesh: ringMesh, age: 0, duration: 0.38, radius });

    this.decals.addScorch(pos, radius);
    this.onFlash(pos, radius);
  }

  update(dt: number): void {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const ring = this.rings[i]!;
      ring.age += dt;
      const k = ring.age / ring.duration;
      const material = ring.mesh.material as THREE.MeshBasicMaterial;
      if (k >= 1) {
        this.group.remove(ring.mesh);
        ring.mesh.geometry.dispose();
        material.dispose();
        this.rings.splice(i, 1);
        continue;
      }
      ring.mesh.scale.setScalar(1 + k * ring.radius * 1.15);
      material.opacity = 0.85 * (1 - k);
    }
  }

  clear(): void {
    for (const ring of this.rings) {
      this.group.remove(ring.mesh);
      ring.mesh.geometry.dispose();
      (ring.mesh.material as THREE.Material).dispose();
    }
    this.rings.length = 0;
  }

  /** Exposed so the renderer can decide whether textures are still needed. */
  get textureRef(): TextureLibrary {
    return this.textures;
  }
}
