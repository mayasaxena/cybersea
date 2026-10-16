// Browser tests for the crew home, ship, lore and rules pages, and for running two games.
import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, invite, signIn } from './harness.mjs';
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
  delete noShip.Map;
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
  assert.ok(await until(async () => (await p.textContent('.gnav .who')) === 'Matt'), 'a player\'s new character is theirs');
  assert.ok(await until(async () => (await signedIn(g1, 'Matt')) === 'yes'));
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
  assert.equal(row(rows, 'sheet', 'Kit'), undefined, 'the kit is items now');
  assert.deepEqual(rows.filter(r => r[0] === 'item').map(r => r[1]), ['Dagger', 'Cloak', 'Tarot deck']);
  assert.equal(row(rows, 'track', 'Treasure')[2], '○○○○○');
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
  await p.waitForSelector('.robar');
  assert.equal(await p.$('.setup'), null, 'setting up the ship needs a sign-in');
  await signIn(p, 'Testa');
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
  assert.equal(await p.$('[data-act="edit"]'), null, 'read-only until signed in');
  await signIn(p, 'Testa');
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

test("rules page: a row's override first, with the book's under it", async () => {
  const p = await h.page();
  await join(p, g1, 'rules.html');
  await p.waitForSelector('#ref .mgroup');
  await p.fill('#q', 'data cable');
  await p.waitForSelector('#ref details.orig');
  assert.match(await p.textContent('#ref .mbody'), /Club, sack, data cable/);
  assert.match(await p.textContent('#ref details.orig'), /Club, sack, rope/);
});

const place = (rows, name) => (rows || []).find(r => r[1] === name && !r[2]);

test("map page: from the Map tab; crew see the region's map and only the places the GM has shown, with their levels", async () => {
  const p = await h.page();
  await join(p, g1, 'map.html');
  await p.waitForSelector('.worldmap img');
  assert.equal(await p.textContent('.worldmap h2'), 'The Test Server');
  assert.ok(await until(() => p.$eval('.worldmap img', i => i.complete && i.naturalWidth === 64)), 'the picture placed in the cell loads, through the script');
  await p.waitForSelector('.loc h2');
  assert.deepEqual(await p.$$eval('.loc h2', hs => hs.map(x => x.textContent)), ['Packet Reef'], 'hidden places never reach the crew');
  assert.equal(await p.$('[data-place]'), null, 'crew can\'t change what\'s on the map');
  assert.doesNotMatch(await p.textContent('main'), /Sharks below|upside down/, 'GM notes stay with the GM');

  const g = await h.page();
  await join(g, g1, 'map.html', KEYS.GM_KEY);
  await g.waitForSelector('[data-place]');
  const names = await g.$$eval('.loc h2', hs => hs.map(x => x.textContent));
  assert.deepEqual(names.sort(), ['Hidden Dock', 'Packet Reef', 'Scrap Town'], 'the GM sees every place');
  assert.match(await g.textContent('main'), /Sharks below/);
  const town = g.locator('.loc', { hasText: 'Scrap Town' });
  assert.equal(await town.locator('[data-place]').getAttribute('aria-pressed'), 'false');
  await town.locator('[data-place]').click();
  assert.ok(await until(async () => place(await h.tab(g1, 'Map'), 'Scrap Town')?.[6] === 'on'), 'the GM\'s choice is saved in the Shown column');
  await g.click('[data-show="on"]');
  assert.deepEqual((await g.$$eval('.loc h2', hs => hs.map(x => x.textContent))).sort(), ['Packet Reef', 'Scrap Town']);

  // The crew page picks it up, levels and all.
  await p.waitForSelector('.loc:has-text("Scrap Town")', { timeout: 8000 });
  const st = p.locator('.loc', { hasText: 'Scrap Town' });
  assert.match(await st.locator('.levels .rich').textContent(), /The docks/);
  await st.locator('[data-lv="1"]').click();
  await p.waitForSelector('.loc [data-lv="1"][aria-selected="true"]');
  assert.match(await p.locator('.loc', { hasText: 'Scrap Town' }).locator('.levels .rich').textContent(), /The market/);
  const lv2 = p.locator('.loc', { hasText: 'Scrap Town' }).locator('.levels img');
  assert.ok(await until(() => lv2.evaluate(i => i.complete && i.naturalWidth === 32)), 'the level\'s picture loads');
  assert.equal(await p.locator('.loc', { hasText: 'Packet Reef' }).locator('.levels').count(), 0, 'a place with no levels is one picture');
  await p.fill('#q', 'market');
  assert.deepEqual(await p.$$eval('.loc h2', hs => hs.map(x => x.textContent)), ['Scrap Town'], 'a level\'s text finds its place');

  // Off again: gone for the crew.
  await g.locator('.loc', { hasText: 'Scrap Town' }).locator('[data-place]').click();
  assert.ok(await until(async () => place(await h.tab(g1, 'Map'), 'Scrap Town')?.[6] === ''));
  await p.fill('#q', '');
  assert.ok(await until(async () => !(await p.$('.loc:has-text("Scrap Town")'))), 'the crew page drops it');
});

