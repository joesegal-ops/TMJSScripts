// ==UserScript==
// @name         Joblogic - PPM Update Contracts (Tags + Plan Reference)
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Paste a TSV of PPM Contract Number / tag(s) to add / new Plan Reference. Preview shows current vs new; Apply saves each contract through its own Joblogic edit form (opened in a popup) so every other field is preserved, then re-reads the contract to verify. Collapses into the shared JL dock.
// @match        https://go.joblogic.com/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20PPMs/ppm-update-contracts-from-table.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20PPMs/ppm-update-contracts-from-table.user.js
// ==/UserScript==

(function () {
    'use strict';

    // Don't build the panel inside the worker popup this script drives.
    if (window.name === 'jl-ppm-update-worker') return;


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

    const VERSION = '1.0.0';
    const SCRIPT_ID = 'ppm-update-contracts';
    const SCRIPT_LABEL = '🏷️ PPM Update Contracts';
    const SCRIPT_COLOR = '#1f7a5c';
    const SCRIPT_DESC = 'Paste a TSV: PPM Contract Number <tab> tag(s) to add <tab> new Plan Reference. Preview shows current vs new values; Apply saves each contract through its own Joblogic edit form (in a popup window) and re-reads it to verify. Tags are only ADDED (existing tags kept); a blank Plan Reference leaves it unchanged.';

    // Throttle to stay under the Joblogic (Azure) WAF rate limit.
    const DELAY_BETWEEN_CONTRACTS = 1400;
    const PAGE_READY_TIMEOUT = 45000;
    const SAVE_TIMEOUT = 30000;
    const WORKER_NAME = 'jl-ppm-update-worker';

    // --- STATE ---
    let panel, logArea, tsvInput, previewBtn, runBtn, stopBtn, progressText;
    let running = false;
    let plan = null; // [{ number, cid, curTags[], curPlanRef, description, addTags[{Id,Title}], newPlanRef }]

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const normTag = s => String(s || '').replace(/\s+/g, '').toLowerCase();
    const normText = s => String(s == null ? '' : s).replace(/\r\n/g, '\n').trim();
    const splitTags = s => String(s || '').split(',').map(t => t.trim()).filter(Boolean);

    // =======================================================================
    // API helpers
    // =======================================================================
    function getToken(doc = document) {
        const el = doc.querySelector('input[name="__RequestVerificationToken"]');
        return el ? el.value : '';
    }

    async function fetchWithRetry(url, opts, tries = 4) {
        let lastErr = '';
        for (let i = 0; i < tries; i++) {
            try {
                const r = await fetch(url, Object.assign({ credentials: 'same-origin' }, opts));
                if (r.status === 403 || r.status === 429) { // WAF / rate limit
                    lastErr = 'HTTP ' + r.status + ' (rate limited)';
                    await sleep(1200 + i * 1200);
                    continue;
                }
                return r;
            } catch (e) {
                lastErr = e.message || String(e);
                await sleep(700 + i * 700);
            }
        }
        throw new Error(lastErr || 'request failed');
    }

    // Contract number -> the SearchPPMContract row (exact number match, any status), or null.
    // SelectedTab 4 = "All" (1 = Active only).
    async function findContract(number) {
        const r = await fetchWithRetry('/api/PPMContract/SearchPPMContract', {
            method: 'POST',
            headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', '__RequestVerificationToken': getToken() },
            body: new URLSearchParams({ SearchTerm: number, PageNumber: 1, PageIndex: 1, PageSize: 50, SelectedTab: 4, IncludeCompleted: true, IncludeCancelled: true }).toString()
        });
        const d = await r.json().catch(() => null);
        const list = (d && d.AdditionalData && d.AdditionalData.PPMContracts) || [];
        return list.find(c => String(c.PPMContractNumber || '').toUpperCase() === number.toUpperCase()) || null;
    }

    // All PPM tags: [{Id, Title}]
    async function getPpmTags() {
        const r = await fetchWithRetry('/api/Tag/GetTags?entityType=PPM', { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        const j = await r.json().catch(() => []);
        return Array.isArray(j) ? j : [];
    }

    // =======================================================================
    // Worker popup: drive the real contract detail page so the save is byte-for-byte what the UI sends
    // (Description, selling rates, currency etc. are only populated by the page's own scripts —
    // rebuilding the form from raw HTML would blank them). Iframes are refused (X-Frame-Options).
    // =======================================================================
    async function waitForDetailPage(win, cid) {
        const t0 = Date.now();
        while (Date.now() - t0 < PAGE_READY_TIMEOUT) {
            if (!running) throw new Error('stopped');
            if (win.closed) throw new Error('worker window was closed');
            try {
                if (win.location.pathname.toLowerCase().indexOf(cid.toLowerCase()) >= 0 && win.document.readyState === 'complete' && win.$) {
                    const form = win.$('#editDetail');
                    const ms = win.$('#Job_TagIds').data('kendoMultiSelect');
                    const names = form.length ? form.serializeArray().map(x => x.name) : [];
                    // 'Labour' etc. are rendered by a Vue component after load — wait for them so they are not posted blank.
                    if (form.length && ms && form.find('.jlMakeEditAble-Edit').length && typeof win.serializeForm === 'function' &&
                        win.$('#PlanReference').length && names.indexOf('Labour') >= 0) {
                        return { form, ms };
                    }
                }
            } catch (e) { /* mid-navigation: cross-document access can throw briefly */ }
            await sleep(300);
        }
        throw new Error('contract page did not finish loading');
    }

    async function applyToContract(win, item) {
        win.location.href = '/PPMContract/Detail/' + item.cid;
        await sleep(1200);
        const { form, ms } = await waitForDetailPage(win, item.cid);
        await sleep(800); // let late Vue/Kendo bindings settle

        // Open edit mode exactly as the page's own Save does.
        const panelOpen = (() => { const e = form.find('#savePanel'); return !e.length || e.hasClass('open'); })();
        if (!panelOpen) form.find('.jlMakeEditAble-Edit').trigger('click');
        await sleep(600);

        // Tags: add to the existing selection (never remove).
        if (item.addTags.length) {
            await ms.dataSource.read();
            const ids = ms.value().slice();
            for (const t of item.addTags) {
                if (!ms.dataSource.data().some(x => x.Id === t.Id)) throw new Error('tag "' + t.Title + '" not offered by the contract tag picker');
                if (ids.indexOf(t.Id) < 0) ids.push(t.Id);
            }
            ms.value(ids);
            ms.trigger('change');
        }

        // Plan Reference
        if (item.newPlanRef) {
            const el = win.$('#PlanReference')[0];
            const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set;
            setter.call(el, item.newPlanRef);
            el.dispatchEvent(new win.Event('input', { bubbles: true }));
            el.dispatchEvent(new win.Event('change', { bubbles: true }));
        }

        const params = win.serializeForm(form);

        // Safety checks before posting anything.
        if (String(params.Id || '').toLowerCase() !== item.cid.toLowerCase()) throw new Error('form Id ' + params.Id + ' != contract — not saved');
        if (normText(params.Description) !== normText(item.description)) throw new Error('Description in form does not match the contract (page not fully loaded?) — not saved');
        const sentTags = [].concat(params.TagIds || []);
        for (const t of item.addTags) if (sentTags.indexOf(t.Id) < 0) throw new Error('tag "' + t.Title + '" missing from form data — not saved');
        if (item.newPlanRef && params.PlanReference !== item.newPlanRef) throw new Error('Plan Reference did not take in the form — not saved');

        // POST /api/PPMContract/EditDetail with the page's own service + options (same call as its Save button).
        const svc = win.eval('JL_SERVICES');
        const resp = await new Promise((resolve, reject) => {
            const to = setTimeout(() => reject(new Error('save timed out (check the popup for a Joblogic error)')), SAVE_TIMEOUT);
            svc.post({
                url: win.canonicalize('/api/PPMContract/EditDetail'),
                params,
                options: { isBodyData: true, isJsonToFormData: true, isAjaxFormPostWithCallback: true },
                success: e => { clearTimeout(to); resolve(e); }
            });
        });
        if (resp && resp.success === false) throw new Error('Joblogic rejected the save: ' + (resp.Message || JSON.stringify(resp.errors || resp).slice(0, 200)));

        // Verify by re-reading (Joblogic can return success and silently not save).
        await sleep(800);
        const after = await findContract(item.number);
        if (!after) throw new Error('saved, but could not re-read the contract to verify');
        const afterTags = splitTags(after.Tags).map(normTag);
        const missing = item.addTags.filter(t => afterTags.indexOf(normTag(t.Title)) < 0).map(t => t.Title);
        if (missing.length) throw new Error('save returned OK but tag(s) not on contract: ' + missing.join(', '));
        if (item.newPlanRef && normText(after.PlanReference) !== normText(item.newPlanRef)) throw new Error('save returned OK but Plan Reference is "' + after.PlanReference + '"');
        if (normText(after.Description) !== normText(item.description)) throw new Error('WARNING: Description changed after save — check this contract');
        return after;
    }

    // =======================================================================
    // UI
    // =======================================================================
    function createUI() {
        if (document.getElementById('jl-ppmupd-panel')) return;

        panel = document.createElement('div');
        panel.id = 'jl-ppmupd-panel';
        const c = document.createElement('div');
        c.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;background:#1a1a2e;color:#eee;border-radius:8px;padding:16px;width:600px;max-height:88vh;display:flex;flex-direction:column;font-family:monospace;font-size:12px;box-shadow:0 4px 20px rgba(0,0,0,0.5);';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;';
        const title = document.createElement('strong');
        title.style.fontSize = '14px';
        title.innerHTML = 'PPM Update Contracts <span style="font-weight:400;color:#8a8ab5;font-size:11px;">v' + VERSION + '</span>';
        const closeBtn = document.createElement('button');
        closeBtn.style.cssText = 'background:none;border:none;color:#eee;font-size:18px;cursor:pointer;';
        closeBtn.textContent = '✕';
        closeBtn.addEventListener('click', () => { panel.style.display = 'none'; });
        header.appendChild(title); header.appendChild(closeBtn);

        const rules = document.createElement('div');
        rules.style.cssText = 'background:#12261f;border-left:3px solid #1f7a5c;border-radius:4px;padding:8px 10px;margin-bottom:8px;line-height:1.5;color:#c9e6da;';
        rules.innerHTML = 'Columns (tab-separated, paste from Sheets/Excel): <b>PPM Contract Number</b> · <b>Tag(s) to add</b> · <b>Plan Reference</b><br>' +
            '• Tags are <b>added</b> — existing tags are kept. Several tags: separate with commas. Tags must already exist in Joblogic.<br>' +
            '• Blank Plan Reference = leave unchanged. A header row is ignored.<br>' +
            '• Apply opens a <b>popup window</b> and saves each contract through its own edit form (allow popups for go.joblogic.com). Don\'t close it while running.';

        const lbl = document.createElement('div');
        lbl.style.cssText = 'color:#aaa;margin-bottom:4px;';
        lbl.textContent = 'TSV rows:';

        tsvInput = document.createElement('textarea');
        tsvInput.rows = 7;
        tsvInput.placeholder = 'PM0001702\tStatutoryPPM\tUpdated reference\nPM0001703\tStatutoryPPM, Critical\t\nPM0001704\t\tNew plan ref only';
        tsvInput.style.cssText = 'width:100%;box-sizing:border-box;background:#0a0a1a;color:#eee;border:1px solid #555;border-radius:4px;padding:8px;font-family:monospace;font-size:12px;resize:vertical;margin-bottom:8px;white-space:pre;';
        tsvInput.addEventListener('keydown', e => { // allow typing a literal tab
            if (e.key === 'Tab') { e.preventDefault(); const s = tsvInput.selectionStart; tsvInput.setRangeText('\t', s, tsvInput.selectionEnd, 'end'); }
        });

        const controls = document.createElement('div');
        controls.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap;';
        previewBtn = mkBtn('Preview (dry run)', '#08a');
        previewBtn.addEventListener('click', () => preview());
        runBtn = mkBtn('Apply changes', '#1f7a5c');
        runBtn.disabled = true; runBtn.style.opacity = '0.5';
        runBtn.addEventListener('click', () => confirmAndApply());
        stopBtn = mkBtn('Stop', '#a22');
        stopBtn.style.display = 'none';
        stopBtn.addEventListener('click', () => { running = false; });
        controls.appendChild(previewBtn); controls.appendChild(runBtn); controls.appendChild(stopBtn);

        const progressDiv = document.createElement('div');
        progressDiv.style.marginBottom = '6px';
        progressText = document.createElement('span');
        progressText.style.color = '#0fa';
        progressText.textContent = 'Paste rows, then Preview.';
        progressDiv.appendChild(progressText);

        logArea = document.createElement('div');
        logArea.style.cssText = 'flex:1;overflow:auto;background:#0a0a1a;padding:8px;border-radius:4px;max-height:50vh;white-space:pre-wrap;word-break:break-word;';

        [header, rules, lbl, tsvInput, controls, progressDiv, logArea].forEach(x => c.appendChild(x));
        panel.appendChild(c);
        document.body.appendChild(panel);
        jlRegisterPanel(panel, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR, SCRIPT_DESC);
    }

    function mkBtn(text, bg) {
        const b = document.createElement('button');
        b.textContent = text;
        b.style.cssText = 'background:' + bg + ';color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;font-family:monospace;font-size:12px;';
        return b;
    }
    function log(msg, color) {
        const line = document.createElement('div');
        line.style.color = color || '#ccc';
        line.textContent = msg;
        logArea.appendChild(line);
        logArea.scrollTop = logArea.scrollHeight;
    }
    const setProgress = (m) => { progressText.textContent = m; };
    function setBusy(busy) {
        running = busy;
        previewBtn.disabled = busy; previewBtn.style.opacity = busy ? '0.5' : '1';
        if (busy) { runBtn.disabled = true; runBtn.style.opacity = '0.5'; }
        stopBtn.style.display = busy ? 'inline-block' : 'none';
    }

    // TSV -> [{ line, number, tags[], planRef }] (rows without a PM number are skipped, e.g. a header)
    function parseTsv(text) {
        const rows = [], seen = new Map();
        text.split(/\r?\n/).forEach((raw, i) => {
            if (!raw.trim()) return;
            const cols = raw.split('\t');
            const m = String(cols[0] || '').match(/PM\s*\d+/i);
            if (!m) return;
            const number = m[0].replace(/\s+/g, '').toUpperCase();
            const row = { line: i + 1, number, tags: splitTags(cols[1]), planRef: String(cols[2] || '').trim() };
            if (seen.has(number)) { // merge duplicates: union of tags, last non-blank plan ref wins
                const prev = seen.get(number);
                row.tags.forEach(t => { if (!prev.tags.some(p => normTag(p) === normTag(t))) prev.tags.push(t); });
                if (row.planRef) prev.planRef = row.planRef;
                return;
            }
            seen.set(number, row);
            rows.push(row);
        });
        return rows;
    }

    // =======================================================================
    // Main — preview
    // =======================================================================
    async function preview() {
        if (running) return;
        const rows = parseTsv(tsvInput.value);
        if (!rows.length) { alert('Paste at least one row starting with a PM contract number.'); return; }

        setBusy(true);
        logArea.innerHTML = '';
        plan = null;
        log('=== PREVIEW (dry run) — nothing will be changed ===', '#ff0');
        log(rows.length + ' contract(s)', '#0af');
        log('');

        let tags;
        try { tags = await getPpmTags(); }
        catch (e) { log('✗ Could not load the PPM tag list: ' + e.message, '#f55'); setBusy(false); return; }
        const tagByNorm = new Map(tags.map(t => [normTag(t.Title), t]));

        const built = [];
        const stats = { change: 0, noop: 0, errors: 0 };
        for (let i = 0; i < rows.length; i++) {
            if (!running) { log('Stopped by user.', '#f55'); break; }
            const row = rows[i];
            setProgress('Checking ' + (i + 1) + '/' + rows.length + ': ' + row.number);

            const unknown = row.tags.filter(t => !tagByNorm.has(normTag(t)));
            if (unknown.length) { log('✗ ' + row.number + ' — tag(s) not found in Joblogic PPM tags: ' + unknown.join(', '), '#f55'); stats.errors++; continue; }

            let c;
            try { c = await findContract(row.number); }
            catch (e) { log('✗ ' + row.number + ' — lookup failed: ' + e.message, '#f55'); stats.errors++; continue; }
            if (!c) { log('✗ ' + row.number + ' — no PPM contract with that number.', '#f55'); stats.errors++; continue; }

            const curTags = splitTags(c.Tags);
            const addTags = row.tags.map(t => tagByNorm.get(normTag(t))).filter(t => !curTags.some(ct => normTag(ct) === normTag(t.Title)));
            const newPlanRef = row.planRef && normText(row.planRef) !== normText(c.PlanReference) ? row.planRef : '';

            log('▸ ' + c.PPMContractNumber + '  · ' + (c.SiteName || '') + (c.IsCancelled ? '  [cancelled]' : ''), '#fff');
            log('    Tags:     ' + (curTags.join(', ') || '(none)') + (addTags.length ? '   + ' + addTags.map(t => t.Title).join(', ') : '   (no tags to add)'), addTags.length ? '#9f9' : '#888');
            log('    Plan ref: ' + (c.PlanReference || '(blank)') + (newPlanRef ? '   → ' + newPlanRef : '   (unchanged)'), newPlanRef ? '#9f9' : '#888');

            if (!addTags.length && !newPlanRef) { stats.noop++; log('    nothing to change', '#888'); }
            else {
                stats.change++;
                built.push({ number: c.PPMContractNumber, cid: c.UniqueId, curTags, curPlanRef: c.PlanReference, description: c.Description, addTags, newPlanRef });
            }
            await sleep(400);
        }

        log('');
        log('===== PREVIEW SUMMARY =====', '#0af');
        log('To update: ' + stats.change, stats.change ? '#9f9' : '#888');
        log('Already up to date: ' + stats.noop, '#888');
        log('Errors: ' + stats.errors, stats.errors ? '#f55' : '#888');

        setBusy(false);
        if (built.length) {
            plan = built;
            runBtn.disabled = false; runBtn.style.opacity = '1';
            setProgress('Preview ready — ' + built.length + ' contract(s) to update. Review, then "Apply changes".');
        } else setProgress('Nothing to change.');
    }

    // =======================================================================
    // Main — apply (only from a computed preview plan)
    // =======================================================================
    function confirmAndApply() {
        if (!plan || !plan.length) { alert('Run Preview first.'); return; }
        if (!confirm('Update ' + plan.length + ' PPM contract(s)?\n\nA popup window will open and step through each contract. Keep it open until finished.')) return;
        // Open the worker synchronously inside the click so the popup blocker allows it.
        const win = window.open('about:blank', WORKER_NAME, 'width=1200,height=850');
        if (!win) { alert('The popup was blocked. Allow popups for go.joblogic.com and click Apply again.'); return; }
        applyPlan(win);
    }

    async function applyPlan(win) {
        setBusy(true);
        logArea.innerHTML = '';
        log('=== APPLYING ===', '#9f9');
        log('');
        const stats = { ok: 0, errors: 0 };

        for (let i = 0; i < plan.length; i++) {
            if (!running) { log('Stopped by user.', '#f55'); break; }
            const item = plan[i];
            setProgress('Updating ' + (i + 1) + '/' + plan.length + ': ' + item.number);
            try {
                const after = await applyToContract(win, item);
                log('✓ ' + item.number + '  tags: ' + (after.Tags || '(none)') + (item.newPlanRef ? '  · plan ref: ' + after.PlanReference : ''), '#0fa');
                stats.ok++;
            } catch (e) {
                log('✗ ' + item.number + ' — ' + (e.message || e), '#f55');
                stats.errors++;
            }
            await sleep(DELAY_BETWEEN_CONTRACTS);
        }
        try { if (!win.closed) win.close(); } catch (e) {}

        log('');
        log('===== SUMMARY =====', '#0af');
        log('Updated (verified): ' + stats.ok, stats.ok ? '#0fa' : '#888');
        log('Errors: ' + stats.errors, stats.errors ? '#f55' : '#888');
        setProgress('Done. Updated ' + stats.ok + ', errors ' + stats.errors + '.');
        plan = null; // force a fresh Preview before another run
        setBusy(false);
    }

    // --- BOOT ---
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', createUI);
    else createUI();
})();
