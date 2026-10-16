// A character's inventory: treasure and hoard as pip tracks, plus a list of items.
// Treasure carries over into hoard as it fills (5-treasure is 1-hoard), and borrows back from
// it when spent. Starting items come from a kit's text, split into one row per item.

import { formatTrack } from './codec.js';

export const TREASURE_PER_HOARD = 5;
const MIN_HOARD_PIPS = 5;

const count = pips => (pips || []).filter(v => v === 1).length;
const filled = (n, len) => Array.from({ length: len }, (_, i) => (i < n ? 1 : 0));

// Treasure and hoard as counts, from a sheet state's tracks.
export function wealth(st) {
  return { treasure: count(st.tracks.treasure?.pips), hoard: count(st.tracks.hoard?.pips) };
}

// Write counts back as tracks. Treasure over 4 carries into hoard; hoard pips grow as needed.
export function setWealth(st, treasure, hoard) {
  let t = Math.max(0, treasure | 0);
  let h = Math.max(0, hoard | 0);
  h += Math.floor(t / TREASURE_PER_HOARD);
  t %= TREASURE_PER_HOARD;
  st.tracks.treasure = { name: st.tracks.treasure?.name || 'Treasure', pips: filled(t, TREASURE_PER_HOARD) };
  st.tracks.hoard = { name: st.tracks.hoard?.name || 'Hoard', pips: filled(h, Math.max(MIN_HOARD_PIPS, h + 1)) };
  return { treasure: t, hoard: h };
}

// Add (or with a negative n, spend) treasure. Spending more than the loose treasure breaks a
// hoard into treasure. Returns null, and changes nothing, when there isn't enough.
export function addTreasure(st, n) {
  const { treasure, hoard } = wealth(st);
  const total = hoard * TREASURE_PER_HOARD + treasure + n;
  if (total < 0) return null;
  return setWealth(st, total % TREASURE_PER_HOARD, Math.floor(total / TREASURE_PER_HOARD));
}

// Split a kit's text into items and its treasure. Takes either a comma-separated line
// ("Dagger (rusty), cloak, 1-treasure") or a "- item" list; sub-bullets join their item in
// parentheses. Commas inside parentheses don't split. "N-treasure" and "N-hoard (of treasure)"
// become treasure, with anything after them kept as a note.
export function splitKit(text) {
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
  const out = { items: [], treasure: 0, hoard: 0, notes: [] };
  for (let p of parts) {
    p = p.trim().replace(/^and\s+/i, '').replace(/\.$/, '').trim();
    if (!p) continue;
    const m = p.match(/^(\d+)[-\s]*(treasure|hoard)(?:\s+of\s+treasure)?\b\s*(.*)$/i);
    if (m) {
      if (m[2].toLowerCase() === 'hoard') out.hoard += +m[1]; else out.treasure += +m[1];
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

// Rows for a new inventory from a kit's text: treasure and hoard tracks, a Treasure notes card,
// and one item row per item.
export function inventoryRows(kitText) {
  const k = splitKit(kitText);
  const st = { tracks: {} };
  setWealth(st, k.treasure, k.hoard);
  const names = [];
  for (const it of k.items) names.push(uniqueName(it, names));
  return [
    ['track', 'Treasure', formatTrack(st.tracks.treasure.pips), ''],
    ['track', 'Hoard', formatTrack(st.tracks.hoard.pips), ''],
    ['inventory', 'Treasure', k.notes.length ? `- Starting kit: ${k.notes.join(', ')}` : '', `(${TREASURE_PER_HOARD}-treasure = 1-hoard)`],
    ...names.map(n => ['item', n, '', '']),
  ];
}
