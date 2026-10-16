/**
 * The Cybersea menu's Update the script: copies the files in the repository's apps-script folder
 * over this script's files of the same name (others are left alone), saves a new version and
 * points the web app deployment at it, so the site's URL stays the same.
 *
 * It uses the Apps Script API, which the spreadsheet's owner turns on once at
 * https://script.google.com/home/usersettings, with the script.projects and script.deployments
 * scopes listed in appsscript.json. Script property SCRIPT_SOURCE (owner/repo@branch) picks
 * where the files come from; the default is DEFAULT_SOURCE.
 */

const DEFAULT_SOURCE = 'mayasaxena/cybersea@main';
const SCRIPT_API = 'https://script.googleapis.com/v1/projects/';
const FILE_TYPES = { gs: 'SERVER_JS', js: 'SERVER_JS', html: 'HTML', json: 'JSON' };

function updateScript() {
  const ui = SpreadsheetApp.getUi();
  let plan;
  try {
    plan = planUpdate_();
  } catch (err) {
    ui.alert('Update the script', String(err.message || err), ui.ButtonSet.OK);
    return;
  }
  if (!plan.changed.length) {
    ui.alert('Update the script', 'The script is already up to date with ' + plan.source + '.', ui.ButtonSet.OK);
    return;
  }
  const ok = ui.alert('Update the script',
    'Replace ' + plan.changed.join(', ') + ' with the versions from ' + plan.source + ', and deploy them?\n\n' +
    'The site keeps the same URL. File → Version history doesn’t cover the script, but Apps Script keeps every deployed version.',
    ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;
  let res;
  try {
    res = applyUpdate_(plan);
  } catch (err) {
    ui.alert('Update the script', String(err.message || err), ui.ButtonSet.OK);
    return;
  }
  ui.alert('Update the script',
    'Updated ' + plan.changed.join(', ') + ' and deployed version ' + res.version + '.' +
    (res.deployments ? '' : '\n\nNo web app deployment was found, so nothing was deployed: use Deploy → New deployment.') +
    (plan.scopesChanged ? '\n\nThe new version needs permissions it didn’t have. Choose Cybersea → Update the script again and approve them, or the site can’t reach the sheet.' : ''),
    ui.ButtonSet.OK);
}

// What would change: {source, files (this project's files, updated), changed (names), scopesChanged}.
function planUpdate_() {
  const source = PropertiesService.getScriptProperties().getProperty('SCRIPT_SOURCE') || DEFAULT_SOURCE;
  const m = /^([\w.-]+)\/([\w.-]+)@([\w./-]+)$/.exec(source);
  if (!m) throw new Error('SCRIPT_SOURCE should look like owner/repo@branch, not ' + source + '.');
  const list = fetchJson_('https://api.github.com/repos/' + m[1] + '/' + m[2] + '/contents/apps-script?ref=' + encodeURIComponent(m[3]));
  const incoming = list
    .filter(f => f.type === 'file' && FILE_TYPES[f.name.split('.').pop()])
    .map(f => {
      const ext = f.name.split('.').pop();
      return { name: f.name.slice(0, -ext.length - 1), type: FILE_TYPES[ext], source: fetchText_(f.download_url), file: f.name };
    });
  if (!incoming.some(f => f.name === 'Code' && f.type === 'SERVER_JS')) throw new Error(source + ' has no apps-script/Code.gs.');

  const files = scriptApi_('get', 'content').files || [];
  const changed = [];
  let scopesChanged = false;
  incoming.forEach(f => {
    const have = files.find(x => x.name === f.name && x.type === f.type);
    if (have && have.source === f.source) return;
    if (f.type === 'JSON' && f.name === 'appsscript') scopesChanged = scopesOf_(have && have.source).join() !== scopesOf_(f.source).join();
    changed.push(f.file);
    if (have) have.source = f.source;
    else files.push({ name: f.name, type: f.type, source: f.source });
  });
  return { source, files, changed, scopesChanged };
}

function applyUpdate_(plan) {
  const id = ScriptApp.getScriptId();
  scriptApi_('put', 'content', { scriptId: id, files: plan.files.map(f => ({ name: f.name, type: f.type, source: f.source })) });
  const version = scriptApi_('post', 'versions', { description: 'From ' + plan.source + ' (Cybersea → Update the script)' }).versionNumber;
  // Only deployments pinned to a version: the editor's own test deployment (HEAD) has none.
  const webApps = (scriptApi_('get', 'deployments').deployments || []).filter(d =>
    d.deploymentConfig && d.deploymentConfig.versionNumber &&
    (d.entryPoints || []).some(e => e.entryPointType === 'WEB_APP'));
  webApps.forEach(d => scriptApi_('put', 'deployments/' + d.deploymentId, {
    deploymentConfig: { scriptId: id, versionNumber: version, manifestFileName: 'appsscript', description: d.deploymentConfig.description || '' },
  }));
  return { version, deployments: webApps.length };
}

function scopesOf_(manifest) {
  try {
    return (JSON.parse(manifest || '{}').oauthScopes || []).slice().sort();
  } catch (err) {
    return [];
  }
}

function scriptApi_(method, path, body) {
  const opts = { method, muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } };
  if (body) {
    opts.contentType = 'application/json';
    opts.payload = JSON.stringify(body);
  }
  const res = UrlFetchApp.fetch(SCRIPT_API + ScriptApp.getScriptId() + '/' + path, opts);
  const text = res.getContentText();
  if (res.getResponseCode() === 200) return JSON.parse(text || '{}');
  if (/Apps Script API/i.test(text) && /not (been )?enabled|has not enabled/i.test(text)) {
    throw new Error('Turn on the Apps Script API first: open https://script.google.com/home/usersettings, switch it on, wait a minute and try again.');
  }
  throw new Error('Apps Script said ' + res.getResponseCode() + ': ' + text.slice(0, 300));
}

function fetchText_(url) {
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('Couldn’t fetch ' + url + ' (' + res.getResponseCode() + ').');
  return res.getContentText();
}

function fetchJson_(url) {
  return JSON.parse(fetchText_(url));
}
