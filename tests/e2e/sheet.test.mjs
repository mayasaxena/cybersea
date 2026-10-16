// Browser tests for the character sheet against the dev server (real Code.gs, fake sheet).
// Run: NODE_PATH=$(npm root -g) node --test tests/e2e/
import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, invite } from './harness.mjs';
import { KEYS } from '../fixtures/game.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const row = (rows, kind, name) => rows.find(r => r[0] === kind && r[1] === name);

async function until(fn, ms = 6000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(100);
  }
  return last;
}

let h;
let api;
test.before(async () => { h = await harness(); api = h.srv.apis[0]; });
test.after(async () => { await h.close(); });

async function openSheet(opts) {
  const p = await h.page(opts);
  await p.goto(`${h.srv.site}/sheet.html?c=Testa#join=${invite(api.url)}`);
  await p.waitForSelector('h1.name');
  return p;
}

test('an invite opens the sheet and the passphrase leaves the URL', async () => {
  const p = await openSheet();
  assert.equal(await p.textContent('h1.name'), 'Testa');
  assert.ok(!p.url().includes('#join'), p.url());
  assert.match(p.url(), /[?&]g=/);
  assert.deepEqual(await p.$$eval('.glinks a', as => as.map(a => a.textContent)), ['Crew', 'Ship', 'Lore', 'Rules']);
  assert.ok(await p.$('.bonds .bond'), 'bonds card is shown');
});

test('pips: tracks toggle; bonds are used and restored, unmarked bonds ignore clicks', async () => {
  const p = await openSheet();
  await p.click('.harm .pip[data-j="1"]');
  await p.click('[data-pip="b:0"][data-j="0"]');  // Ship ● → used
  await p.click('[data-pip="b:0"][data-j="2"]');  // unmarked: ignored outside edit mode
  const rows = await until(async () => { const r = await h.tab(api, 'Testa'); return row(r, 'bond', 'Ship')?.[2] === '○●·' && r; });
  assert.equal(row(rows, 'track', 'Harm')[2], '●●○✕✕✕');
  assert.equal(row(rows, 'bond', 'Ship')[2], '○●·');
  // restore it
  await p.click('[data-pip="b:0"][data-j="0"]');
  assert.ok(await until(async () => row(await h.tab(api, 'Testa'), 'bond', 'Ship')[2] === '●●·'));
});

test('edit mode: text, renamed sections, new pips, and marking bonds', async () => {
  const p = await openSheet();
  await p.click('[data-act="edit"]');
  await p.fill('textarea[data-bind="sec:1:text"]', '- Dagger\n- Cloak\n- Lantern');
  const title = p.locator('input[data-bind="sec:2:title"]');
  await title.fill('Problems');
  await title.press('Tab');
  await p.click('[data-path="t:Experience"][data-act="add-pip"]');
  await p.click('[data-pip="b:1"][data-j="2"]'); // edit mode marks an unmarked bond
  await p.click('[data-act="edit"]');
  const rows = await until(async () => { const r = await h.tab(api, 'Testa'); return row(r, 'sheet', 'Problems') && row(r, 'track', 'Experience')[2].length === 7 && r; });
  assert.equal(row(rows, 'sheet', 'Kit')[2], '- Dagger\n- Cloak\n- Lantern');
  assert.equal(row(rows, 'sheet', 'Troubles'), undefined, 'old title removed');
  assert.equal(row(rows, 'track', 'Experience')[2], '●●○○○○○');
  assert.equal(row(rows, 'bond', 'Passenger')[2], '●○●');
  assert.equal(await p.textContent('.cols .card:nth-child(3) h2').catch(() => ''), 'Problems');
});

test('checklists on playbook moves save per character', async () => {
  const p = await openSheet();
  await p.click('[data-act="tab"][data-tab="moves"]');
  await p.click('details[data-id="playbook:SUMMON"] summary');
  await p.click('details[data-id="playbook:SUMMON"] li[data-ck="1"]');
  const r = await until(async () => { const x = row(await h.tab(api, 'Testa'), 'move', 'SUMMON'); return x && x[3].includes('[x] Fire burst.') && x; });
  assert.match(r[3], /\[x\] Shadow cloak\.\n\[x\] Fire burst\.\n\[x\] Shape change\./);
  // unmarked advance moves show greyed out
  assert.ok(await p.$('details.move.off[data-id="playbook:HEX"]'));
  // a roll chip shows the stat and modifier
  assert.match(await p.textContent('details[data-id="playbook:SUMMON"] .chip'), /Spitfire \+2/);
  await p.click('details[data-id="playbook:SUMMON"] .chip');
  assert.match(await p.textContent('#toast'), /SUMMON · Spitfire/);
});

