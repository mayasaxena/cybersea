// Unit tests for apps-script/Import.gs (the Cybersea menu's Replace with an xlsx…), run against
// tools/gas-fake.mjs. Rules text here is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGas, loadCodeGs, loadAlso } from '../tools/gas-fake.mjs';

const H = ['Kind', 'Name', 'Value', 'Notes'];
const RULES = ['Kind', 'Group', 'Name', 'Text', 'Meta', 'Vis'];

// The fake Drive "converts" an xlsx whose bytes are JSON: {tabs, hidden: [names], protect: {tab:
// [{range?, description, warningOnly, unprotected: [a1]}]}}.
function setup({ fail } = {}) {
  const gas = createGas({
    name: 'Cybersea',
    props: { GM_KEY: 'gm-pass' },
    tabs: {
      Rules: [RULES, ['move', 'basic', 'POKE', 'Old text.', '', 'crew']],
      Nexa: [H, ['info', 'Name', 'Nexa', '']],
      Old: [H, ['note', 'Gone soon', '', '']],
    },
  });
  gas.docProps['gone:nexa'] = '{"x":[1,"s"]}';
  gas.docProps.other = 'kept';
  const api = loadCodeGs(gas);
  const ctx = loadAlso(api, 'Import.gs');
  const drive = new Map();
  let ids = 0;
  ctx.Drive = {
    Files: {
      create: (meta, blob) => {
        assert.equal(meta.mimeType, 'application/vnd.google-apps.spreadsheet');
        const spec = JSON.parse(Buffer.from(blob.getBytes().map(b => b & 255)).toString('utf8'));
        const src = createGas({ name: meta.name, tabs: spec.tabs }).ss;
        for (const name of spec.hidden || []) src.getSheetByName(name).tabHidden = true;
        for (const [name, list] of Object.entries(spec.protect || {})) {
          const sh = src.getSheetByName(name);
          for (const p of list) {
            const q = p.range ? sh.getRange(p.range).protect() : sh.protect();
            q.setDescription(p.description || '').setWarningOnly(!!p.warningOnly);
            q.setUnprotectedRanges((p.unprotected || []).map(a1 => sh.getRange(a1)));
          }
        }
        if (fail) src.getSheets()[fail].copyTo = () => { throw new Error('copy failed'); };
        const id = `temp${++ids}`;
        drive.set(id, src);
        return { id };
      },
      remove: id => { drive.delete(id); },
    },
  };
  ctx.SpreadsheetApp.openById = id => drive.get(id);
  const xlsx = spec => Buffer.from(JSON.stringify(spec)).toString('base64');
  return { gas, api, ctx, drive, xlsx, names: () => gas.ss.getSheets().map(s => s.getName()) };
}

const FRESH = {
  tabs: {
    README: [['Read me']],
    Rules: [RULES, ['move', 'basic', 'POKE', 'New text.', '', 'crew'], ['move', 'basic', 'PROD', 'Also new.', '', 'crew']],
    Nexa: [H, ['info', 'Name', 'Nexa', ''], ['note', 'Fresh', 'New row', '']],
    _Overrides: [['scratch']],
  },
};

test('replaces every tab with the file’s, in its order, and the site reads the new rows', () => {
  const { api, ctx, drive, xlsx, names, gas } = setup();
  const res = ctx.replaceWithXlsx('cybersea.xlsx', xlsx(FRESH));
  assert.equal(res.ok, true, res.error);
  assert.deepEqual([...res.tabs], ['README', 'Rules', 'Nexa', '_Overrides']);
  assert.deepEqual(names(), ['README', 'Rules', 'Nexa', '_Overrides']);
  assert.equal(drive.size, 0, 'the temporary sheet is deleted');
  assert.equal(gas.ss.getName(), 'Cybersea', 'the spreadsheet keeps its name');

  const read = api.call({ key: 'gm-pass', op: 'read', tabs: '*' });
  assert.equal(read.ok, true);
  assert.deepEqual(read.tabs.Rules.rows.map(r => r[3]), ['New text.', 'Also new.']);
  assert.equal(read.tabs.Nexa.rows.find(r => r[0] === 'note')[2], 'New row');
  assert.equal(read.tabs.Old, undefined);
});

