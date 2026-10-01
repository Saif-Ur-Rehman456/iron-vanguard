/**
 * Optional external models (GLB) with a strict provenance contract.
 *
 * The game ships a complete procedural baseline, and this is the *upgrade* path:
 * a downloaded, licensed model (Sketchfab, a purchased pack, a Blender export) can
 * take over a named slot — one weapon, one archetype, one prop kind — without
 * touching the code that places it. Nothing here is required: an empty manifest, a
 * missing file, a truncated download or a driver that refuses the format all fall
 * back to the procedural build, because a shipped game must never depend on a
 * binary being present.
 *
 * Invariant 5 (AGENTS.md) is enforced upstream: every entry in the manifest must
 * have a row in `assets/licenses/ledger.csv`, checked by `npm run licenses:audit`,
 * and `npm run assets:import` writes both at once so they cannot drift.
 */
import * as THREE from 'three';
import { modelKey, type ModelEntry, type ModelManifest, type ModelSlot } from '@iron/content';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

/**
 * The manifest contract lives in `@iron/content` (it is data, and it is validated
 * there); this module is only the loader.
 */
export type { ModelEntry, ModelManifest, ModelSlot } from '@iron/content';
export { modelKey, parseModelManifest } from '@iron/content';

export interface LoadReport {
  loaded: string[];
  failed: string[];
  issues: string[];
}

/** Loaded models, addressed by `slot.id`. Falls back silently to the baseline. */
export class ModelLibrary {
  private readonly models = new Map<string, THREE.Object3D>();
  readonly report: LoadReport = { loaded: [], failed: [], issues: [] };

  constructor(private readonly manifest: ModelManifest) {}

  /** The manifest this library was built from (what the game actually shipped with). */
  get source(): ModelManifest {
    return this.manifest;
  }

  static empty(): ModelLibrary {
    return new ModelLibrary({ version: 1, modelBasePath: 'models/', models: [] });
  }

  /** Resolve a base URL for the manifest's files (trailing slash optional). */
  static url(baseUrl: string, manifest: ModelManifest, entry: ModelEntry): string {
    const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    const path = manifest.modelBasePath.endsWith('/') ? manifest.modelBasePath : `${manifest.modelBasePath}/`;
    return `${base}${path}${entry.file}`;
  }

  /**
   * Load every entry in parallel. Failures are collected, never thrown: the caller
   * gets a library that may be partially filled.
   */
  static async load(
    manifest: ModelManifest,
    baseUrl: string,
    options: { onIssue?: (message: string) => void } = {},
  ): Promise<ModelLibrary> {
    const library = new ModelLibrary(manifest);
    const report = library.report;
    if (manifest.models.length === 0) return library;

    const loader = new GLTFLoader();
    await Promise.all(
      manifest.models.map(async (entry) => {
        const key = modelKey(entry.slot, entry.id);
        try {
          const gltf = await loader.loadAsync(ModelLibrary.url(baseUrl, manifest, entry));
          const root = gltf.scene;
          root.name = `model_${key}`;
          let skinned = false;
          root.traverse((child) => {
            if ((child as THREE.SkinnedMesh).isSkinnedMesh) skinned = true;
            if (child instanceof THREE.Mesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });
          // Skinned clones need SkeletonUtils; a plain `clone()` shares the bones
          // and every instance would animate as one.
          root.userData['skinned'] = skinned;
          if (entry.scale !== undefined) root.scale.multiplyScalar(entry.scale);
          if (entry.yOffset !== undefined) root.position.y += entry.yOffset;
          if (entry.yawOffset !== undefined) root.rotation.y += entry.yawOffset;
          library.models.set(key, root);
          report.loaded.push(key);
        } catch (error) {
          const message = `${key}: ${(error as Error).message}`;
          report.failed.push(message);
          report.issues.push(`${message} — procedural baseline kept`);
          options.onIssue?.(message);
        }
      }),
    );
    return library;
  }

  has(slot: ModelSlot, id: string): boolean {
    return this.models.has(modelKey(slot, id));
  }

  /**
   * A fresh instance of the model, or null when the slot is not filled. Clones are
   * deep and skinned-aware: two riflemen must not share a skeleton.
   */
  instantiate(slot: ModelSlot, id: string): THREE.Object3D | null {
    const source = this.models.get(modelKey(slot, id));
    if (!source) return null;
    const clone = source.userData['skinned'] ? cloneSkinned(source) : source.clone(true);
    clone.name = `${source.name}_instance`;
    return clone;
  }

  get count(): number {
    return this.models.size;
  }

  dispose(): void {
    for (const model of this.models.values()) {
      model.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          for (const material of materials) material.dispose();
        }
      });
    }
    this.models.clear();
  }
}

/** An empty library — what a build with no downloaded models uses. */
export function emptyModelLibrary(): ModelLibrary {
  return ModelLibrary.empty();
}
