// Unit tests for apps-script/Update.gs (the Cybersea menu's Update the script), run against
// tools/gas-fake.mjs with a fake GitHub and Apps Script API.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGas, loadCodeGs, loadAlso } from '../tools/gas-fake.mjs';

const MANIFEST = scopes => JSON.stringify({ oauthScopes: scopes });

// repo: {file name: source}; project: [{name, type, source}]; deployments as the API lists them.
function setup({ repo, project, deployments, apiOff = false, props = {}, answer = 'YES' } = {}) {
  const gas = createGas({ tabs: { Rules: [['Kind']] }, props });
  const api = loadCodeGs(gas);
  const ctx = loadAlso(api, 'Update.gs');
  const calls = [];
  const alerts = [];
  const state = { files: structuredClone(project), versions: 0, deployments: structuredClone(deployments || []) };
  const reply = (code, body) => ({ getResponseCode: () => code, getContentText: () => (typeof body === 'string' ? body : JSON.stringify(body)) });
  ctx.ScriptApp = { getScriptId: () => 'SID', getOAuthToken: () => 'TOKEN' };
  ctx.UrlFetchApp = {
    fetch: (url, opts = {}) => {
      const method = (opts.method || 'get').toLowerCase();
      calls.push([method, url]);
      let m;
      if ((m = /^https:\/\/api\.github\.com\/repos\/(.+?)\/contents\/apps-script\?ref=(.+)$/.exec(url))) {
        if (m[1] !== 'mayasaxena/cybersea' && m[1] !== 'someone/fork') return reply(404, 'not found');
        return reply(200, Object.keys(repo).map(name => ({ name, type: 'file', download_url: `https://raw.example/${m[1]}/${m[2]}/${name}` })).concat({ name: 'old', type: 'dir' }));
      }
      if ((m = /^https:\/\/raw\.example\/.+\/([^/]+)$/.exec(url))) return reply(200, repo[m[1]]);
      if ((m = /^https:\/\/script\.googleapis\.com\/v1\/projects\/SID\/(.+)$/.exec(url))) {
        assert.equal(opts.headers.Authorization, 'Bearer TOKEN');
        if (apiOff) return reply(403, { error: { message: 'User has not enabled the Apps Script API. Enable it by visiting https://script.google.com/home/usersettings' } });
        const body = opts.payload ? JSON.parse(opts.payload) : null;
        if (m[1] === 'content' && method === 'get') return reply(200, { files: state.files });
        if (m[1] === 'content' && method === 'put') { state.files = body.files; return reply(200, body); }
        if (m[1] === 'versions' && method === 'post') return reply(200, { versionNumber: ++state.versions + 4 });
        if (m[1] === 'deployments' && method === 'get') return reply(200, { deployments: state.deployments });
        if ((m = /^deployments\/(.+)$/.exec(m[1])) && method === 'put') {
          const d = state.deployments.find(x => x.deploymentId === m[1]);
          d.deploymentConfig = body.deploymentConfig;
          return reply(200, d);
        }
      }
      return reply(404, 'no route ' + method + ' ' + url);
    },
  };
  ctx.SpreadsheetApp.getUi = () => ({
    ButtonSet: { OK: 'OK', YES_NO: 'YES_NO' },
    Button: { YES: 'YES', NO: 'NO' },
    alert: (title, text, buttons) => { alerts.push(text); return buttons === 'YES_NO' ? answer : 'OK'; },
  });
  return { ctx, calls, alerts, state };
}

const PROJECT = [
  { name: 'appsscript', type: 'JSON', source: MANIFEST(['a']) },
  { name: 'Code', type: 'SERVER_JS', source: 'old code' },
  { name: 'Mine', type: 'SERVER_JS', source: 'the owner’s own file' },
];
const WEB_APP = { deploymentId: 'WEB', deploymentConfig: { versionNumber: 4, description: 'Game' }, entryPoints: [{ entryPointType: 'WEB_APP' }] };
const HEAD = { deploymentId: 'HEAD', deploymentConfig: { description: 'Head' }, entryPoints: [{ entryPointType: 'WEB_APP' }] };

