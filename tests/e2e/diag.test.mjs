// diag.html against the dev server: reachability, reads, the round-trip selftest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './harness.mjs';
import { KEYS } from '../fixtures/game.mjs';

let h;
test.before(async () => { h = await harness(); });
test.after(async () => { await h.close(); });

async function run(api, key) {
  const p = await h.page();
  await p.goto(`${h.srv.site}/diag.html`);
  await p.fill('[name=api]', api);
  await p.fill('[name=key]', key);
  await p.click('#diag button');
  await p.waitForFunction(() => document.querySelector('#out .dline') && !document.querySelector('.dline.wait'), null, { timeout: 8000 });
  return p;
}

test('a good deployment passes every check and can be opened', async () => {
  const p = await run(h.srv.apis[0].url, KEYS.GM_KEY);
  assert.equal(await p.$$eval('.dline.bad', ds => ds.length), 0);
  assert.match(await p.textContent('#out'), /signed in as gm/);
  assert.match(await p.textContent('#out'), /All 15 test values came back exactly/);
  await p.click('#out a.pbtn');
  await p.waitForSelector('.crewcard');
});

test('a wrong passphrase and an unreachable URL are explained', async () => {
  let p = await run(h.srv.apis[0].url, 'nope');
  assert.match(await p.textContent('#out'), /didn’t match CREW_KEY or GM_KEY/);
  p = await run('http://127.0.0.1:9/exec', KEYS.GM_KEY);
  assert.match(await p.textContent('#out'), /No answer/);
});
