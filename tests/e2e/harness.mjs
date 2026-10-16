// Shared setup for browser tests: dev server (real Code.gs on a fake sheet) + Chromium.
import { createRequire } from 'node:module';
import { start } from '../../tools/dev-server.mjs';
import { KEYS } from '../fixtures/game.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright'); // run with NODE_PATH=$(npm root -g)

export const invite = (api, key = KEYS.CREW_KEY, name = 'Fixture Game') =>
  Buffer.from(JSON.stringify({ api, key, name })).toString('base64url');

export async function harness({ games = 1, latency, gameOptions } = {}) {
  const srv = await start({ sitePort: 0, apiPort: 0, games, latency, gameOptions });
  const browser = await chromium.launch();
  const errors = [];
  const contexts = [];
  async function page({ width = 900, height = 900, pollMs = 400 } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height } });
    contexts.push(ctx);
    await ctx.addInitScript(ms => { try { localStorage.setItem('cybersea:pollMs', String(ms)); } catch {} }, pollMs);
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
