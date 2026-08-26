// ==UserScript==
// @name         Joblogic - Bulk Set Invoice Line Nominal Code
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  On the Invoice list page, walks every invoice in the CURRENT search (same tab / filters / search term, all pages) and sets the Nominal Code on their invoice lines to one you pick. Optionally only replaces lines currently on a given code. Scan for a preview, then Apply (with dry-run). Handles Standard and PPM invoices. Collapses into the shared JL dock.
// @match        https://go.joblogic.com/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Finance/joblogic-bulk-set-invoice-nominal-code.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Finance/joblogic-bulk-set-invoice-nominal-code.user.js
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
    // A small help banner prepended inside a panel the first time it opens.
    function jlHelpBanner(text) {
        const b = document.createElement('div');
        b.className = 'jl-help-banner';
        b.style.cssText = 'background:#0e3a4f;color:#e3edf2;font-family:"Open Sans",sans-serif;font-size:11px;line-height:1.45;padding:8px 10px;border-radius:4px;margin:0 0 8px 0;border-left:3px solid #ff7919;';
        b.textContent = text;
        return b;
    }
    // Collapse a panel to a dock button. panelEl = the OUTERMOST element of the
    // script's floating UI. desc = on-hover + in-panel summary text.
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

    const SCRIPT_ID = 'invoice-nominal';
    const SCRIPT_LABEL = '🏷️ Invoice Nominal Code';
    const SCRIPT_COLOR = '#6a3fa0';
    const SCRIPT_VERSION = 'v1.0';
    const SCRIPT_DESC = 'Bulk-changes the Nominal Code on the invoice LINES of every invoice in the current Invoice-list search — same tab, filters and search term you have applied, across all pages. Scan first for a preview, then Apply.';

    const SCAN_PAGE_SIZE = 100;   // rows per SearchInvoice call
    const DELAY_INVOICE = 250;    // ms between invoices
    const DELAY_LINE = 150;       // ms between line saves

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const NONE = '__NONE__';

    // --- STATE ---
    let panel, logArea, progressText, scanBtn, startBtn, stopBtn, dryCheck, targetSel, fromSel, scopeText;
    let running = false, stopFlag = false;
    let nominalCodes = [];        // [{Id, Code, Description}]
    let plan = null;              // { rows:[{row, lines:[], todo:[]}], lineCount }

    // =======================================================================
    // Capture the page's own SearchInvoice payload so a scan respects whatever
    // tab / filters / search term the user has applied to the list.
    // =======================================================================
    let lastSearchPayload = null;
    (function hookXHR() {
        const origOpen = XMLHttpRequest.prototype.open;
        const origSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (m, u) { this.__jlNomUrl = String(u || ''); return origOpen.apply(this, arguments); };
        XMLHttpRequest.prototype.send = function (body) {
            try {
                if (/\/api\/Invoice\/SearchInvoice/i.test(this.__jlNomUrl || '') && body instanceof FormData) {
                    const o = {};
                    for (const [k, v] of body.entries()) o[k] = String(v);
                    if (o.SelectedTab) lastSearchPayload = o;
                }
            } catch (e) { /* ignore */ }
            return origSend.apply(this, arguments);
        };
    })();

    function defaultSearchPayload() {
        let tab = 'APPROVED_INVOICES';
        try {
            const q = new URLSearchParams(location.search).get('selectedTab');
            if (q) tab = q;
        } catch (e) { /* ignore */ }
        return {
            ProjectId: '', IsProjectInvoicesPage: 'false', RequireSummary: 'false',
            searchTerm: '', JobId: '', PPMContractId: '', HireContractId: '',
            CustomerId: '', SiteId: '', PageSize: '50', PageIndex: '1', OrderBy: '0',
            startDate: '', endDate: '', paymentDueStartDate: '', paymentDueEndDate: '',
            SelectedTab: tab, TagIds: '', excludeTagIds: '', batchIds: '',
            InvoicePaymentStatusIds: '', EmailStatusIds: '',
            includeStandardInvoices: 'true', includePPMInvoices: 'true',
            includeSORInvoices: 'true', includeCGroupInvoices: 'true',
            includeRelatedJobInvoices: 'false', includeHireInvoices: 'false',
            includeProjectInvoices: 'true',
        };
    }

    // =======================================================================
    // Low-level helpers
    // =======================================================================
    function getToken() {
        const el = document.querySelector('input[name="__RequestVerificationToken"]');
        return el ? el.value : '';
    }

    async function fetchWithRetry(url, opts, tries = 4) {
        let lastErr = '';
        for (let i = 0; i < tries; i++) {
            try {
                const r = await fetch(url, Object.assign({ credentials: 'same-origin' }, opts));
                if (r.status === 403 || r.status === 429) { // WAF / rate limit
                    lastErr = 'HTTP ' + r.status + ' (rate limited)';
                    await sleep(1200 + i * 1200);
                    continue;
                }
                return r;
            } catch (e) {
                lastErr = e.message || String(e);
                await sleep(700 + i * 700);
            }
        }
        throw new Error(lastErr || 'request failed');
    }

    // Balanced-bracket JSON extractor.
    //  open='{' : the object starts AFTER `needle` (e.g. needle "var MInvoices = ")
    //  open='[' : `needle` is a key INSIDE an array element -> scan backwards for '['
    function extractEnclosing(html, needle, open) {
        const close = open === '{' ? '}' : ']';
        const at = html.indexOf(needle);
        if (at < 0) return null;
        const start = open === '{' ? html.indexOf(open, at) : html.lastIndexOf(open, at);
        if (start < 0) return null;
        let depth = 0, inStr = false, esc = false;
        for (let i = start; i < html.length; i++) {
            const ch = html[i];
            if (esc) { esc = false; continue; }
            if (ch === '\\') { esc = true; continue; }
            if (ch === '"') { inStr = !inStr; continue; }
            if (inStr) continue;
            if (ch === open) depth++;
            else if (ch === close) { depth--; if (depth === 0) { try { return JSON.parse(html.slice(start, i + 1)); } catch (e) { return null; } } }
        }
        return null;
    }

    // =======================================================================
    // Nominal codes
    // =======================================================================
    async function loadNominalCodes() {
        const r = await fetchWithRetry('/NominalCode/GetNominalCodes', { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        const list = await r.json();
        nominalCodes = Array.isArray(list) ? list : [];
        nominalCodes.sort((a, b) => String(a.Code).localeCompare(String(b.Code), undefined, { numeric: true }));
        return nominalCodes;
    }

    // =======================================================================
    // Invoice list
    // =======================================================================
    async function searchPage(pageIndex) {
        const payload = Object.assign({}, lastSearchPayload || defaultSearchPayload());
        payload.RequireSummary = 'false';
        payload.PageSize = String(SCAN_PAGE_SIZE);
        payload.PageIndex = String(pageIndex);
        const fd = new FormData();
        Object.entries(payload).forEach(([k, v]) => fd.append(k, v));
        const r = await fetchWithRetry('/api/Invoice/SearchInvoice', {
            method: 'POST', body: fd,
            headers: { 'X-Requested-With': 'XMLHttpRequest', '__RequestVerificationToken': getToken() },
        });
        if (!r.ok) throw new Error('SearchInvoice HTTP ' + r.status);
        const j = await r.json();
        if (j.success === false) throw new Error('SearchInvoice success=false: ' + (j.Message || ''));
        const ad = j.AdditionalData || {};
        return { rows: ad.Invoices || [], total: ad.TotalSelectedTabCount != null ? ad.TotalSelectedTabCount : (ad.Invoices || []).length };
    }

    async function collectInvoices() {
        const rows = [];
        let total = 0;
        for (let page = 1; page <= 200; page++) {
            if (stopFlag) break;
            const res = await searchPage(page);
            total = res.total;
            res.rows.forEach(x => rows.push(x));
            setProgress(`Listing invoices… ${rows.length}/${total}`);
            if (rows.length >= total || res.rows.length < SCAN_PAGE_SIZE) break;
            await sleep(150);
        }
        return { rows, total };
    }

    const tabLabel = () => (lastSearchPayload || defaultSearchPayload()).SelectedTab;
    const invLabel = (row) => `${row.Type === 1 ? 'PPM' : 'Std'} ${row.InvoiceNumber || 'Draft'} (id ${row.Id})${row.JobNumber ? ' job ' + row.JobNumber : ''}`;

    // =======================================================================
    // Lines — read
    // =======================================================================
    // -> [{ id, desc, nominal, isQuoted, isDiscount }]  (nominal = display string e.g. "102 - Reactive Income")
    async function getStandardLines(invoiceId) {
        const html = await (await fetchWithRetry('/Invoice/GetLines?invoiceId=' + invoiceId, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })).text();
        const model = extractEnclosing(html, 'var MInvoices = ', '{');
        if (!model) throw new Error('could not read the invoice lines model');
        return (model.Lines || []).map(l => ({
            id: l.Id, desc: l.Description || '', nominal: l.NominalCode || '',
            isQuoted: !!l.IsQuotedValue, isDiscount: !!l.IsDiscountLine,
        }));
    }

    async function getPpmLines(invoiceGuid) {
        const html = await (await fetchWithRetry('/PPMInvoice/Detail/' + invoiceGuid, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })).text();
        const arr = extractEnclosing(html, '"PriceValue"', '[');
        if (!Array.isArray(arr)) throw new Error('could not read the PPM invoice lines');
        return arr.map(l => ({
            id: l.Id, desc: l.Description || '', nominal: l.NominalCode || '',
            isQuoted: false, isDiscount: false,
        }));
    }

    const getLines = (row) => (row.Type === 1 ? getPpmLines(row.UniqueId) : getStandardLines(row.Id));

    // =======================================================================
    // Lines — write
    // =======================================================================
    // Standard invoice line: rebuild the edit modal's own form, override the
    // nominal code, POST it back the way the page's unobtrusive-ajax submit does.
    async function setStandardLineNominal(invoiceId, lineId, code) {
        const url = '/Invoice/UpdateLine?id=' + encodeURIComponent(lineId) + '&invoiceId=' + encodeURIComponent(invoiceId);
        const html = await (await fetchWithRetry(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })).text();
        const token = (html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/) || [])[1] || getToken();
        const model = extractEnclosing(html, 'var LineModel = ', '{');
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const form = doc.querySelector('#addUpdateInvoiceLineForm') || doc;

        const params = new URLSearchParams();
        const count = {};
        const push = (n, v) => { params.append(n, v == null ? '' : String(v)); count[n] = (count[n] || 0) + 1; };

        form.querySelectorAll('input[name], select[name], textarea[name]').forEach(el => {
            const n = el.name;
            if (n === '__RequestVerificationToken') return;
            if (el.tagName === 'SELECT') {
                count[n] = count[n] || 0;
                [...el.options].filter(o => o.selected).forEach(o => push(n, o.value));
                return;
            }
            if (el.type === 'checkbox' || el.type === 'radio') {
                count[n] = count[n] || 0;
                if (el.checked) push(n, el.value || 'true');
                return;
            }
            push(n, n === 'NominalCodeId' ? code.Id : (el.value || ''));
        });

        if (!count.NominalCodeId) push('NominalCodeId', code.Id);
        // Kendo combobox companions — a real submit posts the visible text too.
        push('NominalCodeId_input', code.Description);
        if (count.TaxCodeId && model) push('TaxCodeId_input', model.TaxCodeDescription || '');
        // Description is a Vue <ai-text-area>, so it is not in the raw HTML —
        // send the current value back so an editable line keeps its wording.
        // (The approved-invoice modal has no description field at all: skip it there.)
        if (model && !count.Description && model.IsInvoiceApproved !== true) push('Description', model.Description || '');
        if (model && !count.TagIds && Array.isArray(model.TagIds)) model.TagIds.forEach(t => push('TagIds', t));

        const r = await fetchWithRetry('/api/Invoice/SaveLine', {
            method: 'POST',
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                '__RequestVerificationToken': token,
            },
            body: params.toString(),
        });
        const txt = await r.text().catch(() => '');
        if (!r.ok) throw new Error('SaveLine HTTP ' + r.status + ': ' + txt.slice(0, 160));
        let j = null; try { j = JSON.parse(txt); } catch (e) { /* html response is fine */ }
        if (j && j.success === false) throw new Error('SaveLine success=false: ' + (j.Message || j.message || txt.slice(0, 140)));
    }

    // PPM invoice line: /api/PPMInvoice/EditLine wants multipart FormData.
    async function setPpmLineNominal(lineId, code) {
        const html = await (await fetchWithRetry('/PPMInvoice/EditLineModal?id=' + encodeURIComponent(lineId), { headers: { 'X-Requested-With': 'XMLHttpRequest' } })).text();
        const token = (html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/) || [])[1] || getToken();
        const M = extractEnclosing(html, 'Model:', '{');
        if (!M) throw new Error('could not read the PPM line model');

        const fd = new FormData();
        fd.append('Id', M.Id);
        fd.append('PPMContractId', M.PPMContractId == null ? '' : M.PPMContractId);
        fd.append('Description', M.Description == null ? '' : M.Description);
        fd.append('Value', M.Value == null ? '' : String(M.Value));
        fd.append('Discount_Amount', M.Discount_Amount == null ? '' : M.Discount_Amount);
        fd.append('Discount_Percentage', M.Discount_Percentage == null ? '' : M.Discount_Percentage);
        fd.append('TaxCodeId_input', M.TaxCodeDescription == null ? '' : M.TaxCodeDescription);
        fd.append('TaxCodeId', M.TaxCodeId == null ? '' : M.TaxCodeId);
        fd.append('NominalCodeId_input', code.Description);
        fd.append('NominalCodeId', code.Id);
        if (Array.isArray(M.TagIds)) M.TagIds.forEach(t => fd.append('TagIds', t));
        else if (M.TagIds != null && M.TagIds !== '') fd.append('TagIds', M.TagIds);
        fd.append('InvoiceId', M.InvoiceId);

        const r = await fetchWithRetry('/api/PPMInvoice/EditLine', {
            method: 'POST',
            headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, text/javascript, */*; q=0.01', '__RequestVerificationToken': token },
            body: fd,
        });
        const txt = await r.text().catch(() => '');
        if (!r.ok) throw new Error('EditLine HTTP ' + r.status + ': ' + txt.slice(0, 160));
        let j = null; try { j = JSON.parse(txt); } catch (e) { /* ignore */ }
        if (j && j.success === false) throw new Error('EditLine success=false: ' + (j.Message || j.message || txt.slice(0, 140)));
    }

    const setLineNominal = (row, line, code) =>
        (row.Type === 1 ? setPpmLineNominal(line.id, code) : setStandardLineNominal(row.Id, line.id, code));

    // =======================================================================
    // UI
    // =======================================================================
    function createUI() {
        if (document.getElementById('jl-nominal-panel')) return;

        panel = document.createElement('div');
        panel.id = 'jl-nominal-panel';
        const box = document.createElement('div');
        box.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;background:#1a1a2e;color:#eee;border-radius:8px;padding:16px;width:560px;max-height:88vh;display:flex;flex-direction:column;font-family:monospace;font-size:12px;box-shadow:0 4px 20px rgba(0,0,0,0.5);';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;';
        const title = document.createElement('strong');
        title.style.fontSize = '14px';
        title.textContent = '🏷️ Bulk Set Invoice Line Nominal Code ' + SCRIPT_VERSION;
        const closeBtn = document.createElement('button');
        closeBtn.style.cssText = 'background:none;border:none;color:#eee;font-size:18px;cursor:pointer;';
        closeBtn.textContent = 'X';
        closeBtn.addEventListener('click', () => { panel.style.display = 'none'; });
        header.appendChild(title); header.appendChild(closeBtn);

        const mkRow = (labelText, el) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;';
            const lab = document.createElement('label');
            lab.style.cssText = 'white-space:nowrap;color:#aaa;width:170px;';
            lab.textContent = labelText;
            row.appendChild(lab); row.appendChild(el);
            return row;
        };
        const selCss = 'flex:1;padding:6px 8px;border-radius:4px;border:1px solid #555;background:#0a0a1a;color:#eee;font-family:monospace;font-size:12px;';

        targetSel = document.createElement('select');
        targetSel.style.cssText = selCss;
        targetSel.innerHTML = '<option value="">— loading nominal codes… —</option>';

        fromSel = document.createElement('select');
        fromSel.style.cssText = selCss;
        fromSel.innerHTML = '<option value="">Any (every line)</option>';

        scopeText = document.createElement('div');
        scopeText.style.cssText = 'color:#7fd1ff;margin-bottom:8px;';

        const progressDiv = document.createElement('div');
        progressDiv.style.marginBottom = '10px';
        progressText = document.createElement('span');
        progressText.style.color = '#0fa';
        progressText.textContent = 'Filter the invoice list how you want it, then Scan.';
        progressDiv.appendChild(progressText);

        const controls = document.createElement('div');
        controls.style.marginBottom = '10px';

        scanBtn = document.createElement('button');
        scanBtn.style.cssText = 'background:#08a;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;margin-right:8px;';
        scanBtn.textContent = 'Scan';
        scanBtn.addEventListener('click', () => { if (!running) doScan(); });

        startBtn = document.createElement('button');
        startBtn.style.cssText = 'background:#0a8;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;margin-right:8px;';
        startBtn.textContent = 'Apply';
        startBtn.disabled = true;
        startBtn.addEventListener('click', () => { if (!running) doApply(); });

        stopBtn = document.createElement('button');
        stopBtn.style.cssText = 'background:#a22;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;display:none;';
        stopBtn.textContent = 'Stop';
        stopBtn.addEventListener('click', () => { stopFlag = true; log('Stopping after the current step…', '#fa0'); });

        const dryLabel = document.createElement('label');
        dryLabel.style.cssText = 'margin-left:8px;cursor:pointer;';
        dryCheck = document.createElement('input');
        dryCheck.type = 'checkbox';
        dryCheck.checked = true;
        dryLabel.appendChild(dryCheck);
        dryLabel.appendChild(document.createTextNode(' Dry run'));

        controls.appendChild(scanBtn); controls.appendChild(startBtn); controls.appendChild(stopBtn); controls.appendChild(dryLabel);

        logArea = document.createElement('div');
        logArea.style.cssText = 'flex:1;overflow-y:auto;background:#0a0a1a;padding:8px;border-radius:4px;max-height:52vh;';

        box.appendChild(header);
        box.appendChild(mkRow('New nominal code:', targetSel));
        box.appendChild(mkRow('Only lines currently:', fromSel));
        box.appendChild(scopeText);
        box.appendChild(progressDiv);
        box.appendChild(controls);
        box.appendChild(logArea);
        panel.appendChild(box);
        document.body.appendChild(panel);
        jlRegisterPanel(panel, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR, SCRIPT_DESC);

        updateScope();
        loadNominalCodes().then(fillCodeSelects).catch(e => {
            targetSel.innerHTML = '<option value="">— could not load nominal codes —</option>';
            log('Failed to load nominal codes: ' + e.message, '#f55');
        });
    }

    function fillCodeSelects() {
        targetSel.innerHTML = '<option value="">— choose a nominal code —</option>';
        fromSel.innerHTML = '<option value="">Any (every line)</option><option value="' + NONE + '">(no nominal code set)</option>';
        nominalCodes.forEach(c => {
            const a = document.createElement('option');
            a.value = c.Id; a.textContent = c.Description;
            targetSel.appendChild(a);
            const b = document.createElement('option');
            b.value = c.Id; b.textContent = c.Description;
            fromSel.appendChild(b);
        });
    }

    function updateScope() {
        const p = lastSearchPayload;
        scopeText.textContent = 'Scope: tab ' + tabLabel() + (p ? (p.searchTerm ? ' • search "' + p.searchTerm + '"' : '') + ' • live list filters' : ' • default filters (search the list once to pick up its filters)');
    }

    function log(msg, color) {
        const line = document.createElement('div');
        line.style.color = color || '#ccc';
        line.style.whiteSpace = 'pre-wrap';
        line.style.wordBreak = 'break-word';
        line.textContent = msg;
        logArea.appendChild(line);
        logArea.scrollTop = logArea.scrollHeight;
    }
    const setProgress = (m) => { progressText.textContent = m; };

    function busy(on) {
        running = on;
        scanBtn.disabled = on;
        startBtn.disabled = on || !plan || !plan.lineCount;
        stopBtn.style.display = on ? 'inline-block' : 'none';
    }

    // =======================================================================
    // Scan — build the change plan
    // =======================================================================
    function selectedTarget() {
        const id = targetSel.value;
        return nominalCodes.find(c => c.Id === id) || null;
    }

    function lineMatchesFilter(line) {
        const f = fromSel.value;
        if (!f) return true;
        if (f === NONE) return !line.nominal;
        const c = nominalCodes.find(x => x.Id === f);
        return !!c && line.nominal === c.Description;
    }

    async function doScan() {
        const target = selectedTarget();
        if (!target) { alert('Pick the new nominal code first.'); return; }

        logArea.innerHTML = '';
        plan = null;
        stopFlag = false;
        busy(true);
        updateScope();

        const stats = { invoices: 0, withLines: 0, todo: 0, already: 0, filtered: 0, quoted: 0, credits: 0, errors: 0 };
        try {
            log('Reading the invoice list (' + tabLabel() + ')…', '#0af');
            const { rows, total } = await collectInvoices();
            log(`${rows.length} invoice(s) in this search${total && total !== rows.length ? ' (list reports ' + total + ')' : ''}.`, '#0af');
            log('');

            const planned = [];
            for (let i = 0; i < rows.length; i++) {
                if (stopFlag) { log('Scan stopped by user.', '#fa0'); break; }
                const row = rows[i];
                stats.invoices++;
                setProgress(`Reading lines ${i + 1}/${rows.length}…`);

                if (row.IsCredit) { stats.credits++; continue; }
                if (row.Type !== 0 && row.Type !== 1) {
                    log(`  ${invLabel(row)} — unsupported invoice type "${row.TypeDescription}", skipped`, '#fa0');
                    continue;
                }
                if (!row.InvoiceLineExist) continue;

                let lines;
                try {
                    lines = await getLines(row);
                } catch (e) {
                    stats.errors++;
                    log(`  ${invLabel(row)} — ERROR reading lines: ${e.message}`, '#f55');
                    continue;
                }
                if (!lines.length) continue;
                stats.withLines++;

                const todo = [];
                lines.forEach(l => {
                    if (l.isQuoted) { stats.quoted++; return; }
                    if (l.nominal === target.Description) { stats.already++; return; }
                    if (!lineMatchesFilter(l)) { stats.filtered++; return; }
                    todo.push(l);
                });
                if (todo.length) {
                    planned.push({ row, todo });
                    stats.todo += todo.length;
                    log(`  ${invLabel(row)} — ${todo.length} line(s) to change:`, '#fff');
                    todo.forEach(l => log(`      · "${(l.desc || '').slice(0, 60)}"  [${l.nominal || 'none'}] → [${target.Description}]`, '#9fd'));
                }
                await sleep(80);
            }

            plan = { rows: planned, lineCount: stats.todo, target };
            log('');
            log('===== SCAN SUMMARY =====', '#0af');
            log(`Invoices in search:        ${stats.invoices}`);
            log(`Invoices with lines read:  ${stats.withLines}`);
            log(`Lines to change:           ${stats.todo}`, stats.todo ? '#0fa' : '#888');
            log(`Already on target code:    ${stats.already}`, '#888');
            if (stats.filtered) log(`Skipped by "only lines currently" filter: ${stats.filtered}`, '#888');
            if (stats.quoted) log(`Skipped quoted-value lines (not editable): ${stats.quoted}`, '#fa0');
            if (stats.credits) log(`Skipped credit notes: ${stats.credits}`, '#fa0');
            if (stats.errors) log(`Errors reading lines:      ${stats.errors}`, '#f55');
            setProgress(stats.todo ? `${stats.todo} line(s) across ${planned.length} invoice(s) ready. Apply when happy.` : 'Nothing to change.');
        } catch (e) {
            log('SCAN FAILED: ' + e.message, '#f55');
            setProgress('Scan failed.');
        } finally {
            busy(false);
        }
    }

    // =======================================================================
    // Apply
    // =======================================================================
    async function doApply() {
        if (!plan || !plan.lineCount) { alert('Scan first — there is nothing planned.'); return; }
        const target = selectedTarget();
        if (!target || target.Id !== plan.target.Id) { alert('The nominal code changed since the scan — scan again.'); return; }

        const dry = dryCheck.checked;
        if (!dry && !confirm(`Set the nominal code to "${target.Description}" on ${plan.lineCount} line(s) across ${plan.rows.length} invoice(s)?`)) return;

        logArea.innerHTML = '';
        stopFlag = false;
        busy(true);
        log(dry ? 'DRY RUN — nothing will be saved' : `LIVE — setting ${plan.lineCount} line(s) to "${target.Description}"`, dry ? '#ff0' : '#f55');
        log('');

        const stats = { changed: 0, verified: 0, unverified: 0, errors: 0 };
        const failed = [];

        for (let i = 0; i < plan.rows.length; i++) {
            if (stopFlag) { log('Stopped by user.', '#fa0'); break; }
            const { row, todo } = plan.rows[i];
            setProgress(`Invoice ${i + 1}/${plan.rows.length} — ${invLabel(row)}`);
            log(`--- [${i + 1}/${plan.rows.length}] ${invLabel(row)} — ${todo.length} line(s) ---`, '#fff');

            const done = [];
            for (const line of todo) {
                if (stopFlag) break;
                const tag = `"${(line.desc || '').slice(0, 50)}"`;
                if (dry) { log(`    [DRY] ${tag}  [${line.nominal || 'none'}] → [${target.Description}]`, '#ff0'); stats.changed++; continue; }
                try {
                    await setLineNominal(row, line, target);
                    done.push(line);
                    stats.changed++;
                    log(`    ✓ ${tag}  [${line.nominal || 'none'}] → [${target.Description}]`, '#0fa');
                } catch (e) {
                    stats.errors++;
                    failed.push(`${invLabel(row)} line ${line.id}: ${e.message}`);
                    log(`    ✗ ${tag} — ${e.message}`, '#f55');
                }
                await sleep(DELAY_LINE);
            }

            // Read the lines back so a silent no-op save cannot pass as success.
            if (!dry && done.length) {
                try {
                    const after = await getLines(row);
                    const byId = new Map(after.map(l => [String(l.id), l]));
                    let ok = 0;
                    done.forEach(l => { const a = byId.get(String(l.id)); if (a && a.nominal === target.Description) ok++; });
                    stats.verified += ok;
                    stats.unverified += (done.length - ok);
                    if (ok === done.length) log(`    verified ${ok}/${done.length}`, '#888');
                    else log(`    VERIFY FAILED — only ${ok}/${done.length} lines came back on "${target.Description}"`, '#f55');
                } catch (e) {
                    log(`    (could not verify: ${e.message})`, '#fa0');
                }
            }
            await sleep(DELAY_INVOICE);
        }

        log('');
        log('===== SUMMARY =====', '#0af');
        log(dry ? `Would change: ${stats.changed} line(s)` : `Saved:     ${stats.changed} line(s)`, '#0fa');
        if (!dry) {
            log(`Verified:  ${stats.verified}`, '#0fa');
            if (stats.unverified) log(`Unverified: ${stats.unverified}`, '#f55');
        }
        log(`Errors:    ${stats.errors}`, stats.errors ? '#f55' : '#888');
        if (failed.length) { log(''); log('Failed:', '#f55'); failed.forEach(f => log('  ' + f, '#f99')); }
        setProgress(dry ? 'Dry run finished — untick Dry run to apply.' : 'Done. Re-scan to confirm the list is clean.');

        if (!dry) plan = null;   // force a re-scan before another live run
        busy(false);
    }

    // --- BOOT ---
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', createUI);
    else createUI();
})();
