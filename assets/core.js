// Shared UI pieces: icons, pips, dice, toast, dialogs, theme, the top bar and its menu.

import { esc, escTxt } from './markup.js';
import { isSignedIn, isSigninRow } from './codec.js';
import { ls, listGames, inviteUrl, href, joinGame, forgetGame, inviteFromText } from './games.js';

export { esc, escTxt };

export const ICON = {
  pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  dots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  die: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="4"/><g fill="currentColor" stroke="none"><circle cx="8.5" cy="8.5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="15.5" cy="15.5" r="1.4"/></g></svg>',
};

export const uid = () => 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
export const fmt = v => (v > 0 ? '+' + v : v < 0 ? '−' + Math.abs(v) : '0');
export const fmtDate = t => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

// Two-click confirm for destructive buttons (window.confirm is blocked in some embeds).
export function armed(b) {
  if (b.classList.contains('armed')) return true;
  b.classList.add('armed');
  setTimeout(() => b.classList.remove('armed'), 2500);
  return false;
}

/* ---------- pips ---------- */
// Tracks: 0 open, 1 marked, 2 crossed out. Bonds: 0 unmarked, 1 marked, 2 marked but used.
export const pipClass = (v, bond) => (bond ? (v === 1 ? ' on' : v === 2 ? '' : ' nb') : (v === 1 ? ' on' : v === 2 ? ' x' : ''));
export const pips = (path, arr, label, bond = false) => arr.map((v, j) =>
  `<button class="pip${pipClass(v, bond)}" data-pip="${esc(path)}" data-j="${j}"${bond ? ' data-bond' : ''} aria-label="${esc(label)} ${j + 1}" aria-pressed="${v === 1}"></button>`).join('');

/* ---------- theme ---------- */
export function applyTheme() {
  const t = ls.get('cybersea:theme', 'auto');
  if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
  else document.documentElement.removeAttribute('data-theme');
}

/* ---------- dice ---------- */
export function d6() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return 1 + (a[0] % 6);
}

let toastT;
function toastEl() {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.addEventListener('click', () => el.classList.remove('show'));
    document.body.append(el);
  }
  return el;
}

export function doRoll(label, mod = 0, dice = 2) {
  const ds = Array.from({ length: dice }, d6);
  const total = ds.reduce((a, b) => a + b, 0) + mod;
  const band = dice === 2 ? (total >= 10 ? ['hi', '10+'] : total >= 7 ? ['mid', '7-9'] : ['lo', '6-']) : ['', ''];
  const el = toastEl();
  el.innerHTML = `<span class="tl">${escTxt(label)}</span>` + ds.map(d => `<span class="die">${d}</span>`).join('') +
    (mod ? `<span class="mod">${fmt(mod)}</span>` : '') + `<span class="mod">=</span><span class="tot">${total}</span>` +
    (band[1] ? `<span class="band">${band[1]}</span>` : '');
  el.className = 'toast';
  void el.offsetWidth;
  el.className = 'toast show ' + band[0];
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), 12000);
  return { dice: ds, total };
}

export function toast(message, kind = '') {
  const el = toastEl();
  el.innerHTML = `<span class="tl msg">${escTxt(message)}</span>`;
  el.className = 'toast show ' + kind;
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), 5000);
}

/* ---------- dialogs ---------- */
export function closeModal() { document.getElementById('overlay')?.remove(); }

export function modal(inner, { label = 'Dialog', wide = false } = {}) {
  closeModal();
  const o = document.createElement('div');
  o.className = 'overlay';
  o.id = 'overlay';
  o.innerHTML = `<div class="panel${wide ? ' action' : ''}" role="dialog" aria-modal="true" aria-label="${esc(label)}">${inner}</div>`;
  o.addEventListener('click', e => { if (e.target === o || e.target.closest('[data-close]')) closeModal(); });
  document.body.append(o);
  return o;
}

addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
    return ok;
  }
}

