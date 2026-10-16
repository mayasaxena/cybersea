// Signing in and out should feel instant even when the sheet is slow: the site shows the change
// straight away and checks with the sheet afterwards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, invite } from './harness.mjs';
import { KEYS } from '../fixtures/game.mjs';

const LATENCY = 1500; // every request to the fake sheet takes this long
let h;
let api;
test.before(async () => { h = await harness({ latency: String(LATENCY) }); api = h.srv.apis[0]; });
test.after(async () => { await h.close(); });

const who = p => p.$eval('.gnav .who', b => b.textContent.trim());

test('signing out of GM takes effect at once, and leaves the GM page', async () => {
  const p = await h.page();
  await p.goto(`${h.srv.site}/gm.html#join=${invite(api.url, KEYS.GM_KEY)}`);
  await p.waitForSelector('.crewcard', { timeout: 15000 });
  await p.click('.gnav .who');
  await p.click('[data-w="gm-out"]');
  const t0 = Date.now();
  await p.waitForURL(/index\.html/);
  await p.waitForSelector('.gnav .who.who-anyone');
  assert.ok(Date.now() - t0 < LATENCY, 'before the sheet could answer');
  assert.equal(await who(p), 'Sign in');
  assert.equal(await p.$$eval('.glinks a', as => as.some(a => a.textContent === 'GM')), false);
  assert.ok(await p.waitForSelector('.whoami', { timeout: 15000 }), 'and asks who you are');
});

test('signing in shows at once; the GM passphrase shows Checking… until the sheet answers', async () => {
  const p = await h.page();
  await p.goto(`${h.srv.site}/lore.html#join=${invite(api.url)}`);
  await p.waitForSelector('.gnav .who.who-anyone', { timeout: 15000 });
  await p.click('.gnav .who');
  await p.waitForSelector('[role="dialog"] [data-me="Testa"]');
  await p.click('[role="dialog"] [data-me="Testa"]');
  await p.waitForSelector('[role="dialog"] [data-me="Testa"][aria-pressed="true"]', { timeout: LATENCY / 2 });
  assert.equal(await who(p), 'Testa');
  await p.waitForSelector('main [data-act="edit"]', { timeout: LATENCY / 2 });

  await p.click('[data-w="key"]');
  await p.fill('form[data-keyform] input', KEYS.GM_KEY);
  await p.click('form[data-keyform] button');
  assert.equal(await who(p), 'Checking…');
  await p.waitForSelector('.gnav .who.who-gm', { timeout: 15000 });
  assert.deepEqual(h.errors, []);
});
