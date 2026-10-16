// Talking to a game's spreadsheet script.
//
// call(): POST with the JSON body as text/plain. No custom headers, so the browser sends it
// without a CORS preflight (Apps Script can't answer preflights).
//
// GameClient keeps one TabStore per tab:
//   server  = last rows + digest the sheet sent (cached in localStorage)
//   pending = rows changed here but not yet confirmed (also in localStorage, so edits made
//             offline or right before closing the page aren't lost)
//   rows    = server rows with pending changes applied: what the page shows
// Pages report changes as (previous serialization, next serialization); only rows that differ
// become pending, so a stale page never overwrites rows someone else changed.

import { CONFIG } from '../config.js';
import { ls, gkey, upsertGame } from './games.js';
import { rowKey, applyPending, diffRows, isSigninRow, isSignedIn, signinRow } from './codec.js';

// The Code.gs version this site expects (its ping answers {v}). Older deployments still work for
// the GM, but turn away crew without a passphrase.
export const API_VERSION = 2;

export class ApiError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

export async function call(api, body, { timeout = 20000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let res;
  try {
    res = await fetch(api, { method: 'POST', body: JSON.stringify(body), signal: ctrl.signal, redirect: 'follow' });
  } catch (e) {
    throw new ApiError(e.name === 'AbortError' ? 'The sheet took too long to answer.' : 'Can’t reach the sheet right now.', 'network');
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let out;
  try { out = JSON.parse(text); } catch { throw new ApiError('Google sent back an error page. Try again in a moment.', 'html'); }
  if (!out.ok) throw new ApiError(out.error || 'Something went wrong.', out.code || 'error');
  return out;
}

export async function ping(api) {
  const res = await fetch(`${api}${api.includes('?') ? '&' : '?'}op=ping`, { redirect: 'follow' });
  return JSON.parse(await res.text());
}

// An old script answers "wrong passphrase" when none was sent, which is baffling; say what's wrong.
async function outdatedScript(api) {
  try {
    if (((await ping(api)).v || 0) < API_VERSION) {
      return 'This game’s script is out of date, so it still wants a passphrase from everyone. The GM needs to paste the latest Code.gs into it and deploy a new version (SETUP.md, “Updating the script”). The GM passphrase still works.';
    }
  } catch { /* unreachable: keep the original message */ }
  return '';
}

class Emitter {
  constructor() { this.fns = new Set(); }
  on(fn) { this.fns.add(fn); return () => this.fns.delete(fn); }
  emit(e = {}) { for (const fn of [...this.fns]) fn(e); }
}

export class TabStore extends Emitter {
  constructor(client, name) {
    super();
    this.client = client;
    this.name = name;
    this.cacheKey = gkey(client.game, `tab:${name.toLowerCase()}`);
    this.pendKey = gkey(client.game, `pending:${name.toLowerCase()}`);
    this.server = ls.get(this.cacheKey, { d: '', rows: [] });
    this.pending = new Map(Object.entries(ls.get(this.pendKey, {})));
    this.seq = Math.max(0, ...[...this.pending.values()].map(p => p.seq || 0));
    this.loaded = !!this.server.d;
    this.missing = false;
    this.inflight = false;
    this.failures = 0;
    this.confirmedAt = 0; // when the sheet last confirmed a patch from here
    if (this.pending.size) this.schedule(300);
  }

  get rows() { return applyPending(this.server.rows, [...this.pending.values()]); }

  receive(d, rows) {
    this.server = { d, rows };
    this.loaded = true;
    this.missing = false;
    ls.set(this.cacheKey, this.server);
    this.emit({ fromServer: true });
  }

  markMissing() { this.missing = true; this.emit({ missing: true }); }

  change(prev, next) {
    const { set, del, ren } = diffRows(prev, next);
    for (const r of ren) {
      // Anything still queued under the old name would recreate the old row after the rename;
      // the set queued under the new name already carries the latest values.
      this.pending.delete(rowKey(r[0], r[1]));
      this.pending.set(`ren:${rowKey(r[0], r[1])}`, { ren: r, row: r.slice(0, 2), seq: ++this.seq });
    }
    for (const row of set) this.pending.set(rowKey(row[0], row[1]), { row, seq: ++this.seq });
    for (const [k, n] of del) this.pending.set(rowKey(k, n), { row: [k, n, '', ''], del: true, seq: ++this.seq });
    if (!set.length && !del.length && !ren.length) return false;
    this.persist();
    this.schedule();
    return true;
  }

  persist() { ls.set(this.pendKey, Object.fromEntries(this.pending)); }

  schedule(ms = 1000) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), ms);
    this.client.setStatus('busy');
  }

  async flush(beacon = false) {
    if (!this.pending.size) return;
    const sent = [...this.pending.entries()];
    const ordered = sent.map(([, p]) => p).sort((x, y) => x.seq - y.seq);
    const body = {
      op: 'patch',
      tab: this.name,
      ren: ordered.filter(p => p.ren).map(p => p.ren),
      set: ordered.filter(p => !p.del && !p.ren).map(p => p.row),
      del: ordered.filter(p => p.del).map(p => p.row.slice(0, 2)),
    };
    if (beacon) {
      // The page is going away: hand the patch to the browser. It stays pending until a later
      // load confirms it (patches are safe to repeat).
      try { navigator.sendBeacon(this.client.game.api, JSON.stringify({ ...body, key: this.client.game.key || undefined })); } catch { /* ignore */ }
      return;
    }
    if (this.inflight) { this.again = true; return; }
    this.inflight = true;
    clearTimeout(this.timer);
    try {
      const r = await this.client.request(body);
      for (const [k, p] of sent) if (this.pending.get(k)?.seq === p.seq) this.pending.delete(k);
      this.confirmedAt = Date.now();
      this.persist();
      this.failures = 0;
      this.receive(r.d, r.rows);
      this.client.setStatus(this.client.anyPending() ? 'busy' : 'ok');
    } catch (e) {
      this.failures++;
      this.client.setStatus('err', e.message);
      if (e.code === 'auth') { this.client.locked = true; this.client.emit({ auth: true }); }
      else if (e.code !== 'forbidden') this.schedule(Math.min(60000, 1500 * 2 ** this.failures));
    } finally {
      this.inflight = false;
      if (this.again) { this.again = false; if (this.pending.size) this.schedule(200); }
    }
  }
}

