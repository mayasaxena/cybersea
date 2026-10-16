/**
 * Cybersea game API. One spreadsheet = one game; this script is bound to it.
 *
 * Setup (see SETUP.md):
 *   Project Settings > Script properties: GM_KEY (the GM's passphrase). Optional: CREW_KEY, if
 *   players should need a passphrase too; without it, anyone with the web app URL (the invite
 *   link) is crew.
 *   Deploy > New deployment > Web app; Execute as: Me; Who has access: Anyone.
 *
 * Every request is a POST whose body is JSON sent as text/plain (no CORS preflight),
 * carrying any passphrase as "key".
 *
 * Tabs: Rules (Kind|Group|Name|Text|Meta|Vis), GM, Lore, Ship, and one tab per character
 * (Kind|Name|Value|Notes). Tabs starting with "_" and README are ignored.
 *
 * @OnlyCurrentDoc
 */

const API_VERSION = 2; // 2: crew need no passphrase unless CREW_KEY is set
const HEADER = ['Kind', 'Name', 'Value', 'Notes'];
const RULES_HEADER = ['Kind', 'Group', 'Name', 'Text', 'Meta', 'Vis'];
const MAX_CELL = 50000;
const MAX_TAB_NAME = 40;
const BAD_KEY_LIMIT = 10;      // wrong passphrases per minute before pausing
const KEY_CACHE_SECONDS = 120; // passphrase changes take effect within this long

function doGet(e) {
  const op = e && e.parameter ? e.parameter.op : '';
  if (op === 'ping') return out_({ ok: true, v: API_VERSION });
  return out_({ ok: false, error: 'Send requests as POST.' });
}

function doPost(e) {
  let res;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    res = handle_(req);
  } catch (err) {
    res = { ok: false, error: String((err && err.message) || err) };
  }
  return out_(res);
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function handle_(req) {
  if (req.op === 'ping') return { ok: true, v: API_VERSION };
  if (throttled_()) return { ok: false, code: 'throttled', error: 'Too many wrong passphrases. Wait a minute and try again.' };
  const role = role_(req.key);
  if (!role) {
    if (!req.key) return { ok: false, code: 'auth', error: 'This game needs a passphrase.' };
    noteBadKey_();
    return { ok: false, code: 'auth', error: 'Wrong passphrase.' };
  }
  switch (req.op) {
    case 'read': return read_(role, req);
    case 'patch': return withLock_(() => patch_(role, req));
    case 'create': return withLock_(() => create_(role, req));
    case 'selftest': return role === 'gm' ? withLock_(selftest_) : forbidden_();
  }
  return { ok: false, error: 'Unknown op: ' + req.op };
}

/* ---------- passphrases ---------- */

function keys_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('keys');
  if (hit) return JSON.parse(hit);
  const props = PropertiesService.getScriptProperties();
  const keys = { crew: props.getProperty('CREW_KEY') || '', gm: props.getProperty('GM_KEY') || '' };
  cache.put('keys', JSON.stringify(keys), KEY_CACHE_SECONDS);
  return keys;
}

// GM with the GM passphrase; crew with the crew passphrase, or with none if CREW_KEY isn't set.
function role_(key) {
  const keys = keys_();
  if (!keys.gm) throw new Error('No GM passphrase set yet: add GM_KEY under Project Settings > Script properties.');
  key = String(key || '');
  if (key && key === keys.gm) return 'gm';
  if (keys.crew ? key === keys.crew : !key) return 'crew';
  return null;
}

function throttled_() {
  return Number(CacheService.getScriptCache().get('bad') || 0) >= BAD_KEY_LIMIT;
}

function noteBadKey_() {
  const cache = CacheService.getScriptCache();
  cache.put('bad', String(Number(cache.get('bad') || 0) + 1), 60);
}

function forbidden_() {
  return { ok: false, code: 'forbidden', error: 'That needs the GM passphrase.' };
}

/* ---------- tabs ---------- */

function tabKind_(name) {
  const n = String(name).trim().toLowerCase();
  if (!n || n.charAt(0) === '_' || n === 'readme') return null;
  if (n === 'rules' || n === 'gm' || n === 'lore' || n === 'ship') return n;
  return 'character';
}

