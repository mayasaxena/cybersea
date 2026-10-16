// Character sheet: sheet.html?g=<game>&c=<tab name>. ship.html uses the same page in ship mode
// (<body data-tab="Ship">): Wreck and Renown instead of Harm and Luck, ship moves, no actions.
import { bootstrap, href, ls, gkey, inviteUrl } from './games.js';
import { GameClient } from './api.js';
import { parseSheet, serializeSheet, logId } from './codec.js';
import { md, toggleCheck, htmlToMarkup } from './markup.js';
import { indexRules, rollFor } from './rules.js';
import { esc, escTxt, ICON, pips, pipClass, fmt, armed, doRoll, toast, modal, closeModal, pageShell, refreshNav, readOnlyHTML } from './core.js';
import { makeActions } from './actions.js';
import { shipRows } from './build.js';
import { plain } from './markup.js';

const SHIP = (document.body.dataset.tab || '').toLowerCase() === 'ship';
const CATS = SHIP ? ['playbook', 'ship'] : ['playbook', 'basic', 'special', 'ship', 'downtime'];
const CAT_LABEL = { basic: 'Basic', special: 'Special', ship: 'Ship', downtime: 'Downtime' };
const SECTION_TABS = SHIP ? [['sheet', 'Ship'], ['moves', 'Moves'], ['notes', 'Notes']] : [['sheet', 'Sheet'], ['moves', 'Moves'], ['notes', 'Notes'], ['log', 'Log']];
const PAGE = SHIP ? 'ship' : '';

const app = document.getElementById('app');
const game = bootstrap();
const tabName = document.body.dataset.tab || new URLSearchParams(location.search).get('c') || '';

if (!game || !tabName) {
  pageShell(app, null, '');
  app.insertAdjacentHTML('beforeend', `<main class="empty-page"><p>${game ? 'No character picked.' : 'Open this page from an invite link first.'}</p><p><a href="${esc(href('index.html', game))}">Go to the crew page</a></p></main>`);
  throw new Error('no game/character');
}

const client = new GameClient(game);
pageShell(app, client, PAGE);
const store = client.tab(tabName);
const rulesStore = client.tab('Rules');
const uiKey = gkey(game, `ui:${tabName.toLowerCase()}`);
// Only the character's signed-in player (or the GM) edits a sheet; anyone signed in edits the ship.
const canEdit = () => client.canEdit(SHIP ? 'Ship' : tabName);
const ui = Object.assign({ tab: 'sheet', cat: 'all', open: [] }, ls.get(uiKey, {}));
const openSet = new Set(ui.open);
const saveUi = () => { ui.open = [...openSet]; ls.set(uiKey, ui); };

let R = indexRules(rulesStore.rows);
let st = parseSheet(store.rows);
let base = serializeSheet(st);
let editing = false;
let query = '';
let deferred = false;

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Record a change: only rows that differ from the last serialization are sent.
function changed() {
  const next = serializeSheet(st);
  store.change(base, next);
  base = next;
}

// While someone is typing or a dialog is open, hold remote updates until they're done.
const busy = () => !!document.getElementById('overlay') || (document.activeElement && app.contains(document.activeElement) && document.activeElement.matches('input, textarea, select'));
let shown = store.loaded; // has the page rendered real sheet data yet?
function adopt() {
  if (busy()) { deferred = true; return; }
  deferred = false;
  const ns = parseSheet(store.rows);
  const nb = serializeSheet(ns);
  if (shown && same(nb, base)) return;
  st = ns;
  base = nb;
  shown = true;
  render();
}
store.on(e => {
  if (e.missing) render();
  else if (e.fromServer) adopt();
});
rulesStore.on(() => { R = indexRules(rulesStore.rows); render(); });
let couldEdit = canEdit();
client.on(e => {
  if (e.list || e.key) refreshNav(client, PAGE);
  if ((e.me || e.list || e.key || e.auth) && canEdit() !== couldEdit) { couldEdit = canEdit(); render(); }
});
app.addEventListener('focusout', () => setTimeout(() => { if (deferred && !busy()) adopt(); }, 0));
new MutationObserver(() => { if (deferred && !busy()) adopt(); }).observe(document.body, { childList: true }); // a dialog closed

