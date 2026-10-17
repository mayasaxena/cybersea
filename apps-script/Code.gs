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
 * Tabs: Rules (Kind|Group|Name|Text|Meta|Vis, plus optional Override name|Override text|Override
 * meta columns, found by their headers), System (the game's mechanics), GM, Lore, Ship, Map (the world: see mapRows_),
 * Images (pictures by name: see namedImages_), and one
 * tab per character (Kind|Name|Value|Notes). Tabs starting with "_" and README are ignored. The tabs the site
 * edits also get a hidden Version column (see "row versions" below).
 *
 *
 * The game's mechanics (stats, tracks, starting cards: Kind|Group|Name|Text|Meta) are in the System
 * tab, and what a Rules row rolls or does is in its Meta, so the site has none of its own.
 * setUpChecks (run it from the Apps Script editor) guards them: see "checks" below.
 *
 * @OnlyCurrentDoc
 */

const API_VERSION = 8; // 2: crew need no passphrase unless CREW_KEY is set. 3: rows have versions. 4: rules overrides, Map tab. 5: the Map tab holds places and their pictures. 6: the System tab, and checks on the tabs (setUpChecks). 7: feedback. 8: the Images tab, and the GM edits the Map tab (place, images)
const HEADER = ['Kind', 'Name', 'Value', 'Notes'];
const RULES_HEADER = ['Kind', 'Group', 'Name', 'Text', 'Meta', 'Vis'];
// The game's mechanics (stats, tracks, starting cards, options): read by everyone, edited only in Sheets.
const SYSTEM_HEADER = ['Kind', 'Group', 'Name', 'Text', 'Meta'];
// A game's own wording for a Rules row, kept beside the book's (which stays as it is). Found by
// header, so they can sit in any column after Vis; sent as the 7th to 9th cells of each row.
const OVERRIDE_HEADERS = ['Override name', 'Override text', 'Override meta'];
const VER_HEADER = 'Version';
const MAX_CELL = 50000;
const MAX_TAB_NAME = 40;
const MAX_GONE = 150;          // removed rows remembered per tab (see gone_)
const BAD_KEY_LIMIT = 10;      // wrong passphrases per minute before pausing
const KEY_CACHE_SECONDS = 120; // passphrase changes take effect within this long
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
// The Map tab's columns, found by their headers (see mapRows_).
const MAP_HEADER = ['Region', 'Location', 'Level', 'Image', 'Text', 'GM notes', 'Shown'];
// The Images tab: every picture once, by name. A Map or Lore Image cell can name one (see imageTokens_).
const IMAGES_TAB = 'Images';
const IMAGES_HEADER = ['Name', 'Image'];
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // a picture the GM adds from the site
const UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
// The Feedback tab: anonymous notes about the site, added by the feedback button (see feedback_).
const FEEDBACK_TAB = 'Feedback';
const FEEDBACK_HEADER = ['Date', 'Feedback'];
const FEEDBACK_LIMIT = 30; // per minute, from everyone

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
    case 'image': return image_(role, req);
    case 'feedback': return withLock_(() => feedback_(req));
    case 'show': return role === 'gm' ? withLock_(() => show_(req)) : forbidden_();
    case 'place': return role === 'gm' ? withLock_(() => place_(req)) : forbidden_();
    case 'images': return role === 'gm' ? images_() : forbidden_();
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
  if (n === 'rules' || n === 'system' || n === 'gm' || n === 'lore' || n === 'ship' || n === 'map' || n === 'feedback' || n === 'images') return n;
  return 'character';
}

// Feedback is read in Sheets only, so the site never shows it, even to the GM. Nor Images: its
// pictures reach the site only through the rows that name them.
function canRead_(role, kind) {
  return !!kind && kind !== 'feedback' && kind !== 'images' && (kind !== 'gm' || role === 'gm');
}

function canWrite_(role, kind) {
  return !!kind && kind !== 'rules' && kind !== 'system' && kind !== 'map' && kind !== 'feedback' && kind !== 'images' && (kind !== 'gm' || role === 'gm');
}

function findSheet_(ss, name) {
  const want = String(name || '').trim().toLowerCase();
  return ss.getSheets().find(sh => sh.getName().trim().toLowerCase() === want) || null;
}

/*
 * A tab's rows as the site sees them, and a digest of them. Rules rows are as typed; other tabs'
 * rows each come with their version (vers[i] is rows[i]'s), and the digest covers both.
 */
function table_(sh, kind, role) {
  if (kind === 'map') return mapTable_(sh, role);
  const grid = sh.getDataRange().getDisplayValues();
  const fixed = kind === 'rules' || kind === 'system'; // edited only in Sheets: no versions
  const rules = kind === 'rules';
  const width = rules ? RULES_HEADER.length : kind === 'system' ? SYSTEM_HEADER.length : HEADER.length;
  const vc = fixed ? 0 : verColIn_(grid[0]);
  const oc = rules ? overrideCols_(grid[0]) : [];
  const ic = kind === 'lore' ? grid[0].findIndex((h, i) => i >= HEADER.length && String(h).trim().toLowerCase() === 'image') : -1;
  const tokens = ic >= 0 ? imageTokens_(sh, ic, grid.length - 1) : null;
  const rows = [];
  const vers = [];
  const imgs = [];
  grid.slice(1).forEach((line, n) => {
    const r = line.slice(0, width);
    while (r.length < width) r.push('');
    if (oc.some(c => c >= 0)) oc.forEach(c => r.push(c >= 0 && line[c] != null ? line[c] : ''));
    if (r.join('').trim() === '') return;
    if (rules && role !== 'gm' && String(r[5]).trim().toLowerCase() === 'gm') return;
    rows.push(r);
    if (!fixed) vers.push(version_(vc ? line[vc - 1] : '', r));
    if (tokens) imgs.push(tokens[n]);
  });
  if (fixed) return { d: digest_(rows), rows };
  // Lore's Image column: imgs[i] is rows[i]'s picture, sent beside the rows so that rows stay
  // Kind|Name|Value|Notes for the site to edit (see imageTokens_).
  return tokens && imgs.some(Boolean) ? { d: digest_([rows, vers, imgs]), rows, vers, imgs } : { d: digest_([rows, vers]), rows, vers };
}

