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

test('rolls: +x and +bonds spent ask for a number; "-1 per ..." becomes a counter', () => {
  const stats = [{ k: 'Vinegar', v: -1 }];
  assert.deepEqual(rollFor('Spend any number of bonds and roll +X.', stats), { label: '+X', mod: 0, dice: 2, ask: 'X' });
  assert.deepEqual(rollFor('When you *scarper*, roll **+bonds spent**.', stats), { label: '+bonds spent', mod: 0, dice: 2, ask: 'Bonds spent' });
  assert.equal(rollFor('spend a bond and roll +bond spent', stats).ask, 'Bonds spent');
  assert.equal(rollFor('roll +max bonds', stats).ask, 'Max bonds');
  assert.equal(rollFor('roll +your black marks', stats).ask, 'Black marks');
  assert.equal(rollFor('**roll blank**. If they are right here, take +1.', stats).adj, 'Modifier');
  assert.equal(rollFor('spend x-luck and roll x dice', stats), null);
  assert.deepEqual(rollFor('When you *cheat death*, **roll blank**. ^Take -1 per scar.^', stats), { label: '2d6', mod: 0, dice: 2, per: '-1 per scar' });
  assert.deepEqual(rollFor('Roll +VINEGAR, taking −1 for each black mark on your sheet.', stats),
    { label: 'Vinegar', mod: -1, dice: 2, stat: true, per: '-1 per black mark' });
});
