// ==UserScript==
// @name         Joblogic - Auto-Deploy Tomorrow's Visits (18:00 daily)
// @namespace    https://go.joblogic.com/
// @version      1.00
// @description  Every day at 18:00, deploys every Not Sent visit on the Planner scheduled for tomorrow (Friday: Sat + Sun + Mon) to its engineer, across all engineers. Runs from an open Planner tab; Preview shows what would go out. Collapses to a launcher button in the shared dock (drag to reorder).
// @match        https://go.joblogic.com/Scheduler*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/joblogic-auto-deploy-tomorrow.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/joblogic-auto-deploy-tomorrow.user.js
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

    const SCRIPT_VERSION = '1.00';   // keep in sync with @version header
    const SCRIPT_ID = 'auto-deploy-tomorrow';
    const SCRIPT_LABEL = '🚀 Auto-Deploy Tomorrow';
    const SCRIPT_COLOR = '#5f3dc4';
    const SCRIPT_DESC = 'Every day at 18:00, deploys every Not Sent visit on the Planner for tomorrow (Friday: Sat + Sun + Mon) to its engineer. Leave a Planner tab open and logged in. Use Preview to see what would go out.';

    if (window.__jlAutoDeployLoaded) return;
    window.__jlAutoDeployLoaded = true;

    // =========================================================================
    // CONFIG
    // =========================================================================
    const RUN_HOUR = 18, RUN_MINUTE = 0;     // local time the auto-run fires
    const RELOAD_LEAD_MIN = 3;               // reload the Planner this many minutes before, for a fresh session + token
    const RUN_CUTOFF_HOUR = 23;              // don't start a missed run at/after this hour (catch-up window 18:00–22:59)
    const CHECK_EVERY_MS = 30000;            // scheduler tick
    const RETRY_FAILED_RUN_MS = 10 * 60000;  // after a failed auto-run (e.g. logged out), retry at most this often
    const LOCK_STALE_MS = 15 * 60000;        // a run lock older than this is considered abandoned

    // Visits we deploy: StatusDescription "Not Sent" with CanDeploy. Visits that are
    // already New / Read / Accepted have been sent, so they're left alone.
    const ELIGIBLE_STATUSES = ['not sent'];
    const JOB_TYPES = [{ id: 1, label: 'Reactive' }, { id: 2, label: 'PPM' }];
    const DEFAULT_JOB_TYPE_IDS = [1, 2];

    // Azure WAF in front of go.joblogic.com rate-limits per IP — 1400ms is the
    // measured safe pacing; retry 403/429/503 gateway blocks with short backoff.
    const MIN_REQUEST_INTERVAL = 1400;
    const WAF_BACKOFF = [1500, 3000, 6000, 12000, 20000];

    const ENGINEERS_URL = '/Staff/GetEngineers?text=&includeNonLogin=false';
    const SEARCH_URL    = '/Scheduler/SchedulerSearch';
    const DEPLOY_URL    = '/Scheduler/DeployVisit';

    const ENABLED_KEY  = 'jl-autodeploy-enabled-v1';     // '1' = auto-run on
    const JOBTYPE_KEY  = 'jl-autodeploy-jobtypes-v1';    // JSON array of TypeOfJob ids
    const WEEKEND_KEY  = 'jl-autodeploy-friday-weekend-v1'; // '0' = Friday does Saturday only
    const LASTRUN_KEY  = 'jl-autodeploy-lastrun-v1';     // YYYY-MM-DD of last successful auto-run
    const LASTTRY_KEY  = 'jl-autodeploy-lasttry-v1';     // ms timestamp of last auto-run attempt
    const RELOADED_KEY = 'jl-autodeploy-reloaded-v1';    // YYYY-MM-DD the pre-run reload happened
    const LOCK_KEY     = 'jl-autodeploy-lock-v1';        // {tab, ts} — one tab runs at a time
    const SUMMARY_KEY  = 'jl-autodeploy-summary-v1';     // last run summary line
    const LOG_KEY      = 'jl-autodeploy-log-v1';         // last run's log lines (survives reload)

    // =========================================================================
    // HELPERS
    // =========================================================================
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const pad2  = n => String(n).padStart(2, '0');
    const TAB_ID = Math.random().toString(36).slice(2);
    const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
    const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
    const lsDel = k => { try { localStorage.removeItem(k); } catch (e) {} };

    function getToken() {
        const i = document.querySelector('input[name="__RequestVerificationToken"]');
        return i ? i.value : null;
    }
    function ddmmyyyy(d) { return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`; }
    function isoDay(d)   { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
    function dayOf(isoStr)  { const m = String(isoStr || '').match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : ''; }
    function timeOf(isoStr) { const m = String(isoStr || '').match(/T(\d{2}):(\d{2})/); return m ? `${m[1]}:${m[2]}` : '--:--'; }
    function today()       { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
    function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

    const isEnabled = () => lsGet(ENABLED_KEY) === '1';
    const fridayWeekend = () => lsGet(WEEKEND_KEY) !== '0';
    function getJobTypes() {
        try { const v = JSON.parse(lsGet(JOBTYPE_KEY)); if (Array.isArray(v)) return v.map(Number); } catch (e) {}
        return DEFAULT_JOB_TYPE_IDS.slice();
    }

    // The day(s) to deploy: tomorrow. On Friday (optionally) Sat + Sun + Mon, so
    // Monday's work goes out before the weekend if nobody is at the desk.
    function targetDays() {
        const t = today();
        if (t.getDay() === 5 && fridayWeekend()) return [addDays(t, 1), addDays(t, 2), addDays(t, 3)];
        return [addDays(t, 1)];
    }

    // --- throttled fetch with WAF retry ---
    let lastReqAt = 0;
    async function throttle() {
        const wait = lastReqAt + MIN_REQUEST_INTERVAL - Date.now();
        if (wait > 0) await sleep(wait);
        lastReqAt = Date.now();
    }
    function isWafBlock(resp, bodyText) {
        if ([403, 429, 503].indexOf(resp.status) === -1) return false;
        const server = resp.headers.get('server') || '';
        const ct = resp.headers.get('content-type') || '';
        return /Application-Gateway/i.test(server) || /text\/html/i.test(ct) || /<html/i.test(bodyText || '');
    }
    async function jlFetch(url, opts) {
        for (let attempt = 0; ; attempt++) {
            await throttle();
            const r = await fetch(url, Object.assign({ credentials: 'same-origin' }, opts));
            if (r.ok) return r;
            const text = await r.clone().text().catch(() => '');
            if (isWafBlock(r, text) && attempt < WAF_BACKOFF.length) {
                log(`  rate-limited (HTTP ${r.status}) — retrying in ${WAF_BACKOFF[attempt] / 1000}s`, '#fa0');
                await sleep(WAF_BACKOFF[attempt]);
                continue;
            }
            return r;
        }
    }
    // A logged-out session answers JSON endpoints with the login page (HTML).
    async function readJson(r, what) {
        const text = await r.text();
        try { return JSON.parse(text); }
        catch (e) { throw new Error(`${what} did not return JSON (HTTP ${r.status}) — session probably logged out`); }
    }

    // =========================================================================
    // SCHEDULER-SEARCH TEMPLATE CAPTURE (same approach as the Move+Redeploy script)
    // Wrap XHR to grab the planner's own SchedulerSearch FormData, then replay it
    // with our dates / engineers / job types.
    // =========================================================================
    window.__jlSchedTemplate = window.__jlSchedTemplate || null;
    (function hookXHR() {
        if (window.__jlXhrHooked) return;
        window.__jlXhrHooked = true;
        const proto = XMLHttpRequest.prototype;
        const origOpen = proto.open, origSend = proto.send;
        proto.open = function (m, u) { this.__jlUrl = u; return origOpen.apply(this, arguments); };
        proto.send = function (body) {
            try {
                if (/\/Scheduler\/SchedulerSearch/i.test(this.__jlUrl || '') && body instanceof FormData) {
                    const entries = [...body.entries()].filter(([k]) => !/^EngineerIds/i.test(k));
                    if (entries.length) window.__jlSchedTemplate = entries;
                }
            } catch (e) {}
            return origSend.apply(this, arguments);
        };
    })();

    async function ensureTemplate() {
        if (window.__jlSchedTemplate) return true;
        const refresh = [...document.querySelectorAll('button.jl-icon')]
            .find(b => b.querySelector('i.jl-refresh.jli-24px'));
        if (refresh) {
            log('Capturing planner search template (clicking planner refresh)…', '#0af');
            refresh.click();
            for (let i = 0; i < 50 && !window.__jlSchedTemplate; i++) await sleep(200);
        }
        return !!window.__jlSchedTemplate;
    }

    // =========================================================================
    // API CALLS
    // =========================================================================
    async function loadEngineers() {
        const r = await jlFetch(ENGINEERS_URL, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        if (!r.ok) throw new Error('GetEngineers HTTP ' + r.status);
        const data = await readJson(r, 'GetEngineers');
        return (Array.isArray(data) ? data : []).filter(e => e && e.Id != null);
    }

    async function searchVisits(startStr, endStr, engineerIds, jobTypeIds) {
        const tmpl = window.__jlSchedTemplate;
        if (!tmpl) throw new Error('No SchedulerSearch template captured');
        const fd = new FormData();
        for (const [k, v] of tmpl) {
            if (k === 'StartDate')      { fd.append(k, startStr); continue; }
            if (k === 'EndDate')        { fd.append(k, endStr);   continue; }
            if (/^TypeOfJobs/i.test(k)) continue;
            fd.append(k, v);
        }
        jobTypeIds.forEach((t, i) => fd.append('TypeOfJobs[' + i + ']', t));
        engineerIds.forEach((id, i) => fd.append('EngineerIds[' + i + ']', id));
        const r = await jlFetch(SEARCH_URL, {
            method: 'POST',
            headers: { 'X-Requested-With': 'XMLHttpRequest', '__RequestVerificationToken': getToken(), 'Accept': 'application/json' },
            body: fd
        });
        if (!r.ok) throw new Error('SchedulerSearch HTTP ' + r.status);
        const j = await readJson(r, 'SchedulerSearch');
        return (j && j.Items) || [];
    }

    // Body MUST be JSON (form-encoded → 415).
    async function deployVisit(v) {
        const r = await jlFetch(DEPLOY_URL, {
            method: 'POST',
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                '__RequestVerificationToken': getToken(),
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ VisitId: v.id })
        });
        if (!r.ok) throw new Error('DeployVisit HTTP ' + r.status);
        const j = await readJson(r, 'DeployVisit');
        if (!j || j.success !== true) throw new Error((j && j.errors && j.errors.join(', ')) || 'DeployVisit returned failure');
    }

    // Returns '' if the visit should be deployed, else the reason it's skipped.
    function skipReason(v, allowedDays, allowedTypes) {
        if (!v || v.id == null) return 'no id';
        if (!allowedDays.has(dayOf(v.start))) return 'other day';
        if (!allowedTypes.has(Number(v.TypeOfJob))) return 'job type';
        const status = (v.StatusDescription || '').trim().toLowerCase();
        if (ELIGIBLE_STATUSES.indexOf(status) === -1) return 'already sent';
        if (v.SubcontractorId) return 'subcontractor';
        if (v.IsTeamVisit) return 'team visit';
        if (v.CanDeploy === false) return 'not deployable';
        return '';
    }

    // =========================================================================
    // MAIN RUN
    // =========================================================================
    let running = false, stopRequested = false;

    // dryRun=true lists what would be deployed and changes nothing.
    // Returns true when the run completed (even with some per-visit failures).
    async function runDeploy({ dryRun, auto }) {
        if (running) return false;
        running = true; stopRequested = false; setRunningUI(true);
        clearLog();
        const label = dryRun ? 'PREVIEW' : (auto ? 'AUTO-RUN' : 'MANUAL RUN');
        try {
            if (!getToken()) throw new Error('No verification token on this page — reload the Planner.');
            if (!await ensureTemplate()) throw new Error('Could not capture the planner search template — click the planner refresh, then try again.');

            const days = targetDays();
            const allowedDays = new Set(days.map(isoDay));
            const jobTypes = getJobTypes();
            if (!jobTypes.length) throw new Error('No job types ticked.');
            const allowedTypes = new Set(jobTypes);
            log(`${label}: ${days.map(ddmmyyyy).join(', ')} • ${JOB_TYPES.filter(t => allowedTypes.has(t.id)).map(t => t.label).join(' + ')}`, '#0af');

            setProgress('Loading engineers…');
            const engineers = await loadEngineers();
            log(`${engineers.length} engineer(s).`, '#888');

            setProgress('Searching the planner…');
            const items = await searchVisits(
                `${ddmmyyyy(days[0])} 00:00`, `${ddmmyyyy(days[days.length - 1])} 23:59`,
                engineers.map(e => e.Id), jobTypes);

            const toDeploy = [], skipped = {}, flagged = [];
            for (const v of items) {
                const why = skipReason(v, allowedDays, allowedTypes);
                if (!why) { toDeploy.push(v); continue; }
                skipped[why] = (skipped[why] || 0) + 1;
                // Not Sent visits we can't handle here — call them out so someone deploys them by hand.
                if ((why === 'team visit' || why === 'subcontractor' || why === 'not deployable')) flagged.push([v, why]);
            }
            toDeploy.sort((a, b) => String(a.start).localeCompare(String(b.start)));
            log(`${items.length} visit(s) on the planner • ${toDeploy.length} Not Sent to deploy` +
                (Object.keys(skipped).length ? ' • skipped: ' + Object.entries(skipped).map(([k, n]) => `${k} ${n}`).join(', ') : ''), '#888');
            flagged.forEach(([v, why]) => log(`  ⚠ ${v.JobNumber} | ${v.resourceName || '?'} | ${why} — deploy manually`, '#fa0'));

            let deployed = 0, failed = 0;
            for (let i = 0; i < toDeploy.length; i++) {
                if (stopRequested) { log('Stopped by user.', '#fa0'); break; }
                const v = toDeploy[i];
                const line = `${v.JobNumber} | ${v.resourceName || '?'} | ${dayOf(v.start)} ${timeOf(v.start)}`;
                if (dryRun) { log('  would deploy  ' + line, '#ccc'); continue; }
                setProgress(`Deploying ${i + 1}/${toDeploy.length}: ${v.JobNumber}`);
                try { await deployVisit(v); deployed++; log('  ✓ ' + line, '#0fa'); }
                catch (e) { failed++; log('  ✗ ' + line + ' — ' + e.message, '#f55'); }
            }

            const stamp = new Date().toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
            const summary = dryRun
                ? `Preview ${stamp}: ${toDeploy.length} would be deployed`
                : `${label} ${stamp}: ${deployed} deployed, ${failed} failed` + (flagged.length ? `, ${flagged.length} need manual deploy` : '');
            log(summary, failed ? '#fa0' : '#0fa');
            setProgress(summary);
            if (!dryRun) { lsSet(SUMMARY_KEY, summary); renderSummary(); notify(summary); }
            return !stopRequested;
        } catch (e) {
            log(`${label} FAILED: ${e.message}`, '#f55');
            setProgress('Error: ' + e.message);
            if (!dryRun) { lsSet(SUMMARY_KEY, `${label} failed ${new Date().toLocaleString('en-GB')}: ${e.message}`); renderSummary(); notify('Auto-deploy failed: ' + e.message); }
            return false;
        } finally {
            running = false; setRunningUI(false);
        }
    }

    function notify(msg) {
        try { if ('Notification' in window && Notification.permission === 'granted') new Notification('Joblogic auto-deploy', { body: msg }); } catch (e) {}
    }

    // =========================================================================
    // DAILY SCHEDULER
    // Every tick: if enabled, not yet run today and it's past 18:00, take the
    // cross-tab lock and run. A few minutes before, reload the Planner once so
    // the session/token are fresh and the planner re-issues its own search.
    // =========================================================================
    let lastUserInput = Date.now();
    ['mousedown', 'keydown', 'wheel'].forEach(ev => window.addEventListener(ev, () => { lastUserInput = Date.now(); }, true));

    function tryLock() {
        try {
            const cur = JSON.parse(lsGet(LOCK_KEY) || 'null');
            if (cur && cur.tab !== TAB_ID && Date.now() - cur.ts < LOCK_STALE_MS) return false;
        } catch (e) {}
        lsSet(LOCK_KEY, JSON.stringify({ tab: TAB_ID, ts: Date.now() }));
        return true;
    }
    async function lockConfirmed() {
        await sleep(500 + Math.random() * 500);   // let a competing tab's write land, then re-check
        try { return JSON.parse(lsGet(LOCK_KEY) || 'null').tab === TAB_ID; } catch (e) { return false; }
    }

    async function tick() {
        renderSchedule();
        if (!isEnabled() || running) return;
        const now = new Date(), todayStr = isoDay(now);
        if (lsGet(LASTRUN_KEY) === todayStr) return;
        const mins = now.getHours() * 60 + now.getMinutes(), runAt = RUN_HOUR * 60 + RUN_MINUTE;

        if (mins >= runAt - RELOAD_LEAD_MIN && mins < runAt) {
            // Fresh page before the run — but never yank the page from someone using it.
            if (lsGet(RELOADED_KEY) !== todayStr && Date.now() - lastUserInput > 5 * 60000 && tryLock()) {
                lsSet(RELOADED_KEY, todayStr);
                lsDel(LOCK_KEY);
                location.reload();
            }
            return;
        }
        if (mins < runAt || now.getHours() >= RUN_CUTOFF_HOUR) return;
        if (Date.now() - Number(lsGet(LASTTRY_KEY) || 0) < RETRY_FAILED_RUN_MS) return;
        if (!tryLock() || !await lockConfirmed()) return;
        if (lsGet(LASTRUN_KEY) === todayStr) { lsDel(LOCK_KEY); return; }   // another tab finished meanwhile

        lsSet(LASTTRY_KEY, String(Date.now()));
        openPanel();
        const ok = await runDeploy({ dryRun: false, auto: true });
        if (ok) lsSet(LASTRUN_KEY, todayStr);
        lsDel(LOCK_KEY);
        renderSchedule();
    }

    // =========================================================================
    // UI
    // =========================================================================
    let panelEl, logArea, progressEl, scheduleEl, summaryEl;
    function setProgress(msg) { if (progressEl) progressEl.textContent = msg; }

    function log(msg, color = '#ccc') {
        const text = msg ? ('[' + new Date().toLocaleTimeString() + '] ' + msg) : '';
        try {
            const arr = JSON.parse(lsGet(LOG_KEY) || '[]');
            arr.push({ text, color });
            lsSet(LOG_KEY, JSON.stringify(arr.slice(-400)));
        } catch (e) {}
        appendLogLine(text, color);
    }
    function appendLogLine(text, color) {
        if (!logArea) return;
        const line = document.createElement('div');
        line.style.color = color;
        line.textContent = text;
        logArea.appendChild(line);
        logArea.scrollTop = logArea.scrollHeight;
    }
    function clearLog() { lsDel(LOG_KEY); if (logArea) logArea.innerHTML = ''; }
    function replayLog() {
        try { JSON.parse(lsGet(LOG_KEY) || '[]').forEach(l => appendLogLine(l.text, l.color)); } catch (e) {}
    }

    function setRunningUI(isRunning) {
        if (!panelEl) return;
        panelEl.querySelector('.btn-preview').disabled = isRunning;
        panelEl.querySelector('.btn-run').style.display  = isRunning ? 'none' : '';
        panelEl.querySelector('.btn-stop').style.display = isRunning ? '' : 'none';
    }

    function renderSchedule() {
        if (!scheduleEl) return;
        const at = `${pad2(RUN_HOUR)}:${pad2(RUN_MINUTE)}`;
        if (!isEnabled()) { scheduleEl.textContent = 'Auto-deploy is OFF.'; scheduleEl.style.color = '#fa0'; return; }
        const ran = lsGet(LASTRUN_KEY) === isoDay(new Date());
        scheduleEl.textContent = ran
            ? `Auto-deploy ON — done for today, next run tomorrow ${at}.`
            : `Auto-deploy ON — next run today at ${at} (deploys ${targetDays().map(ddmmyyyy).join(', ')}). Keep this tab open.`;
        scheduleEl.style.color = '#0fa';
    }
    function renderSummary() { if (summaryEl) summaryEl.textContent = lsGet(SUMMARY_KEY) ? 'Last run: ' + lsGet(SUMMARY_KEY) : 'No runs yet.'; }

    function openPanel() {
        if (!panelEl || panelEl.style.display !== 'none') return;
        const b = document.getElementById('jl-launch-' + SCRIPT_ID);
        if (b) b.click(); else panelEl.style.display = 'flex';
    }

    function buildPanel() {
        if (document.getElementById('jl-autodeploy-panel')) return;
        panelEl = document.createElement('div');
        panelEl.id = 'jl-autodeploy-panel';
        panelEl.style.display = 'flex';
        panelEl.innerHTML = `
<style>
#jl-autodeploy-panel { position:fixed; top:10px; right:10px; z-index:99999; background:#1a1a2e; color:#eee; border-radius:8px; width:560px; max-height:88vh; flex-direction:column; font-family:monospace; font-size:12px; box-shadow:0 4px 20px rgba(0,0,0,.55); }
#jl-autodeploy-panel header { display:flex; justify-content:space-between; align-items:center; padding:10px 14px; border-bottom:1px solid #333; cursor:move; user-select:none; }
#jl-autodeploy-panel header b { font-size:13px; }
#jl-autodeploy-panel .body { padding:10px 14px; display:flex; flex-direction:column; gap:8px; overflow-y:auto; }
#jl-autodeploy-panel .progress { color:#0fa; font-weight:600; min-height:1.4em; }
#jl-autodeploy-panel .schedule { font-weight:600; }
#jl-autodeploy-panel .summary { color:#cbd5e1; }
#jl-autodeploy-panel .controls { display:flex; gap:6px; flex-wrap:wrap; }
#jl-autodeploy-panel button { background:#2563eb; color:#fff; border:0; border-radius:4px; padding:6px 12px; cursor:pointer; font-family:monospace; font-size:12px; }
#jl-autodeploy-panel .btn-preview { background:#0891b2; }
#jl-autodeploy-panel .btn-run  { background:#16a34a; }
#jl-autodeploy-panel .btn-stop { background:#991b1b; display:none; }
#jl-autodeploy-panel .btn-close { background:transparent; border:none; color:#eee; font-size:16px; cursor:pointer; }
#jl-autodeploy-panel button[disabled] { opacity:.4; cursor:not-allowed; }
#jl-autodeploy-panel .opts { border:1px solid #2a2a40; border-radius:6px; padding:8px; display:flex; flex-direction:column; gap:6px; }
#jl-autodeploy-panel .opts label { display:flex; align-items:center; gap:7px; cursor:pointer; }
#jl-autodeploy-panel .row { display:flex; gap:18px; flex-wrap:wrap; }
#jl-autodeploy-panel .hint { color:#6b7280; font-size:11px; line-height:1.45; }
#jl-autodeploy-panel .log { background:#0a0a1a; padding:8px; border-radius:4px; overflow-y:auto; max-height:40vh; white-space:pre-wrap; word-break:break-word; }
#jl-autodeploy-panel .log div { padding:1px 0; line-height:1.35; }
#jl-autodeploy-panel .ver { color:#64748b; font-weight:400; font-size:11px; }
</style>
<header><b>Auto-Deploy Tomorrow's Visits <span class="ver">v${SCRIPT_VERSION}</span></b><button class="btn-close">×</button></header>
<div class="body">
  <div class="schedule"></div>
  <div class="summary"></div>
  <div class="opts">
    <label><input type="checkbox" class="opt-enabled"> <b>Auto-deploy every day at ${pad2(RUN_HOUR)}:${pad2(RUN_MINUTE)}</b></label>
    <div class="row jobtypes"></div>
    <label><input type="checkbox" class="opt-weekend"> On Fridays, deploy Sat + Sun + Mon</label>
  </div>
  <div class="controls">
    <button class="btn-preview">Preview</button>
    <button class="btn-run">Deploy now</button>
    <button class="btn-stop">Stop</button>
  </div>
  <div class="progress"></div>
  <div class="hint">
    Deploys every <b>Not Sent</b> visit for <b>all engineers</b> scheduled tomorrow, to the engineer it's planned for.
    Visits already sent (New / Read / Accepted…) are left alone; team &amp; subcontractor visits are listed for manual deploy.
    Needs a Planner tab open and logged in at ${pad2(RUN_HOUR)}:${pad2(RUN_MINUTE)} (if the computer is off it catches up when the Planner is next opened, until ${RUN_CUTOFF_HOUR}:00).
    The tab reloads itself ~${RELOAD_LEAD_MIN} min before the run unless you're using it.
  </div>
  <div class="log"></div>
</div>`;
        document.body.appendChild(panelEl);
        jlRegisterPanel(panelEl, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR, SCRIPT_DESC);

        logArea = panelEl.querySelector('.log');
        progressEl = panelEl.querySelector('.progress');
        scheduleEl = panelEl.querySelector('.schedule');
        summaryEl = panelEl.querySelector('.summary');

        const enabledCb = panelEl.querySelector('.opt-enabled');
        enabledCb.checked = isEnabled();
        enabledCb.addEventListener('change', () => {
            lsSet(ENABLED_KEY, enabledCb.checked ? '1' : '0');
            if (enabledCb.checked && 'Notification' in window && Notification.permission === 'default') {
                try { Notification.requestPermission(); } catch (e) {}
            }
            renderSchedule();
        });
        const weekendCb = panelEl.querySelector('.opt-weekend');
        weekendCb.checked = fridayWeekend();
        weekendCb.addEventListener('change', () => { lsSet(WEEKEND_KEY, weekendCb.checked ? '1' : '0'); renderSchedule(); });

        const jtEl = panelEl.querySelector('.jobtypes');
        const sel = new Set(getJobTypes());
        for (const t of JOB_TYPES) {
            const lab = document.createElement('label');
            const cb = document.createElement('input');
            cb.type = 'checkbox'; cb.checked = sel.has(t.id);
            cb.addEventListener('change', () => {
                const cur = new Set(getJobTypes());
                if (cb.checked) cur.add(t.id); else cur.delete(t.id);
                lsSet(JOBTYPE_KEY, JSON.stringify([...cur]));
            });
            lab.appendChild(cb); lab.appendChild(document.createTextNode(t.label));
            jtEl.appendChild(lab);
        }

        const hdr = panelEl.querySelector('header');
        let drag = null;
        hdr.addEventListener('mousedown', e => { if (e.target.closest('button')) return; drag = { x: e.clientX - panelEl.offsetLeft, y: e.clientY - panelEl.offsetTop }; });
        window.addEventListener('mouseup', () => drag = null);
        window.addEventListener('mousemove', e => { if (!drag) return; panelEl.style.left = (e.clientX - drag.x) + 'px'; panelEl.style.top = (e.clientY - drag.y) + 'px'; panelEl.style.right = 'auto'; });

        panelEl.querySelector('.btn-close').onclick = () => { const b = document.getElementById('jl-launch-' + SCRIPT_ID); if (b) b.click(); else panelEl.style.display = 'none'; };
        panelEl.querySelector('.btn-preview').onclick = () => runDeploy({ dryRun: true });
        panelEl.querySelector('.btn-run').onclick = () => {
            if (!confirm(`Deploy every Not Sent visit for ${targetDays().map(ddmmyyyy).join(', ')} now?`)) return;
            runDeploy({ dryRun: false, auto: false });
        };
        panelEl.querySelector('.btn-stop').onclick = () => { stopRequested = true; setProgress('Stopping…'); };

        replayLog();
        renderSchedule();
        renderSummary();
    }

    // =========================================================================
    // BOOT
    // =========================================================================
    function boot() {
        if (!document.body) { setTimeout(boot, 400); return; }
        buildPanel();
        // Give the planner a moment to issue its own first search (captures the template).
        setTimeout(() => { tick(); setInterval(tick, CHECK_EVERY_MS); }, 8000);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
