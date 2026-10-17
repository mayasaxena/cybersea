// Pictures from the spreadsheet: the Image column of the Map and Lore tabs. A cell holds a
// picture placed in it, which the sheet sends as "row:N" (the script then sends its bytes, op
// "image"), an =IMAGE() formula, sent as its https address, or the name of a row of the Images
// tab, sent as what that row holds ("images:N" for a placed picture).
//
// Placed pictures come through the script as base64, so they're costly: they load only as they
// near the screen, a few at a time, and are kept in the browser's Cache Storage between visits.
// A kept picture is used as is while the tab it showed on hasn't changed (and for an hour at
// most); otherwise the script is asked again with the picture's digest, and sends the bytes only
// if they changed.
import { imgSrc } from './markup.js';
import { esc } from './core.js';

const placed = new Map(); // "tab:row" -> object URL, once fetched (once per page)
const loading = new Map(); // "tab:row" -> promise of it
const MAX_PARALLEL = 3;
const KEEP_MS = 60 * 60 * 1000;
const CACHE = 'cybersea-pictures';

export function pictureHTML(tab, image, name, cls) {
  const m = String(image || '').match(/^(row|images):(\d+)$/);
  if (m) {
    const from = m[1] === 'images' ? 'Images' : tab;
    const src = placed.get(`${from}:${m[2]}`);
    return `<span class="${cls}"><img data-tab="${esc(from)}" data-in="${esc(tab)}" data-row="${m[2]}"${src ? ` src="${esc(src)}"` : ''} alt="${esc(name)}"></span>`;
  }
  const src = imgSrc(image);
  return src ? `<a class="${cls}" href="${esc(src)}" target="_blank" rel="noopener"><img src="${esc(src)}" alt="${esc(name)}" loading="lazy"></a>` : '';
}

// At most MAX_PARALLEL script calls for pictures at once.
let running = 0;
const waiting = [];
function limited(fn) {
  return new Promise((resolve, reject) => {
    const go = () => {
      running++;
      fn().then(resolve, reject).finally(() => { running--; waiting.shift()?.(); });
    };
    if (running < MAX_PARALLEL) go(); else waiting.push(go);
  });
}

// Cache Storage, keyed by a made-up address per game, tab and row. Missing (private windows,
// old browsers, plain http) just means no keeping.
const keyUrl = (client, tab, row) => `${location.origin}/__pictures/${encodeURIComponent(client.game.id)}/${encodeURIComponent(tab)}/${row}`;
async function kept(url) {
  try { return await (await caches.open(CACHE)).match(url); } catch { return undefined; }
}
async function keep(url, blob, d, seen) {
  try {
    await (await caches.open(CACHE)).put(url, new Response(blob, { headers: { 'content-type': blob.type, 'x-d': d, 'x-seen': seen, 'x-at': String(Date.now()) } }));
  } catch { /* no Cache Storage: fine */ }
}

// seen: the digest of the tab the picture shows on, as this page has it.
function picture(client, tab, row, seen) {
  const k = `${tab}:${row}`;
  if (!loading.has(k)) {
    const p = (async () => {
      const url = keyUrl(client, tab, row);
      const old = await kept(url);
      const h = old?.headers;
      if (old && seen && h.get('x-seen') === seen && Date.now() - Number(h.get('x-at')) < KEEP_MS) return old.blob();
      let r;
      try {
        r = await limited(() => client.request({ op: 'image', tab, row, have: h?.get('x-d') || undefined }));
      } catch (err) {
        if (old) return old.blob(); // offline, say: the kept copy will do
        throw new Error(err.message || 'Couldn’t load the picture.');
      }
      if (r.same && old) {
        const blob = await old.blob();
        keep(url, blob, r.d, seen || '');
        return blob;
      }
      const bytes = Uint8Array.from(atob(r.data), c => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: r.type });
      keep(url, blob, r.d || '', seen || '');
      return blob;
    })().then(blob => {
      const src = URL.createObjectURL(blob);
      placed.set(k, src);
      return src;
    });
    p.catch(() => loading.delete(k)); // a later render tries again
    loading.set(k, p);
  }
  return loading.get(k);
}

function load(client, img) {
  img.dataset.wait = '';
  const seen = client.tab(img.dataset.in || img.dataset.tab).server.d || '';
  picture(client, img.dataset.tab, +img.dataset.row, seen).then(url => {
    img.src = url;
    const box = img.parentElement;
    if (box?.tagName !== 'SPAN') return;
    const a = document.createElement('a'); // opens the picture full size
    Object.assign(a, { className: box.className, href: url, target: '_blank', rel: 'noopener' });
    box.replaceWith(a);
    a.append(img);
  }, err => {
    const note = document.createElement('span');
    note.className = 'imgfail';
    note.textContent = `${img.alt}: ${err.message}`;
    img.replaceWith(note);
  });
}

// Fill in the placed pictures under root as pages render them, once each comes near the screen.
export function showPictures(root, client) {
  const near = 'IntersectionObserver' in window
    ? new IntersectionObserver(entries => entries.forEach(e => {
      if (!e.isIntersecting) return;
      near.unobserve(e.target);
      if (!e.target.hasAttribute('src') && e.target.isConnected) load(client, e.target);
    }), { rootMargin: '400px' })
    : null;
  const fill = () => root.querySelectorAll('img[data-row]:not([src]):not([data-wait]):not([data-near])').forEach(img => {
    if (!near) { load(client, img); return; }
    img.dataset.near = '';
    near.observe(img);
  });
  new MutationObserver(fill).observe(root, { childList: true, subtree: true });
  fill();
}
