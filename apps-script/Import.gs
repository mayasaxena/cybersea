/**
 * The spreadsheet's Cybersea menu: Replace with an xlsx… swaps tabs for the tabs of an .xlsx file
 * (a fresh workbook from tools/xlsx/build.py, say), picked from the computer. Once a file is
 * picked, the dialog lists its tabs (all ticked: each replaces the sheet's tab of the same name,
 * or is added) and the sheet's tabs the file doesn't have (unticked: ticking one removes it).
 *
 * The spreadsheet itself stays: its name, its script, the script's properties and the web app
 * deployment, so the site's URL and invite links keep working. Everything on a replaced tab goes,
 * including pictures placed in cells (File > Version history can bring them back). The Images tab
 * is never replaced or removed: it holds the pictures, which an .xlsx can't bring in, so a file's
 * Images tab only comes in when the sheet has none yet.
 *
 * The script reads the .xlsx itself (it's a zip of XML files), so it needs no access beyond this
 * spreadsheet. It carries over what the game's workbooks use: values and formulas, plain-text,
 * bold, fill and wrap formatting, column widths, hidden columns and tabs, frozen rows and
 * columns, list data validation, and sheet protection (Excel's "allow edit" ranges stay
 * editable). Anything else is left out and listed in the result.
 *
 * appsscript.json lists the scopes itself (as Code.gs's @OnlyCurrentDoc would): this spreadsheet
 * only, script.container.ui (the menu and dialog) and script.external_request (Code.gs's pictures).
 */

const MAX_XLSX_BYTES = 20 * 1024 * 1024;

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Cybersea')
    .addItem('Replace with an xlsx…', 'showReplaceDialog')
    .addToUi();
}

function showReplaceDialog() {
  const html = HtmlService.createHtmlOutput(REPLACE_DIALOG_HTML).setWidth(460).setHeight(520);
  SpreadsheetApp.getUi().showModalDialog(html, 'Replace with an xlsx');
}

// Called from the dialog once a file is picked: the file's tabs (and whether the sheet has a tab
// of the same name), and the sheet's tabs the file doesn't have.
function listXlsxTabs(name, data) {
  const opened = openXlsx_(name, data, []);
  if (!opened.ok) return opened;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const inFile = {};
  opened.book.tabs.forEach(t => { inFile[tabKey_(t.name)] = 1; });
  return {
    ok: true,
    file: opened.book.tabs.filter(t => !keptTab_(ss, t.name)).map(t => ({ name: t.name, exists: !!findSheet_(ss, t.name) })),
    sheetOnly: ss.getSheets().map(sh => sh.getName()).filter(n => !inFile[tabKey_(n)] && !keptTab_(ss, n)),
  };
}

// Called from the dialog: name is the file's name, data its bytes in base64. choice: {tabs: the
// file's tabs to bring in, remove: the sheet's tabs to delete}; without it, the sheet becomes the
// file (every tab brought in, every other tab removed).
function replaceWithXlsx(name, data, choice) {
  const only = choice && Array.isArray(choice.tabs) ? choice.tabs.map(String) : null;
  const opened = openXlsx_(name, data, only);
  if (!opened.ok) return opened;
  const book = opened.book;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  book.tabs = book.tabs.filter(t => !keptTab_(ss, t.name) && (!only || only.indexOf(t.name) >= 0));
  const remove = choice && Array.isArray(choice.remove) ? choice.remove.map(String) : null;
  return withLock_(() => replaceTabs_(ss, book, remove));
}

// The workbook in base64 data, its tabs' cells read only for the tabs named in only (all if null).
function openXlsx_(name, data, only) {
  name = String(name || '');
  if (!/\.xlsx$/i.test(name)) return { ok: false, error: 'Pick an .xlsx file.' };
  const bytes = Utilities.base64Decode(String(data || ''));
  if (!bytes.length) return { ok: false, error: 'That file is empty.' };
  if (bytes.length > MAX_XLSX_BYTES) return { ok: false, error: 'That file is too big.' };
  try {
    // An .xlsx is a zip, and Utilities.unzip only takes a blob typed as one.
    return { ok: true, book: readXlsx_(Utilities.unzip(Utilities.newBlob(bytes, 'application/zip', name)), only) };
  } catch (err) {
    return { ok: false, error: 'That doesn’t look like an .xlsx file (' + (err.message || err) + '). Nothing was changed.' };
  }
}

