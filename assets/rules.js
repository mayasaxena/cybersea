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
// "+x", "+bonds spent" and the like are 2d6 plus a number the player picks (ask). A note like
// "take -1 per scar" is a modifier the player counts up before rolling (per); other situational
// bonuses ("if they're right here, take +1") get a free +/- modifier (adj).
const ASKED = [
  [/\brolls? \+\s*bonds? spent\b/i, '+bonds spent', 'Bonds spent'],
  [/\brolls? \+\s*max(?:imum)? bonds?\b/i, '+max bonds', 'Max bonds'],
  [/\brolls? \+\s*(?:your )?black marks?\b/i, '+black marks', 'Black marks'],
  [/\brolls? \+\s*x\b/i, '+X', 'X'],
];
export function rollFor(text, stats) {
  const t = plain(text);
  const per = t.match(/([+\-\u2212]\d+)(?: forward| ongoing)? (?:for each|per|for every) ([a-z][a-z' -]*?)(?=[.,;:)\]^]|$| on | and | you )/i);
  const extra = per ? { per: `${per[1].replace('\u2212', '-')} per ${per[2].trim()}` }
    : /\btake [+\-\u2212]\d|\bbonus to the roll\b/i.test(t) ? { adj: 'Modifier' } : {};
  for (const [re, label, ask] of ASKED) if (re.test(t)) return { label, mod: 0, dice: 2, ask, ...extra };
  const m = t.match(/\brolls? \+([A-Za-z]+)/i);
  if (m) {
    const s = stats.find(x => x.k.toLowerCase() === m[1].toLowerCase());
    return s ? { label: s.k, mod: s.v || 0, dice: 2, stat: true, ...extra } : null;
  }
  if (/\broll blank\b/i.test(t)) return { label: '2d6', mod: 0, dice: 2, ...extra };
  if (/\brolls? 1d6\b/i.test(t)) return { label: '1d6', mod: 0, dice: 1, ...extra };
  return null;
}