function canRead_(role, kind) {
  return !!kind && (kind !== 'gm' || role === 'gm');
}

function canWrite_(role, kind) {
  return !!kind && kind !== 'rules' && (kind !== 'gm' || role === 'gm');
}

function findSheet_(ss, name) {
  const want = String(name || '').trim().toLowerCase();
  return ss.getSheets().find(sh => sh.getName().trim().toLowerCase() === want) || null;
}

function rows_(sh, kind, role) {
  const width = kind === 'rules' ? RULES_HEADER.length : HEADER.length;
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, width).getDisplayValues().filter(r =>
    r.join('').trim() !== '' &&
    !(kind === 'rules' && role !== 'gm' && String(r[5]).trim().toLowerCase() === 'gm'));
}

function digest_(rows) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(rows), Utilities.Charset.UTF_8);
  return Utilities.base64Encode(bytes);
}

function key_(kind, name) {
  return String(kind || '').trim().toLowerCase() + '|' + String(name || '').trim().toLowerCase();
}

/* Sheets would read "=…" as a formula and drop a leading "'"; a leading "'" keeps either as text. */
function safe_(v) {
  return /^[=']/.test(v) ? "'" + v : v;
}

function cells_(row, width) {
  const out = [];
  for (let i = 0; i < width; i++) {
    const v = row && row[i] != null ? String(row[i]) : '';
    if (v.length > MAX_CELL) throw new Error('A cell is too long (over ' + MAX_CELL + ' characters).');
    out.push(v);
  }
  return out;
}

function writeRow_(sh, rowNum, cells) {
  const range = sh.getRange(rowNum, 1, 1, cells.length);
  range.setNumberFormat('@');
  range.setValues([cells.map(safe_)]);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, code: 'busy', error: 'The sheet is busy; try again in a moment.' };
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/* ---------- ops ---------- */

/* read {tabs: '*' | [names], have: {name: digest}} -> rows only for tabs whose digest changed */
function read_(role, req) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const want = Array.isArray(req.tabs) ? req.tabs.map(t => String(t).trim().toLowerCase()) : null;
  const have = req.have || {};
  const list = [];
  const tabs = {};
  ss.getSheets().forEach(sh => {
    const name = sh.getName();
    const kind = tabKind_(name);
    if (!canRead_(role, kind)) return;
    list.push({ name, kind });
    if (want && want.indexOf(name.trim().toLowerCase()) < 0) return;
    const rows = rows_(sh, kind, role);
    const d = digest_(rows);
    tabs[name] = have[name] === d ? { d } : { d, rows };
  });
  const res = { ok: true, v: API_VERSION, role, game: ss.getName(), list, tabs };
  if (role === 'gm') res.crewKey = keys_().crew; // lets the GM copy a crew invite link
  return res;
}

/*
 * patch {tab, ren: [[Kind, From, To]...], set: [[Kind, Name, Value, Notes]...], del: [[Kind, Name]...]}
 * Rows are keyed by Kind+Name (case-insensitive; the first match wins). Renames happen first and
 * in place, so a renamed row keeps its position. Only touched rows are written, so formulas,
 * formatting and rows added by hand elsewhere in the tab are kept.
 */