// Where the Rules tab's override columns are (-1 for one it doesn't have).
function overrideCols_(header) {
  const hs = (header || []).map(h => String(h).trim().toLowerCase());
  return OVERRIDE_HEADERS.map(h => {
    const i = hs.indexOf(h.toLowerCase());
    return i >= RULES_HEADER.length ? i : -1;
  });
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

// A row's cells, as plain text, and its mark in the Version column (column vc).
function writeRow_(sh, rowNum, cells, vc, mark) {
  const range = sh.getRange(rowNum, 1, 1, cells.length);
  range.setNumberFormat('@');
  range.setValues([cells.map(safe_)]);
  putMarks_(sh, rowNum, vc, [mark]);
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

/* ---------- row versions ----------
 * Each row on a tab the site edits has a version, so that a change made to an out-of-date copy of
 * a row (sent again after the page was offline, say) is turned down instead of undoing newer
 * changes. The hidden Version column holds "stamp:hash of the row:hash of its Kind+Name". Every
 * write gives the row a new stamp: patch_ (the page picks it, so it knows what its own
 * unconfirmed changes leave), create_, and onEdit for edits made in Sheets. If the hash doesn't
 * match, the row was changed some other way (or was never stamped), and its version is "~" and
 * its hash instead, so the change still shows.
 *
 * Rows that go away (deleted, renamed, or their Kind+Name cleared or typed over) are remembered
 * for a while in the document's properties, so a change made before that doesn't bring them
 * back. Whole rows deleted by hand aren't noticed: Sheets runs no onEdit for that.
 */

// cyrb53: a quick 53-bit string hash, in base 36.
function hash_(s) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// The site makes stamps the same way (assets/api.js).
function stamp_() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function mark_(stamp, cells) {
  return stamp + ':' + hash_(cells.join('\u0001')) + ':' + hash_(key_(cells[0], cells[1]));
}

function version_(mark, cells) {
  const m = String(mark || '').split(':');
  const h = hash_(cells.join('\u0001'));
  return m[0] && m[1] === h ? m[0] : '~' + h;
}

function verColIn_(header) {
  return (header || []).findIndex(h => String(h).trim().toLowerCase() === VER_HEADER.toLowerCase()) + 1;
}

// The tab's Version column, added (hidden, plain text) after any other columns if it has none yet.
function verCol_(sh) {
  const width = Math.max(sh.getLastColumn(), 1);
  const found = verColIn_(sh.getRange(1, 1, 1, width).getDisplayValues()[0]);
  if (found) return found;
  const col = Math.max(width, HEADER.length) + 1;
  if (col > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), col - sh.getMaxColumns());
  sh.getRange(1, col, sh.getMaxRows(), 1).setNumberFormat('@');
  sh.getRange(1, col).setValues([[VER_HEADER]]);
  sh.hideColumns(col);
  return col;
}

function putMarks_(sh, rowNum, vc, marks) {
  if (!marks.length) return;
  const range = sh.getRange(rowNum, vc, marks.length, 1);
  range.setNumberFormat('@');
  range.setValues(marks.map(m => [m]));
}

// Rows that went away from a tab: {hash of Kind+Name: [when, stamp of the change that removed it]}.
function gone_(sh) {
  try {
    return JSON.parse(PropertiesService.getDocumentProperties().getProperty('gone:' + sh.getName().trim().toLowerCase()) || '{}');
  } catch (err) {
    return {};
  }
}

function saveGone_(sh, gone) {
  const keep = {};
  Object.keys(gone).sort((a, b) => gone[b][0] - gone[a][0]).slice(0, MAX_GONE).forEach(k => { keep[k] = gone[k]; });
  PropertiesService.getDocumentProperties().setProperty('gone:' + sh.getName().trim().toLowerCase(), JSON.stringify(keep));
}

/*
 * What a change is based on. The site ends each ren, set and del entry with
 *   {base: [versions], seen, stamp}
 * base: the versions the row may have for the change to go ahead ('' for no row): the one the page
 *   last saw, then any its own unconfirmed changes would have left.
 * seen: when the page last heard from the sheet (the "at" of a read or patch).
 * stamp: the row's new version.
 * Pages from before version 3 send none of this; their changes go ahead regardless.
 */
function when_(x) {
  const w = x && typeof x === 'object' && !Array.isArray(x) ? x : {};
  const stamp = typeof w.stamp === 'string' && /^[a-z0-9]{6,32}$/i.test(w.stamp) ? w.stamp : stamp_();
  const ours = Array.isArray(w.base) ? w.base.slice(0, 100).map(String).concat(stamp) : null;
  return { stamp, ours, seen: Number(w.seen) || 0 };
}

/*
 * Sheets runs this (a simple trigger) after someone edits the spreadsheet by hand. The edited
 * rows get a new stamp, and rows whose Kind+Name went away are remembered as removed.
 */
function onEdit(e) {
  const range = e && e.range;
  if (!range || range.getColumn() > HEADER.length) return;
  const sh = range.getSheet();
  const kind = tabKind_(sh.getName());
  if (!kind || kind === 'rules' || kind === 'system' || kind === 'map' || kind === 'feedback' || kind === 'images') return;
  const top = Math.max(range.getRow(), 2);
  const n = range.getLastRow() - top + 1;
  if (n < 1) return;
  const vc = verCol_(sh);
  const stamp = stamp_();
  const removed = [];
  const marks = sh.getRange(top, 1, n, vc).getDisplayValues().map(line => {
    const cells = line.slice(0, HEADER.length);
    const was = String(line[vc - 1] || '').split(':')[2];
    const keyed = !!(cells[0].trim() || cells[1].trim());
    if (was && (!keyed || was !== hash_(key_(cells[0], cells[1])))) removed.push(was);
    return cells.join('').trim() ? mark_(stamp, cells) : '';
  });
  putMarks_(sh, top, vc, marks);
  if (removed.length) {
    const gone = gone_(sh);
    removed.forEach(k => { gone[k] = [Date.now(), stamp]; });
    saveGone_(sh, gone);
  }
}

/* ---------- ops ---------- */

/*
 * read {tabs: '*' | [names], have: {name: digest}} -> rows (and versions) only for tabs whose
 * digest changed. "at" is when the read started.
 */
function read_(role, req) {
  const at = Date.now();
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
    const t = table_(sh, kind, role);
    tabs[name] = have[name] === t.d ? { d: t.d } : t;
  });
  const res = { ok: true, v: API_VERSION, role, game: ss.getName(), at, list, tabs };
  if (role === 'gm') res.crewKey = keys_().crew; // lets the GM copy a crew invite link
  return res;
}

