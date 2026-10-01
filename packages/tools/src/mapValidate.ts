/**
 * Map validation. These are the mistakes that only show up as a broken mission:
 * a player spawning inside a wall, a gate with no gap, enemies with nowhere to
 * come from, or a plaza with no cover to fight around.
 */
import { createAabbCollisionWorld } from '@iron/sim';
import type { MapDef } from '@iron/content';

export interface MapIssue {
  mapId: string;
  severity: 'error' | 'warning';
  message: string;
}

export function validateMap(map: MapDef): MapIssue[] {
  const issues: MapIssue[] = [];
  const colliders = createAabbCollisionWorld(map);
  const push = (severity: MapIssue['severity'], message: string): void => {
    issues.push({ mapId: map.id, severity, message });
  };

  // 1. Player spawn must be clear of geometry.
  if (colliders.circleCollides(map.playerSpawn.x, map.playerSpawn.z, 0.6)) {
    push('error', `player spawn (${map.playerSpawn.x}, ${map.playerSpawn.z}) is inside geometry`);
  }

  // 2. Spawn point must be inside the playable bounds.
  const { bounds } = map;
  if (
    map.playerSpawn.x < bounds.minX ||
    map.playerSpawn.x > bounds.maxX ||
    map.playerSpawn.z < bounds.minZ ||
    map.playerSpawn.z > bounds.maxZ
  ) {
    push('error', 'player spawn is outside the playable bounds');
  }

  // 3. Gates must be reachable: a wide-open approach with no wall blocking it.
  if (map.gates.length === 0) push('error', 'map has no gates, so nothing can spawn');
  for (const gate of map.gates) {
    const outsideX = gate.axis === 'x' ? gate.x : gate.x + Math.sign(gate.x || 1) * 5;
    const outsideZ = gate.axis === 'z' ? gate.z : gate.z + Math.sign(gate.z || 1) * 5;
    if (colliders.circleCollides(outsideX, outsideZ, 1)) {
      push('warning', `gate at (${gate.x}, ${gate.z}) may be blocked`);
    }
  }

  // 4. Cover variety: a combat arena needs things to hide behind.
  const coverKinds = new Set(['crate', 'barrel', 'jersey', 'planter', 'kiosk', 'sandbags', 'wreck', 'monument']);
  const coverCount = map.props.filter((prop) => coverKinds.has(prop.kind)).length;
  if (coverCount < 10) push('warning', `only ${coverCount} cover props: fights will feel flat`);

  // 5. Barrels are explosive, so they must not sit on the spawn point.
  for (const prop of map.props) {
    if (prop.kind !== 'barrel') continue;
    const distance = Math.hypot(prop.x - map.playerSpawn.x, prop.z - map.playerSpawn.z);
    if (distance < 6) push('warning', `barrel ${distance.toFixed(1)}m from spawn: unfair opener`);
  }

  // 6. Density: props stacked inside each other read as bugs.
  for (let i = 0; i < map.props.length; i++) {
    for (let j = i + 1; j < map.props.length; j++) {
      const a = map.props[i]!;
      const b = map.props[j]!;
      if (a.x === b.x && a.z === b.z) {
        push('warning', `props overlap exactly at (${a.x}, ${a.z}): ${a.kind} / ${b.kind}`);
      }
    }
  }

  return issues;
}
