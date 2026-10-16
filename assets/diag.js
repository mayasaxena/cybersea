// diag.html: check a deployed game script before using it. Works from file:// too.
import { call, ping, API_VERSION } from './api.js';
import { upsertGame, href } from './games.js';
import { esc, escTxt, applyTheme } from './core.js';

applyTheme();
const form = document.getElementById('diag');
const out = document.getElementById('out');
const line = (ok, label, detail = '') => `<div class="dline ${ok === null ? 'wait' : ok ? 'good' : 'bad'}"><b>${ok === null ? '…' : ok ? '✓' : '✗'} ${escTxt(label)}</b>${detail ? `<div>${detail}</div>` : ''}</div>`;
const ms = t0 => `${Math.round(performance.now() - t0)} ms`;

form.addEventListener('submit', async e => {
  e.preventDefault();
  const api = form.api.value.trim();
  const key = form.key.value.trim();
  let html = '';
  const show = extra => { out.innerHTML = html + (extra || ''); };

  if (!/^https:\/\/script\.google(usercontent)?\.com\/.+\/exec$/.test(api) && !/^http:\/\/127\.0\.0\.1/.test(api)) {
    html += line(false, 'Web app URL', 'It should look like https://script.google.com/macros/s/…/exec (Deploy → Manage deployments → Web app URL).');
  }

  show(line(null, 'Reaching the script'));
  let t0 = performance.now();
  try {
    const r = await ping(api);
    html += line(r.ok, 'Reaching the script', `Answered in ${ms(t0)} (API version ${escTxt(r.v)}).`);
    const v = Number(r.v) || 0;
    if (v < API_VERSION) {
      const missing = v < 2
        ? 'Players can’t join without a passphrase until it’s updated.'
        : v < 3
          ? 'It works, but an edit sent again after being offline can undo newer changes to the same rows.'
          : 'It works, but the site shows the book’s wording for every Rules row: the Override columns are ignored.';
      html += line(false, 'Script version', `This deployment runs an older Code.gs (version ${v}; the latest is ${API_VERSION}). ${missing} Paste the latest <code>apps-script/Code.gs</code> into the Apps Script editor and save, then <b>Deploy → Manage deployments</b>, click the pencil, set <b>Version: New version</b> and click <b>Deploy</b>. Saving alone doesn’t change what’s deployed.`);
    }
  } catch {
    html += line(false, 'Reaching the script', 'No answer. Check the URL, and that the deployment’s “Who has access” is “Anyone”. If you just deployed, wait a minute and try again.');
    show();
    return;
  }

  show(line(null, 'Reading the sheet'));
  const times = [];
  let r;
  try {
    for (let i = 0; i < 3; i++) { t0 = performance.now(); r = await call(api, { op: 'read', key, tabs: ['Rules'] }); times.push(performance.now() - t0); }
    const tabs = r.list.map(t => `${t.name} (${t.kind})`).join(', ');
    const rules = r.tabs.Rules?.rows?.length ?? 0;
    html += line(true, 'Reading the sheet', `Game “${escTxt(r.game)}”, signed in as <b>${escTxt(r.role)}</b>. Tabs: ${escTxt(tabs)}. Rules rows: ${rules}. Round trips: ${times.map(t => Math.round(t)).join(', ')} ms.`);
    if (!rules) html += line(false, 'Rules tab', 'The Rules tab is empty or missing; moves and playbooks won’t show up.');
  } catch (err) {
    const hint = err.code === 'auth' ? 'The passphrase didn’t match GM_KEY in Script properties (or CREW_KEY, if you set one).' : err.code === 'html' ? 'Google returned an error page. Re-deploy (Manage deployments → Edit → New version) and try again.' : '';
    html += line(false, 'Reading the sheet', `${escTxt(err.message)} ${hint}`);
    show();
    return;
  }

  if (r.role === 'gm') {
    show(line(null, 'Round-trip check'));
    try {
      const s = await call(api, { op: 'selftest', key });
      const bad = s.results.filter(x => !x.ok);
      html += line(s.ok, 'Values survive the sheet unchanged', bad.length
        ? `These came back different: ${bad.map(x => `<code>${esc(JSON.stringify(x.sent))}</code> → <code>${esc(JSON.stringify(x.got))}</code>`).join(', ')}. Tell Claude what this says.`
        : `All ${s.results.length} test values came back exactly.`);
    } catch (err) { html += line(false, 'Round-trip check', escTxt(err.message)); }
  } else {
    html += line(true, 'Round-trip check', 'Skipped: run this with the GM passphrase to include it.');
  }

  const g = upsertGame({ api, key, name: r.game || 'Game', role: r.role });
  html += `<p><a class="pbtn primary" href="${esc(href('index.html', g))}">Open this game</a></p>`;
  show();
});
