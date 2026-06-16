// ==UserScript==
// @name         Joblogic PPM — Create Visits From Table
// @namespace    https://go.joblogic.com/
// @version      0.7
// @description  Paste a PPM activity table (from Excel) and auto-create one visit per required visit on the open PPM contract, evenly distributed over the 12-month contract. Weekly (52/yr) visits start on Mondays with a 5-day duration; everything else lands on the first working day of its month with a 1-month duration. Activities are grouped by category (Water/Fire/Electrical/HVAC/…): same category shares months, different categories get different months, and annuals land mid-contract. An optional Engineer column assigns each visit — names are matched against the Engineer list first, then Subcontractors, and unmatched names are flagged. "Out of Scope" rows are skipped. Nothing is saved automatically — review and press Joblogic's Save.
// @match        https://go.joblogic.com/PPMContract/Detail/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20PPMs/ppm-create-visits-from-table.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20PPMs/ppm-create-visits-from-table.user.js
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

    const SCRIPT_ID = 'ppm-create-visits-from-table';
    const SCRIPT_LABEL = '📋 PPM Visits From Table';
    const SCRIPT_COLOR = '#ff7919';
    const SCRIPT_DESC = 'Paste the PPM activity table (copied from Excel, tab-separated). One visit is created per required visit, spread evenly across the 12-month contract. 52/yr = weekly, Mondays, 5-day duration (7200 min). Everything else = first working day of its month, 1-month duration (40320 min). Add an optional "Engineer" column to assign each activity — the name is looked up in the Engineer list first, then Subcontractors; unmatched names are flagged in the preview. Rows containing "Out of Scope" are ignored. NOTHING IS SAVED automatically — review the new rows then press Joblogic\'s own Save button (or Undo Changes to discard).';

    const MONTHLY_DURATION = 40320; // minutes ≈ 1 month
    const WEEKLY_DURATION = 7200;   // minutes = 5 days
    const WEEKLY_THRESHOLD = 48;    // visits/yr at or above this are treated as weekly

    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const pad2 = n => String(n).padStart(2, '0');
    const fmtDate = d => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;

    function setNativeValue(el, val) {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function pagePpmNumber() {
        const m = (document.title || '').match(/^\s*([A-Z]{1,4}\d{3,})/i);
        return m ? m[1].toUpperCase() : '';
    }

    function pageStartDate() {
        const inp = document.getElementById('StartDate');
        return inp ? inp.value.trim() : '';
    }

    function parseUkDate(s) {
        const m = (s || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (!m) return null;
        const d = new Date(+m[3], +m[2] - 1, +m[1]);
        return isNaN(d) ? null : d;
    }

    // First working day (Mon–Fri) of the month containing `d`. Bank holidays not handled.
    function firstWorkingDay(year, month) {
        const d = new Date(year, month, 1);
        if (d.getDay() === 6) d.setDate(3);
        else if (d.getDay() === 0) d.setDate(2);
        return d;
    }

    function firstMondayOnOrAfter(d) {
        const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        while (x.getDay() !== 1) x.setDate(x.getDate() + 1);
        return x;
    }

    // ------------------------------------------------------------------
    // Table parsing. Expects tab-separated rows pasted from Excel:
    //   Description | No Units | Cost Per Unit | No Visits | Cost per Visit | Total Cost
    // Any row containing "out of scope" (anywhere) is skipped.
    // Rows without a numeric visit count (headers, section titles) are skipped.
    // ------------------------------------------------------------------
    function parseTable(text) {
        const lines = text.split(/\r?\n/);
        const items = [], skipped = [];
        let visitsCol = 3, engCol = -1;
        for (const line of lines) {
            if (!line.trim()) continue;
            const cells = line.split('\t').map(c => c.trim());
            const desc = cells[0];
            if (/^description$/i.test(desc)) {
                const vi = cells.findIndex(c => /no\.?\s*visits/i.test(c));
                if (vi > 0) visitsCol = vi;
                const ei = cells.findIndex(c => /engineer|assign/i.test(c));
                if (ei > 0) engCol = ei;
                continue;
            }
            if (/out of scope/i.test(line)) { skipped.push({ desc: desc || line.trim(), why: 'Out of Scope' }); continue; }
            const visits = parseInt((cells[visitsCol] || '').replace(/[^\d]/g, ''), 10);
            if (!desc || !visits || visits < 1) { skipped.push({ desc: desc || line.trim(), why: 'no visit count (header/section row)' }); continue; }
            const engineer = engCol >= 0 ? (cells[engCol] || '').trim() : '';
            items.push({ desc, visits, engineer });
        }
        return { items, skipped, hasEngineerCol: engCol >= 0 };
    }

    // ------------------------------------------------------------------
    // Category grouping. Same category → same months; different categories
    // → different months. First matching rule wins (order matters: e.g.
    // "Emergency Lighting Drain Test" must hit Electrical before Drainage).
    // Fallback = first word of the description.
    // ------------------------------------------------------------------
    const CATEGORY_RULES = [
        ['Water', /water|tmv|sentinel|outlet flush|shower|legionella|calorifier|hygiene|\btank\b/i],
        ['Fire', /fire|extinguisher|sprinkler|smoke|\baov\b|damper|refuge|evcs|alarm/i],
        ['Electrical', /electric|eicr|\bpat\b|emergency light|lightning|\blv\b|\bhv\b|\bbms\b|lighting|solar|catering equip/i],
        ['HVAC', /vrf|ahu|hvac|boiler|chiller|heat|ventilat|air con|\bfcu\b|cooling|refrigerat/i],
        ['Lifts', /\blifts?\b|loler|hoist/i],
        ['Height Safety', /mansafe|fall protection|\banchor\b|eyebolt/i],
        ['Drainage/Plumbing', /drain|gutter|booster|\bpumps?\b|leak/i],
        ['Doors/Access', /\bdoors?\b|\bgates?\b|barrier|access control|roller shutter/i],
    ];
    function categorize(desc) {
        for (const [name, re] of CATEGORY_RULES) if (re.test(desc)) return name;
        const w = desc.trim().split(/\s+/)[0];
        return w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : 'Other';
    }

    // ------------------------------------------------------------------
    // Scheduling across a 12-month contract starting at `start`.
    //  - visits >= WEEKLY_THRESHOLD: weekly from the first Monday on/after
    //    start, 5-day duration.
    //  - annuals (1 visit): mid-contract — month 5–9 of the contract,
    //    staggered by category so different categories get different months.
    //  - everything else: month offsets floor(i*12/N) shifted by a category
    //    stagger WITHIN the series' gap (gap = 12/N months), so a series
    //    never wraps past the contract end — visits stay in order and
    //    different categories start in different months.
    // The anchor month is the start month itself if its first working day
    // falls on/after the start date, else the following month.
    // ------------------------------------------------------------------
    function scheduleVisits(items, start) {
        let anchorY = start.getFullYear(), anchorM = start.getMonth();
        if (firstWorkingDay(anchorY, anchorM) < start) { anchorM++; if (anchorM > 11) { anchorM = 0; anchorY++; } }
        const cats = [];
        for (const it of items) {
            it.cat = categorize(it.desc);
            if (!cats.includes(it.cat)) cats.push(it.cat);
        }
        const out = [];
        for (const it of items) {
            const N = it.visits;
            const k = cats.indexOf(it.cat);
            const engineer = it.engineer || '';
            for (let i = 0; i < N; i++) {
                const label = N > 1 ? `${it.desc} - Visit ${i + 1} of ${N}` : it.desc;
                if (N >= WEEKLY_THRESHOLD) {
                    const d = firstMondayOnOrAfter(start);
                    d.setDate(d.getDate() + i * 7);
                    out.push({ desc: label, cat: it.cat, date: d, duration: WEEKLY_DURATION, kind: 'weekly', engineer });
                } else {
                    let off;
                    if (N === 1) {
                        off = 4 + (k % 5); // annual: months 5–9 of the contract
                    } else {
                        const gap = Math.floor(12 / N);          // months between visits in this series
                        const shift = gap > 0 ? k % gap : 0;     // category stagger inside the first gap
                        off = shift + Math.floor(i * 12 / N);    // never exceeds month 11 — no wrap
                    }
                    const d = firstWorkingDay(anchorY, anchorM + off);
                    out.push({ desc: label, cat: it.cat, date: d, duration: MONTHLY_DURATION, kind: 'monthly', engineer });
                }
            }
        }
        out.sort((a, b) => a.date - b.date);
        return out;
    }

    // ------------------------------------------------------------------
    // Assignee resolution. The new-visit row exposes three Kendo comboboxes
    // (Engineer / Engineer Team / Subcontractor); both the Engineer and
    // Subcontractor remote endpoints return their FULL list regardless of
    // filter, so we fetch each once and match names client-side. A name is
    // looked up in Engineers first, then Subcontractors; no match → flagged.
    // ------------------------------------------------------------------
    const ENG_URL = '/Staff/GetEngineers';
    const SUB_URL = '/Subcontractor/Get' + 'SubcontractorsBy';
    const normName = s => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
    let directories = null;        // { engineers:[{id,name}], subs:[{id,name}] }
    const resolveCache = new Map(); // normName -> { type:'engineer'|'subcontractor'|'none', id, name }

    async function fetchList(url) {
        const r = await fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' }, credentials: 'same-origin' });
        const j = await r.json();
        const arr = Array.isArray(j) ? j : (j.Data || j.data || j.results || []);
        return arr.map(o => ({ id: o.Id, name: o.Name })).filter(o => o.name);
    }
    async function loadDirectories(force) {
        if (directories && !force) return directories;
        const [engineers, subs] = await Promise.all([fetchList(ENG_URL), fetchList(SUB_URL)]);
        directories = { engineers, subs };
        return directories;
    }
    // Match a typed name against a list: exact (normalised) first, then a
    // unique substring match either direction. Ambiguous/none → null.
    function matchInList(name, list) {
        const n = normName(name);
        if (!n) return null;
        const exact = list.filter(o => normName(o.name) === n);
        if (exact.length === 1) return exact[0];
        if (exact.length > 1) return null; // ambiguous duplicate names
        const part = list.filter(o => { const on = normName(o.name); return on.includes(n) || n.includes(on); });
        return part.length === 1 ? part[0] : null;
    }
    function resolveAssignee(name) {
        const n = normName(name);
        if (!n) return { type: 'none', reason: 'blank' };
        if (resolveCache.has(n)) return resolveCache.get(n);
        let res;
        const e = matchInList(name, directories.engineers);
        if (e) res = { type: 'engineer', id: e.id, name: e.name };
        else {
            const s = matchInList(name, directories.subs);
            if (s) res = { type: 'subcontractor', id: s.id, name: s.name };
            else res = { type: 'none', reason: 'not found' };
        }
        resolveCache.set(n, res);
        return res;
    }

    // The whole visits tab is one Vue instance whose $data.Model.Visits array
    // is exactly what Save serialises. Setting the assignee fields directly on
    // the new visit object is far more reliable than driving the Kendo
    // comboboxes (which lose their display text when a row re-renders) — the
    // radio + picker update reactively from the model.
    let _vm = null;
    function visitsVM() {
        if (_vm && _vm.$data && _vm.$data.Model && Array.isArray(_vm.$data.Model.Visits)) return _vm;
        const seeds = [document.getElementById('ppmVisits'), document.getElementById('visitsTab'), ...document.querySelectorAll('#visitsTab *')];
        for (const el of seeds) {
            let n = el;
            for (let i = 0; i < 8 && n; i++) {
                if (n.__vue__ && n.__vue__.$data && n.__vue__.$data.Model && Array.isArray(n.__vue__.$data.Model.Visits)) { _vm = n.__vue__; return _vm; }
                n = n.parentElement;
            }
        }
        return null;
    }
    // Write a resolved assignee onto a visit model object (mirrors a manual
    // selection: AssignType + matching Id + Name, other types cleared).
    function applyAssigneeToModel(visit, resolved) {
        if (!resolved || resolved.type === 'none') return;
        if (resolved.type === 'engineer') {
            visit.AssignType = 0;
            visit.EngineerId = String(resolved.id);
            visit.EngineerName = resolved.name;
            visit.EngineerTeamId = null; visit.EngineerTeamName = null;
            visit.SubcontractorId = null; visit.SubcontractorName = null;
        } else {
            visit.AssignType = 3;
            visit.SubcontractorId = String(resolved.id);
            visit.SubcontractorName = resolved.name;
            visit.EngineerId = null; visit.EngineerName = null;
            visit.EngineerTeamId = null; visit.EngineerTeamName = null;
        }
    }
    // Cosmetic: show the assignee name in the row's (re-rendered) combobox so
    // it's visible on review. Never throws — the model is the source of truth.
    async function showAssigneeText(row, resolved) {
        if (!resolved || resolved.type === 'none') return;
        await sleep(150); // let Vue render the picker for the active type
        try {
            const sel = resolved.type === 'engineer' ? '#Visit_EngineerId' : '#Visit_SubcontractorId';
            const el = row.querySelector(sel);
            const combo = el && window.jQuery ? jQuery(el).data('kendoComboBox') : null;
            if (combo) combo.text(resolved.name);
        } catch (e) { /* display-only */ }
    }

    // ------------------------------------------------------------------
    // Visit creation: click Add Visit, find the freshly-prepended row,
    // fill description / due date / duration via native setters.
    // ------------------------------------------------------------------
    const visitRows = () => [...document.querySelectorAll('#ppmVisits ul.list-group > li.list-group-item')];

    function addVisitButton() {
        const tab = document.getElementById('visitsTab');
        return tab ? [...tab.querySelectorAll('button')].find(b => b.textContent.trim() === 'Add Visit' && b.offsetParent) : null;
    }

    async function createOneVisit(v, startTime) {
        const before = new Set(visitRows());
        const vm = visitsVM();
        const modelBefore = vm ? new Set(vm.$data.Model.Visits) : null;
        const btn = addVisitButton();
        if (!btn) throw new Error('Add Visit button not found — are you on the Visits tab?');
        btn.click();
        let row = null;
        for (let t = 0; t < 40 && !row; t++) {
            await sleep(150);
            row = visitRows().find(r => !before.has(r));
        }
        if (!row) throw new Error('new visit row never appeared');
        let desc = null;
        for (let t = 0; t < 40 && !desc; t++) {
            desc = row.querySelector('#visitDescription');
            if (!desc) await sleep(150);
        }
        const date = row.querySelector('input.changeDueDate');
        const dur = row.querySelector('input[name="Duration"]');
        if (!desc || !date || !dur) throw new Error('fields missing in new visit row');
        setNativeValue(desc, v.desc);
        setNativeValue(date, `${fmtDate(v.date)} ${startTime}`);
        setNativeValue(dur, String(v.duration));
        await sleep(120);
        // sanity: the Vue model echoes the date into the row header once bound
        if (date.value.indexOf(fmtDate(v.date)) !== 0) throw new Error('date did not stick');
        // assignee (engineer / subcontractor): write straight onto the new
        // visit's model object, then show the name in the row for review.
        if (v.assignee && v.assignee.type !== 'none') {
            if (!vm || !modelBefore) throw new Error('visits model not found — cannot set assignee');
            const nv = vm.$data.Model.Visits.find(x => !modelBefore.has(x));
            if (!nv) throw new Error('new visit object not found in model');
            applyAssigneeToModel(nv, v.assignee);
            await showAssigneeText(row, v.assignee);
        }
    }

    // ------------------------------------------------------------------ UI
    function buildPanel() {
        const p = document.createElement('div');
        p.id = SCRIPT_ID + '-panel';
        p.style.cssText = 'position:fixed;top:70px;right:8px;z-index:99999;width:430px;max-height:84vh;overflow:auto;background:#fff;border:1px solid #c9d4da;border-radius:6px;box-shadow:0 4px 18px rgba(0,0,0,.25);font-family:"Open Sans",sans-serif;font-size:12px;color:#243b46;padding:12px;';
        p.innerHTML = `
            <div style="font-weight:700;font-size:14px;margin-bottom:8px;">📋 Create Visits From Table <span style="font-weight:400;color:#888;">v0.7</span></div>
            <div style="display:flex;gap:8px;margin-bottom:8px;">
                <label style="flex:1;">PPM number<br><input id="cvft-ppm" class="form-control" style="width:100%;font-size:12px;" placeholder="PM0001234"></label>
                <label style="flex:1;">Contract start (DD/MM/YYYY)<br><input id="cvft-start" class="form-control" style="width:100%;font-size:12px;" placeholder="01/05/2026"></label>
                <label style="width:70px;">Time<br><input id="cvft-time" class="form-control" style="width:100%;font-size:12px;" value="08:00"></label>
            </div>
            <label style="display:block;margin-bottom:8px;">Paste table (tab-separated, straight from Excel). Optional <b>Engineer</b> column (header "Engineer") assigns each visit.<br>
                <textarea id="cvft-table" style="width:100%;height:130px;font-family:monospace;font-size:11px;white-space:pre;" spellcheck="false"></textarea>
            </label>
            <div style="display:flex;gap:8px;margin-bottom:8px;">
                <button id="cvft-preview" class="jl-button-green" style="padding:5px 14px;">Preview</button>
                <button id="cvft-create" class="jl-button-green" style="padding:5px 14px;display:none;">Create visits</button>
                <button id="cvft-cancel" style="padding:5px 14px;display:none;background:#b71c1c;color:#fff;border:none;border-radius:4px;cursor:pointer;">Stop</button>
            </div>
            <div id="cvft-status" style="margin-bottom:6px;font-weight:600;"></div>
            <div id="cvft-out" style="font-size:11px;line-height:1.5;"></div>`;
        document.body.appendChild(p);
        return p;
    }

    function init() {
        const panel = buildPanel();
        jlRegisterPanel(panel, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR, SCRIPT_DESC);

        const $ = id => panel.querySelector('#cvft-' + id);
        const status = msg => { $('status').textContent = msg; };
        let plan = null, cancelled = false;

        // prefill from the open contract
        setTimeout(() => {
            if (!$('ppm').value) $('ppm').value = pagePpmNumber();
            if (!$('start').value) $('start').value = pageStartDate();
        }, 1500);

        const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

        $('preview').addEventListener('click', async () => {
            const start = parseUkDate($('start').value);
            if (!start) { status('⚠ Enter a valid contract start date (DD/MM/YYYY).'); return; }
            const { items, skipped, hasEngineerCol } = parseTable($('table').value);
            if (!items.length) { status('⚠ No usable rows found — paste the table tab-separated (copy straight from Excel).'); return; }
            plan = scheduleVisits(items, start);

            // Resolve engineer names (Engineer list first, then Subcontractors).
            let resolveErr = null;
            if (hasEngineerCol) {
                status('Looking up engineers / subcontractors…');
                try { await loadDirectories(); plan.forEach(v => { v.assignee = resolveAssignee(v.engineer); }); }
                catch (e) { resolveErr = e.message; plan.forEach(v => { v.assignee = { type: 'none', reason: 'lookup failed' }; }); }
            } else {
                plan.forEach(v => { v.assignee = { type: 'none', reason: 'no column' }; });
            }

            const byKind = plan.filter(v => v.kind === 'weekly').length;
            const cats = [...new Set(plan.map(v => v.cat))];
            const unresolved = hasEngineerCol ? [...new Set(plan.filter(v => normName(v.engineer) && v.assignee.type === 'none').map(v => v.engineer))] : [];
            const assignedCount = plan.filter(v => v.assignee.type !== 'none').length;

            let html = `<div style="margin-bottom:6px;"><b>${items.length}</b> activities → <b>${plan.length}</b> visits (${byKind} weekly, ${plan.length - byKind} monthly-style) across <b>${cats.length}</b> categories: ${esc(cats.join(', '))}.</div>`;
            if (hasEngineerCol) html += `<div style="margin-bottom:6px;">${assignedCount} visit(s) will be assigned.</div>`;
            if (resolveErr) html += `<div style="color:#b71c1c;margin-bottom:6px;">⚠ Couldn't load engineer/subcontractor lists (${esc(resolveErr)}) — visits will be created unassigned.</div>`;
            if (unresolved.length) html += `<div style="color:#b71c1c;margin-bottom:6px;">⚠ ${unresolved.length} name(s) not found in Engineers or Subcontractors — these will be left unassigned: ${esc(unresolved.join(', '))}.</div>`;
            if (skipped.length) html += `<div style="color:#9a6b00;margin-bottom:6px;">Skipped ${skipped.length} row(s): ${skipped.map(s => `${esc(s.desc)} <i>(${esc(s.why)})</i>`).join('; ')}</div>`;
            html += '<table style="width:100%;border-collapse:collapse;">' + plan.map(v => {
                const a = v.assignee || { type: 'none' };
                let who = '';
                if (a.type === 'engineer') who = `<span title="Engineer">👷 ${esc(a.name)}</span>`;
                else if (a.type === 'subcontractor') who = `<span title="Subcontractor">🏢 ${esc(a.name)}</span>`;
                else if (normName(v.engineer)) who = `<span style="color:#b71c1c;" title="not found">⚠ ${esc(v.engineer)}</span>`;
                return `<tr style="border-bottom:1px solid #eee;"><td style="padding:2px 4px;">${esc(v.desc)}</td><td style="padding:2px 4px;color:#777;">${esc(v.cat)}</td><td style="padding:2px 4px;white-space:nowrap;">${fmtDate(v.date)}</td><td style="padding:2px 4px;text-align:right;">${v.duration}m</td><td style="padding:2px 4px;">${who}</td></tr>`;
            }).join('') + '</table>';
            $('out').innerHTML = html;
            $('create').style.display = '';
            $('create').textContent = `Create ${plan.length} visits`;
            status('Review the plan, then click Create.');
        });

        $('cancel').addEventListener('click', () => { cancelled = true; });

        $('create').addEventListener('click', async () => {
            if (!plan || !plan.length) return;
            const wanted = $('ppm').value.trim().toUpperCase();
            const here = pagePpmNumber();
            if (wanted && here && wanted !== here) {
                status(`⛔ This page is ${here} but you entered ${wanted} — open the right contract first.`);
                return;
            }
            if (location.hash !== '#visitsTab') { location.hash = '#visitsTab'; await sleep(800); }
            if (!addVisitButton()) { status('⛔ Add Visit button not found — open the Visits tab and try again.'); return; }
            cancelled = false;
            $('create').style.display = 'none';
            $('cancel').style.display = '';
            const startTime = /^\d{1,2}:\d{2}$/.test($('time').value.trim()) ? $('time').value.trim() : '08:00';
            const failed = [];
            for (let i = 0; i < plan.length; i++) {
                if (cancelled) { status(`⏹ Stopped after ${i} of ${plan.length}. Use Undo Changes to discard, or Save to keep what was created.`); break; }
                status(`Creating ${i + 1} / ${plan.length}: ${plan[i].desc}`);
                try { await createOneVisit(plan[i], startTime); }
                catch (e) { failed.push(`${plan[i].desc}: ${e.message}`); console.error('[cvft]', plan[i].desc, e); }
                await sleep(250);
            }
            $('cancel').style.display = 'none';
            if (!cancelled) {
                const assigned = plan.filter(v => v.assignee && v.assignee.type !== 'none').length;
                const unassignedNames = [...new Set(plan.filter(v => normName(v.engineer) && (!v.assignee || v.assignee.type === 'none')).map(v => v.engineer))];
                const tail = (assigned ? ` ${assigned} assigned.` : '') + (unassignedNames.length ? ` ⚠ Left unassigned (name not found): ${unassignedNames.join(', ')}.` : '');
                if (failed.length) {
                    status(`⚠ Done with ${failed.length} failure(s) — see list below. NOT saved yet.${tail}`);
                    $('out').innerHTML = '<div style="color:#b71c1c;">' + failed.map(esc).join('<br>') + '</div>' + $('out').innerHTML;
                } else {
                    status(`✅ ${plan.length} visits created.${tail} Review them, then press Joblogic's SAVE button at the top of the visits list (or Undo Changes to discard).`);
                }
            }
        });
    }

    const wait = setInterval(() => {
        if (document.getElementById('visitsTab') && document.body) { clearInterval(wait); init(); }
    }, 800);
})();
