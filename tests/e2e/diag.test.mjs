// diag.html against the dev server: reachability, reads, the round-trip selftest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, invite } from './harness.mjs';
import { KEYS, CODE_V2, asOldScript } from '../fixtures/game.mjs';

let h;
test.before(async () => {
  h = await harness({ games: 3, gameOptions: [{}, { codePath: CODE_V2, codeTransform: asOldScript }, { codePath: CODE_V2 }] });
});
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

test('a script deployed before crew sign-in is called out, in diag and on the site', async () => {
  const old = h.srv.apis[1];
  const p = await run(old.url, KEYS.GM_KEY);
  assert.match(await p.textContent('.dline.bad'), /older Code\.gs \(version 1; the latest is 5\)\. Players can’t join without a passphrase/);
  assert.match(await p.textContent('#out'), /signed in as gm/, 'the GM passphrase still works');

  const q = await h.page();
  await q.goto(`${h.srv.site}/#join=${invite(old.url)}`);
  await q.waitForSelector('form[data-keyform]');
  assert.match(await q.textContent('[role="dialog"]'), /script is out of date/);
  assert.doesNotMatch(await q.textContent('[role="dialog"]'), /Wrong passphrase/);
});

test('a script from before row versions is called out, and still opens', async () => {
  const p = await run(h.srv.apis[2].url, KEYS.GM_KEY);
  assert.equal(await p.$$eval('.dline.bad', ds => ds.length), 1);
  assert.match(await p.textContent('.dline.bad'), /older Code\.gs \(version 2; the latest is 5\)\. It works, but/);
  await p.click('#out a.pbtn');
  await p.waitForSelector('.crewcard');
});

test('a wrong passphrase and an unreachable URL are explained', async () => {
  let p = await run(h.srv.apis[0].url, 'nope');
  assert.match(await p.textContent('#out'), /didn’t match GM_KEY/);
  p = await run('http://127.0.0.1:9/exec', KEYS.GM_KEY);
  assert.match(await p.textContent('#out'), /No answer/);
});
