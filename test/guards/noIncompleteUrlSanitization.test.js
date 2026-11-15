/**
 * Guard: source code never uses incomplete URL/hostname substring checks (CWE-20).
 *
 * Checking `hostname.includes('example.com')` or `hostname.endsWith('example.com')`
 * allows attacker-controlled domains such as `example.com.evil.com` or
 * `evilexample.com` to pass domain checks (CodeQL `js/incomplete-url-substring-sanitization`).
 *
 * All hostname/domain checks in `src/` MUST use `isHostnameMatch()` from
 * `src/core/domainMatch.ts` (or `getIntegrationForHostname()` for modular
 * integrations).
 *
 * This suite parses every file under `src/` with the TypeScript compiler (so
 * comments and non-matching strings never count) and reports:
 * - any substring/prefix/suffix/regex method (`includes`, `indexOf`, `lastIndexOf`,
 *   `startsWith`, `endsWith`, `search`, `match`) called on a `hostname`, `host`,
 *   or `origin` expression outside `src/core/domainMatch.ts`;
 * - any `includes`, `indexOf`, `lastIndexOf`, or `endsWith` call whose string
 *   literal argument is a domain name (e.g. `'questrade.com'`, `'app.monarch.com'`).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const SRC_DIR = path.join(ROOT, 'src');
const SOURCE_EXTENSIONS = new Set(['.ts', '.js', '.cjs', '.mjs']);

const SUBSTRING_METHODS = new Set([
  'includes',
  'indexOf',
  'lastIndexOf',
  'startsWith',
  'endsWith',
  'search',
  'match',
]);

const DOMAIN_LITERAL_METHODS = new Set([
  'includes',
  'indexOf',
  'lastIndexOf',
  'endsWith',
]);

/** Matches domain-like literals such as 'questrade.com', 'app.monarch.com', 'https://questrade.com' */
const DOMAIN_LITERAL_PATTERN = /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)+(?:com|ca|org|net|io|co|dev|app|ai|edu|gov)\/?$/i;

/** Receiver names that represent a URL's host/origin/location */
const HOST_RECEIVER_PATTERN = /(^|\.)(hostname|host|origin)$/i;

/** Files allowed to implement low-level hostname suffix matching */
const ALLOWED_FILES = new Set(['src/core/domainMatch.ts']);

function getReceiverText(callee) {
  if (!ts.isPropertyAccessExpression(callee)) return null;
  return {
    method: callee.name.text,
    receiver: callee.expression.getText(),
  };
}

function classifyCall(call, file) {
  if (ALLOWED_FILES.has(file)) return null;

  const info = getReceiverText(call.expression);
  if (!info || !SUBSTRING_METHODS.has(info.method)) return null;

  if (HOST_RECEIVER_PATTERN.test(info.receiver)) {
    return {
      method: info.method,
      reason: `uses .${info.method}() on ${info.receiver}; use isHostnameMatch() from src/core/domainMatch.ts`,
    };
  }

  const [firstArg] = call.arguments;
  if (
    DOMAIN_LITERAL_METHODS.has(info.method)
    && firstArg
    && ts.isStringLiteralLike(firstArg)
    && DOMAIN_LITERAL_PATTERN.test(firstArg.text)
  ) {
    return {
      method: info.method,
      reason: `uses .${info.method}('${firstArg.text}') which is vulnerable to substring domain spoofing; use isHostnameMatch()`,
    };
  }

  return null;
}

/**
 * Report every incomplete URL/hostname substring check in one source file.
 * @param {string} sourceText - File contents
 * @param {string} file - Path relative to repo root
 * @returns {Array<{file: string, line: number, method: string, reason: string, code: string}>}
 */
function scanSource(sourceText, file) {
  const scriptKind = file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
  const findings = [];

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const finding = classifyCall(node, file);
      if (finding) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        findings.push({
          file,
          line: line + 1,
          ...finding,
          code: node.getText(sourceFile).split('\n')[0],
        });
      }
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

const formatFindings = (findings) => findings
  .map((f) => `  ${f.file}:${f.line} ${f.reason}: ${f.code}`)
  .join('\n');

describe('guard: no incomplete URL/hostname substring sanitization (CWE-20)', () => {
  const { files, findings } = scanSourceTree();

  it('scans the whole source tree', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files).toEqual(expect.arrayContaining([
      'src/index.ts',
      'src/core/utils.ts',
      'src/core/integrationRegistry.ts',
      'src/services/auth.ts',
    ]));
  });

  it('finds no incomplete URL/hostname substring checks in src/', () => {
    if (findings.length > 0) {
      throw new Error(
        'Incomplete URL/hostname substring checks are forbidden (use isHostnameMatch from src/core/domainMatch.ts):\n'
        + formatFindings(findings),
      );
    }
  });

  describe('the scanner', () => {
    const scan = (code, file = 'src/example.ts') => scanSource(code, file);

    it.each([
      ['hostname.includes with literal', "window.location.hostname.includes('questrade.com');"],
      ['hostname.endsWith with literal', "location.hostname.endsWith('questrade.com');"],
      ['hostname.includes with variable', 'hostname.includes(domain);'],
      ['host.startsWith', "location.host.startsWith('app.monarch.com');"],
      ['origin.includes', "window.location.origin.includes('monarch.com');"],
      ['hostname.indexOf', "hostname.indexOf('rogersbank.com') !== -1;"],
      ['hostname.match', 'hostname.match(/questrade\\.com/);'],
      ['url.includes with domain literal', "url.includes('wealthsimple.com');"],
      ['href.endsWith with domain literal', "href.endsWith('canadalife.com');"],
      ['url.includes with scheme+domain literal', "url.includes('https://app.monarch.com');"],
    ])('reports %s', (_label, code) => {
      expect(scan(code)).toHaveLength(1);
    });

    it.each([
      ['isHostnameMatch call', "isHostnameMatch(window.location.hostname, 'questrade.com');"],
      ['getIntegrationForHostname call', 'getIntegrationForHostname(window.location.hostname);'],
      ['path check on url', "url.includes('/api/v1/accounts');"],
      ['query param check on href', "window.location.href.includes('?tab=holdings');"],
      ['scheme check with startsWith', "url.startsWith('https://');"],
      ['storage key prefix check', "key.startsWith('oidc.user:https://login.questrade.com/');"],
      ['commented out check', "// window.location.hostname.includes('questrade.com');"],
      ['implementation inside domainMatch.ts', "normalizedHost.endsWith(`.${normalizedDomain}`);", 'src/core/domainMatch.ts'],
    ])('does not report %s', (_label, code, file) => {
      expect(scan(code, file)).toEqual([]);
    });
  });
});
