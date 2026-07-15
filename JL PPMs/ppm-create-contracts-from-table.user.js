// ==UserScript==
// @name         JL - Bulk Create PPM Contracts (WeWork 26/27)
// @namespace    https://up-fm.com/joblogic
// @version      1.0.0
// @description  Bulk-creates PPM Contracts in Joblogic from an embedded table (site, order no., plan ref, annual value). Resolves each site + its Billing address via /Site/GetSites and posts to /api/PPMContract/CreatePPMContract using the page's own Vuex getParamsFromStore. Preview (dry-run) before creating.
// @match        https://go.joblogic.com/PPMContract/Create*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
 * WHAT THIS DOES
 *  - For each row below it looks up the Site by name (via /Site/GetSites), picks the
 *    WeWork Ltd match, reads that site's Billing address, and creates a PPM Contract:
 *      Billing type   : Invoice (monthly)          Invoice type : In Advance
 *      Contract value : "Total for 26/27" (ex VAT)  Frequency    : Monthly
 *      Period         : 01/08/2026 - 31/07/2027
 *      Order number   : from the table              Plan Ref     : from the table
 *      Invoice address: Site (Billing) address      Selling rate : Non-Chargeable (JL default)
 *  - It builds the exact payload by driving Joblogic's own Vuex store getter
 *    (getParamsFromStore) so every hidden/default field matches the real form.
 *
 * HOW TO USE
 *  1. Open https://go.joblogic.com/PPMContract/Create  (any PPM create page).
 *  2. A panel appears bottom-right. Click "Preview" first — it resolves all 32 sites,
 *     shows the matched site id, billing address and value, and flags any problems.
 *     NOTHING is created during preview.
 *  3. Review, then click "Create all" and confirm. Progress + created contract links
 *     are logged. Re-running creates DUPLICATES, so only run once.
 */

