/**
 * The spreadsheet's Cybersea menu: Replace with an xlsx… swaps every tab for the tabs of an .xlsx
 * file (a fresh workbook from tools/xlsx/build.py, say), picked from the computer.
 *
 * The spreadsheet itself stays: its name, its script, the script's properties and the web app
 * deployment, so the site's URL and invite links keep working. Everything on the tabs is
 * replaced, including pictures placed in cells (File > Version history can bring them back).
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
  const html = HtmlService.createHtmlOutput(REPLACE_DIALOG_HTML).setWidth(460).setHeight(330);
  SpreadsheetApp.getUi().showModalDialog(html, 'Replace with an xlsx');
}

// Called from the dialog: name is the file's name, data its bytes in base64.
function replaceWithXlsx(name, data) {
  name = String(name || '');
  if (!/\.xlsx$/i.test(name)) return { ok: false, error: 'Pick an .xlsx file.' };
  const bytes = Utilities.base64Decode(String(data || ''));
  if (!bytes.length) return { ok: false, error: 'That file is empty.' };
  if (bytes.length > MAX_XLSX_BYTES) return { ok: false, error: 'That file is too big.' };
  let book;
  try {
    // An .xlsx is a zip, and Utilities.unzip only takes a blob typed as one.
    book = readXlsx_(Utilities.unzip(Utilities.newBlob(bytes, 'application/zip', name)));
  } catch (err) {
    return { ok: false, error: 'That doesn’t look like an .xlsx file (' + (err.message || err) + '). Nothing was changed.' };
  }
  return withLock_(() => replaceTabs_(SpreadsheetApp.getActiveSpreadsheet(), book));
}

// Replaces ss's tabs with the workbook's, in its order. The new tabs are made first, so a failure
// leaves the old tabs as they were.
function replaceTabs_(ss, book) {
  if (!book.tabs.some(t => tabKind_(t.name) === 'rules')) {
    return { ok: false, error: 'That file has no Rules tab, so it doesn’t look like a game. Nothing was changed.' };
  }
  const old = ss.getSheets();
  const made = [];
  try {
    book.tabs.forEach((t, i) => {
      const sh = ss.insertSheet('Importing ' + (i + 1) + ' ' + Date.now());
      made.push(sh);
      fillSheet_(sh, t, book.skipped);
    });
  } catch (err) {
    made.forEach(sh => ss.deleteSheet(sh));
    throw err;
  }
  old.forEach(sh => ss.deleteSheet(sh));
  made.forEach((sh, i) => {
    sh.setName(book.tabs[i].name);
    ss.setActiveSheet(sh);
    ss.moveActiveSheet(i + 1);
  });
  made.forEach((sh, i) => { if (book.tabs[i].hidden) sh.hideSheet(); });
  ss.setActiveSheet(made.find(sh => !sh.isSheetHidden()) || made[0]);

  // Rows remembered as removed (see gone_) were the old tabs' rows.
  const props = PropertiesService.getDocumentProperties();
  Object.keys(props.getProperties()).filter(k => k.indexOf('gone:') === 0).forEach(k => props.deleteProperty(k));
  const skipped = Object.keys(book.skipped);
  return { ok: true, tabs: made.map(sh => sh.getName()), skipped };
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
  range.setFontWeights(grid(c => (c.bold ? 'bold' : 'normal')));
  range.setBackgrounds(grid(c => c.fill || null));
  range.setWraps(grid(c => !!c.wrap));
  t.cols.forEach(c => {
    for (let i = c.min; i <= Math.min(c.max, nc); i++) {
      if (c.width) sh.setColumnWidth(i, Math.round(c.width * 7 + 5));
      if (c.hidden) sh.hideColumns(i);
    }
  });
  if (t.frozenRows) sh.setFrozenRows(t.frozenRows);
  if (t.frozenCols) sh.setFrozenColumns(t.frozenCols);
  t.validations.forEach(v => {
    const list = listOf_(v.formula);
    if (v.type !== 'list' || !list) {
      skipped['data validation that isn’t a list of choices (' + t.name + ' ' + v.sqref + ')'] = 1;
      return;
    }
    const rule = SpreadsheetApp.newDataValidation().requireValueInList(list, v.dropdown).setAllowInvalid(!v.strict).build();
    v.sqref.split(/\s+/).filter(Boolean).forEach(a1 => sh.getRange(a1).setDataValidation(rule));
  });
  if (t.protect) {
    const p = sh.protect();
    p.setUnprotectedRanges(t.protect.open.map(a1 => sh.getRange(a1)));
    p.removeEditors(p.getEditors());
    if (p.canDomainEdit()) p.setDomainEdit(false);
  }
}

// "on,off" in quotes -> ['on', 'off']; anything else (a range, a formula) -> null.
function listOf_(formula) {
  const m = /^"(.*)"$/.exec(String(formula || '').trim());
  return m ? m[1].split(',').map(s => s.trim()) : null;
}

/* ---------- reading an .xlsx ---------- */

// blobs: the unzipped parts. Returns {tabs: [{name, hidden, values, cells, width, cols,
// frozenRows, frozenCols, validations, protect}], skipped: {what: 1}}.
function readXlsx_(blobs) {
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
    const tab = readSheet_(xml_(text(path)), shared, styles, skipped, s.a.name);
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
  label { display: block; margin: 0 0 12px; }
  .row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
  button { font: inherit; padding: 6px 14px; }
  #go { background: #c5221f; color: #fff; border: 0; border-radius: 4px; }
  #go:disabled { background: #ccc; }
  #msg { min-height: 1.4em; }
  .err { color: #c5221f; }
</style>
<p>Every tab in this spreadsheet is replaced by the tabs in the file, including pictures placed in
cells. The spreadsheet, its script and the site's link stay the same.
<b>File → Version history</b> can undo it.</p>
<label><input type="file" id="file" accept=".xlsx"></label>
<label><input type="checkbox" id="sure"> Replace every tab in this spreadsheet</label>
<p id="msg"></p>
<div class="row">
  <button id="cancel" onclick="google.script.host.close()">Cancel</button>
  <button id="go" disabled>Replace</button>
</div>
<script>
  const file = document.getElementById('file');
  const sure = document.getElementById('sure');
  const go = document.getElementById('go');
  const msg = document.getElementById('msg');
  const ready = () => { go.disabled = !(file.files.length && sure.checked); };
  file.onchange = ready;
  sure.onchange = ready;
  const fail = text => { msg.className = 'err'; msg.textContent = text; ready(); };
  go.onclick = () => {
    const f = file.files[0];
    go.disabled = true;
    msg.className = '';
    msg.textContent = 'Replacing… this can take a minute.';
    const reader = new FileReader();
    reader.onerror = () => fail('Couldn’t read that file.');
    reader.onload = () => {
      google.script.run
        .withSuccessHandler(res => {
          if (!res || !res.ok) return fail((res && res.error) || 'Something went wrong.');
          msg.textContent = 'Done: ' + res.tabs.join(', ') + '.' + (res.skipped && res.skipped.length ? ' Left out: ' + res.skipped.join('; ') + '.' : '');
          if (!(res.skipped && res.skipped.length)) setTimeout(() => google.script.host.close(), 1500);
        })
        .withFailureHandler(err => fail(String(err && err.message || err)))
        .replaceWithXlsx(f.name, String(reader.result).split(',')[1] || '');
    };
    reader.readAsDataURL(f);
  };
</script>`;
