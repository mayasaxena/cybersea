// The Rules tab: [Kind, Group, Name, Text, Meta, Vis]. Meta is "key=value" pairs or bare flags,
// e.g. "type=pirate harm=6 luck=8", "traits=0,-1,0,+2", "start", "kind=trait max=3".
// Rows may also carry [Override name, Override text, Override meta]: the game's own wording (a
// theme, such as Cybersea's), used instead of the book's, which stays in place as `orig`.
// Override meta adds to the row's meta, key by key; "hide" there drops the row.

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

// Character tabs remember their moves by name, so moves keep the book's names. (A playbook can
// take a new one: playbook() finds it by either.)
const KEEP_NAME = ['move', 'pmove', 'smove'];

export function overridden([kind = '', group = '', name = '', text = '', meta = '', vis = '', oname = '', otext = '', ometa = ''], i = 0) {
  const k = String(kind).trim().toLowerCase();
  const orig = { name: String(name).trim(), text: String(text), meta: parseMeta(meta) };
  const newName = !KEEP_NAME.includes(k) && String(oname).trim();
  const rec = {
    i,
    kind: k,
    group: String(group).trim(),
    name: newName || orig.name,
    text: String(otext).trim() ? String(otext) : orig.text,
    meta: { ...orig.meta, ...parseMeta(ometa) },
    vis: String(vis || 'crew').trim().toLowerCase(),
  };
  rec.themed = rec.name !== orig.name || rec.text !== orig.text || String(ometa).trim() !== '';
  if (rec.themed) rec.orig = orig;
  rec.search = `${rec.name} ${plain(rec.text)}${rec.orig ? ` ${orig.name} ${plain(orig.text)}` : ''}`.toLowerCase();
  return rec;
}

export function indexRules(rows = []) {
  const recs = rows.map((row, i) => overridden(row, i)).filter(r => r.kind && !r.meta.hide);

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
    // By its group (as the book has it), its name, or the book's name if it has an override name.
    playbook(name) {
      const is = r => [r.group, r.name, r.orig?.name].some(n => n != null && same(n, name || ''));
      const p = recs.find(r => r.kind === 'playbook' && same(r.group, name || '')) || recs.find(r => r.kind === 'playbook' && is(r));
      if (!p) return null;
      const of = kind => recs.filter(r => r.kind === kind && same(r.group, p.group));
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

// Moves and vices that do something when a session starts or ends: "at the start of each
// session", "when you end a session Haunted", "at session's end". A row's meta can say so
// outright, when its wording doesn't: session=start, session=end, session=start,end, session=no.
const SESSION_RE = {
  // Once-per-session features come back when a session begins.
  start: /\b(?:start|beginning|begin)s?\s+(?:of\s+)?(?:(?:a|the|each|every|this|your)\s+)?session\b|\bsession(?:[’']s)?\s+(?:start|begin)s?\b|\b(?:once|first\s+time)\b[^.]*?\b(?:per|a|each|every)\s+session\b/i,
  end: /\b(?:end|close)s?\s+(?:of\s+)?(?:(?:a|the|each|every|this|your)\s+)?session\b|\bsession(?:[’']s)?\s+(?:end|close)s?\b/i,
};
export const atSessionStart = text => SESSION_RE.start.test(plain(text));
export const atSessionEnd = text => SESSION_RE.end.test(plain(text));
export function atSession(when, text, meta = {}) {
  if (typeof meta.session === 'string') return meta.session.toLowerCase().split(/[,|]/).map(x => x.trim()).includes(when);
  return SESSION_RE[when].test(plain(text));
}

// What a move marks that the sheet keeps count of: "mark 1-luck", "mark experience", or
// luck equal to what another track has marked ({ luckFrom: 'unrest' }).
export function gainsFrom(text) {
  const t = plain(text);
  const from = t.match(/\bmarks?\s+luck\s+equal\s+to\b[^.]*?\b(\w+)\s+track\b/i);
  const n = what => {
    const m = t.match(new RegExp(`\\b(?:mark|gain|take)s?\\s+(?:(\\d+)[-‐‑–\\s]*|an?\\s+|one\\s+)?${what}\\b(?!\\s+equal)`, 'i'));
    return m ? +(m[1] || 1) : 0;
  };
  return from ? { luck: 0, xp: n('(?:experience|xp)'), luckFrom: from[1].toLowerCase() } : { luck: n('luck'), xp: n('(?:experience|xp)') };
}

// A house rule's luck floor: its meta (luckfloor=1), or "take up to 1 luck" in its text.
export const luckFloorOf = r => parseInt(r.meta.luckfloor, 10) || parseInt((plain(r.text).match(/\btake\s+up\s+to\s+(\d+)[-\s]*luck\b/i) || [])[1], 10) || 0;
