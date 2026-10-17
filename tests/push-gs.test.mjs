// Unit tests for apps-script/Push.gs (live updates through a Firebase Realtime Database), run
// against tools/gas-fake.mjs with the database's REST API stood in for by gas.onFetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGas, loadCodeGs } from '../tools/gas-fake.mjs';
import { makeXlsx } from './fixtures/xlsx.mjs';

const H = ['Kind', 'Name', 'Value', 'Notes'];
const FB = { FIREBASE_URL: 'https://cybersea-test-default-rtdb.firebaseio.com/', FIREBASE_SECRET: 's3cret' };

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
    return { code: 200, text: '{}' };
  };
  const api = loadCodeGs(gas);
  const gm = body => api.call({ key: 'gm', ...body });
  return { gas, api, gm, pings };
}

test('off without FIREBASE_URL and FIREBASE_SECRET: no listening place, no pings', () => {
  const { gm, pings } = setup({ FIREBASE_URL: 'https://x.firebaseio.com' });
  assert.equal(gm({ op: 'read', tabs: ['Nexa'] }).push, undefined);
  assert.equal(gm({ op: 'patch', tab: 'Nexa', set: [['stat', 'Spitfire', '+3', '']] }).ok, true);
  assert.deepEqual(pings, []);
});

test('reads name the place to listen; a change pings it once it’s done, saying which page made it', () => {
  const { gas, gm, pings } = setup();
  const push = gm({ op: 'read', tabs: ['Nexa'] }).push;
  assert.match(push, /^https:\/\/cybersea-test-default-rtdb\.firebaseio\.com\/games\/[0-9a-f]{32}\.json$/);
  assert.ok(!push.includes('s3cret'));
  assert.equal(gm({ op: 'read', tabs: ['Ship'] }).push, push, 'the same place every time');
  assert.deepEqual(pings, [], 'reads don’t ping');

  let flushedFirst = false;
  gas.onFlush = () => { flushedFirst = !pings.length; };
  assert.equal(gm({ op: 'patch', tab: 'Nexa', set: [['stat', 'Spitfire', '+3', '']], by: 'page1' }).ok, true);
  assert.equal(pings.length, 1);
  assert.equal(pings[0].url, push + '?auth=s3cret');
  assert.equal(pings[0].method, 'put');
  assert.deepEqual(pings[0].body, { at: { '.sv': 'timestamp' }, by: 'page1' });
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

test('an import pings when it’s done', () => {
  const { api, pings } = setup();
  const xlsx = makeXlsx([{ name: 'Nexa', rows: [H, ['info', 'Name', 'Nexa', ''], ['stat', 'Spitfire', '+1', '']] }]).toString('base64');
  const r = api.ctx.replaceWithXlsx('cybersea.xlsx', xlsx, { tabs: ['Nexa'], remove: [] });
  assert.equal(r.ok, true, r.error);
  assert.equal(pings.length, 1);
});
