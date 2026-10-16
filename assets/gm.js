// GM page: gm.html?g=<game>. Needs the GM passphrase.
// The GM tab's rows: npc (Value = tags, Notes = notes), track|<npc name> (that NPC's harm),
// note and secret (Value = text), clock (Value = pips). Other rows are left alone.
import { bootstrap } from './games.js';
import { GameClient } from './api.js';
import { indexRules } from './rules.js';
import { md } from './markup.js';
import { parseTrack, formatTrack } from './codec.js';
import { esc, escTxt, ICON, armed, pipClass, pageShell, refreshNav, askKey } from './core.js';
import { crewCardHTML, shipCardHTML } from './cards.js';
import { SECTIONS, sectionHTML, searchAllHTML, sectionHasContent } from './refview.js';

const app = document.getElementById('app');
const game = bootstrap();
if (!game) {
  pageShell(app, null, 'gm');
  app.insertAdjacentHTML('beforeend', '<main class="empty-page"><p>Open this page from an invite link first.</p><p><a href="index.html">Go to the start page</a></p></main>');
  throw new Error('no game');
}

const client = new GameClient(game);
pageShell(app, client, 'gm');
const gmStore = client.tab('GM');
const rulesStore = client.tab('Rules');
const main = document.createElement('main');
app.append(main);

const TABS = [['crew', 'Crew'], ['npcs', 'NPCs'], ['notes', 'Notes'], ['ref', 'Reference']];
const REF_KEYS = ['fates', 'tags', 'moves', 'playbooks', 'reference', 'world', 'other'];
const NPC_SIZES = [['Mook', 1], ['Combatant', 2], ['Threat', 4], ['Villain', 6]];
let tab = 'crew';
let refTab = 'fates';
let query = '';
let editing = false;
let R = indexRules(rulesStore.rows);

// GM tab rows as editable entries (kinds lower-cased; unknown kinds kept as they are).
const toEntries = rows => rows.filter(r => String(r[0]).trim() && String(r[1]).trim())
  .map(([kind, name, value = '', notes = '']) => ({ kind: String(kind).trim().toLowerCase(), name: String(name).trim(), value, notes }));
const toRows = es => es.map(e => [e.kind, e.name, e.value, e.notes]);
let entries = toEntries(gmStore.rows);
let base = toRows(entries);
function changed() { const next = toRows(entries); gmStore.change(base, next); base = next; }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const busy = () => document.activeElement && main.contains(document.activeElement) && document.activeElement.matches('input, textarea');

gmStore.on(e => {
  if (!e.fromServer || busy()) return;
  const ne = toEntries(gmStore.rows);
  if (same(toRows(ne), base) && main.dataset.ready) return;
  entries = ne;
  base = toRows(ne);
  if (tab === 'npcs' || tab === 'notes') render();
});
rulesStore.on(() => { R = indexRules(rulesStore.rows); if (tab === 'ref' || tab === 'npcs') render(); });

const characters = () => client.list.filter(t => t.kind === 'character').map(t => t.name);
const harmOf = name => entries.find(e => e.kind === 'track' && e.name.toLowerCase() === name.toLowerCase());
const unique = (kind, name) => { let n = name, k = 2; while (entries.some(e => e.kind === kind && e.name.toLowerCase() === n.toLowerCase())) n = `${name} ${k++}`; return n; };
const pipsHTML = (id, arr) => arr.map((v, j) => `<button class="pip${pipClass(v)}" data-gpip="${esc(id)}" data-j="${j}" aria-label="${j + 1}" aria-pressed="${v === 1}"></button>`).join('');

/* ---------- views ---------- */
function crewHTML() {
  return `<div class="crew">${characters().map(n => crewCardHTML(client, n, { gm: true })).join('')}${shipCardHTML(client, { gm: true })}</div>`;
}

// NPC tags link to their definitions in the Rules tab.
function tagChips(tags) {
  return tags.split(',').map(t => t.trim()).filter(Boolean).map(t => {
    const base = t.replace(/[-\s]?\d+$/, '').toLowerCase();
    const def = R.recs.find(r => r.kind === 'tag' && r.name.toLowerCase().replace(/[-\s]?x$/, '') === base);
    return `<span class="tagchip"${def ? ` title="${esc(def.text)}"` : ''}>${escTxt(t)}</span>`;
  }).join('');
}

