const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');
const webpack = require('webpack');

// Function to create banner with metadata
const createBanner = () => {
  // Import metadata from our embedded file
  const metadataPath = path.resolve(__dirname, 'src', 'userscript-metadata.js');
  delete require.cache[metadataPath]; // Clear cache to get fresh metadata
  const metadata = require(metadataPath).default;
  return metadata + '\n\n';
};

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';

  return {
    entry: './src/index.js',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'questrade-account-balance-uploader.user.js'
    },
    module: {
      rules: [
        {
          test: /\.js$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: ['@babel/preset-env']
            }
          }
        }
      ]
    },
    optimization: {
      minimize: isProduction,
      minimizer: [
        new TerserPlugin({
          terserOptions: {
            format: {
              comments: /==UserScript==|@name|@namespace|@version|@description|@author|@match|@grant|@connect|@run-at|==/
            }
          },
          extractComments: false
        })
      ]
    },
    plugins: [
      // Add banner with userscript metadata
      new webpack.BannerPlugin({
        banner: createBanner(),
        raw: true,
        entryOnly: true
      })
    ],
    // Source maps for better debugging
    devtool: isProduction ? false : 'source-map',
    // External GM_ functions
    externals: {
      // List Tampermonkey's GM_* functions as externals
      'GM_addElement': 'GM_addElement',
      'GM_deleteValue': 'GM_deleteValue',
      'GM_download': 'GM_download',
      'GM_getValue': 'GM_getValue',
      'GM_listValues': 'GM_listValues',
      'GM_log': 'GM_log',
      'GM_registerMenuCommand': 'GM_registerMenuCommand',
      'GM_setValue': 'GM_setValue',
      'GM_xmlhttpRequest': 'GM_xmlhttpRequest'
    }
  };
};
