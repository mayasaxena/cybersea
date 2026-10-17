// The kind lists are written out in Code.gs and again in the Python workbook tools, which can't
// share them; keep the copies the same.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const code = read('apps-script/Code.gs');
const mechanics = read('tools/xlsx/mechanics.py');
const build = read('tools/xlsx/build.py');

// NAME = ['a', 'b', ...] (one or more lines), as both languages write it.
function list(src, name) {
  const m = src.match(new RegExp(`^(?:const )?${name} = \\[([^\\]]*)\\]`, 'm'));
  assert.ok(m, `no ${name}`);
  return [...m[1].matchAll(/'([^']*)'/g)].map(x => x[1]);
}

test('Rules, System and sheet kinds match across Code.gs and the workbook tools', () => {
  for (const name of ['RULES_KINDS', 'SYSTEM_KINDS', 'SHEET_KINDS']) assert.deepEqual(list(mechanics, name), list(code, name), name);
  const chars = build.match(/^CHARACTER_KINDS = '([^']*)'/m)[1].split(',');
  assert.deepEqual(chars, list(code, 'SHEET_KINDS'), 'build.py CHARACTER_KINDS');
});

test('tab kinds match, so the tools put sheet dropdowns on the same tabs as setUpChecks', () => {
  assert.deepEqual(list(mechanics, 'TAB_KINDS'), list(code, 'TAB_KINDS'));
  assert.ok(list(code, 'SHEETS_ONLY').every(k => list(code, 'TAB_KINDS').includes(k)));
});
