import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Pin the test timezone before workers spawn so date-boundary tests are
// deterministic regardless of the host machine's locale.
process.env.TZ = 'America/Vancouver';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/**
 * Generate the userscript metadata banner from `src/userscript-metadata.cjs`.
 */
function createBanner() {
  const metadataPath = path.resolve(__dirname, 'src', 'userscript-metadata.cjs');
  delete require.cache[metadataPath];
  const generateMetadata = require(metadataPath);
  const buildType = process.env.BUILD_TYPE || 'local';
  const metadata = generateMetadata(buildType);
  return `${metadata}\n\n`;
}

/**
 * Vite plugin to prepend the userscript metadata block after minification.
 */
function userscriptBannerPlugin() {
  return {
    name: 'userscript-banner',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const banner = createBanner();
      for (const file of Object.values(bundle)) {
        if (file.type === 'chunk' && file.isEntry) {
          file.code = banner + file.code;
        }
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const isProduction = mode === 'production';

  return {
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      sourcemap: isProduction ? false : 'inline',
      minify: isProduction ? 'terser' : false,
      terserOptions: {
        format: {
          // Escape every non-ASCII character as \uXXXX so the delivered
          // userscript is pure 7-bit ASCII. Tampermonkey has no @charset
          // key, and the script is fetched from a raw gist URL — any
          // consumer in that chain that guesses Latin-1 instead of UTF-8
          // would otherwise turn each multi-byte character (status icons,
          // em dashes, emoji) into one replacement character per byte.
          ascii_only: true,
          // Preserve UserScript metadata comments, strip everything else
          comments: (_astNode, comment) => {
            const text = comment.value;
            return /@(name|namespace|version|description|author|match|downloadURL|updateURL|grant|connect|run-at)\s|==\/?UserScript==/.test(
              text,
            );
          },
        },
      },
      lib: {
        entry: path.resolve(__dirname, 'src/index.ts'),
        name: 'MonarchUploader',
        formats: ['iife'],
        fileName: () => 'monarch-uploader.user.js',
      },
      rollupOptions: {
        output: {
          extend: true,
        },
      },
    },
    plugins: [userscriptBannerPlugin()],
    test: {
      environment: 'jsdom',
      // Expose describe/it/expect/vi as globals, matching the Jest-era suite
      globals: true,
      include: ['test/**/*.test.{js,ts}', 'src/**/*.test.{js,ts}'],
      setupFiles: ['test/setup.js'],
      env: { TZ: 'America/Vancouver' },
      coverage: {
        provider: 'v8',
        include: ['src/**/*.{ts,js}'],
        reporter: ['text', 'lcov', 'html'],
        reportsDirectory: 'coverage',
      },
    },
  };
});
