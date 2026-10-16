// ==UserScript==
// @name         Joblogic - Update Jobs: Description + Tag (TSV)
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Paste a TSV/CSV of Job Number, new Description, Tag(s). Replaces each job's Description and adds the tag(s) (existing tags kept) in one save per job. Blank cells leave that field alone. Dry Run preview, Azure-WAF-safe pacing, verifies each save by re-reading the job. Collapses into the shared JL dock.
// @match        https://go.joblogic.com/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/jl-update-jobs-description-tag.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/jl-update-jobs-description-tag.user.js
// ==/UserScript==
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
    const SCRIPT_ID = 'update-jobs-desc-tag';
    const SCRIPT_LABEL = '✏️ Update Jobs: Description + Tag';
    const SCRIPT_COLOR = '#3b5a2b';
    const SCRIPT_DESC = 'Paste a TSV of Job Number, new Description, Tag(s). Replaces each job\'s Description and adds the tag(s), keeping existing tags. Blank cells leave that field alone. Dry Run first, then Start.';

    // --- CONFIG ---
    const MIN_INTERVAL = 1400;        // Azure WAF-safe pacing between requests
    const MAX_INTERVAL = 4000;
    const WAF_BACKOFF = [1500, 3000, 6000, 12000, 20000];
    const SEARCH_PAGE_SIZE = 50;

    // Column header aliases (case-insensitive; underscores normalised to spaces)
    const JOB_HEADERS = ['job', 'job no', 'job no.', 'job number', 'jobno', 'jobnumber', 'job ref', 'job reference', 'number', 'job id'];
    const DESC_HEADERS = ['description', 'desc', 'new description', 'job description'];
    const TAG_HEADERS = ['tag', 'tags', 'tag name', 'tag to add', 'tags to add', 'label'];

    // --- STATE ---
    let panel, logArea, startBtn, stopBtn, pasteBtn, progressText, dryCheck, verifyCheck;
    let running = false;
    let jobsInput = [];    // [{jobRef, description|null, tags:[...]}]
    let tagMap = null;     // norm(title) -> {id, title}

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    async function sleepInterruptible(ms) {
        const end = Date.now() + ms;
        while (running && Date.now() < end) await sleep(Math.min(500, end - Date.now()));
    }
    const norm = (s) => String(s || '').toLowerCase().trim();
    // Joblogic may echo descriptions back with \r\n — compare on normalised newlines/whitespace.
    const normDesc = (s) => String(s == null ? '' : s).replace(/\r\n?/g, '\n').trim();

    // =======================================================================
    // UI
    // =======================================================================
    function createUI() {
        if (document.getElementById('jl-jobdesctag-panel')) return;

        panel = document.createElement('div');
        panel.id = 'jl-jobdesctag-panel';

        const container = document.createElement('div');
        container.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;background:#1a1a2e;color:#eee;border-radius:8px;padding:16px;width:640px;max-height:88vh;display:flex;flex-direction:column;font-family:monospace;font-size:12px;box-shadow:0 4px 20px rgba(0,0,0,0.5);';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;';
        const title = document.createElement('strong');
        title.style.fontSize = '14px';
        title.innerHTML = 'Update Jobs: Description + Tag <span style="font-weight:400;color:#8a8ab5;font-size:11px;">v' + VERSION + '</span>';
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

        const mkCheck = (label, checked) => {
            const l = document.createElement('label');
            l.style.cssText = 'cursor:pointer;';
            const c = document.createElement('input');
            c.type = 'checkbox';
            c.checked = checked;
            l.appendChild(c);
            l.appendChild(document.createTextNode(' ' + label));
            controlsDiv.appendChild(l);
            return c;
        };

        controlsDiv.appendChild(pasteBtn);
        controlsDiv.appendChild(startBtn);
        controlsDiv.appendChild(stopBtn);
        dryCheck = mkCheck('Dry Run', true);
        verifyCheck = mkCheck('Verify after save', true);

        const help = document.createElement('div');
        help.style.cssText = 'font-size:11px;color:#888;margin-bottom:10px;';
        help.textContent = 'Three columns: Job Number, new Description, Tag(s). Header row optional. Description REPLACES the existing one; a blank Description cell leaves it unchanged. Tags are added to existing tags (comma/semicolon for several); a blank Tag cell adds none.';

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
    const short = (s, n = 70) => { const t = normDesc(s).replace(/\n/g, ' ⏎ '); return t.length > n ? t.slice(0, n) + '…' : t; };

    // =======================================================================
    // Input parsing → [{jobRef, description, tags[]}]
    // Full-text parser so quoted cells may contain tabs/newlines (Google Sheets
    // wraps multi-line cells in quotes when copying as TSV).
    // =======================================================================
    function parseRows(text, delim) {
        const rows = [];
        let row = [], cur = '', inQuote = false, atCellStart = true;
        for (let i = 0; i < text.length; i++) {
            const c = text[i];
            if (inQuote) {
                if (c === '"') {
                    if (text[i + 1] === '"') { cur += '"'; i++; }
                    else inQuote = false;
                } else cur += c;
                continue;
            }
            if (c === '"' && atCellStart) { inQuote = true; atCellStart = false; continue; }
            if (c === delim) { row.push(cur); cur = ''; atCellStart = true; continue; }
            if (c === '\r' || c === '\n') {
                if (c === '\r' && text[i + 1] === '\n') i++;
                row.push(cur); rows.push(row);
                row = []; cur = ''; atCellStart = true;
                continue;
            }
            cur += c;
            atCellStart = false;
        }
        if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
        return rows.filter(r => r.some(f => f.trim() !== ''));
    }

    function parseInput(text) {
        const firstLine = (text.split(/\r?\n/).find(l => l.trim()) || '');
        if (!firstLine) return { jobs: [], error: 'Empty input' };
        const delim = firstLine.includes('\t') ? '\t' : ',';
        const allRows = parseRows(text, delim);

        const splitTags = (cell) => String(cell || '').split(/[;,]/).map(t => t.trim()).filter(Boolean);
        const normHeader = (s) => norm(s).replace(/_/g, ' ');
        const firstRow = (allRows[0] || []).map(normHeader);

        let jobCol = -1, descCol = -1, tagCol = -1, dataStart = 0;
        for (let i = 0; i < firstRow.length; i++) {
            if (jobCol < 0 && JOB_HEADERS.includes(firstRow[i])) jobCol = i;
            if (descCol < 0 && DESC_HEADERS.includes(firstRow[i])) descCol = i;
            if (tagCol < 0 && TAG_HEADERS.includes(firstRow[i])) tagCol = i;
        }
        if (jobCol >= 0 && (descCol >= 0 || tagCol >= 0)) {
            dataStart = 1;
        } else {
            jobCol = 0; descCol = 1; tagCol = 2; dataStart = 0;
        }

        const jobs = [];
        const seen = {};
        const dupes = [];
        for (let i = dataStart; i < allRows.length; i++) {
            const r = allRows[i];
            const jobRef = (r[jobCol] || '').trim();
            if (!jobRef) continue;
            const descRaw = descCol >= 0 ? (r[descCol] || '') : '';
            const description = descRaw.trim() ? descRaw.trim() : null;
            const tags = tagCol >= 0 ? splitTags(r[tagCol]) : [];
            if (description == null && !tags.length) continue;
            const key = jobRef.toUpperCase();
            if (seen[key]) {
                // Same job on several rows: merge tags; later description wins.
                const j = seen[key];
                if (description != null) j.description = description;
                for (const tg of tags) if (!j.tags.some(t => norm(t) === norm(tg))) j.tags.push(tg);
                dupes.push(jobRef);
                continue;
            }
            const j = { jobRef, description, tags: [] };
            for (const tg of tags) if (!j.tags.some(t => norm(t) === norm(tg))) j.tags.push(tg);
            seen[key] = j;
            jobs.push(j);
        }
        return { jobs, dupes };
    }

    // =======================================================================
    // Paste dialog
    // =======================================================================
    function openPasteDialog() {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:100001;display:flex;align-items:center;justify-content:center;';
        overlay.innerHTML = `
            <div style="background:#fff;color:#111;border-radius:8px;width:640px;max-width:94vw;box-shadow:0 10px 40px rgba(0,0,0,.4);overflow:hidden;font-family:system-ui,sans-serif;">
                <div style="padding:12px 16px;background:#111827;color:#f9fafb;font-weight:600;">Paste list — Job Number, Description, Tag(s)</div>
                <div style="padding:14px 16px;">
                    <textarea id="jl-jobdesctag-ta" style="width:100%;height:240px;font:13px monospace;padding:8px;border:1px solid #d1d5db;border-radius:4px;box-sizing:border-box;" placeholder="Paste from Google Sheets / Excel (tab-separated):&#10;RE0017205	Replace faulty emergency light in stairwell	Critical&#10;RE0017206	Service AC unit, level 3	Statutory, Critical&#10;RE0017207		Statutory     (blank description = leave as is)"></textarea>
                    <div style="color:#6b7280;font-size:12px;margin-top:6px;">Tab-separated or comma CSV. Header row optional (Job Number / Description / Tag). Description replaces the current one. Tags are added, existing tags kept.</div>
                    <div id="jl-jobdesctag-count" style="color:#2563eb;font-size:12px;margin-top:6px;font-weight:600;">0 jobs detected</div>
                    <div style="text-align:right;margin-top:10px;">
                        <button id="jl-jobdesctag-cancel" style="background:#9ca3af;color:#fff;border:0;border-radius:4px;padding:7px 14px;cursor:pointer;margin-right:6px;">Cancel</button>
                        <button id="jl-jobdesctag-ok" style="background:#2563eb;color:#fff;border:0;border-radius:4px;padding:7px 14px;cursor:pointer;">Load</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        const ta = overlay.querySelector('#jl-jobdesctag-ta');
        const countEl = overlay.querySelector('#jl-jobdesctag-count');

        ta.addEventListener('input', () => {
            const { jobs: j } = parseInput(ta.value);
            countEl.textContent = `${j.length} job${j.length === 1 ? '' : 's'} detected`;
        });

        overlay.querySelector('#jl-jobdesctag-cancel').onclick = () => overlay.remove();
        overlay.querySelector('#jl-jobdesctag-ok').onclick = () => {
            const { jobs: parsed, dupes, error } = parseInput(ta.value);
            overlay.remove();
            if (error || !parsed.length) {
                setProgress('No valid rows found. Check the format.');
                startBtn.disabled = true;
                return;
            }
            jobsInput = parsed;
            logArea.innerHTML = '';
            log(`Loaded ${jobsInput.length} job${jobsInput.length === 1 ? '' : 's'}:`, '#0af');
            jobsInput.slice(0, 8).forEach(j => log(`  ${j.jobRef}  →  desc: ${j.description == null ? '(unchanged)' : '"' + short(j.description, 50) + '"'}  ·  tags: ${j.tags.join(', ') || '(none)'}`, '#ccc'));
            if (jobsInput.length > 8) log(`  … and ${jobsInput.length - 8} more`, '#888');
            if (dupes && dupes.length) log(`Note: ${dupes.length} repeated job row(s) merged (tags combined, last description wins).`, '#fa0');
            setProgress(`${jobsInput.length} jobs ready. ${dryCheck.checked ? 'Dry Run is ON — ' : ''}Click Start.`);
            startBtn.disabled = false;
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
            if (resp.redirected && isLoginUrl(resp.url)) throw new Error('Logged out of Joblogic — log in and Start again');
            if (await isWafBlock(resp)) {
                okStreak = 0;
                currentInterval = Math.min(MAX_INTERVAL, currentInterval + 200);
                if (attempt < WAF_BACKOFF.length && running) {
                    log(`  rate-limited — retry in ${WAF_BACKOFF[attempt] / 1000}s (pace now ${currentInterval} ms)`, '#fa0');
                    await sleepInterruptible(WAF_BACKOFF[attempt]);
                    continue;
                }
                throw new Error('Rate-limited by Azure WAF (403) — gave up after retries');
            }
            if (++okStreak >= 60 && currentInterval > MIN_INTERVAL) { currentInterval = Math.max(MIN_INTERVAL, currentInterval - 100); okStreak = 0; }
            return resp;
        }
    }

    // =======================================================================
    // API helpers
    // =======================================================================
    function getCsrf(doc = document) {
        const el = doc.querySelector('input[name="__RequestVerificationToken"]');
        return el ? el.value : '';
    }

    async function fetchText(url) {
        const resp = await jlFetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        if (!resp.ok) throw new Error('HTTP ' + resp.status + ' on ' + url);
        return resp.text();
    }

    // Job tag library. entityType is the STRING "Job"; text='' returns the full list.
    async function fetchTags(text) {
        const resp = await jlFetch('/api/Tag/GetTags?entityType=Job&text=' + encodeURIComponent(text || ''), {
            headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' }
        });
        if (!resp.ok) throw new Error('GetTags HTTP ' + resp.status);
        const list = await resp.json();
        const arr = Array.isArray(list) ? list : (list.AdditionalData || list.Data || []);
        const found = [];
        for (const t of arr) {
            const id = t.Id != null ? t.Id : t.TagId;
            const title = t.Title || t.Name || t.Text;
            if (id != null && title) found.push({ id: String(id), title });
        }
        return found;
    }

    async function loadTags() {
        if (tagMap) return tagMap;
        const map = {};
        for (const t of await fetchTags('')) map[norm(t.title)] = t;
        tagMap = map;
        const n = Object.keys(map).length;
        if (n === 0) log('Tag library is EMPTY — check you are in the right Joblogic company.', '#f55');
        else log(`Tag library loaded (${n} tags).`, '#0a8');
        return map;
    }

    // Exact (case-insensitive) match only — a fuzzy match could add the wrong tag.
    async function resolveTag(tagName) {
        const key = norm(tagName);
        if (tagMap[key]) return tagMap[key];
        try {
            for (const t of await fetchTags(tagName)) {
                tagMap[norm(t.title)] = t;
                if (norm(t.title) === key) return t;
            }
        } catch (e) { /* treat as unknown */ }
        return tagMap[key] || null;
    }

    // Resolve a job number → { id, number }. Exact JobNumber match.
    async function findJob(jobRef) {
        const resp = await jlFetch('/api/Job/SearchJsonData', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                '__RequestVerificationToken': getCsrf()
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
        const exact = jobs.filter(j => norm(j.JobNumber) === want);
        if (!exact.length) return null;
        return { id: exact[0].Id || exact[0].JobId, number: exact[0].JobNumber, ambiguous: exact.length > 1 ? exact.length : 0 };
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

    function existingTagIds(job) {
        return Array.isArray(job.TagIds)
            ? job.TagIds.map(String)
            : (Array.isArray(job.Tags) ? job.Tags.map(t => String(t.Id || t.TagId || t)) : []);
    }

    async function loadJob(internalId) {
        const html = await fetchText('/Job/Detail/' + internalId);
        return { html, job: extractJobState(html, internalId) };
    }

    // One EditDetail POST carrying both the new Description and the merged tag list.
    async function updateJob(internalId, newDesc, addTagIds, dryRun, _retry = 0) {
        const { html, job } = await loadJob(internalId);

        const curDesc = job.Description == null ? '' : String(job.Description);
        const descChange = newDesc != null && normDesc(newDesc) !== normDesc(curDesc);

        const current = existingTagIds(job);
        const merged = current.slice();
        const addedTags = [];
        for (const id of addTagIds) {
            if (!merged.includes(String(id))) { merged.push(String(id)); addedTags.push(String(id)); }
        }

        const base = { curDesc, descChange, addedTags, current, merged };
        if (!descChange && !addedTags.length) return Object.assign(base, { nothing: true });
        if (dryRun) return Object.assign(base, { dry: true });

        const tokenMatch = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
        const csrfToken = tokenMatch ? tokenMatch[1] : '';

        const entries = [];
        const push = (k, v) => entries.push([k, v == null ? '' : String(v)]);

        push('Id', job.Id);
        push('AssignedToUserId', job.AssignedToUserId);
        merged.forEach((id, idx) => push(`TagIds[${idx}]`, id));                 // ← change 1
        push('TradeId', job.TradeId);
        push('IsRecuring', job.IsRecuring);
        push('JobTypeId', job.JobTypeId);
        push('StatusId', job.StatusId);
        push('Description', descChange ? newDesc : job.Description);             // ← change 2
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
                await sleep(2500);
                return updateJob(internalId, newDesc, addTagIds, dryRun, _retry + 1);
            }
            throw new Error(`EditDetail HTTP ${resp.status}: ${respText.slice(0, 300)}`);
        }
        let json = {};
        try { json = JSON.parse(respText); } catch (_) {}
        if (json.success === false) {
            const errMsg = (Array.isArray(json.errors) && json.errors.length)
                ? json.errors.join('; ')
                : (json.Message || respText.slice(0, 200));
            if (/frozen/i.test(errMsg)) return Object.assign(base, { frozen: true });
            throw new Error(errMsg);
        }
        return base;
    }

    // Re-read the job and confirm both changes stuck (EditDetail can return success and drop a field).
    async function verifyJob(internalId, newDesc, wantTagIds) {
        const { job } = await loadJob(internalId);
        const problems = [];
        if (newDesc != null && normDesc(job.Description) !== normDesc(newDesc)) {
            problems.push(`description is "${short(job.Description)}"`);
        }
        const now = existingTagIds(job);
        const missing = wantTagIds.filter(id => !now.includes(String(id)));
        if (missing.length) {
            const names = missing.map(id => (Object.values(tagMap).find(t => t.id === String(id)) || {}).title || id);
            problems.push(`missing tag(s) ${names.join(', ')}`);
        }
        return problems;
    }

    // =======================================================================
    // Main loop
    // =======================================================================
    async function startProcess() {
        if (running || !jobsInput.length) return;
        running = true;
        startBtn.style.display = 'none';
        stopBtn.style.display = 'inline-block';
        pasteBtn.disabled = true;
        logArea.innerHTML = '';

        const dryRun = dryCheck.checked;
        const verify = verifyCheck.checked && !dryRun;
        log(dryRun ? 'DRY RUN — no changes will be made' : 'LIVE MODE — descriptions and tags will be written', dryRun ? '#ff0' : '#f55');

        const stats = { updated: 0, nothing: 0, frozen: 0, notFound: 0, unknownTag: 0, verifyFail: 0, errors: 0 };
        const failed = [];
        const unknownTags = new Set();

        let curJob = 0;
        const total = jobsInput.length;
        const tally = () => {
            const p = [`✓ ${stats.updated} ${dryRun ? 'would update' : 'updated'}`];
            if (stats.nothing)    p.push(`↷ ${stats.nothing} already`);
            if (stats.frozen)     p.push(`❄ ${stats.frozen} frozen`);
            if (stats.notFound)   p.push(`? ${stats.notFound} not found`);
            if (stats.verifyFail) p.push(`✗ ${stats.verifyFail} verify failed`);
            if (stats.errors)     p.push(`⚠ ${stats.errors} err`);
            return p.join('  ·  ');
        };
        const showProgress = (now) => setProgress(`Job ${curJob}/${total}${now ? '  ·  ' + now : ''}  ·  ${tally()}`);

        try {
            if (jobsInput.some(j => j.tags.length)) await loadTags();
            else tagMap = {};
        } catch (e) {
            log('Could not load tag library: ' + e.message, '#f55');
            running = false;
            startBtn.style.display = 'inline-block';
            stopBtn.style.display = 'none';
            pasteBtn.disabled = false;
            return;
        }

        for (let i = 0; i < jobsInput.length; i++) {
            if (!running) { log('Stopped by user.', '#f55'); break; }
            const { jobRef, description, tags } = jobsInput[i];
            curJob = i + 1;
            log(`--- [${i + 1}/${total}] ${jobRef} ---`, '#fff');
            showProgress(`${jobRef} — resolving tags`);

            const resolved = [];
            for (const tg of tags) {
                const r = await resolveTag(tg);
                if (!r) {
                    log(`  unknown tag "${tg}" — skipping this tag`, '#f55');
                    if (!unknownTags.has(norm(tg))) {
                        unknownTags.add(norm(tg));
                        const available = Object.values(tagMap).map(t => t.title).sort().join(', ');
                        log(`  Available tags: ${available || '(none)'}`, '#888');
                    }
                    stats.unknownTag++;
                    continue;
                }
                resolved.push(r);
            }
            if (description == null && !resolved.length) {
                log('  nothing valid to change — skipped', '#fa0');
                failed.push(`${jobRef} (no valid tag, no description)`);
                showProgress();
                continue;
            }

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

                showProgress(`${jobRef} — ${dryRun ? 'checking' : 'saving'}`);
                const tagIds = resolved.map(r => r.id);
                const res = await updateJob(found.id, description, tagIds, dryRun);
                const addedNames = res.addedTags.map(id => (resolved.find(r => r.id === id) || {}).title || id);

                if (res.nothing) {
                    log('  already has this description and tag(s) — skipped', '#888');
                    stats.nothing++;
                } else if (res.frozen) {
                    log('  frozen — cannot edit, skipped', '#fa0');
                    stats.frozen++;
                    failed.push(`${jobRef} (frozen)`);
                } else {
                    const pre = res.dry ? '  [DRY] would ' : '  ';
                    const col = res.dry ? '#ff0' : '#0fa';
                    if (res.descChange) {
                        log(`${pre}${res.dry ? 'change' : 'changed'} description`, col);
                        log(`      from: "${short(res.curDesc)}"`, '#888');
                        log(`      to:   "${short(description)}"`, '#888');
                    } else if (description != null) {
                        log('  description already matches', '#888');
                    }
                    if (addedNames.length) log(`${pre}${res.dry ? 'add' : 'added'} tag(s): ${addedNames.join(', ')}`, col);
                    else if (resolved.length) log('  tag(s) already present', '#888');

                    if (verify) {
                        showProgress(`${jobRef} — verifying`);
                        const problems = await verifyJob(found.id, res.descChange ? description : null, res.addedTags);
                        if (problems.length) {
                            log(`  ✗ VERIFY FAILED: ${problems.join('; ')}`, '#f55');
                            stats.verifyFail++;
                            failed.push(`${jobRef} (verify: ${problems.join('; ')})`);
                        } else {
                            log('  verified ✓', '#0fa');
                            stats.updated++;
                        }
                    } else {
                        stats.updated++;
                    }
                }
            } catch (e) {
                log(`  ERROR ${e.message}`, '#f55');
                stats.errors++;
                failed.push(`${jobRef} (${e.message})`);
                if (/Logged out/i.test(e.message)) { running = false; }
            }
            showProgress();
        }

        log('');
        log('===== SUMMARY =====', '#0af');
        log(`Jobs processed:   ${curJob}/${total}`, '#0fa');
        log(`${dryRun ? 'Would update:    ' : 'Updated:         '} ${stats.updated}`, '#0fa');
        log(`Already correct:  ${stats.nothing}`, stats.nothing ? '#fa0' : '#888');
        log(`Frozen (skipped): ${stats.frozen}`, stats.frozen ? '#fa0' : '#888');
        log(`Not found:        ${stats.notFound}`, stats.notFound ? '#fa0' : '#888');
        log(`Unknown tags:     ${stats.unknownTag}`, stats.unknownTag ? '#fa0' : '#888');
        if (verify) log(`Verify failed:    ${stats.verifyFail}`, stats.verifyFail ? '#f55' : '#888');
        log(`Errors:           ${stats.errors}`, stats.errors ? '#f55' : '#888');
        if (failed.length) {
            log('');
            log('Needs attention:', '#f55');
            failed.forEach(f => log('  ' + f, '#f99'));
        }
        if (dryRun) log('\nDry run only — untick Dry Run and Start again to apply.', '#ff0');
        setProgress(`Done — ${curJob}/${total} jobs  ·  ${tally()}`);

        running = false;
        startBtn.style.display = 'inline-block';
        stopBtn.style.display = 'none';
        pasteBtn.disabled = false;
    }

    // --- BOOT ---
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createUI);
    } else {
        createUI();
    }
})();
