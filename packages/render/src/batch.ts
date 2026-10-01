/**
 * Static geometry batching.
 *
 * Detail costs draw calls, and the realism pass multiplies the part count of every
 * prop by roughly six. This is the counterweight: the arena, an enemy's limbs and
 * the weapon on screen are all *static within their own transform*, so their parts
 * can be baked into one merged mesh per material.
 *
 * The rule that keeps it honest: everything in a batch shares a transform. An
 * animated limb is its own batch. A magazine that leaves the weapon during a
 * reload is its own batch. Nothing that moves ever gets batched into something
 * that does not.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Reduce a geometry to the three attributes every primitive shares.
 *
 * `mergeGeometries` refuses to merge geometries whose attribute sets differ, and
 * in this codebase they differ constantly: lathes and boxes carry `uv` and some
 * carry a mirrored `uv1` for AO, torus/icosahedron/`ConvexGeometry` primitives
 * carry no UVs at all. Normalising here means a batch can mix any props it likes.
 */
function toMergeable(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const geometry = source.index ? source.toNonIndexed() : source.clone();
  const position = geometry.getAttribute('position');
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  if (!geometry.getAttribute('uv')) {
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(position.count * 2), 2));
  }
  for (const name of Object.keys(geometry.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') geometry.deleteAttribute(name);
  }
  return geometry;
}

interface Bucket {

  material: THREE.Material;
  castShadow: boolean;
  receiveShadow: boolean;
  geometries: THREE.BufferGeometry[];
}

export class StaticBatcher {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly name = 'batch') {}

  /**
   * Bake `object`'s subtree into the batch, in the coordinate space of
   * `object.parent` (i.e. the transform the object currently has).
   */
  add(object: THREE.Object3D): this {
    object.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = [];
    object.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) meshes.push(child as THREE.Mesh);
    });
    for (const mesh of meshes) {
      const material = mesh.material as THREE.Material;
      const key = `${material.uuid}|${mesh.castShadow ? 1 : 0}|${mesh.receiveShadow ? 1 : 0}`;
      let bucket = this.buckets.get(key);
      if (!bucket) {
        bucket = {
          material,
          castShadow: mesh.castShadow,
          receiveShadow: mesh.receiveShadow,
          geometries: [],
        };
        this.buckets.set(key, bucket);
      }
      // Non-indexed and indexed geometry cannot be merged together, and a clone is
      // required anyway because we bake the transform in.
      const geometry = toMergeable(mesh.geometry);
      geometry.applyMatrix4(mesh.matrixWorld);
      bucket.geometries.push(geometry);
    }
    return this;
  }

  /**
   * Like `add`, but in the coordinate space of `object` itself, so the object's
   * own transform still applies afterwards. This is what a batched limb or weapon
   * needs: bake the parts, keep the pivot animatable.
   */
  addLocal(object: THREE.Object3D): this {
    object.updateMatrixWorld(true);
    const inverse = new THREE.Matrix4().copy(object.matrixWorld).invert();
    const relative = new THREE.Matrix4();
    const meshes: THREE.Mesh[] = [];
    object.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) meshes.push(child as THREE.Mesh);
    });
    for (const mesh of meshes) {
      const material = mesh.material as THREE.Material;
      const key = `${material.uuid}|${mesh.castShadow ? 1 : 0}|${mesh.receiveShadow ? 1 : 0}`;
      let bucket = this.buckets.get(key);
      if (!bucket) {
        bucket = { material, castShadow: mesh.castShadow, receiveShadow: mesh.receiveShadow, geometries: [] };
        this.buckets.set(key, bucket);
      }
      relative.multiplyMatrices(inverse, mesh.matrixWorld);
      const geometry = toMergeable(mesh.geometry);
      geometry.applyMatrix4(relative);
      bucket.geometries.push(geometry);
    }
    return this;
  }

  /** One merged mesh per (material, shadow flags). Disposes the intermediates. */
  build(): THREE.Group {
    const group = new THREE.Group();
    group.name = this.name;
    for (const bucket of this.buckets.values()) {
      const merged = mergeGeometries(bucket.geometries, false);
      for (const geometry of bucket.geometries) geometry.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, bucket.material);
      mesh.castShadow = bucket.castShadow;
      mesh.receiveShadow = bucket.receiveShadow;
      group.add(mesh);
    }
    this.buckets.clear();
    return group;
  }

  get drawCallEstimate(): number {
    return this.buckets.size;
  }
}

/**
 * Batch one prop into a single group, keeping its transform and its identity.
 * Used for the handful of props that must stay individually addressable — barrels
 * are hidden one at a time when they explode.
 */
export function batchOne(object: THREE.Object3D, name: string): THREE.Group {
  flattenLocal(object, name);
  return object as THREE.Group;
}

/** Collapse an object's static children into merged meshes, keeping the object. */
export function flattenLocal(object: THREE.Object3D, name: string): void {
  const batcher = new StaticBatcher(name);
  batcher.addLocal(object);
  const merged = batcher.build();
  for (const child of [...object.children]) {
    if ((child as THREE.Mesh).isMesh) object.remove(child);
  }
  for (const child of [...merged.children]) object.add(child);
}

/** Dispose every merged geometry under a batched group. */
export function disposeBatched(group: THREE.Object3D): void {
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) child.geometry.dispose();
  });
}