export class GameClient extends Emitter {
  constructor(game) {
    super();
    this.game = game;
    this.stores = new Map();
    this.watched = new Set();
    this.status = 'idle';
    this.error = '';
    this.role = game.role || null;
    this.list = ls.get(gkey(game, 'list'), []);
    this.reading = false;
    this.locked = false;   // the sheet turned our passphrase (or lack of one) away
    this.checking = false; // a new passphrase is on its way to the sheet
  }

  tab(name) {
    const k = name.toLowerCase();
    if (!this.stores.has(k)) this.stores.set(k, new TabStore(this, name));
    return this.stores.get(k);
  }

  anyPending() { return [...this.stores.values()].some(s => s.pending.size || s.inflight); }

  setStatus(status, error = '') {
    this.status = status;
    this.error = error;
    this.emit({ status });
  }

  // The character this device is signed in as (honor system; the GM has none).
  // Until the tab list has any characters, trust what was stored.
  get me() {
    if (this.role === 'gm' || !this.game.as) return null;
    const chars = this.list.filter(t => t.kind === 'character');
    if (!chars.length) return this.game.as;
    const want = String(this.game.as).toLowerCase();
    return chars.find(t => t.name.toLowerCase() === want)?.name || null;
  }

  // Sign in as a character, or sign out with ''. This device remembers who you are, and the
  // character's tab is marked so the crew can see they're taken, until someone signs them out.
  setMe(name) {
    const old = this.me;
    if (old && old.toLowerCase() !== String(name).toLowerCase()) this.markSignedIn(old, false);
    if (name) this.markSignedIn(name, true);
    this.game = upsertGame({ ...this.game, as: name });
    this.emit({ me: true });
  }

  markSignedIn(name, on) {
    const s = this.tab(name);
    if (s.change(s.rows.filter(isSigninRow), [signinRow(on)])) s.schedule(100); // let the crew see it soon
  }

