// ==UserScript==
// @name         Joblogic - Auto-Deliver POs for Closed Jobs
// @namespace    http://tampermonkey.net/
// @version      1.11
// @description  Reviews open/undelivered POs, checks whether the linked job is closed/completed, and marks the PO as delivered. v1.1: collapses to a launcher button in the shared dock (drag to reorder).
// @match        https://go.joblogic.com/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20POs/joblogic-auto-deliver-pos.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20POs/joblogic-auto-deliver-pos.user.js
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

    const SCRIPT_ID = 'auto-deliver-pos';
    const SCRIPT_LABEL = '📦 Auto Deliver POs';
    const SCRIPT_COLOR = '#4c9f01';
    const SCRIPT_DESC = 'Reviews open and undelivered POs, checks whether the linked job is closed or completed, and marks those POs as delivered. Open the PO list, then Start.';

    console.log('[JL-AutoDeliver] Script loaded');

    // --- CONFIG ---
    const DELAY_BETWEEN_POS = 600;
    const DELAY_BETWEEN_PAGES = 800;
    const CLOSED_STATUSES = ['completed', 'closed', 'invoiced'];

    // --- STATE ---
    let panel, logArea, startBtn, stopBtn, progressText;
    let running = false;

    // --- UI ---
    function createUI() {
        if (document.getElementById('jl-autodeliver-panel')) return;

        panel = document.createElement('div');
        panel.id = 'jl-autodeliver-panel';
        const container = document.createElement('div');
        container.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;background:#1a1a2e;color:#eee;border-radius:8px;padding:16px;width:540px;max-height:80vh;display:flex;flex-direction:column;font-family:monospace;font-size:12px;box-shadow:0 4px 20px rgba(0,0,0,0.5);';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;';
        const title = document.createElement('strong');
        title.style.fontSize = '14px';
        title.textContent = 'Auto-Deliver POs for Closed Jobs';
        const closeBtn = document.createElement('button');
        closeBtn.style.cssText = 'background:none;border:none;color:#eee;font-size:18px;cursor:pointer;';
        closeBtn.textContent = 'X';
        closeBtn.addEventListener('click', () => { panel.style.display = 'none'; });
        header.appendChild(title);
        header.appendChild(closeBtn);

        const progressDiv = document.createElement('div');
        progressDiv.style.marginBottom = '10px';
        progressText = document.createElement('span');
        progressText.style.color = '#0fa';
        progressText.textContent = 'Ready. Go to Purchase Orders page, filter as needed, then click Start.';
        progressDiv.appendChild(progressText);

        const controlsDiv = document.createElement('div');
        controlsDiv.style.marginBottom = '10px';
        startBtn = document.createElement('button');
        startBtn.style.cssText = 'background:#0a8;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;margin-right:8px;';
        startBtn.textContent = 'Start';
        startBtn.addEventListener('click', startProcess);
        stopBtn = document.createElement('button');
        stopBtn.style.cssText = 'background:#a33;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;display:none;';
        stopBtn.textContent = 'Stop';
        stopBtn.addEventListener('click', () => { running = false; });

        const dryLabel = document.createElement('label');
        dryLabel.style.cssText = 'margin-left:12px;font-size:11px;cursor:pointer;';
        const dryCheck = document.createElement('input');
        dryCheck.type = 'checkbox';
        dryCheck.id = 'jl-autodeliver-dryrun';
        dryCheck.checked = true;
        dryLabel.appendChild(dryCheck);
        dryLabel.appendChild(document.createTextNode(' Dry Run (preview only)'));

        const skipPartialLabel = document.createElement('label');
        skipPartialLabel.style.cssText = 'margin-left:12px;font-size:11px;cursor:pointer;';
        const skipPartialCheck = document.createElement('input');
        skipPartialCheck.type = 'checkbox';
        skipPartialCheck.id = 'jl-autodeliver-skip-partial';
        skipPartialCheck.checked = false;
        skipPartialLabel.appendChild(skipPartialCheck);
        skipPartialLabel.appendChild(document.createTextNode(' Skip partially delivered'));

        controlsDiv.appendChild(startBtn);
        controlsDiv.appendChild(stopBtn);
        controlsDiv.appendChild(dryLabel);
        controlsDiv.appendChild(document.createElement('br'));
        controlsDiv.appendChild(skipPartialLabel);

        logArea = document.createElement('div');
        logArea.style.cssText = 'flex:1;overflow-y:auto;max-height:50vh;background:#111;padding:8px;border-radius:4px;white-space:pre-wrap;line-height:1.5;';

        container.appendChild(header);
        container.appendChild(progressDiv);
        container.appendChild(controlsDiv);
        container.appendChild(logArea);
        panel.appendChild(container);
        document.body.appendChild(panel);

        jlRegisterPanel(panel, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR, SCRIPT_DESC);
    }

    function log(msg, color) {
        color = color || '#ccc';
        const line = document.createElement('div');
        line.style.color = color;
        line.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
        logArea.appendChild(line);
        logArea.scrollTop = logArea.scrollHeight;
    }

    function setProgress(msg) {
        progressText.textContent = msg;
    }

    function sleep(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    // --- HELPERS ---

    function getCSRFToken() {
        return document.querySelector('input[name="__RequestVerificationToken"]')?.value || '';
    }

    function getTodayDate() {
        var d = new Date();
        var day = String(d.getDate()).padStart(2, '0');
        var month = String(d.getMonth() + 1).padStart(2, '0');
        return day + '/' + month + '/' + d.getFullYear();
    }

    // Collect POs from the currently visible table rows
    function getPOsFromDOM() {
        var pos = [];
        var seen = {};
        document.querySelectorAll('a[href*="/PurchaseOrder/Detail/"]').forEach(function (a) {
            var match = a.href.match(/\/PurchaseOrder\/Detail\/([a-f0-9\-]{36})/i);
            if (!match || seen[match[1]]) return;
            seen[match[1]] = true;
            var row = a.closest('tr');
            if (!row) return;
            var cells = row.querySelectorAll('td');
            // cells[2] = Job Number, cells[6] = PO Status, cells[7] = Delivery Status
            var jobNo = cells[2] ? cells[2].textContent.trim() : '';
            var poStatus = cells[6] ? cells[6].textContent.trim() : '';
            var deliveryStatus = cells[7] ? cells[7].textContent.trim().toLowerCase() : '';
            pos.push({ id: match[1], jobNo: jobNo, poStatus: poStatus, deliveryStatus: deliveryStatus });
        });
        return pos;
    }

    // Find the Vue paging component
    function getPagingVue() {
        var found = null;
        document.querySelectorAll('*').forEach(function (el) {
            if (el.__vue__?.$options?.name === 'jl-paging' && !found) found = el.__vue__;
        });
        return found;
    }

    // Collect all POs across all pages
    async function collectAllPOs(skipPartial) {
        var allPOs = [];
        var seen = {};

        var paging = getPagingVue();
        if (!paging) {
            log('No paging component found - collecting from current page only', '#fa0');
            return filterPOs(getPOsFromDOM(), skipPartial);
        }

        var totalPages = paging.pager?.totalPages || 1;
        var totalCount = paging.totalCount || 0;
        log('Found ' + totalCount + ' POs across ' + totalPages + ' pages', '#0af');

        for (var page = 1; page <= totalPages && running; page++) {
            setProgress('Collecting POs: page ' + page + '/' + totalPages + ' (' + allPOs.length + ' so far)');

            if (page > 1) {
                paging.onPageClick(page);
                var waited = 0;
                while (waited < 5000) {
                    await sleep(500);
                    waited += 500;
                    var check = getPOsFromDOM();
                    if (check.length > 0 && !seen[check[0].id]) break;
                }
            }

            var pagePOs = getPOsFromDOM();
            var newCount = 0;
            pagePOs.forEach(function (po) {
                if (!seen[po.id]) {
                    seen[po.id] = true;
                    newCount++;
                    // Only collect undelivered/partially delivered POs
                    if (po.deliveryStatus === 'not delivered' || (!skipPartial && po.deliveryStatus === 'partially delivered')) {
                        allPOs.push(po);
                    }
                }
            });

            log('Page ' + page + '/' + totalPages + ': ' + newCount + ' rows, ' + allPOs.length + ' target POs so far');

            if (newCount === 0 && page < totalPages) {
                log('Retrying page ' + page + '...', '#fa0');
                paging.onPageClick(page);
                await sleep(3000);
                pagePOs = getPOsFromDOM();
                pagePOs.forEach(function (po) {
                    if (!seen[po.id]) {
                        seen[po.id] = true;
                        newCount++;
                        if (po.deliveryStatus === 'not delivered' || (!skipPartial && po.deliveryStatus === 'partially delivered')) {
                            allPOs.push(po);
                        }
                    }
                });
                if (newCount === 0) {
                    log('Still no new rows, stopping collection', '#888');
                    break;
                }
            }
        }

        paging.onPageClick(1);
        return allPOs;
    }

    function filterPOs(pos, skipPartial) {
        return pos.filter(function (po) {
            if (po.deliveryStatus === 'not delivered') return true;
            if (!skipPartial && po.deliveryStatus === 'partially delivered') return true;
            return false;
        });
    }

    // Look up job status by job number
    async function getJobStatus(jobNumber) {
        var token = getCSRFToken();
        var resp = await fetch('/api/Job/SearchJsonData', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                '__RequestVerificationToken': token
            },
            body: JSON.stringify({
                SearchTerm: jobNumber,
                PageSize: 5,
                PageIndex: 1,
                EngineerType: 0,
                IncludePPMJobs: true,
                IncludeReactiveJobs: true,
                StartLoggedDate: '', EndLoggedDate: '',
                StartDate: '', EndDate: '',
                StartCompleteDate: '', EndCompleteDate: '',
                StartNextContactDate: '', EndNextContactDate: ''
            })
        });

        if (!resp.ok) throw new Error('Job search HTTP ' + resp.status);
        var data = await resp.json();
        var jobs = (data.AdditionalData && data.AdditionalData.Jobs) || data.Data || [];
        var match = jobs.find(function (j) { return j.JobNumber === jobNumber; }) || jobs[0];
        if (!match) return null;
        return {
            id: match.Id || match.JobId,
            number: match.JobNumber,
            statusDescription: (match.StatusDescription || match.Status || '').toLowerCase()
        };
    }

    // Mark a PO as fully delivered
    async function markPODelivered(poId, token) {
        var fd = new FormData();
        fd.append('PurchaseOrderId', poId);
        fd.append('Id', '');
        fd.append('DeliverAll', 'true');
        fd.append('PurchaseOrderType', '0');
        fd.append('DeliverDate', getTodayDate());
        fd.append('ChangeJobStatus', 'false');
        fd.append('PassDiscount', 'false');

        var resp = await fetch('/PurchaseOrder/SaveDeliveryDate', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                '__RequestVerificationToken': token
            },
            body: fd
        });

        if (!resp.ok) throw new Error('HTTP ' + resp.status + ': ' + resp.statusText);
        var result = await resp.json().catch(function () { return {}; });
        if (result.success === false) {
            throw new Error(result.Message || result.errors?.join(', ') || 'API returned failure');
        }
        return result;
    }

    // --- MAIN PROCESS ---

    async function startProcess() {
        if (running) return;
        running = true;
        startBtn.style.display = 'none';
        stopBtn.style.display = 'inline-block';
        logArea.innerHTML = '';

        var dryRun = document.getElementById('jl-autodeliver-dryrun').checked;
        var skipPartial = document.getElementById('jl-autodeliver-skip-partial').checked;

        log(dryRun ? 'DRY RUN MODE - No changes will be made' : 'LIVE MODE - POs will be marked as delivered!', dryRun ? '#ff0' : '#f55');
        log('Closed statuses: ' + CLOSED_STATUSES.join(', '), '#888');
        log('Skip partially delivered: ' + skipPartial, '#888');

        var token = getCSRFToken();
        if (!token) {
            log('ERROR: Could not find CSRF token. Are you logged in to Joblogic?', '#f55');
            running = false;
            startBtn.style.display = 'inline-block';
            stopBtn.style.display = 'none';
            return;
        }

        try {
            // Step 1: Collect all undelivered POs
            log('Collecting undelivered POs from all pages...', '#0af');
            var targetPOs = await collectAllPOs(skipPartial);

            if (!running) { log('Stopped by user.', '#f55'); return; }

            log('Target POs (not delivered' + (skipPartial ? '' : ' or partially delivered') + '): ' + targetPOs.length, '#0fa');

            if (targetPOs.length === 0) {
                log('No undelivered POs found. Make sure you are on the Purchase Orders page.', '#fa0');
                setProgress('No target POs found.');
                return;
            }

            // Step 2: Process each PO
            var processed = 0;
            var delivered = 0;
            var skippedJobOpen = 0;
            var skippedNoJob = 0;
            var errors = 0;

            for (var i = 0; i < targetPOs.length; i++) {
                if (!running) { log('Stopped by user.', '#f55'); break; }

                var po = targetPOs[i];
                processed++;
                setProgress('Processing ' + processed + '/' + targetPOs.length + ': ' + (po.jobNo || po.id.substring(0, 8)));

                if (!po.jobNo) {
                    log('PO ' + po.id.substring(0, 8) + '... - no job number (stock PO?), skipping', '#888');
                    skippedNoJob++;
                    continue;
                }

                try {
                    // Check job status
                    var job = await getJobStatus(po.jobNo);

                    if (!job) {
                        log('PO -> ' + po.jobNo + ' - job not found', '#fa0');
                        skippedNoJob++;
                        continue;
                    }

                    var isClosed = CLOSED_STATUSES.some(function (s) { return job.statusDescription.includes(s); });

                    if (!isClosed) {
                        log('PO -> ' + po.jobNo + ' [' + job.statusDescription + '] - job is open, skipping', '#888');
                        skippedJobOpen++;
                        continue;
                    }

                    log('PO ' + po.id.substring(0, 8) + '... -> ' + po.jobNo + ' [' + job.statusDescription + '] - delivery: ' + po.deliveryStatus, '#aaf');

                    if (!dryRun) {
                        try {
                            await markPODelivered(po.id, token);
                            log('  Marked as Fully Delivered', '#0fa');
                            delivered++;
                        } catch (e) {
                            log('  ERROR delivering: ' + e.message, '#f55');
                            errors++;
                        }
                    } else {
                        log('  [DRY RUN] Would mark as Fully Delivered', '#ff0');
                        delivered++;
                    }

                } catch (e) {
                    log('PO -> ' + po.jobNo + ' - ERROR: ' + e.message, '#f55');
                    errors++;
                }

                await sleep(DELAY_BETWEEN_POS);
            }

            // Summary
            log('', '#888');
            log('========== SUMMARY ==========', '#0fa');
            log('POs processed: ' + processed + '/' + targetPOs.length, '#0fa');
            log('POs delivered: ' + delivered, delivered > 0 ? '#0fa' : '#888');
            log('POs skipped (job still open): ' + skippedJobOpen, '#888');
            log('POs skipped (no job/not found): ' + skippedNoJob, '#888');
            log('Errors: ' + errors, errors > 0 ? '#f55' : '#0fa');
            if (dryRun) log('(Dry run - no actual changes were made)', '#ff0');
            setProgress('Complete!');

        } catch (e) {
            log('Fatal error: ' + e.message, '#f55');
            setProgress('Error!');
        } finally {
            running = false;
            startBtn.style.display = 'inline-block';
            stopBtn.style.display = 'none';
        }
    }

    // --- INIT ---
    function init() {
        if (document.getElementById('jl-autodeliver-panel')) return;
        if (!document.body) {
            setTimeout(init, 500);
            return;
        }
        createUI();
    }

    if (window.location.hostname === 'go.joblogic.com') {
        init();
    }
})();
