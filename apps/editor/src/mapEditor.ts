/**
 * Level editor model.
 *
 * The map is plain data (see packages/content/src/types.ts), so the editor is a
 * thin layer over that data: read a MapDef, mutate props, hand a MapDef back.
 * Everything the game cares about — collision footprints, gate placement, cover
 * density — is derived with the *same* functions the simulation uses, so the
 * editor cannot disagree with the game about what a prop blocks.
 */
import { obstaclesFromMap } from '@iron/sim';
import type { MapDef, PropDef, PropKind } from '@iron/content';
import type { Obstacle } from '@iron/core';

export const PROP_KINDS: readonly PropKind[] = [
  'building',
  'wall',
  'crate',
  'barrel',
  'jersey',
  'planter',
  'kiosk',
  'sandbags',
  'wreck',
  'lamp',
  'pole',
  'tire',
  'rock',
  'puddle',
  'monument',
  'banner',
  'skyline',
  'firepit',
];

/** Editor palette per kind: fill, and whether it blocks movement. */
export const KIND_STYLE: Record<PropKind, { color: string; blocking: boolean }> = {
  building: { color: '#4b5560', blocking: true },
  wall: { color: '#39424b', blocking: true },
  crate: { color: '#8b6b3f', blocking: true },
  barrel: { color: '#c0392b', blocking: true },
  jersey: { color: '#9aa5ad', blocking: true },
  planter: { color: '#3f7d52', blocking: true },
  kiosk: { color: '#7a6a4f', blocking: true },
  sandbags: { color: '#b3a179', blocking: true },
  wreck: { color: '#6b6154', blocking: true },
  lamp: { color: '#c9a227', blocking: true },
  pole: { color: '#8a8f96', blocking: true },
  tire: { color: '#2b2f33', blocking: false },
  rock: { color: '#5c5f63', blocking: false },
  puddle: { color: '#2d6378', blocking: false },
  monument: { color: '#8f8f8f', blocking: true },
  banner: { color: '#a34a3a', blocking: false },
  skyline: { color: '#22262b', blocking: false },
  firepit: { color: '#e07a2a', blocking: true },
};

export interface EditorSelection {
  index: number;
}

export class MapEditor {
  map: MapDef;
  selection: EditorSelection | null = null;
  /** Set by the host so the canvas can repaint after a mutation. */
  onChange: () => void = () => {};
  private history: string[] = [];

  constructor(map: MapDef) {
    this.map = structuredClone({ ...map, props: [...map.props] }) as MapDef;
    this.pushHistory();
  }

  get props(): PropDef[] {
    return this.map.props as PropDef[];
  }

  /** Collision footprints, computed exactly like the simulation does. */
  obstacles(): Obstacle[] {
    return obstaclesFromMap(this.map);
  }

  selected(): PropDef | null {
    if (!this.selection) return null;
    return this.props[this.selection.index] ?? null;
  }

  private pushHistory(): void {
    this.history.push(JSON.stringify(this.map));
    if (this.history.length > 60) this.history.shift();
  }

  undo(): boolean {
    if (this.history.length < 2) return false;
    this.history.pop();
    this.map = JSON.parse(this.history[this.history.length - 1]!) as MapDef;
    this.clampSelection();
    this.onChange();
    return true;
  }

  private clampSelection(): void {
    if (this.selection && this.selection.index >= this.props.length) {
      this.selection = this.props.length > 0 ? { index: this.props.length - 1 } : null;
    }
  }

  private commit(): void {
    this.pushHistory();
    this.onChange();
  }

  addProp(kind: PropKind, x: number, z: number): number {
    const index = this.props.length;
    this.props.push({ kind, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 });
    this.selection = { index };
    this.commit();
    return index;
  }

  duplicateSelected(): void {
    const prop = this.selected();
    if (!prop) return;
    this.props.push({ ...prop, x: prop.x + 3, z: prop.z + 3 });
    this.selection = { index: this.props.length - 1 };
    this.commit();
  }

