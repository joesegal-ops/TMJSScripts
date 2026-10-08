// ==UserScript==
// @name         Joblogic - Auto-Deliver POs for Closed Jobs
// @namespace    http://tampermonkey.net/
// @version      1.17
// @description  Reviews open/undelivered POs, checks whether the linked job is closed/completed, and marks the PO as delivered. v1.17: optional Job/Action TSV - only process listed jobs, and set Non-Chargeable on SPO cost lines where asked; patient page loading (no longer stops at a slow page). v1.16: sell estimate treats quoted-value jobs and Non-Chargeable rates as £0 sell. v1.15: estimates the job sell each PO will add (cost + selling-rate uplift) and flags already-invoiced jobs. v1.14: also works on the Subcontractor Purchase Orders page (marks SPOs as completed). v1.13: shows the running version in the panel header. v1.12: paces requests under the Azure gateway rate limit, caches job lookups and retries WAF 403s.
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
    const SCRIPT_VERSION = ((typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || '1.17');
    const SCRIPT_ID = 'auto-deliver-pos';
    const SCRIPT_LABEL = '📦 Auto Deliver POs';
    const SCRIPT_COLOR = '#4c9f01';
    const SCRIPT_DESC = 'Reviews open and undelivered POs, checks whether the linked job is closed or completed, and marks those POs as delivered (or completed, on the Subcontractor PO list). Open the PO list, then Start.';

    // The Subcontractor PO list (/SubContractorPO) is a different grid: rows link to
    // /SubcontractorPO/Detail/, the status column is "Completion Status" rather than
    // "Delivery Status", and the equivalent of "deliver all" is "Complete All"
    // (/SubContractorPO/SaveCompleteDate).
    function isSubcontractorPage() { return /^\/SubContractorPO(\/|$)/i.test(location.pathname); }

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
    // Job id -> { rateId, rateName } and selling rate id -> uplift %s, for the sell-impact estimate.
    let jobRateCache = new Map();
    let rateUpliftCache = new Map();

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

        const impactLabel = document.createElement('label');
        impactLabel.style.cssText = 'margin-left:12px;font-size:11px;cursor:pointer;';
        const impactCheck = document.createElement('input');
        impactCheck.type = 'checkbox';
        impactCheck.id = 'jl-autodeliver-sell-impact';
        impactCheck.checked = true;
        impactLabel.appendChild(impactCheck);
        impactLabel.appendChild(document.createTextNode(' Show job sell impact (slower)'));
        controlsDiv.appendChild(impactLabel);

        const listLabel = document.createElement('div');
        listLabel.style.cssText = 'margin-top:8px;font-size:11px;';
        listLabel.textContent = 'Optional job list (paste TSV with header: Job, Action[, PO]). Action = Deliver or Non-Chargeable. When filled, ONLY these jobs are processed:';
        const listArea = document.createElement('textarea');
        listArea.id = 'jl-autodeliver-joblist';
        listArea.placeholder = 'Job\tAction\nR0000095\tNon-Chargeable\nRE0012747\tDeliver';
        listArea.style.cssText = 'width:100%;box-sizing:border-box;height:70px;margin-top:4px;background:#111;color:#eee;border:1px solid #444;border-radius:4px;font-family:monospace;font-size:11px;padding:4px;';
        controlsDiv.appendChild(listLabel);
        controlsDiv.appendChild(listArea);

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

    // Map header text -> column index for the PO grid, so we don't depend on column order.
    function getColumnIndex(row, names, fallback) {
        var table = row.closest('table');
        var ths = table ? table.querySelectorAll('thead th') : [];
        for (var i = 0; i < ths.length; i++) {
            var h = ths[i].textContent.trim().toLowerCase();
            if (names.indexOf(h) !== -1) return i;
        }
        return fallback;
    }

    // Collect POs from the currently visible table rows.
    // deliveryStatus is normalised to 'not delivered' / 'partially delivered' / other,
    // so Subcontractor POs ("Not Completed" / "Partially Completed") flow through the
    // same filters as supplier POs.
    function getPOsFromDOM() {
        var spo = isSubcontractorPage();
        var linkRe = spo ? /\/SubcontractorPO\/Detail\/([a-f0-9\-]{36})/i : /\/PurchaseOrder\/Detail\/([a-f0-9\-]{36})/i;
        var pos = [];
        var seen = {};
        var cols = null;
        document.querySelectorAll(spo ? 'a[href*="/Detail/"]' : 'a[href*="/PurchaseOrder/Detail/"]').forEach(function (a) {
            var match = a.href.match(linkRe);
            if (!match || seen[match[1]]) return;
            seen[match[1]] = true;
            var row = a.closest('tr');
            if (!row) return;
            if (!cols) {
                cols = {
                    job: getColumnIndex(row, ['job number'], 2),
                    poStatus: getColumnIndex(row, ['po status'], spo ? 7 : 6),
                    status: spo ? getColumnIndex(row, ['completion status'], 8) : getColumnIndex(row, ['delivery status'], 7)
                };
            }
            var cells = row.querySelectorAll('td');
            var jobNo = cells[cols.job] ? cells[cols.job].textContent.trim() : '';
            var poStatus = cells[cols.poStatus] ? cells[cols.poStatus].textContent.trim() : '';
            var rawStatus = cells[cols.status] ? cells[cols.status].textContent.trim().toLowerCase() : '';
            var deliveryStatus = rawStatus;
            if (spo) {
                if (rawStatus === 'not completed') deliveryStatus = 'not delivered';
                else if (rawStatus.indexOf('partial') !== -1) deliveryStatus = 'partially delivered';
            }
            var jobLink = row.querySelector('a[href*="/Job/Detail/"]');
            var jobIdMatch = jobLink && jobLink.href.match(/\/Job\/Detail\/(\d+)/);
            pos.push({ id: match[1], jobNo: jobNo, jobId: jobIdMatch ? jobIdMatch[1] : null, poStatus: poStatus, deliveryStatus: deliveryStatus, rawStatus: rawStatus });
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

        var skippedPages = [];
        for (var page = 1; page <= totalPages && running; page++) {
            setProgress('Collecting POs: page ' + page + '/' + totalPages + ' (' + allPOs.length + ' so far)');

            // Joblogic sometimes takes well over 5s to swap a page in. Re-click and poll
            // up to 3 times (15s each) before giving up on the page - and then skip it
            // rather than abandoning every page after it.
            var loaded = page === 1;
            for (var attempt = 0; !loaded && attempt < 3 && running; attempt++) {
                if (attempt > 0) log('Page ' + page + ' slow to load - retry ' + attempt + '/2...', '#fa0');
                paging.onPageClick(page);
                for (var waited = 0; waited < 15000 && running; waited += 500) {
                    await sleep(500);
                    var check = getPOsFromDOM();
                    if (check.length > 0 && !seen[check[0].id]) { loaded = true; break; }
                }
            }
            if (!loaded) {
                log('Page ' + page + '/' + totalPages + ': could not load - SKIPPED (its POs are not in this run)', '#f55');
                skippedPages.push(page);
                continue;
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
        }
        if (skippedPages.length) log('WARNING: pages skipped because they would not load: ' + skippedPages.join(', ') + ' - re-run to pick them up', '#f55');

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

    // Subcontractor PO equivalent of "deliver all": the "Complete All" modal on the
    // SPO Items tab posts to SaveCompleteDate. SetJobComplete is the modal's
    // "Set the Status of the job to complete" box - left off, the job is already closed.
    async function markSPOCompleted(poId, token) {
        var fd = new FormData();
        fd.append('Id', '');
        fd.append('CompleteAll', 'true');
        fd.append('PurchaseOrderId', poId);
        fd.append('CompleteDate', getTodayDate());
        fd.append('SetJobComplete', 'false');
        fd.append('__RequestVerificationToken', token);

        var text = await jlFetch('/SubContractorPO/SaveCompleteDate', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                '__RequestVerificationToken': token
            },
            body: fd
        }, 'SaveCompleteDate');

        var result = (function () { try { return JSON.parse(text); } catch (e) { return {}; } })();
        if (result.success === false || result.Success === false) {
            throw new Error(result.Message || result.message || result.errors?.join(', ') || 'API returned failure');
        }
        return result;
    }

    // --- SELL IMPACT ESTIMATE ---
    // Delivering a supplier PO / completing a subcontractor PO is what creates the job
    // cost line - nothing is on the job beforehand. Joblogic prices that line at
    // cost x (1 + uplift), where uplift is the job's Selling Rate MaterialUplift (supplier
    // POs) or SubcontractorUplift (SPOs). Verified on RE0025984: SPO £20,000 cost ->
    // Subcontractor line 9.53% uplift, £21,906 sell, chargeable.
    // Exception: a job with a QuotedValue (raised from a quote) is billed at the quote, so
    // the line goes in non-chargeable - uplift -100%, sell £0, IsQuotedValue=true. Verified
    // on PROJ0002522 / PROJ0002534. A "Non - Chargeable" selling rate also gives £0 sell.
    // It's an estimate: part-library sell prices or a manual edit can override the uplift.

    function parseMoney(v) {
        if (typeof v === 'number') return v;
        var n = parseFloat(String(v || '').replace(/[^0-9.\-]/g, ''));
        return isNaN(n) ? 0 : n;
    }

    function fmtMoney(n) {
        return '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    // Pull a `var Name = {...}` object literal out of a Joblogic HTML partial.
    function extractJsObject(html, name) {
        var i = html.indexOf(name);
        if (i < 0) return null;
        var start = html.indexOf('{', i);
        var depth = 0, inStr = false, esc = false;
        for (var k = start; k < html.length; k++) {
            var c = html[k];
            if (inStr) {
                if (esc) esc = false;
                else if (c === '\\') esc = true;
                else if (c === '"') inStr = false;
                continue;
            }
            if (c === '"') inStr = true;
            else if (c === '{') depth++;
            else if (c === '}' && --depth === 0) return JSON.parse(html.slice(start, k + 1));
        }
        return null;
    }

    // Cost (ex VAT) of the PO lines that this run would deliver/complete.
    async function getOutstandingPOCost(poId, spo) {
        var headers = { 'X-Requested-With': 'XMLHttpRequest' };
        var lines;
        if (spo) {
            var json = JSON.parse(await jlFetch('/SubContractorPO/GetLineItemsJson?purchaseOrderId=' + poId, { credentials: 'same-origin', headers: headers }, 'SPO lines'));
            lines = (json.AdditionalData || []).filter(function (l) { return l.IsRequired && !l.Completed; });
        } else {
            var html = await jlFetch('/PurchaseOrder/GetLineItems?purchaseOrderId=' + poId, { credentials: 'same-origin', headers: headers }, 'PO lines');
            var model = extractJsObject(html, 'PurchaseOrdersCost');
            lines = ((model && model.Items) || []).filter(function (l) { return !l.Delivered && !l.IsNotRequired && !l.IsReturned; });
        }
        return {
            count: lines.length,
            cost: lines.reduce(function (sum, l) { return sum + parseMoney(l.TotalExcludingVATAndDiscount || l.SubTotal); }, 0)
        };
    }

    async function getJobSellingRate(jobId) {
        if (jobRateCache.has(jobId)) return jobRateCache.get(jobId);
        var html = await jlFetch('/Job/GetCosts?jobId=' + jobId + '&isReadOnly=False', { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } }, 'Job costs');
        var pm = extractJsObject(html, 'JobLinesPM') || {};
        var rate = { rateId: pm.SellingRateId || null, rateName: pm.SellingRateDescription || '', quotedValue: parseMoney(pm.QuotedValue) };
        jobRateCache.set(jobId, rate);
        return rate;
    }

    async function getRateUplifts(rateId) {
        if (rateUpliftCache.has(rateId)) return rateUpliftCache.get(rateId);
        var html = await jlFetch('/SellingRate/Detail/' + rateId, { credentials: 'same-origin' }, 'Selling rate');
        function grab(key) { var m = html.match(new RegExp('"' + key + '"\\s*:\\s*(-?[0-9.]+)')); return m ? parseFloat(m[1]) : null; }
        var uplifts = { material: grab('MaterialUplift'), subcontractor: grab('SubcontractorUplift') };
        rateUpliftCache.set(rateId, uplifts);
        return uplifts;
    }

    // Returns { cost, sell, uplift, rateName, note } or throws.
    async function estimateSellImpact(po, job, spo) {
        var out = await getOutstandingPOCost(po.id, spo);
        var jobId = po.jobId || job.id;
        var rate = jobId ? await getJobSellingRate(jobId) : { rateId: null, rateName: '', quotedValue: 0 };
        if (rate.quotedValue > 0) return { cost: out.cost, sell: 0, uplift: null, rateName: rate.rateName, lines: out.count, note: 'quoted job (' + fmtMoney(rate.quotedValue) + ') - goes in non-chargeable' };
        if (/non\s*-?\s*chargeable/i.test(rate.rateName)) return { cost: out.cost, sell: 0, uplift: null, rateName: rate.rateName, lines: out.count, note: 'non-chargeable selling rate' };
        if (!rate.rateId) return { cost: out.cost, sell: null, uplift: null, rateName: '', lines: out.count };
        var uplifts = await getRateUplifts(rate.rateId);
        var uplift = spo ? uplifts.subcontractor : uplifts.material;
        if (uplift == null) return { cost: out.cost, sell: null, uplift: null, rateName: rate.rateName, lines: out.count };
        return { cost: out.cost, sell: Math.round(out.cost * (1 + uplift / 100) * 100) / 100, uplift: uplift, rateName: rate.rateName, lines: out.count };
    }

    // --- JOB LIST (TSV) ---
    // Header row required. Columns found by name: Job (required), Action (required),
    // PO (optional - the 8-char id prefix from the sell-impact export, narrows to that PO).
    // Action: anything containing "non" -> set Non-Chargeable; deliver/complete/chargeable/yes
    // -> normal; skip/no/blank -> leave alone.
    function parseJobList(text) {
        var lines = String(text || '').split(/\r?\n/).filter(function (l) { return l.trim(); });
        if (!lines.length) return null;
        var head = lines[0].split('\t').map(function (h) { return h.trim().toLowerCase(); });
        var jc = head.indexOf('job'), ac = head.indexOf('action'), pc = head.indexOf('po');
        if (jc < 0 || ac < 0) throw new Error('Job list needs a header row with "Job" and "Action" columns (tab-separated)');
        var entries = [], bad = [];
        lines.slice(1).forEach(function (l, n) {
            var c = l.split('\t');
            var job = (c[jc] || '').trim().toUpperCase();
            var a = (c[ac] || '').trim().toLowerCase();
            if (!job) return;
            var action = /non/.test(a) ? 'nonchg' : /deliver|complete|chargeable|yes|^y$|ok/.test(a) ? 'deliver' : /skip|^no$|^n$|^$/.test(a) ? 'skip' : null;
            if (!action) { bad.push('row ' + (n + 2) + ' "' + a + '"'); return; }
            entries.push({ job: job, action: action, po: pc >= 0 ? (c[pc] || '').trim().toLowerCase() : '' , matched: 0 });
        });
        return { entries: entries, bad: bad };
    }

    function findListEntry(list, po) {
        var job = (po.jobNo || '').toUpperCase();
        for (var i = 0; i < list.entries.length; i++) {
            var e = list.entries[i];
            if (e.job === job && (!e.po || po.id.toLowerCase().indexOf(e.po) === 0)) return e;
        }
        return null;
    }

    // --- SET SPO COST LINES NON-CHARGEABLE ---
    // Same request the job Costs tab "Edit Subcontractor Cost" form sends when Chargeable
    // type = Non-Chargeable. Body rebuilt from GetEditSubcontractorCostMetadata; verified
    // field-for-field against the form's own payload on Test site job RE0025984. Only
    // IsChargeable / PriceCalculationType / Uplift / SellPerHour differ from a plain save.
    function parseJlDateTime(s) {
        var m = String(s || '').match(/(\d+)\/(\d+)\/(\d+)\s+(\d+):(\d+)/);
        return m ? new Date(+m[3], m[2] - 1, +m[1], +m[4], +m[5]) : null;
    }

    function buildSubcontractorCostBody(md) {
        var a = parseJlDateTime(md.DateIncurred), e = parseJlDateTime(md.EndDate);
        var mins = (a && e) ? Math.round((e - a) / 60000) : 60;
        var f = function (n) { return (Number(n) || 0).toFixed(2); };
        return {
            Id: md.Id, CostPerUnit: '0.00', CostPerHour: f(md.CostPerHour), Uplift: '0.00', SellPerUnit: '0.00', SellPerHour: '0.00',
            TaxCodeId: md.TaxCodeId, TaxCodeValue: md.TaxCodeValue, TaxCodeDescription: md.TaxCodeDescription,
            IsChargeable: false, PriceCalculationType: '0',
            Description: md.Description, CreatePayBandAllowed: md.CreatePayBandAllowed,
            SubcontractorId: md.SubcontractorId, SubcontractorName: md.SubcontractorName,
            Hours: Math.floor(mins / 60), Minutes: mins % 60, DateIncurred: md.DateIncurred, EndDate: md.EndDate,
            HasQuote: md.HasQuote, ItemId: md.ItemId || 0, JobLineOption: 7,
            QuotedValueTaxCodeId: md.QuotedValueTaxCodeId, QuotedValueTaxCodeDescription: md.QuotedValueTaxCodeDescription,
            CurrencySymbol: md.CurrencySymbol, AssignType: md.AssignType, DepotId: null, StoreId: null, Discount: '0.00',
            TagIds: md.TagIds || [], Status: 'Required', LimitedSORAccess: false, SellingRateId: null,
            IsManuallyModified: null, ModifiedFields: null, JobId: md.JobId
        };
    }

    async function getSPOLines(poId) {
        var json = JSON.parse(await jlFetch('/SubContractorPO/GetLineItemsJson?purchaseOrderId=' + poId, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } }, 'SPO lines'));
        return json.AdditionalData || [];
    }

    // Returns how many job cost lines were switched to Non-Chargeable.
    async function setSPOLinesNonChargeable(poId, lineIds, token) {
        var lines = (await getSPOLines(poId)).filter(function (l) { return lineIds.indexOf(l.Id) !== -1; });
        var changed = 0;
        for (var i = 0; i < lines.length; i++) {
            var l = lines[i];
            if (!l.JobLineId) throw new Error('SPO line "' + (l.Description || '').trim() + '" has no job cost line after completion');
            var mdUrl = '/api/JobCost/GetEditSubcontractorCostMetadata?id=' + l.JobLineId + '&jobId=' + l.JobId;
            var md = JSON.parse(await jlFetch(mdUrl, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } }, 'Cost line')).AdditionalData;
            if (!md || md.Id !== l.JobLineId || md.JobId !== l.JobId) throw new Error('cost line ' + l.JobLineId + ' metadata did not match');
            if (md.IsChargeable === false) continue; // already non-chargeable (e.g. quoted job)
            var text = await jlFetch('/api/JobLine/SaveSubcontractorCost', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json', '__RequestVerificationToken': token },
                body: JSON.stringify(buildSubcontractorCostBody(md))
            }, 'SaveSubcontractorCost');
            var res = (function () { try { return JSON.parse(text); } catch (e) { return {}; } })();
            if (res.success === false) throw new Error(res.Message || (res.errors || []).join(', ') || 'cost line save failed');
            changed++;
        }
        return changed;
    }

    // --- MAIN PROCESS ---

    async function startProcess() {
        if (running) return;
        running = true;
        startBtn.style.display = 'none';
        stopBtn.style.display = 'inline-block';
        logArea.innerHTML = '';

        var dryRun = document.getElementById('jl-autodeliver-dryrun').checked;
        var spo = isSubcontractorPage();
        var doneLabel = spo ? 'Completed' : 'Fully Delivered';
        var showImpact = document.getElementById('jl-autodeliver-sell-impact').checked;
        var jobList = null;
        try { jobList = parseJobList(document.getElementById('jl-autodeliver-joblist').value); }
        catch (e) { log('ERROR: ' + e.message, '#f55'); running = false; startBtn.style.display = 'inline-block'; stopBtn.style.display = 'none'; return; }
        var skipPartial = document.getElementById('jl-autodeliver-skip-partial').checked;
        jobStatusCache = new Map();
        lastRequestAt = 0;
        currentInterval = MIN_REQUEST_INTERVAL;
        wafBlocks = 0;
        cacheSaves = 0;
        jobRateCache = new Map();
        rateUpliftCache = new Map();

        log('Auto-Deliver POs v' + SCRIPT_VERSION, '#888');
        log(dryRun ? 'DRY RUN MODE - No changes will be made' : 'LIVE MODE - POs will be marked as delivered!', dryRun ? '#ff0' : '#f55');
        log('Closed statuses: ' + CLOSED_STATUSES.join(', '), '#888');
        log('Request pacing: 1 per ' + MIN_REQUEST_INTERVAL + 'ms (~' + Math.round(60000 / MIN_REQUEST_INTERVAL) + '/min) to stay under the gateway rate limit', '#888');
        log('Skip partially delivered: ' + skipPartial, '#888');
        log('Page: ' + (spo ? 'Subcontractor POs (will mark as Completed)' : 'Supplier POs (will mark as Fully Delivered)'), '#888');
        if (jobList) {
            var cnt = { deliver: 0, nonchg: 0, skip: 0 };
            jobList.entries.forEach(function (e) { cnt[e.action]++; });
            log('Job list: ' + jobList.entries.length + ' row(s) - ' + cnt.deliver + ' Deliver, ' + cnt.nonchg + ' Non-Chargeable, ' + cnt.skip + ' Skip. Only listed jobs will be processed.', '#0af');
            if (jobList.bad.length) log('  Unrecognised Action values (ignored): ' + jobList.bad.join('; '), '#fa0');
            if (cnt.nonchg && !spo) log('  Non-Chargeable is only supported on the Subcontractor PO page - those rows will be skipped here', '#fa0');
        }

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
                log('No undelivered POs found. Make sure you are on the Purchase Orders or Subcontractor Purchase Orders page.', '#fa0');
                setProgress('No target POs found.');
                return;
            }

            if (jobList) {
                var before = targetPOs.length;
                targetPOs = targetPOs.filter(function (po) {
                    var e = findListEntry(jobList, po);
                    if (!e) return false;
                    e.matched++;
                    po.listAction = e.action;
                    return e.action !== 'skip';
                });
                log('Job list matched ' + targetPOs.length + ' of ' + before + ' target POs', '#0af');
                var unmatched = jobList.entries.filter(function (e) { return !e.matched && e.action !== 'skip'; });
                if (unmatched.length) log('  Not found among outstanding POs (' + unmatched.length + '): ' + unmatched.map(function (e) { return e.job + (e.po ? '/' + e.po : ''); }).join(', '), '#fa0');
            }

            // Step 2: Process each PO
            var processed = 0;
            var delivered = 0;
            var skippedJobOpen = 0;
            var skippedNoJob = 0;
            var errors = 0;
            var impactCost = 0, impactSell = 0, impactUnknown = 0, impactInvoicedSell = 0, impactInvoicedJobs = 0;
            var impactNonChargeable = 0, impactNonChargeableCost = 0;
            var nonChgSet = 0, nonChgPOs = 0;

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

                    var wantNonChg = po.listAction === 'nonchg';
                    if (wantNonChg && !spo) {
                        log('PO -> ' + po.jobNo + ' - Non-Chargeable requested but only supported for subcontractor POs, skipping', '#fa0');
                        continue;
                    }

                    log('PO ' + po.id.substring(0, 8) + '... -> ' + po.jobNo + ' [' + job.statusDescription + '] - ' + (spo ? 'completion' : 'delivery') + ': ' + po.rawStatus + (wantNonChg ? '  [list: Non-Chargeable]' : po.listAction ? '  [list: Deliver]' : ''), '#aaf');

                    // Must run before delivering - afterwards the lines are no longer outstanding.
                    if (showImpact) {
                        try {
                            var imp = await estimateSellImpact(po, job, spo);
                            if (wantNonChg && !imp.note) imp = { cost: imp.cost, sell: 0, note: 'set Non-Chargeable from your job list' };
                            var verb = dryRun ? 'would add' : 'adds';
                            impactCost += imp.cost;
                            if (imp.note) {
                                impactNonChargeable++;
                                impactNonChargeableCost += imp.cost;
                                log('  Job sell ' + verb + ' £0.00 - cost ' + fmtMoney(imp.cost) + ', ' + imp.note, '#888');
                            } else if (imp.sell == null) {
                                impactUnknown++;
                                log('  Job sell ' + verb + ' ? - cost ' + fmtMoney(imp.cost) + (imp.rateName ? ', no ' + (spo ? 'subcontractor' : 'material') + ' uplift on rate "' + imp.rateName + '"' : ', job has no selling rate'), '#fa0');
                            } else {
                                impactSell += imp.sell;
                                log('  Job sell ' + verb + ' ' + fmtMoney(imp.sell) + ' (cost ' + fmtMoney(imp.cost) + ' + ' + imp.uplift + '% ' + (spo ? 'subcontractor' : 'material') + ' uplift, rate "' + imp.rateName + '")', imp.sell > 0 ? '#ffd27f' : '#888');
                            }
                            if (job.statusDescription.includes('invoiced') && imp.sell !== 0 && imp.cost > 0) {
                                impactInvoicedJobs++;
                                impactInvoicedSell += imp.sell || 0;
                                log('  ⚠ Job is already invoiced - this sell will sit uninvoiced on the job', '#f90');
                            }
                        } catch (e) {
                            if (e.message === 'stopped') throw e;
                            log('  Could not estimate sell impact: ' + e.message, '#fa0');
                            impactUnknown++;
                        }
                    }

                    if (!dryRun) {
                        try {
                            // Remember which lines this completion covers, so only those get flipped.
                            var outstandingIds = wantNonChg ? (await getSPOLines(po.id)).filter(function (l) { return l.IsRequired && !l.Completed; }).map(function (l) { return l.Id; }) : [];
                            if (spo) await markSPOCompleted(po.id, token);
                            else await markPODelivered(po.id, token);
                            log('  Marked as ' + doneLabel, '#0fa');
                            delivered++;
                            if (wantNonChg) {
                                try {
                                    var n = await setSPOLinesNonChargeable(po.id, outstandingIds, token);
                                    nonChgSet += n; nonChgPOs++;
                                    log('  Set ' + n + ' job cost line(s) to Non-Chargeable' + (n < outstandingIds.length ? ' (' + (outstandingIds.length - n) + ' already non-chargeable)' : ''), '#0fa');
                                } catch (e) {
                                    if (e.message === 'stopped') throw e;
                                    log('  ERROR setting Non-Chargeable (PO IS completed - fix the cost line by hand): ' + e.message, '#f55');
                                    errors++;
                                }
                            }
                        } catch (e) {
                            log('  ERROR delivering: ' + e.message, '#f55');
                            errors++;
                        }
                    } else {
                        log('  [DRY RUN] Would mark as ' + doneLabel + (wantNonChg ? ' and set its job cost line(s) Non-Chargeable' : ''), '#ff0');
                        if (wantNonChg) nonChgPOs++;
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
            if (jobList) log('POs ' + (dryRun ? 'that would be ' : '') + 'set Non-Chargeable from job list: ' + nonChgPOs + (dryRun ? '' : ' (' + nonChgSet + ' cost line(s) changed)'), '#0af');
            if (showImpact) {
                log('Job cost ' + (dryRun ? 'that would be ' : '') + 'added: ' + fmtMoney(impactCost), '#ffd27f');
                log('Job sell ' + (dryRun ? 'that would be ' : '') + 'added (est.): ' + fmtMoney(impactSell) + (impactUnknown ? '  (+ ' + impactUnknown + ' PO(s) with unknown uplift)' : ''), '#ffd27f');
                if (impactNonChargeable) log('  ' + impactNonChargeable + ' PO(s) (cost ' + fmtMoney(impactNonChargeableCost) + ') go in non-chargeable - quoted jobs / non-chargeable rate, £0 sell', '#888');
                if (impactInvoicedJobs) log('  of which on already-invoiced jobs: ' + fmtMoney(impactInvoicedSell) + ' across ' + impactInvoicedJobs + ' PO(s)', '#f90');
            }
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
