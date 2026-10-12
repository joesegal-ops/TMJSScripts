// ==UserScript==
// @name         Joblogic - Set Job Reference Number
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Paste (or load) a two-column TSV/CSV of Job Number + value and write column 2 into each job's Reference Number OR Job Ref 1 field. Built for big lists (35k+): indexes every job up front (instant dry run, skips already-correct/frozen/missing jobs), paces under the Azure WAF limit, resumes after Stop/reload, and exports a results CSV with previous values. Collapses into the shared JL dock.
// @match        https://go.joblogic.com/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/jl-set-job-reference-number.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/jl-set-job-reference-number.user.js
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

    const VERSION = '2.0';
    const SCRIPT_ID = 'set-job-reference-number';
    const SCRIPT_LABEL = '🔖 Set Job Reference / Job Ref 1';
    const SCRIPT_COLOR = '#5a3b6b';
    const SCRIPT_DESC = 'Paste or load a two-column TSV/CSV of Job Number + value. Writes column 2 into each job\'s Reference Number or Job Ref 1 field. Dry Run first (instant), then Start. Progress is saved — Stop/reload and Start again to resume.';

    // --- CONFIG ---
    // go.joblogic.com sits behind an Azure WAF that rate-limits per IP (~100 req/min,
    // shared by every JL tab). 1400 ms between ANY two requests is the proven safe pace.
    const MIN_INTERVAL = 1400;
    const MAX_INTERVAL = 4000;
    const WAF_BACKOFF = [1500, 3000, 6000, 12000, 20000];
    const INDEX_PAGE_SIZE = 2000;     // SearchJsonData honours big pages — 54k jobs ≈ 28 calls
    const LOG_MAX_LINES = 400;        // keep the DOM light on 35k-row runs
    const STORE_ROWS = 'jl-setjobref-rows-v2';
    const STORE_PROGRESS = 'jl-setjobref-progress-v2';

    // Job detail labels → EditDetail field names (Vue renders #LJ<Field>, data-vv-as=<label>).
    // Both are also columns on the SearchJsonData grid rows, which is what makes the index work.
    const FIELDS = {
        JobUserReferenceFieldValue: 'Job Ref 1',
        CustomReference: 'Reference Number'
    };

    // Column header aliases (case-insensitive; underscores normalised to spaces)
    const JOB_HEADERS = ['job', 'job no', 'job no.', 'job number', 'jobno', 'jobnumber', 'job reference', 'number', 'id', 'job id'];
    const REF_HEADERS = ['reference', 'ref', 'reference number', 'reference no', 'reference no.', 'ref no', 'ref number', 'custom reference', 'customreference', 'our reference', 'your reference', 'value',
        'job ref 1', 'job ref1', 'jobref1', 'ref 1', 'ref1', 'job ref', 'jobuserreferencefieldvalue'];

    // Row status codes (persisted per row)
    const ST = { SET: 'set', SAME: 'same', NOT_EMPTY: 'not empty', FROZEN: 'frozen', NOT_FOUND: 'not found', AMBIGUOUS: 'ambiguous', ERROR: 'error' };

    // --- STATE ---
    let panel, logArea, startBtn, dryBtn, stopBtn, pasteBtn, csvBtn, discardBtn, progressText, fieldSelect, emptyOnlyCheck;
    let running = false;
    let run = null;   // { rows: [[jobRef, value]], field, emptyOnly, status: [{s, p, m}|null], loadedAt }

    const norm = (s) => String(s || '').toLowerCase().trim();
    class SessionError extends Error {}

    // =======================================================================
    // Timers — Chrome throttles chained setTimeout in hidden tabs to ~1/min,
    // which would stall a multi-hour run. Worker timers aren't throttled that way.
    // =======================================================================
    let timerWorker = null;
    const timerPending = {};
    let timerSeq = 0;
    try {
        const blob = new Blob(['onmessage=e=>setTimeout(()=>postMessage(e.data.id),e.data.ms)'], { type: 'text/javascript' });
        timerWorker = new Worker(URL.createObjectURL(blob));
        timerWorker.onmessage = (e) => { const r = timerPending[e.data]; delete timerPending[e.data]; if (r) r(); };
        timerWorker.onerror = () => { timerWorker = null; Object.keys(timerPending).forEach(k => { timerPending[k](); delete timerPending[k]; }); };
    } catch (e) { timerWorker = null; }
    function sleep(ms) {
        if (!timerWorker) return new Promise(r => setTimeout(r, ms));
        return new Promise(r => { const id = ++timerSeq; timerPending[id] = r; timerWorker.postMessage({ id, ms }); });
    }
    async function sleepInterruptible(ms) {
        const end = Date.now() + ms;
        while (running && Date.now() < end) await sleep(Math.min(500, end - Date.now()));
    }

    // =======================================================================
    // Persistence (localStorage — rows saved once, progress after every job)
    // =======================================================================
    function saveRows() {
        try {
            localStorage.setItem(STORE_ROWS, JSON.stringify({ rows: run.rows, field: run.field, emptyOnly: run.emptyOnly, loadedAt: run.loadedAt }));
            return true;
        } catch (e) { return false; }
    }
    function saveProgress() {
        try { localStorage.setItem(STORE_PROGRESS, JSON.stringify(run.status)); } catch (e) {}
    }
    function loadRun() {
        try {
            const r = JSON.parse(localStorage.getItem(STORE_ROWS) || 'null');
            if (!r || !Array.isArray(r.rows) || !r.rows.length) return null;
            let status = [];
            try { status = JSON.parse(localStorage.getItem(STORE_PROGRESS) || '[]') || []; } catch (e) {}
            if (status.length !== r.rows.length) status = new Array(r.rows.length).fill(null);
            return { rows: r.rows, field: r.field in FIELDS ? r.field : 'JobUserReferenceFieldValue', emptyOnly: !!r.emptyOnly, loadedAt: r.loadedAt, status };
        } catch (e) { return null; }
    }
    function clearRun() {
        try { localStorage.removeItem(STORE_ROWS); localStorage.removeItem(STORE_PROGRESS); } catch (e) {}
        run = null;
    }
    const pendingCount = () => run ? run.status.reduce((n, s) => n + ((!s || s.s === ST.ERROR) ? 1 : 0), 0) : 0;

    // =======================================================================
    // UI
    // =======================================================================
    const btnCss = (bg) => `background:${bg};color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;`;

    function createUI() {
        if (document.getElementById('jl-jobref-panel')) return;

        panel = document.createElement('div');
        panel.id = 'jl-jobref-panel';

        const container = document.createElement('div');
        container.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;background:#1a1a2e;color:#eee;border-radius:8px;padding:16px;width:640px;max-height:88vh;display:flex;flex-direction:column;font-family:monospace;font-size:12px;box-shadow:0 4px 20px rgba(0,0,0,0.5);';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;';
        const title = document.createElement('strong');
        title.style.fontSize = '14px';
        title.innerHTML = 'Set Job Reference / Job Ref 1 <span style="font-weight:400;color:#8a8ab5;font-size:11px;">v' + VERSION + '</span>';
        const closeBtn = document.createElement('button');
        closeBtn.style.cssText = 'background:none;border:none;color:#eee;font-size:18px;cursor:pointer;';
        closeBtn.textContent = '✕';
        closeBtn.addEventListener('click', () => { panel.style.display = 'none'; });
        header.appendChild(title);
        header.appendChild(closeBtn);

        const progressDiv = document.createElement('div');
        progressDiv.style.marginBottom = '10px';
        progressText = document.createElement('span');
        progressText.style.color = '#0fa';
        progressText.textContent = 'Paste a list to begin.';
        progressDiv.appendChild(progressText);

        const optsDiv = document.createElement('div');
        optsDiv.style.cssText = 'display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:8px;';
        const fieldLabel = document.createElement('label');
        fieldLabel.textContent = 'Write into: ';
        fieldSelect = document.createElement('select');
        fieldSelect.style.cssText = 'background:#0a0a1a;color:#eee;border:1px solid #444;border-radius:4px;padding:4px;';
        Object.keys(FIELDS).forEach(k => {
            const o = document.createElement('option');
            o.value = k; o.textContent = FIELDS[k];
            fieldSelect.appendChild(o);
        });
        fieldLabel.appendChild(fieldSelect);
        const emptyLabel = document.createElement('label');
        emptyLabel.style.cssText = 'cursor:pointer;';
        emptyOnlyCheck = document.createElement('input');
        emptyOnlyCheck.type = 'checkbox';
        emptyLabel.appendChild(emptyOnlyCheck);
        emptyLabel.appendChild(document.createTextNode(' Only if empty'));
        emptyLabel.title = 'Leave jobs that already hold a value in the chosen field untouched instead of overwriting them.';
        const onOptChange = () => {
            if (!run || running) return;
            run.field = fieldSelect.value;
            run.emptyOnly = emptyOnlyCheck.checked;
            // Changing the target invalidates prior per-row results.
            run.status = new Array(run.rows.length).fill(null);
            saveRows(); saveProgress();
            refreshButtons();
            setProgress(`${run.rows.length} jobs loaded → ${FIELDS[run.field]}. Dry Run to preview, Start to write.`);
        };
        fieldSelect.addEventListener('change', onOptChange);
        emptyOnlyCheck.addEventListener('change', onOptChange);
        optsDiv.appendChild(fieldLabel);
        optsDiv.appendChild(emptyLabel);

        const controlsDiv = document.createElement('div');
        controlsDiv.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;';

        pasteBtn = document.createElement('button');
        pasteBtn.style.cssText = btnCss('#08a');
        pasteBtn.textContent = 'Paste / Load List';
        pasteBtn.addEventListener('click', openPasteDialog);

        dryBtn = document.createElement('button');
        dryBtn.style.cssText = btnCss('#a80');
        dryBtn.textContent = 'Dry Run';
        dryBtn.addEventListener('click', () => startProcess(true));

        startBtn = document.createElement('button');
        startBtn.style.cssText = btnCss('#0a8');
        startBtn.textContent = 'Start';
        startBtn.addEventListener('click', () => startProcess(false));

        stopBtn = document.createElement('button');
        stopBtn.style.cssText = btnCss('#a22') + 'display:none;';
        stopBtn.textContent = 'Stop';
        stopBtn.addEventListener('click', () => { running = false; stopBtn.textContent = 'Stopping…'; });

        csvBtn = document.createElement('button');
        csvBtn.style.cssText = btnCss('#456');
        csvBtn.textContent = 'Results CSV';
        csvBtn.title = 'Download every row with its result and the field\'s previous value.';
        csvBtn.addEventListener('click', downloadCsv);

        discardBtn = document.createElement('button');
        discardBtn.style.cssText = btnCss('#633');
        discardBtn.textContent = 'Discard';
        discardBtn.title = 'Forget the loaded list and saved progress.';
        discardBtn.addEventListener('click', () => {
            if (!confirm('Discard the loaded list and all saved progress?')) return;
            clearRun();
            logArea.innerHTML = '';
            setProgress('Paste a list to begin.');
            refreshButtons();
        });

        [pasteBtn, dryBtn, startBtn, stopBtn, csvBtn, discardBtn].forEach(b => controlsDiv.appendChild(b));

        const help = document.createElement('div');
        help.style.cssText = 'font-size:11px;color:#888;margin-bottom:10px;';
        help.textContent = 'Two columns: Job Number, value. Header row optional. Dry Run reads every job once (~1 min) and reports what would change — no writes. '
            + 'Start writes ~1 job / 3 s (WAF limit), so 35k jobs ≈ a day: leave this tab open, close other Joblogic tabs, and keep the machine awake. '
            + 'Progress is saved after every job — Stop or reload, then Start again to carry on. Errored rows are retried on the next Start.';

        logArea = document.createElement('div');
        logArea.style.cssText = 'flex:1;overflow-y:auto;background:#0a0a1a;padding:8px;border-radius:4px;max-height:55vh;';

        container.appendChild(header);
        container.appendChild(progressDiv);
        container.appendChild(optsDiv);
        container.appendChild(controlsDiv);
        container.appendChild(help);
        container.appendChild(logArea);
        panel.appendChild(container);
        document.body.appendChild(panel);

        jlRegisterPanel(panel, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR, SCRIPT_DESC);

        run = loadRun();
        if (run) {
            fieldSelect.value = run.field;
            emptyOnlyCheck.checked = run.emptyOnly;
            const left = pendingCount();
            setProgress(`Saved list: ${run.rows.length} jobs → ${FIELDS[run.field]} · ${run.rows.length - left} done · ${left} to go. Start to resume.`);
        }
        refreshButtons();
    }

    function refreshButtons() {
        const has = !!run;
        dryBtn.disabled = startBtn.disabled = !has || running;
        csvBtn.disabled = discardBtn.disabled = !has || running;
        pasteBtn.disabled = fieldSelect.disabled = emptyOnlyCheck.disabled = running;
        [dryBtn, startBtn, csvBtn, discardBtn, pasteBtn].forEach(b => { b.style.opacity = b.disabled ? '0.45' : '1'; });
        dryBtn.style.display = startBtn.style.display = running ? 'none' : 'inline-block';
        stopBtn.style.display = running ? 'inline-block' : 'none';
        stopBtn.textContent = 'Stop';
        if (has && !running) {
            const done = run.status.some(s => s && s.s !== ST.ERROR);
            startBtn.textContent = done ? `Resume (${pendingCount()} left)` : 'Start';
        }
    }

    function log(msg, color) {
        const line = document.createElement('div');
        line.style.color = color || '#ccc';
        line.style.whiteSpace = 'pre-wrap';
        line.style.wordBreak = 'break-word';
        line.textContent = msg;
        logArea.appendChild(line);
        while (logArea.childElementCount > LOG_MAX_LINES) logArea.removeChild(logArea.firstChild);
        logArea.scrollTop = logArea.scrollHeight;
    }
    const setProgress = (msg) => { progressText.textContent = msg; };

    // =======================================================================
    // Input parsing → [[jobRef, value]]  (last value wins if a job repeats)
    // =======================================================================
    function parseInput(text) {
        const rawLines = text.split(/\r?\n|\r/).map(l => l.replace(/\s+$/, '')).filter(l => l.trim());
        if (!rawLines.length) return { rows: [], error: 'Empty input' };

        // Detect the delimiter from the raw paste, not from rawLines[0] — a first
        // row with an empty second cell loses its trailing tab above.
        const delim = /\t/.test(text) ? '\t' : ',';

        function tokenise(line) {
            if (delim === '\t') return line.split('\t').map(f => f.trim());
            const fields = [];
            let cur = '', inQuote = false;
            for (let i = 0; i < line.length; i++) {
                const c = line[i];
                if (c === '"') {
                    if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
                    else inQuote = !inQuote;
                } else if (c === ',' && !inQuote) {
                    fields.push(cur.trim());
                    cur = '';
                } else {
                    cur += c;
                }
            }
            fields.push(cur.trim());
            return fields;
        }

        const normHeader = (s) => norm(s).replace(/_/g, ' ');
        const allRows = rawLines.map(tokenise);
        const firstRow = allRows[0].map(normHeader);

        let jobCol = -1, refCol = -1, dataStart = 0;
        for (let i = 0; i < firstRow.length; i++) {
            if (jobCol < 0 && JOB_HEADERS.includes(firstRow[i])) jobCol = i;
            else if (refCol < 0 && REF_HEADERS.includes(firstRow[i])) refCol = i;
        }
        if (jobCol >= 0 && refCol >= 0) {
            dataStart = 1;
        } else {
            jobCol = 0;
            refCol = 1;
            dataStart = 0;
        }

        const order = [];
        const map = {}; // upperJobRef -> [jobRef, value]
        let dupes = 0;
        for (let i = dataStart; i < allRows.length; i++) {
            const r = allRows[i];
            const jobRef = (r[jobCol] || '').trim();
            const val = (r[refCol] || '').trim();
            if (!jobRef || !val) continue;
            const key = jobRef.toUpperCase();
            if (!map[key]) { map[key] = [jobRef, val]; order.push(key); }
            else { map[key][1] = val; dupes++; }   // duplicate job number — last row wins
        }
        return { rows: order.map(k => map[k]), dupes };
    }

    // =======================================================================
    // Paste / load dialog
    // =======================================================================
    function openPasteDialog() {
        if (run && pendingCount() < run.rows.length && !confirm('A list with saved progress is loaded. Replace it?')) return;

        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:100000;display:flex;align-items:center;justify-content:center;';
        overlay.innerHTML = `
            <div style="background:#fff;color:#111;border-radius:8px;width:600px;max-width:94vw;box-shadow:0 10px 40px rgba(0,0,0,.4);overflow:hidden;font-family:system-ui,sans-serif;">
                <div style="padding:12px 16px;background:#111827;color:#f9fafb;font-weight:600;">Paste list — Job Number, value</div>
                <div style="padding:14px 16px;">
                    <div style="margin-bottom:8px;font-size:13px;">Load a .tsv/.csv file: <input type="file" id="jl-jobref-file" accept=".tsv,.csv,.txt,text/plain,text/csv,text/tab-separated-values"></div>
                    <textarea id="jl-jobref-ta" style="width:100%;height:220px;font:13px monospace;padding:8px;border:1px solid #d1d5db;border-radius:4px;box-sizing:border-box;" placeholder="…or paste from Google Sheets (tab-separated) / comma CSV:&#10;RE0017205	WO-44821&#10;PM0000897/001	ACME/2026/117&#10;RE0017310	SR-9932"></textarea>
                    <div style="color:#6b7280;font-size:12px;margin-top:6px;">Header row optional. Column 1 = job number, column 2 = the value to write (into the field picked in the panel).</div>
                    <div id="jl-jobref-count" style="color:#2563eb;font-size:12px;margin-top:6px;font-weight:600;">0 jobs detected</div>
                    <div style="text-align:right;margin-top:10px;">
                        <button id="jl-jobref-cancel" style="background:#9ca3af;color:#fff;border:0;border-radius:4px;padding:7px 14px;cursor:pointer;margin-right:6px;">Cancel</button>
                        <button id="jl-jobref-ok" style="background:#2563eb;color:#fff;border:0;border-radius:4px;padding:7px 14px;cursor:pointer;">Load</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        const ta = overlay.querySelector('#jl-jobref-ta');
        const countEl = overlay.querySelector('#jl-jobref-count');
        let countTimer = null;
        const recount = () => {
            clearTimeout(countTimer);
            countTimer = setTimeout(() => {
                const { rows, dupes } = parseInput(ta.value);
                countEl.textContent = `${rows.length} job${rows.length === 1 ? '' : 's'} detected` + (dupes ? ` (${dupes} duplicate job numbers — last value wins)` : '');
            }, 250);
        };
        ta.addEventListener('input', recount);
        overlay.querySelector('#jl-jobref-file').addEventListener('change', (e) => {
            const f = e.target.files && e.target.files[0];
            if (!f) return;
            f.text().then(t => { ta.value = t; recount(); });
        });

        overlay.querySelector('#jl-jobref-cancel').onclick = () => overlay.remove();
        overlay.querySelector('#jl-jobref-ok').onclick = () => {
            const { rows, error, dupes } = parseInput(ta.value);
            overlay.remove();
            if (error || !rows.length) {
                setProgress('No valid rows found. Check the format.');
                return;
            }
            run = { rows, field: fieldSelect.value, emptyOnly: emptyOnlyCheck.checked, status: new Array(rows.length).fill(null), loadedAt: new Date().toISOString() };
            logArea.innerHTML = '';
            if (!saveRows()) log('Warning: list too big to save in browser storage — progress will NOT survive a reload. Split the list if you need resume.', '#fa0');
            saveProgress();
            log(`Loaded ${rows.length} job${rows.length === 1 ? '' : 's'}${dupes ? ` (${dupes} duplicate rows collapsed)` : ''}:`, '#0af');
            rows.slice(0, 8).forEach(([j, v]) => log(`  ${j}  →  "${v}"`, '#ccc'));
            if (rows.length > 8) log(`  … and ${rows.length - 8} more`, '#888');
            setProgress(`${rows.length} jobs loaded → ${FIELDS[run.field]}. Dry Run to preview, Start to write.`);
            refreshButtons();
        };
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        setTimeout(() => ta.focus(), 50);
    }

    // =======================================================================
    // Paced fetch with Azure WAF retry
    // =======================================================================
    let lastRequestAt = 0;
    let currentInterval = MIN_INTERVAL;
    let okStreak = 0;

    async function throttle() {
        const wait = lastRequestAt + currentInterval - Date.now();
        if (wait > 0) await sleep(wait);
        lastRequestAt = Date.now();
    }

    async function isWafBlock(resp) {
        if (![403, 429, 503].includes(resp.status)) return false;
        if (/Azure-Application-Gateway/i.test(resp.headers.get('server') || '')) return true;
        return /text\/html/i.test(resp.headers.get('content-type') || '');
    }

    const isLoginUrl = (u) => /\/Account\/|\/login|identity\./i.test(u || '');

    async function jlFetch(url, opts = {}) {
        for (let attempt = 0; ; attempt++) {
            await throttle();
            let resp;
            try {
                resp = await fetch(url, Object.assign({ credentials: 'same-origin' }, opts));
            } catch (e) {
                if (attempt < WAF_BACKOFF.length && running) { await sleepInterruptible(WAF_BACKOFF[attempt]); continue; }
                throw e;
            }
            if (resp.redirected && isLoginUrl(resp.url)) throw new SessionError('Logged out of Joblogic');
            if (await isWafBlock(resp)) {
                okStreak = 0;
                currentInterval = Math.min(MAX_INTERVAL, currentInterval + 200);
                if (attempt < WAF_BACKOFF.length && running) {
                    setProgressNote(`rate-limited — retry in ${WAF_BACKOFF[attempt] / 1000}s (pace now ${currentInterval} ms)`);
                    await sleepInterruptible(WAF_BACKOFF[attempt]);
                    continue;
                }
                throw new Error('Rate-limited by Azure WAF (403) — gave up after retries');
            }
            // Ease back toward the floor after a clean stretch.
            if (++okStreak >= 60 && currentInterval > MIN_INTERVAL) { currentInterval = Math.max(MIN_INTERVAL, currentInterval - 100); okStreak = 0; }
            return resp;
        }
    }

    let progressNote = '';
    let renderProgress = () => {};
    function setProgressNote(n) { progressNote = n; renderProgress(); }

    function getCsrf(doc = document) {
        const el = doc.querySelector('input[name="__RequestVerificationToken"]');
        return el ? el.value : '';
    }

    // =======================================================================
    // Index: every job in one sweep → { JOBNUMBER: {id, cur, frozen} | {ambiguous} }
    // =======================================================================
    async function buildIndex(field) {
        const index = new Map();
        let page = 1, seen = 0, total = Infinity;
        while (seen < total) {
            if (!running) throw new Error('Stopped');
            setProgress(`Indexing jobs… ${seen}${isFinite(total) ? '/' + total : ''}`);
            const resp = await jlFetch('/api/Job/SearchJsonData', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                    '__RequestVerificationToken': getCsrf()
                },
                body: JSON.stringify({
                    SearchTerm: '', SelectedTab: 'All',
                    PageSize: INDEX_PAGE_SIZE, PageIndex: page,
                    EngineerType: 0,
                    IncludePPMJobs: true, IncludeReactiveJobs: true,
                    StatusIds: '',
                    StartLoggedDate: '', EndLoggedDate: '',
                    StartDate: '', EndDate: '',
                    StartCompleteDate: '', EndCompleteDate: '',
                    StartNextContactDate: '', EndNextContactDate: ''
                })
            });
            if (!resp.ok) throw new Error('Index search HTTP ' + resp.status);
            const ct = resp.headers.get('content-type') || '';
            if (!/json/i.test(ct)) throw new SessionError('Job search returned a non-JSON page — logged out?');
            const data = await resp.json();
            if (data.success === false) throw new Error('Index search failed: ' + (data.errors || []).join('; '));
            const ad = data.AdditionalData || {};
            const jobs = ad.Jobs || [];
            total = ad.TotalCount || 0;
            for (const j of jobs) {
                const key = String(j.JobNumber || '').trim().toUpperCase();
                if (!key) continue;
                const entry = { id: j.Id, cur: j[field] == null ? '' : String(j[field]), frozen: !!j.IsFrozen };
                if (index.has(key) && index.get(key).id !== j.Id) index.set(key, { ambiguous: true });
                else index.set(key, entry);
            }
            seen += jobs.length;
            if (!jobs.length) break;
            page++;
        }
        log(`Indexed ${index.size} jobs (TotalCount ${total}).`, '#0af');
        return index;
    }

    // Classify a row against the index without touching the job.
    function preclassify(row, index, emptyOnly) {
        const [jobRef, val] = row;
        const hit = index.get(jobRef.trim().toUpperCase());
        if (!hit) return { s: ST.NOT_FOUND };
        if (hit.ambiguous) return { s: ST.AMBIGUOUS };
        if (hit.cur.trim() === val.trim()) return { s: ST.SAME, p: hit.cur };
        if (emptyOnly && hit.cur.trim()) return { s: ST.NOT_EMPTY, p: hit.cur };
        if (hit.frozen) return { s: ST.FROZEN, p: hit.cur };
        return null; // needs a write
    }

    // =======================================================================
    // Per-job write: GET detail → full form POST to EditDetail
    // =======================================================================
    function extractJobState(html, internalId) {
        const anchor = `"Id":${internalId}`;
        const i = html.indexOf(anchor);
        if (i < 0) throw new Error('Job state anchor not found in detail page');
        let depth = 0, start = -1;
        for (let p = i; p >= 0; p--) {
            const c = html[p];
            if (c === '}') depth++;
            else if (c === '{') {
                if (depth === 0) { start = p; break; }
                depth--;
            }
        }
        if (start < 0) throw new Error('Job state open brace not found');
        let d = 0, inStr = false, esc = false, end = -1;
        for (let j = start; j < html.length; j++) {
            const c = html[j];
            if (esc) { esc = false; continue; }
            if (c === '\\') { esc = true; continue; }
            if (c === '"') { inStr = !inStr; continue; }
            if (inStr) continue;
            if (c === '{') d++;
            else if (c === '}') { d--; if (d === 0) { end = j + 1; break; } }
        }
        if (end < 0) throw new Error('Job state close brace not found');
        return JSON.parse(html.slice(start, end));
    }

    async function writeField(internalId, field, newVal, emptyOnly, _retry = 0) {
        const detailResp = await jlFetch('/Job/Detail/' + internalId, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        if (!detailResp.ok) throw new Error('Detail HTTP ' + detailResp.status);
        const html = await detailResp.text();
        if (html.indexOf(`"Id":${internalId}`) < 0 && /name="Password"|Account\/Login/i.test(html)) throw new SessionError('Logged out of Joblogic');
        const job = extractJobState(html, internalId);

        // Re-check against live state — the index may be minutes/hours old.
        const current = job[field] == null ? '' : String(job[field]);
        if (current.trim() === newVal.trim()) return { s: ST.SAME, p: current };
        if (emptyOnly && current.trim()) return { s: ST.NOT_EMPTY, p: current };

        const tokenMatch = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
        const csrfToken = tokenMatch ? tokenMatch[1] : '';

        const v = (k) => (k === field ? newVal : job[k]);
        const entries = [];
        const push = (k, val) => entries.push([k, val == null ? '' : String(val)]);

        push('Id', job.Id);
        push('AssignedToUserId', job.AssignedToUserId);
        (Array.isArray(job.TagIds) ? job.TagIds : []).forEach((id, idx) => push(`TagIds[${idx}]`, id));
        push('TradeId', job.TradeId);
        push('IsRecuring', job.IsRecuring);
        push('JobTypeId', job.JobTypeId);
        push('StatusId', job.StatusId);
        push('Description', job.Description);
        push('DateLogged', job.DateLogged);
        push('AppointmentDate', job.AppointmentDate);
        push('TargetCompletionDate', job.TargetCompletionDate);
        push('DateComplete', job.DateComplete);
        push('TargetAttendanceDate', job.TargetAttendanceDate);
        push('NextContactDate', job.NextContactDate);

        const fc = job.JobFaultCode || {};
        push('JobFaultCode[ReportedFaultCodeId]',      fc.ReportedFaultCodeId);
        push('JobFaultCode[ReportedFaultCodeName]',    fc.ReportedFaultCodeName);
        push('JobFaultCode[ReportedSubFaultCodeId]',   fc.ReportedSubFaultCodeId);
        push('JobFaultCode[ReportedSubFaultCodeName]', fc.ReportedSubFaultCodeName);
        push('JobFaultCode[ActualFaultCodeId]',        fc.ActualFaultCodeId);
        push('JobFaultCode[ActualFaultCodeName]',      fc.ActualFaultCodeName);
        push('JobFaultCode[ActualSubFaultCodeId]',     fc.ActualSubFaultCodeId);
        push('JobFaultCode[ActualSubFaultCodeName]',   fc.ActualSubFaultCodeName);

        push('JobCategoryId', job.JobCategoryId);
        push('PriorityId', job.PriorityId);
        push('OrderNumber', job.OrderNumber);
        push('CustomReference', v('CustomReference'));                       // "Reference Number"
        push('IsRequireApproval', job.IsRequireApproval);
        push('CompletionTimeSinceOnSite', job.CompletionTimeSinceOnSite);
        push('JobUserReferenceFieldValue', v('JobUserReferenceFieldValue')); // "Job Ref 1"
        push('JobUserReferenceDropdownListValue', job.JobUserReferenceDropdownListValue);
        push('CustomerContractId', job.CustomerContractId);
        push('ProjectNumber', job.ProjectNumber);
        push('MilestoneId', job.MilestoneId);
        push('ProjectMilestoneId', job.ProjectMilestoneId);
        push('ProjectId', job.ProjectId);
        push('BaseCurrencyCode', job.BaseCurrencyCode);
        push('BaseCurrencyName', job.BaseCurrencyName);
        push('ToCurrencyCode', job.ToCurrencyCode);
        push('ToCurrencyName', job.ToCurrencyName);
        push('ConversionRate', job.ConversionRate);
        push('ExchangeRateDate', job.ExchangeRateDate);
        push('IsEnabledMultipleCurrencies', job.IsEnabledMultipleCurrencies);
        push('PreferredCurrencyId', job.PreferredCurrencyId);
        push('CustomerId', job.CustomerId);
        push('IsAssociatedCustomer', job.IsAssociatedCustomer);

        const body = entries.map(([k, val]) => `${encodeURIComponent(k)}=${encodeURIComponent(val)}`).join('&');

        const headers = {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
            'Accept': 'application/json'
        };
        if (csrfToken) headers['__RequestVerificationToken'] = csrfToken;

        const resp = await jlFetch('/api/Job/EditDetail', {
            method: 'POST',
            referrer: `${location.origin}/Job/Detail/${internalId}`,
            referrerPolicy: 'unsafe-url',
            headers,
            body
        });
        const respText = await resp.text().catch(() => '');
        if (!resp.ok) {
            if (resp.status === 400 && _retry < 1) {
                await sleepInterruptible(2500);
                return writeField(internalId, field, newVal, emptyOnly, _retry + 1);
            }
            throw new Error(`EditDetail HTTP ${resp.status}: ${respText.slice(0, 300)}`);
        }
        let json = {};
        try { json = JSON.parse(respText); } catch (_) {}
        if (json.success === false) {
            const errMsg = (Array.isArray(json.errors) && json.errors.length)
                ? json.errors.join('; ')
                : (json.Message || respText.slice(0, 200));
            // Frozen (locked / period-locked) jobs can't be edited — report, don't error.
            if (/frozen/i.test(errMsg)) return { s: ST.FROZEN, p: current };
            throw new Error(errMsg);
        }
        return { s: ST.SET, p: current };
    }

    // =======================================================================
    // Main
    // =======================================================================
    const fmtDur = (ms) => {
        const m = Math.round(ms / 60000);
        return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
    };

    function tallyOf(status) {
        const t = {};
        status.forEach(s => { if (s) t[s.s] = (t[s.s] || 0) + 1; });
        return t;
    }
    function tallyText(t) {
        const p = [`✓ ${t[ST.SET] || 0} set`];
        if (t[ST.SAME])      p.push(`↷ ${t[ST.SAME]} same`);
        if (t[ST.NOT_EMPTY]) p.push(`⊘ ${t[ST.NOT_EMPTY]} not empty`);
        if (t[ST.FROZEN])    p.push(`❄ ${t[ST.FROZEN]} frozen`);
        if (t[ST.NOT_FOUND]) p.push(`? ${t[ST.NOT_FOUND]} not found`);
        if (t[ST.AMBIGUOUS]) p.push(`≠ ${t[ST.AMBIGUOUS]} ambiguous`);
        if (t[ST.ERROR])     p.push(`⚠ ${t[ST.ERROR]} err`);
        return p.join('  ·  ');
    }

    async function startProcess(dryRun) {
        if (running || !run) return;
        running = true;
        refreshButtons();
        logArea.innerHTML = '';
        progressNote = '';

        const field = run.field;
        const label = FIELDS[field];
        const emptyOnly = run.emptyOnly;
        log(dryRun ? `DRY RUN — ${label}: nothing will be written` : `LIVE — writing ${label}`, dryRun ? '#ff0' : '#f55');
        log(emptyOnly ? `Only if empty — jobs that already have a ${label} are left alone.` : `Existing ${label} values WILL be overwritten (old value kept in the Results CSV).`, emptyOnly ? '#888' : '#fa0');

        try {
            const index = await buildIndex(field);

            // Rows still to do: never attempted, or errored last time.
            const todo = [];
            const statusForPreview = run.status.slice();
            run.rows.forEach((row, i) => {
                const prev = run.status[i];
                if (prev && prev.s !== ST.ERROR) return;
                const pre = preclassify(row, index, emptyOnly);
                if (pre) statusForPreview[i] = pre;
                else { statusForPreview[i] = null; todo.push(i); }
            });

            if (dryRun) {
                const t = tallyOf(statusForPreview);
                const overwrites = todo.filter(i => index.get(run.rows[i][0].trim().toUpperCase()).cur.trim());
                log('');
                log('===== DRY RUN SUMMARY =====', '#0af');
                log(`Rows in list:                 ${run.rows.length}`);
                const doneBefore = run.status.filter(s => s && s.s !== ST.ERROR).length;
                if (doneBefore) log(`Already done in earlier runs: ${doneBefore}`, '#888');
                log(`Would write:                  ${todo.length}  (${todo.length - overwrites.length} currently empty, ${overwrites.length} overwrite an existing value)`, '#0fa');
                log(`Already correct (skip):       ${t[ST.SAME] || 0}`, '#888');
                if (emptyOnly) log(`Has a value (skip):           ${t[ST.NOT_EMPTY] || 0}`, '#888');
                log(`Frozen (skip):                ${t[ST.FROZEN] || 0}`, t[ST.FROZEN] ? '#fa0' : '#888');
                log(`Job number not found:         ${t[ST.NOT_FOUND] || 0}`, t[ST.NOT_FOUND] ? '#f55' : '#888');
                if (t[ST.AMBIGUOUS]) log(`Job number matches >1 job:    ${t[ST.AMBIGUOUS]}`, '#f55');
                log(`Estimated live run time:      ~${fmtDur(todo.length * 2 * MIN_INTERVAL)}  (2 calls per job at ${MIN_INTERVAL} ms)`, '#0af');
                if (overwrites.length) {
                    log('');
                    log(`Overwrites (first ${Math.min(30, overwrites.length)}):`, '#fa0');
                    overwrites.slice(0, 30).forEach(i => log(`  ${run.rows[i][0]}: "${index.get(run.rows[i][0].trim().toUpperCase()).cur}" → "${run.rows[i][1]}"`, '#fc8'));
                }
                const nf = run.rows.filter((r, i) => statusForPreview[i] && statusForPreview[i].s === ST.NOT_FOUND);
                if (nf.length) {
                    log('');
                    log(`Not found (first ${Math.min(30, nf.length)}):`, '#f55');
                    nf.slice(0, 30).forEach(r => log('  ' + r[0], '#f99'));
                }
                setProgress(`Dry run: ${todo.length} to write · ${tallyText(t)}`);
                return;
            }

            // Commit the pre-classified skips so they appear in the CSV and aren't re-checked.
            const newlySkipped = [];
            run.rows.forEach((row, i) => {
                if (statusForPreview[i] && (!run.status[i] || run.status[i].s === ST.ERROR)) { run.status[i] = statusForPreview[i]; newlySkipped.push(statusForPreview[i]); }
            });
            saveProgress();
            log(`${todo.length} jobs to write  ·  ${newlySkipped.length} skipped from the index (${tallyText(tallyOf(newlySkipped)).replace(/^✓ 0 set(  ·  )?/, '') || '—'})`, '#0af');

            const startedAt = Date.now();
            let n = 0;
            let current = '';
            renderProgress = () => {
                const elapsed = Date.now() - startedAt;
                const eta = n ? fmtDur(elapsed / n * (todo.length - n)) : '…';
                setProgress(`${n}/${todo.length} written · ETA ${eta}${current ? ' · ' + current : ''}${progressNote ? ' · ' + progressNote : ''}  ||  ${tallyText(tallyOf(run.status))}`);
            };

            for (const i of todo) {
                if (!running) { log('Stopped — progress saved. Start again to resume.', '#f55'); break; }
                const [jobRef, val] = run.rows[i];
                const hit = index.get(jobRef.trim().toUpperCase());
                current = jobRef; progressNote = '';
                renderProgress();
                try {
                    const res = await writeField(hit.id, field, val, emptyOnly);
                    run.status[i] = res;
                    if (res.s === ST.SET) log(`${jobRef}  "${res.p}" → "${val}"  ✓`, '#0fa');
                    else if (res.s === ST.SAME) log(`${jobRef}  already "${res.p}"`, '#888');
                    else if (res.s === ST.NOT_EMPTY) log(`${jobRef}  has "${res.p}" — skipped (only if empty)`, '#fa0');
                    else if (res.s === ST.FROZEN) log(`${jobRef}  frozen — skipped`, '#fa0');
                } catch (e) {
                    if (e instanceof SessionError) {
                        log(`${e.message} — stopped at ${jobRef}. Log back in, reload, and Start to resume.`, '#f55');
                        running = false;
                        break;
                    }
                    if (!running) { log('Stopped — progress saved. Start again to resume.', '#f55'); break; }
                    run.status[i] = { s: ST.ERROR, m: e.message };
                    log(`${jobRef}  ERROR ${e.message}`, '#f55');
                }
                n++;
                saveProgress();
                renderProgress();
            }

            current = '';
            const t = tallyOf(run.status);
            const left = pendingCount();
            log('');
            log('===== SUMMARY =====', '#0af');
            log(`Written this session: ${n}  ·  elapsed ${fmtDur(Date.now() - startedAt)}`, '#0fa');
            log(`Whole list (${run.rows.length}): ${tallyText(t)}`, '#0fa');
            if (left) log(`${left} rows still to do (not reached or errored) — Start again to resume/retry.`, '#fa0');
            log('Use "Results CSV" for the full per-row outcome with previous values.', '#888');
            setProgress(`${left ? 'Paused' : 'Done'} — ${tallyText(t)}${left ? ` · ${left} left` : ''}`);
        } catch (e) {
            log(`ERROR ${e.message}`, '#f55');
            setProgress(e instanceof SessionError ? 'Logged out — log in, reload, Start to resume.' : `Error: ${e.message}`);
        } finally {
            running = false;
            renderProgress = () => {};
            refreshButtons();
        }
    }

    // =======================================================================
    // Results CSV
    // =======================================================================
    function downloadCsv() {
        if (!run) return;
        const q = (s) => {
            const str = s == null ? '' : String(s);
            return /[",\r\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
        };
        const label = FIELDS[run.field];
        const lines = [['Job Number', 'New ' + label, 'Previous ' + label, 'Result', 'Error'].map(q).join(',')];
        run.rows.forEach(([j, v], i) => {
            const s = run.status[i];
            lines.push([j, v, s ? s.p : '', s ? s.s : 'pending', s && s.m ? s.m : ''].map(q).join(','));
        });
        const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `jl-${run.field === 'CustomReference' ? 'reference-number' : 'job-ref-1'}-results-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }

    // --- BOOT ---
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createUI);
    } else {
        createUI();
    }
})();
