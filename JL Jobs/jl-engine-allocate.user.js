// ==UserScript==
// @name         Joblogic - Engine Allocate (WeWork Allocation Engine v2)
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Paste the "Joblogic allocation code" from the WeWork Allocation Engine v2 sheet (menu 6). Resolves each job, re-checks it still has no upcoming visit, matches the engineer, previews everything, then creates the visits (optionally deploying them).
// @match        https://go.joblogic.com/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/jl-engine-allocate.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/jl-engine-allocate.user.js
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

    const VERSION = '1.1';
    const SCRIPT_ID = 'engine-allocate';
    const SCRIPT_LABEL = '🗓 Engine Allocate';
    const SCRIPT_COLOR = '#674ea7';
    const SCRIPT_DESC = 'Paste the code from the WeWork Allocation Engine v2 sheet (⚙️ Allocation → 6. Copy Joblogic allocation code). Check finds each job, makes sure it still has no upcoming visit and matches the engineer; nothing is written until you press Create visits.';

    const PACE_MS = 1400;                     // Azure WAF: keep bulk calls ~1.4 s apart
    const WAF_BACKOFF = [4000, 10000, 20000]; // retry waits on HTML / 403 responses
    const LIVE = ['new', 'not sent', 'read', 'accepted', 'travelling', 'on site', 'paused'];
    const INDEX_PAGE = 2000;

    let rows = [], plan = null, running = false, panel, tbody, logBox, progEl, deployCk, checkBtn, createBtn, stopBtn, csvBtn, pasteBox;

    // ── helpers ──
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const csrf = () => { const el = document.querySelector('input[name="__RequestVerificationToken"]'); return el ? el.value : ''; };
    const norm = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    function log(msg, col) { const d = document.createElement('div'); d.style.color = col || '#ccc'; d.textContent = msg; logBox.appendChild(d); logBox.scrollTop = logBox.scrollHeight; }
    function setProgress(t, col) { progEl.textContent = t; progEl.style.color = col || '#0fa'; }
    function ukToDate(s) { const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/); return m ? new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)) : null; }
    function todayStart() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }

    let lastCall = 0;
    async function jlFetch(url, opts) {
        for (let attempt = 0; ; attempt++) {
            const wait = lastCall + PACE_MS - Date.now(); if (wait > 0) await sleep(wait);
            lastCall = Date.now();
            const r = await fetch(url, Object.assign({ credentials: 'include' }, opts || {}));
            const ct = r.headers.get('content-type') || '';
            if ((r.status === 403 || r.status === 429 || !/json/i.test(ct)) && attempt < WAF_BACKOFF.length) {
                log('  … throttled (HTTP ' + r.status + '), retrying in ' + WAF_BACKOFF[attempt] / 1000 + 's', '#888');
                await sleep(WAF_BACKOFF[attempt]); continue;
            }
            if (!/json/i.test(ct)) throw new Error('HTTP ' + r.status + ' returned a page, not data (logged out or throttled?)');
            return r.json();
        }
    }

    // ── 1. decode the sheet's code ──
    function decode(txt) {
        const t = String(txt || '').trim().replace(/\s+/g, '');
        const m = t.match(/^WWAE1:(.+)$/);
        if (!m) throw new Error('That is not an allocation code — it should start with WWAE1:');
        const bin = atob(m[1]);
        const json = new TextDecoder('utf-8').decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
        const p = JSON.parse(json);
        if (p.kind !== 'wework-allocation-engine' || !Array.isArray(p.jobs)) throw new Error('Code not recognised');
        return p;
    }

    // ── 2. lookups ──
    function searchBody(term, page, ppm) {
        return JSON.stringify({ SearchTerm: term, QuickSearchTerm: term, SelectedTab: 'Open', PageSize: term ? 50 : INDEX_PAGE, PageIndex: page, EngineerType: 0, IncludePPMJobs: ppm, IncludeReactiveJobs: true, StatusIds: '',
            StartLoggedDate: '', EndLoggedDate: '', StartDate: '', EndDate: '', StartCompleteDate: '', EndCompleteDate: '', StartNextContactDate: '', EndNextContactDate: '' });
    }
    // One sweep of the open NON-PPM jobs (the engine only plans reactive work: ~1 page, fast).
    // Anything not in it (e.g. a PPM job) is looked up one by one with findJob().
    async function indexOpenJobs() {
        const idx = new Map(); let page = 1, seen = 0, total = Infinity;
        while (seen < total && running) {
            setProgress('Finding open reactive jobs in Joblogic… ' + seen + (isFinite(total) ? '/' + total : ''));
            const d = await jlFetch('/api/Job/SearchJsonData', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', '__RequestVerificationToken': csrf() },
                body: searchBody('', page, false)
            });
            if (d.success === false) throw new Error('Job search failed: ' + (d.errors || []).join('; '));
            const ad = d.AdditionalData || {}, jobs = ad.Jobs || [];
            total = ad.TotalCount || 0;
            jobs.forEach(j => { const k = String(j.JobNumber || '').trim().toUpperCase(); if (k) idx.set(k, idx.has(k) && idx.get(k).Id !== j.Id ? { ambiguous: true } : j); });
            seen += jobs.length; if (!jobs.length) break; page++;
        }
        return idx;
    }
    async function findJob(jobNumber) {
        const d = await jlFetch('/api/Job/SearchJsonData', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', '__RequestVerificationToken': csrf() },
            body: searchBody(jobNumber, 1, true)
        });
        const want = String(jobNumber).trim().toUpperCase();
        const hits = ((d.AdditionalData || {}).Jobs || []).filter(j => String(j.JobNumber || '').trim().toUpperCase() === want);
        return hits.length > 1 ? { ambiguous: true } : hits[0] || null;
    }
    async function loadEngineers() {
        const r = await fetch('/Staff/GetEngineers?text=&includeNonLogin=false', { credentials: 'include' });
        const list = (await r.json()) || [];
        const byEmail = new Map(), byName = new Map();
        list.filter(e => e && e.Name && e.Active !== false).forEach(e => {
            if (e.EmailAddress) byEmail.set(String(e.EmailAddress).trim().toLowerCase(), e);
            byName.set(norm(e.Name), e);
        });
        return { byEmail, byName, n: list.length };
    }
    async function jobVisits(jobId) {
        const d = await jlFetch('/api/Visit/GetVisitsJson?&jobId=' + jobId + '&isAxaJob=false&isReadOnly=false&pageIndex=1&pageSize=200', { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        const ad = d.AdditionalData || {};
        return { visits: ad.Visits || [], typeOfJob: ad.TypeOfJob };
    }

    // ── 3. check (read-only) ──
    async function onCheck() {
        if (running) return;
        try { plan = decode(pasteBox.value); } catch (e) { setProgress(e.message, '#f66'); return; }
        running = true; toggle();
        logBox.innerHTML = ''; rows = []; renderTable();
        const ageH = (Date.now() - (ukToDate(plan.made) || new Date()).getTime()) / 36e5;
        log('Code made ' + plan.made + ' · ' + plan.jobs.length + ' visits', '#0af');
        if (ageH > 12) log('⚠ This plan is ' + Math.round(ageH) + ' hours old — engineers\' diaries may have changed. Consider re-running the sheet.', '#fa0');
        try {
            const eng = await loadEngineers();
            log('Engineers in this Joblogic account: ' + eng.n, '#888');
            const idx = await indexOpenJobs();
            log('Open reactive jobs in this Joblogic account: ' + idx.size, '#888');
            rows = plan.jobs.map(j => ({ j, include: false, status: 'pending', note: '' }));
            renderTable();
            const today = todayStart();
            for (const r of rows) {
                if (!running) break;
                const j = r.j;
                let hit = idx.get(String(j.n).trim().toUpperCase());
                if (!hit) { setProgress('Looking up ' + j.n + '…'); try { hit = await findJob(j.n); } catch (err) { hit = null; } }
                const e = (j.em && eng.byEmail.get(String(j.em).trim().toLowerCase())) || eng.byName.get(norm(j.en));
                const start = ukToDate(j.s), end = ukToDate(j.e);
                if (!hit) { r.status = 'skip'; r.note = 'not an open job in this Joblogic account'; }
                else if (hit.ambiguous) { r.status = 'skip'; r.note = 'job number matches more than one job'; }
                else if (!e) { r.status = 'skip'; r.note = 'engineer "' + j.en + '" not found in Joblogic'; }
                else if (!start || !end || end <= start) { r.status = 'skip'; r.note = 'bad start/end'; }
                else if (end < new Date()) { r.status = 'skip'; r.note = 'planned time has already passed – re-run the sheet'; }
                else {
                    r.jobId = hit.Id; r.engineerId = e.Id; r.engineerName = e.Name;
                    setProgress('Checking visits ' + (rows.indexOf(r) + 1) + '/' + rows.length + ' — ' + j.n);
                    try {
                        const v = await jobVisits(hit.Id);
                        r.typeOfJob = v.typeOfJob != null ? v.typeOfJob : 1;
                        const live = v.visits.filter(x => LIVE.indexOf(norm(x.StatusDescription)) >= 0 && (ukToDate(x.EndDate) || ukToDate(x.StartDate) || today) >= today);
                        if (live.length) { r.status = 'skip'; r.note = 'already has an upcoming visit: ' + live.map(x => x.StartDate + ' ' + (x.EngineerName || '') + ' (' + x.StatusDescription + ')').join(', '); }
                        else { r.status = 'ok'; r.include = true; r.note = 'ready'; }
                    } catch (err) { r.status = 'skip'; r.note = 'could not read visits: ' + err.message; }
                }
                renderRow(r);
            }
            const ok = rows.filter(r => r.status === 'ok').length;
            setProgress('Checked: ' + ok + ' ready, ' + (rows.length - ok) + ' skipped. Untick any you do not want, then Create visits.', ok ? '#0fa' : '#fa0');
            log('Checked: ' + ok + ' ready, ' + (rows.length - ok) + ' skipped.', '#0af');
        } catch (e) { setProgress(e.message, '#f66'); log('✘ ' + e.message, '#f66'); }
        running = false; toggle();
    }

    // ── 4. write ──
    async function addVisit(r, deploy) {
        const fd = new FormData();
        fd.append('jobId', r.jobId);
        fd.append('typeOfJob', r.typeOfJob);
        fd.append('jobNumber', r.j.n);
        fd.append('deploy', deploy ? 'true' : 'false');
        fd.append('engineerId', r.engineerId);
        fd.append('startDate', r.j.s);
        fd.append('endDate', r.j.e);
        fd.append('isDateAndTimeLocked', 'false');
        const j = await jlFetch('/Scheduler/AddVisit', { method: 'POST', headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json', '__RequestVerificationToken': csrf() }, body: fd });
        if (!j || j.success !== true) throw new Error((j && j.errors && j.errors.join('; ')) || 'AddVisit returned failure');
        // AddVisit ignores endDate (Joblogic applies the job type's default length) — set the planned end explicitly.
        const v = await jobVisits(r.jobId);
        const mine = v.visits.filter(x => x.StartDate === r.j.s && norm(x.EngineerName) === norm(r.engineerName) && LIVE.indexOf(norm(x.StatusDescription)) >= 0)
            .sort((a, b) => (b.Id || 0) - (a.Id || 0))[0];
        if (!mine) return 'created, but could not find it to set the end time';
        if (mine.EndDate === r.j.e) return '';
        const fd2 = new FormData();
        fd2.append('id', mine.Id); fd2.append('jobId', r.jobId); fd2.append('jobNumber', r.j.n); fd2.append('typeOfJob', r.typeOfJob);
        fd2.append('isTeamVisit', 'false'); fd2.append('isCopy', 'false'); fd2.append('deploy', deploy ? 'true' : 'false');
        fd2.append('startDate', r.j.s); fd2.append('endDate', r.j.e);
        const u = await jlFetch('/Scheduler/UpdateVisit', { method: 'POST', headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json', '__RequestVerificationToken': csrf() }, body: fd2 });
        if (!u || u.success !== true) return 'created, but end time left at ' + mine.EndDate.slice(-5) + ' (' + ((u && u.errors || []).join('; ') || 'UpdateVisit failed') + ')';
        return '';
    }
    async function onCreate() {
        if (running) return;
        const todo = rows.filter(r => r.include && r.status === 'ok');
        if (!todo.length) { setProgress('Nothing ticked and ready.', '#fa0'); return; }
        const deploy = deployCk.checked;
        if (!confirm('Create ' + todo.length + ' visits in Joblogic' + (deploy ? ' AND send them to the engineers' : ' (not sent to engineers)') + '?')) return;
        running = true; toggle();
        let done = 0, failed = 0;
        log('===== CREATING ' + todo.length + ' VISITS' + (deploy ? ' (deploying)' : '') + ' =====', '#0af');
        for (const r of todo) {
            if (!running) { log('Stopped.', '#fa0'); break; }
            try {
                // last-second re-check so a double run never doubles up
                const v = await jobVisits(r.jobId);
                const today = todayStart();
                if (v.visits.some(x => LIVE.indexOf(norm(x.StatusDescription)) >= 0 && (ukToDate(x.EndDate) || today) >= today)) { r.status = 'skip'; r.note = 'got an upcoming visit since the check'; renderRow(r); continue; }
                const warn = await addVisit(r, deploy);
                r.status = 'done'; r.note = (deploy ? 'created + sent' : 'created (not sent)') + (warn ? ' – ⚠ ' + warn : ''); done++;
                if (warn) log('  ⚠ ' + r.j.n + ': ' + warn, '#fa0');
                log('✔ ' + r.j.n + ' → ' + r.engineerName + '  ' + r.j.s, '#0f8');
            } catch (e) { r.status = 'failed'; r.note = e.message; failed++; log('✘ ' + r.j.n + ': ' + e.message, '#f66'); }
            renderRow(r);
            setProgress('Created ' + done + ' / ' + todo.length + (failed ? ' (' + failed + ' failed)' : ''));
        }
        running = false; toggle();
        setProgress('Finished — ' + done + ' created' + (failed ? ', ' + failed + ' failed' : '') + '.', failed ? '#fa0' : '#0fa');
        log('===== DONE: ' + done + ' created, ' + failed + ' failed =====', '#0af');
    }

    function onCsv() {
        const head = ['Job', 'Engineer', 'Start', 'End', 'Priority', 'Site', 'Result', 'Note'];
        const lines = [head].concat(rows.map(r => [r.j.n, r.engineerName || r.j.en, r.j.s, r.j.e, r.j.p, r.j.site, r.status, r.note]));
        const csv = lines.map(l => l.map(c => { c = String(c == null ? '' : c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(',')).join('\r\n');
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        a.download = 'engine-allocate-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '') + '.csv'; a.click();
    }

    // ── UI ──
    const COLS = { pending: '#888', ok: '#0f8', skip: '#fa0', done: '#0af', failed: '#f66' };
    function renderRow(r) {
        let tr = r.tr;
        if (!tr) { tr = r.tr = document.createElement('tr'); tbody.appendChild(tr); }
        tr.innerHTML = '';
        const td = h => { const c = document.createElement('td'); c.style.cssText = 'padding:3px 6px;border-bottom:1px solid #333;vertical-align:top;'; c.innerHTML = h; tr.appendChild(c); return c; };
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = r.include; cb.disabled = r.status !== 'ok' || running;
        cb.addEventListener('change', () => { r.include = cb.checked; });
        td('').appendChild(cb);
        td(r.jobId ? '<a href="/Job/Detail/' + r.jobId + '" target="_blank" style="color:#6cf;text-decoration:none">' + esc(r.j.n) + '</a>' : esc(r.j.n));
        td(esc(r.engineerName || r.j.en));
        td(esc(r.j.s) + ' – ' + esc(String(r.j.e).slice(-5)));
        td(esc(r.j.p));
        td(esc(r.j.site));
        td('<span style="color:' + (COLS[r.status] || '#ccc') + '">' + esc(r.status) + '</span> ' + esc(r.note));
    }
    function renderTable() { tbody.innerHTML = ''; rows.forEach(r => { r.tr = null; renderRow(r); }); }
    function toggle() {
        checkBtn.disabled = running; createBtn.disabled = running; stopBtn.style.display = running ? '' : 'none';
        rows.forEach(r => { if (r.tr) { const cb = r.tr.querySelector('input'); if (cb) cb.disabled = r.status !== 'ok' || running; } });
    }
    const BTN = 'color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:12px;';
    function mkBtn(label, colour, onClick) { const b = document.createElement('button'); b.style.cssText = BTN + 'background:' + colour + ';'; b.textContent = label; b.addEventListener('click', onClick); return b; }

    function createUI() {
        if (document.getElementById('jl-engine-alloc-panel')) return;
        panel = document.createElement('div');
        panel.id = 'jl-engine-alloc-panel';
        panel.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;background:#1a1a2e;color:#eee;border-radius:8px;padding:16px;width:980px;max-width:96vw;max-height:92vh;display:flex;flex-direction:column;font-family:monospace;font-size:12px;box-shadow:0 4px 20px rgba(0,0,0,0.5);';
        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;';
        header.innerHTML = '<b style="font-size:14px">Engine Allocate <span style="font-weight:400;color:#8a8ab5;font-size:11px">v' + VERSION + '</span></b>';
        const close = mkBtn('✕', '#444', () => { panel.style.display = 'none'; });
        header.appendChild(close);
        panel.appendChild(header);

        pasteBox = document.createElement('textarea');
        pasteBox.placeholder = 'Paste the code from the sheet here (starts with WWAE1:)';
        pasteBox.style.cssText = 'width:100%;height:56px;background:#111;color:#ddd;border:1px solid #444;border-radius:4px;font-family:monospace;font-size:11px;box-sizing:border-box;';
        panel.appendChild(pasteBox);

        const bar = document.createElement('div');
        bar.style.cssText = 'display:flex;gap:8px;align-items:center;margin:8px 0;flex-wrap:wrap;';
        checkBtn = mkBtn('1. Check', '#2a6f97', onCheck);
        const lab = document.createElement('label'); lab.style.cssText = 'display:flex;gap:4px;align-items:center;cursor:pointer;';
        deployCk = document.createElement('input'); deployCk.type = 'checkbox'; deployCk.checked = false;
        lab.appendChild(deployCk); lab.appendChild(document.createTextNode('Send to engineers (deploy)'));
        createBtn = mkBtn('2. Create visits', '#38761d', onCreate);
        stopBtn = mkBtn('Stop', '#a33', () => { running = false; }); stopBtn.style.display = 'none';
        csvBtn = mkBtn('Export CSV', '#555', onCsv);
        const all = mkBtn('Tick all ready', '#444', () => { rows.forEach(r => { if (r.status === 'ok') r.include = true; }); renderTable(); });
        const none = mkBtn('Untick all', '#444', () => { rows.forEach(r => { r.include = false; }); renderTable(); });
        [checkBtn, lab, createBtn, stopBtn, all, none, csvBtn].forEach(x => bar.appendChild(x));
        panel.appendChild(bar);

        progEl = document.createElement('div'); progEl.style.cssText = 'margin-bottom:6px;color:#0fa;';
        panel.appendChild(progEl);

        const wrap = document.createElement('div'); wrap.style.cssText = 'overflow:auto;flex:1 1 auto;min-height:120px;border:1px solid #333;border-radius:4px;';
        const table = document.createElement('table'); table.style.cssText = 'border-collapse:collapse;width:100%;';
        table.innerHTML = '<thead><tr style="position:sticky;top:0;background:#26264a">' + ['', 'Job', 'Engineer', 'When', 'Priority', 'Site', 'Check'].map(h => '<th style="text-align:left;padding:4px 6px">' + h + '</th>').join('') + '</tr></thead>';
        tbody = document.createElement('tbody'); table.appendChild(tbody); wrap.appendChild(table);
        panel.appendChild(wrap);

        logBox = document.createElement('div'); logBox.style.cssText = 'height:110px;overflow:auto;background:#111;border-radius:4px;padding:6px;margin-top:8px;';
        panel.appendChild(logBox);
        document.body.appendChild(panel);
        jlRegisterPanel(panel, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR, SCRIPT_DESC);
    }

    if (document.body) createUI(); else window.addEventListener('DOMContentLoaded', createUI);
})();