  deleteSelected(): void {
    if (!this.selection) return;
    this.props.splice(this.selection.index, 1);
    this.selection = this.props.length > 0 ? { index: Math.max(0, this.selection.index - 1) } : null;
    this.commit();
  }

  updateSelected(patch: Partial<PropDef>): void {
    const prop = this.selected();
    if (!prop) return;
    Object.assign(prop, patch);
    this.commit();
  }

  moveSelected(x: number, z: number, snap = 0.5): void {
    const prop = this.selected();
    if (!prop) return;
    const quantise = (value: number): number => Math.round(value / snap) * snap;
    this.updateSelected({ x: quantise(x), z: quantise(z) });
  }

  /** Nearest prop under a world point, using its collision footprint when it has one. */
  pick(x: number, z: number): number | null {
    const obstacles = this.obstacles();
    let best: number | null = null;
    let bestDistance = Infinity;
    this.props.forEach((prop, index) => {
      const obstacle = obstacles.find((o) => o.x === prop.x && o.z === prop.z && o.tag === prop.kind);
      const reach = obstacle ? Math.max(obstacle.hx, obstacle.hz, 0.9) : 0.9;
      const distance = Math.hypot(prop.x - x, prop.z - z);
      if (distance <= reach && distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    return best;
  }

  setMeta(patch: Partial<Pick<MapDef, 'id' | 'name' | 'playerSpawn' | 'bounds'>>): void {
    Object.assign(this.map, patch);
    this.commit();
  }

  toJson(): string {
    return JSON.stringify(this.map, null, 2);
  }

  fromJson(text: string): void {
    const parsed = JSON.parse(text) as MapDef;
    if (!parsed || !Array.isArray(parsed.props)) throw new Error('not a map: missing props[]');
    this.map = parsed;
    this.selection = null;
    this.commit();
  }

  /**
   * Emit a TypeScript module with the same shape as
   * packages/content/src/maps/plaza.ts, so an edit can be committed as a diff
   * rather than pasted through a UI.
   */
  toTypeScript(): string {
    const propLine = (prop: PropDef): string => {
      const parts = [`kind: '${prop.kind}'`, `x: ${prop.x}`, `z: ${prop.z}`];
      if (prop.ry !== undefined) parts.push(`ry: ${round(prop.ry)}`);
      if (prop.size !== undefined) parts.push(`size: ${prop.size}`);
      if (prop.depth !== undefined) parts.push(`depth: ${prop.depth}`);
      if (prop.height !== undefined) parts.push(`height: ${prop.height}`);
      if (prop.variant !== undefined) parts.push(`variant: ${prop.variant}`);
      if (prop.burning) parts.push('burning: true');
      if (prop.tag) parts.push(`tag: '${prop.tag}'`);
      return `  { ${parts.join(', ')} },`;
    };
    return `import type { MapDef, PropDef } from '../types';

/**
 * ${this.map.name} — exported from apps/editor (${this.props.length} props).
 * Regenerate with the editor, or hand-edit: it is plain data.
 */
const props: PropDef[] = [
${this.props.map(propLine).join('\n')}
];

export const ${constantName(this.map.id)}: MapDef = {
  id: '${this.map.id}',
  name: ${JSON.stringify(this.map.name)},
  bounds: ${JSON.stringify(this.map.bounds)},
  playerSpawn: ${JSON.stringify(this.map.playerSpawn)},
  groundSurface: '${this.map.groundSurface}',
  props,
  gates: ${JSON.stringify(this.map.gates)},
  ambient: ${JSON.stringify(this.map.ambient, null, 2).replace(/\n/g, '\n  ')},
};

export const MAPS: readonly MapDef[] = [${constantName(this.map.id)}];
`;
  }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function constantName(id: string): string {
  return `${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_MAP`;
}
