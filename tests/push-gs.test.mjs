// Unit tests for apps-script/Push.gs (live updates through a Firebase Realtime Database), run
// against tools/gas-fake.mjs with the database's REST API stood in for by gas.onFetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGas, loadCodeGs } from '../tools/gas-fake.mjs';
import { makeXlsx } from './fixtures/xlsx.mjs';

const H = ['Kind', 'Name', 'Value', 'Notes'];
const FB = { FIREBASE_URL: 'https://cybersea-test-default-rtdb.firebaseio.com/' };

function setup(props = FB) {
  const gas = createGas({
    name: 'Cybersea',
    props: { GM_KEY: 'gm', ...props },
    tabs: {
      Rules: [['Kind', 'Group', 'Name', 'Text', 'Meta', 'Vis'], ['move', 'basic', 'POKE', 'Made up.', '', 'crew']],
      Nexa: [H, ['info', 'Name', 'Nexa', ''], ['stat', 'Spitfire', '+2', '']],
      Ship: [H],
    },
  });
  const pings = [];
  gas.onFetch = (url, opts) => {
    if (!url.includes('firebaseio.com')) return null;
    pings.push({ url, method: opts.method, body: JSON.parse(opts.payload) });
    return new URL(url).searchParams.get('access_token') === 'owner-token' ? { code: 200, text: '{}' } : { code: 401, text: '{"error":"Permission denied"}' };
  };
  const api = loadCodeGs(gas);
  const gm = body => api.call({ key: 'gm', ...body });
  return { gas, api, gm, pings };
}

test('off without FIREBASE_URL: no listening place, no pings', () => {
  const { gm, pings } = setup({ FIREBASE_URL: '' });
  assert.equal(gm({ op: 'read', tabs: ['Nexa'] }).push, undefined);
  assert.equal(gm({ op: 'patch', tab: 'Nexa', set: [['stat', 'Spitfire', '+3', '']] }).ok, true);
  assert.deepEqual(pings, []);
});

test('reads name the place to listen; a change pings it once it’s done, saying which page made it', () => {
  const { gas, gm, pings } = setup();
  const push = gm({ op: 'read', tabs: ['Nexa'] }).push;
  assert.match(push, /^https:\/\/cybersea-test-default-rtdb\.firebaseio\.com\/games\/[0-9a-f]{32}\.json$/);
  assert.equal(gm({ op: 'read', tabs: ['Ship'] }).push, push, 'the same place every time');
  assert.deepEqual(pings, [], 'reads don’t ping');

  let flushedFirst = false;
  gas.onFlush = () => { flushedFirst = !pings.length; };
  assert.equal(gm({ op: 'patch', tab: 'Nexa', set: [['stat', 'Spitfire', '+3', '']], by: 'page1' }).ok, true);
  assert.equal(pings.length, 1);
  assert.equal(pings[0].url, push + '?access_token=owner-token', 'written with the sign-in of the account the script runs as');
  assert.equal(pings[0].method, 'patch');
  const { at, ...rest } = pings[0].body;
  assert.deepEqual(rest, { by: 'page1', n: { '.sv': { increment: 1 } } });
  assert.ok(Math.abs(at - Date.now()) < 5000, 'the time is the script’s clock, as reads’ are');
  assert.ok(flushedFirst, 'the sheet is flushed before the ping');

  // A by that isn't a page's id is left out.
  gm({ op: 'patch', tab: 'Nexa', set: [['stat', 'Spitfire', '+4', '']], by: '../x' });
  assert.equal(pings[1].body.by, '');
});

test('a change turned away pings nothing', () => {
  const { api, pings } = setup();
  assert.equal(api.call({ op: 'patch', tab: 'GM', set: [['x', 'y', '', '']] }).ok, false);
  assert.deepEqual(pings, []);
});

