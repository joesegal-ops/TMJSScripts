// ==UserScript==
// @name         Joblogic - PPM Add Tag to Contract Jobs
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Paste a list of PPM Contract numbers + a tag (e.g. "PM0000848  Statutory"). For every job under that contract (PM0000848/001, /002, …) the script adds the tag via the API, preserving any existing tags. Preview (dry-run) before applying. Collapses into the shared JL dock.
// @match        https://go.joblogic.com/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20PPMs/ppm-add-tag-to-contract-jobs.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20PPMs/ppm-add-tag-to-contract-jobs.user.js
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

    const SCRIPT_ID = 'ppm-add-tag';
    const SCRIPT_LABEL = '🏷 PPM Add Tag to Jobs';
    const SCRIPT_COLOR = '#3d5a2b';
    const SCRIPT_DESC = 'Paste PPM contract numbers + a tag. Finds every job under each contract (PM0000848/001, /002, …) and adds the tag, keeping existing tags. Paste, then Start.';

    // --- CONFIG ---
    const DELAY_BETWEEN_JOBS = 400;   // pause between per-job EditDetail calls
    const DELAY_BETWEEN_SEARCH = 250; // pause between search pages
    const SEARCH_PAGE_SIZE = 200;     // jobs per SearchJsonData page

    // Column header aliases (case-insensitive; underscores normalised to spaces)
    const CONTRACT_HEADERS = ['contract', 'contract no', 'contract no.', 'contract number', 'ppm', 'ppm contract', 'ppm no', 'ppm number', 'pm', 'pm number', 'number', 'ref', 'reference'];
    const TAG_HEADERS = ['tag', 'tags', 'tag name', 'label'];

    // --- STATE ---
    let panel, logArea, startBtn, stopBtn, pasteBtn, progressText, dryCheck;
    let running = false;
    let groups = [];       // [{contract, tags:[...]}]
    let tagMap = null;     // norm(title) -> {id, title}

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const norm = (s) => String(s || '').toLowerCase().trim();
    const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // =======================================================================
    // UI
    // =======================================================================
    function createUI() {
        if (document.getElementById('jl-ppmtag-panel')) return;

        panel = document.createElement('div');
        panel.id = 'jl-ppmtag-panel';

        const container = document.createElement('div');
        container.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;background:#1a1a2e;color:#eee;border-radius:8px;padding:16px;width:600px;max-height:88vh;display:flex;flex-direction:column;font-family:monospace;font-size:12px;box-shadow:0 4px 20px rgba(0,0,0,0.5);';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;';
        const title = document.createElement('strong');
        title.style.fontSize = '14px';
        title.textContent = 'PPM — Add Tag to Contract Jobs';
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

        const dryLabel = document.createElement('label');
        dryLabel.style.cssText = 'cursor:pointer;';
        dryCheck = document.createElement('input');
        dryCheck.type = 'checkbox';
        dryLabel.appendChild(dryCheck);
        dryLabel.appendChild(document.createTextNode(' Dry Run'));

        controlsDiv.appendChild(pasteBtn);
        controlsDiv.appendChild(startBtn);
        controlsDiv.appendChild(stopBtn);
        controlsDiv.appendChild(dryLabel);

        const help = document.createElement('div');
        help.style.cssText = 'font-size:11px;color:#888;margin-bottom:10px;';
        help.textContent = 'Two columns: PPM Contract No, Tag. Header row optional. It finds every job matching <contract>/NNN and adds the tag (existing tags kept).';

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
    // Input parsing → groups of {contract, tags[]}
    // =======================================================================
    function parseInput(text) {
        const rawLines = text.split(/\r?\n|\r/).map(l => l.trim()).filter(Boolean);
        if (!rawLines.length) return { groups: [], error: 'Empty input' };

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

        let conCol = -1, tagCol = -1, dataStart = 0;
        for (let i = 0; i < firstRow.length; i++) {
            if (conCol < 0 && CONTRACT_HEADERS.includes(firstRow[i])) conCol = i;
            if (tagCol < 0 && TAG_HEADERS.includes(firstRow[i])) tagCol = i;
        }
        if (conCol >= 0 && tagCol >= 0) {
            dataStart = 1;
        } else {
            conCol = 0;
            tagCol = 1;
            dataStart = 0;
        }

        // Collect per contract, preserving first-seen order, deduping tags.
        const order = [];
        const map = {}; // upperContract -> {contract, tags:Set}
        for (let i = dataStart; i < allRows.length; i++) {
            const r = allRows[i];
            const contract = (r[conCol] || '').trim().toUpperCase();
            const tag = (r[tagCol] || '').trim();
            if (!contract || !tag) continue;
            if (!map[contract]) { map[contract] = { contract, tags: [] }; order.push(contract); }
            if (!map[contract].tags.some(t => norm(t) === norm(tag))) map[contract].tags.push(tag);
        }
        return { groups: order.map(k => map[k]) };
    }

    // =======================================================================
    // Paste dialog
    // =======================================================================
    function openPasteDialog() {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:100000;display:flex;align-items:center;justify-content:center;';
        overlay.innerHTML = `
            <div style="background:#fff;color:#111;border-radius:8px;width:580px;max-width:94vw;box-shadow:0 10px 40px rgba(0,0,0,.4);overflow:hidden;font-family:system-ui,sans-serif;">
                <div style="padding:12px 16px;background:#111827;color:#f9fafb;font-weight:600;">Paste list — PPM Contract No, Tag</div>
                <div style="padding:14px 16px;">
                    <textarea id="jl-ppmtag-ta" style="width:100%;height:220px;font:13px monospace;padding:8px;border:1px solid #d1d5db;border-radius:4px;box-sizing:border-box;" placeholder="Paste from Google Sheets (tab-separated) or comma CSV:&#10;PM0000848	Statutory&#10;PM0000627	Statutory&#10;PM0000480	Critical"></textarea>
                    <div style="color:#6b7280;font-size:12px;margin-top:6px;">Tab-separated (Google Sheets paste) or comma CSV. Header row optional.</div>
                    <div id="jl-ppmtag-count" style="color:#2563eb;font-size:12px;margin-top:6px;font-weight:600;">0 contracts detected</div>
                    <div style="text-align:right;margin-top:10px;">
                        <button id="jl-ppmtag-cancel" style="background:#9ca3af;color:#fff;border:0;border-radius:4px;padding:7px 14px;cursor:pointer;margin-right:6px;">Cancel</button>
                        <button id="jl-ppmtag-ok" style="background:#2563eb;color:#fff;border:0;border-radius:4px;padding:7px 14px;cursor:pointer;">Load</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        const ta = overlay.querySelector('#jl-ppmtag-ta');
        const countEl = overlay.querySelector('#jl-ppmtag-count');

        ta.addEventListener('input', () => {
            const { groups: g } = parseInput(ta.value);
            countEl.textContent = `${g.length} contract${g.length === 1 ? '' : 's'} detected`;
        });

        overlay.querySelector('#jl-ppmtag-cancel').onclick = () => overlay.remove();
        overlay.querySelector('#jl-ppmtag-ok').onclick = () => {
            const { groups: parsed, error } = parseInput(ta.value);
            overlay.remove();
            if (error || !parsed.length) {
                setProgress('No valid rows found. Check the format.');
                startBtn.disabled = true;
                return;
            }
            groups = parsed;
            logArea.innerHTML = '';
            log(`Loaded ${groups.length} contract${groups.length === 1 ? '' : 's'}:`, '#0af');
            groups.slice(0, 8).forEach(g => log(`  ${g.contract}  →  ${g.tags.join(', ')}`, '#ccc'));
            if (groups.length > 8) log(`  … and ${groups.length - 8} more`, '#888');
            setProgress(`${groups.length} contracts ready. Click Start.`);
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

    // Query the Job tag library. entityType is the STRING "Job"; the endpoint
    // acts as an autocomplete — text='' returns the full list, text=<name>
    // returns matches (useful if the full list is ever capped/empty).
    async function fetchTags(text) {
        const resp = await fetch('/api/Tag/GetTags?entityType=Job&text=' + encodeURIComponent(text || ''), {
            credentials: 'same-origin',
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

    // Build the global tag map (norm(title) -> {id, title}) once.
    async function loadTags() {
        if (tagMap) return tagMap;
        const map = {};
        for (const t of await fetchTags('')) map[norm(t.title)] = t;
        tagMap = map;
        const n = Object.keys(map).length;
        if (n === 0) {
            log('Tag library is EMPTY — this Joblogic company has no Job tags defined.', '#f55');
            log('  Check you are logged into the correct company (top-right company switcher),', '#fa0');
            log('  or create the tag(s) once under Settings → Tags before running.', '#fa0');
        } else {
            log(`Tag library loaded (${n} tags).`, '#0a8');
        }
        return map;
    }

    // Resolve a tag name → {id,title}. Exact, then autocomplete fetch, then fuzzy.
    async function resolveTag(tagName) {
        const key = norm(tagName);
        if (tagMap[key]) return tagMap[key];
        // Autocomplete fallback: ask the server directly for this name.
        try {
            for (const t of await fetchTags(tagName)) {
                tagMap[norm(t.title)] = t;
                if (norm(t.title) === key) return t;
            }
        } catch (e) { /* fall through to fuzzy */ }
        if (tagMap[key]) return tagMap[key];
        // fuzzy contains match as a last resort
        const partial = Object.values(tagMap).find(t => norm(t.title).includes(key) || key.includes(norm(t.title)));
        return partial || null;
    }

    // Page through SearchJsonData for a contract number, returning jobs whose
    // JobNumber matches <contract>/NNN.
    async function findContractJobs(contract) {
        const token = getCsrf();
        // Match <contract>/NNN and also 3-part numbers like <contract>/NNN/NNN
        const re = new RegExp('^' + escapeRe(contract) + '\\/\\d+(?:\\/\\d+)*$', 'i');
        const matches = [];
        let pageIndex = 1, total = null, seen = 0;

        while (true) {
            const resp = await fetch('/api/Job/SearchJsonData', {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                    '__RequestVerificationToken': token
                },
                body: JSON.stringify({
                    SearchTerm: contract,
                    PageSize: SEARCH_PAGE_SIZE, PageIndex: pageIndex,
                    EngineerType: 0,
                    IncludePPMJobs: true, IncludeReactiveJobs: true,
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
            if (total == null) total = ad.TotalCount != null ? ad.TotalCount : jobs.length;

            for (const j of jobs) {
                const num = j.JobNumber || j.ReferenceNumber || '';
                if (re.test(num)) matches.push({ id: j.Id || j.JobId, number: num });
            }

            seen += jobs.length;
            if (!jobs.length || seen >= total || jobs.length < SEARCH_PAGE_SIZE) break;
            pageIndex++;
            await sleep(DELAY_BETWEEN_SEARCH);
        }
        // Dedup by id (search can echo a job across odd paging edges)
        const byId = {};
        matches.forEach(m => { byId[m.id] = m; });
        return Object.values(byId).sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
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

    // POST full form to /api/Job/EditDetail with the merged tag list.
    async function addTagsToJob(internalId, addTagIds, dryRun, _retry = 0) {
        const html = await fetchText('/Job/Detail/' + internalId);
        const job = extractJobState(html, internalId);

        const current = existingTagIds(job);
        const merged = current.slice();
        let added = 0;
        for (const id of addTagIds) {
            if (!merged.includes(String(id))) { merged.push(String(id)); added++; }
        }
        if (added === 0) return { alreadyTagged: true, current };

        if (dryRun) return { dry: true, current, merged };

        const tokenMatch = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
        const csrfToken = tokenMatch ? tokenMatch[1] : '';

        const entries = [];
        const push = (k, v) => entries.push([k, v == null ? '' : String(v)]);

        push('Id', job.Id);
        push('AssignedToUserId', job.AssignedToUserId);
        merged.forEach((id, idx) => push(`TagIds[${idx}]`, id)); // ← the change
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
                return addTagsToJob(internalId, addTagIds, dryRun, _retry + 1);
            }
            throw new Error(`EditDetail HTTP ${resp.status}: ${respText.slice(0, 300)}`);
        }
        let json = {};
        try { json = JSON.parse(respText); } catch (_) {}
        if (json.success === false) throw new Error('EditDetail success=false: ' + (json.Message || respText.slice(0, 200)));
        return { current, merged };
    }

    // =======================================================================
    // Main loop
    // =======================================================================
    async function startProcess() {
        if (running || !groups.length) return;
        running = true;
        startBtn.style.display = 'none';
        stopBtn.style.display = 'inline-block';
        logArea.innerHTML = '';

        const dryRun = dryCheck.checked;
        log(dryRun ? 'DRY RUN — no changes will be made' : 'LIVE MODE — tags will be added', dryRun ? '#ff0' : '#f55');

        const stats = { contracts: 0, jobsFound: 0, tagged: 0, skipped: 0, noJobs: 0, errors: 0 };
        const failed = [];
        const unknownTags = new Set();

        try {
            await loadTags();
        } catch (e) {
            log('Could not load tag library: ' + e.message, '#f55');
            running = false;
            startBtn.style.display = 'inline-block';
            stopBtn.style.display = 'none';
            return;
        }

        outer:
        for (let g = 0; g < groups.length; g++) {
            if (!running) { log('Stopped by user.', '#f55'); break; }
            const { contract, tags } = groups[g];

            // Resolve tag names → ids
            const resolved = [];
            for (const tg of tags) {
                const r = await resolveTag(tg);
                if (!r) {
                    log(`Unknown tag "${tg}" (contract ${contract}) — skipping this tag`, '#f55');
                    if (!unknownTags.has(norm(tg))) {
                        unknownTags.add(norm(tg));
                        const available = Object.values(tagMap).map(t => t.title).sort().join(', ');
                        log(`  Available tags: ${available || '(none)'}`, '#888');
                    }
                    continue;
                }
                resolved.push(r);
            }
            if (!resolved.length) { failed.push(`${contract} (no valid tags)`); continue; }

            const tagLabel = resolved.map(r => r.title).join(', ');
            setProgress(`Contract ${g + 1}/${groups.length}: ${contract}`);
            log('');
            log(`===== ${contract}  →  add tag: ${tagLabel} =====`, '#fff');
            stats.contracts++;

            let jobs;
            try {
                jobs = await findContractJobs(contract);
            } catch (e) {
                log(`  Search failed: ${e.message}`, '#f55');
                stats.errors++;
                failed.push(`${contract} (search: ${e.message})`);
                continue;
            }

            if (!jobs.length) {
                log('  No jobs found for this contract.', '#fa0');
                stats.noJobs++;
                continue;
            }
            log(`  Found ${jobs.length} job${jobs.length === 1 ? '' : 's'}: ${jobs.map(j => j.number).join(', ')}`, '#0af');
            stats.jobsFound += jobs.length;

            const addIds = resolved.map(r => r.id);
            for (let i = 0; i < jobs.length; i++) {
                if (!running) { log('Stopped by user.', '#f55'); break outer; }
                const job = jobs[i];
                setProgress(`${contract} — job ${i + 1}/${jobs.length}: ${job.number}`);
                try {
                    const res = await addTagsToJob(job.id, addIds, dryRun);
                    if (res.alreadyTagged) {
                        log(`    ${job.number}: already tagged — skipped`, '#888');
                        stats.skipped++;
                    } else if (res.dry) {
                        log(`    [DRY] ${job.number}: would set ${res.current.length} → ${res.merged.length} tags`, '#ff0');
                        stats.tagged++;
                    } else {
                        log(`    ${job.number}: tagged ✓`, '#0fa');
                        stats.tagged++;
                    }
                } catch (e) {
                    log(`    ${job.number}: ERROR ${e.message}`, '#f55');
                    stats.errors++;
                    failed.push(`${job.number} (${e.message})`);
                }
                await sleep(DELAY_BETWEEN_JOBS);
            }
        }

        log('');
        log('===== SUMMARY =====', '#0af');
        log(`Contracts processed: ${stats.contracts}`, '#0fa');
        log(`Jobs found:          ${stats.jobsFound}`, '#0fa');
        log(`Tagged:              ${stats.tagged}`, '#0fa');
        log(`Already tagged:      ${stats.skipped}`, stats.skipped ? '#fa0' : '#888');
        log(`Contracts w/ 0 jobs: ${stats.noJobs}`, stats.noJobs ? '#fa0' : '#888');
        log(`Errors:              ${stats.errors}`, stats.errors ? '#f55' : '#888');
        if (failed.length) {
            log('');
            log('Failed:', '#f55');
            failed.forEach(f => log('  ' + f, '#f99'));
        }
        setProgress(`Done. ${stats.tagged} job${stats.tagged === 1 ? '' : 's'} tagged.`);

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
