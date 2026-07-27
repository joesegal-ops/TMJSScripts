// ==UserScript==
// @name         Joblogic - PPM Set Draft Invoice Amount
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Paste a two-column list (PPM Contract No. + New Amount ex VAT). For every DRAFT invoice on each contract, sets the invoice line's net (ex-VAT) value to the given amount; VAT recalculates from the existing tax code. Only touches single-line draft invoices (multi-line/approved are skipped). Preview (dry-run) before applying. Collapses into the shared JL dock.
// @match        https://go.joblogic.com/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20PPMs/ppm-set-invoice-amount.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20PPMs/ppm-set-invoice-amount.user.js
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
    const SCRIPT_ID = 'ppm-set-invoice-amount';
    const SCRIPT_LABEL = '💷 PPM Set Invoice £';
    const SCRIPT_COLOR = '#0a7d6b';
    const SCRIPT_DESC = 'Paste a two-column list: PPM Contract No. + New Amount ex VAT. For every DRAFT invoice on each contract, sets the line\'s net (ex-VAT) value to that amount (VAT recalculates from the existing tax code). Only single-line draft invoices are changed; multi-line and approved invoices are skipped. Always Preview first.';

    // Throttle to stay under the Joblogic WAF rate limit (detail pages are heavy).
    const DELAY_BETWEEN_INVOICES = 550;
    const DELAY_BETWEEN_CONTRACTS = 800;

    const GUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const EPS = 0.005; // ex-VAT match tolerance when verifying a save

    // --- STATE ---
    let panel, logArea, tableInput, previewBtn, runBtn, stopBtn, progressText;
    let running = false;
    let plan = null; // [{ contract, amount, invoices:[{invGid, lineId, from, tag}] }]

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const fmtMoney = (n) => (n < 0 ? '-' : '') + '£' + Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // =======================================================================
    // API helpers
    // =======================================================================
    function getToken(doc = document) {
        const el = doc.querySelector('input[name="__RequestVerificationToken"]');
        return el ? el.value : '';
    }

    async function fetchWithRetry(url, opts, tries = 4) {
        let lastErr = '';
        for (let i = 0; i < tries; i++) {
            try {
                const r = await fetch(url, Object.assign({ credentials: 'same-origin' }, opts));
                if (r.status === 403 || r.status === 429) { // WAF / rate limit
                    lastErr = 'HTTP ' + r.status + ' (rate limited)';
                    await sleep(1200 + i * 1200);
                    continue;
                }
                return r;
            } catch (e) {
                lastErr = e.message || String(e);
                await sleep(700 + i * 700);
            }
        }
        throw new Error(lastErr || 'request failed');
    }

    // Contract number -> { cid, number, planRef, site } (or null if not found)
    async function resolveContract(term) {
        const token = getToken();
        const r = await fetchWithRetry('/api/PPMContract/SearchPPMContract', {
            method: 'POST',
            headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', '__RequestVerificationToken': token },
            body: new URLSearchParams({ SearchTerm: term, PageNumber: 1, PageSize: 50 }).toString()
        });
        const d = await r.json().catch(() => null);
        const list = (d && d.AdditionalData && d.AdditionalData.PPMContracts) || [];
        if (!list.length) return null;
        const norm = s => String(s || '').trim().toLowerCase();
        const exact = list.find(c => norm(c.PPMContractNumber) === norm(term));
        const c = exact || list[0];
        return { cid: c.UniqueId, number: c.PPMContractNumber, planRef: c.PlanReference, site: c.SiteName, ambiguous: !exact && list.length > 1 };
    }

    // cid -> array of DRAFT PPM invoice rows (paged).
    async function getDraftInvoices(cid) {
        const token = getToken();
        const rows = [];
        let pageIndex = 1;
        const pageSize = 200;
        for (let guard = 0; guard < 25; guard++) {
            const params = {
                SearchTerm: '', PageIndex: pageIndex, PageSize: pageSize,
                SelectedTab: 1,           // 1 = Draft Invoices
                OrderBy: 0, SearchingEntity: 4, EntityType: 17,
                IncludeStandardInvoices: false, IncludePPMInvoices: true,
                IncludeCGroupInvoices: false, IncludeHireInvoices: false,
                IncludeProjectInvoices: false, IncludeSORInvoices: false,
                ppmContractId: cid, PPMContractId: cid
            };
            const r = await fetchWithRetry('/api/Invoice/SearchInvoice', {
                method: 'POST',
                headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', '__RequestVerificationToken': token },
                body: new URLSearchParams(params).toString()
            });
            const j = await r.json().catch(() => ({}));
            const ad = j.AdditionalData || {};
            const batch = ad.Invoices || [];
            batch.forEach(x => rows.push(x));
            const total = ad.TotalSelectedTabCount != null ? ad.TotalSelectedTabCount : batch.length;
            if (rows.length >= total || batch.length < pageSize) break;
            pageIndex++;
            await sleep(200);
        }
        return rows.filter(x => x.IsDraft && !x.IsCredit && x.PPMContractId === cid);
    }

    // Balanced-bracket extractor around the first occurrence of `needle`, returning parsed JSON.
    //  open='{' : the object brace comes AFTER the needle (e.g. needle "Model:")  -> search forward.
    //  open='[' : the needle is a key INSIDE an array element (e.g. "PriceValue") -> the array
    //             bracket is before it -> search backward.
    function extractEnclosing(html, needle, open) {
        const close = open === '{' ? '}' : ']';
        const at = html.indexOf(needle);
        if (at < 0) return null;
        const start = open === '{' ? html.indexOf(open, at) : html.lastIndexOf(open, at);
        if (start < 0) return null;
        let depth = 0;
        for (let i = start; i < html.length; i++) {
            const ch = html[i];
            if (ch === open) depth++;
            else if (ch === close) { depth--; if (depth === 0) { try { return JSON.parse(html.slice(start, i + 1)); } catch (e) { return null; } } }
        }
        return null;
    }

    // Invoice GUID -> its embedded line array [{Id, PriceValue, Description, ...}]
    async function getInvoiceLines(invGid) {
        const html = await (await fetchWithRetry('/PPMInvoice/Detail/' + invGid, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })).text();
        const arr = extractEnclosing(html, 'PriceValue', '[');
        return Array.isArray(arr) ? arr : [];
    }

    // Line GUID -> { model, token } from the edit-line modal (authoritative field values).
    async function getLineModel(lineId) {
        const html = await (await fetchWithRetry('/PPMInvoice/EditLineModal?id=' + encodeURIComponent(lineId), { headers: { 'X-Requested-With': 'XMLHttpRequest' } })).text();
        const model = extractEnclosing(html, 'Model:', '{');
        const tk = (html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/) || [])[1] || getToken();
        return { model, token: tk };
    }

    // POST /api/PPMInvoice/EditLine with Value overridden. Returns the new ex-VAT total (number).
    async function setLineValue(model, token, newValue) {
        const M = model;
        const fd = new FormData();
        fd.append('Id', M.Id);
        fd.append('PPMContractId', M.PPMContractId);
        fd.append('Description', M.Description == null ? '' : M.Description);
        fd.append('Value', String(newValue));
        fd.append('Discount_Amount', M.Discount_Amount == null ? '' : M.Discount_Amount);
        fd.append('Discount_Percentage', M.Discount_Percentage == null ? '' : M.Discount_Percentage);
        fd.append('TaxCodeId_input', M.TaxCodeDescription == null ? '' : M.TaxCodeDescription);
        fd.append('TaxCodeId', M.TaxCodeId == null ? '' : M.TaxCodeId);
        fd.append('NominalCodeId_input', M.NominalCodeDescription == null ? '' : M.NominalCodeDescription);
        fd.append('NominalCodeId', M.NominalCodeId == null ? '' : M.NominalCodeId);
        // Preserve any line tags exactly as the UI would (one entry per tag).
        if (Array.isArray(M.TagIds)) M.TagIds.forEach(t => fd.append('TagIds', t));
        else if (M.TagIds != null && M.TagIds !== '') fd.append('TagIds', M.TagIds);
        fd.append('InvoiceId', M.InvoiceId);

        const r = await fetchWithRetry('/api/PPMInvoice/EditLine', {
            method: 'POST',
            headers: { 'Accept': 'application/json, text/javascript, */*; q=0.01', 'X-Requested-With': 'XMLHttpRequest', '__RequestVerificationToken': token },
            body: fd
        });
        const txt = await r.text().catch(() => '');
        if (!r.ok) throw new Error('EditLine HTTP ' + r.status + ': ' + txt.slice(0, 160));
        let j = null;
        try { j = JSON.parse(txt); } catch (e) {}
        if (j && j.success === false) throw new Error('EditLine success=false: ' + (j.Message || j.message || txt.slice(0, 140)));
        // Read back the recalculated ex-VAT total so we can VERIFY the change actually took.
        const totals = j && j.AdditionalData && j.AdditionalData.Totals;
        const line = j && j.AdditionalData && j.AdditionalData.Lines && j.AdditionalData.Lines[0];
        let got = totals && totals.TotalExcludingVatValue;
        if (got == null && line) got = line.PriceValue;
        if (got == null) throw new Error('EditLine returned no totals to verify against');
        return Number(got);
    }

    // =======================================================================
    // Amount parsing
    // =======================================================================
    // "£11,837.25" -> 11837.25 ; returns NaN if no number present.
    function parseAmount(str) {
        const m = String(str || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
        return m ? parseFloat(m[0]) : NaN;
    }

    // Parse the pasted two-column table into [{term, amount}].
    // Each row: a PM number (or GUID) + an amount, tab / comma / multi-space separated.
    function parseRows(text) {
        const out = [];
        const seen = new Set();
        text.split(/\r?\n/).forEach(raw => {
            const line = raw.trim();
            if (!line) return;
            // header row?
            if (/contract\s*no|new\s*amount|ex\s*vat/i.test(line) && !/PM\s*\d/i.test(line)) return;
            let term = null;
            const g = line.match(GUID_RE);
            if (g) term = g[0];
            else { const pm = line.match(/PM\s*0*\d+/i); if (pm) term = pm[0].replace(/\s+/g, ''); }
            if (!term) return;
            // amount = first number in the remainder after removing the contract token
            const rest = line.replace(term, ' ');
            const amount = parseAmount(rest);
            if (!isFinite(amount)) { out.push({ term, amount: NaN, bad: true, raw: line }); return; }
            const key = term.toLowerCase();
            if (seen.has(key)) return;                 // first row for a contract wins
            seen.add(key);
            out.push({ term, amount });
        });
        return out;
    }

    // =======================================================================
    // UI
    // =======================================================================
    function createUI() {
        if (document.getElementById('jl-ppmsetamt-panel')) return;

        panel = document.createElement('div');
        panel.id = 'jl-ppmsetamt-panel';
        const c = document.createElement('div');
        c.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;background:#1a1a2e;color:#eee;border-radius:8px;padding:16px;width:580px;max-height:88vh;display:flex;flex-direction:column;font-family:monospace;font-size:12px;box-shadow:0 4px 20px rgba(0,0,0,0.5);';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;';
        const title = document.createElement('strong');
        title.style.fontSize = '14px';
        title.innerHTML = 'PPM Set Draft Invoice Amount <span style="font-weight:400;color:#8a8ab5;font-size:11px;">v' + VERSION + '</span>';
        const closeBtn = document.createElement('button');
        closeBtn.style.cssText = 'background:none;border:none;color:#eee;font-size:18px;cursor:pointer;';
        closeBtn.textContent = '✕';
        closeBtn.addEventListener('click', () => { panel.style.display = 'none'; });
        header.appendChild(title); header.appendChild(closeBtn);

        const rules = document.createElement('div');
        rules.style.cssText = 'background:#0c2620;border-left:3px solid #0a7d6b;border-radius:4px;padding:8px 10px;margin-bottom:8px;line-height:1.5;color:#bfe;';
        rules.innerHTML = 'Paste two columns: <b>PPM Contract No.</b> and <b>New Amount ex VAT</b> (tab / comma separated).<br>' +
            'For <b>every DRAFT invoice</b> on each contract, the line\'s <b>net (ex-VAT)</b> value is set to that amount — VAT recalculates from the existing tax code.<br>' +
            '• Only <b>single-line</b> draft invoices are changed. Multi-line drafts and approved invoices are <b>skipped</b>.<br>' +
            '• Each save is <b>verified</b> against the recalculated total.<br>' +
            '<span style="color:#ff9;">Changing amounts is not auto-reversible — always Preview first.</span>';

        const lbl = document.createElement('div');
        lbl.style.cssText = 'color:#aaa;margin-bottom:4px;';
        lbl.textContent = 'Contract No. + New Amount ex VAT (one per line):';

        tableInput = document.createElement('textarea');
        tableInput.rows = 7;
        tableInput.placeholder = 'PPM Contract No.\tNew Amount ex VAT\nPM0001724\t£11,837.25\nPM0001726\t£4,500.00';
        tableInput.style.cssText = 'width:100%;box-sizing:border-box;background:#0a0a1a;color:#eee;border:1px solid #555;border-radius:4px;padding:8px;font-family:monospace;font-size:12px;resize:vertical;margin-bottom:8px;white-space:pre;';

        const controls = document.createElement('div');
        controls.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap;';

        previewBtn = mkBtn('Preview (dry run)', '#08a');
        previewBtn.addEventListener('click', () => runPreview());
        runBtn = mkBtn('Apply amounts', '#0a7d6b');
        runBtn.disabled = true; runBtn.style.opacity = '0.5';
        runBtn.addEventListener('click', () => confirmAndApply());
        stopBtn = mkBtn('Stop', '#a22');
        stopBtn.style.display = 'none';
        stopBtn.addEventListener('click', () => { running = false; });

        controls.appendChild(previewBtn);
        controls.appendChild(runBtn);
        controls.appendChild(stopBtn);

        const progressDiv = document.createElement('div');
        progressDiv.style.marginBottom = '6px';
        progressText = document.createElement('span');
        progressText.style.color = '#0fa';
        progressText.textContent = 'Paste the table, then Preview.';
        progressDiv.appendChild(progressText);

        logArea = document.createElement('div');
        logArea.style.cssText = 'flex:1;overflow:auto;background:#0a0a1a;padding:8px;border-radius:4px;max-height:52vh;white-space:pre-wrap;word-break:break-word;';

        c.appendChild(header);
        c.appendChild(rules);
        c.appendChild(lbl);
        c.appendChild(tableInput);
        c.appendChild(controls);
        c.appendChild(progressDiv);
        c.appendChild(logArea);
        panel.appendChild(c);
        document.body.appendChild(panel);
        jlRegisterPanel(panel, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR, SCRIPT_DESC);
    }

    function mkBtn(text, bg) {
        const b = document.createElement('button');
        b.textContent = text;
        b.style.cssText = 'background:' + bg + ';color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;font-family:monospace;font-size:12px;';
        return b;
    }

    function log(msg, color) {
        const line = document.createElement('div');
        line.style.color = color || '#ccc';
        line.textContent = msg;
        logArea.appendChild(line);
        logArea.scrollTop = logArea.scrollHeight;
    }
    const setProgress = (m) => { progressText.textContent = m; };

    function invTag(row, idx) {
        const d = row.DateRaised ? String(row.DateRaised).split('T')[0].split(' ')[0] : ('draft ' + (idx + 1));
        return row.OrderNumber ? (d + ' · PO ' + row.OrderNumber) : d;
    }

    // =======================================================================
    // Preview
    // =======================================================================
    async function runPreview() {
        if (running) return;
        const rows = parseRows(tableInput.value);
        if (!rows.length) { alert('Paste at least one row: a PPM contract number and an amount.'); return; }

        running = true;
        previewBtn.disabled = runBtn.disabled = true;
        previewBtn.style.opacity = runBtn.style.opacity = '0.5';
        stopBtn.style.display = 'inline-block';
        logArea.innerHTML = '';
        plan = null;
        log('=== PREVIEW (dry run) — nothing will be changed ===', '#ff0');
        log(rows.length + ' contract row(s).', '#0af');
        log('');

        const stats = { contracts: 0, willChange: 0, alreadyOk: 0, skipped: 0, errors: 0 };
        const builtPlan = [];

        for (let ci = 0; ci < rows.length; ci++) {
            if (!running) { log('Stopped by user.', '#f55'); break; }
            const { term, amount, bad } = rows[ci];
            if (bad || !isFinite(amount)) { log('✗ ' + term + ' — no valid amount on that row, skipped.', '#f55'); stats.errors++; continue; }
            setProgress('Scanning ' + (ci + 1) + '/' + rows.length + ': ' + term);

            let contract;
            try {
                if (GUID_RE.test(term)) contract = { cid: term, number: term.slice(0, 8) + '…', site: '' };
                else contract = await resolveContract(term);
            } catch (e) { log('✗ ' + term + ' — lookup failed: ' + e.message, '#f55'); stats.errors++; continue; }
            if (!contract) { log('✗ ' + term + ' — no matching PPM contract found.', '#f55'); stats.errors++; continue; }
            stats.contracts++;
            log('▸ ' + contract.number + (contract.site ? '  · ' + contract.site : '') + '   → set ex-VAT ' + fmtMoney(amount), '#fff');
            if (contract.ambiguous) log('  ! "' + term + '" was not an exact match — used first result. Check this is right.', '#fb0');

            let invoices;
            try { invoices = await getDraftInvoices(contract.cid); }
            catch (e) { log('  ✗ could not list invoices: ' + e.message, '#f55'); stats.errors++; continue; }
            if (!invoices.length) { log('  (no draft invoices)', '#888'); await sleep(DELAY_BETWEEN_CONTRACTS); continue; }

            const contractPlan = { contract, amount, invoices: [] };
            for (let ii = 0; ii < invoices.length; ii++) {
                if (!running) break;
                const row = invoices[ii];
                const tag = invTag(row, ii);
                let lines;
                try { lines = await getInvoiceLines(row.UniqueId); }
                catch (e) { log('    ✗ ' + tag + ' — could not read invoice lines: ' + e.message, '#f55'); stats.errors++; await sleep(DELAY_BETWEEN_INVOICES); continue; }

                if (lines.length !== 1) {
                    log('    ⚠ skip ' + tag + ' — has ' + lines.length + ' line item(s) (only single-line invoices are changed).', '#fb0');
                    stats.skipped++;
                    await sleep(200);
                    continue;
                }
                const ln = lines[0];
                const from = Number(ln.PriceValue);
                if (Math.abs(from - amount) < EPS) {
                    log('    · ' + tag + '  [' + (ln.Description || '') + '] — already ' + fmtMoney(amount) + ', skipping', '#888');
                    stats.alreadyOk++;
                    await sleep(150);
                    continue;
                }
                log('    • ' + tag + '  [' + (ln.Description || '') + ']  ' + fmtMoney(from) + ' → ' + fmtMoney(amount), '#9fd');
                contractPlan.invoices.push({ invGid: row.UniqueId, lineId: ln.Id, from, tag });
                stats.willChange++;
                await sleep(150);
            }
            if (contractPlan.invoices.length) builtPlan.push(contractPlan);
            await sleep(DELAY_BETWEEN_CONTRACTS);
        }

        log('');
        log('===== PREVIEW SUMMARY =====', '#0af');
        log('Contracts matched: ' + stats.contracts, '#ccc');
        log('Draft invoices to change: ' + stats.willChange, stats.willChange ? '#9fd' : '#888');
        log('Already at target (skipped): ' + stats.alreadyOk, '#888');
        log('Skipped (multi-line): ' + stats.skipped, stats.skipped ? '#fb0' : '#888');
        log('Errors: ' + stats.errors, stats.errors ? '#f55' : '#888');

        if (stats.willChange > 0) {
            plan = builtPlan;
            runBtn.disabled = false; runBtn.style.opacity = '1';
            setProgress('Preview ready — ' + stats.willChange + ' invoice(s) to change. Review, then Apply.');
            log('');
            log('Review the changes above, then click "Apply amounts".', '#ff0');
        } else {
            setProgress('Nothing to change.');
        }

        running = false;
        previewBtn.disabled = false; previewBtn.style.opacity = '1';
        stopBtn.style.display = 'none';
    }

    // =======================================================================
    // Apply
    // =======================================================================
    function confirmAndApply() {
        if (!plan) { alert('Run Preview first.'); return; }
        const total = plan.reduce((n, c) => n + c.invoices.length, 0);
        if (!total) { alert('Nothing to change.'); return; }
        const ok = confirm('Set the ex-VAT amount on ' + total + ' draft invoice(s) across ' + plan.length + ' contract(s)?');
        if (ok) applyPlan();
    }

    async function applyPlan() {
        if (running || !plan) return;
        running = true;
        previewBtn.disabled = runBtn.disabled = true;
        previewBtn.style.opacity = runBtn.style.opacity = '0.5';
        stopBtn.style.display = 'inline-block';
        logArea.innerHTML = '';
        log('=== APPLYING AMOUNTS ===', '#f66');
        log('');

        const grandTotal = plan.reduce((n, c) => n + c.invoices.length, 0);
        const stats = { applied: 0, errors: 0 };

        for (const cp of plan) {
            if (!running) { log('Stopped by user.', '#f55'); break; }
            log('▸ ' + cp.contract.number + (cp.contract.site ? '  · ' + cp.contract.site : '') + '   → ' + fmtMoney(cp.amount), '#fff');
            for (let ii = 0; ii < cp.invoices.length; ii++) {
                if (!running) break;
                const inv = cp.invoices[ii];
                setProgress('Applying ' + (stats.applied + stats.errors + 1) + '/' + grandTotal);
                try {
                    const { model, token } = await getLineModel(inv.lineId);
                    if (!model || !model.Id) throw new Error('could not read line model (invoice may have changed)');
                    const gotExVat = await setLineValue(model, token, cp.amount);
                    if (Math.abs(gotExVat - cp.amount) < EPS) {
                        log('    ✓ ' + inv.tag + '  ' + fmtMoney(inv.from) + ' → ' + fmtMoney(gotExVat), '#0fa');
                        stats.applied++;
                    } else {
                        log('    ⚠ ' + inv.tag + ' — saved but total came back ' + fmtMoney(gotExVat) + ' (expected ' + fmtMoney(cp.amount) + '). Check this invoice.', '#fb0');
                        stats.errors++;
                    }
                } catch (e) {
                    log('    ✗ ' + inv.tag + ' — ' + e.message, '#f55');
                    stats.errors++;
                }
                await sleep(DELAY_BETWEEN_INVOICES);
            }
            await sleep(DELAY_BETWEEN_CONTRACTS);
        }

        log('');
        log('===== SUMMARY =====', '#0af');
        log('Applied & verified: ' + stats.applied, stats.applied ? '#0fa' : '#888');
        log('Errors / unverified: ' + stats.errors, stats.errors ? '#f55' : '#888');
        setProgress('Done. Applied ' + stats.applied + ', errors ' + stats.errors + '.');

        plan = null;
        runBtn.disabled = true; runBtn.style.opacity = '0.5';
        running = false;
        previewBtn.disabled = false; previewBtn.style.opacity = '1';
        stopBtn.style.display = 'none';
    }

    // --- BOOT ---
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', createUI);
    else createUI();
})();
