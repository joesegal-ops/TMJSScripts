// ==UserScript==
// @name         Joblogic - Auto-Deliver POs for Closed Jobs
// @namespace    http://tampermonkey.net/
// @version      1.13
// @description  Reviews open/undelivered POs, checks whether the linked job is closed/completed, and marks the PO as delivered. v1.13: shows the running version in the panel header. v1.12: paces requests under the Azure gateway rate limit, caches job lookups and retries WAF 403s.
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

    // Read from the metadata block so the on-screen version can never drift from @version.
    const SCRIPT_VERSION = ((typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || '1.13');
    const SCRIPT_ID = 'auto-deliver-pos';
    const SCRIPT_LABEL = '📦 Auto Deliver POs';
    const SCRIPT_COLOR = '#4c9f01';
    const SCRIPT_DESC = 'Reviews open and undelivered POs, checks whether the linked job is closed or completed, and marks those POs as delivered. Open the PO list, then Start.';

    console.log('[JL-AutoDeliver v' + SCRIPT_VERSION + '] Script loaded');

    // --- CONFIG ---
    // go.joblogic.com sits behind an Azure Application Gateway WAF that rate-limits
    // per client IP on a sliding ~1-minute window. Exceeding it returns an HTML
    // "403 Forbidden" page from the gateway (server: Microsoft-Azure-Application-Gateway/v2)
    // rather than anything from Joblogic itself. The old 600ms spacing was ~100 req/min,
    // which sat right on the threshold - any other open JL tab tipped it over and roughly
    // half of all job lookups came back 403 for the rest of the window.
    // 1400ms (~43 req/min) leaves headroom for the rest of the browser session.
    const MIN_REQUEST_INTERVAL = 1400;
    const DELAY_BETWEEN_PAGES = 800;
    const CLOSED_STATUSES = ['completed', 'closed', 'invoiced'];
    // How long to stand down when the WAF does block us, per attempt. Measured
    // behaviour: it is a token bucket, not a lockout - a request retried immediately
    // after five straight 403s already succeeded, and 15/15 at 1400ms spacing came
    // back clean right after tripping it. So retry soon and escalate gently.
    const WAF_BACKOFF_MS = [1500, 3000, 6000, 12000, 20000];

    // --- STATE ---
    let panel, logArea, startBtn, stopBtn, progressText;
    let running = false;
    // Job number -> job status object (or null when not found). The PO list routinely
    // repeats job numbers across POs, so this removes ~15% of the lookups outright.
    let jobStatusCache = new Map();
    // Count of gateway rate-limit blocks we absorbed, for the run summary.
    let wafBlocks = 0;
    // Count of job lookups served from jobStatusCache instead of the network.
    let cacheSaves = 0;

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
        title.textContent = 'Auto-Deliver POs for Closed Jobs' + (SCRIPT_VERSION ? '  (v' + SCRIPT_VERSION + ')' : '');
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

    // --- REQUEST THROTTLE + WAF RETRY ---

    var lastRequestAt = 0;
    // Starts at MIN_REQUEST_INTERVAL and self-corrects upward if we still get
    // blocked (e.g. lots of other JL tabs sharing the same IP budget).
    var currentInterval = MIN_REQUEST_INTERVAL;

    // Space every outbound request by at least currentInterval.
    async function throttle() {
        var wait = currentInterval - (Date.now() - lastRequestAt);
        if (wait > 0) await sleep(wait);
        lastRequestAt = Date.now();
    }

    // A gateway block is an HTML 403/429 from Azure App Gateway - retryable.
    // A 403 from Joblogic itself (JSON, no gateway header) is a real permission
    // error and must NOT be retried.
    function isWafBlock(resp, bodyText) {
        if (resp.status !== 403 && resp.status !== 429 && resp.status !== 503) return false;
        var server = resp.headers.get('server') || '';
        if (/Application-Gateway/i.test(server)) return true;
        var ct = resp.headers.get('content-type') || '';
        return /text\/html/i.test(ct) || /403 Forbidden/i.test(bodyText || '');
    }

    // fetch + throttle + back off and retry when the WAF blocks us.
    // Returns the response body as text on success.
    async function jlFetch(url, opts, label) {
        for (var attempt = 0; ; attempt++) {
            if (!running) throw new Error('stopped');
            await throttle();

            var resp = await fetch(url, opts);
            if (resp.ok) return await resp.text();

            var bodyText = await resp.text().catch(function () { return ''; });

            if (isWafBlock(resp, bodyText)) {
                if (attempt >= WAF_BACKOFF_MS.length) {
                    throw new Error('rate limited by gateway after ' + (attempt + 1) + ' attempts');
                }
                var pause = WAF_BACKOFF_MS[attempt];
                // Ease off for the remainder of the run so we stop hitting the ceiling.
                if (currentInterval < 4000) currentInterval += 200;
                wafBlocks++;
                log('  Rate limited by gateway - retrying ' + label + ' in ' + (pause / 1000) + 's (pacing now ' + currentInterval + 'ms)', '#fa0');
                setProgress('Rate limited - retrying in ' + (pause / 1000) + 's...');
                // Sleep in slices so Stop stays responsive.
                for (var slept = 0; slept < pause && running; slept += 500) await sleep(500);
                continue;
            }

            throw new Error(label + ' HTTP ' + resp.status);
        }
    }

    // Look up job status by job number
    async function getJobStatus(jobNumber) {
        if (jobStatusCache.has(jobNumber)) { cacheSaves++; return jobStatusCache.get(jobNumber); }
        var job = await fetchJobStatus(jobNumber);
        jobStatusCache.set(jobNumber, job);
        return job;
    }

    async function fetchJobStatus(jobNumber) {
        var token = getCSRFToken();
        var text = await jlFetch('/api/Job/SearchJsonData', {
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
        }, 'Job search');

        var data = JSON.parse(text);
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

        var text = await jlFetch('/PurchaseOrder/SaveDeliveryDate', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                '__RequestVerificationToken': token
            },
            body: fd
        }, 'SaveDeliveryDate');

        var result = (function () { try { return JSON.parse(text); } catch (e) { return {}; } })();
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
        jobStatusCache = new Map();
        lastRequestAt = 0;
        currentInterval = MIN_REQUEST_INTERVAL;
        wafBlocks = 0;
        cacheSaves = 0;

        log('Auto-Deliver POs v' + SCRIPT_VERSION, '#888');
        log(dryRun ? 'DRY RUN MODE - No changes will be made' : 'LIVE MODE - POs will be marked as delivered!', dryRun ? '#ff0' : '#f55');
        log('Closed statuses: ' + CLOSED_STATUSES.join(', '), '#888');
        log('Request pacing: 1 per ' + MIN_REQUEST_INTERVAL + 'ms (~' + Math.round(60000 / MIN_REQUEST_INTERVAL) + '/min) to stay under the gateway rate limit', '#888');
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
                    if (e.message === 'stopped') break;
                    log('PO -> ' + po.jobNo + ' - ERROR: ' + e.message, '#f55');
                    errors++;
                }

                // No extra sleep here - jlFetch's throttle already paces every request.
            }

            // Summary
            log('', '#888');
            log('========== SUMMARY ==========', '#0fa');
            log('POs processed: ' + processed + '/' + targetPOs.length, '#0fa');
            log('POs delivered: ' + delivered, delivered > 0 ? '#0fa' : '#888');
            log('POs skipped (job still open): ' + skippedJobOpen, '#888');
            log('POs skipped (no job/not found): ' + skippedNoJob, '#888');
            log('Errors: ' + errors, errors > 0 ? '#f55' : '#0fa');
            log('Job lookups saved by cache: ' + cacheSaves, '#888');
            log('Gateway rate-limit blocks absorbed by retry: ' + wafBlocks + (wafBlocks ? ' (final pacing ' + currentInterval + 'ms)' : ''), wafBlocks ? '#fa0' : '#0fa');
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