test('two people editing different rows keep both changes, live', async () => {
  const a = await openSheet();
  const b = await openSheet();
  await a.click('.luck .pip[data-j="6"]');
  await b.click('.harm .pip[data-j="2"]');
  const rows = await until(async () => { const r = await h.tab(api, 'Testa'); return row(r, 'track', 'Luck')[2][6] === '●' && row(r, 'track', 'Harm')[2][2] === '●' && r; });
  assert.ok(rows, 'both edits landed');
  // each page picks up the other's change by polling
  assert.ok(await until(() => a.$eval('.harm .pip[data-j="2"]', el => el.classList.contains('on'))));
  assert.ok(await until(() => b.$eval('.luck .pip[data-j="6"]', el => el.classList.contains('on'))));
});

test('an edit made directly in the spreadsheet is not overwritten by a pending local edit', async () => {
  const p = await openSheet();
  await fetch(`${api.base}/__test/fail`, { method: 'POST', body: JSON.stringify({ count: 3 }) });
  await p.click('.luck .pip[data-j="7"]'); // stays pending while the API fails
  const sheet = await h.tab(api, 'Testa');
  const edited = sheet.slice(1).map(r => r.slice(0, 4)).map(r => (r[0] === 'sheet' && r[1] === 'Vice' ? ['sheet', 'Vice', 'Edited in the sheet.', ''] : r));
  await h.setTab(api, 'Testa', [['Kind', 'Name', 'Value', 'Notes'], ...edited]);
  const rows = await until(async () => { const r = await h.tab(api, 'Testa'); return row(r, 'track', 'Luck')[2][7] === '●' && r; }, 15000);
  assert.ok(rows, 'pending edit eventually saved');
  assert.equal(row(rows, 'sheet', 'Vice')[2], 'Edited in the sheet.');
  assert.ok(await until(async () => (await p.textContent('.cols')).includes('Edited in the sheet.')));
});

test('edits made while the sheet is unreachable survive a reload', async () => {
  const p = await openSheet();
  await fetch(`${api.base}/__test/fail`, { method: 'POST', body: JSON.stringify({ count: 50 }) });
  await p.click('.harm .pip[data-j="0"]'); // toggles whatever it is
  const want = await p.$eval('.harm .pip[data-j="0"]', el => (el.classList.contains('on') ? '●' : '○'));
  await sleep(300);
  await p.reload();
  await p.waitForSelector('h1.name');
  assert.equal(await p.$eval('.harm .pip[data-j="0"]', el => (el.classList.contains('on') ? '●' : '○')), want, 'shown from the saved pending edit');
  await fetch(`${api.base}/__test/fail`, { method: 'POST', body: JSON.stringify({ count: 0 }) });
  assert.ok(await until(async () => row(await h.tab(api, 'Testa'), 'track', 'Harm')[2][0] === want, 20000));
});

test('actions: session, chapter’s end, downtime with a rolled move, level up', async () => {
  // reset the character
  const { sampleCharacter, HEADER } = await import('../fixtures/game.mjs');
  await h.setTab(api, 'Testa', [HEADER, ...sampleCharacter]);
  const p = await openSheet();
  await p.click('[data-act="tab"][data-tab="log"]');

  await p.click('[data-kind="session"]');
  assert.match(await p.textContent('.eff'), /up to 2 \(4\)/); // already has 4 luck, Spitfire +2
  await p.click('[data-run]');

  await p.click('[data-act="tab"][data-tab="sheet"]');
  await p.click('[data-pip="b:0"][data-j="0"]'); // use a bond
  await p.click('[data-act="tab"][data-tab="log"]');
  await p.click('[data-kind="chapter"]');
  await p.selectOption('[data-pick="0"]', 'xp');
  await p.selectOption('[data-pick="1"]', 'heal');
  await p.click('[data-run]');

  await p.click('[data-kind="dt-begin"]');
  await p.check('input[name=where][value=sea]');
  await p.click('[data-run]');
  await p.click('.harm .pip[data-j="2"]'); // fresh harm during downtime
  await p.click('[data-act="dt-moves"]');
  await p.click('details[data-id="downtime:DICE GAME"] .chip');
  await p.click('[data-act="tab"][data-tab="log"]');
  assert.match(await p.textContent('.dtbar'), /At sea 1\/1/);
  await p.click('[data-kind="dt-leave"]');
  await p.click('[data-run]');

  const rows = await until(async () => { const r = await h.tab(api, 'Testa'); return r.filter(x => x[0] === 'log').length === 4 && r; });
  const logs = rows.filter(x => x[0] === 'log').map(x => `${x[2]}: ${x[3].replace(/\n/g, ' ')}`);
  assert.deepEqual(logs, [
    'Session Begins: ',
    'Chapter’s End: - Replenished 2 bonds - +1 experience - Healed 1 harm',
    'Begin Downtime: - At sea',
    `Leave Downtime: - DICE GAME (${logs[3].match(/\((\d+)\)/)?.[1]})`,
  ]);
  assert.equal(row(rows, 'track', 'Harm')[2], '○○●✕✕✕', 'harm from before downtime healed by chapter’s end; fresh harm stays');
  assert.equal(row(rows, 'track', 'Experience')[2], '●●●○○○');
  assert.match(row(rows, 'sheet', 'Experience')[2], /- 1 \(Chapter’s End\)$/);
  assert.equal(row(rows, 'bond', 'Ship')[2], '●●·');
  assert.equal(row(rows, 'state', 'downtime'), undefined);

  // level up: fill experience, raise Spitfire
  await h.setTab(api, 'Testa', [HEADER, ...rows.map(r => r.slice(0, 4)).filter(r => r[0] !== 'Kind').map(r => (r[1] === 'Experience' && r[0] === 'track' ? ['track', 'Experience', '●●●●●●', ''] : r))]);
  await p.reload();
  await p.waitForSelector('[data-kind="advance"]:not([disabled])');
  await p.click('[data-kind="advance"]');
  await p.selectOption('[data-sub="0"]', 'Spitfire');
  await p.click('[data-run]');
  const after = await until(async () => { const r = await h.tab(api, 'Testa'); return row(r, 'info', 'Level')?.[2] === '1' && r; });
  assert.equal(row(after, 'stat', 'Spitfire')[2], '+3');
  assert.equal(row(after, 'track', 'Experience')[2], '○○○○○○○');
  assert.equal(row(after, 'advance', 'trait')[2], '1');
});

