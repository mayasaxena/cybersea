import test from 'node:test';
import assert from 'node:assert/strict';
import { useItem, usageEntry, signed } from '../assets/usage.js';

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