test('pushChange (the "On change" trigger) pings for edits made in Sheets, and the next read sees them', () => {
  const { gas, api, gm, pings } = setup();
  const first = gm({ op: 'read', tabs: ['Nexa'] });
  const d = first.tabs.Nexa.d;
  // Typed in Sheets with no simple onEdit (Sheets runs none for some changes): only the trigger.
  gas.ss.getSheetByName('Nexa').getRange(3, 3, 1, 1).setValues([['+5']]);
  api.ctx.pushChange({ changeType: 'EDIT' });
  assert.equal(pings.length, 1);
  assert.equal(pings[0].body.by, '');
  const again = gm({ op: 'read', tabs: ['Nexa'], have: { Nexa: d } });
  assert.ok(again.tabs.Nexa.rows, 'the remembered digest was forgotten, so the rows come back');
});

test('pushChange stamps rows typed in Sheets before it pings, so pages don’t keep a version onEdit then replaces', () => {
  const { gas, api, gm, pings } = setup();
  const range = gas.ss.getSheetByName('Nexa').getRange(3, 1, 1, 4);
  range.setValues([['stat', 'Spitfire', '+5', '']]);
  // On change runs before onEdit, and a page reads on its ping.
  api.ctx.pushChange({ changeType: 'EDIT' });
  assert.equal(pings.length, 1);
  const seen = gm({ op: 'read', tabs: ['Nexa'] }).tabs.Nexa;
  const ver = seen.vers[seen.rows.findIndex(r => r[1] === 'Spitfire')];
  assert.doesNotMatch(ver, /^~/, 'stamped before the ping');
  api.onEdit({ range });
  const after = gm({ op: 'read', tabs: ['Nexa'] }).tabs.Nexa;
  assert.equal(after.vers[after.rows.findIndex(r => r[1] === 'Spitfire')], ver, 'onEdit finds it stamped and keeps the version');
  const r = gm({ op: 'patch', tab: 'Nexa', set: [['stat', 'Spitfire', '+6', '', { base: [ver], seen: Date.now(), stamp: 'abcdef123' }]] });
  assert.deepEqual(r.skipped, [], 'a change based on what the page read goes through');

  // A row whose Kind+Name was typed over is remembered as gone, whichever trigger stamps it.
  range.setValues([['stat', 'Grit', '+5', '']]);
  api.ctx.pushChange({ changeType: 'EDIT' });
  const gone = JSON.parse(gas.docProps['gone:nexa'] || '{}');
  assert.equal(Object.keys(gone).length, 1);
});

test('the settings are read from the script properties once, then from the cache', () => {
  const { gas, gm } = setup();
  gm({ op: 'read', tabs: ['Nexa'] });
  gas.setProps({ FIREBASE_URL: '' });
  assert.ok(gm({ op: 'read', tabs: ['Nexa'] }).push, 'still on until the cache lets go');
});

test('a copy of the sheet listens in its own place, and one whose pings are turned away goes back to polling', () => {
  const a = setup();
  const b = setup();
  const pa = a.gm({ op: 'read', tabs: ['Nexa'] }).push;
  const pb = b.gm({ op: 'read', tabs: ['Nexa'] }).push;
  assert.ok(pa && pb && pa !== pb, 'the place comes from the spreadsheet, not from anything copied with it');

  // Someone who can't write to the database (a copy run by another account, say).
  b.gas.oauthToken = 'someone-else';
  assert.equal(b.gm({ op: 'patch', tab: 'Nexa', set: [['stat', 'Spitfire', '+3', '']] }).ok, true, 'the change itself still goes through');
  assert.equal(b.pings.length, 1);
  assert.equal(b.gm({ op: 'read', tabs: ['Nexa'] }).push, undefined, 'pages aren’t told to wait on pings that don’t come');
});

test('an import pings when it’s done', () => {
  const { api, pings } = setup();
  const xlsx = makeXlsx([{ name: 'Nexa', rows: [H, ['info', 'Name', 'Nexa', ''], ['stat', 'Spitfire', '+1', '']] }]).toString('base64');
  const r = api.ctx.replaceWithXlsx('cybersea.xlsx', xlsx, { tabs: ['Nexa'], remove: [] });
  assert.equal(r.ok, true, r.error);
  assert.equal(pings.length, 1);
});
