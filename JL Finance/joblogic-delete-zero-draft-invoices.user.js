// ==UserScript==
// @name         Joblogic - Delete Zero-Value Draft Invoices
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  On the Invoice list page (Draft Invoices tab), scans ALL pages of draft invoices via the SearchInvoice API and deletes every one with a £0.00 grand total. Respects any filters/search currently applied to the list. Scan first (read-only), then Delete with optional dry run. Collapses to a launcher button in the shared dock.
// @match        https://go.joblogic.com/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Finance/joblogic-delete-zero-draft-invoices.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Finance/joblogic-delete-zero-draft-invoices.user.js
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

    const SCRIPT_ID = 'delete-zero-drafts';
    const SCRIPT_LABEL = '🗑️ Delete £0 Draft Invoices';
    const SCRIPT_COLOR = '#4c9f01';
    const SCRIPT_DESC = 'Scans every page of the Draft Invoices tab (respecting any filters/search you have applied) and deletes all draft invoices with a £0.00 total. Scan is read-only; nothing is deleted until you click Delete and confirm.';

    const DELAY_BETWEEN_DELETES = 300;  // ms politeness delay
    const ZERO_TOL = 0.005;             // |GrandTotalDecimal| below this counts as zero
    const SCAN_PAGE_SIZE = 100;

    // --- STATE ---
    let panel, logArea, scanBtn, deleteBtn, stopBtn, progressText, dryCheck;
    let running = false;
    let zeroInvoices = [];

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    // =======================================================================
    // Capture the page's own SearchInvoice payload so a scan respects
    // whatever filters / search term the user has applied to the list.
    // =======================================================================
    let lastSearchPayload = null;
    (function hookXHR() {
        const origOpen = XMLHttpRequest.prototype.open;
        const origSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (m, u) { this.__jlZeroUrl = String(u || ''); return origOpen.apply(this, arguments); };
        XMLHttpRequest.prototype.send = function (body) {
            try {
                if (/\/api\/Invoice\/SearchInvoice/i.test(this.__jlZeroUrl || '') && body instanceof FormData) {
                    const o = {};
                    for (const [k, v] of body.entries()) o[k] = String(v);
                    if (o.SelectedTab === 'DRAFT_INVOICES') lastSearchPayload = o;
                }
            } catch (e) { /* ignore */ }
            return origSend.apply(this, arguments);
        };
    })();

    function defaultSearchPayload() {
        return {
            ProjectId: '', IsProjectInvoicesPage: 'false', RequireSummary: 'false',
            searchTerm: '', JobId: '', PPMContractId: '', HireContractId: '',
            CustomerId: '', SiteId: '', PageSize: '50', PageIndex: '1', OrderBy: '0',
            startDate: '', endDate: '', paymentDueStartDate: '', paymentDueEndDate: '',
            SelectedTab: 'DRAFT_INVOICES', TagIds: '', excludeTagIds: '', batchIds: '',
            InvoicePaymentStatusIds: '', EmailStatusIds: '',
            includeStandardInvoices: 'true', includePPMInvoices: 'true',
            includeSORInvoices: 'true', includeCGroupInvoices: 'true',
            includeRelatedJobInvoices: 'false', includeHireInvoices: 'false',
            includeProjectInvoices: 'true',
        };
    }

    function getPageToken() {
        const el = document.querySelector('input[name="__RequestVerificationToken"]');
        return el ? el.value : '';
    }

    // =======================================================================
    // API
    // =======================================================================
    async function searchDraftPage(pageIndex) {
        const payload = Object.assign({}, lastSearchPayload || defaultSearchPayload());
        payload.SelectedTab = 'DRAFT_INVOICES';
        payload.RequireSummary = 'false';
        payload.PageSize = String(SCAN_PAGE_SIZE);
        payload.PageIndex = String(pageIndex);
        const fd = new FormData();
        Object.entries(payload).forEach(([k, v]) => fd.append(k, v));
        const resp = await fetch('/api/Invoice/SearchInvoice', {
            method: 'POST', credentials: 'same-origin', body: fd,
            headers: { 'X-Requested-With': 'XMLHttpRequest', '__RequestVerificationToken': getPageToken() },
        });
        if (!resp.ok) throw new Error('SearchInvoice HTTP ' + resp.status);
        const json = await resp.json();
        if (json.success === false) throw new Error('SearchInvoice success=false: ' + (json.Message || ''));
        const ad = json.AdditionalData || {};
        return { invoices: ad.Invoices || [], totalCount: ad.TotalCount || 0 };
    }

    // Each invoice type has its own delete-confirmation modal whose <form>
    // carries the prefilled Id + a fresh __RequestVerificationToken, so the
    // delete is performed exactly like the UI: fetch the modal, submit its form.
    //   Standard (Type 0): /Invoice/DeleteModal?id=<numeric Id>  -> POST /Invoice/Delete
    //   PPM      (Type 1): /PPMInvoice/DeleteModal?id=<UniqueId> -> POST /api/PPMInvoice/Delete
    function deleteModalUrlFor(inv) {
        if (inv.Type === 1 || /ppm/i.test(inv.TypeDescription || '')) {
            return '/PPMInvoice/DeleteModal?id=' + encodeURIComponent(inv.UniqueId || inv.Id);
        }
        if (/group/i.test(inv.TypeDescription || '')) {
            return '/CGroupInvoice/DeleteModal?id=' + encodeURIComponent(inv.UniqueId || inv.Id);
        }
        return '/Invoice/DeleteModal?id=' + encodeURIComponent(inv.Id);
    }

    async function deleteInvoice(inv) {
        const modalUrl = deleteModalUrlFor(inv);
        const resp = await fetch(modalUrl, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        if (!resp.ok) throw new Error('DeleteModal HTTP ' + resp.status);
        const html = await resp.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const form = doc.querySelector('form');
        if (!form || !form.getAttribute('action')) throw new Error('No delete form in modal (' + modalUrl + ')');
        const action = form.getAttribute('action');
        const body = new URLSearchParams();
        form.querySelectorAll('input[name]').forEach(i => body.append(i.name, i.value));
        const resp2 = await fetch(action, {
            method: 'POST', credentials: 'same-origin', body,
            headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        });
        const text = await resp2.text().catch(() => '');
        if (!resp2.ok) throw new Error(action + ' HTTP ' + resp2.status + ': ' + text.slice(0, 200));
        let json = {};
        try { json = JSON.parse(text); } catch (e) { /* some endpoints may redirect */ }
        if (json.success === false) throw new Error(action + ' success=false: ' + (json.Message || (json.errors || []).join('; ') || text.slice(0, 200)));
        return action;
    }

    // =======================================================================
    // UI
    // =======================================================================
    function createUI() {
        if (document.getElementById('jl-zerodraft-panel')) return;

        panel = document.createElement('div');
        panel.id = 'jl-zerodraft-panel';
        const container = document.createElement('div');
        container.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;background:#1a1a2e;color:#eee;border-radius:8px;padding:16px;width:520px;max-height:85vh;display:flex;flex-direction:column;font-family:monospace;font-size:12px;box-shadow:0 4px 20px rgba(0,0,0,0.5);';

        // Header
        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;';
        const title = document.createElement('strong');
        title.style.fontSize = '14px';
        title.textContent = 'Delete Zero-Value Draft Invoices';
        const closeBtn = document.createElement('button');
        closeBtn.style.cssText = 'background:none;border:none;color:#eee;font-size:18px;cursor:pointer;';
        closeBtn.textContent = 'X';
        closeBtn.addEventListener('click', () => { panel.style.display = 'none'; });
        header.appendChild(title);
        header.appendChild(closeBtn);

        // Progress
        const progressDiv = document.createElement('div');
        progressDiv.style.marginBottom = '10px';
        progressText = document.createElement('span');
        progressText.style.color = '#0fa';
        progressText.textContent = 'Open the Invoice list (Draft Invoices tab), then Scan.';
        progressDiv.appendChild(progressText);

        // Controls
        const controlsDiv = document.createElement('div');
        controlsDiv.style.marginBottom = '10px';

        scanBtn = document.createElement('button');
        scanBtn.style.cssText = 'background:#08a;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;margin-right:8px;';
        scanBtn.textContent = 'Scan (read-only)';
        scanBtn.addEventListener('click', scanDrafts);

        deleteBtn = document.createElement('button');
        deleteBtn.style.cssText = 'background:#a22;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;margin-right:8px;';
        deleteBtn.textContent = 'Delete £0 drafts';
        deleteBtn.disabled = true;
        deleteBtn.addEventListener('click', startDelete);

        stopBtn = document.createElement('button');
        stopBtn.style.cssText = 'background:#555;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;display:none;';
        stopBtn.textContent = 'Stop';
        stopBtn.addEventListener('click', () => { running = false; });

        const dryLabel = document.createElement('label');
        dryLabel.style.cssText = 'margin-left:8px;cursor:pointer;';
        dryCheck = document.createElement('input');
        dryCheck.type = 'checkbox';
        dryLabel.appendChild(dryCheck);
        dryLabel.appendChild(document.createTextNode(' Dry Run'));

        controlsDiv.appendChild(scanBtn);
        controlsDiv.appendChild(deleteBtn);
        controlsDiv.appendChild(stopBtn);
        controlsDiv.appendChild(dryLabel);

        // Log area
        logArea = document.createElement('div');
        logArea.style.cssText = 'flex:1;overflow-y:auto;background:#0a0a1a;padding:8px;border-radius:4px;max-height:55vh;';

        container.appendChild(header);
        container.appendChild(progressDiv);
        container.appendChild(controlsDiv);
        container.appendChild(logArea);
        panel.appendChild(container);
        document.body.appendChild(panel);
        jlRegisterPanel(panel, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR, SCRIPT_DESC);
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

    const invLabel = (inv) => `${inv.TypeDescription || '?'} | ${inv.JobNumber || inv.OrderNumber || '(no ref)'} | ${inv.CustomerName || ''} | ${inv.TotalIncludingVat || '£0.00'}`;

    // =======================================================================
    // Scan — read-only sweep of every Draft Invoices page
    // =======================================================================
    async function scanDrafts() {
        if (running) return;
        running = true;
        scanBtn.disabled = true;
        deleteBtn.disabled = true;
        logArea.innerHTML = '';
        zeroInvoices = [];

        try {
            log(lastSearchPayload ? 'Using the filters currently applied to the list.' : 'No list search captured yet — scanning ALL draft invoices (no filters).', '#888');
            let pageIndex = 1, total = Infinity, fetched = 0, all = [];
            while (fetched < total) {
                setProgress(`Scanning page ${pageIndex}...`);
                const { invoices, totalCount } = await searchDraftPage(pageIndex);
                total = totalCount;
                if (!invoices.length) break;
                fetched += invoices.length;
                all = all.concat(invoices);
                log(`Page ${pageIndex}: ${invoices.length} drafts (${fetched}/${total})`, '#888');
                pageIndex++;
            }

            zeroInvoices = all.filter(inv =>
                inv.IsDraft === true &&
                inv.IsCredit !== true &&
                Math.abs(Number(inv.GrandTotalDecimal) || 0) < ZERO_TOL
            );

            log('');
            log(`Drafts scanned: ${all.length} — zero-value: ${zeroInvoices.length}`, '#0af');
            zeroInvoices.forEach((inv, i) => log(`  ${i + 1}. ${invLabel(inv)}`, '#0af'));
            if (zeroInvoices.length) {
                setProgress(`${zeroInvoices.length} zero-value draft(s) found. Click Delete to remove them.`);
                deleteBtn.disabled = false;
            } else {
                setProgress('No zero-value drafts found.');
            }
        } catch (e) {
            log('SCAN ERROR: ' + e.message, '#f55');
            setProgress('Scan failed — see log.');
        }

        scanBtn.disabled = false;
        running = false;
    }

    // =======================================================================
    // Delete loop
    // =======================================================================
    async function startDelete() {
        if (running || !zeroInvoices.length) return;
        const dryRun = dryCheck.checked;

        if (!dryRun && !confirm(`Delete ${zeroInvoices.length} zero-value draft invoice(s)?\n\nThis cannot be undone.`)) return;

        running = true;
        scanBtn.disabled = true;
        deleteBtn.style.display = 'none';
        stopBtn.style.display = 'inline-block';

        log('');
        log(dryRun ? 'DRY RUN — nothing will be deleted' : `LIVE — deleting ${zeroInvoices.length} draft invoice(s)`, dryRun ? '#ff0' : '#f55');

        const stats = { deleted: 0, errors: 0 };
        const failed = [];
        const remaining = [];

        for (let i = 0; i < zeroInvoices.length; i++) {
            if (!running) { log('Stopped by user.', '#f55'); remaining.push(...zeroInvoices.slice(i)); break; }
            const inv = zeroInvoices[i];
            setProgress(`Deleting ${i + 1}/${zeroInvoices.length}: ${inv.JobNumber || inv.Id}`);

            try {
                if (dryRun) {
                    log(`  [DRY] Would delete via ${deleteModalUrlFor(inv).split('?')[0]} — ${invLabel(inv)}`, '#ff0');
                    stats.deleted++;
                } else {
                    const endpoint = await deleteInvoice(inv);
                    log(`  Deleted [${i + 1}/${zeroInvoices.length}] ${invLabel(inv)} (${endpoint})`, '#0fa');
                    stats.deleted++;
                }
            } catch (e) {
                log(`  ERROR: ${invLabel(inv)} — ${e.message}`, '#f55');
                stats.errors++;
                failed.push(inv);
            }

            await sleep(DELAY_BETWEEN_DELETES);
        }

        log('');
        log('===== SUMMARY =====', '#0af');
        log(`${dryRun ? 'Would delete' : 'Deleted'}: ${stats.deleted}`, '#0fa');
        log(`Errors:  ${stats.errors}`, stats.errors ? '#f55' : '#888');
        if (failed.length) failed.forEach(f => log('  Failed: ' + invLabel(f), '#f99'));
        if (!dryRun && stats.deleted) log('Refresh the page to see the updated list.', '#ff0');
        setProgress(`Done. ${stats.deleted}/${zeroInvoices.length} ${dryRun ? 'would be ' : ''}deleted${stats.errors ? `, ${stats.errors} error(s)` : ''}.`);

        // Keep anything not yet processed so Stop -> Delete can resume.
        zeroInvoices = remaining.concat(failed);
        running = false;
        scanBtn.disabled = false;
        stopBtn.style.display = 'none';
        deleteBtn.style.display = 'inline-block';
        deleteBtn.disabled = !zeroInvoices.length;
        if (zeroInvoices.length) deleteBtn.textContent = `Delete £0 drafts (${zeroInvoices.length} left)`;
    }

    // --- BOOT ---
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createUI);
    } else {
        createUI();
    }
})();
