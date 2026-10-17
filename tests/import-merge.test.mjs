// Unit tests for Import.gs's merge: an import that keeps the sheet's own changes (rows added,
// edited or removed in Sheets), settles conflicts, and brings older tabs up to date with
// migrations. Run against tools/gas-fake.mjs; rules text here is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createGas, loadCodeGs } from '../tools/gas-fake.mjs';
import { makeXlsx } from './fixtures/xlsx.mjs';

const H = ['Kind', 'Name', 'Value', 'Notes'];
const RULES = ['Kind', 'Group', 'Name', 'Text', 'Meta', 'Vis'];

const rules = (...rows) => ({ name: 'Rules', rows: [RULES, ...rows] });
const nexa = (...rows) => ({ name: 'Nexa', rows: [H, ...rows] });
const FIRST = [
  rules(['move', 'basic', 'POKE', 'Poke it.', '', 'crew'], ['move', 'basic', 'PROD', 'Prod it.', '', 'crew']),
  nexa(['info', 'Name', 'Nexa', ''], ['stat', 'Spitfire', '+2', ''], ['stat', 'Snark', '+1', ''], ['note', 'Typed', 'old', '']),
];
const custom = schema => ({
  'docProps/custom.xml': `<?xml version="1.0" encoding="UTF-8"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="Cybersea schema"><vt:i4>${schema}</vt:i4></property></Properties>`,
});

// A sheet that has had FIRST imported (so _Import remembers it) unless fresh.
function setup({ fresh = false } = {}) {
  const gas = createGas({ name: 'Cybersea', props: { GM_KEY: 'gm-pass' }, tabs: { Rules: [RULES], Nexa: [H] } });
  const api = loadCodeGs(gas);
  const { ctx } = api;
  const sheet = name => gas.ss.getSheetByName(name);
  const b64 = (tabs, opts) => makeXlsx(tabs, opts).toString('base64');
  const merge = (tabs, choice = {}, opts) => ctx.replaceWithXlsx('game.xlsx', b64(tabs, opts), { tabs: tabs.map(t => t.name), remove: [], merge: true, ...choice });
  const list = (tabs, opts) => ctx.listXlsxTabs('game.xlsx', b64(tabs, opts));
  const rows = name => api.call({ key: 'gm-pass', op: 'read', tabs: [name] }).tabs[name].rows.map(r => r.slice(0, name === 'Rules' ? 4 : 3));
  // Types into the sheet as someone in Google Sheets would (onEdit runs after).
  const type = (name, r, values) => {
    const range = sheet(name).getRange(r, 1, 1, values.length);
    range.setValues([values]);
    api.onEdit({ range });
  };
  const at = (name, kind, key) => sheet(name).getDataRange().getDisplayValues().findIndex(l => l[0] === kind && l[1] === key) + 1;
  if (!fresh) assert.equal(ctx.replaceWithXlsx('game.xlsx', b64(FIRST)).ok, true);
  return { gas, api, ctx, sheet, merge, list, rows, type, at };
}

test('keeps rows added, edited and removed on the sheet; takes what only the file changed', () => {
  const { merge, rows, type, at } = setup();
  type('Nexa', at('Nexa', 'stat', 'Spitfire'), ['stat', 'Spitfire', '+3', '']); // edited here
  type('Nexa', at('Nexa', 'note', 'Typed'), ['', '', '', '']); // removed here
  type('Nexa', at('Nexa', 'stat', 'Snark') + 1, ['stat', 'Grit', '+1', 'mine']); // added here, after Snark

  const res = merge([
    rules(['move', 'basic', 'PROD', 'Prod it harder.', '', 'crew'], ['move', 'basic', 'PEEK', 'Peek.', '', 'crew']),
    nexa(['info', 'Name', 'Nexa', 'pilot'], ['stat', 'Spitfire', '+2', ''], ['stat', 'Snark', '+2', ''], ['note', 'Typed', 'old', ''], ['jot', 'Notes', 'hi', '']),
  ]);
  assert.equal(res.ok, true, res.error);
  assert.deepEqual(rows('Nexa'), [
    ['info', 'Name', 'Nexa'],
    ['stat', 'Spitfire', '+3'], // the sheet's edit (the file didn't change it)
    ['stat', 'Snark', '+2'], // the file's (the sheet didn't change it)
    ['stat', 'Grit', '+1'], // the sheet's own row, where it was
    ['jot', 'Notes', 'hi'], // new in the file
  ]);
  assert.deepEqual(rows('Rules'), [
    ['move', 'basic', 'PROD', 'Prod it harder.'],
    ['move', 'basic', 'PEEK', 'Peek.'],
  ], 'POKE, which the file removed and the sheet left alone, goes');
  assert.deepEqual(JSON.parse(JSON.stringify(res.merged)), [
    { tab: 'Rules', added: 1, updated: 1, removed: 1, kept: 0 },
    { tab: 'Nexa', added: 1, updated: 2, removed: 0, kept: 3 },
  ]);

  // And the next import of the same file changes nothing.
  const again = merge([
    rules(['move', 'basic', 'PROD', 'Prod it harder.', '', 'crew'], ['move', 'basic', 'PEEK', 'Peek.', '', 'crew']),
    nexa(['info', 'Name', 'Nexa', 'pilot'], ['stat', 'Spitfire', '+2', ''], ['stat', 'Snark', '+2', ''], ['note', 'Typed', 'old', ''], ['jot', 'Notes', 'hi', '']),
  ]);
  assert.equal(again.ok, true, again.error);
  assert.equal(rows('Nexa').length, 5);
  assert.deepEqual(JSON.parse(JSON.stringify(again.merged))[1], { tab: 'Nexa', added: 0, updated: 0, removed: 0, kept: 3 });
});

