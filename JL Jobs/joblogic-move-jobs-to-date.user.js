// ==UserScript==
// @name         Joblogic - Move Jobs to a New Date
// @namespace    https://go.joblogic.com/
// @version      2.00
// @description  On the Job list, paste a block of "PMxxxx/nnn - Move to WC|MC: date" lines. For each job it finds the visit and MOVES it (same engineer) to the new window — WC = that Mon–Fri working week, MC = 1st of month + 28 days. Headers and blank lines are ignored. Preview first, then Move. Collapses to a launcher button in the shared dock.
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

    const SCRIPT_VERSION = '2.00';   // keep in sync with @version header
    const SCRIPT_ID = 'move-jobs-to-date';
    const SCRIPT_LABEL = '📆 Move Jobs to Date';
    const SCRIPT_COLOR = '#0b7285';
    const SCRIPT_DESC = 'On the Job list, paste "PMxxxx/nnn - Move to WC|MC: date" lines. Each job\'s visit is MOVED (same engineer) to the new window — WC = that Mon–Fri week, MC = 1st of month for 28 days. Headers/blanks ignored. Preview first, then Move.';

    if (window.__jlMoveJobsToDateLoaded) return;
    window.__jlMoveJobsToDateLoaded = true;

    // =========================================================================
    // CONFIG
    // =========================================================================
    const SEARCH_URL     = '/api/Job/SearchJsonData';
    const VISITS_URL     = (jobId) => `/api/Visit/GetVisitsJson?&jobId=${jobId}&isAxaJob=false&isReadOnly=false&pageIndex=1&pageSize=200`;
    const UPDATE_URL     = '/Scheduler/UpdateVisit';
    const DELAY_BETWEEN  = 500;      // ms between writes (be gentle on the API)
    const WORK_START     = '08:00';  // working-day start (visit window start)
    const WORK_END       = '17:00';  // working-day end   (visit window end)
    const MC_DAYS        = 28;        // MC visits run for this many days from the 1st

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

    // Parse a Joblogic "DD/MM/YYYY HH:mm" (time optional) into a sortable key.
    function parseDMY(str) {
        const m = String(str || '').match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2}))?/);
        if (!m) return null;
        const [, d, mo, y, hh, mm] = m;
        return { d, mo, y, hh: hh || null, mm: mm || null, key: `${y}${mo}${d}${hh || '00'}${mm || '00'}` };
    }
    // 2-digit year -> 4-digit (26 -> 2026); leaves 4-digit years alone.
    function fullYear(y) { y = +y; return y < 100 ? 2000 + y : y; }
    // Date -> "DD/MM/YYYY HH:mm".
    function fmtDateTime(dt) { return `${pad2(dt.getDate())}/${pad2(dt.getMonth() + 1)}/${dt.getFullYear()} ${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`; }
    const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // Compute the {start, end} visit window (strings "DD/MM/YYYY HH:mm") for a
    // WC (week-commencing → Mon–Fri) or MC (month-commencing → 1st + 28 days)
    // target. Returns { error } instead if the date can't be parsed.
    function computeWindow(mode, dateStr) {
        const [sh, sm] = WORK_START.split(':').map(Number);
        const [eh, em] = WORK_END.split(':').map(Number);
        if (mode === 'WC') {
            const m = String(dateStr).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
            if (!m) return { error: `bad WC date "${dateStr}" — expected DD/MM/YY` };
            const [, d, mo, y] = m;
            const start = new Date(fullYear(y), +mo - 1, +d, sh, sm);
            if (isNaN(start.getTime()) || +mo < 1 || +mo > 12 || +d < 1 || +d > 31) return { error: `invalid WC date "${dateStr}"` };
            // Friday of the working week that contains the start date.
            const toFri = (5 - start.getDay() + 7) % 7;
            const end = new Date(start.getTime());
            end.setDate(end.getDate() + toFri);
            end.setHours(eh, em, 0, 0);
            return { start: fmtDateTime(start), end: fmtDateTime(end), human: `WC ${pad2(start.getDate())}/${pad2(start.getMonth() + 1)}/${start.getFullYear()} (${dayName[start.getDay()]}→Fri ${pad2(end.getDate())}/${pad2(end.getMonth() + 1)})` };
        }
        if (mode === 'MC') {
            const m = String(dateStr).match(/^(\d{1,2})\/(\d{2,4})$/);
            if (!m) return { error: `bad MC date "${dateStr}" — expected MM/YY` };
            const [, mo, y] = m;
            if (+mo < 1 || +mo > 12) return { error: `invalid MC month "${dateStr}"` };
            const start = new Date(fullYear(y), +mo - 1, 1, sh, sm);
            if (isNaN(start.getTime())) return { error: `invalid MC date "${dateStr}"` };
            const end = new Date(start.getTime());
            end.setDate(end.getDate() + MC_DAYS);
            end.setHours(eh, em, 0, 0);
            return { start: fmtDateTime(start), end: fmtDateTime(end), human: `MC 01/${pad2(+mo)}/${fullYear(y)} (+${MC_DAYS}d → ${pad2(end.getDate())}/${pad2(end.getMonth() + 1)})` };
        }
        return { error: `unknown mode "${mode}"` };
    }

    // Parse the pasted block into targets. One target per line matching
    //   "<jobNumber> - Move to WC|MC: <date>"
    // Blank lines and header lines (no job number) are ignored.
    // jobNumber examples: PM0000495/129, M0000027, AT0000004.
    function parseTargets(text) {
        const re = /^([A-Za-z]{1,5}\d+(?:\/\d+)?)\s*-\s*move\s*to\s*(wc|mc)\s*:\s*([0-9/]+)\s*$/i;
        const out = [];
        for (const raw of String(text || '').split(/\r?\n/)) {
            const line = raw.trim();
            if (!line) continue;
            const m = line.match(re);
            if (!m) continue;   // header / commentary / unrecognised — skip silently
            const jobNumber = m[1].trim();
            const mode = m[2].toUpperCase();
            const dateStr = m[3].trim();
            const win = computeWindow(mode, dateStr);
            out.push({ jobNumber, mode, dateStr, start: win.start, end: win.end, human: win.human, error: win.error });
        }
        return out;
    }

    // =========================================================================
    // API CALLS
    // =========================================================================

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
        // Exact match on job number first, then a forgiving "starts-with" fallback.
        return jobs.find(x => norm(x.JobNumber) === want)
            || jobs.find(x => norm(x.JobNumber).replace(/\s+/g, '') === want.replace(/\s+/g, ''))
            || null;
    }

    // Fetch visits for a job. Returns { visits:[...], typeOfJob }.
    async function getJobVisits(jobId) {
        const r = await fetch(VISITS_URL(jobId), { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        if (!r.ok) throw new Error('GetVisitsJson HTTP ' + r.status);
        const j = await r.json();
        const ad = j.AdditionalData || {};
        return { visits: ad.Visits || [], typeOfJob: ad.TypeOfJob };
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

    // Move a visit to a new window (Scheduler/UpdateVisit, FormData + token). The
    // engineer/subcontractor already on the visit is kept — it is not in the
    // payload. deploy=true re-sends it to the engineer; false just re-dates it.
    async function moveVisit({ visitId, jobId, jobNumber, typeOfJob, isTeamVisit, deploy, startStr, endStr }) {
        const fd = new FormData();
        fd.append('id', visitId);
        fd.append('jobId', jobId);
        fd.append('jobNumber', jobNumber);
        fd.append('typeOfJob', typeOfJob);
        fd.append('isTeamVisit', !!isTeamVisit);
        fd.append('isCopy', false);
        fd.append('deploy', !!deploy);
        fd.append('startDate', startStr);
        fd.append('endDate', endStr);
        const r = await fetch(UPDATE_URL, {
            method: 'POST', credentials: 'same-origin',
            headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json', '__RequestVerificationToken': getToken() },
            body: fd
        });
        const j = await r.json().catch(() => null);
        if (!r.ok) throw new Error('UpdateVisit HTTP ' + r.status);
        if (!j || j.success !== true) throw new Error((j && j.errors && j.errors.join(', ')) || 'UpdateVisit returned failure');
        return j;
    }

    // =========================================================================
    // BUILD A PLAN  (shared by Preview + Move)
    //
    // For each parsed target: resolve -> latest visit -> compute the new window.
    // Flags a conflict when the same job number is targeted at two different
    // windows in the same paste. Returns [{ ...target, ok, reason, ... }].
    // =========================================================================
    async function buildPlan(targets) {
        // Group by job number to detect conflicting duplicates.
        const byJob = {};
        targets.forEach(t => { (byJob[t.jobNumber] = byJob[t.jobNumber] || []).push(t); });

        const plan = [];
        for (let i = 0; i < targets.length; i++) {
            if (!running) break;
            const t = targets[i];
            setProgress(`Looking up ${i + 1}/${targets.length}: ${t.jobNumber}`);
            const row = { ...t, ok: false, reason: '' };

            const grp = byJob[t.jobNumber];
            if (grp.length > 1 && new Set(grp.map(x => `${x.start}|${x.end}`)).size > 1) row.conflict = true;

            if (t.error) { row.reason = t.error; plan.push(row); continue; }
            try {
                const job = await resolveJob(t.jobNumber);
                if (!job) { row.reason = 'job number not found on the Job list'; plan.push(row); continue; }
                row.jobId = job.Id;
                row.jobNumberResolved = job.JobNumber;

                const { visits, typeOfJob } = await getJobVisits(job.Id);
                if (!visits.length) { row.reason = 'job has no visits to move'; plan.push(row); continue; }
                const lv = latestVisit(visits);
                row.visitId = lv.Id;
                row.typeOfJob = typeOfJob;
                row.engineerName = (lv.EngineerName || '').trim();
                row.latestStart = lv.StartDate;
                row.latestStatus = lv.StatusDescription;
                // GetVisitsJson doesn't expose IsTeamVisit; an engineer name means
                // it's an engineer visit. A blank name is likely team/subcontractor.
                row.isTeamVisit = !row.engineerName;
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
    let lastPlan = [];          // ok rows from the most recent Preview

    function readInputs() {
        return {
            targets: parseTargets(jobsInputEl ? jobsInputEl.value : ''),
            deploy: !!(deployEl && deployEl.checked)
        };
    }

    async function onPreview() {
        if (running) return;
        running = true; setRunningUI(true); clearLog(); lastPlan = [];
        if (runBtn) runBtn.disabled = true;
        try {
            const { targets } = readInputs();
            if (!getToken()) { log('Could not find the verification token on this page — refresh and try again.', '#f55'); return; }
            if (!targets.length) { log('No "… - Move to WC|MC: date" lines found. Paste your list and try again.', '#f55'); return; }

            log('Waiting for the job-list search to be ready…', '#0af');
            if (!await ensureSearchBody()) {
                log('Could not capture the job-list search. Run a normal search on this page once, then Preview again.', '#f55');
                return;
            }
            log(`${targets.length} line(s) parsed. Looking them up…`, '#0af');

            const plan = await buildPlan(targets);
            lastPlan = plan.filter(r => r.ok);

            log('', '#ccc');
            log('========== PREVIEW ==========', '#0fa');
            for (const r of plan) {
                if (r.ok) {
                    const eng = r.engineerName || '⚠ no engineer (team/subcontractor?)';
                    const warn = r.conflict ? '  ⚠ SAME JOB targeted twice — last one wins' : '';
                    log(`✓ ${r.jobNumberResolved}  →  ${eng}\n     ${r.human}   [${r.start} → ${r.end}]\n     (was ${r.latestStart || '?'}, ${r.latestStatus || '?'})${warn}`, r.conflict ? '#fd0' : '#0fa');
                } else {
                    log(`✗ ${r.jobNumber}  —  ${r.reason}`, '#f77');
                }
            }
            const okN = lastPlan.length, skipN = plan.length - okN;
            log('', '#ccc');
            log(`Ready to move ${okN} visit(s)${skipN ? `, ${skipN} skipped` : ''}.`, '#0fa');
            setProgress(okN ? `Preview done — ${okN} ready. Click "Move Visits" to commit.` : 'Preview done — nothing to move.');
            if (runBtn) runBtn.disabled = okN === 0;
        } catch (e) {
            log('ERROR: ' + e.message, '#f55');
            setProgress('Error during preview.');
        } finally {
            running = false; setRunningUI(false);
        }
    }

    async function onMove() {
        if (running) return;
        if (!lastPlan.length) { log('Nothing to move — run Preview first.', '#fa0'); return; }
        const { deploy } = readInputs();
        if (!confirm(`Move ${lastPlan.length} visit(s) to their new dates${deploy ? ' and DEPLOY (re-send) each to its engineer' : ''}?\n\nThe original date is replaced. This cannot be auto-undone.`)) return;

        running = true; setRunningUI(true);
        let moved = 0, failed = 0;
        try {
            for (let i = 0; i < lastPlan.length; i++) {
                if (!running) { log('Stopped by user.', '#fa0'); break; }
                const r = lastPlan[i];
                setProgress(`Moving ${i + 1}/${lastPlan.length}: ${r.jobNumberResolved}`);
                log(`${r.jobNumberResolved} | ${r.engineerName || '(no engineer)'} | ${r.start} → ${r.end}${deploy ? ' | deploy' : ''}`, '#fff');
                try {
                    await moveVisit({
                        visitId: r.visitId, jobId: r.jobId, jobNumber: r.jobNumberResolved,
                        typeOfJob: r.typeOfJob, isTeamVisit: r.isTeamVisit,
                        deploy, startStr: r.start, endStr: r.end
                    });
                    moved++;
                    log('  moved', '#0fa');
                } catch (e) {
                    failed++;
                    log('  FAILED: ' + e.message, '#f55');
                }
                await sleep(DELAY_BETWEEN);
            }
            log('', '#ccc');
            log('========== SUMMARY ==========', '#0fa');
            log(`Moved: ${moved}  •  Failed: ${failed}`, '#0fa');
            setProgress(`Done — moved ${moved}, failed ${failed}.`);
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
    let panelEl, logArea, progressEl, jobsInputEl, deployEl, runBtn;
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
#jl-movejobs-panel { position:fixed; top:10px; right:10px; z-index:99999; background:#1a1a2e; color:#eee; border-radius:8px; width:600px; max-height:88vh; display:flex; flex-direction:column; font-family:monospace; font-size:12px; box-shadow:0 4px 20px rgba(0,0,0,.55); }
#jl-movejobs-panel header { display:flex; justify-content:space-between; align-items:center; padding:10px 14px; border-bottom:1px solid #333; cursor:move; user-select:none; }
#jl-movejobs-panel header b { font-size:13px; }
#jl-movejobs-panel .body { padding:10px 14px; display:flex; flex-direction:column; gap:8px; overflow-y:auto; }
#jl-movejobs-panel .progress { color:#0fa; font-weight:600; min-height:1.4em; }
#jl-movejobs-panel label.fld { display:flex; flex-direction:column; gap:4px; }
#jl-movejobs-panel .fld > span { color:#cbd5e1; font-weight:600; }
#jl-movejobs-panel textarea { background:#0a0a1a; border:1px solid #374151; border-radius:4px; color:#eee; padding:7px; font:12px monospace; min-height:150px; resize:vertical; }
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
  <div class="progress">Paste your list, then Preview.</div>
  <label class="fld"><span>Paste lines — "&lt;job&gt; - Move to WC|MC: date" (headers &amp; blank lines ignored)</span>
    <textarea class="jobs" placeholder="PM0000495/129 - Move to WC: 24/08/26&#10;PM0000603/189 - Move to WC: 24/08/26&#10;&#10;EICR:&#10;PM0000495/290 - Move to WC: 07/09/26&#10;&#10;Emergency Lighting Drain Test:&#10;PM0000495/037 - Move to MC: 12/26"></textarea>
  </label>
  <div class="row">
    <label class="chk"><input type="checkbox" class="deploy"><span>Also deploy (re-send to engineer) after moving</span></label>
  </div>
  <div class="controls">
    <button class="btn-preview">Preview</button>
    <button class="btn-run" disabled>Move Visits</button>
    <button class="btn-stop">Stop</button>
  </div>
  <div class="hint">
    For each line the script finds the job's <b>latest visit</b> and <b>moves it</b> (keeping its engineer) to a new window:
    <b>WC</b> = start on the date given, end on that week's <b>Friday</b> (Mon–Fri, ${WORK_START}–${WORK_END}); date is <b>DD/MM/YY</b>.
    <b>MC</b> = start on the <b>1st</b> of the month and run <b>${MC_DAYS} days</b> (${WORK_START}–${WORK_END}); date is <b>MM/YY</b>.
    Header lines and blank lines are ignored. If the same job appears twice with different dates it's flagged and the last one wins.
    <b>Preview</b> shows the exact new dates before anything is written.
  </div>
  <div class="log"></div>
</div>`;
        document.body.appendChild(panelEl);
        jlRegisterPanel(panelEl, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR, SCRIPT_DESC);

        logArea = panelEl.querySelector('.log');
        progressEl = panelEl.querySelector('.progress');
        jobsInputEl = panelEl.querySelector('.jobs');
        deployEl = panelEl.querySelector('.deploy');
        runBtn = panelEl.querySelector('.btn-run');

        const hdr = panelEl.querySelector('header');
        let drag = null;
        hdr.addEventListener('mousedown', e => { if (e.target.closest('button')) return; drag = { x: e.clientX - panelEl.offsetLeft, y: e.clientY - panelEl.offsetTop }; });
        window.addEventListener('mouseup', () => drag = null);
        window.addEventListener('mousemove', e => { if (!drag) return; panelEl.style.left = (e.clientX - drag.x) + 'px'; panelEl.style.top = (e.clientY - drag.y) + 'px'; panelEl.style.right = 'auto'; });

        panelEl.querySelector('.btn-close').onclick = () => { panelEl.style.display = 'none'; };
        panelEl.querySelector('.btn-preview').onclick = onPreview;
        panelEl.querySelector('.btn-run').onclick = onMove;
        panelEl.querySelector('.btn-stop').onclick = onStop;
        // Invalidate a stale plan if the user edits inputs after previewing.
        const invalidate = () => { if (lastPlan.length && runBtn) { runBtn.disabled = true; lastPlan = []; setProgress('Inputs changed — Preview again before moving.'); } };
        jobsInputEl.addEventListener('input', invalidate);
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