const actions = makeActions({ st: () => st, rules: () => R, changed, render: () => render(), editing: () => editing });

/* ---------- helpers ---------- */
const track = name => st.tracks[name.toLowerCase()];
const playbook = () => R.playbook(st.info.playbook);
const charMove = name => st.moves.find(m => m.name.toUpperCase() === String(name).toUpperCase());

// The character's moves: their playbook's moves (marked or not) plus any custom ones,
// then the shared moves from the Rules tab.
function moveList() {
  const out = [];
  const pb = playbook();
  const pbMoves = pb ? (SHIP ? pb.smoves : [...pb.moves, ...pb.smoves]) : [];
  for (const m of pbMoves) {
    const mine = charMove(m.name);
    out.push({ cat: 'playbook', name: m.name, text: mine?.text || m.text, marked: !!mine?.marked, own: true, base: m.text });
  }
  for (const m of st.moves) {
    if (!pbMoves.some(x => x.name.toUpperCase() === m.name.toUpperCase())) out.push({ cat: 'playbook', name: m.name, text: m.text, marked: m.marked, own: true, custom: true });
  }
  for (const cat of CATS.slice(1)) for (const m of R.moves(cat)) out.push({ cat, name: m.name, text: m.text, marked: true });
  return out;
}

const catLabel = c => (c === 'playbook' ? st.info.playbook || 'Playbook' : CAT_LABEL[c]);

/* ---------- rendering ---------- */
function headerHTML() {
  const E = editing;
  const harm = track(SHIP ? 'wreck' : 'harm');
  const luck = track(SHIP ? 'renown' : 'luck');
  const trackHTML = (label, t, kind) => t ? `<div class="track ${kind}"><span class="lbl">${label}</span><span class="pips">${pips(`t:${t.name}`, t.pips, label)}</span>${E ? pm(`t:${t.name}`) : ''}</div>` : '';
  const stats = st.stats.map((s, i) => E
    ? `<div class="stat"><input class="in sk" data-bind="stat:${i}:k" value="${esc(s.k)}" aria-label="Stat"><input class="in sv" type="number" step="1" data-bind="stat:${i}:v" value="${s.v}" aria-label="${esc(s.k)}"></div>`
    : `<button class="stat" data-act="roll-stat" data-i="${i}" title="Roll"><span class="sk">${escTxt(s.k)}</span>${ICON.die}<span class="sv">${fmt(s.v)}</span></button>`).join('');
  return `<header class="top">
    <div class="idrow">
      <div class="ident">
        ${E ? `<input class="in name" data-bind="info:name" value="${esc(st.info.name || '')}" aria-label="Name">` : `<h1 class="name">${escTxt(st.info.name || tabName)}</h1>`}
        <div class="pb"><span class="lbl">Playbook</span>${E ? `<input class="in" data-bind="info:playbook" value="${esc(st.info.playbook || '')}" aria-label="Playbook">` : `<span>${escTxt(st.info.playbook || '—')}</span>`}</div>
        ${st.state.downtime ? '<button class="pill" data-act="tab" data-tab="log">Downtime</button>' : ''}
      </div>
      <div class="tools">
        ${canEdit() ? `<button class="ic${E ? ' on' : ''}" data-act="edit" title="Edit" aria-pressed="${E}">${ICON.pen}</button>` : ''}
        <button class="ic" data-act="sheet-menu" title="Sheet options" aria-label="Sheet options">${ICON.dots}</button>
      </div>
    </div>
    <div class="vitals">${trackHTML(SHIP ? 'Wreck' : 'Harm', harm, 'harm')}${trackHTML(SHIP ? 'Renown' : 'Luck', luck, 'luck')}</div>
    <div class="stats">${stats}</div>
    <nav class="tabs">${SECTION_TABS.map(([k, l]) => `<button data-act="tab" data-tab="${k}" class="${ui.tab === k ? 'on' : ''}">${l}</button>`).join('')}</nav>
  </header>`;
}

