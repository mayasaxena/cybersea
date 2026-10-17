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
//   PUSH=1 node tools/dev-server.mjs                  with live updates (see below)
//
// Test hooks on each API port: POST /__test/set {tab, rows} (edit a tab by hand to hold these
// rows; rows: null deletes it), GET /__test/tab?name=X (dump display values),
// POST /__test/fail {count} (next N echoes 500: the script runs, but its answer is lost).
//
// A game made with {push: true} has live updates on (apps-script/Push.gs): /__fb on its API port
// stands in for the Firebase Realtime Database, streaming the script's pings as server-sent
// events, and edits by hand also run Push.gs's "On change" trigger.

import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGas, loadCodeGs } from './gas-fake.mjs';
import { gameTabs, KEYS, RULES_HEADER } from '../tests/fixtures/game.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
};

function parseLatency(spec) {
  if (!spec) return () => 0;
  const [a, b = a] = String(spec).split('-').map(Number);
  return () => a + Math.random() * (b - a);
}

// codeTransform stands in for an older deployment of Code.gs.
export function makeGame({ name = 'Fixture Game', tabs = gameTabs(), keys = KEYS, rulesJson, codeTransform } = {}) {
  if (rulesJson) {
    const recs = JSON.parse(readFileSync(rulesJson, 'utf8'));
    tabs = { ...tabs, Rules: [RULES_HEADER, ...recs.map(r => [r.kind, r.group, r.name, r.text, r.meta || '', r.vis || 'crew', r.override_name || '', r.override_text || '', r.override_meta || ''])] };
  }
  const gas = createGas({ name, tabs, props: keys, asText: true });
  return { gas, api: loadCodeGs(gas, codeTransform) };
}

// Edit a tab in Sheets until it holds `rows` (row 1 is the header): type over the cells that
// differ (into plain-text cells, like the template's), then let the script's onEdit run for
// each edited row, as Sheets does. Columns past the rows' width (the Version column) are left
// alone. rows: null deletes the tab.
function editByHand(game, tab, rows) {
  const ss = game.gas.ss;
  const old = ss.getSheets().find(s => s.getName().toLowerCase() === tab.toLowerCase());
  if (!rows) { if (old) ss.deleteSheet(old); return; }
  const sh = old || ss.insertSheet(tab);
  const width = Math.max(1, ...rows.map(r => r.length));
  const edited = [];
  for (let i = 0; i < Math.max(rows.length, sh.getLastRow()); i++) {
    const want = Array.from({ length: width }, (_, c) => String(rows[i]?.[c] ?? ''));
    const range = sh.getRange(i + 1, 1, 1, width);
    if (range.getDisplayValues()[0].join('\u0001') === want.join('\u0001')) continue;
    range.setNumberFormat('@');
    range.setValues([want]);
    edited.push(range);
  }
  for (const range of edited) game.api.onEdit({ range, source: ss });
  if (game.push && edited.length) game.api.ctx.pushChange({ changeType: 'OTHER', source: ss });
}

// The Realtime Database's REST API, as much as Push.gs and the site use: PUT a value (with the
// secret), and GET as server-sent events (put events: the value on connecting, then each new one).
function firebase(game, base) {
  const values = new Map();
  const streams = new Map();
  const send = (res, data) => res.write(`event: put\ndata: ${JSON.stringify({ path: '/', data: data ?? null })}\n\n`);
  game.gas.setProps({ FIREBASE_URL: `${base}/__fb`, FIREBASE_SECRET: 'dev-secret' });
  game.gas.onFetch = (url, opts) => {
    const u = new URL(url);
    if (!u.pathname.startsWith('/__fb/') || String(opts.method).toLowerCase() !== 'put') return null;
    if (u.searchParams.get('auth') !== 'dev-secret') return { code: 401, text: '{"error":"Permission denied"}' };
    const body = JSON.parse(opts.payload);
    const v = JSON.parse(JSON.stringify(body), (k, x) => (x && x['.sv'] === 'timestamp' ? Date.now() : x));
    values.set(u.pathname, v);
    for (const res of streams.get(u.pathname) || []) send(res, v);
    return { code: 200, text: JSON.stringify(v) };
  };
  game.push = { pings: () => [...values.values()].length };
  return (req, res, url) => {
    if (req.method !== 'GET') { res.writeHead(405).end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
    const set = streams.get(url.pathname) || new Set();
    streams.set(url.pathname, set);
    set.add(res);
    req.on('close', () => set.delete(res));
    send(res, values.get(url.pathname));
  };
}

// What .gitignore keeps out of the repo (rules.json, workbooks, the private materials folder)
// is never served either. Handles the simple patterns that file uses: name, *.ext, dir/.
const IGNORED = (() => {
  let lines = [];
  try { lines = readFileSync(join(ROOT, '.gitignore'), 'utf8').split('\n'); } catch { /* none */ }
  return lines.map(l => l.trim()).filter(l => l && !l.startsWith('#') && !l.startsWith('!')).map(l => {
    const dir = l.endsWith('/');
    const body = l.replace(/^\/|\/$/g, '').replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
    return new RegExp(`(^|/)${body}${dir ? '/' : '$'}`);
  });
})();
const ignored = rel => IGNORED.some(re => re.test(rel));

function siteHandler(req, res) {
  let path;
  try { path = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end('Bad request'); return; }
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(ROOT, path));
  const rel = file.slice(ROOT.length + 1).split(sep).join('/');
  if (!file.startsWith(ROOT + sep) || /(^|\/)\.|(^|\/)node_modules\/|^tools\/extract\//.test(rel) || ignored(rel)) {
    res.writeHead(404).end('Not found');
    return;
  }
  if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(readFileSync(file));
}

