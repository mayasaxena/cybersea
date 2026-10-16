// The world: map.html?g=<game>. Everyone sees it. From the Rules tab (edited in the spreadsheet):
//   map      | Group | Name     | Text | img=…        a map of the whole world (or a region)
//   location | Group | Name     | Text | img=…        a place; Group is the region it's listed under
//   level    | Place | Level 1  | Text | img=…        a floor or level of a place, in order
// The image is a picture placed in the row's Image cell (or an =IMAGE() formula there).
// The book's locations and new ones alike; Override name/text/meta give a book location the
// game's own name, text and image (see rules.js).
//
// The GM picks which places are on the map, here or in the Map tab (the GM's alone):
//   place | the location's book name | on | its name as shown (a reminder for people reading the tab)
// Crew see only places that are on; maps always show, and levels show with their place.
import { bootstrap } from './games.js';
import { GameClient } from './api.js';
import { indexRules } from './rules.js';
import { md } from './markup.js';
import { esc, escTxt, pageShell, refreshNav } from './core.js';
import { imgHTML, origHTML, showSheetImages } from './refview.js';

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
const placesStore = client.tab('Map');
const main = document.createElement('main');
app.append(main);
showSheetImages(main, client);
let R = indexRules(store.rows);
let query = '';
let showAll = true; // the GM's view: every place, or only those on the map
const shownLevel = {}; // location index -> which of its levels is showing

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const isGm = () => client.role === 'gm';
const levelsOf = loc => R.by('level').filter(l => same(l.group, loc.name) || (loc.orig && same(l.group, loc.orig.name)));
const matches = (r, q) => !q || r.search.includes(q) || levelsOf(r).some(l => l.search.includes(q));

// A place is keyed by its book name, so theming it (a new name) keeps it on the map.
const placeKey = loc => (loc.orig ? loc.orig.name : loc.name);
const placeRow = loc => placesStore.rows.find(r => same(String(r[0]).trim(), 'place') && same(String(r[1]).trim(), placeKey(loc)));
const isOn = loc => /^(on|yes|y|x|true|●|1)$/i.test(String(placeRow(loc)?.[2] ?? '').trim());

function locationHTML(loc) {
  const levels = levelsOf(loc);
  const at = Math.min(shownLevel[loc.i] || 0, Math.max(levels.length - 1, 0));
  const lv = levels[at];
  const on = isOn(loc);
  const toggle = isGm()
    ? `<button class="pbtn mapon${on ? ' on' : ''}" data-place="${loc.i}" aria-pressed="${on}" title="${on ? 'Take it off the crew’s map' : 'Put it on the crew’s map'}">${on ? 'On the map' : 'Hidden'}</button>`
    : '';
  return `<section class="card loc${on ? '' : ' off'}" id="loc-${loc.i}"><div class="shead"><h2>${escTxt(loc.name)}</h2>${loc.vis === 'gm' ? '<span class="cnt">GM</span>' : ''}${toggle}</div>
    ${loc.text.trim() ? `<div class="rich">${md(loc.text)}</div>` : ''}
    ${imgHTML(loc, 'rimg')}
    ${levels.length ? `<div class="levels">
      <div class="cats" role="tablist">${levels.map((l, k) => `<button role="tab" data-loc="${loc.i}" data-lv="${k}" aria-selected="${k === at}" class="${k === at ? 'on' : ''}">${escTxt(l.name)}</button>`).join('')}</div>
      ${lv.text.trim() ? `<div class="rich">${md(lv.text)}</div>` : ''}${imgHTML(lv, 'rimg')}</div>` : ''}
    ${origHTML(loc)}</section>`;
}

function render() {
  if (!store.loaded || (!placesStore.loaded && !placesStore.missing)) { main.innerHTML = '<div class="empty">Loading…</div>'; return; }
  const q = query.trim().toLowerCase();
  const gm = isGm();
  const maps = R.by('map').filter(m => !q || m.search.includes(q));
  const all = R.by('location');
  const onCount = all.filter(isOn).length;
  const locs = all.filter(l => matches(l, q) && ((gm && showAll) || isOn(l)));
  const groups = [...new Set(locs.map(l => l.group))];
  const none = gm ? (q ? 'No matches.' : showAll ? 'No locations in the Rules tab yet.' : 'No places on the map yet: show every place and turn some on.')
    : (q ? 'No matches.' : 'Nothing on the map yet.');
  main.innerHTML = `
    <div class="mtools">
      <input type="search" class="in search" id="q" placeholder="Search places" value="${esc(query)}" aria-label="Search places" autocomplete="off">
      ${gm ? `<div class="cats"><button data-show="all" class="${showAll ? 'on' : ''}">Every place</button><button data-show="on" class="${showAll ? '' : 'on'}">On the map (${onCount})</button></div>` : ''}
    </div>
    ${gm ? '<div class="robar"><span>You choose which places the crew see. Book locations and new ones alike start hidden.</span></div>' : ''}
    <div id="world">
      ${maps.map(m => `<section class="worldmap"><h2>${escTxt(m.name)}</h2>${imgHTML(m, 'mapimg')}${m.text.trim() ? `<div class="rich">${md(m.text)}</div>` : ''}${origHTML(m)}</section>`).join('')}
      ${groups.map(g => `<div class="mgroup"><h3>${escTxt(g || 'Places')}</h3><div class="cols">${locs.filter(l => l.group === g).map(locationHTML).join('')}</div></div>`).join('')}
      ${!locs.length ? `<div class="empty">${none}</div>` : ''}
    </div>`;
}

const rerenderCard = loc => { const el = document.getElementById(`loc-${loc.i}`); if (el) el.outerHTML = locationHTML(loc); };

let creating = null;
async function setOn(loc, on) {
  const row = ['place', placeKey(loc), on ? 'on' : '', loc.name !== placeKey(loc) ? loc.name : ''];
  if (placesStore.missing) {
    // No Map tab yet: the GM's first choice makes it.
    creating ||= client.request({ op: 'create', tab: 'Map', rows: [row] }).then(() => client.read(['Map'])).finally(() => { creating = null; });
    await creating;
    return;
  }
  const was = placeRow(loc);
  placesStore.change(was ? [was] : [], [row]);
  render();
}

main.addEventListener('click', e => {
  const t = e.target.closest('[data-place]');
  if (t && isGm()) {
    const loc = R.recs.find(r => r.kind === 'location' && String(r.i) === t.dataset.place);
    if (loc) setOn(loc, !isOn(loc)).catch(err => alert(err.message));
    return;
  }
  const s = e.target.closest('[data-show]');
  if (s) { showAll = s.dataset.show === 'all'; render(); return; }
  const b = e.target.closest('[data-lv]');
  if (!b) return;
  shownLevel[b.dataset.loc] = +b.dataset.lv;
  const loc = R.recs.find(r => r.kind === 'location' && String(r.i) === b.dataset.loc);
  if (loc) rerenderCard(loc);
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
placesStore.on(() => render());
client.on(e => {
  if (e.list) refreshNav(client, 'map');
  if (e.list || e.key || e.auth) render();
});
render();
client.watch('Map');
client.read(['Rules', 'Map']).catch(() => render());
client.startPolling();
