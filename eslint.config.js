// Lint with `npx eslint .` (or a global eslint): no packages needed, so the globals are listed here.
// Code.gs and Import.gs share one global scope in Apps Script, so they're linted as scripts that
// see each other's functions: no-undef catches a misspelt call between them.
const BROWSER = ['window', 'document', 'location', 'history', 'navigator', 'localStorage', 'sessionStorage', 'caches',
  'fetch', 'Response', 'Request', 'Headers', 'URL', 'URLSearchParams', 'Blob', 'File', 'FileReader', 'Image', 'DOMException',
  'AbortController', 'TextEncoder', 'TextDecoder', 'atob', 'btoa', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'console', 'alert', 'confirm', 'getComputedStyle', 'matchMedia',
  'IntersectionObserver', 'MutationObserver', 'ResizeObserver', 'CSS', 'Event', 'CustomEvent', 'HTMLElement', 'Node', 'NodeFilter',
  'createImageBitmap', 'OffscreenCanvas', 'crypto', 'structuredClone', 'queueMicrotask', 'addEventListener', 'removeEventListener',
  'innerWidth', 'innerHeight', 'scrollTo', 'open', 'google', 'Storage', 'HTMLDetailsElement'];
const NODE = ['process', 'Buffer', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'URL', 'URLSearchParams',
  'TextEncoder', 'TextDecoder', 'fetch', 'AbortController', 'structuredClone', 'performance', 'atob', 'btoa', 'queueMicrotask',
  'Response', 'Blob', 'DOMException', 'crypto', 'setImmediate'];
const GAS = ['SpreadsheetApp', 'PropertiesService', 'CacheService', 'LockService', 'Utilities', 'ContentService', 'HtmlService',
  'Session', 'XmlService', 'Logger', 'UrlFetchApp', 'console'];
const ro = names => Object.fromEntries(names.map(n => [n, 'readonly']));
const gsFuns = () => {
  // Every top-level function and const of both scripts, as globals for the other.
  const fs = process.getBuiltinModule('node:fs');
  const out = {};
  for (const f of ['apps-script/Code.gs', 'apps-script/Import.gs']) {
    for (const m of fs.readFileSync(new URL(f, import.meta.url), 'utf8').matchAll(/^(?:function\s+|const\s+|let\s+)([A-Za-z_$][\w$]*)/gm)) out[m[1]] = 'readonly';
  }
  return out;
};

const rules = {
  'no-undef': 'error',
  'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
  'no-redeclare': 'error',
  'no-dupe-keys': 'error',
  'no-duplicate-imports': 'error',
  'no-unreachable': 'error',
  'no-self-assign': 'error',
  'no-const-assign': 'error',
  'no-empty': ['error', { allowEmptyCatch: true }],
  eqeqeq: ['error', 'smart'],
};

export default [
  { ignores: ['node_modules/**', 'tests/fixtures/*.gs'] },
  { files: ['assets/**/*.js', 'config.js', 'config.example.js'], languageOptions: { sourceType: 'module', globals: ro(BROWSER) }, rules },
  { files: ['**/*.mjs', 'eslint.config.js'], languageOptions: { sourceType: 'module', globals: { ...ro(NODE), ...ro(BROWSER) } }, rules },
  {
    files: ['apps-script/*.gs'],
    languageOptions: { sourceType: 'script', globals: { ...ro(GAS), ...gsFuns() } },
    rules: { ...rules, 'no-unused-vars': 'off', 'no-redeclare': 'off' }, // its functions are entry points or used by the other file
  },
];
