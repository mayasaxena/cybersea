// The world: map.html?g=<game>. Everyone sees it. From the Map tab (edited in the spreadsheet):
//   Region | Location | Level   | Image | Text | GM notes | Shown
//   Vega   |          |         | 🖼    | …    |          |          a region's own map: always shows
//   Vega   | Haven    |         | 🖼    | …    | …        | on       a place: crew see it once Shown is on
//          | Haven    | Level 1 | 🖼    | …    |          |          a floor or level of the place, in order
// A place with no levels is one picture. Image is a picture placed in the cell, or =IMAGE(…).
// GM notes reach only the GM; the script leaves hidden places out of what the crew get.
import { bootstrap } from './games.js';
import { GameClient } from './api.js';
import { md } from './markup.js';
import { pictureHTML, showPictures } from './pictures.js';
import { esc, escTxt, pageShell, refreshNav } from './core.js';

const app = document.getElementById('app');
const game = bootstrap();
if (!game) {
  pageShell(app, null, 'map');
  app.insertAdjacentHTML('beforeend', '<main class="empty-page"><p>Open this page from an invite link first.</p><p><a href="index.html">Go to the start page</a></p></main>');
  throw new Error('no game');
}
const client = new GameClient(game);
pageShell(app, client, 'map');
const store = client.tab('Map');
const main = document.createElement('main');
app.append(main);
let query = '';
let showAll = true; // the GM's view: every place, or only those on the map
const shownLevel = {}; // place index -> which of its levels is showing

const key = s => String(s || '').trim().toLowerCase();
const isGm = () => client.role === 'gm';

// The Map tab as regions, each with its maps and places; a place has its levels.
function world(rows) {
  const regions = [];
  const region = name => {
    let r = regions.find(x => key(x.name) === key(name));
    if (!r) regions.push(r = { name: String(name || '').trim(), maps: [], places: [] });
    return r;
  };
  const places = new Map();
  const levels = [];
  rows.forEach(([reg, loc, level, image, text, notes, shown]) => {
    const item = { name: String(level || loc || reg || '').trim(), image, text: String(text || ''), notes: String(notes || '') };
    if (!String(loc || '').trim()) { region(reg).maps.push(item); return; }
    if (String(level || '').trim()) { levels.push([key(loc), item]); return; }
    if (places.has(key(loc))) return;
    const p = { ...item, i: places.size, on: shown === 'on', levels: [] };
    places.set(key(loc), p);
    region(reg).places.push(p);
  });
  for (const [k, lv] of levels) places.get(k)?.levels.push(lv);
  for (const p of places.values()) p.search = [p.name, p.text, p.notes, ...p.levels.flatMap(l => [l.name, l.text])].join(' ').toLowerCase();
  return regions;
}

const imgHTML = (item, cls) => pictureHTML('Map', item.image, item.name, cls);
showPictures(main, client);

/* ---------- the page ---------- */

const notesHTML = it => (isGm() && it.notes.trim() ? `<details class="orig"><summary>GM notes</summary>${md(it.notes)}</details>` : '');

function placeHTML(p) {
  const at = Math.min(shownLevel[p.i] || 0, Math.max(p.levels.length - 1, 0));
  const lv = p.levels[at];
  const toggle = isGm()
    ? `<button class="pbtn mapon${p.on ? ' on' : ''}" data-place="${p.i}" aria-pressed="${p.on}" title="${p.on ? 'Take it off the crew’s map' : 'Put it on the crew’s map'}">${p.on ? 'On the map' : 'Hidden'}</button>`
    : '';
  return `<section class="card loc${p.on ? '' : ' off'}" id="loc-${p.i}"><div class="shead"><h2>${escTxt(p.name)}</h2>${toggle}</div>
    ${p.text.trim() ? `<div class="rich">${md(p.text)}</div>` : ''}
    ${imgHTML(p, 'rimg')}
    ${p.levels.length ? `<div class="levels">
      <div class="cats" role="tablist">${p.levels.map((l, k) => `<button role="tab" data-loc="${p.i}" data-lv="${k}" aria-selected="${k === at}" class="${k === at ? 'on' : ''}">${escTxt(l.name)}</button>`).join('')}</div>
      ${lv.text.trim() ? `<div class="rich">${md(lv.text)}</div>` : ''}${imgHTML(lv, 'rimg')}</div>` : ''}
    ${notesHTML(p)}</section>`;
}

