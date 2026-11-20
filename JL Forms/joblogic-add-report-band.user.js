// ==UserScript==
// @name         Joblogic - Add Report Summary Band
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Appends the Remedials + H&S fields to a custom form's Report Designer summary band, below whatever is already there, then saves. The report layout only exists inside the Stimulsoft designer at runtime — there is no endpoint that hands it over — so this runs ON the designer page, one form at a time. It computes placement from the band's existing contents rather than a fixed offset, because every form's layout differs: a fixed offset lands on top of the signature block. Only works on an UNLOCKED (undeployed) draft, so add the report band before deploying, not after.
// @match        https://go.joblogic.com/Form/Designer/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Forms/joblogic-add-report-band.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Forms/joblogic-add-report-band.user.js
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

    const VERSION = '1.0.0';
    const SCRIPT_ID = 'add-report-band';
    const SCRIPT_LABEL = '📄 Add Report Band';
    const SCRIPT_COLOR = '#5a4a8c';
    const SCRIPT_DESC = 'Adds the Remedials + H&S fields to this form’s Report Designer summary band, placed below whatever is already in it. Open the Report Designer first. Only works on an undeployed draft.';

    // The five fields, and where each one reads from. Joblogic builds the report dictionary
    // from the form definition, so these exist as soon as the survey side is saved:
    //   - simple page-level questions land on  Table1
    //   - a DROPDOWN gets its own data source with a single Value column
    const ROWS = [
        { label: 'Remedials Required?',               expr: '{Table1.VisitRemedialsRequired}' },
        { label: 'What is the remedial?',             expr: '{Table1.VisitRemedialDetail}' },
        { label: 'Remedial priority',                 expr: '{VisitRemedialPriority.Value}' },
        { label: 'Is this a Health and Safety Risk?', expr: '{Table1.HealthSafetyRisk}' },
        { label: 'Describe the risk',                 expr: '{Table1.HealthSafetyDetail}' }
    ];
    const HEADING = 'Remedials and Health & Safety';
    const PREFIX = 'JLRem';            // every component this script creates is named JLRem*

    // Inches — the designer's status bar says so, and clientRectangle is in report units.
    const GAP_ABOVE = 0.4, HEAD_H = 0.5, ROW_H = 0.5, ROW_STEP = 0.6, PAD_BELOW = 0.3;

    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const formIdFromUrl = () => (location.pathname.match(/\/Form\/Designer\/([0-9a-f-]{36})/i) || [])[1] || '';

    function csrf() {
        const el = document.querySelector('input[name="__RequestVerificationToken"]');
        return el ? el.value : '';
    }

    // =======================================================================
    // Report model helpers — all against the live Stimulsoft designer
    // =======================================================================
    const getDesigner = () => window.designer || null;
    const getReport = () => { const d = getDesigner(); return d && (d.report || d._report); };

    function summaryBand(rep) {
        const page = rep.pages.getByIndex(0);
        for (let i = 0; i < page.components.count; i++) {
            const c = page.components.getByIndex(i);
            if (/Summary/i.test(c.name || '')) return { band: c, page };
        }
        return { band: null, page };
    }

    /** Bottom edge of everything already in the band — what we must clear. */
    function contentBottom(band) {
        let bottom = 0;
        for (let i = 0; i < band.components.count; i++) {
            const r = band.components.getByIndex(i).clientRectangle;
            bottom = Math.max(bottom, r.y + r.height);
        }
        return bottom;
    }

    /** Left margin and usable width, taken from what the band already uses. */
    function bandMetrics(band) {
        let left = null, right = null;
        for (let i = 0; i < band.components.count; i++) {
            const r = band.components.getByIndex(i).clientRectangle;
            left = left === null ? r.x : Math.min(left, r.x);
            right = right === null ? r.x + r.width : Math.max(right, r.x + r.width);
        }
        if (left === null) { left = 0.6; right = 7.3; }
        if (right - left < 3) right = left + 6.1;      // degenerate band — use a sane width
        return { left, width: right - left };
    }

    const already = (band) => {
        for (let i = 0; i < band.components.count; i++)
            if (String(band.components.getByIndex(i).name || '').startsWith(PREFIX)) return true;
        return false;
    };

    function addBand(rep, band, say) {
        const S = window.Stimulsoft;
        const Rect = S.System && S.System.Drawing && S.System.Drawing.Rectangle;
        const Text = S.Report.Components.StiText;
        if (!Rect || !Text) throw new Error('Stimulsoft classes not found on this page');

        const { left, width } = bandMetrics(band);
        const labelW = Math.min(2.6, width * 0.42);
        const valueL = left + labelW + 0.2;
        const valueW = Math.max(1.5, width - labelW - 0.2);
        const top0 = contentBottom(band) + GAP_ABOVE;

        const mk = (name, text, l, t, w, h, bold) => {
            const c = new Text();
            c.name = name;
            c.text = text;
            c.clientRectangle = new Rect(l, t, w, h);
            c.canGrow = true;
            c.wordWrap = true;
            if (bold) {
                try { c.font = new S.System.Drawing.Font('Arial', 9, S.System.Drawing.FontStyle.Bold); }
                catch (e) { /* styling is cosmetic — never fail the run for it */ }
            }
            band.components.add(c);
        };

        mk(PREFIX + 'Heading', HEADING, left, top0, width, HEAD_H, true);
        ROWS.forEach((r, i) => {
            const t = top0 + HEAD_H + 0.1 + i * ROW_STEP;
            mk(PREFIX + 'Lbl' + i, r.label, left, t, labelW, ROW_H, true);
            mk(PREFIX + 'Val' + i, r.expr, valueL, t, valueW, ROW_H, false);
        });

        band.height = top0 + HEAD_H + 0.1 + ROWS.length * ROW_STEP + PAD_BELOW;
        say('placed at y=' + top0.toFixed(2) + ', band height now ' + band.height.toFixed(2)
            + ' (left ' + left.toFixed(2) + ', width ' + width.toFixed(2) + ')');
    }

    /** Rebuild the designer view from the model — it does NOT redraw on its own. */
    function refreshDesigner(rep) {
        const S = window.Stimulsoft, d = getDesigner();
        const json = rep.saveToJsonString();
        const fresh = new S.Report.StiReport();
        fresh.load(json);                  // note: load(), not loadFromJsonString()
        d.report = fresh;
        return fresh;
    }

    /**
     * Save the layout. This is what the floppy-disk icon above Paste does — captured live.
     * The Survey Designer's own Save button is for the survey definition; don't rely on it
     * for the report.
     */
    async function saveReport(rep, formId, name) {
        const fd = new FormData();
        fd.append('id', formId);
        fd.append('name', name || 'report.mrt');
        // content must be a BLOB named contentBlob, exactly as SaveSurveyForm wants it.
        // Passing the JSON as a plain string is accepted with HTTP 200 and then refused in
        // the body: {success:false, errors:["Invalid content"]} — easy to miss if you only
        // check the status code.
        fd.append('content', new Blob([rep.saveToJsonString()], { type: 'application/json' }), 'contentBlob');
        const resp = await fetch('/api/DynamicForm/SaveFormDesigner', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'X-Requested-With': 'XMLHttpRequest', '__RequestVerificationToken': csrf() },
            body: fd
        });
        const txt = await resp.text();
        let json = null; try { json = JSON.parse(txt); } catch (e) {}
        if (!resp.ok) throw new Error('SaveFormDesigner HTTP ' + resp.status);
        if (json && json.success === false) throw new Error((json.errors || []).join('; ') || 'save refused');
        return true;
    }

    // =======================================================================
    // UI
    // =======================================================================
    let panel, logArea, statusLine;

    function log(msg, color) {
        if (!logArea) { console.log('[report-band]', msg); return; }
        const line = document.createElement('div');
        line.style.color = color || '#ccc';
        line.style.whiteSpace = 'pre-wrap';
        line.textContent = msg;
        logArea.appendChild(line);
        logArea.scrollTop = logArea.scrollHeight;
    }
    const setStatus = (m) => { if (statusLine) statusLine.textContent = m; };

    function mkBtn(label, color, onClick) {
        const b = document.createElement('button');
        b.textContent = label;
        b.style.cssText = 'background:' + color + ';color:#fff;border:none;border-radius:4px;'
            + 'padding:6px 12px;cursor:pointer;font-family:monospace;font-size:12px;';
        b.addEventListener('click', onClick);
        return b;
    }

    /** Read-only: what the script would do, and whether this page is in a fit state. */
    function inspect() {
        const rep = getReport();
        if (!rep) { log('Report Designer is not open — click Report Designer first, then try again.', '#e2a33c'); return null; }
        const { band } = summaryBand(rep);
        if (!band) { log('This report has no ReportSummaryBand. It needs one adding by hand first.', '#ff6b6b'); return null; }
        log('Summary band "' + band.name + '": ' + band.components.count + ' component(s), height '
            + Number(band.height).toFixed(2));
        const m = bandMetrics(band);
        log('existing content ends at y=' + contentBottom(band).toFixed(2)
            + '; margin ' + m.left.toFixed(2) + ', usable width ' + m.width.toFixed(2));
        if (already(band)) { log('Already carries ' + PREFIX + '* components — nothing to do.', '#9fb6c4'); return null; }
        return { rep, band };
    }

    async function run() {
        try {
            const ctx = inspect();
            if (!ctx) return;
            const formId = formIdFromUrl();
            if (!formId) { log('Could not read the form id from the URL.', '#ff6b6b'); return; }

            setStatus('adding…');
            addBand(ctx.rep, ctx.band, (m) => log('  ' + m, '#9fb6c4'));
            const fresh = refreshDesigner(ctx.rep);

            setStatus('saving…');
            await saveReport(fresh, formId, (document.title || 'report').replace(/ - Designer$/, ''));
            log('Saved. Reload the page to confirm it stuck.', '#0fa');

            // Verify from the model we just serialised, then tell the user to reload —
            // the only real proof is a fresh load, so don't claim more than that.
            const { band } = summaryBand(fresh);
            log('Band now has ' + band.components.count + ' component(s), height '
                + Number(band.height).toFixed(2) + '.', '#0fa');
            setStatus('done');
        } catch (e) {
            log('Failed: ' + e.message, '#ff6b6b');
            setStatus('failed');
        }
    }

    function createUI() {
        if (document.getElementById('jl-reportband-panel')) return;
        panel = document.createElement('div');
        panel.id = 'jl-reportband-panel';

        const box = document.createElement('div');
        box.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;background:#1a1a2e;'
            + 'color:#eee;border-radius:8px;padding:14px;width:560px;max-height:80vh;display:flex;'
            + 'flex-direction:column;font-family:monospace;font-size:12px;box-shadow:0 4px 20px rgba(0,0,0,0.5);';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;';
        const title = document.createElement('strong');
        title.innerHTML = 'Add Report Band <span style="font-weight:400;color:#b59ad6;font-size:11px;">v' + VERSION + '</span>';
        const close = document.createElement('button');
        close.textContent = '✕';
        close.style.cssText = 'background:none;border:none;color:#eee;font-size:18px;cursor:pointer;';
        close.addEventListener('click', () => { panel.style.display = 'none'; });
        header.appendChild(title); header.appendChild(close);

        const blurb = document.createElement('div');
        blurb.style.cssText = 'color:#9fb6c4;margin-bottom:8px;line-height:1.5;';
        blurb.textContent = 'Open the Report Designer tab first. Inspect says what it would do; '
            + 'Add appends the five fields below the band’s existing content and saves. '
            + 'Works only on an undeployed draft — add the band before deploying.';

        statusLine = document.createElement('div');
        statusLine.style.cssText = 'color:#0fa;margin-bottom:8px;';

        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;';
        row.appendChild(mkBtn('Inspect', '#3d4a6b', () => { logArea.textContent = ''; inspect(); }));
        row.appendChild(mkBtn('Add + save', '#5a4a8c', () => {
            if (confirm('Append the Remedials + H&S block to this form’s report summary band and save?')) run();
        }));

        logArea = document.createElement('div');
        logArea.style.cssText = 'flex:1;overflow-y:auto;background:#0a0a1a;border-radius:4px;'
            + 'padding:8px;min-height:120px;';

        box.appendChild(header); box.appendChild(blurb); box.appendChild(statusLine);
        box.appendChild(row); box.appendChild(logArea);
        panel.appendChild(box);
        document.body.appendChild(panel);

        if (typeof jlRegisterPanel === 'function') jlRegisterPanel(panel, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR, SCRIPT_DESC);
        setStatus(getReport() ? 'Report Designer is open.' : 'Open the Report Designer tab, then Inspect.');
    }

    // --- BOOT ---
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', createUI);
    else createUI();
})();
