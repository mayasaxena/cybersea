// A strict, in-memory stand-in for the Google Apps Script services Code.gs uses, so the real
// script can run in Node for unit tests and the local dev server. "Strict" means it behaves
// like Sheets where that would expose bugs: setValues checks dimensions, values typed into
// non-text cells are coerced (numbers, booleans) or become formulas, and a leading "'" is
// hidden from display values.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const MAX_ROWS = 1000;

class Cell {
  constructor() { this.v = ''; this.formula = null; this.fmt = null; }
  display() {
    if (this.formula) return '#FORMULA ' + this.formula; // Code.gs must never create formulas
    if (typeof this.v === 'boolean') return this.v ? 'TRUE' : 'FALSE';
    return String(this.v);
  }
}

function coerce(cell, value) {
  const s = value == null ? '' : String(value);
  cell.formula = null;
  if (s.startsWith("'")) { cell.v = s.slice(1); return; }          // quote prefix: stored as text, hidden
  if (s.startsWith('=') && s.length > 1) { cell.formula = s; cell.v = ''; return; }
  if (cell.fmt === '@') { cell.v = s; return; }                      // plain text format keeps it as typed
  if (/^[+-]?\d+(\.\d+)?(e\d+)?$/i.test(s.trim())) { cell.v = Number(s); return; }
  if (/^(true|false)$/i.test(s.trim())) { cell.v = /^true$/i.test(s.trim()); return; }
  cell.v = s;
}

class Range {
  constructor(sheet, row, col, nr, nc) {
    for (const [n, v] of [['row', row], ['column', col], ['rows', nr], ['columns', nc]]) {
      if (!Number.isInteger(v) || v < 1) throw new Error(`Range ${n} must be a positive integer (got ${v}).`);
    }
    Object.assign(this, { sheet, row, col, nr, nc });
  }
  cells(fn) {
    const out = [];
    for (let r = 0; r < this.nr; r++) {
      const line = [];
      for (let c = 0; c < this.nc; c++) line.push(fn(this.sheet.cell(this.row + r, this.col + c), r, c));
      out.push(line);
    }
    return out;
  }
  getDisplayValues() { return this.cells(c => c.display()); }
  getValues() { return this.cells(c => (c.formula ? '' : c.v)); }
  setValues(values) {
    if (!Array.isArray(values) || values.length !== this.nr) {
      throw new Error(`The number of rows in the data does not match the number of rows in the range. The data has ${values?.length} but the range has ${this.nr}.`);
    }
    values.forEach((line, r) => {
      if (line.length !== this.nc) {
        throw new Error(`The number of columns in the data does not match the number of columns in the range. The data has ${line.length} but the range has ${this.nc}.`);
      }
    });
    this.cells((c, r, col) => coerce(c, values[r][col]));
    this.sheet.ss.edits++;
    return this;
  }
  setNumberFormat(fmt) { this.cells(c => { c.fmt = fmt; }); return this; }
  setFontWeight() { return this; }
}

class Sheet {
  constructor(ss, name) { this.ss = ss; this.name = name; this.grid = []; this.frozen = 0; }
  cell(r, c) {
    if (r > MAX_ROWS) throw new Error('Those rows are out of bounds.');
    while (this.grid.length < r) this.grid.push([]);
    const row = this.grid[r - 1];
    while (row.length < c) row.push(new Cell());
    return row[c - 1];
  }
  getName() { return this.name; }
  getMaxRows() { return MAX_ROWS; }
  getLastRow() {
    for (let r = this.grid.length; r >= 1; r--) {
      if (this.grid[r - 1].some(c => c.formula || c.v !== '')) return r;
    }
    return 0;
  }
  getRange(row, col, nr = 1, nc = 1) { return new Range(this, row, col, nr, nc); }
  insertRowAfter(r) { this.cell(r, 1); this.grid.splice(r, 0, []); this.ss.edits++; return this; }
  deleteRow(r) { if (r <= this.grid.length) this.grid.splice(r - 1, 1); this.ss.edits++; return this; }
  setFrozenRows(n) { this.frozen = n; return this; }
}