function patch_(role, req) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = findSheet_(ss, req.tab);
  if (!sh) return { ok: false, code: 'missing', error: 'No tab called "' + req.tab + '".' };
  const kind = tabKind_(sh.getName());
  if (!canWrite_(role, kind)) return kind === 'rules' ? { ok: false, code: 'forbidden', error: 'Rules are edited in the spreadsheet itself.' } : forbidden_();

  const sets = (req.set || []).map(r => cells_(r, 4));
  const dels = (req.del || []).map(r => key_(r[0], r[1]));
  const last = sh.getLastRow();
  const vals = last >= 2 ? sh.getRange(2, 1, last - 1, 4).getDisplayValues() : [];
  const find = k => vals.findIndex(r => key_(r[0], r[1]) === k);

  (req.ren || []).forEach(r => {
    const from = find(key_(r[0], r[1]));
    const to = String(r[2] == null ? '' : r[2]);
    if (from < 0 || !to.trim() || find(key_(r[0], to)) >= 0) return;
    if (to.length > MAX_CELL) throw new Error('A cell is too long (over ' + MAX_CELL + ' characters).');
    const cell = sh.getRange(from + 2, 2);
    cell.setNumberFormat('@');
    cell.setValues([[safe_(to)]]);
    vals[from][1] = to;
  });

  const doomed = [];
  dels.forEach(k => { const i = find(k); if (i >= 0 && doomed.indexOf(i) < 0) doomed.push(i); });
  doomed.sort((a, b) => b - a).forEach(i => { sh.deleteRow(i + 2); vals.splice(i, 1); });

  sets.forEach(cells => {
    if (!cells[0].trim() && !cells[1].trim()) return;
    const at = find(key_(cells[0], cells[1]));
    if (at >= 0) {
      if (vals[at].join('\u0001') !== cells.join('\u0001')) { writeRow_(sh, at + 2, cells); vals[at] = cells; }
      return;
    }
    // New rows go after the last row of the same Kind, so the tab stays grouped for people reading it.
    const k = cells[0].trim().toLowerCase();
    let pos = -1;
    vals.forEach((r, j) => { if (String(r[0]).trim().toLowerCase() === k) pos = j; });
    if (pos >= 0 && pos < vals.length - 1) {
      sh.insertRowAfter(pos + 2);
      writeRow_(sh, pos + 3, cells);
      vals.splice(pos + 1, 0, cells);
    } else {
      writeRow_(sh, vals.length + 2, cells);
      vals.push(cells);
    }
  });

  const rows = rows_(sh, kind, role);
  return { ok: true, tab: sh.getName(), d: digest_(rows), rows };
}

/* create {tab, rows}: a new character tab (or a missing Ship/Lore tab; GM tab needs the GM key) */
function create_(role, req) {
  const name = String(req.tab || '').trim();
  if (!name || name.length > MAX_TAB_NAME || /[\[\]*?\/\\:]/.test(name)) {
    return { ok: false, code: 'name', error: 'Pick a different name: up to ' + MAX_TAB_NAME + ' characters, without [ ] * ? / \\ :' };
  }
  const kind = tabKind_(name);
  if (!kind || kind === 'rules' || (kind === 'gm' && role !== 'gm')) {
    return { ok: false, code: 'name', error: '"' + name + '" is a reserved name.' };
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (findSheet_(ss, name)) return { ok: false, code: 'exists', error: 'A tab called "' + name + '" already exists.' };

  const rows = (req.rows || []).map(r => cells_(r, 4)).filter(c => c[0].trim() || c[1].trim());
  const sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, 4).setValues([HEADER]);
  sh.setFrozenRows(1);
  sh.getRange(2, 1, Math.max(sh.getMaxRows() - 1, 1), 4).setNumberFormat('@');
  if (rows.length) sh.getRange(2, 1, rows.length, 4).setValues(rows.map(c => c.map(safe_)));
  const out = rows_(sh, kind, role);
  return { ok: true, tab: name, kind, d: digest_(out), rows: out };
}

/* selftest (GM): checks that values survive a round trip through this sheet unchanged */
const PROBES = ['=1+1', "'tis", '+2', '-1', '007', '1/2', 'TRUE', '3.0', '1e3', '- bullet', 'two\nlines',
  '●○✕·', '@mention', 'http://example.com', 'x  y'];

function selftest_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = findSheet_(ss, '_selftest') || ss.insertSheet('_selftest');
  const range = sh.getRange(1, 1, PROBES.length, 1);
  range.setNumberFormat('@');
  range.setValues(PROBES.map(p => [safe_(p)]));
  const back = range.getDisplayValues();
  ss.deleteSheet(sh);
  const results = PROBES.map((p, i) => ({ sent: p, got: back[i][0], ok: back[i][0] === p }));
  return { ok: results.every(r => r.ok), results };
}
