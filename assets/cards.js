// Read-only summary cards for the crew home and the GM page.
import { parseSheet, isSignedIn } from './codec.js';
import { href } from './games.js';
import { plain } from './markup.js';
import { esc, escTxt, fmt, pipClass } from './core.js';

export const staticPips = (arr, bond = false) => arr.map(v => `<span class="pip${pipClass(v, bond)}" aria-hidden="true"></span>`).join('');

export function crewCardHTML(client, name, { gm = false, me = false } = {}) {
  const rows = client.tab(name).rows;
  const st = parseSheet(rows);
  const harm = st.tracks.harm?.pips || [];
  const luck = st.tracks.luck?.pips || [];
  const xp = (st.tracks.experience?.pips || []).filter(v => v === 1).length;
  const vice = st.tracks.vice?.pips || [];
  const troubles = st.sections.find(x => x.title.toLowerCase() === 'troubles')?.text || '';
  return `<a class="card crewcard" href="${esc(href('sheet.html', client.game, { c: name }))}">
    <div class="shead"><h2>${escTxt(st.info.name || name)}</h2>${me ? '<span class="pill me">You</span>' : isSignedIn(rows) ? '<span class="pill in">Signed in</span>' : ''}${st.state.downtime ? '<span class="pill">Downtime</span>' : ''}${gm && vice.includes(1) ? '<span class="pill vice">Vice</span>' : ''}</div>
    <div class="note">${escTxt([st.info.playbook, st.info.player].filter(Boolean).join(' · '))}</div>
    <div class="cc-row"><span class="lbl">Harm</span><span class="pips harm">${staticPips(harm)}</span></div>
    <div class="cc-row"><span class="lbl">Luck</span><span class="pips luck">${staticPips(luck)}</span></div>
    <div class="cc-row cc-stats">${st.stats.map(x => `<span><span class="lbl">${escTxt(x.k)}</span> ${fmt(x.v)}</span>`).join('')}</div>
    ${st.bonds.length ? `<div class="cc-bonds">${st.bonds.map(b => `<span class="cc-bond">${escTxt(b.name)} <span class="pips">${staticPips(b.pips, true)}</span></span>`).join('')}</div>` : ''}
    ${troubles.trim() ? `<div class="cc-row"><span class="lbl">Troubles</span> <span class="cc-text">${escTxt(plain(troubles))}</span></div>` : ''}
    <div class="cc-row"><span class="lbl">Level ${parseInt(st.info.level, 10) || 0}</span><span class="cnt">${xp} exp</span></div>
  </a>`;
}

export function shipCardHTML(client) {
  const s = client.tab('Ship');
  if (s.missing) return `<a class="card crewcard" href="${esc(href('ship.html', client.game))}"><h2>Ship</h2><div class="note">Not set up yet.</div></a>`;
  const st = parseSheet(s.rows);
  return `<a class="card crewcard" href="${esc(href('ship.html', client.game))}">
    <div class="shead"><h2>${escTxt(st.info.name || 'Ship')}</h2></div>
    <div class="note">${escTxt(st.info.playbook || '')}</div>
    <div class="cc-row"><span class="lbl">Wreck</span><span class="pips harm">${staticPips(st.tracks.wreck?.pips || [])}</span></div>
    <div class="cc-row"><span class="lbl">Renown</span><span class="pips luck">${staticPips(st.tracks.renown?.pips || [])}</span></div>
    <div class="cc-row cc-stats">${st.stats.map(x => `<span><span class="lbl">${escTxt(x.k)}</span> ${fmt(x.v)}</span>`).join('')}</div>
  </a>`;
}