const pm = path => `<span class="pm"><button class="mini" data-act="rm-pip" data-path="${esc(path)}" aria-label="Remove">−</button><button class="mini" data-act="add-pip" data-path="${esc(path)}" aria-label="Add">+</button></span>`;

function sectionHTML(s, i) {
  const E = editing;
  const t = track(s.title);
  const isBonds = s.title.toLowerCase() === 'bonds';
  let h = '<section class="card"><div class="shead">' +
    (E ? `<input class="in st" data-bind="sec:${i}:title" value="${esc(s.title)}" aria-label="Title">` : `<h2>${escTxt(s.title)}</h2>`) +
    (t && !['harm', 'luck', 'wreck', 'renown'].includes(t.name.toLowerCase()) ? `<span class="pips">${pips(`t:${t.name}`, t.pips, s.title)}</span>` : '') +
    (E && !isBonds ? pm(`t:${s.title}`) : '') +
    (E ? `<button class="mini del" data-act="rm-section" data-i="${i}" title="Delete" aria-label="Delete">×</button>` : '') +
    (s.title.toLowerCase() === 'experience' && !E ? `<span class="lvl">Level ${parseInt(st.info.level, 10) || 0}</span>` : '') +
    (s.title.toLowerCase() === 'experience' && E ? `<label class="lvl">Level <input class="in lv" type="number" min="0" step="1" data-bind="info:level" value="${esc(parseInt(st.info.level, 10) || 0)}"></label>` : '') +
    '</div>';
  if (E) h += `<input class="in note" data-bind="sec:${i}:note" value="${esc(s.note || '')}" aria-label="Note">`;
  else if (s.note) h += `<div class="note">${escTxt(s.note)}</div>`;
  if (isBonds) {
    h += '<div class="bonds">' + st.bonds.map((b, j) => '<div class="bond">' +
      (E ? `<input class="in" data-bind="bond:${j}:name" value="${esc(b.name)}" aria-label="Name">` : `<span class="bn">${escTxt(b.name)}</span>`) +
      `<span class="pips">${pips(`b:${j}`, b.pips, b.name, true)}</span>` +
      (E ? `<button class="mini del" data-act="rm-bond" data-j="${j}" aria-label="Delete">×</button>` : '') + '</div>').join('') + '</div>';
    if (E && st.bonds.length < 8) h += '<button class="add sm" data-act="add-bond">+</button>';
  }
  if (E) h += `<textarea class="in rtext" data-bind="sec:${i}:text" aria-label="${esc(s.title)}">${escTxt(s.text || '')}</textarea>`;
  else if (s.text) h += `<div class="rich" data-sec="${i}">${md(s.text)}</div>`;
  return h + '</section>';
}

function sectionsHTML(tab) {
  const cards = st.sections.map((s, i) => (s.tab === tab ? sectionHTML(s, i) : '')).join('');
  return `<div class="cols">${cards}</div>` + (editing ? `<button class="add" data-act="add-section" data-tab="${tab}">+</button>` : '');
}

function moveHTML(m, i, forceOpen) {
  const id = `${m.cat}:${m.name}`;
  const mk = m.cat === 'playbook' ? `<i class="mk${m.marked ? ' on' : ''}" aria-hidden="true"></i>` : '';
  if (editing && m.own) {
    return `<div class="move edit"><div class="mhead">` +
      `<button class="mk${m.marked ? ' on' : ''}" data-act="mv-mark" data-name="${esc(m.name)}" aria-pressed="${m.marked}" aria-label="Marked"></button>` +
      (m.custom ? `<input class="in mn" data-bind="move:${esc(encodeURIComponent(m.name))}:name" value="${esc(m.name)}" aria-label="Move">` : `<span class="mn">${escTxt(m.name)}</span>`) +
      (m.custom ? `<button class="mini del" data-act="rm-move" data-name="${esc(m.name)}" aria-label="Delete">×</button>` : '') +
      `</div><textarea class="in rtext" data-bind="move:${esc(encodeURIComponent(m.name))}:text" aria-label="${esc(m.name)}">${escTxt(m.text || '')}</textarea></div>`;
  }
  const r = rollFor(m.text, st.stats);
  const chip = r ? `<button class="chip" data-act="roll-move" data-i="${i}" title="Roll">${ICON.die}<span>${escTxt(r.label)}${r.stat ? ' ' + fmt(r.mod) : ''}</span></button>` : '';
  const open = forceOpen || openSet.has(id);
  return `<details class="move${m.cat === 'playbook' && !m.marked ? ' off' : ''}" data-id="${esc(id)}"${open ? ' open' : ''}><summary>${mk}<span class="mn">${escTxt(m.name)}</span>${chip}</summary>` +
    `<div class="mbody"${m.own ? ` data-move="${esc(m.name)}"` : ''}>${md(m.text)}</div></details>`;
}

