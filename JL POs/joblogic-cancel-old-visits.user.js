// ==UserScript==
// @name         Joblogic - Cancel Old Open Visits
// @namespace    http://tampermonkey.net/
// @version      2.11
// @description  Loops through jobs in the list, finds open visits (New, Accepted, Travelling, On Site, Left Site) scheduled more than a week ago, and cancels them Collapses to a launcher button in the shared dock (drag to reorder).
// @match        https://go.joblogic.com/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20POs/joblogic-cancel-old-visits.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20POs/joblogic-cancel-old-visits.user.js
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

    const SCRIPT_ID = 'cancel-old-visits';
    const SCRIPT_LABEL = '🗑 Cancel Old Visits';
    const SCRIPT_COLOR = '#4c9f01';
    const SCRIPT_DESC = 'Loops through the jobs list and cancels open visits (New, Accepted, Travelling, On Site, Left Site) scheduled more than a week ago. Apply a filter first, then Start.';

    console.log('[JL-CancelVisits] Script loaded');

    // --- CONFIG ---
    const DELAY_BETWEEN_JOBS = 800;
    const DELAY_BETWEEN_CANCELS = 500;
    const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

    // Open visit status descriptions (matched against StatusDescription from API)
    const OPEN_STATUS_NAMES = ['new', 'accepted', 'travelling', 'on site', 'left site'];

    // --- STATE ---
    let panel, logArea, startBtn, stopBtn, progressText;
    let running = false;

    // --- UI ---
    function createUI() {
        if (document.getElementById('jl-cancel-visits-panel')) return;

        panel = document.createElement('div');
        panel.id = 'jl-cancel-visits-panel';
        const container = document.createElement('div');
        container.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;background:#1a1a2e;color:#eee;border-radius:8px;padding:16px;width:540px;max-height:80vh;display:flex;flex-direction:column;font-family:monospace;font-size:12px;box-shadow:0 4px 20px rgba(0,0,0,0.5);';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;';
        const title = document.createElement('strong');
        title.style.fontSize = '14px';
        title.textContent = 'Cancel Old Open Visits';
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
        progressText.textContent = 'Ready. Search for jobs on the Jobs page, then click Start.';
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
        dryLabel.style.cssText = 'margin-left:12px;font-size:11px;';
        const dryCheck = document.createElement('input');
        dryCheck.type = 'checkbox';
        dryCheck.id = 'jl-cancel-dryrun';
        dryCheck.checked = true;
        dryLabel.appendChild(dryCheck);
        dryLabel.appendChild(document.createTextNode(' Dry Run (preview only)'));
        controlsDiv.appendChild(startBtn);
        controlsDiv.appendChild(stopBtn);
        controlsDiv.appendChild(dryLabel);

        logArea = document.createElement('div');
        logArea.style.cssText = 'flex:1;overflow-y:auto;max-height:50vh;background:#111;padding:8px;border-radius:4px;white-space:pre-wrap;line-height:1.5;';

        container.appendChild(header);
        container.appendChild(progressDiv);
        container.appendChild(controlsDiv);
        container.appendChild(logArea);
        panel.appendChild(container);
        document.body.appendChild(panel);
        jlRegisterPanel(panel, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR, SCRIPT_DESC);

        console.log('[JL-CancelVisits] Panel created');
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

    // Collect job IDs from the currently visible DOM
    function getJobsFromDOM() {
        var links = document.querySelectorAll('a[href*="/Job/Detail/"]');
        var jobs = [];
        var seen = {};
        links.forEach(function (a) {
            var match = a.href.match(/Detail\/(\d+)/);
            if (match && !seen[match[1]]) {
                seen[match[1]] = true;
                var row = a.closest('tr');
                var jobNo = row ? row.querySelector('td')?.textContent?.trim() : '';
                jobs.push({ id: match[1], jobNo: jobNo });
            }
        });
        return jobs;
    }

    // Find the Vue paging component
    function getPagingVue() {
        var found = null;
        document.querySelectorAll('*').forEach(function (el) {
            if (el.__vue__?.$options?.name === 'jl-paging' && !found) found = el.__vue__;
        });
        return found;
    }

    // Navigate pager and collect all job IDs across all pages
    async function collectAllJobs() {
        var allJobs = [];
        var seen = {};

        var paging = getPagingVue();
        if (!paging) {
            log('No paging component found - collecting from current page only', '#fa0');
            return getJobsFromDOM();
        }

        var totalPages = paging.pager?.totalPages || 1;
        var totalCount = paging.totalCount || 0;
        log('Found ' + totalCount + ' jobs across ' + totalPages + ' pages', '#0af');

        for (var page = 1; page <= totalPages && running; page++) {
            setProgress('Collecting jobs: page ' + page + '/' + totalPages + ' (' + allJobs.length + ' so far)');

            if (page > 1) {
                paging.onPageClick(page);
                var waited = 0;
                while (waited < 5000) {
                    await sleep(500);
                    waited += 500;
                    var check = getJobsFromDOM();
                    if (check.length > 0 && !seen[check[0].id]) break;
                }
            }

            var pageJobs = getJobsFromDOM();
            var newJobs = 0;
            pageJobs.forEach(function (j) {
                if (!seen[j.id]) {
                    seen[j.id] = true;
                    allJobs.push(j);
                    newJobs++;
                }
            });

            log('Page ' + page + '/' + totalPages + ': ' + newJobs + ' new jobs (total: ' + allJobs.length + ')');

            if (newJobs === 0 && page < totalPages) {
                log('Retrying page ' + page + '...', '#fa0');
                paging.onPageClick(page);
                await sleep(3000);
                pageJobs = getJobsFromDOM();
                pageJobs.forEach(function (j) {
                    if (!seen[j.id]) {
                        seen[j.id] = true;
                        allJobs.push(j);
                        newJobs++;
                    }
                });
                log('Retry: ' + newJobs + ' new jobs (total: ' + allJobs.length + ')');
                if (newJobs === 0) {
                    log('Still no new jobs, stopping collection', '#888');
                    break;
                }
            }
        }

        paging.onPageClick(1);
        return allJobs;
    }

    // Fetch visits for a job using the real Joblogic API
    async function fetchVisitsForJob(jobId) {
        var resp = await fetch('/api/Visit/GetVisitsJson?jobId=' + jobId + '&isActive=true&pageIndex=1&pageSize=100', {
            method: 'GET',
            credentials: 'same-origin',
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });

        if (!resp.ok) throw new Error('HTTP ' + resp.status);

        var data = await resp.json();
        return (data.AdditionalData && data.AdditionalData.Visits) ? data.AdditionalData.Visits : [];
    }

    // Cancel a visit using the real Joblogic API
    async function cancelVisit(visitId, jobId) {
        var resp = await fetch('/api/Visit/CancelVirtualVisit', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: JSON.stringify({ id: visitId, jobId: parseInt(jobId) })
        });

        if (!resp.ok) throw new Error('HTTP ' + resp.status + ': ' + resp.statusText);
        var result = await resp.json().catch(function () { return {}; });
        if (result.success === false) {
            throw new Error(result.Message || result.errors?.join(', ') || 'API returned failure');
        }
        return result;
    }

    // Check if a visit is "open" based on its StatusDescription
    function isOpenVisit(visit) {
        var desc = (visit.StatusDescription || '').trim().toLowerCase();
        return OPEN_STATUS_NAMES.indexOf(desc) !== -1;
    }

    // Parse DD/MM/YYYY HH:mm date format from the API
    function parseVisitDate(dateStr) {
        if (!dateStr) return null;

        // Handle DD/MM/YYYY HH:mm format
        var match = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/);
        if (match) {
            return new Date(
                parseInt(match[3]),     // year
                parseInt(match[2]) - 1, // month (0-indexed)
                parseInt(match[1]),     // day
                parseInt(match[4]),     // hours
                parseInt(match[5])      // minutes
            );
        }

        // Handle DD/MM/YYYY without time
        var dateOnly = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (dateOnly) {
            return new Date(
                parseInt(dateOnly[3]),
                parseInt(dateOnly[2]) - 1,
                parseInt(dateOnly[1])
            );
        }

        // Fallback
        var d = new Date(dateStr);
        return isNaN(d.getTime()) ? null : d;
    }

    // Check if a visit date is more than one week ago
    function isOlderThanOneWeek(visitDate) {
        if (!visitDate) return false;
        var now = new Date();
        var diff = now.getTime() - visitDate.getTime();
        return diff > ONE_WEEK_MS;
    }

    // --- MAIN PROCESS ---

    async function startProcess() {
        if (running) return;
        running = true;
        startBtn.style.display = 'none';
        stopBtn.style.display = 'inline-block';
        logArea.innerHTML = '';

        var dryRun = document.getElementById('jl-cancel-dryrun').checked;
        log(dryRun ? 'DRY RUN MODE - No changes will be made' : 'LIVE MODE - Visits will be cancelled!', dryRun ? '#ff0' : '#f55');
        log('Open statuses: ' + OPEN_STATUS_NAMES.join(', '), '#888');

        try {
            // Step 1: Collect all job IDs from all pages
            log('Collecting job IDs from all pages...', '#0af');
            var allJobs = await collectAllJobs();

            if (!running) { log('Stopped by user.', '#f55'); return; }
            log('Total unique jobs: ' + allJobs.length, '#0fa');

            if (allJobs.length === 0) {
                log('No jobs found! Make sure you are on the Jobs page with search results visible.', '#f55');
                return;
            }

            // Step 2: Process each job
            var jobsProcessed = 0;
            var visitsCancelled = 0;
            var jobsNoOpenVisits = 0;
            var errors = 0;
            var cutoffDate = new Date(Date.now() - ONE_WEEK_MS);

            log('Cutoff date: ' + cutoffDate.toLocaleDateString('en-GB') + ' (visits before this will be cancelled)', '#0af');
            log('');

            for (var i = 0; i < allJobs.length; i++) {
                var job = allJobs[i];
                if (!running) { log('Stopped by user.', '#f55'); break; }

                jobsProcessed++;
                setProgress('Processing ' + jobsProcessed + '/' + allJobs.length + ': ' + job.jobNo);

                try {
                    var visits = await fetchVisitsForJob(job.id);

                    if (!visits || visits.length === 0) {
                        log(job.jobNo + ' - no visits', '#666');
                        jobsNoOpenVisits++;
                        continue;
                    }

                    // Filter for open visits that are older than one week
                    var openOldVisits = [];
                    var openRecentCount = 0;

                    for (var v = 0; v < visits.length; v++) {
                        var visit = visits[v];
                        if (isOpenVisit(visit)) {
                            var visitDate = parseVisitDate(visit.StartDate);
                            if (visitDate && isOlderThanOneWeek(visitDate)) {
                                openOldVisits.push(visit);
                            } else {
                                openRecentCount++;
                            }
                        }
                    }

                    if (openOldVisits.length === 0) {
                        if (openRecentCount > 0) {
                            log(job.jobNo + ' - ' + visits.length + ' visit(s), ' + openRecentCount + ' open but recent', '#666');
                        } else {
                            log(job.jobNo + ' - ' + visits.length + ' visit(s), none are old & open', '#666');
                        }
                        jobsNoOpenVisits++;
                        continue;
                    }

                    log(job.jobNo + ' - ' + openOldVisits.length + ' old open visit(s) to cancel', '#fa0');

                    for (var v = 0; v < openOldVisits.length; v++) {
                        var visit = openOldVisits[v];
                        if (!running) break;

                        var visitDate = parseVisitDate(visit.StartDate);
                        var dateStr = visitDate ? visitDate.toLocaleDateString('en-GB') : visit.StartDate;

                        log('  Visit #' + visit.Id + ' | ' + visit.EngineerName + ' | Status: ' + visit.StatusDescription + ' | Date: ' + dateStr, '#fff');

                        if (!dryRun) {
                            if (!visit.CanCancel) {
                                log('    SKIPPED - API says CanCancel=false', '#fa0');
                                continue;
                            }
                            try {
                                await cancelVisit(visit.Id, job.id);
                                log('    Cancelled OK', '#0fa');
                                visitsCancelled++;
                            } catch (e) {
                                log('    ERROR cancelling: ' + e.message, '#f55');
                                errors++;
                            }
                            await sleep(DELAY_BETWEEN_CANCELS);
                        } else {
                            log('    [DRY RUN] Would cancel' + (visit.CanCancel ? '' : ' (NOTE: CanCancel=false, may fail)'), '#ff0');
                            visitsCancelled++;
                        }
                    }

                } catch (e) {
                    log(job.jobNo + ' - ERROR: ' + e.message, '#f55');
                    errors++;
                }

                await sleep(DELAY_BETWEEN_JOBS);
            }

            // Summary
            log('');
            log('========== SUMMARY ==========', '#0fa');
            log('Jobs processed: ' + jobsProcessed + '/' + allJobs.length, '#0fa');
            log('Jobs with no old open visits: ' + jobsNoOpenVisits, '#888');
            log('Visits cancelled: ' + visitsCancelled, visitsCancelled > 0 ? '#0fa' : '#888');
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
        if (document.getElementById('jl-cancel-visits-panel')) return;
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
