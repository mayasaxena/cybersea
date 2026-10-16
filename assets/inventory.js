// A character's inventory: treasure and hoard as pip tracks, plus a list of items.
// Treasure carries over into hoard as it fills (a full treasure track is 1-hoard), and borrows back from
// it when spent. Starting items come from a kit's text, split into one row per item.

import { formatTrack } from './codec.js';
import { fillIn, sum } from './system.js';

// The game's treasure and hoard tracks (role=treasure, role=hoard): their names, how much
// treasure makes a hoard (the treasure track's size) and the hoard track's starting size.
export function wealthOf(sys) {
  const t = sys.track('treasure');
  const h = sys.track('hoard');
  return {
    t: t?.name || '', h: h?.name || '',
    per: Math.max(1, sum(t?.size)), min: sum(h?.size),
    note: fillIn(sys.section('treasure')?.note || ''),
    title: sys.title('treasure'),
  };
}

const count = pips => (pips || []).filter(v => v === 1).length;
const filled = (n, len) => Array.from({ length: len }, (_, i) => (i < n ? 1 : 0));
const tk = name => String(name).toLowerCase();

// Treasure and hoard as counts, from a sheet state's tracks.
export function wealth(st, w) {
  return { treasure: count(st.tracks[tk(w.t)]?.pips), hoard: count(st.tracks[tk(w.h)]?.pips) };
}

// Write counts back as tracks. A full treasure track carries into hoard; hoard pips grow as needed.
export function setWealth(st, w, treasure, hoard) {
  let t = Math.max(0, treasure | 0);
  let h = Math.max(0, hoard | 0);
  h += Math.floor(t / w.per);
  t %= w.per;
  st.tracks[tk(w.t)] = { name: st.tracks[tk(w.t)]?.name || w.t, pips: filled(t, w.per) };
  st.tracks[tk(w.h)] = { name: st.tracks[tk(w.h)]?.name || w.h, pips: filled(h, Math.max(w.min, h + 1)) };
  return { treasure: t, hoard: h };
}

// Add (or with a negative n, spend) treasure. Spending more than the loose treasure breaks a
// hoard into treasure. Returns null, and changes nothing, when there isn't enough.
export function addTreasure(st, w, n) {
  const { treasure, hoard } = wealth(st, w);
  const total = hoard * w.per + treasure + n;
  if (total < 0) return null;
  return setWealth(st, w, total % w.per, Math.floor(total / w.per));
}

// Split a kit's text into items and its treasure. Takes either a comma-separated line
// ("Dagger (rusty), cloak, 1-treasure") or a "- item" list; sub-bullets join their item in
// parentheses. Commas inside parentheses don't split. "N-<treasure>" and "N-<hoard> (of
// <treasure>)", in the game's words for them, become treasure, with anything after them kept as a note.
const reEsc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function splitKit(text, w = { t: '', h: '' }) {
  const src = String(text || '').trim();
  let parts;
  if (/^\s*- /m.test(src)) {
    parts = [];
    for (const line of src.split('\n')) {
      const m = line.match(/^(\s*)- (.*)$/);
      if (!m) continue;
      if (m[1].length && parts.length) parts[parts.length - 1] += ` (${m[2].trim()})`;
      else parts.push(m[2]);
    }
  } else {
    parts = [];
    let depth = 0;
    let cur = '';
    for (const ch of src.replace(/\s*\n\s*/g, ' ')) {
      if (ch === '(') depth++;
      if (ch === ')') depth = Math.max(0, depth - 1);
      if (ch === ',' && !depth) { parts.push(cur); cur = ''; } else cur += ch;
    }
    parts.push(cur);
  }
  const names = [w.t, w.h].filter(Boolean).map(reEsc).join('|');
  const out = { items: [], treasure: 0, hoard: 0, notes: [] };
  for (let p of parts) {
    p = p.trim().replace(/^and\s+/i, '').replace(/\.$/, '').trim();
    if (!p) continue;
    const m = names && p.match(new RegExp(`^(\\d+)[-\\s]*(${names})(?:\\s+of\\s+${reEsc(w.t || w.h)})?\\b\\s*(.*)$`, 'i'));
    if (m) {
      if (w.h && m[2].toLowerCase() === w.h.toLowerCase()) out.hoard += +m[1]; else out.treasure += +m[1];
      out.notes.push(p);
      continue;
    }
    out.items.push(p.charAt(0).toUpperCase() + p.slice(1));
  }
  return out;
}

// Names are row keys, so two of the same item get " (2)", " (3)"…
export function uniqueName(name, taken) {
  const has = n => taken.some(t => t.toLowerCase() === n.toLowerCase());
  let n = name;
  let k = 2;
  while (has(n)) n = `${name} (${k++})`;
  return n;
}

// Rows for a new inventory from a kit's text: treasure and hoard tracks, their notes card
// (section role=treasure), and one item row per item.
export function inventoryRows(sys, kitText) {
  const w = wealthOf(sys);
  const k = splitKit(kitText, w);
  const st = { tracks: {} };
  const rows = [];
  if (w.t && w.h) {
    setWealth(st, w, k.treasure, k.hoard);
    rows.push(['track', w.t, formatTrack(st.tracks[tk(w.t)].pips), ''], ['track', w.h, formatTrack(st.tracks[tk(w.h)].pips), '']);
  }
  if (w.title) rows.push(['inventory', w.title, k.notes.length ? `- Starting kit: ${k.notes.join(', ')}` : '', w.note]);
  const names = [];
  for (const it of k.items) names.push(uniqueName(it, names));
  return [...rows, ...names.map(n => ['item', n, '', ''])];
}
