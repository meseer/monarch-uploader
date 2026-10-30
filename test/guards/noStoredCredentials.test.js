/**
 * Guard: source code never persists credentials (ADR-010).
 *
 * Credentials (auth/bearer tokens, session and CSRF tokens, request-signing
 * headers, device IDs and encoded IDs sent as auth headers) are read from the
 * institution's page when needed or held in memory for the page. They are
 * never written to userscript (GM) storage, the configStore `auth` section,
 * the page's localStorage/sessionStorage/IndexedDB, or cookies.
 *
 * This suite parses every file under `src/` with the TypeScript compiler (so
 * comments and strings never count) and reports:
 * - any `setAuth` (the removed configStore auth writer), any
 *   `updateConfigSection(id, 'auth', ...)`, and any `saveConfig` call whose
 *   object literal has an `auth` property;
 * - GM storage writes (`GM_setValue`, `GM.setValue`, `GM_setValues`, and
 *   `storage.set` on the storage adapter) whose key or value looks like a
 *   credential;
 * - any write to the page's storage or cookies: `localStorage.setItem`,
 *   `sessionStorage.setItem`, `indexedDB`, `document.cookie = ...`,
 *   `cookieStore.set`, `GM_cookie.set`. The institution's page storage is
 *   read-only to this script, so these are reported whatever the key.
 *
 * It is a heuristic: a key built at run time from innocuous parts can slip
 * past it, so code review still applies. The scanner's own tests below pin
 * what it must and must not report.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import { STORAGE } from '../../src/core/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const SRC_DIR = path.join(ROOT, 'src');
const SOURCE_EXTENSIONS = new Set(['.ts', '.js', '.cjs', '.mjs']);

/** Storage key names and values that identify a credential */
const CREDENTIAL_KEY_PATTERN = /token|csrf|bearer|auth|session_?(id|key)|device_?id|fingerprint|secret|password|credential|cookie|api_?key|(account|customer)_?id_?encoded/i;

/**
 * Identifiers in a stored value that identify a credential. Narrower than the
 * key pattern: a bare `token` is also the name of the sync lock's random owner
 * token, which is not a credential.
 */
const CREDENTIAL_VALUE_PATTERN = /(access|auth|bearer|csrf|session|refresh|id|api)_?token|csrf|bearer|authorization|device_?id|fingerprint|secret|password|credential|(account|customer)_?id_?encoded/i;

/**
 * The only stored credential this guard accepts.
 *
 * The Monarch CSRF token is captured on app.monarch.com and needed on the bank
 * sites, and GM storage is the only channel between the two (ADR-007). It is
 * kept as the one documented exception (ADR-010, Option A):
 * docs/decisions/010-credentials-are-never-stored.md#exception-the-monarch-csrf-token
 * Do not add entries. Remove this one only through a new ADR that supersedes
 * ADR-007.
 */
const ALLOWLIST = [
  {
    file: 'src/services/auth.ts',
    sink: 'GM_setValue',
    key: 'STORAGE.MONARCH_CSRF_TOKEN',
  },
];

/**
 * Value of a `STORAGE.X` key expression, so a write is judged by the real key
 * as well as by the constant's name
 */
function resolveStorageKey(node) {
  if (node && ts.isPropertyAccessExpression(node) && node.expression.getText() === 'STORAGE') {
    const value = STORAGE[node.name.text];
    return typeof value === 'string' ? value : null;
  }
  return null;
}

/** Property names of an object literal, including shorthand ones */
function objectLiteralPropertyNames(node) {
  if (!node || !ts.isObjectLiteralExpression(node)) return [];
  return node.properties
    .filter((prop) => (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) && prop.name)
    .map((prop) => prop.name.getText());
}

function looksLikeCredentialWrite(keyNode, valueNode) {
  const keyText = keyNode ? keyNode.getText() : '';
  const resolvedKey = resolveStorageKey(keyNode) || '';
  const valueText = valueNode ? valueNode.getText() : '';
  return CREDENTIAL_KEY_PATTERN.test(keyText)
    || CREDENTIAL_KEY_PATTERN.test(resolvedKey)
    || CREDENTIAL_VALUE_PATTERN.test(valueText);
}

/**
 * Classify a call expression. Returns a finding without its location, or null.
 */
