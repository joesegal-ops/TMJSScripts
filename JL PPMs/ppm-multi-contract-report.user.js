// ==UserScript==
// @name         JL: PPM Multi-Contract Report
// @namespace    https://go.joblogic.com/
// @version      3.34
// @description  On the PPM Contracts list page, read every visible contract (skipping Suspended), collect all visits, and generate a single combined Untitled Projects branded matrix report. v3.27: collapses to a launcher button in the shared dock (drag to reorder).
// @match        https://go.joblogic.com/PPMContract*
// @grant        none
// @run-at       document-idle
// @downloadURL https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20PPMs/ppm-multi-contract-report.user.js
// @updateURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20PPMs/ppm-multi-contract-report.user.js
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

    const SCRIPT_ID = 'ppm-multi-contract';
    const SCRIPT_LABEL = '📊 Multi-Contract PPM Report';
    const SCRIPT_COLOR = '#4c9f01';

    if (window.__ppmMultiReportLoaded) return;
    window.__ppmMultiReportLoaded = true;

    const VERSION   = '3.26';
    const STATE_KEY = 'ppm-multi-report-v1';
    const PLOG_KEY  = 'ppm-multi-log-v1';

    // ─── Persistent log buffer ─────────────────────────────────────────────────
    // Survives page-to-page navigation (localStorage). After a run, open the
    // browser console and type:  ppmShowLog()
    // to see every log line from the entire run, OR:  ppmCopyLog()
    // to copy it to the clipboard.
    function _ppmWrite(prefix, args) {
        try {
            const msg = args.map(a =>
                typeof a === 'string' ? a
                : (a instanceof Error) ? a.message
                : JSON.stringify(a)
            ).join(' ');
            const entry = new Date().toISOString().slice(11, 23) + ' ' + prefix + ' ' + msg;
            const arr = JSON.parse(localStorage.getItem(PLOG_KEY) || '[]');
            arr.push(entry);
            if (arr.length > 3000) arr.splice(0, arr.length - 3000);
            localStorage.setItem(PLOG_KEY, JSON.stringify(arr));
        } catch { /* storage full or unavailable */ }
    }
    // Pass-through wrappers — call sites keep their existing '[PPM-Multi]' first arg;
    // we just also write the same args to the persistent log buffer.
    function ppmLog(...args)  { console.log(...args);  _ppmWrite('LOG ', args); }
    function ppmWarn(...args) { console.warn(...args); _ppmWrite('WARN', args); }

    // Exposed globally so you can call them in the DevTools console after a run
    window.ppmShowLog  = () => {
        const arr = JSON.parse(localStorage.getItem(PLOG_KEY) || '[]');
        const txt = `=== PPM Multi Log — ${arr.length} entries ===\n` + arr.join('\n');
        console.log(txt);
        return txt;
    };
    window.ppmCopyLog  = () => {
        const txt = window.ppmShowLog();
        navigator.clipboard?.writeText(txt)
            .then(() => console.log('Log copied to clipboard.'))
            .catch(() => console.log('Clipboard copy failed — use ppmShowLog() output above.'));
    };
    window.ppmClearLog = () => { localStorage.removeItem(PLOG_KEY); console.log('PPM log cleared.'); };

    // ─── Page detection ───────────────────────────────────────────────────────
    const isDetailPage = /\/PPMContract\/Detail\//i.test(location.pathname);
    const isListPage   = !isDetailPage;

    // ─── Utilities ────────────────────────────────────────────────────────────
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const qs    = (s, r = document) => r.querySelector(s);
    const qsa   = (s, r = document) => [...r.querySelectorAll(s)];

    function waitFor(fn, { timeout = 14000, interval = 200 } = {}) {
        return new Promise((resolve, reject) => {
            const t0 = Date.now();
            (function tick() {
                const v = fn();
                if (v) return resolve(v);
                if (Date.now() - t0 > timeout) return reject(new Error('waitFor timeout'));
                setTimeout(tick, interval);
            })();
        });
    }

    // ─── Persistent state ─────────────────────────────────────────────────────
    function loadState() {
        try {
            const s = JSON.parse(localStorage.getItem(STATE_KEY) || 'null');
            // State from an incompatible script version may have a different schema.
            // Discard it silently so stale state never causes a hang or crash.
            // Allow 3.22 / 3.26 state to resume in either version — schema is identical.
            const sv = s ? (s.stateVersion || '') : '';
            const compatible = !s || sv === VERSION || /^3\.2[23]$/.test(sv);
            if (!compatible) {
                console.warn(`[PPM-Multi] Discarding state from v${sv || '?'} (current v${VERSION})`);
                localStorage.removeItem(STATE_KEY);
                return null;
            }
            return s;
        } catch { return null; }
    }
    function saveState(s) { try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch {} }
    function clearState() { localStorage.removeItem(STATE_KEY); }

    // ─── Date helpers ─────────────────────────────────────────────────────────
    function parseUKDate(str) {
        if (!str) return null;
        const m = String(str).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
        if (!m) return null;
        const d = new Date(+m[3], +m[2] - 1, +m[1], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
        return isNaN(d) ? null : d;
    }

    const SHORT_MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const FULL_MON  = ['January','February','March','April','May','June',
                       'July','August','September','October','November','December'];

    function monthKey(d)    { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }
    function monthLabel(mk) {
        const [y, m] = mk.split('-');
        return `${SHORT_MON[+m-1]} '${String(y).slice(2)}`;
    }
    function monthFull(mk) {
        const [y, m] = mk.split('-');
        return `${FULL_MON[+m-1]} ${y}`;
    }

    // ─── Service categorisation (matches single-contract script) ─────────────
    const CAT_RULES = [
        { name:'Water Hygiene', accent:'#0097A7', bg:'#e0f7fa', border:'#80deea', text:'#006064',
          re:/water|flush|tmv|legionella|sentinel|temperature test|sampling|risk assess|annual review|chlorin/i },
        { name:'Electrical',    accent:'#FFAB40', bg:'#fff8e1', border:'#ffe082', text:'#e65100',
          re:/electric|lights|lighting|eicr|pat test|ups\b|power|emergency light|distribution board|consumer unit/i },
        { name:'Fire Safety',   accent:'#f43f5e', bg:'#fff1f2', border:'#fecdd3', text:'#9f1239',
          re:/fire alarm|fire door|sprinkler|extinguish|suppression|smoke|detection/i },
        { name:'HVAC',          accent:'#10b981', bg:'#ecfdf5', border:'#a7f3d0', text:'#065f46',
          re:/hvac|vrv|vrf|air.?con|a\/c|\bac\b|fan coil|chiller|heat pump|ahu|ventilation|cooling/i },
        { name:'Mechanical',    accent:'#8b5cf6', bg:'#f5f3ff', border:'#ddd6fe', text:'#4c1d95',
          re:/boiler|heating|gas|pump|plumb|plant|pressure|valve|pipework/i },
    ];
    const CAT_GENERAL = { name:'General', accent:'#4285F4', bg:'#e8f0fe', border:'#aecbfa', text:'#1a73e8' };
    const CAT_PO = { name:'Purchase Orders', accent:'#f59e0b', bg:'#fffbeb', border:'#fde68a', text:'#92400e' };

    function categorise(desc) {
        for (const rule of CAT_RULES) if (rule.re.test(desc)) return rule;
        return CAT_GENERAL;
    }

    // ─── Visit status detection ───────────────────────────────────────────────
    function readDurationFromScope(scope) {
        for (const lbl of qsa('label', scope)) {
            if (!/duration/i.test(lbl.textContent)) continue;
            const forId = lbl.getAttribute('for');
            const inp   = forId
                ? scope.querySelector('#' + CSS.escape(forId))
                : lbl.parentElement?.querySelector('input[type="number"], input[type="text"]');
            if (inp) {
                const v = parseFloat((inp.value || '').replace(/[^\d.]/g, ''));
                if (!isNaN(v) && v > 0) return v;
            }
        }
        return null;
    }

    async function readDurationFromRow(row) {
        const details = row.querySelector('.visit-details');
        if (details && getComputedStyle(details).display !== 'none' && details.childElementCount > 0)
            return readDurationFromScope(details);
        const trigger = row.querySelector('.visit-info-description, .visit-info') || row;
        trigger.click();
        await sleep(400);
        const d2  = row.querySelector('.visit-details');
        const dur = (d2 && d2.childElementCount > 0) ? readDurationFromScope(d2) : null;
        trigger.click();
        return dur;
    }

    function detectStatus(row, effectiveEnd) {
        const label     = qs('.label', row);
        const labelText = (label ? label.textContent : '').trim().toLowerCase();
        if (/complet/.test(labelText))  return 'complete';
        if (/cancel/.test(labelText))   return 'cancelled';
        if (effectiveEnd && effectiveEnd < new Date()) return 'overdue';
        if (/new.?job|allocat|in.?progress|open|raised|active/.test(labelText)) return 'raised';
        const rc = row.className || '';
        if (/list-group-item-success/.test(rc)) return 'complete';
        if (/list-group-item-danger/.test(rc))  return 'overdue';
        if (/list-group-item-warning/.test(rc)) return 'raised';
        return 'pending';
    }

    // ─── Read all visits from the current PPM Contract detail page ────────────
    async function readVisitsFromPage() {
        const rows = qsa('#ppmVisits ul.list-group > li.list-group-item')
            .filter(r => r.offsetParent !== null);

        const visits = [];
        for (const row of rows) {
            const pEl         = qs('p', row);
            const description = pEl
                ? (pEl.textContent.split('\n').map(l => l.trim()).filter(Boolean)[0] || 'PPM Visit')
                : 'PPM Visit';

            const dateEl  = qs('span.ml12', row);
            const dueDate = dateEl ? parseUKDate(dateEl.textContent.trim()) : null;

            let effectiveEnd = null;
            if (dueDate) {
                const now          = new Date();
                const msInPast     = now - dueDate;
                const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
                if (msInPast > 0 && msInPast < thirtyDaysMs) {
                    const dur = await readDurationFromRow(row);
                    effectiveEnd = dur
                        ? new Date(dueDate.getTime() + dur * 60 * 1000)
                        : new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate(), 23, 59, 59);
                } else if (msInPast >= thirtyDaysMs) {
                    effectiveEnd = dueDate;
                }
            }

            const status    = detectStatus(row, effectiveEnd);
            const jobLinkEl = row.querySelector('a[href*="/Job/"]');
            const rawHref   = jobLinkEl ? jobLinkEl.getAttribute('href') : null;
            // Make absolute — the report opens as about:blank, so relative paths break
            const jobUrl    = rawHref
                ? (rawHref.startsWith('http') ? rawHref : `${location.origin}${rawHref}`)
                : null;
            if (!jobUrl) ppmLog('[PPM-Multi] No job link found in visit row — anchors in row:', row.querySelectorAll('a').length, [...row.querySelectorAll('a')].map(a=>a.getAttribute('href')).join(', '));
            visits.push({
                dueDate: dueDate ? dueDate.toISOString() : null,
                description,
                status,
                jobUrl,
            });
        }
        return visits;
    }

    // ─── Read Contract POs from the current PPM Contract detail page ──────────
    // scope: the CPO tab panel element to search within (avoids picking up the
    //        visits grid or other tables that are still in the DOM)
    async function readPOsFromPage(scope = document) {
        const today = new Date(); today.setHours(0,0,0,0);
        const $     = window.jQuery || window.$;
        const pos   = [];

        // Handles UK strings (DD/MM/YYYY), ISO strings, and Kendo Date objects
        const parsePoDate = v => {
            if (!v) return null;
            if (v instanceof Date) return isNaN(v) ? null : v;
            const uk = parseUKDate(String(v));
            if (uk) return uk;
            const iso = new Date(v);
            return isNaN(iso) ? null : iso;
        };

        ppmLog('[PPM-Multi] readPOsFromPage — scope:', scope === document ? 'document' : (scope.id || scope.className || 'panel'));

        try {
            // ── Try Kendo grid approach — scoped to the CPO panel ────────────────
            const gridEl = qs('[data-role="grid"]', scope);
            ppmLog('[PPM-Multi] CPO grid element:', !!gridEl, gridEl ? (gridEl.id || '') : '');

            if (gridEl && $) {
                const grid = $(gridEl).data('kendoGrid');
                ppmLog('[PPM-Multi] Kendo grid widget:', !!grid);

                if (grid) {
                    const ds      = grid.dataSource;
                    const domRows = qsa('tr[data-uid]', gridEl);
                    ppmLog('[PPM-Multi] CPO dom rows (data-uid):', domRows.length);

                    // Helper — convert one raw Kendo item to a PO record
                    const itemToPO = raw => {
                        // Cast a wide net over Joblogic's possible field names
                        const poNumber  = raw.PONumber || raw.PoNumber || raw.poNumber
                            || raw.CPONumber || raw.CpoNumber || raw.CPONo
                            || raw.ContractPurchaseOrderNumber || raw.ContractPONumber
                            || raw.PurchaseOrderNumber || raw.Number || '';
                        const reference = raw.ReferenceNumber || raw.Reference || raw.Ref
                            || raw.reference || raw.CPOReference || raw.CPORef || '';
                        // Prefer actual completion date for completed CPOs; fall back to estimated
                        const estVal    = raw.ActualCompletionDate || raw.DateCompleted
                            || raw.CompletedDate || raw.EstimatedCompletionDate
                            || raw.EstimatedDate || raw.TargetDate || raw.DueDate
                            || raw.CompletionDate || raw.PlannedDate || raw.ScheduledDate || null;
                        const statusStr = (raw.Status || raw.StatusName || raw.CPOStatus
                            || raw.POStatus || raw.ContractPurchaseOrderStatus || '').trim();
                        const estDate   = parsePoDate(estVal);
                        const estISO    = estDate ? estDate.toISOString() : null;
                        let status;
                        // Match "Fully Complete", "Complete", "Completed", "Fully Completed"
                        // BUT NOT "Not Completed" / "Incomplete" — test requires either "fully"
                        // prefix OR the word to be at the START of the string after trimming.
                        const isCompleteKendo = /\bfully.?complet/i.test(statusStr)
                            || /^complet(?:e|ed)?\b/i.test(statusStr.trim());
                        if (isCompleteKendo)                        status = 'complete';
                        else if (estDate && estDate < today)        status = 'overdue';
                        else                                        status = 'pending';
                        return { poNumber, reference, estimatedDate: estISO, status };
                    };

                    if (domRows.length > 0) {
                        const sample = domRows[0];
                        const sampleItem = ds.getByUid(sample.getAttribute('data-uid'));
                        if (sampleItem) {
                            const s = sampleItem.toJSON ? sampleItem.toJSON() : sampleItem;
                            ppmLog('[PPM-Multi] Kendo PO fields (uid):', Object.keys(s).join(', '));
                            ppmLog('[PPM-Multi] Kendo PO sample:', JSON.stringify(s).slice(0, 400));
                        }
                        for (const row of domRows) {
                            const uid  = row.getAttribute('data-uid');
                            const item = uid ? ds.getByUid(uid) : null;
                            if (!item) continue;
                            const po = itemToPO(item.toJSON ? item.toJSON() : item);
                            // If field-name guessing missed the CPO number, grab the link text
                            // from the DOM row — Joblogic renders the CPO ref as the link label
                            const linkEl = row.querySelector('a[href*="/ContractPurchaseOrder/"]');
                            if (linkEl) {
                                const rawHref = linkEl.getAttribute('href') || '';
                                po.poUrl = rawHref.startsWith('http') ? rawHref : `${location.origin}${rawHref}`;
                                if (!po.poNumber && !po.reference)
                                    po.poNumber = (linkEl.textContent || '').trim();
                            }
                            pos.push(po);
                        }
                        ppmLog('[PPM-Multi] CPO via uid rows:', pos.length);
                        return pos;
                    }

                    // ds.data() fallback (client-side grids)
                    const allLoaded = ds.data ? [...ds.data()] : [];
                    ppmLog('[PPM-Multi] CPO ds.data() items:', allLoaded.length);
                    if (allLoaded.length > 0) {
                        const s = allLoaded[0].toJSON ? allLoaded[0].toJSON() : allLoaded[0];
                        ppmLog('[PPM-Multi] Kendo PO fields (ds):', Object.keys(s).join(', '));
                        ppmLog('[PPM-Multi] Kendo PO sample:', JSON.stringify(s).slice(0, 400));
                        allLoaded.forEach(item => pos.push(itemToPO(item.toJSON ? item.toJSON() : item)));
                        return pos;
                    }
                }
            }

            // ── DOM table fallback — scoped strictly to the CPO panel ────────────
            const tbl = qs('table', scope);
            ppmLog('[PPM-Multi] CPO DOM table fallback:', !!tbl);
            if (tbl) {
                const headerCells = qsa('thead th, thead td', tbl);
                const headers     = headerCells.map(th => (th.textContent || '').trim().toLowerCase().replace(/\s+/g,' '));
                ppmLog('[PPM-Multi] CPO table headers:', headers.join(' | '));

                // Match "PO Number", "CPO Number", "Contract PO Number", etc.
                const poIdx   = headers.findIndex(h => /^c?po.?(?:number|no\.?|ref)?$|^purchase.*order$|^contract.?po/.test(h));
                const refIdx  = headers.findIndex(h => /reference/i.test(h));
                // Estimated completion date column
                const dateIdx     = headers.findIndex(h =>
                    /estimated/i.test(h) ||
                    /target.?date/i.test(h) ||
                    /due.?date/i.test(h) ||
                    /planned.?date/i.test(h) ||
                    /\bcompletion.?date\b/i.test(h)
                );
                // Actual completion date — used for completed CPOs (more accurate than estimated)
                const actDateIdx  = headers.findIndex(h => /actual.?(completion|date)/i.test(h));
                // Prefer "Completion Status" over generic "PO Status" / "Invoice Status"
                let statIdx   = headers.findIndex(h => /completion.?status/i.test(h));
                if (statIdx < 0) statIdx = headers.findIndex(h => /status/i.test(h));

                ppmLog('[PPM-Multi] CPO col indices — po:', poIdx, 'ref:', refIdx, 'date:', dateIdx, 'stat:', statIdx);

                const bodyRows = qsa('tbody tr', tbl);
                for (const row of bodyRows) {
                    const cells = qsa('td', row);
                    if (!cells.length) continue;
                    const poNumber   = poIdx     >= 0 ? (cells[poIdx]?.textContent     || '').trim() : '';
                    const reference  = refIdx    >= 0 ? (cells[refIdx]?.textContent    || '').trim() : '';
                    const estStr     = dateIdx   >= 0 ? (cells[dateIdx]?.textContent   || '').trim() : '';
                    const actStr     = actDateIdx >= 0 ? (cells[actDateIdx]?.textContent || '').trim() : '';
                    const statusStr  = statIdx   >= 0 ? (cells[statIdx]?.textContent   || '').trim() : '';
                    // For completed CPOs use the actual completion date (accurate month);
                    // fall back to estimated for in-progress / pending CPOs.
                    // Guard against "Not Completed" / "Incomplete": require "fully" prefix OR
                    // the word to appear at the START of the trimmed status string.
                    const isComplete = /\bfully.?complet/i.test(statusStr)
                        || /^complet(?:e|ed)?\b/i.test(statusStr.trim());
                    const dateStr    = (isComplete && actStr) ? actStr : estStr;
                    const estDate    = parsePoDate(dateStr);
                    const estISO     = estDate ? estDate.toISOString() : null;
                    let status;
                    if (isComplete)                        status = 'complete';
                    else if (estDate && estDate < today)   status = 'overdue';
                    else                                   status = 'pending';
                    // Capture the CPO detail link — also use its text as a last-resort identifier
                    // (Joblogic renders the CPO reference, e.g. "CPO00076", as the link label)
                    const cpoLinkEl = row.querySelector('a[href*="/ContractPurchaseOrder/"]');
                    const rawCpoHref = cpoLinkEl ? (cpoLinkEl.getAttribute('href') || '') : '';
                    const poUrl      = rawCpoHref
                        ? (rawCpoHref.startsWith('http') ? rawCpoHref : `${location.origin}${rawCpoHref}`)
                        : null;
                    const linkText  = cpoLinkEl ? (cpoLinkEl.textContent || '').trim() : '';
                    // Use link text as identifier if the column-based parse gave nothing
                    const finalNum  = poNumber || linkText;
                    ppmLog('[PPM-Multi] CPO row:', finalNum, '| ref:', reference, '| est:', estStr, '| stat:', statusStr, '| status->', status);
                    if (finalNum || reference) pos.push({ poNumber: finalNum, reference, estimatedDate: estISO, status, poUrl });
                }
                ppmLog('[PPM-Multi] CPO DOM rows found:', pos.length);
            }
        } catch (e) {
            ppmWarn('[PPM-Multi] readPOsFromPage error:', e.message);
        }

        return pos;
    }

    // ─── Read contract meta from the current detail page ─────────────────────
    function readContractMeta() {
        const meta = { ref: '', site: '', customer: '', description: '' };

        // ── Contract reference ────────────────────────────────────────────────
        const titleMatch = document.title.match(/^(PM\d+)/);
        if (titleMatch) meta.ref = titleMatch[1];
        if (!meta.ref) {
            const h3m = qs('h3')?.textContent.match(/PM\d+/);
            if (h3m) meta.ref = h3m[0];
        }

        // ── Site, customer, and Plan Reference from detail tab labels ────────────
        const detailTab = qs('#detailTab');
        if (detailTab) {
            for (const lbl of qsa('label', detailTab)) {
                const txt   = lbl.textContent.toLowerCase().trim().replace(/[*:.]/g, '');
                const forId = lbl.getAttribute('for');
                if (!forId || forId === 'null') continue;
                const valEl = qs('#' + CSS.escape(forId));
                const val   = valEl ? (valEl.value || valEl.textContent || '').trim() : '';
                if (!val) continue;
                if (/^site\b/.test(txt) && !meta.site)             meta.site        = val;
                if (/customer|client/.test(txt) && !meta.customer) meta.customer    = val;
                // Target "Plan Reference" — the human-readable plan name (list page col 1)
                if (/plan.?ref/i.test(txt) && !meta.description)
                    meta.description = val;
            }
        }

        return meta;
    }

    // ─── HTML escaping ────────────────────────────────────────────────────────
    function esc(s) {
        return String(s ?? '')
            .replace(/&/g,'&amp;').replace(/</g,'&lt;')
            .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }

    // ─── Cell rendering config (shared) ──────────────────────────────────────
    const CELL_CFG = {
        complete:  { bg:'#f0fdf4', icon:'✓', ic:'#16a34a', border:'#86efac', label:'Complete'    },
        overdue:   { bg:'#fff1f2', icon:'!', ic:'#dc2626', border:'#fca5a5', label:'Overdue'     },
        raised:    { bg:'#fff8e1', icon:'◎', ic:'#d97706', border:'#fcd34d', label:'In Progress' },
        pending:   { bg:'#f8fafc', icon:'–', ic:'#94a3b8', border:'#cbd5e1', label:'Scheduled'   },
        cancelled: { bg:'#f3f4f6', icon:'×', ic:'#9ca3af', border:'#d1d5db', label:'Cancelled'   },
    };

    const RANK = { complete:0, pending:1, raised:2, overdue:3, cancelled:1 };
    function cellBg(cellVisits) {
        const worst = cellVisits.reduce((acc, v) => {
            const s = v.status || 'pending';
            return (RANK[s] ?? 1) > (RANK[acc] ?? 0) ? s : acc;
        }, 'complete');
        return (CELL_CFG[worst] || CELL_CFG.pending).bg;
    }

    function renderCell(mk, cell, thisMonthKey) {
        const isCur  = mk === thisMonthKey;
        const sorted = [...cell.visits].sort((a, b) => a.day - b.day);
        const bg     = cellBg(cell.visits);
        const dots   = sorted.map(v => {
            const cfg   = CELL_CFG[v.status] || CELL_CFG.pending;
            const inner = `<div style="width:15px;height:15px;border-radius:3px;flex-shrink:0;` +
                `background:${cfg.bg};border:1.5px solid ${cfg.border};` +
                `display:inline-flex;align-items:center;justify-content:center;` +
                `font-size:9px;font-weight:800;color:${cfg.ic};line-height:1;" ` +
                `title="${cfg.label} · ${v.day}">${cfg.icon}</div>`;
            return v.jobUrl
                ? `<a href="${esc(v.jobUrl)}" target="_blank" style="text-decoration:none;line-height:0;" title="Open job — ${cfg.label} · ${v.day}">${inner}</a>`
                : inner;
        }).join('');
        return `<td class="mcol" style="background:${bg};border:1px solid #f1f5f9;padding:5px 3px;` +
            `vertical-align:middle;min-width:66px;` +
            `${isCur ? 'outline:2px solid #0097A7;outline-offset:-2px;' : ''}">` +
            `<div style="display:flex;flex-wrap:wrap;gap:2px;justify-content:center;align-items:center;">` +
            `${dots}</div></td>`;
    }

    // ─── Build the single combined matrix across all contracts ────────────────
    function buildCombinedMatrix(contractDataList) {
        const today        = new Date(); today.setHours(0,0,0,0);
        const thisMonthKey = monthKey(today);

        // rows: { contractRef, description, category, months: { 'YYYY-MM': { visits: [{day, status}] } }, type }
        const rows     = [];
        const monthSet = new Set();

        for (const cd of contractDataList) {
            const contractRef = (cd.meta && cd.meta.ref) ? cd.meta.ref : '';

            // Best description for this contract — used for PO rows and empty rows.
            // Prefer the meta description read from the detail page; fall back to the
            // first visit's description (contracts with visits share their service name).
            const contractDesc = (cd.meta && cd.meta.description)
                || (cd.visits && cd.visits.length > 0 ? cd.visits[0].description : '')
                || '';

            // Visit rows
            for (const v of (cd.visits || [])) {
                if (!v.dueDate) continue;
                const d   = new Date(v.dueDate);
                const mk  = monthKey(d);
                const day = d.getDate();
                monthSet.add(mk);

                // Find or create a row for this (contractRef, description) pair
                let row = rows.find(r => r.type === 'visit' && r.contractRef === contractRef && r.description === v.description);
                if (!row) {
                    row = {
                        contractRef,
                        description: v.description,
                        category: categorise(v.description),
                        months: {},
                        type: 'visit',
                    };
                    rows.push(row);
                }

                if (!row.months[mk]) row.months[mk] = { visits: [] };
                row.months[mk].visits.push({ day, status: v.status, jobUrl: v.jobUrl || null });
            }

            // PO rows — no longer a separate "Purchase Orders" section.
            // Category is derived from the contract description so POs sit alongside
            // the visit rows for the same contract. The service label appends the PO
            // identifier to the contract description.
            for (const po of (cd.pos || [])) {
                // If no estimated date, place the dot in the current month so the
                // CPO still appears in the matrix rather than being silently dropped
                const d   = po.estimatedDate ? new Date(po.estimatedDate) : today;
                const mk  = monthKey(d);
                const day = d.getDate();
                monthSet.add(mk);

                // Service label: "Contract Description · CPO00076" (or fallback)
                const poId = po.poNumber || po.reference || 'CPO';
                const desc = contractDesc
                    ? `${contractDesc} · ${poId}`
                    : (po.poNumber
                        ? `PO ${po.poNumber}${po.reference ? ' · ' + po.reference : ''}`
                        : (po.reference || 'Purchase Order'));

                // Categorise by contract description, not as a generic PO
                const category = contractDesc ? categorise(contractDesc) : CAT_PO;

                let row = rows.find(r => r.type === 'po' && r.contractRef === contractRef && r.description === desc);
                if (!row) {
                    row = {
                        contractRef,
                        description: desc,
                        poUrl: po.poUrl || null, // absolute URL — links the CPO ID in the Service column
                        category,
                        months: {},
                        type: 'po',
                    };
                    rows.push(row);
                }

                if (!row.months[mk]) row.months[mk] = { visits: [] };
                row.months[mk].visits.push({ day, status: po.status, jobUrl: po.poUrl || null });
            }
        }

        // Contracts with no visits AND no CPOs still get one placeholder row so they
        // appear in the table with the calendar cells left blank.
        // Use the contract description (from meta) so the Service column shows the
        // plan name rather than a generic "no visits / no CPO" label.
        const contractsWithRows = new Set(rows.map(r => r.contractRef));
        for (const cd of contractDataList) {
            const ref  = (cd.meta && cd.meta.ref) ? cd.meta.ref : '';
            if (!ref || contractsWithRows.has(ref)) continue;
            const desc = (cd.meta && cd.meta.description) || '';
            rows.push({
                contractRef: ref,
                description: desc,
                category:    desc ? categorise(desc) : CAT_GENERAL,
                months:      {},
                type:        'empty',
            });
        }

        // Track which contractRefs have at least one PO — used to badge the Contract column
        const cpoContractRefs = new Set(
            contractDataList
                .filter(cd => cd.pos && cd.pos.length > 0)
                .map(cd => (cd.meta && cd.meta.ref) ? cd.meta.ref : '')
                .filter(Boolean)
        );

        if (!monthSet.size) {
            return {
                tableHtml: '<p style="text-align:center;padding:40px;color:#9ca3af;">No visit data found.</p>',
                monthHeaders: '',
                total: 0, complete: 0, overdue: 0, upcoming: 0, pct: 0, pctColor: '#0097A7',
            };
        }

        // Fill every month between the earliest and latest so the table has no gaps.
        // Cap at 60 consecutive months to prevent far-future CPO dates or old historical
        // visits from creating a table with hundreds of empty columns (which is slow to
        // render). Months with actual data are always present regardless of the cap —
        // they were added to monthSet during visit/CPO collection above.
        {
            const existing = [...monthSet].sort();
            const [sy, sm] = existing[0].split('-').map(Number);
            const [ey, em] = existing[existing.length - 1].split('-').map(Number);
            let y = sy, m = sm, filled = 0;
            while ((y < ey || (y === ey && m <= em)) && filled < 60) {
                monthSet.add(`${y}-${String(m).padStart(2, '0')}`);
                m++; if (m > 12) { m = 1; y++; }
                filled++;
            }
        }

        const sortedMonths = [...monthSet].sort();

        // Months where no row has any visit or CPO dot — used to drive the "hide blank" toggle
        const blankMonths = new Set(
            sortedMonths.filter(mk => !rows.some(r => r.months[mk] && r.months[mk].visits.length > 0))
        );

        // Group rows by category — PO rows now use the contract description's category,
        // so CAT_PO no longer needs its own section (it's a fallback only)
        const allCatDefs = [...CAT_RULES, CAT_GENERAL, CAT_PO];
        const usedCatNames = new Set(rows.map(r => r.category.name));
        const activeCats   = allCatDefs.filter(c => usedCatNames.has(c.name));

        const catGroups = {};
        for (const cat of activeCats) catGroups[cat.name] = [];
        for (const row of rows) {
            catGroups[row.category.name].push(row);
        }
        // Sort within each category by (contractRef, description)
        for (const arr of Object.values(catGroups)) {
            arr.sort((a, b) => {
                const rc = a.contractRef.localeCompare(b.contractRef);
                if (rc !== 0) return rc;
                return a.description.localeCompare(b.description);
            });
        }

        // Stats — contract total
        let total = 0, complete = 0, overdue = 0;
        for (const row of rows) {
            for (const cell of Object.values(row.months)) {
                for (const v of cell.visits) {
                    total++;
                    if (v.status === 'complete') complete++;
                    else if (v.status === 'overdue') overdue++;
                }
            }
        }
        const upcoming = total - complete - overdue;
        const pct      = total > 0 ? Math.round((complete / total) * 100) : 0;
        const pctColor = pct === 100 ? '#15803d' : overdue > 0 ? '#b91c1c' : '#0097A7';

        // Stats — this month only
        let mTotal = 0, mComplete = 0, mOverdue = 0;
        for (const row of rows) {
            const cell = row.months[thisMonthKey];
            if (!cell) continue;
            for (const v of cell.visits) {
                mTotal++;
                if (v.status === 'complete') mComplete++;
                else if (v.status === 'overdue') mOverdue++;
            }
        }
        const mUpcoming     = mTotal - mComplete - mOverdue;
        const mPct          = mTotal > 0 ? Math.round((mComplete / mTotal) * 100) : 0;
        const thisMonthName = sortedMonths.includes(thisMonthKey) ? monthFull(thisMonthKey) : '';

        // Site column — only shown when contracts span more than one site
        const allSites = [...new Set(
            contractDataList.map(cd => (cd.meta && cd.meta.site) || '').filter(Boolean)
        )];
        const showSite       = allSites.length > 1;
        const SITE_W         = 150; // px — fixed width of the sticky Site column
        const svcLeft        = showSite ? 90 + SITE_W : 90; // Service left offset shifts when Site is present
        const contractSiteMap = showSite
            ? new Map(contractDataList.map(cd => [(cd.meta && cd.meta.ref) || '', (cd.meta && cd.meta.site) || '']))
            : null;

        // Contract URL map — links PM numbers in the table back to Joblogic
        const contractUrlMap = new Map(
            contractDataList
                .filter(cd => cd.id)
                .map(cd => [(cd.meta && cd.meta.ref) || '', `https://go.joblogic.com/PPMContract/Detail/${cd.id}`])
        );

        // Month header cells
        const monthHeaders = sortedMonths.map(mk => {
            const isCur  = mk === thisMonthKey;
            const blankC = blankMonths.has(mk) ? ' m-blank' : '';
            return `<th class="mcol${blankC}" style="background:${isCur ? '#162040' : '#09152b'};` +
                `color:${isCur ? '#93c5fd' : '#c0cfe0'};` +
                `font-size:10px;font-weight:600;padding:9px 4px;text-align:center;min-width:66px;` +
                `border-left:1px solid #1a2e4a;border-bottom:2px solid #1a2e4a;white-space:nowrap;">` +
                `${isCur ? '<div style="font-size:7px;color:#0097A7;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:2px;">NOW</div>' : ''}` +
                `${monthLabel(mk)}</th>`;
        }).join('');

        // Build table rows
        let tableRows = '';
        for (const cat of activeCats) {
            const catRows = catGroups[cat.name];
            if (!catRows.length) continue;

            // Category header row — spans all sticky columns (2 or 3 depending on showSite)
            tableRows += `<tr>
                <td colspan="${showSite ? 3 : 2}" style="position:sticky;left:0;z-index:10;background:${cat.bg};color:${cat.text};
                    font-size:8px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;
                    padding:5px 14px;border-top:2px solid ${cat.accent};
                    border-right:1px solid ${cat.border};border-bottom:1px solid ${cat.border};">${esc(cat.name)}</td>
                ${sortedMonths.map(mk => `<td class="mcol${blankMonths.has(mk) ? ' m-blank' : ''}" style="background:${cat.bg};border-top:2px solid ${cat.accent};border-bottom:1px solid ${cat.border};border-left:1px solid ${cat.border};min-width:66px;"></td>`).join('')}
            </tr>`;

            for (const row of catRows) {
                const rowSite     = showSite ? (contractSiteMap.get(row.contractRef) || '') : '';
                const contractUrl = contractUrlMap.get(row.contractRef) || null;

                // Service column content — for CPO rows, link just the CPO identifier
                // e.g. "Gas Servicing · <a>CPO00174</a>"
                const svcHtml = (() => {
                    if (row.type === 'po' && row.poUrl && row.description) {
                        const lastDot = row.description.lastIndexOf(' · ');
                        const base    = lastDot >= 0 ? row.description.slice(0, lastDot) : '';
                        const cpoId   = lastDot >= 0 ? row.description.slice(lastDot + 3) : row.description;
                        return (base ? esc(base) + ' · ' : '') +
                            `<a href="${esc(row.poUrl)}" target="_blank"
                                style="color:inherit;text-decoration:underline;text-underline-offset:2px;
                                       text-decoration-color:rgba(30,41,59,0.4);"
                                title="Open CPO in Joblogic">${esc(cpoId)}</a>`;
                    }
                    return row.description ? esc(row.description) : (row.type === 'empty' ? '—' : '');
                })();

                const refLabel    = contractUrl
                    ? `<a href="${esc(contractUrl)}" target="_blank"
                          style="color:inherit;text-decoration:underline;text-underline-offset:2px;
                                 text-decoration-color:rgba(15,35,71,0.35);"
                          title="Open ${esc(row.contractRef)} in Joblogic">${esc(row.contractRef)}</a>`
                    : esc(row.contractRef);
                tableRows += `<tr>
                    <td style="position:sticky;left:0;z-index:10;background:#fff;
                        font-size:10px;font-weight:700;color:#0f2347;
                        padding:6px 6px 6px 10px;
                        border-left:3px solid ${cat.accent};
                        border-right:1px solid #e2e8f0;
                        border-bottom:1px solid #f1f5f9;
                        white-space:nowrap;overflow:hidden;width:90px;text-overflow:ellipsis;"
                        title="${esc(row.contractRef)}${cpoContractRefs.has(row.contractRef) ? ' · Has Contract PO' : ''}${row.type === 'empty' ? ' · No visits or CPOs recorded' : ''}">${refLabel}${cpoContractRefs.has(row.contractRef) ? '<span style="display:inline-block;background:#f59e0b;color:#78350f;font-size:7px;font-weight:800;letter-spacing:0.06em;padding:1px 4px;border-radius:3px;vertical-align:middle;margin-left:3px;line-height:1.4;">CPO</span>' : ''}${row.type === 'empty' ? '<span style="display:inline-block;background:#fee2e2;color:#dc2626;font-size:10px;padding:0 3px;border-radius:3px;vertical-align:middle;margin-left:3px;line-height:1.5;" title="No visits or CPOs recorded">⚠</span>' : ''}</td>
                    ${showSite ? `<td style="position:sticky;left:90px;z-index:10;background:#fff;
                        font-size:10px;font-weight:400;color:#475569;
                        padding:6px 8px;
                        border-right:1px solid #e2e8f0;
                        border-bottom:1px solid #f1f5f9;
                        white-space:nowrap;overflow:hidden;width:${SITE_W}px;text-overflow:ellipsis;"
                        title="${esc(rowSite)}">${esc(rowSite) || '—'}</td>` : ''}
                    <td style="position:sticky;left:${svcLeft}px;z-index:10;background:#fff;
                        font-size:11px;font-weight:500;
                        color:${row.type === 'empty' ? '#94a3b8' : '#1e293b'};
                        font-style:${row.type === 'empty' ? 'italic' : 'normal'};
                        padding:6px 10px 6px 8px;
                        border-right:1px solid #e2e8f0;
                        border-bottom:1px solid #f1f5f9;
                        white-space:nowrap;overflow:hidden;max-width:220px;text-overflow:ellipsis;"
                        title="${row.description ? esc(row.description) : (row.type === 'empty' ? 'No visits or CPOs recorded' : '')}">${svcHtml}</td>
                    ${sortedMonths.map(mk => row.months[mk]
                        ? renderCell(mk, row.months[mk], thisMonthKey)
                        : `<td class="mcol${blankMonths.has(mk) ? ' m-blank' : ''}" style="background:#f8fafc;border:1px solid #f1f5f9;min-width:66px;"></td>`
                    ).join('')}
                </tr>`;
            }
        }

        const tableHtml = `<div style="overflow-x:auto;">
            <table style="border-collapse:collapse;width:100%;min-width:600px;background:#fff;">
                <thead>
                    <tr>
                        <th style="position:sticky;left:0;z-index:20;background:#09152b;color:#3d5a80;
                            font-size:8.5px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;
                            padding:10px 10px;text-align:left;width:90px;
                            border-right:1px solid #1a2e4a;border-bottom:2px solid #1a2e4a;">Contract</th>
                        ${showSite ? `<th style="position:sticky;left:90px;z-index:20;background:#09152b;color:#3d5a80;
                            font-size:8.5px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;
                            padding:10px 10px;text-align:left;width:${SITE_W}px;
                            border-right:1px solid #1a2e4a;border-bottom:2px solid #1a2e4a;">Site</th>` : ''}
                        <th style="position:sticky;left:${svcLeft}px;z-index:20;background:#09152b;color:#3d5a80;
                            font-size:8.5px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;
                            padding:10px 14px;text-align:left;max-width:220px;
                            border-right:1px solid #1a2e4a;border-bottom:2px solid #1a2e4a;">Service</th>
                        ${monthHeaders}
                    </tr>
                </thead>
                <tbody>${tableRows}</tbody>
            </table>
        </div>`;

        return { tableHtml, monthHeaders, blankMonths, total, complete, overdue, upcoming, pct, pctColor,
                 mTotal, mComplete, mOverdue, mUpcoming, mPct, thisMonthName };
    }

    // ─── Generate the full combined HTML report ───────────────────────────────
    function generateFullReport(contractDataList, reportTitle = 'PPM Service Report') {
        const today   = new Date(); today.setHours(0,0,0,0);
        const genDate = today.toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' });

        // Stat box — font size and width scale with the number so 3-digit values
        // don't overflow their containers and bleed into neighbouring stats.
        const statBox = (n, l, c) => {
            const fs = n >= 1000 ? '19px' : n >= 100 ? '22px' : '26px';
            const w  = n >= 1000 ? '64px' : n >= 100 ? '56px' : '52px';
            return `<div style="text-align:center;width:${w};flex-shrink:0;">` +
                `<div style="font-family:'Syne',sans-serif;font-size:${fs};font-weight:800;color:${c};line-height:1;">${n}</div>` +
                `<div style="font-size:8px;text-transform:uppercase;letter-spacing:0.08em;color:#3d5a80;margin-top:3px;">${l}</div>` +
                `</div>`;
        };

        const { tableHtml, blankMonths, total, complete, overdue, upcoming, pct, pctColor,
                mTotal, mComplete, mOverdue, mUpcoming, mPct, thisMonthName } =
            buildCombinedMatrix(contractDataList);

        const legendItems = [
            { icon:'–', color:'#94a3b8', label:'Scheduled'   },
            { icon:'✓', color:'#4ade80', label:'Complete'    },
            { icon:'!', color:'#f87171', label:'Overdue'     },
            { icon:'◎', color:'#fbbf24', label:'In Progress' },
        ].map(x => `<span style="display:inline-flex;align-items:center;gap:5px;font-size:10px;
            color:rgba(255,255,255,0.45);">
            <span style="font-weight:800;color:${x.color};">${x.icon}</span>${x.label}</span>`).join('');

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(reportTitle)} — Untitled Projects Management</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Syne:wght@700;800&display=swap');
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Plus Jakarta Sans',system-ui,sans-serif; background:#f0f4f8; color:#111827;
         -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .page { max-width:1100px; margin:0 auto; padding:24px; }
  @media print {
    body { background:white; }
    .page { padding:0; }
    .no-print { display:none!important; }
  }
</style>
</head>
<body>
<div class="page">

  <!-- ── MASTER HEADER ── -->
  <div style="background:linear-gradient(135deg,#09152b 0%,#0f2347 100%);
      border-radius:10px 10px 0 0;padding:22px 44px 16px 28px;margin-bottom:0;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:20px;flex-wrap:wrap;">

      <!-- Title block -->
      <div>
        <div style="font-family:'Syne',sans-serif;font-weight:800;font-size:22px;
            letter-spacing:-0.03em;color:#fff;line-height:1;">${esc(reportTitle)}</div>
        <div style="font-size:10px;color:#4a6fa0;letter-spacing:0.1em;
            text-transform:uppercase;margin-top:5px;">
          Untitled Projects Management &nbsp;·&nbsp; ${contractDataList.length} Contract${contractDataList.length!==1?'s':''} &nbsp;·&nbsp; ${genDate}
        </div>
        <div style="display:flex;align-items:center;gap:10px;margin-top:14px;">
          <span style="font-size:10px;color:#4a6fa0;">Overall completion</span>
          <div style="width:160px;height:5px;background:rgba(255,255,255,0.08);border-radius:99px;overflow:hidden;">
            <div style="width:${pct}%;height:100%;background:${pctColor};border-radius:99px;"></div>
          </div>
          <span style="font-family:'Syne',sans-serif;font-size:14px;font-weight:700;color:${pctColor};">${pct}%</span>
        </div>
        <!-- Print button — left side, below progress bar -->
        <button class="no-print" onclick="window.print()"
          style="margin-top:14px;padding:7px 16px;background:rgba(255,255,255,0.08);
            border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:#94a3b8;
            font-size:11px;cursor:pointer;font-family:inherit;display:inline-block;">⎙ Print</button>
      </div>

      <!-- Stat blocks -->
      <div style="display:flex;align-items:flex-start;gap:28px;flex-wrap:wrap;flex-shrink:0;">

        <div style="display:flex;flex-direction:column;gap:16px;">

          <!-- Contract Total -->
          <div>
            <div style="font-size:8px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;
                color:#3d5a80;margin-bottom:10px;font-family:'Syne',sans-serif;">Contract Total</div>
            <div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap;">
              ${[{n:total,l:'Visits',c:'#e2e8f0'},{n:complete,l:'Complete',c:'#4ade80'},
                 {n:overdue,l:'Overdue',c:'#f87171'},{n:upcoming,l:'Upcoming',c:'#7dd3fc'}]
                .map(({n,l,c}) => statBox(n,l,c)).join('')}
              <div style="text-align:center;min-width:60px;flex-shrink:0;
                  border-left:1px solid rgba(255,255,255,0.08);padding-left:12px;">
                <div style="font-family:'Syne',sans-serif;font-size:26px;font-weight:800;color:${pctColor};line-height:1;">${pct}%</div>
                <div style="font-size:8px;text-transform:uppercase;letter-spacing:0.08em;color:#3d5a80;margin-top:3px;">Done</div>
              </div>
            </div>
          </div>

          <!-- This Month -->
          ${thisMonthName ? `
          <div>
            <div style="font-size:8px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;
                color:#0097A7;margin-bottom:10px;font-family:'Syne',sans-serif;">${esc(thisMonthName)}</div>
            <div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap;">
              ${[{n:mTotal,l:'Visits',c:'#e2e8f0'},{n:mComplete,l:'Complete',c:'#4ade80'},
                 {n:mOverdue,l:'Overdue',c:'#f87171'},{n:mUpcoming,l:'Upcoming',c:'#7dd3fc'}]
                .map(({n,l,c}) => statBox(n,l,c)).join('')}
              <div style="text-align:center;min-width:60px;flex-shrink:0;
                  border-left:1px solid rgba(255,255,255,0.08);padding-left:12px;">
                <div style="font-family:'Syne',sans-serif;font-size:26px;font-weight:800;color:#0097A7;line-height:1;">${mPct}%</div>
                <div style="font-size:8px;text-transform:uppercase;letter-spacing:0.08em;color:#3d5a80;margin-top:3px;">Done</div>
              </div>
            </div>
          </div>` : ''}

        </div>

      </div>
    </div>
  </div>

  <!-- ── LEGEND / KEY BAR ── -->
  <div style="background:#0c1a30;border-radius:0;padding:7px 28px;
      display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;
      margin-bottom:20px;">
    <div style="display:flex;gap:16px;flex-wrap:wrap;">${legendItems}</div>
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
      <span style="font-size:9.5px;color:rgba(255,255,255,0.25);">
        Dot = one visit &nbsp;·&nbsp; Multiple dots = multiple visits in that month
      </span>
      ${blankMonths.size > 0 ? `<button id="hide-blank-btn" class="no-print"
        onclick="(function(btn){
          var hiding = btn.getAttribute('data-h') !== '1';
          btn.setAttribute('data-h', hiding ? '1' : '0');
          btn.textContent = hiding ? 'Show blank months' : 'Hide blank months (' + ${blankMonths.size} + ')';
          document.querySelectorAll('.m-blank').forEach(function(el){ el.style.display = hiding ? 'none' : ''; });
        })(this)"
        style="padding:4px 11px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);
          border-radius:5px;color:#94a3b8;font-size:10px;cursor:pointer;font-family:inherit;white-space:nowrap;">
        Hide blank months (${blankMonths.size})</button>` : ''}
    </div>
  </div>

  <!-- ── COMBINED MATRIX ── -->
  <div style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;
      box-shadow:0 1px 4px rgba(0,0,0,.06);">
    ${tableHtml}
  </div>

  <!-- ── FOOTER ── -->
  <div style="margin-top:24px;padding-top:14px;border-top:1px solid #e2e8f0;
      display:flex;justify-content:space-between;font-size:10px;color:#9ca3af;flex-wrap:wrap;gap:8px;">
    <span>Untitled Projects Management &nbsp;·&nbsp; PPM Multi-Contract Report</span>
    <span>${genDate}</span>
  </div>

</div>
</body>
</html>`;
    }

    // ─── Phase A: Collect contracts from the list page ────────────────────────
    async function collectContracts(statusEl) {
        const $ = window.jQuery || window.$;

        const seen      = new Set();
        const contracts = [];
        const suspended = []; // contracts excluded because status matches /suspend/i

        function processItem(raw) {
            const item = raw.toJSON ? raw.toJSON() : raw;

            // Cast-insensitive ID lookup — Joblogic varies between Id/ID/ContractId/ContractID
            const id = String(
                item.Id ?? item.id ?? item.ID ??
                item.ContractId ?? item.ContractID ??
                item.PPMContractId ?? item.PpmContractId ?? ''
            );

            if (!id) {
                ppmWarn('[PPM-Multi] Item has no ID — fields:', Object.keys(item).join(','),
                             '| sample:', JSON.stringify(item).slice(0, 150));
                return;
            }
            if (seen.has(id)) return;
            seen.add(id);

            const status = String(
                item.Status ?? item.ContractStatus ?? item.StatusName ??
                item.ContractStatusName ?? item.StatusText ?? ''
            );
            const ref = item.Reference || item.ContractReference || item.ContractNumber || item.Ref || id;
            ppmLog('[PPM-Multi] id:', id, '| ref:', ref, '| status:', JSON.stringify(status));

            if (/suspend/i.test(status)) {
                suspended.push({ id, ref, status });
                ppmLog('[PPM-Multi]  → skipped (suspended match on status:', JSON.stringify(status), ')');
                return;
            }
            contracts.push({
                id,
                ref,
                planRef:  item.PlanReference || item.PlanRef || item.PlanName || item.PPMPlanName || '',
                site:     item.SiteName     || item.Site              || item.SiteAddress    || '',
                customer: item.CustomerName || item.Customer          || item.ClientName     || '',
                status,
            });
        }

        // ── Pre-step: switch to "All" tab before any strategy runs ────────────
        // Without this, Strategy 1 reads from whichever tab is active
        // (typically "Active") and returns early, missing Completed, Expired, etc.
        // Clicking "All" first means every strategy sees the full contract list.
        {
            const navLinks = qsa(
                'ul.nav-tabs a[data-toggle="tab"],ul.nav a[data-toggle="tab"],' +
                'ul.nav-tabs a[data-bs-toggle="tab"],ul.nav a[data-bs-toggle="tab"]'
            );
            const allTabLink = navLinks.find(a => /^all\b/i.test((a.textContent || '').trim()));
            if (allTabLink) {
                const parentLi = allTabLink.closest('li');
                const alreadyActive = parentLi && parentLi.classList.contains('active');
                if (!alreadyActive) {
                    ppmLog('[PPM-Multi] Pre-step: clicking All tab before scan…');
                    statusEl.textContent = 'Switching to All tab…';
                    allTabLink.click();
                    await sleep(1400); // give AJAX time to reload the grid/table
                    ppmLog('[PPM-Multi] Pre-step: All tab loaded');
                } else {
                    ppmLog('[PPM-Multi] Pre-step: already on All tab');
                }
            } else {
                ppmLog('[PPM-Multi] Pre-step: no All tab found — scanning current tab');
            }
        }

        // ── Strategy 1: Kendo grid API — read ALL grids on the page ───────────
        // Joblogic often renders separate grids per contract-status group
        // (Active, Expired, Renewal, etc.). qs() only finds the first one.
        const gridEls = qsa('[data-role="grid"]');
        ppmLog('[PPM-Multi] Kendo grids found:', gridEls.length, '| jQuery:', !!$);

        if (gridEls.length && $) {
            for (let gi = 0; gi < gridEls.length; gi++) {
                const gridEl = gridEls[gi];
                const grid   = $(gridEl).data('kendoGrid');
                if (!grid) { ppmLog('[PPM-Multi] Grid', gi, ': no kendoGrid widget, skipping'); continue; }

                const ds = grid.dataSource;
                ppmLog('[PPM-Multi] Grid', gi, ':');

                // ── Attempt A: visible DOM rows via ds.getByUid() ────────────────
                const domRows = qsa('tr[data-uid]', gridEl);
                ppmLog('[PPM-Multi]   tr[data-uid] rows:', domRows.length);

                if (domRows.length > 0) {
                    for (const row of domRows) {
                        const uid  = row.getAttribute('data-uid');
                        const item = uid ? ds.getByUid(uid) : null;
                        if (item) {
                            processItem(item);
                        } else {
                            // uid not in datasource — fall back to link href
                            const a = row.querySelector('a[href*="/PPMContract/Detail/"]');
                            const m = a?.getAttribute('href')?.match(/\/Detail\/([\w-]+)/);
                            if (m && !seen.has(m[1])) {
                                seen.add(m[1]);
                                if (!/suspend/i.test(row.textContent)) {
                                    contracts.push({ id: m[1], ref: m[1], site: '', customer: '', status: 'unknown' });
                                } else {
                                    suspended.push({ id: m[1], ref: m[1], status: 'suspended (row text)' });
                                }
                            }
                        }
                    }
                    ppmLog('[PPM-Multi]   after grid', gi, '(dom rows p1): kept', contracts.length);

                    // Server-side paging: the visible rows are just one page.
                    // If ds.total() says there are more items, page through the rest.
                    const totalInDs  = (ds.total ? ds.total() : 0) || ds._total || 0;
                    const pgSize     = (ds.pageSize ? ds.pageSize() : 0) || domRows.length || 20;
                    const startPage  = (ds.page ? ds.page() : 1) || 1;
                    const totalPages = totalInDs > 0 ? Math.ceil(totalInDs / pgSize) : 1;
                    ppmLog('[PPM-Multi]   total in ds:', totalInDs, '| pageSize:', pgSize, '| pages:', totalPages);

                    for (let p = startPage + 1; p <= totalPages; p++) {
                        statusEl.textContent = `Grid ${gi+1}/${gridEls.length} — page ${p} of ${totalPages}…`;
                        await new Promise(resolve => {
                            ds.one('change', resolve);
                            ds.page(p);
                            setTimeout(resolve, 6000);
                        });
                        await sleep(600);
                        // Read the newly-rendered DOM rows for this page
                        const pageRows = qsa('tr[data-uid]', gridEl);
                        for (const row of pageRows) {
                            const uid  = row.getAttribute('data-uid');
                            const item = uid ? ds.getByUid(uid) : null;
                            if (item) processItem(item);
                        }
                        ppmLog('[PPM-Multi]   after page', p, ': kept', contracts.length);
                    }
                    // Restore original page
                    if (ds.page && ds.page() !== startPage) ds.page(startPage);
                    continue; // move on to the next grid
                }

                // ── Attempt B: ds.data() (client-side grids) ────────────────────
                const allLoaded = ds.data ? [...ds.data()] : [];
                let totalItems  = ds.total() || ds._total || 0;
                if (!totalItems) {
                    const pagerInfo = gridEl.closest('.k-grid')?.querySelector('.k-pager-info')
                                      || qs('.k-pager-info');
                    if (pagerInfo) {
                        const m = pagerInfo.textContent.match(/of\s+([\d,]+)/i);
                        if (m) totalItems = parseInt(m[1].replace(/,/g, ''), 10) || 0;
                    }
                }
                ppmLog('[PPM-Multi]   ds.data():', allLoaded.length, '| total:', totalItems);

                if (allLoaded.length > 0) {
                    allLoaded.forEach(processItem);
                    ppmLog('[PPM-Multi]   after grid', gi, '(ds.data): kept', contracts.length, 'suspended', suspended.length);
                    continue;
                }

                // ── Attempt C: page-by-page navigation ──────────────────────────
                const pageSize = ds.pageSize() || 20;
                const origPage = ds.page() || 1;
                const maxPages = totalItems > 0 ? Math.ceil(totalItems / pageSize) : 50;

                for (let p = 1; p <= maxPages; p++) {
                    statusEl.textContent = `Grid ${gi+1}/${gridEls.length} — page ${p}…`;
                    if (ds.page() !== p) {
                        await new Promise(resolve => {
                            ds.one('change', resolve);
                            ds.page(p);
                            setTimeout(resolve, 6000);
                        });
                        await sleep(600);
                    }
                    const view = [...ds.view()];
                    if (!view.length) break;
                    view.forEach(processItem);
                    if (view.length < pageSize) break;
                }
                if (ds.page() !== origPage) ds.page(origPage);
                ppmLog('[PPM-Multi]   after grid', gi, '(paged): kept', contracts.length, 'suspended', suspended.length);
            }

            if (seen.size > 0) return { contracts, suspended };
        }

        // ── Strategy 2: Dedicated table reader ──────────────────────────────────
        // The PPM Contracts list uses a plain <table class="table-ppm-contract-table">
        // with NO Kendo grid binding. Columns (0-based):
        //   0: No. (PM reference)  1: Plan Reference  2: Site Name  3: Customer Name
        //   4: Start Date  5: End Date  6: Progress  7: Tags  8: Date Created
        // Contract URLs use full GUIDs, not integer IDs.
        // Tabs (In Progress / Completed / Expired / Suspended / All) are Bootstrap tabs
        // that reload via AJAX — we iterate ALL non-suspended tabs and ALL pages within
        // each tab so we never miss contracts on a different tab or page.
        const contractTable = qs('table.table-ppm-contract-table, table.jl-table');
        ppmLog('[PPM-Multi] contractTable found:', !!contractTable);

        if (contractTable) {

            // ── Helpers ──────────────────────────────────────────────────────────
            // Read every row from the currently-visible table snapshot
            function scrapeVisibleTable() {
                const tbl = qs('table.table-ppm-contract-table, table.jl-table');
                if (!tbl) return 0;
                const activeTabEl    = qs('ul.nav li.active a, ul.nav li a.active');
                const activeTabTxt   = (activeTabEl?.textContent || '').trim();
                const tabIsSuspended = /suspend/i.test(activeTabTxt);
                let added = 0;
                for (const row of qsa('tr', tbl).filter(r => r.querySelector('a[href*="/PPMContract/Detail/"]'))) {
                    const a = row.querySelector('a[href*="/PPMContract/Detail/"]');
                    const m = a?.getAttribute('href')?.match(/\/PPMContract\/Detail\/([\w-]+)/);
                    if (!m) continue;
                    const id = m[1];
                    if (seen.has(id)) continue;
                    seen.add(id);
                    const cells    = [...row.querySelectorAll('td')];
                    const ref      = cells[0]?.textContent.trim() || id;
                    const planRef  = cells[1]?.textContent.trim() || '';
                    const site     = cells[2]?.textContent.trim() || '';
                    const customer = cells[3]?.textContent.trim() || '';
                    if (tabIsSuspended || /suspend/i.test(row.textContent)) {
                        suspended.push({ id, ref, status: 'Suspended' });
                        ppmLog('[PPM-Multi]  → suspended:', ref);
                    } else {
                        contracts.push({ id, ref, planRef, site, customer, status: 'active' });
                        added++;
                    }
                }
                return added;
            }

            // Attempt to click the "Next page" control; returns true if found & clicked
            function clickNextPage() {
                const btn = qs(
                    '.pagination li:not(.disabled) a[aria-label="Next"],' +
                    '.pagination li:not(.disabled) a[rel="next"],' +
                    '.pagination .next:not(.disabled) > a,' +
                    '.dataTables_paginate .next:not(.disabled),' +
                    '.paginate_button.next:not(.disabled)'
                );
                if (!btn) return false;
                btn.click();
                return true;
            }

            // ── Identify tabs to iterate ─────────────────────────────────────────
            const allNavLinks = qsa(
                'ul.nav-tabs a[data-toggle="tab"],ul.nav a[data-toggle="tab"],' +
                'ul.nav-tabs a[data-bs-toggle="tab"],ul.nav a[data-bs-toggle="tab"]'
            );
            // Prefer an "All" tab — one pass covers every contract.
            // Match "All", "All (31)", "All Contracts", etc. — not just the bare word.
            const allTabLink  = allNavLinks.find(a => /^all\b/i.test(a.textContent.trim()));
            const tabsToScan  = allTabLink
                ? [allTabLink]
                : allNavLinks.filter(a => !/suspend/i.test(a.textContent));
            const originalTab = qs('ul.nav-tabs li.active a, ul.nav li.active a');

            ppmLog('[PPM-Multi] Tabs to scan:',
                tabsToScan.length ? tabsToScan.map(a => a.textContent.trim()).join(', ') : 'current only');

            const tabIter = tabsToScan.length ? tabsToScan : [null]; // null = no tab switch
            for (const tabLink of tabIter) {
                if (tabLink) {
                    // Skip the click if pre-step already switched us to this tab
                    const parentLi      = tabLink.closest('li');
                    const alreadyActive = parentLi && parentLi.classList.contains('active');
                    if (!alreadyActive) {
                        ppmLog('[PPM-Multi] Switching to tab:', tabLink.textContent.trim());
                        tabLink.click();
                        await sleep(1200); // wait for AJAX reload
                    } else {
                        ppmLog('[PPM-Multi] Tab already active (pre-step did it):', tabLink.textContent.trim());
                    }
                }
                const tabName = tabLink?.textContent.trim() || 'current tab';
                let page = 1;
                while (true) {
                    statusEl.textContent = `Scanning "${tabName}" page ${page}…`;
                    const added = scrapeVisibleTable();
                    ppmLog(`[PPM-Multi] "${tabName}" page ${page}: +${added} (total ${contracts.length})`);
                    if (!clickNextPage()) break;
                    await sleep(900);
                    page++;
                    if (page > 50) { ppmWarn('[PPM-Multi] Pagination safety cap'); break; }
                }
            }

            // Restore original tab
            if (tabsToScan.length > 1 && originalTab) {
                originalTab.click();
                await sleep(400);
            }

            ppmLog('[PPM-Multi] Table scan complete. kept:', contracts.length, 'suspended:', suspended.length);
            if (seen.size > 0) return { contracts, suspended };
        }

        // ── Strategy 3: Generic link scraping (last resort) ──────────────────────
        // Note: regex MUST use [\w-]+ not \d+ — contract IDs are GUIDs not integers.
        ppmLog('[PPM-Multi] Falling back to generic link scraping');
        for (const a of qsa('a[href*="/PPMContract/Detail/"]')) {
            const m = a.getAttribute('href').match(/\/PPMContract\/Detail\/([\w-]+)/);
            if (!m || seen.has(m[1])) continue;
            seen.add(m[1]);
            const row = a.closest('tr, li, .row, [class*="item"]');
            if (row && /suspend/i.test(row.textContent)) {
                suspended.push({ id: m[1], ref: (a.textContent || '').trim() || m[1], status: 'Suspended' });
                continue;
            }
            contracts.push({ id: m[1], ref: (a.textContent || '').trim() || m[1], site: '', customer: '', status: 'unknown' });
        }
        ppmLog('[PPM-Multi] Link scrape done. kept:', contracts.length, 'suspended:', suspended.length);
        return { contracts, suspended };
    }

    // ─── Phase B: Process each contract's visits tab ──────────────────────────
    async function processCurrentContract() {
        const st = loadState();
        if (!st || st.phase !== 'visiting') return;

        const contract = st.contracts[st.currentIndex];
        if (!contract) { finalise(st); return; }

        setStatus(`Reading visits for ${contract.ref} (${st.currentIndex + 1} / ${st.contracts.length})…`);

        // Activate the visits tab via its nav link — setting location.hash alone doesn't
        // always trigger Joblogic's AJAX tab loading (Bootstrap requires a click event)
        const visitsNavLink = qs('a[href="#visitsTab"][data-toggle="tab"]');
        if (visitsNavLink) visitsNavLink.click();
        else if (!location.hash.includes('visitsTab')) location.hash = 'visitsTab';
        await sleep(400); // waitFor below detects load completion — no need for a long fixed pause

        // Wait for visits tab to load — resolves when:
        //   a) visit rows appear, OR
        //   b) the #ppmVisits container is visible but clearly has no visits
        //      (loaded successfully, just an empty contract — don't wait 14s for nothing)
        try {
            await waitFor(() => {
                const rows = qsa('#ppmVisits ul.list-group > li.list-group-item')
                    .filter(r => r.offsetParent !== null);
                if (rows.length > 0) return rows;

                // Container is visible — check for the "no visits" empty state
                const container = qs('#ppmVisits');
                if (container && container.offsetParent !== null) {
                    // Specific Joblogic phrase
                    if (/no visits/i.test(container.innerText || '')) return [];
                    // Empty list group = loaded with no rows
                    const listGroup = qs('#ppmVisits .list-group, #ppmVisits ul');
                    if (listGroup && listGroup.children.length === 0) return [];
                    // Broad: any visible text with no loading spinner = loaded (empty state,
                    // unknown wording). Guards against variations like "No scheduled visits".
                    const txt = (container.innerText || '').trim();
                    if (txt.length > 5 && !qs('.k-loading-image,.loading-overlay', container)) return [];
                }
                return null; // still loading
            }, { timeout: 10000 });
        } catch {
            // Timed out — visits tab didn't appear within 10s.
            // Don't skip: fall through so the CPO tab is still read and the contract
            // appears in the report (as a placeholder if nothing is found).
            contract.error  = 'Visits tab did not load within 10s';
            contract.visits = [];
            setStatus(`⚠ ${contract.ref}: visits tab slow — checking CPO…`);
            await sleep(300);
        }

        // Read visits (safe even if the tab didn't load — returns [] gracefully)
        try {
            const meta   = readContractMeta();
            // Fill any meta gaps from the stored contract data
            if (!meta.ref)         meta.ref         = contract.ref;
            if (!meta.site)        meta.site        = contract.site;
            if (!meta.customer)    meta.customer    = contract.customer;
            // Plan Reference — captured from list page col 1; used for Service column
            if (!meta.description) meta.description = contract.planRef || '';

            contract.meta   = meta;
            // Only re-read if we don't already have an error set (timeout case already has [])
            if (!contract.error) contract.visits = await readVisitsFromPage();
        } catch (e) {
            contract.error  = e.message;
            contract.visits = [];
        }

        // Read Contract Purchase Orders
        // Click the tab nav link directly — more reliable than setting location.hash
        contract.pos = [];
        try {
            const cpoNavLink = qs(
                'a[href="#contractPO"][data-toggle="tab"],' +
                'a[href="#contractPurchaseOrderTab"][data-toggle="tab"],' +
                'a[href="#contractPO"], a[href="#contractPurchaseOrderTab"],' +
                'a[data-target="#contractPO"], a[data-target="#contractPurchaseOrderTab"]'
            );
            ppmLog(`[PPM-Multi] ${contract.ref}: CPO nav link found:`, !!cpoNavLink,
                cpoNavLink ? (cpoNavLink.getAttribute('href') || cpoNavLink.getAttribute('data-target') || '') : '');
            if (cpoNavLink) cpoNavLink.click();
            else { location.hash = 'contractPO'; }
            await sleep(500); // slightly longer — gives Bootstrap tab transition time to fire

            // Wait for the CPO panel to fully settle (data rows or confirmed empty).
            //
            // KEY SUBTLETY: the CPO tab on Joblogic is a plain HTML table loaded via AJAX.
            // The filter UI ("Hide Filter", "All (N)" badge) renders BEFORE tbody rows appear.
            // We MUST NOT resolve on mere panel visibility or filter-UI text.
            //
            // If the panel happens to contain a Kendo grid element (some contracts do),
            // we check Kendo first — but crucially we do NOT short-circuit on "Kendo still
            // loading": we fall through and also check for plain-HTML tbody rows so a
            // co-existing plain table is never missed.
            //
            // Timeout: 12 s. Covers slow AJAX on large contracts. Most empty-state
            // contracts resolve in under 2 s.
            let cpoPanel = null;
            let cpoPanelFirstVisible = 0; // timestamp (ms) when panel first became visible
            try {
                await waitFor(() => {
                    const panel = qs('#contractPO, #contractPurchaseOrderTab');
                    if (!panel) return null;
                    const pst = getComputedStyle(panel);
                    if (pst.display === 'none' || pst.visibility === 'hidden') {
                        cpoPanelFirstVisible = 0; // reset if panel hides again
                        return null;
                    }
                    cpoPanel = panel;
                    if (!cpoPanelFirstVisible) cpoPanelFirstVisible = Date.now();

                    // ── Kendo grid (if present in this panel) ────────────────────────
                    // Check for Kendo data first; fall through to plain-HTML check so a
                    // co-existing plain CPO table is never missed.
                    const gridEl = qs('[data-role="grid"]', panel);
                    if (gridEl) {
                        if (qsa('tr[data-uid]', gridEl).length > 0) return panel; // Kendo rows ready
                        if (qs('.k-grid-norecords,.k-no-data', gridEl))  return panel; // Kendo explicit empty
                        const content = qs('.k-grid-content', gridEl);
                        if (content && (content.innerText || '').trim().length > 2) return panel;
                        // Fall through — also check for plain-HTML tbody below
                    }

                    // ── Plain HTML / lazy-AJAX CPO table ─────────────────────────────
                    // tbody rows → resolve immediately (AJAX returned real data)
                    const tbodyRows = qsa('tbody tr', panel);
                    if (tbodyRows.length > 0) {
                        ppmLog(`[PPM-Multi] ${contract.ref}: CPO panel ready — ${tbodyRows.length} tbody row(s)`);
                        return panel;
                    }

                    // ── "No results" / "All (0)" text ────────────────────────────────
                    // IMPORTANT: Joblogic renders a "no records found" placeholder text
                    // in the CPO panel BEFORE the AJAX request fires. Resolving on this
                    // too early means we skip contracts that DO have CPOs.
                    // Guard: only accept an "empty" signal after the panel has been
                    // visible for at least 2 000 ms — enough time for the AJAX to either
                    // return real rows (caught above) or confirm the contract has no CPOs.
                    const elapsed = Date.now() - cpoPanelFirstVisible;
                    if (elapsed >= 2000) {
                        const ptxt = (panel.innerText || '').trim();
                        if (/no matching|no results|no.*found/i.test(ptxt)) {
                            ppmLog(`[PPM-Multi] ${contract.ref}: CPO panel — no-results text (${elapsed} ms dwell)`);
                            return panel;
                        }
                        if (/All \(0\)/.test(ptxt)) {
                            ppmLog(`[PPM-Multi] ${contract.ref}: CPO panel — All (0) (${elapsed} ms dwell)`);
                            return panel;
                        }
                    }

                    // Kendo loading spinner → nothing yet, keep waiting
                    if (gridEl && qs('.k-loading-image', gridEl)) return null;
                    // Panel visible but AJAX still in flight — keep polling
                    return null;
                }, { timeout: 12000 });
            } catch {
                const tbLen = cpoPanel ? qsa('tbody tr', cpoPanel).length : 'N/A';
                const hasTable = cpoPanel ? !!qs('table', cpoPanel) : false;
                ppmWarn(`[PPM-Multi] ${contract.ref}: CPO panel timeout (12 s) — ` +
                    `panel visible: ${!!cpoPanel}, tbodyRows: ${tbLen}, hasTable: ${hasTable}`);
            }

            // After waitFor (resolved or timed-out): if the panel is visible but still
            // has no tbody rows and no "empty" text, give AJAX one final 3 s grace period.
            if (cpoPanel) {
                const tbRows = qsa('tbody tr', cpoPanel);
                const ptxtNow = (cpoPanel.innerText || '').trim();
                const hasEmptyState = /no matching|no results|no.*found|All \(0\)/i.test(ptxtNow);
                if (tbRows.length === 0 && !hasEmptyState) {
                    ppmLog(`[PPM-Multi] ${contract.ref}: CPO — no tbody rows after waitFor, extra 3 s grace…`);
                    await sleep(3000);
                }
                ppmLog(`[PPM-Multi] ${contract.ref}: CPO panel final state — ` +
                    `tbodyRows: ${qsa('tbody tr', cpoPanel).length}, ` +
                    `hasTable: ${!!qs('table', cpoPanel)}, ` +
                    `hasGrid: ${!!qs('[data-role="grid"]', cpoPanel)}`);
            } else {
                ppmWarn(`[PPM-Multi] ${contract.ref}: CPO panel never became visible`);
            }

            contract.pos = await readPOsFromPage(cpoPanel || undefined);
            ppmLog(`[PPM-Multi] ${contract.ref}: ${contract.pos.length} PO(s) found`);
        } catch (e) {
            ppmWarn(`[PPM-Multi] ${contract.ref}: CPO tab error:`, e.message);
            contract.pos = [];
        }

        contract.visited = true;
        saveState(st);

        await navigateToNext(st);
    }

    function finalise(st) {
        st.phase = 'done';
        saveState(st);
        setStatus('Generating report…');

        const contractDataList = st.contracts
            .filter(c => c.visited)
            .map(c => ({ id: c.id, meta: c.meta || { ref: c.ref, site: c.site, customer: c.customer }, visits: c.visits, pos: c.pos || [] }));

        if (!contractDataList.length) {
            setStatus('No visit data collected — check that the contracts have visits loaded.');
            return;
        }

        let html;
        try {
            html = generateFullReport(contractDataList, st.reportTitle || 'PPM Service Report');
        } catch (e) {
            ppmWarn('[PPM-Multi] generateFullReport error:', e.message, e.stack || '');
            setStatus(`⚠ Report generation failed: ${e.message}. Try Reset and run again.`);
            return;
        }

        const win  = window.open('', '_blank');
        if (!win) {
            setStatus('Pop-up blocked — allow pop-ups for go.joblogic.com and click the button again.');
            return;
        }
        win.document.open();
        win.document.write(html);
        win.document.close();
        setStatus(`✓ Report opened (${contractDataList.length} contracts, ${contractDataList.reduce((n,c)=>n+c.visits.length,0)} visits).`);
    }

    async function navigateToNext(st) {
        st.currentIndex++;
        while (st.currentIndex < st.contracts.length && st.contracts[st.currentIndex].visited)
            st.currentIndex++;

        if (st.currentIndex >= st.contracts.length) {
            saveState(st);
            finalise(st);
            return;
        }

        saveState(st);
        await sleep(600);
        const next = st.contracts[st.currentIndex];
        location.href = `/PPMContract/Detail/${next.id}#visitsTab`;
    }

    // ─── Status log helper ────────────────────────────────────────────────────
    let _statusEl = null;
    function setStatus(msg) {
        ppmLog('[PPM-Multi]', msg);
        if (_statusEl) _statusEl.textContent = msg;
    }

    // ─── List page UI ─────────────────────────────────────────────────────────
    function injectListButton() {
        if (document.getElementById('ppm-multi-btn')) return;

        const wrapper = document.createElement('div');
        wrapper.id    = 'ppm-multi-wrapper';
        wrapper.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:99999;' +
            'display:flex;flex-direction:column;align-items:flex-end;gap:8px;';

        const btn = document.createElement('button');
        btn.id    = 'ppm-multi-btn';
        btn.textContent = `📋 Multi-Contract Report  v${VERSION}`;
        btn.style.cssText = 'background:#0f2347;color:#fff;border:1px solid #1a3a6b;' +
            'border-radius:6px;padding:10px 18px;font-size:13px;font-weight:600;' +
            'cursor:pointer;white-space:nowrap;box-shadow:0 3px 14px rgba(0,0,0,.3);' +
            'font-family:system-ui,sans-serif;';

        const statusBox = document.createElement('div');
        statusBox.style.cssText = 'background:rgba(9,21,43,0.92);color:#7dd3fc;' +
            'font-size:11px;padding:6px 12px;border-radius:5px;max-width:340px;' +
            'text-align:right;font-family:monospace;display:none;';
        _statusEl = statusBox;

        const resetBtn = document.createElement('button');
        resetBtn.textContent  = 'Reset';
        resetBtn.style.cssText = 'background:#fff;color:#374151;border:1px solid #9ca3af;' +
            'border-radius:4px;padding:4px 10px;font-size:11px;font-weight:600;cursor:pointer;' +
            'font-family:system-ui,sans-serif;box-shadow:0 1px 3px rgba(0,0,0,.15);';

        const titleInput = document.createElement('input');
        titleInput.type  = 'text';
        titleInput.value = 'PPM Service Report';
        titleInput.placeholder = 'Report title…';
        titleInput.style.cssText = 'background:rgba(9,21,43,0.85);color:#e2e8f0;' +
            'border:1px solid #2d4a6e;border-radius:4px;padding:5px 10px;' +
            'font-size:12px;font-family:system-ui,sans-serif;width:240px;' +
            'text-align:right;outline:none;';
        titleInput.addEventListener('focus', () => { titleInput.style.borderColor = '#0097A7'; });
        titleInput.addEventListener('blur',  () => { titleInput.style.borderColor = '#2d4a6e'; });

        wrapper.appendChild(titleInput);
        wrapper.appendChild(statusBox);
        wrapper.appendChild(btn);
        wrapper.appendChild(resetBtn);
        document.body.appendChild(wrapper);
        jlRegisterPanel(wrapper, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR);

        // Restore any saved state — show a clear indicator so the user knows cached data exists
        const existingBootSt = loadState();
        if (existingBootSt) {
            statusBox.style.display = 'block';
            if (existingBootSt.reportTitle) titleInput.value = existingBootSt.reportTitle;

            if (existingBootSt.phase === 'done') {
                const n = existingBootSt.contracts ? existingBootSt.contracts.filter(c => c.visited).length : 0;
                // Green tint — data is ready, button click will instantly re-generate
                statusBox.style.background   = 'rgba(5,90,55,0.92)';
                statusBox.style.color        = '#6ee7b7';
                statusBox.style.border       = '1px solid #059669';
                statusBox.textContent        = `✓ Cached data ready — ${n} contract${n!==1?'s':''} · click to re-generate`;
                btn.style.background         = '#065f46';
                btn.style.borderColor        = '#059669';
                btn.textContent              = `⟳ Re-generate Report  v${VERSION}`;
            } else if (existingBootSt.phase === 'visiting') {
                const done  = existingBootSt.contracts ? existingBootSt.contracts.filter(c => c.visited).length : 0;
                const total = existingBootSt.contracts ? existingBootSt.contracts.length : 0;
                // Amber tint — run was interrupted mid-way
                statusBox.style.background   = 'rgba(120,53,15,0.92)';
                statusBox.style.color        = '#fcd34d';
                statusBox.style.border       = '1px solid #d97706';
                statusBox.textContent        = `⚠ Run paused — ${done} / ${total} contracts collected · Reset to start fresh`;
                btn.style.background         = '#78350f';
                btn.style.borderColor        = '#d97706';
            }
        }

        btn.addEventListener('click', async () => {
            const existingSt = loadState();
            if (existingSt && existingSt.phase === 'done') {
                // Always use whatever is currently typed in the title input —
                // don't let stale cached state override a title the user just entered
                existingSt.reportTitle = titleInput.value.trim() || 'PPM Service Report';
                statusBox.style.display = 'block';
                setStatus('Re-generating from cached data…');
                finalise(existingSt);
                return;
            }

            btn.disabled = true;
            statusBox.style.display = 'block';
            setStatus('Scanning contracts…');

            let contracts, suspended;
            try {
                ({ contracts, suspended } = await collectContracts(statusBox));
            } catch (e) {
                setStatus(`Error: ${e.message}`);
                btn.disabled = false;
                return;
            }

            const total = contracts.length + suspended.length;
            if (!total) {
                setStatus('No contracts found on this page.');
                btn.disabled = false;
                return;
            }

            setStatus(`Found ${contracts.length} active, ${suspended.length} suspended.`);

            // Build confirmation dialog with full breakdown
            let confirmMsg = `Found ${total} PPM contract${total!==1?'s':''} on this page.\n\n`;
            confirmMsg    += `✓  ${contracts.length} active — will be processed\n`;
            if (suspended.length) {
                confirmMsg += `✗  ${suspended.length} excluded as Suspended:\n`;
                confirmMsg += suspended.map(s => `     ${s.ref}  (${s.status})`).join('\n');
                confirmMsg += '\n';
            }
            confirmMsg += '\nThe script will navigate to each active contract to read its visits.\nClick OK to start.';

            if (!confirm(confirmMsg)) {
                btn.disabled = false;
                setStatus('Cancelled.');
                return;
            }

            // Clear the persistent log buffer so this run starts fresh
            localStorage.removeItem(PLOG_KEY);

            const st = {
                phase:        'visiting',
                stateVersion: VERSION,
                reportTitle:  titleInput.value.trim() || 'PPM Service Report',
                contracts:    contracts.map(c => ({ ...c, visited: false, error: null, visits: [], pos: [], meta: null })),
                currentIndex: 0,
            };
            saveState(st);
            setStatus(`Starting — navigating to ${contracts[0].ref}…`);
            await sleep(400);
            location.href = `/PPMContract/Detail/${contracts[0].id}#visitsTab`;
        });

        resetBtn.addEventListener('click', () => {
            if (!confirm('Clear saved progress and start over?')) return;
            clearState();
            statusBox.style.display    = 'none';
            statusBox.style.background = 'rgba(9,21,43,0.92)';
            statusBox.style.color      = '#7dd3fc';
            statusBox.style.border     = '';
            btn.disabled               = false;
            btn.style.background       = '#0f2347';
            btn.style.borderColor      = '#1a3a6b';
            btn.textContent            = `📋 Multi-Contract Report  v${VERSION}`;
        });
    }

    // ─── Detail page resume UI ────────────────────────────────────────────────
    function injectDetailResumeIndicator() {
        const st = loadState();
        if (!st || st.phase !== 'visiting') return;

        const bar = document.createElement('div');
        bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;' +
            'background:#0f2347;color:#7dd3fc;font-size:12px;font-family:monospace;' +
            'padding:7px 16px;display:flex;align-items:center;gap:12px;' +
            'box-shadow:0 2px 8px rgba(0,0,0,.4);';

        // Status lives in its own span — if we set _statusEl = bar, every
        // setStatus() call does bar.textContent = msg which destroys the buttons.
        const statusSpan = document.createElement('span');
        const contract   = st.contracts[st.currentIndex];
        const done       = st.contracts.filter(c => c.visited).length;
        statusSpan.textContent = `📋 Multi-contract report — reading ${contract?.ref || '…'} (${done + 1} / ${st.contracts.length})`;
        _statusEl = statusSpan;
        bar.appendChild(statusSpan);

        // ── Stop & Report — generate report from whatever has been collected so far
        const stopBtn = document.createElement('button');
        stopBtn.textContent  = '⏹ Stop & Report';
        stopBtn.style.cssText = 'margin-left:auto;background:#0097A7;color:#fff;' +
            'border:1px solid #00bcd4;border-radius:4px;padding:4px 12px;' +
            'font-size:11px;font-weight:600;cursor:pointer;font-family:monospace;white-space:nowrap;';
        stopBtn.addEventListener('click', () => {
            const currentSt = loadState();
            if (!currentSt) { bar.remove(); return; }
            currentSt.phase = 'done';
            saveState(currentSt);
            bar.remove();
            finalise(currentSt);
        });
        bar.appendChild(stopBtn);

        // ── Cancel — discard all collected data
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent  = '✕ Cancel';
        cancelBtn.style.cssText = 'background:rgba(255,255,255,0.08);color:#64748b;' +
            'border:1px solid rgba(255,255,255,0.12);border-radius:4px;padding:4px 10px;' +
            'font-size:11px;cursor:pointer;font-family:monospace;';
        cancelBtn.addEventListener('click', () => {
            if (!confirm('Cancel the run and discard all collected data?')) return;
            clearState();
            bar.remove();
        });
        bar.appendChild(cancelBtn);

        document.body.appendChild(bar);
    }

    // ─── Boot ─────────────────────────────────────────────────────────────────
    async function boot() {
        if (isListPage) {
            injectListButton();

            // If there's an in-progress run that somehow ended up back on list page, resume
            const st = loadState();
            if (st && st.phase === 'visiting') {
                // User navigated back manually — show status
                _statusEl = document.querySelector('#ppm-multi-wrapper div');
                if (_statusEl) {
                    _statusEl.style.display = 'block';
                    setStatus(`Run in progress (${st.contracts.filter(c=>c.visited).length}/${st.contracts.length} done). Click button to continue or Reset to clear.`);
                }
            }
            return;
        }

        if (isDetailPage) {
            const st = loadState();
            if (!st || st.phase !== 'visiting') return;

            injectDetailResumeIndicator();

            // Wait for page to settle, then process
            await sleep(1500);
            await processCurrentContract();
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();

    ppmLog(`[PPM-Multi-Report] v${VERSION} loaded`);
})();
