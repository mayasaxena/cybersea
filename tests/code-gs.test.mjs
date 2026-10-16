// Unit tests for apps-script/Code.gs, run against tools/gas-fake.mjs.
// Rules text here is made up: real rulebook text never goes in the repo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGas, loadCodeGs } from '../tools/gas-fake.mjs';

const H = ['Kind', 'Name', 'Value', 'Notes'];
const KEYS = { GM_KEY: 'gm-pass' }; // no CREW_KEY: crew need no passphrase

function setup(opts = {}) {
  let t = 1_000_000;
  const gas = createGas({
    name: 'Cybersea',
    props: KEYS,
    now: () => t,
    tabs: {
      Rules: [
        ['Kind', 'Group', 'Name', 'Text', 'Meta', 'Vis'],
        ['move', 'basic', 'POKE', 'When you poke, roll +SNARK.', '', 'crew'],
        ['fate', 'move', 'LOOM', 'A secret for the GM.', '', 'gm'],
      ],
      Nexa: [H,
        ['info', 'Name', 'Nexa', ''],
        ['stat', 'Spitfire', '+2', ''],
        ['track', 'Harm', '●○○✕✕✕', ''],
        ['custom', 'Hand-added', '=1+1', 'a formula someone typed'],
      ],
      Lore: [H, ['place', 'Hacker’s Haven', 'A port.', '']],
      GM: [H, ['secret', 'Twist', 'The demon lies.', '']],
      Ship: [H],
      README: [['Read me']],
      _scratch: [['ignored']],
    },
    ...opts,
  });
  const api = loadCodeGs(gas);
  return { gas, api, tick: ms => { t += ms; } };
}

const crew = (api, body) => api.call({ ...body });
const gm = (api, body) => api.call({ key: 'gm-pass', ...body });

test('ping works without a passphrase, GET otherwise refuses', () => {
  const { api } = setup();
  assert.deepEqual(api.doGet({ parameter: { op: 'ping' } }), { ok: true, v: 1 });
  assert.equal(api.doGet({ parameter: {} }).ok, false);
  assert.deepEqual(api.call({ op: 'ping' }), { ok: true, v: 1 });
});

test('explains missing passphrases', () => {
  const { api } = setup({ props: {} });
  const r = api.call({ op: 'read', key: 'x' });
  assert.equal(r.ok, false);
  assert.match(r.error, /GM_KEY/);
});

test('malformed bodies still come back as JSON errors', () => {
  const { api } = setup();
  const r = api.doPostRaw('{not json');
  assert.equal(r.ok, false);
  assert.ok(r.error);
  assert.equal(crew(api, { op: 'nope' }).ok, false);
});

test('a crew passphrase is optional', () => {
  const { api } = setup({ props: { GM_KEY: 'gm-pass', CREW_KEY: 'crew-pass' } });
  const none = api.call({ op: 'read' });
  assert.equal(none.code, 'auth');
  assert.match(none.error, /needs a passphrase/);
  assert.equal(api.call({ op: 'read', key: 'crew-pass' }).role, 'crew');
  assert.equal(api.call({ op: 'read', key: 'nope' }).code, 'auth');
  assert.equal(gm(api, { op: 'read' }).crewKey, 'crew-pass');
  for (let i = 0; i < 12; i++) api.call({ op: 'read' });
  assert.equal(api.call({ op: 'read', key: 'crew-pass' }).ok, true, 'a missing passphrase isn’t a wrong guess');
});

test('wrong passphrases are refused, then throttled for a minute', () => {
  const { api, tick } = setup();
  for (let i = 0; i < 10; i++) assert.equal(api.call({ op: 'read', key: 'guess' + i }).code, 'auth');
  assert.equal(crew(api, { op: 'read' }).code, 'throttled');
  tick(61_000);
  assert.equal(crew(api, { op: 'read' }).ok, true);
});

