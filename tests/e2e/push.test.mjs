// Live updates (apps-script/Push.gs) in Chromium: the dev server's stand-in for the Firebase
// database streams the script's pings, and pages read when one comes instead of polling.
// Run: NODE_PATH=$(npm root -g) node --test tests/e2e/
import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, invite, signIn, until, sleep } from './harness.mjs';

let h;
let api;
test.before(async () => { h = await harness({ gameOptions: [{ push: true }] }); [api] = h.srv.apis; });
test.after(async () => { await h.close(); });

const NO_POLLS = 600000; // so only pings make these pages read
const track = (p, cls) => p.$$eval(`.${cls} .pip`, ps => ps.map(e => (e.classList.contains('on') ? '●' : '○')).join(''));
const harmIn = async tab => (await h.tab(api, tab)).find(r => r[0] === 'track' && r[1] === 'Harm')[2];

async function open(as) {
  const p = await h.page({ pollMs: NO_POLLS });
  const reads = { n: 0 };
  p.on('requestfinished', r => { if (r.method() === 'POST' && /"op":"read"/.test(r.postData() || '')) reads.n++; });
  const listening = p.waitForRequest(r => r.url().includes('/__fb/'));
  await p.goto(`${h.srv.site}/sheet.html?c=Testa#join=${invite(api.url)}`);
  await p.waitForSelector('h1.name');
  if (as) { await signIn(p, as); await p.waitForSelector('[data-act="edit"]'); }
  await listening;
  return { p, reads };
}

test('edits from Sheets and from other pages show at once; a page skips the ping for its own edit', async () => {
  const a = await open('Testa');
  const b = await open(null);
  await sleep(500);
  assert.equal(b.reads.n, 1, 'one read when the page opens: connecting doesn’t read again');

  // Typed in Sheets: the "On change" trigger pings, and both pages read.
  const rows = (await h.tab(api, 'Testa')).map(r => r.slice(0, 4));
  await h.setTab(api, 'Testa', rows.map(r => (r[0] === 'track' && r[1] === 'Harm' ? ['track', 'Harm', '●●○✕✕✕', ''] : r)));
  for (const { p } of [a, b]) assert.equal(await until(async () => (await track(p, 'harm')).startsWith('●●○') && 'ok', 4000), 'ok');

  // A marks harm on the site: B hears of it and reads; A doesn't read again for its own change.
  await sleep(300);
  const aReads = a.reads.n;
  const bReads = b.reads.n;
  await a.p.click('.harm .pip[data-j="2"]');
  assert.ok(await until(async () => (await harmIn('Testa')).startsWith('●●●'), 4000), 'the change reached the sheet');
  assert.equal(await until(async () => (await track(b.p, 'harm')).startsWith('●●●') && 'ok', 4000), 'ok');
  assert.ok(b.reads.n > bReads);
  await sleep(500);
  assert.equal(a.reads.n, aReads, 'no read for its own ping');
  assert.ok((await track(a.p, 'harm')).startsWith('●●●'));
  assert.deepEqual(h.errors, []);
});

test('a hidden page lets go of the connection, and reads what it missed when shown again', async () => {
  const { p } = await open(null);
  const hide = hidden => p.evaluate(on => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => on });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
  await hide(true);
  const rows = (await h.tab(api, 'Testa')).map(r => r.slice(0, 4));
  await h.setTab(api, 'Testa', rows.map(r => (r[0] === 'track' && r[1] === 'Harm' ? ['track', 'Harm', '●○○✕✕✕', ''] : r)));
  await sleep(500);
  assert.ok(!(await track(p, 'harm')).startsWith('●○○'), 'nothing read while hidden');
  await hide(false);
  assert.equal(await until(async () => (await track(p, 'harm')).startsWith('●○○') && 'ok', 4000), 'ok');
});