/*
 * patch {tab, ren: [[Kind, From, To, when]...], set: [[Kind, Name, Value, Notes, when]...], del: [[Kind, Name, when]...]}
 * Rows are keyed by Kind+Name (case-insensitive; the first match wins). Renames happen first and
 * in place, so a renamed row keeps its position. Only touched rows are written, so formulas,
 * formatting and rows added by hand elsewhere in the tab are kept.
 * A change whose row isn't as it was when the change was made (see when_) is skipped, and listed
 * in "skipped" as [Kind, Name]. So are changes to the new name of a skipped rename.
 */
function patch_(role, req) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = findSheet_(ss, req.tab);
  if (!sh) return { ok: false, code: 'missing', error: 'No tab called "' + req.tab + '".' };
  const kind = tabKind_(sh.getName());
  if (!canWrite_(role, kind)) return kind === 'rules' || kind === 'system' || kind === 'map' || kind === 'feedback' || kind === 'images' ? { ok: false, code: 'forbidden', error: 'That tab is edited in the spreadsheet itself.' } : forbidden_();

  const sets = (req.set || []).map(r => ({ cells: cells_(r, 4), w: when_(r[4]) }));
  const vc = verCol_(sh);
  const last = sh.getLastRow();
  const grid = last >= 2 ? sh.getRange(2, 1, last - 1, vc).getDisplayValues() : [];
  const vals = grid.map(r => r.slice(0, 4));
  const marks = grid.map(r => r[vc - 1]);
  const find = k => vals.findIndex(r => key_(r[0], r[1]) === k);
  let gone = null;
  const goneNow = () => gone || (gone = gone_(sh));
  let buried = false;
  const bury = (k, w) => { goneNow()[hash_(k)] = [Date.now(), w.stamp]; buried = true; };
  const renamed = {}; // names rows were renamed to here: the rename checked them already
  const blocked = {}; // names a skipped rename would have made
  const skipped = [];

  // Whether a change to the row keyed k (at index i; -1 if it isn't there) may go ahead.
  const fits = (k, i, w) => {
    if (!w.ours || renamed[k]) return true;
    if (i >= 0) return w.ours.indexOf(version_(marks[i], vals[i])) >= 0;
    const g = goneNow()[hash_(k)];
    if (g && w.ours.indexOf(g[1]) >= 0) return true; // one of our own changes removed it
    return w.ours.indexOf('') >= 0 && !(g && g[0] > w.seen); // there was none, and none was removed since
  };

  (req.ren || []).forEach(r => {
    const w = when_(r[3]);
    const to = String(r[2] == null ? '' : r[2]);
    if (!to.trim()) return;
    if (to.length > MAX_CELL) throw new Error('A cell is too long (over ' + MAX_CELL + ' characters).');
    const k = key_(r[0], r[1]);
    const from = find(k);
    if (from < 0) {
      // Renamed already (this is a retry), or never reached the sheet: the set queued under the
      // new name brings the row. Removed by someone else since: it stays removed.
      if (blocked[k] || !fits(k, -1, w)) { blocked[key_(r[0], to)] = true; skipped.push([r[0], r[1]]); }
      return;
    }
    if (find(key_(r[0], to)) >= 0 || !fits(k, from, w)) {
      if (w.ours) { blocked[key_(r[0], to)] = true; skipped.push([r[0], r[1]]); }
      return;
    }
    const cell = sh.getRange(from + 2, 2);
    cell.setNumberFormat('@');
    cell.setValues([[safe_(to)]]);
    vals[from][1] = to;
    marks[from] = mark_(w.stamp, vals[from]);
    putMarks_(sh, from + 2, vc, [marks[from]]);
    bury(k, w);
    renamed[key_(r[0], to)] = true;
  });

  const doomed = [];
  (req.del || []).forEach(r => {
    const w = when_(r[2]);
    const k = key_(r[0], r[1]);
    const i = find(k);
    if (i < 0 || doomed.indexOf(i) >= 0) return;
    if (blocked[k] || !fits(k, i, w)) { skipped.push([r[0], r[1]]); return; }
    doomed.push(i);
    bury(k, w);
  });
  doomed.sort((a, b) => b - a).forEach(i => { sh.deleteRow(i + 2); vals.splice(i, 1); marks.splice(i, 1); });

  sets.forEach(({ cells, w }) => {
    if (!cells[0].trim() && !cells[1].trim()) return;
    const k = key_(cells[0], cells[1]);
    const at = find(k);
    // Already so (a retry of a change that landed, say): nothing to do. After a rename, the row
    // is written anyway, so it carries this change's stamp.
    if (at >= 0 && !renamed[k] && vals[at].join('\u0001') === cells.join('\u0001')) return;
    if (blocked[k] || !fits(k, at, w)) { skipped.push([cells[0], cells[1]]); return; }
    const mark = mark_(w.stamp, cells);
    if (at >= 0) {
      writeRow_(sh, at + 2, cells, vc, mark);
      vals[at] = cells;
      marks[at] = mark;
      return;
    }
    // New rows go after the last row of the same Kind, so the tab stays grouped for people reading it.
    const kk = cells[0].trim().toLowerCase();
    let pos = -1;
    vals.forEach((r, j) => { if (String(r[0]).trim().toLowerCase() === kk) pos = j; });
    if (pos >= 0 && pos < vals.length - 1) {
      sh.insertRowAfter(pos + 2);
      writeRow_(sh, pos + 3, cells, vc, mark);
      vals.splice(pos + 1, 0, cells);
      marks.splice(pos + 1, 0, mark);
    } else {
      writeRow_(sh, vals.length + 2, cells, vc, mark);
      vals.push(cells);
      marks.push(mark);
    }
  });

  if (buried) saveGone_(sh, gone);
  const at = Date.now();
  const t = table_(sh, kind, role);
  return { ok: true, tab: sh.getName(), at, d: t.d, rows: t.rows, vers: t.vers, imgs: t.imgs, skipped };
}

