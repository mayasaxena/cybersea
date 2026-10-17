// Signing in and out should feel instant even when the sheet is slow: the site shows the change
// straight away and checks with the sheet afterwards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, invite, signIn } from './harness.mjs';
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
  const field = await p.$eval('form[data-keyform] input', i => [i.type, i.autocomplete, i.hasAttribute('data-1p-ignore')]);
  assert.deepEqual(field, ['password', 'off', true], 'masked, but not offered to password managers as a login');
  await p.fill('form[data-keyform] input', KEYS.GM_KEY);
  await p.click('form[data-keyform] button');
  assert.equal(await who(p), 'Checking…');
  await p.waitForSelector('.gnav .who.who-gm', { timeout: 15000 });
  assert.deepEqual(h.errors, []);
});

// The GM plays no character, so the two sign-ins push each other out.
const signedIn = async name => (await h.tab(api, name)).find(r => r[0] === 'signin')?.[2] || '';
const until = async (fn, ms = 15000) => { const t = Date.now() + ms; while (!(await fn())) { if (Date.now() > t) throw new Error('timed out'); await new Promise(r => setTimeout(r, 100)); } };

test('signing in as the GM signs your character out, and signing out of GM leaves you signed out', async () => {
  const p = await h.page();
  await p.goto(`${h.srv.site}/index.html#join=${invite(api.url)}`);
  await signIn(p, 'Testa');
  await until(async () => (await signedIn('Testa')) === 'yes');
  await p.click('.gnav .who');
  await p.click('[data-w="key"]');
  await p.fill('form[data-keyform] input', KEYS.GM_KEY);
  await p.click('form[data-keyform] button');
  await p.waitForSelector('.gnav .who.who-gm', { timeout: 15000 });
  await until(async () => (await signedIn('Testa')) === '');

  await p.click('.gnav .who');
  await p.click('[data-w="gm-out"]');
  await p.waitForSelector('.gnav .who.who-anyone');
  await p.waitForTimeout(LATENCY * 2); // polls come and go
  assert.equal(await who(p), 'Sign in', 'not back as Testa, nor as the GM');
  assert.equal(await signedIn('Testa'), '');
  assert.deepEqual(h.errors, []);
});

test('picking a character while signed in as the GM signs out of GM', async () => {
  const p = await h.page();
  await p.goto(`${h.srv.site}/gm.html#join=${invite(api.url, KEYS.GM_KEY)}`);
  await p.waitForSelector('.crewcard', { timeout: 15000 });
  await p.click('.gnav .who');
  await p.click('[role="dialog"] [data-me="Testa"]');
  await p.waitForURL(/index\.html/);
  await p.waitForSelector('.gnav .who.who-me');
  assert.equal(await who(p), 'Testa');
  await p.waitForTimeout(LATENCY * 2);
  assert.equal(await who(p), 'Testa', 'stays Testa once the sheet answers');
  assert.equal(await p.$$eval('.glinks a', as => as.some(a => a.textContent === 'GM')), false);
  await until(async () => (await signedIn('Testa')) === 'yes');
  assert.deepEqual(h.errors, []);
});