test('a cell both changed is a conflict: nothing changes until it is settled, either way', () => {
  const { merge, rows, type, at, gas } = setup();
  type('Nexa', at('Nexa', 'stat', 'Spitfire'), ['stat', 'Spitfire', '+3', '']);
  type('Nexa', at('Nexa', 'note', 'Typed'), ['', '', '', '']);
  type('Nexa', at('Nexa', 'stat', 'Snark'), ['stat', 'Snark', '+1', 'noted']);
  const file = [nexa(['info', 'Name', 'Nexa', ''], ['stat', 'Spitfire', '+1', ''], ['note', 'Typed', 'new', ''])];
  const before = JSON.stringify(gas.ss.getSheets().map(s => s.getDataRange().getValues()));

  const res = merge(file);
  assert.equal(res.ok, false);
  assert.equal(res.code, 'conflicts');
  assert.deepEqual(JSON.parse(JSON.stringify(res.conflicts)), [
    { id: 'nexa|stat|spitfire', tab: 'Nexa', row: 'stat · Spitfire', what: 'changed here and in the file', cells: [{ col: 'Value', here: '+3', file: '+1' }] },
    { id: 'nexa|note|typed', tab: 'Nexa', row: 'note · Typed', what: 'removed here, changed in the file', cells: [{ col: 'Kind', here: '', file: 'note' }, { col: 'Name', here: '', file: 'Typed' }, { col: 'Value', here: '', file: 'new' }] },
    { id: 'nexa|stat|snark', tab: 'Nexa', row: 'stat · Snark', what: 'changed here, removed from the file', cells: [{ col: 'Kind', here: 'stat', file: '' }, { col: 'Name', here: 'Snark', file: '' }, { col: 'Value', here: '+1', file: '' }, { col: 'Notes', here: 'noted', file: '' }] },
  ]);
  assert.equal(JSON.stringify(gas.ss.getSheets().map(s => s.getDataRange().getValues())), before, 'nothing changed');

  const ids = res.conflicts.map(c => c.id);
  const sheetWins = merge(file, { resolve: Object.fromEntries(ids.map(id => [id, 'sheet'])) });
  assert.equal(sheetWins.ok, true, sheetWins.error);
  assert.deepEqual(rows('Nexa'), [['info', 'Name', 'Nexa'], ['stat', 'Spitfire', '+3'], ['stat', 'Snark', '+1']]);
  // Settled for good: the same file again raises nothing.
  assert.equal(merge(file).ok, true);
  assert.deepEqual(rows('Nexa'), [['info', 'Name', 'Nexa'], ['stat', 'Spitfire', '+3'], ['stat', 'Snark', '+1']]);
});

test('settling a conflict with the file’s takes the file’s cells, rows and removals', () => {
  const { merge, rows, type, at } = setup();
  type('Nexa', at('Nexa', 'stat', 'Spitfire'), ['stat', 'Spitfire', '+3', 'here']);
  type('Nexa', at('Nexa', 'note', 'Typed'), ['', '', '', '']);
  type('Nexa', at('Nexa', 'stat', 'Snark'), ['stat', 'Snark', '+1', 'noted']);
  const file = [nexa(['info', 'Name', 'Nexa', ''], ['stat', 'Spitfire', '+1', ''], ['note', 'Typed', 'new', ''])];
  const resolve = Object.fromEntries(merge(file).conflicts.map(c => [c.id, 'file']));
  const res = merge(file, { resolve });
  assert.equal(res.ok, true, res.error);
  assert.deepEqual(rows('Nexa'), [['info', 'Name', 'Nexa'], ['stat', 'Spitfire', '+1'], ['note', 'Typed', 'new']]);
  const read = res.ok && rows('Nexa');
  assert.ok(read);
});

