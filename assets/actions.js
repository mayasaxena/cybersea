// Session Begins, Session Ends, Chapter's End, Begin/Leave Downtime and Level Up for a character sheet.
// The rule text shown in each dialog comes from the Rules tab (procedure rows); the mechanics
// live here. ctx = {st(), rules(), changed(), render(), editing()}.

import { esc, escTxt, fmt, fmtDate, armed, modal, closeModal, toast } from './core.js';
import { md, plain } from './markup.js';
import { logId } from './codec.js';
import { atSession, gainsFrom, rollFor, luckFloorOf } from './rules.js';

export const ACTIONS = {
  session: 'Session Begins',
  'session-end': 'Session Ends',
  chapter: 'Chapter’s End',
  'dt-begin': 'Begin Downtime',
  'dt-leave': 'Leave Downtime',
  advance: 'Level Up',
};
// Short UI labels; the full wording is in the rule text shown above them.
const CHAPTER_CHOICES = [['xp', '+1 experience'], ['luck', '+2 luck'], ['heal', 'Heal 2 harm']];
const DT_SLOTS = { port: 2, sea: 1 };
// Moves on the Moves tab that run one of these actions instead of a roll.
const MOVE_ACTIONS = { 'BEGIN DOWNTIME': 'dt-begin', 'LEAVE DOWNTIME': 'dt-leave' };

