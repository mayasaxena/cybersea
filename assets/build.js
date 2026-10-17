// Starting rows for a new character or ship, built from a playbook and the game's stat, track and
// section rows in the System tab (see system.js). Text (vice, oddity, kit, questions, last words) is
// copied from the Rules tab into the new tab so the player can edit their own copy. A
// kit becomes item rows on the Kit tab.

import { parseStat, formatStat } from './codec.js';
import { kitRows } from './kit.js';
import { systemOf, typeOf, floorOf, trackSize, circles, sum, fillIn, SHIP } from './system.js';

const traitsOf = (rec, n) => {
  const t = String(rec?.meta?.traits || '').split(',').map(parseStat);
  return Array.from({ length: n }, (_, i) => t[i] || 0);
};

// The playbook text a section starts with (fill=…).
function filled(sec, pb, { odd, kitRec }) {
  switch (sec.fill) {
    case 'vices': return pb.vices.map(v => `**${v.name}.** ${v.text}`).join('\n\n');
    case 'oddity': return odd ? `**${odd.name}**${odd.meta.traits ? ` (${odd.meta.traits})` : ''}\n\n${odd.text}` : '';
    case 'kit': return kitRec ? kitRec.text : '';
    case 'specials': return String(pb.meta.specials || '').split(/[|,]/).map(s => s.trim()).filter(Boolean).map(s => `[ ] ${s}`).join('\n');
    case 'questions': return pb.questions.map(q => `${q.name}. ${q.text}`).join('\n\n');
    case 'lastwords': return pb.lastwords ? pb.lastwords.text : '';
    default: return '';
  }
}

function rowsFor(R, sys, pb, { name, player, traitsFrom, odd, kitRec, moves }) {
  const stats = sys.stats.map((k, i) => ({ k, v: traitsOf(traitsFrom, sys.stats.length)[i] }));
  const ctx = { stats, level: 0 };
  const rows = [['info', 'Name', name, ''], ['info', 'Playbook', pb.name, '']];
  if (player != null) rows.push(['info', 'Player', player, ''], ['info', 'Level', '0', '']);
  rows.push(...stats.map(s => ['stat', s.k, formatStat(s.v), '']));
  const wealthRoles = ['treasure', 'hoard'];
  for (const t of sys.tracks) {
    if (wealthRoles.includes(t.role)) continue; // the kit's own (below)
    const n = trackSize(t, { pb, ...ctx });
    const start = t.start ? Math.min(n, Math.max(floorOf(R, t.role), sum(t.start, ctx))) : 0;
    rows.push(['track', t.name, circles(n, start), '']);
  }
  const wealth = sys.tracks.some(t => wealthRoles.includes(t.role)) || sys.section('treasure');
  for (const s of sys.sections) {
    if (s.role === 'treasure') continue;
    const items = s.role === 'kit'; // its card lists the kit's items (below), not its text
    const text = items ? '' : filled(s, pb, { odd, kitRec });
    if (s.fill && !text && !items) continue;
    rows.push([s.tab === 'notes' || s.tab === 'kit' ? s.tab : 'sheet', s.title, text, fillIn(s.note, ctx)]);
  }
  if (wealth || sys.section('kit')) rows.push(...kitRows(sys, kitRec ? kitRec.text : '')); // the kit becomes items on the Kit tab
  for (const m of moves) rows.push(['move', m.name, '●', '']);
  return rows;
}

export function characterRows(R, { name, playbook, player = '', oddity, kit, extraMove }) {
  const pb = R.playbook(playbook);
  if (!pb) throw new Error(`No playbook called ${playbook} in the Rules tab.`);
  const odd = pb.oddities.find(o => o.name === oddity) || pb.oddities[0] || null;
  const kitRec = pb.kits.find(k => k.name === kit) || null;
  const sys = systemOf(R, typeOf(R, playbook));
  return rowsFor(R, sys, pb, { name, player, traitsFrom: odd, odd, kitRec, moves: pb.moves.filter(m => m.meta.start || m.name === extraMove) });
}

export function shipRows(R, { name, playbook, kit, oddity }) {
  const pb = R.playbook(playbook);
  if (!pb) throw new Error(`No ship playbook called ${playbook} in the Rules tab.`);
  const kitRec = pb.kits.find(k => k.name === kit) || pb.kits[0] || null;
  const odd = pb.oddities.find(o => o.name === oddity) || null;
  return rowsFor(R, systemOf(R, SHIP), pb, { name, traitsFrom: kitRec, odd, kitRec, moves: pb.smoves });
}
