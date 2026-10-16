import test from 'node:test';
import assert from 'node:assert/strict';
import { splitKit, wealth, setWealth, addTreasure, uniqueName, inventoryRows } from '../assets/inventory.js';
import { parseSheet, serializeSheet } from '../assets/codec.js';

test('a kit line splits into items and treasure', () => {
  const k = splitKit('A lamp (brass, dented), two maps, and a key, 2-treasure (old coins)');
  assert.deepEqual(k.items, ['A lamp (brass, dented)', 'Two maps', 'A key']);
  assert.equal(k.treasure, 2);
  assert.deepEqual(k.notes, ['2-treasure (old coins)']);
  const h = splitKit('A hat, 1-hoard of treasure.');
  assert.deepEqual([h.items, h.treasure, h.hoard], [['A hat'], 0, 1]);
});

test('a kit written as a list keeps sub-bullets with their item', () => {
  assert.deepEqual(splitKit('- Dagger\n  - rusty\n- Cloak').items, ['Dagger (rusty)', 'Cloak']);
});

test('treasure carries into hoard and borrows back', () => {
  const st = { tracks: {} };
  setWealth(st, 4, 0);
  assert.deepEqual(addTreasure(st, 1), { treasure: 0, hoard: 1 });
  assert.equal(st.tracks.treasure.pips.join(''), '00000');
  assert.equal(st.tracks.hoard.pips.join(''), '10000');
  assert.deepEqual(addTreasure(st, -1), { treasure: 4, hoard: 0 });
  assert.equal(addTreasure(st, -5), null, 'not enough');
  assert.deepEqual(wealth(st), { treasure: 4, hoard: 0 });
  setWealth(st, 0, 5);
  assert.equal(st.tracks.hoard.pips.length, 6, 'hoard pips grow past 5');
});

test('duplicate items get numbered names', () => {
  assert.equal(uniqueName('Rope', ['rope', 'Rope (2)']), 'Rope (3)');
});

test('inventory rows survive parse and serialize', () => {
  const rows = [['info', 'Name', 'Ann', ''], ...inventoryRows('Rope, rope, 6-treasure')];
  const st = parseSheet(rows);
  assert.deepEqual(st.items.map(i => i.name), ['Rope', 'Rope (2)']);
  assert.deepEqual(wealth(st), { treasure: 1, hoard: 1 });
  assert.equal(st.sections[0].tab, 'inventory');
  assert.deepEqual(serializeSheet(st), rows);
});
