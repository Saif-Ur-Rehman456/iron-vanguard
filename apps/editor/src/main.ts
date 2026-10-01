/**
 * Level editor UI.
 *
 * A top-down canvas over the real MapDef with a property inspector, live
 * validation through the game's own map checks, and export back to TypeScript.
 * No 3D viewport yet — this is the tool for the hundreds of small placement
 * decisions, which is what actually costs level-design time.
 */
import { PLAZA_MAP, getMission, type PropDef, type PropKind } from '@iron/content';
import { validateMap } from '@iron/tools';
import { MapEditor, KIND_STYLE, PROP_KINDS } from './mapEditor';
import './style.css';

const root = document.getElementById('editor');
if (!root) throw new Error('editor root missing');

root.innerHTML = `
  <header class="ed-head">
    <div class="ed-mark">IV</div>
    <div>
      <h1>LEVEL EDITOR</h1>
      <p class="ed-note">Al Kadim Plaza · drag to move · shift-drag to lock an axis · wheel to zoom · right-drag to pan</p>
    </div>
    <div class="ed-actions">
      <button id="undo">UNDO</button>
      <button id="exportTs">EXPORT .TS</button>
      <button id="exportJson">COPY JSON</button>
      <button id="importJson">IMPORT JSON</button>
    </div>
  </header>
  <div class="ed-body">
    <canvas id="view"></canvas>
    <aside class="ed-side">
      <section>
        <h2>ADD</h2>
        <select id="addKind">${PROP_KINDS.map((k) => `<option value="${k}">${k}</option>`).join('')}</select>
        <button id="addBtn">ADD AT SPAWN</button>
      </section>
      <section>
        <h2>SELECTION</h2>
        <div id="inspector" class="ed-inspector"><p class="ed-note">Nothing selected.</p></div>
      </section>
      <section>
        <h2>VALIDATION</h2>
        <div id="issues"></div>
      </section>
      <section>
        <h2>MISSION</h2>
        <div id="missionInfo" class="ed-note"></div>
      </section>
    </aside>
  </div>
  <footer class="ed-foot">
    <span id="status">ready</span>
    <span id="cursorPos"></span>
  </footer>
`;

const canvas = root.querySelector<HTMLCanvasElement>('#view')!;
const ctx = canvas.getContext('2d')!;
const inspector = root.querySelector<HTMLElement>('#inspector')!;
const issuesHost = root.querySelector<HTMLElement>('#issues')!;
const statusLine = root.querySelector<HTMLElement>('#status')!;
const cursorLine = root.querySelector<HTMLElement>('#cursorPos')!;

const editor = new MapEditor(PLAZA_MAP);
const view = { offsetX: 0, offsetZ: 0, scale: 4 };

let dragging: { index: number; mode: 'move' | 'pan'; startX: number; startZ: number; axis: 0 | 1 | 2 } | null =
  null;
let shiftHeld = false;