function tabKey_(name) {
  return String(name).trim().toLowerCase();
}

// Tabs of ss an import never touches: the Images tab, once there is one.
function keptTab_(ss, name) {
  return tabKind_(name) === 'images' && !!findSheet_(ss, name);
}

// Brings book's tabs into ss: each replaces the tab of the same name, keeping its place, or is
// added at the end. Then removes the tabs named in remove (null: every tab the book doesn't
// have, and the tabs end up in the book's order). The new tabs are made first, so a failure
// leaves the old tabs as they were.
function replaceTabs_(ss, book, remove) {
  if (!book.tabs.length) return { ok: false, error: 'Tick at least one tab from the file. Nothing was changed.' };
  const incoming = {};
  book.tabs.forEach(t => { incoming[tabKey_(t.name)] = 1; });
  const gone = {};
  ss.getSheets().map(sh => sh.getName()).forEach(n => {
    if (!incoming[tabKey_(n)] && !keptTab_(ss, n) && (remove ? remove.some(r => tabKey_(r) === tabKey_(n)) : true)) gone[tabKey_(n)] = n;
  });
  const kept = ss.getSheets().map(sh => sh.getName()).filter(n => !incoming[tabKey_(n)] && !gone[tabKey_(n)]);
  if (!book.tabs.some(t => tabKind_(t.name) === 'rules') && !kept.some(n => tabKind_(n) === 'rules')) {
    return { ok: false, error: 'That would leave no Rules tab, so the site couldn’t read the game. Nothing was changed.' };
  }
  const made = [];
  try {
    book.tabs.forEach((t, i) => {
      // Named with a leading "_", so the site (which ignores such tabs) never shows a half-filled
      // one, nor one left behind if the run is cut off at Apps Script's time limit.
      const sh = ss.insertSheet('_importing ' + (i + 1) + ' ' + Date.now());
      made.push(sh);
      try {
        fillSheet_(sh, t, book.skipped);
      } catch (err) {
        throw new Error((err.message || err) + ' (the ' + t.name + ' tab)');
      }
    });
  } catch (err) {
    made.forEach(sh => ss.deleteSheet(sh));
    throw err;
  }
  // Swapping the new tabs in: from here on, the old tabs start going.
  try {
    made.forEach((sh, i) => {
      const old = findSheet_(ss, book.tabs[i].name);
      const at = old ? old.getIndex() : 0;
      if (old) ss.deleteSheet(old);
      sh.setName(book.tabs[i].name);
      if (at) {
        ss.setActiveSheet(sh);
        ss.moveActiveSheet(at);
      }
    });
    Object.keys(gone).forEach(k => ss.deleteSheet(findSheet_(ss, gone[k])));
    if (!kept.length) made.forEach((sh, i) => { ss.setActiveSheet(sh); ss.moveActiveSheet(i + 1); });
  } catch (err) {
    throw new Error((err.message || err) + ' (while swapping the new tabs in; File → Version history can undo it)');
  }
  made.forEach((sh, i) => { if (book.tabs[i].hidden) sh.hideSheet(); });
  // setUpChecks's checks, as on a tab the site makes. The tabs are in by now, so a check that
  // can't be set is listed rather than stopping the import.
  made.forEach(sh => extra_(book.skipped, 'the site’s checks on the ' + sh.getName() + ' tab', () => guard_(sh)));
  ss.setActiveSheet(made.find(sh => !sh.isSheetHidden()) || made[0]);

  // Rows remembered as removed (see gone_) were the old tabs' rows.
  const props = PropertiesService.getDocumentProperties();
  Object.keys(incoming).concat(Object.keys(gone)).forEach(k => props.deleteProperty('gone:' + k));
  const skipped = Object.keys(book.skipped);
  return { ok: true, tabs: made.map(sh => sh.getName()), removed: Object.keys(gone).map(k => gone[k]), skipped };
}

