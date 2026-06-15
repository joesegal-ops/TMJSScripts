// ==UserScript==
// @name         Joblogic PPM — Create Visits From Table
// @namespace    https://go.joblogic.com/
// @version      0.6
// @description  Paste a PPM activity table (from Excel) and auto-create one visit per required visit on the open PPM contract, evenly distributed over the 12-month contract. Weekly (52/yr) visits start on Mondays with a 5-day duration; everything else lands on the first working day of its month with a 1-month duration. Activities are grouped by category (Water/Fire/Electrical/HVAC/…): same category shares months, different categories get different months, and annuals land mid-contract. "Out of Scope" rows are skipped. Nothing is saved automatically — review and press Joblogic's Save.
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
    const SCRIPT_DESC = 'Paste the PPM activity table (copied from Excel, tab-separated). One visit is created per required visit, spread evenly across the 12-month contract. 52/yr = weekly, Mondays, 5-day duration (7200 min). Everything else = first working day of its month, 1-month duration (40320 min). Rows containing "Out of Scope" are ignored. NOTHING IS SAVED automatically — review the new rows then press Joblogic\'s own Save button (or Undo Changes to discard).';

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
        let visitsCol = 3;
        for (const line of lines) {
            if (!line.trim()) continue;
            const cells = line.split('\t').map(c => c.trim());
            const desc = cells[0];
            if (/^description$/i.test(desc)) {
                const idx = cells.findIndex(c => /no\.?\s*visits/i.test(c));
                if (idx > 0) visitsCol = idx;
                continue;
            }
            if (/out of scope/i.test(line)) { skipped.push({ desc: desc || line.trim(), why: 'Out of Scope' }); continue; }
            const visits = parseInt((cells[visitsCol] || '').replace(/[^\d]/g, ''), 10);
            if (!desc || !visits || visits < 1) { skipped.push({ desc: desc || line.trim(), why: 'no visit count (header/section row)' }); continue; }
            items.push({ desc, visits });
        }
        return { items, skipped };
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
            for (let i = 0; i < N; i++) {
                const label = N > 1 ? `${it.desc} - Visit ${i + 1} of ${N}` : it.desc;
                if (N >= WEEKLY_THRESHOLD) {
                    const d = firstMondayOnOrAfter(start);
                    d.setDate(d.getDate() + i * 7);
                    out.push({ desc: label, cat: it.cat, date: d, duration: WEEKLY_DURATION, kind: 'weekly' });
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
                    out.push({ desc: label, cat: it.cat, date: d, duration: MONTHLY_DURATION, kind: 'monthly' });
                }
            }
        }
        out.sort((a, b) => a.date - b.date);
        return out;
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
    }

    // ------------------------------------------------------------------ UI
    function buildPanel() {
        const p = document.createElement('div');
        p.id = SCRIPT_ID + '-panel';
        p.style.cssText = 'position:fixed;top:70px;right:8px;z-index:99999;width:430px;max-height:84vh;overflow:auto;background:#fff;border:1px solid #c9d4da;border-radius:6px;box-shadow:0 4px 18px rgba(0,0,0,.25);font-family:"Open Sans",sans-serif;font-size:12px;color:#243b46;padding:12px;';
        p.innerHTML = `
            <div style="font-weight:700;font-size:14px;margin-bottom:8px;">📋 Create Visits From Table <span style="font-weight:400;color:#888;">v0.5</span></div>
            <div style="display:flex;gap:8px;margin-bottom:8px;">
                <label style="flex:1;">PPM number<br><input id="cvft-ppm" class="form-control" style="width:100%;font-size:12px;" placeholder="PM0001234"></label>
                <label style="flex:1;">Contract start (DD/MM/YYYY)<br><input id="cvft-start" class="form-control" style="width:100%;font-size:12px;" placeholder="01/05/2026"></label>
                <label style="width:70px;">Time<br><input id="cvft-time" class="form-control" style="width:100%;font-size:12px;" value="08:00"></label>
            </div>
            <label style="display:block;margin-bottom:8px;">Paste table (tab-separated, straight from Excel)<br>
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

        $('preview').addEventListener('click', () => {
            const start = parseUkDate($('start').value);
            if (!start) { status('⚠ Enter a valid contract start date (DD/MM/YYYY).'); return; }
            const { items, skipped } = parseTable($('table').value);
            if (!items.length) { status('⚠ No usable rows found — paste the table tab-separated (copy straight from Excel).'); return; }
            plan = scheduleVisits(items, start);
            const byKind = plan.filter(v => v.kind === 'weekly').length;
            const cats = [...new Set(plan.map(v => v.cat))];
            let html = `<div style="margin-bottom:6px;"><b>${items.length}</b> activities → <b>${plan.length}</b> visits (${byKind} weekly, ${plan.length - byKind} monthly-style) across <b>${cats.length}</b> categories: ${cats.join(', ')}.</div>`;
            if (skipped.length) html += `<div style="color:#9a6b00;margin-bottom:6px;">Skipped ${skipped.length} row(s): ${skipped.map(s => `${s.desc} <i>(${s.why})</i>`).join('; ')}</div>`;
            html += '<table style="width:100%;border-collapse:collapse;">' + plan.map(v =>
                `<tr style="border-bottom:1px solid #eee;"><td style="padding:2px 4px;">${v.desc}</td><td style="padding:2px 4px;color:#777;">${v.cat}</td><td style="padding:2px 4px;white-space:nowrap;">${fmtDate(v.date)}</td><td style="padding:2px 4px;text-align:right;">${v.duration}m</td></tr>`
            ).join('') + '</table>';
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
                if (failed.length) {
                    status(`⚠ Done with ${failed.length} failure(s) — see list below. NOT saved yet.`);
                    $('out').innerHTML = '<div style="color:#b71c1c;">' + failed.join('<br>') + '</div>' + $('out').innerHTML;
                } else {
                    status(`✅ ${plan.length} visits created — review them, then press Joblogic's SAVE button at the top of the visits list (or Undo Changes to discard).`);
                }
            }
        });
    }

    const wait = setInterval(() => {
        if (document.getElementById('visitsTab') && document.body) { clearInterval(wait); init(); }
    }, 800);
})();