test('crew reads everything except the GM tab and GM-only rules', () => {
  const { api } = setup();
  const r = crew(api, { op: 'read', tabs: '*' });
  assert.equal(r.ok, true);
  assert.equal(r.role, 'crew');
  assert.equal(r.game, 'Cybersea');
  assert.deepEqual(r.list.map(t => `${t.name}:${t.kind}`).sort(), ['Lore:lore', 'Nexa:character', 'Rules:rules', 'Ship:ship']);
  assert.equal(r.tabs.GM, undefined);
  assert.deepEqual(r.tabs.Rules.rows.map(x => x[2]), ['POKE']);
  assert.deepEqual(r.tabs.Nexa.rows[1], ['stat', 'Spitfire', '2', '']); // typed by hand into an unformatted cell
});

test('GM reads everything', () => {
  const { api } = setup();
  const r = gm(api, { op: 'read' });
  assert.equal(r.role, 'gm');
  assert.ok(r.tabs.GM);
  assert.deepEqual(r.tabs.Rules.rows.map(x => x[2]), ['POKE', 'LOOM']);
  assert.equal(r.crewKey, '');
  assert.equal(crew(api, { op: 'read' }).crewKey, undefined);
});

test('digests skip unchanged tabs and notice direct sheet edits', () => {
  const { api, gas } = setup();
  const first = crew(api, { op: 'read', tabs: ['Nexa', 'Lore'] });
  assert.deepEqual(Object.keys(first.tabs).sort(), ['Lore', 'Nexa']);
  const have = { Nexa: first.tabs.Nexa.d, Lore: first.tabs.Lore.d };
  const second = crew(api, { op: 'read', tabs: ['Nexa', 'Lore'], have });
  assert.equal(second.tabs.Nexa.rows, undefined);
  assert.equal(second.tabs.Lore.rows, undefined);
  gas.ss.getSheetByName('Lore').getRange(2, 3).setValues([['A busier port.']]);
  const third = crew(api, { op: 'read', tabs: ['Nexa', 'Lore'], have });
  assert.equal(third.tabs.Nexa.rows, undefined);
  assert.equal(third.tabs.Lore.rows[0][2], 'A busier port.');
});