let lastMoves = [];
function moveListHTML() {
  const q = query.trim().toLowerCase();
  const all = moveList();
  lastMoves = all;
  const cats = ui.cat === 'all' ? CATS : [ui.cat];
  let out = '';
  for (const c of cats) {
    const items = [];
    all.forEach((m, i) => {
      if (m.cat !== c) return;
      if (q && !`${m.name} ${m.text}`.toLowerCase().includes(q)) return;
      items.push(moveHTML(m, i, !!q));
    });
    if (!items.length && !(editing && c === 'playbook' && !q)) continue;
    out += `<div class="mgroup"><h3>${escTxt(c === 'playbook' ? `${catLabel(c)} moves` : `${CAT_LABEL[c]} moves`)}</h3>${items.join('')}` +
      (editing && c === 'playbook' ? '<button class="add sm" data-act="add-move">+</button>' : '') + '</div>';
  }
  if (R.empty && !out) return '<div class="empty">The Rules tab hasn’t loaded yet.</div>';
  return out || '<div class="empty">—</div>';
}

function movesHTML() {
  const cats = [['all', 'All'], ...CATS.map(c => [c, catLabel(c)])];
  return `<div class="mtools">
      <input type="search" class="in search" id="q" placeholder="Search" value="${esc(query)}" aria-label="Search moves" autocomplete="off">
      <div class="cats">${cats.map(([k, l]) => `<button data-act="cat" data-cat="${k}" class="${ui.cat === k ? 'on' : ''}">${escTxt(l)}</button>`).join('')}</div>
    </div><div id="mlist">${moveListHTML()}</div>`;
}

