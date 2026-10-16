#!/usr/bin/env node
// Local development server: serves the site and runs the real apps-script/Code.gs against an
// in-memory fake spreadsheet, imitating how a deployed Apps Script web app behaves:
//   - the API is on a different port (origin) from the site;
//   - POST /exec runs doPost, then answers 302 to a one-time /echo/<id> URL that returns the
//     JSON with Access-Control-Allow-Origin: *;
//   - OPTIONS (a CORS preflight) gets 405 with no CORS headers, as Apps Script does, so any
//     request that would need a preflight fails here too.
//
//   node tools/dev-server.mjs                         site :8080, one fixture game on :8081
//   GAMES=2 LATENCY=300-1500 node tools/dev-server.mjs
//   RULES_JSON=/path/rules.json node tools/dev-server.mjs   preview with real rules (local only)
//
// Test hooks on each API port: POST /__test/set {tab, rows} (replace a tab as if edited by hand),
// GET /__test/tab?name=X (dump display values), POST /__test/fail {count} (next N echoes 500).

import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGas, loadCodeGs, seedTab } from './gas-fake.mjs';
import { gameTabs, KEYS, RULES_HEADER } from '../tests/fixtures/game.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

function parseLatency(spec) {
  if (!spec) return () => 0;
  const [a, b = a] = String(spec).split('-').map(Number);
  return () => a + Math.random() * (b - a);
}

export function makeGame({ name = 'Fixture Game', tabs = gameTabs(), keys = KEYS, rulesJson, codeTransform } = {}) {
  if (rulesJson) {
    const recs = JSON.parse(readFileSync(rulesJson, 'utf8'));
    tabs = { ...tabs, Rules: [RULES_HEADER, ...recs.map(r => [r.kind, r.group, r.name, r.text, r.meta || '', r.vis || 'crew'])] };
  }
  const gas = createGas({ name, tabs, props: keys, asText: true });
  return { gas, api: loadCodeGs(gas, undefined, codeTransform) };
}

function siteHandler(req, res) {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT) || /[\\/]\.|node_modules|[\\/]tools[\\/]extract/.test(file.slice(ROOT.length))) {
    res.writeHead(404).end('Not found');
    return;
  }
  if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(readFileSync(file));
}

function apiHandler(game, latency) {
  const outputs = new Map();
  let failNext = 0;
  let n = 0;
  return (req, res) => {
    const url = new URL(req.url, 'http://x');
    const body = () => new Promise(ok => { let b = ''; req.on('data', c => { b += c; }); req.on('end', () => ok(b)); });
    const json = (code, obj, extra = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', ...extra }); res.end(JSON.stringify(obj)); };
    const redirect = out => {
      const id = String(++n);
      outputs.set(id, out);
      // Google's 302 carries ACAO:* too; without it the browser would drop the redirect.
      setTimeout(() => { res.writeHead(302, { Location: `/echo/${id}`, 'Access-Control-Allow-Origin': '*' }); res.end(); }, latency());
    };

    if (req.method === 'OPTIONS') { res.writeHead(405).end(); return; }

    if (url.pathname === '/exec' && req.method === 'GET') {
      redirect(game.api.doGet({ parameter: Object.fromEntries(url.searchParams) }));
      return;
    }
    if (url.pathname === '/exec' && req.method === 'POST') {
      body().then(text => redirect(game.api.doPostRaw(text)));
      return;
    }
    if (url.pathname.startsWith('/echo/')) {
      const id = url.pathname.slice(6);
      const out = outputs.get(id);
      outputs.delete(id);
      if (failNext > 0) {
        failNext--;
        res.writeHead(500, { 'Content-Type': 'text/html' }).end('<html><body>Sorry, unable to open the file at this time.</body></html>');
        return;
      }
      if (!out) { res.writeHead(404, { 'Content-Type': 'text/html' }).end('<html>Not found</html>'); return; }
      json(200, out, { 'Access-Control-Allow-Origin': '*' });
      return;
    }

    // test hooks (same-origin only: no CORS headers)
    if (url.pathname === '/__test/set' && req.method === 'POST') {
      body().then(text => {
        const { tab, rows } = JSON.parse(text);
        const ss = game.gas.ss;
        const old = ss.getSheets().find(s => s.getName().toLowerCase() === tab.toLowerCase());
        if (old) ss.deleteSheet(old);
        seedTab(ss, tab, rows, true);
        json(200, { ok: true });
      });
      return;
    }
    if (url.pathname === '/__test/tab') {
      const sh = game.gas.ss.getSheets().find(s => s.getName() === url.searchParams.get('name'));
      const last = sh ? sh.getLastRow() : 0;
      json(200, { rows: last ? sh.getRange(1, 1, last, 6).getDisplayValues() : [] });
      return;
    }
    if (url.pathname === '/__test/fail' && req.method === 'POST') {
      body().then(text => { const c = JSON.parse(text || '{}').count; failNext = c == null ? 1 : Number(c); json(200, { ok: true }); });
      return;
    }
    res.writeHead(404).end();
  };
}

// Start the site plus `games` fake APIs. Resolves to {site, apis: [{url, game}], close()}.
export function start({ sitePort = 8080, apiPort = 8081, games = 1, latency, gameOptions = [] } = {}) {
  const servers = [];
  const listen = (handler, port) => new Promise(ok => {
    const s = http.createServer(handler);
    servers.push(s);
    s.listen(port, '127.0.0.1', () => ok(s.address().port));
  });
  return (async () => {
    const site = await listen(siteHandler, sitePort);
    const apis = [];
    for (let i = 0; i < games; i++) {
      const game = makeGame({ name: i ? `Fixture Game ${i + 1}` : 'Fixture Game', ...gameOptions[i] });
      const port = await listen(apiHandler(game, parseLatency(latency)), apiPort ? apiPort + i : 0);
      apis.push({ url: `http://127.0.0.1:${port}/exec`, base: `http://127.0.0.1:${port}`, game });
    }
    return {
      site: `http://127.0.0.1:${site}`,
      apis,
      close: () => Promise.all(servers.map(s => new Promise(ok => s.close(ok)))),
    };
  })();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const games = Number(process.env.GAMES || 1);
  const rulesJson = process.env.RULES_JSON;
  start({
    sitePort: Number(process.env.PORT || 8080),
    apiPort: Number(process.env.API_PORT || 8081),
    games,
    latency: process.env.LATENCY,
    gameOptions: Array.from({ length: games }, () => ({ rulesJson })),
  }).then(({ site, apis }) => {
    console.log(`site  ${site}`);
    for (const a of apis) {
      const invite = Buffer.from(JSON.stringify({ api: a.url, name: a.game.gas.ss.getName() })).toString('base64url');
      const gmInvite = Buffer.from(JSON.stringify({ api: a.url, key: KEYS.GM_KEY, name: a.game.gas.ss.getName() })).toString('base64url');
      console.log(`api   ${a.url}\n  crew invite: ${site}/#join=${invite}\n  GM invite:   ${site}/#join=${gmInvite}`);
    }
  });
}