function npcHTML() {
  const npcs = entries.map((e, i) => ({ e, i })).filter(x => x.e.kind === 'npc');
  const cards = npcs.map(({ e, i }) => {
    const h = harmOf(e.name);
    const harm = h ? parseTrack(h.value) : [];
    if (editing) {
      return `<section class="card"><div class="shead">
          <input class="in st" data-f="name" data-i="${i}" value="${esc(e.name)}" aria-label="Name">
          <button class="mini del" data-act="rm" data-i="${i}" aria-label="Delete">×</button></div>
        <input class="in note" data-f="value" data-i="${i}" value="${esc(e.value)}" placeholder="Tags, comma-separated" aria-label="Tags">
        <div class="cc-row"><span class="lbl">Harm</span><span class="pips harm">${pipsHTML(e.name, harm)}</span>
          <span class="pm"><button class="mini" data-act="harm-" data-name="${esc(e.name)}" aria-label="Less">−</button><button class="mini" data-act="harm+" data-name="${esc(e.name)}" aria-label="More">+</button></span></div>
        <textarea class="in rtext" data-f="notes" data-i="${i}" aria-label="Notes">${escTxt(e.notes)}</textarea></section>`;
    }
    return `<section class="card"><div class="shead"><h2>${escTxt(e.name)}</h2></div>
      ${e.value ? `<div class="tags">${tagChips(e.value)}</div>` : ''}
      ${harm.length ? `<div class="cc-row"><span class="lbl">Harm</span><span class="pips harm">${pipsHTML(e.name, harm)}</span></div>` : ''}
      ${e.notes ? `<div class="rich">${md(e.notes)}</div>` : ''}</section>`;
  }).join('');
  return `<div class="mtools"><span class="grow"></span>${editToggle()}</div>
    <div class="cols">${cards || '<div class="empty">No NPCs yet.</div>'}</div>
    <div class="prow npcadd"><span class="lbl">Add</span>${NPC_SIZES.map(([l, n]) => `<button class="pbtn" data-act="add-npc" data-harm="${n}">${l}</button>`).join('')}</div>`;
}

function notesHTML() {
  const groups = [['secret', 'Secrets'], ['note', 'Notes'], ['clock', 'Clocks']];
  const body = groups.map(([kind, label]) => {
    const items = entries.map((e, i) => ({ e, i })).filter(x => x.e.kind === kind);
    if (!items.length && !editing) return '';
    const cards = items.map(({ e, i }) => {
      if (kind === 'clock') {
        const p = parseTrack(e.value);
        return `<section class="card"><div class="shead">${editing ? `<input class="in st" data-f="name" data-i="${i}" value="${esc(e.name)}" aria-label="Clock">` : `<h2>${escTxt(e.name)}</h2>`}
          <span class="pips">${pipsHTML(`clock:${i}`, p)}</span>
          ${editing ? `<span class="pm"><button class="mini" data-act="clock-" data-i="${i}" aria-label="Fewer">−</button><button class="mini" data-act="clock+" data-i="${i}" aria-label="More">+</button></span><button class="mini del" data-act="rm" data-i="${i}" aria-label="Delete">×</button>` : ''}</div></section>`;
      }
      return editing
        ? `<section class="card"><div class="shead"><input class="in st" data-f="name" data-i="${i}" value="${esc(e.name)}" aria-label="Title"><button class="mini del" data-act="rm" data-i="${i}" aria-label="Delete">×</button></div>
            <textarea class="in rtext" data-f="value" data-i="${i}" aria-label="Text">${escTxt(e.value)}</textarea></section>`
        : `<section class="card"><div class="shead"><h2>${escTxt(e.name)}</h2></div>${e.value ? `<div class="rich">${md(e.value)}</div>` : ''}</section>`;
    }).join('');
    return `<div class="mgroup"><h3>${label}</h3><div class="cols">${cards}</div>${editing ? `<button class="add sm" data-act="add-note" data-kind="${kind}">+</button>` : ''}</div>`;
  }).join('');
  return `<div class="mtools"><span class="grow"></span>${editToggle()}</div>${body || '<div class="empty">No notes yet. Use the pencil to add some.</div>'}`;
}

function refHTML() {
  const keys = REF_KEYS.filter(k => sectionHasContent(R, k));
  if (!keys.includes(refTab)) refTab = keys[0] || 'fates';
  return `<div class="mtools">
      <input type="search" class="in search" id="q" placeholder="Search everything" value="${esc(query)}" aria-label="Search" autocomplete="off">
      <div class="cats">${keys.map(k => `<button data-ref="${k}" class="${!query && refTab === k ? 'on' : ''}">${SECTIONS[k].label}</button>`).join('')}</div>
    </div><div id="ref">${query.trim() ? searchAllHTML(R, keys, query) : keys.length ? sectionHTML(R, refTab) : '<div class="empty">The Rules tab is empty.</div>'}</div>`;
}

const editToggle = () => `<button class="ic${editing ? ' on' : ''}" data-act="edit" title="Edit" aria-pressed="${editing}">${ICON.pen}</button>`;

function render() {
  main.dataset.ready = gmStore.loaded ? '1' : '';
  if (client.role && client.role !== 'gm') {
    main.innerHTML = `<div class="empty-page"><p>This page needs the GM passphrase.</p><p><button class="pbtn" data-act="gm-key">Enter the GM passphrase</button></p></div>`;
    return;
  }
  if (!gmStore.loaded && !gmStore.missing) { main.innerHTML = '<div class="empty">Loading…</div>'; return; }
  const view = tab === 'crew' ? crewHTML() : tab === 'npcs' ? npcHTML() : tab === 'notes' ? notesHTML() : refHTML();
  main.innerHTML = `<nav class="tabs">${TABS.map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</nav><div class="gmview">${view}</div>`;
  main.querySelectorAll('textarea').forEach(t => { t.style.height = Math.max(70, t.scrollHeight + 4) + 'px'; });
}

