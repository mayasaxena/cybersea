import test from 'node:test';
import assert from 'node:assert/strict';
import { useItem, useOf, usageEntry, signed } from '../assets/usage.js';

test('using an item takes at least one and no more than it has', () => {
  assert.deepEqual(useItem({ count: 3 }, 1), { used: 1, left: 2 });
  assert.deepEqual(useItem({ count: 3 }, 9), { used: 3, left: 0 });
  assert.deepEqual(useItem({ count: 3 }, 0), { used: 1, left: 2 });
  assert.deepEqual(useItem({ count: null }, 1), { used: 0, left: null });
});

test('one change is the log entry’s title; several go under Changes', () => {
  assert.deepEqual(usageEntry(['Harm +1'], 'ow'), { title: 'Harm +1', items: [], note: 'ow' });
  assert.deepEqual(usageEntry(['Harm +1', 'Luck −2']), { title: 'Changes', items: ['Harm +1', 'Luck −2'], note: '' });
  assert.equal(signed(2), '+2');
  assert.equal(signed(-1), '−1');
});

test('a use’s log entry tells what undoing it gives back', () => {
  const items = [{ name: 'Medkit', count: 0 }, { name: 'Rope', count: null }];
  assert.equal(useOf({ title: 'Medkit', items: ['Used 2, 0 left'] }, items).n, 2);
  assert.equal(useOf({ title: 'Rope', items: ['Used'] }, items).n, 0);
  assert.equal(useOf({ title: 'Gone', items: ['Used 1, 0 left'] }, items), null, 'the item was removed');
  assert.equal(useOf({ title: 'Medkit', items: ['Harm +1'] }, items), null, 'not a use');
});