function fillSheet_(sh, t, skipped) {
  const nr = Math.max(t.values.length, 1);
  const nc = Math.max(t.width, 1);
  if (sh.getMaxRows() < nr) sh.insertRowsAfter(sh.getMaxRows(), nr - sh.getMaxRows());
  if (sh.getMaxColumns() < nc) sh.insertColumnsAfter(sh.getMaxColumns(), nc - sh.getMaxColumns());
  const grid = f => t.values.length ? t.cells.map(line => line.map(f)) : [[f({})]];
  const range = sh.getRange(1, 1, nr, nc);
  range.setNumberFormats(grid(c => (c.text ? '@' : 'General')));
  range.setValues(t.values.length ? t.values : [['']]);
  // The rest is how the tab looks and what it checks: one that can't be set is listed in the
  // result instead of stopping the import.
  const tab = ' (' + t.name + ')';
  extra_(skipped, 'bold' + tab, () => range.setFontWeights(grid(c => (c.bold ? 'bold' : 'normal'))));
  extra_(skipped, 'fill colors' + tab, () => range.setBackgrounds(grid(c => c.fill || null)));
  extra_(skipped, 'wrapping' + tab, () => range.setWraps(grid(c => !!c.wrap)));
  t.cols.forEach(c => {
    for (let i = Math.max(c.min, 1); i <= Math.min(c.max, nc); i++) {
      if (c.width > 0) extra_(skipped, 'column widths' + tab, () => sh.setColumnWidth(i, Math.round(c.width * 7 + 5)));
      if (c.hidden) extra_(skipped, 'hidden columns' + tab, () => sh.hideColumns(i));
    }
  });
  if (t.frozenRows) extra_(skipped, 'frozen rows' + tab, () => sh.setFrozenRows(t.frozenRows));
  if (t.frozenCols) extra_(skipped, 'frozen columns' + tab, () => sh.setFrozenColumns(t.frozenCols));
  t.validations.forEach(v => {
    const list = listOf_(v.formula);
    if (v.type !== 'list' || !list) {
      skipped['data validation that isn’t a list of choices (' + t.name + ' ' + v.sqref + ')'] = 1;
      return;
    }
    extra_(skipped, 'data validation (' + t.name + ' ' + v.sqref + ')', () => {
      const rule = SpreadsheetApp.newDataValidation().requireValueInList(list, v.dropdown).setAllowInvalid(!v.strict).build();
      v.sqref.split(/\s+/).filter(Boolean).forEach(a1 => sh.getRange(a1).setDataValidation(rule));
    });
  });
  if (t.protect) {
    extra_(skipped, 'protection' + tab, () => {
      const p = sh.protect();
      p.setUnprotectedRanges(t.protect.open.map(a1 => sh.getRange(a1)));
      p.removeEditors(p.getEditors());
      if (p.canDomainEdit()) p.setDomainEdit(false);
    });
  }
}

// Runs fn; if Sheets turns it down, notes what, and why, in skipped.
function extra_(skipped, what, fn) {
  try {
    fn();
  } catch (err) {
    console.warn('Import: ' + what + ': ' + (err.stack || err));
    skipped[what + ': ' + (err.message || err)] = 1;
  }
}

// "on,off" in quotes -> ['on', 'off']; anything else (a range, a formula) -> null.
function listOf_(formula) {
  const m = /^"(.*)"$/.exec(String(formula || '').trim());
  return m ? m[1].split(',').map(s => s.trim()) : null;
}

/* ---------- reading an .xlsx ---------- */

