import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMeta, indexRules, rollFor } from '../assets/rules.js';

test('meta: pairs, flags and quoted values', () => {
  assert.deepEqual(parseMeta('type=pirate harm=6 luck=8 pick=1'), { type: 'pirate', harm: '6', luck: '8', pick: '1' });
  assert.deepEqual(parseMeta('start'), { start: true });
  assert.deepEqual(parseMeta('type=ship specials="Gun Deck|Rising Star" x=1'), { type: 'ship', specials: 'Gun Deck|Rising Star', x: '1' });
  assert.deepEqual(parseMeta('traits=0,-1,0,+2'), { traits: '0,-1,0,+2' });
  assert.deepEqual(parseMeta(''), {});
});

test('playbooks gather their parts by group', () => {
  const R = indexRules([
    ['playbook', 'Brute', 'Brute', 'Big.', 'type=pirate harm=8 luck=5', 'crew'],
    ['pmove', 'brute', 'SMASH', 'roll +BLOOD', 'start=1', 'crew'],
    ['oddity', 'Brute', 'IRON', 'x', 'traits=+2,0,-1,0', 'crew'],
    ['move', 'basic', 'POKE', 'roll +VINEGAR', '', 'crew'],
  ]);
  const pb = R.playbook('BRUTE');
  assert.equal(pb.moves[0].name, 'SMASH');
  assert.ok(pb.moves[0].meta.start);
  assert.equal(pb.oddities[0].meta.traits, '+2,0,-1,0');
  assert.equal(R.playbooks('pirate').length, 1);
  assert.equal(R.moves('basic').length, 1);
});

test('rolls: a stat on this sheet, roll blank, 1d6', () => {
  const stats = [{ k: 'Vinegar', v: -1 }];
  assert.deepEqual(rollFor('When you look, roll +VINEGAR.', stats), { label: 'Vinegar', mod: -1, dice: 2, stat: true });
  assert.equal(rollFor('roll +STEADFAST', stats), null);
  assert.deepEqual(rollFor('**roll blank**', stats), { label: '2d6', mod: 0, dice: 2 });
  assert.deepEqual(rollFor('one of the crew rolls **1d6**', stats), { label: '1d6', mod: 0, dice: 1 });
});