/* ---------- a new game has no Ship tab yet: set one up from a ship playbook ---------- */
const setup = { name: '', playbook: '', kit: '', oddity: '' };
const short = (t, n = 70) => { const p = plain(t); return p.length > n ? p.slice(0, n - 1) + '…' : p; };
function shipSetupHTML() {
  if (!canEdit()) return `<div class="empty-page"><p>This game has no Ship tab yet.</p>${readOnlyHTML(client, 'Ship')}</div>`;
  const ships = R.playbooks('ship');
  if (!ships.length) return '<div class="empty-page"><p>This game has no Ship tab yet, and its Rules tab has no ship playbooks to start one from.</p></div>';
  if (!ships.some(p => p.name === setup.playbook)) setup.playbook = ships[0].name;
  const pb = R.playbook(setup.playbook);
  const opt = (v, label, cur) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${escTxt(label)}</option>`;
  return `<section class="card setup"><h2>Set up the ship</h2>
    <label class="field"><span class="lbl">Name</span><input class="in" data-setup="name" value="${esc(setup.name)}" placeholder="The ship’s name"></label>
    <label class="field"><span class="lbl">Playbook</span><select class="in" data-setup="playbook">${ships.map(p => opt(p.name, p.name, setup.playbook)).join('')}</select></label>
    ${pb.text ? `<div class="rich">${md(pb.text)}</div>` : ''}
    ${pb.kits.length ? `<label class="field"><span class="lbl">Kit</span><select class="in" data-setup="kit">${pb.kits.map(k => opt(k.name, `${k.name} (${k.meta.traits || ''}): ${short(k.text)}`, setup.kit)).join('')}</select></label>` : ''}
    ${pb.oddities.length ? `<label class="field"><span class="lbl">Oddity</span><select class="in" data-setup="oddity">${pb.oddities.map(o => opt(o.name, `${o.name}: ${short(o.text)}`, setup.oddity)).join('')}</select></label>` : ''}
    <div class="prow"><span class="grow"></span><button class="pbtn primary" data-act="ship-create">Create the Ship tab</button></div>
    <div class="status" id="setup-msg"></div></section>`;
}

async function createShip() {
  const msg = document.getElementById('setup-msg');
  const pb = R.playbook(setup.playbook);
  const rows = shipRows(R, { name: setup.name.trim() || 'The ship', playbook: setup.playbook, kit: setup.kit || pb.kits[0]?.name, oddity: setup.oddity || pb.oddities[0]?.name });
  msg.textContent = 'Creating…';
  try {
    const r = await client.request({ op: 'create', tab: 'Ship', rows });
    store.receive(r, r.at);
  } catch (e) { msg.textContent = e.message; }
}

function render() {
  const ro = !canEdit();
  if (ro) editing = false;
  const sheetShown = store.loaded && !store.missing;
  document.body.classList.toggle('editing', editing);
  document.body.classList.toggle('readonly', ro && sheetShown);
  let main;
  if (store.missing) main = SHIP ? shipSetupHTML() : `<div class="empty-page"><p>There’s no tab called “${escTxt(tabName)}” in this game’s sheet.</p><p><a href="${esc(href('index.html', client.game))}">Back to the crew</a></p></div>`;
  else if (!store.loaded) main = '<div class="empty">Loading…</div>';
  else if (ui.tab === 'moves') main = movesHTML();
  else if (ui.tab === 'log' && !SHIP) main = actions.logHTML(editing, ro);
  else main = sectionsHTML(ui.tab);
  const hdr = store.loaded && !store.missing ? headerHTML() : '';
  let body = document.getElementById('sheet');
  if (!body) { body = document.createElement('div'); body.id = 'sheet'; app.append(body); }
  body.innerHTML = hdr + `<main>${ro && sheetShown ? readOnlyHTML(client, SHIP ? 'Ship' : tabName, st.info.name || tabName) : ''}${main}</main>`;
  document.title = `${st.info.name || tabName} · ${client.game.name || 'Cybersea'}`;
  autoSize();
}

function autoSize() {
  app.querySelectorAll('textarea.rtext, textarea.enote').forEach(t => { t.style.height = 'auto'; t.style.height = Math.max(60, t.scrollHeight + 4) + 'px'; });
}

/* ---------- interactions ---------- */
function clickPip(btn) {
  if (!canEdit()) return;
  const path = btn.dataset.pip;
  const j = +btn.dataset.j;
  const bond = btn.hasAttribute('data-bond');
  const arr = path.startsWith('b:') ? st.bonds[+path.slice(2)]?.pips : st.tracks[path.slice(2).toLowerCase()]?.pips;
  if (!arr) return;
  let v = arr[j] || 0;
  if (bond) {
    if (editing) v = v ? 0 : 1;      // mark / unmark
    else if (!v) return;             // unmarked bonds can't be used
    else v = v === 1 ? 2 : 1;        // use / restore
  } else if (editing && path.toLowerCase() === 't:harm') v = (v + 1) % 3;
  else if (v === 2) return;
  else v = v ? 0 : 1;
  arr[j] = v;
  btn.className = 'pip' + pipClass(v, bond);
  btn.setAttribute('aria-pressed', v === 1);
  changed();
}

function setTrack(path, fn) {
  const name = path.slice(2);
  const k = name.toLowerCase();
  if (!st.tracks[k]) st.tracks[k] = { name, pips: [] };
  fn(st.tracks[k].pips);
  if (!st.tracks[k].pips.length) delete st.tracks[k];
}

app.addEventListener('click', e => {
  const pip = e.target.closest('.pip');
  if (pip) { clickPip(pip); return; }

  if (!editing && canEdit()) {
    const li = e.target.closest('ul.ck > li[data-ck]');
    if (li) {
      const sec = li.closest('[data-sec]');
      const mv = li.closest('[data-move]');
      if (sec) { const s = st.sections[+sec.dataset.sec]; s.text = toggleCheck(s.text, +li.dataset.ck); changed(); render(); return; }
      if (mv) {
        const m = moveList().find(x => x.own && x.name === mv.dataset.move);
        if (m) {
          const text = toggleCheck(m.text, +li.dataset.ck);
          const mine = charMove(m.name);
          if (mine) mine.text = text; else st.moves.push({ name: m.name, marked: m.marked, text });
          changed();
          li.classList.toggle('on');
        }
        return;
      }
    }
  }

  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.closest('summary')) e.preventDefault();
  const act = b.dataset.act;
  const i = +b.dataset.i;
  switch (act) {
    case 'edit': editing = !editing && canEdit(); render(); if (!editing && deferred) adopt(); break;
    case 'tab': ui.tab = b.dataset.tab; saveUi(); render(); break;
    case 'cat': ui.cat = b.dataset.cat; saveUi(); render(); break;
    case 'sheet-menu': sheetMenu(); break;
    case 'roll-stat': { const s = st.stats[i]; doRoll(s.k, s.v, 2); break; }
    case 'roll-move': {
      const m = lastMoves[i];
      const r = m && rollFor(m.text, st.stats);
      if (!r) break;
      doRoll(r.stat ? `${m.name} · ${r.label}` : m.name, r.mod, r.dice, ({ total }) => {
        if (canEdit() && actions.noteRoll(m, total)) changed();
      });
      break;
    }
    case 'add-pip': setTrack(b.dataset.path, p => { if (p.length < 20) p.push(0); }); changed(); render(); break;
    case 'rm-pip': setTrack(b.dataset.path, p => p.pop()); changed(); render(); break;
    case 'add-section': st.sections.push({ tab: b.dataset.tab, title: uniqueTitle('New section'), text: '', note: '' }); changed(); render(); break;
    case 'rm-section': if (armed(b)) { st.sections.splice(i, 1); changed(); render(); } break;
    case 'add-bond': st.bonds.push({ name: uniqueBond('Someone'), pips: [0, 0, 0] }); changed(); render(); break;
    case 'rm-bond': if (armed(b)) { st.bonds.splice(+b.dataset.j, 1); changed(); render(); } break;
    case 'mv-mark': {
      const m = charMove(b.dataset.name);
      if (m) m.marked = !m.marked; else st.moves.push({ name: b.dataset.name, marked: true, text: '' });
      changed(); render(); break;
    }
    case 'add-move': st.moves.push({ name: uniqueMove('NEW MOVE'), marked: true, text: '' }); changed(); render(); break;
    case 'rm-move': if (armed(b)) { st.moves = st.moves.filter(m => m.name !== b.dataset.name); changed(); render(); } break;
    case 'run': if (canEdit()) actions.open(b.dataset.kind); break;
    case 'rm-log': if (armed(b)) { st.log.splice(i, 1); changed(); render(); } break;
    case 'dt-moves': ui.tab = 'moves'; ui.cat = 'downtime'; saveUi(); render(); break;
    case 'ship-create': if (canEdit()) createShip(); break;
  }
});

const uniqueTitle = t => { let n = t, k = 2; while (st.sections.some(s => s.title.toLowerCase() === n.toLowerCase())) n = `${t} ${k++}`; return n; };
const uniqueBond = t => { let n = t, k = 2; while (st.bonds.some(s => s.name.toLowerCase() === n.toLowerCase())) n = `${t} ${k++}`; return n; };
const uniqueMove = t => { let n = t, k = 2; while (moveList().some(s => s.name.toLowerCase() === n.toLowerCase())) n = `${t} ${k++}`; return n; };

// Text inputs: names/titles apply when you leave the field (they're row keys); text applies as you type.
function bind(el, final) {
  const spec = el.dataset.bind;
  if (!spec) return;
  const [what, rawA, b] = spec.split(':');
  const a = what === 'move' ? decodeURIComponent(rawA) : rawA;
  const v = el.value;
  if (what === 'info') { st.info[a] = el.type === 'number' ? String(parseInt(v, 10) || 0) : v; }
  else if (what === 'stat') { const s = st.stats[+a]; if (b === 'v') s.v = parseInt(v, 10) || 0; else if (final && v.trim()) s.k = v.trim(); else return; }
  else if (what === 'sec') {
    const s = st.sections[+a];
    if (b === 'title') {
      if (!final || !v.trim() || v.trim() === s.title) return;
      const t = track(s.title);
      const nt = uniqueTitle(v.trim());
      if (t) { delete st.tracks[s.title.toLowerCase()]; st.tracks[nt.toLowerCase()] = { name: nt, pips: t.pips }; }
      s.title = nt;
    } else s[b] = v;
  } else if (what === 'bond') { if (!final || !v.trim()) return; st.bonds[+a].name = v.trim(); }
  else if (what === 'move') {
    const m = charMove(a) || (() => { const lm = moveList().find(x => x.name === a); const n = { name: a, marked: !!lm?.marked, text: lm?.text || '' }; st.moves.push(n); return n; })();
    if (b === 'name') { if (!final || !v.trim()) return; m.name = v.trim(); }
    else m.text = v;
  }
  changed();
  if (final && /title|name/.test(b || '') ) render();
}

app.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'q') { query = t.value; document.getElementById('mlist').innerHTML = moveListHTML(); return; }
  if (t.dataset.setup) { setup[t.dataset.setup] = t.value; return; }
  if (t.dataset.log != null) { st.log[+t.dataset.log].note = t.value; changed(); return; }
  if (t.matches('textarea')) { t.style.height = 'auto'; t.style.height = Math.max(60, t.scrollHeight + 4) + 'px'; }
  const spec = t.dataset.bind || '';
  if (/:(title|name|k)$/.test(spec) || spec.startsWith('bond:')) return; // applied on change
  bind(t, false);
});
app.addEventListener('change', e => {
  if (e.target.dataset.bind) bind(e.target, true);
  if (e.target.dataset.setup) { setup[e.target.dataset.setup] = e.target.value; if (e.target.dataset.setup === 'playbook') { setup.kit = ''; setup.oddity = ''; render(); } }
});

app.addEventListener('toggle', e => {
  const d = e.target;
  if (!(d instanceof HTMLDetailsElement) || !d.dataset.id || query) return;
  if (d.open) openSet.add(d.dataset.id); else openSet.delete(d.dataset.id);
  saveUi();
}, true);

document.addEventListener('keydown', e => {
  if (e.key === '/' && !e.target.closest('input,textarea,select') && !document.getElementById('overlay')) {
    e.preventDefault();
    if (ui.tab !== 'moves') { ui.tab = 'moves'; saveUi(); render(); }
    document.getElementById('q')?.focus();
  }
});

/* ---------- sheet menu: embed link, import from the old one-page sheet ---------- */
function sheetMenu() {
  const local = (() => { try { return localStorage.getItem('rapscallion:nexa:v1'); } catch { return null; } })();
  const o = modal(`
    <div class="prow"><h2>${escTxt(st.info.name || tabName)}</h2><span class="grow"></span><button class="mini" data-close aria-label="Close">×</button></div>
    <div class="prow"><button class="pbtn" data-s="embed">Copy Notion embed link</button></div>
    ${canEdit() ? `<div class="mhd lbl">Import from the old one-page sheet</div>
    <div class="status">Replaces this character’s sheet with data from the old nexa.html (⋯ → Download, then paste it here).</div>
    <textarea class="in json" spellcheck="false" placeholder="Paste the downloaded JSON" aria-label="Old sheet JSON">${local ? escTxt(local) : ''}</textarea>
    <div class="prow"><span class="grow"></span><button class="pbtn" data-s="import">Import</button></div>` : ''}
    <div class="status" data-msg></div>`, { label: 'Sheet options' });
  const say = m => { o.querySelector('[data-msg]').textContent = m; };
  o.addEventListener('click', async e => {
    const s = e.target.closest('[data-s]')?.dataset.s;
    if (s === 'embed') {
      const url = new URL(inviteUrl(client.game));
      const link = `${url.origin}${url.pathname}sheet.html?c=${encodeURIComponent(tabName)}${url.hash}`;
      try { await navigator.clipboard.writeText(link); say('Copied. Paste it into a Notion /embed block.'); } catch { say(link); }
    }
    if (s === 'import' && canEdit()) {
      const btn = e.target.closest('[data-s]');
      let old;
      try { old = JSON.parse(o.querySelector('textarea').value); } catch { say('That isn’t valid JSON.'); return; }
      if (!old || !Array.isArray(old.sections)) { say('That doesn’t look like the old sheet’s data.'); return; }
      if (!armed(btn)) { say('Click Import again to replace this sheet.'); return; }
      st = fromLegacy(old);
      changed();
      closeModal();
      render();
      toast('Imported. Saving to the sheet…');
    }
  });
}

// Convert the old nexa.html state (v1/v2) to this sheet's shape.
function fromLegacy(old) {
  const ns = { info: {}, stats: [], tracks: {}, bonds: [], sections: [], moves: [], specials: [], advances: {}, log: [], state: {} };
  ns.info.name = old.name || st.info.name || tabName;
  ns.info.playbook = old.playbook || st.info.playbook || '';
  if (st.info.player) ns.info.player = st.info.player;
  ns.info.level = String(old.level || 0);
  ns.stats = (old.stats || []).map(s => ({ k: s.k, v: parseInt(s.v, 10) || 0 }));
  if (Array.isArray(old.harm)) ns.tracks.harm = { name: 'Harm', pips: old.harm.slice() };
  if (Array.isArray(old.luck)) ns.tracks.luck = { name: 'Luck', pips: old.luck.slice() };
  for (const sec of old.sections || []) {
    const title = sec.title || 'Section';
    if (Array.isArray(sec.track)) ns.tracks[title.toLowerCase()] = { name: title, pips: sec.track.slice() };
    if (sec.type === 'bonds') {
      for (const r of sec.rows || []) ns.bonds.push({ name: r.name || 'Someone', pips: (r.pips || []).slice() });
      ns.sections.push({ tab: sec.tab === 'notes' ? 'notes' : 'sheet', title, text: '', note: sec.note || '' });
    } else {
      ns.sections.push({ tab: sec.tab === 'notes' ? 'notes' : 'sheet', title, text: htmlToMarkup(sec.html || ''), note: sec.note || '' });
    }
  }
  // Keep a move's own text only where it differs from the Rules tab (e.g. checked dark powers),
  // so later fixes to the Rules tab still reach this sheet.
  const pbMoves = R.playbook(ns.info.playbook)?.moves || [];
  for (const m of old.moves || []) {
    if (m.cat !== 'playbook' && !String(m.id || '').startsWith('u')) continue;
    let text = htmlToMarkup(m.html || '');
    const rule = pbMoves.find(x => x.name.toUpperCase() === String(m.name).toUpperCase());
    if (rule && !/\[x\]/i.test(text) && plain(text) === plain(rule.text)) text = '';
    if (m.off && !text) continue;
    ns.moves.push({ name: m.name, marked: !m.off, text });
  }
  for (const a of old.advances || []) if (a.n) ns.advances[a.kind || a.t] = a.n;
  for (const e of old.log || []) ns.log.push({ id: logId(e.at), at: e.at, title: e.title, items: e.items || [], note: e.note || '' });
  if (old.downtime) ns.state.downtime = old.downtime;
  return ns;
}

/* ---------- start ---------- */
render();
client.watch(tabName); // Rules is read once per visit (cached by digest), not polled
client.read([tabName, 'Rules']).catch(() => render()); // a wrong or missing passphrase opens the prompt (see wireNav)
client.startPolling();
