/**
 * Tracers and shell casings — pooled, allocation-free (PARITY_NOTES #6).
 * parity: 26 player tracers, 40 enemy tracers, 14 casings, additive boxes.
 */
import * as THREE from 'three';
import type { Vec3 } from '@iron/core';

const TRACER_LIFETIME = 0.09; // parity

interface Tracer {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  life: number;
}

export class TracerPool {
  readonly group = new THREE.Group();
  private readonly tracers: Tracer[] = [];

  constructor(count: number, color: number) {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < count; i++) {
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.tracers.push({ mesh, material, life: 0 });
    }
  }

  fire(from: Vec3, to: Vec3): void {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const length = Math.hypot(dx, dy, dz);
    if (length < 0.1) return;

    let tracer = this.tracers.find((t) => !t.mesh.visible);
    if (!tracer) tracer = this.tracers[0];
    if (!tracer) return;

    tracer.mesh.visible = true;
    tracer.life = TRACER_LIFETIME;
    tracer.material.opacity = 0.95;
    tracer.mesh.position.set(from.x + dx * 0.5, from.y + dy * 0.5, from.z + dz * 0.5);
    tracer.mesh.lookAt(to.x, to.y, to.z);
    tracer.mesh.scale.set(0.02, 0.02, length); // parity
  }

  update(dt: number): void {
    for (const tracer of this.tracers) {
      if (!tracer.mesh.visible) continue;
      tracer.life -= dt;
      if (tracer.life <= 0) tracer.mesh.visible = false;
      else tracer.material.opacity = Math.max(0, tracer.life / TRACER_LIFETIME) * 0.95;
    }
  }

  clear(): void {
    for (const tracer of this.tracers) tracer.mesh.visible = false;
  }
}

interface Casing {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
}

export class CasingSystem {
  readonly group = new THREE.Group();
  private readonly casings: Casing[] = [];

  constructor(count = 14) {
    const geometry = new THREE.BoxGeometry(0.02, 0.02, 0.06);
    const material = new THREE.MeshStandardMaterial({
      color: 0xc9a24a,
      metalness: 0.9,
      roughness: 0.35,
    });
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      this.group.add(mesh);
      this.casings.push({
        mesh,
        velocity: new THREE.Vector3(),
        spin: new THREE.Vector3(),
        life: 0,
      });
    }
  }

  eject(position: THREE.Vector3, right: THREE.Vector3, forward: THREE.Vector3): void {
    const casing = this.casings.find((c) => !c.mesh.visible);
    if (!casing) return;
    casing.mesh.visible = true;
    casing.life = 1.6; // parity
    casing.mesh.position.copy(position);
    casing.velocity
      .copy(right)
      .multiplyScalar(1.6 + Math.random())
      .addScaledVector(forward, -0.6 + Math.random() * 0.8);
    casing.velocity.y += 1 + Math.random() * 0.8;
    casing.spin.set(
      (Math.random() - 0.5) * 28,
      (Math.random() - 0.5) * 28,
      (Math.random() - 0.5) * 28,
    );
  }

  update(dt: number): void {
    for (const casing of this.casings) {
      if (!casing.mesh.visible) continue;
      casing.life -= dt;
      if (casing.life <= 0) {
        casing.mesh.visible = false;
        continue;
      }
      casing.velocity.y -= 9.8 * dt;
      casing.mesh.position.addScaledVector(casing.velocity, dt);
      if (casing.mesh.position.y < 0.02) {
        casing.mesh.position.y = 0.02;
        casing.velocity.y *= -0.3;
        casing.velocity.x *= 0.6;
        casing.velocity.z *= 0.6;
        casing.spin.multiplyScalar(0.5);
      }
      casing.mesh.rotation.x += casing.spin.x * dt;
      casing.mesh.rotation.y += casing.spin.y * dt;
      casing.mesh.rotation.z += casing.spin.z * dt;
    }
  }

  clear(): void {
    for (const casing of this.casings) casing.mesh.visible = false;
  }
}