/*
 * feedback {text}: a line added to the Feedback tab (made if the game has none yet). It's
 * anonymous: only the day and the text are kept, not who sent it, their role or their page.
 */
function feedback_(req) {
  const text = String(req.text == null ? '' : req.text).trim();
  if (!text) return { ok: false, error: 'There’s nothing to send.' };
  if (text.length > MAX_CELL) return { ok: false, error: 'That’s too long (over ' + MAX_CELL + ' characters).' };
  const cache = CacheService.getScriptCache();
  const sent = Number(cache.get('feedback') || 0);
  if (sent >= FEEDBACK_LIMIT) return { ok: false, code: 'busy', error: 'Lots of feedback just now. Try again in a minute.' };
  cache.put('feedback', String(sent + 1), 60);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = findSheet_(ss, FEEDBACK_TAB);
  if (!sh) {
    sh = ss.insertSheet(FEEDBACK_TAB);
    sh.getRange(1, 1, 1, FEEDBACK_HEADER.length).setValues([FEEDBACK_HEADER]);
  }
  const day = new Date().toISOString().slice(0, 10);
  const range = sh.getRange(sh.getLastRow() + 1, 1, 1, FEEDBACK_HEADER.length);
  range.setNumberFormat('@');
  range.setValues([[day, safe_(text)]]);
  return { ok: true };
}

/* create {tab, rows}: a new character tab (or a missing Ship/Lore tab; a GM tab needs the GM key) */
function create_(role, req) {
  const name = String(req.tab || '').trim();
  if (!name || name.length > MAX_TAB_NAME || /[\[\]*?\/\\:]/.test(name)) {
    return { ok: false, code: 'name', error: 'Pick a different name: up to ' + MAX_TAB_NAME + ' characters, without [ ] * ? / \\ :' };
  }
  const kind = tabKind_(name);
  if (!kind || kind === 'rules' || kind === 'system' || kind === 'map' || kind === 'feedback' || kind === 'images' || (kind === 'gm' && role !== 'gm')) {
    return { ok: false, code: 'name', error: '"' + name + '" is a reserved name.' };
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (findSheet_(ss, name)) return { ok: false, code: 'exists', error: 'A tab called "' + name + '" already exists.' };

  const rows = (req.rows || []).map(r => cells_(r, 4)).filter(c => c[0].trim() || c[1].trim());
  const sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, 4).setValues([HEADER]);
  sh.setFrozenRows(1);
  sh.getRange(2, 1, Math.max(sh.getMaxRows() - 1, 1), 4).setNumberFormat('@');
  const vc = verCol_(sh);
  if (rows.length) {
    sh.getRange(2, 1, rows.length, 4).setValues(rows.map(c => c.map(safe_)));
    const stamp = stamp_();
    putMarks_(sh, 2, vc, rows.map(c => mark_(stamp, c)));
  }
  guard_(sh);
  const at = Date.now();
  const t = table_(sh, kind, role);
  return { ok: true, tab: name, kind, at, d: t.d, rows: t.rows, vers: t.vers };
}

