// ==UserScript==
// @name         Joblogic - Move Jobs to a New Date
// @namespace    https://go.joblogic.com/
// @version      1.01
// @description  On the Job list, paste a list of job numbers and a target date. For each job it finds the latest visit, reads that visit's engineer, and creates a new visit on the chosen date for the same engineer (same time of day + duration). Preview first, then Create. Collapses to a launcher button in the shared dock.
// @match        https://go.joblogic.com/Job*
// @grant        none
// @run-at       document-start
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/joblogic-move-jobs-to-date.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/joblogic-move-jobs-to-date.user.js
// ==/UserScript==

(function () {
    'use strict';

    // =========================================================================
    // SEARCH-JSON CAPTURE  (must run at document-start, before the page's own
    // load-time search fires). The Job list posts a big filter body to
    // /api/Job/SearchJsonData (JSON, needs the anti-forgery token). Rather than
    // reconstruct ~70 filter fields we capture the page's own request and replay
    // it with SearchTerm swapped to the job number we want. Hook both fetch and
    // XHR because JL_SERVICES may use either.
    // =========================================================================
    window.__jlJobSearchBody = window.__jlJobSearchBody || null;
    (function hookSearch() {
        if (window.__jlJobSearchHooked) return;
        window.__jlJobSearchHooked = true;
        const stash = (url, body) => {
            try {
                if (!/\/api\/Job\/SearchJsonData/i.test(url || '')) return;
                if (typeof body !== 'string') { try { body = JSON.stringify(body); } catch (e) { return; } }
                if (body && body[0] === '{') window.__jlJobSearchBody = body;
            } catch (e) {}
        };
        const F = window.fetch;
        if (F) window.fetch = function (u, o) {
            try { stash((typeof u === 'string') ? u : (u && u.url), o && o.body); } catch (e) {}
            return F.apply(this, arguments);
        };
        const proto = XMLHttpRequest.prototype;
        const oOpen = proto.open, oSend = proto.send;
        proto.open = function (m, u) { this.__jlUrl = u; return oOpen.apply(this, arguments); };
        proto.send = function (b) { stash(this.__jlUrl, b); return oSend.apply(this, arguments); };
    })();

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

    const SCRIPT_VERSION = '1.00';   // keep in sync with @version header
    const SCRIPT_ID = 'move-jobs-to-date';
    const SCRIPT_LABEL = '📆 Move Jobs to Date';
    const SCRIPT_COLOR = '#0b7285';
    const SCRIPT_DESC = 'On the Job list, paste job numbers + a target date. For each job it reads the latest visit\'s engineer and creates a new visit on that date for the same engineer. Preview first, then Create.';

    if (window.__jlMoveJobsToDateLoaded) return;
    window.__jlMoveJobsToDateLoaded = true;

    // =========================================================================
    // CONFIG
    // =========================================================================
    const ENGINEERS_URL  = '/Staff/GetEngineers?text=&includeNonLogin=false';
    const SEARCH_URL     = '/api/Job/SearchJsonData';
    const VISITS_URL     = (jobId) => `/api/Visit/GetVisitsJson?&jobId=${jobId}&isAxaJob=false&isReadOnly=false&pageIndex=1&pageSize=200`;
    const ADDVISIT_URL   = '/Scheduler/AddVisit';
    const DELAY_BETWEEN  = 500;    // ms between writes (be gentle on the API)
    const DEFAULT_TIME   = '09:00'; // start time used when the latest visit has no time
    const DEFAULT_MINS   = 60;      // duration used when it can't be derived

    // =========================================================================
    // HELPERS
    // =========================================================================
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const pad2  = n => String(n).padStart(2, '0');
    const norm  = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

    // Anti-forgery token — required as a request header on Scheduler + SearchJsonData POSTs.
    function getToken() {
        const i = document.querySelector('input[name="__RequestVerificationToken"]');
        return i ? i.value : null;
    }

    // Parse a Joblogic "DD/MM/YYYY HH:mm" (time optional) into parts + a sortable key.
    function parseDMY(str) {
        const m = String(str || '').match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2}))?/);
        if (!m) return null;
        const [, d, mo, y, hh, mm] = m;
        return { d, mo, y, hh: hh || null, mm: mm || null,
                 key: `${y}${mo}${d}${hh || '00'}${mm || '00'}` };
    }
    // Minutes between two "DD/MM/YYYY HH:mm" strings (null if not derivable / negative).
    function durationMins(startStr, endStr) {
        const a = parseDMY(startStr), b = parseDMY(endStr);
        if (!a || !b || a.hh == null || b.hh == null) return null;
        const toMin = p => (((new Date(+p.y, +p.mo - 1, +p.d, +p.hh, +p.mm)).getTime()) / 60000);
        const diff = toMin(b) - toMin(a);
        return (diff > 0 && diff < 24 * 60) ? Math.round(diff) : null;
    }
    // "DD/MM/YYYY" + "HH:mm" (+ minutes) -> {start, end} "DD/MM/YYYY HH:mm" strings.
    function makeWindow(dmyDate, timeHHmm, mins) {
        const [d, mo, y] = dmyDate.split('/').map(Number);
        const [hh, mm] = (timeHHmm || DEFAULT_TIME).split(':').map(Number);
        const startD = new Date(y, mo - 1, d, hh, mm);
        const endD = new Date(startD.getTime() + (mins || DEFAULT_MINS) * 60000);
        const fmt = x => `${pad2(x.getDate())}/${pad2(x.getMonth() + 1)}/${x.getFullYear()} ${pad2(x.getHours())}:${pad2(x.getMinutes())}`;
        return { start: fmt(startD), end: fmt(endD) };
    }
    // Native <input type=date> value "YYYY-MM-DD" -> "DD/MM/YYYY".
    function isoToDMY(iso) {
        const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
        return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
    }

    // Split the pasted textarea into a clean, de-duplicated list of job numbers.
    function parseJobNumbers(text) {
        return [...new Set(String(text || '')
            .split(/[\s,;]+/)
            .map(s => s.trim())
            .filter(Boolean))];
    }

    // =========================================================================
    // API CALLS
    // =========================================================================
    let engineersCache = null;   // [{Id, Name}]

    async function loadEngineers() {
        if (engineersCache) return engineersCache;
        const r = await fetch(ENGINEERS_URL, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        if (!r.ok) throw new Error('GetEngineers HTTP ' + r.status);
        const data = await r.json();
        engineersCache = (Array.isArray(data) ? data : []).filter(e => e && e.Id != null && e.Name);
        return engineersCache;
    }
    function resolveEngineerId(name) {
        const want = norm(name);
        if (!want) return null;
        const list = engineersCache || [];
        return (list.find(e => norm(e.Name) === want)
             || list.find(e => norm(e.Name).includes(want))
             || null);
    }

    // Wait for the page's own SearchJsonData body to be captured (fires on load).
    async function ensureSearchBody() {
        for (let i = 0; i < 40 && !window.__jlJobSearchBody; i++) await sleep(150);
        return window.__jlJobSearchBody;
    }

    // Resolve a job number -> its job record {Id, JobNumber, ...} using the page's
    // own captured search body with SearchTerm swapped. Returns null if not found.
    async function resolveJob(jobNumber) {
        const tmpl = window.__jlJobSearchBody;
        if (!tmpl) throw new Error('No search template captured yet');
        let body;
        try { body = JSON.parse(tmpl); } catch (e) { throw new Error('Bad search template'); }
        body.SearchTerm = jobNumber;
        body.QuickSearchTerm = jobNumber;
        body.PageIndex = 1;
        if (!body.PageSize || body.PageSize < 25) body.PageSize = 50;
        const r = await fetch(SEARCH_URL, {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json', '__RequestVerificationToken': getToken() },
            body: JSON.stringify(body)
        });
        if (!r.ok) throw new Error('SearchJsonData HTTP ' + r.status);
        const j = await r.json().catch(() => null);
        const jobs = (j && j.AdditionalData && j.AdditionalData.Jobs) || [];
        const want = norm(jobNumber);
        return jobs.find(x => norm(x.JobNumber) === want) || null;
    }

    // Fetch visits for a job. Returns { visits:[...], typeOfJob, isReactive }.
    async function getJobVisits(jobId) {
        const r = await fetch(VISITS_URL(jobId), { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        if (!r.ok) throw new Error('GetVisitsJson HTTP ' + r.status);
        const j = await r.json();
        const ad = j.AdditionalData || {};
        return { visits: ad.Visits || [], typeOfJob: ad.TypeOfJob, isReactive: ad.IsReactiveJob };
    }
    // The most recent visit by start date/time.
    function latestVisit(visits) {
        let best = null, bestKey = '';
        for (const v of visits || []) {
            const p = parseDMY(v.StartDate);
            const key = p ? p.key : '';
            if (!best || key >= bestKey) { best = v; bestKey = key; }
        }
        return best;
    }

    // Create a new visit for an engineer on a job (Scheduler/AddVisit, FormData +
    // token). deploy=false leaves it as "Not Sent"; deploy=true sends it to the
    // engineer straight away.
    async function addVisit({ jobId, jobNumber, typeOfJob, engineerId, startStr, endStr, deploy, isLocked }) {
        const fd = new FormData();
        fd.append('jobId', jobId);
        fd.append('typeOfJob', typeOfJob);
        fd.append('jobNumber', jobNumber);
        fd.append('deploy', !!deploy);
        fd.append('engineerId', engineerId);
        fd.append('startDate', startStr);
        fd.append('endDate', endStr);
        fd.append('isDateAndTimeLocked', !!isLocked);
        const r = await fetch(ADDVISIT_URL, {
            method: 'POST', credentials: 'same-origin',
            headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json', '__RequestVerificationToken': getToken() },
            body: fd
        });
        const j = await r.json().catch(() => null);
        if (!r.ok) throw new Error('AddVisit HTTP ' + r.status);
        if (j && j.success === false) throw new Error((j.errors && j.errors.join(', ')) || 'AddVisit returned failure');
        return j;
    }

    // =========================================================================
    // BUILD A PLAN  (shared by Preview + Create)
    //
    // For each pasted job number: resolve -> latest visit -> engineer -> compute
    // the new visit window. Returns [{ jobNumber, ok, reason, ...plan }].
    // =========================================================================
    async function buildPlan(jobNumbers, dmyDate) {
        const plan = [];
        for (let i = 0; i < jobNumbers.length; i++) {
            if (!running) break;
            const jn = jobNumbers[i];
            setProgress(`Looking up ${i + 1}/${jobNumbers.length}: ${jn}`);
            const row = { jobNumber: jn, ok: false, reason: '' };
            try {
                const job = await resolveJob(jn);
                if (!job) { row.reason = 'job number not found'; plan.push(row); continue; }
                row.jobId = job.Id;
                row.jobNumberResolved = job.JobNumber;

                const { visits, typeOfJob } = await getJobVisits(job.Id);
                if (!visits.length) { row.reason = 'job has no visits — nothing to copy'; plan.push(row); continue; }
                const lv = latestVisit(visits);
                row.typeOfJob = typeOfJob;
                row.latestStart = lv.StartDate;
                row.latestStatus = lv.StatusDescription;
                row.engineerName = (lv.EngineerName || '').trim();
                row.isLocked = !!lv.IsDateAndTimeLocked;

                if (!row.engineerName) { row.reason = 'latest visit has no engineer (team/subcontractor?) — skipped'; plan.push(row); continue; }
                const eng = resolveEngineerId(row.engineerName);
                if (!eng) { row.reason = `engineer "${row.engineerName}" not found in roster — skipped`; plan.push(row); continue; }
                row.engineerId = eng.Id;

                const p = parseDMY(lv.StartDate);
                const timeHHmm = (p && p.hh != null) ? `${p.hh}:${p.mm}` : DEFAULT_TIME;
                const mins = durationMins(lv.StartDate, lv.EndDate) || DEFAULT_MINS;
                const win = makeWindow(dmyDate, timeHHmm, mins);
                row.startStr = win.start;
                row.endStr = win.end;
                row.ok = true;
            } catch (e) {
                row.reason = 'error: ' + e.message;
            }
            plan.push(row);
            await sleep(120);
        }
        return plan;
    }

    // =========================================================================
    // ACTIONS
    // =========================================================================
    let running = false;
    let lastPlan = [];          // the plan from the most recent Preview (ok rows only)

    function readInputs() {
        const jobNumbers = parseJobNumbers(jobsInputEl ? jobsInputEl.value : '');
        const dmyDate = isoToDMY(dateInputEl ? dateInputEl.value : '');
        return { jobNumbers, dmyDate, deploy: !!(deployEl && deployEl.checked) };
    }

    async function onPreview() {
        if (running) return;
        running = true; setRunningUI(true); clearLog(); lastPlan = [];
        if (runBtn) runBtn.disabled = true;
        try {
            const { jobNumbers, dmyDate } = readInputs();
            if (!getToken()) { log('Could not find the verification token on this page — refresh and try again.', '#f55'); return; }
            if (!jobNumbers.length) { log('Paste at least one job number.', '#f55'); return; }
            if (!dmyDate) { log('Pick a target date first.', '#f55'); return; }

            log('Waiting for the job-list search to be ready…', '#0af');
            if (!await ensureSearchBody()) {
                log('Could not capture the job-list search. Run a normal search on this page once, then Preview again.', '#f55');
                return;
            }
            await loadEngineers();
            log(`Target date: ${dmyDate}  •  ${jobNumbers.length} job(s) to process`, '#0af');

            const plan = await buildPlan(jobNumbers, dmyDate);
            lastPlan = plan.filter(r => r.ok);

            log('', '#ccc');
            log('========== PREVIEW ==========', '#0fa');
            for (const r of plan) {
                if (r.ok) {
                    log(`✓ ${r.jobNumberResolved}  →  ${r.engineerName}  |  ${r.startStr}  (from latest ${r.latestStatus || '?'} visit ${r.latestStart || ''})`, '#0fa');
                } else {
                    log(`✗ ${r.jobNumber}  —  ${r.reason}`, '#f77');
                }
            }
            const okN = lastPlan.length, skipN = plan.length - okN;
            log('', '#ccc');
            log(`Ready to create ${okN} visit(s)${skipN ? `, ${skipN} skipped` : ''}.`, '#0fa');
            setProgress(okN ? `Preview done — ${okN} ready. Click "Create Visits" to commit.` : 'Preview done — nothing to create.');
            if (runBtn) runBtn.disabled = okN === 0;
        } catch (e) {
            log('ERROR: ' + e.message, '#f55');
            setProgress('Error during preview.');
        } finally {
            running = false; setRunningUI(false);
        }
    }

    async function onCreate() {
        if (running) return;
        if (!lastPlan.length) { log('Nothing to create — run Preview first.', '#fa0'); return; }
        const { deploy } = readInputs();
        if (!confirm(`Create ${lastPlan.length} new visit(s)${deploy ? ' and DEPLOY (send) each to its engineer' : ' (as Not Sent)'}?`)) return;

        running = true; setRunningUI(true);
        let created = 0, failed = 0;
        try {
            for (let i = 0; i < lastPlan.length; i++) {
                if (!running) { log('Stopped by user.', '#fa0'); break; }
                const r = lastPlan[i];
                setProgress(`Creating ${i + 1}/${lastPlan.length}: ${r.jobNumberResolved}`);
                log(`${r.jobNumberResolved} | ${r.engineerName} | ${r.startStr}${deploy ? ' | deploy' : ''}`, '#fff');
                try {
                    await addVisit({
                        jobId: r.jobId, jobNumber: r.jobNumberResolved, typeOfJob: r.typeOfJob,
                        engineerId: r.engineerId, startStr: r.startStr, endStr: r.endStr,
                        deploy, isLocked: r.isLocked
                    });
                    created++;
                    log('  created', '#0fa');
                } catch (e) {
                    failed++;
                    log('  FAILED: ' + e.message, '#f55');
                }
                await sleep(DELAY_BETWEEN);
            }
            log('', '#ccc');
            log('========== SUMMARY ==========', '#0fa');
            log(`Created: ${created}  •  Failed: ${failed}`, '#0fa');
            setProgress(`Done — created ${created}, failed ${failed}.`);
            lastPlan = [];
            if (runBtn) runBtn.disabled = true;
        } catch (e) {
            log('Fatal error: ' + e.message, '#f55');
        } finally {
            running = false; setRunningUI(false);
        }
    }

    function onStop() { running = false; setProgress('Stopping…'); }

    // =========================================================================
    // UI
    // =========================================================================
    let panelEl, logArea, progressEl, jobsInputEl, dateInputEl, deployEl, runBtn;
    function setProgress(msg) { if (progressEl) progressEl.textContent = msg; }
    function log(msg, color = '#ccc') {
        if (!logArea) return;
        const line = document.createElement('div');
        line.style.color = color;
        line.textContent = msg ? ('[' + new Date().toLocaleTimeString() + '] ' + msg) : '';
        logArea.appendChild(line);
        logArea.scrollTop = logArea.scrollHeight;
    }
    function clearLog() { if (logArea) logArea.innerHTML = ''; }
    function setRunningUI(isRunning) {
        if (!panelEl) return;
        panelEl.querySelector('.btn-preview').disabled = isRunning;
        panelEl.querySelector('.btn-run').style.display = isRunning ? 'none' : '';
        panelEl.querySelector('.btn-stop').style.display = isRunning ? '' : 'none';
    }

    function buildPanel() {
        if (document.getElementById('jl-movejobs-panel')) return;
        panelEl = document.createElement('div');
        panelEl.id = 'jl-movejobs-panel';
        panelEl.innerHTML = `
<style>
#jl-movejobs-panel { position:fixed; top:10px; right:10px; z-index:99999; background:#1a1a2e; color:#eee; border-radius:8px; width:560px; max-height:88vh; display:flex; flex-direction:column; font-family:monospace; font-size:12px; box-shadow:0 4px 20px rgba(0,0,0,.55); }
#jl-movejobs-panel header { display:flex; justify-content:space-between; align-items:center; padding:10px 14px; border-bottom:1px solid #333; cursor:move; user-select:none; }
#jl-movejobs-panel header b { font-size:13px; }
#jl-movejobs-panel .body { padding:10px 14px; display:flex; flex-direction:column; gap:8px; overflow-y:auto; }
#jl-movejobs-panel .progress { color:#0fa; font-weight:600; min-height:1.4em; }
#jl-movejobs-panel label.fld { display:flex; flex-direction:column; gap:4px; }
#jl-movejobs-panel .fld > span { color:#cbd5e1; font-weight:600; }
#jl-movejobs-panel textarea { background:#0a0a1a; border:1px solid #374151; border-radius:4px; color:#eee; padding:7px; font:12px monospace; min-height:96px; resize:vertical; }
#jl-movejobs-panel input[type=date] { background:#0a0a1a; border:1px solid #374151; border-radius:4px; color:#eee; padding:5px 7px; font:12px monospace; width:160px; }
#jl-movejobs-panel .row { display:flex; gap:14px; align-items:center; flex-wrap:wrap; }
#jl-movejobs-panel .chk { display:flex; align-items:center; gap:7px; cursor:pointer; }
#jl-movejobs-panel button { background:#2563eb; color:#fff; border:0; border-radius:4px; padding:6px 12px; cursor:pointer; font-family:monospace; font-size:12px; }
#jl-movejobs-panel .btn-preview { background:#0891b2; }
#jl-movejobs-panel .btn-run  { background:#16a34a; }
#jl-movejobs-panel .btn-stop { background:#991b1b; display:none; }
#jl-movejobs-panel .btn-close { background:transparent; border:none; color:#eee; font-size:16px; cursor:pointer; }
#jl-movejobs-panel button[disabled] { opacity:.4; cursor:not-allowed; }
#jl-movejobs-panel .controls { display:flex; gap:6px; flex-wrap:wrap; }
#jl-movejobs-panel .hint { color:#6b7280; font-size:11px; line-height:1.45; }
#jl-movejobs-panel .log { background:#0a0a1a; padding:8px; border-radius:4px; overflow-y:auto; max-height:38vh; white-space:pre-wrap; word-break:break-word; }
#jl-movejobs-panel .log div { padding:1px 0; line-height:1.35; }
#jl-movejobs-panel .ver { color:#64748b; font-weight:400; font-size:11px; }
</style>
<header><b>Move Jobs to a New Date <span class="ver">v${SCRIPT_VERSION}</span></b><button class="btn-close">×</button></header>
<div class="body">
  <div class="progress">Paste job numbers, pick a date, then Preview.</div>
  <label class="fld"><span>Job numbers (one per line, or comma/space separated)</span>
    <textarea class="jobs" placeholder="M0000010&#10;M0000011&#10;AT0000004"></textarea>
  </label>
  <div class="row">
    <label class="fld"><span>New date</span><input type="date" class="date"></label>
    <label class="chk"><input type="checkbox" class="deploy"><span>Deploy (send to engineer) — otherwise created as Not Sent</span></label>
  </div>
  <div class="controls">
    <button class="btn-preview">Preview</button>
    <button class="btn-run" disabled>Create Visits</button>
    <button class="btn-stop">Stop</button>
  </div>
  <div class="hint">
    For each job it finds the <b>latest visit</b>, reads that visit's <b>engineer</b>, and creates a
    <b>new visit</b> on the chosen date for the same engineer — keeping the latest visit's time of day and
    duration. The original visit is left untouched. Jobs with no visits, or whose latest visit is a
    team / subcontractor visit, are skipped. <b>Preview</b> shows exactly what will be created; nothing is
    written until you click <b>Create Visits</b>.
  </div>
  <div class="log"></div>
</div>`;
        document.body.appendChild(panelEl);
        jlRegisterPanel(panelEl, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR, SCRIPT_DESC);

        logArea = panelEl.querySelector('.log');
        progressEl = panelEl.querySelector('.progress');
        jobsInputEl = panelEl.querySelector('.jobs');
        dateInputEl = panelEl.querySelector('.date');
        deployEl = panelEl.querySelector('.deploy');
        runBtn = panelEl.querySelector('.btn-run');

        const hdr = panelEl.querySelector('header');
        let drag = null;
        hdr.addEventListener('mousedown', e => { if (e.target.closest('button')) return; drag = { x: e.clientX - panelEl.offsetLeft, y: e.clientY - panelEl.offsetTop }; });
        window.addEventListener('mouseup', () => drag = null);
        window.addEventListener('mousemove', e => { if (!drag) return; panelEl.style.left = (e.clientX - drag.x) + 'px'; panelEl.style.top = (e.clientY - drag.y) + 'px'; panelEl.style.right = 'auto'; });

        panelEl.querySelector('.btn-close').onclick = () => { panelEl.style.display = 'none'; };
        panelEl.querySelector('.btn-preview').onclick = onPreview;
        panelEl.querySelector('.btn-run').onclick = onCreate;
        panelEl.querySelector('.btn-stop').onclick = onStop;
        // Invalidate a stale plan if the user edits inputs after previewing.
        const invalidate = () => { if (lastPlan.length && runBtn) { runBtn.disabled = true; lastPlan = []; setProgress('Inputs changed — Preview again before creating.'); } };
        jobsInputEl.addEventListener('input', invalidate);
        dateInputEl.addEventListener('change', invalidate);
    }

    // =========================================================================
    // BOOT
    // =========================================================================
    function boot() {
        if (!document.body) { setTimeout(boot, 400); return; }
        buildPanel();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
