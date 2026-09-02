// ==UserScript==
// @name         Joblogic - Delete Jobs (list)
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Paste a list of Job Numbers and delete them. Resolves each job number, opens Joblogic's own delete-confirmation modal to read exactly what else would be removed (invoices, visits, costs, lines...), then submits that form. Defaults to DRY RUN — a live run needs a typed confirmation, since job deletion is irreversible. Collapses into the shared JL dock.
// @match        https://go.joblogic.com/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/jl-delete-jobs.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/jl-delete-jobs.user.js
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

    const VERSION = '1.0';
    const SCRIPT_ID = 'delete-jobs';
    const SCRIPT_LABEL = '🗑 Delete Jobs';
    const SCRIPT_COLOR = '#7a1f1f';
    const SCRIPT_DESC = 'Paste a list of Job Numbers to delete. Dry run first — it shows exactly what Joblogic would remove with each job. A live run needs a typed confirmation; deletion is irreversible.';

    // --- CONFIG ---
    const DELAY_BETWEEN_JOBS = 500;   // pause between per-job deletes
    const SEARCH_PAGE_SIZE = 50;      // results per SearchJsonData lookup
    const CONFIRM_PHRASE = 'DELETE';  // must be typed to start a live run
    const BIG_BATCH_WARN = 100;       // extra warning above this many jobs

    // Column header aliases (case-insensitive; underscores normalised to spaces)
    const JOB_HEADERS = ['job', 'job no', 'job no.', 'job number', 'jobno', 'jobnumber', 'job ref', 'job reference', 'reference', 'ref', 'number', 'id', 'job id'];

    // --- STATE ---
    let panel, logArea, startBtn, stopBtn, pasteBtn, copyBtn, progressText, dryCheck, skipInvCheck;
    let running = false;
    let jobsInput = [];    // ['R0001234', ...]
    let results = [];      // [{jobRef, id, status, collateral, outcome, detail}]

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const norm = (s) => String(s || '').toLowerCase().trim();

    // =======================================================================
    // UI
    // =======================================================================
    function createUI() {
        if (document.getElementById('jl-jobdel-panel')) return;

        panel = document.createElement('div');
        panel.id = 'jl-jobdel-panel';

        const container = document.createElement('div');
        container.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;background:#1a1a2e;color:#eee;border-radius:8px;padding:16px;width:640px;max-height:88vh;display:flex;flex-direction:column;font-family:monospace;font-size:12px;box-shadow:0 4px 20px rgba(0,0,0,0.5);';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;';
        const title = document.createElement('strong');
        title.style.fontSize = '14px';
        title.innerHTML = 'Delete Jobs <span style="font-weight:400;color:#8a8ab5;font-size:11px;">v' + VERSION + '</span>';
        const closeBtn = document.createElement('button');
        closeBtn.style.cssText = 'background:none;border:none;color:#eee;font-size:18px;cursor:pointer;';
        closeBtn.textContent = '✕';
        closeBtn.addEventListener('click', () => { panel.style.display = 'none'; });
        header.appendChild(title);
        header.appendChild(closeBtn);

        const danger = document.createElement('div');
        danger.style.cssText = 'background:#3a0d0d;border-left:3px solid #f55;color:#ffd9d9;padding:8px 10px;border-radius:4px;margin-bottom:10px;font-size:11px;line-height:1.45;';
        danger.textContent = 'Job deletion is permanent and irreversible. Joblogic also removes everything hanging off the job — visits, invoices, credits, costs, lines, notes, attachments, forms — and reverses any stock issued. Always dry-run first and read the collateral list.';

        const progressDiv = document.createElement('div');
        progressDiv.style.marginBottom = '10px';
        progressText = document.createElement('span');
        progressText.style.color = '#0fa';
        progressText.textContent = 'Paste a list to begin.';
        progressDiv.appendChild(progressText);

        const controlsDiv = document.createElement('div');
        controlsDiv.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;';

        pasteBtn = document.createElement('button');
        pasteBtn.style.cssText = 'background:#08a;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;';
        pasteBtn.textContent = 'Paste List';
        pasteBtn.addEventListener('click', openPasteDialog);

        startBtn = document.createElement('button');
        startBtn.style.cssText = 'background:#0a8;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;';
        startBtn.textContent = 'Start';
        startBtn.disabled = true;
        startBtn.addEventListener('click', startProcess);

        stopBtn = document.createElement('button');
        stopBtn.style.cssText = 'background:#a22;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;display:none;';
        stopBtn.textContent = 'Stop';
        stopBtn.addEventListener('click', () => { running = false; });

        copyBtn = document.createElement('button');
        copyBtn.style.cssText = 'background:#555;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;display:none;';
        copyBtn.textContent = 'Copy TSV';
        copyBtn.addEventListener('click', copyResults);

        const dryLabel = document.createElement('label');
        dryLabel.style.cssText = 'cursor:pointer;color:#ff0;';
        dryCheck = document.createElement('input');
        dryCheck.type = 'checkbox';
        dryCheck.checked = true;   // safe default
        dryCheck.addEventListener('change', () => {
            startBtn.style.background = dryCheck.checked ? '#0a8' : '#c22';
            startBtn.textContent = dryCheck.checked ? 'Start' : 'DELETE';
        });
        dryLabel.appendChild(dryCheck);
        dryLabel.appendChild(document.createTextNode(' Dry Run (preview only)'));

        const skipLabel = document.createElement('label');
        skipLabel.style.cssText = 'cursor:pointer;color:#fa0;';
        skipInvCheck = document.createElement('input');
        skipInvCheck.type = 'checkbox';
        skipLabel.appendChild(skipInvCheck);
        skipLabel.appendChild(document.createTextNode(' Skip jobs with invoices'));

        controlsDiv.appendChild(pasteBtn);
        controlsDiv.appendChild(startBtn);
        controlsDiv.appendChild(stopBtn);
        controlsDiv.appendChild(copyBtn);
        controlsDiv.appendChild(dryLabel);
        controlsDiv.appendChild(skipLabel);

        const help = document.createElement('div');
        help.style.cssText = 'font-size:11px;color:#888;margin-bottom:10px;';
        help.textContent = 'One Job Number per line (or paste a column from Sheets — the first column, or a column headed "Job Number", is used). Duplicates are collapsed.';

        logArea = document.createElement('div');
        logArea.style.cssText = 'flex:1;overflow-y:auto;background:#0a0a1a;padding:8px;border-radius:4px;max-height:58vh;';

        container.appendChild(header);
        container.appendChild(danger);
        container.appendChild(progressDiv);
        container.appendChild(controlsDiv);
        container.appendChild(help);
        container.appendChild(logArea);
        panel.appendChild(container);
        document.body.appendChild(panel);

        jlRegisterPanel(panel, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR, SCRIPT_DESC);
    }

    function log(msg, color) {
        const line = document.createElement('div');
        line.style.color = color || '#ccc';
        line.style.whiteSpace = 'pre-wrap';
        line.style.wordBreak = 'break-word';
        line.textContent = msg;
        logArea.appendChild(line);
        logArea.scrollTop = logArea.scrollHeight;
    }
    const setProgress = (msg) => { progressText.textContent = msg; };

    // =======================================================================
    // Input parsing → ['R0001234', ...]
    // =======================================================================
    function parseInput(text) {
        const rawLines = text.split(/\r?\n|\r/).map(l => l.trim()).filter(Boolean);
        if (!rawLines.length) return { jobs: [] };

        const delim = rawLines[0].includes('\t') ? '\t' : ',';

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

        // Locate the job column from a header row if there is one, else column 0.
        let jobCol = -1, dataStart = 0;
        for (let i = 0; i < firstRow.length; i++) {
            if (jobCol < 0 && JOB_HEADERS.includes(firstRow[i])) jobCol = i;
        }
        if (jobCol >= 0) dataStart = 1; else jobCol = 0;

        const seen = new Set();
        const jobs = [];
        for (let i = dataStart; i < allRows.length; i++) {
            const jobRef = (allRows[i][jobCol] || '').trim();
            if (!jobRef) continue;
            const key = jobRef.toUpperCase();
            if (seen.has(key)) continue;
            seen.add(key);
            jobs.push(jobRef);
        }
        return { jobs };
    }

    // =======================================================================
    // Paste dialog
    // =======================================================================
    function openPasteDialog() {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:100000;display:flex;align-items:center;justify-content:center;';
        overlay.innerHTML = `
            <div style="background:#fff;color:#111;border-radius:8px;width:580px;max-width:94vw;box-shadow:0 10px 40px rgba(0,0,0,.4);overflow:hidden;font-family:system-ui,sans-serif;">
                <div style="padding:12px 16px;background:#111827;color:#f9fafb;font-weight:600;">Paste list — Job Numbers to delete</div>
                <div style="padding:14px 16px;">
                    <textarea id="jl-jobdel-ta" style="width:100%;height:220px;font:13px monospace;padding:8px;border:1px solid #d1d5db;border-radius:4px;box-sizing:border-box;" placeholder="One job number per line:&#10;R0001234&#10;PM0000897/001&#10;PROJ0002715"></textarea>
                    <div style="color:#6b7280;font-size:12px;margin-top:6px;">One per line, or paste a column from Google Sheets. A header row is optional. Extra columns are ignored.</div>
                    <div id="jl-jobdel-count" style="color:#2563eb;font-size:12px;margin-top:6px;font-weight:600;">0 jobs detected</div>
                    <div style="text-align:right;margin-top:10px;">
                        <button id="jl-jobdel-cancel" style="background:#9ca3af;color:#fff;border:0;border-radius:4px;padding:7px 14px;cursor:pointer;margin-right:6px;">Cancel</button>
                        <button id="jl-jobdel-ok" style="background:#2563eb;color:#fff;border:0;border-radius:4px;padding:7px 14px;cursor:pointer;">Load</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        const ta = overlay.querySelector('#jl-jobdel-ta');
        const countEl = overlay.querySelector('#jl-jobdel-count');

        ta.addEventListener('input', () => {
            const { jobs: j } = parseInput(ta.value);
            countEl.textContent = `${j.length} job${j.length === 1 ? '' : 's'} detected`;
        });

        overlay.querySelector('#jl-jobdel-cancel').onclick = () => overlay.remove();
        overlay.querySelector('#jl-jobdel-ok').onclick = () => {
            const { jobs: parsed } = parseInput(ta.value);
            overlay.remove();
            if (!parsed.length) {
                setProgress('No job numbers found. Check the format.');
                startBtn.disabled = true;
                return;
            }
            jobsInput = parsed;
            results = [];
            copyBtn.style.display = 'none';
            logArea.innerHTML = '';
            log(`Loaded ${jobsInput.length} job${jobsInput.length === 1 ? '' : 's'}:`, '#0af');
            jobsInput.slice(0, 10).forEach(j => log('  ' + j, '#ccc'));
            if (jobsInput.length > 10) log(`  … and ${jobsInput.length - 10} more`, '#888');
            setProgress(`${jobsInput.length} jobs ready. Dry Run is ON — click Start to preview.`);
            startBtn.disabled = false;
        };
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        setTimeout(() => ta.focus(), 50);
    }

    // =======================================================================
    // Live-run confirmation — typed phrase, not just an OK button
    // =======================================================================
    function confirmLiveRun(count) {
        return new Promise(resolve => {
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:100001;display:flex;align-items:center;justify-content:center;';
            overlay.innerHTML = `
                <div style="background:#fff;color:#111;border-radius:8px;width:520px;max-width:94vw;box-shadow:0 10px 40px rgba(0,0,0,.5);overflow:hidden;font-family:system-ui,sans-serif;">
                    <div style="padding:12px 16px;background:#7f1d1d;color:#fff;font-weight:600;">Permanently delete ${count} job${count === 1 ? '' : 's'}?</div>
                    <div style="padding:14px 16px;">
                        <p style="margin:0 0 10px;font-size:13px;line-height:1.5;">This cannot be undone. Each job goes with everything attached to it — visits, invoices, credits, costs, lines, notes, attachments and forms — and any stock issued is reversed back into stock.</p>
                        ${count >= BIG_BATCH_WARN ? `<p style="margin:0 0 10px;font-size:13px;color:#b91c1c;font-weight:600;">That is a large batch (${count} jobs). Consider dry-running and checking the list again first.</p>` : ''}
                        <p style="margin:0 0 6px;font-size:13px;">Type <strong>${CONFIRM_PHRASE}</strong> to confirm:</p>
                        <input id="jl-jobdel-phrase" autocomplete="off" style="width:100%;font:14px monospace;padding:8px;border:1px solid #d1d5db;border-radius:4px;box-sizing:border-box;">
                        <div style="text-align:right;margin-top:12px;">
                            <button id="jl-jobdel-no" style="background:#9ca3af;color:#fff;border:0;border-radius:4px;padding:7px 14px;cursor:pointer;margin-right:6px;">Cancel</button>
                            <button id="jl-jobdel-yes" disabled style="background:#dc2626;color:#fff;border:0;border-radius:4px;padding:7px 14px;cursor:pointer;opacity:.4;">Delete permanently</button>
                        </div>
                    </div>
                </div>`;
            document.body.appendChild(overlay);

            const input = overlay.querySelector('#jl-jobdel-phrase');
            const yes = overlay.querySelector('#jl-jobdel-yes');
            const done = (val) => { overlay.remove(); resolve(val); };

            input.addEventListener('input', () => {
                const ok = input.value.trim().toUpperCase() === CONFIRM_PHRASE;
                yes.disabled = !ok;
                yes.style.opacity = ok ? '1' : '.4';
            });
            input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !yes.disabled) done(true); });
            overlay.querySelector('#jl-jobdel-no').onclick = () => done(false);
            yes.onclick = () => done(true);
            setTimeout(() => input.focus(), 50);
        });
    }

    // =======================================================================
    // API helpers
    // =======================================================================
    function getCsrf(doc = document) {
        const el = doc.querySelector('input[name="__RequestVerificationToken"]');
        return el ? el.value : '';
    }

    // Resolve a single job number → { id, number, status }. Exact JobNumber match only.
    async function findJob(jobRef) {
        const token = getCsrf();
        const resp = await fetch('/api/Job/SearchJsonData', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                '__RequestVerificationToken': token
            },
            body: JSON.stringify({
                SearchTerm: jobRef,
                PageSize: SEARCH_PAGE_SIZE, PageIndex: 1,
                EngineerType: 0,
                IncludePPMJobs: true, IncludeReactiveJobs: true,
                StatusIds: '',
                StartLoggedDate: '', EndLoggedDate: '',
                StartDate: '', EndDate: '',
                StartCompleteDate: '', EndCompleteDate: '',
                StartNextContactDate: '', EndNextContactDate: ''
            })
        });
        if (!resp.ok) throw new Error('Search HTTP ' + resp.status);
        const data = await resp.json();
        const ad = data.AdditionalData || {};
        const jobs = ad.Jobs || data.Data || [];
        const want = norm(jobRef);
        const exact = jobs.filter(j => norm(j.JobNumber || j.ReferenceNumber) === want);
        if (!exact.length) return null;
        const j = exact[0];
        return {
            id: j.Id || j.JobId,
            number: j.JobNumber,
            status: j.StatusDescription || '',
            ambiguous: exact.length > 1 ? exact.length : 0
        };
    }

    // Fetch Joblogic's own delete-confirmation modal for a job. It is the same
    // partial the UI shows, so it carries both the authoritative "what else goes"
    // list and the form (action + token + Id) we have to submit.
    async function getDeletePlan(jobId) {
        const resp = await fetch('/Job/DeleteModal?id=' + encodeURIComponent(jobId), {
            credentials: 'same-origin',
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });
        if (!resp.ok) throw new Error('DeleteModal HTTP ' + resp.status);
        const html = await resp.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const form = doc.querySelector('form[action]');

        // "The following items will also be removed: 1 Invoice(s), 7 Line(s), …"
        const collateral = [...doc.querySelectorAll('.modal-body ul li, ul li')]
            .map(li => li.textContent.replace(/\s+/g, ' ').trim())
            .filter(Boolean);

        if (!form) {
            // No form = Joblogic will not delete this one (permission, or a
            // project variation / locked job it refuses to remove).
            const msg = (doc.body.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200);
            return { deletable: false, collateral, message: msg || 'no delete form returned' };
        }
        return {
            deletable: true,
            collateral,
            action: form.getAttribute('action'),
            token: getCsrf(doc),
            idField: (form.querySelector('input[name="Id"]') || {}).value || String(jobId)
        };
    }

    const invoiceCount = (collateral) => {
        for (const c of collateral) {
            const m = c.match(/^(\d+)\s+(Invoice|Credit)/i);
            if (m) return parseInt(m[1], 10);
        }
        return 0;
    };

    // Submit the modal's form, exactly as the UI does.
    async function deleteJob(plan, jobId) {
        const body = new URLSearchParams();
        body.append('Id', plan.idField || String(jobId));
        if (plan.token) body.append('__RequestVerificationToken', plan.token);

        const headers = {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
            'Accept': 'application/json, text/javascript, */*'
        };
        if (plan.token) headers['__RequestVerificationToken'] = plan.token;

        const resp = await fetch(plan.action, {
            method: 'POST',
            credentials: 'same-origin',
            referrer: `${location.origin}/Job/Detail/${jobId}`,
            referrerPolicy: 'unsafe-url',
            headers,
            body
        });
        const text = await resp.text().catch(() => '');
        if (!resp.ok) throw new Error(`${plan.action} HTTP ${resp.status}: ${text.slice(0, 200)}`);
        let json = null;
        try { json = JSON.parse(text); } catch (_) {}
        if (json && json.success === false) {
            const msg = (Array.isArray(json.errors) && json.errors.length)
                ? json.errors.join('; ')
                : (json.Message || json.message || text.slice(0, 200));
            throw new Error(msg || 'delete reported success=false');
        }
        return json || {};
    }

    // =======================================================================
    // Results TSV
    // =======================================================================
    function copyResults() {
        const rows = [['Job Number', 'Job Id', 'Status', 'Outcome', 'Detail', 'Also removed'].join('\t')];
        for (const r of results) {
            rows.push([
                r.jobRef,
                r.id == null ? '' : r.id,
                r.status || '',
                r.outcome,
                (r.detail || '').replace(/\s+/g, ' '),
                (r.collateral || []).join('; ')
            ].join('\t'));
        }
        const tsv = rows.join('\n');
        navigator.clipboard.writeText(tsv)
            .then(() => log('Results copied to clipboard (TSV).', '#0fa'))
            .catch(() => {
                log('Clipboard blocked — TSV printed below instead:', '#fa0');
                log(tsv, '#ccc');
            });
    }

    // =======================================================================
    // Main loop
    // =======================================================================
    async function startProcess() {
        if (running || !jobsInput.length) return;

        const dryRun = dryCheck.checked;
        const skipInvoiced = skipInvCheck.checked;

        if (!dryRun) {
            const ok = await confirmLiveRun(jobsInput.length);
            if (!ok) { setProgress('Cancelled — nothing deleted.'); return; }
        }

        running = true;
        startBtn.style.display = 'none';
        stopBtn.style.display = 'inline-block';
        copyBtn.style.display = 'none';
        logArea.innerHTML = '';
        results = [];

        log(dryRun
            ? 'DRY RUN — nothing will be deleted. Read the "also removed" lines carefully.'
            : 'LIVE MODE — jobs are being PERMANENTLY DELETED', dryRun ? '#ff0' : '#f55');
        if (skipInvoiced) log('Guard on: any job whose delete would take invoices/credits with it will be skipped.', '#fa0');

        const stats = { deleted: 0, would: 0, notFound: 0, blocked: 0, skipped: 0, errors: 0 };
        let curJob = 0;
        const total = jobsInput.length;
        const tally = () => {
            const p = [dryRun ? `✓ ${stats.would} deletable` : `✓ ${stats.deleted} deleted`];
            if (stats.skipped)  p.push(`↷ ${stats.skipped} skipped`);
            if (stats.blocked)  p.push(`⛔ ${stats.blocked} blocked`);
            if (stats.notFound) p.push(`? ${stats.notFound} not found`);
            if (stats.errors)   p.push(`⚠ ${stats.errors} err`);
            return p.join('  ·  ');
        };
        const showProgress = (now) => setProgress(`Job ${curJob}/${total}${now ? '  ·  ' + now : ''}  ·  ${tally()}`);

        for (let i = 0; i < jobsInput.length; i++) {
            if (!running) { log('Stopped by user.', '#f55'); break; }
            const jobRef = jobsInput[i];
            curJob = i + 1;
            const rec = { jobRef, id: null, status: '', collateral: [], outcome: '', detail: '' };
            results.push(rec);

            log(`--- [${curJob}/${total}] ${jobRef} ---`, '#fff');
            showProgress(`${jobRef} — finding job`);

            try {
                const found = await findJob(jobRef);
                if (!found) {
                    log('  Not found', '#f55');
                    rec.outcome = 'not found';
                    stats.notFound++;
                    showProgress();
                    continue;
                }
                rec.id = found.id;
                rec.status = found.status;
                if (found.ambiguous) {
                    // Two jobs sharing a number should not happen — refuse rather
                    // than guess which one to destroy.
                    log(`  ${found.ambiguous} jobs share this number — skipped, resolve by hand`, '#fa0');
                    rec.outcome = 'ambiguous';
                    rec.detail = `${found.ambiguous} exact matches`;
                    stats.skipped++;
                    showProgress();
                    continue;
                }
                log(`  id=${found.id}  status=${found.status || '?'}`, '#888');

                showProgress(`${jobRef} — reading delete plan`);
                const plan = await getDeletePlan(found.id);
                rec.collateral = plan.collateral;
                if (plan.collateral.length) {
                    log('  also removed: ' + plan.collateral.join(', '), '#fa0');
                } else {
                    log('  also removed: nothing else', '#888');
                }

                if (!plan.deletable) {
                    log(`  BLOCKED — Joblogic will not delete this job: ${plan.message}`, '#f55');
                    rec.outcome = 'blocked';
                    rec.detail = plan.message;
                    stats.blocked++;
                    showProgress();
                    continue;
                }

                const inv = invoiceCount(plan.collateral);
                if (skipInvoiced && inv > 0) {
                    log(`  SKIPPED — would remove ${inv} invoice/credit record(s)`, '#fa0');
                    rec.outcome = 'skipped (invoiced)';
                    rec.detail = `${inv} invoice/credit`;
                    stats.skipped++;
                    showProgress();
                    continue;
                }
                if (inv > 0) log(`  ⚠ this job carries ${inv} invoice/credit record(s)`, '#f55');

                if (dryRun) {
                    log('  [DRY] would be deleted', '#ff0');
                    rec.outcome = 'would delete';
                    stats.would++;
                    showProgress();
                    continue;
                }

                showProgress(`${jobRef} — deleting`);
                await deleteJob(plan, found.id);

                // Verify: the job should no longer resolve.
                let gone = null;
                try { gone = await findJob(jobRef); } catch (_) { gone = undefined; }
                if (gone === null) {
                    log('  deleted ✓ (verified gone)', '#0fa');
                    rec.outcome = 'deleted';
                } else if (gone === undefined) {
                    log('  deleted ✓ (could not re-check)', '#0fa');
                    rec.outcome = 'deleted (unverified)';
                } else {
                    log('  delete accepted but the job still appears in search — check it manually', '#fa0');
                    rec.outcome = 'unconfirmed';
                    rec.detail = 'still in search after delete';
                }
                stats.deleted++;
            } catch (e) {
                log(`  ERROR ${e.message}`, '#f55');
                rec.outcome = 'error';
                rec.detail = e.message;
                stats.errors++;
            }
            showProgress();
            await sleep(DELAY_BETWEEN_JOBS);
        }

        log('');
        log('===== SUMMARY =====', '#0af');
        log(`Jobs processed:  ${curJob}`, '#0fa');
        if (dryRun) log(`Would delete:    ${stats.would}`, '#ff0');
        else        log(`Deleted:         ${stats.deleted}`, '#0fa');
        log(`Skipped:         ${stats.skipped}`, stats.skipped ? '#fa0' : '#888');
        log(`Blocked by JL:   ${stats.blocked}`, stats.blocked ? '#fa0' : '#888');
        log(`Not found:       ${stats.notFound}`, stats.notFound ? '#fa0' : '#888');
        log(`Errors:          ${stats.errors}`, stats.errors ? '#f55' : '#888');
        if (dryRun && stats.would) {
            log('');
            log(`Dry run only — nothing was deleted. Untick "Dry Run" and click DELETE to remove the ${stats.would} deletable job(s).`, '#ff0');
        }
        setProgress(`Done — ${curJob}/${total} jobs  ·  ${tally()}`);

        copyBtn.style.display = results.length ? 'inline-block' : 'none';
        running = false;
        startBtn.style.display = 'inline-block';
        stopBtn.style.display = 'none';
    }

    // --- BOOT ---
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createUI);
    } else {
        createUI();
    }
})();