/* ---------- the Map tab ----------
 * Region | Location | Level | Image | Text | GM notes | Shown, one row each for:
 *   a region's own map:   Region, no Location            (always shown)
 *   a place:              Region, Location, no Level     (shown to the crew once Shown is "on")
 *   a floor of a place:   Location, Level                (in order; shown with its place)
 * A place with no Level rows is one picture. Image is a picture placed in the cell (Insert > Image >
 * Insert image in cell), an =IMAGE("https://…") formula, or the name of a row of the Images tab.
 * GM notes are only sent to the GM. Rows go out as those 7 cells, the Image cell as imageTokens_
 * sends it.
 */
function mapCols_(header) {
  const hs = (header || []).map(h => String(h).trim().toLowerCase());
  return MAP_HEADER.map(h => hs.indexOf(h.toLowerCase()));
}

const isOn_ = v => /^(on|yes|y|x|true|●|1)$/i.test(String(v || '').trim());

// The Map tab's rows that role may see: [{n: sheet row, cells}].
function mapRows_(sh, role, named) {
  const grid = sh.getDataRange().getDisplayValues();
  const cols = mapCols_(grid[0]);
  const tokens = cols[3] >= 0 ? imageTokens_(sh, cols[3], grid.length - 1, named) : null;
  const out = [];
  const shown = {};
  grid.slice(1).forEach((line, i) => {
    const cells = cols.map(c => (c >= 0 && line[c] != null ? String(line[c]) : ''));
    if (tokens) cells[3] = tokens[i];
    if (!cells.join('').trim()) return;
    const loc = cells[1].trim().toLowerCase();
    cells[6] = isOn_(cells[6]) ? 'on' : '';
    if (loc && !cells[2].trim() && !(loc in shown)) shown[loc] = cells[6] === 'on';
    if (role !== 'gm') cells[5] = '';
    out.push({ n: i + 2, cells, loc });
  });
  return role === 'gm' ? out : out.filter(r => !r.loc || shown[r.loc]);
}

// The GM also gets each row's place in the sheet (ns), to edit it by (see place_).
function mapTable_(sh, role) {
  const seen = mapRows_(sh, role);
  const rows = seen.map(r => r.cells);
  if (role !== 'gm') return { d: digest_(rows), rows };
  const ns = seen.map(r => r.n);
  return { d: digest_([rows, ns]), rows, ns };
}

/* show {location, on} (GM): puts a place on the crew's map, or takes it off */
function show_(req) {
  const sh = findSheet_(SpreadsheetApp.getActiveSpreadsheet(), 'Map');
  if (!sh) return { ok: false, code: 'missing', error: 'No Map tab.' };
  const grid = sh.getDataRange().getDisplayValues();
  const cols = mapCols_(grid[0]);
  if (cols[6] < 0) return { ok: false, error: 'Add a "Shown" column to the Map tab.' };
  const want = String(req.location || '').trim().toLowerCase();
  const i = grid.findIndex((line, j) => j > 0 && String(line[cols[1]]).trim().toLowerCase() === want && !(cols[2] >= 0 && String(line[cols[2]]).trim()));
  if (!want || i < 0) return { ok: false, code: 'missing', error: 'No place called "' + req.location + '" in the Map tab.' };
  const cell = sh.getRange(i + 1, cols[6] + 1);
  cell.setNumberFormat('@');
  cell.setValues([[req.on ? 'on' : '']]);
  const t = mapTable_(sh, 'gm');
  return { ok: true, tab: sh.getName(), at: Date.now(), d: t.d, rows: t.rows };
}

/*
 * place {row, was, cells, image} (GM): adds, changes or removes a row of the Map tab.
 *   row: the sheet row to change, or 0 to add one. was: its 7 cells as the GM last read them; if
 *     the row has changed in the sheet since, nothing is changed.
 *   cells: [Region, Location, Level, Text, GM notes]; leave it out to remove the row (a place's
 *     levels go with it).
 *   image: left out keeps the picture; '' clears it; {name} names a row of the Images tab;
 *     {name, type, data (base64)} adds the picture to the Images tab under that name (with a
 *     number added if the name is taken) and names that row.
 * Renaming a place renames its levels' Location too. A new level goes after its place's last
 * row, anything else new at the end. A new place starts hidden.
 */
