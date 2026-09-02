// ==UserScript==
// @name         Joblogic - Redeploy Visits (from filtered list)
// @namespace    https://go.joblogic.com/
// @version      2.00
// @description  Scan the filtered Jobs list and redeploy each job's existing visits back to the same engineer via Joblogic's own RedeployVisit endpoint, so the jobs re-appear in their app. Never creates a new visit. Collapses to a launcher button in the shared dock (drag to reorder).
// @match        https://go.joblogic.com/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/joblogic-redeploy-visits.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/joblogic-redeploy-visits.user.js
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


    const SCRIPT_ID = 'redeploy-visits';
    const SCRIPT_LABEL = '🔁 Redeploy Visits';
    const SCRIPT_COLOR = '#0b7285';
    const SCRIPT_DESC = 'Scans the filtered Jobs list and redeploys each job’s existing visits to the same engineer (via Joblogic’s RedeployVisit endpoint) so the jobs reappear in the engineer app. Never creates a new visit. Apply a filter first, then Scan.';

    if (window.__jlRedeployLoaded) return;
    window.__jlRedeployLoaded = true;

    // =========================================================================
    // CONFIG
    //
    // This script redeploys EXISTING visits only. It calls Joblogic's own
    // /Scheduler/RedeployVisit endpoint with the visit's Id — the same call the
    // native "Redeploy" row action makes. It never touches the Allocate panel
    // and never calls AddVisit, so no new visit can be created.
    // =========================================================================
    const STATE_KEY     = 'jl-redeploy-state-v1';
    const LOG_KEY       = 'jl-redeploy-loglines-v1';
    const LOG_MAX_LINES = 400;
    const VISIT_GAP_MS  = 250;   // pause between redeploy calls
    const JOB_GAP_MS    = 150;   // pause between jobs

    const VISITS_URL   = jobId => `/api/Visit/GetVisitsJson?&jobId=${jobId}&isAxaJob=false&isReadOnly=false&pageIndex=1&pageSize=200`;
    const REDEPLOY_URL = '/Scheduler/RedeployVisit';

    // =========================================================================
    // HELPERS
    // =========================================================================
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const qs    = (s, r = document) => r.querySelector(s);
    const qsa   = (s, r = document) => [...r.querySelectorAll(s)];

    function waitFor(fn, { timeout = 10000, interval = 150 } = {}) {
        return new Promise((resolve, reject) => {
            const t0 = Date.now();
            (function tick() {
                let v; try { v = fn(); } catch { v = null; }
                if (v) return resolve(v);
                if (Date.now() - t0 > timeout) return reject(new Error('waitFor timeout'));
                setTimeout(tick, interval);
            })();
        });
    }

    function fire(el, type, init = {}) {
        const E = (type.startsWith('mouse') || type === 'click') ? MouseEvent
                : type.startsWith('key')                         ? KeyboardEvent
                : Event;
        el.dispatchEvent(new E(type, { bubbles: true, cancelable: true, view: window, ...init }));
    }

    // Anti-forgery token — required as a request header on all /Scheduler POSTs.
    function getToken() {
        const i = document.querySelector('input[name="__RequestVerificationToken"]');
        return i ? i.value : null;
    }

    const normEng = s => (s || '').toLowerCase().trim();

    // =========================================================================
    // JOB LIST SCRAPING — called on /Job
    // =========================================================================
    function scrapeJobsFromList() {
        const jobs = [];
        const seen = new Set();

        // Joblogic renders the job list with <a href="/Job/Detail/{id}"> links.
        // We also try to read the visible job reference from the link text or a
        // nearby cell so we can show a human-readable label in the log.
        for (const link of qsa('a[href*="/Job/Detail/"]')) {
            const m = link.href.match(/\/Job\/Detail\/(\d+)/i);
            if (!m || seen.has(m[1])) continue;
            seen.add(m[1]);

            let ref = link.textContent.trim();
            if (!ref || /^\d+$/.test(ref)) {
                const row = link.closest('tr, .tr, li, [class*="row"]');
                if (row) {
                    const cell = qsa('td, .td, span, div', row).find(el => {
                        const t = el.textContent.trim();
                        return /^[A-Z]{1,4}[-\/]?\d{4,}/.test(t) || /^\d{4,}$/.test(t);
                    });
                    if (cell) ref = cell.textContent.trim();
                }
            }
            jobs.push({ id: m[1], ref: ref || m[1] });
        }

        return jobs;
    }

    // =========================================================================
    // VISIT API
    //
    // GetVisitsJson is the same feed the job's Visits tab renders from. Each
    // visit carries the authoritative action flags, so we no longer have to
    // guess eligibility from status icons:
    //   Id, JobId, StartDate, EndDate, EngineerName, StatusDescription,
    //   CanRedeploy, CanDeploy, CanCancel, ...
    // =========================================================================
    async function fetchJobVisits(jobId) {
        const r = await fetch(VISITS_URL(jobId), {
            credentials: 'same-origin',
            headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' }
        });
        if (!r.ok) throw new Error('GetVisitsJson HTTP ' + r.status);
        const j = await r.json();
        return ((j.AdditionalData && j.AdditionalData.Visits) || []);
    }

    // Redeploy one existing visit. Body MUST be JSON (form-encoded → HTTP 415).
    // This re-sends the SAME visit to its existing engineer — it does not create,
    // copy or move anything.
    async function redeployVisit(visitId) {
        const token = getToken();
        if (!token) throw new Error('__RequestVerificationToken not found on this page');
        const r = await fetch(REDEPLOY_URL, {
            method: 'POST', credentials: 'same-origin',
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                '__RequestVerificationToken': token,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ VisitId: visitId })
        });
        const j = await r.json().catch(() => null);
        if (!r.ok) throw new Error('Redeploy HTTP ' + r.status);
        if (!j || j.success !== true) {
            throw new Error((j && j.errors && j.errors.join(', ')) || 'RedeployVisit returned failure');
        }
        return true;
    }

    // =========================================================================
    // PER-JOB HANDLER
    //
    // Pure API — no navigation, no DOM clicking, so Stop takes effect at once.
    // =========================================================================
    async function processJob(row, st) {
        log(`--- [${st.currentIndex + 1}/${st.rows.length}] ${row.ref} ---`, '#fff');

        let visits;
        try {
            visits = await fetchJobVisits(row.id);
        } catch (e) {
            log(`  Could not read visits: ${e.message}`, '#f55');
            return { status: 'error', redeployed: 0, failed: 1, error: e.message };
        }
        log(`  ${visits.length} visit(s) on this job`, '#0af');

        const engFilter = normEng(st.engineerFilter || '');

        const eligible = [];
        for (const v of visits) {
            const eng = normEng(v.EngineerName);
            if (engFilter && !(eng.includes(engFilter) || engFilter.includes(eng))) continue;
            if (!v.CanRedeploy) {
                log(`  Skip: "${v.EngineerName}" ${v.StartDate} [${v.StatusDescription}] — not redeployable`, '#888');
                continue;
            }
            eligible.push(v);
        }

        if (!eligible.length) {
            log(`  No redeployable visits matching "${st.engineerFilter}" — skipping`, '#888');
            return { status: 'skipped', redeployed: 0, failed: 0 };
        }
        log(`  ${eligible.length} redeployable (matching "${st.engineerFilter}")`);

        let redeployed = 0, failed = 0;

        for (const v of eligible) {
            if (stopRequested) { log('  Stopped by user', '#fa0'); break; }

            const label = `"${v.EngineerName}" ${v.StartDate} → ${v.EndDate} [${v.StatusDescription}]`;

            if (st.dryRun) {
                log(`  [DRY] Would redeploy visit ${v.Id}: ${label}`, '#ff0');
                redeployed++;
                continue;
            }

            try {
                await redeployVisit(v.Id);
                log(`  Redeployed visit ${v.Id}: ${label}`, '#0fa');
                redeployed++;
            } catch (e) {
                log(`  FAILED visit ${v.Id}: ${e.message}`, '#f55');
                failed++;
            }

            await sleep(VISIT_GAP_MS);
        }

        return {
            status: redeployed > 0 ? 'ok' : (failed > 0 ? 'fail' : 'skipped'),
            redeployed, failed
        };
    }

    // =========================================================================
    // STATE
    // =========================================================================
    const loadState  = () => { try { const r = localStorage.getItem(STATE_KEY); return r ? JSON.parse(r) : null; } catch { return null; } };
    const saveState  = s  => { try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch {} };
    const clearState = () => { try { localStorage.removeItem(STATE_KEY); } catch {} };

    // =========================================================================
    // LOGGING
    // =========================================================================
    let logArea = null;

    function log(msg, color = '#ccc') {
        try {
            const arr = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
            arr.push({ msg, color });
            while (arr.length > LOG_MAX_LINES) arr.shift();
            localStorage.setItem(LOG_KEY, JSON.stringify(arr));
        } catch {}
        if (!logArea) return;
        const line = document.createElement('div');
        line.style.color = color;
        line.textContent = msg;
        logArea.appendChild(line);
        logArea.scrollTop = logArea.scrollHeight;
    }

    function replayLog() {
        if (!logArea) return;
        try {
            for (const { msg, color } of JSON.parse(localStorage.getItem(LOG_KEY) || '[]')) {
                const line = document.createElement('div');
                line.style.color = color || '#ccc';
                line.textContent = msg;
                logArea.appendChild(line);
            }
            logArea.scrollTop = logArea.scrollHeight;
        } catch {}
    }

    function clearLog() {
        try { localStorage.removeItem(LOG_KEY); } catch {}
        if (logArea) logArea.innerHTML = '';
    }

    // =========================================================================
    // UI PANEL
    // =========================================================================
    let panelEl, progressEl;

    function setProgress(msg) { if (progressEl) progressEl.textContent = msg; }

    function setRunningUI(running) {
        if (!panelEl) return;
        panelEl.querySelector('.btn-scan').disabled  = running;
        panelEl.querySelector('.btn-dry').style.display  = running ? 'none' : '';
        panelEl.querySelector('.btn-run').style.display  = running ? 'none' : '';
        panelEl.querySelector('.btn-reset').disabled = running;
        panelEl.querySelector('.btn-stop').style.display = running ? '' : 'none';
        panelEl.querySelector('.btn-stop').disabled = false;
        panelEl.querySelector('.btn-stop').textContent = 'Stop';
    }

    function setActionButtonsEnabled(enabled) {
        if (!panelEl) return;
        panelEl.querySelector('.btn-dry').disabled = !enabled;
        panelEl.querySelector('.btn-run').disabled = !enabled;
    }

    function buildPanel() {
        if (document.getElementById('jl-redeploy-panel')) return;

        panelEl = document.createElement('div');
        panelEl.id = 'jl-redeploy-panel';
        panelEl.innerHTML = `
<style>
#jl-redeploy-panel {
  position:fixed; top:10px; right:10px; z-index:99999;
  background:#1a1a2e; color:#eee; border-radius:8px; width:520px;
  max-height:88vh; display:flex; flex-direction:column;
  font-family:monospace; font-size:12px;
  box-shadow:0 4px 20px rgba(0,0,0,.55);
}
#jl-redeploy-panel header {
  display:flex; justify-content:space-between; align-items:center;
  padding:10px 14px; border-bottom:1px solid #333; cursor:move; user-select:none;
}
#jl-redeploy-panel header b { font-size:13px; }
#jl-redeploy-panel .body { padding:10px 14px; display:flex; flex-direction:column; gap:8px; overflow-y:auto; }
#jl-redeploy-panel .progress { color:#0fa; font-weight:600; min-height:1.4em; }
#jl-redeploy-panel .controls { display:flex; gap:6px; flex-wrap:wrap; }
#jl-redeploy-panel button {
  background:#2563eb; color:#fff; border:0; border-radius:4px;
  padding:6px 12px; cursor:pointer; font-family:monospace; font-size:12px;
}
#jl-redeploy-panel .btn-scan  { background:#0891b2; }
#jl-redeploy-panel .btn-dry   { background:#ca8a04; }
#jl-redeploy-panel .btn-run   { background:#16a34a; }
#jl-redeploy-panel .btn-stop  { background:#991b1b; display:none; font-weight:700; }
#jl-redeploy-panel .btn-reset { background:#4b5563; }
#jl-redeploy-panel .btn-close { background:transparent; border:none; color:#eee; font-size:16px; cursor:pointer; }
#jl-redeploy-panel button[disabled] { opacity:.4; cursor:not-allowed; }
#jl-redeploy-panel .hint { color:#6b7280; font-size:11px; line-height:1.45; }
#jl-redeploy-panel .log {
  background:#0a0a1a; padding:8px; border-radius:4px;
  overflow-y:auto; max-height:46vh;
  white-space:pre-wrap; word-break:break-word;
}
#jl-redeploy-panel .log div { padding:1px 0; line-height:1.35; }
</style>
<header>
  <b>Redeploy Visits</b>
  <button class="btn-close">×</button>
</header>
<div class="body">
  <div class="progress">Filter the Jobs list by engineer, then click Scan.</div>
  <div class="controls">
    <button class="btn-scan">Scan Jobs</button>
    <button class="btn-dry" disabled>Dry Run</button>
    <button class="btn-run" disabled>Redeploy All</button>
    <button class="btn-stop">Stop</button>
    <button class="btn-reset">Reset</button>
  </div>
  <div style="display:flex;align-items:center;gap:6px;">
    <label style="color:#9ca3af;white-space:nowrap;font-size:11px;">Engineer name:</label>
    <input class="eng-filter" type="text" placeholder="e.g. Joe Bloggs"
      style="flex:1;background:#0a0a1a;border:1px solid #374151;border-radius:3px;
             color:#eee;padding:4px 7px;font:12px monospace;">
  </div>
  <div class="hint">
    Re-sends each job's EXISTING visits to the engineer named above, so the job
    reappears in their app. It never creates, copies or moves a visit — only
    visits Joblogic reports as redeployable are touched. Stop halts immediately.
  </div>
  <div class="log"></div>
</div>`;
        document.body.appendChild(panelEl);
        jlRegisterPanel(panelEl, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR, SCRIPT_DESC);

        logArea   = panelEl.querySelector('.log');
        progressEl = panelEl.querySelector('.progress');

        // Drag to reposition
        const hdr = panelEl.querySelector('header');
        let drag = null;
        hdr.addEventListener('mousedown', e => {
            if (e.target.closest('button')) return;
            drag = { x: e.clientX - panelEl.offsetLeft, y: e.clientY - panelEl.offsetTop };
        });
        window.addEventListener('mouseup', () => drag = null);
        window.addEventListener('mousemove', e => {
            if (!drag) return;
            panelEl.style.left  = (e.clientX - drag.x) + 'px';
            panelEl.style.top   = (e.clientY - drag.y) + 'px';
            panelEl.style.right = 'auto';
        });

        panelEl.querySelector('.btn-close').onclick = () => { panelEl.style.display = 'none'; };
        panelEl.querySelector('.btn-scan').onclick  = () => onScan();
        panelEl.querySelector('.btn-dry').onclick   = () => onStart(true);
        panelEl.querySelector('.btn-run').onclick   = () => onStart(false);
        panelEl.querySelector('.btn-stop').onclick  = onStop;
        panelEl.querySelector('.btn-reset').onclick = onReset;

        // Esc also stops a run in progress.
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && running) onStop();
        });
    }

    // =========================================================================
    // PAGINATION HELPER
    // =========================================================================
    // Returns the LI element for the next page, or null if on last page / not found.
    function findNextPageLi() {
        // Joblogic uses: ul.pagination > li.page-item.next (no .disabled = clickable)
        const li = qs('ul.pagination li.page-item.next');
        if (li && !li.classList.contains('disabled')) return li;
        return null;
    }

    function getActivePage() {
        const active = qs('ul.pagination li.page-item.active a, ul.pagination li.page-number.active a');
        return parseInt((active?.textContent || '0').trim(), 10);
    }

    // =========================================================================
    // BUTTON HANDLERS
    // =========================================================================
    async function onScan() {
        const scanBtn = panelEl?.querySelector('.btn-scan');
        if (scanBtn) scanBtn.disabled = true;

        const allJobs = [];
        const seen    = new Set();
        let   page    = 1;

        setProgress('Scanning page 1…');
        clearLog();

        while (true) {
            const pageJobs = scrapeJobsFromList();
            let newCount = 0;
            for (const j of pageJobs) {
                if (!seen.has(j.id)) { seen.add(j.id); allJobs.push(j); newCount++; }
            }
            log(`Page ${page}: +${newCount} jobs (${allJobs.length} total)`, '#0af');
            setProgress(`Scanning… page ${page}, ${allJobs.length} job(s) found`);

            const nextLi = findNextPageLi();
            if (!nextLi) {
                log('No further pages detected — scan complete.', '#0af');
                break;
            }

            const currentActivePage = getActivePage();

            const a = nextLi.querySelector('a.page-link') || nextLi.querySelector('a') || nextLi;

            // 1. Try Vue component methods — walk up from the LI to find a component
            let advanced = false;
            let el = nextLi;
            while (el && !advanced) {
                const vue = el.__vue__;
                if (vue) {
                    for (const m of ['nextPage', 'next', 'goNext', 'goToNextPage', 'handleNext', 'onClick', 'handleClick']) {
                        if (typeof vue[m] === 'function') {
                            try { vue[m](currentActivePage + 1); advanced = true; break; } catch {}
                            try { vue[m](); advanced = true; break; } catch {}
                        }
                    }
                    if (!advanced) {
                        for (const ev of ['next', 'change', 'page-change', 'click']) {
                            try { vue.$emit(ev, currentActivePage + 1); } catch {}
                        }
                    }
                }
                el = el.parentElement;
            }

            // 2. PointerEvent (Vue 3 and some component libs listen to pointer events)
            if (!advanced) {
                a.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
                a.dispatchEvent(new PointerEvent('pointerup',   { bubbles: true, cancelable: true }));
            }

            // 3. Full mouse + click sequence on both the <a> and parent <li>
            fire(a,      'mousedown'); fire(a,      'mouseup'); fire(a,      'click');
            fire(nextLi, 'mousedown'); fire(nextLi, 'mouseup'); fire(nextLi, 'click');

            // Detect page change by watching the active page number
            try {
                await waitFor(
                    () => getActivePage() > currentActivePage ? true : null,
                    { timeout: 8000, interval: 200 }
                );
            } catch {
                log('Pagination timed out — stopping at current page', '#fa0');
                break;
            }

            page++;
        }

        if (scanBtn) scanBtn.disabled = false;

        if (!allJobs.length) {
            setProgress('No jobs found — are you on the Jobs list with results visible?');
            return;
        }

        const st = {
            rows: allJobs.map(j => ({ ...j, status: 'pending', redeployed: 0, failed: 0, error: null })),
            currentIndex: 0,
            running: false,
            dryRun: false,
            phase: 'idle'
        };
        saveState(st);
        setActionButtonsEnabled(true);
        setProgress(`Found ${allJobs.length} job(s) across ${page} page(s). Click Dry Run to preview, or Redeploy All to run.`);
        log(`Scan complete — ${allJobs.length} jobs:`, '#0fa');
        allJobs.slice(0, 30).forEach(j => log(`  ${j.ref}  (id=${j.id})`));
        if (allJobs.length > 30) log(`  …and ${allJobs.length - 30} more`);
    }

    async function onStart(dryRun) {
        const st = loadState();
        if (!st?.rows?.length) { setProgress('No jobs loaded — click Scan first.'); return; }
        if (running) { setProgress('Already running — click Stop first.'); return; }

        const engFilter = (panelEl?.querySelector('.eng-filter')?.value || '').trim();
        if (!engFilter) { setProgress('Enter the engineer name before running.'); return; }
        if (!dryRun) {
            if (!confirm(`Redeploy the existing visits for "${engFilter}" on ${st.rows.length} job(s)?\n\nThis re-sends visits that are already there — it does not create any new visit.`)) return;
        }

        st.running = true;
        st.dryRun  = dryRun;
        st.engineerFilter = engFilter;
        st.currentIndex = 0;
        st.rows.forEach(r => { r.status = 'pending'; r.error = null; r.redeployed = 0; r.failed = 0; });
        st.phase = dryRun ? 'dry-run' : 'running';
        saveState(st);
        clearLog();

        stopRequested = false;
        running = true;
        setRunningUI(true);
        try {
            await runAll(st);
        } finally {
            running = false;
            setRunningUI(false);
        }
    }

    function onStop() {
        stopRequested = true;
        const st = loadState();
        if (st) { st.running = false; st.phase = 'stopped'; saveState(st); }
        if (panelEl) {
            const b = panelEl.querySelector('.btn-stop');
            b.disabled = true;
            b.textContent = 'Stopping…';
        }
        log('Stop requested — finishing the current call, then halting.', '#fa0');
        setProgress('Stopping…');
    }

    function onReset() {
        if (running) { setProgress('Stop the run before resetting.'); return; }
        if (!confirm('Clear loaded jobs and log?')) return;
        clearState();
        clearLog();
        setProgress('Filter the Jobs list by engineer, then click Scan.');
        setRunningUI(false);
        setActionButtonsEnabled(false);
    }

    // =========================================================================
    // RUN LOOP
    //
    // Everything happens from the Jobs list page over the API, so there is no
    // page navigation to interrupt — Stop halts after the in-flight call.
    // =========================================================================
    let running = false;
    let stopRequested = false;

    async function runAll(st) {
        for (st.currentIndex = 0; st.currentIndex < st.rows.length; st.currentIndex++) {
            if (stopRequested) break;

            const row = st.rows[st.currentIndex];
            setProgress(`${st.dryRun ? '[DRY] ' : ''}Job ${st.currentIndex + 1}/${st.rows.length}: ${row.ref}`);

            try {
                const result = await processJob(row, st);
                row.status     = result.status;
                row.redeployed = result.redeployed || 0;
                row.failed     = result.failed     || 0;
                row.error      = result.error      || null;
            } catch (e) {
                log(`ERROR on ${row.ref}: ${e.message}`, '#f55');
                row.status = 'error';
                row.error  = e.message;
            }

            saveState(st);
            await sleep(JOB_GAP_MS);
        }

        const stopped = stopRequested;
        const done    = Math.min(st.currentIndex, st.rows.length);
        st.running = false;
        st.phase   = stopped ? 'stopped' : 'done';
        saveState(st);

        finishRun(stopped
            ? `Stopped after ${done}/${st.rows.length} job(s) — click Redeploy All to run again, or Reset to clear.`
            : `Done — ${st.rows.length} job(s) processed.`);
    }

    function finishRun(msg) {
        setProgress(msg);
        log(msg, '#0fa');
        const st = loadState();
        if (st?.rows) {
            const ok      = st.rows.filter(r => r.status === 'ok').length;
            const skipped = st.rows.filter(r => r.status === 'skipped').length;
            const failed  = st.rows.filter(r => ['fail', 'error'].includes(r.status)).length;
            log(`Summary — ok: ${ok}, skipped: ${skipped}, failed: ${failed}`, '#0af');

            const withVisits = st.rows.filter(r => r.redeployed > 0);
            if (withVisits.length) {
                log(`Jobs with redeployed visits (${withVisits.length}):`, '#0af');
                withVisits.forEach(r =>
                    log(`  ${r.ref}  — ${r.redeployed} visit(s)${r.failed ? `, ${r.failed} failed` : ''}`, '#ccc')
                );
            }
        }
    }

    // =========================================================================
    // BOOT
    // =========================================================================
    const SCRIPT_VERSION = '2.00';

    function boot() {
        buildPanel();
        replayLog();
        log(`Redeploy Visits v${SCRIPT_VERSION} loaded`, '#444');

        const st = loadState();
        if (st?.rows?.length) {
            const done = st.rows.filter(r => r.status && r.status !== 'pending').length;
            setProgress(`${done}/${st.rows.length} processed — phase: ${st.phase}`);
            setActionButtonsEnabled(true);
            // Restore the engineer filter input so it survives a reload
            if (st.engineerFilter) {
                const engInput = panelEl?.querySelector('.eng-filter');
                if (engInput) engInput.value = st.engineerFilter;
            }
            // A run only ever lives inside one page session now — never auto-resume.
            if (st.running) {
                st.running = false; st.phase = 'interrupted'; saveState(st);
                log('Previous run was interrupted by a page reload — not resuming automatically.', '#fa0');
            }
        }
        setRunningUI(false);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
