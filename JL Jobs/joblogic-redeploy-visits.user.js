// ==UserScript==
// @name         Joblogic - Redeploy Visits (from filtered list)
// @namespace    https://go.joblogic.com/
// @version      1.17
// @description  Scan the filtered Jobs list, navigate to each job, and redeploy eligible visits back to the same engineer so the jobs re-appear in their app. Collapses to a launcher button in the shared dock (drag to reorder).
// @match        https://go.joblogic.com/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/joblogic-redeploy-visits.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/joblogic-redeploy-visits.user.js
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
            d.style.cssText = 'position:fixed;top:80px;right:8px;z-index:100000;display:flex;flex-direction:column;gap:8px;align-items:flex-end;';
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

    const SCRIPT_ID = 'redeploy-visits';
    const SCRIPT_LABEL = '🔁 Redeploy Visits';
    const SCRIPT_COLOR = '#a60';

    if (window.__jlRedeployLoaded) return;
    window.__jlRedeployLoaded = true;

    // =========================================================================
    // CONFIG
    // =========================================================================
    const STATE_KEY        = 'jl-redeploy-state-v1';
    const LOG_KEY          = 'jl-redeploy-loglines-v1';
    const LOG_MAX_LINES    = 400;
    const DIALOG_WAIT_MS   = 8000;
    const CONFIRM_WAIT_MS  = 6000;

    // Icon filenames / status text that make a visit ineligible for redeployment.
    const INELIGIBLE = [/complet/i, /cancel/i, /reject/i, /redeploy/i, /pending/i, /not.?sent/i, /unsent/i, /non.?deploy/i];

    // =========================================================================
    // HELPERS
    // =========================================================================
    const sleep  = ms => new Promise(r => setTimeout(r, ms));
    const qs     = (s, r = document) => r.querySelector(s);
    const qsa    = (s, r = document) => [...r.querySelectorAll(s)];

    function waitFor(fn, { timeout = 10000, interval = 150 } = {}) {
        return new Promise((resolve, reject) => {
            const t0 = Date.now();
            (function tick() {
                let v; try { v = fn(); } catch { v = null; }
                if (v) return resolve(v);
                if (Date.now() - t0 > timeout) return reject(new Error('waitFor timeout'));
                setTimeout(tick, interval);
            })();
        });
    }

    function fire(el, type, init = {}) {
        const E = (type.startsWith('mouse') || type === 'click') ? MouseEvent
                : type.startsWith('key')                         ? KeyboardEvent
                : Event;
        el.dispatchEvent(new E(type, { bubbles: true, cancelable: true, view: window, ...init }));
    }

    function setNativeValue(el, value) {
        if (!el) return;
        const proto  = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(el, value);
        fire(el, 'input');
        fire(el, 'change');
        fire(el, 'blur');
    }

    // =========================================================================
    // JOB LIST SCRAPING — called on /Job/Index
    // =========================================================================
    function scrapeJobsFromList() {
        const jobs = [];
        const seen = new Set();

        // Joblogic renders the job list with <a href="/Job/Detail/{id}"> links.
        // We also try to read the visible job reference from the link text or a
        // nearby cell so we can show a human-readable label in the log.
        for (const link of qsa('a[href*="/Job/Detail/"]')) {
            const m = link.href.match(/\/Job\/Detail\/(\d+)/i);
            if (!m || seen.has(m[1])) continue;
            seen.add(m[1]);

            // Job reference: prefer text of the link if it looks like a ref,
            // otherwise walk up to find a cell that does.
            let ref = link.textContent.trim();
            if (!ref || /^\d+$/.test(ref)) {
                // Look for a ref-like sibling or ancestor cell
                const row = link.closest('tr, .tr, li, [class*="row"]');
                if (row) {
                    const cell = qsa('td, .td, span, div', row).find(el => {
                        const t = el.textContent.trim();
                        return /^[A-Z]{1,4}[-\/]?\d{4,}/.test(t) || /^\d{4,}$/.test(t);
                    });
                    if (cell) ref = cell.textContent.trim();
                }
            }
            jobs.push({ id: m[1], ref: ref || m[1] });
        }

        return jobs;
    }

    // =========================================================================
    // VISIT ROW READING — called on /Job/Detail/*
    // =========================================================================
    function readVisitRows() {
        // Reactive-job visits sit inside .jl-table-div as .tr-group .tr.table-row
        const container = qs('.jl-table-div') || qs('#visitsTab') || document;
        const rows = qsa('.tr-group .tr.table-row', container);
        // Fallback: plain <tr> inside #visitsTab if the above yields nothing
        if (!rows.length) return qsa('#visitsTab tbody tr');
        return rows;
    }

    function getIconFile(rowEl) {
        // Prefer the dedicated status icon element (same pattern as bulk-allocate script)
        const statusImg = rowEl.querySelector('.visit-status-icon img, [class*="status"] img, [class*="Status"] img');
        if (statusImg?.src) return statusImg.src.split('/').pop().toLowerCase();
        // Fallback: any img — but only if it looks like a status icon filename
        const anyImg = rowEl.querySelector('img[src*="_ic"], img[src*="status"], img[src*="icon"]');
        return (anyImg?.src || '').split('/').pop().toLowerCase();
    }

    // Also read visible status text from the row as a fallback when no icon is found.
    function getStatusText(rowEl) {
        const statusEl = rowEl.querySelector('[class*="status"], [class*="Status"], .badge, .label');
        return (statusEl?.textContent || '').toLowerCase().trim();
    }

    function isEligible(rowEl) {
        const icon = getIconFile(rowEl);
        const text = getStatusText(rowEl);
        const source = icon || text;
        // If we can read a status, check against ineligible patterns
        if (source) return !INELIGIBLE.some(re => re.test(source));
        // No status detectable — skip to be safe (avoids redeploying completed/cancelled visits)
        return false;
    }

    // Returns { engineer, start, end } extracted from a visit row.
    function parseVisitRow(rowEl) {
        const engineer =
            rowEl.querySelector('a')?.textContent?.trim() ||
            rowEl.querySelector('.preview')?.textContent?.trim() || '';

        const dateTds = qsa('.td, td', rowEl).filter(td =>
            /^\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}$/.test((td.textContent || '').trim())
        );
        const start = dateTds[0]?.textContent?.trim() || '';
        const end   = dateTds[1]?.textContent?.trim() || '';

        return { engineer, start, end };
    }

    // =========================================================================
    // FINDING THE REDEPLOY BUTTON
    //
    // Joblogic puts visit-row actions in one of two places:
    //   (a) A visible button with text "Redeploy" on the row
    //   (b) A dropdown / kebab menu that, when opened, reveals a "Redeploy" item
    //
    // We try (a) first, then open any candidate trigger for (b).
    // =========================================================================
    async function findRedeployTrigger(rowEl) {
        // (a) Direct "Redeploy" button/link already visible on the row
        const direct = qsa('button, a, [role="button"]', rowEl).find(el =>
            /redeploy/i.test((el.textContent || '').trim())
        );
        if (direct) return direct;

        // (b) Three-dot / kebab button at the right of the row.
        // Gather every clickable element within the row.
        const allBtns = qsa(
            'button, a, [role="button"], [class*="kebab"], [class*="three-dot"], [class*="ellipsis"], [class*="more"], [class*="action"], [class*="option"], [class*="dropdown"]',
            rowEl
        ).filter(el => el.offsetParent !== null);

        // Sort icon-only (empty/short text) buttons first — the kebab trigger is usually
        // a tiny icon button with no visible text, while "Allocate", date cells, etc. have text.
        const sorted = [...allBtns].sort((a, b) =>
            (a.textContent || '').trim().length - (b.textContent || '').trim().length
        );

        log(`  Row btns (${sorted.length}): ` +
            sorted.map(el => `${el.tagName}.${[...el.classList].join('.')}="${(el.textContent||'').trim().slice(0,20)}"`).join(' | '), '#444');

        for (const btn of sorted) {
            // Full pointer + mouse gesture — Vue 3 / Joblogic needs the full sequence
            btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window }));
            btn.dispatchEvent(new PointerEvent('pointerup',   { bubbles: true, cancelable: true, view: window }));
            fire(btn, 'mousedown'); fire(btn, 'mouseup'); fire(btn, 'click');
            await sleep(600);

            // Search the whole document for a now-visible "Redeploy" menu item
            // (portals often render outside the row's subtree)
            const redeployItem = qsa('button, a, li, [role="menuitem"], [class*="item"], [class*="option"]')
                .find(el => /redeploy/i.test((el.textContent || '').trim()) && el.offsetParent !== null);

            if (redeployItem) {
                log(`  Found Redeploy item via ${btn.tagName}.${[...btn.classList].join('.')}`, '#0af');
                return redeployItem;
            }

            // Didn't work — close any open menu and try the next candidate
            document.body.click();
            await sleep(200);
        }

        return null;
    }

    // =========================================================================
    // HANDLING THE REDEPLOY DIALOG
    //
    // After clicking Redeploy, Joblogic shows either:
    //   • An inline panel very similar to the "Allocate Engineer" panel
    //     (radio buttons + engineer jl-select/Kendo dropdown + date inputs + button)
    //   • A Bootstrap/custom modal dialog
    //
    // We wait for either to appear, then fill engineer + dates + click confirm.
    // =========================================================================
    async function handleRedeployDialog(engineer, start, end) {
        // Wait for a visible dialog or a mutation in the allocate-panel area
        let scope;
        try {
            scope = await waitFor(() => {
                // Prefer an explicit modal
                const modal = qs('.modal.show, [role="dialog"]:not([aria-hidden="true"]), .modal[style*="display: block"]');
                if (modal && modal.offsetParent !== null) return modal;
                // Fall back to the allocate panel refreshing inside #visitsTab
                const panel = qs('#visitsTab');
                if (panel && panel.querySelector('#Engineer, [id*="Engineer"], input[data-role="combobox"]')) return panel;
                return null;
            }, { timeout: DIALOG_WAIT_MS, interval: 200 });
        } catch {
            // Last-ditch fallback: operate on the whole document
            scope = document;
            log('  WARN: dialog not detected — operating on full page', '#fa0');
        }

        // --- Engineer radio (if present — selects "Engineer" vs Team/Subcontractor) ---
        const radio = scope.querySelector('#Engineer, input[value="Engineer"][type="radio"]');
        if (radio && !radio.checked) {
            const lbl = radio.closest('label') || qs(`label[for="${radio.id}"]`, scope);
            if (lbl) { fire(lbl, 'mousedown'); fire(lbl, 'mouseup'); lbl.click(); }
            radio.checked = true;
            fire(radio, 'input'); fire(radio, 'change'); fire(radio, 'click');
            await sleep(250);
        }

        // --- Engineer name ---
        if (engineer) {
            const resolved = await setEngineerDropdown(scope, engineer);
            log(`  engineer: "${resolved || '(not set)'}"`, resolved ? '#0fa' : '#fa0');
        }

        // --- Dates ---
        if (start) {
            const startEl = scope.querySelector('#startDate, input[name*="start" i][type="text"], input[placeholder*="start" i]');
            if (startEl) { setNativeValue(startEl, start); log(`  start date: ${start}`); }
        }
        if (end) {
            const endEl = scope.querySelector('#endDate, input[name*="end" i][type="text"], input[placeholder*="end" i]');
            if (endEl) { setNativeValue(endEl, end); log(`  end date: ${end}`); }
        }

        await sleep(300);

        // --- Confirm button ---
        const confirmBtn = qsa('button, input[type="submit"]', scope).find(b => {
            const t = (b.textContent || b.value || '').trim().toLowerCase();
            return t === 'redeploy' || t === 'allocate' || t === 'confirm' || t === 'save' || t === 'submit';
        });
        if (!confirmBtn) throw new Error('Confirm button not found in redeploy dialog');
        confirmBtn.click();
        log(`  Clicked "${confirmBtn.textContent.trim() || confirmBtn.value}"`, '#0af');
    }

    // Set the engineer in a jl-select (Vue) or Kendo dropdown within `scope`.
    async function setEngineerDropdown(scope, engineerName) {
        const norm = s => (s || '').toLowerCase().trim();
        const want = norm(engineerName);

        // --- jl-select (Vue component) ---
        for (const el of qsa('.jl-select.jl--single, .jl-select', scope)) {
            if (el.classList.contains('jl--disabled')) continue;
            const vue = el.__vue__;
            if (!vue || !Array.isArray(vue.options) || !vue.options.length) continue;
            const labelProp = vue.$props?.label || 'Name';
            const match = vue.options.find(o => norm(o[labelProp]) === want)
                       || vue.options.find(o => norm(o[labelProp]).includes(want));
            if (match) {
                try { vue.select(match); return match[labelProp]; } catch {}
            }
        }

        // --- Kendo ComboBox / DropDownList ---
        const $ = window.jQuery || window.$;
        if ($) {
            for (const input of qsa('input[data-role="combobox"], input[data-role="dropdownlist"]', scope)) {
                const widget = $(input).data('kendoComboBox') || $(input).data('kendoDropDownList');
                if (!widget) continue;
                try { widget.enable(true); } catch {}
                const tf = widget.options.dataTextField  || 'Name';
                const vf = widget.options.dataValueField || 'Id';
                let items = (widget.dataSource.data && widget.dataSource.data()) || [];
                let match = items.find(d => norm(d[tf]) === want)
                         || items.find(d => norm(d[tf]).includes(want));
                if (!match) {
                    await new Promise(res => {
                        widget.dataSource.one('change', res);
                        widget.search(engineerName);
                        setTimeout(res, 2500);
                    });
                    items = (widget.dataSource.data && widget.dataSource.data()) || [];
                    match = items.find(d => norm(d[tf]) === want)
                          || items.find(d => norm(d[tf]).includes(want));
                }
                if (match) {
                    widget.value(match[vf]);
                    widget.trigger('change');
                    return match[tf];
                }
            }
        }

        return null;
    }

    // =========================================================================
    // PER-JOB HANDLER — runs on /Job/Detail/*
    // =========================================================================
    async function processCurrentJob(st) {
        const row = st.rows[st.currentIndex];
        log(`--- [${st.currentIndex + 1}/${st.rows.length}] ${row.ref} ---`, '#fff');

        // Make sure we're on the Visits tab
        if (!location.hash.includes('visitsTab')) {
            location.hash = 'visitsTab';
            await sleep(800);
        }

        // Wait for the visits table to render
        let visitRows = [];
        try {
            await waitFor(() => { visitRows = readVisitRows(); return visitRows.length > 0; },
                { timeout: 10000, interval: 300 });
        } catch {
            visitRows = readVisitRows();
        }
        log(`  ${visitRows.length} visit row(s) found`, '#0af');

        const normEng = (s) => (s || '').toLowerCase().trim();
        const engFilter = normEng(st.engineerFilter || '');

        const eligible = visitRows.filter(vRow => {
            if (!isEligible(vRow)) return false;
            if (!engFilter) return true;
            const { engineer } = parseVisitRow(vRow);
            return normEng(engineer).includes(engFilter) || engFilter.includes(normEng(engineer));
        });

        if (!eligible.length) {
            log(`  No eligible visits matching "${st.engineerFilter}" — skipping`, '#888');
            return { status: 'skipped' };
        }
        log(`  ${eligible.length} eligible for redeploy (matching "${st.engineerFilter}")`);

        let redeployed = 0, failed = 0;

        for (const vRow of eligible) {
            // Respect Stop between visits within the same job
            if (!loadState()?.running) {
                log('  Stopped by user', '#fa0');
                break;
            }

            const { engineer, start, end } = parseVisitRow(vRow);
            const icon = getIconFile(vRow);
            log(`  Visit: "${engineer}" | ${start} → ${end} | [${icon || 'unknown'}]`, '#888');

            if (st.dryRun) {
                log(`  [DRY] Would redeploy → "${engineer}" ${start}`, '#ff0');
                redeployed++;
                await sleep(0); // yield so Stop click can be processed
                continue;
            }

            const prevRowCount = readVisitRows().length;

            try {
                const trigger = await findRedeployTrigger(vRow);
                if (!trigger) {
                    log('  Redeploy button not found on this visit row — logging DOM for debug', '#f55');
                    // Emit a summary of buttons/links present so the user can report back
                    const btns = qsa('button, a[href], [role="button"]', vRow)
                        .map(el => `${el.tagName.toLowerCase()}[class="${el.className}"]: "${el.textContent.trim()}"`)
                        .slice(0, 8).join(' | ');
                    log(`    Row actions: ${btns || '(none found)'}`, '#666');
                    failed++;
                    continue;
                }

                trigger.click();
                await sleep(400);

                await handleRedeployDialog(engineer, start, end);

                // Wait for a new visit row to appear as confirmation
                let confirmed = false;
                try {
                    await waitFor(
                        () => readVisitRows().length > prevRowCount || null,
                        { timeout: CONFIRM_WAIT_MS, interval: 300 }
                    );
                    confirmed = true;
                } catch {
                    // Also accept if the icon on the original row changed to "redeployed"
                    const newIcon = getIconFile(vRow);
                    confirmed = /redeploy/i.test(newIcon);
                }

                if (confirmed) {
                    log('  Redeployed', '#0fa');
                    redeployed++;
                } else {
                    log(`  No confirmation received within ${CONFIRM_WAIT_MS / 1000}s — marking UNCONFIRMED`, '#fa0');
                    failed++;
                }

            } catch (e) {
                log(`  ERROR: ${e.message}`, '#f55');
                failed++;
            }

            await sleep(500);
        }

        return {
            status: redeployed > 0 ? 'ok' : (failed > 0 ? 'fail' : 'skipped'),
            redeployed, failed
        };
    }

    // =========================================================================
    // STATE
    // =========================================================================
    const loadState  = () => { try { const r = localStorage.getItem(STATE_KEY); return r ? JSON.parse(r) : null; } catch { return null; } };
    const saveState  = s  => { try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch {} };
    const clearState = () => { try { localStorage.removeItem(STATE_KEY); } catch {} };

    // =========================================================================
    // LOGGING
    // =========================================================================
    let logArea = null;

    function log(msg, color = '#ccc') {
        try {
            const arr = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
            arr.push({ msg, color });
            while (arr.length > LOG_MAX_LINES) arr.shift();
            localStorage.setItem(LOG_KEY, JSON.stringify(arr));
        } catch {}
        if (!logArea) return;
        const line = document.createElement('div');
        line.style.color = color;
        line.textContent = msg;
        logArea.appendChild(line);
        logArea.scrollTop = logArea.scrollHeight;
    }

    function replayLog() {
        if (!logArea) return;
        try {
            for (const { msg, color } of JSON.parse(localStorage.getItem(LOG_KEY) || '[]')) {
                const line = document.createElement('div');
                line.style.color = color || '#ccc';
                line.textContent = msg;
                logArea.appendChild(line);
            }
            logArea.scrollTop = logArea.scrollHeight;
        } catch {}
    }

    function clearLog() {
        try { localStorage.removeItem(LOG_KEY); } catch {}
        if (logArea) logArea.innerHTML = '';
    }

    // =========================================================================
    // UI PANEL
    // =========================================================================
    let panelEl, progressEl;

    function setProgress(msg) { if (progressEl) progressEl.textContent = msg; }

    function setRunningUI(running) {
        if (!panelEl) return;
        panelEl.querySelector('.btn-dry').style.display  = running ? 'none' : '';
        panelEl.querySelector('.btn-run').style.display  = running ? 'none' : '';
        panelEl.querySelector('.btn-stop').style.display = running ? '' : 'none';
    }

    function setActionButtonsEnabled(enabled) {
        if (!panelEl) return;
        panelEl.querySelector('.btn-dry').disabled = !enabled;
        panelEl.querySelector('.btn-run').disabled = !enabled;
    }

    function buildPanel() {
        if (document.getElementById('jl-redeploy-panel')) return;

        panelEl = document.createElement('div');
        panelEl.id = 'jl-redeploy-panel';
        panelEl.innerHTML = `
<style>
#jl-redeploy-panel {
  position:fixed; top:10px; right:10px; z-index:99999;
  background:#1a1a2e; color:#eee; border-radius:8px; width:520px;
  max-height:88vh; display:flex; flex-direction:column;
  font-family:monospace; font-size:12px;
  box-shadow:0 4px 20px rgba(0,0,0,.55);
}
#jl-redeploy-panel header {
  display:flex; justify-content:space-between; align-items:center;
  padding:10px 14px; border-bottom:1px solid #333; cursor:move; user-select:none;
}
#jl-redeploy-panel header b { font-size:13px; }
#jl-redeploy-panel .body { padding:10px 14px; display:flex; flex-direction:column; gap:8px; overflow-y:auto; }
#jl-redeploy-panel .progress { color:#0fa; font-weight:600; min-height:1.4em; }
#jl-redeploy-panel .controls { display:flex; gap:6px; flex-wrap:wrap; }
#jl-redeploy-panel button {
  background:#2563eb; color:#fff; border:0; border-radius:4px;
  padding:6px 12px; cursor:pointer; font-family:monospace; font-size:12px;
}
#jl-redeploy-panel .btn-scan  { background:#0891b2; }
#jl-redeploy-panel .btn-dry   { background:#ca8a04; }
#jl-redeploy-panel .btn-run   { background:#16a34a; }
#jl-redeploy-panel .btn-stop  { background:#991b1b; display:none; }
#jl-redeploy-panel .btn-reset { background:#4b5563; }
#jl-redeploy-panel .btn-close { background:transparent; border:none; color:#eee; font-size:16px; cursor:pointer; }
#jl-redeploy-panel button[disabled] { opacity:.4; cursor:not-allowed; }
#jl-redeploy-panel .hint { color:#6b7280; font-size:11px; line-height:1.45; }
#jl-redeploy-panel .log {
  background:#0a0a1a; padding:8px; border-radius:4px;
  overflow-y:auto; max-height:46vh;
  white-space:pre-wrap; word-break:break-word;
}
#jl-redeploy-panel .log div { padding:1px 0; line-height:1.35; }
</style>
<header>
  <b>Redeploy Visits</b>
  <button class="btn-close">×</button>
</header>
<div class="body">
  <div class="progress">Filter the Jobs list by engineer, then click Scan.</div>
  <div class="controls">
    <button class="btn-scan">Scan Jobs</button>
    <button class="btn-dry" disabled>Dry Run</button>
    <button class="btn-run" disabled>Redeploy All</button>
    <button class="btn-stop">Stop</button>
    <button class="btn-reset">Reset</button>
  </div>
  <div style="display:flex;align-items:center;gap:6px;">
    <label style="color:#9ca3af;white-space:nowrap;font-size:11px;">Engineer name:</label>
    <input class="eng-filter" type="text" placeholder="e.g. Joe Bloggs"
      style="flex:1;background:#0a0a1a;border:1px solid #374151;border-radius:3px;
             color:#eee;padding:4px 7px;font:12px monospace;">
  </div>
  <div class="hint">
    Only redeployes visits where the assigned engineer matches the name above.
    Navigates each job's Visits tab and clicks Redeploy — so the job reappears
    in the engineer's app.
  </div>
  <div class="log"></div>
</div>`;
        document.body.appendChild(panelEl);
        jlRegisterPanel(panelEl, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR);

        logArea   = panelEl.querySelector('.log');
        progressEl = panelEl.querySelector('.progress');

        // Drag to reposition
        const hdr = panelEl.querySelector('header');
        let drag = null;
        hdr.addEventListener('mousedown', e => {
            if (e.target.closest('button')) return;
            drag = { x: e.clientX - panelEl.offsetLeft, y: e.clientY - panelEl.offsetTop };
        });
        window.addEventListener('mouseup', () => drag = null);
        window.addEventListener('mousemove', e => {
            if (!drag) return;
            panelEl.style.left  = (e.clientX - drag.x) + 'px';
            panelEl.style.top   = (e.clientY - drag.y) + 'px';
            panelEl.style.right = 'auto';
        });

        panelEl.querySelector('.btn-close').onclick = () => { panelEl.style.display = 'none'; };
        panelEl.querySelector('.btn-scan').onclick  = () => onScan();
        panelEl.querySelector('.btn-dry').onclick   = () => onStart(true);
        panelEl.querySelector('.btn-run').onclick   = () => onStart(false);
        panelEl.querySelector('.btn-stop').onclick  = onStop;
        panelEl.querySelector('.btn-reset').onclick = onReset;
    }

    // =========================================================================
    // PAGINATION HELPER
    // =========================================================================
    // Returns the LI element for the next page, or null if on last page / not found.
    function findNextPageLi() {
        // Joblogic uses: ul.pagination > li.page-item.next (no .disabled = clickable)
        const li = qs('ul.pagination li.page-item.next');
        if (li && !li.classList.contains('disabled')) return li;
        return null;
    }

    function getActivePage() {
        const active = qs('ul.pagination li.page-item.active a, ul.pagination li.page-number.active a');
        return parseInt((active?.textContent || '0').trim(), 10);
    }

    // Log pagination-related elements for debugging
    // =========================================================================
    // BUTTON HANDLERS
    // =========================================================================
    async function onScan() {
        const scanBtn = panelEl?.querySelector('.btn-scan');
        if (scanBtn) scanBtn.disabled = true;

        const allJobs = [];
        const seen    = new Set();
        let   page    = 1;

        setProgress('Scanning page 1…');
        clearLog();

        while (true) {
            const pageJobs = scrapeJobsFromList();
            let newCount = 0;
            for (const j of pageJobs) {
                if (!seen.has(j.id)) { seen.add(j.id); allJobs.push(j); newCount++; }
            }
            log(`Page ${page}: +${newCount} jobs (${allJobs.length} total)`, '#0af');
            setProgress(`Scanning… page ${page}, ${allJobs.length} job(s) found`);

            const nextLi = findNextPageLi();
            if (!nextLi) {
                log('No further pages detected — scan complete.', '#0af');
                break;
            }

            const currentActivePage = getActivePage();

            const a = nextLi.querySelector('a.page-link') || nextLi.querySelector('a') || nextLi;

            // 1. Try Vue component methods — walk up from the LI to find a component
            let advanced = false;
            let el = nextLi;
            while (el && !advanced) {
                const vue = el.__vue__;
                if (vue) {
                    for (const m of ['nextPage', 'next', 'goNext', 'goToNextPage', 'handleNext', 'onClick', 'handleClick']) {
                        if (typeof vue[m] === 'function') {
                            try { vue[m](currentActivePage + 1); advanced = true; break; } catch {}
                            try { vue[m](); advanced = true; break; } catch {}
                        }
                    }
                    if (!advanced) {
                        for (const ev of ['next', 'change', 'page-change', 'click']) {
                            try { vue.$emit(ev, currentActivePage + 1); } catch {}
                        }
                    }
                }
                el = el.parentElement;
            }

            // 2. PointerEvent (Vue 3 and some component libs listen to pointer events)
            if (!advanced) {
                a.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
                a.dispatchEvent(new PointerEvent('pointerup',   { bubbles: true, cancelable: true }));
            }

            // 3. Full mouse + click sequence on both the <a> and parent <li>
            fire(a,      'mousedown'); fire(a,      'mouseup'); fire(a,      'click');
            fire(nextLi, 'mousedown'); fire(nextLi, 'mouseup'); fire(nextLi, 'click');

            // Detect page change by watching the active page number
            try {
                await waitFor(
                    () => getActivePage() > currentActivePage ? true : null,
                    { timeout: 8000, interval: 200 }
                );
            } catch {
                log('Pagination timed out — stopping at current page', '#fa0');
                break;
            }

            page++;
        }

        if (scanBtn) scanBtn.disabled = false;

        if (!allJobs.length) {
            setProgress('No jobs found — are you on the Jobs list with results visible?');
            return;
        }

        const st = {
            rows: allJobs.map(j => ({ ...j, status: 'pending', redeployed: 0, failed: 0, error: null })),
            currentIndex: 0,
            running: false,
            dryRun: false,
            phase: 'idle'
        };
        saveState(st);
        setActionButtonsEnabled(true);
        setProgress(`Found ${allJobs.length} job(s) across ${page} page(s). Click Dry Run to preview, or Redeploy All to run.`);
        log(`Scan complete — ${allJobs.length} jobs:`, '#0fa');
        allJobs.slice(0, 30).forEach(j => log(`  ${j.ref}  (id=${j.id})`));
        if (allJobs.length > 30) log(`  …and ${allJobs.length - 30} more`);
    }

    async function onStart(dryRun) {
        const st = loadState();
        if (!st?.rows?.length) { setProgress('No jobs loaded — click Scan first.'); return; }
        const engFilter = (panelEl?.querySelector('.eng-filter')?.value || '').trim();
        if (!engFilter) { setProgress('Enter the engineer name before running.'); return; }
        if (!dryRun) {
            if (!confirm(`Redeploy visits for "${engFilter}" on ${st.rows.length} job(s)? This navigates each job and clicks Redeploy on matching visits.`)) return;
        }
        st.running = true;
        st.dryRun  = dryRun;
        st.engineerFilter = engFilter;
        st.currentIndex = 0;
        st.rows.forEach(r => { r.status = 'pending'; r.error = null; r.redeployed = 0; r.failed = 0; });
        st.phase = 'navigating';
        saveState(st);
        clearLog();
        setRunningUI(true);
        await runDispatcher();
    }

    function onStop() {
        const st = loadState();
        if (st) { st.running = false; st.phase = 'stopped'; saveState(st); }
        setRunningUI(false);
        setProgress('Stopped — click Redeploy All to resume from where it left off, or Reset to clear.');
    }

    function onReset() {
        if (!confirm('Clear loaded jobs and log?')) return;
        clearState();
        clearLog();
        setProgress('Filter the Jobs list by engineer, then click Scan.');
        setRunningUI(false);
        setActionButtonsEnabled(false);
    }

    // =========================================================================
    // PAGE-NAVIGATION STATE MACHINE
    // =========================================================================
    let __busy = false;

    async function runDispatcher() {
        if (__busy) return;
        __busy = true;
        try {
            const st = loadState();
            if (!st?.running) return;

            const row = st.rows[st.currentIndex];
            if (!row) { finishRun('All jobs processed.'); return; }

            const expectedPath = `/Job/Detail/${row.id}`;
            if (!location.pathname.toLowerCase().startsWith(expectedPath.toLowerCase())) {
                location.href = `${expectedPath}?pageIndex=1#visitsTab`;
                return; // New page load resumes the dispatcher
            }

            setProgress(`Job ${st.currentIndex + 1}/${st.rows.length}: ${row.ref}`);

            let result;
            try {
                result = await processCurrentJob(st);
                row.status     = result.status;
                row.redeployed = result.redeployed || 0;
                row.failed     = result.failed     || 0;
            } catch (e) {
                log(`ERROR on ${row.ref}: ${e.message}`, '#f55');
                row.status = 'error';
                row.error  = e.message;
            }

            // Advance to the next pending row
            st.rows[st.currentIndex] = row;
            st.currentIndex++;
            while (st.currentIndex < st.rows.length && !st.rows[st.currentIndex]?.id) {
                st.rows[st.currentIndex].status = 'skipped';
                st.currentIndex++;
            }

            if (st.currentIndex >= st.rows.length) {
                st.running = false;
                st.phase   = 'done';
                saveState(st);
                finishRun(`Done — ${st.rows.length} job(s) processed.`);
                return;
            }

            saveState(st);
            await sleep(700);
            const next = st.rows[st.currentIndex];
            location.href = `/Job/Detail/${next.id}?pageIndex=1#visitsTab`;

        } catch (e) {
            log('Dispatcher error: ' + e.message, '#f55');
            const st = loadState();
            if (st) { st.running = false; saveState(st); }
            setRunningUI(false);
        } finally {
            __busy = false;
        }
    }

    function finishRun(msg) {
        const st = loadState();
        if (st) { st.running = false; st.phase = 'done'; saveState(st); }
        setRunningUI(false);
        setProgress(msg);
        log(msg, '#0fa');
        if (st?.rows) {
            const ok      = st.rows.filter(r => r.status === 'ok').length;
            const skipped = st.rows.filter(r => r.status === 'skipped').length;
            const failed  = st.rows.filter(r => ['fail', 'error'].includes(r.status)).length;
            log(`Summary — ok: ${ok}, skipped: ${skipped}, failed: ${failed}`, '#0af');

            const withVisits = st.rows.filter(r => r.redeployed > 0);
            if (withVisits.length) {
                log(`Jobs with eligible visits (${withVisits.length}):`, '#0af');
                withVisits.forEach(r =>
                    log(`  ${r.ref}  — ${r.redeployed} visit(s)${r.failed ? `, ${r.failed} failed` : ''}`, '#ccc')
                );
            }
        }
    }

    // =========================================================================
    // BOOT
    // =========================================================================
    const SCRIPT_VERSION = '1.16';

    function boot() {
        buildPanel();
        replayLog();
        log(`Redeploy Visits v${SCRIPT_VERSION} loaded`, '#444');

        const st = loadState();
        if (st?.rows?.length) {
            const done = st.rows.filter(r => r.status && r.status !== 'pending').length;
            setProgress(`${done}/${st.rows.length} processed — phase: ${st.phase}${st.running ? ' (running)' : ''}`);
            setActionButtonsEnabled(true);
            // Restore the engineer filter input so it survives page navigations
            if (st.engineerFilter) {
                const engInput = panelEl?.querySelector('.eng-filter');
                if (engInput) engInput.value = st.engineerFilter;
            }
            if (st.running) {
                setRunningUI(true);
                log('Resuming run...', '#0af');
                setTimeout(runDispatcher, 1500);
            }
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
