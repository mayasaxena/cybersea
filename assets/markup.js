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

// Old nexa.html sections were stored as HTML; convert them for import. Browser only (DOMParser).
export function htmlToMarkup(html) {
  const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
  const inl = node => [...node.childNodes].map(n => {
    if (n.nodeType === 3) return n.textContent.replace(/\s+/g, ' ');
    if (n.nodeType !== 1) return '';
    const t = n.tagName.toLowerCase();
    if (t === 'ul' || t === 'ol') return '';
    if (t === 'br') return ' ';
    const inner = inl(n);
    if (t === 'b' || t === 'strong') {
      if (n.classList.contains('t')) return `*${inner}*`;
      if (n.classList.contains('k')) return `~${inner}~`;
      if (n.classList.contains('s')) return inner;
      return `**${inner}**`;
    }
    if (t === 'i' || t === 'em') return `^${inner}^`;
    return inner;
  }).join('');
  const out = [];
  const list = (ul, depth) => {
    const ck = ul.classList.contains('ck');
    for (const li of ul.children) {
      if (li.tagName.toLowerCase() !== 'li') continue;
      const mark = ck ? (li.classList.contains('on') ? '[x] ' : '[ ] ') : '- ';
      out.push('  '.repeat(depth) + mark + inl(li).trim());
      for (const sub of li.children) if (/^(ul|ol)$/i.test(sub.tagName)) list(sub, depth + 1);
    }
  };
  const block = node => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { if (n.textContent.trim()) { out.push(n.textContent.trim(), ''); } continue; }
      if (n.nodeType !== 1) continue;
      const t = n.tagName.toLowerCase();
      if (t === 'ul' || t === 'ol') { list(n, 0); out.push(''); }
      else if (t === 'p' || t === 'div') { const s = inl(n).trim(); if (s) out.push(s, ''); for (const sub of n.children) if (/^(ul|ol)$/i.test(sub.tagName)) { list(sub, 0); out.push(''); } }
      else { const s = inl(n).trim(); if (s) out.push(s, ''); }
    }
  };
  block(doc.body);
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
