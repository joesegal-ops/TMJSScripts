// ==UserScript==
// @name         JobLogic → Monday: Upgraded Job Ref
// @namespace    up-fm.joblogic.monday
// @version      1.0.0
// @description  When a JobLogic quote has been upgraded to a job, push the upgraded job number to the matching Monday item (via the Apps Script relay). Part of the JobLogic→Monday integration.
// @match        https://go.joblogic.com/Job/Detail/*
// @match        https://go.joblogic.com/Quote/Detail/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      script.google.com
// @connect      script.googleusercontent.com
// ==/UserScript==
/*
 * SETUP (per install): fill in the two CONFIG values below.
 *   RELAY_URL     = the Apps Script web-app /exec URL (from monday-upgrade-relay.gs deployment)
 *   SHARED_SECRET = the same SHARED_SECRET you set in the relay's Script Properties
 *
 * How it works: on a Quote or Job detail page it resolves the quote id, fetches /Quote/Detail/{id}
 * (same-origin, uses your JL session), and if the quote has been UPGRADED it sends
 * {jobNumber, parentJobStringId, quoteNumber} to the relay, which fills the Monday item's
 * "Upgraded Job Ref". De-duped so each upgrade is sent at most once per browser.
 */
(function () {
  'use strict';

  const CONFIG = {
    RELAY_URL: 'https://script.google.com/macros/s/AKfycbzAL-wiWfiHPtES-R4pob4IQF-0vlycVZTc7c8YTF9gthcRV5V7cT_VkQfln9yw8Dq5/exec',
    SHARED_SECRET: '40XbFpV@A1kLx3zT!=jxFt>m1a#zz+zp.)uZDGLJQLV7f>XZBZ?_.G}U3qX?pb3=EiLjQu',
  };

  const log = (...a) => console.log('[JL→Monday]', ...a);
  const rx = (text, re) => { const m = text.match(re); return m ? m[1] : null; };

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
      method: 'POST', url: CONFIG.RELAY_URL,
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
    if (CONFIG.RELAY_URL.indexOf('PASTE_') === 0) { log('not configured (set RELAY_URL / SHARED_SECRET)'); return; }
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
      postToRelay({ secret: CONFIG.SHARED_SECRET, jobNumber, parentJobStringId, quoteNumber });
      GM_setValue(key, Date.now());
    } catch (e) {
      log('error', e);
    }
  }

  run();
})();
