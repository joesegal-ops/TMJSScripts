// ==UserScript==
// @name         Joblogic - Bulk Set Site Reference Number
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Paste CSV of AutoID,SF ID; script walks each Site config tab, sets Reference Number, and saves. Collapses to a launcher button in the shared dock (drag to reorder).
// @match        https://go.joblogic.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // ===== Shared JL userscript launcher dock (identical in every script) =====
    const JL_DOCK_ID = 'jl-userscript-dock', JL_ORDER_KEY = 'jl-userscript-dock-order';
    function jlReadOrder() { try { return JSON.parse(localStorage.getItem(JL_ORDER_KEY)) || []; } catch (e) { return []; } }
    function jlSaveOrder() { const d = document.getElementById(JL_DOCK_ID); if (!d) return; localStorage.setItem(JL_ORDER_KEY, JSON.stringify([...d.children].map(b => b.dataset.scriptId).filter(Boolean))); }
    function jlApplyOrder() { const d = document.getElementById(JL_DOCK_ID); if (!d) return; [...d.children].sort((a, b) => { const o = jlReadOrder(); let ia = o.indexOf(a.dataset.scriptId), ib = o.indexOf(b.dataset.scriptId); if (ia < 0) ia = 1e9; if (ib < 0) ib = 1e9; return ia - ib; }).forEach(b => d.appendChild(b)); }
    function jlAfter(d, y) { let c = { o: -Infinity, el: null }; for (const el of d.querySelectorAll('button:not(.jl-dragging)')) { const r = el.getBoundingClientRect(); const off = y - (r.top + r.height / 2); if (off < 0 && off > c.o) c = { o: off, el }; } return c.el; }
    function jlGetDock() {
        let d = document.getElementById(JL_DOCK_ID);
        if (!d) {
            d = document.createElement('div');
            d.id = JL_DOCK_ID;
            d.style.cssText = 'position:fixed;top:80px;left:8px;z-index:100000;display:flex;flex-direction:column;gap:8px;align-items:flex-start;';
            document.body.appendChild(d);
        }
        if (!d.dataset.dnd) {
            d.dataset.dnd = '1';
            d.addEventListener('dragover', e => { e.preventDefault(); const dr = d.querySelector('.jl-dragging'); if (!dr) return; const a = jlAfter(d, e.clientY); if (a == null) d.appendChild(dr); else d.insertBefore(dr, a); });
            d.addEventListener('drop', e => { e.preventDefault(); jlSaveOrder(); });
        }
        return d;
    }
    function jlDockButton(id, label, color, onClick) {
        const d = jlGetDock();
        let b = document.getElementById('jl-launch-' + id);
        if (b) return b;
        b = document.createElement('button');
        b.id = 'jl-launch-' + id;
        b.dataset.scriptId = id;
        b.textContent = label;
        b.title = 'Show / hide ' + label + '  (drag to reorder)';
        b.draggable = true;
        b.style.cssText = `background:${color};color:#fff;border:none;padding:8px 13px;border-radius:18px;cursor:grab;font-family:monospace;font-size:12px;box-shadow:0 2px 8px rgba(0,0,0,.4);white-space:nowrap;`;
        b.addEventListener('click', () => { if (b.dataset.justDragged) { delete b.dataset.justDragged; return; } onClick(); });
        b.addEventListener('dragstart', () => { b.classList.add('jl-dragging'); b.style.opacity = '0.4'; });
        b.addEventListener('dragend', () => { b.classList.remove('jl-dragging'); b.style.opacity = '1'; b.dataset.justDragged = '1'; setTimeout(() => { delete b.dataset.justDragged; }, 60); jlSaveOrder(); });
        d.appendChild(b);
        jlApplyOrder();
        return b;
    }
    function jlRegisterPanel(panelEl, id, label, color) {
        const shown = (panelEl.style.display && panelEl.style.display !== 'none') ? panelEl.style.display : 'block';
        panelEl.style.display = 'none';
        const btn = jlDockButton(id, label, color, () => {
            const opening = panelEl.style.display === 'none';
            panelEl.style.display = opening ? shown : 'none';
            btn.style.boxShadow = opening ? '0 0 0 2px #fff, 0 2px 8px rgba(0,0,0,.4)' : '0 2px 8px rgba(0,0,0,.4)';
        });
        return btn;
    }
    // ===== end shared dock =====

    const SCRIPT_ID = 'set-site-reference';
    const SCRIPT_LABEL = '🏢 Set Site Reference';
    const SCRIPT_COLOR = '#a60';

    // --- CONFIG ---
    const STATE_KEY = 'jl-bulk-site-ref:state';
    const LOG_KEY = 'jl-bulk-site-ref:log';
    const SAVE_TIMEOUT_MS = 8000;
    const FIELD_FIND_TIMEOUT_MS = 15000;
    const POST_SAVE_PAUSE_MS = 150;
    const HEADER_WORDS_AUTOID = ['autoid', 'auto id', 'site id', 'siteid', 'id'];
    const HEADER_WORDS_SFID = ['sf id', 'sfid', 'sf', 'reference', 'ref', 'reference number', 'salesforce', 'salesforce id'];

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    // =======================================================================
    // Network watcher — installed at document-start so we catch the save POST
    // and avoid polling toasts. Used to detect save completion in real time.
    // =======================================================================
    const networkLog = []; // { url, method, status, ok, ts }
    const NET_LOG_MAX = 100;

    (function installNetworkWatcher() {
        const recordNonGet = (entry) => {
            if (!entry.method || entry.method.toUpperCase() === 'GET') return;
            networkLog.push(entry);
            if (networkLog.length > NET_LOG_MAX) networkLog.shift();
        };

        const origFetch = window.fetch;
        if (origFetch && !origFetch.__jlSiteRefWrap) {
            const wrapped = async function (input, init) {
                const url = typeof input === 'string' ? input : (input && input.url) || '';
                const method = (init && init.method) || (input && input.method) || 'GET';
                try {
                    const resp = await origFetch.apply(this, arguments);
                    recordNonGet({ url: String(url), method, status: resp.status, ok: resp.ok, ts: Date.now() });
                    return resp;
                } catch (e) {
                    recordNonGet({ url: String(url), method, status: 0, ok: false, error: e.message, ts: Date.now() });
                    throw e;
                }
            };
            wrapped.__jlSiteRefWrap = true;
            window.fetch = wrapped;
        }

        const origOpen = XMLHttpRequest.prototype.open;
        const origSend = XMLHttpRequest.prototype.send;
        if (origOpen && !origOpen.__jlSiteRefWrap) {
            const wrappedOpen = function (method, url) {
                this.__jlMethod = method;
                this.__jlUrl = url;
                return origOpen.apply(this, arguments);
            };
            wrappedOpen.__jlSiteRefWrap = true;
            XMLHttpRequest.prototype.open = wrappedOpen;

            const wrappedSend = function () {
                this.addEventListener('loadend', () => {
                    recordNonGet({
                        url: String(this.__jlUrl || ''),
                        method: this.__jlMethod || 'GET',
                        status: this.status,
                        ok: this.status >= 200 && this.status < 400,
                        ts: Date.now()
                    });
                });
                return origSend.apply(this, arguments);
            };
            wrappedSend.__jlSiteRefWrap = true;
            XMLHttpRequest.prototype.send = wrappedSend;
        }
    })();

    // =======================================================================
    // State (persisted across page loads)
    // =======================================================================
    function loadState() {
        try { return JSON.parse(localStorage.getItem(STATE_KEY) || 'null'); }
        catch (e) { return null; }
    }
    function saveState(s) {
        if (s == null) localStorage.removeItem(STATE_KEY);
        else localStorage.setItem(STATE_KEY, JSON.stringify(s));
    }
    function loadLog() {
        try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); }
        catch (e) { return []; }
    }
    function saveLog(arr) {
        // Keep log size sane
        if (arr.length > 1000) arr = arr.slice(-1000);
        localStorage.setItem(LOG_KEY, JSON.stringify(arr));
    }
    function pushLog(msg, color) {
        const arr = loadLog();
        arr.push({ msg, color: color || '#ccc', ts: Date.now() });
        saveLog(arr);
        if (logArea) renderLogLine(msg, color);
    }
    function clearLog() {
        saveLog([]);
        if (logArea) logArea.innerHTML = '';
    }

    // =======================================================================
    // UI
    // =======================================================================
    let panel, logArea, startBtn, stopBtn, pasteBtn, clearBtn, progressText, dryCheck, skipFilledCheck;

    function createUI() {
        if (document.getElementById('jl-sitebulkref-panel')) return;

        panel = document.createElement('div');
        panel.id = 'jl-sitebulkref-panel';
        const container = document.createElement('div');
        container.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;background:#1a1a2e;color:#eee;border-radius:8px;padding:16px;width:580px;max-height:85vh;display:flex;flex-direction:column;font-family:monospace;font-size:12px;box-shadow:0 4px 20px rgba(0,0,0,0.5);';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;';
        const title = document.createElement('strong');
        title.style.fontSize = '14px';
        title.textContent = 'Bulk Set Site Reference Number';
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
        progressText.textContent = 'Paste CSV (AutoID, SF ID) to begin.';
        progressDiv.appendChild(progressText);

        const controlsDiv = document.createElement('div');
        controlsDiv.style.cssText = 'margin-bottom:10px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;';

        pasteBtn = document.createElement('button');
        pasteBtn.style.cssText = 'background:#08a;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;';
        pasteBtn.textContent = 'Paste CSV';
        pasteBtn.addEventListener('click', openPasteDialog);

        startBtn = document.createElement('button');
        startBtn.style.cssText = 'background:#0a8;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;';
        startBtn.textContent = 'Start';
        startBtn.disabled = true;
        startBtn.addEventListener('click', startProcess);

        stopBtn = document.createElement('button');
        stopBtn.style.cssText = 'background:#a22;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;display:none;';
        stopBtn.textContent = 'Stop';
        stopBtn.addEventListener('click', stopProcess);

        clearBtn = document.createElement('button');
        clearBtn.style.cssText = 'background:#555;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;';
        clearBtn.textContent = 'Clear Log';
        clearBtn.addEventListener('click', clearLog);

        const dryLabel = document.createElement('label');
        dryLabel.style.cssText = 'cursor:pointer;';
        dryCheck = document.createElement('input');
        dryCheck.type = 'checkbox';
        dryLabel.appendChild(dryCheck);
        dryLabel.appendChild(document.createTextNode(' Dry Run'));

        const skipLabel = document.createElement('label');
        skipLabel.style.cssText = 'cursor:pointer;';
        skipFilledCheck = document.createElement('input');
        skipFilledCheck.type = 'checkbox';
        skipFilledCheck.checked = true;
        skipLabel.appendChild(skipFilledCheck);
        skipLabel.appendChild(document.createTextNode(' Skip if already correct'));

        controlsDiv.appendChild(pasteBtn);
        controlsDiv.appendChild(startBtn);
        controlsDiv.appendChild(stopBtn);
        controlsDiv.appendChild(clearBtn);
        controlsDiv.appendChild(dryLabel);
        controlsDiv.appendChild(skipLabel);

        logArea = document.createElement('div');
        logArea.style.cssText = 'flex:1;overflow-y:auto;background:#0a0a1a;padding:8px;border-radius:4px;max-height:55vh;';

        container.appendChild(header);
        container.appendChild(progressDiv);
        container.appendChild(controlsDiv);
        container.appendChild(logArea);
        panel.appendChild(container);
        document.body.appendChild(panel);
        jlRegisterPanel(panel, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR);

        // Restore log
        for (const entry of loadLog()) renderLogLine(entry.msg, entry.color);

        // Sync UI to current state
        const state = loadState();
        if (state && state.running) {
            startBtn.style.display = 'none';
            stopBtn.style.display = 'inline-block';
            pasteBtn.disabled = true;
            dryCheck.checked = !!state.dryRun;
            skipFilledCheck.checked = !!state.skipFilled;
            setProgress(`Running: ${state.index + 1}/${state.queue.length} (AutoID ${state.queue[state.index]?.autoId || '?'})`);
        } else if (state && state.queue && state.queue.length) {
            startBtn.disabled = false;
            setProgress(`${state.queue.length} rows ready. Click Start.`);
        }
    }

    function renderLogLine(msg, color) {
        const line = document.createElement('div');
        line.style.color = color || '#ccc';
        line.style.whiteSpace = 'pre-wrap';
        line.style.wordBreak = 'break-word';
        line.textContent = msg;
        logArea.appendChild(line);
        logArea.scrollTop = logArea.scrollHeight;
    }
    const setProgress = (msg) => { if (progressText) progressText.textContent = msg; };

    // =======================================================================
    // CSV parsing
    // =======================================================================
    function splitCsvLine(line) {
        if (line.includes('\t')) return line.split('\t').map(s => s.trim());
        const out = [];
        let cur = '';
        let inQ = false;
        for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (c === '"') {
                if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
                else inQ = !inQ;
            } else if (c === ',' && !inQ) {
                out.push(cur.trim()); cur = '';
            } else {
                cur += c;
            }
        }
        out.push(cur.trim());
        return out.map(s => s.replace(/^"|"$/g, ''));
    }

    function parseCsv(text) {
        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (!lines.length) return [];
        const first = splitCsvLine(lines[0]);
        const firstLooksLikeHeader =
            first.length >= 2 &&
            (HEADER_WORDS_AUTOID.includes((first[0] || '').toLowerCase()) ||
             HEADER_WORDS_SFID.includes((first[1] || '').toLowerCase()));
        const dataLines = firstLooksLikeHeader ? lines.slice(1) : lines;

        const out = [];
        const seen = new Set();
        for (const line of dataLines) {
            const cols = splitCsvLine(line);
            if (cols.length < 2) continue;
            const autoId = cols[0].trim();
            const sfId = cols[1].trim();
            if (!autoId || !sfId) continue;
            if (!/^\d+$/.test(autoId)) continue; // AutoID must be numeric
            if (seen.has(autoId)) continue;
            seen.add(autoId);
            out.push({ autoId, sfId });
        }
        return out;
    }

    function openPasteDialog() {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:100000;display:flex;align-items:center;justify-content:center;';
        overlay.innerHTML = `
            <div style="background:#fff;color:#111;border-radius:8px;width:560px;max-width:92vw;box-shadow:0 10px 40px rgba(0,0,0,.4);overflow:hidden;font-family:system-ui,sans-serif;">
                <div style="padding:12px 16px;background:#111827;color:#f9fafb;font-weight:600;">Paste AutoID and SF ID</div>
                <div style="padding:14px 16px;">
                    <textarea id="jl-paste-ta" style="width:100%;height:220px;font:13px monospace;padding:8px;border:1px solid #d1d5db;border-radius:4px;box-sizing:border-box;" placeholder="Two columns: AutoID, SF ID&#10;&#10;Example:&#10;16956893, 0015800001abcDEF&#10;16956894, 0015800001ghiJKL"></textarea>
                    <div style="color:#6b7280;font-size:12px;margin-top:6px;">Comma or tab separated. Header row optional. AutoID must be numeric.</div>
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
            const parsed = parseCsv(ta.value);
            count.textContent = `${parsed.length} row${parsed.length === 1 ? '' : 's'} detected`;
            count.style.color = parsed.length ? '#2563eb' : '#dc2626';
            preview.innerHTML = parsed.slice(0, 6).map(r =>
                `<div>${r.autoId} &rarr; ${r.sfId}</div>`
            ).join('') + (parsed.length > 6 ? `<div style="color:#9ca3af;">...and ${parsed.length - 6} more</div>` : '');
        };

        ta.addEventListener('input', refreshPreview);
        overlay.querySelector('#jl-paste-cancel').onclick = () => overlay.remove();
        overlay.querySelector('#jl-paste-ok').onclick = () => {
            const parsed = parseCsv(ta.value);
            overlay.remove();
            if (!parsed.length) {
                setProgress('No valid rows found.');
                startBtn.disabled = true;
                return;
            }
            // Stash queue (not yet running)
            saveState({
                queue: parsed,
                index: 0,
                running: false,
                dryRun: dryCheck.checked,
                skipFilled: skipFilledCheck.checked,
                originUrl: location.href,
                stats: { updated: 0, skipped: 0, errors: 0, dryRun: 0 },
                failed: []
            });
            clearLog();
            pushLog(`Loaded ${parsed.length} rows.`, '#0af');
            setProgress(`${parsed.length} rows ready. Click Start.`);
            startBtn.disabled = false;
        };
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        setTimeout(() => ta.focus(), 50);
    }

    // =======================================================================
    // Start / Stop
    // =======================================================================
    function startProcess() {
        const state = loadState();
        if (!state || !state.queue || !state.queue.length) {
            setProgress('No rows loaded.');
            return;
        }
        state.running = true;
        state.dryRun = dryCheck.checked;
        state.skipFilled = skipFilledCheck.checked;
        state.originUrl = state.originUrl || location.href;
        saveState(state);

        startBtn.style.display = 'none';
        stopBtn.style.display = 'inline-block';
        pasteBtn.disabled = true;

        pushLog(state.dryRun ? 'DRY RUN — no changes will be saved' : 'LIVE MODE — Reference Number will be saved',
            state.dryRun ? '#ff0' : '#f55');
        pushLog(`Processing ${state.queue.length} sites...`, '#0af');

        // Navigate to first site (or current site if already on one)
        navigateToCurrent();
    }

    function stopProcess() {
        const state = loadState();
        if (state) {
            state.running = false;
            saveState(state);
        }
        pushLog('Stopped by user.', '#f55');
        startBtn.style.display = 'inline-block';
        stopBtn.style.display = 'none';
        pasteBtn.disabled = false;
        setProgress('Stopped. Click Start to resume from current row, or Paste CSV to start over.');
    }

    function navigateToCurrent() {
        const state = loadState();
        if (!state || !state.running) return;
        if (state.index >= state.queue.length) return finish();
        const row = state.queue[state.index];
        const targetUrl = `https://go.joblogic.com/Site/Detail/${row.autoId}?pageIndex=1#configurationTab`;
        setProgress(`Navigating ${state.index + 1}/${state.queue.length} -> AutoID ${row.autoId}`);
        if (location.href === targetUrl) {
            // Already on the right page (no navigation will happen) — kick off processing
            processCurrentSite();
        } else {
            location.href = targetUrl;
        }
    }

    function finish() {
        const state = loadState();
        if (!state) return;
        state.running = false;
        saveState(state);

        pushLog('', '#ccc');
        pushLog('===== SUMMARY =====', '#0af');
        pushLog(`Updated:  ${state.stats.updated}`, '#0fa');
        pushLog(`DryRun:   ${state.stats.dryRun}`, '#ff0');
        pushLog(`Skipped:  ${state.stats.skipped}`, '#888');
        pushLog(`Errors:   ${state.stats.errors}`, state.stats.errors ? '#f55' : '#888');
        if (state.failed && state.failed.length) {
            pushLog('', '#ccc');
            pushLog('Failed:', '#f55');
            for (const f of state.failed) pushLog('  ' + f, '#f99');
        }
        setProgress(`Done. ${state.stats.updated}/${state.queue.length} updated.`);

        if (startBtn) {
            startBtn.style.display = 'inline-block';
            stopBtn.style.display = 'none';
            pasteBtn.disabled = false;
        }
    }

    // =======================================================================
    // Site page processing
    // =======================================================================
    function getCurrentSiteAutoIdFromUrl() {
        const m = location.pathname.match(/\/Site\/Detail\/(\d+)/i);
        return m ? m[1] : null;
    }

    async function waitFor(predicate, timeoutMs, intervalMs = 200) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            try {
                const v = predicate();
                if (v) return v;
            } catch (e) { /* keep polling */ }
            await sleep(intervalMs);
        }
        return null;
    }

    function isVisible(el) {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return false;
        const cs = getComputedStyle(el);
        return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
    }

    // Find the Reference Number input on the Configuration tab.
    // Tries (in order): label-text match, name/id contains "Reference", placeholder match.
    function findReferenceNumberInput() {
        // Restrict search to the configuration tab pane if we can find one
        const tabPane = document.querySelector('#configurationTab, [id$="configurationTab"], .tab-pane.active');
        const root = tabPane && isVisible(tabPane) ? tabPane : document;

        // 1) <label>Reference Number</label> -> via for=
        const labels = root.querySelectorAll('label');
        for (const lbl of labels) {
            const txt = (lbl.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
            if (txt === 'reference number' || txt === 'reference no' || txt === 'reference no.' || txt === 'reference #') {
                const forId = lbl.getAttribute('for');
                if (forId) {
                    const el = document.getElementById(forId);
                    if (el && isVisible(el)) return el;
                }
                // Or the input as a sibling/child
                const sib = lbl.parentElement && lbl.parentElement.querySelector('input,textarea');
                if (sib && isVisible(sib)) return sib;
            }
        }

        // 2) name/id contains "Reference" (but not customer/job reference fields)
        const candidates = root.querySelectorAll('input[name*="Reference" i], input[id*="Reference" i], input[name*="ReferenceNumber" i]');
        for (const el of candidates) {
            if (!isVisible(el)) continue;
            const n = (el.getAttribute('name') || '') + ' ' + (el.id || '');
            if (/customer|job|order|po\b/i.test(n)) continue;
            return el;
        }

        // 3) placeholder match
        const ph = root.querySelectorAll('input[placeholder*="Reference" i]');
        for (const el of ph) if (isVisible(el)) return el;

        return null;
    }

    function setNativeValue(el, value) {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
    }

    // Find the Save button on the configuration tab / page-level Save.
    function findSaveButton() {
        // Prefer buttons whose visible text is exactly "Save"
        const all = Array.from(document.querySelectorAll('button, input[type="submit"], a.btn'));
        const visible = all.filter(isVisible);
        // Exact text "Save"
        for (const b of visible) {
            const t = (b.textContent || b.value || '').replace(/\s+/g, ' ').trim().toLowerCase();
            if (t === 'save' && !b.disabled) return b;
        }
        // "Save & Close" or "Save Changes"
        for (const b of visible) {
            const t = (b.textContent || b.value || '').replace(/\s+/g, ' ').trim().toLowerCase();
            if (/^save\b/.test(t) && !/template|search|filter|view|preset/i.test(t) && !b.disabled) return b;
        }
        return null;
    }

    // Heuristic: does this URL look like a Site save endpoint?
    function looksLikeSiteSaveUrl(url) {
        if (!url) return false;
        // Same-origin or absolute — match the path
        let path = url;
        try { path = new URL(url, location.origin).pathname; } catch (e) {}
        // Skip clearly-unrelated endpoints
        if (/SearchJsonData|GetGridData|Autocomplete|Lookup|Validate|CheckExists/i.test(path)) return false;
        // Match Site-related write endpoints
        return /\/Site\//i.test(path) || /SaveSite|EditSite|SiteEdit|SiteConfiguration/i.test(path);
    }

    // Wait for the save POST to land in our network log; fall back to toast.
    async function waitForSaveOutcome(snapshotIdx, timeoutMs) {
        const deadline = Date.now() + timeoutMs;
        const errorSel = '.toast-error, .toast.error, .k-notification-error, .alert-danger, .Toastify__toast--error, .field-validation-error, [class*="error"][class*="toast" i]';
        const successSel = '.toast-success, .toast.success, .k-notification-success, .alert-success, .Toastify__toast--success, [class*="success"][class*="toast" i]';

        let bestNonSiteWrite = null; // any non-GET completion, in case URL heuristic misses

        while (Date.now() < deadline) {
            // 1) Network log — definitive signal
            for (let i = snapshotIdx; i < networkLog.length; i++) {
                const r = networkLog[i];
                if (looksLikeSiteSaveUrl(r.url)) {
                    return r.ok
                        ? { ok: true,  message: `${r.method} ${r.url} -> ${r.status}` }
                        : { ok: false, message: `${r.method} ${r.url} -> ${r.status}` };
                }
                if (!bestNonSiteWrite) bestNonSiteWrite = r;
            }

            // 2) Visible error toast — fail fast
            const errEls = Array.from(document.querySelectorAll(errorSel)).filter(isVisible);
            if (errEls.length) {
                const txt = errEls.map(e => (e.textContent || '').trim()).filter(Boolean).join(' | ');
                return { ok: false, message: txt || 'error toast' };
            }

            // 3) Visible success toast — finish
            const okEls = Array.from(document.querySelectorAll(successSel)).filter(isVisible);
            if (okEls.length) {
                const txt = okEls.map(e => (e.textContent || '').trim()).filter(Boolean).join(' | ');
                return { ok: true, message: txt || 'success toast' };
            }

            await sleep(75);
        }

        // Timed out without a Site-write match. If we DID see any non-GET
        // request complete in the window, treat it as the save (best guess).
        if (bestNonSiteWrite) {
            return bestNonSiteWrite.ok
                ? { ok: true,  message: `(fuzzy) ${bestNonSiteWrite.method} ${bestNonSiteWrite.url} -> ${bestNonSiteWrite.status}` }
                : { ok: false, message: `(fuzzy) ${bestNonSiteWrite.method} ${bestNonSiteWrite.url} -> ${bestNonSiteWrite.status}` };
        }
        return null; // genuine timeout
    }

    async function processCurrentSite() {
        const state = loadState();
        if (!state || !state.running) return;

        const expectedAutoId = state.queue[state.index]?.autoId;
        const onAutoId = getCurrentSiteAutoIdFromUrl();

        if (!expectedAutoId) return finish();
        if (onAutoId !== expectedAutoId) {
            // We are on the wrong page (e.g. user navigated, or origin page) — go to expected
            navigateToCurrent();
            return;
        }

        const row = state.queue[state.index];
        setProgress(`Processing ${state.index + 1}/${state.queue.length}: AutoID ${row.autoId}`);
        pushLog(`--- [${state.index + 1}/${state.queue.length}] AutoID ${row.autoId} -> "${row.sfId}" ---`, '#fff');

        try {
            // 1) Wait for the configuration tab content to render.
            const refInput = await waitFor(findReferenceNumberInput, FIELD_FIND_TIMEOUT_MS);
            if (!refInput) {
                throw new Error('Reference Number input not found on Configuration tab');
            }

            const before = (refInput.value || '').trim();
            pushLog(`  Current value: "${before}"`, '#888');

            if (state.skipFilled && before === row.sfId) {
                pushLog(`  Already correct — skipping`, '#0a8');
                state.stats.skipped++;
                return advance(state);
            }

            // 2) Set value
            setNativeValue(refInput, row.sfId);
            const after = (refInput.value || '').trim();
            if (after !== row.sfId) {
                throw new Error(`Set failed: input now reads "${after}", expected "${row.sfId}"`);
            }

            if (state.dryRun) {
                pushLog(`  [DRY] Would save "${before}" -> "${row.sfId}"`, '#ff0');
                state.stats.dryRun++;
                // Reset value to avoid leaving page dirty
                setNativeValue(refInput, before);
                return advance(state);
            }

            // 3) Click Save
            const saveBtn = findSaveButton();
            if (!saveBtn) throw new Error('Save button not found');
            pushLog(`  Clicking Save (text="${(saveBtn.textContent || saveBtn.value || '').trim()}")`, '#0af');
            const netSnapshot = networkLog.length;
            saveBtn.click();

            // 4) Wait for outcome (network-first, toast fallback)
            const outcome = await waitForSaveOutcome(netSnapshot, SAVE_TIMEOUT_MS);
            if (outcome && !outcome.ok) {
                throw new Error('Save error: ' + (outcome.message || 'unknown'));
            }
            if (!outcome) {
                pushLog(`  No save signal within ${SAVE_TIMEOUT_MS}ms — proceeding anyway`, '#fa0');
            } else {
                pushLog(`  Save OK: ${outcome.message}`, '#0fa');
            }

            state.stats.updated++;
            await sleep(POST_SAVE_PAUSE_MS);
            return advance(state);

        } catch (e) {
            pushLog(`  ERROR: ${e.message}`, '#f55');
            state.stats.errors++;
            state.failed = state.failed || [];
            state.failed.push(`${row.autoId} (${e.message})`);
            return advance(state);
        }
    }

    function advance(state) {
        state.index++;
        saveState(state);
        if (state.index >= state.queue.length) return finish();
        navigateToCurrent();
    }

    // =======================================================================
    // Boot
    // =======================================================================
    function boot() {
        createUI();

        // If a run is in progress and we're on the expected Site detail page, process it.
        const state = loadState();
        if (!state || !state.running) return;

        const onAutoId = getCurrentSiteAutoIdFromUrl();
        if (!onAutoId) return; // not on a site page; user can navigate or panel will

        const expectedAutoId = state.queue[state.index]?.autoId;
        if (onAutoId !== expectedAutoId) {
            // Wrong site page — re-route
            navigateToCurrent();
            return;
        }

        // Give the SPA a moment to settle, then process
        setTimeout(processCurrentSite, 500);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
