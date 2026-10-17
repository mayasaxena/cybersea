// Browser tests for the GM page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, invite, until, polls, sleep } from './harness.mjs';
import { KEYS } from '../fixtures/game.mjs';

const row = (rows, kind, name) => rows.find(r => r[0] === kind && r[1] === name);

let h;
let api;
test.before(async () => { h = await harness(); api = h.srv.apis[0]; });
test.after(async () => { await h.close(); });

async function openGm(key = KEYS.GM_KEY) {
  const p = await h.page();
  await p.goto(`${h.srv.site}/gm.html#join=${invite(api.url, key)}`);
  return p;
}

test('crew (no passphrase) are turned away; the GM passphrase opens the page', async () => {
  const p = await openGm('');
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

test('crew cards show the GM each sheet at a glance: vice, moves, ship cargo', async () => {
  const p = await openGm();
  await p.waitForSelector('.crewcard');
  const testa = await p.textContent('.crewcard:has-text("Testa")');
  assert.match(testa, /Vice\s*Haunted/);
  assert.match(testa, /Moves\s*SUMMON, HAGGLE/);
  assert.match(await p.textContent('.crewcard[href*="ship.html"]'), /Cargo\s*Crate of limes/);
});

test('NPCs: tag definitions, harm by size, renames carry harm, deletes', async () => {
  const p = await openGm();
  await p.waitForSelector('[data-tab="npcs"]');
  await p.click('[data-tab="npcs"]');
  assert.equal(await p.getAttribute('a.tagchip:has-text("jumpy")', 'title'), 'jumpy: Startles easily.', 'an npc tag the Rules tab defines is a chip linking to it');
  assert.equal(await p.textContent('.card:has-text("Captain Vex") .tagtext'), 'loud', 'the rest are free text');
  await p.click('[data-act="add-npc"][data-harm="4"]');
  const name = p.locator('input[data-f="name"]').last();
  await name.fill('Dockmaster Ilse');
  await name.press('Tab');
  const tag = p.locator('[id^="newtag-npc-"]').last();
  await tag.fill('jumpy');
  await tag.press('Enter');
  await p.locator('[id^="newtag-npc-"]').last().fill('tough-2');
  await p.locator('[data-act="add-tag"]').last().click();
  assert.deepEqual(await p.locator('.card:has(input[value="Dockmaster Ilse"]) .tagchip').allTextContents(), ['jumpy']);
  await p.click('[data-act="edit"]');
  await p.click('.card:has-text("Dockmaster Ilse") [data-gpip][data-j="0"]');
  const rows = await until(async () => { const r = await h.tab(api, 'GM'); return row(r, 'track', 'Dockmaster Ilse')?.[2] === '●○○○' && r; });
  assert.equal(row(rows, 'npc', 'Dockmaster Ilse')[2], 'jumpy, tough-2');
  assert.equal(row(rows, 'npc', 'New NPC'), undefined);
  assert.equal(row(rows, 'track', 'New NPC'), undefined, 'harm row renamed with the NPC');
  await p.click('[data-act="edit"]');
  const del = p.locator('.card:has(input[value="Dockmaster Ilse"]) [data-act="rm"]');
  await del.click();
  await del.click();
  await p.click('.toast .tact'); // Undo: it and its harm never leave the sheet
  await p.waitForSelector('.card input[value="Dockmaster Ilse"]');
  await sleep(2000);
  assert.ok(row(await h.tab(api, 'GM'), 'npc', 'Dockmaster Ilse') && row(await h.tab(api, 'GM'), 'track', 'Dockmaster Ilse'));
  await del.click();
  await del.click();
  assert.ok(await until(async () => { const r = await h.tab(api, 'GM'); return !row(r, 'npc', 'Dockmaster Ilse') && !row(r, 'track', 'Dockmaster Ilse'); }));
});

test('polls don\'t redraw the page under the GM\'s cursor', async () => {
  const p = await openGm();
  await p.waitForSelector('[data-tab="npcs"]');
  await p.click('[data-tab="npcs"]');
  await p.click('[data-act="edit"]');
  await p.click('[data-act="add-npc"][data-harm="1"]');
  const field = p.locator('input[data-f="name"]').last();
  await field.click();
  await p.evaluate(() => { window.__field = document.activeElement; });
  await polls(p);
  assert.equal(await p.evaluate(() => document.activeElement === window.__field && document.contains(window.__field)), true);
  await p.click('[data-act="edit"]');
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
  await p.waitForFunction(() => [...document.querySelectorAll('#ref .mn')].map(m => m.textContent).join() === 'SPRING A TRAP');
  assert.deepEqual(h.errors, []);
});
