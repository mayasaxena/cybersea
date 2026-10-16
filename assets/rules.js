// The Rules tab: [Kind, Group, Name, Text, Meta, Vis]. Meta is "key=value" pairs or bare flags,
// e.g. "type=pirate harm=6 luck=8", "traits=0,-1,0,+2", "start", "kind=trait max=3", "roll=Blood".
// What the site does with them (stats, tracks, rolls, actions) is in system.js.
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

// A game's Rules and System tabs, indexed: every page reads both.
export const TABS = ['Rules', 'System'];
export const gameRules = client => indexRules(client.tab('Rules').rows, client.tab('System').rows);

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

// system: the System tab's rows (Kind | Group | Name | Text | Meta), the game's mechanics; they
// join the Rules tab's rows, seen by everyone.
export function indexRules(rows = [], system = []) {
  const all = [...rows, ...system.map(([k = '', g = '', n = '', t = '', m = '']) => [k, g, n, t, m, 'crew'])];
  const recs = all.map((row, i) => overridden(row, i)).filter(r => r.kind && !r.meta.hide);

  const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  const by = (kind, group) => recs.filter(r => r.kind === kind && (group == null || same(r.group, group)));
  const one = (kind, group) => by(kind, group)[0] || null;

  return {
    recs,
    by,
    one,
    empty: recs.length === 0,
    moves: cat => by('move', cat),
    // A type's playbooks; without one, every playbook. (See system.js for types.)
    playbooks: type => by('playbook').filter(p => !type || same(p.meta.type || '', type)),
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