test('forgets rows remembered as removed from the old tabs, and nothing else', () => {
  const { ctx, xlsx, gas } = setup();
  ctx.replaceWithXlsx('cybersea.xlsx', xlsx(FRESH));
  assert.equal(gas.docProps['gone:nexa'], undefined);
  assert.equal(gas.docProps.other, 'kept');
});

test('keeps the file’s hidden tabs and protections', () => {
  const { ctx, xlsx, gas } = setup();
  const res = ctx.replaceWithXlsx('cybersea.xlsx', xlsx({
    ...FRESH,
    hidden: ['_Overrides'],
    protect: {
      Rules: [{ description: 'The rules', unprotected: ['G2:G5'] }],
      Nexa: [{ range: 'A1:D1', description: 'Header', warningOnly: true }],
    },
  }));
  assert.equal(res.ok, true, res.error);
  assert.equal(gas.ss.getSheetByName('_Overrides').isSheetHidden(), true);
  assert.equal(gas.ss.getSheetByName('Rules').isSheetHidden(), false);

  const [rules] = gas.ss.getSheetByName('Rules').getProtections('SHEET');
  assert.equal(rules.getDescription(), 'The rules');
  assert.deepEqual(rules.getEditors(), ['owner']);
  assert.equal(rules.canDomainEdit(), false);
  assert.deepEqual(rules.getUnprotectedRanges().map(r => [r.getSheet().getName(), r.getA1Notation()]), [['Rules', 'G2:G5']]);

  const [header] = gas.ss.getSheetByName('Nexa').getProtections('RANGE');
  assert.equal(header.getRange().getA1Notation(), 'A1:D1');
  assert.equal(header.getRange().getSheet(), gas.ss.getSheetByName('Nexa'));
  assert.equal(header.isWarningOnly(), true);
});

test('turns down a file with no Rules tab, and other files, without changing anything', () => {
  const { ctx, xlsx, names, drive } = setup();
  const before = names();
  const res = ctx.replaceWithXlsx('budget.xlsx', xlsx({ tabs: { Sheet1: [['a']] } }));
  assert.equal(res.ok, false);
  assert.match(res.error, /no Rules tab/);
  assert.equal(drive.size, 0);
  assert.equal(ctx.replaceWithXlsx('notes.csv', xlsx(FRESH)).ok, false);
  assert.equal(ctx.replaceWithXlsx('empty.xlsx', '').ok, false);
  assert.deepEqual(names(), before);
});

test('if a tab can’t be copied, the old tabs stay as they were', () => {
  const { ctx, xlsx, names, drive } = setup({ fail: 2 });
  const before = names();
  assert.throws(() => ctx.replaceWithXlsx('cybersea.xlsx', xlsx(FRESH)), /copy failed/);
  assert.deepEqual(names(), before);
  assert.equal(drive.size, 0, 'the temporary sheet is still deleted');
});

test('waits for the site’s writes: a busy sheet is turned down', () => {
  const { ctx, xlsx, names } = setup();
  const lock = ctx.LockService.getScriptLock();
  lock.tryLock();
  const before = names();
  const res = ctx.replaceWithXlsx('cybersea.xlsx', xlsx(FRESH));
  lock.releaseLock();
  assert.equal(res.ok, false);
  assert.equal(res.code, 'busy');
  assert.deepEqual(names(), before);
});

test('adds the Cybersea menu when the spreadsheet opens', () => {
  const { ctx } = setup();
  const items = [];
  let added = false;
  ctx.SpreadsheetApp.getUi = () => ({
    createMenu: name => {
      assert.equal(name, 'Cybersea');
      const m = { addItem: (label, fn) => { items.push([label, fn]); return m; }, addToUi: () => { added = true; } };
      return m;
    },
  });
  ctx.onOpen();
  assert.equal(added, true);
  assert.deepEqual(items, [['Replace with an xlsx…', 'showReplaceDialog']]);
  assert.equal(typeof ctx[items[0][1]], 'function');
});
