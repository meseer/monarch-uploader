/**
 * Build-output encoding guard.
 *
 * The delivered userscript must be pure 7-bit ASCII. Tampermonkey has no
 * `@charset` key and the script is fetched from a raw gist URL, so any consumer
 * in that delivery chain that guesses Latin-1 instead of UTF-8 turns every
 * multi-byte character into one U+FFFD per byte. That is what made the sync
 * progress dialog render the three-byte status icon '⟳' (e2 9f b3) as three
 * replacement characters.
 *
 * `ascii_only: true` in the Terser format options escapes every non-ASCII
 * character as \uXXXX, which makes the bundle immune to the consumer's charset
 * guess. This suite runs the REAL production webpack build and asserts the
 * emitted artifact byte-wise, so it also covers the BannerPlugin metadata block
 * (injected with `raw: true`, which bypasses Terser entirely).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
// jsdom does not expose TextDecoder, so take Node's implementation directly.
const { TextDecoder } = require('util');

const webpack = require('webpack');

const ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_PATH = path.join(ROOT, 'webpack.config.cjs');
const BUNDLE_NAME = 'monarch-uploader.user.js';

// webpack's AsyncQueue needs setImmediate, which the jsdom test environment
// does not provide. The suite cannot use `@jest-environment node` because the
// shared test/setup.js touches `document`.
if (typeof global.setImmediate !== 'function') {
  global.setImmediate = (fn, ...args) => setTimeout(fn, 0, ...args);
  global.clearImmediate = (id) => clearTimeout(id);
}

/** Load the production webpack config fresh */
function loadProductionConfig() {
  delete require.cache[CONFIG_PATH];
  // eslint-disable-next-line import/no-dynamic-require, global-require
  return require(CONFIG_PATH)({}, { mode: 'production' });
}

/**
 * Read the Terser `format` options out of the configured minimizer.
 *
 * terser-webpack-plugin normalizes the `terserOptions` it is constructed with
 * onto `options.minimizer.options`, so accept either shape rather than pinning
 * this guard to the plugin's current internals.
 */
function getTerserFormatOptions(config) {
  const plugins = config.optimization.minimizer || [];
  for (const plugin of plugins) {
    const opts = plugin && plugin.options;
    if (!opts) continue;
    const format = (opts.terserOptions && opts.terserOptions.format)
      || (opts.minimizer && opts.minimizer.options && opts.minimizer.options.format);
    if (format) return format;
  }
  return undefined;
}

/** Build the production bundle into a scratch directory and return its bytes */
function buildProductionBundle() {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mu-bundle-encoding-'));
  const config = loadProductionConfig();
  config.output = { ...config.output, path: outDir };

  return new Promise((resolve, reject) => {
    webpack(config, (err, stats) => {
      if (err) return reject(err);
      if (stats.hasErrors()) {
        return reject(new Error(stats.toString({ all: false, errors: true })));
      }
      const bundlePath = path.join(outDir, BUNDLE_NAME);
      const bytes = fs.readFileSync(bundlePath);
      fs.rmSync(outDir, { recursive: true, force: true });
      return resolve(bytes);
    });
  });
}

describe('built userscript encoding', () => {
  let bytes;
  let text;

  beforeAll(async () => {
    bytes = await buildProductionBundle();
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
      expect(text.toLowerCase()).toContain('\\u27f3');
      expect(text).toMatch(/\\u[0-9a-fA-F]{4}/);
    });

    it('still carries the status icons the progress dialog renders', () => {
      // '✗' error icon and '○' pending icon, in escaped form.
      const lowered = text.toLowerCase();
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
      // eslint-disable-next-line global-require
      const { version } = require('../../src/scriptInfo.json');
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
});

describe('generated userscript metadata block', () => {
  // The banner is injected with `raw: true`, so Terser never sees it and
  // `ascii_only` cannot rescue it. It must be ASCII at the source.
  it('is pure ASCII for every build type', () => {
    // eslint-disable-next-line global-require
    const generateMetadata = require('../../src/userscript-metadata.cjs');
    for (const buildType of ['local', 'dev', 'stable']) {
      const metadata = generateMetadata(buildType);
      // eslint-disable-next-line no-control-regex
      expect(metadata).not.toMatch(/[^\x00-\x7F]/);
      expect(Buffer.byteLength(metadata, 'utf8')).toBe(metadata.length);
    }
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

describe('webpack Terser configuration', () => {
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
});
