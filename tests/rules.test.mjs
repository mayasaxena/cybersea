import test from 'node:test';
import assert from 'node:assert/strict';
import { atSession, atSessionStart, luckFloorOf, parseMeta, indexRules, rollFor, atSessionEnd, gainsFrom } from '../assets/rules.js';
import { imgSrc } from '../assets/markup.js';

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

test("overrides: the game's wording first, the book's kept as orig", () => {
  const R = indexRules([
    ['playbook', 'Brute', 'Brute', 'Big.', 'type=pirate', 'crew', 'Bruiser', '', ''],
    ['kit', 'Brute', 'Kit 1', 'Club, rope', 'traits=1,0,0', 'crew', '', 'Club, data cable', 'traits=0,1,0'],
    ['pmove', 'Brute', 'SMASH', 'roll +BLOOD', 'start', 'crew', 'CRUSH', 'roll +BLOOD hard', ''],
    ['location', 'places', 'Gull Rock', 'Gulls.', '', 'crew', 'Packet Reef', '', 'img=https://example.com/x.jpg'],
    ['location', 'places', 'Old Mill', 'A mill.', '', 'crew', '', '', 'hide'],
    ['move', 'basic', 'POKE', 'roll +VINEGAR', '', 'crew'],
  ]);
  const kit = R.by('kit')[0];
  assert.equal(kit.text, 'Club, data cable');
  assert.equal(kit.orig.text, 'Club, rope');
  assert.equal(kit.meta.traits, '0,1,0', 'override meta adds to the book\'s, key by key');
  const loc = R.by('location');
  assert.deepEqual(loc.map(l => l.name), ['Packet Reef'], 'renamed, and "hide" drops a row');
  assert.equal(loc[0].text, 'Gulls.', 'no override text: the book\'s');
  assert.ok(R.search('gull rock').length, 'the book\'s name still finds it');
  assert.equal(R.by('move')[0].orig, undefined, 'no overrides: nothing kept');
  assert.equal(R.playbook('Bruiser').name, 'Bruiser');
  assert.equal(R.playbook('Brute').name, 'Bruiser', 'sheets made before the rename still find it');
  assert.equal(R.playbook('Bruiser').kits[0].text, 'Club, data cable');
  const smash = R.playbook('Brute').moves[0];
  assert.equal(smash.name, 'SMASH', 'moves keep the book\'s name: sheets remember them by it');
  assert.equal(smash.text, 'roll +BLOOD hard');
});

test('images: https only; the site holds no art of its own', () => {
  assert.equal(imgSrc('https://example.com/a.png'), 'https://example.com/a.png');
  for (const bad of ['assets/world/vega-server.jpg', 'javascript:alert(1)', 'http://example.com/a.png', '../secret.jpg', '//evil.com/a.jpg', 'data:image/png;base64,xx', '"onerror=x']) assert.equal(imgSrc(bad), '', bad);
});

test("images: the Image cell (a placed picture, or an =IMAGE() address) wins over Meta's img=", () => {
  const R = indexRules([
    ['map', 'World', 'Placed', '', 'img=https://example.com/old.png', 'crew', '', '', '', 'row:7'],
    ['map', 'World', 'Formula', '', '', 'crew', '', '', '', 'https://example.com/f.png'],
    ['map', 'World', 'Meta only', '', 'img=https://example.com/m.png', 'crew'],
  ]);
  const [placed, formula, meta] = R.by('map');
  assert.equal(placed.imageRow, 7);
  assert.equal(formula.meta.img, 'https://example.com/f.png');
  assert.equal(formula.imageRow, undefined);
  assert.equal(meta.meta.img, 'https://example.com/m.png');
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