test('importing the old one-page sheet replaces the character', async () => {
  const p = await openSheet();
  const old = {
    name: 'Nexa', playbook: 'Trickster', level: 0, harm: [1, 0, 0, 2, 2, 2], luck: [1, 1, 0, 0, 0, 0, 0, 0],
    stats: [{ k: 'Blood', v: 0 }, { k: 'Spitfire', v: 2 }],
    sections: [
      { id: 'vice', tab: 'sheet', title: 'Vice', track: [1], html: '<p><b>Haunted:</b> test.</p>' },
      { id: 'kit', tab: 'sheet', title: 'Kit', html: '<ul><li>Dagger,<ul><li>rusty</li></ul></li><li>Cloak</li></ul>' },
      { id: 'bonds', tab: 'sheet', type: 'bonds', title: 'Bonds', note: '(up to 8)', rows: [{ name: 'Ship', pips: [1, 2, 0] }] },
    ],
    moves: [{ id: 'm0', cat: 'playbook', name: 'SUMMON', html: '<ul class="ck"><li class="on">Shadow cloak.</li><li>Fire burst.</li></ul>' }, { id: 'm5', cat: 'basic', name: 'POKE AROUND', html: '<p>x</p>' }],
    log: [{ at: 1760000000000, title: 'Chapter’s End', items: ['+1 experience'], note: 'n' }],
  };
  await p.click('[data-act="sheet-menu"]');
  await p.fill('.panel textarea', JSON.stringify(old));
  await p.click('[data-s="import"]');
  await p.click('[data-s="import"]');
  const rows = await until(async () => { const r = await h.tab(api, 'Testa'); return row(r, 'info', 'Name')?.[2] === 'Nexa' && row(r, 'move', 'SUMMON')?.[3].startsWith('[x]') && r; });
  assert.equal(row(rows, 'sheet', 'Kit')[2], '- Dagger,\n  - rusty\n- Cloak');
  assert.equal(row(rows, 'sheet', 'Vice')[2], '**Haunted:** test.');
  assert.equal(row(rows, 'track', 'Vice')[2], '●');
  assert.equal(row(rows, 'bond', 'Ship')[2], '●○·');
  assert.equal(row(rows, 'sheet', 'Bonds')[3], '(up to 8)');
  assert.equal(row(rows, 'move', 'POKE AROUND'), undefined, 'shared moves are not copied');
  assert.equal(rows.filter(r => r[0] === 'log').length, 1);
});

test('a wrong passphrase asks for the right one, or you can carry on as crew', async () => {
  const p = await h.page();
  await p.goto(`${h.srv.site}/sheet.html?c=Testa#join=${invite(api.url, 'nope')}`);
  await p.waitForSelector('form[data-keyform]');
  await p.fill('form[data-keyform] input', KEYS.GM_KEY);
  await p.click('form[data-keyform] button');
  await p.waitForSelector('h1.name');
  assert.equal(await p.textContent('h1.name'), 'Nexa');

  const q = await h.page();
  await q.goto(`${h.srv.site}/sheet.html?c=Testa#join=${invite(api.url, 'nope')}`);
  await q.waitForSelector('form[data-keyform]');
  await q.keyboard.press('Escape');
  await q.click('.gnav .who');
  await q.click('[data-w="gm-out"]');
  await q.waitForSelector('h1.name');
  assert.equal(await q.textContent('.gnav .who'), 'Sign in');
});

test('phone width has no sideways scrolling, and no page errors anywhere', async () => {
  const p = await openSheet({ width: 380, height: 760 });
  for (const t of ['sheet', 'moves', 'notes', 'log']) {
    await p.click(`[data-act="tab"][data-tab="${t}"]`);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, t);
  }
  assert.deepEqual(h.errors, []);
});