function place_(req) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = findSheet_(ss, 'Map');
  const row = Number(req.row) || 0;
  if (!sh) {
    if (row) return { ok: false, code: 'missing', error: 'No Map tab.' };
    sh = ss.insertSheet('Map');
    sh.getRange(1, 1, 1, MAP_HEADER.length).setValues([MAP_HEADER]);
    sh.setFrozenRows(1);
  }
  const cols = mapColsFor_(sh);
  const all = mapRows_(sh, 'gm');
  const old = row ? all.find(r => r.n === row) : null;
  if (row && (!old || JSON.stringify(old.cells) !== JSON.stringify((req.was || []).map(String)))) {
    return { ok: false, code: 'conflict', error: 'That row of the Map tab has changed since this page read it. Look again and redo your change.' };
  }
  const levelsOf = loc => all.filter(r => r.loc === loc && String(r.cells[2]).trim());
  if (!req.cells) {
    if (!old) return { ok: false, error: 'Nothing to remove.' };
    const gone = [old].concat(!String(old.cells[2]).trim() && old.loc ? levelsOf(old.loc) : []);
    gone.map(r => r.n).sort((a, b) => b - a).forEach(n => sh.deleteRow(n));
    return mapResult_(sh);
  }
  const c = cells_(req.cells, 5).map(v => v.trim());
  if (!c[0] && !c[1]) return { ok: false, error: 'Give it a region or a place.' };
  if (c[2] && !c[1]) return { ok: false, error: 'A level needs the place it’s in.' };
  let image = null; // the Image cell's new text, when it changes
  if (req.image === '') image = '';
  else if (req.image && req.image.data) {
    const added = addImage_(ss, req.image);
    if (!added.ok) return added;
    image = added.name;
  } else if (req.image && req.image.name != null) image = String(req.image.name).trim();
  let n = row;
  if (!n) {
    const loc = c[1].toLowerCase();
    const after = c[2] ? all.filter(r => r.loc === loc).map(r => r.n).pop() : 0;
    if (after) {
      sh.insertRowAfter(after);
      n = after + 1;
    } else n = Math.max(sh.getLastRow(), 1) + 1;
  }
  const put = (col, v) => {
    const cell = sh.getRange(n, col + 1);
    cell.setNumberFormat('@');
    cell.setValues([[safe_(v)]]);
  };
  [0, 1, 2].forEach(i => put(cols[i], c[i]));
  put(cols[4], c[3]);
  put(cols[5], c[4]);
  if (image != null) {
    const cell = sh.getRange(n, cols[3] + 1);
    cell.setNumberFormat('General'); // a name, or =IMAGE() typed in later, as Sheets reads it
    cell.setValues([[safe_(image)]]);
  }
  // A renamed place takes its levels along.
  if (old && !String(old.cells[2]).trim() && old.loc && c[1].toLowerCase() !== old.loc) {
    levelsOf(old.loc).forEach(r => {
      const cell = sh.getRange(r.n, cols[1] + 1);
      cell.setNumberFormat('@');
      cell.setValues([[safe_(c[1])]]);
    });
  }
  return mapResult_(sh);
}

function mapResult_(sh) {
  const t = mapTable_(sh, 'gm');
  return { ok: true, tab: sh.getName(), at: Date.now(), d: t.d, rows: t.rows, ns: t.ns };
}

// The Map tab's columns, adding any it lacks after the last.
function mapColsFor_(sh) {
  const last = Math.max(sh.getLastColumn(), 1);
  const cols = mapCols_(sh.getRange(1, 1, 1, last).getDisplayValues()[0]);
  let next = sh.getLastColumn();
  MAP_HEADER.forEach((h, i) => {
    if (cols[i] >= 0) return;
    if (next >= sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), 1);
    sh.getRange(1, next + 1).setValues([[h]]);
    cols[i] = next++;
  });
  return cols;
}

// Adds {name, type, data (base64)} to the Images tab (made if need be) as a picture placed in a
// cell. Returns {ok, name} with the name it went under.
function addImage_(ss, img) {
  const type = String(img.type || '').toLowerCase();
  if (UPLOAD_TYPES.indexOf(type) < 0) return { ok: false, error: 'Use a PNG, JPEG, GIF or WebP picture.' };
  const data = String(img.data || '');
  if (!data || data.length * 3 / 4 > MAX_UPLOAD_BYTES) return { ok: false, error: 'That picture is too big (over 5 MB).' };
  let sh = findSheet_(ss, IMAGES_TAB);
  if (!sh) {
    sh = ss.insertSheet(IMAGES_TAB);
    sh.getRange(1, 1, 1, IMAGES_HEADER.length).setValues([IMAGES_HEADER]);
    sh.setFrozenRows(1);
  }
  const cols = imagesCols_(sh);
  const base = String(img.name || '').trim().slice(0, 200) || 'Picture';
  const taken = namedImagesAll_(sh, cols);
  let name = base;
  for (let k = 2; taken[name.toLowerCase()]; k++) name = base + ' ' + k;
  let pic;
  try {
    pic = SpreadsheetApp.newCellImage().setSourceUrl('data:' + type + ';base64,' + data).setAltTextTitle(name).build();
  } catch (err) {
    return { ok: false, error: 'The sheet couldn’t take that picture (' + (err.message || err) + '). Try a smaller one.' };
  }
  const n = Math.max(sh.getLastRow(), 1) + 1;
  const cell = sh.getRange(n, cols[0] + 1);
  cell.setNumberFormat('@');
  cell.setValues([[safe_(name)]]);
  sh.getRange(n, cols[1] + 1).setValues([[pic]]);
  return { ok: true, name };
}

// Every name in the Images tab, lowercase -> 1, pictures or not.
function namedImagesAll_(sh, cols) {
  const out = {};
  if (sh.getLastRow() < 2) return out;
  sh.getRange(2, cols[0] + 1, sh.getLastRow() - 1, 1).getDisplayValues()
    .forEach(line => { const k = String(line[0]).trim().toLowerCase(); if (k) out[k] = 1; });
  return out;
}