let W = [];
const allPlaces = () => W.flatMap(r => r.places);

function render() {
  if (!store.loaded && !store.missing) { main.innerHTML = '<div class="empty">Loading…</div>'; return; }
  if (store.missing) { main.innerHTML = `<div class="empty">${isGm() ? 'Add a Map tab to the spreadsheet (see SETUP.md) to fill this page.' : 'Nothing on the map yet.'}</div>`; return; }
  const q = query.trim().toLowerCase();
  const gm = isGm();
  const onCount = allPlaces().filter(p => p.on).length;
  const visible = p => (!q || p.search.includes(q)) && ((gm && showAll) || p.on);
  const none = gm ? (q ? 'No matches.' : showAll ? 'No places in the Map tab yet.' : 'No places on the map yet: show every place and turn some on.')
    : (q ? 'No matches.' : 'Nothing on the map yet.');
  const regions = W.map(r => ({ ...r, maps: r.maps.filter(m => !q || `${m.name} ${m.text}`.toLowerCase().includes(q)), places: r.places.filter(visible) }))
    .filter(r => r.maps.length || r.places.length);
  main.innerHTML = `
    <div class="mtools">
      <input type="search" class="in search" id="q" placeholder="Search places" value="${esc(query)}" aria-label="Search places" autocomplete="off">
      ${gm ? `<div class="cats"><button data-show="all" class="${showAll ? 'on' : ''}">Every place</button><button data-show="on" class="${showAll ? '' : 'on'}">On the map (${onCount})</button></div>` : ''}
    </div>
    ${gm ? '<div class="robar"><span>You choose which places the crew see; every place starts hidden.</span></div>' : ''}
    <div id="world">
      ${regions.map(r => `
        ${r.maps.map(m => `<section class="worldmap"><h2>${escTxt(m.name)}</h2>${imgHTML(m, 'mapimg')}${m.text.trim() ? `<div class="rich">${md(m.text)}</div>` : ''}${notesHTML(m)}</section>`).join('')}
        ${r.places.length ? `<div class="mgroup"><h3>${escTxt(r.name || 'Places')}</h3><div class="cols">${r.places.map(placeHTML).join('')}</div></div>` : ''}`).join('')}
      ${!regions.some(r => r.places.length) ? `<div class="empty">${none}</div>` : ''}
    </div>`;
}

const rerenderCard = p => { const el = document.getElementById(`loc-${p.i}`); if (el) el.outerHTML = placeHTML(p); };

async function setOn(p, on) {
  p.on = on; // shows at once; the read that follows has the sheet's word
  render();
  try {
    const r = await client.request({ op: 'show', location: p.name, on });
    if (!r.ok) throw new Error(r.error);
  } finally {
    await client.read(['Map']).catch(() => {});
  }
}

main.addEventListener('click', e => {
  const t = e.target.closest('[data-place]');
  if (t && isGm()) {
    const p = allPlaces().find(x => String(x.i) === t.dataset.place);
    if (p) setOn(p, !p.on).catch(err => alert(err.message));
    return;
  }
  const s = e.target.closest('[data-show]');
  if (s) { showAll = s.dataset.show === 'all'; render(); return; }
  const b = e.target.closest('[data-lv]');
  if (!b) return;
  shownLevel[b.dataset.loc] = +b.dataset.lv;
  const p = allPlaces().find(x => String(x.i) === b.dataset.loc);
  if (p) rerenderCard(p);
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
store.on(() => { W = world(store.rows); render(); });
client.on(e => {
  if (e.list) refreshNav(client, 'map');
  if (e.list || e.key || e.auth) render();
});
render();
client.watch('Map');
client.read(['Map']).catch(() => render());
client.startPolling();
