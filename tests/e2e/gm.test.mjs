// Browser tests for the GM page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, invite } from './harness.mjs';
import { KEYS } from '../fixtures/game.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const row = (rows, kind, name) => rows.find(r => r[0] === kind && r[1] === name);
async function until(fn, ms = 6000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) { last = await fn(); if (last) return last; await sleep(100); }
  return last;
}

let h;
let api;
test.before(async () => { h = await harness(); api = h.srv.apis[0]; });
test.after(async () => { await h.close(); });

async function openGm(key = KEYS.GM_KEY) {
  const p = await h.page();
  await p.goto(`${h.srv.site}/gm.html#join=${invite(api.url, key)}`);
  return p;
}

test('the crew passphrase is turned away; the GM passphrase opens the page', async () => {
  const p = await openGm(KEYS.CREW_KEY);
  await p.waitForSelector('[data-act="gm-key"]');
  await p.click('[data-act="gm-key"]');
  await p.fill('form[data-keyform] input', KEYS.GM_KEY);
  await p.click('form[data-keyform] button');
  await p.waitForSelector('.crewcard');
  assert.deepEqual(await p.$$eval('.crewcard h2', hs => hs.map(x => x.textContent)), ['Testa', 'The Gull']);
});

test('the crew view updates live and flags a marked vice', async () => {
  const p = await openGm();
  await p.waitForSelector('.crewcard');
  const sheet = await h.tab(api, 'Testa');
  await h.setTab(api, 'Testa', sheet.map(r => r.slice(0, 4)).map(r => (r[0] === 'track' && r[1] === 'Vice' ? ['track', 'Vice', '●', ''] : r)));
  assert.ok(await until(() => p.$('.crewcard .pill.vice')));
});

test('NPCs: tag definitions, harm by size, renames carry harm, deletes', async () => {
  const p = await openGm();
  await p.waitForSelector('[data-tab="npcs"]');
  await p.click('[data-tab="npcs"]');
  assert.equal(await p.getAttribute('.tagchip:has-text("jumpy")', 'title'), 'Startles easily.');
  await p.click('[data-act="add-npc"][data-harm="4"]');
  const name = p.locator('input[data-f="name"]').last();
  await name.fill('Dockmaster Ilse');
  await name.press('Tab');
  await p.locator('input[data-f="value"]').last().fill('loud, tough-2');
  await p.click('[data-act="edit"]');
  await p.click('.card:has-text("Dockmaster Ilse") [data-gpip][data-j="0"]');
  const rows = await until(async () => { const r = await h.tab(api, 'GM'); return row(r, 'track', 'Dockmaster Ilse')?.[2] === '●○○○' && r; });
  assert.equal(row(rows, 'npc', 'Dockmaster Ilse')[2], 'loud, tough-2');
  assert.equal(row(rows, 'npc', 'New NPC'), undefined);
  assert.equal(row(rows, 'track', 'New NPC'), undefined, 'harm row renamed with the NPC');
  await p.click('[data-act="edit"]');
  const del = p.locator('.card:has(input[value="Dockmaster Ilse"]) [data-act="rm"]');
  await del.click();
  await del.click();
  assert.ok(await until(async () => { const r = await h.tab(api, 'GM'); return !row(r, 'npc', 'Dockmaster Ilse') && !row(r, 'track', 'Dockmaster Ilse'); }));
});

test('notes: secrets and clocks', async () => {
  const p = await openGm();
  await p.waitForSelector('[data-tab="notes"]');
  await p.click('[data-tab="notes"]');
  assert.match(await p.textContent('.gmview'), /The map is fake\./);
  await p.click('[data-act="edit"]');
  await p.click('[data-act="add-note"][data-kind="clock"]');
  await p.click('[data-act="edit"]');
  await p.click('.card:has-text("New clock") [data-gpip][data-j="0"]');
  await p.click('.card:has-text("New clock") [data-gpip][data-j="1"]');
  assert.ok(await until(async () => row(await h.tab(api, 'GM'), 'clock', 'New clock')?.[2] === '●●○○○○'));
});

test('reference: Fates material, a tags glossary, and search', async () => {
  const p = await openGm();
  await p.waitForSelector('[data-tab="ref"]');
  await p.click('[data-tab="ref"]');
  assert.match(await p.textContent('#ref'), /SPRING A TRAP/);
  await p.click('[data-ref="tags"]');
  assert.match(await p.textContent('#ref'), /jumpy\s*Startles easily\./i);
  await p.fill('#q', 'trap');
  assert.deepEqual(await p.$$eval('#ref .mn', ms => ms.map(m => m.textContent)), ['SPRING A TRAP']);
  assert.deepEqual(h.errors, []);
});