function resize(): void {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(320, Math.floor(rect.width * dpr));
  canvas.height = Math.max(240, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

/** World → screen. North (+Z) is up, matching the in-game compass. */
function toScreen(x: number, z: number): { x: number; y: number } {
  return {
    x: canvas.clientWidth / 2 + (x - view.offsetX) * view.scale,
    y: canvas.clientHeight / 2 - (z - view.offsetZ) * view.scale,
  };
}

/** Screen → world. */
function toWorld(sx: number, sy: number): { x: number; z: number } {
  return {
    x: (sx - canvas.clientWidth / 2) / view.scale + view.offsetX,
    z: (canvas.clientHeight / 2 - sy) / view.scale + view.offsetZ,
  };
}

function draw(): void {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#0d1013';
  ctx.fillRect(0, 0, width, height);

  const { bounds } = editor.map;

  // Grid every 5 m.
  ctx.strokeStyle = '#1b2127';
  ctx.lineWidth = 1;
  const cell = 5 * view.scale;
  if (cell > 4) {
    const startX = ((bounds.minX - view.offsetX) * view.scale + width / 2) % cell;
    for (let x = startX; x < width; x += cell) line(x, 0, x, height);
    const startY = (height / 2 - (bounds.maxZ - view.offsetZ) * view.scale) % cell;
    for (let y = startY; y < height; y += cell) line(0, y, width, y);
  }

  // Bounds.
  const min = toScreen(bounds.minX, bounds.maxZ);
  const max = toScreen(bounds.maxX, bounds.minZ);
  ctx.strokeStyle = '#3d4a55';
  ctx.lineWidth = 2;
  ctx.strokeRect(min.x, min.y, max.x - min.x, max.y - min.y);

  // Gates.
  ctx.strokeStyle = '#c9a227';
  ctx.lineWidth = 3;
  for (const gate of editor.map.gates) {
    const point = toScreen(gate.x, gate.z);
    const half = 8 * view.scale;
    if (gate.axis === 'x') line(point.x - half, point.y, point.x + half, point.y);
    else line(point.x, point.y - half, point.x, point.y + half);
  }

  // Player spawn.
  const spawn = toScreen(editor.map.playerSpawn.x, editor.map.playerSpawn.z);
  ctx.strokeStyle = '#4fd1c5';
  ctx.beginPath();
  ctx.arc(spawn.x, spawn.y, 6, 0, Math.PI * 2);
  ctx.stroke();

  // Props: footprint first, then the kind glyph.
  const obstacles = editor.obstacles();
  editor.props.forEach((prop, index) => {
    const obstacle = obstacles.find((o) => o.x === prop.x && o.z === prop.z && o.tag === prop.kind);
    const style = KIND_STYLE[prop.kind] ?? { color: '#888', blocking: false };
    const point = toScreen(prop.x, prop.z);
    ctx.fillStyle = style.color;
    ctx.globalAlpha = editor.selection?.index === index ? 0.95 : 0.75;

    if (obstacle) {
      const half = toScreen(prop.x + obstacle.hx, prop.z + obstacle.hz);
      const size = Math.max(3, (point.x - half.x) * 2);
      ctx.fillRect(point.x - size / 2, point.y - size / 2, size, size);
    } else {
      ctx.beginPath();
      ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (editor.selection?.index === index) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.strokeRect(point.x - 12, point.y - 12, 24, 24);
    }
  });

  // Extraction zone from the mission, so the designer can see the goal.
  const zone = getMission('m00_prologue').objectives.find((o) => o.params.zone)?.params.zone;
  if (zone) {
    const point = toScreen(zone.x, zone.z);
    ctx.strokeStyle = '#6ee7a8';
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.arc(point.x, point.y, zone.radius * view.scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function line(x1: number, y1: number, x2: number, y2: number): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function refresh(): void {
  draw();
  renderInspector();
  renderIssues();
}

function renderInspector(): void {
  const prop = editor.selected();
  const index = editor.selection?.index;
  if (!prop || index === undefined) {
    inspector.replaceChildren(Object.assign(document.createElement('p'), { className: 'ed-note', textContent: 'Nothing selected.' }));
    return;
  }
  inspector.innerHTML = `
    <div class="ed-row"><span>index</span><b>${index}</b></div>
    <label>kind<select data-field="kind">${PROP_KINDS.map(
      (kind) => `<option value="${kind}"${kind === prop.kind ? ' selected' : ''}>${kind}</option>`,
    ).join('')}</select></label>
    <label>x<input data-field="x" type="number" step="0.5" value="${prop.x}"></label>
    <label>z<input data-field="z" type="number" step="0.5" value="${prop.z}"></label>
    <label>ry<input data-field="ry" type="number" step="0.1" value="${prop.ry ?? 0}"></label>
    <label>size<input data-field="size" type="number" step="0.1" value="${prop.size ?? ''}"></label>
    <label>depth<input data-field="depth" type="number" step="0.1" value="${prop.depth ?? ''}"></label>
    <label>height<input data-field="height" type="number" step="0.5" value="${prop.height ?? ''}"></label>
    <label>variant<input data-field="variant" type="number" step="1" value="${prop.variant ?? 0}"></label>
    <label>tag<input data-field="tag" type="text" value="${prop.tag ?? ''}"></label>
    <div class="ed-row-btns">
      <button id="duplicateBtn">DUPLICATE</button>
      <button id="deleteBtn" class="danger">DELETE</button>
    </div>
  `;

  for (const input of inspector.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-field]')) {
    input.addEventListener('change', () => {
      const field = input.dataset.field as keyof PropDef;
      const raw = input.value;
      if (field === 'kind') {
        editor.updateSelected({ kind: raw as PropKind });
      } else if (field === 'tag') {
        editor.updateSelected({ tag: raw === '' ? undefined : raw });
      } else if (raw === '') {
        editor.updateSelected({ [field]: undefined } as Partial<PropDef>);
      } else {
        editor.updateSelected({ [field]: Number(raw) } as Partial<PropDef>);
      }
      refresh();
    });
  }
  inspector.querySelector('#duplicateBtn')!.addEventListener('click', () => {
    editor.duplicateSelected();
    refresh();
  });
  inspector.querySelector('#deleteBtn')!.addEventListener('click', () => {
    editor.deleteSelected();
    refresh();
  });
}

function renderIssues(): void {
  const issues = validateMap(editor.map);
  issuesHost.replaceChildren();
  if (issues.length === 0) {
    const ok = document.createElement('p');
    ok.className = 'ed-ok';
    ok.textContent = `PASS — ${editor.props.length} props, ${editor.obstacles().length} blockers`;
    issuesHost.append(ok);
    return;
  }
  for (const issue of issues) {
    const row = document.createElement('p');
    row.className = issue.severity === 'error' ? 'ed-bad' : 'ed-warn';
    row.textContent = `${issue.severity.toUpperCase()}: ${issue.message}`;
    issuesHost.append(row);
  }
}

const mission = getMission('m00_prologue');
root.querySelector('#missionInfo')!.textContent =
  `${mission.codename} — ${mission.subtitle}. Extraction zone is drawn dashed; gates are gold.`;

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------

canvas.addEventListener('pointerdown', (event) => {
  const rect = canvas.getBoundingClientRect();
  const world = toWorld(event.clientX - rect.left, event.clientY - rect.top);
  canvas.setPointerCapture(event.pointerId);
  if (event.button === 2) {
    dragging = { index: -1, mode: 'pan', startX: world.x, startZ: world.z, axis: 0 };
    return;
  }
  const hit = editor.pick(world.x, world.z);
  editor.selection = hit === null ? null : { index: hit };
  dragging =
    hit === null
      ? null
      : { index: hit, mode: 'move', startX: editor.props[hit]!.x, startZ: editor.props[hit]!.z, axis: 0 };
  refresh();
});

canvas.addEventListener('pointermove', (event) => {
  const rect = canvas.getBoundingClientRect();
  const sx = event.clientX - rect.left;
  const sy = event.clientY - rect.top;
  const world = toWorld(sx, sy);
  cursorLine.textContent = `x ${world.x.toFixed(1)} z ${world.z.toFixed(1)}`;

  if (!dragging) return;
  if (dragging.mode === 'pan') {
    view.offsetX -= (world.x - dragging.startX);
    view.offsetZ -= (world.z - dragging.startZ);
    dragging.startX = world.x;
    dragging.startZ = world.z;
    draw();
    return;
  }

  // Shift locks the drag to the dominant axis, like every other level tool.
  if (shiftHeld) {
    const dx = Math.abs(world.x - dragging.startX);
    const dz = Math.abs(world.z - dragging.startZ);
    if (dx > 0.4 || dz > 0.4) dragging.axis = dx >= dz ? 1 : 2;
  } else {
    dragging.axis = 0;
  }
  const x = dragging.axis === 2 ? dragging.startX : world.x;
  const z = dragging.axis === 1 ? dragging.startZ : world.z;
  editor.moveSelected(x, z);
  refresh();
});

canvas.addEventListener('pointerup', (event) => {
  canvas.releasePointerCapture(event.pointerId);
  dragging = null;
});

canvas.addEventListener('contextmenu', (event) => event.preventDefault());
canvas.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const before = toWorld(event.clientX - rect.left, event.clientY - rect.top);
    view.scale = Math.max(1.5, Math.min(16, view.scale * (event.deltaY < 0 ? 1.12 : 1 / 1.12)));
    const after = toWorld(event.clientX - rect.left, event.clientY - rect.top);
    // Keep the point under the cursor fixed while zooming.
    view.offsetX += before.x - after.x;
    view.offsetZ += before.z - after.z;
    draw();
  },
  { passive: false },
);

window.addEventListener('keydown', (event) => {
  shiftHeld = event.shiftKey;
  if (event.key === 'Delete' || event.key === 'Backspace') {
    editor.deleteSelected();
    refresh();
  }
  if (event.metaKey || event.ctrlKey) {
    if (event.key.toLowerCase() === 'z') {
      if (editor.undo()) refresh();
      event.preventDefault();
    }
    if (event.key.toLowerCase() === 'd') {
      editor.duplicateSelected();
      refresh();
      event.preventDefault();
    }
  }
});
window.addEventListener('keyup', (event) => {
  shiftHeld = event.shiftKey;
});
window.addEventListener('resize', resize);

root.querySelector('#addBtn')!.addEventListener('click', () => {
  const kind = root.querySelector<HTMLSelectElement>('#addKind')!.value as PropKind;
  editor.addProp(kind, editor.map.playerSpawn.x, editor.map.playerSpawn.z);
  refresh();
  setStatus(`added ${kind}`);
});

root.querySelector('#undo')!.addEventListener('click', () => {
  if (editor.undo()) {
    refresh();
    setStatus('undo');
  }
});

function download(name: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

root.querySelector('#exportTs')!.addEventListener('click', () => {
  download(`${editor.map.id}.ts`, editor.toTypeScript());
  setStatus(`exported ${editor.map.id}.ts`);
});

root.querySelector('#exportJson')!.addEventListener('click', async () => {
  await navigator.clipboard.writeText(editor.toJson());
  setStatus('map JSON copied to clipboard');
});

root.querySelector('#importJson')!.addEventListener('click', () => {
  const text = window.prompt('Paste a map JSON document:');
  if (!text) return;
  try {
    editor.fromJson(text);
    refresh();
    setStatus('imported map JSON');
  } catch (error) {
    setStatus(`IMPORT FAILED: ${(error as Error).message}`);
  }
});

function setStatus(text: string): void {
  statusLine.textContent = text;
}

editor.onChange = () => refresh();
resize();
refresh();