function classifyCall(call) {
  const callee = call.expression;
  const calleeText = callee.getText();
  const [first, second] = call.arguments;
  const calleeName = ts.isPropertyAccessExpression(callee) ? callee.name.text : calleeText;
  const receiver = ts.isPropertyAccessExpression(callee) ? callee.expression.getText() : '';

  if (calleeText === 'GM_setValue' || calleeText === 'GM.setValue') {
    return looksLikeCredentialWrite(first, second)
      ? { sink: 'GM_setValue', key: first ? first.getText() : '', reason: 'stores a credential in GM storage' }
      : null;
  }
  if (calleeText === 'GM_setValues' || calleeText === 'GM.setValues') {
    return looksLikeCredentialWrite(first, first)
      ? { sink: 'GM_setValues', key: first ? first.getText() : '', reason: 'stores a credential in GM storage' }
      : null;
  }
  if (calleeName === 'set' && /storage(adapter)?$/i.test(receiver)) {
    return looksLikeCredentialWrite(first, second)
      ? { sink: 'storage.set', key: first ? first.getText() : '', reason: 'stores a credential through the storage adapter' }
      : null;
  }
  if (calleeName === 'setItem' && /(^|\.)(localStorage|sessionStorage)$/.test(receiver)) {
    return { sink: `${receiver}.setItem`, key: first ? first.getText() : '', reason: 'writes to the page\'s storage, which is read-only to this script' };
  }
  if (calleeName === 'set' && /(^|\.)(cookieStore|GM_cookie|GM\.cookie)$/.test(receiver)) {
    return { sink: `${receiver}.set`, key: '', reason: 'sets a cookie' };
  }
  if (calleeName === 'updateConfigSection' && second && ts.isStringLiteralLike(second) && second.text === 'auth') {
    return { sink: 'updateConfigSection', key: 'auth', reason: 'writes the configStore auth section' };
  }
  if (calleeName === 'saveConfig' && objectLiteralPropertyNames(second).includes('auth')) {
    return { sink: 'saveConfig', key: 'auth', reason: 'writes the configStore auth section' };
  }
  return null;
}

/** Classify a node that is not a call. Returns a finding without its location, or null. */
function classifyNode(node) {
  if (ts.isIdentifier(node) && node.text === 'setAuth') {
    return { sink: 'setAuth', key: 'auth', reason: 'writes the configStore auth section' };
  }
  if (ts.isIdentifier(node) && node.text === 'indexedDB') {
    return { sink: 'indexedDB', key: '', reason: 'uses the page\'s IndexedDB' };
  }
  if (ts.isBinaryExpression(node)
    && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    && /(^|\.)document\.cookie$/.test(node.left.getText())) {
    return { sink: 'document.cookie', key: '', reason: 'sets a cookie' };
  }
  if (ts.isCallExpression(node)) {
    return classifyCall(node);
  }
  return null;
}

/**
 * Report every credential write in one source file
 * @param {string} sourceText - File contents
 * @param {string} file - Path used in findings (relative to the repo root)
 * @returns {Array<{file, line, sink, key, reason, code}>}
 */
function scanSource(sourceText, file) {
  const scriptKind = file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
  const findings = [];

  const visit = (node) => {
    const finding = classifyNode(node);
    if (finding) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      findings.push({ file, line: line + 1, ...finding, code: node.getText(sourceFile).split('\n')[0] });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return findings;
}

function listSourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(fullPath);
    return SOURCE_EXTENSIONS.has(path.extname(entry.name)) ? [fullPath] : [];
  });
}

function scanSourceTree() {
  const files = listSourceFiles(SRC_DIR).map((fullPath) => path.relative(ROOT, fullPath).split(path.sep).join('/'));
  const findings = files.flatMap((file) => scanSource(fs.readFileSync(path.join(ROOT, file), 'utf8'), file));
  return { files, findings };
}

const matchesEntry = (entry, finding) => (
  entry.file === finding.file && entry.sink === finding.sink && entry.key === finding.key
);

const isAllowlisted = (finding) => ALLOWLIST.some((entry) => matchesEntry(entry, finding));

const formatFindings = (findings) => findings
  .map((f) => `  ${f.file}:${f.line} ${f.reason}: ${f.code}`)
  .join('\n');

