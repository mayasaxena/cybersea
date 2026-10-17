// Pictures from the spreadsheet: the Image column of the Map and Lore tabs. A cell holds a
// picture placed in it, which the sheet sends as "row:N" (the script then sends its bytes, op
// "image"), an =IMAGE() formula, sent as its https address, or the name of a row of the Images
// tab, sent as what that row holds ("images:N" for a placed picture).
import { imgSrc } from './markup.js';
import { esc } from './core.js';

const placed = new Map(); // "tab:row" -> object URL, once fetched (once per page)
const loading = new Map(); // "tab:row" -> promise of it

export function pictureHTML(tab, image, name, cls) {
  const m = String(image || '').match(/^(row|images):(\d+)$/);
  if (m) {
    const from = m[1] === 'images' ? 'Images' : tab;
    const src = placed.get(`${from}:${m[2]}`);
    return `<span class="${cls}"><img data-tab="${esc(from)}" data-row="${m[2]}"${src ? ` src="${esc(src)}"` : ''} alt="${esc(name)}"></span>`;
  }
  const src = imgSrc(image);
  return src ? `<a class="${cls}" href="${esc(src)}" target="_blank" rel="noopener"><img src="${esc(src)}" alt="${esc(name)}" loading="lazy"></a>` : '';
}

function picture(client, tab, row) {
  const k = `${tab}:${row}`;
  if (!loading.has(k)) {
    const why = msg => new Error(/unknown op/i.test(msg || '') ? `Update the game’s script to show pictures from the ${tab} tab.` : msg || 'Couldn’t load the picture.');
    loading.set(k, client.request({ op: 'image', tab, row }).catch(err => { throw why(err.message); }).then(r => {
      if (!r.ok) throw why(r.error);
      const bytes = Uint8Array.from(atob(r.data), c => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: r.type }));
      placed.set(k, url);
      return url;
    }));
  }
  return loading.get(k);
}

// Fill in the placed pictures under root as pages render them.
export function showPictures(root, client) {
  const fill = () => root.querySelectorAll('img[data-row]:not([src]):not([data-wait])').forEach(img => {
    img.dataset.wait = '';
    picture(client, img.dataset.tab, +img.dataset.row).then(url => {
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
  });
  new MutationObserver(fill).observe(root, { childList: true, subtree: true });
  fill();
}