(function () {
  'use strict';

  // ----------------------------------------------------------------------------
  // CONFIG
  // ----------------------------------------------------------------------------
  const CFG = {
    startDate: '01/08/2026',
    endDate: '31/07/2027',
    invoiceFirstDate: '01/08/2026',
    billingType: 1,          // ENUM_TYPE_BILLING.INVOICE
    invoiceType: 1,          // ENUM_TYPE_INVOICE.inAdvance
    invoiceFrequency: 2,     // Monthly
    sellingRateId: 97830,    // "Non - Chargeable" (Joblogic default)
    sellingRateDesc: 'Non - Chargeable',
    selectedAddressType: 5,  // 5 = Site (Billing) address
    expectedCustomerId: 5595606,       // WeWork Ltd — sanity check
    expectedCustomerName: 'WeWork Ltd',
    createUrl: '/api/PPMContract/CreatePPMContract',
    siteSearchUrl: '/Site/GetSites',
    postDelayMs: 400         // pause between creations
  };

  // ----------------------------------------------------------------------------
  // DATA  (Total for 26/27 = ex-VAT annual value)
  // ----------------------------------------------------------------------------
  const RENEWAL = ' - Aug 27 Renewal - Master Contract';
  function R(total, code, site) {
    return {
      total: String(total),
      order: 'PPM | SCON-00021244 - ' + code,
      site: site,
      plan: site + RENEWAL
    };
  }
  const ROWS = [
    R(133697.57,  '1MARKS', "1 Mark Square LON19"),
    R(105813.44,  '1STKAT', "1 St Katharine's Way LON28"),
    R(91931.82,   '1WATER', "1 Waterhouse Square LON43"),
    R(166912.63,  '10DEVO', "10 Devonshire Square LON40"),
    R(75084.74,   '10FENC', "10 Fenchurch Avenue LON54"),
    R(1213271.56, '10YORK', "10 York Road LON20"),
    R(99010.23,   '120MOO', "120 Moorgate LON32"),
    R(192102.30,  '123BUC', "123 Buckingham Palace Road LON44"),
    R(155576.44,  '145CIT', "145 City Road LON13"),
    R(49727.04,   '16GREA', "16 Great Chapel Street LON12"),
    R(81784.02,   '17STHE', "17 St Helen's Place WE-GB-10735"),
    R(81088.06,   '184SHE', "184 Shepherd's Bush Road LON37"),
    R(295719.25,  '2EASTB', "2 Eastbourne Terrace LON09"),
    R(92922.11,   '2MINST', "2 Minster Court LON53"),
    R(48147.24,   '26HATT', "26 Hatton Garden LON45"),
    R(140314.57,  '3WATER', "3 Waterhouse Square LON11"),
    R(601560.08,  '30CHUR', "30 Churchill Place WE-GB-63302"),
    R(76076.47,   '33QUEE', "33 Queen Street LON15"),
    R(262385.70,  '5MERCH', "5 Merchant Square LON49"),
    R(81057.03,   '5060ST', "50-60 Station Road CBG01"),
    R(92060.40,   '77LEAD', "77 Leadenhall Street LON50"),
    R(305857.18,  '8DEVON', "8 Devonshire Square LON41"),
    R(109904.75,  '80GEOR', "80 George Street EDI01"),
    R(127885.37,  'ALDWYC', "Aldwych House LON25"),
    R(304719.19,  'AVIATI', "Aviation House LON23"),
    R(115360.66,  'DALTON', "Dalton Place MAN03"),
    R(54802.38,   'KINGSP', "Kings Place LON33"),
    R(19936.43,   'MEDIUS', "Medius House LON02"),
    R(278329.34,  'MOORPL', "Moor Place LON06"),
    R(167224.17,  'NORTHW', "North West House LON17"),
    R(67314.10,   'STPETE', "St Peter's Square MAN02"),
    R(136358.47,  'THEMON', "The Monument LON31")
  ];

  // ----------------------------------------------------------------------------
  // JOBLOGIC PLUMBING
  // ----------------------------------------------------------------------------
  function getToken() {
    const el = document.querySelector('input[name="__RequestVerificationToken"]');
    return el ? el.value : null;
  }

  function findStore() {
    const els = document.querySelectorAll('*');
    for (let i = 0; i < els.length; i++) {
      const v = els[i].__vue__;
      if (v && v.$store && v.$store.getters && 'getParamsFromStore' in v.$store.getters) return v.$store;
    }
    // fallback: any store
    for (let i = 0; i < els.length; i++) {
      const v = els[i].__vue__;
      if (v && v.$store) return v.$store;
    }
    return null;
  }

  function isObj(v) {
    return v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof File);
  }

  // Faithful replica of Joblogic's component.objectToFormData
  function objectToFormData(t, n, i) {
    n = n || new FormData();
    i = i || '';
    if (!t || typeof t !== 'object' || t instanceof Date || t instanceof File) {
      n.append(i, t);
      return n;
    }
    Object.keys(t).forEach(function (a) {
      const s = t[a];
      const o = i ? i + '[' + a + ']' : a;
      if (s instanceof Date) {
        n.append(o, s.toISOString());
      } else if (Array.isArray(s)) {
        s.forEach(function (item, idx) {
          const k = o + '[' + idx + ']';
          if (isObj(item)) objectToFormData(item, n, k);
          else n.append(k, item);
        });
      } else if (isObj(s)) {
        objectToFormData(s, n, o);
      } else {
        n.append(o, s != null ? s : '');
      }
    });
    return n;
  }

  // Faithful replica of Joblogic's component.fixDataType
  function fixDataType(fd) {
    ['VisitFrequency', 'TagIds', 'Assets'].forEach(function (k) {
      const v = fd.get(k);
      if (v == null || v === '') fd.delete(k);
    });
    return fd;
  }

  async function fetchJson(url, opts) {
    const r = await fetch(url, Object.assign({ credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } }, opts || {}));
    const raw = await r.text();
    let d = null;
    try { d = JSON.parse(raw); } catch (e) {}
    return { status: r.status, data: d, raw: raw };
  }

  // Resolve a site name -> the WeWork site object (with billing address)
  async function resolveSite(name) {
    const res = await fetchJson(CFG.siteSearchUrl + '?text=' + encodeURIComponent(name));
    if (res.status !== 200 || !Array.isArray(res.data)) throw new Error('Site search failed (HTTP ' + res.status + ')');
    const wanted = name.trim().toLowerCase();
    let exact = res.data.filter(s => (s.Name || '').trim().toLowerCase() === wanted);
    if (exact.length === 0) throw new Error('No site named exactly "' + name + '" (got ' + res.data.length + ' fuzzy result(s))');
    // prefer the expected customer
    let pref = exact.filter(s => s.CustomerId === CFG.expectedCustomerId);
    if (pref.length === 0) pref = exact.filter(s => (s.CustomerName || '').toLowerCase().indexOf('wework') !== -1);
    const chosen = pref.length ? pref : exact;
    if (chosen.length > 1) throw new Error('Ambiguous: ' + chosen.length + ' matches for "' + name + '" under the same customer');
    return chosen[0];
  }

  // The site's "Billing" address, mapped like Joblogic's mapNewVal(site,'Billing').
  // Falls back to the site's own address if the site has no separate billing address.
  function billingAddressOf(site) {
    if (site.UseBillingAddress && (site.BillingName || site.BillingAddress1)) {
      return {
        source: 'Billing',
        Name: site.BillingName || '',
        Address1: site.BillingAddress1 || '',
        Address2: site.BillingAddress2 || '',
        Address3: site.BillingAddress3 || '',
        Address4: site.BillingAddress4 || '',
        Postcode: site.BillingPostcode || '',
        Address: ''
      };
    }
    return {
      source: 'Site (no separate billing addr)',
      Name: site.Name || '',
      Address1: site.Address1 || '',
      Address2: site.Address2 || '',
      Address3: site.Address3 || '',
      Address4: site.Address4 || '',
      Postcode: site.Postcode || '',
      Address: ''
    };
  }

  // Build the CreatePPMContract params by driving the live Vuex getter.
  // NB: replaceState + getter read happen synchronously (no await) so Vue's
  // async watchers can't mutate our state before we read the params.
  function buildParams(store, pristine, row, site, billing) {
    const st = JSON.parse(JSON.stringify(pristine));
    st.typePPM = 2;                    // Contract
    st.typeBilling = CFG.billingType;  // Invoice
    st.typeInvoice = CFG.invoiceType;  // In Advance
    st.invoiceFrequency = CFG.invoiceFrequency; // Monthly
    st.selectedAddressType = CFG.selectedAddressType; // Site (Billing)
    st.startDate = CFG.startDate;
    st.endDate = CFG.endDate;
    st.invoiceDate = CFG.invoiceFirstDate;
    st.planReference = row.plan;
    st.customerOrderNumber = row.order;
    st.invoiceContractValue = row.total;
    st.description = '';
    st.customer = { data: [], model: { Id: site.CustomerId }, warnings: null };
    st.site = { data: [], model: { Id: site.Id }, siteId: site.Id, warnings: null };
    st.sellingRate = { data: [], model: { Id: CFG.sellingRateId, Description: CFG.sellingRateDesc } };
    st.jobCategory = { data: [], model: null };
    st.invoiceAddress.siteBilling = {
      Name: billing.Name, Address1: billing.Address1, Address2: billing.Address2,
      Address3: billing.Address3, Address4: billing.Address4, Postcode: billing.Postcode,
      Address: billing.Address
    };
    store.replaceState(st);
    return store.getters.getParamsFromStore; // synchronous read
  }

  async function createContract(store, pristine, row, site, billing) {
    const params = buildParams(store, pristine, row, site, billing);
    let fd = objectToFormData(params);
    fd = fixDataType(fd);
    const token = getToken();
    if (token) fd.append('__RequestVerificationToken', token);
    const r = await fetch(CFG.createUrl, {
      method: 'POST',
      credentials: 'include',
      headers: Object.assign({ 'X-Requested-With': 'XMLHttpRequest' }, token ? { '__RequestVerificationToken': token } : {}),
      body: fd
    });
    const raw = await r.text();
    let d = null;
    try { d = JSON.parse(raw); } catch (e) {}
    if (d && d.success) return { ok: true, id: d.AdditionalData, resp: d, params: params };
    return { ok: false, status: r.status, resp: d, raw: raw.slice(0, 300), params: params };
  }

  // ----------------------------------------------------------------------------
  // UI
  // ----------------------------------------------------------------------------
  let running = false;
  const money = n => '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function buildUI() {
    const wrap = document.createElement('div');
    wrap.id = 'ppm-bulk-panel';
    wrap.innerHTML = `
      <style>
        #ppm-bulk-panel{position:fixed;right:16px;bottom:16px;z-index:999999;width:480px;max-height:70vh;
          display:flex;flex-direction:column;background:#fff;border:1px solid #c8ced6;border-radius:10px;
          box-shadow:0 8px 28px rgba(0,0,0,.22);font:12px/1.45 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1f2733;}
        #ppm-bulk-panel h3{margin:0;padding:10px 12px;font-size:13px;background:#0d3b66;color:#fff;border-radius:10px 10px 0 0;
          display:flex;justify-content:space-between;align-items:center;}
        #ppm-bulk-panel .pb-body{padding:10px 12px;overflow:auto;}
        #ppm-bulk-panel .pb-cfg{background:#f4f6f9;border:1px solid #e2e7ee;border-radius:6px;padding:8px;margin-bottom:8px;color:#3a4658;}
        #ppm-bulk-panel .pb-cfg b{color:#0d3b66;}
        #ppm-bulk-panel .pb-btns{display:flex;gap:8px;margin-bottom:8px;}
        #ppm-bulk-panel button{cursor:pointer;border:0;border-radius:6px;padding:8px 12px;font-weight:600;font-size:12px;}
        #ppm-bulk-panel .pb-prev{background:#e7eefc;color:#1b4fbf;}
        #ppm-bulk-panel .pb-go{background:#1b8a4b;color:#fff;}
        #ppm-bulk-panel button:disabled{opacity:.5;cursor:not-allowed;}
        #ppm-bulk-panel .pb-min{background:transparent;color:#fff;font-size:16px;padding:0 6px;}
        #ppm-bulk-panel .pb-log{white-space:pre-wrap;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;
          background:#0b1220;color:#d7e2f0;border-radius:6px;padding:8px;max-height:32vh;overflow:auto;}
        #ppm-bulk-panel .pb-log .ok{color:#57d982;}
        #ppm-bulk-panel .pb-log .err{color:#ff8080;}
        #ppm-bulk-panel .pb-log .warn{color:#ffd166;}
        #ppm-bulk-panel a{color:#7db4ff;}
        #ppm-bulk-panel.min .pb-body{display:none;}
      </style>
      <h3><span>PPM Bulk Create — ${ROWS.length} WeWork contracts</span>
        <button class="pb-min" title="minimise">–</button></h3>
      <div class="pb-body">
        <div class="pb-cfg">
          <div><b>Period:</b> ${CFG.startDate} → ${CFG.endDate} &nbsp; <b>Billing:</b> Invoice / Monthly (in advance)</div>
          <div><b>Value:</b> "Total for 26/27" (ex-VAT) &nbsp; <b>Address:</b> Site (Billing)</div>
          <div><b>Selling rate:</b> ${CFG.sellingRateDesc} &nbsp; <b>Job category:</b> (none)</div>
        </div>
        <div class="pb-btns">
          <button class="pb-prev">🔍 Preview (no changes)</button>
          <button class="pb-go">⚙️ Create all ${ROWS.length}</button>
          <button class="pb-copy" style="background:#e2e7ee;color:#3a4658;margin-left:auto;">Copy log</button>
        </div>
        <div class="pb-log">Ready. Click Preview first.\n</div>
      </div>`;
    document.body.appendChild(wrap);

    const logEl = wrap.querySelector('.pb-log');
    const prevBtn = wrap.querySelector('.pb-prev');
    const goBtn = wrap.querySelector('.pb-go');
    wrap.querySelector('.pb-min').onclick = () => wrap.classList.toggle('min');
    wrap.querySelector('.pb-copy').onclick = () => { navigator.clipboard.writeText(logEl.textContent); };

    const log = (msg, cls) => {
      const span = document.createElement('span');
      if (cls) span.className = cls;
      span.textContent = msg + '\n';
      logEl.appendChild(span);
      logEl.scrollTop = logEl.scrollHeight;
    };
    const logHtml = (html) => { logEl.insertAdjacentHTML('beforeend', html); logEl.scrollTop = logEl.scrollHeight; };

    prevBtn.onclick = () => run(true);
    goBtn.onclick = () => run(false);

    async function run(dryRun) {
      if (running) return;
      const store = findStore();
      if (!store || !('getParamsFromStore' in store.getters)) {
        log('✗ Vuex store not found. Make sure you are on the PPM Create page and it has finished loading, then reload.', 'err');
        return;
      }
      if (!getToken()) log('! Anti-forgery token not found on page — POST may be rejected.', 'warn');

      if (!dryRun) {
        const yes = window.confirm(
          'Create ' + ROWS.length + ' PPM contracts for WeWork?\n\n' +
          'Period ' + CFG.startDate + ' → ' + CFG.endDate + ', monthly invoicing, value = Total for 26/27.\n\n' +
          'Running this more than once will create DUPLICATES. Continue?'
        );
        if (!yes) { log('Cancelled.', 'warn'); return; }
      }

      running = true; prevBtn.disabled = true; goBtn.disabled = true;
      const pristine = JSON.parse(JSON.stringify(store.state));
      logEl.textContent = '';
      log((dryRun ? '── PREVIEW (dry run, nothing is created) ──' : '── CREATING CONTRACTS ──'));

      let done = 0, failed = 0;
      for (let idx = 0; idx < ROWS.length; idx++) {
        const row = ROWS[idx];
        const tag = (idx + 1) + '/' + ROWS.length + '  ' + row.site;
        try {
          const site = await resolveSite(row.site);
          const billing = billingAddressOf(site);
          const custWarn = site.CustomerId !== CFG.expectedCustomerId
            ? ('  ⚠ customer=' + site.CustomerName + ' (id ' + site.CustomerId + ')') : '';
          const addr = [billing.Name, billing.Address1, billing.Address2, billing.Address3, billing.Address4, billing.Postcode]
            .filter(Boolean).join(', ');

          if (dryRun) {
            log('✓ ' + tag, 'ok');
            log('    siteId ' + site.Id + ' · ' + site.CustomerName + custWarn);
            log('    order: ' + row.order);
            log('    value: ' + money(row.total) + ' (annual, ex-VAT) → monthly ' + money(Number(row.total) / 12));
            log('    bill →[' + billing.source + '] ' + (addr || '(EMPTY!)'), addr ? null : 'err');
            if (!addr) failed++; else done++;
          } else {
            const res = await createContract(store, pristine, row, site, billing);
            if (res.ok) {
              done++;
              const url = res.id ? ('/PPMContract/Detail/' + res.id) : null;
              logHtml('<span class="ok">✓ ' + esc(tag) + ' — created' + custWarn.replace('⚠','&#9888;') + '</span>' +
                (url ? ' <a href="' + url + '" target="_blank">open</a>' : '') + '\n');
            } else {
              failed++;
              log('✗ ' + tag + ' — FAILED (HTTP ' + (res.status || '?') + ') ' +
                (res.resp ? JSON.stringify(res.resp).slice(0, 200) : res.raw), 'err');
            }
            await new Promise(r => setTimeout(r, CFG.postDelayMs));
          }
        } catch (e) {
          failed++;
          log('✗ ' + tag + ' — ' + (e && e.message ? e.message : e), 'err');
        }
      }

      // restore original store state so the visible form isn't left half-filled
      try { store.replaceState(pristine); } catch (e) {}

      log('── DONE: ' + done + ' ok, ' + failed + ' problem(s) ──', failed ? 'warn' : 'ok');
      if (dryRun && !failed) log('Preview looks clean. Click "Create all" to proceed.', 'ok');
      running = false; prevBtn.disabled = false; goBtn.disabled = false;
    }

    function esc(s) { return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
  }

  // ----------------------------------------------------------------------------
  // BOOT — wait for the Vue store to be ready
  // ----------------------------------------------------------------------------
  let tries = 0;
  const boot = setInterval(() => {
    tries++;
    if (findStore() || tries > 80) {
      clearInterval(boot);
      if (!document.getElementById('ppm-bulk-panel')) buildUI();
    }
  }, 250);
})();
