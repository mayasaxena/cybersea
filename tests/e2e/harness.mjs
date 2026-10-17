// Shared setup for browser tests: dev server (real Code.gs on a fake sheet) + Chromium.
import { createRequire } from 'node:module';
import { start } from '../../tools/dev-server.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright'); // run with NODE_PATH=$(npm root -g)

export const sleep = ms => new Promise(r => setTimeout(r, ms));

// fn's first truthy answer, polled every 100 ms for up to ms (then its last answer).
export async function until(fn, ms = 6000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(100);
  }
  return last;
}

const isRead = r => r.method() === 'POST' && /"op":"read"/.test(r.postData() || '');

// Resolves once the page has made n more reads of the sheet and handled their answers: "several
// polls went by" without guessing how long that takes.
export function polls(p, n = 3) {
  return new Promise(resolve => {
    let k = 0;
    const on = r => {
      if (!isRead(r) || ++k < n) return;
      p.off('requestfinished', on);
      p.evaluate(() => new Promise(requestAnimationFrame)).then(resolve, resolve);
    };
    p.on('requestfinished', on);
  });
}

// From now on, how many requests made after this call the sheet has answered.
export function answersFrom(p) {
  const mine = new Set();
  let done = 0;
  p.on('request', r => { if (r.method() === 'POST') mine.add(r); });
  p.on('requestfinished', r => { if (mine.has(r)) done++; });
  return () => done;
}

// No key: a crew invite.
export const invite = (api, key = '', name = 'Fixture Game') =>
  Buffer.from(JSON.stringify({ api, ...(key ? { key } : {}), name })).toString('base64url');

// Sign in as a character from the top bar, as a player would (editing needs it).
export async function signIn(p, name) {
  await p.waitForSelector('.gnav .who:not(.who-wait)');
  await p.click('.gnav .who');
  await p.click(`[role="dialog"] [data-me="${name}"]`);
  await p.waitForSelector(`[role="dialog"] [data-me="${name}"][aria-pressed="true"]`);
  await p.keyboard.press('Escape');
}

export async function harness({ games = 1, latency, gameOptions } = {}) {
  const srv = await start({ sitePort: 0, apiPort: 0, games, latency, gameOptions });
  const browser = await chromium.launch();
  const errors = [];
  const contexts = [];
  async function page({ width = 900, height = 900, pollMs = 400, undoMs = 1500 } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height } });
    contexts.push(ctx);
    await ctx.addInitScript(([ms, u]) => { try { localStorage.setItem('cybersea:pollMs', String(ms)); localStorage.setItem('cybersea:undoMs', String(u)); } catch {} }, [pollMs, undoMs]);
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message));
    // Injected Google error pages (POST /__test/fail) have no CORS header, so the browser logs them; that's expected.
    p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|\/echo\/\d+' \(redirected/.test(m.text())) errors.push(m.text()); });
    return p;
  }
  const tab = async (api, name) => (await (await fetch(`${api.base}/__test/tab?name=${encodeURIComponent(name)}`)).json()).rows;
  const setTab = (api, name, rows) => fetch(`${api.base}/__test/set`, { method: 'POST', body: JSON.stringify({ tab: name, rows }) });
  return {
    srv, browser, page, errors, tab, setTab,
    async close() { for (const c of contexts) await c.close(); await browser.close(); await srv.close(); },
  };
}
