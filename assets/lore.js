// Shared lore: lore.html?g=<game>. The Lore tab's rows are entries:
// Kind = category, Name = title, Value = text (markup), Notes = who added it.
import { bootstrap, href } from './games.js';
import { GameClient } from './api.js';
import { md } from './markup.js';
import { pictureHTML, showPictures } from './pictures.js';
import { esc, escTxt, ICON, armed, pageShell, refreshNav, readOnlyHTML } from './core.js';

const app = document.getElementById('app');
const game = bootstrap();
if (!game) {
  pageShell(app, null, 'lore');
  app.insertAdjacentHTML('beforeend', `<main class="empty-page"><p>Open this page from an invite link first.</p><p><a href="index.html">Go to the start page</a></p></main>`);
  throw new Error('no game');
}

const client = new GameClient(game);
pageShell(app, client, 'lore');
const store = client.tab('Lore');
const main = document.createElement('main');
app.append(main);
showPictures(main, client);

let entries = toEntries(store.rows);
let base = toRows(entries);
let editing = false;
let query = '';
let cat = 'all';

function toEntries(rows) {
  return rows.filter(r => String(r[0]).trim() && String(r[1]).trim())
    .map(([kind, name, value = '', notes = '']) => ({ kind: String(kind).trim(), name: String(name).trim(), value, notes }));
}
function toRows(es) { return es.map(e => [e.kind, e.name, e.value, e.notes]); }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function changed() {
  const next = toRows(entries);
  store.change(base, next);
  base = next;
}

const busy = () => document.activeElement && main.contains(document.activeElement) && document.activeElement.matches('input, textarea');
store.on(e => {
  if (e.missing) { render(); return; }
  if (!e.fromServer || busy()) return;
  const ne = toEntries(store.rows);
  if (same(toRows(ne), base) && main.dataset.ready) return;
  entries = ne;
  base = toRows(ne);
  render();
});
// Anyone signed in as a character (or the GM) edits lore.
const canEdit = () => client.canEdit('Lore');
let couldEdit = canEdit();
client.on(e => {
  if (e.list) refreshNav(client, 'lore');
  if ((e.me || e.list || e.key || e.auth) && canEdit() !== couldEdit) { couldEdit = canEdit(); if (!couldEdit) editing = false; render(); }
});

const categories = () => [...new Set(entries.map(e => e.kind))];
const unique = (kind, name) => { let n = name, k = 2; while (entries.some(e => e.kind.toLowerCase() === kind.toLowerCase() && e.name.toLowerCase() === n.toLowerCase())) n = `${name} ${k++}`; return n; };

function render() {
  main.dataset.ready = store.loaded ? '1' : '';
  if (store.missing) { main.innerHTML = '<div class="empty-page"><p>This game’s sheet has no Lore tab.</p></div>'; return; }
  if (!store.loaded) { main.innerHTML = '<div class="empty">Loading…</div>'; return; }
  const q = query.trim().toLowerCase();
  const cats = categories();
  const shown = entries.map((e, i) => ({ e, i })).filter(({ e }) => (cat === 'all' || e.kind === cat) && (!q || `${e.kind} ${e.name} ${e.value} ${e.notes}`.toLowerCase().includes(q)));
  const groups = cats.filter(c => cat === 'all' || c === cat);
  main.innerHTML = `
    <div class="mtools">
      <input type="search" class="in search" id="q" placeholder="Search lore" value="${esc(query)}" aria-label="Search lore" autocomplete="off">
      <div class="cats">${[['all', 'All'], ...cats.map(c => [c, c])].map(([k, l]) => `<button data-act="cat" data-cat="${esc(k)}" class="${cat === k ? 'on' : ''}">${escTxt(l)}</button>`).join('')}</div>
      ${canEdit() ? `<button class="ic${editing ? ' on' : ''}" data-act="edit" title="Edit" aria-pressed="${editing}">${ICON.pen}</button>` : ''}
    </div>
    ${canEdit() ? '' : readOnlyHTML(client, 'Lore')}
    <datalist id="lore-cats">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
    ${groups.map(c => {
      const items = shown.filter(x => x.e.kind === c);
      if (!items.length) return '';
      return `<div class="mgroup"><h3>${escTxt(c)}</h3><div class="cols">${items.map(({ e, i }) => entryHTML(e, i)).join('')}</div></div>`;
    }).join('') || '<div class="empty">Nothing here yet.</div>'}
    ${editing ? '<button class="add" data-act="add">+ Entry</button>' : ''}`;
  main.querySelectorAll('textarea').forEach(t => { t.style.height = Math.max(70, t.scrollHeight + 4) + 'px'; });
}

function entryHTML(e, i) {
  if (!editing) {
    return `<section class="card"><div class="shead"><h2>${escTxt(e.name)}</h2></div>
      ${e.notes ? `<div class="note">${escTxt(e.notes)}</div>` : ''}
      ${e.value ? `<div class="rich">${md(e.value)}</div>` : ''}${pictureHTML('Lore', store.imageOf(e.kind, e.name), e.name, 'rimg')}</section>`;
  }
  return `<section class="card"><div class="shead">
      <input class="in st" data-f="name" data-i="${i}" value="${esc(e.name)}" aria-label="Title">
      <button class="mini del" data-act="rm" data-i="${i}" aria-label="Delete">×</button></div>
    <div class="prow"><input class="in" data-f="kind" data-i="${i}" value="${esc(e.kind)}" list="lore-cats" aria-label="Category" placeholder="Category">
      <input class="in" data-f="notes" data-i="${i}" value="${esc(e.notes)}" aria-label="Added by" placeholder="Added by"></div>
    <textarea class="in rtext" data-f="value" data-i="${i}" aria-label="Text">${escTxt(e.value)}</textarea></section>`;
}

main.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'edit') { editing = !editing && canEdit(); render(); }
  if (act === 'cat') { cat = b.dataset.cat; render(); }
  if (act === 'add' && canEdit()) {
    const kind = cat !== 'all' ? cat : categories()[0] || 'Notes';
    entries.push({ kind, name: unique(kind, 'New entry'), value: '', notes: '' });
    changed();
    render();
  }
  if (act === 'rm' && canEdit() && armed(b)) { entries.splice(+b.dataset.i, 1); changed(); render(); }
});

main.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'q') { query = t.value; const pos = t.selectionStart; render(); const q = document.getElementById('q'); q.focus(); q.setSelectionRange(pos, pos); return; }
  if (t.dataset.f === 'value' || t.dataset.f === 'notes') {
    entries[+t.dataset.i][t.dataset.f] = t.value;
    if (t.tagName === 'TEXTAREA') { t.style.height = 'auto'; t.style.height = Math.max(70, t.scrollHeight + 4) + 'px'; }
    changed();
  }
});
// Title and category are the row's key, so they apply when you leave the field.
main.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.f !== 'name' && t.dataset.f !== 'kind') return;
  const en = entries[+t.dataset.i];
  const v = t.value.trim();
  if (!v) { render(); return; }
  if (t.dataset.f === 'name') en.name = unique(en.kind, v) === v || v.toLowerCase() === en.name.toLowerCase() ? v : unique(en.kind, v);
  else { en.name = entries.some(x => x !== en && x.kind.toLowerCase() === v.toLowerCase() && x.name.toLowerCase() === en.name.toLowerCase()) ? unique(v, en.name) : en.name; en.kind = v; }
  changed();
  render();
});

render();
client.watch('Lore');
client.read().catch(() => render());
client.startPolling();
