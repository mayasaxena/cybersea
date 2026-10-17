// Talking to a game's spreadsheet script.
//
// call(): POST with the JSON body as text/plain. No custom headers, so the browser sends it
// without a CORS preflight (Apps Script can't answer preflights).
//
// GameClient keeps one TabStore per tab:
//   server  = last rows, their versions and the digest the sheet sent (cached in localStorage)
//   pending = rows changed here but not yet confirmed (also in localStorage, so edits made
//             offline or right before closing the page aren't lost)
//   rows    = server rows with pending changes applied: what the page shows
// Pages report changes as (previous serialization, next serialization); only rows that differ
// become pending, so a stale page never overwrites rows someone else changed. Each pending
// change also says which version of its row it was made to, and the sheet turns it down if the
// row has changed since (see "row versions" in Code.gs).

import { CONFIG } from '../config.js';
import { ls, gkey, upsertGame } from './games.js';
import { rowKey, applyPending, diffRows, isSigninRow, isSignedIn, signinRow } from './codec.js';

// The latest Code.gs version (its ping answers {v}). Older deployments still work: before 2, only
// with a passphrase (crew without one are turned away); before 3, without row versions, so
// changes always go ahead; before 4, without the Rules tab's override columns; before 5, without
// the Map tab (places, levels and pictures); before 6, without the System tab (the game's mechanics);
// before 7, without feedback.
export const API_VERSION = 7;
const CREW_SIGNIN_VERSION = 2;

// The most versions a pending change carries for what earlier unconfirmed changes may have left.
const MAX_ALTS = 20;

