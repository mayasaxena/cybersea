// Light text markup used everywhere text is stored (sheet cells, rules):
//   blank line = new paragraph      "- item" = bullet (indent 2 spaces per nesting level)
//   "[ ] item" / "[x] item" = checklist item (clickable on the page)
//   **bold**   *trigger*   ~tag~   ^italic^   +STAT (highlighted)

export const escTxt = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const esc = s => escTxt(s).replace(/"/g, '&quot;');

// Openers must not follow a word character, so "climbing gear*, rope*" stays plain text.
const BOLD = /(^|[^\w*])\*\*(?=\S)(.+?)(?<=\S)\*\*(?!\w)/g;
const TRIGGER = /(^|[^\w*])\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?![\w*])/g;
const TAG = /(^|[^\w~])~(?=\S)(.+?)(?<=\S)~(?!\w)/g;
const ITALIC = /(^|[^\w^])\^(?=\S)(.+?)(?<=\S)\^(?!\w)/g;

export function inline(s) {
  return escTxt(s)
    .replace(BOLD, '$1<b>$2</b>')
    .replace(TRIGGER, '$1<b class="t">$2</b>')
    .replace(TAG, '$1<b class="k">$2</b>')
    .replace(ITALIC, '$1<i>$2</i>')
    .replace(/\+([A-Z]{3,})\b/g, '+<b class="s">$1</b>');
}

const ITEM = /^(\s*)(?:- |\[( |x|X)\] )(.*)$/;

export function md(src) {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
  let html = '';
  let para = [];
  const stack = []; // open lists: {indent, type}
  let ck = 0;

  const flush = () => { if (para.length) { html += `<p>${inline(para.join(' '))}</p>`; para = []; } };
  const closeTo = indent => { while (stack.length && stack[stack.length - 1].indent > indent) { html += '</li></ul>'; stack.pop(); } };
  const open = (type, indent) => { html += type === 'ck' ? '<ul class="ck">' : '<ul>'; stack.push({ indent, type }); };

  for (const raw of lines) {
    const m = raw.match(ITEM);
    if (m) {
      flush();
      const indent = m[1].replace(/\t/g, '  ').length;
      const type = m[2] !== undefined ? 'ck' : 'ul';
      closeTo(indent);
      const top = stack[stack.length - 1];
      if (top && top.indent === indent) {
        if (top.type === type) html += '</li>';
        else { html += '</li></ul>'; stack.pop(); open(type, indent); }
      } else {
        open(type, indent);
      }
      html += type === 'ck' ? `<li data-ck="${ck++}"${/x/i.test(m[2]) ? ' class="on"' : ''}>` : '<li>';
      html += inline(m[3]);
      continue;
    }
    if (!raw.trim()) { flush(); closeTo(-1); continue; }
    const lead = raw.match(/^\s*/)[0].length;
    if (stack.length && lead > stack[stack.length - 1].indent) { html += ' ' + inline(raw.trim()); continue; } // wrapped list line
    closeTo(-1);
    para.push(raw.trim());
  }
  flush();
  closeTo(-1);
  return html;
}

// Flip the nth checklist item ("[ ]" <-> "[x]") in the source.
export function toggleCheck(src, n) {
  let i = -1;
  return String(src ?? '').split('\n').map(line => {
    const m = line.match(/^(\s*)\[( |x|X)\] /);
    if (!m || ++i !== n) return line;
    return line.replace(/\[( |x|X)\]/, m[2] === ' ' ? '[x]' : '[ ]');
  }).join('\n');
}

// Text without markup, for search and matching.
export function plain(src) {
  return String(src ?? '')
    .replace(/^\s*(?:- |\[( |x|X)\] )/gm, '')
    .replace(/\*\*|[*~^]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// An image a Rules row points to (img=… in its meta, or an =IMAGE() formula in its Image cell):
// an https address. Anything else gives ''.
export function imgSrc(u) {
  const s = String(u || '').trim();
  return /^https:\/\/[^\s"'<>]+$/i.test(s) ? s : '';
}
