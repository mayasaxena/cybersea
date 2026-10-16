import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMeta, indexRules, rollFor, atSessionEnd, gainsFrom } from '../assets/rules.js';

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

test('session end: which moves it touches, and what they mark', () => {
  assert.ok(atSessionEnd('Mark 1-luck when you *end a session* Haunted.'));
  assert.ok(atSessionEnd('At the end of each session, mark experience.'));
  assert.ok(atSessionEnd('When the session ends, …'));
  assert.ok(atSessionEnd('at session’s end'));
  assert.ok(!atSessionEnd('At the start of a session, luck refills.'));
  assert.ok(!atSessionEnd('When the chapter ends. Session over.'));
  assert.deepEqual(gainsFrom('Mark **1-luck** when you end a session Haunted.'), { luck: 1, xp: 0 });
  assert.deepEqual(gainsFrom('At the end of each session, mark experience.'), { luck: 0, xp: 1 });
  assert.deepEqual(gainsFrom('mark 2-xp'), { luck: 0, xp: 2 });
  assert.deepEqual(gainsFrom('take 1-harm, pay 1-luck'), { luck: 0, xp: 0 });
});