test('the first merge, with nothing remembered: a cell that differs is a conflict unless the sheet’s is blank', () => {
  const { merge, rows, sheet, gas } = setup({ fresh: true });
  sheet('Nexa').getRange(2, 1, 3, 4).setValues([['info', 'Name', 'Nexa', ''], ['stat', 'Spitfire', "'+3", ''], ['stat', 'Grit', "'+1", '']]);
  sheet('Rules').getRange(2, 1, 1, 6).setValues([['move', 'basic', 'POKE', 'Poke it.', '', 'crew']]);
  const res = merge(FIRST);
  assert.equal(res.code, 'conflicts');
  assert.deepEqual(JSON.parse(JSON.stringify(res.conflicts.map(c => c.id))), ['nexa|stat|spitfire']);
  assert.equal(merge(FIRST, { resolve: { 'nexa|stat|spitfire': 'sheet' } }).ok, true);
  // Grit, only on the sheet, stays after the row it followed there.
  assert.deepEqual(rows('Nexa'), [['info', 'Name', 'Nexa'], ['stat', 'Spitfire', '+3'], ['stat', 'Grit', '+1'], ['stat', 'Snark', '+1'], ['note', 'Typed', 'old']]);
  assert.deepEqual(rows('Rules').map(r => r[2]), ['POKE', 'PROD']);
  assert.ok(gas.ss.getSheetByName('_Import'));
});

test('without merge, a tab is replaced whole, as before; _Import still remembers it', () => {
  const { ctx, rows, type, at, merge } = setup();
  type('Nexa', at('Nexa', 'stat', 'Spitfire'), ['stat', 'Spitfire', '+3', '']);
  const res = ctx.replaceWithXlsx('game.xlsx', makeXlsx([nexa(['info', 'Name', 'Nexa', ''])]).toString('base64'), { tabs: ['Nexa'], remove: [] });
  assert.equal(res.ok, true, res.error);
  assert.deepEqual(rows('Nexa'), [['info', 'Name', 'Nexa']]);
  assert.deepEqual(JSON.parse(JSON.stringify(res.merged)), []);
  type('Nexa', 3, ['note', 'Grit', 'mine', '']);
  assert.equal(merge([nexa(['info', 'Name', 'Nexa', 'pilot'])]).ok, true);
  assert.deepEqual(rows('Nexa'), [['info', 'Name', 'Nexa'], ['note', 'Grit', 'mine']]);
});

test('the sheet’s own columns, Version marks, formats and pictures stay with the rows kept', () => {
  const { gas, api, merge, sheet, type, at } = setup();
  const vers = () => {
    const t = api.call({ key: 'gm-pass', op: 'read', tabs: ['Nexa'] }).tabs.Nexa;
    return Object.fromEntries(t.rows.map((r, i) => [r[1], t.vers[i]]));
  };
  type('Nexa', at('Nexa', 'stat', 'Spitfire'), ['stat', 'Spitfire', '+3', '']);
  const nx = sheet('Nexa');
  const head = nx.getDataRange().getDisplayValues()[0];
  const vc = head.indexOf('Version') + 1;
  assert.ok(vc > 4 && nx.isColumnHiddenByUser(vc), 'onEdit added the hidden Version column');
  nx.getRange(1, vc + 1).setValues([['Image']]);
  nx.getRange(at('Nexa', 'stat', 'Snark'), vc + 1).setValues([[{ image: { type: 'image/png', bytes: Buffer.from([1, 2, 3]) } }]]);
  nx.cell(at('Nexa', 'stat', 'Spitfire'), 4).bg = '#ffeeaa';
  const before = vers();

  const res = merge([nexa(['info', 'Name', 'Nexa', 'pilot'], ['stat', 'Spitfire', '+2', ''], ['stat', 'Snark', '+1', ''], ['note', 'Typed', 'old', ''])]);
  assert.equal(res.ok, true, res.error);
  const after = vers();
  assert.equal(after.Spitfire, before.Spitfire, 'a row kept as it was keeps its version');
  assert.notEqual(after.Name, before.Name, 'a row the file changed is new to the site');
  const now = sheet('Nexa');
  const h2 = now.getDataRange().getDisplayValues()[0];
  assert.deepEqual(h2.slice(4), ['Version', 'Image']);
  assert.ok(now.isColumnHiddenByUser(h2.indexOf('Version') + 1), 'Version stays hidden');
  const snark = now.getDataRange().getDisplayValues().findIndex(l => l[1] === 'Snark') + 1;
  assert.ok(now.cell(snark, h2.indexOf('Image') + 1).image, 'the picture placed in the cell came along');
  const spit = now.getDataRange().getDisplayValues().findIndex(l => l[1] === 'Spitfire') + 1;
  assert.equal(now.cell(spit, 4).bg, '#ffeeaa');
  assert.ok(gas.ss.getSheetByName('_Import').isSheetHidden());
});

