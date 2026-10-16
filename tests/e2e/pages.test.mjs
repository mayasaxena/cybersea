// Browser tests for the crew home, ship, lore and rules pages, and for running two games.
import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, invite } from './harness.mjs';
import { KEYS, gameTabs } from '../fixtures/game.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const row = (rows, kind, name) => rows.find(r => r[0] === kind && r[1] === name);
async function until(fn, ms = 6000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) { last = await fn(); if (last) return last; await sleep(100); }
  return last;
}

let h;
let g1;
let g2;
test.before(async () => {
  const noShip = gameTabs();
  delete noShip.Ship;
  h = await harness({ games: 2, gameOptions: [{}, { tabs: noShip }] });
  [g1, g2] = h.srv.apis;
});
test.after(async () => { await h.close(); });

const join = (p, api, page = '', key) => p.goto(`${h.srv.site}/${page}#join=${invite(api.url, key, api === g1 ? 'Fixture Game' : 'Second Game')}`);

test('with no game, the start page offers to join by invite link', async () => {
  const p = await h.page();
  await p.goto(`${h.srv.site}/`);
  await p.fill('[data-join] input', `${h.srv.site}/#join=${invite(g1.url)}`);
  await p.click('[data-join] button');
  await p.waitForSelector('.crewcard');
  assert.match(p.url(), /[?&]g=/);
});

test('crew home shows each character (not the ship) and makes new characters', async () => {
  const p = await h.page();
  await join(p, g1);
  await p.waitForSelector('.crewcard h2');
  const names = await until(async () => { const n = await p.$$eval('.crewcard h2', hs => hs.map(x => x.textContent)); return n.length === 1 && n; });
  assert.deepEqual(names, ['Testa']);
  assert.equal(await p.$('.crewcard[href*="ship.html"]'), null, 'the ship has its own page');
  await p.click('[data-act="new"]');
  await p.fill('[data-f="name"]', 'Matt');
  await p.fill('[data-f="player"]', 'Jo');
  await p.selectOption('[data-f="playbook"]', 'Trickster');
  await p.selectOption('[data-f="oddity"]', 'CARD SHARP');
  await p.click('[data-create]');
  await p.waitForURL(/sheet\.html\?.*c=Matt/);
  await p.waitForSelector('h1.name');
  const rows = await h.tab(g1, 'Matt');
  assert.equal(row(rows, 'info', 'Player')[2], 'Jo');
  assert.equal(row(rows, 'stat', 'Blood')[2], '-2');
  assert.equal(row(rows, 'stat', 'Spitfire')[2], '+1');
  assert.equal(row(rows, 'track', 'Harm')[2], '○○○○○○');
  assert.equal(row(rows, 'track', 'Luck')[2], '●○○○○○○○', 'luck starts at Spitfire');
  assert.equal(row(rows, 'move', 'SUMMON')[2], '●');
  assert.equal(row(rows, 'move', 'HEX'), undefined, 'advance moves start unmarked');
  assert.match(row(rows, 'sheet', 'Oddity')[2], /^\*\*CARD SHARP\*\*/);
  assert.match(row(rows, 'notes', 'Last Words')[2], /last words/);
});

test('playbooks with an extra starting move offer the pick', async () => {
  const p = await h.page();
  await join(p, g1);
  await p.waitForSelector('[data-act="new"]');
  await p.click('[data-act="new"]');
  await p.fill('[data-f="name"]', 'Bruno');
  await p.selectOption('[data-f="playbook"]', 'Brute');
  await p.selectOption('[data-f="extraMove"]', 'ROAR');
  await p.click('[data-create]');
  await p.waitForURL(/c=Bruno/);
  const rows = await h.tab(g1, 'Bruno');
  assert.deepEqual(rows.filter(r => r[0] === 'move').map(r => r[1]), ['SMASH', 'ROAR']);
});

test('ship page: ship stats roll, ship moves only', async () => {
  const p = await h.page();
  await join(p, g1, 'ship.html');
  await p.waitForSelector('h1.name');
  assert.equal(await p.textContent('h1.name'), 'The Gull');
  assert.deepEqual(await p.$$eval('.vitals .lbl', ls => ls.map(l => l.textContent)), ['Wreck', 'Renown']);
  await p.click('[data-act="roll-stat"][data-i="1"]');
  assert.match(await p.textContent('#toast'), /Speed/);
  await p.click('[data-act="tab"][data-tab="moves"]');
  assert.deepEqual(await p.$$eval('.mgroup h3', hs => hs.map(x => x.textContent)), ['Skiff moves', 'Ship moves']);
  assert.equal(await p.$('[data-tab="log"]'), null, 'no actions tab for the ship');
});

