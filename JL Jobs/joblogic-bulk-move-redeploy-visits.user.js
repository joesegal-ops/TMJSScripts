// ==UserScript==
// @name         Joblogic - Bulk Move & Redeploy Yesterday's Visits
// @namespace    https://go.joblogic.com/
// @version      1.00
// @description  On the Planner, finds every New / Not Sent / Read visit dated yesterday across ALL engineers, moves it to today (same time of day) and redeploys it to the same engineer. Collapses to a launcher button in the shared dock (drag to reorder).
// @match        https://go.joblogic.com/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/joblogic-bulk-move-redeploy-visits.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/joblogic-bulk-move-redeploy-visits.user.js
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

    const SCRIPT_ID = 'move-redeploy-visits';
    const SCRIPT_LABEL = '📅 Move+Redeploy Visits';
    const SCRIPT_COLOR = '#072d3d';
    const SCRIPT_DESC = 'On the Planner, finds every New / Not Sent / Read visit dated yesterday across all engineers, moves it to today (same time of day) and redeploys it. Open on the Planner page, Scan to preview, then Run.';

    if (window.__jlMoveRedeployLoaded) return;
    window.__jlMoveRedeployLoaded = true;

    // =========================================================================
    // CONFIG
    // =========================================================================
    // Only these engineers are processed. Names are matched case-insensitively
    // against /Staff/GetEngineers. Leave the array empty to process ALL engineers.
    const ENGINEER_ALLOWLIST = [
        'Daniel Nobes',
        'Francis Jones',
        'George Kirumira',
        'Indy Singh',
        'Jake Rafferty',
        'Jevarri Williams',
        'Keiran Connolly',
        'Lee Rafferty',
        'Luke Kelly',
        'Raj Solanki'
    ];

    // StatusDescription values that are eligible to be moved + redeployed.
    const ELIGIBLE_STATUSES = ['new', 'not sent', 'read'];
    const DELAY_BETWEEN_VISITS = 450;   // ms between writes (be gentle on the API)
    const ENGINEERS_URL = '/Staff/GetEngineers?text=&includeNonLogin=false';
    const SEARCH_URL    = '/Scheduler/SchedulerSearch';
    const UPDATE_URL    = '/Scheduler/UpdateVisit';
    const REDEPLOY_URL  = '/Scheduler/RedeployVisit';
    const DEPLOY_URL    = '/Scheduler/DeployVisit';

    // =========================================================================
    // HELPERS
    // =========================================================================
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const pad2  = n => String(n).padStart(2, '0');

    // Anti-forgery token — required as a request header on all Scheduler POSTs.
    function getToken() {
        const i = document.querySelector('input[name="__RequestVerificationToken"]');
        return i ? i.value : null;
    }

    // DD/MM/YYYY for a Date
    function ddmmyyyy(d) { return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`; }
    // YYYY-MM-DD for a Date (to compare against ISO date strings)
    function isoDay(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

    // Pull "HH:mm" out of an ISO-ish datetime string like "2026-06-09T09:00:00".
    function timeOf(isoStr) {
        const m = String(isoStr || '').match(/T(\d{2}):(\d{2})/);
        return m ? `${m[1]}:${m[2]}` : '00:00';
    }
    // The date portion "YYYY-MM-DD" of an ISO-ish datetime string.
    function dayOf(isoStr) {
        const m = String(isoStr || '').match(/^(\d{4}-\d{2}-\d{2})/);
        return m ? m[1] : '';
    }

    function today()       { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
    function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
    // The source day(s) to sweep. On Monday (getDay()===1) sweep Fri + Sat + Sun so
    // weekend visits are caught; every other day sweeps just the previous day.
    function sourceDays() {
        const t = today();
        if (t.getDay() === 1) return [addDays(t, -3), addDays(t, -2), addDays(t, -1)]; // Fri, Sat, Sun
        return [addDays(t, -1)];
    }

    // =========================================================================
    // SCHEDULER-SEARCH TEMPLATE CAPTURE
    //
    // The planner builds a rich FormData for /Scheduler/SchedulerSearch (job-type
    // flags, timezone, view mode, etc). Rather than hard-code those fields (and
    // risk drifting when Joblogic changes them) we capture the planner's own
    // request by wrapping XMLHttpRequest, then replay it with our own dates and
    // the full engineer list. We strip the EngineerIds[] entries so we control them.
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

    // Force a SchedulerSearch (so the hook captures a template) by clicking the
    // planner's data-refresh icon. Returns true if a template is available after.
    async function ensureTemplate() {
        if (window.__jlSchedTemplate) return true;
        const refresh = [...document.querySelectorAll('button.jl-icon')]
            .find(b => b.querySelector('i.jl-refresh.jli-24px'));
        if (refresh) {
            log('No search template yet — clicking the planner refresh to capture one…', '#0af');
            refresh.click();
            for (let i = 0; i < 30 && !window.__jlSchedTemplate; i++) await sleep(200);
        }
        return !!window.__jlSchedTemplate;
    }

    // =========================================================================
    // API CALLS
    // =========================================================================
    async function fetchEngineerIds() {
        const r = await fetch(ENGINEERS_URL, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        if (!r.ok) throw new Error('GetEngineers HTTP ' + r.status);
        const data = await r.json();
        const engineers = Array.isArray(data) ? data : [];
        if (!ENGINEER_ALLOWLIST.length) {
            return engineers.map(e => e.Id).filter(id => id != null);
        }
        const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
        const ids = [];
        for (const name of ENGINEER_ALLOWLIST) {
            const want = norm(name);
            const match = engineers.find(e => norm(e.Name) === want) || engineers.find(e => norm(e.Name).includes(want));
            if (match) { ids.push(match.Id); }
            else { log(`  ⚠ engineer not found: "${name}"`, '#fa0'); }
        }
        log(`Restricted to ${ids.length}/${ENGINEER_ALLOWLIST.length} configured engineer(s).`, '#888');
        return ids;
    }

    // Search all engineers between two DD/MM/YYYY HH:mm strings. Returns Items[].
    async function searchVisits(startStr, endStr, engineerIds) {
        const tmpl = window.__jlSchedTemplate;
        if (!tmpl) throw new Error('No SchedulerSearch template captured');
        const fd = new FormData();
        for (const [k, v] of tmpl) {
            if (k === 'StartDate') { fd.append(k, startStr); continue; }
            if (k === 'EndDate')   { fd.append(k, endStr);   continue; }
            fd.append(k, v);
        }
        engineerIds.forEach((id, i) => fd.append('EngineerIds[' + i + ']', id));
        const r = await fetch(SEARCH_URL, {
            method: 'POST', credentials: 'same-origin',
            headers: { 'X-Requested-With': 'XMLHttpRequest', '__RequestVerificationToken': getToken(), 'Accept': 'application/json' },
            body: fd
        });
        if (!r.ok) throw new Error('SchedulerSearch HTTP ' + r.status);
        const j = await r.json().catch(() => null);
        return (j && j.Items) || [];
    }

    // Move a visit to a new start/end (DD/MM/YYYY HH:mm). deploy:false = move only.
    async function moveVisit(v, startStr, endStr) {
        const fd = new FormData();
        fd.append('id', v.id);
        fd.append('jobId', v.JobId);
        fd.append('jobNumber', v.JobNumber);
        fd.append('typeOfJob', v.TypeOfJob);
        fd.append('isTeamVisit', !!v.IsTeamVisit);
        fd.append('isCopy', false);
        fd.append('deploy', false);
        fd.append('startDate', startStr);
        fd.append('endDate', endStr);
        const r = await fetch(UPDATE_URL, {
            method: 'POST', credentials: 'same-origin',
            headers: { 'X-Requested-With': 'XMLHttpRequest', '__RequestVerificationToken': getToken(), 'Accept': 'application/json' },
            body: fd
        });
        const j = await r.json().catch(() => null);
        if (!r.ok) throw new Error('UpdateVisit HTTP ' + r.status);
        if (!j || j.success !== true) throw new Error((j && j.errors && j.errors.join(', ')) || 'UpdateVisit returned failure');
        return j;
    }

    // Redeploy (or first-deploy) a visit. Body MUST be JSON (form-encoded → 415).
    async function deployOrRedeploy(v) {
        // Prefer Redeploy; fall back to Deploy for visits that can only be deployed.
        const url = (v.CanRedeploy || !v.CanDeploy) ? REDEPLOY_URL : DEPLOY_URL;
        const r = await fetch(url, {
            method: 'POST', credentials: 'same-origin',
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                '__RequestVerificationToken': getToken(),
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ VisitId: v.id })
        });
        const j = await r.json().catch(() => null);
        if (!r.ok) throw new Error((url === REDEPLOY_URL ? 'Redeploy' : 'Deploy') + ' HTTP ' + r.status);
        if (!j || j.success !== true) throw new Error((j && j.errors && j.errors.join(', ')) || 'Deploy/Redeploy returned failure');
        return url === REDEPLOY_URL ? 'redeployed' : 'deployed';
    }

    // =========================================================================
    // ELIGIBILITY
    // =========================================================================
    function isEligible(v, allowedDays) {
        if (!v || v.id == null) return false;
        if (v.SubcontractorId) return false;                       // engineers only
        if (v.IsTeamVisit) return false;                           // team visits use a different endpoint
        if (v.IsMoveable === false) return false;
        if (!allowedDays.has(dayOf(v.start))) return false;        // must start on a source day
        const status = (v.StatusDescription || '').trim().toLowerCase();
        return ELIGIBLE_STATUSES.indexOf(status) !== -1;
    }

    // =========================================================================
    // MAIN RUN
    // =========================================================================
    let running = false, foundVisits = [];

    async function onScan() {
        if (running) return;
        running = true; setRunningUI(true); clearLog();
        try {
            if (!/\/Scheduler/i.test(location.pathname)) {
                log('Open this on the Planner page (go.joblogic.com/Scheduler) first.', '#f55');
                return;
            }
            if (!getToken()) { log('Could not find the verification token on this page.', '#f55'); return; }
            if (!await ensureTemplate()) {
                log('Could not capture a search template. Click the planner refresh once, then Scan again.', '#f55');
                return;
            }
            const srcDays = sourceDays(), tDay = today();
            const allowed = new Set(srcDays.map(isoDay));
            const rangeLabel = srcDays.map(ddmmyyyy).join(', ');
            log(`Source day(s) = ${rangeLabel}  →  moving to Today = ${ddmmyyyy(tDay)}`, '#0af');

            log('Fetching engineer list…', '#0af');
            const engIds = await fetchEngineerIds();
            log(`${engIds.length} engineer(s).`, '#888');

            setProgress('Searching source day(s) for the configured engineers…');
            const items = await searchVisits(
                `${ddmmyyyy(srcDays[0])} 00:00`,
                `${ddmmyyyy(srcDays[srcDays.length - 1])} 23:59`,
                engIds);
            log(`${items.length} visit(s) in range in total.`, '#888');

            foundVisits = items.filter(v => isEligible(v, allowed));

            // Tally for transparency
            const tally = {};
            items.forEach(v => { const s = (v.StatusDescription || 'null'); tally[s] = (tally[s] || 0) + 1; });
            log('Status breakdown (all in range): ' + Object.entries(tally).map(([k, n]) => `${k}:${n}`).join(', '), '#666');

            if (!foundVisits.length) {
                setProgress('Nothing to do — no New / Not Sent / Read visits on the source day(s).');
                log('No eligible visits found.', '#fa0');
                return;
            }
            log(`${foundVisits.length} eligible (New / Not Sent / Read) to move → today + redeploy:`, '#0fa');
            foundVisits.slice(0, 60).forEach(v =>
                log(`  ${v.JobNumber}  | ${v.resourceName} | ${timeOf(v.start)} | ${v.StatusDescription}`, '#ccc'));
            if (foundVisits.length > 60) log(`  …and ${foundVisits.length - 60} more`, '#ccc');
            setProgress(`Found ${foundVisits.length}. Click "Move + Redeploy All" to run, or close.`);
            if (panelEl) panelEl.querySelector('.btn-run').disabled = false;
        } catch (e) {
            log('ERROR: ' + e.message, '#f55');
            setProgress('Error during scan.');
        } finally {
            running = false; setRunningUI(false);
        }
    }

    async function onRun() {
        if (running) return;
        if (!foundVisits.length) { log('Nothing scanned — click Scan first.', '#fa0'); return; }
        if (!confirm(`Move ${foundVisits.length} visit(s) from yesterday to today (same time) and redeploy each to its engineer?`)) return;

        running = true; setRunningUI(true);
        const tDay = today();
        let moved = 0, redeployed = 0, failed = 0;

        try {
            for (let i = 0; i < foundVisits.length; i++) {
                if (!running) { log('Stopped by user.', '#fa0'); break; }
                const v = foundVisits[i];
                setProgress(`Processing ${i + 1}/${foundVisits.length}: ${v.JobNumber}`);

                const startStr = `${ddmmyyyy(tDay)} ${timeOf(v.start)}`;
                const endStr   = `${ddmmyyyy(tDay)} ${timeOf(v.end)}`;
                log(`${v.JobNumber} | ${v.resourceName} | ${v.StatusDescription} → ${startStr}`, '#fff');

                try {
                    await moveVisit(v, startStr, endStr);
                    moved++;
                    log('  moved', '#0fa');
                } catch (e) {
                    log('  MOVE FAILED: ' + e.message + ' (skipping redeploy)', '#f55');
                    failed++;
                    await sleep(DELAY_BETWEEN_VISITS);
                    continue;
                }

                try {
                    const what = await deployOrRedeploy(v);
                    redeployed++;
                    log('  ' + what, '#0fa');
                } catch (e) {
                    log('  REDEPLOY FAILED: ' + e.message, '#f55');
                    failed++;
                }

                await sleep(DELAY_BETWEEN_VISITS);
            }

            log('', '#ccc');
            log('========== SUMMARY ==========', '#0fa');
            log(`Moved: ${moved}  •  Redeployed/Deployed: ${redeployed}  •  Failed: ${failed}`, '#0fa');
            setProgress(`Done — moved ${moved}, (re)deployed ${redeployed}, failed ${failed}.`);
            foundVisits = [];
            if (panelEl) panelEl.querySelector('.btn-run').disabled = true;
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
    let panelEl, logArea, progressEl;
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
        panelEl.querySelector('.btn-scan').disabled = isRunning;
        panelEl.querySelector('.btn-run').style.display  = isRunning ? 'none' : '';
        panelEl.querySelector('.btn-stop').style.display = isRunning ? '' : 'none';
    }

    function buildPanel() {
        if (document.getElementById('jl-moveredeploy-panel')) return;
        panelEl = document.createElement('div');
        panelEl.id = 'jl-moveredeploy-panel';
        panelEl.innerHTML = `
<style>
#jl-moveredeploy-panel { position:fixed; top:10px; right:10px; z-index:99999; background:#1a1a2e; color:#eee; border-radius:8px; width:560px; max-height:88vh; display:flex; flex-direction:column; font-family:monospace; font-size:12px; box-shadow:0 4px 20px rgba(0,0,0,.55); }
#jl-moveredeploy-panel header { display:flex; justify-content:space-between; align-items:center; padding:10px 14px; border-bottom:1px solid #333; cursor:move; user-select:none; }
#jl-moveredeploy-panel header b { font-size:13px; }
#jl-moveredeploy-panel .body { padding:10px 14px; display:flex; flex-direction:column; gap:8px; overflow-y:auto; }
#jl-moveredeploy-panel .progress { color:#0fa; font-weight:600; min-height:1.4em; }
#jl-moveredeploy-panel .controls { display:flex; gap:6px; flex-wrap:wrap; }
#jl-moveredeploy-panel button { background:#2563eb; color:#fff; border:0; border-radius:4px; padding:6px 12px; cursor:pointer; font-family:monospace; font-size:12px; }
#jl-moveredeploy-panel .btn-scan { background:#0891b2; }
#jl-moveredeploy-panel .btn-run  { background:#16a34a; }
#jl-moveredeploy-panel .btn-stop { background:#991b1b; display:none; }
#jl-moveredeploy-panel .btn-close { background:transparent; border:none; color:#eee; font-size:16px; cursor:pointer; }
#jl-moveredeploy-panel button[disabled] { opacity:.4; cursor:not-allowed; }
#jl-moveredeploy-panel .hint { color:#6b7280; font-size:11px; line-height:1.45; }
#jl-moveredeploy-panel .log { background:#0a0a1a; padding:8px; border-radius:4px; overflow-y:auto; max-height:52vh; white-space:pre-wrap; word-break:break-word; }
#jl-moveredeploy-panel .log div { padding:1px 0; line-height:1.35; }
</style>
<header><b>Move + Redeploy Yesterday's Visits</b><button class="btn-close">×</button></header>
<div class="body">
  <div class="progress">Open on the Planner, then click Scan.</div>
  <div class="controls">
    <button class="btn-scan">Scan</button>
    <button class="btn-run" disabled>Move + Redeploy All</button>
    <button class="btn-stop">Stop</button>
  </div>
  <div class="hint">
    Finds every <b>New / Not Sent / Read</b> visit from the <b>previous day</b> (on Mondays:
    <b>Fri + Sat + Sun</b>) for the <b>configured engineers</b> (edit <code>ENGINEER_ALLOWLIST</code> in the script),
    moves each to <b>today</b> at the same time of day, then redeploys it. Skips team &amp; subcontractor
    visits. Respects the planner's current job-type filter. Scan previews first — nothing is changed until you Run.
  </div>
  <div class="log"></div>
</div>`;
        document.body.appendChild(panelEl);
        jlRegisterPanel(panelEl, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR, SCRIPT_DESC);

        logArea = panelEl.querySelector('.log');
        progressEl = panelEl.querySelector('.progress');

        const hdr = panelEl.querySelector('header');
        let drag = null;
        hdr.addEventListener('mousedown', e => { if (e.target.closest('button')) return; drag = { x: e.clientX - panelEl.offsetLeft, y: e.clientY - panelEl.offsetTop }; });
        window.addEventListener('mouseup', () => drag = null);
        window.addEventListener('mousemove', e => { if (!drag) return; panelEl.style.left = (e.clientX - drag.x) + 'px'; panelEl.style.top = (e.clientY - drag.y) + 'px'; panelEl.style.right = 'auto'; });

        panelEl.querySelector('.btn-close').onclick = () => { panelEl.style.display = 'none'; };
        panelEl.querySelector('.btn-scan').onclick = onScan;
        panelEl.querySelector('.btn-run').onclick = onRun;
        panelEl.querySelector('.btn-stop').onclick = onStop;
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