test('_Import is hidden, warns before an edit, and is never offered, replaced or read by the site', () => {
  const { gas, api, list, ctx } = setup();
  const base = gas.ss.getSheetByName('_Import');
  assert.ok(base.isSheetHidden());
  assert.ok(base.getProtections('SHEET')[0]?.isWarningOnly());
  const listed = list([...FIRST, { name: '_Import', rows: [['x']] }]);
  assert.ok(!listed.file.some(t => t.name === '_Import'));
  assert.ok(!listed.sheetOnly.includes('_Import'));
  const res = ctx.replaceWithXlsx('game.xlsx', makeXlsx(FIRST).toString('base64'));
  assert.deepEqual([...res.removed], []);
  assert.ok(gas.ss.getSheetByName('_Import'));
  assert.ok(!api.call({ key: 'gm-pass', op: 'read', tabs: '*' }).list.some(t => /import/i.test(t.name)));
});

test('a change the site saves while the import fills in turns the import down, keeping it', () => {
  const { gas, api, merge, rows } = setup();
  gas.onFlush = () => {
    gas.onFlush = null;
    const res = api.call({ key: 'gm-pass', op: 'patch', tab: 'Nexa', set: [['stat', 'Snark', '+4', '']] });
    assert.equal(res.ok, true, res.error);
  };
  const res = merge([nexa(['info', 'Name', 'Nexa', 'pilot'], ['stat', 'Spitfire', '+2', ''], ['stat', 'Snark', '+1', ''], ['note', 'Typed', 'old', ''])]);
  assert.equal(res.ok, false);
  assert.match(res.error, /Nexa tab changed while this was importing/);
  assert.equal(rows('Nexa').find(r => r[1] === 'Snark')[2], '+4');
  assert.ok(!gas.ss.getSheets().some(s => /_importing/.test(s.getName())), 'no half-made tabs left');
  assert.equal(merge([nexa(['info', 'Name', 'Nexa', 'pilot'], ['stat', 'Spitfire', '+2', ''], ['stat', 'Snark', '+1', ''], ['note', 'Typed', 'old', ''])]).ok, true);
  assert.equal(rows('Nexa').find(r => r[1] === 'Snark')[2], '+4', 'the next try keeps it');
});

/* ---------- schemas and migrations ---------- */

const KIT = { about: 'Inventory tab renamed Kit', tab: n => (/^inventory$/i.test(n) ? 'Kit' : n), rows: t => t.rows.forEach(r => { if (/^inventory$/i.test(r[0])) r[0] = 'kit'; }) };
const addMigration = ctx => vm.runInContext(`MIGRATIONS.push(${'{ about: ' + JSON.stringify(KIT.about) + ', tab: ' + KIT.tab + ', rows: ' + KIT.rows + ' }'})`, ctx);

test('a newer file’s migration brings the sheet’s tab, and what was remembered, up to date before merging', () => {
  const { ctx, merge, list, rows, gas, type, at } = setup({ fresh: true });
  assert.equal(ctx.replaceWithXlsx('game.xlsx', makeXlsx([...FIRST, { name: 'Inventory', rows: [H, ['inventory', 'Rope', '1', ''], ['inventory', 'Lamp', '1', '']] }]).toString('base64')).ok, true);
  type('Inventory', at('Inventory', 'inventory', 'Rope'), ['inventory', 'Rope', '3', '']); // edited here
  type('Inventory', 4, ['inventory', 'Hook', '1', '']); // added here
  addMigration(ctx);
  assert.equal(vm.runInContext('schema_()', ctx), 2);

  const file = [{ name: 'Kit', rows: [H, ['kit', 'Rope', '1', ''], ['kit', 'Lamp', '2', '']] }];
  const listed = list(file, { extra: custom(2) });
  assert.deepEqual(JSON.parse(JSON.stringify(listed.file)), [{ name: 'Kit', exists: true }]);
  assert.ok(!listed.sheetOnly.includes('Inventory'), 'the sheet’s Inventory tab is the file’s Kit tab');

  const res = merge(file, {}, { extra: custom(2) });
  assert.equal(res.ok, true, res.error);
  const names = gas.ss.getSheets().map(s => s.getName());
  assert.ok(names.includes('Kit') && !names.includes('Inventory'), names.join());
  assert.deepEqual(rows('Kit'), [['kit', 'Rope', '3'], ['kit', 'Lamp', '2'], ['kit', 'Hook', '1']]);
  assert.deepEqual(JSON.parse(JSON.stringify(res.merged)), [{ tab: 'Kit', added: 0, updated: 1, removed: 0, kept: 2 }]);
});

