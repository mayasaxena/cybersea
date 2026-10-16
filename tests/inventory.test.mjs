import test from 'node:test';
import assert from 'node:assert/strict';
import { splitKit, wealth, wealthOf, setWealth, addTreasure, uniqueName, inventoryRows } from '../assets/inventory.js';
import { parseSheet, serializeSheet } from '../assets/codec.js';
import { indexRules } from '../assets/rules.js';
import { systemOf } from '../assets/system.js';
import { rules, system, RULES_HEADER } from './fixtures/game.mjs';

const sys = systemOf(indexRules(rules, system), 'pirate');
const W = wealthOf(sys);

test('the treasure and hoard tracks come from the Rules tab', () => {
  assert.deepEqual([W.t, W.h, W.per, W.min, W.title, W.note], ['Treasure', 'Hoard', 5, 5, 'Treasure', '(5-treasure = 1-hoard)']);
  const other = wealthOf(systemOf(indexRules([
    ['track', 'spacer', 'Credits', '', 'role=treasure size=10'],
    ['track', 'spacer', 'Stash', '', 'role=hoard size=2'],
  ]), 'spacer'));
  assert.deepEqual([other.t, other.h, other.per, other.min], ['Credits', 'Stash', 10, 2]);
  assert.equal(splitKit('Blaster, 12-credits', other).treasure, 12, 'kits are read in the game’s words');
  assert.ok(RULES_HEADER.length);
});

test('a kit line splits into items and treasure', () => {
  const k = splitKit('A lamp (brass, dented), two maps, and a key, 2-treasure (old coins)', W);
  assert.deepEqual(k.items, ['A lamp (brass, dented)', 'Two maps', 'A key']);
  assert.equal(k.treasure, 2);
  assert.deepEqual(k.notes, ['2-treasure (old coins)']);
  const h = splitKit('A hat, 1-hoard of treasure.', W);
  assert.deepEqual([h.items, h.treasure, h.hoard], [['A hat'], 0, 1]);
});

test('a kit written as a list keeps sub-bullets with their item', () => {
  assert.deepEqual(splitKit('- Dagger\n  - rusty\n- Cloak', W).items, ['Dagger (rusty)', 'Cloak']);
});

test('treasure carries into hoard and borrows back', () => {
  const st = { tracks: {} };
  setWealth(st, W, 4, 0);
  assert.deepEqual(addTreasure(st, W, 1), { treasure: 0, hoard: 1 });
  assert.equal(st.tracks.treasure.pips.join(''), '00000');
  assert.equal(st.tracks.hoard.pips.join(''), '10000');
  assert.deepEqual(addTreasure(st, W, -1), { treasure: 4, hoard: 0 });
  assert.equal(addTreasure(st, W, -5), null, 'not enough');
  assert.deepEqual(wealth(st, W), { treasure: 4, hoard: 0 });
  setWealth(st, W, 0, 5);
  assert.equal(st.tracks.hoard.pips.length, 6, 'hoard pips grow past 5');
});

test('duplicate items get numbered names', () => {
  assert.equal(uniqueName('Rope', ['rope', 'Rope (2)']), 'Rope (3)');
});

test('inventory rows survive parse and serialize', () => {
  const rows = [['info', 'Name', 'Ann', ''], ...inventoryRows(sys, 'Rope, rope, 6-treasure')];
  const st = parseSheet(rows);
  assert.deepEqual(st.items.map(i => i.name), ['Rope', 'Rope (2)']);
  assert.deepEqual(wealth(st, W), { treasure: 1, hoard: 1 });
  assert.equal(st.sections[0].tab, 'inventory');
  assert.equal(st.sections[0].note, '(5-treasure = 1-hoard)');
  assert.deepEqual(serializeSheet(st), rows);
});
