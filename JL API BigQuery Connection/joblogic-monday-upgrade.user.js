// ==UserScript==
// @name         JobLogic → Monday: Upgraded Job Ref
// @namespace    up-fm.joblogic.monday
// @version      1.1.0
// @description  When a JobLogic quote has been upgraded to a job, push the upgraded job number to the matching Monday item (via the Apps Script relay). Part of the JobLogic→Monday integration.
// @match        https://go.joblogic.com/Job/Detail/*
// @match        https://go.joblogic.com/Quote/Detail/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20API%20BigQuery%20Connection/joblogic-monday-upgrade.user.js
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20API%20BigQuery%20Connection/joblogic-monday-upgrade.user.js
// ==/UserScript==
/*
 * Auto-updates from the public TMJSScripts repo. Because the repo is PUBLIC, the shared secret is
 * NOT stored in this file — each browser sets it once and it lives only in TamperMonkey storage.
 *
 * SETUP (per browser, once): TamperMonkey menu (the extension icon) → this script →
 *   "Set JL→Monday shared secret" → paste the SHARED_SECRET from the relay's Script Properties.
 * (RELAY_URL below is not sensitive — the relay ignores any request without the correct secret.)
 */
(function () {
  'use strict';

  const RELAY_URL = 'https://script.google.com/macros/s/AKfycbzAL-wiWfiHPtES-R4pob4IQF-0vlycVZTc7c8YTF9gthcRV5V7cT_VkQfln9yw8Dq5/exec';
  const SECRET_KEY = 'jlm_shared_secret';

  const log = (...a) => console.log('[JL→Monday]', ...a);
  const rx = (text, re) => { const m = text.match(re); return m ? m[1] : null; };

  GM_registerMenuCommand('Set JL→Monday shared secret', function () {
    const cur = GM_getValue(SECRET_KEY, '');
    const v = prompt('Paste the JL→Monday SHARED_SECRET (from the relay Script Properties):', cur || '');
    if (v !== null) { GM_setValue(SECRET_KEY, v.trim()); alert('Saved. Reload a JobLogic quote/job page to use it.'); }
  });

  async function quoteIdForPage() {
    const path = location.pathname;
    let m = path.match(/\/Quote\/Detail\/(\d+)/);
    if (m) return m[1];
    m = path.match(/\/Job\/Detail\/(\d+)/);
    if (!m) return null;
    // Job page: the job model embeds "QuoteId":<n> when the job came from a quote.
    const html = await (await fetch(location.pathname + location.search,
                                    { headers: { 'X-Requested-With': 'XMLHttpRequest' } })).text();
    const qid = rx(html, /"QuoteId"\s*:\s*(\d+)/);
    return (qid && qid !== '0') ? qid : null;
  }

  function postToRelay(payload) {
    GM_xmlhttpRequest({
      method: 'POST', url: RELAY_URL,
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify(payload),
      onload: (r) => {
        let res; try { res = JSON.parse(r.responseText); } catch (e) { res = r.responseText; }
        log('relay response:', res);
      },
      onerror: (e) => log('relay error:', e),
    });
  }

  async function run() {
    const secret = GM_getValue(SECRET_KEY, '');
    if (!secret) { log('no shared secret set — use the TamperMonkey menu → "Set JL→Monday shared secret"'); return; }
    try {
      const quoteId = await quoteIdForPage();
      if (!quoteId) return;                              // not a quote-derived record
      const t = await (await fetch('/Quote/Detail/' + quoteId,
                                   { headers: { 'X-Requested-With': 'XMLHttpRequest' } })).text();
      const parentJobStringId = rx(t, /"OriginalJobNumber"\s*:\s*"([^"]*)"/);
      const jobNumber         = rx(t, /"UpgradedIntoJobNumber"\s*:\s*"([^"]*)"/);
      const quoteNumber       = rx(t, /"QuoteNumber"\s*:\s*"([^"]*)"/);
      if (!jobNumber || !parentJobStringId) return;      // not upgraded yet — nothing to send

      const key = 'jlm:' + quoteId + ':' + jobNumber;
      if (GM_getValue(key)) { log('already sent', key); return; }

      log('sending', { quoteNumber, parentJobStringId, jobNumber });
      postToRelay({ secret, jobNumber, parentJobStringId, quoteNumber });
      GM_setValue(key, Date.now());
    } catch (e) {
      log('error', e);
    }
  }

  run();
})();
