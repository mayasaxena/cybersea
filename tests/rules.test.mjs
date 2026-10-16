import test from 'node:test';
import assert from 'node:assert/strict';
import { atSession, atSessionStart, luckFloorOf, parseMeta, indexRules, rollFor, atSessionEnd, gainsFrom } from '../assets/rules.js';

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

test('session start: which moves it touches; meta can say so outright', () => {
  assert.ok(atSessionStart('At the start of each session, roll +SPITFIRE.'));
  assert.ok(atSessionStart('When a session begins, …'));
  assert.ok(atSessionStart('at the beginning of the session'));
  assert.ok(!atSessionStart('Mark 1-luck when you end a session Haunted.'));
  const both = 'At the start of each session, roll. Hold 1 until the end of the session.';
  assert.ok(atSession('start', both) && atSession('end', both), 'a hold that lasts the session shows at both');
  assert.ok(atSession('start', 'No wording about it.', { session: 'start' }));
  assert.ok(atSession('end', 'x', { session: 'start,end' }));
  assert.ok(!atSession('start', 'At the start of a session, …', { session: 'no' }));
});

test('session start: once-per-session features, luck from a track, a house luck floor', () => {
  assert.ok(atSessionStart('Once per session, you can call in a favor.'));
  assert.ok(atSessionStart('The first time you sing during a session, it is free.'));
  assert.ok(!atSessionStart('Once you sing, everyone listens.'));
  assert.deepEqual(gainsFrom('At the start of each session, mark luck equal to the tally on your grudge track.'), { luck: 0, xp: 0, luckFrom: 'grudge' });
  assert.equal(luckFloorOf({ meta: { luckfloor: '2' }, text: '' }), 2);
  assert.equal(luckFloorOf({ meta: {}, text: 'House rule: when your spitfire is low, take up to 1 luck when you sit down.' }), 1);
  assert.equal(luckFloorOf({ meta: {}, text: 'Nothing here.' }), 0);
});