/* images (GM): the Images tab's pictures, [[name, token]] in its order, for picking one */
function images_() {
  const sh = findSheet_(SpreadsheetApp.getActiveSpreadsheet(), IMAGES_TAB);
  if (!sh || sh.getLastRow() < 2) return { ok: true, images: [] };
  const cols = imagesCols_(sh);
  const names = sh.getRange(2, cols[0] + 1, sh.getLastRow() - 1, 1).getDisplayValues();
  const tokens = imageTokens_(sh, cols[1], names.length, {});
  const images = [];
  names.forEach((line, i) => {
    const name = String(line[0]).trim();
    if (name && tokens[i]) images.push([name, tokens[i].replace(/^row:/, 'images:')]);
  });
  return { ok: true, images };
}

/*
 * What n rows (from row 2) have in an Image column (0-based col): "row:<the sheet's row>" for a
 * picture placed in the cell (op "image" sends its bytes; its own URL is short-lived), the
 * address of an =IMAGE("https://…") formula, what the Images tab has for a name typed in the
 * cell ("images:<its row>" for a placed picture), or ''.
 */
function imageTokens_(sh, col, n, named) {
  if (n < 1) return [];
  const range = sh.getRange(2, col + 1, n, 1);
  const vals = range.getValues();
  const forms = range.getFormulas();
  return vals.map((v, i) => {
    if (isCellImage_(v[0])) return 'row:' + (i + 2);
    const m = String(forms[i][0] || '').match(/^=\s*IMAGE\s*\(\s*"(https:\/\/[^"\s]+)"/i);
    if (m) return m[1];
    const name = forms[i][0] ? '' : String(v[0] == null ? '' : v[0]).trim().toLowerCase();
    if (!name) return '';
    if (!named) named = namedImages_();
    return named[name] || '';
  });
}

// The Images tab's pictures by name (lowercase): "images:<row>" for one placed in its Image cell,
// or an =IMAGE() formula's address. The first row with a name wins.
function namedImages_() {
  const sh = findSheet_(SpreadsheetApp.getActiveSpreadsheet(), IMAGES_TAB);
  const out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  const cols = imagesCols_(sh);
  const names = sh.getRange(2, cols[0] + 1, sh.getLastRow() - 1, 1).getDisplayValues();
  const tokens = imageTokens_(sh, cols[1], names.length, out); // a name there never points back
  names.forEach((line, i) => {
    const name = String(line[0]).trim().toLowerCase();
    if (name && !(name in out) && tokens[i]) out[name] = tokens[i].replace(/^row:/, 'images:');
  });
  return out;
}

// The Images tab's Name and Image columns (0-based), by header, else the first two.
function imagesCols_(sh) {
  const hs = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getDisplayValues()[0].map(h => String(h).trim().toLowerCase());
  return IMAGES_HEADER.map((h, i) => (hs.indexOf(h.toLowerCase()) >= 0 ? hs.indexOf(h.toLowerCase()) : i));
}

function isCellImage_(v) {
  return !!v && typeof v === 'object' && typeof v.getContentUrl === 'function';
}

/*
 * image {tab: 'Map' (the default), 'Lore' or 'Images', row} -> {type, data (base64)}: the picture
 * placed in that row's Image cell, if the caller can see the row. The crew see an Images row only
 * while a Map row they can see, or a Lore row, names it.
 */
function image_(role, req) {
  const tab = String(req.tab || 'Map').trim().toLowerCase();
  const name = tab === 'lore' ? 'Lore' : tab === 'images' ? IMAGES_TAB : 'Map';
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = findSheet_(ss, name);
  const row = Number(req.row);
  if (!sh || !(row >= 2 && row <= sh.getLastRow() && Math.floor(row) === row)) return { ok: false, code: 'missing', error: 'No picture there.' };
  const header = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getDisplayValues()[0];
  let col;
  if (name === IMAGES_TAB) {
    if (role !== 'gm' && !namedOnSight_(ss, 'images:' + row)) return { ok: false, code: 'missing', error: 'No picture there.' };
    col = imagesCols_(sh)[1];
  } else if (name === 'Map') {
    const seen = mapRows_(sh, role).find(r => r.n === row);
    if (!seen || seen.cells[3] !== 'row:' + row) return { ok: false, code: 'missing', error: 'No picture there.' };
    col = mapCols_(header)[3];
  } else {
    col = header.findIndex((h, i) => i >= HEADER.length && String(h).trim().toLowerCase() === 'image');
  }
  const v = col >= 0 ? sh.getRange(row, col + 1).getValue() : null;
  if (!isCellImage_(v)) return { ok: false, code: 'missing', error: 'No picture there.' };
  let res;
  try {
    res = UrlFetchApp.fetch(v.getContentUrl(), { muteHttpExceptions: true });
  } catch (err) {
    return { ok: false, error: 'Couldn\'t read the picture in row ' + row + ' of the ' + name + ' tab.' };
  }
  if (res.getResponseCode() !== 200) return { ok: false, error: 'Couldn\'t read the picture in row ' + row + ' of the ' + name + ' tab (' + res.getResponseCode() + ').' };
  const blob = res.getBlob();
  const bytes = blob.getBytes();
  if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, error: 'That picture is too big (over 20 MB).' };
  return { ok: true, type: String(blob.getContentType() || 'image/png'), data: Utilities.base64Encode(bytes) };
}

