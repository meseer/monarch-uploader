// ==UserScript==
// @name         Questrade, EQBank, CanadaLife to Monarch Balance Uploader
// @namespace    http://tampermonkey.net/
// @version      3.7.0
// @description  Adds buttons to download/upload balance history for individual and all accounts. Supports Questrade, EQBank, and CanadaLife. Supports progress tracking.
// @author       You
// @match        https://myportal.questrade.com/investing/summary*
// @match        https://app.monarchmoney.com/*
// @match        https://secure.eqbank.ca/*
// @match        https://my.canadalife.com/*
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

const metadata = `// ==UserScript==
// @name         Questrade, EQBank, CanadaLife to Monarch Balance Uploader
// @namespace    http://tampermonkey.net/
// @version      3.7.0
// @description  Adds buttons to download/upload balance history for individual and all accounts. Supports Questrade, EQBank, and CanadaLife. Supports progress tracking.
// @author       You
// @match        https://myportal.questrade.com/investing/summary*
// @match        https://app.monarchmoney.com/*
// @match        https://secure.eqbank.ca/*
// @match        https://my.canadalife.com/s/dashboard*
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
// ==/UserScript==`;

export default metadata;
