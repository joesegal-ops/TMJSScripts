// ==UserScript==
// @name         Joblogic - Move PPM Visits to a New Date
// @namespace    https://go.joblogic.com/
// @version      5.01
// @description  On the Jobs list, paste "PMxxxx/nnn - Move to WC|MC: date" lines spanning ANY number of PPM contracts. Not-yet-deployed visits are rescheduled in place (contract due-date); deployed visits get a NEW visit reallocated (Scheduler/AddVisit, same engineer, Not Sent) leaving the original untouched. WC = that Mon–Fri week, MC = 1st of month for 28 days. Resolves each contract automatically, verifies every change, skips ones already at the target. Preview first.
// @match        https://go.joblogic.com/Job*
// @grant        none
// @run-at       document-start
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/joblogic-move-jobs-to-date.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/joblogic-move-jobs-to-date.user.js
// ==/UserScript==

(function () {
    'use strict';

    // =========================================================================
    // SEARCH-JSON CAPTURE  (document-start, before the page's own load-time
    // search fires). We resolve a job number -> jobId by replaying the Job
    // list's own /api/Job/SearchJsonData body with SearchTerm swapped, rather
    // than reconstructing ~70 filter fields. Hook both fetch and XHR.
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

    const SCRIPT_VERSION = '5.01';   // keep in sync with @version header
    const SCRIPT_ID = 'move-jobs-to-date';
    const SCRIPT_LABEL = '📆 Move PPM Visits to Date';
    const SCRIPT_COLOR = '#0b7285';
    const SCRIPT_DESC = 'On the Jobs list, paste "PMxxxx/nnn - Move to WC|MC: date" lines across any number of PPM contracts. Not-yet-deployed visits are rescheduled in place (due-date); deployed visits get a NEW visit reallocated (same engineer, Not Sent), leaving the original. WC = Mon–Fri week, MC = 1st + 28 days. Resolves contracts automatically, verifies, skips ones already there. Preview first.';

    const PERSIST_KEY = 'jl-move-ppm-visits-input';

    if (window.__jlMovePpmVisitsLoaded) return;
    window.__jlMovePpmVisitsLoaded = true;

    // =========================================================================
    // CONFIG
    // =========================================================================
    const SEARCH_URL         = '/api/Job/SearchJsonData';
    const JOB_DETAIL_URL     = (jobId) => `/Job/Detail/${jobId}`;
    const GET_VISITS_URL     = (guid)  => `/api/Visit/GetVisits/${guid}`;
    const SAVE_PPM_URL       = '/api/Visit/SavePPMContractVisits';
    const GET_VISITSJSON_URL = (jobId) => `/api/Visit/GetVisitsJson?&jobId=${jobId}&isAxaJob=false&isReadOnly=false&pageIndex=1&pageSize=200`;
    const ADD_VISIT_URL      = '/Scheduler/AddVisit';
    const DELAY_BETWEEN      = 400;      // ms between scheduler writes
    const WORK_START         = '08:00';  // working-day start
    const WORK_END           = '17:00';  // working-day end
    const MC_DAYS            = 28;         // MC visits run this many days from the 1st
    // Visit statuses that don't count as a real allocation — a visit in one of
    // these sitting at the target date won't block a fresh reallocation.
    const DEAD_STATUS        = /reject|abort|abandon|cancel/i;

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
    // The contract number in a visit job number: "PM0001706/008" -> "PM0001706"
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

    async function ensureSearchBody() {
        for (let i = 0; i < 40 && !window.__jlJobSearchBody; i++) await sleep(150);
        return window.__jlJobSearchBody;
    }

    // Resolve a job number -> its job record {Id, JobNumber, ...} by replaying the
    // page's captured search body with SearchTerm swapped.
    async function resolveJob(jobNumber) {
        const tmpl = window.__jlJobSearchBody;
        if (!tmpl) throw new Error('No search template captured yet');
        let body; try { body = JSON.parse(tmpl); } catch (e) { throw new Error('Bad search template'); }
        body.SearchTerm = jobNumber; body.QuickSearchTerm = jobNumber; body.PageIndex = 1;
        if (!body.PageSize || body.PageSize < 25) body.PageSize = 50;
        const r = await fetch(SEARCH_URL, {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json', '__RequestVerificationToken': getToken() },
            body: JSON.stringify(body)
        });
        if (!r.ok) throw new Error('SearchJsonData HTTP ' + r.status);
        const jobs = ((await r.json().catch(() => null)) || {}).AdditionalData;
        const list = (jobs && jobs.Jobs) || [];
        const want = norm(jobNumber);
        return list.find(x => norm(x.JobNumber) === want) || null;
    }

    // Get the PPM contract GUID a job belongs to by scraping the job detail page
    // (it links its contract as /PPMContract/Detail/<guid>). NB: don't use the
    // search record's UniqueId — that's the JOB's GUID, not the contract's.
    async function contractGuidForJob(job) {
        const t = await (await fetch(JOB_DETAIL_URL(job.Id), { credentials: 'same-origin' })).text();
        const m = t.match(/\/PPMContract\/Detail\/([0-9a-fA-F-]{36})/);
        return m ? m[1] : null;
    }

    // Full PPM contract visit model (AdditionalData: PPMContractId, SiteId, Visits[]).
    async function getContractVisits(guid) {
        const r = await fetch(GET_VISITS_URL(guid), { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        if (!r.ok) throw new Error('GetVisits HTTP ' + r.status);
        return (await r.json()).AdditionalData || {};
    }

    // Trimmed per-visit submit object (matches the page's GetSubmitData).
    function buildSubmitVisit(v, startStr, durMin) {
        const at = v.AssignType;
        return {
            Id: v.Id, AssignType: at,
            EngineerId: (at === 0 || at === 2) ? v.EngineerId : null,
            EngineerTeamId: (at === 1) ? v.EngineerTeamId : null,
            SubcontractorId: (at === 3) ? v.SubcontractorId : null,
            JobId: v.JobId, JobCategoryId: v.JobCategoryId, Description: v.Description,
            StartDate: startStr, EstDuration: durMin,
            FixedPriceValue: v.FixedPriceValue, Appointment: v.Appointment, SendEmailSMS: false,
            IsNew: false, Edited: true, IsDeleted: false, FixedDuration: true,
            Assets: [], Tasks: [], LastUsedServiceOrder: v.LastUsedServiceOrder || null,
            TradeId: v.TradeId, TradeDescription: v.TradeDescription,
            IsDateAndTimeLocked: v.IsDateAndTimeLocked, AdminEnforcedLock: v.AdminEnforcedLock
        };
    }

    // Save changed PPM contract visits in one call (whole model JSON in a single
    // "dataFile" blob field — matches the page's createBlobFormData save).
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
        // NB: returns success:true even when it silently ignores a non-editable
        // visit — callers MUST verify by re-reading.
        if (!j || j.success !== true) throw new Error((j && j.errors && j.errors.join(', ')) || 'SavePPMContractVisits returned failure');
        return j;
    }

    // Scheduler side: all planner appointments for a job (to duplicate-check).
    async function getSchedulerVisits(jobId) {
        const r = await fetch(GET_VISITSJSON_URL(jobId), { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        if (!r.ok) throw new Error('GetVisitsJson HTTP ' + r.status);
        const ad = (await r.json()).AdditionalData || {};
        return { visits: ad.Visits || [], typeOfJob: ad.TypeOfJob };
    }
    // Reallocate: create a NEW visit for the engineer on the target window, leaving
    // any existing (rejected/old) visit untouched. deploy=false → created Not Sent.
    async function reallocateVisit({ jobId, jobNumber, typeOfJob, engineerId, deploy, startStr, endStr }) {
        const fd = new FormData();
        fd.append('jobId', jobId);
        fd.append('typeOfJob', typeOfJob);
        fd.append('jobNumber', jobNumber);
        fd.append('deploy', !!deploy);
        fd.append('engineerId', engineerId);
        fd.append('startDate', startStr);
        fd.append('endDate', endStr);
        fd.append('isDateAndTimeLocked', false);
        const r = await fetch(ADD_VISIT_URL, {
            method: 'POST', credentials: 'same-origin',
            headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json', '__RequestVerificationToken': getToken() },
            body: fd
        });
        const j = await r.json().catch(() => null);
        if (!r.ok) throw new Error('AddVisit HTTP ' + r.status);
        if (!j || j.success !== true) throw new Error((j && j.errors && j.errors.join(', ')) || 'AddVisit returned failure');
        return j;
    }

    // =========================================================================
    // BUILD A PLAN  (shared by Preview + Move)
    //
    // Groups pasted targets by contract, resolves each contract's GUID + visit
    // model once, and builds a per-visit row (window, editability, already-there).
    // Returns { contracts:[{num, guid, ppmContractId, siteId, rows:[…], error}] }.
    // =========================================================================
    async function buildPlan() {
        const all = parseTargets(jobsInputEl ? jobsInputEl.value : '');
        const groups = new Map();
        for (const t of all) {
            const num = baseContract(t.jobNumber);
            if (!groups.has(num)) groups.set(num, []);
            groups.get(num).push(t);
        }

        const contracts = [];
        let ci = 0;
        for (const [num, tgts] of groups) {
            if (!running) break;
            ci++;
            setProgress(`Resolving contract ${ci}/${groups.size}: ${num}…`);
            const cx = { num, guid: null, ppmContractId: null, siteId: null, rows: [], error: null };

            // Resolve the contract GUID via any of its target job numbers.
            let guid = null;
            for (const t of tgts) {
                if (!running) break;
                let job = null;
                try { job = await resolveJob(t.jobNumber); } catch (e) { cx.error = e.message; }
                if (job) { try { guid = await contractGuidForJob(job); } catch (e) {} if (guid) break; }
            }
            if (!guid) {
                cx.error = cx.error || 'could not resolve this contract (job number not found, or not a PPM job)';
                tgts.forEach(t => cx.rows.push({ ...t, ok: false, reason: cx.error }));
                contracts.push(cx); continue;
            }
            cx.guid = guid;

            let ad;
            try { ad = await getContractVisits(guid); }
            catch (e) { cx.error = 'GetVisits failed: ' + e.message; tgts.forEach(t => cx.rows.push({ ...t, ok: false, reason: cx.error })); contracts.push(cx); continue; }
            cx.ppmContractId = ad.PPMContractId; cx.siteId = ad.SiteId;
            const byNum = new Map((ad.Visits || []).map(v => [norm(v.JobNumber), v]));

            for (const t of tgts) {
                const row = { ...t, ok: false, reason: '' };
                if (t.error) { row.reason = t.error; cx.rows.push(row); continue; }
                const v = byNum.get(norm(t.jobNumber));
                if (!v) { row.reason = `not found on contract ${num}`; cx.rows.push(row); continue; }
                row.visit = v; row.jobId = v.JobId; row.currentStart = v.StartDate;
                row.alreadyDue = norm(v.StartDate) === norm(row.startStr) && Number(v.EstDuration) === row.durMin;
                row.editable = !!v.EditVisitAllowed;   // true = reschedule due-date in place; false = deployed → reallocate
                row.assignType = v.AssignType;
                row.engineerId = v.EngineerId;
                row.engineerName = (v.EngineerName || v.EngineerTeamName || v.SubcontractorName || '').trim();
                row.status = v.JobStatusDescription;
                row.ok = true;
                cx.rows.push(row);
            }
            contracts.push(cx);
            await sleep(120);
        }
        return { contracts };
    }

    // =========================================================================
    // ACTIONS
    // =========================================================================
    let running = false;
    let lastPlan = null;

    function planCounts(plan) {
        let ok = 0, bad = 0;
        for (const c of plan.contracts) for (const r of c.rows) (r.ok ? ok++ : bad++);
        return { ok, bad };
    }

    async function onPreview() {
        if (running) return;
        running = true; setRunningUI(true); clearLog(); lastPlan = null;
        if (runBtn) runBtn.disabled = true;
        try {
            if (!getToken()) { log('No verification token on this page — refresh and try again.', '#f55'); return; }
            const targets = parseTargets(jobsInputEl ? jobsInputEl.value : '');
            if (!targets.length) { log('No "… - Move to WC|MC: date" lines found. Paste your list and try again.', '#f55'); return; }
            log('Waiting for the job-list search to be ready…', '#0af');
            if (!await ensureSearchBody()) { log('Could not capture the job-list search. Run a normal search on this page once, then Preview again.', '#f55'); return; }

            const plan = await buildPlan();
            const { ok, bad } = planCounts(plan);
            log(`${plan.contracts.length} contract(s), ${ok} visit(s) matched${bad ? `, ${bad} problem(s)` : ''}.`, '#0af');
            log('', '#ccc');
            log('========== PREVIEW ==========', '#0fa');
            for (const c of plan.contracts) {
                log(`── ${c.num} ${c.error ? '(' + c.error + ')' : ''}`, c.error ? '#f77' : '#89b4fa');
                for (const r of c.rows) {
                    if (!r.ok) { log(`   ✗ ${r.jobNumber}  —  ${r.reason}`, '#f77'); continue; }
                    const action = !r.editable
                        ? (r.assignType === 0 && r.engineerId ? 'DEPLOYED → reallocate a NEW visit (Not Sent)' : 'DEPLOYED, not an engineer visit → manual')
                        : (r.alreadyDue ? 'due-date already at target' : 'move due-date in place');
                    log(`   ✓ ${r.jobNumber}  [${r.status || '?'}, ${r.engineerName || 'no engineer'}]\n        ${r.human}   start ${r.startStr}  dur ${r.durMin}m\n        was ${r.currentStart}  •  ${action}`, r.editable ? '#0fa' : '#89d0fa');
                }
            }
            lastPlan = plan;
            log('', '#ccc');
            log(`Ready: ${ok} visit(s) across ${plan.contracts.filter(c => !c.error).length} contract(s).`, '#0fa');
            setProgress(ok ? `Preview done — ${ok} ready. Click "Move Visits".` : 'Preview done — nothing to move.');
            if (runBtn) runBtn.disabled = ok === 0;
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
        const total = planCounts(lastPlan).ok;
        if (!total) { log('Nothing to move.', '#fa0'); return; }
        const deploy = !!(deployEl && deployEl.checked);
        if (!confirm(`Process ${total} visit(s) across ${lastPlan.contracts.filter(c => !c.error).length} contract(s)?\n\n• Editable visits: reschedule the contract due-date in place.\n• Deployed visits: reallocate a NEW visit${deploy ? ' and deploy it' : ' (Not Sent)'}, leaving the original untouched.\n\nEach change is verified; anything already at the target is skipped.`)) return;

        running = true; setRunningUI(true);
        let done = 0, reallocated = 0, attempted = 0;
        try {
            for (const c of lastPlan.contracts) {
                if (!running) { log('Stopped by user.', '#fa0'); break; }
                const rows = c.rows.filter(r => r.ok);
                if (!rows.length) continue;
                log('', '#ccc');
                log(`── ${c.num}`, '#89b4fa');

                // 1) Editable (not-yet-deployed): reschedule the due-date in place.
                //    Batched + verified. Already-there = done, not re-saved.
                const dueOk = new Set();
                rows.filter(r => r.editable && r.alreadyDue).forEach(r => dueOk.add(r.jobNumber));
                const toSave = rows.filter(r => r.editable && !r.alreadyDue);
                if (toSave.length) {
                    setProgress(`${c.num}: saving ${toSave.length} due-date(s)…`);
                    try {
                        await savePpmVisits(c.ppmContractId, c.siteId, toSave.map(r => buildSubmitVisit(r.visit, r.startStr, r.durMin)));
                        await sleep(900);
                        const ad = await getContractVisits(c.guid);
                        const after = new Map((ad.Visits || []).map(v => [norm(v.JobNumber), v]));
                        for (const r of toSave) { const v = after.get(norm(r.jobNumber)); if (v && norm(v.StartDate) === norm(r.startStr)) dueOk.add(r.jobNumber); }
                    } catch (e) { log(`   contract save failed: ${e.message}`, '#f55'); }
                }

                // 2) Per visit: editable → report the due-date move; deployed → reallocate
                //    a NEW visit (leave the original untouched), skipping if one already exists there.
                for (let i = 0; i < rows.length; i++) {
                    if (!running) { log('Stopped by user.', '#fa0'); break; }
                    const r = rows[i]; attempted++;
                    setProgress(`${c.num}: ${i + 1}/${rows.length} — ${r.jobNumber}`);

                    if (r.editable) {
                        const part = r.alreadyDue ? 'due-date already correct'
                            : (dueOk.has(r.jobNumber) ? 'due-date moved' : 'due-date NOT applied (verify failed)');
                        const good = r.alreadyDue || dueOk.has(r.jobNumber);
                        if (good) done++;
                        log(`   ${r.jobNumber}  →  ${r.startStr}    ${part}`, good ? '#0fa' : '#fd0');
                        continue;
                    }

                    // Deployed → reallocate a new visit.
                    let msg = '', good = false;
                    if (r.assignType !== 0 || !r.engineerId) {
                        msg = 'deployed & not an engineer visit — reallocate skipped (do manually)';
                    } else {
                        try {
                            // A rejected/aborted/abandoned/cancelled visit at the target does NOT
                            // count — we still want a fresh, live visit allocated there.
                            const isLiveAtTarget = v => norm(v.StartDate) === norm(r.startStr) && !DEAD_STATUS.test(v.StatusDescription || '');
                            const { visits, typeOfJob } = await getSchedulerVisits(r.jobId);
                            if (visits.some(isLiveAtTarget)) { msg = 'already reallocated (live visit exists at target)'; good = true; }
                            else {
                                await reallocateVisit({ jobId: r.jobId, jobNumber: r.jobNumber, typeOfJob: typeOfJob != null ? typeOfJob : 2, engineerId: r.engineerId, deploy, startStr: r.startStr, endStr: r.endStr });
                                await sleep(700);
                                if ((await getSchedulerVisits(r.jobId)).visits.some(isLiveAtTarget)) { msg = 'reallocated new visit (Not Sent)' + (deploy ? ' + deployed' : ''); good = true; reallocated++; }
                                else msg = 'reallocate NOT confirmed (no new live visit found)';
                            }
                        } catch (e) { msg = 'reallocate FAILED: ' + e.message; }
                    }
                    if (good) done++;
                    log(`   ${r.jobNumber}  →  ${r.startStr}    ${msg}  [${r.engineerName || 'no engineer'}]`, good ? '#0fa' : '#fd0');
                    await sleep(DELAY_BETWEEN);
                }
            }
            log('', '#ccc');
            log('========== SUMMARY ==========', '#0fa');
            log(`${done}/${attempted} done  (${reallocated} new visit(s) reallocated).`, '#0fa');
            setProgress(`Done — ${done}/${attempted}.`);
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
#jl-movejobs-panel { position:fixed; top:10px; right:10px; z-index:99999; background:#1a1a2e; color:#eee; border-radius:8px; width:640px; max-height:88vh; display:flex; flex-direction:column; font-family:monospace; font-size:12px; box-shadow:0 4px 20px rgba(0,0,0,.55); }
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
#jl-movejobs-panel .log { background:#0a0a1a; padding:8px; border-radius:4px; overflow-y:auto; max-height:42vh; white-space:pre-wrap; word-break:break-word; }
#jl-movejobs-panel .log div { padding:1px 0; line-height:1.35; }
#jl-movejobs-panel .ver { color:#64748b; font-weight:400; font-size:11px; }
</style>
<header><b>Move PPM Visits to a New Date <span class="ver">v${SCRIPT_VERSION}</span></b><button class="btn-close">×</button></header>
<div class="body">
  <div class="progress">Paste your list, then Preview.</div>
  <label class="fld"><span>Paste lines — "&lt;PMxxxx/nnn&gt; - Move to WC|MC: date" (headers &amp; blank lines ignored; any number of contracts)</span>
    <textarea class="jobs" placeholder="PM0000495/129 - Move to WC: 24/08/26&#10;PM0000603/189 - Move to WC: 24/08/26&#10;&#10;EICR:&#10;PM0001706/005 - Move to WC: 19/10/26&#10;&#10;Emergency Lighting Drain Test:&#10;PM0000495/037 - Move to MC: 12/26"></textarea>
  </label>
  <div class="row">
    <label class="chk"><input type="checkbox" class="deploy"><span>Deploy reallocated visits to the engineer (otherwise created Not Sent)</span></label>
  </div>
  <div class="controls">
    <button class="btn-preview">Preview</button>
    <button class="btn-run" disabled>Move Visits</button>
    <button class="btn-stop">Stop</button>
  </div>
  <div class="hint">
    Run this on the <b>Jobs list</b>. It groups your pasted lines by contract, resolves each one automatically, and per visit:
    <b>not-yet-deployed</b> → reschedule the contract <b>due-date in place</b>;
    <b>deployed</b> → <b>reallocate a NEW visit</b> for the same engineer (Not Sent), leaving the original visit untouched.
    Windows: <b>WC</b> = that Monday → Friday (${WORK_START}–${WORK_END}), date <b>DD/MM/YY</b>; <b>MC</b> = the 1st for <b>${MC_DAYS} days</b> (${WORK_START}–${WORK_END}), date <b>MM/YY</b>.
    Anything already at the target is skipped (no duplicate visits). Every change is <b>verified by re-reading</b>.
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
