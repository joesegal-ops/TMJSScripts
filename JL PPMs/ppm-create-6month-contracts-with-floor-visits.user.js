// ==UserScript==
// @name         JL - Create 6-Month PPM Contracts + Floor Visits
// @namespace    https://up-fm.com/joblogic
// @version      1.0.1
// @description  Paste a 4-column TSV (Site, Start Date, No. Days, No. Floors) and pick an initiation date. For each row it creates a No-Billing PPM Contract on that Site running for 6 months from the initiation date, then adds one visit per floor starting on the row's Start Date and lasting No. Days. Preview (dry-run) first. Safe to re-run — existing contracts are reused and only missing floor visits are added.
// @match        https://go.joblogic.com/PPMContract
// @match        https://go.joblogic.com/PPMContract/*
// @run-at       document-idle
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20PPMs/ppm-create-6month-contracts-with-floor-visits.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20PPMs/ppm-create-6month-contracts-with-floor-visits.user.js
// ==/UserScript==

/*
 * WHAT THIS DOES
 *  For each pasted row  (Site <tab> Start Date <tab> No. Days <tab> No. Floors):
 *   1. Looks up the Site by exact name (/Site/GetSites) → siteId + customerId.
 *   2. Creates a PPM Contract (/api/PPMContract/CreatePPMContract):
 *        Billing      : No Billing
 *        Period       : Initiation date → +6 months − 1 day   (initiation date is set in the panel)
 *        Plan Ref     : from the panel template (default "{site} - 6 Month PPM")
 *        Selling rate : Non-Chargeable (JL default)
 *   3. Adds one visit per floor (/api/Visit/SavePPMContractVisits, IsNew visits):
 *        Description  : from the panel template (default "Floor {n}")
 *        Start        : row Start Date at the panel start time (default 08:00)
 *        Duration     : No. Days, ending at the panel end time on the last day (default 17:00)
 *                       e.g. 5 days 08:00→17:00 = 4×1440 + 540 = 6300 minutes
 *        Unassigned (no engineer) — allocate afterwards as normal.
 *   Visits are verified by re-reading the contract (SavePPMContractVisits can return
 *   success:true while silently ignoring a save).
 *
 *  RE-RUN SAFETY
 *   A contract with the same Plan Reference + Site + Start date is reused, not duplicated,
 *   and only floor visits whose description isn't already on it are added.
 *
 *  Dates in the TSV: DD/MM/YYYY (also D/M/YY, YYYY-MM-DD, "13 Oct 2026"). A header row is
 *  detected and skipped automatically.
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

  const SCRIPT_ID = 'ppm-create-6month-contracts-floor-visits';
  const SCRIPT_LABEL = '🏗️ 6-Month PPMs + Floor Visits';
  const SCRIPT_COLOR = '#1b7a3a';
  const SCRIPT_VERSION = 'v1.0.1';
  const SCRIPT_DESC = 'Paste 4 columns (Site, Start Date, No. Days, No. Floors) and set the initiation date. Each row becomes a No-Billing PPM Contract on that Site for 6 months from the initiation date, with one visit per floor starting on the Start Date and lasting No. Days (unassigned). Click Preview first (nothing is changed), then Create all. Safe to re-run — existing contracts (same plan ref + site + start) are reused and only missing floor visits are added.';

  // ----------------------------------------------------------------------------
  // CONFIG
  // ----------------------------------------------------------------------------
  const CFG = {
    billingType: 3,          // ENUM_TYPE_BILLING.NO_BILLING
    invoiceType: 1,          // ENUM_TYPE_INVOICE.inAdvance (unused for No Billing, but the form always sends it)
    invoiceFrequency: 2,     // Monthly (ditto)
    sellingRateId: 97830,    // "Non - Chargeable" (Joblogic default)
    selectedAddressType: 5,  // 5 = Site (Billing) address
    createUrl: '/api/PPMContract/CreatePPMContract',
    siteSearchUrl: '/Site/GetSites',
    contractSearchUrl: '/api/PPMContract/SearchPPMContract',
    getVisitsUrl: guid => '/api/Visit/GetVisits/' + guid,
    saveVisitsUrl: '/api/Visit/SavePPMContractVisits',
    minIntervalMs: 1400,     // Azure WAF budget is per IP — 1400ms is the proven safe pace
    wafBackoffMs: [1500, 3000, 6000, 12000, 20000],
    createRetries: 3
  };

  const DEFAULTS = {
    months: 6,
    planTpl: '{site} - 6 Month PPM',
    visitTpl: 'Floor {n}',
    startTime: '08:00',
    endTime: '17:00'
  };

  // ----------------------------------------------------------------------------
  // DATES
  // ----------------------------------------------------------------------------
  const pad = n => String(n).padStart(2, '0');
  const dmy = d => pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

  function mkDate(y, m, d) {
    if (y < 100) y += 2000;
    const dt = new Date(y, m, d);
    return (dt.getFullYear() === y && dt.getMonth() === m && dt.getDate() === d) ? dt : null;
  }

  // DD/MM/YYYY, D/M/YY, DD-MM-YYYY, DD.MM.YYYY, YYYY-MM-DD(Thh:mm…), "13 Oct 2026", "13-Oct-26"
  function parseDate(s) {
    s = String(s == null ? '' : s).trim();
    let m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return mkDate(+m[1], +m[2] - 1, +m[3]);
    if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/))) return mkDate(+m[3], +m[2] - 1, +m[1]);
    if ((m = s.match(/^(\d{1,2})[\s\-]+([A-Za-z]{3})[A-Za-z]*[\s\-,]+(\d{2,4})$/)) && MONTHS[m[2].toLowerCase()] != null)
      return mkDate(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
    return null;
  }

  // start + n months − 1 day, clamping the day (31 Aug + 6m → 28 Feb, not 3 Mar)
  function contractEnd(start, months) {
    const y = start.getFullYear(), mo = start.getMonth() + months;
    const last = new Date(y, mo + 1, 0).getDate();
    const d = new Date(y, mo, Math.min(start.getDate(), last));
    d.setDate(d.getDate() - 1);
    return d;
  }

  const hhmmToMin = s => { const m = String(s || '').match(/^(\d{1,2}):(\d{2})$/); return m ? (+m[1]) * 60 + (+m[2]) : null; };

  // Search rows may carry dates as DD/MM/YYYY, ISO, or /Date(ms)/ — normalise to DD/MM/YYYY.
  function normDate(v) {
    if (v == null) return '';
    const ms = String(v).match(/\/Date\((-?\d+)/);
    if (ms) return dmy(new Date(+ms[1]));
    const d = parseDate(v);
    return d ? dmy(d) : String(v);
  }

  // ----------------------------------------------------------------------------
  // TSV PARSING — Site, Start Date, No. Days, No. Floors (fixed column order)
  // ----------------------------------------------------------------------------
  function parseTsv(text) {
    const lines = String(text || '').split(/\r?\n/).filter(l => l.trim() !== '');
    const rows = [], errors = [];
    lines.forEach((line, i) => {
      const c = line.split('\t').map(x => x.trim());
      const site = c[0] || '';
      const start = parseDate(c[1]);
      const days = Number(String(c[2] || '').replace(/[^0-9.]/g, ''));
      const floors = Number(String(c[3] || '').replace(/[^0-9.]/g, ''));
      if (i === 0 && !start && !(days > 0)) return; // header row
      if (!site) { errors.push('Line ' + (i + 1) + ': no Site — skipped'); return; }
      if (!start) { errors.push('Line ' + (i + 1) + ' (' + site + '): Start Date "' + (c[1] || '') + '" not recognised — skipped'); return; }
      if (!Number.isInteger(days) || days < 1) { errors.push('Line ' + (i + 1) + ' (' + site + '): No. Days "' + (c[2] || '') + '" must be a whole number ≥ 1 — skipped'); return; }
      if (!Number.isInteger(floors) || floors < 1) { errors.push('Line ' + (i + 1) + ' (' + site + '): No. Floors "' + (c[3] || '') + '" must be a whole number ≥ 1 — skipped'); return; }
      rows.push({ line: i + 1, site, start, days, floors });
    });
    return { rows, errors };
  }

  // ----------------------------------------------------------------------------
  // JOBLOGIC PLUMBING
  // ----------------------------------------------------------------------------
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let stopRequested = false;

  function getToken() {
    const el = document.querySelector('input[name="__RequestVerificationToken"]');
    return el ? el.value : null;
  }

  // One throttle for every request (Azure WAF rate-limits per IP).
  let lastReqAt = 0, curInterval = CFG.minIntervalMs;
  async function throttle() {
    const wait = lastReqAt + curInterval - Date.now();
    if (wait > 0) await sleep(wait);
    lastReqAt = Date.now();
  }

  function isWafBlock(status, raw, headers) {
    if (![403, 429, 503].includes(status)) return false;
    const gw = /Application-Gateway/i.test((headers && headers.get('server')) || '');
    return gw || /^\s*<(?:!doctype|html)/i.test(raw || '');
  }

  // fetch → {status, data, raw, waf}. retryWaf=false for non-idempotent creates.
  async function jlFetch(url, opts, retryWaf) {
    const token = getToken();
    const headers = Object.assign({ 'X-Requested-With': 'XMLHttpRequest' }, token ? { '__RequestVerificationToken': token } : {}, (opts && opts.headers) || {});
    const backoff = retryWaf === false ? [] : CFG.wafBackoffMs;
    for (let attempt = 0; ; attempt++) {
      await throttle();
      let r, raw = '';
      try {
        r = await fetch(url, Object.assign({ credentials: 'include' }, opts || {}, { headers }));
        raw = await r.text();
      } catch (e) {
        if (attempt < backoff.length) { await sleep(backoff[attempt]); continue; }
        throw e;
      }
      let data = null;
      try { data = JSON.parse(raw); } catch (e) {}
      const waf = isWafBlock(r.status, raw, r.headers);
      if (waf) curInterval = Math.min(4000, curInterval + 200);
      if (waf && attempt < backoff.length) { await sleep(backoff[attempt]); continue; }
      return { status: r.status, data, raw, waf };
    }
  }

  // Resolve a site name → site row (Id, CustomerId, CustomerName, billing address…)
  async function resolveSite(name, customerFilter) {
    const res = await jlFetch(CFG.siteSearchUrl + '?text=' + encodeURIComponent(name));
    if (res.status !== 200 || !Array.isArray(res.data)) throw new Error('Site search failed (HTTP ' + res.status + ')');
    const wanted = name.trim().toLowerCase();
    let exact = res.data.filter(s => (s.Name || '').trim().toLowerCase() === wanted);
    if (!exact.length) throw new Error('No site named exactly "' + name + '" (' + res.data.length + ' fuzzy result(s): ' + res.data.slice(0, 3).map(s => s.Name).join(' / ') + ')');
    if (customerFilter) {
      const cf = customerFilter.trim().toLowerCase();
      const f = exact.filter(s => (s.CustomerName || '').toLowerCase().includes(cf));
      if (!f.length) throw new Error('Site "' + name + '" exists but not under a customer matching "' + customerFilter + '" (found: ' + exact.map(s => s.CustomerName).join(', ') + ')');
      exact = f;
    }
    if (exact.length > 1) throw new Error('Ambiguous: ' + exact.length + ' sites named "' + name + '" (customers: ' + exact.map(s => s.CustomerName).join(', ') + ') — set the Customer filter');
    return exact[0];
  }

  function addressOf(site) {
    const useBilling = site.UseBillingAddress && (site.BillingName || site.BillingAddress1);
    const p = useBilling ? 'Billing' : '';
    return {
      Name: (useBilling ? site.BillingName : site.Name) || '',
      Address1: site[p + 'Address1'] || '', Address2: site[p + 'Address2'] || '',
      Address3: site[p + 'Address3'] || '', Address4: site[p + 'Address4'] || '',
      Postcode: site[p + 'Postcode'] || '', Address: ''
    };
  }

  // Faithful replica of Joblogic's component.objectToFormData
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof File);
  function objectToFormData(t, n, i) {
    n = n || new FormData(); i = i || '';
    Object.keys(t).forEach(a => {
      const s = t[a], o = i ? i + '[' + a + ']' : a;
      if (Array.isArray(s)) s.forEach((item, idx) => { const k = o + '[' + idx + ']'; if (isObj(item)) objectToFormData(item, n, k); else n.append(k, item); });
      else if (isObj(s)) objectToFormData(s, n, o);
      else n.append(o, s != null ? s : '');
    });
    return n;
  }
  // Faithful replica of Joblogic's component.fixDataType
  function fixDataType(fd) {
    ['VisitFrequency', 'TagIds', 'Assets'].forEach(k => { const v = fd.get(k); if (v == null || v === '') fd.delete(k); });
    return fd;
  }

  // Same shape as Joblogic's getParamsFromStore (see ppm-create-contracts-from-table).
  function buildParams(job) {
    const a = addressOf(job.site);
    return {
      CustomerContractId: null, SelectedAddressType: CFG.selectedAddressType,
      PlanReference: job.plan, JobCategoryId: null, DepotId: null, Description: '',
      StartDate: job.cStart, EndDate: job.cEnd,
      PPMSellingRateId: CFG.sellingRateId,
      BillingType: CFG.billingType, SelectedInvoiceType: CFG.invoiceType,
      InvoiceContractValue: '0', NoBillingContractValue: 0,
      InvoiceFrequency: CFG.invoiceFrequency, WeekNumber: null, InvoiceFirstDate: job.cStart,
      VisitFirstDate: null, VisitFrequency: 1, VisitDescription: null, VisitDefaultValue: 0,
      Name: a.Name, Address1: a.Address1, Address2: a.Address2, Address3: a.Address3, Address4: a.Address4, Postcode: a.Postcode,
      DefaultEngineerId: null, DefaultEngineerTeamId: null, DefaultSubcontractorId: null,
      Labour: '0.00', Material: '0.00', Overtime: '0.00', Expenses: '0.00',
      Travel: '0.00', CallOut: '0.00', Mileage: '0.00', Subcontractor: '0.00',
      TagIds: [],
      InvoiceHeaderDetails: { AccountNumber: '', OrderNumber: '', InvoiceHeaderId: '', InvoiceHeaderDescription: '', InvoiceHeader: '', Notes: '', Terms: '', EmailTo: '', EmailSubject: '', EmailBody: '' },
      IsPPMScheduleImport: false, AccountManagerId: null, AccountManager: null, CustomerOrderNumber: '',
      GenerateTrade: false, GenerateAssetDescription: false, GenerateFrequency: false, ExcludeWeekends: false,
      QuoteRequestId: null, IncludeQuoteRequestAssets: false, IncludeQuoteRequestNotes: false, IncludeQuoteRequestAttachments: false,
      SiteIds: [], ExchangeRateDate: dmy(new Date()), ConversionRate: null, ToCurrencyCode: '',
      IsEnabledMultipleCurrencies: false, ToCurrencyName: '', BaseCurrencyCode: 'GBP', BaseCurrencyName: 'Pound Sterling',
      PPMCustomerId: job.site.CustomerId, PPMSiteId: job.site.Id
    };
  }

  async function postCreate(job) {
    const fd = fixDataType(objectToFormData(buildParams(job)));
    const token = getToken();
    if (token) fd.append('__RequestVerificationToken', token);
    // No WAF auto-retry here: a 403 can hide a real create, so the caller re-checks first.
    return jlFetch(CFG.createUrl, { method: 'POST', body: fd }, false);
  }

  // Create response carries the new contract GUID — as a bare string in AdditionalData,
  // or wrapped in an object; accept any GUID-looking value we can find.
  const GUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  function guidFromCreate(d) {
    const ad = d.AdditionalData != null ? d.AdditionalData : d.additionalData;
    const cands = [ad, ad && ad.Id, ad && ad.UniqueId, ad && ad.PPMContractId, ad && ad.Guid, d.Id, d.redirectUrl, d.RedirectUrl];
    for (const c of cands) { const m = typeof c === 'string' && c.match(GUID_RE); if (m && !/^0{8}-/.test(m[0])) return m[0]; }
    const m = JSON.stringify(d).match(GUID_RE);
    return m && !/^0{8}-/.test(m[0]) ? m[0] : null;
  }

  const normRef = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

  async function searchContracts(term) {
    const res = await jlFetch(CFG.contractSearchUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: new URLSearchParams({ SearchTerm: term, PageNumber: 1, PageSize: 500 }).toString()
    });
    if (res.status !== 200) throw new Error('Contract search failed (HTTP ' + res.status + ')');
    return (res.data && res.data.AdditionalData && res.data.AdditionalData.PPMContracts) || [];
  }

  // Dedup key = PlanReference + SiteId + StartDate (plan refs repeat across sites).
  async function findExisting(job) {
    const list = await searchContracts(job.plan);
    return list.find(c => normRef(c.PlanReference) === normRef(job.plan) &&
      String(c.SiteId) === String(job.site.Id) &&
      normDate(c.StartDate) === job.cStart && !c.IsCancelled) || null;
  }

  async function getVisits(guid) {
    const res = await jlFetch(CFG.getVisitsUrl(guid));
    if (res.status !== 200 || !res.data || !res.data.AdditionalData) throw new Error('GetVisits failed (HTTP ' + res.status + ')');
    return res.data.AdditionalData;
  }

  const liveDescs = ad => new Set((ad.Visits || []).filter(v => !v.IsDeleted).map(v => normRef(v.Description)));

  // New-visit submit object — same fields as the page's GetSubmitData for an IsNew row.
  function newVisit(desc, startStr, durMin) {
    return {
      Id: crypto.randomUUID(), AssignType: 0,
      EngineerId: null, EngineerTeamId: null, SubcontractorId: null,
      JobId: null, JobCategoryId: null, Description: desc,
      StartDate: startStr, EstDuration: durMin, FixedPriceValue: 0,
      Appointment: 0, // appointmentWaitingStatus
      SendEmailSMS: false, IsNew: true, Edited: false, IsDeleted: false, FixedDuration: true,
      Assets: [], Tasks: [], LastUsedServiceOrder: null, TradeId: null, TradeDescription: null,
      IsDateAndTimeLocked: false, AdminEnforcedLock: false
    };
  }

  async function saveVisits(ppmContractId, siteId, visits) {
    const fd = new FormData();
    fd.append('dataFile', new Blob([JSON.stringify({ PPMContractId: ppmContractId, SiteId: siteId, Visits: visits })], { type: 'application/json' }), 'dataFileBlob');
    const res = await jlFetch(CFG.saveVisitsUrl, { method: 'POST', headers: { 'Accept': 'application/json' }, body: fd });
    if (res.status !== 200) throw new Error('SavePPMContractVisits HTTP ' + res.status + ' ' + (res.raw || '').slice(0, 200));
    if (!res.data || res.data.success !== true) throw new Error('SavePPMContractVisits: ' + ((res.data && res.data.errors && res.data.errors.join(', ')) || (res.raw || '').slice(0, 200)));
    return res.data;
  }

  // ----------------------------------------------------------------------------
  // UI
  // ----------------------------------------------------------------------------
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const LS_KEY = SCRIPT_ID + '-settings';
  let running = false;

  function buildPanel() {
    const p = document.createElement('div');
    p.id = SCRIPT_ID + '-panel';
    p.style.cssText = 'position:fixed;top:70px;right:8px;z-index:99999;width:480px;max-height:86vh;overflow:auto;background:#fff;border:1px solid #c9d4da;border-radius:6px;box-shadow:0 4px 18px rgba(0,0,0,.25);font-family:"Open Sans",sans-serif;font-size:12px;color:#243b46;padding:12px;';
    const inp = 'padding:3px 5px;border:1px solid #c9d4da;border-radius:3px;font-size:12px;';
    p.innerHTML = `
      <div style="font-weight:700;font-size:14px;margin-bottom:8px;">${SCRIPT_LABEL} <span style="font-weight:400;color:#888;">${SCRIPT_VERSION}</span></div>
      <div style="display:grid;grid-template-columns:auto 1fr auto 1fr;gap:6px 8px;align-items:center;background:#f4f6f9;border:1px solid #e2e7ee;border-radius:4px;padding:8px;margin-bottom:8px;">
        <b>Initiation date</b><input id="sm-init" type="date" style="${inp}">
        <b>Months</b><input id="sm-months" type="number" min="1" max="60" style="${inp}width:60px;">
        <b>Plan ref</b><input id="sm-plan" type="text" style="${inp}grid-column:span 3;" title="{site} is replaced with the site name">
        <b>Visit desc</b><input id="sm-desc" type="text" style="${inp}grid-column:span 3;" title="{n} = floor number, {site} = site name">
        <b>Visit start</b><input id="sm-st" type="time" style="${inp}">
        <b>Ends (last day)</b><input id="sm-et" type="time" style="${inp}">
        <b>Customer filter</b><input id="sm-cust" type="text" placeholder="optional — only if a site name exists under several customers" style="${inp}grid-column:span 3;">
      </div>
      <div id="sm-summary" style="margin-bottom:8px;color:#4a6572;"></div>
      <label style="display:block;margin-bottom:8px;">Paste 4 columns — Site · Start Date · No. Days · No. Floors (header row optional):<br>
        <textarea id="sm-table" spellcheck="false" placeholder="Site&#9;Start Date&#9;No Days&#9;No Floors&#10;1 Mark Square LON19&#9;03/11/2026&#9;5&#9;8" style="width:100%;height:120px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;white-space:pre;box-sizing:border-box;"></textarea>
      </label>
      <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center;">
        <button id="sm-preview" class="jl-button-green" style="padding:5px 14px;">Preview</button>
        <button id="sm-create" class="jl-button-green" style="padding:5px 14px;">Create all</button>
        <button id="sm-stop" style="padding:5px 12px;background:#b71c1c;color:#fff;border:1px solid #b71c1c;border-radius:4px;cursor:pointer;display:none;">Stop</button>
        <button id="sm-copy" style="padding:5px 12px;margin-left:auto;background:#eef1f5;color:#243b46;border:1px solid #c9d4da;border-radius:4px;cursor:pointer;">Copy log</button>
      </div>
      <div id="sm-status" style="margin-bottom:6px;font-weight:600;"></div>
      <div id="sm-out" style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;line-height:1.5;max-height:40vh;overflow:auto;background:#fbfcfe;border:1px solid #e2e7ee;border-radius:4px;padding:8px;white-space:pre-wrap;">Set the initiation date, paste the rows, then click Preview — nothing is created.</div>`;
    document.body.appendChild(p);
    return p;
  }

  function init() {
    const panel = buildPanel();
    jlRegisterPanel(panel, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR, SCRIPT_DESC);

    const $ = id => panel.querySelector('#sm-' + id);
    const outEl = $('out'), statusEl = $('status'), prevBtn = $('preview'), goBtn = $('create'), stopBtn = $('stop');
    const COL = { ok: '#1b7a3a', err: '#b71c1c', warn: '#9a6b00' };
    const status = (msg, cls) => { statusEl.textContent = msg; statusEl.style.color = cls ? COL[cls] : '#243b46'; };
    const log = (msg, cls) => { const s = document.createElement('span'); if (cls) s.style.color = COL[cls]; s.textContent = msg + '\n'; outEl.appendChild(s); outEl.scrollTop = outEl.scrollHeight; };
    const logHtml = html => { outEl.insertAdjacentHTML('beforeend', html); outEl.scrollTop = outEl.scrollHeight; };
    const link = (guid, text) => '<a href="/PPMContract/Detail/' + guid + '#visitsTab" target="_blank" style="color:#1b6fb3;">' + esc(text) + '</a>';

    // Settings persist per browser (convenience only).
    const fields = { init: '', months: DEFAULTS.months, plan: DEFAULTS.planTpl, desc: DEFAULTS.visitTpl, st: DEFAULTS.startTime, et: DEFAULTS.endTime, cust: '' };
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) {}
    Object.keys(fields).forEach(k => { $(k).value = saved[k] != null ? saved[k] : fields[k]; });
    const readSettings = () => {
      const s = {}; Object.keys(fields).forEach(k => { s[k] = $(k).value; });
      try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (e) {}
      return s;
    };
    const summarise = () => {
      const s = readSettings();
      const st = parseDate(s.init), months = parseInt(s.months, 10);
      $('summary').innerHTML = st && months > 0
        ? '<b>Contract</b> ' + dmy(st) + ' → ' + dmy(contractEnd(st, months)) + ' · <b>No Billing</b> · visits ' + esc(s.st) + ' on day 1 → ' + esc(s.et) + ' on the last day, unassigned'
        : '<span style="color:' + COL.err + '">Set an initiation date.</span>';
    };
    Object.keys(fields).forEach(k => $(k).addEventListener('input', summarise));
    summarise();

    $('copy').onclick = () => navigator.clipboard.writeText(outEl.textContent);
    stopBtn.onclick = () => { stopRequested = true; status('Stopping after the current row…', 'warn'); };
    prevBtn.onclick = () => run(true);
    goBtn.onclick = () => run(false);

    const setBusy = busy => {
      running = busy;
      prevBtn.disabled = goBtn.disabled = busy;
      prevBtn.style.opacity = goBtn.style.opacity = busy ? '.5' : '1';
      stopBtn.style.display = busy ? '' : 'none';
    };

    async function run(dryRun) {
      if (running) return;
      outEl.textContent = '';
      const s = readSettings();
      const initDate = parseDate(s.init), months = parseInt(s.months, 10);
      const stMin = hhmmToMin(s.st), etMin = hhmmToMin(s.et);
      if (!initDate) { status('Set the initiation date first.', 'err'); return; }
      if (!(months > 0)) { status('Months must be ≥ 1.', 'err'); return; }
      if (stMin == null || etMin == null) { status('Visit start / end times must be HH:mm.', 'err'); return; }
      if (!/\{n\}/.test(s.desc)) { status('Visit description must contain {n} (the floor number) so each floor visit is distinct.', 'err'); return; }

      const parsed = parseTsv($('table').value);
      parsed.errors.forEach(e => log('! ' + e, 'warn'));
      if (!parsed.rows.length) { status('No usable rows — paste Site, Start Date, No. Days, No. Floors.', 'err'); return; }

      const cStartD = initDate, cEndD = contractEnd(initDate, months);
      const cStart = dmy(cStartD), cEnd = dmy(cEndD);
      const jobs = parsed.rows.map(r => {
        const dur = (r.days - 1) * 1440 + (etMin - stMin);
        const visitEnd = new Date(r.start); visitEnd.setDate(visitEnd.getDate() + r.days - 1);
        return Object.assign({}, r, {
          cStart, cEnd, dur, visitEnd,
          plan: s.plan.replace(/\{site\}/g, r.site).trim(),
          startStr: dmy(r.start) + ' ' + s.st,
          descs: Array.from({ length: r.floors }, (_, i) => s.desc.replace(/\{n\}/g, i + 1).replace(/\{site\}/g, r.site).trim())
        });
      });
      const badDur = jobs.filter(j => j.dur <= 0);
      if (badDur.length) { status('Visit end time must be after the start time for 1-day visits (' + badDur.map(j => j.site).join(', ') + ').', 'err'); return; }

      log('Parsed ' + jobs.length + ' row(s), ' + jobs.reduce((a, j) => a + j.floors, 0) + ' floor visit(s). Contract ' + cStart + ' → ' + cEnd + ', No Billing.');
      if (!getToken()) log('! Anti-forgery token not found on this page — requests may be rejected. Reload and try again.', 'warn');

      if (!dryRun && !window.confirm('Create up to ' + jobs.length + ' No-Billing PPM contract(s) (' + cStart + ' → ' + cEnd + ') and ' +
        jobs.reduce((a, j) => a + j.floors, 0) + ' floor visit(s)?\n\nExisting contracts (same plan ref + site + start) are reused, and floor visits already on them are skipped.')) {
        status('Cancelled.', 'warn'); return;
      }

      setBusy(true); stopRequested = false;
      log(dryRun ? '── PREVIEW (dry run, nothing is changed) ──' : '── CREATING ──');
      const tally = { contracts: 0, reused: 0, visits: 0, problems: 0 };

      for (let i = 0; i < jobs.length; i++) {
        if (stopRequested) { log('■ Stopped by user before row ' + (i + 1) + '.', 'warn'); break; }
        const job = jobs[i];
        const tag = (i + 1) + '/' + jobs.length + '  ' + job.site;
        status((dryRun ? 'Checking ' : 'Processing ') + (i + 1) + ' of ' + jobs.length + '…');
        try {
          job.site = await resolveSite(job.site, s.cust);
          const warns = [];
          if (job.start < cStartD || job.visitEnd > cEndD) warns.push('visit ' + dmy(job.start) + '–' + dmy(job.visitEnd) + ' falls outside the contract period');

          let existing = await findExisting(job);
          let guid = existing ? existing.UniqueId : null;
          let haveDescs = new Set();
          if (guid) haveDescs = liveDescs(await getVisits(guid));
          const todo = job.descs.filter(d => !haveDescs.has(normRef(d)));

          if (dryRun) {
            log('✓ ' + tag + '  (site ' + job.site.Id + ' · ' + job.site.CustomerName + ')', 'ok');
            if (existing) log('    contract EXISTS: ' + existing.PPMContractNumber + ' — will reuse; ' + (job.floors - todo.length) + '/' + job.floors + ' floor visits already there', 'warn');
            else log('    new contract "' + job.plan + '"');
            log('    ' + todo.length + ' visit(s) to add: ' + (todo.length ? todo[0] + (todo.length > 1 ? ' … ' + todo[todo.length - 1] : '') : '—') +
              ' · ' + job.startStr + ' for ' + job.days + ' day(s) (' + job.dur + ' min)');
            warns.forEach(w => log('    ⚠ ' + w, 'warn'));
            existing ? tally.reused++ : tally.contracts++;
            tally.visits += todo.length;
            continue;
          }

          // 1) Contract
          if (existing) {
            tally.reused++;
            logHtml('<span style="color:' + COL.warn + '">↺ ' + esc(tag) + ' — reusing existing</span> ' + link(guid, existing.PPMContractNumber) + '\n');
          } else {
            for (let attempt = 0; attempt <= CFG.createRetries && !guid; attempt++) {
              const res = await postCreate(job);
              const ok = !!(res.data && (res.data.success || res.data.Success));
              guid = ok ? guidFromCreate(res.data) : null;
              if (guid) break;
              // Success without a readable id, or a WAF 403 that may hide a real create —
              // find it by search (give the index a moment to catch up) before any retry.
              for (let look = 0; look < 3 && !existing; look++) {
                if (look) await sleep(2000);
                existing = await findExisting(job);
              }
              if (existing) { guid = existing.UniqueId; break; }
              // Joblogic said success but we can't find it — never re-post (would duplicate).
              if (ok) throw new Error('Created, but could not resolve the new contract id — re-run to add visits. Response: ' + (res.raw || '').slice(0, 200));
              if (attempt < CFG.createRetries && (res.waf || !res.data)) {
                log('… ' + tag + ' — HTTP ' + res.status + ' (rate-limited); retrying', 'warn');
                await sleep(CFG.wafBackoffMs[Math.min(attempt + 1, CFG.wafBackoffMs.length - 1)]);
              } else {
                throw new Error('Contract create failed (HTTP ' + res.status + ') ' + (res.data ? JSON.stringify(res.data).slice(0, 200) : (res.raw || '').slice(0, 200)));
              }
            }
            if (!guid) throw new Error('Contract create failed after retries');
            tally.contracts++;
            logHtml('<span style="color:' + COL.ok + '">✓ ' + esc(tag) + ' — contract created</span> ' + link(guid, 'open') + '\n');
          }

          // 2) Floor visits
          const ad = await getVisits(guid);
          const have = liveDescs(ad);
          const add = job.descs.filter(d => !have.has(normRef(d)));
          if (!add.length) { log('    all ' + job.floors + ' floor visits already present', 'ok'); continue; }
          await saveVisits(ad.PPMContractId, ad.SiteId, add.map(d => newVisit(d, job.startStr, job.dur)));

          // 3) Verify (success:true is not proof)
          const after = liveDescs(await getVisits(guid));
          const missing = job.descs.filter(d => !after.has(normRef(d)));
          tally.visits += add.length - missing.filter(d => add.includes(d)).length;
          if (missing.length) { tally.problems++; log('    ✗ ' + missing.length + ' visit(s) NOT saved: ' + missing.join(', '), 'err'); }
          else log('    ✓ ' + add.length + ' visit(s) added (' + job.startStr + ', ' + job.days + ' day(s))', 'ok');
          warns.forEach(w => log('    ⚠ ' + w, 'warn'));
        } catch (e) {
          tally.problems++;
          log('✗ ' + tag + ' — ' + (e && e.message ? e.message : e), 'err');
        }
      }

      const summary = (dryRun ? 'Preview: ' + tally.contracts + ' contract(s) to create, ' + tally.reused + ' to reuse, ' + tally.visits + ' visit(s) to add'
        : 'Done: ' + tally.contracts + ' contract(s) created, ' + tally.reused + ' reused, ' + tally.visits + ' visit(s) added') +
        ', ' + tally.problems + ' problem(s).';
      status(summary, tally.problems ? 'warn' : 'ok');
      log('── ' + summary + ' ──', tally.problems ? 'warn' : 'ok');
      if (dryRun && !tally.problems) log('Preview looks clean. Click "Create all" to proceed.', 'ok');
      setBusy(false);
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
