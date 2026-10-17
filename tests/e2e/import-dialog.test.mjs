// The Cybersea menu's "Import an xlsx…" dialog (Import.gs's REPLACE_DIALOG_HTML) in Chromium,
// with google.script.run calling the real Import.gs on a fake sheet.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { createGas, loadCodeGs } from '../../tools/gas-fake.mjs';
import { makeXlsx } from '../fixtures/xlsx.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright'); // run with NODE_PATH=$(npm root -g)

const H = ['Kind', 'Name', 'Value', 'Notes'];
const RULES = ['Kind', 'Group', 'Name', 'Text', 'Meta', 'Vis'];

// google.script.run: each call goes to the page's gas() binding, which runs the script function.
const STUB = `<script>
  window.closed_ = false;
  google = { host: { close: () => { window.closed_ = true; } } };
  Object.defineProperty(google, 'script', { get: () => ({ host: google.host, run: (() => {
    const chain = (ok, bad) => new Proxy({}, { get: (_, name) => {
      if (name === 'withSuccessHandler') return f => chain(f, bad);
      if (name === 'withFailureHandler') return f => chain(ok, f);
      return (...args) => gas(name, args).then(r => ok && ok(r), e => bad && bad(e));
    } });
    return chain();
  })() }) });
</script>`;

let browser;
test.before(async () => { browser = await chromium.launch(); });
test.after(async () => { await browser?.close(); });

async function open() {
  const gas = createGas({
    name: 'Cybersea',
    props: { GM_KEY: 'gm-pass' },
    tabs: { Rules: [RULES, ['move', 'basic', 'POKE', 'Old.', '', 'crew']], Nexa: [H, ['info', 'Name', 'Nexa', '']], Old: [H] },
  });
  const { ctx } = loadCodeGs(gas);
  const p = await browser.newPage();
  const calls = [];
  await p.exposeFunction('gas', (name, args) => { calls.push(name); return JSON.parse(JSON.stringify(ctx[name](...args))); });
  const html = vm.runInContext('REPLACE_DIALOG_HTML', ctx);
  await p.setContent(html.replace('<style>', `${STUB}<style>`));
  return { p, gas, calls, names: () => gas.ss.getSheets().map(s => s.getName()) };
}

const xlsx = makeXlsx([
  { name: 'Rules', rows: [RULES, ['move', 'basic', 'POKE', 'New.', '', 'crew']] },
  { name: 'Nexa', rows: [H, ['info', 'Name', 'Nexa', ''], ['stat', 'Snark', '+1', '']] },
  { name: 'Vex', rows: [H, ['info', 'Name', 'Vex', '']] },
]);

test('lists the file’s tabs, replaces the ticked ones whole, removes a ticked sheet-only tab, then closes', async () => {
  const { p, gas, names } = await open();
  await p.setInputFiles('#file', { name: 'game.xlsx', mimeType: 'application/octet-stream', buffer: xlsx });
  await p.waitForSelector('input[data-kind="file"][value="Vex"]');
  assert.match(await p.textContent('label:has(input[value="Nexa"])'), /updates this sheet’s/);
  assert.match(await p.textContent('label:has(input[value="Vex"])'), /new tab/);
  await p.uncheck('input[data-kind="file"][value="Nexa"]');
  assert.equal(await p.$eval('#all', a => a.indeterminate), true);
  await p.check('input[data-kind="remove"][value="Old"]');
  await p.uncheck('#merge');
  await p.click('#go');
  await p.waitForFunction(() => /^Done:/.test(document.getElementById('msg').textContent));
  await p.waitForFunction(() => window.closed_, null, { timeout: 4000 });
  assert.deepEqual(names().filter(n => n !== '_Import'), ['Rules', 'Nexa', 'Vex']);
  assert.equal(gas.ss.getSheetByName('Rules').getRange(2, 4).getValue(), 'New.');
  assert.equal(gas.ss.getSheetByName('Nexa').getLastRow(), 2, 'the unticked tab stays as it was');
});

test('keeping this sheet’s changes: shows each conflict, imports with the choices made, and says what it kept', async () => {
  const { p, gas, calls } = await open();
  await p.setInputFiles('#file', { name: 'game.xlsx', mimeType: 'application/octet-stream', buffer: xlsx });
  await p.waitForSelector('input[data-kind="file"][value="Vex"]');
  assert.equal(await p.isChecked('#merge'), true, 'the default');
  await p.click('#go');
  // Rules has POKE as "Old." here and "New." in the file, with no earlier import to tell which changed.
  await p.waitForSelector('.conflict');
  assert.match(await p.textContent('.conflict'), /Rules · move · basic · POKE[\s\S]*Old\.[\s\S]*New\./);
  assert.equal(await p.textContent('#go'), 'Import with these choices');
  assert.equal(gas.ss.getSheetByName('Rules').getRange(2, 4).getValue(), 'Old.', 'nothing changed yet');
  await p.click('.bulk button:nth-child(2)'); // All: the file's
  calls.length = 0;
  await p.click('#go');
  await p.waitForFunction(() => /^Done:/.test(document.getElementById('msg').textContent));
  assert.match(await p.textContent('#msg'), /Rules: 1 updated/);
  assert.match(await p.textContent('#msg'), /Nexa: 1 added/);
  assert.equal(await p.$$eval('.conflict', d => d.length), 0);
  assert.equal(gas.ss.getSheetByName('Rules').getRange(2, 4).getValue(), 'New.');
  assert.ok(gas.ss.getSheetByName('Old'), 'unticked sheet-only tabs stay');
  assert.ok(gas.ss.getSheetByName('_Import').isSheetHidden());
  assert.deepEqual(calls, ['replaceWithXlsx']);
});

test('Replace waits for a ticked tab; a file too big is turned down before it is sent', async () => {
  const { p, calls } = await open();
  await p.setInputFiles('#file', { name: 'game.xlsx', mimeType: 'application/octet-stream', buffer: xlsx });
  await p.waitForSelector('#all');
  await p.uncheck('#all');
  assert.equal(await p.isDisabled('#go'), true);
  await p.check('#all');
  assert.equal(await p.isDisabled('#go'), false);
  calls.length = 0;
  await p.setInputFiles('#file', { name: 'big.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.alloc(6 * 1024 * 1024) });
  await p.waitForFunction(() => /too big/.test(document.getElementById('msg').textContent));
  assert.deepEqual(calls, []);
  assert.equal(await p.isDisabled('#go'), true);
});

test('an error from the script shows in the dialog', async () => {
  const { p } = await open();
  await p.setInputFiles('#file', { name: 'notes.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('not a zip') });
  await p.waitForSelector('#msg.err');
  assert.notEqual((await p.textContent('#msg')).trim(), '');
});
