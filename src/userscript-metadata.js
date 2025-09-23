// ==UserScript==
// @name         Questrade, EQBank, CanadaLife, Rogers Bank to Monarch Balance Uploader
// @namespace    http://tampermonkey.net/
// @version      3.8.0
// @description  Adds buttons to download/upload balance history for individual and all accounts.
// @description  Supports Questrade, EQBank, CanadaLife, and Rogers Bank. Supports progress tracking.
// @author       You
// @match        https://myportal.questrade.com/investing/summary*
// @match        https://app.monarchmoney.com/*
// @match        https://secure.eqbank.ca/*
// @match        https://my.canadalife.com/*
// @match        https://selfserve.rogersbank.com/*
// @grant        GM_addElement
// @grant        GM_deleteValue
// @grant        GM_download
// @grant        GM_getValue
// @grant        GM_listValues
// @grant        GM_log
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      api.monarchmoney.com
// @connect      api.questrade.com
// @run-at       document-idle
// ==/UserScript==

function generateMetadata(buildType = 'local') {
  const baseUrl = 'https://github.com/meseer/monarch-uploader/releases';

  let downloadUrl;
  let updateUrl;

  switch (buildType) {
    case 'stable':
      downloadUrl = `${baseUrl}/latest/download/monarch-uploader-stable.user.js`;
      updateUrl = `${baseUrl}/latest/download/monarch-uploader-stable.user.js`;
      break;
    case 'dev':
      downloadUrl = `${baseUrl}/download/dev-latest/monarch-uploader-dev.user.js`;
      updateUrl = `${baseUrl}/download/dev-latest/monarch-uploader-dev.user.js`;
      break;
    default:
      // For local builds or unknown types, don't include update URLs
      downloadUrl = null;
      updateUrl = null;
      break;
  }

  const downloadLine = downloadUrl ? `// @downloadURL  ${downloadUrl}\n` : '';
  const updateLine = updateUrl ? `// @updateURL    ${updateUrl}\n` : '';

  return `// ==UserScript==
// @name         Questrade, EQBank, CanadaLife, Rogers Bank to Monarch Balance Uploader
// @namespace    http://tampermonkey.net/
// @version      3.8.0
// @description  Adds buttons to download/upload balance history for individual and all accounts.
// @description  Supports Questrade, EQBank, CanadaLife, and Rogers Bank. Supports progress tracking.
// @author       You
// @match        https://myportal.questrade.com/investing/summary*
// @match        https://app.monarchmoney.com/*
// @match        https://secure.eqbank.ca/*
// @match        https://my.canadalife.com/s/dashboard*
// @match        https://selfserve.rogersbank.com/*
${downloadLine}${updateLine}// @grant        GM_addElement
// @grant        GM_deleteValue
// @grant        GM_download
// @grant        GM_getValue
// @grant        GM_listValues
// @grant        GM_log
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      api.monarchmoney.com
// @connect      api.questrade.com
// @run-at       document-idle
// ==/UserScript==`;
}

module.exports = generateMetadata;
