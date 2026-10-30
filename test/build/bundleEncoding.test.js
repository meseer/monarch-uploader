/**
 * Build-output encoding guard.
 *
 * The delivered userscript must be pure 7-bit ASCII. Tampermonkey has no
 * `@charset` key and the script is fetched from a raw gist URL, so any consumer
 * in that delivery chain that guesses Latin-1 instead of UTF-8 turns every
 * multi-byte character into one U+FFFD per byte. That is what made the sync
 * progress dialog render its three-byte in-progress status icon as three
 * replacement characters. (That icon was U+27F3 at the time; it is now U+21BB,
 * swapped because U+27F3 was missing from the system UI font and fell back to a
 * symbol font that drew it far smaller than the other status icons.)
 *
 * `ascii_only: true` in the Terser format options escapes every non-ASCII
 * character as \uXXXX, which makes the bundle immune to the consumer's charset
 * guess. This suite runs the REAL production Vite build and asserts the
 * emitted artifact byte-wise, so it also covers the userscript metadata banner
 * (prepended post-minify, which bypasses Terser entirely).
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// jsdom does not expose TextDecoder, so take Node's implementation directly.
import { TextDecoder } from 'node:util';
import { JSDOM } from 'jsdom';
import viteConfigFn from '../../vite.config.mjs';
import scriptInfo from '../../src/scriptInfo.json';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '..', '..');
const BUNDLE_NAME = 'monarch-uploader.user.js';

/** Load the production Vite config */
function loadProductionConfig() {
  return typeof viteConfigFn === 'function'
    ? viteConfigFn({ mode: 'production', command: 'build' })
    : viteConfigFn;
}

/**
 * Read the Terser `format` options out of the configured Vite build.
 */
function getTerserFormatOptions(config) {
  return config?.build?.terserOptions?.format;
}

/**
 * Build a Vite bundle (`production` or `development`) into a scratch directory
 * and return its raw bytes.
 *
 * Spawned as a child process using Node's loader to match what `npm run build`
 * and `npm run build:dev` actually do.
 */