class Spreadsheet {
  constructor(name) { this.name = name; this.sheets = []; this.edits = 0; }
  getName() { return this.name; }
  getSheets() { return this.sheets.slice(); }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(name) {
    if (this.sheets.some(s => s.name.toLowerCase() === String(name).toLowerCase())) {
      throw new Error(`A sheet with the name "${name}" already exists. Please enter another name.`);
    }
    const sh = new Sheet(this, name);
    this.sheets.push(sh);
    return sh;
  }
  deleteSheet(sh) { this.sheets = this.sheets.filter(s => s !== sh); }
}

// Build the fake services. `tabs` is {name: [[...header], [...row], ...]} (rows as typed into the
// sheet by hand: values starting with "=" become formulas, as in Sheets).
export function createGas({ name = 'Test Game', tabs = {}, props = {}, now = () => Date.now(), asText = false } = {}) {
  const ss = new Spreadsheet(name);
  for (const [tab, rows] of Object.entries(tabs)) seedTab(ss, tab, rows, asText);

  const store = { ...props };
  const cache = new Map();
  let locked = false;

  return {
    ss,
    setProps(p) { Object.assign(store, p); },
    clearCache() { cache.clear(); },
    services: {
      SpreadsheetApp: { getActiveSpreadsheet: () => ss },
      PropertiesService: {
        getScriptProperties: () => ({
          getProperty: k => (k in store ? store[k] : null),
          setProperty: (k, v) => { store[k] = String(v); },
          getProperties: () => ({ ...store }),
        }),
      },
      CacheService: {
        getScriptCache: () => ({
          get: k => { const e = cache.get(k); return e && e.until > now() ? e.v : null; },
          put: (k, v, ttl = 600) => { cache.set(k, { v: String(v), until: now() + ttl * 1000 }); },
          remove: k => { cache.delete(k); },
        }),
      },
      LockService: {
        getScriptLock: () => ({
          tryLock: () => { if (locked) return false; locked = true; return true; },
          waitLock: () => { if (locked) throw new Error('Lock timeout'); locked = true; },
          releaseLock: () => { locked = false; },
        }),
      },
      ContentService: {
        MimeType: { JSON: 'application/json' },
        createTextOutput: s => ({ content: s, mime: 'text/plain', setMimeType(m) { this.mime = m; return this; }, getContent() { return this.content; } }),
      },
      Utilities: {
        DigestAlgorithm: { MD5: 'md5' },
        Charset: { UTF_8: 'utf8' },
        computeDigest: (alg, str) => [...createHash(alg).update(String(str), 'utf8').digest()].map(b => (b > 127 ? b - 256 : b)),
        base64Encode: bytes => Buffer.from(bytes.map(b => b & 255)).toString('base64'),
      },
    },
  };
}

// asText mirrors the template, whose columns are formatted as plain text.
export function seedTab(ss, tab, rows, asText = false) {
  const sh = ss.insertSheet(tab);
  rows.forEach((line, r) => line.forEach((v, c) => {
    const cell = sh.cell(r + 1, c + 1);
    if (asText) cell.fmt = '@';
    coerce(cell, v);
  }));
  return sh;
}

// Run apps-script/Code.gs against a fake. Returns {doGet, doPost, call(body) -> parsed JSON}.
export function loadCodeGs(gas, path = new URL('../apps-script/Code.gs', import.meta.url)) {
  const ctx = vm.createContext({ ...gas.services, console });
  vm.runInContext(readFileSync(path, 'utf8'), ctx, { filename: 'Code.gs' });
  const parse = out => JSON.parse(out.getContent());
  return {
    doGet: e => parse(ctx.doGet(e)),
    doPostRaw: contents => parse(ctx.doPost({ postData: { contents, type: 'text/plain' } })),
    call: body => parse(ctx.doPost({ postData: { contents: JSON.stringify(body), type: 'text/plain' } })),
  };
}
