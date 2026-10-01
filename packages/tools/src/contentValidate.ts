/** Content validation: schema, cross-references and per-map sanity. */
import { MAPS, MISSIONS, validateContent, type ContentIssue } from '@iron/content';
import { validateMap, type MapIssue } from './mapValidate';

export interface ValidationSummary {
  content: ContentIssue[];
  maps: MapIssue[];
  ok: boolean;
}

export function validateAll(): ValidationSummary {
  const content = validateContent();
  const maps: MapIssue[] = [];
  for (const map of MAPS) maps.push(...validateMap(map));
  // A mission that points at a missing map is already caught by validateContent.
  for (const mission of MISSIONS) {
    if (!MAPS.some((map) => map.id === mission.mapId)) {
      content.push({ where: `mission:${mission.id}`, message: `map ${mission.mapId} is missing` });
    }
  }
  const ok = content.length === 0 && maps.every((issue) => issue.severity !== 'error');
  return { content, maps, ok };
}
