// ==UserScript==
// @name         Joblogic - Bulk Update Invoice Customer Order Number
// @namespace    http://tampermonkey.net/
// @version      1.6
// @description  On any Invoice/PPMInvoice list page, enter a value and script updates CustomerOrderNumber on all visible invoices via API.
// @match        https://go.joblogic.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

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
        closeBtn.addEventListener('click', () => panel.remove());
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
