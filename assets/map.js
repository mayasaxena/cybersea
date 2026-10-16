// The world: map.html?g=<game>. Everyone sees it. From the Rules tab (edited in the spreadsheet):
//   map      | Group | Name     | Text | img=…        a map of the whole world (or a region)
//   location | Group | Name     | Text | img=…        a place; Group is the region it's listed under
//   level    | Place | Level 1  | Text | img=…        a floor or level of a place, in order
// The book's locations and new ones alike; Override name/text/meta give a book location the
// game's own name, text and image (see rules.js).
import { bootstrap } from './games.js';
import { GameClient } from './api.js';
import { indexRules } from './rules.js';
import { md } from './markup.js';
import { esc, escTxt, pageShell, refreshNav } from './core.js';
import { imgHTML, origHTML } from './refview.js';

const app = document.getElementById('app');
const game = bootstrap();
if (!game) {
  pageShell(app, null, 'map');
  app.insertAdjacentHTML('beforeend', '<main class="empty-page"><p>Open this page from an invite link first.</p><p><a href="index.html">Go to the start page</a></p></main>');
  throw new Error('no game');
}
const client = new GameClient(game);
pageShell(app, client, 'map');
const store = client.tab('Rules');
const main = document.createElement('main');
app.append(main);
let R = indexRules(store.rows);
let query = '';
const shownLevel = {}; // location index -> which of its levels is showing

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const levelsOf = loc => R.by('level').filter(l => same(l.group, loc.name) || (loc.orig && same(l.group, loc.orig.name)));
const matches = (r, q) => !q || r.search.includes(q) || levelsOf(r).some(l => l.search.includes(q));

function locationHTML(loc) {
  const levels = levelsOf(loc);
  const at = Math.min(shownLevel[loc.i] || 0, Math.max(levels.length - 1, 0));
  const lv = levels[at];
  return `<section class="card loc" id="loc-${loc.i}"><div class="shead"><h2>${escTxt(loc.name)}</h2>${loc.vis === 'gm' ? '<span class="cnt">GM</span>' : ''}</div>
    ${loc.text.trim() ? `<div class="rich">${md(loc.text)}</div>` : ''}
    ${imgHTML(loc, 'rimg')}
    ${levels.length ? `<div class="levels">
      <div class="cats" role="tablist">${levels.map((l, k) => `<button role="tab" data-loc="${loc.i}" data-lv="${k}" aria-selected="${k === at}" class="${k === at ? 'on' : ''}">${escTxt(l.name)}</button>`).join('')}</div>
      ${lv.text.trim() ? `<div class="rich">${md(lv.text)}</div>` : ''}${imgHTML(lv, 'rimg')}</div>` : ''}
    ${origHTML(loc)}</section>`;
}

function render() {
  if (!store.loaded) { main.innerHTML = '<div class="empty">Loading…</div>'; return; }
  const q = query.trim().toLowerCase();
  const maps = R.by('map').filter(m => !q || m.search.includes(q));
  const locs = R.by('location').filter(l => matches(l, q));
  const groups = [...new Set(locs.map(l => l.group))];
  main.innerHTML = `
    <div class="mtools">
      <input type="search" class="in search" id="q" placeholder="Search places" value="${esc(query)}" aria-label="Search places" autocomplete="off">
    </div>
    <div id="world">
      ${maps.map(m => `<section class="worldmap"><h2>${escTxt(m.name)}</h2>${imgHTML(m, 'mapimg')}${m.text.trim() ? `<div class="rich">${md(m.text)}</div>` : ''}${origHTML(m)}</section>`).join('')}
      ${groups.map(g => `<div class="mgroup"><h3>${escTxt(g || 'Places')}</h3><div class="cols">${locs.filter(l => l.group === g).map(locationHTML).join('')}</div></div>`).join('')}
      ${!maps.length && !locs.length ? `<div class="empty">${q ? 'No matches.' : 'No maps or locations in the Rules tab yet.'}</div>` : ''}
    </div>`;
}

main.addEventListener('click', e => {
  const b = e.target.closest('[data-lv]');
  if (!b) return;
  shownLevel[b.dataset.loc] = +b.dataset.lv;
  const loc = R.recs.find(r => r.kind === 'location' && String(r.i) === b.dataset.loc);
  if (loc) document.getElementById(`loc-${loc.i}`).outerHTML = locationHTML(loc);
});
main.addEventListener('input', e => {
  if (e.target.id !== 'q') return;
  query = e.target.value;
  const pos = e.target.selectionStart;
  render();
  const q = document.getElementById('q');
  q.focus();
  q.setSelectionRange(pos, pos);
});
store.on(() => { R = indexRules(store.rows); render(); });
client.on(e => { if (e.list) refreshNav(client, 'map'); });
render();
client.read(['Rules']).catch(() => render());