test('copies the repository’s files over the script’s, keeps the others, and redeploys the web app', () => {
  const { ctx, alerts, state } = setup({
    repo: { 'Code.gs': 'new code', 'Import.gs': 'import', 'appsscript.json': MANIFEST(['a']), 'README.md': 'skipped' },
    project: PROJECT,
    deployments: [WEB_APP, HEAD],
  });
  ctx.updateScript();
  assert.match(alerts[0], /Replace Code\.gs, Import\.gs with the versions from mayasaxena\/cybersea@main/);
  assert.deepEqual(state.files.map(f => [f.name, f.type, f.source]), [
    ['appsscript', 'JSON', MANIFEST(['a'])],
    ['Code', 'SERVER_JS', 'new code'],
    ['Mine', 'SERVER_JS', 'the owner’s own file'],
    ['Import', 'SERVER_JS', 'import'],
  ]);
  assert.deepEqual(state.deployments.find(d => d.deploymentId === 'WEB').deploymentConfig,
    { scriptId: 'SID', versionNumber: 5, manifestFileName: 'appsscript', description: 'Game' });
  assert.deepEqual(state.deployments.find(d => d.deploymentId === 'HEAD').deploymentConfig, { description: 'Head' });
  assert.match(alerts[1], /deployed version 5\./);
  assert.doesNotMatch(alerts[1], /permissions/);
});

test('says when the new version needs new permissions', () => {
  const { ctx, alerts } = setup({
    repo: { 'Code.gs': 'old code', 'appsscript.json': MANIFEST(['a', 'b']) },
    project: PROJECT,
    deployments: [WEB_APP],
  });
  ctx.updateScript();
  assert.match(alerts[0], /Replace appsscript\.json /);
  assert.match(alerts[1], /needs permissions it didn’t have/);
});

test('changes nothing when already up to date, or when the owner says no', () => {
  const upToDate = setup({ repo: { 'Code.gs': 'old code', 'appsscript.json': MANIFEST(['a']) }, project: PROJECT, deployments: [WEB_APP] });
  upToDate.ctx.updateScript();
  assert.deepEqual(upToDate.alerts, ['The script is already up to date with mayasaxena/cybersea@main.']);
  assert.equal(upToDate.calls.some(([m]) => m !== 'get'), false);

  const no = setup({ repo: { 'Code.gs': 'new code' }, project: PROJECT, deployments: [WEB_APP], answer: 'NO' });
  no.ctx.updateScript();
  assert.equal(no.alerts.length, 1);
  assert.equal(no.calls.some(([m]) => m !== 'get'), false);
  assert.equal(no.state.files[1].source, 'old code');
});

test('says how to turn on the Apps Script API', () => {
  const { ctx, alerts } = setup({ repo: { 'Code.gs': 'new code' }, project: PROJECT, apiOff: true });
  ctx.updateScript();
  assert.match(alerts[0], /Turn on the Apps Script API first: open https:\/\/script\.google\.com\/home\/usersettings/);
});

test('SCRIPT_SOURCE picks another repository; one without Code.gs is turned down', () => {
  const fork = setup({ repo: { 'Code.gs': 'fork code' }, project: PROJECT, deployments: [WEB_APP], props: { SCRIPT_SOURCE: 'someone/fork@dev' } });
  fork.ctx.updateScript();
  assert.ok(fork.calls.some(([, url]) => url === 'https://api.github.com/repos/someone/fork/contents/apps-script?ref=dev'));
  assert.equal(fork.state.files[1].source, 'fork code');

  const empty = setup({ repo: { 'Other.gs': 'x' }, project: PROJECT });
  empty.ctx.updateScript();
  assert.match(empty.alerts[0], /has no apps-script\/Code\.gs/);

  const bad = setup({ repo: {}, project: PROJECT, props: { SCRIPT_SOURCE: 'nonsense' } });
  bad.ctx.updateScript();
  assert.match(bad.alerts[0], /owner\/repo@branch/);
});

test('says so when there is no web app deployment to update', () => {
  const { ctx, alerts } = setup({ repo: { 'Code.gs': 'new code' }, project: PROJECT, deployments: [HEAD] });
  ctx.updateScript();
  assert.match(alerts[1], /No web app deployment was found/);
});
