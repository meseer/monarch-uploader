// ==UserScript==
// @name         Monarch Uploader
// @namespace    https://github.com/meseer/monarch-uploader
// @version      3.20.2
// @description  Upload Questrade, CanadaLife, and Rogers Bank balance and transactions to Monarch.
// @author       Mykhailo Delegan
// @match        https://myportal.questrade.com/*
// @match        https://app.monarchmoney.com/*
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
  // All builds now point to the same Gist for updates
  const gistUrl = 'https://gist.github.com/meseer/f00fb552c96efeb3eb4e4e1fd520d4e7/raw/monarch-uploader.user.js';
  
  // Always include update URLs pointing to the Gist
  const downloadUrl = gistUrl;
  const updateUrl = gistUrl;

  const downloadLine = `// @downloadURL  ${downloadUrl}\n`;
  const updateLine = `// @updateURL    ${updateUrl}\n`;

  return `// ==UserScript==
// @name         Monarch Uploader
// @namespace    https://github.com/meseer/monarch-uploader
// @version      3.20.2
// @description  Upload Questrade, CanadaLife, and Rogers Bank balance and transactions to Monarch.
// @author       Mykhailo Delegan
// @match        https://myportal.questrade.com/*
// @match        https://app.monarchmoney.com/*
// @match        https://my.canadalife.com/*
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
