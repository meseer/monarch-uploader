const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');
const webpack = require('webpack');

// Function to create banner with metadata
const createBanner = () => {
  // Import metadata from our embedded file
  const metadataPath = path.resolve(__dirname, 'src', 'userscript-metadata.cjs');
  delete require.cache[metadataPath]; // Clear cache to get fresh metadata
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const generateMetadata = require(metadataPath);
  const buildType = process.env.BUILD_TYPE || 'local';
  const metadata = generateMetadata(buildType);
  return `${metadata}\n\n`;
};

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';

  return {
    entry: './src/index.js',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'monarch-uploader.user.js',
    },
    module: {
      rules: [
        {
          test: /\.js$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: ['@babel/preset-env'],
            },
          },
        },
      ],
    },
    optimization: {
      minimize: isProduction,
      splitChunks: false, // Disable code splitting for userscripts (must be single file)
      minimizer: [
        new TerserPlugin({
          terserOptions: {
            format: {
              comments: /==UserScript==|@name|@namespace|@version|@description|@author|@match|@downloadURL|@updateURL|@grant|@connect|@run-at|==/,
            },
          },
          extractComments: false,
        }),
      ],
    },
    plugins: [
      // Add banner with userscript metadata
      new webpack.BannerPlugin({
        banner: createBanner(),
        raw: false,
        entryOnly: true,
      }),
    ],
    // Source maps for better debugging
    devtool: isProduction ? false : 'inline-source-map',
    // External GM_ functions
    externals: {
      // List Tampermonkey's GM_* functions as externals
      GM_addElement: 'GM_addElement',
      GM_deleteValue: 'GM_deleteValue',
      GM_download: 'GM_download',
      GM_getValue: 'GM_getValue',
      GM_listValues: 'GM_listValues',
      GM_log: 'GM_log',
      GM_registerMenuCommand: 'GM_registerMenuCommand',
      GM_setValue: 'GM_setValue',
      GM_xmlhttpRequest: 'GM_xmlhttpRequest',
    },
  };
};