function buildBundle(mode = 'production') {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), `mu-bundle-${mode}-`));
  const viteCli = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  try {
    execFileSync(
      process.execPath,
      [viteCli, 'build', '--mode', mode, '--outDir', outDir],
      { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' },
    );
    return fs.readFileSync(path.join(outDir, BUNDLE_NAME));
  } catch (err) {
    const detail = [err.stdout, err.stderr, err.message].filter(Boolean).join('\n');
    throw new Error(`${mode} Vite build failed:\n${detail.slice(0, 4000)}`);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

/**
 * Decode a Source Map v3 VLQ mappings string and return the original
 * `{ source, line }` (1-based) mapped at the first segment of `targetGenLine`
 * (1-based generated line number).
 */
function resolveGeneratedLine(map, targetGenLine) {
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const genLines = map.mappings.split(';');
  let sourceIdx = 0;
  let origLine = 0; // 0-based in VLQ state

  for (let lineIdx = 0; lineIdx < targetGenLine && lineIdx < genLines.length; lineIdx++) {
    const lineStr = genLines[lineIdx];
    if (!lineStr) continue;
    const segments = lineStr.split(',');
    for (let segIdx = 0; segIdx < segments.length; segIdx++) {
      const seg = segments[segIdx];
      let i = 0;
      const fields = [];
      while (i < seg.length) {
        let result = 0;
        let shift = 0;
        let digit;
        do {
          digit = B64.indexOf(seg[i++]);
          result += (digit & 31) << shift;
          shift += 5;
        } while (digit & 32);
        fields.push(result & 1 ? -(result >> 1) : result >> 1);
      }
      if (fields.length >= 4) {
        sourceIdx += fields[1];
        origLine += fields[2];
        if (lineIdx === targetGenLine - 1 && segIdx === 0) {
          return { source: map.sources[sourceIdx], line: origLine + 1 };
        }
      }
    }
  }
  return null;
}

describe('built userscript encoding', () => {
  let bytes;
  let text;

  beforeAll(() => {
    bytes = buildBundle('production');
    text = bytes.toString('latin1'); // byte-preserving, so no decode can hide a high byte
  }, 300000);

  describe('pure ASCII output', () => {
    it('contains no byte >= 0x80 anywhere, banner included', () => {
      const offenders = [];
      for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] >= 0x80) {
          offenders.push({ offset: i, byte: `0x${bytes[i].toString(16)}` });
          if (offenders.length >= 10) break;
        }
      }
      expect(offenders).toEqual([]);
    });

    it('is byte-identical when decoded as UTF-8 and as Latin-1', () => {
      // The whole point: a consumer that guesses the wrong charset must get the
      // same script. That is only true when every byte is < 0x80. Compare
      // lengths and the first divergence rather than the whole megabyte-scale
      // string, so a failure reports a readable location instead of the bundle.
      const asUtf8 = bytes.toString('utf8');
      const asLatin1 = bytes.toString('latin1');
      let firstDivergence = null;
      if (asUtf8 !== asLatin1) {
        const limit = Math.min(asUtf8.length, asLatin1.length);
        let i = 0;
        while (i < limit && asUtf8[i] === asLatin1[i]) i++;
        firstDivergence = {
          index: i,
          utf8: JSON.stringify(asUtf8.slice(i, i + 40)),
          latin1: JSON.stringify(asLatin1.slice(i, i + 40)),
        };
      }
      expect(firstDivergence).toBeNull();
    });

    it('escapes non-ASCII characters as \\uXXXX rather than dropping them', () => {
      // Guards against a "fix" that merely deletes the icons instead of escaping
      // them: the progress dialog processing icon must survive, escaped.
      expect(text.toLowerCase()).toContain('\\u21bb');
      expect(text).toMatch(/\\u[0-9a-fA-F]{4}/);
    });

    it('still carries every status icon the progress dialog renders', () => {
      // All four `getStepIcon` glyphs, in escaped form: '↻' processing,
      // '✓' success, '✗' error, '○' pending/skipped.
      //
      // Scope note: this asserts presence bundle-wide, which is the right scope
      // for an *encoding* guard but makes two of the four non-exclusive --
      // '✓' and '✗' also appear in settingsModalAccountCards, so those two
      // would survive the progress dialog losing them. U+21BB and U+25CB are
      // currently unique to progressDialog and so are the load-bearing ones
      // here. Glyph ownership per component is pinned in
      // test/ui/progressDialog.statusIcons.test.js instead.
      const lowered = text.toLowerCase();
      expect(lowered).toContain('\\u21bb');
      expect(lowered).toContain('\\u2713');
      expect(lowered).toContain('\\u2717');
      expect(lowered).toContain('\\u25cb');
    });
  });

  describe('userscript metadata banner', () => {
    it('survives minification', () => {
      expect(text).toContain('// ==UserScript==');
      expect(text).toContain('// ==/UserScript==');
      expect(text).toContain('@name');
      expect(text).toContain('@namespace');
      expect(text).toContain('@grant');
      expect(text).toContain('@match');
      expect(text).toContain('@downloadURL');
      expect(text).toContain('@updateURL');
      expect(text).toContain('@run-at');
    });

    it('declares the version from scriptInfo.json', () => {
      const { version } = scriptInfo;
      expect(text).toContain(`@version      ${version}`);
    });

    it('lists every GM_ grant the script relies on', () => {
      for (const grant of [
        'GM_addElement', 'GM_deleteValue', 'GM_download', 'GM_getValue',
        'GM_listValues', 'GM_log', 'GM_registerMenuCommand', 'GM_setValue',
        'GM_xmlhttpRequest',
      ]) {
        expect(text).toContain(`@grant        ${grant}`);
      }
    });
  });

  describe('runtime boot smoke test (jsdom)', () => {
    it.each([
      ['Monarch', 'https://app.monarch.com/accounts', 'Running on Monarch site'],
      ['Wealthsimple', 'https://my.wealthsimple.com/app/home', 'Running on Wealthsimple site'],
      ['MBNA', 'https://service.mbna.ca/waw/mbna/account', 'Running on modular integration site: MBNA'],
      ['Neo Financial', 'https://member.neofinancial.com/accounts', 'Running on modular integration site: Neo Financial'],
      ['Rogers Bank', 'https://rbaccess.rogersbank.com/', 'Running on Rogers Bank site'],
      ['Unrelated site', 'https://example.com/', 'Running on unsupported site: example.com'],
    ])('boots cleanly through DOMContentLoaded and initApp on %s (%s)', (_label, url, expectedInitLog) => {
      const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
        url,
        runScripts: 'outside-only',
      });
      try {
        const win = dom.window;
        expect(win.location.hostname).toBe(new URL(url).hostname);

        const errors = [];
        const consoleErrors = [];
        const debugLogs = [];
        const menuCommands = [];
        const timeouts = [];

        win.addEventListener('error', (evt) => errors.push(evt.error || evt.message));
        win.addEventListener('unhandledrejection', (evt) => errors.push(evt.reason));
        win.console.log = (...args) => debugLogs.push(args.join(' '));
        win.console.error = (...args) => consoleErrors.push(args);

        // Simulate @run-at document-start and intercept timers so we can drive
        // both the document-idle callback (0ms) and initApp (1000ms) without
        // leaving background intervals running after the test.
        let readyState = 'loading';
        Object.defineProperty(win.document, 'readyState', {
          configurable: true,
          get: () => readyState,
        });
        win.setTimeout = (fn, delay = 0) => {
          timeouts.push({ fn, delay });
          return timeouts.length;
        };
        win.clearTimeout = () => {};
        win.setInterval = () => 1;
        win.clearInterval = () => {};

        Object.assign(win, {
          GM_addElement: (parentOrTag, tagOrAttrs) => {
            const tag = typeof parentOrTag === 'string' ? parentOrTag : tagOrAttrs;
            return win.document.createElement(typeof tag === 'string' ? tag : 'div');
          },
          GM_deleteValue: () => Promise.resolve(),
          GM_download: () => {},
          GM_getValue: (k, def) => (k === 'debug_log_level' ? 'debug' : def),
          GM_listValues: () => Promise.resolve([]),
          GM_log: () => {},
          GM_registerMenuCommand: (name) => menuCommands.push(name),
          GM_setValue: () => {},
          GM_xmlhttpRequest: () => ({ abort: () => {} }),
        });

        // 1. Evaluate the bundle at document-start
        win.eval(text);

        // 2. Finish parsing and dispatch DOMContentLoaded
        readyState = 'complete';
        win.document.dispatchEvent(new win.Event('DOMContentLoaded', { bubbles: true }));

        // 3. Flush queued timeouts up to 1000ms (runs startMonarchUploader -> initApp)
        while (timeouts.length > 0) {
          const next = timeouts.shift();
          if (next.delay <= 1000) {
            next.fn();
          }
        }

        expect(errors).toEqual([]);
        expect(consoleErrors).toEqual([]);
        expect(menuCommands).toHaveLength(5);
        expect(win.document.getElementById('monarch-uploader-theme')).not.toBeNull();
        expect(debugLogs.some((msg) => msg.includes(expectedInitLog))).toBe(true);
      } finally {
        dom.window.close();
      }
    });
  });
});

