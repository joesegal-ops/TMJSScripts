// ==UserScript==
// @name         Joblogic - Add Report Summary Band
// @namespace    http://tampermonkey.net/
// @version      1.1.1
// @description  Appends the Remedials + H&S fields to a custom form's Report Designer summary band, below whatever is already there, then saves. The report layout only exists inside the Stimulsoft designer at runtime — there is no endpoint that hands it over — so this runs ON the designer page, one form at a time. It computes placement from the band's existing contents rather than a fixed offset, because every form's layout differs: a fixed offset lands on top of the signature block. The report is NOT version-locked: a deployed, locked form saves fine (verified 2026-11-20), so this can run as a separate pass after the surveys are deployed and the jobs repointed. Reports come in two shapes: banded ones get the fields appended to the summary band; flat hand-laid-out ones (no bands at all, every page full) get a new SUMMARY FRONT PAGE carrying the logo, date, company, form name, site and the five fields.
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
    const SCRIPT_DESC = 'Adds the Remedials + H&S fields to this form’s Report Designer summary band, placed below whatever is already in it. Open the Report Designer first. Works on deployed forms — only the survey is version-locked.';

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

    /**
     * Left margin and usable width. Start from what the band already uses, but fall back to
     * the PAGE width when the band's own content is narrow — a band holding two small boxes
     * on an 8.5" page reported 2.4", which would squeeze the block into a third of the sheet.
     */
    function bandMetrics(band, page) {
        let left = null, right = null;
        for (let i = 0; i < band.components.count; i++) {
            const r = band.components.getByIndex(i).clientRectangle;
            left = left === null ? r.x : Math.min(left, r.x);
            right = right === null ? r.x + r.width : Math.max(right, r.x + r.width);
        }
        if (left === null) left = 0.6;
        const pageW = page && page.width ? page.width : 0;
        // usable width on the page, allowing the same margin on the right as on the left
        const pageUsable = pageW ? Math.max(0, pageW - left * 2) : 0;
        let width = (right === null) ? 0 : right - left;
        if (pageUsable > width) width = pageUsable;    // prefer the page over a narrow band
        if (width < 3) width = 6.1;                    // nothing sensible to go on
        return { left, width };
    }

    const already = (band) => {
        for (let i = 0; i < band.components.count; i++)
            if (String(band.components.getByIndex(i).name || '').startsWith(PREFIX)) return true;
        return false;
    };

    function addBand(rep, band, say, page) {
        const S = window.Stimulsoft;
        const Rect = S.System && S.System.Drawing && S.System.Drawing.Rectangle;
        const Text = S.Report.Components.StiText;
        if (!Rect || !Text) throw new Error('Stimulsoft classes not found on this page');

        const { left, width } = bandMetrics(band, page);
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

    // =======================================================================
    // Flat reports: build a summary FRONT page
    // =======================================================================
    // Not every report is banded. The per-site certificate reports are hand-laid-out: flat
    // StiText/StiImage straight on the page, no bands anywhere, 13 pages each and every page
    // full to within a fraction of an inch. There is nowhere to append to, so the fields get
    // their own page at the front, styled from the report's own header so it does not look
    // bolted on.
    const COMPANY_LINE = 'Untitled Projects Management Ltd';

    const isBanded = (page) => {
        for (let i = 0; i < page.components.count; i++) {
            const c = page.components.getByIndex(i);
            if (c && c.components && c.components.count !== undefined) return true;
        }
        return false;
    };

    const newGuid = () => {
        let s = '';
        for (let i = 0; i < 32; i++) s += '0123456789abcdef'[Math.floor(Math.random() * 16)];
        return s;
    };

    /**
     * Build the front page by editing the report JSON, not the object model: the pages
     * collection has no insert() and components have no clone(), so a JSON copy is both the
     * only way to put a page FIRST and the only exact way to carry the logo's ImageBytes over.
     */
    function buildSummaryPage(rep, formName, say) {
        const j = JSON.parse(rep.saveToJsonString());
        const keys = Object.keys(j.Pages).sort((a, b) => +a - +b);
        const src = j.Pages[keys[0]];
        const sc = src.Components || {};
        const list = Object.keys(sc).map(k => sc[k]).filter(Boolean);

        const textOf = (c) => (c && c.Text && c.Text.Value != null) ? String(c.Text.Value) : '';
        const logo = list.find(c => c.Ident === 'StiImage' && c.ImageBytes);
        const dateC = list.find(c => /UTCNonFormated/i.test(textOf(c)));
        const siteC = list.find(c => /\{Site\.Name\}/i.test(textOf(c)));
        // style templates: a bold label, and a plain value
        const labelT = list.find(c => c.Ident === 'StiText' && /:\s*$/.test(textOf(c)))
                    || list.find(c => c.Ident === 'StiText');
        const valueT = dateC || siteC || labelT;
        if (!labelT) throw new Error('no text component to copy styling from');

        const clone = o => JSON.parse(JSON.stringify(o));
        const rect = (x, y, w, h) => [x, y, w, h].join(',');
        const out = {}; let n = 0;
        const put = o => { out[String(n++)] = o; };
        const mk = (tpl, name, value, x, y, w, h, opts) => {
            const t = clone(tpl);
            t.Name = name; t.Guid = newGuid();
            t.ClientRectangle = rect(x, y, w, h);
            t.Text = { Value: value };
            delete t.TextFormat;            // our values are plain text, not dates
            // NEVER set Margins on a component. Adding `Margins: "0.07,0,0.07,0"` to pad the
            // text off the border made Stimulsoft's loader DROP every component carrying it —
            // silently, 18 components down to 7, with SaveFormDesigner still reporting
            // {success:true}. The only signal was the preview coming back short. If padding is
            // ever wanted, move the ClientRectangle instead.
            delete t.Margins;
            t.Type = 'Expression';
            t.CanGrow = true; t.WordWrap = true;
            if (opts && opts.align) t.HorAlignment = opts.align;
            put(t);
        };

        const W = parseFloat(src.PageWidth) || 10.2;
        const right = Math.max(6, W - 1);      // keep clear of the right margin
        const bodyW = right - 1;

        if (logo) { const g = clone(logo); g.Name = 'SumLogo'; g.Guid = newGuid();
                    g.ClientRectangle = rect(0, 0, 3.6, 1.4); put(g); }
        if (dateC) {
            mk(labelT, 'SumDateLbl', 'DATE:', right - 4, 0.2, 1.1, 0.5, { align: 'Center' });
            const dv = clone(dateC); dv.Name = 'SumDateVal'; dv.Guid = newGuid();
            dv.ClientRectangle = rect(right - 2.9, 0.2, 2.9, 0.5); put(dv);   // keeps its UTC format
        }
        mk(labelT, 'SumCompany', COMPANY_LINE, 1, 1.6, bodyW, 0.4, { align: 'Center' });
        mk(labelT, 'SumFormName', formName, 1, 2.1, bodyW, 0.4, { align: 'Center' });
        mk(labelT, 'SumSiteLbl', 'SITE:', 1, 2.7, 1.5, 0.4, { align: 'Left' });
        if (siteC) { const sv = clone(siteC); sv.Name = 'SumSiteVal'; sv.Guid = newGuid();
                     sv.ClientRectangle = rect(2.6, 2.7, bodyW - 1.6, 0.4); put(sv); }
        else mk(valueT, 'SumSiteVal', '{Site.Name}', 2.6, 2.7, bodyW - 1.6, 0.4, { align: 'Left' });

        mk(labelT, 'SumHeading', HEADING, 1, 3.4, bodyW, 0.45, { align: 'Center' });
        ROWS.forEach((r, i) => {
            const y = 4.0 + i * 0.55;
            mk(labelT, 'SumLbl' + i, r.label, 1, y, 3.2, 0.45, { align: 'Left' });
            mk(valueT, 'SumVal' + i, r.expr, 4.3, y, bodyW - 3.3, 0.45, { align: 'Left' });
        });

        const page = { Ident: 'StiPage', Name: 'SummaryPage', Guid: newGuid(),
            Interaction: { Ident: 'StiInteraction' },
            Border: src.Border, Brush: src.Brush, Components: out,
            PaperSize: src.PaperSize, Orientation: src.Orientation,
            PageWidth: src.PageWidth, PageHeight: src.PageHeight,
            Watermark: src.Watermark, Margins: src.Margins };

        const old = keys.map(k => j.Pages[k]);
        const rebuilt = { '0': page };
        old.forEach((p, i) => { rebuilt[String(i + 1)] = p; });
        j.Pages = rebuilt;

        say('front page built: ' + n + ' components'
            + (logo ? ', logo copied' : ', NO LOGO FOUND')
            + (dateC ? ', date copied' : ', no date field found')
            + (siteC ? ', site copied' : ', site synthesised'));
        return j;
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
        const page0 = rep.pages.getByIndex(0);

        // Already done? Either shape leaves a marker behind.
        if (String(page0.name || '') === 'SummaryPage') {
            log('Page 1 is already a SummaryPage — nothing to do.', '#9fb6c4'); return null;
        }

        const { band } = summaryBand(rep);
        if (band) {
            log('Banded report. Summary band "' + band.name + '": ' + band.components.count
                + ' component(s), height ' + Number(band.height).toFixed(2));
            const m = bandMetrics(band, rep.pages.getByIndex(0));
            log('existing content ends at y=' + contentBottom(band).toFixed(2)
                + '; margin ' + m.left.toFixed(2) + ', usable width ' + m.width.toFixed(2));
            if (already(band)) { log('Already carries ' + PREFIX + '* components — nothing to do.', '#9fb6c4'); return null; }
            return { mode: 'band', rep, band };
        }

        // No bands anywhere — flat, hand-laid-out report.
        if (isBanded(page0)) { log('Bands exist but no summary band — not handled, do this one by hand.', '#ff6b6b'); return null; }
        let full = 0, maxFree = 0;
        for (let p = 0; p < rep.pages.count; p++) {
            const pg = rep.pages.getByIndex(p);
            let bottom = 0;
            for (let i = 0; i < pg.components.count; i++) {
                const r = pg.components.getByIndex(i).clientRectangle;
                bottom = Math.max(bottom, r.y + r.height);
            }
            const free = pg.height - bottom;
            maxFree = Math.max(maxFree, free);
            if (free < 1) full++;
        }
        log('Flat report: ' + rep.pages.count + ' page(s), no bands. ' + full + ' of them are full'
            + ' (most free space on any page: ' + maxFree.toFixed(2) + '").');
        log('Will add a SUMMARY FRONT PAGE: logo, date, company, form name, site, and the five fields.', '#9fb6c4');
        return { mode: 'page', rep };
    }

    async function run() {
        try {
            const ctx = inspect();
            if (!ctx) return;
            const formId = formIdFromUrl();
            if (!formId) { log('Could not read the form id from the URL.', '#ff6b6b'); return; }

            const name = (document.title || 'report').replace(/ - Designer$/, '');
            let fresh;
            if (ctx.mode === 'band') {
                setStatus('appending to the summary band…');
                addBand(ctx.rep, ctx.band, (m) => log('  ' + m, '#9fb6c4'), ctx.rep.pages.getByIndex(0));
                fresh = refreshDesigner(ctx.rep);
                const { band } = summaryBand(fresh);
                log('Band now has ' + band.components.count + ' component(s), height '
                    + Number(band.height).toFixed(2) + '.', '#0fa');
            } else {
                setStatus('building the summary front page…');
                const json = buildSummaryPage(ctx.rep, name, (m) => log('  ' + m, '#9fb6c4'));
                const S = window.Stimulsoft;
                fresh = new S.Report.StiReport();
                fresh.load(JSON.stringify(json));
                getDesigner().report = fresh;
                log('Report now has ' + fresh.pages.count + ' page(s); page 1 is "'
                    + fresh.pages.getByIndex(0).name + '".', '#0fa');
            }

            setStatus('saving…');
            await saveReport(fresh, formId, name);
            log('Saved. Reload the page to confirm it stuck.', '#0fa');
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
            + 'Works on deployed forms too — the report is not version-locked.';

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
