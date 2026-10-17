// tools/dev-server.mjs: bad requests get 400 without taking it down, and it serves only the site.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { start } from '../tools/dev-server.mjs';

let srv;
test.before(async () => { srv = await start({ sitePort: 0, apiPort: 0 }); });
test.after(async () => { await srv.close(); });

// A raw path, sent as is (fetch would tidy it up first).
const get = (base, path) => new Promise((ok, fail) => {
  const u = new URL(base);
  http.get({ host: u.hostname, port: u.port, path }, res => { res.resume(); ok(res.statusCode); }).on('error', fail);
});

test('serves the site, but nothing outside it, hidden, or gitignored', async () => {
  assert.equal(await get(srv.site, '/index.html'), 200);
  assert.equal(await get(srv.site, '/assets/core.js'), 200);
  for (const path of ['/..%2f..%2fetc%2fpasswd', '/..%2fcybersea-other%2findex.html', '/.git/config', '/rules.json', '/materials/cybersea.xlsx', '/x.xlsx', '/node_modules/a.js']) {
    assert.equal(await get(srv.site, path), 404, path);
  }
  assert.equal(await get(srv.site, '/%E0%A4%A'), 400, 'a malformed path');
});

test('a malformed test-hook body is a 400, and the server carries on', async () => {
  const { base, url } = srv.apis[0];
  for (const hook of ['/__test/set', '/__test/fail']) {
    const r = await fetch(base + hook, { method: 'POST', body: '{not json' });
    assert.equal(r.status, 400, hook);
  }
  const ping = await fetch(`${url}?op=ping`);
  assert.equal((await ping.json()).ok, true);
});