  // The sheet has the last word on who's signed in: if this device's character was signed out
  // there (from another device, or by clearing the cell), this device is signed out too. Only a
  // read that started after our own sign-in reached the sheet can say so.
  reconcileMe(readNames, startedAt) {
    const as = this.game.as;
    if (!as || this.role === 'gm' || !readNames.some(n => n.toLowerCase() === as.toLowerCase())) return;
    const s = this.tab(as);
    if (!s.loaded || s.missing || s.inflight || s.confirmedAt >= startedAt) return;
    if ([...s.pending.values()].some(p => isSigninRow(p.row))) return;
    if (!isSignedIn(s.rows)) {
      this.game = upsertGame({ ...this.game, as: null });
      this.emit({ me: true });
    }
  }

  // Honor system, kept by the site rather than the sheet: the GM edits everything; crew edit once
  // signed in as a character: that character's sheet, and the shared Ship and Lore tabs.
  canEdit(tab) {
    if (this.role === 'gm') return true;
    const me = this.me;
    if (this.role !== 'crew' || this.locked || !me) return false;
    const t = String(tab).trim().toLowerCase();
    return t === 'ship' || t === 'lore' || t === me.toLowerCase();
  }

  setKey(key) {
    this.game = upsertGame({ ...this.game, key });
    this.locked = false;
    this.checking = !!key;
    this.emit({ key: true });
  }

  // Back to crew. Crew need no passphrase, so show that straight away; the caller's next read
  // confirms it, or asks for a passphrase if this game set one for the crew.
  signOutGm() {
    this.game = upsertGame({ ...this.game, key: '', role: 'crew' });
    this.role = 'crew';
    this.crewKey = null;
    this.locked = false;
    this.checking = false;
    this.emit({ key: true, list: true, me: true });
  }

  request(body) {
    return call(this.game.api, { ...body, key: this.game.key || undefined });
  }

  // Fetch tabs; only tabs that changed since our cached copy come back with rows.
  async read(names = [...this.watched]) {
    const have = {};
    for (const n of names) { const s = this.tab(n); if (s.server.d) have[s.name] = s.server.d; }
    this.reading = true;
    const startedAt = Date.now();
    try {
      const r = await this.request({ op: 'read', tabs: names, have });
      this.role = r.role;
      this.list = r.list;
      this.crewKey = r.crewKey || null;
      this.game = upsertGame({ ...this.game, name: r.game || this.game.name, role: r.role });
      ls.set(gkey(this.game, 'list'), r.list);
      const got = Object.keys(r.tabs).map(k => k.toLowerCase());
      for (const [name, t] of Object.entries(r.tabs)) {
        const s = this.tab(name);
        s.name = name;
        if (t.rows) s.receive(t.d, t.rows); else if (!s.loaded) { s.loaded = true; s.emit({ fromServer: true }); }
      }
      for (const n of names) if (!got.includes(n.toLowerCase())) this.tab(n).markMissing();
      this.reconcileMe(names, startedAt);
      if (!this.anyPending()) this.setStatus('ok');
      this.emit({ list: true });
      return r;
    } catch (e) {
      if (e.code === 'auth' && !this.game.key) e.message = (await outdatedScript(this.game.api)) || e.message;
      this.setStatus('err', e.message);
      if (e.code === 'auth') { this.locked = true; this.emit({ auth: true }); }
      throw e;
    } finally {
      this.reading = false;
      if (this.checking) { this.checking = false; this.emit({ me: true }); }
    }
  }

  watch(...names) { names.forEach(n => this.watched.add(n)); }

  // Poll watched tabs while the page is visible; flush pending edits when it's hidden or closed.
  startPolling() {
    const tick = () => {
      if (document.hidden || this.reading || this.anyPending() || this.locked) return;
      this.read().catch(() => {});
    };
    this.pollTimer = setInterval(tick, Number(ls.get('cybersea:pollMs')) || CONFIG.pollMs); // override is for tests
    addEventListener('focus', tick);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.flushAll(true); else tick();
    });
    addEventListener('pagehide', () => this.flushAll(true));
  }

  flushAll(beacon = false) { for (const s of this.stores.values()) s.flush(beacon); }
}