test('patch updates, inserts grouped by kind, deletes, and leaves hand-added rows alone', () => {
  const { api, gas } = setup();
  const r = crew(api, {
    op: 'patch', tab: 'nexa', // tab names are matched case-insensitively
    set: [
      ['track', 'Harm', '●●○✕✕✕', ''],      // update
      ['info', 'Playbook', 'Mountebank', ''], // insert after the last info row
      ['bond', 'Ship', '●●·', ''],            // new kind: appended
    ],
    del: [['STAT', 'spitfire']],              // keys are case-insensitive
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.rows.map(x => `${x[0]}|${x[1]}|${x[2]}`), [
    'info|Name|Nexa',
    'info|Playbook|Mountebank',
    'track|Harm|●●○✕✕✕',
    'custom|Hand-added|#FORMULA =1+1',
    'bond|Ship|●●·',
  ]);
  // the formula typed into the sheet survived (only touched rows are written)
  const sh = gas.ss.getSheetByName('Nexa');
  assert.ok(sh.getRange(5, 3).getDisplayValues()[0][0].startsWith('#FORMULA'));
});

test('renames happen in place, before sets', () => {
  const { api } = setup();
  const r = crew(api, {
    op: 'patch', tab: 'Nexa',
    ren: [['track', 'Harm', 'Wounds'], ['info', 'Nobody', 'X'], ['info', 'Name', 'Name']],
    set: [['track', 'Wounds', '●●○✕✕✕', '']],
  });
  assert.deepEqual(r.rows.map(x => `${x[0]}|${x[1]}|${x[2]}`), [
    'info|Name|Nexa', 'stat|Spitfire|2', 'track|Wounds|●●○✕✕✕', 'custom|Hand-added|#FORMULA =1+1',
  ]);
});

test('patching is idempotent and returns a digest a read agrees with', () => {
  const { api, gas } = setup();
  const body = { op: 'patch', tab: 'Nexa', set: [['bond', 'Demon', '●●·', '']] };
  const a = crew(api, body);
  const edits = gas.ss.edits;
  const b = crew(api, body);
  assert.equal(b.d, a.d);
  assert.equal(gas.ss.edits, edits, 'an unchanged row is not rewritten');
  assert.equal(crew(api, { op: 'read', tabs: ['Nexa'] }).tabs.Nexa.d, a.d);
});

test('values that Sheets would mangle come back exactly as sent', () => {
  const { api } = setup();
  const tricky = ['=1+1', "'tis", '+2', '-1', '007', '1/2', 'TRUE', '- bullet\n  - nested', '●○✕·'];
  const r = crew(api, { op: 'patch', tab: 'Lore', set: tricky.map((v, i) => ['note', 'n' + i, v, v]) });
  const got = r.rows.filter(x => x[0] === 'note');
  assert.deepEqual(got.map(x => x[2]), tricky);
  assert.deepEqual(got.map(x => x[3]), tricky);
});

test('permissions: crew cannot write GM or Rules; GM can write GM but not Rules', () => {
  const { api } = setup();
  assert.equal(crew(api, { op: 'patch', tab: 'GM', set: [['note', 'x', 'y', '']] }).code, 'forbidden');
  assert.equal(crew(api, { op: 'patch', tab: 'Rules', set: [['move', 'x', 'y', '']] }).code, 'forbidden');
  assert.equal(gm(api, { op: 'patch', tab: 'Rules', set: [['move', 'x', 'y', '']] }).code, 'forbidden');
  assert.equal(gm(api, { op: 'patch', tab: 'GM', set: [['note', 'Session 3', 'Ambush at dawn', '']] }).ok, true);
  assert.equal(crew(api, { op: 'patch', tab: 'Nobody', set: [] }).code, 'missing');
  assert.equal(crew(api, { op: 'selftest' }).code, 'forbidden');
});

test('oversize cells are refused', () => {
  const { api } = setup();
  const r = crew(api, { op: 'patch', tab: 'Lore', set: [['note', 'big', 'x'.repeat(50001), '']] });
  assert.equal(r.ok, false);
  assert.match(r.error, /too long/);
});

test('create makes a character tab and validates names', () => {
  const { api, gas } = setup();
  const r = crew(api, { op: 'create', tab: 'Matt', rows: [['info', 'Name', 'Matt', ''], ['stat', 'Blood', '+1', '']] });
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'character');
  assert.deepEqual(r.rows, [['info', 'Name', 'Matt', ''], ['stat', 'Blood', '+1', '']]);
  assert.equal(gas.ss.getSheetByName('Matt').frozen, 1);
  assert.equal(crew(api, { op: 'create', tab: 'matt' }).code, 'exists');
  assert.equal(crew(api, { op: 'create', tab: 'Rules' }).code, 'name');
  assert.equal(crew(api, { op: 'create', tab: 'GM' }).code, 'name');
  assert.equal(crew(api, { op: 'create', tab: '_hidden' }).code, 'name');
  assert.equal(crew(api, { op: 'create', tab: 'a/b' }).code, 'name');
  assert.equal(crew(api, { op: 'create', tab: 'x'.repeat(41) }).code, 'name');
  // later edits to the new tab keep text as text
  const p = crew(api, { op: 'patch', tab: 'Matt', set: [['stat', 'Polish', '-1', '']] });
  assert.deepEqual(p.rows.at(-1), ['stat', 'Polish', '-1', '']);
});

test('selftest reports every probe surviving the round trip', () => {
  const { api, gas } = setup();
  const r = gm(api, { op: 'selftest' });
  assert.equal(r.ok, true, JSON.stringify(r.results?.filter(x => !x.ok)));
  assert.equal(gas.ss.getSheetByName('_selftest'), null);
});