/* ---------- passphrase ---------- */
export function askKey(client, message = '') {
  const o = modal(`
    <div class="prow"><h2>${escTxt(client.game.name || 'Game')}</h2><span class="grow"></span><button class="mini" data-close aria-label="Close">×</button></div>
    ${message ? `<div class="status">${escTxt(message)}</div>` : ''}
    <form class="prow" data-keyform>
      <input class="in tok" type="password" autocomplete="current-password" placeholder="Passphrase" aria-label="Passphrase" required>
      <button class="pbtn primary">Open</button>
    </form>`, { label: 'Passphrase' });
  const input = o.querySelector('input');
  input.focus();
  o.querySelector('form').addEventListener('submit', async e => {
    e.preventDefault();
    client.setKey(input.value.trim());
    closeModal();
    try { await client.read(); } catch (err) { if (err.code === 'auth' || err.code === 'throttled') askKey(client, err.message); }
  });
}

/* ---------- top bar ---------- */
const PAGES = [['home', 'index.html', 'Crew'], ['ship', 'ship.html', 'Ship'], ['lore', 'lore.html', 'Lore'], ['map', 'map.html', 'Map'], ['rules', 'rules.html', 'Rules'], ['gm', 'gm.html', 'GM']];

export function navHTML(client, page) {
  const g = client?.game;
  const links = PAGES.filter(([k]) => k !== 'gm' || client?.role === 'gm')
    .map(([k, file, label]) => `<a href="${esc(href(file, g))}"${k === page ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  return `<nav class="gnav">
    <a class="gname" href="${esc(href('index.html', g))}">${escTxt(g?.name || 'Cybersea')}</a>
    <div class="glinks">${links}</div>
    ${whoChip(client)}
    <button class="ic" data-nav="menu" title="Menu" aria-label="Menu">${ICON.dots}<i class="sdot ${client ? client.status === 'idle' ? 'busy' : client.status : 'off'}"></i></button>
  </nav>`;
}

/* ---------- who you're signed in as ---------- */
const characterNames = client => client.list.filter(t => t.kind === 'character').map(t => t.name);

// GM, your character, or "Sign in". Empty until the first read says what this device can do.
function whoChip(client) {
  if (!client) return '';
  const me = client.me;
  const [cls, text, title] = client.checking ? ['anyone', 'Checking…', 'Checking the passphrase']
    : client.locked ? ['off', 'Sign in', 'Enter the passphrase']
    : client.role === 'gm' ? ['gm', 'GM', 'Signed in as the GM']
    : me ? ['me', me, `Signed in as ${me}`]
    : client.role === 'crew' ? ['anyone', 'Sign in', 'Sign in as your character']
    : ['wait', '', ''];
  return `<button class="who who-${cls}" data-nav="who" title="${esc(title)}" aria-label="${esc(title || 'Signing in')}">${escTxt(text)}</button>`;
}

const whoText = client => (client.role === 'gm' ? 'GM' : client.me || client.role || 'not signed in');

// Your character's button signs you in; clicking it again signs you out. Others show if they're taken.
export function pickerHTML(client, { looking = false } = {}) {
  const me = client.me;
  const btn = (n, label, sub = '') => `<button class="pbtn pick" data-me="${esc(n)}" aria-pressed="${!!n && n === me}">${escTxt(label)}${sub ? `<span class="sub">${escTxt(sub)}</span>` : ''}</button>`;
  return `<div class="picks">${characterNames(client).map(n => btn(n, n, n === me ? 'you · click to sign out' : isSignedIn(client.tab(n).rows) ? 'signed in' : '')).join('')}${looking ? btn('', 'Just looking') : ''}</div>`;
}

export function pick(client, el) {
  const n = el.dataset.me;
  client.setMe(n && n === client.me ? '' : n);
}

// Shown instead of edit controls when this device can't edit a tab.
export function readOnlyHTML(client, tab, label = tab) {
  if (!client.role || client.locked) return '';
  const me = client.me;
  const msg = !me ? 'Read-only until you sign in as your character.' : `Read-only: only ${label}’s player (or the GM) edits this.`;
  return `<div class="robar"><span>${escTxt(msg)}</span>${me ? '' : '<button class="pbtn" data-nav="who">Sign in</button>'}</div>`;
}

export function openWho(client, { fresh = false } = {}) {
  const g = client.game;
  const me = client.me;
  let title, body;
  if (client.locked || !client.role) {
    title = 'Not signed in';
    body = `<p>${escTxt(client.error || 'This game needs a passphrase.')}</p>
      <div class="prow">${g.key ? '<button class="pbtn" data-w="gm-out">Continue as crew</button>' : ''}<span class="grow"></span><button class="pbtn primary" data-w="key">Enter passphrase</button></div>`;
  } else if (client.role === 'gm') {
    title = 'Signed in as the GM';
    body = `<p>You used the GM passphrase, so you can see and change everything, including the GM page.</p>
      <div class="prow"><a class="pbtn primary" href="${esc(href('gm.html', g))}">GM page</a><span class="grow"></span><button class="pbtn" data-w="gm-out">Sign out of GM</button></div>`;
  } else {
    title = me ? `Signed in as ${me}` : 'Sign in as your character';
    body = `<p>Click your character to sign in, and again to sign out. The crew sees who’s signed in. Anyone can still open any sheet.</p>
      ${pickerHTML(client)}
      <div class="prow">${me ? `<a class="pbtn primary" href="${esc(href('sheet.html', g, { c: me }))}">Open my sheet</a>` : ''}<span class="grow"></span><button class="pbtn" data-w="key">I’m the GM</button></div>`;
  }
  const o = modal(`<div class="prow"><h2>${escTxt(title)}</h2><span class="grow"></span><button class="mini" data-close aria-label="Close">×</button></div>
    <div class="note">${escTxt(g.name || 'Game')}</div>${body}`, { label: 'Who you are' });
  o.addEventListener('click', e => {
    const p = e.target.closest('[data-me]');
    if (p) { pick(client, p); openWho(client, { fresh: true }); }
    if (e.target.closest('[data-w="key"]')) askKey(client, client.role === 'crew' ? 'Enter the GM passphrase.' : '');
    if (e.target.closest('[data-w="gm-out"]')) {
      client.signOutGm();
      if (/gm\.html$/.test(location.pathname)) location.href = href('index.html', g); // that page reads
      else openWho(client); // reads, which confirms the sign-out and fills in the characters
    }
  });
  // Who's signed in lives on each character's tab: fetch them all (unchanged ones cost little).
  if (!fresh && client.role === 'crew') {
    client.read([...new Set([...client.watched, ...characterNames(client)])])
      .then(() => { if (document.querySelector('[role="dialog"][aria-label="Who you are"]')) openWho(client, { fresh: true }); })
      .catch(() => {});
  }
}

export function wireNav(root, client) {
  root.addEventListener('click', e => {
    if (e.target.closest('[data-nav="menu"]')) openMenu(client);
    if (e.target.closest('[data-nav="who"]')) openWho(client);
  });
  client?.on(e => {
    if (e.me || e.list || e.key || e.auth || e.status) {
      const w = document.querySelector('.gnav .who');
      if (w) w.outerHTML = whoChip(client);
    }
    if (e.status) {
      const dot = document.querySelector('.gnav .sdot');
      if (dot) { dot.className = 'sdot ' + client.status; dot.title = client.error || ''; }
      const line = document.getElementById('sync-status');
      if (line) line.textContent = statusText(client);
    }
    if (e.auth) askKey(client, client.error);
    if (e.skipped) toast(notSaved(e.skipped.rows));
  });
}

// Rows the sheet turned down because they'd changed there since this page's copy.
function notSaved(rows) {
  const names = [...new Set(rows.map(r => (isSigninRow(r) ? 'who’s signed in' : String(r[0]).trim().toLowerCase() === 'log' ? 'a log entry' : String(r[1]))))];
  const list = names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', ');
  return `Not saved: ${list} changed on the sheet first.`;
}

const statusText = c => (c.status === 'err' ? c.error : c.status === 'busy' ? 'Saving…' : c.status === 'ok' ? 'Saved to the sheet' : '');

export function openMenu(client) {
  const theme = ls.get('cybersea:theme', 'auto');
  const games = listGames();
  const g = client?.game;
  const o = modal(`
    <div class="prow"><h2>Menu</h2><span class="grow"></span><button class="mini" data-close aria-label="Close">×</button></div>
    <div class="prow"><span class="lbl">Theme</span>
      <div class="seg">${['auto', 'dark', 'light'].map(t => `<button data-theme-set="${t}" class="${theme === t ? 'on' : ''}">${t}</button>`).join('')}</div></div>
    ${g ? `
    <div class="mhd lbl">${escTxt(g.name)} · ${escTxt(whoText(client))}</div>
    <div class="status" id="sync-status">${escTxt(statusText(client))}</div>
    <div class="prow">
      <button class="pbtn" data-m="invite">${client.role === 'gm' ? 'Copy crew invite' : 'Copy invite link'}</button>
      ${client.role === 'gm' ? '<button class="pbtn" data-m="gm-invite">Copy GM link</button>' : ''}
      <button class="pbtn" data-m="key">${client.role === 'gm' ? 'Change passphrase' : 'GM sign-in'}</button>
    </div>` : ''}
    <div class="mhd lbl">Games</div>
    <div class="glist">${games.map(x => `<div class="prow"><a href="${esc(href('index.html', x))}" class="${g && x.id === g.id ? 'cur' : ''}">${escTxt(x.name)}</a><span class="grow"></span><button class="mini" data-forget="${esc(x.id)}" title="Forget this game" aria-label="Forget">×</button></div>`).join('') || '<div class="status">None yet.</div>'}</div>
    <form class="prow" data-join><input class="in tok" placeholder="Paste an invite link" aria-label="Invite link"><button class="pbtn">Join</button></form>
    <div class="status" data-msg></div>`, { label: 'Menu' });
  const say = m => { o.querySelector('[data-msg]').textContent = m; };
  o.addEventListener('click', async e => {
    const th = e.target.closest('[data-theme-set]');
    if (th) {
      ls.set('cybersea:theme', th.dataset.themeSet);
      applyTheme();
      o.querySelectorAll('[data-theme-set]').forEach(b => b.classList.toggle('on', b === th));
      return;
    }
    const m = e.target.closest('[data-m]')?.dataset.m;
    if (m === 'invite') {
      const url = inviteUrl(g, client.role === 'gm' ? client.crewKey : g.key);
      say((await copy(url)) ? 'Copied. Send it to the crew.' : url);
    }
    if (m === 'gm-invite') say((await copy(inviteUrl(g))) ? 'Copied. It gives GM access, so keep it to yourself.' : inviteUrl(g));
    if (m === 'key') askKey(client, client.role === 'gm' ? '' : 'Enter the GM passphrase.');
    const f = e.target.closest('[data-forget]');
    if (f && armed(f)) {
      forgetGame(f.dataset.forget);
      if (g && f.dataset.forget === g.id) location.href = 'index.html'; else openMenu(client);
    }
  });
  o.querySelector('[data-join]').addEventListener('submit', e => {
    e.preventDefault();
    const inv = inviteFromText(e.target.querySelector('input').value);
    if (!inv) { say('That doesn’t look like an invite link.'); return; }
    location.href = href('index.html', joinGame(inv));
  });
}

// Common page start: theme, nav, and (if there's a game) a client that's ready to read.
export function pageShell(root, client, page) {
  applyTheme();
  root.insertAdjacentHTML('afterbegin', navHTML(client, page));
  wireNav(document.body, client);
}

export function refreshNav(client, page) {
  const old = document.querySelector('.gnav');
  if (old) old.outerHTML = navHTML(client, page);
}
