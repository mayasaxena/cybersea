/**
 * The spreadsheet's Cybersea menu: Replace with an xlsx… swaps every tab for the tabs of an .xlsx
 * file (a fresh workbook from tools/xlsx/build.py, say), picked from the computer.
 *
 * The spreadsheet itself stays: its name, its script, the script's properties and the web app
 * deployment, so the site's URL and invite links keep working. Everything on the tabs is
 * replaced, including pictures placed in cells (File > Version history can bring them back).
 *
 * Sheets can't read an .xlsx directly, so the file is turned into a temporary Google Sheet in
 * Drive (the Drive advanced service, enabled in appsscript.json), its tabs are copied in, and the
 * temporary sheet is deleted. That needs more than the attached spreadsheet, so appsscript.json
 * lists the scopes itself (which overrides Code.gs's @OnlyCurrentDoc): spreadsheets (to open the
 * temporary sheet), drive.file (only files this script creates), script.container.ui (the menu
 * and dialog) and script.external_request (Code.gs's pictures).
 */

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const GSHEET_MIME = 'application/vnd.google-apps.spreadsheet';
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

  const temp = Drive.Files.create(
    { name: 'Cybersea import (temporary): ' + name, mimeType: GSHEET_MIME },
    Utilities.newBlob(bytes, XLSX_MIME, name));
  try {
    const src = SpreadsheetApp.openById(temp.id);
    return withLock_(() => replaceTabs_(SpreadsheetApp.getActiveSpreadsheet(), src));
  } finally {
    try { Drive.Files.remove(temp.id); } catch (err) { console.warn('Could not delete the temporary sheet ' + temp.id + ': ' + err); }
  }
}

// Replaces ss's tabs with copies of src's, in src's order, keeping src's names, hidden tabs and
// protections. Copies are made first, so a failure leaves the old tabs as they were.
function replaceTabs_(ss, src) {
  const from = src.getSheets();
  if (!from.some(sh => tabKind_(sh.getName()) === 'rules')) {
    return { ok: false, error: 'That file has no Rules tab, so it doesn’t look like a game. Nothing was changed.' };
  }
  const old = ss.getSheets();
  const copies = [];
  try {
    from.forEach(sh => copies.push(sh.copyTo(ss)));
  } catch (err) {
    copies.forEach(c => ss.deleteSheet(c));
    throw err;
  }
  old.forEach(sh => ss.deleteSheet(sh));
  copies.forEach((copy, i) => {
    copy.setName(from[i].getName());
    ss.setActiveSheet(copy);
    ss.moveActiveSheet(i + 1);
    copyProtections_(from[i], copy);
  });
  copies.forEach((copy, i) => { if (from[i].isSheetHidden()) copy.hideSheet(); });
  ss.setActiveSheet(copies.find(c => !c.isSheetHidden()) || copies[0]);

  // Rows remembered as removed (see gone_) were the old tabs' rows.
  const props = PropertiesService.getDocumentProperties();
  Object.keys(props.getProperties()).filter(k => k.indexOf('gone:') === 0).forEach(k => props.deleteProperty(k));
  return { ok: true, tabs: copies.map(c => c.getName()) };
}

function copyProtections_(from, to) {
  const P = SpreadsheetApp.ProtectionType;
  to.getProtections(P.SHEET).concat(to.getProtections(P.RANGE)).forEach(p => p.remove());
  from.getProtections(P.SHEET).forEach(p => {
    const q = to.protect();
    q.setUnprotectedRanges(p.getUnprotectedRanges().map(r => to.getRange(r.getA1Notation())));
    protectLike_(p, q);
  });
  from.getProtections(P.RANGE).forEach(p => protectLike_(p, to.getRange(p.getRange().getA1Notation()).protect()));
}

// Only the spreadsheet's owner can edit a protected range, unless it only warns.
function protectLike_(p, q) {
  q.setDescription(p.getDescription());
  if (p.isWarningOnly()) {
    q.setWarningOnly(true);
    return;
  }
  q.removeEditors(q.getEditors());
  if (q.canDomainEdit()) q.setDomainEdit(false);
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
          msg.textContent = 'Done: ' + res.tabs.join(', ') + '.';
          setTimeout(() => google.script.host.close(), 1500);
        })
        .withFailureHandler(err => fail(String(err && err.message || err)))
        .replaceWithXlsx(f.name, String(reader.result).split(',')[1] || '');
    };
    reader.readAsDataURL(f);
  };
</script>`;