export function makeActions(ctx) {
  const st = () => ctx.st();
  const R = () => ctx.rules();
  const track = name => st().tracks[name] || null;
  const xpTrack = () => track('experience');
  const xpCount = () => (xpTrack()?.pips || []).filter(v => v === 1).length;
  const level = () => parseInt(st().info.level, 10) || 0;
  const xpNeeded = () => level() + 6; // experience equal to the next level + 5
  const statVal = k => (st().stats.find(s => s.k.toLowerCase() === k) || { v: 0 }).v;
  const luckFloor = () => Math.max(0, ...R().house('session').map(luckFloorOf));
  const luckTarget = () => Math.min(track('luck')?.pips.length || 0, Math.max(luckFloor(), statVal('spitfire')));
  const usedBonds = () => st().bonds.reduce((n, b) => n + b.pips.filter(v => v === 2).length, 0);
  const bondCount = b => b.pips.filter(v => v > 0).length;
  const playbook = () => R().playbook(st().info.playbook);
  const unmarkedMoves = () => (playbook()?.moves || []).filter(m => !st().moves.some(x => x.name.toUpperCase() === m.name.toUpperCase() && x.marked));
  const section = title => st().sections.find(s => s.title.toLowerCase() === title.toLowerCase());
  const moveText = name => (R().moves('downtime').find(m => m.name.toUpperCase() === name) || {}).text || '';
  // The character's vice, oddity and marked moves that do something when a session starts or ends.
  function sessionMoves(when) {
    const pb = playbook();
    const pbMoves = pb?.moves || [];
    const mine = name => st().moves.find(x => x.name.toUpperCase() === name.toUpperCase());
    // The one the sheet names, when the playbook offers a choice.
    const chosen = (list, title, all) => {
      const v = (section(title)?.text || '').toLowerCase();
      const named = list.filter(x => v.includes(x.name.toLowerCase()));
      return named.length || !all ? named : list;
    };
    const vices = chosen(pb?.vices || [], 'vice', true);
    const oddities = chosen(pb?.oddities || [], 'oddity', false);
    const moves = [
      ...pbMoves.filter(m => mine(m.name)?.marked).map(m => ({ name: m.name, text: mine(m.name).text || m.text, meta: m.meta })),
      ...st().moves.filter(m => m.marked && !pbMoves.some(x => x.name.toUpperCase() === m.name.toUpperCase())),
    ];
    return [...vices, ...oddities, ...moves].filter(m => atSession(when, m.text, m.meta)).map(m => ({ name: m.name, text: m.text, gains: gainsFrom(m.text) }));
  }
  let sessMoves = [];
  const marks = name => (track(name)?.pips || []).filter(v => v === 1).length;
  const sessionList = (when, none) => {
    sessMoves = sessionMoves(when);
    if (!sessMoves.length) return none ? `<div class="status">${none}</div>` : '';
    const what = m => {
      const r = rollFor(m.text, st().stats);
      return [m.gains.luck && `+${m.gains.luck} luck`, m.gains.luckFrom && `+${marks(m.gains.luckFrom)} luck`, m.gains.xp && `+${m.gains.xp} experience`,
        r && `roll ${r.stat ? `${r.label} ${fmt(r.mod)}` : r.label} on the Moves tab`].filter(Boolean).join(', ');
    };
    return '<div class="opts">' + sessMoves.map((m, k) =>
      `<div class="opt endm"><label class="eff"><input type="checkbox" data-eff="sess:${k}">${escTxt(m.name)}` +
      `${what(m) ? `<span class="cnt">${escTxt(what(m))}</span>` : ''}</label><div class="mbody">${md(m.text)}</div></div>`).join('') + '</div>';
  };
  // Tick a listed move: log it, and mark the luck or experience it says to.
  function runSessionMoves(on, items) {
    sessMoves.forEach((m, k) => {
      if (!on(`sess:${k}`)) return;
      const got = [];
      const want = m.gains.luckFrom ? marks(m.gains.luckFrom) : m.gains.luck;
      const luck = want && track('luck') ? markN(track('luck').pips, want) : 0;
      if (luck) got.push(`+${luck} luck`);
      let xp = 0;
      while (xp < m.gains.xp && markXp(m.name)) xp++;
      if (xp) got.push(`+${xp} experience`);
      items.push(got.length ? `${m.name}: ${got.join(', ')}` : m.name);
    });
  }

  function markN(pipsArr, n) {
    let done = 0;
    for (let j = 0; j < pipsArr.length && done < n; j++) if (pipsArr[j] === 0) { pipsArr[j] = 1; done++; }
    return done;
  }
  function healN(n) {
    const h = track('harm');
    let done = 0;
    for (let j = (h?.pips.length || 0) - 1; j >= 0 && done < n; j--) if (h.pips[j] === 1) { h.pips[j] = 0; done++; }
    return done;
  }
  // Mark the next experience tally and note why in the Experience section, e.g. "1 (Chapter’s End)".
  function markXp(reason) {
    const t = xpTrack();
    const j = t ? t.pips.indexOf(0) : -1;
    if (j < 0) return false;
    t.pips[j] = 1;
    const s = section('experience');
    if (s) s.text = (s.text.trim() ? s.text.replace(/\s+$/, '') + '\n' : '') + `- 1 (${reason})`;
    return true;
  }
  // Leave Downtime heals harm taken before downtime began, not fresh harm taken during it.
  function healable() {
    const h = track('harm')?.pips || [];
    const before = st().state.downtime?.harm || h;
    return h.map((v, j) => v === 1 && before[j] === 1);
  }

  const eff = (key, label, ok) =>
    `<label class="eff${ok ? '' : ' off'}"><input type="checkbox" data-eff="${key}"${ok ? ' checked' : ' disabled'}>${escTxt(label)}</label>`;
  const select = (k, items) => `<select class="in sub" data-sub="${k}">${items.map(([v, t]) => `<option value="${esc(v)}">${escTxt(t)}</option>`).join('')}</select>`;

  function ruleFor(kind) {
    // Session steps are numbered; the first is how a session begins.
    if (kind === 'session-end') return R().by('procedure', 'session').slice(1).find(r => /\b(END|CLOS)/i.test(r.name) || atSessionEnd(r.text)) || null;
    const map = { session: 'session', chapter: 'chapter', 'dt-begin': 'downtime', advance: 'advance' };
    return map[kind] ? R().procedure(map[kind]) : null;
  }

  function controls(kind) {
    const s = st();
    if (kind === 'session') {
      const have = (track('luck')?.pips || []).filter(v => v === 1).length;
      const t = luckTarget();
      return eff('luck', `Refresh luck up to ${t} (${have})`, have < t) + sessionList('start', '');
    }
    if (kind === 'session-end') return sessionList('end', 'Nothing on this sheet happens at the end of a session.');
    if (kind === 'chapter') {
      const pick = n => `<select class="in" data-pick="${n}" aria-label="Choice ${n + 1}"><option value="">—</option>` +
        CHAPTER_CHOICES.map(([k, t]) => `<option value="${k}">${t}</option>`).join('') + '</select>';
      return eff('bonds', `Replenish all bonds (${usedBonds()})`, usedBonds() > 0) + `<div class="picks">${pick(0)}${pick(1)}</div>`;
    }
    if (kind === 'dt-begin') {
      return '<div class="opts">' + [['port', 'In port'], ['sea', 'At sea']].map(([v, t], k) =>
        `<label class="optl"><input type="radio" name="where" value="${v}"${k ? '' : ' checked'}><span>${t}</span><span class="cnt">${DT_SLOTS[v]} downtime move${DT_SLOTS[v] > 1 ? 's' : ''}</span></label>`).join('') + '</div>';
    }
    if (kind === 'dt-leave') {
      const n = healable().filter(Boolean).length;
      return eff('heal', `Heal all harm (${n})`, n > 0);
    }
    if (kind === 'advance') {
      let h = `<div class="lvl">Level ${level()} → ${level() + 1}</div><div class="opts">`;
      R().advances().forEach((a, k) => {
        const label = a.text.trim() || a.name;
        const kindA = a.meta.kind;
        const taken = s.advances[kindA || label] || 0;
        let sub = '';
        let ok = true;
        if (kindA === 'trait') {
          const opts = s.stats.filter(x => x.v < 3).map(x => [x.k, `${x.k} ${fmt(x.v)}`]); // base traits stop at +3
          ok = taken < (parseInt(a.meta.max, 10) || 3) && opts.length > 0;
          sub = select(k, opts);
        } else if (kindA === 'bond') {
          const rows = s.bonds.map((b, j) => [j, `${b.name} (${bondCount(b)})`, b]).filter(x => bondCount(x[2]) < 3);
          ok = rows.length > 0;
          sub = select(k, rows.map(x => [x[0], x[1]]));
        } else if (kindA === 'move') {
          const ms = unmarkedMoves().map(m => [m.name, m.name]);
          ok = ms.length > 0;
          sub = select(k, ms);
        } else if (kindA === 'oddity') {
          sub = `<input class="in sub" data-sub="${k}" aria-label="Oddity name">`;
        }
        h += `<div class="opt${ok ? '' : ' off'}"><label class="optl"><input type="radio" name="adv" value="${k}"${ok ? '' : ' disabled'}>` +
          `<span>${escTxt(label)}</span>${taken ? `<span class="cnt">×${taken}</span>` : ''}</label>${ok ? sub : ''}</div>`;
      });
      return h + '<div class="opt"><label class="optl"><input type="radio" name="adv" value="other"><input class="in other" aria-label="Other advance"></label></div></div>';
    }
    return '';
  }

  function open(kind) {
    const title = ACTIONS[kind];
    let h = `<div class="prow"><h2>${title}</h2><span class="grow"></span><button class="mini" data-close aria-label="Close">×</button></div>`;
    if (kind === 'dt-begin' || kind === 'dt-leave') {
      const mt = moveText(kind === 'dt-begin' ? 'BEGIN DOWNTIME' : 'LEAVE DOWNTIME');
      if (mt) h += `<div class="mbody rule">${md(mt)}</div>`;
    }
    const rule = ruleFor(kind);
    if (rule?.text) h += `<div class="mbody rule">${md(rule.text)}</div>`;
    h += controls(kind) +
      `<textarea class="in anote" placeholder="Note" aria-label="Note"></textarea>
       <div class="prow"><span class="grow"></span><button class="pbtn" data-close>Cancel</button><button class="pbtn primary" data-run>${title}</button></div>`;
    const o = modal(h, { label: title, wide: true });
    const pickRadio = el => { const r = el.closest('.opt')?.querySelector('input[type=radio]'); if (r && !r.disabled) r.checked = true; };
    o.addEventListener('focusin', e => { if (e.target.matches('.sub, .other')) pickRadio(e.target); });
    o.addEventListener('change', e => { if (e.target.matches('.sub')) pickRadio(e.target); });
    o.addEventListener('click', e => { if (e.target.closest('[data-run]')) run(kind, o); });
  }

  function run(kind, o) {
    const s = st();
    const on = k => !!o.querySelector(`[data-eff="${k}"]`)?.checked;
    const items = [];
    if (kind === 'session') {
      if (on('luck')) {
        const l = track('luck');
        const need = luckTarget() - l.pips.filter(v => v === 1).length;
        const n = need > 0 ? markN(l.pips, need) : 0;
        if (n) items.push(`+${n} luck`);
      }
      runSessionMoves(on, items);
    } else if (kind === 'session-end') {
      runSessionMoves(on, items);
    } else if (kind === 'chapter') {
      if (on('bonds')) {
        let n = 0;
        s.bonds.forEach(b => { b.pips = b.pips.map(v => (v === 2 ? (n++, 1) : v)); });
        if (n) items.push(`Replenished ${n} bond${n === 1 ? '' : 's'}`);
      }
      o.querySelectorAll('[data-pick]').forEach(sel => {
        if (sel.value === 'xp') { if (markXp(ACTIONS.chapter)) items.push('+1 experience'); }
        else if (sel.value === 'luck') { const n = track('luck') ? markN(track('luck').pips, 2) : 0; if (n) items.push(`+${n} luck`); }
        else if (sel.value === 'heal') { const n = healN(2); if (n) items.push(`Healed ${n} harm`); }
      });
    } else if (kind === 'dt-begin') {
      const where = o.querySelector('input[name=where]:checked')?.value || 'port';
      s.state.downtime = { at: Date.now(), where, harm: (track('harm')?.pips || []).slice(), moves: [] };
      items.push(where === 'sea' ? 'At sea' : 'In port');
    } else if (kind === 'dt-leave') {
      (s.state.downtime?.moves || []).forEach(m => items.push(`${m.name} (${m.total})`));
      if (on('heal') && track('harm')) {
        const heal = healable();
        const n = heal.filter(Boolean).length;
        track('harm').pips = track('harm').pips.map((v, j) => (heal[j] ? 0 : v));
        if (n) items.push(`Healed ${n} harm`);
      }
      s.state.downtime = null;
    } else if (kind === 'advance') {
      const next = level() + 1;
      const pick = o.querySelector('input[name=adv]:checked');
      let bondXp = null;
      items.push(`Level ${next}`);
      if (pick && pick.value !== 'other') {
        const k = +pick.value;
        const a = R().advances()[k];
        const label = a.text.trim() || a.name;
        const sub = o.querySelector(`[data-sub="${k}"]`);
        const key = a.meta.kind || label;
        s.advances[key] = (s.advances[key] || 0) + 1;
        items.push(label);
        if (a.meta.kind === 'trait' && sub) {
          const stat = s.stats.find(x => x.k === sub.value);
          if (stat) { stat.v = Math.min(3, stat.v + 1); items.push(`${stat.k} ${fmt(stat.v)}`); }
        } else if (a.meta.kind === 'bond' && sub) {
          const b = s.bonds[+sub.value];
          const j = b ? b.pips.indexOf(0) : -1;
          if (j >= 0) { b.pips[j] = 1; items.push(`+1 bond: ${b.name}`); if (bondCount(b) === 3) bondXp = b.name; }
        } else if (a.meta.kind === 'move' && sub) {
          const m = s.moves.find(x => x.name.toUpperCase() === sub.value.toUpperCase());
          if (m) m.marked = true; else s.moves.push({ name: sub.value, marked: true, text: '' });
          items.push(sub.value);
        } else if (a.meta.kind === 'oddity' && sub && sub.value.trim()) {
          const odd = section('oddity');
          if (odd) odd.text = (odd.text.trim() ? odd.text.replace(/\s+$/, '') + '\n\n' : '') + `**${sub.value.trim()}**`;
          items.push(sub.value.trim());
        }
      } else {
        const t = (o.querySelector('.other')?.value || '').trim();
        if (t) items.push(t);
      }
      // Level up: erase all experience tally marks; the next level needs one more.
      s.info.level = String(next);
      const xt = xpTrack();
      if (xt) xt.pips = Array(xpNeeded()).fill(0);
      // Gaining a third bond through this advance gives its experience immediately.
      if (bondXp && markXp(`3 bonds with ${bondXp}`)) items.push('+1 experience');
    }
    const note = (o.querySelector('.anote')?.value || '').trim();
    const at = Date.now();
    s.log.push({ id: logId(at), at, title: ACTIONS[kind], items, note });
    ctx.changed();
    closeModal();
    ctx.render();
  }

  function logHTML(editing, readOnly = false) {
    const s = st();
    const dt = s.state.downtime;
    const xp = xpCount();
    const need = xpNeeded();
    const btn = (kind, label, cls = '', attrs = '') => `<button class="act${cls}" data-act="run" data-kind="${kind}"${attrs}>${label}</button>`;
    let h = readOnly ? '' : '<div class="actions">' +
      btn('session', ACTIONS.session) +
      btn('session-end', ACTIONS['session-end']) +
      btn('chapter', ACTIONS.chapter) +
      (dt ? btn('dt-leave', ACTIONS['dt-leave'], ' live') : btn('dt-begin', ACTIONS['dt-begin'])) +
      btn('advance', `${ACTIONS.advance}<span class="cnt">${xp}/${need}</span>`, '', xp < need ? ' disabled' : '') +
      '</div>';
    if (dt) {
      const moves = dt.moves || [];
      h += `<div class="dtbar">Downtime <time>${fmtDate(dt.at)}</time>` +
        `<span class="cnt">${dt.where === 'sea' ? 'At sea' : 'In port'} ${moves.length}/${DT_SLOTS[dt.where] || 2}</span>` +
        (moves.length ? `<span class="dtm">${moves.map(m => escTxt(`${m.name} (${m.total})`)).join(' · ')}</span>` : '') +
        '<button class="pill" data-act="dt-moves">Downtime moves</button></div>';
    }
    const entries = s.log.map((e, i) =>
      `<article class="entry"><div class="ehead"><span class="et">${escTxt(e.title)}</span><time>${e.at ? fmtDate(e.at) : ''}</time>` +
      (editing ? `<button class="mini del" data-act="rm-log" data-i="${i}" aria-label="Delete">×</button>` : '') + '</div>' +
      (e.items.length ? `<ul class="eitems">${e.items.map(t => `<li>${escTxt(t)}</li>`).join('')}</ul>` : '') +
      (editing ? `<textarea class="in enote" data-log="${i}" aria-label="Note">${escTxt(e.note || '')}</textarea>`
               : e.note ? `<p class="enote">${escTxt(e.note)}</p>` : '') +
      '</article>').reverse().join('');
    return h + (entries || '<div class="empty">—</div>');
  }

  // The action a move runs, and whether it can run now (only one of Begin/Leave Downtime applies).
  function forMove(move) {
    const kind = move.cat === 'downtime' && MOVE_ACTIONS[move.name.toUpperCase()];
    if (!kind) return null;
    const dt = !!st().state.downtime;
    return { kind, label: kind === 'dt-begin' ? 'Begin' : 'Leave', ok: kind === 'dt-begin' ? !dt : dt,
      why: kind === 'dt-begin' ? 'Already in downtime' : 'Not in downtime' };
  }

  // Luck a move spends outright: "spend 1-luck", "pay 3-luck", "spend x-luck" (x asks how much).
  // Not "you don't have to spend 1-luck".
  function luckCost(move) {
    const m = plain(move.text).match(/(?<!have to )\b(?:spend|pay) (\d+|x)-luck\b/i);
    if (!m || !track('luck')) return null;
    const n = m[1].toLowerCase() === 'x' ? null : +m[1];
    const have = track('luck').pips.filter(v => v === 1).length;
    return { n, have, ok: have >= (n || 1) };
  }

  function spendLuck(move) {
    const c = luckCost(move);
    if (!c?.ok) return;
    const spend = n => {
      const l = track('luck').pips;
      let done = 0;
      for (let j = l.length - 1; j >= 0 && done < n; j--) if (l[j] === 1) { l[j] = 0; done++; }
      ctx.changed();
      ctx.render();
      toast(`Spent ${done} luck: ${move.name} (${c.have - done} left)`);
    };
    if (c.n) { spend(c.n); return; }
    const o = modal(`<div class="prow"><h2>${escTxt(move.name)}</h2><span class="grow"></span><button class="mini" data-close aria-label="Close">×</button></div>
      <label class="field"><span class="lbl">Luck to spend (${c.have})</span><input class="in" type="number" data-luck min="1" max="${c.have}" value="1"></label>
      <div class="prow"><span class="grow"></span><button class="pbtn" data-close>Cancel</button><button class="pbtn primary" data-spend>Spend luck</button></div>`, { label: move.name });
    o.querySelector('[data-luck]').focus();
    o.addEventListener('click', e => {
      if (!e.target.closest('[data-spend]')) return;
      const n = Math.min(c.have, Math.max(1, parseInt(o.querySelector('[data-luck]').value, 10) || 1));
      closeModal();
      spend(n);
    });
  }

  // Count downtime moves rolled during downtime.
  function noteRoll(move, total) {
    const dt = st().state.downtime;
    if (!dt || move.cat !== 'downtime') return false;
    (dt.moves = dt.moves || []).push({ name: move.name, total });
    return true;
  }

  return { open, logHTML, noteRoll, forMove, luckCost, spendLuck, armed, xpCount, xpNeeded };
}
