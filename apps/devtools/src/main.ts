/**
 * Developer tools shell.
 *
 * Deliberately dependency-free (no framework): the tool has to keep working when
 * the game's own stack is mid-refactor, and it must be readable by an agent
 * without learning a new abstraction. Each panel is a tab.
 */
import { PANELS } from './panels';
import './style.css';

const root = document.getElementById('devtools');
if (!root) throw new Error('devtools root missing');

root.innerHTML = `
  <header class="iv-head">
    <div class="iv-mark">IV</div>
    <div>
      <h1>IRON VANGUARD — DEV TOOLS</h1>
      <p class="iv-note">Read-only views of the same modules the game ships. Nothing here is a mock.</p>
    </div>
  </header>
  <nav class="iv-tabs" role="tablist"></nav>
  <main class="iv-panel" role="tabpanel"></main>
  <footer class="iv-foot">
    <span>Harness equivalents:</span>
    <code>npm run sim -- --seed=7</code>
    <code>npm run sweep -- --seeds=8</code>
    <code>npm run bench:sim</code>
    <code>npm run content:validate</code>
  </footer>
`;

const tabs = root.querySelector<HTMLElement>('.iv-tabs')!;
const panelHost = root.querySelector<HTMLElement>('.iv-panel')!;

const buttons = new Map<string, HTMLButtonElement>();

function select(id: string): void {
  const panel = PANELS.find((candidate) => candidate.id === id) ?? PANELS[0]!;
  for (const [key, button] of buttons) {
    button.classList.toggle('active', key === panel.id);
    button.setAttribute('aria-selected', String(key === panel.id));
  }
  panelHost.replaceChildren();
  const header = document.createElement('div');
  header.innerHTML = `<h2>${panel.title}</h2><p class="iv-note">${panel.description}</p>`;
  panelHost.append(header);
  panel.render(panelHost);
  window.location.hash = panel.id;
  document.title = `IV — ${panel.title}`;
}

for (const panel of PANELS) {
  const button = document.createElement('button');
  button.textContent = panel.title;
  button.setAttribute('role', 'tab');
  button.addEventListener('click', () => select(panel.id));
  buttons.set(panel.id, button);
  tabs.append(button);
}

select(window.location.hash.replace('#', '') || PANELS[0]!.id);
