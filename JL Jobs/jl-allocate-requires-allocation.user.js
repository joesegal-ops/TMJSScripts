// ==UserScript==
// @name         Joblogic - Allocate Requires-Allocation Jobs
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  On the Jobs list, pulls the "Requires Allocation" quick-filter grid, reads the Site Staffing sheet (live, cached), optionally amends it with a free-text labour plan parsed by the Claude API, then picks the best engineer per job (site + trade first, multi-skilled only for basic repairs) and previews every allocation before creating/deploying the visits. Exports CSV at any point. Collapses into the shared JL dock.
// @match        https://go.joblogic.com/*
// @connect      docs.google.com
// @connect      api.anthropic.com
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-start
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/jl-allocate-requires-allocation.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/jl-allocate-requires-allocation.user.js
// ==/UserScript==

(function () {
    'use strict';

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
    const SCRIPT_ID = 'allocate-req-alloc';
    const SCRIPT_LABEL = '👷 Allocate Jobs';
    const SCRIPT_COLOR = '#1f5a3a';
    const SCRIPT_DESC = 'Pulls the "Requires Allocation" jobs, matches each to the right engineer using the Site Staffing sheet (plus any labour-plan changes you paste in), and shows you every pick before it writes a single visit.';

    // =======================================================================
    // CONFIG  — the allocation rules live here; edit these, not the code below
    // =======================================================================

    // Site Staffing sheet (gid 0 = the staffing matrix tab)
    const STAFFING_SHEET_ID = '1Co0L-mzac0dI3CphPt3yEwiFXWW6a5mdkcKder772qA';
    const STAFFING_GID = '0';
    const STAFFING_CACHE_KEY = 'jl-alloc-staffing-cache';
    const NAME_MAP_KEY = 'jl-alloc-name-overrides';   // { "Robert D": 12345 }
    const API_KEY_KEY = 'jl-alloc-anthropic-key';
    const PLAN_KEY = 'jl-alloc-last-plan';
    const CLAUDE_MODEL = 'claude-opus-5';

    // The staffing-sheet rows that name an engineer we can allocate to.
    // Order matters: it is the fallback order when a job's own trade row is empty.
    const TRADE_ROWS = ['Electrical', 'Plumbing', 'Fabric', 'Mechanical', 'HVAC', 'Multi-Skilled'];
    // Rows that name office staff, not engineers — parsed for context, never allocated.
    const OFFICE_ROWS = ['Contract Manager', 'Technical Supervisor', 'Lead Contract Support', 'Scheduler'];

    // Job Category -> staffing rows to try, best first.
    // A category that is NOT in this map falls back to CATEGORY_DEFAULT.
    const CATEGORY_TO_ROWS = {
        'electrical': ['Electrical', 'Multi-Skilled'],
        'lighting': ['Electrical', 'Multi-Skilled'],
        'phone booth': ['Electrical', 'Multi-Skilled'],
        'power': ['Electrical', 'Multi-Skilled'],
        'plumbing': ['Plumbing', 'Mechanical', 'Multi-Skilled'],
        'restrooms': ['Plumbing', 'Mechanical', 'Multi-Skilled'],
        'bathrooms': ['Plumbing', 'Mechanical', 'Multi-Skilled'],
        'leaks': ['Plumbing', 'Mechanical', 'Multi-Skilled'],
        'drainage': ['Plumbing', 'Mechanical'],
        'mechanical': ['Mechanical', 'Plumbing'],
        'hvac': ['HVAC'],
        'heating and cooling (hvac)': ['HVAC'],
        'air conditioning': ['HVAC'],
        'ventilation': ['HVAC'],
        'bms': ['HVAC'],
        'appliances': [],
        'emergency lighting': ['Electrical'],
        'fire, life, safety': [],
        'fire life safety': [],
        'water hygiene & compliance': [],
        'doors': ['Fabric', 'Multi-Skilled'],
        'door stoppers': ['Multi-Skilled', 'Fabric'],
        'carpentry': ['Fabric', 'Multi-Skilled'],
        'carpentry/handyman': ['Multi-Skilled', 'Fabric'],
        'handyman': ['Multi-Skilled', 'Fabric'],
        'fabric': ['Fabric', 'Multi-Skilled'],
        'furniture': ['Fabric', 'Multi-Skilled'],
        'furniture/accessories': ['Fabric', 'Multi-Skilled'],
        'flooring': ['Fabric', 'Multi-Skilled'],
        'glass': ['Fabric', 'Multi-Skilled'],
        'glass & windows': ['Fabric', 'Multi-Skilled'],
        'painting and wall repair': ['Fabric', 'Multi-Skilled'],
        'signage': ['Fabric', 'Multi-Skilled'],
        'general': ['Multi-Skilled', 'Fabric'],
    };
    const CATEGORY_DEFAULT = ['Multi-Skilled', 'Fabric'];

    // Company-wide specialists who are NOT on the site staffing sheet because
    // they cover every site. Tried before the sheet for these categories.
    // Empty this out if you only ever want the sheet to decide.
    const GLOBAL_SPECIALISTS = {
        'appliances': ['George Kirumira'],
    };

    // SPECIALIST WORK — the multi-skilled engineer can do basic repairs, not these.
    // If a job's category matches here, "Multi-Skilled" is struck out of the
    // candidate list and the job goes unallocated rather than to the wrong person.
    const SPECIALIST_CATEGORIES = [
        'hvac', 'heating and cooling (hvac)', 'air conditioning', 'ventilation', 'refrigeration',
        'bms', 'gas', 'fire', 'fire alarm', 'sprinkler', 'lift', 'lifts', 'escalator',
        'appliances', 'emergency lighting', 'water hygiene', 'compliance',
        'generator', 'ups', 'water treatment', 'legionella', 'asbestos', 'water hygiene',
        'eicr', 'electrical testing', 'fixed wire', 'pat testing', 'high voltage', 'hv',
        'access control', 'cctv', 'security systems', 'automatic doors', 'roller shutter',
    ];
    // ...and the same idea on the description, for jobs logged under a vague category.
    const SPECIALIST_DESCRIPTION_KEYWORDS = [
        'chiller', 'ahu', 'air handling', 'vrv', 'vrf', 'fcu', 'fan coil', 'condenser',
        'gas safe', 'boiler service', 'fire alarm', 'sprinkler', 'dry riser', 'lift car',
        'legionella', 'asbestos', 'high voltage', 'hv switch', 'generator', 'ups battery',
    ];

    // Project-type work — never auto-allocated to a maintenance engineer.
    const SKIP_CATEGORIES = [
        'signage', 'member labour request', 'member labor request', 'member paid works',
        'painting and wall repair', 'add on - subject to charge', 'flooring', 'carpentry',
        'glass', 'glass & windows', 'furniture', 'furniture/accessories', 'project',
    ];
    const SKIP_DESCRIPTION_KEYWORDS = [
        'member request', 'member labour', 'member labor', 'painting', 'decorating',
        'glazing', 'signage', 'acoustics', 'removals', 'mimo', 'floor grommet',
        'data logger', 'furniture assembly', 'whiteboard', 'blinds', 'artwork',
        'pest control', 'pantry cabinet',
    ];

    // Day shape
    const WORK_START_H = 8;
    const WORK_END_H = 17;
    const JOB_MINUTES = 30;
    const TRAVEL_MINUTES = 30;       // charged when an engineer changes site
    const MAX_SITES_PER_DAY = 3;
    const MAX_SPILL_DAYS = 5;        // how far forward an overloaded engineer may spill

    // Pacing — the Azure gateway in front of Joblogic throttles bulk runs
    const WRITE_DELAY_MS = 1400;
    const SEARCH_PAGE_SIZE = 50;

    // --- STATE ---
    let panel, logArea, progressText, tableWrap;
    let running = false;
    let jobs = [];           // raw rows from SearchJsonData
    let staffing = null;     // { sites:[{site,patch,roles:{role:[names]}}], bySite:{} }
    let engineers = [];      // [{Id, Name, ...}] from /Staff/GetEngineers
    let plan = null;         // parsed labour plan { absences:[], overrides:[], unparsed:[] }
    let rows = [];           // allocation rows shown in the preview
    let capturedBody = null; // the page's own SearchJsonData payload

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const norm = (s) => String(s == null ? '' : s).toLowerCase().trim();
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    function log(msg, colour) {
        if (!logArea) return;
        const d = document.createElement('div');
        d.style.cssText = 'padding:1px 0;color:' + (colour || '#bbb') + ';white-space:pre-wrap;';
        d.textContent = msg;
        logArea.appendChild(d);
        logArea.scrollTop = logArea.scrollHeight;
    }
    function setProgress(msg, colour) {
        if (progressText) { progressText.textContent = msg; progressText.style.color = colour || '#0fa'; }
    }

    // =======================================================================
    // 1. PULL THE "REQUIRES ALLOCATION" GRID
    // =======================================================================
    // Joblogic rejects a hand-built SearchJsonData payload ("the payload is
    // empty") — it wants the full ~60-field filter object the page itself
    // sends. So hook XHR/fetch at document-start, keep the last payload the
    // page sent, and replay it with SelectedTab/PageIndex swapped.
    function installCaptureHook() {
        const W = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
        if (W.__jlAllocHooked) return;
        W.__jlAllocHooked = true;
        const store = (b) => { try { if (typeof b === 'string' && b.indexOf('SelectedTab') >= 0) W.__jlAllocBody = b; } catch (e) {} };

        const openOrig = W.XMLHttpRequest.prototype.open;
        const sendOrig = W.XMLHttpRequest.prototype.send;
        W.XMLHttpRequest.prototype.open = function (m, u) { this.__jlUrl = u; return openOrig.apply(this, arguments); };
        W.XMLHttpRequest.prototype.send = function (b) {
            if (this.__jlUrl && /SearchJsonData/i.test(this.__jlUrl)) store(b);
            return sendOrig.apply(this, arguments);
        };
        const fetchOrig = W.fetch;
        if (fetchOrig) {
            W.fetch = function (u, o) {
                try {
                    const uu = (typeof u === 'string') ? u : (u && u.url);
                    if (uu && /SearchJsonData/i.test(uu) && o && o.body) store(o.body);
                } catch (e) {}
                return fetchOrig.apply(this, arguments);
            };
        }
    }
    const getCapturedBody = () => {
        const W = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
        return W.__jlAllocBody || null;
    };

    const rvToken = () => {
        const el = document.querySelector('input[name="__RequestVerificationToken"]');
        return el ? el.value : '';
    };

    // Nudge the page into running a search so the hook has something to copy.
    async function ensureCapturedBody() {
        if (getCapturedBody()) return true;
        const tab = [...document.querySelectorAll('a')].find(a => /^Requires Allocation\b/i.test((a.textContent || '').trim()));
        if (tab) {
            log('No search captured yet — clicking the Requires Allocation tab to trigger one…', '#fa0');
            tab.click();
            for (let i = 0; i < 40 && !getCapturedBody(); i++) await sleep(250);
        }
        return !!getCapturedBody();
    }

    async function fetchRequiresAllocationJobs() {
        const raw = getCapturedBody();
        if (!raw) throw new Error('Could not capture the Jobs search payload. Run a search on the Jobs page once, then try again.');
        let base;
        try { base = JSON.parse(raw); } catch (e) { throw new Error('Captured search payload was not JSON — cannot replay it.'); }

        const out = [];
        let pageIndex = 1, total = null;
        while (true) {
            const body = Object.assign({}, base, {
                SelectedTab: 'RequiresAllocation',
                PageIndex: pageIndex,
                PageSize: SEARCH_PAGE_SIZE,
            });
            const r = await fetch('/api/Job/SearchJsonData', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json', '__RequestVerificationToken': rvToken() },
                body: JSON.stringify(body),
            });
            const ct = r.headers.get('content-type') || '';
            if (!ct.includes('json')) throw new Error('Jobs search returned HTML (HTTP ' + r.status + ') — usually the Azure gateway throttling. Wait a moment and retry.');
            const j = await r.json();
            if (!j.success) throw new Error('Jobs search failed: ' + (j.errors || []).join('; '));
            const ad = j.AdditionalData || {};
            const page = ad.Jobs || [];
            if (total === null) total = ad.TotalCount;
            out.push(...page);
            setProgress('Pulled ' + out.length + (total ? ' of ' + total : '') + ' jobs…');
            if (page.length < SEARCH_PAGE_SIZE || (total !== null && out.length >= total)) break;
            pageIndex++;
            if (pageIndex > 60) break;   // safety
            await sleep(250);
        }
        return out;
    }

    // =======================================================================
    // 2. SITE STAFFING SHEET
    // =======================================================================
    function gmGet(url, headers) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET', url: url, headers: headers || {},
                onload: res => resolve(res),
                onerror: () => reject(new Error('Network error fetching ' + url)),
                ontimeout: () => reject(new Error('Timed out fetching ' + url)),
                timeout: 30000,
            });
        });
    }

    // RFC4180 parser — staffing cells contain embedded newlines ("10 York Road\nAlana")
    function parseCsv(text) {
        const rowsOut = [];
        let row = [], field = '', inQ = false;
        for (let i = 0; i < text.length; i++) {
            const c = text[i];
            if (inQ) {
                if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
                else field += c;
            } else if (c === '"') inQ = true;
            else if (c === ',') { row.push(field); field = ''; }
            else if (c === '\n') { row.push(field); rowsOut.push(row); row = []; field = ''; }
            else if (c !== '\r') field += c;
        }
        if (field.length || row.length) { row.push(field); rowsOut.push(row); }
        return rowsOut;
    }

    // Google exports a merged range as "value, then blanks". Re-inflate it by
    // filling rightwards, resetting at every column where a new PATCH starts.
    function parseStaffing(csvText) {
        const grid = parseCsv(csvText);
        const patchRow = grid.find(r => norm(r[0]) === 'patch');
        const siteRow = grid.find(r => norm(r[0]) === 'site');
        if (!siteRow) throw new Error('Staffing sheet has no "SITE" row — has the layout changed?');

        const width = Math.max(siteRow.length, patchRow ? patchRow.length : 0);
        const patchStart = [];
        for (let c = 0; c < width; c++) patchStart[c] = !!(patchRow && String(patchRow[c] || '').trim());

        const fill = (r) => {
            const o = [];
            for (let c = 0; c < width; c++) {
                const v = String((r && r[c]) || '').trim();
                o[c] = (v || patchStart[c] || c === 0) ? v : (o[c - 1] || '');
            }
            return o;
        };
        const patches = patchRow ? fill(patchRow) : [];
        const roleRows = {};
        for (const r of grid) {
            const role = String(r[0] || '').trim();
            if (!role || norm(role) === 'patch' || norm(role) === 'site') continue;
            roleRows[role] = fill(r);
        }

        const sites = [];
        for (let c = 1; c < width; c++) {
            const site = String(siteRow[c] || '').trim();
            if (!site) continue;
            const roles = {};
            for (const role of Object.keys(roleRows)) {
                const names = splitNames(roleRows[role][c]);
                if (names.length) roles[role] = names;
            }
            sites.push({ site, patch: (patches[c] || '').split('\n')[0].trim(), roles, col: c });
        }
        const bySite = {};
        for (const s of sites) bySite[siteKey(s.site)] = s;
        return { sites, bySite, roles: Object.keys(roleRows) };
    }

    // "Damon Rafferty (Niall McDaid as a Sub)" -> ['Damon Rafferty','Niall McDaid']
    // "Keiran Connolly / Raj"                 -> ['Keiran Connolly','Raj']
    function splitNames(cell) {
        // Split on the separators FIRST — a cell can stack two people on
        // separate lines ("Estefania G\nArina M"), so collapsing whitespace
        // up front would weld them into one name.
        const raw = String(cell == null ? '' : cell).trim();
        if (!raw || /^tbc$/i.test(raw)) return [];
        const out = [];
        const push = (v) => {
            const p = String(v).replace(/\s+/g, ' ').trim();
            if (p && !/^tbc$/i.test(p) && out.indexOf(p) < 0) out.push(p);
        };
        for (const chunk of raw.split(/[\n\r\/,;]+|\s+and\s+/i)) {
            const c = chunk.trim();
            if (!c) continue;
            const m = c.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
            if (m) {
                push(m[1]);
                // "(Niall McDaid as a Sub)" — the sub is a real fallback, keep them
                push(m[2].replace(/\bas a\b/i, '').replace(/\bsub(stitute)?\b/i, ''));
            } else push(c);
        }
        return out;
    }

    // Site names arrive from Joblogic with the LON code glued on ("26 Hatton
    // Garden LON45") and vary in wording between systems ("St Peter's Square"
    // vs "One St Peter's Square").
    // Joblogic glues a site code onto the name and the codes are not all LON:
    // "26 Hatton Garden LON45", "30 Churchill Place WE-GB-63302",
    // "St Peter's Square MAN02", "50-60 Station Road CBG01", "80 George Street EDI01".
    const SITE_CODE_RE = /\b(?:we[- ]?gb[- ]?\d+|[a-z]{2,4}\d{2,6})\b/g;
    function siteKey(name) {
        return norm(name)
            .replace(SITE_CODE_RE, ' ')
            .replace(/[^a-z0-9]+/g, ' ')
            .replace(/^(the|one|no|number)\s+/, '')
            .replace(/\s+/g, ' ')
            .trim();
    }
    function matchSite(jlSiteName) {
        if (!staffing) return null;
        const k = siteKey(jlSiteName);
        if (staffing.bySite[k]) return staffing.bySite[k];
        // containment fallback, longest match wins
        let best = null;
        for (const s of staffing.sites) {
            const sk = siteKey(s.site);
            if (!sk) continue;
            if (k.includes(sk) || sk.includes(k)) {
                if (!best || sk.length > siteKey(best.site).length) best = s;
            }
        }
        return best;
    }

    async function loadStaffing(forceRefresh) {
        const url = 'https://docs.google.com/spreadsheets/d/' + STAFFING_SHEET_ID + '/gviz/tq?tqx=out:csv&gid=' + STAFFING_GID + '&_=' + Date.now();
        let text = null, err = null;
        try {
            const res = await gmGet(url);
            const body = res.responseText || '';
            if (res.status === 200 && body.slice(0, 200).indexOf('<!DOCTYPE') === -1) text = body;
            else err = 'HTTP ' + res.status + (res.status === 401 || /accounts\.google/.test(body) ? ' — Google did not accept the browser session. Make sure you are signed in to the Google account that can open the sheet, in this browser.' : '');
        } catch (e) { err = e.message; }

        if (text) {
            try { localStorage.setItem(STAFFING_CACHE_KEY, JSON.stringify({ when: new Date().toLocaleString('en-GB'), csv: text })); } catch (e) {}
            log('Fetched the Site Staffing sheet live.', '#0fa');
            return parseStaffing(text);
        }
        const cached = readCachedStaffing();
        if (cached) {
            log('Live fetch failed (' + err + '). Falling back to the cached copy from ' + cached.when + '.', '#fa0');
            return parseStaffing(cached.csv);
        }
        throw new Error('Could not read the Site Staffing sheet and there is no cached copy. ' + err);
    }
    function readCachedStaffing() {
        try { const o = JSON.parse(localStorage.getItem(STAFFING_CACHE_KEY)); return (o && o.csv) ? o : null; } catch (e) { return null; }
    }

    // =======================================================================
    // 3. ENGINEER NAMES
    // =======================================================================
    async function loadEngineers() {
        const r = await fetch('/Staff/GetEngineers?text=&includeNonLogin=false', { credentials: 'include' });
        const j = await r.json();
        return (j || []).filter(e => e && e.Name);
    }

    const readNameMap = () => { try { return JSON.parse(localStorage.getItem(NAME_MAP_KEY)) || {}; } catch (e) { return {}; } };
    const writeNameMap = (m) => { try { localStorage.setItem(NAME_MAP_KEY, JSON.stringify(m)); } catch (e) {} };

    function levenshtein(a, b) {
        const m = a.length, n = b.length;
        if (!m) return n; if (!n) return m;
        let prev = Array.from({ length: n + 1 }, (_, i) => i);
        for (let i = 1; i <= m; i++) {
            const cur = [i];
            for (let j = 1; j <= n; j++) {
                cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            }
            prev = cur;
        }
        return prev[n];
    }

    // The staffing sheet abbreviates ("Robert D", "Fahim K") and misspells
    // ("Gerrard Egan" vs "Gerard Egan"), so match on first name + surname
    // initial first, then fall back to a tolerant whole-name distance.
    function resolveEngineer(rawName) {
        const name = String(rawName || '').replace(/\s+/g, ' ').trim();
        if (!name) return null;
        const overrides = readNameMap();
        if (overrides[name]) {
            const e = engineers.find(x => String(x.Id) === String(overrides[name]));
            if (e) return e;
        }
        const n = norm(name);
        const exact = engineers.find(e => norm(e.Name) === n);
        if (exact) return exact;

        const parts = n.split(' ').filter(Boolean);
        const first = parts[0] || '';
        const rest = parts.slice(1).join(' ');
        const firstOf = (e) => norm(e.Name).split(' ')[0];
        const surnameOf = (e) => norm(e.Name).split(' ').slice(1).join(' ');

        // "Rob Fish" -> Robert Fish: the sheet shortens first names too, so
        // accept an engineer whose first name starts with the one given.
        let pool = engineers.filter(e => firstOf(e) === first);
        if (!pool.length && first.length >= 3) pool = engineers.filter(e => firstOf(e).startsWith(first));
        if (!pool.length && first.length >= 3) pool = engineers.filter(e => first.startsWith(firstOf(e)));

        if (pool.length === 1 && !rest) return pool[0];
        if (pool.length) {
            if (!rest) return null;                                   // "Daniel" alone is ambiguous — don't guess
            const full = pool.filter(e => surnameOf(e) === rest);
            if (full.length === 1) return full[0];
            // "Robert D", "Fahim K" — surname given as an initial
            const byInitial = pool.filter(e => surnameOf(e).startsWith(rest[0]));
            if (rest.length <= 2 && byInitial.length === 1) return byInitial[0];
            // "Fahim Kandoker" vs "Fahim Khandoker" — tolerate a typo
            let best = null, bestD = 99;
            for (const e of pool) {
                const d = levenshtein(surnameOf(e), rest);
                if (d < bestD) { bestD = d; best = e; }
            }
            if (best && bestD <= Math.max(1, Math.floor(rest.length / 3))) return best;
            if (rest.length <= 2 && byInitial.length > 1) return null; // ambiguous initial — make the user choose
        }

        let best = null, bestD = 99;
        for (const e of engineers) {
            const d = levenshtein(norm(e.Name), n);
            if (d < bestD) { bestD = d; best = e; }
        }
        return (best && bestD <= 2) ? best : null;
    }

    function unresolvedNames() {
        const missing = new Map();
        if (!staffing) return [];
        for (const s of staffing.sites) {
            for (const role of TRADE_ROWS) {
                for (const nm of (s.roles[role] || [])) {
                    if (!resolveEngineer(nm)) {
                        if (!missing.has(nm)) missing.set(nm, []);
                        missing.get(nm).push(s.site + ' / ' + role);
                    }
                }
            }
        }
        return [...missing.entries()].map(([name, where]) => ({ name, where }));
    }

    // =======================================================================
    // 4. LABOUR PLAN  (free text -> structured amendments, via the Claude API)
    // =======================================================================
    const PLAN_SCHEMA_HINT = [
        '{',
        '  "absences":  [{"engineer":"<exact name>","from":"YYYY-MM-DD","to":"YYYY-MM-DD","reason":"<short>"}],',
        '  "overrides": [{"site":"<exact site>","trade":"Electrical|Plumbing|Fabric|Mechanical|HVAC|Multi-Skilled","engineer":"<exact name>","from":"YYYY-MM-DD","to":"YYYY-MM-DD","note":"<short>"}],',
        '  "unparsed":  ["<any line you could not turn into a rule>"]',
        '}',
    ].join('\n');

    function callClaude(apiKey, systemPrompt, userPrompt) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: 'https://api.anthropic.com/v1/messages',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                    'anthropic-dangerous-direct-browser-access': 'true',
                },
                data: JSON.stringify({
                    model: CLAUDE_MODEL,
                    max_tokens: 4000,
                    system: systemPrompt,
                    messages: [{ role: 'user', content: userPrompt }],
                }),
                onload: res => {
                    let j;
                    try { j = JSON.parse(res.responseText); } catch (e) { return reject(new Error('Claude API returned non-JSON (HTTP ' + res.status + ')')); }
                    if (res.status !== 200) return reject(new Error('Claude API ' + res.status + ': ' + ((j.error && j.error.message) || res.responseText.slice(0, 200))));
                    const text = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
                    resolve(text);
                },
                onerror: () => reject(new Error('Network error calling the Claude API')),
                timeout: 120000,
                ontimeout: () => reject(new Error('Claude API timed out')),
            });
        });
    }

    async function parseLabourPlan(planText, targetDate) {
        const apiKey = (localStorage.getItem(API_KEY_KEY) || '').trim();
        if (!apiKey) throw new Error('No Claude API key saved — click "API key" and paste one.');
        const siteList = staffing.sites.map(s => s.site);
        const engList = engineers.map(e => e.Name);
        const system = [
            'You convert a facilities-management labour plan written in free text into strict JSON.',
            'Return ONLY the JSON object, no prose, no markdown fences.',
            'Shape:', PLAN_SCHEMA_HINT,
            'Rules:',
            '- "engineer" must be copied EXACTLY from the supplied engineer list. If a person in the plan is not in the list, do not invent a match: put the original line in "unparsed".',
            '- "site" must be copied EXACTLY from the supplied site list, same rule.',
            '- "trade" must be one of the six listed values.',
            '- An absence (holiday, sick, leave, training, "off", "not in") becomes an entry in "absences".',
            '- Someone covering a site, moved to a site, or working a site for a period becomes an entry in "overrides" — that overrides the normal site staffing for that trade.',
            '- If the plan gives a weekday or relative date ("Tuesday", "all week", "until Friday"), resolve it against the reference date given by the user, using UK date conventions and Monday as the start of the week.',
            '- If no end date is implied, set "to" equal to "from".',
            '- Never drop information: anything you cannot express as an absence or override goes in "unparsed" verbatim.',
        ].join('\n');
        const user = [
            'Reference date (the date being allocated): ' + targetDate,
            '',
            'Engineer list (exact names):', engList.join(', '),
            '',
            'Site list (exact names):', siteList.join(', '),
            '',
            'Labour plan:', '"""', planText, '"""',
        ].join('\n');

        const raw = await callClaude(apiKey, system, user);
        const cleaned = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
        let parsed;
        try { parsed = JSON.parse(cleaned); }
        catch (e) { throw new Error('Claude did not return valid JSON. First 200 chars: ' + cleaned.slice(0, 200)); }
        parsed.absences = parsed.absences || [];
        parsed.overrides = parsed.overrides || [];
        parsed.unparsed = parsed.unparsed || [];
        return parsed;
    }

    const inWindow = (dateStr, from, to) => {
        if (!from && !to) return true;
        const d = dateStr;
        return (!from || d >= from) && (!to || d <= to);
    };
    function isAbsent(engineerName, isoDate) {
        if (!plan) return null;
        for (const a of plan.absences) {
            if (norm(a.engineer) === norm(engineerName) && inWindow(isoDate, a.from, a.to)) return a;
        }
        return null;
    }
    function planOverridesFor(siteName, role, isoDate) {
        if (!plan) return [];
        const k = siteKey(siteName);
        return plan.overrides
            .filter(o => siteKey(o.site) === k && norm(o.trade) === norm(role) && inWindow(isoDate, o.from, o.to))
            .map(o => o.engineer);
    }

    // =======================================================================
    // 5. ALLOCATION
    // =======================================================================
    const isoOf = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const ukOf = (d) => String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
    const ukDateTime = (d) => ukOf(d) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    function nextWorkingDay(d) {
        const n = new Date(d.getTime());
        do { n.setDate(n.getDate() + 1); } while (n.getDay() === 0 || n.getDay() === 6);
        return n;
    }
    function defaultTargetDate() {
        const now = new Date();
        let d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (now.getHours() >= 12) d = nextWorkingDay(d);
        while (d.getDay() === 0 || d.getDay() === 6) d = nextWorkingDay(d);
        return d;
    }

    const hit = (haystack, list) => list.some(k => haystack.indexOf(k) >= 0);

    function classifyJob(job) {
        const cat = norm(job.CategoryDescription);
        const desc = norm(job.Description);
        if (SKIP_CATEGORIES.includes(cat)) {
            return { skip: true, reason: 'Project-type work — category "' + (job.CategoryDescription || 'none') + '" is on the skip list' };
        }
        const kw = SKIP_DESCRIPTION_KEYWORDS.find(k => desc.indexOf(k) >= 0);
        if (kw) {
            return { skip: true, reason: 'Project-type work — the description mentions "' + kw + '"' };
        }
        const specialist = SPECIALIST_CATEGORIES.includes(cat)
            || SPECIALIST_CATEGORIES.some(k => cat.indexOf(k) >= 0 && k.length > 3)
            || hit(desc, SPECIALIST_DESCRIPTION_KEYWORDS);
        const roles = (CATEGORY_TO_ROWS[cat] || CATEGORY_DEFAULT).slice();
        return { skip: false, specialist, roles, category: job.CategoryDescription || '(none)' };
    }

    // Day-book: tracks what each engineer has been given during this run so
    // jobs get sensible times instead of all landing at 08:00.
    function makeDayBook() {
        return { byEng: {} };   // engId -> { 'YYYY-MM-DD': { minutes, sites:Set, lastSite } }
    }
    function bookSlot(book, engId, date, siteName) {
        let cur = new Date(date.getTime());
        for (let spill = 0; spill <= MAX_SPILL_DAYS; spill++) {
            const key = isoOf(cur);
            const perEng = book.byEng[engId] || (book.byEng[engId] = {});
            const day = perEng[key] || (perEng[key] = { cursor: WORK_START_H * 60, sites: new Set(), lastSite: null });
            const newSite = day.lastSite !== null && day.lastSite !== siteName;
            if (newSite && day.sites.size >= MAX_SITES_PER_DAY && !day.sites.has(siteName)) {
                cur = nextWorkingDay(cur); continue;
            }
            const start = day.cursor + (newSite ? TRAVEL_MINUTES : 0);
            if (start + JOB_MINUTES > WORK_END_H * 60) { cur = nextWorkingDay(cur); continue; }
            day.cursor = start + JOB_MINUTES;
            day.sites.add(siteName);
            day.lastSite = siteName;
            const s = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate(), Math.floor(start / 60), start % 60);
            const e = new Date(s.getTime() + JOB_MINUTES * 60000);
            return { start: s, end: e, spilled: spill > 0 };
        }
        return null;   // engineer is full for the whole spill window
    }

    function allocate(targetDate) {
        const iso = isoOf(targetDate);
        const book = makeDayBook();
        const out = [];

        // Steadier output: biggest sites first, so site consolidation kicks in early.
        const ordered = jobs.slice().sort((a, b) => String(a.SiteName || '').localeCompare(String(b.SiteName || '')) || String(a.JobNumber).localeCompare(String(b.JobNumber)));

        for (const job of ordered) {
            const row = {
                job, jobNumber: job.JobNumber, jobId: job.Id,
                site: (job.SiteName || '').replace(/\s+(?:WE-GB-\d+|[A-Z]{2,4}\d{2,6})\s*$/i, '').trim() || '(no site)',
                rawSite: job.SiteName || '',
                category: job.CategoryDescription || '',
                description: (job.Description || '').replace(/\s+/g, ' ').slice(0, 160),
                typeOfJob: /ppm/i.test(job.TypeDescription || '') ? 2 : 1,
                engineer: null, engineerId: null, start: null, end: null,
                include: false, reason: '', status: 'pending',
            };
            const cls = classifyJob(job);
            if (cls.skip) { row.reason = cls.reason; row.status = 'skip'; out.push(row); continue; }

            const siteRec = matchSite(job.SiteName);
            if (!siteRec) {
                row.reason = 'Site "' + row.site + '" is not on the Site Staffing sheet';
                row.status = 'unmatched'; out.push(row); continue;
            }
            row.patch = siteRec.patch || '';

            // Candidate list: labour-plan cover first, then the sheet's own rows.
            const tried = [];
            const candidates = [];
            for (const nm of (GLOBAL_SPECIALISTS[norm(job.CategoryDescription)] || [])) {
                candidates.push({ name: nm, role: row.category || 'specialist', via: 'company-wide specialist' });
            }
            for (const role of cls.roles) {
                if (role === 'Multi-Skilled' && cls.specialist) { tried.push(role + ' (blocked: specialist work)'); continue; }
                for (const nm of planOverridesFor(siteRec.site, role, iso)) candidates.push({ name: nm, role, via: 'labour plan' });
                for (const nm of (siteRec.roles[role] || [])) candidates.push({ name: nm, role, via: 'site staffing' });
                if (!(siteRec.roles[role] || []).length && !planOverridesFor(siteRec.site, role, iso).length) tried.push('no ' + role + ' listed for this site');
            }
            // Last resort: the same trade anywhere in the same patch.
            if (!candidates.length && siteRec.patch) {
                for (const role of cls.roles) {
                    if (role === 'Multi-Skilled' && cls.specialist) continue;
                    for (const peer of staffing.sites) {
                        if (peer.patch !== siteRec.patch || peer === siteRec) continue;
                        for (const nm of (peer.roles[role] || [])) candidates.push({ name: nm, role, via: 'patch cover from ' + peer.site });
                    }
                }
            }

            let picked = null, blockedBy = [];
            for (const c of candidates) {
                const eng = resolveEngineer(c.name);
                if (!eng) { blockedBy.push(c.name + ' (not a Joblogic engineer)'); continue; }
                const away = isAbsent(eng.Name, iso);
                if (away) { blockedBy.push(eng.Name + ' (' + (away.reason || 'away') + ')'); continue; }
                const slot = bookSlot(book, eng.Id, targetDate, siteRec.site);
                if (!slot) { blockedBy.push(eng.Name + ' (full)'); continue; }
                picked = { eng, slot, c };
                break;
            }

            if (!picked) {
                row.status = 'unallocated';
                const why = blockedBy.length
                    ? 'No one available: ' + blockedBy.join('; ')
                    : (tried.length ? 'Nobody to try: ' + tried.join('; ')
                                    : 'No trade on the staffing sheet covers "' + cls.category + '"');
                row.reason = why + (cls.specialist ? ' — specialist work, so the site\'s multi-skilled engineer is not eligible' : '');
                out.push(row); continue;
            }

            row.engineer = picked.eng.Name;
            row.engineerId = picked.eng.Id;
            row.start = picked.slot.start;
            row.end = picked.slot.end;
            row.include = true;
            row.status = 'ok';
            row.reason = picked.c.role + ' @ ' + siteRec.site + ' (' + picked.c.via + ')'
                + (picked.c.name !== picked.eng.Name ? ' [sheet says "' + picked.c.name + '"]' : '')
                + (picked.slot.spilled ? ' — spilled to a later day, ' + ukOf(picked.slot.start) : '')
                + (cls.specialist ? ' — specialist' : '');
            out.push(row);
        }
        return out;
    }

    // =======================================================================
    // 6. WRITE THE VISITS
    // =======================================================================
    async function createVisit(row, deploy) {
        const fd = new FormData();
        fd.append('jobId', row.jobId);
        fd.append('typeOfJob', row.typeOfJob);
        fd.append('jobNumber', row.jobNumber);
        fd.append('deploy', deploy ? 'true' : 'false');
        fd.append('engineerId', row.engineerId);
        fd.append('startDate', ukDateTime(row.start));
        fd.append('endDate', ukDateTime(row.end));
        fd.append('isDateAndTimeLocked', 'false');
        const r = await fetch('/Scheduler/AddVisit', {
            method: 'POST', credentials: 'include',
            headers: { '__RequestVerificationToken': rvToken() },
            body: fd,
        });
        const ct = r.headers.get('content-type') || '';
        if (!ct.includes('json')) {
            const e = new Error('HTTP ' + r.status + ' (non-JSON — gateway throttle?)');
            e.throttled = true; throw e;
        }
        const j = await r.json();
        if (!j.success) throw new Error((j.errors || ['unknown error']).join('; '));
        return j;
    }

    async function runWrites(deploy) {
        const todo = rows.filter(r => r.include && r.status === 'ok' && r.engineerId);
        if (!todo.length) { setProgress('Nothing ticked to allocate.', '#fa0'); return; }
        running = true;
        let done = 0, failed = 0;
        log('===== ALLOCATING ' + todo.length + ' JOBS =====', '#0af');
        for (const row of todo) {
            if (!running) { log('Stopped by user.', '#fa0'); break; }
            let attempt = 0;
            while (attempt < 3) {
                attempt++;
                try {
                    await createVisit(row, deploy);
                    row.status = 'done';
                    done++;
                    log('✔ ' + row.jobNumber + ' → ' + row.engineer + '  ' + ukDateTime(row.start), '#0f8');
                    break;
                } catch (e) {
                    if (e.throttled && attempt < 3) { log('  … throttled on ' + row.jobNumber + ', retrying', '#888'); await sleep(4000); continue; }
                    row.status = 'failed'; row.reason = e.message; failed++;
                    log('✘ ' + row.jobNumber + ' → ' + row.engineer + ': ' + e.message, '#f66');
                    break;
                }
            }
            setProgress('Allocated ' + done + ' / ' + todo.length + (failed ? '  (' + failed + ' failed)' : ''));
            renderTable();
            await sleep(WRITE_DELAY_MS);
        }
        running = false;
        log('===== SUMMARY =====', '#0af');
        log('Allocated: ' + done + '   Failed: ' + failed + '   Visits ' + (deploy ? 'created and deployed' : 'created, not deployed'), '#0af');
        setProgress('Finished — ' + done + ' allocated' + (failed ? ', ' + failed + ' failed' : '') + '.', failed ? '#fa0' : '#0fa');
    }

    // =======================================================================
    // 7. UI
    // =======================================================================
    let dateInput, planBox, deployCheck, loadBtn, planBtn, allocBtn, writeBtn, stopBtn, csvBtn, keyBtn, refreshBtn, unmatchedWrap;

    const BTN = 'color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:12px;';

    function mkBtn(label, colour, onClick) {
        const b = document.createElement('button');
        b.style.cssText = BTN + 'background:' + colour + ';';
        b.textContent = label;
        b.addEventListener('click', onClick);
        return b;
    }

    function createUI() {
        if (document.getElementById('jl-alloc-panel')) return;
        panel = document.createElement('div');
        panel.id = 'jl-alloc-panel';

        const box = document.createElement('div');
        box.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;background:#1a1a2e;color:#eee;border-radius:8px;padding:16px;width:900px;max-width:96vw;max-height:92vh;display:flex;flex-direction:column;font-family:monospace;font-size:12px;box-shadow:0 4px 20px rgba(0,0,0,0.5);';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;';
        const title = document.createElement('strong');
        title.style.fontSize = '14px';
        title.innerHTML = 'Allocate Requires-Allocation Jobs <span style="font-weight:400;color:#8a8ab5;font-size:11px;">v' + VERSION + '</span>';
        const closeBtn = document.createElement('button');
        closeBtn.style.cssText = 'background:none;border:none;color:#eee;font-size:18px;cursor:pointer;';
        closeBtn.textContent = '✕';
        closeBtn.addEventListener('click', () => { panel.style.display = 'none'; });
        header.appendChild(title); header.appendChild(closeBtn);

        const progressDiv = document.createElement('div');
        progressDiv.style.marginBottom = '10px';
        progressText = document.createElement('span');
        progressText.style.color = '#0fa';
        progressText.textContent = 'Step 1 — load the jobs and the staffing sheet.';
        progressDiv.appendChild(progressText);

        // --- row 1: date + load
        const r1 = document.createElement('div');
        r1.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;';
        const dLabel = document.createElement('label');
        dLabel.style.color = '#8a8ab5';
        dLabel.textContent = 'Allocate for ';
        dateInput = document.createElement('input');
        dateInput.type = 'date';
        dateInput.value = isoOf(defaultTargetDate());
        dateInput.style.cssText = 'background:#0a0a1a;color:#eee;border:1px solid #333;border-radius:4px;padding:6px;font-family:inherit;';
        dLabel.appendChild(dateInput);
        loadBtn = mkBtn('1. Load jobs + staffing', '#08a', onLoad);
        refreshBtn = mkBtn('↻ Staffing sheet', '#555', () => onLoad(true));
        keyBtn = mkBtn('API key', '#555', onSetKey);
        r1.appendChild(dLabel); r1.appendChild(loadBtn); r1.appendChild(refreshBtn); r1.appendChild(keyBtn);

        // --- row 2: labour plan
        const planLabel = document.createElement('div');
        planLabel.style.cssText = 'color:#8a8ab5;margin:6px 0 4px;';
        planLabel.textContent = 'Labour plan (optional) — write it however you normally would; it amends the site staffing for the date above:';
        planBox = document.createElement('textarea');
        planBox.rows = 3;
        planBox.placeholder = 'e.g. Damon off Tue and Wed, Niall covering 30 Churchill Place. Jake Rafferty at Aviation House all week. Charlie on leave until Friday.';
        planBox.style.cssText = 'width:100%;box-sizing:border-box;background:#0a0a1a;color:#eee;border:1px solid #333;border-radius:4px;padding:8px;font-family:inherit;font-size:12px;resize:vertical;';
        try { planBox.value = localStorage.getItem(PLAN_KEY) || ''; } catch (e) {}

        const r2 = document.createElement('div');
        r2.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:8px 0;';
        planBtn = mkBtn('2. Parse labour plan', '#6a4', onParsePlan);
        allocBtn = mkBtn('3. Work out allocation', '#0a8', onAllocate);
        writeBtn = mkBtn('4. Allocate in Joblogic', '#c60', onWrite);
        stopBtn = mkBtn('Stop', '#a22', () => { running = false; });
        stopBtn.style.display = 'none';
        csvBtn = mkBtn('Download CSV', '#555', onCsv);
        const depLabel = document.createElement('label');
        depLabel.style.cssText = 'cursor:pointer;color:#fa0;display:flex;align-items:center;gap:4px;';
        deployCheck = document.createElement('input');
        deployCheck.type = 'checkbox';
        deployCheck.checked = true;
        depLabel.appendChild(deployCheck);
        depLabel.appendChild(document.createTextNode('Deploy to engineer'));
        r2.appendChild(planBtn); r2.appendChild(allocBtn); r2.appendChild(writeBtn);
        r2.appendChild(stopBtn); r2.appendChild(csvBtn); r2.appendChild(depLabel);

        unmatchedWrap = document.createElement('div');
        unmatchedWrap.style.cssText = 'margin-bottom:8px;';

        tableWrap = document.createElement('div');
        tableWrap.style.cssText = 'flex:1;overflow:auto;background:#0a0a1a;border-radius:4px;max-height:42vh;margin-bottom:8px;';

        logArea = document.createElement('div');
        logArea.style.cssText = 'overflow-y:auto;background:#0a0a1a;padding:8px;border-radius:4px;max-height:20vh;';

        box.appendChild(header); box.appendChild(progressDiv); box.appendChild(r1);
        box.appendChild(planLabel); box.appendChild(planBox); box.appendChild(r2);
        box.appendChild(unmatchedWrap); box.appendChild(tableWrap); box.appendChild(logArea);
        panel.appendChild(box);
        document.body.appendChild(panel);

        jlRegisterPanel(panel, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR, SCRIPT_DESC);
    }

    function onSetKey() {
        const cur = localStorage.getItem(API_KEY_KEY) || '';
        const v = prompt('Anthropic API key (used only to parse the labour plan).\n\nIt is stored in this browser\'s localStorage for go.joblogic.com — anything that can run script on this page can read it. Use a key scoped to this job, and clear it here when you are done.\n\nLeave blank to clear.', cur);
        if (v === null) return;
        if (v.trim()) { localStorage.setItem(API_KEY_KEY, v.trim()); log('API key saved.', '#0fa'); }
        else { localStorage.removeItem(API_KEY_KEY); log('API key cleared.', '#fa0'); }
    }

    async function onLoad(forceStaffing) {
        try {
            loadBtn.disabled = true;
            setProgress('Loading…');
            logArea.innerHTML = '';
            await ensureCapturedBody();
            const [j, s, e] = await Promise.all([
                fetchRequiresAllocationJobs(),
                loadStaffing(forceStaffing === true),
                loadEngineers(),
            ]);
            jobs = j; staffing = s; engineers = e;
            log('Jobs requiring allocation: ' + jobs.length, '#0fa');
            log('Staffing sheet: ' + staffing.sites.length + ' sites, rows: ' + staffing.roles.join(', '), '#0fa');
            log('Joblogic engineers: ' + engineers.length, '#0fa');
            renderUnmatched();
            setProgress(jobs.length + ' jobs loaded. Parse a labour plan if you have one, then work out the allocation.');
        } catch (err) {
            log('Load failed: ' + err.message, '#f66');
            setProgress('Load failed — see the log.', '#f66');
        } finally { loadBtn.disabled = false; }
    }

    function renderUnmatched() {
        unmatchedWrap.innerHTML = '';
        const missing = unresolvedNames();
        if (!missing.length) return;
        const d = document.createElement('div');
        d.style.cssText = 'background:#3a2a0d;border-left:3px solid #fa0;color:#ffe9c2;padding:8px 10px;border-radius:4px;font-size:11px;line-height:1.5;';
        d.appendChild(document.createTextNode('Names on the staffing sheet with no Joblogic engineer — map them or their sites fall through to the next trade:'));
        for (const m of missing) {
            const line = document.createElement('div');
            line.style.cssText = 'margin-top:4px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;';
            const lbl = document.createElement('span');
            lbl.innerHTML = '<b>' + esc(m.name) + '</b> <span style="color:#c9ab7a">(' + esc(m.where.slice(0, 3).join(', ')) + (m.where.length > 3 ? ' +' + (m.where.length - 3) + ' more' : '') + ')</span> →';
            const sel = document.createElement('select');
            sel.style.cssText = 'background:#0a0a1a;color:#eee;border:1px solid #444;border-radius:3px;padding:3px;font-family:inherit;font-size:11px;';
            sel.appendChild(new Option('— leave unmapped —', ''));
            for (const e of engineers) sel.appendChild(new Option(e.Name, e.Id));
            sel.addEventListener('change', () => {
                const map = readNameMap();
                if (sel.value) map[m.name] = sel.value; else delete map[m.name];
                writeNameMap(map);
                renderUnmatched();
            });
            line.appendChild(lbl); line.appendChild(sel);
            d.appendChild(line);
        }
        unmatchedWrap.appendChild(d);
    }

    async function onParsePlan() {
        const text = planBox.value.trim();
        if (!text) { plan = null; setProgress('No labour plan — using the staffing sheet as-is.'); return; }
        if (!staffing || !engineers.length) { setProgress('Load the jobs and staffing sheet first.', '#fa0'); return; }
        try {
            planBtn.disabled = true;
            setProgress('Asking Claude to read the labour plan…');
            try { localStorage.setItem(PLAN_KEY, text); } catch (e) {}
            plan = await parseLabourPlan(text, dateInput.value);
            log('--- labour plan ---', '#0af');
            if (!plan.absences.length && !plan.overrides.length) log('Nothing in the plan changed the staffing for ' + dateInput.value + '.', '#fa0');
            for (const a of plan.absences) log('AWAY   ' + a.engineer + '  ' + a.from + ' → ' + a.to + (a.reason ? '  (' + a.reason + ')' : ''), '#fa0');
            for (const o of plan.overrides) log('COVER  ' + o.engineer + '  ' + o.site + ' / ' + o.trade + '  ' + o.from + ' → ' + o.to + (o.note ? '  (' + o.note + ')' : ''), '#6cf');
            for (const u of plan.unparsed) log('UNREAD ' + u, '#f66');
            setProgress('Labour plan read: ' + plan.absences.length + ' absence(s), ' + plan.overrides.length + ' cover rule(s)'
                + (plan.unparsed.length ? ', ' + plan.unparsed.length + ' line(s) NOT understood — check the log' : '') + '.',
                plan.unparsed.length ? '#fa0' : '#0fa');
        } catch (err) {
            plan = null;
            log('Labour plan failed: ' + err.message, '#f66');
            setProgress('Labour plan not applied — see the log.', '#f66');
        } finally { planBtn.disabled = false; }
    }

    function onAllocate() {
        if (!jobs.length || !staffing) { setProgress('Load the jobs and staffing sheet first.', '#fa0'); return; }
        const [y, m, d] = dateInput.value.split('-').map(Number);
        rows = allocate(new Date(y, m - 1, d));
        renderTable();
        const ok = rows.filter(r => r.status === 'ok').length;
        const un = rows.filter(r => r.status === 'unallocated').length;
        const sk = rows.filter(r => r.status === 'skip').length;
        const nm = rows.filter(r => r.status === 'unmatched').length;
        setProgress(ok + ' allocated · ' + un + ' no one available · ' + sk + ' project-type (skipped) · ' + nm + ' site not on sheet. Review, then allocate.',
            un + nm ? '#fa0' : '#0fa');
    }

    const STATUS_COLOUR = { ok: '#0f8', skip: '#888', unallocated: '#fa0', unmatched: '#f66', done: '#0af', failed: '#f66' };

    function renderTable() {
        tableWrap.innerHTML = '';
        if (!rows.length) return;
        const t = document.createElement('table');
        t.style.cssText = 'width:100%;border-collapse:collapse;font-size:11px;';
        t.innerHTML = '<thead><tr style="position:sticky;top:0;background:#16162a;">' +
            ['', 'Job', 'Site', 'Category', 'Engineer', 'Time', 'Why'].map(h => '<th style="text-align:left;padding:5px 6px;border-bottom:1px solid #333;color:#8a8ab5;font-weight:600;">' + h + '</th>').join('') +
            '</tr></thead>';
        const tb = document.createElement('tbody');
        for (const row of rows) {
            const tr = document.createElement('tr');
            tr.style.cssText = 'border-bottom:1px solid #1e1e36;';

            const tdChk = document.createElement('td');
            tdChk.style.padding = '4px 6px';
            const chk = document.createElement('input');
            chk.type = 'checkbox';
            chk.checked = !!row.include;
            chk.disabled = row.status === 'done' || !row.engineerId;
            chk.addEventListener('change', () => { row.include = chk.checked; });
            tdChk.appendChild(chk);

            const cell = (html, colour) => {
                const td = document.createElement('td');
                td.style.cssText = 'padding:4px 6px;vertical-align:top;' + (colour ? 'color:' + colour + ';' : '');
                td.innerHTML = html;
                return td;
            };

            const tdEng = document.createElement('td');
            tdEng.style.cssText = 'padding:4px 6px;vertical-align:top;';
            const sel = document.createElement('select');
            sel.style.cssText = 'background:#0a0a1a;color:' + (STATUS_COLOUR[row.status] || '#eee') + ';border:1px solid #333;border-radius:3px;padding:2px;font-family:inherit;font-size:11px;max-width:150px;';
            sel.appendChild(new Option(row.engineer ? row.engineer : '— none —', ''));
            for (const e of engineers) if (e.Name !== row.engineer) sel.appendChild(new Option(e.Name, e.Id));
            sel.disabled = row.status === 'done';
            sel.addEventListener('change', () => {
                if (!sel.value) return;
                const e = engineers.find(x => String(x.Id) === sel.value);
                if (!e) return;
                row.engineer = e.Name; row.engineerId = e.Id; row.status = 'ok'; row.include = true;
                if (!row.start) {
                    const [y, m, d] = dateInput.value.split('-').map(Number);
                    const s = new Date(y, m - 1, d, WORK_START_H, 0);
                    row.start = s; row.end = new Date(s.getTime() + JOB_MINUTES * 60000);
                }
                row.reason = 'Chosen by hand';
                renderTable();
            });
            tdEng.appendChild(sel);

            tr.appendChild(tdChk);
            tr.appendChild(cell('<a href="/Job/Detail/' + row.jobId + '" target="_blank" style="color:#6cf;text-decoration:none;">' + esc(row.jobNumber) + '</a>'));
            tr.appendChild(cell(esc(row.site)));
            tr.appendChild(cell(esc(row.category)));
            tr.appendChild(tdEng);
            tr.appendChild(cell(row.start ? esc(ukDateTime(row.start).slice(-5) + ' · ' + ukOf(row.start).slice(0, 5)) : '—'));
            tr.appendChild(cell(esc(row.reason), STATUS_COLOUR[row.status] || '#999'));
            tb.appendChild(tr);
        }
        t.appendChild(tb);
        tableWrap.appendChild(t);
    }

    function onCsv() {
        if (!rows.length) { setProgress('Work out the allocation first.', '#fa0'); return; }
        const head = ['Job Number', 'Job Id', 'Site', 'Patch', 'Category', 'Type', 'Engineer', 'Engineer Id', 'Start', 'End', 'Status', 'Reason', 'Description'];
        const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
        const lines = [head.map(q).join(',')];
        for (const r of rows) {
            lines.push([r.jobNumber, r.jobId, r.site, r.patch || '', r.category, r.typeOfJob === 2 ? 'PPM' : 'Reactive',
                r.engineer || '', r.engineerId || '', r.start ? ukDateTime(r.start) : '', r.end ? ukDateTime(r.end) : '',
                r.status, r.reason, r.description].map(q).join(','));
        }
        const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'requires-allocation-' + dateInput.value + '.csv';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }

    async function onWrite() {
        const todo = rows.filter(r => r.include && r.status === 'ok' && r.engineerId);
        if (!todo.length) { setProgress('Nothing ticked to allocate.', '#fa0'); return; }
        const deploy = deployCheck.checked;
        if (!confirm('Create ' + todo.length + ' visit(s) in Joblogic' + (deploy ? ' and deploy them to the engineers' : ' without deploying') + '?\n\nThis writes to the live system.')) return;
        writeBtn.disabled = true; allocBtn.disabled = true; stopBtn.style.display = '';
        try { await runWrites(deploy); }
        finally { writeBtn.disabled = false; allocBtn.disabled = false; stopBtn.style.display = 'none'; }
    }

    // =======================================================================
    // BOOT
    // =======================================================================
    installCaptureHook();
    function boot() {
        if (!/^\/Job\b/i.test(location.pathname)) return;
        createUI();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
