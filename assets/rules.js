// The Rules tab: [Kind, Group, Name, Text, Meta, Vis]. Meta is "key=value" pairs or bare flags,
// e.g. "type=pirate harm=6 luck=8", "traits=0,-1,0,+2", "start", "kind=trait max=3".

import { plain } from './markup.js';

// Values may be quoted to hold spaces: specials="Gun Deck|Rising Star".
export function parseMeta(s) {
  const out = {};
  for (const m of String(s ?? '').matchAll(/([^\s=]+)=(?:"([^"]*)"|(\S*))|(\S+)/g)) {
    if (m[4]) out[m[4].toLowerCase()] = true;
    else out[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : m[3];
  }
  return out;
}

export function indexRules(rows = []) {
  const recs = rows.map(([kind = '', group = '', name = '', text = '', meta = '', vis = ''], i) => ({
    i,
    kind: String(kind).trim().toLowerCase(),
    group: String(group).trim(),
    name: String(name).trim(),
    text: String(text),
    meta: parseMeta(meta),
    vis: String(vis || 'crew').trim().toLowerCase(),
    search: `${name} ${plain(text)}`.toLowerCase(),
  })).filter(r => r.kind);

  const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  const by = (kind, group) => recs.filter(r => r.kind === kind && (group == null || same(r.group, group)));
  const one = (kind, group) => by(kind, group)[0] || null;

  return {
    recs,
    by,
    one,
    empty: recs.length === 0,
    moves: cat => by('move', cat),
    playbooks: type => by('playbook').filter(p => !type || (p.meta.type || 'pirate') === type),
    playbook(name) {
      const of = kind => recs.filter(r => r.kind === kind && same(r.group, name || ''));
      const p = of('playbook')[0];
      if (!p) return null;
      return {
        ...p,
        vices: of('vice'), oddities: of('oddity'), kits: of('kit'), lastwords: of('lastwords')[0] || null,
        questions: of('question'), moves: of('pmove'), smoves: of('smove'), notes: of('pnote'),
        renown: of('renown'), rules: of('rule'),
      };
    },
    procedure: group => one('procedure', group),
    house: group => by('house', group),
    advances: () => by('advance'),
    tags: group => by('tag', group),
    search(q, kinds) {
      const t = String(q).trim().toLowerCase();
      return recs.filter(r => (!kinds || kinds.includes(r.kind)) && (!t || r.search.includes(t)));
    },
  };
}

// Which roll a move asks for: one of these stats, a plain 2d6 ("roll blank"), or 1d6.
export function rollFor(text, stats) {
  const t = plain(text);
  const m = t.match(/\brolls? \+([A-Za-z]+)/);
  if (m) {
    const s = stats.find(x => x.k.toLowerCase() === m[1].toLowerCase());
    return s ? { label: s.k, mod: s.v || 0, dice: 2, stat: true } : null;
  }
  if (/\broll blank\b/i.test(t)) return { label: '2d6', mod: 0, dice: 2 };
  if (/\brolls? 1d6\b/i.test(t)) return { label: '1d6', mod: 0, dice: 1 };
  return null;
}

// Moves and vices that do something when a session ends: "at the end of each session",
// "when you end a session Haunted", "at session's end".
export const atSessionEnd = text =>
  /\b(?:end|close)s?\s+(?:of\s+)?(?:(?:a|the|each|every|this|your)\s+)?session\b|\bsession(?:[’']s)?\s+(?:end|close)s?\b/i.test(plain(text));

// What a move marks that the sheet keeps count of: "mark 1-luck", "mark experience".
export function gainsFrom(text) {
  const t = plain(text);
  const n = what => {
    const m = t.match(new RegExp(`\\b(?:mark|gain|take)s?\\s+(?:(\\d+)[-‐‑–\\s]*|an?\\s+|one\\s+)?${what}\\b`, 'i'));
    return m ? +(m[1] || 1) : 0;
  };
  return { luck: n('luck'), xp: n('(?:experience|xp)') };
}