test('a game without a Ship tab offers to set one up from a ship playbook', async () => {
  const p = await h.page();
  await join(p, g2, 'ship.html');
  await p.waitForSelector('.setup');
  await p.fill('[data-setup="name"]', 'Sea Wasp');
  await p.click('[data-act="ship-create"]');
  await p.waitForSelector('h1.name');
  const rows = await h.tab(g2, 'Ship');
  assert.equal(row(rows, 'info', 'Name')[2], 'Sea Wasp');
  assert.equal(row(rows, 'stat', 'Speed')[2], '+2');
  assert.equal(row(rows, 'track', 'Wreck')[2], '○○○', 'wreck tally is Steadfast + 3');
  assert.equal(row(rows, 'move', 'SLIP AWAY')[2], '●');
});

test('lore: read, search, add, edit and delete entries', async () => {
  const p = await h.page();
  await join(p, g1, 'lore.html');
  await p.waitForSelector('main .card h2');
  assert.equal(await p.textContent('main .card h2'), 'Gull Harbor');
  await p.click('[data-act="edit"]');
  await p.click('[data-act="add"]');
  const title = p.locator('input[data-f="name"]').nth(1);
  await title.fill('The Drowned Bell');
  await title.press('Tab');
  await p.locator('textarea[data-f="value"]').nth(1).fill('- rings at low tide');
  const kind = p.locator('input[data-f="kind"]').nth(1);
  await kind.fill('Rumors');
  await kind.press('Tab');
  const rows = await until(async () => { const r = await h.tab(g1, 'Lore'); return row(r, 'Rumors', 'The Drowned Bell')?.[2] === '- rings at low tide' && r; });
  assert.ok(rows, 'new entry saved');
  assert.equal(row(rows, 'place', 'New entry'), undefined);
  await p.click('[data-act="edit"]');
  await p.fill('#q', 'bell');
  assert.deepEqual(await p.$$eval('main .card h2', hs => hs.map(x => x.textContent)), ['The Drowned Bell']);
  await p.fill('#q', '');
  await p.click('[data-act="edit"]');
  await p.click('[data-act="rm"][data-i="1"]');
  await p.click('[data-act="rm"][data-i="1"]');
  assert.ok(await until(async () => !row(await h.tab(g1, 'Lore'), 'Rumors', 'The Drowned Bell')));
});

test('rules page: sections, search, and no GM-only rules for the crew', async () => {
  const p = await h.page();
  await join(p, g1, 'rules.html');
  await p.waitForSelector('#ref .mgroup');
  const tabs = await p.$$eval('.cats button', bs => bs.map(b => b.textContent));
  assert.ok(!tabs.includes('Fates'), tabs.join());
  await p.fill('#q', 'poke');
  assert.deepEqual(await p.$$eval('#ref .mn', ms => ms.map(m => m.textContent)), ['POKE AROUND']);
  await p.fill('#q', 'trap');
  assert.match(await p.textContent('#ref'), /No matches/);
  await p.fill('#q', '');
  await p.click('.cats button:has-text("Playbooks")');
  assert.deepEqual(await p.$$eval('#ref .move.pb .mn', ms => ms.map(m => m.textContent)), ['Trickster', 'Brute', 'Skiff']);
});

test('two games stay separate, and the menu switches between them', async () => {
  const p = await h.page();
  await join(p, g1);
  await p.waitForSelector('.crewcard');
  await join(p, g2);
  await p.waitForSelector('.crewcard');
  assert.equal(await p.textContent('.gname'), 'Fixture Game 2');
  // change Testa in game 2 only
  await p.goto(p.url().replace('index.html', '').replace(/\/(\?|$)/, '/sheet.html$1') + '&c=Testa');
  await p.waitForSelector('h1.name');
  await p.click('.luck .pip[data-j="7"]');
  await until(async () => row(await h.tab(g2, 'Testa'), 'track', 'Luck')[2].endsWith('●'));
  assert.ok(!row(await h.tab(g1, 'Testa'), 'track', 'Luck')[2].endsWith('●'), 'game 1 untouched');
  await p.click('[data-nav="menu"]');
  const games = await p.$$eval('.glist a', as => as.map(a => a.textContent));
  assert.deepEqual(games.sort(), ['Fixture Game', 'Fixture Game 2']);
  await p.click('.glist a:has-text("Fixture Game"):not(:has-text("2"))');
  await p.waitForSelector('.crewcard');
  assert.equal(await p.textContent('.gname'), 'Fixture Game');
});

test('the GM link only shows with the GM passphrase', async () => {
  const p = await h.page();
  await join(p, g1, '', KEYS.GM_KEY);
  await p.waitForSelector('.crewcard');
  assert.ok(await until(async () => (await p.$$eval('.glinks a', as => as.map(a => a.textContent))).includes('GM')));
  assert.deepEqual(h.errors, []);
});
