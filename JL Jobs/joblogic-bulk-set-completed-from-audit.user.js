// ==UserScript==
// @name         Joblogic - Bulk Set Completed Date from Status Audit
// @namespace    http://tampermonkey.net/
// @version      1.7
// @description  Paste a list of Job IDs. For each, look up the Status Audit log, find when status changed to "Completed", and write that date into DateComplete. Jobs with no Completed entry are queued so you can revert them all to New Job in one click. v1.1: collapses to a launcher button in the shared dock (drag to reorder).
// @match        https://go.joblogic.com/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/joblogic-bulk-set-completed-from-audit.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/joblogic-bulk-set-completed-from-audit.user.js
// ==/UserScript==

(function () {
    'use strict';

    // ===== Shared JL userscript launcher dock (identical in every script) =====
    const JL_DOCK_ID = 'jl-userscript-dock', JL_ORDER_KEY = 'jl-userscript-dock-order', JL_MIN_KEY = 'jl-userscript-dock-min', JL_TOP_KEY = 'jl-userscript-dock-top';
    const JL_BTN_CSS = 'color:#fff;padding:7px 13px;border-radius:4px;border:1px solid transparent;cursor:grab;font-family:"Open Sans",sans-serif;font-size:12px;box-shadow:0 1px 3px rgba(0,0,0,.25);white-space:nowrap;';
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
        jlSetDockMin(localStorage.getItem(JL_MIN_KEY) !== '0');
        return d;
    }
    function jlDockButton(id, label, color, onClick) {
        jlGetDock();
        const l = jlDockList();
        let b = document.getElementById('jl-launch-' + id);
        if (b) return b;
        const bg = color || '#072d3d';
        b = document.createElement('button');
        b.id = 'jl-launch-' + id;
        b.dataset.scriptId = id;
        b.textContent = label;
        b.title = 'Show / hide ' + label + '  (drag to reorder)';
        b.draggable = true;
        b.style.cssText = JL_BTN_CSS + 'background:' + bg + ';border-color:' + bg + ';';
        b.addEventListener('click', () => { if (b.dataset.justDragged) { delete b.dataset.justDragged; return; } onClick(); });
        b.addEventListener('dragstart', () => { b.classList.add('jl-dragging'); b.style.opacity = '0.4'; });
        b.addEventListener('dragend', () => { b.classList.remove('jl-dragging'); b.style.opacity = '1'; b.dataset.justDragged = '1'; setTimeout(() => { delete b.dataset.justDragged; }, 60); jlSaveOrder(); });
        l.appendChild(b);
        jlApplyOrder();
        return b;
    }
    // Collapse a panel to a dock button. panelEl = the OUTERMOST element of the
    // script's floating UI. Returns the dock button.
    function jlRegisterPanel(panelEl, id, label, color) {
        const shown = (panelEl.style.display && panelEl.style.display !== 'none') ? panelEl.style.display : 'block';
        panelEl.style.display = 'none';
        const btn = jlDockButton(id, label, color, () => {
            const opening = panelEl.style.display === 'none';
            panelEl.style.display = opening ? shown : 'none';
            btn.style.boxShadow = opening ? '0 0 0 2px #fff, 0 1px 3px rgba(0,0,0,.25)' : '0 1px 3px rgba(0,0,0,.25)';
        });
        return btn;
    }
    // ===== end shared dock =====

    const SCRIPT_ID = 'completed-from-audit';
    const SCRIPT_LABEL = '📅 Completed from Audit';
    const SCRIPT_COLOR = '#072d3d';

    // --- CONFIG ---
    const DELAY_BETWEEN_JOBS = 400;
    const STATUS_ID_NEW_JOB = 'N';
    const STATUS_ID_COMPLETED = 'Y';
    const HEADER_WORDS_ID = ['job id', 'job no', 'job no.', 'jobid', 'job number', 'id', 'ref', 'reference', 'job ref', 'job reference'];

    // --- STATE ---
    let panel, logArea, startBtn, stopBtn, pasteBtn, revertBtn, pasteRevertBtn, clearRevertBtn, progressText, dryCheck;
    let running = false;
    let rows = [];                  // [{ ref }]
    let noCompletionList = [];      // [{ ref, internalId }]

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    // =======================================================================
    // UI
    // =======================================================================
    function createUI() {
        if (document.getElementById('jl-auditdate-panel')) return;

        panel = document.createElement('div');
        panel.id = 'jl-auditdate-panel';
        const container = document.createElement('div');
        container.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;background:#1a1a2e;color:#eee;border-radius:8px;padding:16px;width:600px;max-height:88vh;display:flex;flex-direction:column;font-family:monospace;font-size:12px;box-shadow:0 4px 20px rgba(0,0,0,0.5);';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;';
        const title = document.createElement('strong');
        title.style.fontSize = '14px';
        title.textContent = 'Set Completed Date from Status Audit';
        const closeBtn = document.createElement('button');
        closeBtn.style.cssText = 'background:none;border:none;color:#eee;font-size:18px;cursor:pointer;';
        closeBtn.textContent = 'X';
        closeBtn.addEventListener('click', () => { panel.style.display = 'none'; });
        header.appendChild(title);
        header.appendChild(closeBtn);

        const progressDiv = document.createElement('div');
        progressDiv.style.marginBottom = '10px';
        progressText = document.createElement('span');
        progressText.style.color = '#0fa';
        progressText.textContent = 'Paste Job IDs to begin.';
        progressDiv.appendChild(progressText);

        const controlsDiv = document.createElement('div');
        controlsDiv.style.marginBottom = '10px';

        pasteBtn = document.createElement('button');
        pasteBtn.style.cssText = 'background:#08a;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;margin-right:8px;';
        pasteBtn.textContent = 'Paste Job IDs';
        pasteBtn.addEventListener('click', openPasteDialog);

        startBtn = document.createElement('button');
        startBtn.style.cssText = 'background:#0a8;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;margin-right:8px;';
        startBtn.textContent = 'Start';
        startBtn.disabled = true;
        startBtn.addEventListener('click', startProcess);

        stopBtn = document.createElement('button');
        stopBtn.style.cssText = 'background:#a22;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;display:none;';
        stopBtn.textContent = 'Stop';
        stopBtn.addEventListener('click', () => { running = false; });

        revertBtn = document.createElement('button');
        revertBtn.style.cssText = 'background:#a60;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;margin-left:8px;display:none;';
        revertBtn.textContent = 'Revert "no-completion" jobs to New Job';
        revertBtn.addEventListener('click', revertNoCompletionJobs);

        pasteRevertBtn = document.createElement('button');
        pasteRevertBtn.style.cssText = 'background:#558;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;margin-left:8px;';
        pasteRevertBtn.textContent = 'Paste revert list';
        pasteRevertBtn.addEventListener('click', openRevertPasteDialog);

        clearRevertBtn = document.createElement('button');
        clearRevertBtn.style.cssText = 'background:#444;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;margin-left:8px;display:none;';
        clearRevertBtn.textContent = 'Clear revert queue';
        clearRevertBtn.addEventListener('click', () => {
            const n = noCompletionList.length;
            noCompletionList = [];
            revertBtn.style.display = 'none';
            clearRevertBtn.style.display = 'none';
            log(`Cleared revert queue (${n} job${n === 1 ? '' : 's'} removed).`, '#888');
            setProgress(`Revert queue cleared.`);
        });

        const dryLabel = document.createElement('label');
        dryLabel.style.cssText = 'margin-left:8px;cursor:pointer;';
        dryCheck = document.createElement('input');
        dryCheck.type = 'checkbox';
        dryCheck.id = 'jl-auditdate-dryrun';
        dryLabel.appendChild(dryCheck);
        dryLabel.appendChild(document.createTextNode(' Dry Run (log only, no changes)'));

        controlsDiv.appendChild(pasteBtn);
        controlsDiv.appendChild(startBtn);
        controlsDiv.appendChild(stopBtn);
        controlsDiv.appendChild(dryLabel);
        controlsDiv.appendChild(revertBtn);
        controlsDiv.appendChild(pasteRevertBtn);
        controlsDiv.appendChild(clearRevertBtn);

        logArea = document.createElement('div');
        logArea.style.cssText = 'flex:1;overflow-y:auto;background:#0a0a1a;padding:8px;border-radius:4px;max-height:60vh;';

        container.appendChild(header);
        container.appendChild(progressDiv);
        container.appendChild(controlsDiv);
        container.appendChild(logArea);
        panel.appendChild(container);
        document.body.appendChild(panel);

        jlRegisterPanel(panel, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR);
    }

    function showRevertButtons() {
        revertBtn.textContent = `Revert ${noCompletionList.length} job${noCompletionList.length === 1 ? '' : 's'} to New Job`;
        revertBtn.style.display = 'inline-block';
        clearRevertBtn.style.display = 'inline-block';
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
    // Input parsing — accepts CSV, tab-separated, or one-per-line job IDs.
    // First column only is used; header row optional.
    // =======================================================================
    function splitFirstCol(line) {
        if (line.includes('\t')) return line.split('\t')[0].trim();
        if (line.includes(',')) {
            // respect quoted commas
            let cur = '', inQ = false;
            for (let i = 0; i < line.length; i++) {
                const c = line[i];
                if (c === '"') { inQ = !inQ; continue; }
                if (c === ',' && !inQ) return cur.trim().replace(/^"|"$/g, '');
                cur += c;
            }
            return cur.trim().replace(/^"|"$/g, '');
        }
        return line.trim();
    }

    function parseInput(text) {
        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (!lines.length) return [];
        const firstFirstCol = splitFirstCol(lines[0]).toLowerCase();
        const startIdx = HEADER_WORDS_ID.includes(firstFirstCol) ? 1 : 0;
        const out = [];
        for (let i = startIdx; i < lines.length; i++) {
            const ref = splitFirstCol(lines[i]);
            if (ref) out.push({ ref });
        }
        return out;
    }

    function openPasteDialog() {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:100000;display:flex;align-items:center;justify-content:center;';
        overlay.innerHTML = `
            <div style="background:#fff;color:#111;border-radius:8px;width:560px;max-width:92vw;box-shadow:0 10px 40px rgba(0,0,0,.4);overflow:hidden;font-family:system-ui,sans-serif;">
                <div style="padding:12px 16px;background:#111827;color:#f9fafb;font-weight:600;">Paste Job IDs (one per line)</div>
                <div style="padding:14px 16px;">
                    <textarea id="jl-paste-ta" style="width:100%;height:220px;font:13px monospace;padding:8px;border:1px solid #d1d5db;border-radius:4px;box-sizing:border-box;" placeholder="One Job ID per line. First column of CSV/TSV is also accepted.&#10;&#10;Example:&#10;M0000010&#10;M0000011&#10;PM0000120/008"></textarea>
                    <div style="color:#6b7280;font-size:12px;margin-top:6px;">Header row optional. Other columns ignored.</div>
                    <div id="jl-paste-count" style="color:#2563eb;font-size:12px;margin-top:6px;font-weight:600;">0 rows detected</div>
                    <div id="jl-paste-preview" style="color:#374151;font-size:11px;margin-top:6px;max-height:100px;overflow-y:auto;font-family:monospace;"></div>
                    <div style="text-align:right;margin-top:10px;">
                        <button id="jl-paste-cancel" style="background:#9ca3af;color:#fff;border:0;border-radius:4px;padding:7px 14px;cursor:pointer;margin-right:6px;">Cancel</button>
                        <button id="jl-paste-ok" style="background:#2563eb;color:#fff;border:0;border-radius:4px;padding:7px 14px;cursor:pointer;">Load</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        const ta = overlay.querySelector('#jl-paste-ta');
        const count = overlay.querySelector('#jl-paste-count');
        const preview = overlay.querySelector('#jl-paste-preview');

        const refreshPreview = () => {
            const parsed = parseInput(ta.value);
            count.textContent = `${parsed.length} row${parsed.length === 1 ? '' : 's'} detected`;
            preview.innerHTML = parsed.slice(0, 8).map(r => `<div>${r.ref}</div>`).join('') +
                (parsed.length > 8 ? `<div style="color:#9ca3af;">...and ${parsed.length - 8} more</div>` : '');
        };
        ta.addEventListener('input', refreshPreview);
        overlay.querySelector('#jl-paste-cancel').onclick = () => overlay.remove();
        overlay.querySelector('#jl-paste-ok').onclick = () => {
            const parsed = parseInput(ta.value);
            rows = parsed;
            overlay.remove();
            if (rows.length) {
                log(`Loaded ${rows.length} job IDs.`, '#0af');
                setProgress(`${rows.length} jobs ready. Click Start.`);
                startBtn.disabled = false;
                noCompletionList = [];
                revertBtn.style.display = 'none';
            } else {
                setProgress('No valid rows found.');
                startBtn.disabled = true;
            }
        };
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        setTimeout(() => ta.focus(), 50);
    }

    // =======================================================================
    // Paste-to-revert dialog — manually populate the revert queue.
    // Resolves each pasted Job ID -> internalId via Search, then shows the
    // revert button. Replaces any existing queue.
    // =======================================================================
    function openRevertPasteDialog() {
        if (running) { alert('Wait for current run to finish first.'); return; }
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:100000;display:flex;align-items:center;justify-content:center;';
        overlay.innerHTML = `
            <div style="background:#fff;color:#111;border-radius:8px;width:560px;max-width:92vw;box-shadow:0 10px 40px rgba(0,0,0,.4);overflow:hidden;font-family:system-ui,sans-serif;">
                <div style="padding:12px 16px;background:#7c2d12;color:#fff;font-weight:600;">Paste Job IDs to revert to New Job</div>
                <div style="padding:14px 16px;">
                    <textarea id="jl-revert-ta" style="width:100%;height:220px;font:13px monospace;padding:8px;border:1px solid #d1d5db;border-radius:4px;box-sizing:border-box;" placeholder="One Job ID per line. First column of CSV/TSV is also accepted.&#10;&#10;Example:&#10;RE0006830&#10;RE0008185&#10;M0000010"></textarea>
                    <div style="color:#6b7280;font-size:12px;margin-top:6px;">This replaces the current revert queue. Each ID will be resolved to its internal ID before reverting.</div>
                    <div id="jl-revert-count" style="color:#7c2d12;font-size:12px;margin-top:6px;font-weight:600;">0 rows detected</div>
                    <div id="jl-revert-preview" style="color:#374151;font-size:11px;margin-top:6px;max-height:100px;overflow-y:auto;font-family:monospace;"></div>
                    <div style="text-align:right;margin-top:10px;">
                        <button id="jl-revert-cancel" style="background:#9ca3af;color:#fff;border:0;border-radius:4px;padding:7px 14px;cursor:pointer;margin-right:6px;">Cancel</button>
                        <button id="jl-revert-ok" style="background:#7c2d12;color:#fff;border:0;border-radius:4px;padding:7px 14px;cursor:pointer;">Resolve & queue</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        const ta = overlay.querySelector('#jl-revert-ta');
        const count = overlay.querySelector('#jl-revert-count');
        const preview = overlay.querySelector('#jl-revert-preview');

        const refreshPreview = () => {
            const parsed = parseInput(ta.value);
            count.textContent = `${parsed.length} row${parsed.length === 1 ? '' : 's'} detected`;
            preview.innerHTML = parsed.slice(0, 8).map(r => `<div>${r.ref}</div>`).join('') +
                (parsed.length > 8 ? `<div style="color:#9ca3af;">...and ${parsed.length - 8} more</div>` : '');
        };
        ta.addEventListener('input', refreshPreview);
        overlay.querySelector('#jl-revert-cancel').onclick = () => overlay.remove();
        overlay.querySelector('#jl-revert-ok').onclick = async () => {
            const parsed = parseInput(ta.value);
            if (!parsed.length) { setProgress('No valid rows.'); overlay.remove(); return; }
            overlay.remove();
            await resolveRevertList(parsed);
        };
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        setTimeout(() => ta.focus(), 50);
    }

    async function resolveRevertList(refs) {
        running = true;
        startBtn.style.display = 'none';
        stopBtn.style.display = 'inline-block';
        revertBtn.style.display = 'none';
        clearRevertBtn.style.display = 'none';

        log('');
        log(`===== RESOLVING ${refs.length} JOB ID${refs.length === 1 ? '' : 'S'} FOR REVERT =====`, '#88f');
        const resolved = [];
        const notFound = [];
        for (let i = 0; i < refs.length; i++) {
            if (!running) { log('Stopped by user.', '#f55'); break; }
            const { ref } = refs[i];
            setProgress(`Resolving ${i + 1}/${refs.length}: ${ref}`);
            try {
                const job = await searchJob(ref);
                if (!job) {
                    log(`  ${ref} -> NOT FOUND`, '#f55');
                    notFound.push(ref);
                } else {
                    log(`  ${ref} -> id=${job.id} (status=${job.statusDescription})`, '#0af');
                    resolved.push({ ref, internalId: job.id });
                }
            } catch (e) {
                log(`  ${ref} -> ERROR: ${e.message}`, '#f55');
                notFound.push(ref);
            }
            await sleep(DELAY_BETWEEN_JOBS);
        }

        noCompletionList = resolved;
        log('');
        log(`Resolved ${resolved.length}/${refs.length}. ${notFound.length} not found.`,
            notFound.length ? '#fa0' : '#0fa');
        if (notFound.length) log('Not found: ' + notFound.join(', '), '#fa0');
        if (resolved.length) {
            showRevertButtons();
            setProgress(`${resolved.length} job${resolved.length === 1 ? '' : 's'} ready to revert.`);
        } else {
            setProgress('Nothing to revert.');
        }

        running = false;
        startBtn.style.display = 'inline-block';
        stopBtn.style.display = 'none';
    }

    // =======================================================================
    // API helpers
    // =======================================================================
    // Token cache — Joblogic's anti-forgery token rotates after a number of
    // requests. We refresh it from a GET (which always returns a fresh token
    // in the HTML) whenever a POST returns 400/403.
    let cachedToken = null;
    function readTokenFromHtml(html) {
        const m = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
        return m ? m[1] : '';
    }
    function getCachedTokenSync() {
        if (cachedToken) return cachedToken;
        const el = document.querySelector('input[name="__RequestVerificationToken"]');
        return el ? el.value : '';
    }
    async function refreshToken() {
        // GET the current page URL — guaranteed to be a valid auth'd page that
        // renders the form token. Fall back to "/" if for some reason that 404s.
        const candidates = [location.pathname + location.search, '/'];
        for (const url of candidates) {
            try {
                const resp = await fetch(url, { credentials: 'same-origin' });
                if (!resp.ok) continue;
                const html = await resp.text();
                const tok = readTokenFromHtml(html);
                if (tok) { cachedToken = tok; return cachedToken; }
            } catch (e) {}
        }
        return cachedToken;
    }

    async function fetchText(url) {
        const resp = await fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        if (!resp.ok) throw new Error('HTTP ' + resp.status + ' on ' + url);
        const html = await resp.text();
        // Opportunistically refresh token from any HTML response that includes it.
        const tok = readTokenFromHtml(html);
        if (tok) cachedToken = tok;
        return html;
    }

    async function searchJob(jobRef, _retry = 0) {
        const token = getCachedTokenSync();
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
                PageSize: 10, PageIndex: 1,
                EngineerType: 0,
                IncludePPMJobs: true, IncludeReactiveJobs: true,
                StartLoggedDate: '', EndLoggedDate: '',
                StartDate: '', EndDate: '',
                StartCompleteDate: '', EndCompleteDate: '',
                StartNextContactDate: '', EndNextContactDate: ''
            })
        });
        if (resp.status === 403 || resp.status === 400) {
            if (_retry < 2) {
                log(`  token rotated, refreshing... (retry ${_retry + 1})`, '#888');
                await refreshToken();
                await sleep(500);
                return searchJob(jobRef, _retry + 1);
            }
        }
        if (!resp.ok) throw new Error('Search HTTP ' + resp.status);
        const data = await resp.json();
        const jobs = (data.AdditionalData && data.AdditionalData.Jobs) || data.Data || [];
        if (!jobs.length) return null;
        const match = jobs.find(j => j.JobNumber === jobRef || j.ReferenceNumber === jobRef) || jobs[0];
        return {
            id: match.Id || match.JobId,
            number: match.JobNumber || match.ReferenceNumber || jobRef,
            statusDescription: match.StatusDescription || ''
        };
    }

    // Status Audit endpoint returns HTML with embedded JSON: intializeStatusAudit([...])
    // (note: Joblogic spell it "intialize" — sic)
    async function getStatusAudit(internalId) {
        const html = await fetchText('/Audit/GetStatusAudit?jobId=' + internalId);
        const m = html.match(/intializeStatusAudit\s*\(\s*(\[[\s\S]*?\])\s*\)/);
        if (!m) throw new Error('Status Audit JSON not found in response');
        try {
            return JSON.parse(m[1]);
        } catch (e) {
            throw new Error('Status Audit JSON parse error: ' + e.message);
        }
    }

    // From the audit rows, find the most recent row where StatusDescription === "Completed".
    // StatusDate format: "dd/MM/yyyy HH:mm" — same shape DateComplete expects, so no reformat needed.
    function findCompletedDate(auditRows) {
        if (!Array.isArray(auditRows)) return null;
        // Audit is returned in chronological order. Take the LAST "Completed" entry
        // (handles the rare case where a job was completed, reopened, then completed again).
        let found = null;
        for (const row of auditRows) {
            if ((row.StatusDescription || '').trim() === 'Completed') found = row;
        }
        return found ? (found.StatusDate || '').trim() : null;
    }

    // Extract embedded job-state JSON blob from the detail page HTML
    function extractJobState(html, internalId) {
        const anchor = `"Id":${internalId}`;
        const i = html.indexOf(anchor);
        if (i < 0) throw new Error(`Job state anchor "${anchor}" not in HTML`);
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

    // POST a full EditDetail payload, optionally overriding DateComplete and/or StatusId.
    // overrides: { dateComplete?: string, statusId?: string }
    async function editJobDetail(internalId, overrides, dryRun, _retry = 0) {
        const html = await fetchText('/Job/Detail/' + internalId);
        const job = extractJobState(html, internalId);
        const tokenMatch = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
        const csrfToken = tokenMatch ? tokenMatch[1] : '';

        const existingTagIds = Array.isArray(job.TagIds)
            ? job.TagIds.map(String)
            : (Array.isArray(job.Tags) ? job.Tags.map(t => String(t.Id || t.TagId || t)) : []);

        const newDateComplete = overrides.dateComplete !== undefined ? overrides.dateComplete : job.DateComplete;
        const newStatusId = overrides.statusId !== undefined ? overrides.statusId : job.StatusId;

        const entries = [];
        const push = (k, v) => entries.push([k, v == null ? '' : String(v)]);

        push('Id', job.Id);
        push('AssignedToUserId', job.AssignedToUserId);
        existingTagIds.forEach((id, idx) => push(`TagIds[${idx}]`, id));
        push('TradeId', job.TradeId);
        push('IsRecuring', job.IsRecuring);
        push('JobTypeId', job.JobTypeId);
        push('StatusId', newStatusId);
        push('Description', job.Description);
        push('DateLogged', job.DateLogged);
        push('AppointmentDate', job.AppointmentDate);
        push('TargetCompletionDate', job.TargetCompletionDate);
        push('DateComplete', newDateComplete);
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

        const summary = {
            existingDateComplete: job.DateComplete || '(empty)',
            newDateComplete,
            existingStatusId: job.StatusId,
            newStatusId,
            fieldCount: entries.length
        };
        if (dryRun) return { dry: true, ...summary };

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
            if ((resp.status === 400 || resp.status === 403) && _retry < 2) {
                await refreshToken();
                await sleep(1500);
                return editJobDetail(internalId, overrides, dryRun, _retry + 1);
            }
            throw new Error(`EditDetail HTTP ${resp.status}: ${respText.slice(0, 400)}`);
        }
        let json = {};
        try { json = JSON.parse(respText); } catch (e) {}
        if (json.success === false) {
            throw new Error('EditDetail success=false: ' + (json.Message || respText.slice(0, 300)));
        }
        return { status: resp.status, ...summary };
    }

    // =======================================================================
    // Main loop — for each job: search, fetch audit, write DateComplete
    // =======================================================================
    async function startProcess() {
        if (running || !rows.length) return;
        running = true;
        startBtn.style.display = 'none';
        stopBtn.style.display = 'inline-block';
        revertBtn.style.display = 'none';
        logArea.innerHTML = '';
        noCompletionList = [];

        const dryRun = dryCheck.checked;
        log(dryRun ? 'DRY RUN — no changes will be made' : 'LIVE MODE — DateComplete will be updated',
            dryRun ? '#ff0' : '#f55');
        log(`Processing ${rows.length} jobs...`, '#0af');
        log('');

        const stats = { updated: 0, alreadyMatched: 0, noCompletion: 0, notFound: 0, errors: 0 };
        const failed = [];

        for (let i = 0; i < rows.length; i++) {
            if (!running) { log('Stopped by user.', '#f55'); break; }
            const { ref } = rows[i];
            setProgress(`Processing ${i + 1}/${rows.length}: ${ref}`);
            log(`--- [${i + 1}/${rows.length}] ${ref} ---`, '#fff');

            try {
                const job = await searchJob(ref);
                if (!job) {
                    log('  Not found in search', '#f55');
                    stats.notFound++;
                    failed.push(ref + ' (not found)');
                    continue;
                }
                log(`  Resolved -> internalId=${job.id} (status=${job.statusDescription})`, '#0af');

                const audit = await getStatusAudit(job.id);
                const completedDate = findCompletedDate(audit);

                if (!completedDate) {
                    log(`  No "Completed" entry in Status Audit (${audit.length} rows). Queued for revert-to-New-Job.`, '#fa0');
                    stats.noCompletion++;
                    noCompletionList.push({ ref, internalId: job.id });
                    continue;
                }

                log(`  Audit Completed date: ${completedDate}`, '#0af');

                const res = await editJobDetail(job.id, { dateComplete: completedDate }, dryRun);
                if (res.dry) {
                    log(`  [DRY] Would set DateComplete: "${res.existingDateComplete}" -> "${res.newDateComplete}"`, '#ff0');
                    stats.updated++;
                } else if (res.existingDateComplete === res.newDateComplete) {
                    log(`  DateComplete already "${res.newDateComplete}" — posted anyway`, '#0a8');
                    stats.alreadyMatched++;
                } else {
                    log(`  DateComplete updated: "${res.existingDateComplete}" -> "${res.newDateComplete}"`, '#0fa');
                    stats.updated++;
                }
            } catch (e) {
                log(`  ERROR: ${e.message}`, '#f55');
                stats.errors++;
                failed.push(ref + ' (' + e.message + ')');
            }

            await sleep(DELAY_BETWEEN_JOBS);
        }

        log('');
        log('===== SUMMARY =====', '#0af');
        log(`Updated:        ${stats.updated}`, '#0fa');
        log(`Already matched:${stats.alreadyMatched}`, '#888');
        log(`No completion:  ${stats.noCompletion}`, stats.noCompletion ? '#fa0' : '#888');
        log(`Not found:      ${stats.notFound}`, stats.notFound ? '#fa0' : '#888');
        log(`Errors:         ${stats.errors}`, stats.errors ? '#f55' : '#888');
        if (failed.length) {
            log('');
            log('Failed:', '#f55');
            failed.forEach(f => log('  ' + f, '#f99'));
        }
        if (noCompletionList.length) {
            log('');
            log(`Jobs queued for revert (${noCompletionList.length}):`, '#fa0');
            noCompletionList.forEach(j => log('  ' + j.ref + ' (id=' + j.internalId + ')', '#fc8'));
            showRevertButtons();
        }
        setProgress(`Done. ${stats.updated}/${rows.length} updated. ${noCompletionList.length} need revert.`);

        running = false;
        startBtn.style.display = 'inline-block';
        stopBtn.style.display = 'none';
    }

    // =======================================================================
    // Revert pass — change StatusId to "N" for queued jobs
    // =======================================================================
    async function revertNoCompletionJobs() {
        if (running || !noCompletionList.length) return;
        const dryRun = dryCheck.checked;
        const confirmMsg = dryRun
            ? `Dry run: simulate reverting ${noCompletionList.length} job(s) to New Job?`
            : `Revert ${noCompletionList.length} job(s) to New Job status? This will change job status on Joblogic.`;
        if (!confirm(confirmMsg)) return;

        running = true;
        revertBtn.disabled = true;
        startBtn.style.display = 'none';
        stopBtn.style.display = 'inline-block';

        log('');
        log('===== REVERTING TO NEW JOB =====', '#fa0');
        log(dryRun ? 'DRY RUN' : 'LIVE MODE — status will change to New Job', dryRun ? '#ff0' : '#f55');

        const stats = { reverted: 0, errors: 0 };
        const failed = [];

        for (let i = 0; i < noCompletionList.length; i++) {
            if (!running) { log('Stopped by user.', '#f55'); break; }
            const { ref, internalId } = noCompletionList[i];
            setProgress(`Reverting ${i + 1}/${noCompletionList.length}: ${ref}`);
            log(`--- [${i + 1}/${noCompletionList.length}] ${ref} (id=${internalId}) ---`, '#fff');
            try {
                const res = await editJobDetail(internalId, { statusId: STATUS_ID_NEW_JOB }, dryRun);
                if (res.dry) {
                    log(`  [DRY] Would set StatusId: "${res.existingStatusId}" -> "${res.newStatusId}"`, '#ff0');
                    stats.reverted++;
                } else if (res.existingStatusId === STATUS_ID_NEW_JOB) {
                    log(`  Already New Job — no change needed`, '#888');
                    stats.reverted++;
                } else {
                    log(`  StatusId: "${res.existingStatusId}" -> "${res.newStatusId}"`, '#0fa');
                    stats.reverted++;
                }
            } catch (e) {
                log(`  ERROR: ${e.message}`, '#f55');
                stats.errors++;
                failed.push(ref + ' (' + e.message + ')');
            }
            await sleep(DELAY_BETWEEN_JOBS);
        }

        log('');
        log('===== REVERT SUMMARY =====', '#fa0');
        log(`Reverted: ${stats.reverted}`, '#0fa');
        log(`Errors:   ${stats.errors}`, stats.errors ? '#f55' : '#888');
        if (failed.length) {
            log('Failed:', '#f55');
            failed.forEach(f => log('  ' + f, '#f99'));
        }
        setProgress(`Revert done. ${stats.reverted}/${noCompletionList.length} reverted.`);

        // Clear the revert queue so we don't double-revert
        noCompletionList = [];
        revertBtn.style.display = 'none';
        clearRevertBtn.style.display = 'none';
        revertBtn.disabled = false;
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
