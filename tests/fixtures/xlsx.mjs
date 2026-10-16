// Builds a small .xlsx (a zip of SpreadsheetML parts, stored uncompressed) for tests, the way
// openpyxl and Excel write them: strings shared or inline, styles by index, validations,
// frozen panes and sheet protection.
import { crc32 } from 'node:zlib';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const col = c => (c > 26 ? col(Math.floor((c - 1) / 26)) : '') + String.fromCharCode(65 + ((c - 1) % 26));
const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

// Styles: 0 plain, 1 plain text (@), 2 bold header with a fill, 3 plain text and wrapped.
const STYLES = `<?xml version="1.0" encoding="UTF-8"?><styleSheet ${NS}><numFmts count="0"/>
<fonts count="2"><font><sz val="11"/></font><font><b val="1"/></font></fonts>
<fills count="3"><fill><patternFill/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="00E8EEF3"/></patternFill></fill></fills>
<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0"/><xf numFmtId="49" fontId="0" fillId="0"/><xf numFmtId="0" fontId="1" fillId="2"/><xf numFmtId="49" fontId="0" fillId="0"><alignment wrapText="1" vertical="top"/></xf></cellXfs></styleSheet>`;

// tabs: [{name, rows: [[value | {f: formula} | {v, s: style}]], hidden, style (default for
// strings: 1), inline (inline strings, not shared), cols: [{min, max, width, hidden}],
// freeze: {rows, cols}, validations: [{sqref, formula, type, strict}], protect: {open: [a1]},
// merge: 'A1:B1'}]
export function makeXlsx(tabs, { extra = {} } = {}) {
  const shared = [];
  const sheets = tabs.map(t => {
    const rows = t.rows.map((line, r) => `<row r="${r + 1}">${line.map((v, c) => {
      const ref = `${col(c + 1)}${r + 1}`;
      if (v && typeof v === 'object' && 'f' in v) return `<c r="${ref}"><f>${esc(v.f)}</f><v></v></c>`;
      const s = v && typeof v === 'object' ? v.s : r === 0 && t.header !== false ? 2 : (t.style ?? 1);
      const val = v && typeof v === 'object' ? v.v : v;
      if (val === '' || val == null) return `<c r="${ref}" s="${s}"/>`;
      if (typeof val === 'number') return `<c r="${ref}" s="${s}"><v>${val}</v></c>`;
      if (typeof val === 'boolean') return `<c r="${ref}" s="${s}" t="b"><v>${val ? 1 : 0}</v></c>`;
      if (t.inline) return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(val)}</t></is></c>`;
      shared.push(val);
      return `<c r="${ref}" s="${s}" t="s"><v>${shared.length - 1}</v></c>`;
    }).join('')}</row>`).join('');
    const pane = t.freeze ? `<sheetViews><sheetView workbookViewId="0"><pane${t.freeze.cols ? ` xSplit="${t.freeze.cols}"` : ''}${t.freeze.rows ? ` ySplit="${t.freeze.rows}"` : ''} topLeftCell="A2" state="frozen"/></sheetView></sheetViews>` : '';
    const cols = t.cols ? `<cols>${t.cols.map(c => `<col min="${c.min}" max="${c.max}"${c.width ? ` width="${c.width}" customWidth="1"` : ''}${c.hidden ? ' hidden="1"' : ''}/>`).join('')}</cols>` : '';
    const prot = t.protect ? `<sheetProtection sheet="1" objects="1"/>${t.protect.open?.length ? `<protectedRanges>${t.protect.open.map((a, i) => `<protectedRange name="r${i}" sqref="${a}"/>`).join('')}</protectedRanges>` : ''}` : '';
    const merge = t.merge ? `<mergeCells count="1"><mergeCell ref="${t.merge}"/></mergeCells>` : '';
    const dv = t.validations ? `<dataValidations count="${t.validations.length}">${t.validations.map(v => `<dataValidation type="${v.type || 'list'}" allowBlank="1"${v.strict ? ' showErrorMessage="1"' : ''} sqref="${v.sqref}"><formula1>${esc(v.formula)}</formula1></dataValidation>`).join('')}</dataValidations>` : '';
    return `<?xml version="1.0" encoding="UTF-8"?>\n<!-- made by a test --><worksheet ${NS}>${pane}${cols}<sheetData>${rows}</sheetData>${prot}${merge}${dv}</worksheet>`;
  });
  const files = {
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8"?><workbook ${NS}><sheets>${tabs.map((t, i) => `<sheet name="${esc(t.name)}" sheetId="${i + 1}"${t.hidden ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${tabs.map((t, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${i % 2 ? '/xl/' : ''}worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`,
    'xl/styles.xml': STYLES,
    'xl/sharedStrings.xml': `<?xml version="1.0" encoding="UTF-8"?><sst ${NS}>${shared.map(s => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')}</sst>`,
    ...Object.fromEntries(sheets.map((x, i) => [`xl/worksheets/sheet${i + 1}.xml`, x])),
    ...extra,
  };
  return zip(Object.entries(files).map(([n, s]) => [n, Buffer.from(s, 'utf8')]));
}

function zip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const n = Buffer.from(name, 'utf8');
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4);
    head.writeUInt32LE(crc32(data), 14); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(n.length, 26);
    locals.push(head, n, data);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6);
    dir.writeUInt32LE(crc32(data), 16); dir.writeUInt32LE(data.length, 20); dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(n.length, 28); dir.writeUInt32LE(offset, 42);
    central.push(dir, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
