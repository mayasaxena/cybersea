// Player reference: rules.html?g=<game>. Everything in the Rules tab the crew can see.
import { bootstrap } from './games.js';
import { GameClient } from './api.js';
import { indexRules } from './rules.js';
import { esc, pageShell, refreshNav } from './core.js';
import { SECTIONS, sectionHTML, searchAllHTML, sectionHasContent, showSheetImages } from './refview.js';

const app = document.getElementById('app');
const game = bootstrap();
if (!game) {
  pageShell(app, null, 'rules');
  app.insertAdjacentHTML('beforeend', '<main class="empty-page"><p>Open this page from an invite link first.</p><p><a href="index.html">Go to the start page</a></p></main>');
  throw new Error('no game');
}
const client = new GameClient(game);
pageShell(app, client, 'rules');
const store = client.tab('Rules');
const main = document.createElement('main');
app.append(main);
showSheetImages(main, client);
const KEYS = ['moves', 'playbooks', 'tags', 'reference', 'world', 'other'];
let R = indexRules(store.rows);
let tab = 'moves';
let query = '';

function render() {
  if (!store.loaded) { main.innerHTML = '<div class="empty">Loading…</div>'; return; }
  const tabs = KEYS.filter(k => k === 'moves' || sectionHasContent(R, k));
  if (!tabs.includes(tab)) tab = tabs[0];
  main.innerHTML = `
    <div class="mtools">
      <input type="search" class="in search" id="q" placeholder="Search all rules" value="${esc(query)}" aria-label="Search rules" autocomplete="off">
      <div class="cats">${tabs.map(k => `<button data-tab="${k}" class="${!query && tab === k ? 'on' : ''}">${SECTIONS[k].label}</button>`).join('')}</div>
    </div>
    <div id="ref">${query.trim() ? searchAllHTML(R, tabs, query) : sectionHTML(R, tab)}</div>`;
}

main.addEventListener('click', e => {
  const b = e.target.closest('[data-tab]');
  if (b) { tab = b.dataset.tab; query = ''; render(); }
});
main.addEventListener('input', e => {
  if (e.target.id !== 'q') return;
  query = e.target.value;
  document.getElementById('ref').innerHTML = query.trim() ? searchAllHTML(R, KEYS, query) : sectionHTML(R, tab);
  main.querySelectorAll('.cats button').forEach(b => b.classList.toggle('on', !query && b.dataset.tab === tab));
});
document.addEventListener('keydown', e => {
  if (e.key === '/' && !e.target.closest('input,textarea,select')) { e.preventDefault(); document.getElementById('q')?.focus(); }
});
store.on(() => { R = indexRules(store.rows); render(); });
client.on(e => { if (e.list) refreshNav(client, 'rules'); });
render();
client.read(['Rules']).catch(() => render());
