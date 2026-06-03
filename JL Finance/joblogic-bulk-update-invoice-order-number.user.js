// ==UserScript==
// @name         Joblogic - Bulk Update Invoice Customer Order Number
// @namespace    http://tampermonkey.net/
// @version      1.11
// @description  On any Invoice/PPMInvoice list page, enter a value and script updates CustomerOrderNumber on all visible invoices via API. Collapses to a launcher button in the shared dock (drag to reorder).
// @match        https://go.joblogic.com/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Finance/joblogic-bulk-update-invoice-order-number.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Finance/joblogic-bulk-update-invoice-order-number.user.js
// ==/UserScript==

(function () {
    'use strict';

    // ===== Shared JL userscript launcher dock (identical in every script) =====
    const JL_DOCK_ID = 'jl-userscript-dock', JL_ORDER_KEY = 'jl-userscript-dock-order', JL_MIN_KEY = 'jl-userscript-dock-min', JL_TOP_KEY = 'jl-userscript-dock-top';
    const jlDockList = () => document.getElementById('jl-userscript-dock-list');
    function jlReadOrder() { try { return JSON.parse(localStorage.getItem(JL_ORDER_KEY)) || []; } catch (e) { return []; } }
    function jlSaveOrder() { const l = jlDockList(); if (!l) return; localStorage.setItem(JL_ORDER_KEY, JSON.stringify([...l.children].map(b => b.dataset.scriptId).filter(Boolean))); }
    function jlApplyOrder() { const l = jlDockList(); if (!l) return; [...l.children].sort((a, b) => { const o = jlReadOrder(); let ia = o.indexOf(a.dataset.scriptId), ib = o.indexOf(b.dataset.scriptId); if (ia < 0) ia = 1e9; if (ib < 0) ib = 1e9; return ia - ib; }).forEach(b => l.appendChild(b)); }
    function jlAfter(l, y) { let c = { o: -Infinity, el: null }; for (const el of l.querySelectorAll('button:not(.jl-dragging)')) { const r = el.getBoundingClientRect(); const off = y - (r.top + r.height / 2); if (off < 0 && off > c.o) c = { o: off, el }; } return c.el; }
    function jlSetDockMin(min) { const l = jlDockList(), t = document.getElementById('jl-userscript-dock-toggle'); if (l) l.style.display = min ? 'none' : 'flex'; if (t) t.textContent = (min ? '▸' : '▾') + ' Advanced Controls'; try { localStorage.setItem(JL_MIN_KEY, min ? '1' : '0'); } catch (e) {} }
    function jlGetDock() {
        let d = document.getElementById(JL_DOCK_ID);
        if (!d) { d = document.createElement('div'); d.id = JL_DOCK_ID; document.body.appendChild(d); }
        d.style.cssText = 'position:fixed;top:80px;right:8px;z-index:100000;display:flex;flex-direction:column;gap:8px;align-items:flex-end;';
        const savedTop = localStorage.getItem(JL_TOP_KEY); if (savedTop !== null) d.style.top = savedTop + 'px';
        let t = document.getElementById('jl-userscript-dock-toggle');
        if (!t) {
            t = document.createElement('button');
            t.id = 'jl-userscript-dock-toggle';
            t.title = 'Drag to move up/down • click to expand/collapse';
            t.style.cssText = 'background:#11111a;color:#fff;border:1px solid #555;padding:6px 12px;border-radius:18px;cursor:grab;font-family:monospace;font-size:12px;box-shadow:0 2px 8px rgba(0,0,0,.4);white-space:nowrap;touch-action:none;';
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
        jlSetDockMin(localStorage.getItem(JL_MIN_KEY) !== '0');
        return d;
    }
    function jlDockButton(id, label, color, onClick) {
        jlGetDock();
        const l = jlDockList();
        let b = document.getElementById('jl-launch-' + id);
        if (b) return b;
        b = document.createElement('button');
        b.id = 'jl-launch-' + id;
        b.dataset.scriptId = id;
        b.textContent = label;
        b.title = 'Show / hide ' + label + '  (drag to reorder)';
        b.draggable = true;
        b.style.cssText = `background:${color};color:#fff;border:none;padding:8px 13px;border-radius:18px;cursor:grab;font-family:monospace;font-size:12px;box-shadow:0 2px 8px rgba(0,0,0,.4);white-space:nowrap;`;
        b.addEventListener('click', () => { if (b.dataset.justDragged) { delete b.dataset.justDragged; return; } onClick(); });
        b.addEventListener('dragstart', () => { b.classList.add('jl-dragging'); b.style.opacity = '0.4'; });
        b.addEventListener('dragend', () => { b.classList.remove('jl-dragging'); b.style.opacity = '1'; b.dataset.justDragged = '1'; setTimeout(() => { delete b.dataset.justDragged; }, 60); jlSaveOrder(); });
        l.appendChild(b);
        jlApplyOrder();
        return b;
    }
    // Collapse a panel to a dock button. panelEl = the OUTERMOST element of the
    // script's floating UI. Returns the dock button.
    function jlRegisterPanel(panelEl, id, label, color) {
        const shown = (panelEl.style.display && panelEl.style.display !== 'none') ? panelEl.style.display : 'block';
        panelEl.style.display = 'none';
        const btn = jlDockButton(id, label, color, () => {
            const opening = panelEl.style.display === 'none';
            panelEl.style.display = opening ? shown : 'none';
            btn.style.boxShadow = opening ? '0 0 0 2px #fff, 0 2px 8px rgba(0,0,0,.4)' : '0 2px 8px rgba(0,0,0,.4)';
        });
        return btn;
    }
    // ===== end shared dock =====

    const SCRIPT_ID = 'invoice-order-no';
    const SCRIPT_LABEL = '🧾 Invoice Order No';
    const SCRIPT_COLOR = '#08a';

    const DELAY_BETWEEN_INVOICES = 400;

    // --- STATE ---
    let panel, logArea, startBtn, stopBtn, scanBtn, progressText, dryCheck, orderInput;
    let running = false;
    let invoiceIds = []; // internal numeric IDs scraped from page

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    // =======================================================================
    // UI
    // =======================================================================
    function createUI() {
        if (document.getElementById('jl-invorder-panel')) return;

        panel = document.createElement('div');
        panel.id = 'jl-invorder-panel';
        const container = document.createElement('div');
        container.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;background:#1a1a2e;color:#eee;border-radius:8px;padding:16px;width:500px;max-height:85vh;display:flex;flex-direction:column;font-family:monospace;font-size:12px;box-shadow:0 4px 20px rgba(0,0,0,0.5);';

        // Header
        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;';
        const title = document.createElement('strong');
        title.style.fontSize = '14px';
        title.textContent = 'Bulk Update Invoice Customer Order Number';
        const closeBtn = document.createElement('button');
        closeBtn.style.cssText = 'background:none;border:none;color:#eee;font-size:18px;cursor:pointer;';
        closeBtn.textContent = 'X';
        closeBtn.addEventListener('click', () => { panel.style.display = 'none'; });
        header.appendChild(title);
        header.appendChild(closeBtn);

        // Order number input row
        const inputRow = document.createElement('div');
        inputRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:10px;';
        const inputLabel = document.createElement('label');
        inputLabel.style.cssText = 'white-space:nowrap;color:#aaa;';
        inputLabel.textContent = 'Customer Order No:';
        orderInput = document.createElement('input');
        orderInput.type = 'text';
        orderInput.placeholder = 'e.g. PO-12345';
        orderInput.style.cssText = 'flex:1;padding:6px 8px;border-radius:4px;border:1px solid #555;background:#0a0a1a;color:#eee;font-family:monospace;font-size:12px;';
        inputRow.appendChild(inputLabel);
        inputRow.appendChild(orderInput);

        // Progress
        const progressDiv = document.createElement('div');
        progressDiv.style.marginBottom = '10px';
        progressText = document.createElement('span');
        progressText.style.color = '#0fa';
        progressText.textContent = 'Scan the page to find visible invoices, then click Start.';
        progressDiv.appendChild(progressText);

        // Controls
        const controlsDiv = document.createElement('div');
        controlsDiv.style.marginBottom = '10px';

        scanBtn = document.createElement('button');
        scanBtn.style.cssText = 'background:#08a;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;margin-right:8px;';
        scanBtn.textContent = 'Scan Page';
        scanBtn.addEventListener('click', scanPage);

        startBtn = document.createElement('button');
        startBtn.style.cssText = 'background:#0a8;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;margin-right:8px;';
        startBtn.textContent = 'Start';
        startBtn.disabled = true;
        startBtn.addEventListener('click', startProcess);

        stopBtn = document.createElement('button');
        stopBtn.style.cssText = 'background:#a22;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;display:none;';
        stopBtn.textContent = 'Stop';
        stopBtn.addEventListener('click', () => { running = false; });

        const dryLabel = document.createElement('label');
        dryLabel.style.cssText = 'margin-left:8px;cursor:pointer;';
        dryCheck = document.createElement('input');
        dryCheck.type = 'checkbox';
        dryLabel.appendChild(dryCheck);
        dryLabel.appendChild(document.createTextNode(' Dry Run'));

        controlsDiv.appendChild(scanBtn);
        controlsDiv.appendChild(startBtn);
        controlsDiv.appendChild(stopBtn);
        controlsDiv.appendChild(dryLabel);

        // Log area
        logArea = document.createElement('div');
        logArea.style.cssText = 'flex:1;overflow-y:auto;background:#0a0a1a;padding:8px;border-radius:4px;max-height:55vh;';

        container.appendChild(header);
        container.appendChild(inputRow);
        container.appendChild(progressDiv);
        container.appendChild(controlsDiv);
        container.appendChild(logArea);
        panel.appendChild(container);
        document.body.appendChild(panel);
        jlRegisterPanel(panel, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR);
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
    const setProgress = (msg) => { progressText.textContent = msg; };

    // =======================================================================
    // Page scraping — find invoice IDs from the visible Kendo grid / table
    // =======================================================================
    function scanPage() {
        logArea.innerHTML = '';
        invoiceIds = [];
        const seen = new Set();
        const GUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

        const add = (id) => {
            const s = String(id || '').trim();
            // Accept both numeric IDs and GUIDs
            if (s && (GUID_RE.test(s) || /^\d+$/.test(s)) && !seen.has(s)) {
                seen.add(s);
                invoiceIds.push(s);
            }
        };

        // Strategy 1: links to /PPMInvoice/ or /Invoice/ with GUID or numeric ID
        document.querySelectorAll('a[href]').forEach(a => {
            const m = a.href.match(/\/(?:PPM)?Invoice\/[A-Za-z]*\/?([0-9a-f\-]{8,}|\d+)/i);
            if (m) add(m[1]);
        });

        // Strategy 2: Kendo grid datasource
        try {
            const $ = window.jQuery || window.$;
            if ($) {
                $('.k-grid').each(function () {
                    const grid = $(this).data('kendoGrid');
                    if (!grid) return;
                    const items = grid.dataSource.data();
                    items.forEach(item => {
                        const id = item.Id || item.InvoiceId || item.PPMInvoiceId || item.id;
                        if (id) add(id);
                    });
                });
            }
        } catch (e) { /* ignore */ }

        // Strategy 3: <tr> / element data attributes
        document.querySelectorAll('[data-id], [data-invoiceid], [data-ppminvoiceid]').forEach(el => {
            add(el.getAttribute('data-id') || el.getAttribute('data-invoiceid') || el.getAttribute('data-ppminvoiceid'));
        });

        if (!invoiceIds.length) {
            log('No invoice IDs found on this page.', '#f55');
            setProgress('No invoices found — make sure the table is fully loaded.');
            startBtn.disabled = true;
            return;
        }

        log('');
        log(`Found ${invoiceIds.length} invoice ID(s):`, '#0af');
        invoiceIds.forEach((id, i) => log(`  ${i + 1}. ID: ${id}`, '#0af'));
        setProgress(`${invoiceIds.length} invoice(s) found. Enter Customer Order No and click Start.`);
        startBtn.disabled = false;
    }

    // =======================================================================
    // API helpers
    // =======================================================================
    function getCsrfToken(doc = document) {
        const el = doc.querySelector('input[name="__RequestVerificationToken"]');
        return el ? el.value : '';
    }

    async function fetchText(url) {
        const resp = await fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        if (!resp.ok) throw new Error('HTTP ' + resp.status + ' fetching ' + url);
        return resp.text();
    }

    // Extract the embedded JSON model from invoice detail/edit HTML.
    // Tries multiple anchor patterns used by Joblogic (numeric and GUID IDs).
    function extractInvoiceState(html, invoiceId) {
        const q = invoiceId.replace(/-/g, '[\\-]'); // GUID with optional escaped dashes
        // Build anchors covering both "Id":"guid" and "Id": "guid" (with space)
        const anchors = [
            `"Id":"${invoiceId}"`,
            `"Id": "${invoiceId}"`,
            `"InvoiceId":"${invoiceId}"`,
            `"InvoiceId": "${invoiceId}"`,
            `"PPMInvoiceId":"${invoiceId}"`,
            `"PPMInvoiceId": "${invoiceId}"`,
            `"Id":${invoiceId}`,
            `"InvoiceId":${invoiceId}`,
        ];

        for (const anchor of anchors) {
            const i = html.indexOf(anchor);
            if (i < 0) continue;

            // Walk backward to find opening brace
            let depth = 0, start = -1;
            for (let p = i; p >= 0; p--) {
                const c = html[p];
                if (c === '}') depth++;
                else if (c === '{') {
                    if (depth === 0) { start = p; break; }
                    depth--;
                }
            }
            if (start < 0) continue;

            // Walk forward matching braces, skipping strings
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
            if (end < 0) continue;

            try {
                const obj = JSON.parse(html.slice(start, end));
                // Make sure this blob actually looks like an invoice model
                if (obj.Id || obj.InvoiceId || obj.InvoiceNumber || obj.JobId) return obj;
            } catch (e) {
                // Try next anchor
            }
        }

        throw new Error(`Could not extract invoice JSON state for ID ${invoiceId}`);
    }

    // Read all form fields from the fetched HTML as a fallback / supplement
    function extractFormFields(html) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const fields = {};
        doc.querySelectorAll('input[name], select[name], textarea[name]').forEach(el => {
            if (el.type === 'checkbox') {
                fields[el.name] = el.checked ? 'true' : 'false';
            } else {
                fields[el.name] = el.value || '';
            }
        });
        return fields;
    }

    // Update CustomerOrderNumber on a PPM invoice via /api/PPMInvoice/EditDetail.
    async function updateInvoiceOrderNumber(invoiceId, newOrderNumber, dryRun) {
        const detailUrl = `/PPMInvoice/Detail/${invoiceId}`;
        const html = await fetchText(detailUrl);

        const tokenMatch = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
        const csrfToken = tokenMatch ? tokenMatch[1] : '';

        // Extract the embedded JSON model
        let jsonState = null;
        try { jsonState = extractInvoiceState(html, invoiceId); } catch (e) { /* will fall back */ }

        // Read ALL form inputs — inputs, selects, textareas, plus hidden Kendo editor fields
        const doc = new DOMParser().parseFromString(html, 'text/html');

        // Collect all form fields (preserving multiple values for same name, e.g. TagIds)
        const formEntries = []; // [{name, value}]
        doc.querySelectorAll('input[name], select[name], textarea[name]').forEach(el => {
            if (el.name === '__RequestVerificationToken') return;
            const val = el.type === 'checkbox' ? (el.checked ? 'true' : 'false') : (el.value || '');
            formEntries.push({ name: el.name, value: val });
        });
        // Deduplicated map for field lookup (last value wins — same as browser submit)
        const formFields = {};
        formEntries.forEach(({ name, value }) => { formFields[name] = value; });

        const orderFieldCandidates = [
            'CustomerOrderNumber', 'OrderNumber', 'CustomerPONumber',
            'PurchaseOrderNumber', 'PONumber', 'CustOrderNo'
        ];
        const orderFieldName = orderFieldCandidates.find(c => c in formFields)
            || (jsonState && orderFieldCandidates.find(c => c in jsonState))
            || 'OrderNumber';

        const oldValue = formFields[orderFieldName] || '(empty)';

        // Always use scraped form entries — the JSON state on this page is a customer
        // address blob, not the invoice model. Form fields are authoritative here.
        const entries = [];
        const push = (k, v) => entries.push([k, v == null ? '' : String(v)]);
        formEntries.forEach(({ name, value }) => {
            push(name, name === orderFieldName ? newOrderNumber : value);
        });
        if (!entries.some(([k]) => k === orderFieldName)) push(orderFieldName, newOrderNumber);

        const body = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

        if (dryRun) {
            return {
                dry: true, oldValue, fieldName: orderFieldName,
                fieldCount: entries.length,
                formFieldKeys: [...new Set(formEntries.map(e => e.name))],
            };
        }

        const headers = {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
            'Accept': 'application/json, text/html, */*',
        };
        if (csrfToken) headers['__RequestVerificationToken'] = csrfToken;

        const resp = await fetch('/api/PPMInvoice/EditDetail', {
            method: 'POST', credentials: 'same-origin',
            referrer: `${location.origin}${detailUrl}`,
            referrerPolicy: 'unsafe-url',
            headers, body
        });
        const respText = await resp.text().catch(() => '');
        if (!resp.ok) throw new Error(`EditDetail HTTP ${resp.status}: ${respText.slice(0, 300)}`);
        let json = {};
        try { json = JSON.parse(respText); } catch (e) {}
        if (json.success === false) {
            throw new Error(`EditDetail success=false — Message: "${json.Message || ''}" | Response: ${respText.slice(0, 400)}`);
        }
        return { endpoint: '/api/PPMInvoice/EditDetail', oldValue, fieldName: orderFieldName };
    }

    // =======================================================================
    // Main loop
    // =======================================================================
    async function startProcess() {
        if (running || !invoiceIds.length) return;

        const newOrderNumber = orderInput.value.trim();
        if (!newOrderNumber) {
            alert('Please enter a Customer Order Number first.');
            orderInput.focus();
            return;
        }

        running = true;
        startBtn.style.display = 'none';
        stopBtn.style.display = 'inline-block';
        logArea.innerHTML = '';

        const dryRun = dryCheck.checked;
        log(dryRun ? 'DRY RUN — no changes will be made' : `LIVE MODE — CustomerOrderNumber will be set to "${newOrderNumber}"`,
            dryRun ? '#ff0' : '#f55');
        log(`Processing ${invoiceIds.length} invoice(s)...`, '#0af');
        log('');

        const stats = { updated: 0, unchanged: 0, errors: 0 };
        const failed = [];

        for (let i = 0; i < invoiceIds.length; i++) {
            if (!running) { log('Stopped by user.', '#f55'); break; }
            const id = invoiceIds[i];
            setProgress(`Processing ${i + 1}/${invoiceIds.length}: Invoice ID ${id}`);
            log(`--- [${i + 1}/${invoiceIds.length}] Invoice ID: ${id} ---`, '#fff');

            try {
                const res = await updateInvoiceOrderNumber(id, newOrderNumber, dryRun);

                if (res.dry) {
                    log(`  [DRY] Field: "${res.fieldName}" | "${res.oldValue}" -> "${newOrderNumber}" | ${res.fieldCount} fields`, '#ff0');
                    log(`  [DRY] Form fields: ${res.formFieldKeys.join(', ')}`, '#888');
                    stats.updated++;
                } else if (res.oldValue === newOrderNumber) {
                    log(`  Already "${newOrderNumber}" — posted anyway via ${res.endpoint}`, '#0a8');
                    stats.unchanged++;
                } else {
                    log(`  Updated "${res.fieldName}": "${res.oldValue}" -> "${newOrderNumber}" via ${res.endpoint}`, '#0fa');
                    stats.updated++;
                }
            } catch (e) {
                log(`  ERROR: ${e.message}`, '#f55');
                stats.errors++;
                failed.push(`Invoice ${id} (${e.message})`);
            }

            await sleep(DELAY_BETWEEN_INVOICES);
        }

        log('');
        log('===== SUMMARY =====', '#0af');
        log(`Updated:   ${stats.updated}`, '#0fa');
        log(`Unchanged: ${stats.unchanged}`, '#888');
        log(`Errors:    ${stats.errors}`, stats.errors ? '#f55' : '#888');
        if (failed.length) {
            log('');
            log('Failed:', '#f55');
            failed.forEach(f => log('  ' + f, '#f99'));
        }
        setProgress(`Done. ${stats.updated}/${invoiceIds.length} processed.`);

        running = false;
        startBtn.style.display = 'inline-block';
        stopBtn.style.display = 'none';
    }

    // --- BOOT ---
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createUI);
    } else {
        createUI();
    }
})();