test('map page: with no Map tab, the GM is told to add one', async () => {
  const g = await h.page();
  await join(g, g2, 'map.html', KEYS.GM_KEY);
  await g.waitForSelector('main .empty:has-text("Add a Map tab")');
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
  await signIn(p, 'Testa');
  await p.waitForSelector('[data-act="edit"]');
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

const who = p => p.$eval('.gnav .who', b => b.textContent.trim());
const TESTA_IN = '.crewcard[href*="c=Testa"] .pill.in';
const signedIn = async (api, name) => row(await h.tab(api, name), 'signin', 'Signed in')?.[2];

test('players sign in as a character with a click, and out again; everyone sees it', async () => {
  const p = await h.page();
  await join(p, g1);
  await p.waitForSelector('.whoami');
  assert.equal(await who(p), 'Sign in');
  await p.click('.whoami [data-me="Testa"]');
  await p.waitForSelector('.crewcard .pill.me');
  assert.equal(await who(p), 'Testa');
  assert.equal(await p.$('.whoami'), null);
  assert.ok(await until(async () => (await signedIn(g1, 'Testa')) === 'yes'), 'marked in the sheet');
  await p.reload();
  await p.waitForSelector('.crewcard .pill.me');
  assert.equal(await who(p), 'Testa', 'remembered on this device');

  // another player sees Testa is taken
  const q = await h.page();
  await join(q, g1);
  await q.waitForSelector('.whoami .pick .sub');
  assert.equal(await q.textContent('.whoami [data-me="Testa"] .sub'), 'signed in');
  await q.waitForSelector(TESTA_IN);

  // clicking Testa again signs out
  await p.click('.gnav .who');
  await p.waitForSelector('[role="dialog"] [data-me="Testa"][aria-pressed="true"]');
  assert.ok(await p.$('[role="dialog"] a[href*="c=Testa"]'), 'links to my sheet');
  await p.click('[role="dialog"] [data-me="Testa"]');
  assert.ok(await until(async () => (await who(p)) === 'Sign in'));
  assert.ok(await until(async () => (await signedIn(g1, 'Testa')) === ''), 'cleared in the sheet');
  await p.keyboard.press('Escape');
  assert.equal(await p.$('.crewcard .pill.me'), null);
  assert.ok(await until(async () => !(await q.$(TESTA_IN))), 'the other player sees it too');

  // signed in by hand in the sheet shows up as well
  await h.setTab(g1, 'Testa', [...(await h.tab(g1, 'Testa'))].map(r => r.slice(0, 4)).filter(r => r[0] !== 'signin').concat([['signin', 'Signed in', 'yes', '']]));
  assert.ok(await until(() => q.$(TESTA_IN)));
  await h.setTab(g1, 'Testa', [...(await h.tab(g1, 'Testa'))].map(r => r.slice(0, 4)).filter(r => r[0] !== 'signin'));
});

test('the GM badge, and the crew invite needs no passphrase', async () => {
  const p = await h.page();
  await p.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: h.srv.site });
  await join(p, g1, '', KEYS.GM_KEY);
  assert.ok(await until(async () => (await who(p)) === 'GM'));
  assert.equal(await p.$('.whoami'), null, 'the GM isn\'t asked');
  await p.click('[data-nav="menu"]');
  await p.click('[data-m="invite"]');
  await p.waitForSelector('[data-msg]:has-text("Send it to the crew")');
  const url = await p.evaluate(() => navigator.clipboard.readText());
  const inv = JSON.parse(Buffer.from(url.split('#join=')[1], 'base64url').toString());
  assert.equal(inv.key, undefined, 'no passphrase in the crew invite');

  const q = await h.page();
  await q.goto(url);
  await q.waitForSelector('.whoami');
  assert.equal(await who(q), 'Sign in');
  assert.equal(await q.$$eval('.glinks a', as => as.some(a => a.textContent === 'GM')), false, 'crew access, not GM');
});

test('the GM link only shows with the GM passphrase', async () => {
  const p = await h.page();
  await join(p, g1, '', KEYS.GM_KEY);
  await p.waitForSelector('.crewcard');
  assert.ok(await until(async () => (await p.$$eval('.glinks a', as => as.map(a => a.textContent))).includes('GM')));
  assert.deepEqual(h.errors, []);
});

test('the menu button shows turning sync arrows while loading, then the dots', async () => {
  const slow = await harness({ latency: 800 });
  try {
    const p = await slow.page();
    await p.goto(`${slow.srv.site}/#join=${invite(slow.srv.apis[0].url)}`);
    await p.waitForSelector('.gnav [data-nav="menu"].syncing svg');
    assert.equal(await p.$eval('.gnav .syncing svg', el => getComputedStyle(el).animationName), 'spin');
    await p.waitForSelector('.gnav [data-nav="menu"]:not(.syncing)', { timeout: 8000 });
    assert.equal(await p.$$eval('.gnav [data-nav="menu"] circle', c => c.length), 3);
    assert.equal(await p.$('.sdot'), null);
    await p.emulateMedia({ reducedMotion: 'reduce' });
    await p.reload();
    await p.waitForSelector('.gnav [data-nav="menu"].syncing svg');
    assert.equal(await p.$eval('.gnav .syncing svg', el => getComputedStyle(el).animationName), 'none');
  } finally { await slow.close(); }
});
