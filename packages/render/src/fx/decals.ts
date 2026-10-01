/**
 * Decals: bullet impacts and explosion scorch marks.
 * The prototype kept only 12 scorch decals and none for bullets; here both share
 * one capped pool so cover reads as battle-damaged without unbounded memory.
 */
import * as THREE from 'three';
import type { SurfaceDef } from '@iron/content';
import type { TextureLibrary } from '../materials/textures';

interface Decal {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  life: number;
  baseOpacity: number;
}

export class DecalSystem {
  readonly group = new THREE.Group();
  private readonly decals: Decal[] = [];
  private readonly geometry = new THREE.CircleGeometry(1, 16);
  private readonly cursor = { index: 0 };

  constructor(textures: TextureLibrary, capacity: number) {
    for (let i = 0; i < capacity; i++) {
      const material = new THREE.MeshBasicMaterial({
        map: textures.decal,
        transparent: true,
        depthWrite: false,
        opacity: 0,
      });
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.visible = false;
      mesh.renderOrder = 2;
      this.group.add(mesh);
      this.decals.push({ mesh, material, life: 0, baseOpacity: 1 });
    }
  }

  private next(): Decal {
    const free = this.decals.find((d) => !d.mesh.visible);
    if (free) return free;
    // Ring buffer: recycle the oldest decal when the cap is reached.
    this.cursor.index = (this.cursor.index + 1) % this.decals.length;
    return this.decals[this.cursor.index]!;
  }

  addImpact(point: { x: number; y: number; z: number }, normal: { x: number; y: number; z: number }, surface: SurfaceDef): void {
    const decal = this.next();
    decal.mesh.visible = true;
    decal.life = 18;
    decal.baseOpacity = surface.decalOpacity;
    decal.material.color.setHex(surface.decalColor);
    decal.material.opacity = surface.decalOpacity;
    decal.mesh.position.set(
      point.x + normal.x * 0.01,
      point.y + normal.y * 0.01,
      point.z + normal.z * 0.01,
    );
    decal.mesh.lookAt(
      point.x + normal.x * 2,
      point.y + normal.y * 2,
      point.z + normal.z * 2,
    );
    const size = surface.decalSize * 0.6;
    decal.mesh.scale.setScalar(size);
  }

  addScorch(point: { x: number; y: number; z: number }, radius: number): void {
    const decal = this.next();
    decal.mesh.visible = true;
    decal.life = 40;
    decal.baseOpacity = 0.5; // parity scorch opacity
    decal.material.color.setHex(0x141210); // parity scorch colour
    decal.material.opacity = 0.5;
    decal.mesh.position.set(point.x, 0.03, point.z);
    decal.mesh.rotation.set(-Math.PI / 2, 0, 0);
    decal.mesh.scale.setScalar(radius * 0.55); // parity
  }

  update(dt: number): void {
    for (const decal of this.decals) {
      if (!decal.mesh.visible) continue;
      decal.life -= dt;
      if (decal.life <= 0) {
        decal.mesh.visible = false;
        decal.material.opacity = 0;
        continue;
      }
      // Fade out over the final three seconds of life.
      const fade = decal.life < 3 ? decal.life / 3 : 1;
      decal.material.opacity = decal.baseOpacity * fade;
    }
  }

  clear(): void {
    for (const decal of this.decals) {
      decal.mesh.visible = false;
      decal.material.opacity = 0;
    }
  }

  dispose(): void {
    for (const decal of this.decals) decal.material.dispose();
    this.geometry.dispose();
    this.decals.length = 0;
  }
}
