// ==UserScript==
// @name         JL - Bulk Create PPM Contracts (WeWork 26/27)
// @namespace    https://up-fm.com/joblogic
// @version      1.4.1
// @description  Bulk-creates PPM Contracts in Joblogic from a table pasted from Google Sheets (Total for 26/27, Customer Order Number, Site, Plan Reference). Resolves each site + its Billing address via /Site/GetSites and posts to /api/PPMContract/CreatePPMContract. Preview (dry-run) before creating. v1.4: skips plan references that already exist (safe to re-run), throttles + retries around the WAF 403 rate-limit.
// @match        https://go.joblogic.com/PPMContract
// @match        https://go.joblogic.com/PPMContract/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
 * WHAT THIS DOES
 *  - You paste the table from Google Sheets (tab-separated). For each row it looks up
 *    the Site by name (via /Site/GetSites), picks the WeWork Ltd match, reads that
 *    site's Billing address, and creates a PPM Contract:
 *      Billing type   : Invoice (monthly)          Invoice type : In Advance
 *      Contract value : "Total for 26/27" (ex VAT)  Frequency    : Monthly
 *      Period         : 01/08/2026 - 31/07/2027
 *      Order number   : from the paste              Plan Ref     : from the paste
 *      Invoice address: Site (Billing) address      Selling rate : Non-Chargeable (JL default)
 *  - Columns are matched by header name (order doesn't matter). Needed headers:
 *      "Total for 26/27", "Customer Order Number", "Site", "Plan Reference".
 *  - The payload is the exact object Joblogic's own create form produces
 *    (validated against its Vuex getParamsFromStore) — built here in plain JS so the
 *    script works on any PPMContract page (list or Create).
 *
 * HOW TO USE
 *  1. Open the PPM Contracts list (or any PPMContract page).
 *  2. Open "Create PPM Contracts" from the Advanced Controls dock (top-right).
 *  3. Paste the sheet (include the header row), then click Preview — resolves each site,
 *     shows matched id / billing address / value, and flags problems. Nothing is created.
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
  const SCRIPT_COLOR = '#ff7919';
  const SCRIPT_DESC = 'Paste the WeWork PPM table from Google Sheets (include the header row). Each row becomes an Invoice / Monthly (in advance) contract, 01/08/2026–31/07/2027, value = "Total for 26/27" (ex-VAT), invoiced to the Site (Billing) address, selling rate Non-Chargeable, no job category. Columns are matched by header name (Total for 26/27, Customer Order Number, Site, Plan Reference). Sites + billing addresses are looked up live. Click Preview first (no changes are made); then Create all and confirm. Safe to re-run — any plan reference that already exists is skipped, not duplicated.';

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
    contractSearchUrl: '/api/PPMContract/SearchPPMContract',
    postDelayMs: 1500,       // pause between creations (WAF throttles rapid bursts)
    maxRetries: 3,           // retries after a WAF 403 / network blip
    backoffMs: [15000, 30000, 45000] // wait before each retry
  };

  // ----------------------------------------------------------------------------
  // TSV PARSING  (paste straight from Google Sheets / Excel)
  //   Needed columns (matched by header name, any order):
  //     "Total for 26/27" (ex-VAT annual value), "Customer Order Number",
  //     "Site", "Plan Reference".
  //   If a "Plan Reference" cell is blank it defaults to "<Site>" + RENEWAL.
  // ----------------------------------------------------------------------------
  const RENEWAL = ' - Aug 27 Renewal - Master Contract';

  // "£133,697.57" -> 133697.57  (null if not a number)
  function parseMoney(s) {
    const n = parseFloat(String(s == null ? '' : s).replace(/[^0-9.\-]/g, ''));
    return isNaN(n) ? null : n;
  }

  // Returns { rows:[{site,total,order,plan}], errors:[...], mapNote:'' }
  function parseTsv(text) {
    const lines = String(text || '').split(/\r?\n/).filter(l => l.trim() !== '');
    if (!lines.length) return { rows: [], errors: ['Nothing pasted.'] };

    const errors = [];
    // Default column positions (matches the original sheet layout).
    let col = { total: 0, order: 4, site: 5, plan: 6 };
    let start = 0;
    let mapNote = 'using default column positions (Total=1, Order=5, Site=6, Plan=7)';

    const head = lines[0].split('\t').map(c => c.trim());
    const looksHeader = head.some(c => /total for|customer order|plan reference|^site$/i.test(c));
    if (looksHeader) {
      const totIdx = head.findIndex(c => /^total for/i.test(c) && !/inc\s*vat/i.test(c));
      const ordIdx = head.findIndex(c => /customer order/i.test(c));
      const sitIdx = head.findIndex(c => /^site$/i.test(c));
      const plnIdx = head.findIndex(c => /plan reference/i.test(c));
      const missing = [];
      if (totIdx < 0) missing.push('Total for 26/27'); else col.total = totIdx;
      if (ordIdx < 0) missing.push('Customer Order Number'); else col.order = ordIdx;
      if (sitIdx < 0) missing.push('Site'); else col.site = sitIdx;
      if (plnIdx < 0) missing.push('Plan Reference'); else col.plan = plnIdx;
      if (missing.length) errors.push('Header row is missing column(s): ' + missing.join(', ') + '. Falling back to default positions for those.');
      mapNote = 'matched columns by header';
      start = 1;
    }

    const rows = [];
    for (let i = start; i < lines.length; i++) {
      const c = lines[i].split('\t');
      const site = (c[col.site] || '').trim();
      const totalRaw = (c[col.total] || '').trim();
      const total = parseMoney(totalRaw);
      const order = (c[col.order] || '').trim();
      const plan = (c[col.plan] || '').trim();
      if (!site && total == null) continue; // blank line
      if (!site) { errors.push('Row ' + (i + 1) + ': no Site — skipped'); continue; }
      if (total == null) { errors.push('Row ' + (i + 1) + ' (' + site + '): value "' + totalRaw + '" is not a number — skipped'); continue; }
      rows.push({ site, total: total.toFixed(2), order, plan: plan || (site + RENEWAL) });
    }
    return { rows, errors, mapNote };
  }

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
    // A WAF 403 (HTML page, not Joblogic JSON) means "throttled" — the create may
    // still have succeeded server-side, so callers re-check by searching.
    const throttled = r.status === 403 || (!d && /^\s*<(?:!doctype|html)/i.test(raw));
    return { ok: false, status: r.status, throttled: throttled, resp: d, raw: raw.slice(0, 200) };
  }

  // --- Duplicate guard via /api/PPMContract/SearchPPMContract (form-encoded) ---
  const normRef = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

  async function searchContracts(term) {
    const token = getToken();
    const r = await fetch(CFG.contractSearchUrl, {
      method: 'POST',
      credentials: 'include',
      headers: Object.assign({ 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }, token ? { '__RequestVerificationToken': token } : {}),
      body: new URLSearchParams({ SearchTerm: term, PageNumber: 1, PageSize: 500 }).toString()
    });
    const d = await r.json().catch(() => null);
    const list = (d && d.AdditionalData && d.AdditionalData.PPMContracts) || [];
    return list.map(c => c.PlanReference);
  }

  // Longest common trailing string across the rows' plan references.
  function commonSuffix(arr) {
    if (!arr.length) return '';
    let suf = arr[0];
    for (let i = 1; i < arr.length; i++) {
      const s = arr[i];
      let n = Math.min(suf.length, s.length);
      while (n > 0 && suf.slice(-n) !== s.slice(-n)) n--;
      suf = suf.slice(-n);
      if (!suf) break;
    }
    return suf.trim();
  }

  // Build a Set of normalised plan references that already exist on the server.
  // One bulk search on the shared suffix if there is a good one; else per-row.
  async function fetchExistingRefs(rows, log) {
    const set = new Set();
    const suffix = commonSuffix(rows.map(r => r.plan));
    try {
      if (suffix.length >= 10) {
        (await searchContracts(suffix)).forEach(ref => set.add(normRef(ref)));
        log('Checked existing contracts matching "…' + suffix + '": ' + set.size + ' found.');
      } else {
        for (const row of rows) {
          (await searchContracts(row.plan)).forEach(ref => set.add(normRef(ref)));
          await new Promise(r => setTimeout(r, 150));
        }
        log('Checked existing contracts per-row: ' + set.size + ' found.');
      }
    } catch (e) {
      log('! Could not pre-check existing contracts (' + (e.message || e) + '). Proceeding — a re-created plan reference would duplicate.', 'warn');
    }
    return set;
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
      <div style="font-weight:700;font-size:14px;margin-bottom:8px;">🏢 Create PPM Contracts <span style="font-weight:400;color:#888;">v1.3</span></div>
      <div style="background:#f4f6f9;border:1px solid #e2e7ee;border-radius:4px;padding:8px;margin-bottom:8px;line-height:1.55;">
        <b>Period</b> ${CFG.startDate} → ${CFG.endDate} &nbsp;·&nbsp; <b>Invoice</b> / Monthly (in advance)<br>
        <b>Value</b> Total for 26/27 (ex-VAT) &nbsp;·&nbsp; <b>Address</b> Site (Billing)<br>
        <b>Selling rate</b> ${esc(CFG.sellingRateDesc)} &nbsp;·&nbsp; <b>Job category</b> none
      </div>
      <label style="display:block;margin-bottom:8px;">Paste the table from Google Sheets (tab-separated, include the header row):<br>
        <textarea id="cc-table" spellcheck="false" placeholder="Total for 26/27&#9;Total Inc VAT&#9;Monthly for 26/27&#9;Monthly Inc VAT&#9;Customer Order Number&#9;Site&#9;Plan Reference&#10;£133,697.57&#9;…&#9;PPM | SCON-00021244 - 1MARKS&#9;1 Mark Square LON19&#9;1 Mark Square LON19 - Aug 27 Renewal - Master Contract" style="width:100%;height:130px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;white-space:pre;box-sizing:border-box;"></textarea>
      </label>
      <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center;">
        <button id="cc-preview" class="jl-button-green" style="padding:5px 14px;">Preview</button>
        <button id="cc-create" class="jl-button-green" style="padding:5px 14px;">Create all</button>
        <button id="cc-copy" style="padding:5px 12px;margin-left:auto;background:#eef1f5;color:#243b46;border:1px solid #c9d4da;border-radius:4px;cursor:pointer;">Copy log</button>
      </div>
      <div id="cc-status" style="margin-bottom:6px;font-weight:600;"></div>
      <div id="cc-out" style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;line-height:1.5;max-height:40vh;overflow:auto;background:#fbfcfe;border:1px solid #e2e7ee;border-radius:4px;padding:8px;white-space:pre-wrap;">Paste the sheet above, then click Preview — nothing is created.</div>`;
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

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    async function run(dryRun) {
      if (running) return;

      const parsed = parseTsv($('table').value);
      outEl.textContent = '';
      parsed.errors.forEach(e => log('! ' + e, 'warn'));
      const ROWS = parsed.rows;
      if (!ROWS.length) { status('No usable rows — paste the table (with headers) first.', 'err'); return; }
      log('Parsed ' + ROWS.length + ' row(s) — ' + parsed.mapNote + '.');
      if (!getToken()) log('! Anti-forgery token not found on page — requests may be rejected. Try reloading.', 'warn');

      running = true; prevBtn.disabled = true; goBtn.disabled = true;
      prevBtn.style.opacity = goBtn.style.opacity = '.5';

      // Which plan references already exist? (Skip those — never duplicate.)
      status('Checking which contracts already exist…');
      const existing = await fetchExistingRefs(ROWS, log);
      const toDo = ROWS.filter(r => !existing.has(normRef(r.plan)));
      const already = ROWS.length - toDo.length;
      if (already) log(already + ' of ' + ROWS.length + ' already exist and will be skipped.', 'warn');
      log(toDo.length + ' to ' + (dryRun ? 'create (preview)' : 'create') + '.');

      if (!dryRun) {
        if (!toDo.length) { status('Nothing to create — all already exist.', 'ok'); running = false; prevBtn.disabled = goBtn.disabled = false; prevBtn.style.opacity = goBtn.style.opacity = '1'; return; }
        const yes = window.confirm(
          'Create ' + toDo.length + ' new PPM contract(s) for WeWork?\n' +
          (already ? '(' + already + ' already exist and will be skipped.)\n' : '') + '\n' +
          'Period ' + CFG.startDate + ' → ' + CFG.endDate + ', monthly invoicing, value = Total for 26/27.'
        );
        if (!yes) { status('Cancelled.', 'warn'); running = false; prevBtn.disabled = goBtn.disabled = false; prevBtn.style.opacity = goBtn.style.opacity = '1'; return; }
      }

      log(dryRun ? '── PREVIEW (dry run, nothing is created) ──' : '── CREATING CONTRACTS ──');

      let done = 0, failed = 0, skipped = already;
      for (let idx = 0; idx < toDo.length; idx++) {
        const row = toDo[idx];
        const tag = (idx + 1) + '/' + toDo.length + '  ' + row.site;
        status((dryRun ? 'Checking ' : 'Creating ') + (idx + 1) + ' of ' + toDo.length + '…');
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
            continue;
          }

          // Create with throttle + back-off. A WAF 403 may hide a real success,
          // so after backing off we re-check by searching for the plan reference.
          let created = false;
          for (let attempt = 0; attempt <= CFG.maxRetries && !created; attempt++) {
            const res = await createContract(row, site, billing);
            if (res.ok) {
              created = true;
              const url = res.id ? ('/PPMContract/Detail/' + res.id) : null;
              logHtml('<span style="color:' + COL.ok + '">✓ ' + esc(tag) + ' — created</span>' +
                (url ? ' <a href="' + url + '" target="_blank" style="color:#1b6fb3;">open</a>' : '') +
                (custWarn ? '<span style="color:' + COL.warn + '">' + esc(custWarn) + '</span>' : '') + '\n');
              break;
            }
            // did it actually land despite the error? (WAF 403 after a real save)
            const exists = (await searchContracts(row.plan)).some(ref => normRef(ref) === normRef(row.plan));
            if (exists) {
              created = true;
              log('✓ ' + tag + ' — created (server confirmed after HTTP ' + res.status + ')', 'ok');
              break;
            }
            if (attempt < CFG.maxRetries && (res.throttled || !res.resp)) {
              const wait = CFG.backoffMs[Math.min(attempt, CFG.backoffMs.length - 1)];
              log('… ' + tag + ' — HTTP ' + res.status + ' (rate-limited); retrying in ' + Math.round(wait / 1000) + 's', 'warn');
              await sleep(wait);
            } else {
              log('✗ ' + tag + ' — FAILED (HTTP ' + (res.status || '?') + ') ' +
                (res.resp ? JSON.stringify(res.resp).slice(0, 160) : res.raw), 'err');
              break;
            }
          }
          if (created) { done++; existing.add(normRef(row.plan)); }
          else failed++;
          await sleep(CFG.postDelayMs);
        } catch (e) {
          failed++;
          log('✗ ' + tag + ' — ' + (e && e.message ? e.message : e), 'err');
        }
      }

      const tail = skipped ? (', ' + skipped + ' skipped (already existed)') : '';
      status('Done: ' + done + ' ' + (dryRun ? 'to create' : 'created') + ', ' + failed + ' problem(s)' + tail + '.', failed ? 'warn' : 'ok');
      log('── DONE: ' + done + ' ' + (dryRun ? 'to create' : 'created') + ', ' + failed + ' problem(s)' + tail + ' ──', failed ? 'warn' : 'ok');
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
