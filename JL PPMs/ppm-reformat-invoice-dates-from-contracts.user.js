// ==UserScript==
// @name         Joblogic - PPM Invoice Date & Order No Reformatter
// @namespace    http://tampermonkey.net/
// @version      1.2.1
// @description  Paste a list of PPM Contract numbers + one order-number reference. For every DRAFT invoice on each contract, sets Date to Raise = 15th of the month before the line service month, Payment Due = 30 days after the Date to Raise, and overwrites the Customer Order Number as "PPM - {MMMYY} | {ref} - {SITE}". Preview (dry-run) before applying. Collapses into the shared JL dock.
// @match        https://go.joblogic.com/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20PPMs/ppm-reformat-invoice-dates-from-contracts.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20PPMs/ppm-reformat-invoice-dates-from-contracts.user.js
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

    const VERSION = '1.2.1';
    const SCRIPT_ID = 'ppm-invoice-reformat';
    const SCRIPT_LABEL = '🗓️ PPM Invoice Dates';
    const SCRIPT_COLOR = '#8a5cf6';
    const SCRIPT_DESC = 'Paste PPM Contract numbers + one order-number reference. For each contract\'s DRAFT invoices it sets Date to Raise = 15th of the month before the line service month, Payment Due = 30 days after the Date to Raise, and overwrites the Customer Order Number as "PPM - {MMMYY} | {ref} - {SITE}". Always Preview first.';

    // Throttle to stay under the Joblogic WAF rate limit.
    const DELAY_BETWEEN_INVOICES = 450;
    const DELAY_BETWEEN_CONTRACTS = 700;

    const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const GUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

    // --- STATE ---
    let panel, logArea, contractInput, refInput, previewBtn, runBtn, stopBtn, progressText;
    let running = false;
    let plan = null; // last computed preview plan (array of {contract, invoices:[...]})

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    // =======================================================================
    // Date + order-number transforms
    // =======================================================================
    const fmtDMY = (d, mo, y) => String(d).padStart(2, '0') + '/' + String(mo).padStart(2, '0') + '/' + y;

    // Everything is anchored to the invoice line's SERVICE MONTH M ({mo,y}),
    // read from the line description e.g. "Invoice (01/07/2026 - 31/07/2026)".
    // Date to Raise -> 15th of the month BEFORE M.
    function raiseDate(m) {
        let mo = m.mo - 1, y = m.y;
        if (mo < 1) { mo = 12; y--; }
        return { d: 15, mo, y };
    }
    // Payment Due -> 30 days after the Date to Raise.
    function addDays(dmy, n) {
        const dt = new Date(Date.UTC(dmy.y, dmy.mo - 1, dmy.d));
        dt.setUTCDate(dt.getUTCDate() + n);
        return { d: dt.getUTCDate(), mo: dt.getUTCMonth() + 1, y: dt.getUTCFullYear() };
    }
    const dmyStr = (dmy) => fmtDMY(dmy.d, dmy.mo, dmy.y);
    // Order-number month token, e.g. "JUL26" = month + 2-digit year of the service month.
    const monthYY = (m) => MONTHS[m.mo - 1] + String(m.y).slice(-2);

    // Pull the service month from the invoice line description on the detail page.
    function parseServiceMonth(html) {
        const m = /Invoice\s*\((\d{2})\/(\d{2})\/(\d{4})\s*[-–]\s*(\d{2})\/(\d{2})\/(\d{4})\)/.exec(html);
        if (!m) return null;
        return { mo: +m[2], y: +m[3], label: 'Invoice (' + m[1] + '/' + m[2] + '/' + m[3] + ' - ' + m[4] + '/' + m[5] + '/' + m[6] + ')' };
    }

    // Build the Customer Order Number: "PPM - {MMMYY} | {ref} - {siteCode}"
    //   MMMYY    = service month + 2-digit year (= month of payment), e.g. JUL26
    //   ref      = user-entered reference for the whole run, e.g. SCON-00021244
    //   siteCode = first 6 non-blank chars of the Site Name, upper-cased
    //              ("1 Mark Square LON19" -> "1MARKS")
    function siteCode(siteName) {
        return String(siteName || '').replace(/\s+/g, '').slice(0, 6).toUpperCase();
    }
    function buildOrderNumber(mon, ref, siteName) {
        return 'PPM - ' + mon + ' | ' + ref + ' - ' + siteCode(siteName);
    }

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
        // Safety: keep only genuine draft, non-credit PPM invoices belonging to this contract.
        return rows.filter(x => x.IsDraft && !x.IsCredit && x.PPMContractId === cid);
    }

    // Fetch the invoice detail page: header form fields + service month + token.
    async function fetchDetail(gid) {
        const detailUrl = '/PPMInvoice/Detail/' + gid;
        const html = await (await fetchWithRetry(detailUrl, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })).text();
        const tk = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
        const csrf = tk ? tk[1] : getToken();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const form = doc.querySelector('form[action*="EditDetail"]') || doc;
        const entries = []; // [name, value] preserving duplicates (e.g. TagIds)
        form.querySelectorAll('input[name], select[name], textarea[name]').forEach(el => {
            if (el.name === '__RequestVerificationToken') return;
            const val = el.type === 'checkbox' ? (el.checked ? 'true' : 'false') : (el.value || '');
            entries.push([el.name, val]);
        });
        const cur = {};
        entries.forEach(([k, v]) => { if (!(k in cur)) cur[k] = v; });
        return { detailUrl, entries, cur, csrf, serviceMonth: parseServiceMonth(html) };
    }

    // Compute the change set from a fetched detail. Returns { changes, warnings, changed, skip }.
    function computeChanges(detail, ref, siteName) {
        const warnings = [];
        const cur = detail.cur;
        const sm = detail.serviceMonth;
        if (!sm) {
            warnings.push('could not read the invoice line service period ("Invoice (dd/mm/yyyy - dd/mm/yyyy)") — skipped for safety');
            return { changes: {}, warnings, changed: false, skip: true };
        }
        const mon = monthYY(sm);
        if (!siteCode(siteName)) warnings.push('Site Name is blank — order number site code will be empty');
        const raise = raiseDate(sm);
        const due = addDays(raise, 30);
        const out = {
            InvoiceDate: { old: cur.InvoiceDate || '', new: dmyStr(raise) },
            PaymentDueDate: { old: cur.PaymentDueDate || '', new: dmyStr(due) },
            OrderNumber: { old: cur.OrderNumber || '', new: buildOrderNumber(mon, ref, siteName), mon }
        };
        const changed = Object.values(out).some(v => v.old !== v.new);
        return { changes: out, warnings, changed, skip: false, serviceLabel: sm.label };
    }

    // POST EditDetail with the three fields overridden (other fields preserved).
    async function applyInvoice(detail, changes) {
        const override = {
            InvoiceDate: changes.InvoiceDate.new,
            PaymentDueDate: changes.PaymentDueDate.new,
            OrderNumber: changes.OrderNumber.new
        };
        const body = detail.entries.map(([k, v]) => {
            const val = (k in override) ? override[k] : v;
            return encodeURIComponent(k) + '=' + encodeURIComponent(val == null ? '' : val);
        }).join('&');
        const r = await fetchWithRetry('/api/PPMInvoice/EditDetail', {
            method: 'POST',
            referrer: location.origin + detail.detailUrl,
            referrerPolicy: 'unsafe-url',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest',
                'Accept': 'application/json, text/html, */*',
                '__RequestVerificationToken': detail.csrf
            },
            body
        });
        const txt = await r.text().catch(() => '');
        if (!r.ok) throw new Error('EditDetail HTTP ' + r.status + ': ' + txt.slice(0, 200));
        let j = {};
        try { j = JSON.parse(txt); } catch (e) {}
        if (j.success === false) throw new Error('EditDetail success=false: ' + (j.Message || txt.slice(0, 200)));
    }

    // =======================================================================
    // UI
    // =======================================================================
    function createUI() {
        if (document.getElementById('jl-ppminv-panel')) return;

        panel = document.createElement('div');
        panel.id = 'jl-ppminv-panel';
        const c = document.createElement('div');
        c.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;background:#1a1a2e;color:#eee;border-radius:8px;padding:16px;width:560px;max-height:88vh;display:flex;flex-direction:column;font-family:monospace;font-size:12px;box-shadow:0 4px 20px rgba(0,0,0,0.5);';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;';
        const title = document.createElement('strong');
        title.style.fontSize = '14px';
        title.innerHTML = 'PPM Invoice Date &amp; Order No Reformatter <span style="font-weight:400;color:#8a8ab5;font-size:11px;">v' + VERSION + '</span>';
        const closeBtn = document.createElement('button');
        closeBtn.style.cssText = 'background:none;border:none;color:#eee;font-size:18px;cursor:pointer;';
        closeBtn.textContent = '✕';
        closeBtn.addEventListener('click', () => { panel.style.display = 'none'; });
        header.appendChild(title); header.appendChild(closeBtn);

        const rules = document.createElement('div');
        rules.style.cssText = 'background:#12122a;border-left:3px solid #8a5cf6;border-radius:4px;padding:8px 10px;margin-bottom:8px;line-height:1.5;color:#cbd;';
        rules.innerHTML = 'For every <b>DRAFT</b> invoice, anchored to its line service month M ' +
            '(e.g. "Invoice (01/07/2026 - 31/07/2026)" → July):<br>' +
            '• <b>Date to Raise</b> → 15th of the month <i>before</i> M (July → 15/06)<br>' +
            '• <b>Payment Due</b> → 30 days after the Date to Raise (15/06 → 15/07)<br>' +
            '• <b>Customer Order No</b> → overwritten as <b>PPM - {MMMYY} | {ref} - {SITE}</b><br>' +
            '&nbsp;&nbsp;&nbsp;e.g. "PPM - JUL26 | SCON-00021244 - 1MARKS" ({SITE} = first 6 non-blank chars of Site Name)<br>' +
            '<span style="color:#8fd;">Safe to re-run — results are stable.</span>';

        const lbl = document.createElement('div');
        lbl.style.cssText = 'color:#aaa;margin-bottom:4px;';
        lbl.textContent = 'PPM Contract numbers (one per line — PM numbers, or paste contract URLs):';

        contractInput = document.createElement('textarea');
        contractInput.rows = 5;
        contractInput.placeholder = 'PM0001725\nPM0001726\n…';
        contractInput.style.cssText = 'width:100%;box-sizing:border-box;background:#0a0a1a;color:#eee;border:1px solid #555;border-radius:4px;padding:8px;font-family:monospace;font-size:12px;resize:vertical;margin-bottom:8px;';

        const refLbl = document.createElement('div');
        refLbl.style.cssText = 'color:#aaa;margin-bottom:4px;';
        refLbl.textContent = 'Order-number reference (the "SCON-00021244" part — used for every invoice this run):';
        refInput = document.createElement('input');
        refInput.type = 'text';
        refInput.placeholder = 'SCON-00021244';
        refInput.style.cssText = 'width:100%;box-sizing:border-box;background:#0a0a1a;color:#eee;border:1px solid #555;border-radius:4px;padding:8px;font-family:monospace;font-size:12px;margin-bottom:8px;';

        const controls = document.createElement('div');
        controls.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap;';

        previewBtn = mkBtn('Preview (dry run)', '#08a');
        previewBtn.addEventListener('click', () => run(true));
        runBtn = mkBtn('Apply changes', '#0a8');
        runBtn.disabled = true; runBtn.style.opacity = '0.5';
        runBtn.addEventListener('click', () => run(false));
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
        progressText.textContent = 'Paste contract numbers, then Preview.';
        progressDiv.appendChild(progressText);

        logArea = document.createElement('div');
        logArea.style.cssText = 'flex:1;overflow:auto;background:#0a0a1a;padding:8px;border-radius:4px;max-height:52vh;white-space:pre-wrap;word-break:break-word;';

        c.appendChild(header);
        c.appendChild(rules);
        c.appendChild(lbl);
        c.appendChild(contractInput);
        c.appendChild(refLbl);
        c.appendChild(refInput);
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

    function parseContracts(text) {
        const out = [];
        const seen = new Set();
        text.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean).forEach(tok => {
            let term = tok;
            const g = tok.match(GUID_RE);
            if (g) term = g[0];                                   // a URL / raw GUID
            else { const pm = tok.match(/PM\s*0*\d+/i); if (pm) term = pm[0].replace(/\s+/g, ''); }
            const key = term.toLowerCase();
            if (!seen.has(key)) { seen.add(key); out.push(term); }
        });
        return out;
    }

    // =======================================================================
    // Main
    // =======================================================================
    async function run(dryRun) {
        if (running) return;
        const terms = parseContracts(contractInput.value);
        if (!terms.length) { alert('Paste at least one PPM contract number.'); return; }
        const ref = refInput.value.trim();
        if (!ref) { alert('Enter the order-number reference (the "SCON-00021244" part) first.'); refInput.focus(); return; }

        running = true;
        previewBtn.disabled = runBtn.disabled = true;
        previewBtn.style.opacity = runBtn.style.opacity = '0.5';
        stopBtn.style.display = 'inline-block';
        logArea.innerHTML = '';
        log(dryRun ? '=== PREVIEW (dry run) — no changes will be made ===' : '=== APPLYING CHANGES ===', dryRun ? '#ff0' : '#f66');
        log(terms.length + ' contract(s): ' + terms.join(', '), '#0af');
        log('Order-number reference: "' + ref + '"  →  PPM - {MMMYY} | ' + ref + ' - {SITE}', '#0af');
        log('');

        const stats = { contracts: 0, invoices: 0, changed: 0, applied: 0, skipped: 0, errors: 0 };
        const builtPlan = [];

        for (let ci = 0; ci < terms.length; ci++) {
            if (!running) { log('Stopped by user.', '#f55'); break; }
            const term = terms[ci];
            setProgress('Contract ' + (ci + 1) + '/' + terms.length + ': ' + term);

            let contract;
            try {
                if (GUID_RE.test(term)) contract = { cid: term, number: term.slice(0, 8) + '…', planRef: '', site: '' };
                else contract = await resolveContract(term);
            } catch (e) { log('✗ ' + term + ' — lookup failed: ' + e.message, '#f55'); stats.errors++; continue; }

            if (!contract) { log('✗ ' + term + ' — no matching PPM contract found.', '#f55'); stats.errors++; continue; }
            stats.contracts++;
            log('▸ ' + contract.number + '  ' + (contract.planRef || '') + (contract.site ? '  · ' + contract.site : ''), '#fff');
            if (contract.ambiguous) log('  ! "' + term + '" was not an exact match — used first result. Check this is right.', '#fb0');

            let invoices;
            try { invoices = await getDraftInvoices(contract.cid); }
            catch (e) { log('  ✗ could not list invoices: ' + e.message, '#f55'); stats.errors++; continue; }

            if (!invoices.length) { log('  (no draft invoices)', '#888'); await sleep(DELAY_BETWEEN_CONTRACTS); continue; }
            log('  ' + invoices.length + ' draft invoice(s):', '#0af');

            const contractPlan = { contract, invoices: [] };

            for (let ii = 0; ii < invoices.length; ii++) {
                if (!running) break;
                const row = invoices[ii];
                stats.invoices++;
                const tag = row.InvoiceNumber && row.InvoiceNumber !== 'Draft' ? row.InvoiceNumber : ('draft ' + (ii + 1));

                let detail;
                try { detail = await fetchDetail(row.UniqueId); }
                catch (e) { log('    ✗ ' + tag + ' — could not read invoice: ' + e.message, '#f55'); stats.errors++; await sleep(DELAY_BETWEEN_INVOICES); continue; }

                const { changes, warnings, changed, skip, serviceLabel } = computeChanges(detail, ref, row.SiteName);
                warnings.forEach(w => log('      ! ' + tag + ': ' + w, '#fb0'));
                if (skip) { stats.errors++; continue; }

                const rl = changes.InvoiceDate.old + '→' + changes.InvoiceDate.new;
                const dl = changes.PaymentDueDate.old + '→' + changes.PaymentDueDate.new;
                const po = '"' + changes.OrderNumber.old + '" → "' + changes.OrderNumber.new + '"';

                if (!changed) { log('    · ' + tag + '  [' + serviceLabel + '] — already correct, skipping', '#888'); stats.skipped++; await sleep(150); continue; }
                stats.changed++;
                log('    • ' + tag + '  [' + serviceLabel + ']', '#9cf');
                log('        Raise:   ' + rl, '#bcd');
                log('        Due:     ' + dl, '#bcd');
                log('        OrderNo: ' + po, '#bcd');
                contractPlan.invoices.push({ gid: row.UniqueId, tag });

                if (dryRun) {
                    await sleep(150);
                } else {
                    try {
                        await applyInvoice(detail, changes);
                        log('        ✓ saved', '#0fa');
                        stats.applied++;
                    } catch (e) {
                        log('        ✗ ' + e.message, '#f55');
                        stats.errors++;
                    }
                    await sleep(DELAY_BETWEEN_INVOICES);
                }
            }
            builtPlan.push(contractPlan);
            await sleep(DELAY_BETWEEN_CONTRACTS);
        }

        log('');
        log('===== SUMMARY =====', '#0af');
        log('Contracts matched: ' + stats.contracts, '#ccc');
        log('Draft invoices seen: ' + stats.invoices, '#ccc');
        log('Needing changes: ' + stats.changed, '#9cf');
        log('Already correct (skipped): ' + stats.skipped, '#888');
        if (!dryRun) log('Applied: ' + stats.applied, '#0fa');
        log('Errors: ' + stats.errors, stats.errors ? '#f55' : '#888');

        if (dryRun && stats.changed > 0) {
            plan = builtPlan;
            runBtn.disabled = false; runBtn.style.opacity = '1';
            setProgress('Preview ready — ' + stats.changed + ' invoice(s) to change. Review, then Apply.');
            log('');
            log('Review the changes above, then click "Apply changes".', '#ff0');
        } else if (dryRun) {
            setProgress('Nothing to change.');
        } else {
            setProgress('Done. Applied ' + stats.applied + ', errors ' + stats.errors + '.');
        }

        running = false;
        previewBtn.disabled = false; previewBtn.style.opacity = '1';
        stopBtn.style.display = 'none';
    }

    // --- BOOT ---
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', createUI);
    else createUI();
})();
