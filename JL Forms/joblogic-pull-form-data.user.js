// ==UserScript==
// @name         JobLogic Forms Logbook — Pull Form Data
// @namespace    com.joesegal.joblogic
// @version      1.0.0
// @description  Pulls the raw answers behind every Forms Logbook "Edit Data" page (POST /api/DynamicForm/GetReportSummary) and downloads them as JSONL for the BigQuery loader (load_form_data.py). Enumerates forms via /api/Logbook/Search, paces itself under the Azure WAF limit, writes part files as it goes and resumes where it left off.
// @match        https://go.joblogic.com/Logbook*
// @run-at       document-idle
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Forms/joblogic-pull-form-data.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Forms/joblogic-pull-form-data.user.js
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

    const SCRIPT_ID = 'pull-form-data';
    const SCRIPT_LABEL = '📥 Pull Form Data';
    const SCRIPT_COLOR = '#1f6f4a';
    const SCRIPT_DESC = 'Downloads the raw answers inside completed forms (what the "Edit Data" page shows) as JSONL part files, ready for load_form_data.py to push into BigQuery. Pick a date range, Start, then leave the tab open — it paces itself under the Joblogic gateway limit and saves a part file every 250 forms, so a stopped run resumes where it left off.';

    // =======================================================================
    // API helpers  (same WAF-aware throttle as the other JL bulk scripts)
    // =======================================================================
    const jlCsrfToken = () => document.querySelector('input[name="__RequestVerificationToken"]')?.value || '';

    // go.joblogic.com sits behind an Azure App Gateway WAF that rate-limits per IP: bulk runs
    // go clean for ~40 requests then start getting HTML 403s. 1400ms (~43/min) is the measured
    // safe pace; it's a token bucket, so retry soon and escalate gently.
    const MIN_REQUEST_INTERVAL = 1400;
    const WAF_BACKOFF_MS = [1500, 3000, 6000, 12000, 20000];
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    let lastRequestAt = 0;
    let currentInterval = MIN_REQUEST_INTERVAL;
    let onWafRetry = null;

    async function throttle() {
        const wait = currentInterval - (Date.now() - lastRequestAt);
        if (wait > 0) await sleep(wait);
        lastRequestAt = Date.now();
    }

    function isWafBlock(r, txt) {
        if (r.status !== 403 && r.status !== 429 && r.status !== 503) return false;
        if (/Application-Gateway/i.test(r.headers.get('server') || '')) return true;
        return /text\/html/i.test(r.headers.get('content-type') || '') || /403 Forbidden/i.test(txt || '');
    }

    async function jlFetch(url, opts) {
        for (let attempt = 0; ; attempt++) {
            await throttle();
            const r = await fetch(url, opts);
            const txt = await r.text().catch(() => '');
            if (!r.ok && isWafBlock(r, txt) && attempt < WAF_BACKOFF_MS.length) {
                const pause = WAF_BACKOFF_MS[attempt];
                if (currentInterval < 4000) currentInterval += 200;
                onWafRetry?.(pause, currentInterval);
                await sleep(pause);
                continue;
            }
            let j = null; try { j = JSON.parse(txt); } catch (e) {}
            return { ok: r.ok, status: r.status, j, txt };
        }
    }

    async function jlPostForm(url, fields) {
        const fd = new FormData();
        Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
        return jlFetch(url, {
            method: 'POST', credentials: 'same-origin',
            headers: { '__RequestVerificationToken': jlCsrfToken(), 'X-Requested-With': 'XMLHttpRequest' },
            body: fd
        });
    }

    // =======================================================================
    // Joblogic endpoints
    // =======================================================================
    // The logbook list. PageSize caps at 50 server-side whatever you ask for, so 5k forms = ~102 pages.
    // Dates are dd/mm/yyyy; blank means "no bound". ShowPrivate mirrors the page's own toggle.
    const LOGBOOK_PAGE_SIZE = 50;

    async function searchLogbook(pageIndex, { startDate, endDate, showPrivate, searchTerm }) {
        const r = await jlPostForm('/api/Logbook/Search', {
            PageIndex: pageIndex, PageSize: LOGBOOK_PAGE_SIZE,
            ShowPrivate: showPrivate ? 'true' : 'false',
            SearchTerm: searchTerm || '',
            StartDate: startDate || '', EndDate: endDate || '', OrderBy: 0
        });
        if (!r.ok || !r.j?.success) throw new Error('Logbook/Search HTTP ' + r.status + (r.j?.errors?.length ? ' — ' + r.j.errors.join('; ') : ''));
        const ad = r.j.AdditionalData || {};
        return { forms: ad.Forms || [], total: ad.TotalCount || 0 };
    }

    // The "Edit Data" payload. Only `id` is accepted (formId/formUniqueId are rejected); the
    // response also carries JsonDynamicForm, the ~250KB form TEMPLATE, which we throw away —
    // the answers are the ~1KB JsonData string, keyed by SurveyJS question name.
    // Non-dynamic (legacy) forms have no SurveyJS data: this endpoint returns an HTML error
    // page for them, so they are skipped on IsDynamicForm before we ever call it.
    async function getFormData(id) {
        const r = await jlPostForm('/api/DynamicForm/GetReportSummary', { id });
        if (!r.j) return { error: 'non-JSON response (HTTP ' + r.status + ')' };
        if (!r.j.success) return { error: r.j.errors?.join('; ') || r.j.Message || 'success:false' };
        const a = r.j.AdditionalData || {};
        return { data: a.JsonData ?? null, formName: a.FormName, formType: a.FormType, createdDate: a.CreatedDate, deployedTo: a.DeployedTo, isPrivate: a.IsPrivate };
    }

    // =======================================================================
    // Run state — survives a reload so a long backfill can be resumed.
    //
    // We keep only the FILTERS and the ids already written to a part file, never the 5k logbook
    // rows themselves (that would blow the ~5MB localStorage quota, and saveState would then fail
    // silently). Resume re-lists the logbook with the same filters and skips what is already done,
    // so it does not depend on Joblogic returning the pages in the same order twice.
    // An id joins `done` only once its line has been flushed to a part file, so a crashed run
    // re-pulls the unflushed tail instead of losing it.
    // =======================================================================
    const STATE_KEY = 'jl-pull-form-data-state';
    const PART_SIZE = 250;          // forms per downloaded part file
    const loadState = () => { try { return JSON.parse(localStorage.getItem(STATE_KEY)) || null; } catch (e) { return null; } };
    const saveState = s => { try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); return true; } catch (e) { return false; } };
    const clearState = () => { try { localStorage.removeItem(STATE_KEY); } catch (e) {} };

    function downloadText(filename, text) {
        const url = URL.createObjectURL(new Blob([text], { type: 'application/x-ndjson' }));
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    }

    // One JSONL line per form: the logbook header columns + the raw answers string.
    // JsonData is kept VERBATIM (not parsed) — every form template has its own question
    // names, so the loader stores it as a JSON string and the per-form views unpack it.
    function jsonlLine(row, res) {
        return JSON.stringify({
            form_uid: row.Id,
            form_name: res.formName ?? row.FormName,
            full_form_name: row.FullFormName,
            form_type: res.formType ?? row.FormType,
            created_date: res.createdDate ?? row.DateCreated,
            job_number: row.JobNumber,
            job_id: row.JobId,
            customer: row.Customer,
            customer_id: row.CustomerId,
            site: row.Site,
            site_id: row.SiteId,
            asset_number: row.AssetNumber,
            asset_description: row.AssetDescription,
            asset_id: row.AssetId,
            engineer: row.Engineer,
            is_general_form: row.IsGeneralForm,
            is_private: res.isPrivate ?? row.IsPrivate,
            visit_complete: row.VisitComplete,
            json_data: res.data
        });
    }

    // =======================================================================
    // UI
    // =======================================================================
    function buildUI() {
        if (document.getElementById('jl-pfd-root')) return;

        const root = document.createElement('div');
        root.id = 'jl-pfd-root';
        root.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:99999;font-family:system-ui,sans-serif;';

        const panel = document.createElement('div');
        panel.style.cssText = 'display:block;background:#1a1a2e;color:#eee;border-radius:8px;padding:14px;width:430px;box-shadow:0 4px 20px rgba(0,0,0,0.5);';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;';
        const title = document.createElement('strong');
        title.textContent = 'Pull Form Data';
        const ver = typeof GM_info !== 'undefined' ? GM_info.script?.version : '';
        if (ver) {
            const v = document.createElement('span');
            v.textContent = ' v' + ver;
            v.style.cssText = 'font-weight:400;font-size:11px;color:#9fb6c4;margin-left:6px;';
            title.append(v);
        }
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '×';
        closeBtn.title = 'Collapse to dock';
        closeBtn.style.cssText = 'background:none;border:0;color:#eee;font-size:18px;cursor:pointer;line-height:1;padding:0 4px;';
        closeBtn.addEventListener('click', () => document.getElementById('jl-launch-' + SCRIPT_ID)?.click());
        header.append(title, closeBtn);
        panel.append(header);

        const help = document.createElement('div');
        help.style.cssText = 'color:#9fb6c4;font-size:11px;line-height:1.45;margin-bottom:10px;';
        help.textContent = 'Downloads one JSONL part file per ' + PART_SIZE + ' forms into your Downloads folder. Keep this tab open and in the foreground while it runs.';
        panel.append(help);

        // --- date range ---
        const dateWrap = document.createElement('div');
        dateWrap.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;font-size:12px;';
        const mkDate = (label, value) => {
            const l = document.createElement('label');
            l.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:3px;';
            const s = document.createElement('span'); s.textContent = label; s.style.color = '#9fb6c4';
            const i = document.createElement('input');
            i.type = 'date'; i.value = value;
            i.style.cssText = 'background:#0a0a1a;color:#eee;border:1px solid #333;border-radius:4px;padding:5px;font-family:inherit;';
            l.append(s, i);
            dateWrap.append(l);
            return i;
        };
        const today = new Date();
        const iso = d => d.toISOString().slice(0, 10);
        const monthAgo = new Date(today.getTime() - 30 * 86400000);
        const startInput = mkDate('From', iso(monthAgo));
        const endInput = mkDate('To', iso(today));
        panel.append(dateWrap);

        const optWrap = document.createElement('div');
        optWrap.style.cssText = 'display:flex;gap:16px;margin-bottom:8px;font-size:12px;align-items:center;';
        const privLabel = document.createElement('label');
        privLabel.style.cssText = 'display:flex;align-items:center;gap:5px;cursor:pointer;';
        const privCb = document.createElement('input');
        privCb.type = 'checkbox'; privCb.checked = true;
        privLabel.append(privCb, document.createTextNode('Include private forms'));
        const allBtn = document.createElement('button');
        allBtn.textContent = 'Everything (no date limit)';
        allBtn.style.cssText = 'background:#0a0a1a;color:#9fb6c4;border:1px solid #333;border-radius:4px;padding:5px 8px;cursor:pointer;font-size:11px;';
        allBtn.addEventListener('click', () => { startInput.value = ''; endInput.value = ''; });
        optWrap.append(privLabel, allBtn);
        panel.append(optWrap);

        const btnWrap = document.createElement('div');
        btnWrap.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;';
        const mkBtn = (label, bg) => {
            const b = document.createElement('button');
            b.textContent = label;
            b.style.cssText = 'flex:1;border:0;border-radius:4px;padding:8px;cursor:pointer;font-weight:600;color:#fff;background:' + bg + ';';
            btnWrap.append(b);
            return b;
        };
        const startBtn = mkBtn('Start', '#1f6f4a');
        const resumeBtn = mkBtn('Resume', '#0b7285');
        const stopBtn = mkBtn('Stop', '#8a2f2f');
        panel.append(btnWrap);

        const status = document.createElement('div');
        status.style.cssText = 'font-size:12px;color:#cfe3ec;margin-bottom:6px;min-height:16px;';
        panel.append(status);

        const log = document.createElement('div');
        log.style.cssText = 'background:#0a0a1a;border-radius:4px;padding:8px;max-height:180px;overflow:auto;font-family:ui-monospace,monospace;font-size:11px;line-height:1.5;color:#b9c9d4;';
        panel.append(log);

        root.append(panel);
        document.body.append(root);
        jlRegisterPanel(panel, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR, SCRIPT_DESC);

        // --- run control ---
        let running = false, stopRequested = false;
        const say = (msg, color) => {
            const line = document.createElement('div');
            if (color) line.style.color = color;
            line.textContent = msg;
            log.append(line);
            log.scrollTop = log.scrollHeight;
        };
        onWafRetry = (pause, interval) => say('⏸ gateway throttled us — waiting ' + (pause / 1000) + 's, pace now ' + interval + 'ms', '#e8b339');

        const ukDate = v => v ? v.split('-').reverse().join('/') : '';   // yyyy-mm-dd -> dd/mm/yyyy

        function setRunning(on) {
            running = on;
            startBtn.disabled = on; resumeBtn.disabled = on; stopBtn.disabled = !on;
            [startBtn, resumeBtn].forEach(b => b.style.opacity = on ? '0.5' : '1');
            stopBtn.style.opacity = on ? '1' : '0.5';
        }

        // Walk the logbook pages and collect the ids to pull.
        async function enumerate(filters) {
            const first = await searchLogbook(1, filters);
            const pages = Math.ceil(first.total / LOGBOOK_PAGE_SIZE);
            say('Logbook: ' + first.total + ' forms across ' + pages + ' pages');
            const rows = [...first.forms];
            for (let p = 2; p <= pages; p++) {
                if (stopRequested) break;
                status.textContent = 'Listing forms… page ' + p + ' of ' + pages;
                const r = await searchLogbook(p, filters);
                rows.push(...r.forms);
            }
            return rows;
        }

        async function run(resuming) {
            setRunning(true);
            stopRequested = false;
            const startedAt = Date.now();
            let state = resuming ? loadState() : null;
            try {
                if (!state) {
                    state = {
                        stamp: new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19),
                        filters: {
                            startDate: ukDate(startInput.value), endDate: ukDate(endInput.value),
                            showPrivate: privCb.checked, searchTerm: ''
                        },
                        done: [], part: 1, errors: 0
                    };
                }
                const f = state.filters;
                const span = (f.startDate || f.endDate) ? ' ' + (f.startDate || 'the start') + ' → ' + (f.endDate || 'now') : ' (all dates)';
                say('Listing forms' + span + '…');
                const rows = await enumerate(f);
                if (stopRequested) { say('Stopped while listing.', '#e8b339'); saveState(state); return; }

                // Legacy non-dynamic forms hold no SurveyJS answers — the endpoint serves an HTML
                // error page for them, so they never reach the pull.
                const legacy = rows.filter(r => !r.IsDynamicForm).length;
                if (legacy) say('Skipping ' + legacy + ' non-dynamic (legacy) form' + (legacy === 1 ? '' : 's') + ' — they hold no form data.', '#9fb6c4');

                const doneSet = new Set(state.done);
                const queue = rows.filter(r => r.IsDynamicForm && !doneSet.has(r.Id));
                if (doneSet.size) say(doneSet.size + ' form' + (doneSet.size === 1 ? '' : 's') + ' already saved — pulling the remaining ' + queue.length + '.');
                else say('Pulling ' + queue.length + ' forms…');
                if (!queue.length) {
                    say('✔ Nothing left to pull.', '#7bd88f');
                    clearState();
                    return;
                }

                let pending = [], pulledIds = [];
                const flush = () => {
                    if (!pending.length) return;
                    const name = 'jl-form-data-' + state.stamp + '-part' + String(state.part).padStart(3, '0') + '.jsonl';
                    downloadText(name, pending.join('\n') + '\n');
                    say('💾 ' + name + ' (' + pending.length + ' forms)', '#7bd88f');
                    state.part++;
                    // Only now are these forms safely on disk, so only now do they count as done.
                    state.done.push(...pulledIds);
                    pending = []; pulledIds = [];
                    if (!saveState(state)) say('⚠ could not save progress (browser storage full) — Resume may re-pull some forms', '#e8b339');
                };

                for (let i = 0; i < queue.length; i++) {
                    if (stopRequested) break;
                    const row = queue[i];
                    const elapsed = (Date.now() - startedAt) / 1000;
                    const left = Math.round((elapsed / (i + 1)) * (queue.length - i - 1) / 60);
                    status.textContent = (i + 1) + ' / ' + queue.length + ' forms' + (left > 0 ? ' — about ' + left + ' min left' : '');
                    try {
                        const res = await getFormData(row.Id);
                        if (res.error) {
                            state.errors++;
                            say('✗ ' + (row.JobNumber || row.Id) + ' — ' + res.error, '#ff8f8f');
                        } else {
                            pending.push(jsonlLine(row, res));
                            pulledIds.push(row.Id);
                        }
                    } catch (e) {
                        state.errors++;
                        say('✗ ' + (row.JobNumber || row.Id) + ' — ' + e.message, '#ff8f8f');
                    }
                    if (pending.length >= PART_SIZE) flush();
                }

                flush();
                if (stopRequested) {
                    saveState(state);
                    say('■ Stopped — ' + state.done.length + ' forms saved. Press Resume to carry on.', '#e8b339');
                } else {
                    say('✔ Done — ' + state.done.length + ' forms pulled, ' + state.errors + ' failed.', '#7bd88f');
                    status.textContent = 'Finished. Run load_form_data.py on the downloaded part files.';
                    clearState();
                }
            } catch (e) {
                say('✗ ' + e.message, '#ff8f8f');
                if (state) saveState(state);
            } finally {
                setRunning(false);
                refreshResume();
            }
        }

        function refreshResume() {
            const s = loadState();
            const can = !!(s && s.done);
            resumeBtn.disabled = running || !can;
            resumeBtn.style.opacity = resumeBtn.disabled ? '0.5' : '1';
            resumeBtn.title = can ? 'Re-list the same date range and pull what is still missing (' + s.done.length + ' already saved)' : 'Nothing part-finished to resume';
            if (can && !running) status.textContent = 'Part-finished run: ' + s.done.length + ' forms saved so far.';
        }

        startBtn.addEventListener('click', () => {
            const s = loadState();
            if (s && s.done && s.done.length &&
                !confirm('A part-finished run is saved (' + s.done.length + ' forms done). Starting fresh throws that progress away and re-pulls them. Carry on?')) return;
            clearState();
            log.textContent = '';
            run(false);
        });
        resumeBtn.addEventListener('click', () => run(true));
        stopBtn.addEventListener('click', () => { stopRequested = true; status.textContent = 'Stopping after this form…'; });

        setRunning(false);
        refreshResume();
    }

    // The logbook list is rendered by Vue; wait for it (and the CSRF token) before adding the dock button.
    function waitForPage(attempts = 40) {
        if (document.querySelector('input[name="__RequestVerificationToken"]') && document.getElementById('logbookListView')) return buildUI();
        if (attempts <= 0) return;
        setTimeout(() => waitForPage(attempts - 1), 500);
    }
    waitForPage();
})();