// Whether a Map row the crew can see, or a Lore row, has the picture token.
function namedOnSight_(ss, token) {
  const named = namedImages_();
  const map = findSheet_(ss, 'Map');
  if (map && mapRows_(map, 'crew', named).some(r => r.cells[3] === token)) return true;
  const lore = findSheet_(ss, 'Lore');
  if (!lore || lore.getLastRow() < 2) return false;
  const ic = lore.getRange(1, 1, 1, Math.max(lore.getLastColumn(), 1)).getDisplayValues()[0]
    .findIndex((h, i) => i >= HEADER.length && String(h).trim().toLowerCase() === 'image');
  return ic >= 0 && imageTokens_(lore, ic, lore.getLastRow() - 1, named).indexOf(token) >= 0;
}

/* ---------- checks ---------- */

/*
 * Guards against accidental edits in Google Sheets. Run it once from the Apps Script editor
 * (pick setUpChecks in the function list, click Run), and again after adding tabs by hand; a
 * tab the site makes gets the checks itself. Running it again changes nothing.
 *   Rules, System and README: protected, with a warning before any edit (anyone can still edit
 *   on purpose). Their Kind columns, and Rules' Vis, only take the values the site knows.
 *   Character and Ship tabs: Kind suggests the site's kinds; a stat's Value must be a number,
 *   and a track's or bond's only pip symbols. The hidden Version column warns before an edit.
 * The script itself isn't held back by any of this.
 */
const RULES_KINDS = ['move', 'procedure', 'house', 'advance', 'playbook', 'vice', 'oddity', 'kit', 'lastwords', 'question',
  'pmove', 'smove', 'pnote', 'renown', 'rule', 'special', 'tag', 'trouble', 'table', 'fate', 'world', 'faction'];
const SYSTEM_KINDS = ['stat', 'track', 'section', 'choice'];
const SHEET_KINDS = ['info', 'stat', 'track', 'bond', 'sheet', 'notes', 'jot', 'inventory', 'item', 'move', 'special', 'advance', 'log', 'state', 'signin'];
const GUARD_NOTE = 'Cybersea: ';

function setUpChecks() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const done = [];
  ss.getSheets().forEach(sh => { if (guard_(sh)) done.push(sh.getName()); });
  return done;
}

// The checks for one tab (see setUpChecks). Returns whether it has any.
function guard_(sh) {
  const name = sh.getName().trim().toLowerCase();
  const kind = tabKind_(sh.getName());
  if (name === 'readme') { protectTab_(sh, 'how the sheet works'); return true; }
  if (!kind || kind === 'feedback' || kind === 'images') return false;
  const rows = Math.max(sh.getMaxRows() - 1, 1);
  const list = (values, strict, help) => SpreadsheetApp.newDataValidation().requireValueInList(values, true)
    .setAllowInvalid(!strict).setHelpText(help).build();
  if (kind === 'rules' || kind === 'system') {
    protectTab_(sh, kind === 'rules' ? 'the game’s rules; the site reads them' : 'the game’s mechanics; the site reads them');
    const head = sh.getRange(1, 1, 1, RULES_HEADER.length).getDisplayValues()[0].map(h => String(h).trim().toLowerCase());
    const col = h => head.indexOf(h) + 1;
    if (col('kind')) sh.getRange(2, col('kind'), rows, 1).setDataValidation(list(kind === 'rules' ? RULES_KINDS : SYSTEM_KINDS, true, 'A kind the site knows (see README).'));
    if (kind === 'system') return true;
    if (col('vis')) sh.getRange(2, col('vis'), rows, 1).setDataValidation(list(['crew', 'gm'], true, 'crew (or blank): everyone sees it. gm: only the GM.'));
    return true;
  }
  if (kind === 'character' || kind === 'ship') {
    sh.getRange(2, 1, rows, 1).setDataValidation(list(SHEET_KINDS, false, 'A kind the site knows (see README).'));
    const value = SpreadsheetApp.newDataValidation()
      .requireFormulaSatisfied('=IF($A2="stat",REGEXMATCH(TO_TEXT(C2),"^\\s*[+\\-−–]?\\d+\\s*$"),' +
        'IF($A2="track",REGEXMATCH(TO_TEXT(C2),"^[○●✕xXoO01×*•.\\-_\\s]*$"),' +
        'IF($A2="bond",REGEXMATCH(TO_TEXT(C2),"^[·●○oO01*•.\\-\\s]*$"),TRUE)))')
      .setAllowInvalid(false)
      .setHelpText('A stat is a number like +1 or -2. Tracks: ● marked, ○ open, ✕ crossed out. Bonds: ● marked, ○ used, · not marked.')
      .build();
    sh.getRange(2, 3, rows, 1).setDataValidation(value);
  }
  const vc = verColIn_(sh.getRange(1, 1, 1, sh.getMaxColumns()).getDisplayValues()[0]);
  if (vc) protectRange_(sh.getRange(1, vc, sh.getMaxRows(), 1), 'row versions the site keeps');
  return true;
}

function protectTab_(sh, what) {
  if (sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) return;
  sh.protect().setDescription(GUARD_NOTE + what).setWarningOnly(true);
}

function protectRange_(range, what) {
  const note = GUARD_NOTE + what;
  if (range.getSheet().getProtections(SpreadsheetApp.ProtectionType.RANGE).some(p => p.getDescription() === note)) return;
  range.protect().setDescription(note).setWarningOnly(true);
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