// blobs: the unzipped parts; only: the tabs whose cells to read (null: all; others get only
// their name and hidden). Returns {tabs: [{name, hidden, values, cells, width, cols,
// frozenRows, frozenCols, validations, protect}], skipped: {what: 1}}.
function readXlsx_(blobs, only) {
  const parts = {};
  blobs.forEach(b => { parts[b.getName().replace(/^\/+/, '')] = b; });
  const text = path => (parts[path] ? parts[path].getDataAsString('UTF-8') : '');
  if (!parts['xl/workbook.xml']) throw new Error('no xl/workbook.xml');
  const rels = {};
  all_(xml_(text('xl/_rels/workbook.xml.rels')), 'Relationship').forEach(r => { rels[r.a.Id] = r.a.Target; });
  const shared = all_(xml_(text('xl/sharedStrings.xml')), 'si').map(textOf_);
  const styles = readStyles_(xml_(text('xl/styles.xml')));
  const skipped = {};
  const tabs = all_(xml_(text('xl/workbook.xml')), 'sheet').map(s => {
    const target = String(rels[s.a['r:id']] || '');
    const path = target.charAt(0) === '/' ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    if (!parts[path]) throw new Error('no ' + path + ' for tab ' + s.a.name);
    const tab = only && only.indexOf(s.a.name) < 0 ? {} : readSheet_(xml_(text(path)), shared, styles, skipped, s.a.name);
    tab.name = s.a.name;
    tab.hidden = !!s.a.state && s.a.state !== 'visible';
    return tab;
  });
  if (blobs.some(b => /^xl\/(media|drawings|richData)\//.test(b.getName()))) skipped['pictures'] = 1;
  return { tabs, skipped };
}

function readStyles_(doc) {
  const fmts = {};
  all_(doc, 'numFmt').forEach(f => { fmts[f.a.numFmtId] = f.a.formatCode; });
  const fonts = kids_(first_(doc, 'fonts'), 'font').map(f => {
    const b = first_(f, 'b');
    return !!b && b.a.val !== '0' && b.a.val !== 'false';
  });
  const fills = kids_(first_(doc, 'fills'), 'fill').map(f => {
    const p = first_(f, 'patternFill');
    const fg = p && p.a.patternType === 'solid' && first_(p, 'fgColor');
    return fg && /^[0-9a-f]{8}$/i.test(fg.a.rgb || '') ? '#' + fg.a.rgb.slice(2) : null;
  });
  return kids_(first_(doc, 'cellXfs'), 'xf').map(x => {
    const al = first_(x, 'alignment');
    return {
      text: x.a.numFmtId === '49' || fmts[x.a.numFmtId] === '@',
      bold: !!fonts[Number(x.a.fontId) || 0],
      fill: fills[Number(x.a.fillId) || 0] || null,
      wrap: !!al && (al.a.wrapText === '1' || al.a.wrapText === 'true'),
    };
  });
}

function readSheet_(doc, shared, styles, skipped, name) {
  const values = [];
  const cells = [];
  let width = 0;
  let r = 0;
  all_(doc, 'row').forEach(row => {
    r = Number(row.a.r) || r + 1;
    let c = 0;
    kids_(row, 'c').forEach(cell => {
      const ref = /^([A-Z]+)(\d+)$/.exec(cell.a.r || '');
      c = ref ? colNum_(ref[1]) : c + 1;
      const style = styles[Number(cell.a.s) || 0] || {};
      const f = first_(cell, 'f');
      const v = first_(cell, 'v');
      let value;
      if (f && f.t) value = '=' + f.t;
      else if (cell.a.t === 's') value = shared[Number(v && v.t)] || '';
      else if (cell.a.t === 'inlineStr') value = textOf_(first_(cell, 'is') || { c: [] });
      else if (cell.a.t === 'b') value = !!v && v.t === '1';
      else if (cell.a.t === 'str' || cell.a.t === 'e') value = v ? v.t : '';
      else value = v && v.t !== '' ? Number(v.t) : '';
      // Sheets would take "=…" as a formula and drop a leading ' (and, outside plain text, take
      // "+2" or "TRUE" as a number or a boolean); a leading ' keeps it as the text it was.
      if (typeof value === 'string' && !(f && f.t) && (/^[=']/.test(value) ||
          (!style.text && /^\s*([+-]?[\d.]|true\s*$|false\s*$)/i.test(value)))) value = "'" + value;
      while (values.length < r) { values.push([]); cells.push([]); }
      values[r - 1][c - 1] = value;
      cells[r - 1][c - 1] = style;
      width = Math.max(width, c);
    });
  });
  values.forEach((line, i) => {
    for (let j = 0; j < width; j++) {
      if (line[j] === undefined) line[j] = '';
      if (!cells[i][j]) cells[i][j] = styles[0] || {};
    }
  });
  const cols = all_(doc, 'col').map(c => ({
    min: Number(c.a.min), max: Number(c.a.max), width: c.a.customWidth === '1' || c.a.customWidth === 'true' ? Number(c.a.width) : 0,
    hidden: c.a.hidden === '1' || c.a.hidden === 'true',
  }));
  const pane = all_(doc, 'pane').find(p => p.a.state === 'frozen' || p.a.state === 'frozenSplit');
  const validations = all_(doc, 'dataValidation').map(v => ({
    type: v.a.type || 'any', sqref: v.a.sqref || '', formula: (first_(v, 'formula1') || {}).t,
    strict: v.a.showErrorMessage === '1' || v.a.showErrorMessage === 'true',
    dropdown: v.a.showDropDown !== '1' && v.a.showDropDown !== 'true', // Excel's flag means "hide it"
  }));
  if (all_(doc, 'mergeCell').length) skipped['merged cells (' + name + ')'] = 1;
  if (all_(doc, 'conditionalFormatting').length) skipped['conditional formatting (' + name + ')'] = 1;
  const prot = first_(doc, 'sheetProtection');
  const protect = prot && prot.a.sheet !== '0' && prot.a.sheet !== 'false' && Object.keys(prot.a).length
    ? { open: all_(doc, 'protectedRange').map(p => p.a.sqref).join(' ').split(/\s+/).filter(Boolean) }
    : null;
  return {
    values, cells, width, cols, validations, protect,
    frozenRows: pane ? Number(pane.a.ySplit) || 0 : 0,
    frozenCols: pane ? Number(pane.a.xSplit) || 0 : 0,
  };
}

function colNum_(letters) {
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + letters.charCodeAt(i) - 64;
  return n;
}

/* ---------- a small XML reader, enough for the parts of an .xlsx ----------
 * xml_(text) -> the document as {n: local name, a: {attribute: value}, c: [children], t: text}.
 */
function xml_(s) {
  const root = { n: '', a: {}, c: [], t: '' };
  const stack = [root];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<[?!][\s\S]*?>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(String(s || '')))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) { top.t += m[1]; continue; }
    if (m[6] !== undefined) { top.t += unescapeXml_(m[6]); continue; }
    if (!m[3]) continue; // a comment, declaration or processing instruction
    if (m[2]) { if (stack.length > 1) stack.pop(); continue; }
    const el = { n: m[3].replace(/^[\w.-]+:/, ''), a: {}, c: [], t: '' };
    const attr = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let a;
    while ((a = attr.exec(m[4]))) el.a[a[1]] = unescapeXml_(a[2] !== undefined ? a[2] : a[3]);
    top.c.push(el);
    if (!m[5]) stack.push(el);
  }
  return root;
}

