// ==UserScript==
// @name         JL - Bulk Create PPM Contracts (WeWork 26/27)
// @namespace    https://up-fm.com/joblogic
// @version      1.2.0
// @description  Bulk-creates PPM Contracts in Joblogic from an embedded table (site, order no., plan ref, annual value). Resolves each site + its Billing address via /Site/GetSites and posts to /api/PPMContract/CreatePPMContract. Preview (dry-run) before creating. v1.2: collapses to a launcher button in the shared dock (drag to reorder).
// @match        https://go.joblogic.com/PPMContract
// @match        https://go.joblogic.com/PPMContract/*
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
 *  - The payload is the exact object Joblogic's own create form produces
 *    (validated against its Vuex getParamsFromStore) — built here in plain JS so the
 *    script works on any PPMContract page (list or Create).
 *
 * HOW TO USE
 *  1. Open the PPM Contracts list (or any PPMContract page).
 *  2. Open "Create PPM Contracts" from the Advanced Controls dock (top-right).
 *  3. Click Preview first — resolves all 32 sites, shows matched id / billing address /
 *     value, and flags problems. NOTHING is created during preview.
 *  4. Review, then Create all and confirm. Re-running creates DUPLICATES — run once.
 */

(function () {
  'use strict';

  // ===== Shared JL userscript launcher dock (identical in every script) =====
  const JL_DOCK_ID = 'jl-userscript-dock', JL_ORDER_KEY = 'jl-userscript-dock-order', JL_MIN_KEY = 'jl-userscript-dock-min', JL_TOP_KEY = 'jl-userscript-dock-top';
  const JL_BTN_CSS = 'color:#fff;padding:7px 13px;border-radius:4px;border:1px solid transparent;cursor:grab;font-family:"Open Sans",sans-serif;font-size:14px;box-shadow:0 1px 3px rgba(0,0,0,.25);white-space:nowrap;';
  const jlDockList = () => document.getElementById('jl-userscript-dock-list');
  function jlReadOrder() { try { return JSON.parse(localStorage.getItem(JL_ORDER_KEY)) || []; } catch (e) { return []; } }
  function jlSaveOrder() { const l = jlDockList(); if (!l) return; localStorage.setItem(JL_ORDER_KEY, JSON.stringify([...l.children].map(b => b.dataset.scriptId).filter(Boolean))); }
  function jlApplyOrder() { const l = jlDockList(); if (!l) return; [...l.children].sort((a, b) => { const o = jlReadOrder(); let ia = o.indexOf(a.dataset.scriptId), ib = o.indexOf(b.dataset.scriptId); if (ia < 0) ia = 1e9; if (ib < 0) ib = 1e9; return ia - ib; }).forEach(b => l.appendChild(b)); }
  function jlAfter(l, y) { let c = { o: -Infinity, el: null }; for (const el of l.querySelectorAll('button:not(.jl-dragging)')) { const r = el.getBoundingClientRect(); const off = y - (r.top + r.height / 2); if (off < 0 && off > c.o) c = { o: off, el }; } return c.el; }
  function jlSetDockMin(min) { const l = jlDockList(), t = document.getElementById('jl-userscript-dock-toggle'); if (l) l.style.display = min ? 'none' : 'flex'; if (t) t.textContent = (min ? '▸' : '▾') + ' Advanced Controls'; try { localStorage.setItem(JL_MIN_KEY, min ? '1' : '0'); } catch (e) {} }
  function jlGetDock() {
    if (!document.getElementById('jl-dock-style')) { const st = document.createElement('style'); st.id = 'jl-dock-style'; st.textContent = '#jl-userscript-dock button:hover{filter:brightness(1.18);}'; (document.head || document.documentElement).appendChild(st); }
    let d = document.getElementById(JL_DOCK_ID);
    if (!d) { d = document.createElement('div'); d.id = JL_DOCK_ID; document.body.appendChild(d); }
    d.style.cssText = 'position:fixed;top:80px;right:8px;z-index:100000;display:flex;flex-direction:column;gap:8px;align-items:flex-end;';
    const savedTop = localStorage.getItem(JL_TOP_KEY); if (savedTop !== null) d.style.top = savedTop + 'px';
    let t = document.getElementById('jl-userscript-dock-toggle');
    if (!t) {
      t = document.createElement('button');
      t.id = 'jl-userscript-dock-toggle';
      t.title = 'Drag to move up/down • click to expand/collapse';
      t.style.cssText = JL_BTN_CSS + 'background:#072d3d;border-color:#072d3d;touch-action:none;';
      let drag = null;
      t.addEventListener('pointerdown', e => { drag = { y: e.clientY, top: d.getBoundingClientRect().top, moved: false }; try { t.setPointerCapture(e.pointerId); } catch (x) {} t.style.cursor = 'grabbing'; e.preventDefault(); });
      t.addEventListener('pointermove', e => { if (!drag) return; const dy = e.clientY - drag.y; if (Math.abs(dy) > 4) drag.moved = true; if (drag.moved) { const top = Math.max(4, Math.min(window.innerHeight - 40, drag.top + dy)); d.style.top = top + 'px'; } });
      const endDrag = e => { if (!drag) return; const moved = drag.moved; drag = null; t.style.cursor = 'grab'; try { t.releasePointerCapture(e.pointerId); } catch (x) {} if (moved) { try { localStorage.setItem(JL_TOP_KEY, parseInt(d.style.top, 10)); } catch (x) {} } else { jlSetDockMin(jlDockList().style.display !== 'none'); } };
      t.addEventListener('pointerup', endDrag);
      t.addEventListener('pointercancel', endDrag);
      d.appendChild(t);
    }
    let l = document.getElementById('jl-userscript-dock-list');
    if (!l) {
      l = document.createElement('div');
      l.id = 'jl-userscript-dock-list';
      l.style.cssText = 'display:flex;flex-direction:column;gap:8px;align-items:flex-end;';
      l.addEventListener('dragover', e => { e.preventDefault(); const dr = l.querySelector('.jl-dragging'); if (!dr) return; const a = jlAfter(l, e.clientY); if (a == null) l.appendChild(dr); else l.insertBefore(dr, a); });
      l.addEventListener('drop', e => { e.preventDefault(); jlSaveOrder(); });
      d.appendChild(l);
    }
    [...d.children].forEach(c => { if (c.id && c.id.indexOf('jl-launch-') === 0) l.appendChild(c); });
    jlApplyOrder();
    jlSetDockMin(localStorage.getItem(JL_MIN_KEY) !== '0');
    return d;
  }
  function jlDockButton(id, label, color, onClick, desc) {
    jlGetDock();
    const l = jlDockList();
    let b = document.getElementById('jl-launch-' + id);
    if (b) return b;
    const bg = color || '#072d3d';
    b = document.createElement('button');
    b.id = 'jl-launch-' + id;
    b.dataset.scriptId = id;
    b.textContent = label;
    b.title = (desc ? desc + '\n\n' : '') + '(click to open • drag to reorder)';
    b.draggable = true;
    b.style.cssText = JL_BTN_CSS + 'background:' + bg + ';border-color:' + bg + ';';
    b.addEventListener('click', () => { if (b.dataset.justDragged) { delete b.dataset.justDragged; return; } onClick(); });
    b.addEventListener('dragstart', () => { b.classList.add('jl-dragging'); b.style.opacity = '0.4'; });
    b.addEventListener('dragend', () => { b.classList.remove('jl-dragging'); b.style.opacity = '1'; b.dataset.justDragged = '1'; setTimeout(() => { delete b.dataset.justDragged; }, 60); jlSaveOrder(); });
    l.appendChild(b);
    jlApplyOrder();
    return b;
  }
  function jlHelpBanner(text) {
    const b = document.createElement('div');
    b.className = 'jl-help-banner';
    b.style.cssText = 'background:#0e3a4f;color:#e3edf2;font-family:"Open Sans",sans-serif;font-size:11px;line-height:1.45;padding:8px 10px;border-radius:4px;margin:0 0 8px 0;border-left:3px solid #ff7919;';
    b.textContent = text;
    return b;
  }
  function jlRegisterPanel(panelEl, id, label, color, desc) {
    const shown = (panelEl.style.display && panelEl.style.display !== 'none') ? panelEl.style.display : 'block';
    panelEl.style.display = 'none';
    const btn = jlDockButton(id, label, color, () => {
      const opening = panelEl.style.display === 'none';
      panelEl.style.display = opening ? shown : 'none';
      if (opening && desc) {
        const box = getComputedStyle(panelEl).position === 'fixed' ? panelEl : (panelEl.firstElementChild || panelEl);
        if (box && !box.querySelector(':scope > .jl-help-banner')) box.insertBefore(jlHelpBanner(desc), box.firstChild);
      }
      btn.style.boxShadow = opening ? '0 0 0 2px #fff, 0 1px 3px rgba(0,0,0,.25)' : '0 1px 3px rgba(0,0,0,.25)';
    }, desc);
    return btn;
  }
  // ===== end shared dock =====

  const SCRIPT_ID = 'ppm-create-contracts-from-table';
  const SCRIPT_LABEL = '🏢 Create PPM Contracts';
  const SCRIPT_COLOR = '#1b8a4b';
  const SCRIPT_DESC = 'Bulk-creates the 32 WeWork 26/27 PPM contracts. Each is an Invoice / Monthly (in advance) contract, 01/08/2026–31/07/2027, value = "Total for 26/27" (ex-VAT), invoiced to the Site (Billing) address, selling rate Non-Chargeable, no job category. Sites + billing addresses are looked up live. Click Preview first (no changes are made); then Create all and confirm. Running Create twice makes DUPLICATES.';

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

  function todayDMY() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear();
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

  // Build the exact CreatePPMContract params object (matches Joblogic's
  // getParamsFromStore output — validated field-for-field).
  function buildParams(row, site, billing) {
    return {
      CustomerContractId: null,
      SelectedAddressType: CFG.selectedAddressType,
      PlanReference: row.plan,
      JobCategoryId: null,
      DepotId: null,
      Description: '',
      StartDate: CFG.startDate,
      EndDate: CFG.endDate,
      PPMSellingRateId: CFG.sellingRateId,
      BillingType: CFG.billingType,
      SelectedInvoiceType: CFG.invoiceType,
      InvoiceContractValue: row.total,
      NoBillingContractValue: 0,
      InvoiceFrequency: CFG.invoiceFrequency,
      WeekNumber: null,
      InvoiceFirstDate: CFG.invoiceFirstDate,
      VisitFirstDate: null,
      VisitFrequency: 1,
      VisitDescription: null,
      VisitDefaultValue: 0,
      Name: billing.Name,
      Address1: billing.Address1,
      Address2: billing.Address2,
      Address3: billing.Address3,
      Address4: billing.Address4,
      Postcode: billing.Postcode,
      DefaultEngineerId: null,
      DefaultEngineerTeamId: null,
      DefaultSubcontractorId: null,
      Labour: '0.00', Material: '0.00', Overtime: '0.00', Expenses: '0.00',
      Travel: '0.00', CallOut: '0.00', Mileage: '0.00', Subcontractor: '0.00',
      TagIds: [],
      InvoiceHeaderDetails: {
        AccountNumber: '', OrderNumber: '', InvoiceHeaderId: '', InvoiceHeaderDescription: '',
        InvoiceHeader: '', Notes: '', Terms: '', EmailTo: '', EmailSubject: '', EmailBody: ''
      },
      IsPPMScheduleImport: false,
      AccountManagerId: null,
      AccountManager: null,
      CustomerOrderNumber: row.order,
      GenerateTrade: false,
      GenerateAssetDescription: false,
      GenerateFrequency: false,
      ExcludeWeekends: false,
      QuoteRequestId: null,
      IncludeQuoteRequestAssets: false,
      IncludeQuoteRequestNotes: false,
      IncludeQuoteRequestAttachments: false,
      SiteIds: [],
      ExchangeRateDate: todayDMY(),
      ConversionRate: null,
      ToCurrencyCode: '',
      IsEnabledMultipleCurrencies: false,
      ToCurrencyName: '',
      BaseCurrencyCode: 'GBP',
      BaseCurrencyName: 'Pound Sterling',
      PPMCustomerId: site.CustomerId,
      PPMSiteId: site.Id
    };
  }

  async function createContract(row, site, billing) {
    const params = buildParams(row, site, billing);
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
    if (d && d.success) return { ok: true, id: d.AdditionalData, resp: d };
    return { ok: false, status: r.status, resp: d, raw: raw.slice(0, 300) };
  }

  // ----------------------------------------------------------------------------
  // UI  (house style: Open Sans panel top-right, collapses into the shared dock)
  // ----------------------------------------------------------------------------
  const money = n => '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  let running = false;

  function buildPanel() {
    const p = document.createElement('div');
    p.id = SCRIPT_ID + '-panel';
    p.style.cssText = 'position:fixed;top:70px;right:8px;z-index:99999;width:460px;max-height:84vh;overflow:auto;background:#fff;border:1px solid #c9d4da;border-radius:6px;box-shadow:0 4px 18px rgba(0,0,0,.25);font-family:"Open Sans",sans-serif;font-size:12px;color:#243b46;padding:12px;';
    p.innerHTML = `
      <div style="font-weight:700;font-size:14px;margin-bottom:8px;">🏢 Create PPM Contracts <span style="font-weight:400;color:#888;">v1.2 · ${ROWS.length} sites</span></div>
      <div style="background:#f4f6f9;border:1px solid #e2e7ee;border-radius:4px;padding:8px;margin-bottom:8px;line-height:1.55;">
        <b>Period</b> ${CFG.startDate} → ${CFG.endDate} &nbsp;·&nbsp; <b>Invoice</b> / Monthly (in advance)<br>
        <b>Value</b> Total for 26/27 (ex-VAT) &nbsp;·&nbsp; <b>Address</b> Site (Billing)<br>
        <b>Selling rate</b> ${esc(CFG.sellingRateDesc)} &nbsp;·&nbsp; <b>Job category</b> none
      </div>
      <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center;">
        <button id="cc-preview" class="jl-button-green" style="padding:5px 14px;">Preview</button>
        <button id="cc-create" class="jl-button-green" style="padding:5px 14px;">Create all ${ROWS.length}</button>
        <button id="cc-copy" style="padding:5px 12px;margin-left:auto;background:#eef1f5;color:#243b46;border:1px solid #c9d4da;border-radius:4px;cursor:pointer;">Copy log</button>
      </div>
      <div id="cc-status" style="margin-bottom:6px;font-weight:600;"></div>
      <div id="cc-out" style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;line-height:1.5;max-height:44vh;overflow:auto;background:#fbfcfe;border:1px solid #e2e7ee;border-radius:4px;padding:8px;white-space:pre-wrap;">Click Preview first — nothing is created.</div>`;
    document.body.appendChild(p);
    return p;
  }

  function init() {
    const panel = buildPanel();
    jlRegisterPanel(panel, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR, SCRIPT_DESC);

    const $ = id => panel.querySelector('#cc-' + id);
    const outEl = $('out');
    const statusEl = $('status');
    const prevBtn = $('preview'), goBtn = $('create');

    const COL = { ok: '#1b7a3a', err: '#b71c1c', warn: '#9a6b00' };
    const status = (msg, cls) => { statusEl.textContent = msg; statusEl.style.color = cls ? COL[cls] : '#243b46'; };
    const log = (msg, cls) => {
      const span = document.createElement('span');
      if (cls) span.style.color = COL[cls];
      span.textContent = msg + '\n';
      outEl.appendChild(span);
      outEl.scrollTop = outEl.scrollHeight;
    };
    const logHtml = (html) => { outEl.insertAdjacentHTML('beforeend', html); outEl.scrollTop = outEl.scrollHeight; };

    $('copy').onclick = () => { navigator.clipboard.writeText(outEl.textContent); };
    prevBtn.onclick = () => run(true);
    goBtn.onclick = () => run(false);

    async function run(dryRun) {
      if (running) return;
      if (!getToken()) log('! Anti-forgery token not found on page — POST may be rejected. Try reloading.', 'warn');

      if (!dryRun) {
        const yes = window.confirm(
          'Create ' + ROWS.length + ' PPM contracts for WeWork?\n\n' +
          'Period ' + CFG.startDate + ' → ' + CFG.endDate + ', monthly invoicing, value = Total for 26/27.\n\n' +
          'Running this more than once will create DUPLICATES. Continue?'
        );
        if (!yes) { status('Cancelled.', 'warn'); return; }
      }

      running = true; prevBtn.disabled = true; goBtn.disabled = true;
      prevBtn.style.opacity = goBtn.style.opacity = '.5';
      outEl.textContent = '';
      log(dryRun ? '── PREVIEW (dry run, nothing is created) ──' : '── CREATING CONTRACTS ──');

      let done = 0, failed = 0;
      for (let idx = 0; idx < ROWS.length; idx++) {
        const row = ROWS[idx];
        const tag = (idx + 1) + '/' + ROWS.length + '  ' + row.site;
        status((dryRun ? 'Checking ' : 'Creating ') + (idx + 1) + ' of ' + ROWS.length + '…');
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
            const res = await createContract(row, site, billing);
            if (res.ok) {
              done++;
              const url = res.id ? ('/PPMContract/Detail/' + res.id) : null;
              logHtml('<span style="color:' + COL.ok + '">✓ ' + esc(tag) + ' — created</span>' +
                (url ? ' <a href="' + url + '" target="_blank" style="color:#1b6fb3;">open</a>' : '') +
                (custWarn ? '<span style="color:' + COL.warn + '">' + esc(custWarn) + '</span>' : '') + '\n');
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

      status('Done: ' + done + ' ok, ' + failed + ' problem(s).', failed ? 'warn' : 'ok');
      log('── DONE: ' + done + ' ok, ' + failed + ' problem(s) ──', failed ? 'warn' : 'ok');
      if (dryRun && !failed) log('Preview looks clean. Click "Create all" to proceed.', 'ok');
      running = false; prevBtn.disabled = false; goBtn.disabled = false;
      prevBtn.style.opacity = goBtn.style.opacity = '1';
    }
  }

  // ----------------------------------------------------------------------------
  // BOOT
  // ----------------------------------------------------------------------------
  let tries = 0;
  const boot = setInterval(() => {
    tries++;
    if (document.body || tries > 80) {
      clearInterval(boot);
      if (document.body && !document.getElementById(SCRIPT_ID + '-panel')) init();
    }
  }, 250);
})();
