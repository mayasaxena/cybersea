// Starting rows for a new character or ship, built from a playbook in the Rules tab.
// Text (vice, oddity, kit, questions, last words) is copied from the Rules tab into the new
// tab so the player can edit their own copy. A character's kit becomes inventory items.

import { parseStat, formatStat, formatTrack } from './codec.js';
import { luckFloorOf } from './rules.js';
import { inventoryRows } from './inventory.js';

const PIRATE_STATS = ['Blood', 'Vinegar', 'Polish', 'Spitfire'];
const SHIP_STATS = ['Steadfast', 'Speed', 'Fortune'];

const traitsOf = (rec, n) => {
  const t = String(rec?.meta?.traits || '').split(',').map(parseStat);
  return Array.from({ length: n }, (_, i) => t[i] || 0);
};
const circles = (n, marked = 0) => formatTrack(Array.from({ length: Math.max(0, n) }, (_, i) => (i < marked ? 1 : 0)));
const list = items => items.map(t => `- ${t}`).join('\n');

export function characterRows(R, { name, playbook, player = '', oddity, kit, extraMove }) {
  const pb = R.playbook(playbook);
  if (!pb) throw new Error(`No playbook called ${playbook} in the Rules tab.`);
  const odd = pb.oddities.find(o => o.name === oddity) || pb.oddities[0] || null;
  const stats = traitsOf(odd, 4);
  const harm = parseInt(pb.meta.harm, 10) || 6;
  const luckLen = parseInt(pb.meta.luck, 10) || 5;
  const floor = Math.max(0, ...R.house('session').map(luckFloorOf));
  const luck = Math.min(luckLen, Math.max(floor, stats[3])); // luck starts at SPITFIRE
  const kitRec = pb.kits.find(k => k.name === kit) || null;

  const rows = [
    ['info', 'Name', name, ''],
    ['info', 'Playbook', pb.name, ''],
    ['info', 'Player', player, ''],
    ['info', 'Level', '0', ''],
    ...PIRATE_STATS.map((k, i) => ['stat', k, formatStat(stats[i]), '']),
    ['track', 'Harm', circles(harm), ''],
    ['track', 'Luck', circles(luckLen, luck), ''],
    ['track', 'Vice', '○', ''],
    ['track', 'Experience', circles(6), ''],
    ['sheet', 'Vice', pb.vices.map(v => `**${v.name}.** ${v.text}`).join('\n\n'), ''],
    ['sheet', 'Oddity', odd ? `**${odd.name}** (${odd.meta.traits || ''})\n\n${odd.text}` : '', ''],
    ['sheet', 'Bonds', '', ''],
    ['sheet', 'Troubles', '', ''],
    ['sheet', 'Experience', '', ''],
  ];
  rows.push(...inventoryRows(kitRec ? kitRec.text : '')); // the kit becomes items on the Inventory tab
  if (pb.questions.length) rows.push(['notes', 'Questions', pb.questions.map(q => `${q.name}. ${q.text}`).join('\n\n'), '']);
  if (pb.lastwords) rows.push(['notes', 'Last Words', pb.lastwords.text, '']);
  for (const m of pb.moves) if (m.meta.start || m.name === extraMove) rows.push(['move', m.name, '●', '']);
  return rows;
}

export function shipRows(R, { name, playbook, kit, oddity }) {
  const pb = R.playbook(playbook);
  if (!pb) throw new Error(`No ship playbook called ${playbook} in the Rules tab.`);
  const kitRec = pb.kits.find(k => k.name === kit) || pb.kits[0] || null;
  const odd = pb.oddities.find(o => o.name === oddity) || null;
  const stats = traitsOf(kitRec, 3);
  const specials = String(pb.meta.specials || '').split(/[|,]/).map(s => s.trim()).filter(Boolean);
  const rows = [
    ['info', 'Name', name, ''],
    ['info', 'Playbook', pb.name, ''],
    ...SHIP_STATS.map((k, i) => ['stat', k, formatStat(stats[i]), '']),
    ['track', 'Wreck', circles(Math.max(1, stats[0] + 3)), ''], // wreck tally is STEADFAST + 3
    ['track', 'Renown', circles(5), ''],
    ['sheet', 'Oddity', odd ? `**${odd.name}**\n\n${odd.text}` : '', ''],
    ['sheet', 'Kit', kitRec ? kitRec.text : '', ''],
    ['sheet', 'Cargo', '', `(${stats[2] + 5} cargo space)`],
    ['sheet', 'Crew', '', `(${stats[2] + 5} crew space)`],
    ['sheet', 'Specials', specials.map(s => `[ ] ${s}`).join('\n'), ''],
  ];
  if (pb.questions.length) rows.push(['notes', 'Questions', pb.questions.map(q => `${q.name}. ${q.text}`).join('\n\n'), '']);
  for (const m of pb.smoves) rows.push(['move', m.name, '●', '']);
  return rows;
}

export const statNames = { pirate: PIRATE_STATS, ship: SHIP_STATS };
export { list };
