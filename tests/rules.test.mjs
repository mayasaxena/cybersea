import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMeta, indexRules, rollFor } from '../assets/rules.js';
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

test("overrides: the game's wording first, the book's kept as orig", () => {
  const R = indexRules([
    ['playbook', 'Brute', 'Brute', 'Big.', 'type=pirate', 'crew', 'Bruiser', '', ''],
    ['kit', 'Brute', 'Kit 1', 'Club, rope', 'traits=1,0,0', 'crew', '', 'Club, data cable', 'traits=0,1,0'],
    ['pmove', 'Brute', 'SMASH', 'roll +BLOOD', 'start', 'crew', 'CRUSH', 'roll +BLOOD hard', ''],
    ['location', 'places', 'Gull Rock', 'Gulls.', '', 'crew', 'Packet Reef', '', 'img=assets/world/x.jpg'],
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

test('images: site paths and https only', () => {
  assert.equal(imgSrc('assets/world/vega-server.jpg'), 'assets/world/vega-server.jpg');
  assert.equal(imgSrc('https://example.com/a.png'), 'https://example.com/a.png');
  for (const bad of ['javascript:alert(1)', 'http://example.com/a.png', '../secret.jpg', '//evil.com/a.jpg', 'data:image/png;base64,xx', '"onerror=x']) assert.equal(imgSrc(bad), '', bad);
});
