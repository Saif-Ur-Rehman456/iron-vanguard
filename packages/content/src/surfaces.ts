import type { SurfaceDef } from './types';

/**
 * Surface table: one row per material class drives impact particles, decals,
 * penetration, ricochet and audio. Bullets ask the surface, never the mesh.
 */
export const SURFACES: readonly SurfaceDef[] = [
  {
    id: 'concrete',
    displayName: 'Concrete',
    impactColor: 0x9a938a,
    decalColor: 0x2a2724,
    decalOpacity: 0.55,
    decalSize: 0.16,
    ricochetChance: 0.06,
    penetrationLoss: 0.12,
    audio: 'impact_concrete',
  },
  {
    id: 'metal',
    displayName: 'Metal',
    impactColor: 0xffdf9a,
    decalColor: 0x1c1a18,
    decalOpacity: 0.6,
    decalSize: 0.12,
    ricochetChance: 0.22,
    penetrationLoss: 0.2,
    audio: 'impact_metal',
  },
  {
    id: 'wood',
    displayName: 'Wood',
    impactColor: 0xb08a52,
    decalColor: 0x33261a,
    decalOpacity: 0.5,
    decalSize: 0.14,
    ricochetChance: 0.03,
    penetrationLoss: 0.08,
    audio: 'impact_wood',
  },
  {
    id: 'sand',
    displayName: 'Sandbag',
    impactColor: 0x8c7d55,
    decalColor: 0x4a4030,
    decalOpacity: 0.4,
    decalSize: 0.18,
    ricochetChance: 0.01,
    penetrationLoss: 0.05,
    audio: 'impact_sand',
  },
  {
    id: 'glass',
    displayName: 'Glass',
    impactColor: 0xcfe6ff,
    decalColor: 0x8fa6b8,
    decalOpacity: 0.35,
    decalSize: 0.2,
    ricochetChance: 0.08,
    penetrationLoss: 0.02,
    audio: 'impact_glass',
  },
  {
    id: 'dirt',
    displayName: 'Dirt',
    impactColor: 0x6b6152,
    decalColor: 0x2e2a22,
    decalOpacity: 0.45,
    decalSize: 0.2,
    ricochetChance: 0,
    penetrationLoss: 0.03,
    audio: 'impact_dirt',
  },
  {
    id: 'flesh',
    displayName: 'Flesh',
    impactColor: 0x8a1410,
    decalColor: 0x5a0f0c,
    decalOpacity: 0.5,
    decalSize: 0.14,
    ricochetChance: 0,
    penetrationLoss: 0.35,
    audio: 'impact_flesh',
  },
];

export const SURFACES_BY_ID: Readonly<Record<string, SurfaceDef>> = Object.fromEntries(
  SURFACES.map((s) => [s.id, s]),
);

export function getSurface(id: string): SurfaceDef {
  const surface = SURFACES_BY_ID[id];
  if (!surface) throw new Error(`unknown surface id: ${id}`);
  return surface;
}
