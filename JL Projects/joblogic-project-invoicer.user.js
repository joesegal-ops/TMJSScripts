// ==UserScript==
// @name         Joblogic - Project Invoicer (bulk create → approve → email)
// @namespace    http://tampermonkey.net/
// @version      1.23
// @description  Paste a list of Jobs + PO numbers (a job cell may hold several comma-separated job numbers — each is tried in order until one has something to invoice, and the empty £0 draft Joblogic leaves behind for an already-invoiced job is deleted automatically). Works through them ONE AT A TIME (create invoice → set Customer Order Number to "PROJ | PO-XXXX - SITEID", SITEID auto-derived from the job's site → approve → email → then updates the matching Monday item (Finance Stat → "Invoiced", Price Est. ← invoice net) → next), so Stop always leaves you at a known job and Start resumes from there. Default DRY-RUN: composes each email and stops for you to review + Send; tick "Auto-send" to send unattended. Outputs a TSV you can paste straight into Google Sheets. Collapses to a launcher in the shared dock.
// @match        https://go.joblogic.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @connect      api.monday.com
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Projects/joblogic-project-invoicer.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Projects/joblogic-project-invoicer.user.js
// ==/UserScript==

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

    // Read the version straight from the userscript metadata so it never drifts
    // from the @version header (GM_info is available in Tampermonkey under any @grant).
    const VERSION = (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) ? GM_info.script.version : '';

    const SCRIPT_ID = 'project-invoicer';
    const SCRIPT_LABEL = '📧 Project Invoicer';
    const SCRIPT_COLOR = '#7A4FBF';
    const SCRIPT_DESC = 'Bulk-invoice Jobs to the customer. Paste "JobNumber <tab> PO" rows; the script creates each invoice, sets the Customer Order Number to "PROJ | PO-XXXX - SITEID", approves it, then opens the email composer with the standard recipients. Dry-run by default (stops at each email for you to Send). Copy the results into Google Sheets when done.';

    // Fixed recipients for every invoice email.
    const RECIPIENTS = [
        'europepayments@wework.com',
        'accounts.receivable@up-fm.com',
    ];

    const STATE_KEY = 'jl-project-invoicer-state';
    const LOG_KEY = 'jl-project-invoicer-log';   // persists the log across page navigations (email step reloads the page)
    function loadLog() { try { return JSON.parse(localStorage.getItem(LOG_KEY)) || []; } catch (e) { return []; } }
    function saveLog(lines) { try { localStorage.setItem(LOG_KEY, JSON.stringify(lines.slice(-400))); } catch (e) {} }
    const DELAY = 500;               // politeness delay between API calls (ms)
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    // --- Monday write-back (board "Minor Projects - WW Active") ---
    const MONDAY_BOARD = 5084790211;
    const MB_FINANCE = 'color_mkvy3avs';    // Finance Stat. → "Invoiced"
    const MB_PRICE   = 'numbers_mkmk43k6';  // Price Est. (ex. VAT)
    const MB_PO      = 'text_mky86hyy';      // PO Number (primary match key)
    const MB_JOBREF  = 'text_mkyrcb16';      // Job Ref. (fallback match key)
    const MB_PMSTAT  = 'status';             // PM Stat. — "Complete" means leave the job as Invoiced
    const MONDAY_TOKEN_KEY = 'jl-monday-token';   // Tampermonkey GM storage, set via a prompt (no DOM field → password managers can't clobber it)
    function mondayToken() { try { return GM_getValue(MONDAY_TOKEN_KEY, '') || ''; } catch (e) { return ''; } }

    // With @grant GM_xmlhttpRequest the script runs in TM's sandbox, so page globals
    // (e.g. JL's onClickShareEmail) live on unsafeWindow, not the sandbox `window`.
    const pageWin = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

    // --- STATE (persisted across navigations) ---
    function loadState() { try { return JSON.parse(localStorage.getItem(STATE_KEY)); } catch (e) { return null; } }
    function saveState(s) { localStorage.setItem(STATE_KEY, JSON.stringify(s)); }
    function clearState() { localStorage.removeItem(STATE_KEY); }

    // --- UI refs ---
    let panel, inputArea, autoSendCheck, skipEmailCheck, mondayCheck, startBtn, stopBtn, resetBtn, copyBtn, nextBtn, refillBtn, logArea, progressText, resultsArea;

    // =======================================================================
    // Helpers
    // =======================================================================
    function getToken() {
        const el = document.querySelector('input[name="__RequestVerificationToken"]');
        return el ? el.value : '';
    }
    function tokenFromHtml(html) {
        const m = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
        return m ? m[1] : '';
    }
    function nowStamp() {
        // DD/MM/YYYY HH:mm — matches Joblogic + pastes cleanly into Google Sheets (en-GB).
        const d = new Date();
        const p = n => String(n).padStart(2, '0');
        return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }
    // SITEID: strip whitespace, first 6 chars, upper. "120 Moorgate"->120MOO, "10 York Road"->10YORK
    function siteIdFrom(siteName) {
        return String(siteName || '').replace(/\s+/g, '').slice(0, 6).toUpperCase();
    }
    // Normalise PO so the reference is always "PO-<number>" regardless of how it was pasted.
    function formatPO(raw) {
        const cleaned = String(raw || '').trim().replace(/^PO[-\s:]*/i, '');
        return 'PO-' + cleaned;
    }
    function buildReference(po, siteId) {
        return `PROJ | ${formatPO(po)} - ${siteId}`;
    }

    async function fetchText(url) {
        const r = await fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
        return r.text();
    }

    // =======================================================================
    // API: resolve / create / set order number / approve
    // =======================================================================
    async function resolveJob(jobNumber) {
        const r = await fetch('/api/Job/SearchJsonData', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', '__RequestVerificationToken': getToken() },
            body: JSON.stringify({ SearchTerm: jobNumber, PageSize: 10, PageIndex: 1, EngineerType: 0, IncludePPMJobs: true, IncludeReactiveJobs: true }),
        });
        if (!r.ok) throw new Error('SearchJsonData HTTP ' + r.status);
        const j = await r.json();
        const jobs = (j.AdditionalData && j.AdditionalData.Jobs) || [];
        if (!jobs.length) throw new Error('Job not found: "' + jobNumber + '"');
        // Prefer an exact JobNumber match; else take the first hit.
        const exact = jobs.find(x => String(x.JobNumber).toLowerCase() === jobNumber.toLowerCase());
        const job = exact || jobs[0];
        return { jobId: job.Id, jobNumber: job.JobNumber, siteName: job.SiteName || '' };
    }

    async function createInvoice(jobId) {
        const r = await fetch('/Invoice/Create?jobId=' + encodeURIComponent(jobId), {
            method: 'GET', credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' },
        });
        const txt = await r.text();
        let json = null; try { json = JSON.parse(txt); } catch (e) {}
        if (json && json.success === false) throw new Error('Create failed: ' + (json.Message || (json.errors || []).join('; ')));
        const url = (json && json.redirectUrl) || r.url || '';
        const m = String(url).match(/\/Invoice\/Detail\/(\d+)/);
        if (!m) throw new Error('Could not read new invoice id from create response');
        return m[1];
    }

    // Set the Customer Order Number via the InvoiceDetailForm (POST /api/Invoice).
    async function setOrderNumber(invoiceId, reference) {
        const html = await fetchText('/Invoice/Detail/' + invoiceId);
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const form = doc.getElementById('InvoiceDetailForm');
        if (!form) throw new Error('InvoiceDetailForm not found on invoice ' + invoiceId);
        const token = (form.querySelector('input[name="__RequestVerificationToken"]') || {}).value || tokenFromHtml(html);
        const entries = [...form.querySelectorAll('[name]')].map(el => {
            let v = el.type === 'checkbox' ? (el.checked ? 'true' : 'false') : (el.value || '');
            if (el.name === 'OrderNumber') v = reference;
            return [el.name, v];
        });
        if (!entries.some(([k]) => k === 'OrderNumber')) entries.push(['OrderNumber', reference]);
        const body = entries.map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
        const r = await fetch('/api/Invoice', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', '__RequestVerificationToken': token },
            body,
        });
        const txt = await r.text();
        let json = {}; try { json = JSON.parse(txt); } catch (e) {}
        if (!r.ok || json.success === false) throw new Error('Set order number failed: ' + (json.Message || (json.errors || []).join('; ') || ('HTTP ' + r.status)));
        return true;
    }

    // The human-facing Invoice Number (e.g. "002132") is only assigned on Approve — a
    // draft's title is "Draft - Invoice - JobLogic", an approved one "002132 - Invoice -
    // JobLogic". Parse that leading token (ignoring "Draft").
    function invoiceNumberFromTitle(title) {
        const m = String(title || '').match(/^\s*([^<]*?)\s*-\s*Invoice\b/i);
        const v = m ? m[1].trim() : '';
        return /draft/i.test(v) ? '' : v;
    }
    // Fetch the approved invoice's detail page and read its number from the <title>.
    async function fetchInvoiceNumber(invoiceId) {
        try {
            const html = await fetchText('/Invoice/Detail/' + invoiceId);
            const m = html.match(/<title>([\s\S]*?)<\/title>/i);
            return invoiceNumberFromTitle(m ? m[1] : '');
        } catch (e) { return ''; }
    }

    async function approveInvoice(invoiceId) {
        const r = await fetch('/api/Invoice/Approve/' + invoiceId, {
            method: 'POST', credentials: 'same-origin',
            headers: { 'X-Requested-With': 'XMLHttpRequest', '__RequestVerificationToken': getToken() },
        });
        const txt = await r.text();
        let json = {}; try { json = JSON.parse(txt); } catch (e) {}
        if (!r.ok || json.success === false) throw new Error('Approve failed: ' + (json.Message || (json.errors || []).join('; ') || ('HTTP ' + r.status)));
        return true;
    }

    // =======================================================================
    // JOB STATUS — capture before invoicing, put back afterwards
    // Approving an invoice flips the JOB's status to "Invoiced". We snapshot the
    // status first, then (unless Monday says the project is Complete) write it back.
    // Pattern lifted from JL Jobs/joblogic-bulk-set-category.user.js: pull the job-state
    // JSON embedded in /Job/Detail/{id}, then POST the FULL field set to
    // /api/Job/EditDetail with one field changed. A partial payload misbehaves.
    // =======================================================================
    function extractJobState(html, internalId) {
        const anchor = `"Id":${internalId}`;
        const i = html.indexOf(anchor);
        if (i < 0) throw new Error('Job state anchor not found in detail page');
        let depth = 0, start = -1;
        for (let p = i; p >= 0; p--) {
            const c = html[p];
            if (c === '}') depth++;
            else if (c === '{') { if (depth === 0) { start = p; break; } depth--; }
        }
        if (start < 0) throw new Error('Job state open brace not found');
        let d = 0, inStr = false, esc = false, end = -1;
        for (let j = start; j < html.length; j++) {
            const c = html[j];
            if (esc) { esc = false; continue; }
            if (c === '\\') { esc = true; continue; }
            if (c === '"') { inStr = !inStr; continue; }
            if (inStr) continue;
            if (c === '{') d++;
            else if (c === '}') { d--; if (d === 0) { end = j + 1; break; } }
        }
        if (end < 0) throw new Error('Job state close brace not found');
        return JSON.parse(html.slice(start, end));
    }

    async function fetchJobState(jobId) {
        const html = await fetchText('/Job/Detail/' + jobId);
        return { html, job: extractJobState(html, jobId) };
    }

    // Status code → label, for logging only. Cached for the run.
    let statusLabels = null;
    async function statusLabel(code) {
        if (code == null || code === '') return '';
        if (!statusLabels) {
            statusLabels = {};
            try {
                const r = await fetch('/api/Job/GetStatusesForDropdown', { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' } });
                if (r.ok) ((await r.json()).AdditionalData || []).forEach(x => { statusLabels[String(x.Value)] = x.Text; });
            } catch (e) {}
        }
        return statusLabels[String(code)] || String(code);
    }

    // Write StatusId back onto a job via /api/Job/EditDetail, echoing every other field.
    async function setJobStatus(jobId, statusId, _retry = 0) {
        const { html, job } = await fetchJobState(jobId);
        const tokenMatch = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
        const csrfToken = tokenMatch ? tokenMatch[1] : tokenFromHtml(html);

        const entries = [];
        const push = (k, v) => entries.push([k, v == null ? '' : String(v)]);
        push('Id', job.Id);
        push('AssignedToUserId', job.AssignedToUserId);
        const existingTagIds = Array.isArray(job.TagIds) ? job.TagIds
            : (Array.isArray(job.Tags) ? job.Tags.map(t => t.Id || t.TagId || t) : []);
        existingTagIds.forEach((id, idx) => push(`TagIds[${idx}]`, id));
        push('TradeId', job.TradeId);
        push('IsRecuring', job.IsRecuring);
        push('JobTypeId', job.JobTypeId);
        push('StatusId', statusId); // ← the change
        push('Description', job.Description);
        push('DateLogged', job.DateLogged);
        push('AppointmentDate', job.AppointmentDate);
        push('TargetCompletionDate', job.TargetCompletionDate);
        push('DateComplete', job.DateComplete);
        push('TargetAttendanceDate', job.TargetAttendanceDate);
        push('NextContactDate', job.NextContactDate);
        const fc = job.JobFaultCode || {};
        push('JobFaultCode[ReportedFaultCodeId]',      fc.ReportedFaultCodeId);
        push('JobFaultCode[ReportedFaultCodeName]',    fc.ReportedFaultCodeName);
        push('JobFaultCode[ReportedSubFaultCodeId]',   fc.ReportedSubFaultCodeId);
        push('JobFaultCode[ReportedSubFaultCodeName]', fc.ReportedSubFaultCodeName);
        push('JobFaultCode[ActualFaultCodeId]',        fc.ActualFaultCodeId);
        push('JobFaultCode[ActualFaultCodeName]',      fc.ActualFaultCodeName);
        push('JobFaultCode[ActualSubFaultCodeId]',     fc.ActualSubFaultCodeId);
        push('JobFaultCode[ActualSubFaultCodeName]',   fc.ActualSubFaultCodeName);
        push('JobCategoryId', job.JobCategoryId);
        push('PriorityId', job.PriorityId);
        push('OrderNumber', job.OrderNumber);
        push('CustomReference', job.CustomReference);
        push('IsRequireApproval', job.IsRequireApproval);
        push('CompletionTimeSinceOnSite', job.CompletionTimeSinceOnSite);
        push('JobUserReferenceFieldValue', job.JobUserReferenceFieldValue);
        push('JobUserReferenceDropdownListValue', job.JobUserReferenceDropdownListValue);
        push('CustomerContractId', job.CustomerContractId);
        push('ProjectNumber', job.ProjectNumber);
        push('MilestoneId', job.MilestoneId);
        push('ProjectMilestoneId', job.ProjectMilestoneId);
        push('ProjectId', job.ProjectId);
        push('BaseCurrencyCode', job.BaseCurrencyCode);
        push('BaseCurrencyName', job.BaseCurrencyName);
        push('ToCurrencyCode', job.ToCurrencyCode);
        push('ToCurrencyName', job.ToCurrencyName);
        push('ConversionRate', job.ConversionRate);
        push('ExchangeRateDate', job.ExchangeRateDate);
        push('IsEnabledMultipleCurrencies', job.IsEnabledMultipleCurrencies);
        push('PreferredCurrencyId', job.PreferredCurrencyId);
        push('CustomerId', job.CustomerId);
        push('IsAssociatedCustomer', job.IsAssociatedCustomer);

        const body = entries.map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
        const headers = { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' };
        if (csrfToken) headers['__RequestVerificationToken'] = csrfToken;
        const resp = await fetch('/api/Job/EditDetail', {
            method: 'POST', credentials: 'same-origin',
            referrer: location.origin + '/Job/Detail/' + jobId, referrerPolicy: 'unsafe-url',
            headers, body,
        });
        const txt = await resp.text().catch(() => '');
        if (!resp.ok) {
            if (resp.status === 400 && _retry < 1) { await sleep(2500); return setJobStatus(jobId, statusId, _retry + 1); }
            throw new Error(`EditDetail HTTP ${resp.status}: ${txt.slice(0, 200)}`);
        }
        let json = {}; try { json = JSON.parse(txt); } catch (e) {}
        if (json.success === false) throw new Error('EditDetail success=false: ' + (json.Message || txt.slice(0, 200)));
        return true;
    }

    // Put the job's pre-invoice status back, unless Monday says the project is Complete.
    // Never throws — logs and records onto the job, like pushJobToMonday.
    async function restoreJobStatus(i) {
        let s = loadState(); if (!s) return;
        const job = s.jobs[i]; if (!job) return;
        const done = (v) => { const cur = loadState(); if (cur) { cur.jobs[i] = job; saveState(cur); renderResults(cur); } return v; };

        // Only jobs we actually invoiced had their status changed by us.
        if (job.prepStatus !== 'approved') return;
        if (String(job.statusRestore || '').indexOf('done') === 0 || job.statusRestore === 'kept (PM Stat. Complete)') return; // idempotent on resume
        if (!job.statusBefore) { job.statusRestore = 'skipped (status not captured)'; return done(); }

        // PM Stat. decides. Prefer the value read during the Monday write-back; look it
        // up ourselves if Monday push was off or hasn't run.
        let pm = job.pmStat;
        if (pm === undefined || pm === null) {
            try {
                const hit = await mondayFindItem(formatPO(job.po), job.jobNumber);
                if (!hit) { job.statusRestore = 'skipped (no Monday item — status left as Invoiced)'; log(`    ⚠ status: no Monday item for ${formatPO(job.po)} / ${job.jobNumber} — can't read PM Stat., leaving job as Invoiced`, '#fd0'); return done(); }
                if (hit.ambiguous) { job.statusRestore = `skipped (${hit.count} Monday ${hit.by} matches)`; log(`    ⚠ status: ${hit.count} Monday items match — can't read PM Stat., leaving job as Invoiced`, '#fd0'); return done(); }
                pm = hit.pmStat;
                job.pmStat = pm;
            } catch (e) {
                job.statusRestore = 'skipped (Monday lookup failed: ' + e.message + ')';
                log(`    ⚠ status: couldn't read PM Stat. (${e.message}) — leaving job as Invoiced`, '#fd0');
                return done();
            }
        }

        if (String(pm).trim().toLowerCase() === 'complete') {
            job.statusRestore = 'kept (PM Stat. Complete)';
            log(`    status: PM Stat. is "Complete" — leaving job as Invoiced`, '#8fd');
            return done();
        }

        const was = await statusLabel(job.statusBefore);
        try {
            await setJobStatus(job.jobId, job.statusBefore);
            job.statusRestore = `done (back to ${was})`;
            log(`    status: PM Stat. is "${pm || '(blank)'}" (not Complete) — job ${job.jobNumber} put back to "${was}"`, '#0fa');
        } catch (e) {
            job.statusRestore = 'error';
            job.statusError = e.message;
            log(`    ✗ status: could not put ${job.jobNumber} back to "${was}": ${e.message}`, '#f55');
        }
        return done();
    }

    // Delete a draft invoice, exactly as the UI does: fetch its delete-confirmation
    // modal and submit that form. Used to clear away the empty £0 draft Joblogic hands
    // back for a job that has nothing left to invoice, so falling through to the next
    // job number on the row doesn't litter the account with stray drafts.
    async function deleteDraftInvoice(invoiceId) {
        const r = await fetch('/Invoice/DeleteModal?id=' + encodeURIComponent(invoiceId), {
            credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' },
        });
        if (!r.ok) throw new Error('DeleteModal HTTP ' + r.status);
        const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
        const form = doc.querySelector('form');
        if (!form || !form.getAttribute('action')) throw new Error('No delete form in modal for invoice ' + invoiceId);
        const action = form.getAttribute('action');
        const body = new URLSearchParams();
        form.querySelectorAll('input[name]').forEach(i => body.append(i.name, i.value));
        const r2 = await fetch(action, {
            method: 'POST', credentials: 'same-origin', body,
            headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        });
        const txt = await r2.text().catch(() => '');
        if (!r2.ok) throw new Error(action + ' HTTP ' + r2.status);
        let json = {}; try { json = JSON.parse(txt); } catch (e) {}
        if (json.success === false) throw new Error(action + ' success=false: ' + (json.Message || (json.errors || []).join('; ')));
        return true;
    }

    // All standard/project invoices on a job, via the SearchInvoice API.
    // Fields confirmed on live data: TotalExcludingVatDecimal, OrderNumber.
    async function searchJobInvoices(jobId) {
        const payload = {
            ProjectId: '', IsProjectInvoicesPage: 'false', RequireSummary: 'false',
            searchTerm: '', JobId: String(jobId || ''), PPMContractId: '', HireContractId: '',
            CustomerId: '', SiteId: '', PageSize: '25', PageIndex: '1', OrderBy: '0',
            startDate: '', endDate: '', paymentDueStartDate: '', paymentDueEndDate: '',
            SelectedTab: 'ALL_INVOICES', TagIds: '', excludeTagIds: '', batchIds: '',
            InvoicePaymentStatusIds: '', EmailStatusIds: '',
            includeStandardInvoices: 'true', includePPMInvoices: 'false', includeSORInvoices: 'false',
            includeCGroupInvoices: 'false', includeRelatedJobInvoices: 'false',
            includeHireInvoices: 'false', includeProjectInvoices: 'true',
        };
        const fd = new FormData();
        Object.entries(payload).forEach(([k, v]) => fd.append(k, v));
        const r = await fetch('/api/Invoice/SearchInvoice', {
            method: 'POST', credentials: 'same-origin', body: fd,
            headers: { 'X-Requested-With': 'XMLHttpRequest', '__RequestVerificationToken': getToken() },
        });
        if (!r.ok) throw new Error('SearchInvoice HTTP ' + r.status);
        const j = await r.json();
        return ((j.AdditionalData || {}).Invoices) || [];
    }

    // The ex-VAT total of ONE specific invoice — no fallback to other invoices on the job.
    // Returns null if that invoice isn't in the list yet. Used to spot the empty draft.
    async function draftNet(jobId, invoiceId) {
        const inv = (await searchJobInvoices(jobId)).find(x => String(x.Id) === String(invoiceId));
        if (!inv) return null;
        const n = Number(inv.TotalExcludingVatDecimal);
        return isNaN(n) ? null : n;
    }

    // Invoice net (ex-VAT total) + Customer Order Number for the job.
    async function fetchInvoiceInfo(jobId, invoiceId) {
        const invs = await searchJobInvoices(jobId);
        if (!invs.length) return { net: null, orderNumber: '' };
        // Pick the source invoice: normally the one we just created (has lines); if that's
        // empty/£0 (already-invoiced job), fall back to the job's largest-net invoice — the
        // real prior one — and read BOTH its net and its Customer Order Number from there.
        const exact = invs.find(x => String(x.Id) === String(invoiceId));
        let chosen = (exact && Number(exact.TotalExcludingVatDecimal) > 0) ? exact : null;
        if (!chosen) {
            const top = invs.reduce((b, x) => ((Number(x.TotalExcludingVatDecimal) || 0) > (Number(b.TotalExcludingVatDecimal) || 0) ? x : b), invs[0]);
            chosen = (Number(top.TotalExcludingVatDecimal) || 0) > 0 ? top : (exact || top);
        }
        const net = chosen ? Number(chosen.TotalExcludingVatDecimal) : NaN;
        return { net: isNaN(net) ? null : net, orderNumber: (chosen && chosen.OrderNumber) || (exact && exact.OrderNumber) || '' };
    }

    // =======================================================================
    // MONDAY WRITE-BACK — find the project item, set Finance Stat + Price Est.
    // Calls go through GM_xmlhttpRequest (api.monday.com blocks page-origin CORS).
    // =======================================================================
    function mondayApi(query, variables) {
        return new Promise((resolve, reject) => {
            const tok = mondayToken();
            if (!tok) { reject(new Error('No Monday token set')); return; }
            GM_xmlhttpRequest({
                method: 'POST', url: 'https://api.monday.com/v2',
                headers: { 'Content-Type': 'application/json', 'Authorization': tok, 'API-Version': '2024-01' },
                data: JSON.stringify({ query, variables: variables || {} }),
                timeout: 20000,
                onload: (resp) => {
                    let j = null; try { j = JSON.parse(resp.responseText); } catch (e) { reject(new Error('Monday parse error (HTTP ' + resp.status + ')')); return; }
                    if (j.errors && j.errors.length) { reject(new Error(j.errors.map(e => e.message).join('; '))); return; }
                    resolve(j.data);
                },
                onerror: () => reject(new Error('Monday network error')),
                ontimeout: () => reject(new Error('Monday timeout')),
            });
        });
    }
    // Look up the board item by exact PO, then fall back to exact Job Ref.
    async function mondayFindItem(po, jobRef) {
        async function byColumn(colId, value) {
            if (!value) return [];
            const q = `query { items_page_by_column_values(limit: 10, board_id: ${MONDAY_BOARD}, columns: [{column_id: "${colId}", column_values: ${JSON.stringify([String(value)])}}]) { items { id name column_values(ids: ["${MB_PMSTAT}"]) { text } } } }`;
            const d = await mondayApi(q, {});
            return ((d.items_page_by_column_values || {}).items) || [];
        }
        let items = await byColumn(MB_PO, po);
        let by = 'PO';
        if (!items.length) { items = await byColumn(MB_JOBREF, jobRef); by = 'JobRef'; }
        if (!items.length) return null;
        const pmStat = (((items[0].column_values || [])[0] || {}).text || '').trim();
        return { id: items[0].id, name: items[0].name, pmStat, by, ambiguous: items.length > 1, count: items.length };
    }
    async function mondaySetInvoiced(itemId, netAmount, poNumber) {
        const cv = {}; cv[MB_FINANCE] = { label: 'Invoiced' };
        if (netAmount != null && !isNaN(netAmount)) cv[MB_PRICE] = String(netAmount);
        if (poNumber) cv[MB_PO] = String(poNumber);
        const q = `mutation { change_multiple_column_values(board_id: ${MONDAY_BOARD}, item_id: ${itemId}, column_values: ${JSON.stringify(JSON.stringify(cv))}) { id } }`;
        return mondayApi(q, {});
    }

    // Push one finished job to Monday. Never throws — logs and records status on the job.
    async function pushJobToMonday(i) {
        let s = loadState(); if (!s) return;
        const job = s.jobs[i]; if (!job) return;
        if (!s.pushMonday) { job.mondayStatus = 'off'; }
        else if (String(job.mondayStatus).indexOf('done') === 0) { /* already pushed — resume-safe */ return; }
        else if (job.prepStatus !== 'approved' && job.prepStatus !== 'already-invoiced') { job.mondayStatus = 'skipped (not approved)'; }
        else {
            try {
                const po = formatPO(job.po);
                const hit = await mondayFindItem(po, job.jobNumber);
                if (!hit) throw new Error(`no Monday item for ${po} / ${job.jobNumber}`);
                if (!hit.ambiguous) job.pmStat = hit.pmStat; // read by restoreJobStatus()
                if (hit.ambiguous) {
                    // Multiple board items match → don't guess. Skip and flag for manual handling.
                    job.mondayStatus = `skipped (⚠ ${hit.count} ${hit.by} matches — update manually)`;
                    log(`    ⚠ Monday: ${hit.count} items match ${hit.by} "${hit.by === 'PO' ? po : job.jobNumber}" — SKIPPED, update manually`, '#fd0');
                } else {
                    // Make sure we have the net + the invoice's Customer Order Number.
                    let net = (job.net != null) ? job.net : null;
                    let orderNo = job.orderNumber || '';
                    if (net == null || !orderNo) {
                        try { const info = await fetchInvoiceInfo(job.jobId, job.invoiceId); if (net == null) { net = info.net; job.net = net; } if (!orderNo) { orderNo = info.orderNumber; job.orderNumber = orderNo; } } catch (e) {}
                    }
                    // Write the Customer Order Number verbatim (whatever it contains); fall back to the pasted PO only if it's blank.
                    const poForMonday = String(orderNo || '').trim() || String(job.po || '').trim();
                    await mondaySetInvoiced(hit.id, net, poForMonday);
                    job.mondayItemId = hit.id;
                    job.mondayStatus = `done (by ${hit.by})`;
                    log(`    Monday: "${hit.name}" → Invoiced${net != null ? `, Price Est. £${net}` : ' (net not found)'}${poForMonday ? `, PO "${poForMonday}"` : ''}`, '#0fa');
                }
            } catch (e) {
                job.mondayStatus = 'error';
                job.mondayError = e.message;
                log(`    ✗ Monday: ${e.message}`, '#f55');
            }
        }
        const cur = loadState(); if (cur) { cur.jobs[i] = job; saveState(cur); renderResults(cur); }
    }

    // =======================================================================
    // PREP PHASE — create + set order number + approve, all via API (no nav)
    // =======================================================================
    function parseRows(text) {
        const rows = [];
        text.split(/\r?\n/).forEach(line => {
            const t = line.trim();
            if (!t) return;
            // Split Job | PO on TAB / pipe / 2+ spaces only — NOT on single commas, because a
            // job cell can hold several comma-separated job numbers ("PROJ0002205, PROJ0002049").
            // (Splitting on comma used to read the 2nd job number as the PO.)
            const parts = t.split(/\t|\s*\|\s*|\s{2,}/).map(x => x.trim()).filter(Boolean);
            // A cell can hold several comma-separated job numbers. Keep them ALL, in order:
            // prepOne() invoices the first one that actually has something to invoice, and
            // falls through to the next when a job is already invoiced or has no costs.
            // Skip header/label/blank rows — every real Joblogic job number contains a
            // digit, so "Job Number", "PO Number", etc. are dropped automatically.
            // (Without this, "Job Number" fuzzy-matches a random job via SearchJsonData.)
            const jobNumbers = (parts[0] || '').split(',').map(x => x.trim()).filter(x => /\d/.test(x));
            if (!jobNumbers.length) return;
            const jobNumber = jobNumbers[0];
            if (parts.length < 2) { rows.push({ jobNumber, jobNumbers, po: '', bad: true }); return; }
            rows.push({ jobNumber, jobNumbers, po: parts[1] });
        });
        return rows;
    }

    // A create/approve failure that means "there is nothing left to invoice on THIS job"
    // (already invoiced, or no costs). Deliberately narrow: it must NOT match incidental
    // "... not found" plumbing errors, because a match here authorises deleting the draft.
    const NOTHING_TO_INVOICE = /no lines|nothing to invoice|no cost|no uninvoiced|nothing to approve/i;
    // A bad/unknown job number also falls through to the next one on the row, but never
    // reaches the create step, so it can't put a draft at risk.
    const JOB_NOT_FOUND = /^Job not found/i;
    const canTryNextJob = (msg) => NOTHING_TO_INVOICE.test(msg) || JOB_NOT_FOUND.test(msg);

    // Create + set order number + approve a single job (all headless). Resume-safe:
    // won't re-create or re-approve if that was already done for this job.
    // Returns 'approved' | 'already-invoiced' | 'error' | 'stopped'.
    async function prepOne(i) {
        let s = loadState();
        if (!s || !s.running) return 'stopped';
        const job = s.jobs[i];
        const cands = (job.jobNumbers && job.jobNumbers.length) ? job.jobNumbers.slice() : [job.jobNumber];
        setProgress(`Job ${i + 1}/${s.jobs.length}: ${cands.join(', ')} — creating & approving`);
        try {
            if (job.bad) throw new Error('Row needs Job number AND PO');
            // Walk the row's job numbers in order until one actually produces an APPROVED
            // invoice. A job with nothing left to invoice doesn't fail at create — Joblogic
            // hands back an empty £0 draft and only refuses at approve — so the whole
            // create → order-number → approve sequence lives inside the loop, and we bin
            // the empty draft before moving on to the next job number.
            if (job.prepStatus !== 'approved') {
                if (cands.length > 1) log(`[${i + 1}] ${cands.length} job numbers on this row — will use the first one with something to invoice: ${cands.join(', ')}`, '#0af');
                // Resume: if we already resolved one of these, carry on from that one.
                let startAt = job.jobId ? Math.max(0, cands.findIndex(c => String(c).toLowerCase() === String(job.jobNumber).toLowerCase())) : 0;
                for (let c = startAt; c < cands.length; c++) {
                    const cand = cands[c];
                    const isLast = c === cands.length - 1;
                    try {
                        if (!(c === startAt && job.jobId)) {
                            const info = await resolveJob(cand);
                            job.jobId = info.jobId;
                            job.jobNumber = info.jobNumber;
                            job.siteName = info.siteName;
                        }
                        job.siteId = siteIdFrom(job.siteName);
                        job.reference = buildReference(job.po, job.siteId);
                        log(`[${i + 1}] ${job.jobNumber} → site "${job.siteName}" (${job.siteId}) | ${job.reference}`, '#0af');
                        await sleep(DELAY);
                        if (!job.invoiceId) {
                            job.invoiceId = await createInvoice(job.jobId);
                            log(`    created invoice #${job.invoiceId}`, '#8fd');
                            await sleep(DELAY);
                        }
                        // Catch the empty draft BEFORE writing to it / approving it, so we
                        // don't depend solely on the wording of the approve error.
                        const net0 = await draftNet(job.jobId, job.invoiceId);
                        if (net0 === 0) throw new Error('no lines to invoice (draft came back £0)');
                        await setOrderNumber(job.invoiceId, job.reference);
                        log(`    order number set`, '#8fd');
                        await sleep(DELAY);
                        // Snapshot the job's status BEFORE approving — approving flips it to
                        // "Invoiced", and restoreJobStatus() puts this back afterwards unless
                        // Monday's PM Stat. says the project is Complete.
                        try {
                            const st = (await fetchJobState(job.jobId)).job;
                            job.statusBefore = (st.StatusId == null ? '' : String(st.StatusId));
                            job.statusBeforeName = await statusLabel(job.statusBefore);
                            log(`    status before invoicing: "${job.statusBeforeName}"`, '#8fd');
                        } catch (x) { log(`    ⚠ could not read current job status (${x.message}) — status won't be put back`, '#fd0'); }
                        await approveInvoice(job.invoiceId);
                        break;
                    } catch (e) {
                        if (!canTryNextJob(e.message)) throw e;
                        // Nothing to invoice on this job number. Bin the empty draft (if one
                        // got created) so it can't be approved or emailed later by mistake.
                        // Re-check the total first and NEVER delete an invoice that has value —
                        // if it isn't provably empty, leave it and flag it for a manual look.
                        if (job.invoiceId) {
                            let n = null;
                            try { n = await draftNet(job.jobId, job.invoiceId); } catch (x) {}
                            if (n === 0 || n === null) {
                                try { await deleteDraftInvoice(job.invoiceId); log(`    deleted empty draft #${job.invoiceId}`, '#fd0'); }
                                catch (x) { log(`    ⚠ could not delete empty draft #${job.invoiceId}: ${x.message} — delete it manually`, '#f80'); (job.strayDrafts = job.strayDrafts || []).push(job.invoiceId); }
                            } else {
                                log(`    ⚠ draft #${job.invoiceId} is £${n}, NOT empty — left in place, check it manually`, '#f80');
                                (job.strayDrafts = job.strayDrafts || []).push(job.invoiceId);
                            }
                            job.invoiceId = null;
                        }
                        (job.skipped = job.skipped || []).push(`${cand}: ${e.message}`);
                        if (isLast) throw new Error('no lines to invoice on any job number on this row (' + cands.join(', ') + ')');
                        log(`    ⓘ ${cand}: ${e.message} — trying next job number "${cands[c + 1]}"`, '#fd0');
                        job.jobId = null;
                        await sleep(DELAY);
                    }
                }
            }
            job.invoiceNumber = await fetchInvoiceNumber(job.invoiceId); // number is assigned on approve
            job.prepStatus = 'approved';
            job.emailStatus = 'pending';
            log(`    ✓ approved${job.invoiceNumber ? ` — invoice ${job.invoiceNumber}` : ''}`, '#0fa');
            try { const info = await fetchInvoiceInfo(job.jobId, job.invoiceId); job.net = info.net; job.orderNumber = info.orderNumber; if (job.net != null) log(`    net (ex VAT) £${job.net}`, '#8fd'); }
            catch (e) { log(`    (net/order-number lookup failed: ${e.message})`, '#fd0'); }
        } catch (e) {
            if (/no lines/i.test(e.message)) {
                // Nothing left to invoice on ANY job number on the row = it was all invoiced
                // earlier. Skip the email (nothing to send) but still flip Monday, pulling the
                // net from the real prior invoice. Report against the row's FIRST job number,
                // which is the primary one on the sheet.
                if (String(job.jobNumber).toLowerCase() !== String(cands[0]).toLowerCase()) {
                    log(`    ⓘ nothing to invoice on any of ${cands.join(', ')} — reporting against ${cands[0]}`, '#fd0');
                    try { const first = await resolveJob(cands[0]); job.jobId = first.jobId; job.jobNumber = first.jobNumber; job.siteName = first.siteName; job.siteId = siteIdFrom(job.siteName); job.reference = buildReference(job.po, job.siteId); } catch (x) {}
                }
                job.prepStatus = 'already-invoiced';
                job.emailStatus = 'skipped';
                try { const info = await fetchInvoiceInfo(job.jobId, job.invoiceId); job.net = info.net; job.orderNumber = info.orderNumber; } catch (x) {}
                log(`    ⓘ already invoiced (no new lines) — skipping email, still updating Monday${job.net != null ? ` (net £${job.net})` : ''}`, '#fd0');
            } else {
                job.prepStatus = 'error';
                job.error = e.message;
                log(`    ✗ ${job.jobNumber}: ${e.message}`, '#f55');
            }
        }
        // Persist onto the LATEST state (preserves the running flag if Stop was pressed
        // mid-job) so a Stop can't be clobbered back to true.
        const latest = loadState();
        if (!latest) return 'stopped';
        latest.jobs[i] = job;
        saveState(latest);
        renderResults(latest);
        if (!latest.running) return 'stopped';
        return job.prepStatus;
    }

    // =======================================================================
    // EMAIL PHASE — drive the real Share→Email modal on each invoice page
    // =======================================================================
    function waitFor(fn, timeout = 12000, interval = 200) {
        return new Promise((resolve, reject) => {
            const t0 = Date.now();
            (function poll() {
                let v; try { v = fn(); } catch (e) { v = null; }
                if (v) return resolve(v);
                if (Date.now() - t0 > timeout) return reject(new Error('timeout waiting for element'));
                setTimeout(poll, interval);
            })();
        });
    }

    function nativeSet(el, value) {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Open the invoice email composer. Returns when the modal + recipient box exist.
    async function openEmailModal(invoiceId) {
        // Prefer the page's own handler; fall back to clicking the menu item.
        // (Sandbox: JL's handler is on the page window, i.e. pageWin/unsafeWindow.)
        if (typeof pageWin.onClickShareEmail === 'function') {
            pageWin.onClickShareEmail('/Invoice/Email/' + invoiceId);
        } else {
            const btn = document.getElementById('emailButton') ||
                [...document.querySelectorAll('a,button')].find(b => /^\s*Email\s*$/.test((b.innerText || '').trim()));
            if (!btn) throw new Error('Email button not found');
            btn.click();
        }
        return waitFor(() => {
            const modal = document.getElementById('emailInvoice_modal');
            if (!modal) return null;
            const box = modal.querySelector('#EmailAddressDropdown') || modal.querySelector('.email-dropdownlist');
            const send = document.getElementById('sendEmailButton');
            return (box && send) ? { modal, box, send } : null;
        });
    }

    // Replace the recipient tokens in the vue-select with our fixed list.
    // The recipient box is a Vue-2 vue-select (taggable, multiple) whose value is a
    // plain array of email strings; the page keeps #EmailAddress + #validEmailAddress
    // in sync off that array. Driving the component's own updateValue() is far more
    // reliable than simulating typing (which loses items to Vue's async reactivity).
    // The composer loads its DEFAULT recipient asynchronously after the modal opens,
    // and that late load clobbers whatever we set — so we (a) wait for the default to
    // arrive first, then (b) apply our list and re-apply if it gets reset again.
    // Re-query the live recipient box every time — the modal (jlSwitchModalContent)
    // swaps its content after opening, so a box captured early becomes a detached
    // node whose __vue__ is an orphaned component (updateValue on it does nothing).
    // Target the RECIPIENT box specifically. The modal has two vue-selects — the
    // Email Template dropdown comes first in the DOM, so a combined selector would
    // grab that by mistake. The recipient box is #EmailAddressDropdown/.email-dropdownlist.
    function liveBox() {
        const modal = document.getElementById('emailInvoice_modal') || document;
        return modal.querySelector('#EmailAddressDropdown') || modal.querySelector('.email-dropdownlist');
    }
    async function setRecipients(emails) {
        const tokensNow = () => { const b = liveBox(); return b ? [...b.querySelectorAll('.vs__selected')].map(t => t.innerText.replace(/\s*×\s*$/, '').trim()).filter(Boolean) : []; };
        const allSet = () => { const p = tokensNow().map(x => x.toLowerCase()); return p.length === emails.length && emails.every(e => p.includes(e.toLowerCase())); };

        // 1. Wait for the composer to finish loading its default recipient(s).
        for (let i = 0; i < 24 && tokensNow().length === 0; i++) await sleep(150); // up to ~3.6s
        await sleep(700); // let any late re-init settle

        // 2. Apply our list; retry (re-querying the live box each time) because a late
        //    re-init can overwrite it or replace the whole component.
        for (let attempt = 0; attempt < 8; attempt++) {
            const box = liveBox();
            const comp = box && box.__vue__; // main-world component; DOM-typing fallback below if unreachable
            if (comp && typeof comp.updateValue === 'function') {
                comp.updateValue(emails.slice());
            } else if (box) {
                // Fallback: type each email into the search box + Enter, one at a time.
                const search = box.querySelector('input.vs__search, input[type="search"], input');
                box.querySelectorAll('.vs__deselect').forEach(x => x.click());
                await sleep(150);
                for (const email of emails) {
                    if (!search) break;
                    search.focus();
                    nativeSet(search, email);
                    await sleep(150);
                    ['keydown', 'keypress', 'keyup'].forEach(type =>
                        search.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })));
                    await sleep(200);
                }
                const hidden = document.getElementById('EmailAddress');
                if (hidden) nativeSet(hidden, emails.join(','));
                const valid = document.getElementById('validEmailAddress');
                if (valid) nativeSet(valid, 'true');
            }
            await sleep(600);
            if (allSet()) break;
        }
        return tokensNow();
    }

    // Compose (and, if auto-send, send) the email for one job. Assumes we are on that
    // invoice's detail page.
    async function emailOne(i) {
        const job = loadState().jobs[i];
        // We're on the invoice page now — the title is the authoritative invoice number.
        if (!job.invoiceNumber) {
            const num = invoiceNumberFromTitle(document.title);
            if (num) { const cur = loadState(); cur.jobs[i].invoiceNumber = num; saveState(cur); renderResults(cur); job.invoiceNumber = num; }
        }
        try {
            log(`Email ${i + 1}: ${job.jobNumber} (invoice ${job.invoiceNumber || '#' + job.invoiceId})`, '#0af');
            await openEmailModal(job.invoiceId);
            const tokens = await setRecipients(RECIPIENTS);
            const missing = RECIPIENTS.filter(r => !tokens.some(t => t.toLowerCase() === r.toLowerCase()));
            if (missing.length) log(`    ⚠ recipients not auto-added: ${missing.join(', ')} — add them before sending`, '#fd0');
            else log(`    recipients set: ${tokens.length}`, '#8fd');

            const s = loadState();
            if (s.autoSend && !missing.length) {
                const send = document.getElementById('sendEmailButton'); // re-query live
                if (send) send.click();
                await waitFor(() => !document.getElementById('emailInvoice_modal') || document.getElementById('emailInvoice_modal').offsetParent === null, 15000).catch(() => {});
                const cur = loadState(); cur.jobs[i].emailStatus = 'sent'; cur.jobs[i].sentAt = nowStamp();
                saveState(cur); renderResults(cur);
                log(`    ✓ sent`, '#0fa');
                await advanceJob(); // → Monday push, then prep + navigate to the next job
            } else {
                const cur = loadState(); cur.jobs[i].emailStatus = 'composed';
                saveState(cur); renderResults(cur);
                setProgress(`Review invoice #${job.invoiceId}, click Send, then press "Sent → Next ▶".`);
                showNextButton(true);
            }
        } catch (e) {
            const cur = loadState(); cur.jobs[i].emailStatus = 'error';
            cur.jobs[i].error = (cur.jobs[i].error ? cur.jobs[i].error + ' | ' : '') + 'Email: ' + e.message;
            saveState(cur); renderResults(cur);
            log(`    ✗ email: ${e.message}`, '#f55');
            setProgress(`Email failed for #${job.invoiceId}. Send manually if needed, then press "Sent → Next ▶".`);
            showNextButton(true);
        }
    }

    // The one sequential driver: for the current job, prep it (headless), then navigate
    // to its invoice and email it, then advance. Re-entered on every page load via boot().
    async function drive() {
        while (true) {
            let s = loadState();
            if (!s || !s.running) return;
            if (s.idx >= s.jobs.length) { finishRun(s); return; }
            let job = s.jobs[s.idx];

            // 1. Ensure this job is created + approved (headless, runs on any JL page).
            if (job.prepStatus !== 'approved' && job.prepStatus !== 'error' && job.prepStatus !== 'already-invoiced') {
                const st = await prepOne(s.idx);
                if (st === 'stopped') { setProgress(`Stopped at job ${loadState().idx + 1}.`); return; }
                s = loadState();
                if (!s || !s.running) return;
                job = s.jobs[s.idx];
            }

            // 2. If we can't/shouldn't email this job, move to the next one.
            if (job.prepStatus === 'error' || job.prepStatus === 'already-invoiced' || s.skipEmail || job.emailStatus === 'sent') {
                // Already-invoiced jobs, and skip-email mode, still update Monday (guarded).
                if (job.prepStatus === 'already-invoiced' || (s.skipEmail && job.prepStatus === 'approved')) { await pushJobToMonday(s.idx); await restoreJobStatus(s.idx); }
                const cur = loadState(); cur.idx += 1; saveState(cur);
                continue;
            }

            // 2b. Already composed and waiting for you (dry-run) — go fully hands-off.
            // Don't re-open/re-fill on reloads or when you click around (e.g. previewing
            // the template PDF). You proceed only via the "Sent → Next ▶" button.
            if (!s.autoSend && job.emailStatus === 'composed') {
                setProgress(`Waiting: review invoice ${job.invoiceNumber || '#' + job.invoiceId}, Send it, then press "Sent → Next ▶". (Use "Re-fill emails" if the recipients got cleared.)`);
                showNextButton(true);
                return;
            }

            // 3. Emailing needs the invoice detail page. Navigate there if not already.
            const m = location.pathname.match(/\/Invoice\/Detail\/(\d+)/);
            if (!m || m[1] !== String(job.invoiceId)) {
                setProgress(`Job ${s.idx + 1}/${s.jobs.length}: opening invoice #${job.invoiceId} to email`);
                location.href = '/Invoice/Detail/' + job.invoiceId; // resumes via boot()→drive()
                return;
            }

            // 4. On the right page — compose/send. emailOne decides what happens next.
            await emailOne(s.idx);
            return;
        }
    }

    // Advance to the next job after a send (auto, or manual "Sent → Next").
    async function advanceJob() {
        let s = loadState();
        if (!s) return;
        const j = s.jobs[s.idx];
        if (j && j.emailStatus === 'composed') { j.emailStatus = 'sent'; j.sentAt = nowStamp(); }
        saveState(s);
        renderResults(s);
        await pushJobToMonday(s.idx);   // Monday write-back for the job just finished (guarded/idempotent)
        await restoreJobStatus(s.idx);  // put the job's pre-invoice status back (unless PM Stat. = Complete)
        s = loadState(); if (!s) return;
        s.idx += 1;
        saveState(s);
        renderResults(s);
        showNextButton(false);
        drive();
    }

    function finishRun(s) {
        s.running = false;
        saveState(s);
        renderResults(s);
        showNextButton(false);
        const sent = s.jobs.filter(j => j.emailStatus === 'sent').length;
        const appr = s.jobs.filter(j => j.prepStatus === 'approved').length;
        const already = s.jobs.filter(j => j.prepStatus === 'already-invoiced').length;
        const errs = s.jobs.filter(j => j.prepStatus === 'error' || j.emailStatus === 'error').length;
        setProgress(`Done. ${appr} approved, ${sent} emailed${already ? `, ${already} already-invoiced (Monday only)` : ''}, ${errs} error(s). Copy the results into Google Sheets.`);
        log('===== FINISHED =====', '#0af');
        setRunningUI(false);

        // Collect anything that needs a human, and make it unmissable at the end of the run.
        const flags = [];
        s.jobs.forEach(j => {
            if (j.prepStatus === 'error') flags.push(`• ${j.jobNumber} (${formatPO(j.po)}) — invoice error: ${j.error || 'unknown'}`);
            else if (j.emailStatus === 'error') flags.push(`• ${j.jobNumber} (${formatPO(j.po)}) — email error: ${j.error || 'unknown'}`);
            const m = j.mondayStatus || '';
            if (m.indexOf('skipped') === 0) flags.push(`• ${j.jobNumber} (${formatPO(j.po)}) — Monday NOT updated: ${m}`);
            else if (m === 'error') flags.push(`• ${j.jobNumber} (${formatPO(j.po)}) — Monday error: ${j.mondayError || 'unknown'}`);
            if ((j.strayDrafts || []).length) flags.push(`• ${j.jobNumber} (${formatPO(j.po)}) — DELETE MANUALLY: empty £0 draft invoice(s) #${j.strayDrafts.join(', #')}`);
            const sr = j.statusRestore || '';
            if (sr === 'error') flags.push(`• ${j.jobNumber} (${formatPO(j.po)}) — job status NOT put back (still "Invoiced"): ${j.statusError || 'unknown'}`);
            else if (sr.indexOf('skipped') === 0) flags.push(`• ${j.jobNumber} (${formatPO(j.po)}) — job status left as "Invoiced": ${sr}`);
        });
        if (flags.length) {
            log(`⚠ ${flags.length} item(s) need attention — see popup / Results.`, '#fd0');
            const shown = flags.slice(0, 40).join('\n');
            const more = flags.length > 40 ? `\n\n…and ${flags.length - 40} more — see the Results table.` : '';
            alert(`⚠ Run finished — ${flags.length} item(s) need manual attention:\n\n${shown}${more}`);
        } else {
            alert(`✓ Run finished cleanly — ${sent} emailed, ${appr} approved${already ? `, ${already} already-invoiced` : ''}. No items need attention.`);
        }
    }

    // =======================================================================
    // Start
    // =======================================================================
    function start() {
        const existing = loadState();
        if (existing && existing.running) { alert('A run is already in progress. Use Stop or Reset first.'); return; }

        const wantMonday = mondayCheck.checked;
        if (wantMonday && !mondayToken()) log('⚠ "Update Monday" is on but no Monday token is saved — click "Set Monday token" first, or the Monday step will error.', '#fd0');

        // Offer to resume a stopped, unfinished run so we never re-create done invoices.
        if (existing && existing.jobs && existing.idx < existing.jobs.length &&
            existing.jobs.some(j => j.prepStatus === 'approved' || j.prepStatus === 'error')) {
            if (confirm(`Resume the previous run from job ${existing.idx + 1}/${existing.jobs.length}?\n\nOK = resume where you stopped.\nCancel = start a NEW run from the box above.`)) {
                const s = loadState(); s.running = true; s.pushMonday = wantMonday; saveState(s);
                setRunningUI(true);
                log(`Resuming from job ${s.idx + 1}/${s.jobs.length}...`, '#0af');
                drive();
                return;
            }
        }

        const rows = parseRows(inputArea.value);
        if (!rows.length) { alert('Paste at least one "JobNumber <tab> PO" row.'); return; }

        const s = {
            running: true,
            autoSend: autoSendCheck.checked,
            skipEmail: skipEmailCheck.checked,
            pushMonday: wantMonday,
            idx: 0,
            jobs: rows.map(r => ({
                jobNumber: r.jobNumber, jobNumbers: r.jobNumbers || [r.jobNumber], po: r.po, bad: !!r.bad,
                jobId: null, siteName: '', siteId: '', reference: '',
                invoiceId: null, invoiceNumber: '', net: null, orderNumber: '',
                prepStatus: 'pending', emailStatus: '', sentAt: '', error: '', skipped: null, strayDrafts: null,
                statusBefore: '', statusBeforeName: '', statusRestore: '', statusError: '', pmStat: null,
                mondayStatus: '', mondayItemId: '', mondayError: '',
            })),
        };
        saveState(s);
        clearLog();
        setRunningUI(true);
        log(`Processing ${s.jobs.length} job(s), one at a time: create → approve → email${wantMonday ? ' → Monday' : ''} → next.`, '#0af');
        if (wantMonday) log('Monday update ON — each invoiced job sets its board item to "Invoiced" + Price Est. (matched by PO, then Job Ref).', '#0af');
        log(s.autoSend ? 'AUTO-SEND is ON — emails will be sent without pausing.' : 'DRY-RUN — each email is composed and paused for your review.', s.autoSend ? '#f80' : '#ff0');
        if (s.skipEmail) log('SKIP EMAIL is ON — invoices will be created & approved only.', '#ff0');
        drive();
    }

    function stopRun() {
        const s = loadState();
        if (s) { s.running = false; saveState(s); }
        setRunningUI(false);
        showNextButton(false);
        setProgress(`Stopped${s ? ` at job ${s.idx + 1}/${s.jobs.length}` : ''}. Press Start to resume from here, or Reset to clear.`);
    }

    function resetRun() {
        if (!confirm('Clear the current run and all results?')) return;
        clearState();
        clearLog();
        if (resultsArea) resultsArea.value = '';
        setRunningUI(false);
        setProgress('Ready. Paste "JobNumber <tab> PO" rows and click Start.');
    }

    // =======================================================================
    // Output — TSV for Google Sheets
    // =======================================================================
    const TSV_HEADERS = ['Job Number', 'PO', 'Site', 'SITEID', 'Customer Order No', 'Invoice ID', 'Invoice No', 'Net (ex VAT)', 'Status', 'Sent At', 'Monday', 'PM Stat.', 'Job Status', 'Notes / Error'];
    function toTSV(s) {
        const lines = [TSV_HEADERS.join('\t')];
        s.jobs.forEach(j => {
            const status = j.prepStatus === 'error' ? 'ERROR (prep)'
                : j.prepStatus === 'already-invoiced' ? 'Already invoiced (Monday only)'
                : j.emailStatus === 'sent' ? 'Sent'
                : j.emailStatus === 'composed' ? 'Composed (not sent)'
                : j.emailStatus === 'error' ? 'ERROR (email)'
                : j.prepStatus === 'approved' ? 'Approved' : 'Pending';
            const monday = j.mondayStatus === 'error' ? ('ERROR: ' + (j.mondayError || '')) : (j.mondayStatus || '');
            // Note the job numbers we passed over (already invoiced / no costs) so the sheet
            // shows why the invoiced job isn't the first one in the cell.
            const note = [
                (j.skipped || []).length ? 'skipped ' + j.skipped.join('; ') : '',
                (j.strayDrafts || []).length ? 'DELETE empty draft(s) #' + j.strayDrafts.join(', #') : '',
                j.error || '',
            ].filter(Boolean).join(' | ');
            lines.push([
                j.jobNumber, formatPO(j.po), j.siteName, j.siteId, j.reference,
                j.invoiceId || '', j.invoiceNumber || '', (j.net != null ? j.net : ''), status, j.sentAt || '', monday,
                j.pmStat || '', j.statusRestore === 'error' ? ('ERROR: ' + (j.statusError || '')) : (j.statusRestore || ''), note,
            ].map(x => String(x == null ? '' : x).replace(/\t/g, ' ').replace(/\r?\n/g, ' ')).join('\t'));
        });
        return lines.join('\n');
    }
    function renderResults(s) {
        if (resultsArea) resultsArea.value = toTSV(s);
    }

    // =======================================================================
    // UI
    // =======================================================================
    function createUI() {
        if (document.getElementById('jl-projinv-panel')) return;

        panel = document.createElement('div');
        panel.id = 'jl-projinv-panel';
        const c = document.createElement('div');
        c.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;background:#1a1a2e;color:#eee;border-radius:8px;padding:16px;width:560px;max-height:90vh;display:flex;flex-direction:column;font-family:monospace;font-size:12px;box-shadow:0 4px 20px rgba(0,0,0,0.5);';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;';
        const title = document.createElement('strong');
        title.style.fontSize = '14px';
        title.textContent = 'Project Invoicer' + (VERSION ? ' v' + VERSION : '');
        const closeBtn = document.createElement('button');
        closeBtn.style.cssText = 'background:none;border:none;color:#eee;font-size:18px;cursor:pointer;';
        closeBtn.textContent = 'X';
        closeBtn.addEventListener('click', () => { panel.style.display = 'none'; });
        header.appendChild(title); header.appendChild(closeBtn);

        const help = document.createElement('div');
        help.style.cssText = 'color:#9fb;margin-bottom:8px;line-height:1.4;';
        help.innerHTML = 'Paste one row per job: <b>Job Number</b> then a <b>tab</b> then <b>PO number</b> (paste straight from the sheet). If a job cell has two numbers, the first is used. A header row is fine — it\'s skipped automatically.<br>Ref becomes <b>PROJ | PO-XXXX - SITEID</b> (SITEID = first 6 letters of the site, no spaces).';

        inputArea = document.createElement('textarea');
        inputArea.placeholder = 'PM0000579/001\tPO-01041292\nPM0000580/001\tPO-01041293';
        inputArea.style.cssText = 'width:100%;height:110px;box-sizing:border-box;background:#0a0a1a;color:#eee;border:1px solid #555;border-radius:4px;padding:8px;font-family:monospace;font-size:12px;margin-bottom:8px;';

        // Options row
        const opts = document.createElement('div');
        opts.style.cssText = 'display:flex;gap:16px;align-items:center;margin-bottom:8px;flex-wrap:wrap;';
        const mkCheck = (labelText, title) => {
            const l = document.createElement('label'); l.style.cssText = 'cursor:pointer;'; l.title = title || '';
            const cb = document.createElement('input'); cb.type = 'checkbox';
            l.appendChild(cb); l.appendChild(document.createTextNode(' ' + labelText));
            return { l, cb };
        };
        const a = mkCheck('Auto-send emails', 'When off (default), the script composes each email and stops so you can review and click Send yourself.');
        autoSendCheck = a.cb;
        const sk = mkCheck('Skip email (create + approve only)', 'Create and approve the invoices but do not open the email composer.');
        skipEmailCheck = sk.cb;
        const md = mkCheck('Update Monday', 'After each invoice, set the matching Monday item (board "Minor Projects - WW Active") Finance Stat → "Invoiced" and Price Est. (ex VAT) ← the invoice net total. Matches by PO Number, then Job Ref.');
        mondayCheck = md.cb; mondayCheck.checked = true;
        opts.appendChild(a.l); opts.appendChild(sk.l); opts.appendChild(md.l);
        // Token via a native prompt + Tampermonkey storage — no password field for a
        // password manager to autofill/overwrite.
        const mondayStat = document.createElement('span');
        mondayStat.style.cssText = 'font-size:11px;';
        const refreshMondayStat = () => {
            const has = !!mondayToken();
            mondayStat.textContent = has ? '🔑 token saved' : '🔑 no token';
            mondayStat.style.color = has ? '#7d7' : '#fd0';
        };
        const mondayBtn = mkBtn('Set Monday token', '#334');
        mondayBtn.style.padding = '4px 10px';
        mondayBtn.title = 'Paste your Monday API token into the popup. Stored in Tampermonkey, persists across sessions.';
        mondayBtn.addEventListener('click', () => {
            const has = !!mondayToken();
            const t = prompt('Paste your Monday API token' + (has ? '\n(blank = keep current, "clear" = remove):' : ':'), '');
            if (t === null) return;                              // cancelled
            const v = t.trim();
            if (v === '') return;                                // keep existing
            if (v.toLowerCase() === 'clear') { GM_deleteValue(MONDAY_TOKEN_KEY); log('Monday token cleared.', '#fd0'); refreshMondayStat(); return; }
            GM_setValue(MONDAY_TOKEN_KEY, v); log('Monday token saved.', '#0fa'); refreshMondayStat();
        });
        opts.appendChild(mondayBtn); opts.appendChild(mondayStat);
        refreshMondayStat();

        // Controls
        const ctl = document.createElement('div');
        ctl.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap;';
        startBtn = mkBtn('Start', '#0a8'); startBtn.addEventListener('click', start);
        stopBtn = mkBtn('Stop', '#a22'); stopBtn.style.display = 'none'; stopBtn.addEventListener('click', stopRun);
        nextBtn = mkBtn('Sent → Next ▶', '#c60'); nextBtn.style.display = 'none'; nextBtn.addEventListener('click', () => advanceJob());
        refillBtn = mkBtn('Re-fill emails', '#0b6e99'); refillBtn.style.display = 'none';
        refillBtn.title = 'Re-add the standard recipients if a template change cleared them.';
        refillBtn.addEventListener('click', async () => {
            const t = await setRecipients(RECIPIENTS);
            const miss = RECIPIENTS.filter(r => !t.some(x => x.toLowerCase() === r.toLowerCase()));
            log(miss.length ? `Re-fill: still missing ${miss.join(', ')}` : `Re-filled ${t.length} recipients.`, miss.length ? '#fd0' : '#8fd');
        });
        resetBtn = mkBtn('Reset', '#555'); resetBtn.addEventListener('click', resetRun);
        ctl.appendChild(startBtn); ctl.appendChild(stopBtn); ctl.appendChild(nextBtn); ctl.appendChild(refillBtn); ctl.appendChild(resetBtn);

        // Progress
        const pd = document.createElement('div');
        pd.style.cssText = 'margin-bottom:6px;';
        progressText = document.createElement('span');
        progressText.style.color = '#0fa';
        progressText.textContent = 'Ready. Paste "JobNumber <tab> PO" rows and click Start.';
        pd.appendChild(progressText);

        // Log
        logArea = document.createElement('div');
        logArea.style.cssText = 'flex:1;overflow-y:auto;background:#0a0a1a;padding:8px;border-radius:4px;max-height:34vh;min-height:80px;margin-bottom:8px;';

        // Results (TSV)
        const rHead = document.createElement('div');
        rHead.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;';
        const rLabel = document.createElement('span'); rLabel.textContent = 'Results (paste into Google Sheets):'; rLabel.style.color = '#aaa';
        copyBtn = mkBtn('Copy', '#08a');
        copyBtn.addEventListener('click', () => {
            resultsArea.select();
            navigator.clipboard.writeText(resultsArea.value).then(() => { copyBtn.textContent = 'Copied!'; setTimeout(() => copyBtn.textContent = 'Copy', 1200); }).catch(() => { document.execCommand('copy'); });
        });
        rHead.appendChild(rLabel); rHead.appendChild(copyBtn);
        resultsArea = document.createElement('textarea');
        resultsArea.readOnly = true;
        resultsArea.style.cssText = 'width:100%;height:90px;box-sizing:border-box;background:#0a0a1a;color:#9fd;border:1px solid #555;border-radius:4px;padding:8px;font-family:monospace;font-size:11px;';

        c.appendChild(header); c.appendChild(help); c.appendChild(inputArea);
        c.appendChild(opts); c.appendChild(ctl); c.appendChild(pd);
        c.appendChild(logArea); c.appendChild(rHead); c.appendChild(resultsArea);
        panel.appendChild(c);
        document.body.appendChild(panel);
        jlRegisterPanel(panel, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR, SCRIPT_DESC);

        // Restore prior run + log into the panel (survives the email-step navigation).
        restoreLog();
        const s = loadState();
        if (s) {
            renderResults(s);
            if (s.running) setRunningUI(true);
        }
    }

    function mkBtn(text, color) {
        const b = document.createElement('button');
        b.textContent = text;
        b.style.cssText = `background:${color};color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;`;
        return b;
    }
    function appendLogLine(msg, color) {
        if (!logArea) return;
        const line = document.createElement('div');
        line.style.color = color || '#ccc';
        line.style.whiteSpace = 'pre-wrap';
        line.style.wordBreak = 'break-word';
        line.textContent = msg;
        logArea.appendChild(line);
        logArea.scrollTop = logArea.scrollHeight;
    }
    function log(msg, color) {
        const lines = loadLog();
        lines.push({ m: msg, c: color || '#ccc' });
        saveLog(lines);
        appendLogLine(msg, color);
    }
    function restoreLog() {
        if (!logArea) return;
        logArea.innerHTML = '';
        loadLog().forEach(l => appendLogLine(l.m, l.c));
    }
    function clearLog() {
        try { localStorage.removeItem(LOG_KEY); } catch (e) {}
        if (logArea) logArea.innerHTML = '';
    }
    const setProgress = (m) => { if (progressText) progressText.textContent = m; };
    function setRunningUI(running) {
        if (!startBtn) return;
        startBtn.style.display = running ? 'none' : 'inline-block';
        stopBtn.style.display = running ? 'inline-block' : 'none';
    }
    function showNextButton(show) {
        if (nextBtn) nextBtn.style.display = show ? 'inline-block' : 'none';
        if (refillBtn) refillBtn.style.display = show ? 'inline-block' : 'none';
    }

    // --- BOOT ---
    function boot() {
        createUI();
        // Resume the run after a navigation (drive() figures out prep vs. email).
        const s = loadState();
        if (s && s.running) {
            // Auto-open the panel so the user sees progress.
            if (panel && panel.style.display === 'none') { const btn = document.getElementById('jl-launch-' + SCRIPT_ID); if (btn) btn.click(); }
            setTimeout(drive, 800);
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
