// A strict, in-memory stand-in for the Google Apps Script services Code.gs uses, so the real
// script can run in Node for unit tests and the local dev server. "Strict" means it behaves
// like Sheets where that would expose bugs: setValues checks dimensions, values typed into
// non-text cells are coerced (numbers, booleans) or become formulas, and a leading "'" is
// hidden from display values.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const MAX_ROWS = 1000;
const MAX_COLUMNS = 26; // a new sheet's size; insertColumnsAfter adds more

// A picture placed in a cell (Insert > Image > Insert image in cell): {type, bytes (a Buffer)}.
// Seed one by giving a cell {image: {type, bytes}}.
const images = new Map(); // fake content URL -> image
class Cell {
  constructor() { this.v = ''; this.formula = null; this.fmt = null; this.image = null; }
  display() {
    if (this.image) return '';
    if (this.formula && /^=\s*IMAGE\s*\(/i.test(this.formula)) return ''; // Sheets shows the picture, not text
    if (this.formula) return '#FORMULA ' + this.formula; // Code.gs must never create formulas
    if (typeof this.v === 'boolean') return this.v ? 'TRUE' : 'FALSE';
    return String(this.v);
  }
}

function coerce(cell, value) {
  cell.image = value && typeof value === 'object' && value.image ? value.image : null;
  if (cell.image) { cell.v = ''; cell.formula = null; return; }
  const s = value == null ? '' : String(value);
  cell.formula = null;
  if (s.startsWith("'")) { cell.v = s.slice(1); return; }          // quote prefix: stored as text, hidden
  if (s.startsWith('=') && s.length > 1) { cell.formula = s; cell.v = ''; return; }
  if (cell.fmt === '@') { cell.v = s; return; }                      // plain text format keeps it as typed
  if (/^[+-]?\d+(\.\d+)?(e\d+)?$/i.test(s.trim())) { cell.v = Number(s); return; }
  if (/^(true|false)$/i.test(s.trim())) { cell.v = /^true$/i.test(s.trim()); return; }
  cell.v = s;
}

// Like Apps Script's CellImage: its content URL is new each time, as Google's are short-lived.
let urls = 0;
function cellImage(image) {
  return {
    valueType: 'IMAGE',
    getContentUrl: () => { const u = `https://lh7-rt.googleusercontent.com/fake/${++urls}`; images.set(u, image); return u; },
    getAltTextTitle: () => '',
  };
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
  getSheet() { return this.sheet; }
  getRow() { return this.row; }
  getColumn() { return this.col; }
  getNumRows() { return this.nr; }
  getNumColumns() { return this.nc; }
  getLastRow() { return this.row + this.nr - 1; }
  getLastColumn() { return this.col + this.nc - 1; }
  getDisplayValues() { return this.cells(c => c.display()); }
  getValues() { return this.cells(c => (c.image ? cellImage(c.image) : c.formula ? '' : c.v)); }
  getValue() { return this.getValues()[0][0]; }
  getDisplayValue() { return this.getDisplayValues()[0][0]; }
  getFormulas() { return this.cells(c => c.formula || ''); }
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
  constructor(ss, name) { this.ss = ss; this.name = name; this.grid = []; this.frozen = 0; this.maxCols = MAX_COLUMNS; this.hidden = new Set(); }
  cell(r, c) {
    if (r > MAX_ROWS) throw new Error('Those rows are out of bounds.');
    if (c > this.maxCols) throw new Error('Those columns are out of bounds.');
    while (this.grid.length < r) this.grid.push([]);
    const row = this.grid[r - 1];
    while (row.length < c) row.push(new Cell());
    return row[c - 1];
  }
  getName() { return this.name; }
  getMaxRows() { return MAX_ROWS; }
  getMaxColumns() { return this.maxCols; }
  getLastRow() {
    for (let r = this.grid.length; r >= 1; r--) {
      if (this.grid[r - 1].some(c => c.formula || c.v !== '')) return r;
    }
    return 0;
  }
  getLastColumn() {
    let last = 0;
    for (const row of this.grid) row.forEach((c, i) => { if (c.formula || c.v !== '') last = Math.max(last, i + 1); });
    return last;
  }
  getRange(row, col, nr = 1, nc = 1) { return new Range(this, row, col, nr, nc); }
  getDataRange() { return this.getRange(1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); }
  insertColumnsAfter(c, n) { if (c !== this.maxCols) throw new Error('fake: only appends columns'); this.maxCols += n; return this; }
  hideColumns(c, n = 1) { for (let i = 0; i < n; i++) this.hidden.add(c + i); return this; }
  isColumnHiddenByUser(c) { return this.hidden.has(c); }
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
  const docStore = {};
  const cache = new Map();
  const propsOf = s => ({
    getProperty: k => (k in s ? s[k] : null),
    setProperty: (k, v) => { s[k] = String(v); },
    getProperties: () => ({ ...s }),
  });
  let locked = false;

  return {
    ss,
    now,
    docProps: docStore,
    setProps(p) { Object.assign(store, p); },
    clearCache() { cache.clear(); },
    services: {
      SpreadsheetApp: { getActiveSpreadsheet: () => ss, ValueType: { IMAGE: 'IMAGE' } },
      UrlFetchApp: {
        fetch: url => {
          const img = images.get(url);
          if (!img) return { getResponseCode: () => 404, getBlob: () => null };
          return { getResponseCode: () => 200, getBlob: () => ({ getContentType: () => img.type, getBytes: () => [...img.bytes].map(b => (b > 127 ? b - 256 : b)) }) };
        },
      },
      PropertiesService: {
        getScriptProperties: () => propsOf(store),
        getDocumentProperties: () => propsOf(docStore),
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

// Date for the script, telling the fake's time.
function clock(now) {
  return class extends Date {
    constructor(...a) { if (a.length) super(...a); else super(now()); }
    static now() { return now(); }
  };
}

// Run apps-script/Code.gs against a fake. Returns {doGet, doPost, call(body) -> parsed JSON,
// onEdit(e)} (onEdit as Sheets runs it after an edit by hand; a no-op for scripts without one).
// `transform` edits the source first (tests use it to stand in for an older deployment).
export function loadCodeGs(gas, path = new URL('../apps-script/Code.gs', import.meta.url), transform = s => s) {
  const ctx = vm.createContext({ ...gas.services, console, Date: clock(gas.now) });
  vm.runInContext(transform(readFileSync(path, 'utf8')), ctx, { filename: 'Code.gs' });
  const parse = out => JSON.parse(out.getContent());
  return {
    doGet: e => parse(ctx.doGet(e)),
    doPostRaw: contents => parse(ctx.doPost({ postData: { contents, type: 'text/plain' } })),
    call: body => parse(ctx.doPost({ postData: { contents: JSON.stringify(body), type: 'text/plain' } })),
    onEdit: e => { if (typeof ctx.onEdit === 'function') ctx.onEdit(e); },
  };
}
