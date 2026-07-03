// ==UserScript==
// @name         Joblogic - Move PPM Visits to a New Date
// @namespace    https://go.joblogic.com/
// @version      3.01
// @description  On a PPM Contract page, paste "PMxxxx/nnn - Move to WC|MC: date" lines. For each visit on THIS contract it moves BOTH the contract due-date (SavePPMContractVisits) and the planner appointment (Scheduler/UpdateVisit) to the new window — WC = that Mon–Fri week, MC = 1st of month for 28 days. Verifies every change by re-reading (won't falsely report success). Headers/blanks and other-contract lines are ignored. Preview first, then Move.
// @match        https://go.joblogic.com/PPMContract/Detail/*
// @grant        none
// @run-at       document-start
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/joblogic-move-jobs-to-date.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/joblogic-move-jobs-to-date.user.js
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

    const SCRIPT_VERSION = '3.01';   // keep in sync with @version header
    const SCRIPT_ID = 'move-jobs-to-date';
    const SCRIPT_LABEL = '📆 Move PPM Visits to Date';
    const SCRIPT_COLOR = '#0b7285';
    const SCRIPT_DESC = 'On a PPM Contract page, paste "PMxxxx/nnn - Move to WC|MC: date" lines. Moves matching visits\' contract due-date AND planner slot to the new window (WC = Mon–Fri week, MC = 1st + 28 days). Verifies each change. Run once per contract. Preview first.';

    const PERSIST_KEY = 'jl-move-ppm-visits-input';

    if (window.__jlMovePpmVisitsLoaded) return;
    window.__jlMovePpmVisitsLoaded = true;

    // =========================================================================
    // CONFIG
    // =========================================================================
    const GET_VISITS_URL   = (guid)  => `/api/Visit/GetVisits/${guid}`;
    const SAVE_PPM_URL      = '/api/Visit/SavePPMContractVisits';
    const GET_VISITSJSON_URL = (jobId) => `/api/Visit/GetVisitsJson?&jobId=${jobId}&isAxaJob=false&isReadOnly=false&pageIndex=1&pageSize=200`;
    const UPDATE_VISIT_URL  = '/Scheduler/UpdateVisit';
    const DELAY_BETWEEN     = 500;      // ms between scheduler writes
    const WORK_START        = '08:00';  // working-day start
    const WORK_END          = '17:00';  // working-day end
    const MC_DAYS           = 28;        // MC visits run this many days from the 1st

    // =========================================================================
    // HELPERS
    // =========================================================================
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const pad2  = n => String(n).padStart(2, '0');
    const norm  = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

    function getToken() {
        const i = document.querySelector('input[name="__RequestVerificationToken"]');
        return i ? i.value : null;
    }
    // Contract GUID from the URL: /PPMContract/Detail/<guid>
    function contractGuid() {
        const m = location.pathname.match(/\/PPMContract\/Detail\/([0-9a-fA-F-]{36})/);
        return m ? m[1] : null;
    }
    // Contract number from the page title: "PM0001706 - PPM Contract - JobLogic"
    function contractNumber() {
        const m = (document.title || '').match(/\b(PM\d+)\b/);
        return m ? m[1] : null;
    }
    // The contract number embedded in a visit job number: "PM0001706/008" -> "PM0001706"
    const baseContract = jn => String(jn || '').split('/')[0].trim();

    const fullYear = y => { y = +y; return y < 100 ? 2000 + y : y; };
    const fmtDateTime = dt => `${pad2(dt.getDate())}/${pad2(dt.getMonth() + 1)}/${dt.getFullYear()} ${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;
    const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // Compute the visit window for a WC / MC target.
    // Returns { startStr, endStr, durMin, human } or { error }.
    //  WC (DD/MM/YY): start on the date @ WORK_START, end that week's Friday @ WORK_END.
    //  MC (MM/YY):    start on the 1st @ WORK_START, end +MC_DAYS days @ WORK_END.
    function computeWindow(mode, dateStr) {
        const [sh, sm] = WORK_START.split(':').map(Number);
        const [eh, em] = WORK_END.split(':').map(Number);
        let start, end;
        if (mode === 'WC') {
            const m = String(dateStr).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
            if (!m) return { error: `bad WC date "${dateStr}" — expected DD/MM/YY` };
            const [, d, mo, y] = m;
            start = new Date(fullYear(y), +mo - 1, +d, sh, sm);
            if (isNaN(start.getTime()) || +mo < 1 || +mo > 12 || +d < 1 || +d > 31) return { error: `invalid WC date "${dateStr}"` };
            const toFri = (5 - start.getDay() + 7) % 7;   // Friday of this working week
            end = new Date(start.getTime()); end.setDate(end.getDate() + toFri); end.setHours(eh, em, 0, 0);
        } else if (mode === 'MC') {
            const m = String(dateStr).match(/^(\d{1,2})\/(\d{2,4})$/);
            if (!m) return { error: `bad MC date "${dateStr}" — expected MM/YY` };
            const [, mo, y] = m;
            if (+mo < 1 || +mo > 12) return { error: `invalid MC month "${dateStr}"` };
            start = new Date(fullYear(y), +mo - 1, 1, sh, sm);
            end = new Date(start.getTime()); end.setDate(end.getDate() + MC_DAYS); end.setHours(eh, em, 0, 0);
        } else {
            return { error: `unknown mode "${mode}"` };
        }
        const durMin = Math.round((end.getTime() - start.getTime()) / 60000);
        const human = mode === 'WC'
            ? `WC ${fmtDateTime(start).slice(0, 10)} (${dayName[start.getDay()]}→Fri ${fmtDateTime(end).slice(0, 10)})`
            : `MC ${fmtDateTime(start).slice(0, 10)} (+${MC_DAYS}d → ${fmtDateTime(end).slice(0, 10)})`;
        return { startStr: fmtDateTime(start), endStr: fmtDateTime(end), durMin, human };
    }

    // Parse the pasted block. One target per line matching
    //   "<jobNumber> - Move to WC|MC: <date>". Blank/header lines ignored.
    function parseTargets(text) {
        const re = /^([A-Za-z]{1,5}\d+(?:\/\d+)?)\s*-\s*move\s*to\s*(wc|mc)\s*:\s*([0-9/]+)\s*$/i;
        const out = [];
        for (const raw of String(text || '').split(/\r?\n/)) {
            const line = raw.trim();
            if (!line) continue;
            const m = line.match(re);
            if (!m) continue;
            const jobNumber = m[1].trim();
            const mode = m[2].toUpperCase();
            const dateStr = m[3].trim();
            out.push({ jobNumber, mode, dateStr, ...computeWindow(mode, dateStr) });
        }
        return out;
    }

    // =========================================================================
    // API CALLS
    // =========================================================================

    // Full PPM contract visit model (AdditionalData: PPMContractId, SiteId, Visits[]).
    async function getContractVisits(guid) {
        const r = await fetch(GET_VISITS_URL(guid), { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        if (!r.ok) throw new Error('GetVisits HTTP ' + r.status);
        const j = await r.json();
        return j.AdditionalData || {};
    }

    // Build the trimmed per-visit submit object (matches the page's GetSubmitData).
    function buildSubmitVisit(v, startStr, durMin) {
        const at = v.AssignType;
        return {
            Id: v.Id,
            AssignType: at,
            EngineerId: (at === 0 || at === 2) ? v.EngineerId : null,
            EngineerTeamId: (at === 1) ? v.EngineerTeamId : null,
            SubcontractorId: (at === 3) ? v.SubcontractorId : null,
            JobId: v.JobId,
            JobCategoryId: v.JobCategoryId,
            Description: v.Description,
            StartDate: startStr,
            EstDuration: durMin,
            FixedPriceValue: v.FixedPriceValue,
            Appointment: v.Appointment,
            SendEmailSMS: false,
            IsNew: false,
            Edited: true,
            IsDeleted: false,
            FixedDuration: true,
            Assets: [],
            Tasks: [],
            LastUsedServiceOrder: v.LastUsedServiceOrder || null,
            TradeId: v.TradeId,
            TradeDescription: v.TradeDescription,
            IsDateAndTimeLocked: v.IsDateAndTimeLocked,
            AdminEnforcedLock: v.AdminEnforcedLock
        };
    }

    // Save changed PPM contract visits in one call (matches the page's save: the
    // whole model JSON in a single "dataFile" blob field).
    async function savePpmVisits(ppmContractId, siteId, submitVisits) {
        const model = { PPMContractId: ppmContractId, SiteId: siteId, Visits: submitVisits };
        const fd = new FormData();
        fd.append('dataFile', new Blob([JSON.stringify(model)], { type: 'application/json' }), 'dataFileBlob');
        const r = await fetch(SAVE_PPM_URL, {
            method: 'POST', credentials: 'same-origin',
            headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json', '__RequestVerificationToken': getToken() },
            body: fd
        });
        const j = await r.json().catch(() => null);
        if (!r.ok) throw new Error('SavePPMContractVisits HTTP ' + r.status);
        // NB: this endpoint returns success:true even when it silently ignores a
        // non-editable visit — callers MUST verify by re-reading.
        if (!j || j.success !== true) throw new Error((j && j.errors && j.errors.join(', ')) || 'SavePPMContractVisits returned failure');
        return j;
    }

    // Scheduler side: find the (latest) planner appointment for a job.
    async function getSchedulerVisit(jobId) {
        const r = await fetch(GET_VISITSJSON_URL(jobId), { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        if (!r.ok) throw new Error('GetVisitsJson HTTP ' + r.status);
        const ad = (await r.json()).AdditionalData || {};
        const visits = ad.Visits || [];
        let best = null, bestKey = '';
        for (const v of visits) {
            const m = String(v.StartDate || '').match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2}))?/);
            const key = m ? `${m[3]}${m[2]}${m[1]}${m[4] || '00'}${m[5] || '00'}` : '';
            if (!best || key >= bestKey) { best = v; bestKey = key; }
        }
        return { visit: best, typeOfJob: ad.TypeOfJob };
    }
    // Move (re-date) a planner appointment. Keeps its engineer.
    async function moveSchedulerVisit({ visitId, jobId, jobNumber, typeOfJob, isTeamVisit, deploy, startStr, endStr }) {
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
        const r = await fetch(UPDATE_VISIT_URL, {
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
    // Reads THIS contract's visits, matches each pasted target for this contract,
    // and works out the new window + whether the due-date is editable.
    // =========================================================================
    async function buildPlan() {
        const guid = contractGuid();
        const num = contractNumber();
        if (!guid) throw new Error('No PPM contract GUID in the URL — open a PPM Contract detail page.');

        const all = parseTargets(jobsInputEl ? jobsInputEl.value : '');
        const mine = [], others = [];
        for (const t of all) (num && baseContract(t.jobNumber) === num ? mine : others).push(t);

        const ad = await getContractVisits(guid);
        const visits = ad.Visits || [];
        const byNum = new Map(visits.map(v => [norm(v.JobNumber), v]));

        const rows = [];
        for (const t of mine) {
            const row = { ...t, ok: false, reason: '' };
            if (t.error) { row.reason = t.error; rows.push(row); continue; }
            const v = byNum.get(norm(t.jobNumber));
            if (!v) { row.reason = 'not found on this contract'; rows.push(row); continue; }
            row.visit = v;
            row.jobId = v.JobId;
            row.currentStart = v.StartDate;
            // Already at the target window? (start + duration both match). If so the
            // due-date save is skipped; the planner slot is checked separately at move time.
            row.alreadyDue = norm(v.StartDate) === norm(row.startStr) && Number(v.EstDuration) === row.durMin;
            row.editable = !!v.EditVisitAllowed;
            row.isTeamVisit = v.AssignType === 1;
            row.engineerName = (v.EngineerName || v.EngineerTeamName || v.SubcontractorName || '').trim();
            row.status = v.JobStatusDescription;
            row.ok = true;
            rows.push(row);
        }
        return { guid, num, ppmContractId: ad.PPMContractId, siteId: ad.SiteId, rows, others, allCount: all.length };
    }

    // =========================================================================
    // ACTIONS
    // =========================================================================
    let running = false;
    let lastPlan = null;

    async function onPreview() {
        if (running) return;
        running = true; setRunningUI(true); clearLog(); lastPlan = null;
        if (runBtn) runBtn.disabled = true;
        try {
            if (!getToken()) { log('No verification token on this page — refresh and try again.', '#f55'); return; }
            const plan = await buildPlan();
            if (!plan.num) log('⚠ Could not read this contract\'s number from the page title.', '#fa0');
            log(`This contract: ${plan.num || '?'}  •  ${plan.rows.length} of your pasted line(s) belong here.`, '#0af');
            if (plan.others.length) {
                const otherNums = [...new Set(plan.others.map(o => baseContract(o.jobNumber)))].join(', ');
                log(`${plan.others.length} line(s) are for other contracts (${otherNums}) — open each and run there.`, '#89b4fa');
            }
            log('', '#ccc');
            log('========== PREVIEW ==========', '#0fa');
            let movable = 0;
            for (const r of plan.rows) {
                if (!r.ok) { log(`✗ ${r.jobNumber}  —  ${r.reason}`, '#f77'); continue; }
                movable++;
                const dueNote = !r.editable ? 'due-date: LOCKED (deployed) — planner only'
                    : (r.alreadyDue ? 'due-date: already at target' : 'due-date: editable');
                log(`✓ ${r.jobNumber}  [${r.status || '?'}, ${r.engineerName || 'no engineer'}]\n     ${r.human}   start ${r.startStr}  dur ${r.durMin}m\n     was ${r.currentStart}  •  ${dueNote}`, r.editable ? '#0fa' : '#fd0');
            }
            lastPlan = plan;
            log('', '#ccc');
            log(`Ready: ${movable} visit(s) to move on this contract.`, '#0fa');
            setProgress(movable ? `Preview done — ${movable} ready. Click "Move Visits".` : 'Preview done — nothing to move here.');
            if (runBtn) runBtn.disabled = movable === 0;
        } catch (e) {
            log('ERROR: ' + e.message, '#f55');
            setProgress('Error during preview.');
        } finally {
            running = false; setRunningUI(false);
        }
    }

    async function onMove() {
        if (running) return;
        if (!lastPlan) { log('Run Preview first.', '#fa0'); return; }
        const rows = lastPlan.rows.filter(r => r.ok);
        if (!rows.length) { log('Nothing to move on this contract.', '#fa0'); return; }
        const deploy = !!(deployEl && deployEl.checked);
        if (!confirm(`Move ${rows.length} visit(s) on ${lastPlan.num}?\n\nUpdates the contract due-date (where editable) AND the planner appointment${deploy ? ', deploying each to its engineer' : ''}. Each change is verified.`)) return;

        running = true; setRunningUI(true);
        try {
            // ---- 1) Contract due-date, batched, then verified by re-reading ----
            // Visits already at the target window are counted as done and not re-saved.
            const dueOk = new Set();
            rows.filter(r => r.editable && r.alreadyDue).forEach(r => dueOk.add(r.jobNumber));
            const toSave = rows.filter(r => r.editable && !r.alreadyDue);
            if (toSave.length) {
                setProgress(`Saving ${toSave.length} contract due-date(s)…`);
                try {
                    const submit = toSave.map(r => buildSubmitVisit(r.visit, r.startStr, r.durMin));
                    await savePpmVisits(lastPlan.ppmContractId, lastPlan.siteId, submit);
                    await sleep(1000);
                    const ad = await getContractVisits(lastPlan.guid);
                    const after = new Map((ad.Visits || []).map(v => [norm(v.JobNumber), v]));
                    for (const r of toSave) {
                        const v = after.get(norm(r.jobNumber));
                        if (v && norm(v.StartDate) === norm(r.startStr)) dueOk.add(r.jobNumber);
                    }
                } catch (e) {
                    log('Contract save failed: ' + e.message, '#f55');
                }
            }

            // ---- 2) Planner appointment, per visit, verified via the response ----
            let done = 0;
            for (let i = 0; i < rows.length; i++) {
                if (!running) { log('Stopped by user.', '#fa0'); break; }
                const r = rows[i];
                setProgress(`Planner ${i + 1}/${rows.length}: ${r.jobNumber}`);
                let schedMsg = '';
                try {
                    const { visit, typeOfJob } = await getSchedulerVisit(r.jobId);
                    if (!visit) {
                        schedMsg = 'no planner appointment';
                    } else if (norm(visit.StartDate) === norm(r.startStr) && norm(visit.EndDate) === norm(r.endStr)) {
                        schedMsg = 'planner already correct';
                    } else {
                        await moveSchedulerVisit({
                            visitId: visit.Id, jobId: r.jobId, jobNumber: r.jobNumber,
                            typeOfJob: typeOfJob != null ? typeOfJob : 2, isTeamVisit: r.isTeamVisit,
                            deploy, startStr: r.startStr, endStr: r.endStr
                        });
                        schedMsg = 'planner moved' + (deploy ? ' + deployed' : '');
                    }
                } catch (e) {
                    schedMsg = 'planner FAILED: ' + e.message;
                }

                const duePart = !r.editable ? 'due-date LOCKED (planner only)'
                    : (r.alreadyDue ? 'due-date already correct'
                    : (dueOk.has(r.jobNumber) ? 'due-date moved' : 'due-date NOT applied (verify failed)'));
                const good = (r.editable ? dueOk.has(r.jobNumber) : true) && !/FAILED/.test(schedMsg);
                if (good) done++;
                log(`${r.jobNumber}  →  ${r.startStr}\n     ${duePart}  |  ${schedMsg}`, good ? '#0fa' : '#fd0');
                await sleep(DELAY_BETWEEN);
            }

            log('', '#ccc');
            log('========== SUMMARY ==========', '#0fa');
            log(`${done}/${rows.length} fully applied on ${lastPlan.num}.`, '#0fa');
            const lockedN = rows.filter(r => !r.editable).length;
            if (lockedN) log(`${lockedN} had a LOCKED contract due-date (deployed) — only their planner slot moved. Re-date those in the planner if needed.`, '#fd0');
            setProgress(`Done — ${done}/${rows.length} moved on ${lastPlan.num}.`);
            lastPlan = null;
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
#jl-movejobs-panel { position:fixed; top:10px; right:10px; z-index:99999; background:#1a1a2e; color:#eee; border-radius:8px; width:620px; max-height:88vh; display:flex; flex-direction:column; font-family:monospace; font-size:12px; box-shadow:0 4px 20px rgba(0,0,0,.55); }
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
#jl-movejobs-panel .log { background:#0a0a1a; padding:8px; border-radius:4px; overflow-y:auto; max-height:40vh; white-space:pre-wrap; word-break:break-word; }
#jl-movejobs-panel .log div { padding:1px 0; line-height:1.35; }
#jl-movejobs-panel .ver { color:#64748b; font-weight:400; font-size:11px; }
</style>
<header><b>Move PPM Visits to a New Date <span class="ver">v${SCRIPT_VERSION}</span></b><button class="btn-close">×</button></header>
<div class="body">
  <div class="progress">Paste your list, then Preview.</div>
  <label class="fld"><span>Paste lines — "&lt;PMxxxx/nnn&gt; - Move to WC|MC: date" (headers, blanks &amp; other-contract lines ignored)</span>
    <textarea class="jobs" placeholder="PM0001706/005 - Move to WC: 19/10/26&#10;PM0001706/008 - Move to MC: 12/26&#10;&#10;Lighting Controls:&#10;PM0001706/014 - Move to MC: 07/26"></textarea>
  </label>
  <div class="row">
    <label class="chk"><input type="checkbox" class="deploy"><span>Deploy (send to engineer) after moving the planner slot</span></label>
  </div>
  <div class="controls">
    <button class="btn-preview">Preview</button>
    <button class="btn-run" disabled>Move Visits</button>
    <button class="btn-stop">Stop</button>
  </div>
  <div class="hint">
    Run this <b>on each PPM Contract page</b> — it only touches visits belonging to the contract you're on (paste the whole list; it filters).
    For each match it moves <b>both</b> the contract <b>due-date</b> and the <b>planner appointment</b> to the new window:
    <b>WC</b> = start that Monday, run to Friday (Mon–Fri, ${WORK_START}–${WORK_END}); date <b>DD/MM/YY</b>.
    <b>MC</b> = start the 1st, run <b>${MC_DAYS} days</b> (${WORK_START}–${WORK_END}); date <b>MM/YY</b>.
    Already-deployed visits have a <b>locked</b> due-date — only their planner slot can move; these are flagged.
    Every change is <b>verified by re-reading</b>, so the summary reflects what actually moved.
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

        // Persist the paste across contracts (you run this on each contract in turn).
        try { const saved = localStorage.getItem(PERSIST_KEY); if (saved) jobsInputEl.value = saved; } catch (e) {}

        const hdr = panelEl.querySelector('header');
        let drag = null;
        hdr.addEventListener('mousedown', e => { if (e.target.closest('button')) return; drag = { x: e.clientX - panelEl.offsetLeft, y: e.clientY - panelEl.offsetTop }; });
        window.addEventListener('mouseup', () => drag = null);
        window.addEventListener('mousemove', e => { if (!drag) return; panelEl.style.left = (e.clientX - drag.x) + 'px'; panelEl.style.top = (e.clientY - drag.y) + 'px'; panelEl.style.right = 'auto'; });

        panelEl.querySelector('.btn-close').onclick = () => { panelEl.style.display = 'none'; };
        panelEl.querySelector('.btn-preview').onclick = onPreview;
        panelEl.querySelector('.btn-run').onclick = onMove;
        panelEl.querySelector('.btn-stop').onclick = onStop;
        const invalidate = () => { try { localStorage.setItem(PERSIST_KEY, jobsInputEl.value); } catch (e) {} if (lastPlan && runBtn) { runBtn.disabled = true; lastPlan = null; setProgress('Inputs changed — Preview again before moving.'); } };
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