// A new row version (Code.gs makes them the same way).
const newStamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

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
    if (((await ping(api)).v || 0) < CREW_SIGNIN_VERSION) {
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

  // The version the sheet last sent for a row ('' when it had none), or null if it sent none
  // (nothing read yet, or a script older than version 3): a change made then goes ahead anyway.
  version(key) {
    const { rows, vers } = this.server;
    if (!this.loaded || !Array.isArray(vers)) return null;
    const i = rows.findIndex(r => rowKey(r[0], r[1]) === key);
    return i < 0 ? '' : vers[i] ?? null;
  }

  // A row's picture from the tab's Image column (see pictures.js), or ''.
  imageOf(kind, name) {
    const { rows, imgs } = this.server;
    if (!Array.isArray(imgs)) return '';
    const i = rows.findIndex(r => rowKey(r[0], r[1]) === rowKey(kind, name));
    return i < 0 ? '' : imgs[i] || '';
  }

  // A tab from the sheet ({d, rows, vers, imgs}), read at `at` (the sheet's clock). Rows read before
  // the copy we have (by a read that started before our last patch, say) are older, so they're
  // dropped.
  receive(t, at) {
    if (!(at && this.server.at > at)) {
      this.server = { d: t.d, rows: t.rows, vers: t.vers, imgs: t.imgs, at };
      ls.set(this.cacheKey, this.server);
    }
    this.loaded = true;
    this.missing = false;
    this.emit({ fromServer: true });
  }

  // The sheet says our copy is still current, as of `at`.
  unchanged(at) {
    if (at > (this.server.at || 0)) this.server.at = at;
    if (!this.loaded) { this.loaded = true; this.emit({ fromServer: true }); }
  }

  markMissing() { this.missing = true; this.emit({ missing: true }); }

  change(prev, next) {
    const { set, del, ren } = diffRows(prev, next);
    for (const r of ren) {
      // Anything still queued under the old name would recreate the old row after the rename;
      // the set queued under the new name already carries the latest values.
      const k = rowKey(r[0], r[1]);
      const was = this.pending.get(k);
      this.pending.delete(k);
      this.queue(`ren:${k}`, { ren: r, row: r.slice(0, 2) }, was);
    }
    for (const row of set) this.queue(rowKey(row[0], row[1]), { row });
    for (const [k, n] of del) this.queue(rowKey(k, n), { row: [k, n, '', ''], del: true });
    if (!set.length && !del.length && !ren.length) return false;
    this.persist();
    this.schedule();
    return true;
  }

  // Queue a change to a row, with what it's based on (see when_ in Code.gs): the row's version
  // when the sheet last sent it, or, if a change to the row is queued already, whatever that one
  // was based on. A queued change that was sent may have reached the sheet even though we never
  // heard back, so the version it would have left counts too: base and alts list them all.
  queue(id, change, was = this.pending.get(id)) {
    const key = rowKey(change.row[0], change.row[1]);
    const alts = was ? [...(was.alts || []), ...(was.sent && was.st ? [was.st] : [])] : [];
    const away = !change.ren && this.pending.get(`ren:${key}`); // a queued rename takes the row away first
    if (away && !alts.includes(away.st)) alts.push(away.st);
    this.pending.set(id, {
      ...change,
      base: was ? was.base : this.version(key),
      seen: was ? was.seen : this.server.at,
      alts: alts.slice(-MAX_ALTS),
      st: newStamp(),
      seq: ++this.seq,
    });
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
    // Each change ends with what it's based on; scripts older than version 3 ignore it.
    const when = p => ({ base: p.base == null ? undefined : [p.base, ...(p.alts || [])], seen: p.seen, stamp: p.st });
    const body = {
      op: 'patch',
      tab: this.name,
      ren: ordered.filter(p => p.ren).map(p => [...p.ren, when(p)]),
      set: ordered.filter(p => !p.del && !p.ren).map(p => [...p.row, when(p)]),
      del: ordered.filter(p => p.del).map(p => [...p.row.slice(0, 2), when(p)]),
    };
    // From here on these changes may reach the sheet even if we never hear back.
    const sending = () => { for (const p of ordered) p.sent = true; this.persist(); };
    if (beacon) {
      // The page is going away: hand the patch to the browser. It stays pending until a later
      // load confirms it; if it did land, the sheet sees that the retry changes nothing.
      try {
        if (navigator.sendBeacon(this.client.game.api, JSON.stringify({ ...body, key: this.client.game.key || undefined }))) sending();
      } catch { /* ignore */ }
      return;
    }
    if (this.inflight) { this.again = true; return; }
    this.inflight = true;
    clearTimeout(this.timer);
    if (navigator.onLine !== false) sending(); // offline, it can't leave the browser
    try {
      const r = await this.client.request(body);
      this.settle(sent, r);
      this.confirmedAt = Date.now();
      this.persist();
      this.failures = 0;
      this.receive(r, r.at);
      if (r.skipped?.length) this.client.emit({ skipped: { tab: this.name, rows: r.skipped } });
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

  // The sheet answered a patch: the changes it carried are done with, applied or turned down
  // ("skipped"). A row changed again while the patch was on its way is now based on the
  // sheet's new version of it, or dropped if the sheet turned that row down: the newer change
  // was made on top of the refused one.
  settle(sent, r) {
    const skipped = new Set((r.skipped || []).map(x => rowKey(x[0], x[1])));
    const vers = new Map();
    if (Array.isArray(r.vers)) r.rows.forEach((row, i) => { const k = rowKey(row[0], row[1]); if (!vers.has(k)) vers.set(k, r.vers[i]); });
    for (const [id, p] of sent) {
      const cur = this.pending.get(id);
      if (!cur) continue;
      if (cur.seq === p.seq) { this.pending.delete(id); continue; }
      const key = rowKey(cur.row[0], cur.row[1]);
      if (skipped.has(key)) this.pending.delete(id);
      else Object.assign(cur, { base: Array.isArray(r.vers) ? vers.get(key) ?? '' : null, seen: r.at, alts: [] });
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
  // signed in as a character: that character's sheet, and the shared Ship and Lore tabs. (The Map
  // tab, like the GM tab, is the GM's alone; the sheet holds to that too.)
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
        if (t.rows) s.receive(t, r.at); else s.unchanged(r.at);
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
