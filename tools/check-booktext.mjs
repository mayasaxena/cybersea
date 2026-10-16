#!/usr/bin/env node
// Fails if repo files (or history) contain runs of rulebook text.
// The rulebook stays local: pass its path in RAPSCALLION_TXT (or --book <path>).
//
//   node tools/check-booktext.mjs              scan tracked + untracked (not ignored) files
//   node tools/check-booktext.mjs --staged     scan the staged versions (pre-commit)
//   node tools/check-booktext.mjs --history    scan lines added anywhere in git history
//   node tools/check-booktext.mjs --history main   …or only in one branch's history
//   node tools/check-booktext.mjs a.html b.js  scan just these files
//
// A "hit" is any run of SHINGLE consecutive words that also appears in the book,
// after normalizing case, punctuation, quotes, line-break hyphens and markup.

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const SHINGLE = 8;
const SKIP_EXT = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|zip|gz)$/i;
const FORBIDDEN_EXT = /\.(xlsx|xls|ods|pdf|docx)$/i; // never commit these: they'd carry book or player data

const args = process.argv.slice(2);
const flag = f => args.includes(f);
const bookArg = args.indexOf('--book');
const bookPath = bookArg >= 0 ? args[bookArg + 1] : process.env.RAPSCALLION_TXT;
const histIdx = args.indexOf('--history');
const histRef = histIdx >= 0 && args[histIdx + 1] && !args[histIdx + 1].startsWith('--') ? args[histIdx + 1] : null;
const files = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--book' && (i - 1 !== histIdx || !histRef));

if (!bookPath || !existsSync(bookPath)) {
  console.error('check-booktext: set RAPSCALLION_TXT to the rulebook text file (or pass --book <path>).');
  process.exit(2);
}

function words(text) {
  return text
    .replace(/<[^>]*>/g, ' ')               // html tags
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')      // entities
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[‐-―]/g, '-')
    .replace(/(\w)-\s*\n\s*(\w)/g, '$1$2')  // line-break hyphenation
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

function shingles(ws) {
  const out = [];
  for (let i = 0; i + SHINGLE <= ws.length; i++) out.push(ws.slice(i, i + SHINGLE).join(' '));
  return out;
}

const book = new Set(shingles(words(readFileSync(bookPath, 'utf8'))));

function hits(text) {
  const found = [];
  const ws = words(text);
  for (let i = 0; i + SHINGLE <= ws.length; i++) {
    const s = ws.slice(i, i + SHINGLE).join(' ');
    if (book.has(s)) { found.push(s); i += SHINGLE - 1; }
  }
  return found;
}

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 30 });
let failures = 0;

function report(label, text) {
  if (text.includes('\u0000')) return;
  const h = hits(text);
  if (!h.length) return;
  failures++;
  console.log(`✗ ${label}: ${h.length} run(s) of ${SHINGLE}+ words from the book`);
  for (const s of h.slice(0, 3)) console.log(`    “${s} …”`);
}

if (flag('--history')) {
  const log = git('log', '-p', histRef || '--all', '--no-color', '--format=@@COMMIT %h %s');
  for (const chunk of log.split('@@COMMIT ').slice(1)) {
    const head = chunk.slice(0, chunk.indexOf('\n'));
    const added = chunk.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).map(l => l.slice(1)).join('\n');
    report(`commit ${head}`, added);
  }
} else {
  let list = files;
  if (!list.length) {
    list = flag('--staged')
      ? git('diff', '--cached', '--name-only', '--diff-filter=ACMR').split('\n').filter(Boolean)
      : git('ls-files', '--cached', '--others', '--exclude-standard').split('\n').filter(Boolean);
  }
  for (const f of list) {
    if (FORBIDDEN_EXT.test(f)) { failures++; console.log(`✗ ${f}: spreadsheet/document files must not be committed`); continue; }
    if (SKIP_EXT.test(f)) continue;
    let text;
    try { text = flag('--staged') ? git('show', `:${f}`) : readFileSync(f, 'utf8'); } catch { continue; }
    report(f, text);
  }
}

if (failures) {
  console.log(`\ncheck-booktext: ${failures} problem(s). Rulebook text belongs in the spreadsheet's Rules tab, not the repo.`);
  process.exit(1);
}
console.log('check-booktext: clean');
