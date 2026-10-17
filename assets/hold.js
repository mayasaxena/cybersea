// Deletes wait here for a few seconds before they go to the sheet, so Undo can take them back
// with nothing to repair. hold(commit) runs commit after UNDO_MS, or at once if the page is
// hidden or closed first; cancel() means it never runs.

// (The browser tests shorten it with localStorage cybersea:undoMs.)
const short = (() => { try { return +localStorage.getItem('cybersea:undoMs'); } catch { return 0; } })();
export const UNDO_MS = short > 0 ? short : 10000;

const held = new Set();

export function hold(commit, ms = UNDO_MS) {
  const h = {
    run() { if (!held.delete(h)) return; clearTimeout(t); commit(); },
    cancel() { held.delete(h); clearTimeout(t); },
  };
  const t = setTimeout(() => h.run(), ms);
  held.add(h);
  return h;
}

// Cmd+Z (Ctrl+Z) runs the latest undo on offer: a toast's Undo, or the log panel's ×. In a text
// field it stays the field's own undo.
let undoable = null; // { run, until }
export function offerUndo(run, ms = Infinity) {
  undoable = { run, until: Date.now() + ms };
  return undoable;
}
export function withdrawUndo(u) { if (u && undoable === u) undoable = null; }

// Leaving the page (or putting it in the background, which may be the last chance) sends what's held.
const flush = () => { for (const h of [...held]) h.run(); };
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  addEventListener('pagehide', flush);
  document.addEventListener('keydown', e => {
    if (e.key.toLowerCase() !== 'z' || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    const u = undoable;
    undoable = null;
    if (!u || Date.now() > u.until) return;
    e.preventDefault();
    u.run();
  });
}