describe('generated userscript metadata block', () => {
  // The banner is injected post-minify, so Terser never sees it and
  // `ascii_only` cannot rescue it. It must be ASCII at the source.
  it('is pure ASCII for every build type', () => {
    const generateMetadata = require('../../src/userscript-metadata.cjs');
    for (const buildType of ['local', 'dev', 'stable']) {
      const metadata = generateMetadata(buildType);
      // eslint-disable-next-line no-control-regex
      expect(metadata).not.toMatch(/[^\x00-\x7F]/);
      expect(Buffer.byteLength(metadata, 'utf8')).toBe(metadata.length);
    }
  });

  it('matches the Neo portal and grants access to its GraphQL API', () => {
    const generateMetadata = require('../../src/userscript-metadata.cjs');
    const metadata = generateMetadata();

    expect(metadata).toContain('// @match        https://member.neofinancial.com/*');
    expect(metadata).toContain('// @connect      api.production.neofinancial.com');
  });
});

describe('source file encoding', () => {
  // Mangled edits have twice left a lone continuation byte behind in a source
  // comment (the trailing byte of a half-deleted '→'). Such a file is not valid
  // UTF-8 at all, which silently breaks grep and any strict-decoding tool.
  const collect = (dir, out = []) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) collect(full, out);
      else if (/\.(ts|js|cjs|mjs|json)$/.test(entry.name)) out.push(full);
    }
    return out;
  };

  it('decodes every src/ and test/ file as strict UTF-8', () => {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const files = [
      ...collect(path.join(ROOT, 'src')),
      ...collect(path.join(ROOT, 'test')),
    ];
    expect(files.length).toBeGreaterThan(100);

    const undecodable = [];
    for (const file of files) {
      try {
        decoder.decode(fs.readFileSync(file));
      } catch {
        undecodable.push(path.relative(ROOT, file));
      }
    }
    expect(undecodable).toEqual([]);
  });
});

describe('Vite Terser configuration', () => {
  it('sets ascii_only so non-ASCII is escaped at minification', () => {
    const format = getTerserFormatOptions(loadProductionConfig());
    expect(format).toBeDefined();
    expect(format.ascii_only).toBe(true);
  });

  it('keeps the metadata comment filter alongside ascii_only', () => {
    const { comments } = getTerserFormatOptions(loadProductionConfig());
    expect(typeof comments).toBe('function');
    expect(comments(null, { value: ' ==UserScript== ' })).toBe(true);
    expect(comments(null, { value: ' @grant GM_getValue ' })).toBe(true);
    expect(comments(null, { value: ' just an ordinary comment ' })).toBe(false);
  });

  it('aligns inline source map line numbers after the userscript banner in development builds', () => {
    const devText = buildBundle('development').toString('utf8');
    expect(devText.startsWith('// ==UserScript==')).toBe(true);

    const mapMatch = devText.match(
      /\/\/# sourceMappingURL=data:application\/json;charset=utf-8;base64,([A-Za-z0-9+/=]+)/,
    );
    expect(mapMatch).not.toBeNull();
    const map = JSON.parse(Buffer.from(mapMatch[1], 'base64').toString('utf8'));

    const bundleLines = devText.split('\n');
    const genLine = bundleLines.findIndex((l) => l.includes('Script loaded successfully')) + 1;
    expect(genLine).toBeGreaterThan(30);

    const indexSrcLines = fs.readFileSync(path.join(ROOT, 'src', 'index.ts'), 'utf8').split('\n');
    const expectedSrcLine = indexSrcLines.findIndex((l) => l.includes('Script loaded successfully')) + 1;

    const resolved = resolveGeneratedLine(map, genLine);
    expect(resolved).not.toBeNull();
    expect(resolved.source).toMatch(/src\/index\.ts$/);
    expect(resolved.line).toBe(expectedSrcLine);
  });
});