test('an older file is brought up to date too; a file newer than the script is turned down', () => {
  const { ctx, merge, rows } = setup();
  addMigration(ctx);
  const old = [{ name: 'Inventory', rows: [H, ['inventory', 'Rope', '1', '']] }];
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.listXlsxTabs('game.xlsx', makeXlsx(old).toString('base64')).file)), [{ name: 'Inventory', exists: false }],
    'a file that names no schema is taken to be the script’s');
  const ok = ctx.replaceWithXlsx('game.xlsx', makeXlsx(old, { extra: custom(1) }).toString('base64'), { tabs: ['Kit'], remove: [], merge: true });
  assert.equal(ok.ok, true, ok.error);
  assert.deepEqual(rows('Kit'), [['kit', 'Rope', '1']]);

  const newer = merge([nexa(['info', 'Name', 'Nexa', ''])], {}, { extra: custom(3) });
  assert.equal(newer.ok, false);
  assert.match(newer.error, /newer version/);
});

test('tools/xlsx/build.py writes the schema the script is at', async () => {
  const { readFileSync } = await import('node:fs');
  const gas = createGas();
  const { ctx } = loadCodeGs(gas);
  const py = readFileSync(new URL('../tools/xlsx/build.py', import.meta.url), 'utf8');
  assert.equal(Number(/^SCHEMA = (\d+)/m.exec(py)?.[1]), vm.runInContext('schema_()', ctx));
});

test('review lists every change before anything changes, including edits kept from the sheet', () => {
  const { merge, rows, type, at, gas } = setup();
  type('Nexa', at('Nexa', 'stat', 'Spitfire'), ['stat', 'Spitfire', '+3', '']); // edited here only
  type('Nexa', at('Nexa', 'note', 'Typed'), ['', '', '', '']); // removed here only
  type('Nexa', at('Nexa', 'stat', 'Snark') + 1, ['stat', 'Grit', '+1', '']); // added here
  const file = [nexa(['info', 'Name', 'Nexa', 'pilot'], ['stat', 'Spitfire', '+2', ''], ['stat', 'Snark', '+1', ''], ['note', 'Typed', 'old', ''], ['jot', 'Notes', 'hi', ''])];
  const before = JSON.stringify(gas.ss.getSheets().map(s => s.getDataRange().getValues()));
  const res = merge(file, { review: true });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'review');
  assert.deepEqual(JSON.parse(JSON.stringify(res.changes)), [
    { tab: 'Nexa', row: 'info · Name', what: 'takes the file’s changes', cells: [{ col: 'Notes', here: '', file: 'pilot' }] },
    { tab: 'Nexa', row: 'stat · Spitfire', what: 'keeps this sheet’s edit', cells: [{ col: 'Value', here: '+3', file: '+2' }] },
    { tab: 'Nexa', row: 'note · Typed', what: 'stays removed (removed here)', cells: [{ col: 'Kind', here: '', file: 'note' }, { col: 'Name', here: '', file: 'Typed' }, { col: 'Value', here: '', file: 'old' }] },
    { tab: 'Nexa', row: 'jot · Notes', what: 'added from the file', cells: [{ col: 'Kind', here: '', file: 'jot' }, { col: 'Name', here: '', file: 'Notes' }, { col: 'Value', here: '', file: 'hi' }] },
    { tab: 'Nexa', row: 'stat · Grit', what: 'stays (only on this sheet)', cells: [{ col: 'Kind', here: 'stat', file: '' }, { col: 'Name', here: 'Grit', file: '' }, { col: 'Value', here: '+1', file: '' }] },
  ]);
  assert.equal(JSON.stringify(gas.ss.getSheets().map(s => s.getDataRange().getValues())), before, 'nothing changed');
  assert.equal(merge(file).ok, true);
  assert.equal(rows('Nexa').find(r => r[1] === 'Spitfire')[2], '+3');
});