/* ---------- interactions ---------- */
function setHarm(name, fn) {
  let h = harmOf(name);
  if (!h) { h = { kind: 'track', name, value: '', notes: '' }; entries.push(h); }
  const p = parseTrack(h.value);
  fn(p);
  h.value = formatTrack(p);
  if (!p.length) entries.splice(entries.indexOf(h), 1);
}

main.addEventListener('click', e => {
  const pip = e.target.closest('[data-gpip]');
  if (pip) {
    const id = pip.dataset.gpip;
    const j = +pip.dataset.j;
    if (id.startsWith('clock:')) { const c = entries[+id.slice(6)]; const p = parseTrack(c.value); p[j] = p[j] === 1 ? 0 : 1; c.value = formatTrack(p); }
    else setHarm(id, p => { p[j] = p[j] === 1 ? 0 : 1; });
    changed();
    render();
    return;
  }
  const t = e.target.closest('[data-tab]');
  if (t) { tab = t.dataset.tab; render(); return; }
  const r = e.target.closest('[data-ref]');
  if (r) { refTab = r.dataset.ref; query = ''; render(); return; }
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  const i = +b.dataset.i;
  if (act === 'gm-key') askKey(client, 'Enter the GM passphrase.');
  if (act === 'edit') { editing = !editing; render(); }
  if (act === 'add-npc') {
    const name = unique('npc', 'New NPC');
    entries.push({ kind: 'npc', name, value: '', notes: '' });
    setHarm(name, p => { p.push(...Array(+b.dataset.harm).fill(0)); }); // harm tally by NPC size
    editing = true;
    changed(); render();
  }
  if (act === 'add-note') {
    const kind = b.dataset.kind;
    entries.push({ kind, name: unique(kind, kind === 'clock' ? 'New clock' : kind === 'secret' ? 'New secret' : 'New note'), value: kind === 'clock' ? '○○○○○○' : '', notes: '' });
    changed(); render();
  }
  if (act === 'harm+' || act === 'harm-') { setHarm(b.dataset.name, p => (act === 'harm+' ? p.push(0) : p.pop())); changed(); render(); }
  if (act === 'clock+' || act === 'clock-') { const c = entries[i]; const p = parseTrack(c.value); if (act === 'clock+') p.push(0); else p.pop(); c.value = formatTrack(p); changed(); render(); }
  if (act === 'rm' && armed(b)) {
    const gone = entries[i];
    entries.splice(i, 1);
    if (gone.kind === 'npc') { const h = harmOf(gone.name); if (h) entries.splice(entries.indexOf(h), 1); }
    changed(); render();
  }
});

main.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'q') {
    query = t.value;
    const keys = REF_KEYS.filter(k => sectionHasContent(R, k));
    document.getElementById('ref').innerHTML = query.trim() ? searchAllHTML(R, keys, query) : sectionHTML(R, refTab);
    return;
  }
  if (t.dataset.f === 'value' || t.dataset.f === 'notes') {
    entries[+t.dataset.i][t.dataset.f] = t.value;
    if (t.tagName === 'TEXTAREA') { t.style.height = 'auto'; t.style.height = Math.max(70, t.scrollHeight + 4) + 'px'; }
    changed();
  }
});
// Names are row keys: apply them when the field is left, and carry an NPC's harm along.
main.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.f !== 'name') return;
  const en = entries[+t.dataset.i];
  const v = t.value.trim();
  if (!v || v.toLowerCase() === en.name.toLowerCase()) { if (v) { en.name = v; changed(); } return; }
  const nn = unique(en.kind, v);
  if (en.kind === 'npc') { const h = harmOf(en.name); if (h && !harmOf(nn)) h.name = nn; }
  en.name = nn;
  changed();
  render();
});

/* ---------- start ---------- */
// Every poll reports the tab list. Redraw only when it (or our access) changed: a redraw resets
// half-typed fields and the first click of a two-click delete. Tab contents redraw on their own.
let listSig = null;
client.on(e => {
  if (e.list) {
    refreshNav(client, 'gm');
    const fresh = ['Ship', ...characters()].filter(n => !client.watched.has(n));
    fresh.forEach(n => { client.watch(n); client.tab(n).on(() => { if (tab === 'crew') render(); }); });
    if (fresh.length) client.read().catch(() => {});
    const sig = JSON.stringify([client.role, client.list]);
    if (sig !== listSig) { listSig = sig; render(); }
  }
});
render();
client.watch('GM', 'Ship', ...characters());
for (const n of ['Ship', ...characters()]) client.tab(n).on(() => { if (tab === 'crew') render(); });
client.read(['Rules', ...client.watched]).catch(() => render());
client.startPolling();

