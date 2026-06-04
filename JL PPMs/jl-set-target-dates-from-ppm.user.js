// ==UserScript==
// @name         JL: Set Target Completion Dates from PPM Visits
// @namespace    http://tampermonkey.net/
// @version      2.13
// @description  For each job in the filtered Jobs list (all pages), reads PPM Visit Due Date + Duration, then sets Target Completion Date = Due Date + Duration (minutes). Supports dry run and stop. v2.3: collapses to a launcher button in the shared dock (drag to reorder).
// @author       UP-FM / Claude
// @match        https://go.joblogic.com/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20PPMs/jl-set-target-dates-from-ppm.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20PPMs/jl-set-target-dates-from-ppm.user.js
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
    // A small help banner prepended inside a panel the first time it opens.
    function jlHelpBanner(text) {
        const b = document.createElement('div');
        b.className = 'jl-help-banner';
        b.style.cssText = 'background:#0e3a4f;color:#e3edf2;font-family:"Open Sans",sans-serif;font-size:11px;line-height:1.45;padding:8px 10px;border-radius:4px;margin:0 0 8px 0;border-left:3px solid #ff7919;';
        b.textContent = text;
        return b;
    }
    // Collapse a panel to a dock button. panelEl = the OUTERMOST element of the
    // script's floating UI. desc = on-hover + in-panel summary text.
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

    const SCRIPT_ID = 'target-dates-ppm';
    const SCRIPT_LABEL = '🎯 Target Dates (PPM)';
    const SCRIPT_COLOR = '#ff7919';
    const SCRIPT_DESC = 'For every job in the filtered list across all pages, reads the PPM Visit Due Date and Duration and sets Target Completion Date = Due Date plus Duration. Supports dry run. Apply a filter, then Start.';

    if (window.__jlTargetDatesLoaded) return;
    window.__jlTargetDatesLoaded = true;

    const VERSION   = '2.2';
    const STATE_KEY = 'jl-target-dates-v2';

    // ─────────────────────────────────────────────────────────────────────────
    // STATE
    // ─────────────────────────────────────────────────────────────────────────
    function loadState() {
        try { return JSON.parse(localStorage.getItem(STATE_KEY) || 'null'); } catch { return null; }
    }
    function saveState(s) { localStorage.setItem(STATE_KEY, JSON.stringify(s)); }
    function clearState() { localStorage.removeItem(STATE_KEY); }
    function isStopped()  { return !!(loadState()?.stopped); }

    // ─────────────────────────────────────────────────────────────────────────
    // UTILITIES
    // ─────────────────────────────────────────────────────────────────────────
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const qs  = (s, r = document) => r.querySelector(s);
    const qsa = (s, r = document) => [...r.querySelectorAll(s)];

    function waitFor(fn, { timeout = 10000, interval = 150 } = {}) {
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

    async function fetchText(url) {
        const r = await fetch(url, { credentials: 'same-origin' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DATE UTILITIES
    // ─────────────────────────────────────────────────────────────────────────
    function parseUKDate(str) {
        if (!str) return null;
        const s = String(str).trim();
        const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[\sT](\d{1,2}):(\d{2}))?/);
        if (!m) return null;
        const d = new Date(+m[3], +m[2] - 1, +m[1], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
        return isNaN(d) ? null : d;
    }

    function formatUKDate(d) {
        const p = n => String(n).padStart(2, '0');
        return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }

    function addMinutes(date, minutes) {
        return new Date(date.getTime() + minutes * 60000);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // COLLECT JOBS — all pages of the filtered grid
    // ─────────────────────────────────────────────────────────────────────────
    function parseGridItems(data) {
        const jobs = [];
        for (const raw of data) {
            const item = (raw && typeof raw.toJSON === 'function') ? raw.toJSON() : raw;
            const id  = item.Id || item.id || item.JobId || item.jobId;
            if (!id) continue;

            const ref = item.JobNumber || item.ReferenceNumber || item.Reference
                      || item.jobNumber || item.referenceNumber || String(id);

            const rawDate = item.DueDate || item.dueDate || item.PlannedDate
                          || item.RequiredDate || item.TargetDate;
            let jobDueDate = null;
            if (rawDate) {
                const d = rawDate instanceof Date ? rawDate : parseUKDate(String(rawDate));
                if (d && !isNaN(d)) jobDueDate = formatUKDate(d);
            }

            // Try to read PPM contract ID directly from grid data — saves a fetch per job
            const ppmFromGrid = item.PPMContractId || item.PpmContractId || item.PPMId
                              || item.ContractId    || item.ppmContractId || null;

            const job = makeJob(String(id), String(ref), jobDueDate);
            if (ppmFromGrid) job.ppmContractId = String(ppmFromGrid);
            jobs.push(job);
        }
        return jobs;
    }

    async function collectAllJobsFromGrid() {
        const $ = window.jQuery || window.$;
        if (!$) return null;

        const gridEl = document.querySelector('[data-role="grid"]');
        if (!gridEl) return null;

        const grid = $(gridEl).data('kendoGrid');
        if (!grid) return null;

        const ds = grid.dataSource;

        // ── Determine total pages ──────────────────────────────────────────────
        // Priority 1: Kendo pager widget (most reliable — it's what the UI shows)
        let totalPages = 1;
        const pagerEl = gridEl.querySelector('[data-role="pager"]')
                     || document.querySelector('.k-pager-wrap');
        if (pagerEl && $) {
            const pager = $(pagerEl).data('kendoPager');
            if (pager && typeof pager.totalPages === 'function') {
                totalPages = pager.totalPages() || 1;
            }
        }

        // Priority 2: parse "1–50 of 250 items" text from pager info span
        if (totalPages <= 1 && pagerEl) {
            const infoEl = pagerEl.querySelector('.k-pager-info');
            if (infoEl) {
                const m = infoEl.textContent.match(/of\s+([\d,]+)/i);
                if (m) {
                    const total = parseInt(m[1].replace(/,/g, ''), 10);
                    const ps    = ds.pageSize() || 50;
                    if (total > ps) totalPages = Math.ceil(total / ps);
                }
            }
        }

        // Priority 3: ds.total() vs pageSize
        if (totalPages <= 1) {
            const total = ds.total();
            const ps    = ds.pageSize() || 50;
            if (total > ps) totalPages = Math.ceil(total / ps);
        }

        // Single page — no navigation needed
        if (totalPages <= 1) {
            const data = ds.data().length ? ds.data() : ds.view();
            return parseGridItems(data);
        }

        // ── Walk all pages ─────────────────────────────────────────────────────
        const originalPage = ds.page() || 1;
        const allJobs = [];

        log(`Grid has ${totalPages} page(s). Collecting all…`, '#0af');

        for (let p = 1; p <= totalPages; p++) {
            setProgress(`Collecting page ${p} / ${totalPages}…`);

            if (ds.page() !== p) {
                await new Promise(resolve => {
                    const onDone = () => resolve();
                    ds.one('change', onDone);
                    ds.page(p);
                    setTimeout(onDone, 4000); // safety
                });
                await sleep(400);
            }

            allJobs.push(...parseGridItems(ds.view()));
        }

        // Restore view
        if (ds.page() !== originalPage) ds.page(originalPage);

        return allJobs;
    }

    function makeJob(jobId, jobRef, jobDueDate) {
        return {
            jobId, jobRef, jobDueDate,
            ppmContractId: null, visitDueDate: null, durationMinutes: null,
            targetDate: null, status: 'pending', error: null
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FIND PPM CONTRACT ID — three strategies in order
    // ─────────────────────────────────────────────────────────────────────────

    // 1) Parse a fetched /Job/Detail/{id} HTML page
    function parsePPMContractIdFromHtml(html) {
        const doc = new DOMParser().parseFromString(html, 'text/html');

        // Anchor links — accept any ID containing at least one digit (not a plain word like "Edit")
        for (const a of doc.querySelectorAll('a[href*="PPMContract/Detail/"]')) {
            const href = a.getAttribute('href') || '';
            // Allow hyphens so GUIDs like 04b1f3ea-8825-4042-ba5e-e5da3b8c7c08 are captured in full
            const m = href.match(/PPMContract\/Detail\/([A-Za-z0-9][A-Za-z0-9\-]*)/);
            if (m && /\d/.test(m[1]) && !/^(edit|create|index|delete|view|list)$/i.test(m[1])) {
                return m[1];
            }
        }

        // Hidden inputs / data attributes
        for (const sel of ['[name="PPMContractId"]', '[name="PpmContractId"]', '[data-ppm-contract-id]']) {
            const el = doc.querySelector(sel);
            const v  = el?.value || el?.dataset?.ppmContractId;
            if (v && /\d/.test(v)) return v;
        }

        // Raw text scan — allow hyphens to capture GUIDs in full
        for (const m of html.matchAll(/PPMContract\/Detail\/([A-Za-z0-9][A-Za-z0-9\-]{2,})/g)) {
            const id = m[1];
            if (/\d/.test(id) && !/^(edit|create|index|delete|view|list)$/i.test(id)) return id;
        }

        return null;
    }

    // 2) Derive contract reference from job reference, then search the API
    //    "PM0000579/001" → "PM0000579" → search → return internal numeric ID
    function deriveContractRef(jobRef) {
        // Standard Joblogic PPM format: <letters><digits>/<visit number>
        const m = String(jobRef).match(/^([A-Za-z]*\d+)(?:\/|$)/);
        return m ? m[1] : null;
    }

    async function searchPPMContractByRef(contractRef) {
        if (!contractRef) return null;
        try {
            const resp = await fetch('/api/PPMContract/SearchJsonData', {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                },
                body: JSON.stringify({ SearchTerm: contractRef, PageSize: 5, PageIndex: 1 }),
            });
            if (!resp.ok) return null;
            const data = await resp.json();
            const list = data.AdditionalData?.PPMContracts
                      || data.AdditionalData?.Contracts
                      || data.Data || data.data || [];
            const target = contractRef.toLowerCase();
            const match = list.find(c => {
                const r = (c.Reference || c.ContractReference || c.PPMContractNumber || c.Number || '').toLowerCase();
                return r === target;
            }) || list[0];
            if (match) return String(match.Id || match.id || match.ContractId || '');
        } catch {}
        return null;
    }

    // Master resolver — tries grid data (already filled), then HTML fetch, then search API
    async function resolvePPMContractId(job) {
        // Already resolved (e.g. from grid data)
        if (job.ppmContractId) return job.ppmContractId;

        // Strategy A: fetch the job detail page and parse HTML
        try {
            const html = await fetchText(`/Job/Detail/${job.jobId}`);
            const id = parsePPMContractIdFromHtml(html);
            if (id) return id;
            // Log diagnostic: show all PPMContract hrefs found
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const hrefs = [...doc.querySelectorAll('a[href*="PPMContract"]')].map(a => a.getAttribute('href'));
            if (hrefs.length) log(`  HTML has PPMContract links: ${hrefs.join(', ')}`, '#888');
            else log(`  No PPMContract links found in /Job/Detail/${job.jobId} HTML (may be JS-rendered)`, '#888');
        } catch (e) {
            log(`  HTML fetch failed: ${e.message}`, '#888');
        }

        // Strategy B: derive ref from job number and search API
        const contractRef = deriveContractRef(job.jobRef);
        if (contractRef) {
            log(`  Trying search API for contract ref "${contractRef}"…`, '#888');
            const id = await searchPPMContractByRef(contractRef);
            if (id) { log(`  Found via search: ${id}`, '#888'); return id; }
        }

        return null;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // READ VISIT DATA FROM LIVE PPM CONTRACT PAGE
    // ─────────────────────────────────────────────────────────────────────────
    async function readVisitData(jobId, jobDueDate) {
        const allRows = qsa('#ppmVisits ul.list-group > li.list-group-item')
            .filter(r => r.offsetParent !== null);
        if (!allRows.length) throw new Error('No visit rows visible — is the Visits tab loaded?');

        // Strategy 1: direct job link in the row
        let targetRow = allRows.find(row =>
            qsa(`a[href*="/Job/Detail/${jobId}"]`, row).length > 0
        );

        // Strategy 2: closest due date to the job's due date
        if (!targetRow && jobDueDate) {
            const jobDate = parseUKDate(jobDueDate);
            if (jobDate) {
                let bestDiff = Infinity;
                for (const row of allRows) {
                    const dates = (row.textContent.match(/\d{1,2}\/\d{1,2}\/\d{4}/g) || [])
                        .map(parseUKDate).filter(Boolean);
                    for (const d of dates) {
                        const diff = Math.abs(d - jobDate);
                        if (diff < bestDiff) { bestDiff = diff; targetRow = row; }
                    }
                }
            }
        }

        // Strategy 3: first row
        if (!targetRow) targetRow = allRows[0];

        const rowSummary = (targetRow.querySelector('.visit-info-description, .visit-info') || targetRow)
            .textContent.trim().slice(0, 80);
        log(`  Visit row: "${rowSummary}"`);

        // Due date from row header (before expanding)
        const headerEl = targetRow.querySelector('.visit-info-description, .visit-info, .list-group-item-heading') || targetRow;
        const headerDates = (headerEl.textContent.match(/\d{1,2}\/\d{1,2}\/\d{4}(?:\s+\d{2}:\d{2})?/g) || [])
            .map(parseUKDate).filter(Boolean);
        let dueDate = headerDates[0] || null;

        // Expand the row to access fields
        const details = targetRow.querySelector('.visit-details');
        const isExpanded = details && getComputedStyle(details).display !== 'none' && details.childElementCount > 0;
        if (!isExpanded) {
            const trigger = targetRow.querySelector('.visit-info-description')
                         || targetRow.querySelector('.visit-info') || targetRow;
            trigger.click();
            try {
                await waitFor(() => {
                    const d = targetRow.querySelector('.visit-details');
                    return d && getComputedStyle(d).display !== 'none' && d.childElementCount > 0 ? d : null;
                }, { timeout: 5000 });
            } catch {
                throw new Error('Visit row did not expand — cannot read Duration');
            }
            await sleep(250);
        }

        const scope = targetRow.querySelector('.visit-details') || targetRow;

        // Due date from expanded details if still missing
        if (!dueDate) {
            for (const lbl of qsa('label', scope)) {
                const txt = lbl.textContent.toLowerCase().replace(/\*$/, '').trim();
                if (!txt.includes('due') && !txt.includes('planned') && !txt.includes('scheduled')) continue;
                const forId = lbl.getAttribute('for');
                const inp = forId ? scope.querySelector('#' + CSS.escape(forId))
                    : lbl.nextElementSibling?.querySelector?.('input')
                    || lbl.parentElement?.querySelector?.('input');
                if (inp) { dueDate = parseUKDate(inp.value); if (dueDate) break; }
            }
        }
        if (!dueDate) {
            const anyDates = (scope.textContent.match(/\d{1,2}\/\d{1,2}\/\d{4}(?:\s+\d{2}:\d{2})?/g) || [])
                .map(parseUKDate).filter(Boolean);
            dueDate = anyDates[0] || null;
        }

        // Duration
        let durationMinutes = null;
        for (const lbl of qsa('label', scope)) {
            const txt = lbl.textContent.toLowerCase().replace(/\*$/, '').trim();
            if (!txt.startsWith('duration')) continue;
            const forId = lbl.getAttribute('for');
            let inp = forId ? scope.querySelector('#' + CSS.escape(forId)) : null;
            if (!inp) inp = lbl.parentElement?.querySelector?.('input[type="number"], input[type="text"]');
            if (inp) {
                const v = parseFloat((inp.value || '').replace(/[^\d.]/g, ''));
                if (!isNaN(v) && v > 0) { durationMinutes = v; break; }
            }
        }

        if (!dueDate)             throw new Error('Due Date not found in visit row');
        if (durationMinutes === null) throw new Error('Duration not found in visit row');

        return { dueDate: formatUKDate(dueDate), durationMinutes };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // UPDATE JOB TARGET COMPLETION DATE
    // ─────────────────────────────────────────────────────────────────────────
    async function updateJobTargetDate(jobId, targetDateStr) {
        const editHtml = await fetchText(`/Job/Edit/${jobId}`);
        const doc = new DOMParser().parseFromString(editHtml, 'text/html');

        const form = doc.querySelector('form');
        if (!form) throw new Error('Job edit form not found at /Job/Edit/' + jobId);

        const fd = new FormData();
        for (const el of qsa('input, select, textarea', doc)) {
            if (!el.name) continue;
            if (el.type === 'checkbox' || el.type === 'radio') {
                if (el.checked) fd.append(el.name, el.value);
            } else {
                fd.append(el.name, el.value || '');
            }
        }

        const targetInput = qsa('[name]', doc).find(el => {
            const n = el.name.toLowerCase();
            return (n.includes('target') && n.includes('date'))
                || n.includes('targetcompletion')
                || n.includes('completiondate');
        });

        if (!targetInput) {
            const dateFields = qsa('[name]', doc)
                .filter(el => el.name.toLowerCase().includes('date'))
                .map(el => el.name);
            throw new Error(`Target date field not found. Date fields: ${dateFields.join(', ')}`);
        }

        fd.set(targetInput.name, targetDateStr);
        log(`  Field "${targetInput.name}" → ${targetDateStr}`);

        const resp = await fetch(form.action || `/Job/Edit/${jobId}`, {
            method: 'POST',
            credentials: 'same-origin',
            body: fd,
        });
        if (!resp.ok) throw new Error(`POST returned HTTP ${resp.status}`);

        const respHtml = await resp.text();
        const errDoc = new DOMParser().parseFromString(respHtml, 'text/html');
        const errMsgs = qsa('.validation-summary-errors li, .field-validation-error', errDoc)
            .map(e => e.textContent.trim()).filter(Boolean);
        if (errMsgs.length) throw new Error('Validation: ' + errMsgs.join('; '));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // WORKFLOW
    // ─────────────────────────────────────────────────────────────────────────
    async function collectJobs() {
        setRunningUI(true);
        _logArea.innerHTML = '';
        setProgress('Collecting…');

        let jobs = null;
        try {
            jobs = await collectAllJobsFromGrid();
            // Log first item's keys so we can see what the grid actually provides
            if (jobs?.length) {
                const $ = window.jQuery || window.$;
                const gridEl = document.querySelector('[data-role="grid"]');
                if (gridEl && $) {
                    const grid = $(gridEl).data('kendoGrid');
                    if (grid) {
                        const sample = grid.dataSource.view()[0];
                        if (sample) {
                            const obj = sample.toJSON ? sample.toJSON() : sample;
                            log(`Grid fields: ${Object.keys(obj).join(', ')}`, '#555');
                        }
                    }
                }
            }
        } catch (e) {
            log(`Grid error: ${e.message}`, '#f55');
        }

        // Fallback: scrape links
        if (!jobs?.length) {
            log('Grid API unavailable — scraping job links from DOM.', '#fa0');
            const seen = new Set();
            jobs = qsa('a[href*="/Job/Detail/"]')
                .map(a => { const m = a.href.match(/Job\/Detail\/(\d+)/); return m ? m[1] : null; })
                .filter(id => id && !seen.has(id) && seen.add(id))
                .map(id => makeJob(id, id, null));
        }

        if (!jobs?.length) {
            log('No jobs found. Make sure the grid is loaded and filtered.', '#f55');
            setRunningUI(false);
            setProgress('Ready.');
            return;
        }

        const dryRun = qs('#jltd-dry')?.checked || false;
        const st = {
            version: VERSION,
            phase: 'prefetching',
            jobs,
            currentIndex: 0,
            dryRun,
            running: false,
            stopped: false,
        };
        saveState(st);

        const fromGrid = jobs.filter(j => j.ppmContractId).length;
        log(`Collected ${jobs.length} job(s)${dryRun ? ' [DRY RUN]' : ''}. ${fromGrid > 0 ? `${fromGrid} already have PPM contract ID from grid.` : ''}`, '#0af');
        jobs.forEach(j => log(`  ${j.jobRef} (id=${j.jobId})${j.ppmContractId ? ' → PPM ' + j.ppmContractId : ''}`, '#555'));

        setProgress(`${jobs.length} jobs ready. Click Run.`);
        setRunningUI(false);
        qs('#jltd-run').disabled = false;
    }

    async function startRun() {
        const st = loadState();
        if (!st?.jobs?.length) {
            log('Nothing loaded — click "Collect Jobs" first.', '#f55');
            return;
        }

        st.running = true;
        st.stopped = false;
        saveState(st);
        setRunningUI(true);

        try {
            if (st.phase === 'prefetching' || st.phase === 'stopped') {
                st.phase = 'prefetching';
                saveState(st);
                await runPhaseA(st);
            } else if (location.pathname.match(/PPMContract\/Detail/i)) {
                await runPhaseB(st);
            } else {
                log('Unexpected state — try Reset or navigate back to the jobs list.', '#f55');
                setRunningUI(false);
            }
        } catch (e) {
            log('Run error: ' + e.message, '#f55');
            setRunningUI(false);
        }
    }

    // Phase A: resolve PPM contract IDs for all jobs
    async function runPhaseA(st) {
        log(`v${VERSION} — Phase A: resolving PPM contract IDs${st.dryRun ? ' [DRY RUN]' : ''}`, '#0af');

        for (let i = 0; i < st.jobs.length; i++) {
            if (isStopped()) { handleStop(st); return; }

            const job = st.jobs[i];
            if (job.status !== 'pending') continue;
            if (job.ppmContractId) {
                log(`  ✓ ${job.jobRef} → PPM ${job.ppmContractId} (from grid)`, '#555');
                continue;
            }

            setProgress(`Prefetching ${i + 1} / ${st.jobs.length}: ${job.jobRef}`);
            const id = await resolvePPMContractId(job);
            if (id) {
                job.ppmContractId = id;
                log(`  ✓ ${job.jobRef} → PPM ${id}`, '#555');
            } else {
                job.status = 'skipped';
                job.error  = 'Could not find PPM contract ID (tried HTML + search API)';
                log(`  ⚠ ${job.jobRef}: no PPM contract found — skipping`, '#fa0');
            }

            saveState(st);
            await sleep(250);
        }

        const first = st.jobs.findIndex(j => j.status === 'pending' && j.ppmContractId);
        if (first < 0) { finishRun(st); return; }

        st.currentIndex = first;
        st.phase = 'navigating';
        saveState(st);

        const next = st.jobs[first];
        log(`Navigating to PPM ${next.ppmContractId} for ${next.jobRef}…`, '#0af');
        await sleep(500);
        location.href = `/PPMContract/Detail/${next.ppmContractId}#visitsTab`;
    }

    // Phase B: on each PPM contract page, read visit data and update the job
    async function runPhaseB(st) {
        const job = st.jobs[st.currentIndex];
        if (!job) { finishRun(st); return; }

        if (isStopped()) { handleStop(st); return; }

        const tag = st.dryRun ? ' [DRY RUN]' : '';
        setProgress(`[${st.currentIndex + 1} / ${st.jobs.length}] ${job.jobRef}${tag}`);
        log(`--- [${st.currentIndex + 1}/${st.jobs.length}] ${job.jobRef}${tag} ---`, '#fff');

        if (!location.hash.includes('visitsTab')) {
            location.hash = 'visitsTab';
            await sleep(800);
        }

        try {
            await waitFor(
                () => qsa('#ppmVisits ul.list-group > li.list-group-item')
                        .filter(r => r.offsetParent !== null).length > 0,
                { timeout: 12000 }
            );
        } catch {
            job.status = 'error';
            job.error  = 'Visits tab did not load within 12s';
            log(`  ✗ ${job.error}`, '#f55');
            saveState(st);
            return navigateToNext(st);
        }

        try {
            const { dueDate, durationMinutes } = await readVisitData(job.jobId, job.jobDueDate);
            job.visitDueDate    = dueDate;
            job.durationMinutes = durationMinutes;

            const targetDateObj = addMinutes(parseUKDate(dueDate), durationMinutes);
            job.targetDate      = formatUKDate(targetDateObj);

            log(`  Due: ${dueDate}`, '#0af');
            log(`  Duration: ${durationMinutes} min (${(durationMinutes / 1440).toFixed(1)} days)`, '#0af');
            log(`  Target: ${job.targetDate}`, st.dryRun ? '#fa0' : '#0fa');

            if (st.dryRun) {
                job.status = 'dry-ok';
                log('  [DRY RUN] No changes saved.', '#fa0');
            } else {
                await updateJobTargetDate(job.jobId, job.targetDate);
                job.status = 'ok';
                log('  ✓ Saved', '#0fa');
            }
        } catch (e) {
            job.status = 'error';
            job.error  = e.message;
            log(`  ✗ ${e.message}`, '#f55');
        }

        saveState(st);
        await navigateToNext(st);
    }

    async function navigateToNext(st) {
        if (isStopped()) { handleStop(st); return; }

        st.currentIndex++;
        while (st.currentIndex < st.jobs.length) {
            const j = st.jobs[st.currentIndex];
            if (j.status === 'pending' && j.ppmContractId) break;
            if (j.status === 'pending') { j.status = 'skipped'; j.error = 'No PPM contract ID'; }
            st.currentIndex++;
        }
        saveState(st);

        if (st.currentIndex >= st.jobs.length) { finishRun(st); return; }

        const next = st.jobs[st.currentIndex];
        log(`Navigating to PPM ${next.ppmContractId} for ${next.jobRef}…`, '#0af');
        await sleep(600);
        location.href = `/PPMContract/Detail/${next.ppmContractId}#visitsTab`;
    }

    function handleStop(st) {
        st.running = false;
        st.stopped = true;
        st.phase   = 'stopped';
        saveState(st);
        setRunningUI(false);
        const done = st.jobs.filter(j => j.status !== 'pending').length;
        const msg  = `Stopped — ${done} / ${st.jobs.length} processed. Click Run to resume, Reset to clear.`;
        setProgress(msg);
        log(msg, '#fa0');
    }

    function finishRun(st) {
        st.running = false;
        st.phase   = 'done';
        saveState(st);
        setRunningUI(false);

        const isDry   = st.dryRun;
        const ok      = st.jobs.filter(j => j.status === (isDry ? 'dry-ok' : 'ok')).length;
        const skipped = st.jobs.filter(j => j.status === 'skipped').length;
        const failed  = st.jobs.filter(j => j.status === 'error').length;
        const verb    = isDry ? 'calculated' : 'updated';
        const tag     = isDry ? '[DRY RUN] ' : '';

        const msg = `${tag}Done — ✓ ${ok} ${verb}  ⚠ ${skipped} skipped  ✗ ${failed} failed`;
        setProgress(msg);
        log(msg, '#0fa');
        if (isDry) log('No changes were made to Joblogic.', '#fa0');
        st.jobs.filter(j => j.status === 'error').forEach(j =>
            log(`  ✗ ${j.jobRef}: ${j.error}`, '#f55')
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // UI
    // ─────────────────────────────────────────────────────────────────────────
    let _logArea = null;

    function log(msg, color = '#aaa') {
        console.log('[JL-TargetDates]', msg);
        if (!_logArea) return;
        const el = document.createElement('div');
        el.style.color = color;
        el.textContent = msg;
        _logArea.appendChild(el);
        _logArea.scrollTop = _logArea.scrollHeight;
    }

    function setProgress(msg) {
        const el = qs('#jltd-progress');
        if (el) el.textContent = msg;
    }

    // IMPORTANT: always use explicit display values — never '' (empty string)
    // which lets CSS `display:none` rules take over and hide elements unexpectedly.
    function setRunningUI(running) {
        const collect = qs('#jltd-collect');
        const run     = qs('#jltd-run');
        const stop    = qs('#jltd-stop');
        const dryWrap = qs('#jltd-dry-wrap');
        const reset   = qs('#jltd-reset');

        if (run)     run.style.display     = running ? 'none'         : 'inline-block';
        if (stop)    stop.style.display    = running ? 'inline-block' : 'none';
        if (collect) collect.disabled      = running;
        if (dryWrap) dryWrap.style.opacity = running ? '0.4' : '1';
        if (reset)   reset.disabled        = running;
    }

    function buildPanel() {
        if (qs('#jltd-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'jltd-panel';
        panel.innerHTML = `
<style>
  #jltd-panel{position:fixed;top:10px;right:10px;z-index:99999;background:#1a1a2e;color:#eee;
    border-radius:8px;width:440px;max-height:88vh;display:flex;flex-direction:column;
    font-family:monospace;font-size:12px;box-shadow:0 4px 20px rgba(0,0,0,.5);}
  #jltd-panel header{display:flex;justify-content:space-between;align-items:center;
    padding:10px 14px;border-bottom:1px solid #333;cursor:move;user-select:none;}
  #jltd-panel .body{padding:10px 14px;display:flex;flex-direction:column;gap:8px;overflow-y:auto;}
  #jltd-panel .controls{display:flex;gap:6px;flex-wrap:wrap;align-items:center;}
  #jltd-panel button{background:#2563eb;color:#fff;border:0;border-radius:4px;
    padding:6px 12px;cursor:pointer;font-family:inherit;font-size:12px;display:inline-block;}
  #jltd-panel button.red{background:#991b1b;}
  #jltd-panel button.amber{background:#b45309;}
  #jltd-panel button.x{background:none;border:none;color:#eee;font-size:18px;cursor:pointer;line-height:1;}
  #jltd-panel button[disabled]{opacity:.4;cursor:not-allowed;}
  #jltd-panel #jltd-stop{display:none;}
  #jltd-panel #jltd-dry-wrap{display:inline-flex;align-items:center;gap:5px;
    font-size:12px;cursor:pointer;user-select:none;color:#d1d5db;}
  #jltd-panel #jltd-dry-wrap input{cursor:pointer;accent-color:#f59e0b;}
  #jltd-panel #jltd-progress{color:#0fa;font-weight:600;min-height:14px;word-break:break-word;}
  #jltd-panel #jltd-log{background:#0a0a1a;padding:8px;border-radius:4px;
    max-height:54vh;overflow-y:auto;white-space:pre-wrap;word-break:break-word;}
  #jltd-panel #jltd-log div{padding:1px 0;line-height:1.3;}
</style>
<header>
  <b>📅 Set Target Dates from PPM <span style="font-weight:400;color:#475569;font-size:11px;">v${VERSION}</span></b>
  <button class="x" id="jltd-close">×</button>
</header>
<div class="body">
  <div id="jltd-progress">Ready.</div>
  <div class="controls">
    <button id="jltd-collect">1. Collect Jobs</button>
    <button id="jltd-run" disabled>2. Run</button>
    <button id="jltd-stop" class="red">⏹ Stop</button>
    <label id="jltd-dry-wrap"><input type="checkbox" id="jltd-dry"> Dry run</label>
    <button id="jltd-reset" class="amber">Reset</button>
  </div>
  <div id="jltd-log"></div>
</div>`;

        document.body.appendChild(panel);
        jlRegisterPanel(panel, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR, SCRIPT_DESC);
        _logArea = panel.querySelector('#jltd-log');

        // Draggable
        let drag = null;
        panel.querySelector('header').addEventListener('mousedown', e => {
            if (e.target.closest('button')) return;
            drag = { x: e.clientX - panel.offsetLeft, y: e.clientY - panel.offsetTop };
        });
        window.addEventListener('mouseup', () => drag = null);
        window.addEventListener('mousemove', e => {
            if (!drag) return;
            panel.style.left = (e.clientX - drag.x) + 'px';
            panel.style.top  = (e.clientY - drag.y) + 'px';
            panel.style.right = 'auto';
        });

        panel.querySelector('#jltd-close').onclick  = () => { panel.style.display = 'none'; };
        panel.querySelector('#jltd-collect').onclick = collectJobs;
        panel.querySelector('#jltd-run').onclick     = startRun;
        panel.querySelector('#jltd-reset').onclick   = () => {
            if (!confirm('Clear all state and start over?')) return;
            clearState();
            _logArea.innerHTML = '';
            setProgress('Ready.');
            setRunningUI(false);
            qs('#jltd-run').disabled = true;
        };
        panel.querySelector('#jltd-stop').onclick = () => {
            const st = loadState();
            if (!st) return;
            st.stopped = true;
            saveState(st);
            qs('#jltd-stop').disabled = true;
            log('Stop requested — will halt after current job.', '#fa0');
        };

        // Restore state
        const st = loadState();
        if (st?.jobs?.length) {
            const done = st.jobs.filter(j => j.status !== 'pending').length;
            if (st.running && !st.stopped) {
                setRunningUI(true);
                setProgress(`Running… ${done} / ${st.jobs.length}`);
            } else {
                const label = st.phase === 'done' ? 'complete' : 'paused';
                setProgress(`${done} / ${st.jobs.length} processed (${label}). ${st.phase !== 'done' ? 'Click Run to continue.' : ''}`);
                qs('#jltd-run').disabled = (st.phase === 'done');
                if (st.dryRun && qs('#jltd-dry')) qs('#jltd-dry').checked = true;
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // BOOT
    // ─────────────────────────────────────────────────────────────────────────
    function boot() {
        buildPanel();

        const st = loadState();
        if (!st?.running || st.stopped) return;

        if (st.phase === 'navigating' && location.pathname.match(/PPMContract\/Detail/i)) {
            log(`v${VERSION} — resuming run…${st.dryRun ? ' [DRY RUN]' : ''}`, '#0af');
            setRunningUI(true);
            setTimeout(async () => {
                try {
                    await runPhaseB(st);
                } catch (e) {
                    log('Resume error: ' + e.message, '#f55');
                    setRunningUI(false);
                }
            }, 1500);
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();

    console.log(`[JL-TargetDates] v${VERSION} loaded`);
})();