describe('guard: credentials are never stored (ADR-010)', () => {
  const { files, findings } = scanSourceTree();

  it('scans the whole source tree', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files).toEqual(expect.arrayContaining([
      'src/api/wealthsimple.ts',
      'src/services/auth.ts',
      'src/services/common/configStore.ts',
    ]));
  });

  it('finds no credential written to storage, page storage or cookies outside the allowlist', () => {
    const violations = findings.filter((finding) => !isAllowlisted(finding));

    if (violations.length > 0) {
      throw new Error(
        'Credentials must never be stored (docs/decisions/010-credentials-are-never-stored.md). '
        + 'Read them from the page when needed or keep them in memory for the page instead:\n'
        + formatFindings(violations),
      );
    }
  });

  it.each(ALLOWLIST)('still needs the allowlist entry for $key in $file', (entry) => {
    // Once the Monarch CSRF token stops being stored, delete the entry
    expect(findings.filter((finding) => matchesEntry(entry, finding)).length).toBeGreaterThan(0);
  });

  describe('the scanner', () => {
    const scan = (code) => scanSource(code, 'src/example.ts');

    it.each([
      ['a GM write of a credential key', 'GM_setValue(STORAGE.ROGERSBANK_AUTH_TOKEN, header);'],
      ['a GM write of a literal credential key', "GM_setValue('mybank_session_id', value);"],
      ['a GM write whose STORAGE key resolves to a credential', 'GM_setValue(STORAGE.ROGERSBANK_DEVICE_ID, value);'],
      ['a GM write of a value holding a token', 'GM_setValue(STORAGE.WEALTHSIMPLE_CONFIG, JSON.stringify({ auth: { accessToken } }));'],
      ['an encoded ID sent as an auth header', 'GM_setValue(key, { accountIdEncoded });'],
      ['the async GM API', 'GM.setValue(`${id}_csrf`, value);'],
      ['a batch GM write', 'GM_setValues({ mybank_token: value });'],
      ['a storage adapter write', 'this.storage.set(`${id}_token`, value);'],
      ['the removed configStore auth writer', 'setAuth(INTEGRATIONS.WEALTHSIMPLE, authData);'],
      ['an auth section written directly', "updateConfigSection(id, 'auth', { sessionActive: true });"],
      ['a config saved with an auth section', 'saveConfig(id, { ...config, auth });'],
      ['a localStorage write', "localStorage.setItem('anything', '1');"],
      ['a sessionStorage write', "window.sessionStorage.setItem('anything', value);"],
      ['IndexedDB', "indexedDB.open('db');"],
      ['setting a cookie', "document.cookie = 'name=value';"],
      ['the cookie store', "cookieStore.set('name', 'value');"],
      ['GM_cookie', "GM_cookie.set({ name: 'x', value: 'y' });"],
    ])('reports %s', (_label, code) => {
      expect(scan(code)).toHaveLength(1);
    });

    it.each([
      ['the sync lock owner token', 'GM_setValue(key, JSON.stringify({ token, acquiredAt: now }));'],
      ['an accounts list', 'GM_setValue(STORAGE.WEALTHSIMPLE_ACCOUNTS_LIST, JSON.stringify(accounts));'],
      ['a session expiry time', 'GM_setValue(STORAGE.MONARCH_SESSION_EXPIRES_AT, sessionExpiresAt);'],
      ['reading page storage', 'localStorage.getItem(STORAGE.CANADALIFE_TOKEN_KEY);'],
      ['reading cookies', "const cookies = document.cookie.split(';');"],
      ['a Map keyed by "token"', "tokens.set('token', value);"],
      ['in-memory state', 'stateManager.setRogersBankAuth({ authToken });'],
      ['a comment', '// GM_setValue(STORAGE.MONARCH_CSRF_TOKEN, csrfToken);'],
      ['a string', "const example = 'GM_setValue(STORAGE.MONARCH_CSRF_TOKEN, csrfToken)';"],
      ['deleting a stored credential', 'GM_deleteValue(STORAGE.ROGERSBANK_AUTH_TOKEN);'],
    ])('does not report %s', (_label, code) => {
      expect(scan(code)).toEqual([]);
    });

    it('matches the Monarch CSRF writes to the allowlist entry', () => {
      const monarch = scanSource('GM_setValue(STORAGE.MONARCH_CSRF_TOKEN, csrfToken);', 'src/services/auth.ts');
      const elsewhere = scanSource('GM_setValue(STORAGE.MONARCH_CSRF_TOKEN, csrfToken);', 'src/api/other.ts');

      expect(monarch.filter(isAllowlisted)).toHaveLength(1);
      expect(elsewhere.filter(isAllowlisted)).toEqual([]);
    });
  });
});
