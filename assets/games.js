// Which games this browser knows, and how to join one.
// A game is one spreadsheet's deployed script: {id, name, api, key, role}.
// Invite links carry it in the URL fragment (#join=…), which never reaches any server.

import { CONFIG } from '../config.js';

const REG = 'cybersea:games';
const LAST = 'cybersea:last';

export const ls = {
  get(k, fallback = null) { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
};

// Short stable id from the API URL (FNV-1a).
export function gameId(api) {
  let h = 0x811c9dc5;
  for (const c of String(api)) { h ^= c.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

const b64url = s => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)));

export const encodeInvite = ({ api, key, name }) => b64url(JSON.stringify({ api, key, name }));
export function decodeInvite(s) {
  try {
    const o = JSON.parse(unb64url(String(s).trim()));
    return o && typeof o.api === 'string' && /^https?:\/\//.test(o.api) ? o : null;
  } catch { return null; }
}
// Accepts a full invite URL or just the code after #join=.
export const inviteFromText = text => decodeInvite(String(text).includes('#join=') ? String(text).split('#join=')[1].split(/[&\s]/)[0] : text);
export const inviteUrl = (game, key = game.key) => `${location.origin}${location.pathname.replace(/[^/]*$/, '')}#join=${encodeInvite({ api: game.api, key, name: game.name })}`;

export const listGames = () => ls.get(REG, []);
const saveGames = list => ls.set(REG, list);

export function upsertGame(g) {
  const list = listGames();
  const id = gameId(g.api);
  const i = list.findIndex(x => x.id === id);
  const merged = { ...(i >= 0 ? list[i] : {}), ...g, id };
  if (i >= 0) list[i] = merged; else list.push(merged);
  saveGames(list);
  return merged;
}

export function forgetGame(id) {
  saveGames(listGames().filter(g => g.id !== id));
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(`cybersea:${id}:`)) localStorage.removeItem(k);
    }
  } catch { /* storage unavailable */ }
  if (ls.get(LAST) === id) ls.del(LAST);
}

// Per-game storage key.
export const gkey = (game, suffix) => `cybersea:${game.id}:${suffix}`;

// Read #join= / #k= from the URL, register the game, tidy the URL, and return the current game.
export function bootstrap() {
  const url = new URL(location.href);
  const hash = new URLSearchParams(url.hash.slice(1));
  let joined = null;
  if (hash.has('join')) {
    const inv = decodeInvite(hash.get('join'));
    if (inv) joined = upsertGame({ api: inv.api, key: inv.key, name: inv.name || 'Game' });
  }
  if (CONFIG.defaultGame && CONFIG.defaultGame.api && !listGames().some(g => g.id === gameId(CONFIG.defaultGame.api))) {
    upsertGame({ api: CONFIG.defaultGame.api, name: CONFIG.defaultGame.name || 'Game', key: '' });
  }
  const list = listGames();
  const wanted = url.searchParams.get('g');
  let game = joined || list.find(g => g.id === wanted) || list.find(g => g.id === ls.get(LAST)) || (list.length === 1 ? list[0] : null);
  if (game && hash.has('k')) game = upsertGame({ ...game, key: hash.get('k') });
  if (hash.has('join') || hash.has('k') || (game && url.searchParams.get('g') !== game.id)) {
    if (game) url.searchParams.set('g', game.id);
    hash.delete('join');
    hash.delete('k');
    url.hash = hash.toString();
    history.replaceState(null, '', url.toString().replace(/#$/, ''));
  }
  if (game) ls.set(LAST, game.id);
  return game;
}

// Link to another page of the site for the same game.
export function href(page, game, params = {}) {
  const u = new URL(page, location.href);
  if (game) u.searchParams.set('g', game.id);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.pathname.split('/').pop() + u.search;
}