function unescapeXml_(s) {
  return s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (all, e) => {
    const k = e.toLowerCase();
    if (k.charAt(0) === '#') return String.fromCodePoint(k.charAt(1) === 'x' ? parseInt(k.slice(2), 16) : Number(k.slice(1)));
    return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[k];
  });
}

function kids_(el, n) { return el ? el.c.filter(x => x.n === n) : []; }
function first_(el, n) { return el ? all_(el, n)[0] || null : null; }
function all_(el, n, out) {
  out = out || [];
  (el ? el.c : []).forEach(x => { if (x.n === n) out.push(x); all_(x, n, out); });
  return out;
}

// A shared or inline string: its <t> runs, without phonetic hints, and _xHHHH_ escapes undone.
function textOf_(el) {
  let s = '';
  (function walk(x) { x.c.forEach(k => { if (k.n === 't') s += k.t; else if (k.n !== 'rPh') walk(k); }); })(el);
  return s.replace(/_x([0-9a-f]{4})_/gi, (all, h) => String.fromCharCode(parseInt(h, 16)));
}

const REPLACE_DIALOG_HTML = `<!doctype html>
<style>
  body { font: 14px/1.4 Arial, sans-serif; margin: 0; }
  p { margin: 0 0 12px; }
  label { display: block; margin: 0 0 8px; }
  h4 { margin: 12px 0 6px; font-size: 13px; color: #555; }
  #tabs { max-height: 230px; overflow-y: auto; }
  #tabs label { margin: 0 0 4px; }
  #tabs label.all { font-weight: bold; }
  .note { color: #777; }
  .row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
  button { font: inherit; padding: 6px 14px; }
  #go { background: #c5221f; color: #fff; border: 0; border-radius: 4px; }
  #go:disabled { background: #ccc; }
  #msg { min-height: 1.4em; margin-top: 12px; }
  .err { color: #c5221f; }
</style>
<p>Each ticked tab from the file replaces the tab of the same name here, including pictures placed
in cells, or is added. Tabs you don't tick stay as they are, and so does the Images tab. The
spreadsheet, its script and the site's link stay the same. <b>File → Version history</b> can undo it.</p>
<label><input type="file" id="file" accept=".xlsx"></label>
<div id="tabs"></div>
<p id="msg"></p>
<div class="row">
  <button id="cancel" onclick="google.script.host.close()">Cancel</button>
  <button id="go" disabled>Replace</button>
</div>
<script>
  const file = document.getElementById('file');
  const tabs = document.getElementById('tabs');
  const go = document.getElementById('go');
  const msg = document.getElementById('msg');
  let data = null;
  const ticked = kind => [...tabs.querySelectorAll('input[data-kind="' + kind + '"]:checked')].map(i => i.value);
  const ready = () => {
    const all = tabs.querySelector('#all');
    const boxes = [...tabs.querySelectorAll('input[data-kind="file"]')];
    if (all) {
      all.checked = boxes.every(b => b.checked);
      all.indeterminate = !all.checked && boxes.some(b => b.checked);
    }
    go.disabled = !(data && ticked('file').length);
  };
  const say = (text, err) => { msg.className = err ? 'err' : ''; msg.textContent = text; };
  const fail = text => { say(text, true); ready(); };
  const box = (kind, name, text, on) => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = name;
    input.checked = on;
    input.dataset.kind = kind;
    input.onchange = ready;
    const note = document.createElement('span');
    note.className = 'note';
    note.textContent = text;
    label.append(input, ' ' + name + ' ', note);
    return label;
  };
  const heading = text => { const h = document.createElement('h4'); h.textContent = text; return h; };
  file.onchange = () => {
    data = null;
    tabs.replaceChildren();
    ready();
    const f = file.files[0];
    if (!f) return;
    say('Reading the file…');
    const reader = new FileReader();
    reader.onerror = () => fail('Couldn’t read that file.');
    reader.onload = () => {
      const b64 = String(reader.result).split(',')[1] || '';
      google.script.run
        .withSuccessHandler(res => {
          if (!res || !res.ok) return fail((res && res.error) || 'Something went wrong.');
          data = b64;
          tabs.append(heading('Tabs in the file'));
          const all = box('all', 'Replace all', '', true);
          all.className = 'all';
          all.querySelector('input').id = 'all';
          all.querySelector('input').onchange = e => {
            tabs.querySelectorAll('input[data-kind="file"]').forEach(b => { b.checked = e.target.checked; });
            ready();
          };
          tabs.append(all);
          res.file.forEach(t => tabs.append(box('file', t.name, t.exists ? '(replaces this sheet’s)' : '(new tab)', true)));
          if (res.sheetOnly.length) {
            tabs.append(heading('Tabs only in this sheet: tick to remove'));
            res.sheetOnly.forEach(n => tabs.append(box('remove', n, '', false)));
          }
          say('');
          ready();
        })
        .withFailureHandler(err => fail(String(err && err.message || err)))
        .listXlsxTabs(f.name, b64);
    };
    reader.readAsDataURL(f);
  };
  go.onclick = () => {
    go.disabled = true;
    say('Replacing… this can take a minute.');
    google.script.run
      .withSuccessHandler(res => {
        if (!res || !res.ok) return fail((res && res.error) || 'Something went wrong.');
        let text = 'Done: ' + res.tabs.join(', ') + '.';
        if (res.removed && res.removed.length) text += ' Removed: ' + res.removed.join(', ') + '.';
        if (res.skipped && res.skipped.length) text += ' Left out: ' + res.skipped.join('; ') + '.';
        say(text);
        if (!(res.skipped && res.skipped.length)) setTimeout(() => google.script.host.close(), 1500);
      })
      .withFailureHandler(err => fail(String(err && err.message || err)))
      .replaceWithXlsx(file.files[0].name, data, { tabs: ticked('file'), remove: ticked('remove') });
  };
</script>`;
