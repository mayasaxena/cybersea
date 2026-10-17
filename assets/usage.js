// Changes made outside edit mode (a pip marked, a bond used, treasure spent, a box ticked) gather
// in a small panel at the bottom of the page. Log writes them to the log as one entry, with an
// optional note; the panel's × undoes them instead.
// Using a kit item always logs, from its own dialog (sheet.js).

import { escTxt } from './markup.js';
import { offerUndo, withdrawUndo } from './hold.js';

// A signed count for a line, e.g. "Harm +2" or "Treasure −1".
export const signed = n => (n > 0 ? `+${n}` : `−${Math.abs(n)}`);

// What a use takes from an item with a count: how many (at least 1, at most what's left) and what's left.
export function useItem(item, n) {
  if (item.count == null) return { used: 0, left: null };
  const used = Math.min(item.count, Math.max(1, n | 0));
  return { used, left: item.count - used };
}

// The item use a log entry records ("Used 2, 1 left" or "Used" under the item's name), if the
// item is still there: undoing it gives back n.
export function useOf(entry, items) {
  const m = entry.items.length === 1 && entry.items[0].match(/^Used(?: (\d+), \d+ left)?$/);
  const item = m && items.find(x => x.name === entry.title);
  return item ? { item, n: m[1] && item.count != null ? +m[1] : 0 } : null;
}

// One log entry for the gathered lines: a single line is the title, several go under "Changes".
export function usageEntry(lines, note = '') {
  return lines.length === 1 ? { title: lines[0], items: [], note } : { title: 'Changes', items: lines, note };
}

// log(entry) adds { title, items, note } to the log and saves. undone(lines) runs after × undoes them.
export function makeUsage({ log, undone }) {
  const pending = new Map(); // key -> { n, line(n) }
  const undos = []; // one per change while the panel is open, each putting back what that change found
  let el = null;
  let note = '';
  let offer = null; // Cmd+Z, while the panel is open, does what × does

  const lines = () => [...pending.values()].map(p => p.line(p.n)).filter(Boolean);

  function draw() {
    const ls = lines();
    if (!ls.length) { clear(); return; }
    if (!el) {
      el = document.createElement('div');
      el.className = 'usage';
      el.setAttribute('role', 'region');
      el.setAttribute('aria-label', 'Log this change');
      el.innerHTML = `<ul class="ulines"></ul><div class="urow"><input class="in" placeholder="Note (optional)" aria-label="Note" autocomplete="off">` +
        '<button class="pbtn primary" data-log>Log</button><button class="mini" data-undo title="Undo" aria-label="Undo">×</button></div>';
      el.querySelector('input').addEventListener('input', e => { note = e.target.value; });
      el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); commit(); } });
      el.addEventListener('click', e => {
        if (e.target.closest('[data-log]')) commit();
        else if (e.target.closest('[data-undo]')) undo();
      });
      document.body.append(el);
      document.body.classList.add('has-usage');
    }
    el.querySelector('.ulines').innerHTML = ls.map(l => `<li>${escTxt(l)}</li>`).join('');
    document.body.style.setProperty('--usage-h', `${el.offsetHeight + 8}px`);
  }

  function hide() {
    el?.remove();
    el = null;
    document.body.classList.remove('has-usage');
  }

  function clear() {
    pending.clear();
    undos.length = 0;
    withdrawUndo(offer);
    offer = null;
    note = '';
    hide();
  }

  function undo() {
    const ls = lines();
    undos.reverse().forEach(u => u());
    clear();
    if (ls.length) undone?.(ls);
  }

  function commit() {
    const ls = lines();
    if (ls.length) log(usageEntry(ls, note.trim()));
    clear();
  }

  // Add n to the change under key; line(total) words it, or returns '' when it nets out to nothing.
  // revert, taken before the change was made, puts back what it changed.
  function add(key, n, line, revert) {
    const p = pending.get(key) || { n: 0, line };
    p.n += n;
    p.line = line;
    if (p.n) pending.set(key, p); else pending.delete(key);
    if (revert) undos.push(revert);
    draw();
    if (el) offer = offerUndo(undo);
  }

  return { add, clear };
}