function apiHandler(game, latency, firebaseOf = () => null) {
  const outputs = new Map();
  let failNext = 0;
  let n = 0;
  return (req, res) => {
    try { handle(req, res); } catch (err) { if (!res.headersSent) res.writeHead(400).end(String(err?.message || err)); }
  };
  function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const body = () => new Promise(ok => { let b = ''; req.on('data', c => { b += c; }); req.on('end', () => ok(b)); });
    const json = (code, obj, extra = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', ...extra }); res.end(JSON.stringify(obj)); };
    // A malformed request is the test's mistake: answer 400 rather than take the server down.
    const bad = err => { if (!res.headersSent) json(400, { ok: false, error: String(err?.message || err) }); };
    const redirect = out => {
      const id = String(++n);
      outputs.set(id, out);
      // Google's 302 carries ACAO:* too; without it the browser would drop the redirect.
      setTimeout(() => { res.writeHead(302, { Location: `/echo/${id}`, 'Access-Control-Allow-Origin': '*' }); res.end(); }, latency());
    };

    if (req.method === 'OPTIONS') { res.writeHead(405).end(); return; }
    const fb = firebaseOf();
    if (fb && url.pathname.startsWith('/__fb/')) { fb(req, res, url); return; }

    if (url.pathname === '/exec' && req.method === 'GET') {
      redirect(game.api.doGet({ parameter: Object.fromEntries(url.searchParams) }));
      return;
    }
    if (url.pathname === '/exec' && req.method === 'POST') {
      body().then(text => redirect(game.api.doPostRaw(text))).catch(bad);
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
        editByHand(game, tab, rows);
        json(200, { ok: true });
      }).catch(bad);
      return;
    }
    if (url.pathname === '/__test/tab') {
      const sh = game.gas.ss.getSheets().find(s => s.getName() === url.searchParams.get('name'));
      const last = sh ? sh.getLastRow() : 0;
      json(200, { rows: last ? sh.getRange(1, 1, last, Math.max(sh.getLastColumn(), 6)).getDisplayValues() : [] });
      return;
    }
    if (url.pathname === '/__test/fail' && req.method === 'POST') {
      body().then(text => { const c = JSON.parse(text || '{}').count; failNext = c == null ? 1 : Number(c); json(200, { ok: true }); }).catch(bad);
      return;
    }
    res.writeHead(404).end();
  }
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
      const { push, ...opts } = gameOptions[i] || {};
      const game = makeGame({ name: i ? `Fixture Game ${i + 1}` : 'Fixture Game', ...opts });
      let fb = null;
      const handler = apiHandler(game, parseLatency(latency), () => fb);
      const port = await listen(handler, apiPort ? apiPort + i : 0);
      const base = `http://127.0.0.1:${port}`;
      if (push) fb = firebase(game, base);
      apis.push({ url: `${base}/exec`, base, game });
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
    gameOptions: Array.from({ length: games }, () => ({ rulesJson, push: !!process.env.PUSH })),
  }).then(({ site, apis }) => {
    console.log(`site  ${site}`);
    for (const a of apis) {
      const invite = Buffer.from(JSON.stringify({ api: a.url, name: a.game.gas.ss.getName() })).toString('base64url');
      const gmInvite = Buffer.from(JSON.stringify({ api: a.url, key: KEYS.GM_KEY, name: a.game.gas.ss.getName() })).toString('base64url');
      console.log(`api   ${a.url}\n  crew invite: ${site}/#join=${invite}\n  GM invite:   ${site}/#join=${gmInvite}`);
    }
  });
}
