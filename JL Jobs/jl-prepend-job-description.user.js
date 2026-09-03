// ==UserScript==
// @name         Joblogic - Prepend Text to Job Description
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Paste a two-column TSV/CSV of Job Number + text. The script resolves each job and prepends the text to the front of its Description, keeping the existing description intact. Choose the separator, preview with Dry Run, skips jobs that already start with the text. Collapses into the shared JL dock.
// @match        https://go.joblogic.com/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/jl-prepend-job-description.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/jl-prepend-job-description.user.js
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
    const SCRIPT_ID = 'prepend-job-description';
    const SCRIPT_LABEL = '📝 Prepend Job Description';
    const SCRIPT_COLOR = '#5a3b6b';
    const SCRIPT_DESC = 'Paste a two-column TSV/CSV of Job Number + text. Prepends the text to the front of each job Description. Paste, then Start.';

    // --- CONFIG ---
    const DELAY_BETWEEN_JOBS = 400;   // pause between per-job EditDetail calls
    const SEARCH_PAGE_SIZE = 50;      // results per SearchJsonData lookup

    // Separator inserted between the pasted text and the existing description.
    const SEPARATORS = [
        { label: 'Space',     value: ' '    },
        { label: 'Space-dash', value: ' - ' },
        { label: 'New line',  value: '\n'   },
        { label: 'Blank line', value: '\n\n' },
        { label: 'Nothing',   value: ''     }
    ];

    // Column header aliases (case-insensitive; underscores normalised to spaces)
    const JOB_HEADERS = ['job', 'job no', 'job no.', 'job number', 'jobno', 'jobnumber', 'job ref', 'job reference', 'reference', 'ref', 'number', 'id', 'job id'];
    const TEXT_HEADERS = ['text', 'prefix', 'description', 'desc', 'job description', 'note', 'prepend', 'string', 'value', 'add'];

    // --- STATE ---
    let panel, logArea, startBtn, stopBtn, pasteBtn, progressText, dryCheck, sepSelect;
    let running = false;
    let jobsInput = [];    // [{jobRef, text}]

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const norm = (s) => String(s || '').toLowerCase().trim();
    const visible = (s) => String(s).replace(/\n/g, '\\n');

    // =======================================================================
    // UI
    // =======================================================================
    function createUI() {
        if (document.getElementById('jl-jobdesc-panel')) return;

        panel = document.createElement('div');
        panel.id = 'jl-jobdesc-panel';

        const container = document.createElement('div');
        container.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;background:#1a1a2e;color:#eee;border-radius:8px;padding:16px;width:600px;max-height:88vh;display:flex;flex-direction:column;font-family:monospace;font-size:12px;box-shadow:0 4px 20px rgba(0,0,0,0.5);';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;';
        const title = document.createElement('strong');
        title.style.fontSize = '14px';
        title.innerHTML = 'Prepend Text to Job Description <span style="font-weight:400;color:#8a8ab5;font-size:11px;">v' + VERSION + '</span>';
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

        const sepLabel = document.createElement('label');
        sepLabel.style.cssText = 'display:flex;align-items:center;gap:4px;';
        sepLabel.appendChild(document.createTextNode('Separator:'));
        sepSelect = document.createElement('select');
        sepSelect.style.cssText = 'background:#0a0a1a;color:#eee;border:1px solid #444;border-radius:4px;padding:5px;font-family:monospace;';
        SEPARATORS.forEach((s, i) => {
            const o = document.createElement('option');
            o.value = String(i);
            o.textContent = s.label;
            sepSelect.appendChild(o);
        });
        sepLabel.appendChild(sepSelect);

        const dryLabel = document.createElement('label');
        dryLabel.style.cssText = 'cursor:pointer;';
        dryCheck = document.createElement('input');
        dryCheck.type = 'checkbox';
        dryLabel.appendChild(dryCheck);
        dryLabel.appendChild(document.createTextNode(' Dry Run'));

        controlsDiv.appendChild(pasteBtn);
        controlsDiv.appendChild(startBtn);
        controlsDiv.appendChild(stopBtn);
        controlsDiv.appendChild(sepLabel);
        controlsDiv.appendChild(dryLabel);

        const help = document.createElement('div');
        help.style.cssText = 'font-size:11px;color:#888;margin-bottom:10px;';
        help.textContent = 'Two columns: Job Number, text to put at the front of the Description. Header row optional. The existing description is kept and pushed after the separator. Jobs whose description already starts with the text are skipped.';

        logArea = document.createElement('div');
        logArea.style.cssText = 'flex:1;overflow-y:auto;background:#0a0a1a;padding:8px;border-radius:4px;max-height:60vh;';

        container.appendChild(header);
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
    // Input parsing → [{jobRef, text}]  (last value wins if a job repeats)
    // =======================================================================
    function parseInput(text) {
        const rawLines = text.split(/\r?\n|\r/).map(l => l.replace(/\s+$/, '')).filter(l => l.trim());
        if (!rawLines.length) return { jobs: [], error: 'Empty input' };

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

        let jobCol = -1, textCol = -1, dataStart = 0;
        for (let i = 0; i < firstRow.length; i++) {
            if (jobCol < 0 && JOB_HEADERS.includes(firstRow[i])) jobCol = i;
            if (textCol < 0 && TEXT_HEADERS.includes(firstRow[i])) textCol = i;
        }
        if (jobCol >= 0 && textCol >= 0) {
            dataStart = 1;
        } else {
            jobCol = 0;
            textCol = 1;
            dataStart = 0;
        }

        const order = [];
        const map = {}; // upperJobRef -> {jobRef, text}
        for (let i = dataStart; i < allRows.length; i++) {
            const r = allRows[i];
            const jobRef = (r[jobCol] || '').trim();
            const txt = (r[textCol] || '').trim();
            if (!jobRef || !txt) continue;
            const key = jobRef.toUpperCase();
            if (!map[key]) { map[key] = { jobRef, text: txt }; order.push(key); }
            else map[key].text = txt;   // duplicate job number — last row wins
        }
        return { jobs: order.map(k => map[k]) };
    }

    // =======================================================================
    // Paste dialog
    // =======================================================================
    function openPasteDialog() {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:100000;display:flex;align-items:center;justify-content:center;';
        overlay.innerHTML = `
            <div style="background:#fff;color:#111;border-radius:8px;width:580px;max-width:94vw;box-shadow:0 10px 40px rgba(0,0,0,.4);overflow:hidden;font-family:system-ui,sans-serif;">
                <div style="padding:12px 16px;background:#111827;color:#f9fafb;font-weight:600;">Paste list — Job Number, Text to prepend</div>
                <div style="padding:14px 16px;">
                    <textarea id="jl-jobdesc-ta" style="width:100%;height:220px;font:13px monospace;padding:8px;border:1px solid #d1d5db;border-radius:4px;box-sizing:border-box;" placeholder="Paste from Google Sheets (tab-separated) or comma CSV:&#10;RE0017205	[QUOTED]&#10;PM0000897/001	URGENT -&#10;RE0017310	Site access via rear gate."></textarea>
                    <div style="color:#6b7280;font-size:12px;margin-top:6px;">Tab-separated (Google Sheets paste) or comma CSV. Header row optional. Column 1 = job number, column 2 = the text that goes at the front of the Description.</div>
                    <div id="jl-jobdesc-count" style="color:#2563eb;font-size:12px;margin-top:6px;font-weight:600;">0 jobs detected</div>
                    <div style="text-align:right;margin-top:10px;">
                        <button id="jl-jobdesc-cancel" style="background:#9ca3af;color:#fff;border:0;border-radius:4px;padding:7px 14px;cursor:pointer;margin-right:6px;">Cancel</button>
                        <button id="jl-jobdesc-ok" style="background:#2563eb;color:#fff;border:0;border-radius:4px;padding:7px 14px;cursor:pointer;">Load</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        const ta = overlay.querySelector('#jl-jobdesc-ta');
        const countEl = overlay.querySelector('#jl-jobdesc-count');

        ta.addEventListener('input', () => {
            const { jobs: j } = parseInput(ta.value);
            countEl.textContent = `${j.length} job${j.length === 1 ? '' : 's'} detected`;
        });

        overlay.querySelector('#jl-jobdesc-cancel').onclick = () => overlay.remove();
        overlay.querySelector('#jl-jobdesc-ok').onclick = () => {
            const { jobs: parsed, error } = parseInput(ta.value);
            overlay.remove();
            if (error || !parsed.length) {
                setProgress('No valid rows found. Check the format.');
                startBtn.disabled = true;
                return;
            }
            jobsInput = parsed;
            logArea.innerHTML = '';
            log(`Loaded ${jobsInput.length} job${jobsInput.length === 1 ? '' : 's'}:`, '#0af');
            jobsInput.slice(0, 8).forEach(j => log(`  ${j.jobRef}  →  "${j.text}"`, '#ccc'));
            if (jobsInput.length > 8) log(`  … and ${jobsInput.length - 8} more`, '#888');
            setProgress(`${jobsInput.length} jobs ready. Click Start.`);
            startBtn.disabled = false;
        };
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        setTimeout(() => ta.focus(), 50);
    }

    // =======================================================================
    // API helpers
    // =======================================================================
    function getCsrf(doc = document) {
        const el = doc.querySelector('input[name="__RequestVerificationToken"]');
        return el ? el.value : '';
    }

    async function fetchText(url) {
        const resp = await fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        if (!resp.ok) throw new Error('HTTP ' + resp.status + ' on ' + url);
        return resp.text();
    }

    // Resolve a single job number → { id, number }. Exact JobNumber match.
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
        if (exact.length > 1) return { id: exact[0].Id || exact[0].JobId, number: exact[0].JobNumber, ambiguous: exact.length };
        if (exact.length === 1) return { id: exact[0].Id || exact[0].JobId, number: exact[0].JobNumber };
        return null;
    }

    // Pull embedded job-state JSON from the detail page HTML
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

    // POST full form to /api/Job/EditDetail with the new Description.
    async function prependDescription(internalId, prefix, sep, dryRun, _retry = 0) {
        const html = await fetchText('/Job/Detail/' + internalId);
        const job = extractJobState(html, internalId);

        const current = job.Description == null ? '' : String(job.Description);
        // Already prefixed (e.g. a re-run) — leave it alone.
        if (norm(current).startsWith(norm(prefix))) return { alreadyPrefixed: true, current };

        const merged = current.trim() ? (prefix + sep + current) : prefix;

        if (dryRun) return { dry: true, current, merged };

        const tokenMatch = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
        const csrfToken = tokenMatch ? tokenMatch[1] : '';

        const entries = [];
        const push = (k, v) => entries.push([k, v == null ? '' : String(v)]);

        push('Id', job.Id);
        push('AssignedToUserId', job.AssignedToUserId);
        (Array.isArray(job.TagIds) ? job.TagIds : []).forEach((id, idx) => push(`TagIds[${idx}]`, id));
        push('TradeId', job.TradeId);
        push('IsRecuring', job.IsRecuring);
        push('JobTypeId', job.JobTypeId);
        push('StatusId', job.StatusId);
        push('Description', merged); // ← the change
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
        push('CustomReference', job.CustomReference);
        push('IsRequireApproval', job.IsRequireApproval);
        push('CompletionTimeSinceOnSite', job.CompletionTimeSinceOnSite);
        push('JobUserReferenceFieldValue', job.JobUserReferenceFieldValue);
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

        const body = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

        const headers = {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
            'Accept': 'application/json'
        };
        if (csrfToken) headers['__RequestVerificationToken'] = csrfToken;

        const resp = await fetch('/api/Job/EditDetail', {
            method: 'POST',
            credentials: 'same-origin',
            referrer: `${location.origin}/Job/Detail/${internalId}`,
            referrerPolicy: 'unsafe-url',
            headers,
            body
        });
        const respText = await resp.text().catch(() => '');
        if (!resp.ok) {
            if (resp.status === 400 && _retry < 1) {
                await sleep(2500);
                return prependDescription(internalId, prefix, sep, dryRun, _retry + 1);
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
            if (/frozen/i.test(errMsg)) return { frozen: true, current };
            throw new Error(errMsg);
        }
        return { current, merged };
    }

    // =======================================================================
    // Main loop
    // =======================================================================
    async function startProcess() {
        if (running || !jobsInput.length) return;
        running = true;
        startBtn.style.display = 'none';
        stopBtn.style.display = 'inline-block';
        logArea.innerHTML = '';

        const dryRun = dryCheck.checked;
        const sepDef = SEPARATORS[Number(sepSelect.value)] || SEPARATORS[0];
        const sep = sepDef.value;
        log(dryRun ? 'DRY RUN — no changes will be made' : 'LIVE MODE — descriptions will be updated', dryRun ? '#ff0' : '#f55');
        log(`Separator: ${sepDef.label} ("${visible(sep)}")`, '#888');

        const stats = { updated: 0, skipped: 0, frozen: 0, notFound: 0, errors: 0 };
        const failed = [];

        // Persistent progress line: job position + live running tally + what's happening now.
        let curJob = 0;
        const total = jobsInput.length;
        const tally = () => {
            const p = [`✓ ${stats.updated} updated`];
            if (stats.skipped)  p.push(`↷ ${stats.skipped} already`);
            if (stats.frozen)   p.push(`❄ ${stats.frozen} frozen`);
            if (stats.notFound) p.push(`? ${stats.notFound} not found`);
            if (stats.errors)   p.push(`⚠ ${stats.errors} err`);
            return p.join('  ·  ');
        };
        const showProgress = (now) => setProgress(`Job ${curJob}/${total}${now ? '  ·  ' + now : ''}  ·  ${tally()}`);

        for (let i = 0; i < jobsInput.length; i++) {
            if (!running) { log('Stopped by user.', '#f55'); break; }
            const { jobRef, text } = jobsInput[i];
            curJob = i + 1;

            log(`--- [${i + 1}/${total}] ${jobRef}  →  "${text}" ---`, '#fff');
            showProgress(`${jobRef} — finding job`);

            try {
                const found = await findJob(jobRef);
                if (!found) {
                    log('  Not found', '#f55');
                    stats.notFound++;
                    failed.push(`${jobRef} (not found)`);
                    showProgress();
                    continue;
                }
                if (found.ambiguous) log(`  Warning: ${found.ambiguous} exact matches — using the first (id=${found.id})`, '#fa0');

                showProgress(`${jobRef} — updating description`);
                const res = await prependDescription(found.id, text, sep, dryRun);
                if (res.alreadyPrefixed) {
                    log(`  description already starts with that text — skipped`, '#888');
                    stats.skipped++;
                } else if (res.frozen) {
                    log(`  frozen — cannot edit, skipped`, '#fa0');
                    stats.frozen++;
                    failed.push(`${jobRef} (frozen)`);
                } else if (res.dry) {
                    log(`  [DRY] "${visible(res.merged).slice(0, 160)}${res.merged.length > 160 ? '…' : ''}"`, '#ff0');
                    stats.updated++;
                } else {
                    log(`  updated ✓  "${visible(res.merged).slice(0, 160)}${res.merged.length > 160 ? '…' : ''}"`, '#0fa');
                    stats.updated++;
                }
            } catch (e) {
                log(`  ERROR ${e.message}`, '#f55');
                stats.errors++;
                failed.push(`${jobRef} (${e.message})`);
            }
            showProgress();
            await sleep(DELAY_BETWEEN_JOBS);
        }

        log('');
        log('===== SUMMARY =====', '#0af');
        log(`Jobs processed:  ${curJob}`, '#0fa');
        log(`Updated:         ${stats.updated}`, '#0fa');
        log(`Already prefixed:${stats.skipped}`, stats.skipped ? '#fa0' : '#888');
        log(`Frozen (skipped):${stats.frozen}`, stats.frozen ? '#fa0' : '#888');
        log(`Not found:       ${stats.notFound}`, stats.notFound ? '#fa0' : '#888');
        log(`Errors:          ${stats.errors}`, stats.errors ? '#f55' : '#888');
        if (failed.length) {
            log('');
            log('Not updated:', '#f55');
            failed.forEach(f => log('  ' + f, '#f99'));
        }
        setProgress(`Done — ${curJob}/${total} jobs  ·  ${tally()}`);

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
