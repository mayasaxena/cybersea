// Tag lists (a crew member's tags, an NPC's): the tags the Rules tab defines are chips linking to
// their entry on the Rules page; anything else is free text. In edit mode each can be taken off,
// and a new one picked from the Rules tab's tags (a chip) or typed in (free text).
// The page handles data-act="add-tag" / "rm-tag" (data-tags = the list's key, data-k = which tag)
// with addTag and removeTag, and Enter in the #newtag-<key> field like add-tag.
import { esc, escTxt } from './core.js';
import { plain } from './markup.js';
import { href } from './games.js';
import { tagDef, splitTags } from './crew.js';

export { addTag, removeTag } from './crew.js';

// A tag's entry on the Rules page.
export const tagHref = (game, def) => href('rules.html', game, { tag: def.name, group: def.group });

export function tagsHTML(s, { R, group, game, edit = false, key }) {
  const tags = splitTags(s).map((t, k) => ({ t, k, def: tagDef(R, t, group) }));
  const rm = (t, k) => (edit ? `<button class="mini del" data-act="rm-tag" data-tags="${esc(key)}" data-k="${k}" aria-label="${esc(`Take off ${t}`)}">×</button>` : '');
  const chips = tags.filter(x => x.def).map(({ t, k, def }) => `<span class="tagwrap">${edit ? `<span class="tagchip" title="${esc(plain(def.text))}">${escTxt(t)}</span>`
    : `<a class="tagchip" href="${esc(tagHref(game, def))}" title="${esc(`${def.name}: ${plain(def.text)}`)}">${escTxt(t)}</a>`}${rm(t, k)}</span>`);
  const free = tags.filter(x => !x.def);
  const rest = edit ? free.map(({ t, k }) => `<span class="tagwrap"><span class="tagtext">${escTxt(t)}</span>${rm(t, k)}</span>`).join('')
    : free.length ? `<span class="tagtext">${free.map(x => escTxt(x.t)).join(', ')}</span>` : '';
  let h = chips.length || free.length ? `<div class="tags">${chips.join('')}${rest}</div>` : '';
  if (edit) {
    h += `<div class="additem"><input class="in" id="newtag-${esc(key)}" list="taglist" placeholder="Add a tag: pick one or type your own" aria-label="New tag" autocomplete="off">` +
      `<button class="pbtn" data-act="add-tag" data-tags="${esc(key)}">Add</button></div>`;
  }
  return h;
}

// The Rules tab's tags of a group, to pick from (once per page, while editing).
export const tagListHTML = (R, group) => `<datalist id="taglist">${R.by('tag', group || undefined).map(r => `<option value="${esc(r.name)}"></option>`).join('')}</datalist>`;
