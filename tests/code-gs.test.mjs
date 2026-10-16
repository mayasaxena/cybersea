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
const row = (rows, kind, name) => rows.find(r => r[0] === kind && r[1] === name);

// A tab as a page would have it: rows, versions, and when the sheet read them.
function look(api, name, who = crew) {
  const r = who(api, { op: 'read', tabs: [name] });
  const t = r.tabs[name];
  return { ...t, at: r.at, ver: (kind, n) => { const i = t.rows.findIndex(x => x[0] === kind && x[1] === n); return i < 0 ? '' : t.vers[i]; } };
}

// What a change is based on, as the site sends it (see when_ in Code.gs).
let stamps = 0;
const newStamp = () => `stamp${String(++stamps).padStart(4, '0')}`;
const on = (base, seen, stamp = newStamp()) => ({ base, seen, stamp });

// Type into a row as someone would in Sheets; Sheets then runs onEdit (unless trigger is false,
// standing in for a change that bypasses it).
function byHand(gas, api, tab, rowNum, cells, { trigger = true } = {}) {
  const range = gas.ss.getSheetByName(tab).getRange(rowNum, 1, 1, cells.length);
  range.setValues([cells]);
  if (trigger) api.onEdit({ range });
}

test('ping works without a passphrase, GET otherwise refuses', () => {
  const { api } = setup();
  assert.deepEqual(api.doGet({ parameter: { op: 'ping' } }), { ok: true, v: 4 });
  assert.equal(api.doGet({ parameter: {} }).ok, false);
  assert.deepEqual(api.call({ op: 'ping' }), { ok: true, v: 4 });
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

test('Rules rows carry the override columns, found by their headers, when the tab has them', () => {
  const plain = setup();
  assert.equal(crew(plain.api, { op: 'read', tabs: ['Rules'] }).tabs.Rules.rows[0].length, 6, 'no override columns: rows as before');
  const { api } = setup({
    tabs: {
      Rules: [
        ['Kind', 'Group', 'Name', 'Text', 'Meta', 'Vis', 'Notes to self', 'Override text', 'Override name'],
        ['kit', 'Brute', 'Kit 1', 'Club, rope', '', 'crew', 'ignore me', 'Club, data cable', ''],
        ['location', 'places', 'Gull Rock', 'Gulls.', '', 'crew', '', '', 'Packet Reef'],
      ],
    },
  });
  const rows = crew(api, { op: 'read', tabs: ['Rules'] }).tabs.Rules.rows;
  assert.deepEqual(rows[0], ['kit', 'Brute', 'Kit 1', 'Club, rope', '', 'crew', '', 'Club, data cable', '']);
  assert.deepEqual(rows[1], ['location', 'places', 'Gull Rock', 'Gulls.', '', 'crew', 'Packet Reef', '', '']);
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

/* ---------- row versions ---------- */

test('every row has a version, kept in a hidden plain-text column', () => {
  const { api, gas } = setup();
  const a = look(api, 'Nexa');
  assert.equal(a.vers.length, a.rows.length);
  assert.ok(a.vers.every(v => v.startsWith('~')), 'rows never written by the site go by their contents');
  assert.equal(crew(api, { op: 'read', tabs: ['Rules'] }).tabs.Rules.vers, undefined);
  const again = look(api, 'Nexa');
  assert.deepEqual([again.d, again.vers], [a.d, a.vers]);

  const r = crew(api, { op: 'patch', tab: 'Nexa', set: [['track', 'Harm', '●●○✕✕✕', '', on([a.ver('track', 'Harm')], a.at)]] });
  assert.deepEqual(r.skipped, []);
  const b = look(api, 'Nexa');
  assert.deepEqual(b.rows, r.rows);
  assert.deepEqual(b.vers, r.vers);
  assert.match(b.ver('track', 'Harm'), /^stamp\d+$/, 'the row has the change’s stamp');
  assert.deepEqual(b.vers.filter((v, i) => i !== 2), a.vers.filter((v, i) => i !== 2), 'other rows keep theirs');

  const sh = gas.ss.getSheetByName('Nexa');
  assert.equal(sh.getRange(1, 5).getDisplayValues()[0][0], 'Version');
  assert.ok(sh.isColumnHiddenByUser(5));
  assert.equal(sh.cell(4, 5).fmt, '@');
  assert.equal(sh.cell(40, 5).fmt, '@', 'the whole column is plain text');
});

test('a change to a row that changed since is skipped, even if it has changed back', () => {
  const { api } = setup();
  const a = look(api, 'Nexa');
  // someone else changes Harm, then puts it back
  for (const v of ['●●●✕✕✕', '●○○✕✕✕']) {
    const b = look(api, 'Nexa');
    assert.deepEqual(crew(api, { op: 'patch', tab: 'Nexa', set: [['track', 'Harm', v, '', on([b.ver('track', 'Harm')], b.at)]] }).skipped, []);
  }
  const r = crew(api, {
    op: 'patch', tab: 'Nexa', set: [
      ['track', 'Harm', '○○○✕✕✕', '', on([a.ver('track', 'Harm')], a.at)],
      ['stat', 'Spitfire', '+3', '', on([a.ver('stat', 'Spitfire')], a.at)],
    ],
  });
  assert.deepEqual(r.skipped, [['track', 'Harm']]);
  assert.equal(row(r.rows, 'track', 'Harm')[2], '●○○✕✕✕', 'the answer has the sheet’s row to show instead');
  assert.equal(row(r.rows, 'stat', 'Spitfire')[2], '+3', 'rows that didn’t change since still save');
});

test('edits made in Sheets count, with or without onEdit', () => {
  const { api, gas } = setup();
  const a = look(api, 'Nexa');
  const harmTo = (v, base) => crew(api, { op: 'patch', tab: 'Nexa', set: [['track', 'Harm', v, '', on([base], a.at)]] });
  // typed over and back by hand: onEdit stamps it each time
  byHand(gas, api, 'Nexa', 4, ['track', 'Harm', '●●●●●●']);
  byHand(gas, api, 'Nexa', 4, ['track', 'Harm', '●○○✕✕✕']);
  const b = look(api, 'Nexa');
  assert.notEqual(b.ver('track', 'Harm'), a.ver('track', 'Harm'));
  assert.notEqual(b.d, a.d, 'a new version alone is news to readers');
  assert.deepEqual(harmTo('○○○✕✕✕', a.ver('track', 'Harm')).skipped, [['track', 'Harm']]);

  // changed some way that skips onEdit: the row's hash no longer matches its stamp
  byHand(gas, api, 'Nexa', 4, ['track', 'Harm', '●●○✕✕✕'], { trigger: false });
  const c = look(api, 'Nexa');
  assert.match(c.ver('track', 'Harm'), /^~/);
  assert.deepEqual(harmTo('○○○✕✕✕', b.ver('track', 'Harm')).skipped, [['track', 'Harm']]);
  assert.deepEqual(harmTo('○○○✕✕✕', c.ver('track', 'Harm')).skipped, []);
});

test('onEdit leaves alone what the site doesn’t edit', () => {
  const { api, gas } = setup();
  const a = look(api, 'Nexa');
  for (const [tab, r, c] of [['Rules', 2, 1], ['README', 1, 1], ['_scratch', 1, 1], ['Nexa', 1, 1], ['Nexa', 4, 6]]) {
    api.onEdit({ range: gas.ss.getSheetByName(tab).getRange(r, c) });
  }
  assert.deepEqual(look(api, 'Nexa').vers, a.vers);
  assert.equal(gas.ss.getSheetByName('Rules').getLastColumn(), 6, 'no Version column on Rules');
  assert.equal(gas.ss.getSheetByName('README').getLastColumn(), 1);
});

test('a change sent again after it landed goes through quietly, and so does one made on top of it', () => {
  const { api, gas } = setup();
  const a = look(api, 'Nexa');
  const v0 = a.ver('track', 'Harm');
  const first = ['track', 'Harm', '●●○✕✕✕', '', on([v0], a.at, 'stamp1001')];
  assert.deepEqual(crew(api, { op: 'patch', tab: 'Nexa', set: [first] }).skipped, []);
  const edits = gas.ss.edits;
  assert.deepEqual(crew(api, { op: 'patch', tab: 'Nexa', set: [first] }).skipped, [], 'the page never heard back, so it sends it again');
  assert.equal(gas.ss.edits, edits, 'nothing to write');
  // a newer change, made before hearing back: based on the old version, or on what the first left
  const second = ['track', 'Harm', '●●●✕✕✕', '', on([v0, 'stamp1001'], a.at, 'stamp1002')];
  assert.deepEqual(crew(api, { op: 'patch', tab: 'Nexa', set: [second] }).skipped, []);
  assert.deepEqual(crew(api, { op: 'patch', tab: 'Nexa', set: [first] }).skipped, [['track', 'Harm']], 'but not the first again');
  assert.equal(row(look(api, 'Nexa').rows, 'track', 'Harm')[2], '●●●✕✕✕');
});

test('changes sent without versions (pages from before version 3) go ahead as before', () => {
  const { api } = setup();
  const a = look(api, 'Nexa');
  crew(api, { op: 'patch', tab: 'Nexa', set: [['track', 'Harm', '●●●✕✕✕', '', on([a.ver('track', 'Harm')], a.at)]] });
  const r = crew(api, { op: 'patch', tab: 'Nexa', ren: [['stat', 'Spitfire', 'Fire']], set: [['track', 'Harm', '○○○✕✕✕', ''], ['stat', 'Fire', '2', '']], del: [['info', 'Name']] });
  assert.deepEqual(r.skipped, []);
  assert.deepEqual(r.rows.map(x => `${x[0]}|${x[1]}|${x[2]}`), ['stat|Fire|2', 'track|Harm|○○○✕✕✕', 'custom|Hand-added|#FORMULA =1+1']);
  assert.match(look(api, 'Nexa').ver('track', 'Harm'), /^[a-z0-9]+$/, 'stamped all the same');
});

test('deletes: a stale change neither brings a row back nor deletes a newer one', () => {
  const { api } = setup();
  const a = look(api, 'Nexa');
  const at = (kind, name) => on([a.ver(kind, name)], a.at);
  let b = look(api, 'Nexa');
  crew(api, { op: 'patch', tab: 'Nexa', del: [['track', 'Harm', on([b.ver('track', 'Harm')], b.at)]], set: [['stat', 'Spitfire', '+3', '', on([b.ver('stat', 'Spitfire')], b.at)]] });
  const r = crew(api, { op: 'patch', tab: 'Nexa', set: [['track', 'Harm', '●●●✕✕✕', '', at('track', 'Harm')]], del: [['stat', 'Spitfire', at('stat', 'Spitfire')], ['track', 'Harm', at('track', 'Harm')]] });
  assert.deepEqual(r.skipped, [['stat', 'Spitfire'], ['track', 'Harm']], 'deleting what’s gone already is no change');
  assert.equal(row(r.rows, 'track', 'Harm'), undefined);
  assert.equal(row(r.rows, 'stat', 'Spitfire')[2], '+3');
  // the page's own delete, unconfirmed, then the row added back: based on either
  b = look(api, 'Nexa');
  const del = on([b.ver('stat', 'Spitfire')], b.at);
  crew(api, { op: 'patch', tab: 'Nexa', del: [['stat', 'Spitfire', del]] });
  const back = crew(api, { op: 'patch', tab: 'Nexa', set: [['stat', 'Spitfire', '+1', '', on([b.ver('stat', 'Spitfire'), del.stamp], b.at)]] });
  assert.deepEqual(back.skipped, []);
  assert.equal(row(back.rows, 'stat', 'Spitfire')[2], '+1');
});

test('a row taken away stays away: a stale change doesn’t bring it back', () => {
  const { api, gas, tick } = setup();
  // signing in adds the row; the page doesn't hear back, so it will send it again
  const a = look(api, 'Nexa');
  const signIn = ['signin', 'Signed in', 'yes', '', on([a.ver('signin', 'Signed in')], a.at)];
  assert.equal(signIn[4].base[0], '', 'no such row yet');
  crew(api, { op: 'patch', tab: 'Nexa', set: [signIn] });
  // the GM signs Nexa out by clearing the row in Sheets
  tick(1000);
  const sh = gas.ss.getSheetByName('Nexa');
  const at = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getDisplayValues().findIndex(r => r[0] === 'signin') + 2;
  byHand(gas, api, 'Nexa', at, ['', '', '', '']);
  tick(1000);
  assert.deepEqual(crew(api, { op: 'patch', tab: 'Nexa', set: [signIn] }).skipped, [['signin', 'Signed in']]);
  assert.equal(row(look(api, 'Nexa').rows, 'signin', 'Signed in'), undefined);
  // a page that has seen it gone can sign in again
  tick(1000);
  const b = look(api, 'Nexa');
  assert.deepEqual(crew(api, { op: 'patch', tab: 'Nexa', set: [['signin', 'Signed in', 'yes', '', on([b.ver('signin', 'Signed in')], b.at)]] }).skipped, []);

  // the same when the row is deleted from the site, or typed over in Sheets
  const lore = look(api, 'Lore');
  const rumor = ['rumor', 'The Bell', 'rings', '', on([''], lore.at)];
  crew(api, { op: 'patch', tab: 'Lore', set: [rumor] });
  tick(1000);
  const c = look(api, 'Lore');
  crew(api, { op: 'patch', tab: 'Lore', del: [['rumor', 'The Bell', on([c.ver('rumor', 'The Bell')], c.at)]] });
  tick(1000);
  assert.deepEqual(crew(api, { op: 'patch', tab: 'Lore', set: [rumor] }).skipped, [['rumor', 'The Bell']]);
  const place = ['place', 'The Reef', 'sharp', '', on([''], c.at)];
  crew(api, { op: 'patch', tab: 'Lore', set: [place] });
  tick(1000);
  byHand(gas, api, 'Lore', 3, ['place', 'The Shoal', 'sharp', '']);
  tick(1000);
  assert.deepEqual(crew(api, { op: 'patch', tab: 'Lore', set: [place] }).skipped, [['place', 'The Reef']]);
});

test('renames are checked against the old name, and a skipped one keeps its new name off the sheet', () => {
  const { api } = setup();
  const a = look(api, 'Nexa');
  const renameHarm = w => ({ op: 'patch', tab: 'Nexa', ren: [['track', 'Harm', 'Wounds', w]], set: [['track', 'Wounds', '●○○✕✕✕', '', on([''], a.at)]] });
  // someone else changed Harm first
  const b = look(api, 'Nexa');
  crew(api, { op: 'patch', tab: 'Nexa', set: [['track', 'Harm', '●●○✕✕✕', '', on([b.ver('track', 'Harm')], b.at)]] });
  const r = crew(api, renameHarm(on([a.ver('track', 'Harm')], a.at)));
  assert.deepEqual(r.skipped, [['track', 'Harm'], ['track', 'Wounds']]);
  assert.deepEqual(r.rows.filter(x => x[0] === 'track').map(x => `${x[1]}|${x[2]}`), ['Harm|●●○✕✕✕']);

  // made to the current row: renamed in place; sending it again changes nothing
  const c = look(api, 'Nexa');
  const ok = renameHarm(on([c.ver('track', 'Harm')], c.at));
  ok.set[0][2] = '●●○✕✕✕';
  assert.deepEqual(crew(api, ok).skipped, []);
  const again = crew(api, ok);
  assert.deepEqual(again.skipped, []);
  assert.deepEqual(again.rows.map(x => x[1]), ['Name', 'Spitfire', 'Wounds', 'Hand-added']);
  assert.equal(look(api, 'Nexa').ver('track', 'Wounds'), ok.set[0][4].stamp, 'the row carries the set’s stamp');
});

test('renames of rows the sheet never had, and the old name used again', () => {
  const { api } = setup();
  const a = look(api, 'Lore');
  // added and renamed before reaching the sheet: only the new name arrives
  const r = crew(api, { op: 'patch', tab: 'Lore', ren: [['note', 'New note', 'Tides', on([''], a.at)]], set: [['note', 'Tides', 'high', '', on([''], a.at)]] });
  assert.deepEqual(r.skipped, []);
  assert.deepEqual(r.rows.map(x => x[1]), ['Hacker’s Haven', 'Tides']);
  // renamed, then a new row under the old name in the same patch (it's based on the rename)
  const b = look(api, 'Lore');
  const ren = on([b.ver('note', 'Tides')], b.at);
  const both = crew(api, {
    op: 'patch', tab: 'Lore',
    ren: [['note', 'Tides', 'Currents', ren]],
    set: [['note', 'Currents', 'high', '', on([''], b.at)], ['note', 'Tides', 'low', '', on([b.ver('note', 'Tides'), ren.stamp], b.at)]],
  });
  assert.deepEqual(both.skipped, []);
  assert.deepEqual(both.rows.map(x => `${x[1]}|${x[2]}`), ['Hacker’s Haven|A port.', 'Currents|high', 'Tides|low']);
});

test('the Version column goes after any columns already there', () => {
  const { api, gas } = setup({ tabs: { Ship: [['Kind', 'Name', 'Value', 'Notes', 'Mine'], ['stat', 'Speed', '1', '', 'keep me']] } });
  gas.ss.getSheetByName('Ship').maxCols = 5; // a tab trimmed to its columns
  const a = look(api, 'Ship');
  crew(api, { op: 'patch', tab: 'Ship', set: [['stat', 'Speed', '2', '', on([a.ver('stat', 'Speed')], a.at)]] });
  const sh = gas.ss.getSheetByName('Ship');
  assert.deepEqual(sh.getRange(1, 1, 2, 6).getDisplayValues().map(r => r.join('|')), ['Kind|Name|Value|Notes|Mine|Version', 'stat|Speed|2||keep me|' + sh.getRange(2, 6).getDisplayValues()[0][0]]);
  assert.match(look(api, 'Ship').ver('stat', 'Speed'), /^stamp/);
});

test('create stamps the new tab’s rows; reads and patches say when they read the sheet', () => {
  const { api, tick } = setup();
  const r = crew(api, { op: 'create', tab: 'Matt', rows: [['info', 'Name', 'Matt', '']] });
  assert.equal(r.vers.length, 1);
  assert.match(r.vers[0], /^[a-z0-9]+$/);
  tick(5);
  assert.equal(look(api, 'Matt').at, r.at + 5);
  assert.deepEqual(look(api, 'Matt').vers, r.vers);
});

test('removed rows are remembered within a property’s size', () => {
  const { api, gas } = setup();
  const notes = Array.from({ length: 200 }, (_, i) => ['note', `A fairly long note title, number ${i}`, 'x', '']);
  crew(api, { op: 'patch', tab: 'Lore', set: notes });
  crew(api, { op: 'patch', tab: 'Lore', del: notes.map(n => [n[0], n[1], on(null, 0)]) });
  const gone = gas.docProps['gone:lore'];
  assert.equal(Object.keys(JSON.parse(gone)).length, 150);
  assert.ok(gone.length < 9000, `${gone.length} characters`); // Apps Script allows 9 kB per property
});
