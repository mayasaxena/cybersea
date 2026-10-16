#!/usr/bin/env node
// Convert the old one-page sheet's saved data (nexa.html ⋯ → Download) into a character tab's
// rows, using the site's own import (sheet menu → Import) against the dev server. Local only.
//
//   NODE_PATH=$(npm root -g) node tools/xlsx/legacy-to-rows.mjs old.json rules.json Nexa out.json
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { start } from '../dev-server.mjs';
import { HEADER, KEYS } from '../../tests/fixtures/game.mjs';

const [oldPath, rulesPath, tabName = 'Nexa', outPath] = process.argv.slice(2);
if (!oldPath || !rulesPath || !outPath) {
  console.error('usage: legacy-to-rows.mjs old.json rules.json TabName out.json');
  process.exit(2);
}
const { chromium } = createRequire(import.meta.url)('playwright');
const srv = await start({ sitePort: 0, apiPort: 0, gameOptions: [{ tabs: { [tabName]: [HEADER] }, rulesJson: rulesPath }] });
const api = srv.apis[0];
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const invite = Buffer.from(JSON.stringify({ api: api.url, key: KEYS.CREW_KEY, name: 'Convert' })).toString('base64url');
  await page.goto(`${srv.site}/sheet.html?c=${encodeURIComponent(tabName)}#join=${invite}`);
  await page.waitForSelector('[data-act="sheet-menu"]');
  await page.click('[data-act="sheet-menu"]');
  await page.fill('.panel textarea', readFileSync(oldPath, 'utf8'));
  await page.click('[data-s="import"]');
  await page.click('[data-s="import"]');
  const dump = async () => (await (await fetch(`${api.base}/__test/tab?name=${encodeURIComponent(tabName)}`)).json()).rows.slice(1).map(r => r.slice(0, 4));
  let rows = [];
  for (let i = 0; i < 100 && rows.length < 3; i++) { await new Promise(r => setTimeout(r, 200)); rows = await dump(); }
  await new Promise(r => setTimeout(r, 2500)); // let the last patch land
  rows = (await dump()).filter(r => r[0] || r[1]);
  writeFileSync(outPath, JSON.stringify(rows, null, 1));
  console.log(`wrote ${outPath}: ${rows.length} rows`);
} finally {
  await browser.close();
  await srv.close();
}
