// Generates userscript metadata block at build time.
// Version is read from scriptInfo.json — do NOT hardcode a version here.

const scriptInfo = require('./scriptInfo.json');

function generateMetadata(_buildType = 'local') {
  // Use shared constants
  const { version, gistUrl } = scriptInfo;

  // Always include update URLs pointing to the Gist
  const downloadUrl = gistUrl;
  const updateUrl = gistUrl;

  const downloadLine = `// @downloadURL  ${downloadUrl}\n`;
  const updateLine = `// @updateURL    ${updateUrl}\n`;

  return `// ==UserScript==
// @name         Monarch Uploader
// @namespace    https://github.com/meseer/monarch-uploader
// @version      ${version}
// @description  Upload Canadian financial institution balances and transactions to Monarch.
// @author       Mykhailo Delegan
// @match        https://myportal.questrade.com/*
// @match        https://app.monarch.com/*
// @match        https://my.canadalife.com/*
// @match        https://selfserve.rogersbank.com/*
// @match        https://my.wealthsimple.com/*
// @match        https://service.mbna.ca/*
// @match        https://secure.pcfinancial.ca/*
// @match        https://app.pcfinancial.ca/*
${downloadLine}${updateLine}// @grant        GM_addElement
// @grant        GM_deleteValue
// @grant        GM_download
// @grant        GM_getValue
// @grant        GM_listValues
// @grant        GM_log
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      api.monarch.com
// @connect      api.questrade.com
// @connect      service.mbna.ca
// @connect      app.pcfinancial.ca
// @run-at       document-start
// ==/UserScript==`;
}

module.exports = generateMetadata;
