// ==UserScript==
// @name         Joblogic - Project Invoicer (bulk create → approve → email)
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Paste a list of Jobs + PO numbers. For each: creates an invoice against the job, sets the Customer Order Number to "PROJ | PO-XXXX - SITEID" (SITEID auto-derived from the job's site), approves it, then opens the Share→Email composer prefilled with the standard recipients. Default DRY-RUN: composes each email and stops for you to review + Send; tick "Auto-send" to send unattended. Outputs a TSV you can paste straight into Google Sheets. Collapses to a launcher in the shared dock.
// @match        https://go.joblogic.com/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Finance/joblogic-project-invoicer.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Finance/joblogic-project-invoicer.user.js
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

    const SCRIPT_ID = 'project-invoicer';
    const SCRIPT_LABEL = '📧 Project Invoicer';
    const SCRIPT_COLOR = '#0b6e99';
    const SCRIPT_DESC = 'Bulk-invoice Jobs to the customer. Paste "JobNumber <tab> PO" rows; the script creates each invoice, sets the Customer Order Number to "PROJ | PO-XXXX - SITEID", approves it, then opens the email composer with the standard recipients. Dry-run by default (stops at each email for you to Send). Copy the results into Google Sheets when done.';

    // Fixed recipients for every invoice email.
    const RECIPIENTS = [
        'europepayments@wework.com',
        '13428874@mypaperless.co.uk',
        'accounts@up-fm.com',
        'accounts.receivable@up-fm.com',
    ];

    const STATE_KEY = 'jl-project-invoicer-state';
    const DELAY = 500;               // politeness delay between API calls (ms)
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    // --- STATE (persisted across navigations) ---
    function loadState() { try { return JSON.parse(localStorage.getItem(STATE_KEY)); } catch (e) { return null; } }
    function saveState(s) { localStorage.setItem(STATE_KEY, JSON.stringify(s)); }
    function clearState() { localStorage.removeItem(STATE_KEY); }

    // --- UI refs ---
    let panel, inputArea, autoSendCheck, skipEmailCheck, startBtn, stopBtn, resetBtn, copyBtn, nextBtn, logArea, progressText, resultsArea;

    // =======================================================================
    // Helpers
    // =======================================================================
    function getToken() {
        const el = document.querySelector('input[name="__RequestVerificationToken"]');
        return el ? el.value : '';
    }
    function tokenFromHtml(html) {
        const m = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
        return m ? m[1] : '';
    }
    function nowStamp() {
        // DD/MM/YYYY HH:mm — matches Joblogic + pastes cleanly into Google Sheets (en-GB).
        const d = new Date();
        const p = n => String(n).padStart(2, '0');
        return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }
    // SITEID: strip whitespace, first 6 chars, upper. "120 Moorgate"->120MOO, "10 York Road"->10YORK
    function siteIdFrom(siteName) {
        return String(siteName || '').replace(/\s+/g, '').slice(0, 6).toUpperCase();
    }
    // Normalise PO so the reference is always "PO-<number>" regardless of how it was pasted.
    function formatPO(raw) {
        const cleaned = String(raw || '').trim().replace(/^PO[-\s:]*/i, '');
        return 'PO-' + cleaned;
    }
    function buildReference(po, siteId) {
        return `PROJ | ${formatPO(po)} - ${siteId}`;
    }

    async function fetchText(url) {
        const r = await fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
        return r.text();
    }

    // =======================================================================
    // API: resolve / create / set order number / approve
    // =======================================================================
    async function resolveJob(jobNumber) {
        const r = await fetch('/api/Job/SearchJsonData', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', '__RequestVerificationToken': getToken() },
            body: JSON.stringify({ SearchTerm: jobNumber, PageSize: 10, PageIndex: 1, EngineerType: 0, IncludePPMJobs: true, IncludeReactiveJobs: true }),
        });
        if (!r.ok) throw new Error('SearchJsonData HTTP ' + r.status);
        const j = await r.json();
        const jobs = (j.AdditionalData && j.AdditionalData.Jobs) || [];
        if (!jobs.length) throw new Error('Job not found: "' + jobNumber + '"');
        // Prefer an exact JobNumber match; else take the first hit.
        const exact = jobs.find(x => String(x.JobNumber).toLowerCase() === jobNumber.toLowerCase());
        const job = exact || jobs[0];
        return { jobId: job.Id, jobNumber: job.JobNumber, siteName: job.SiteName || '' };
    }

    async function createInvoice(jobId) {
        const r = await fetch('/Invoice/Create?jobId=' + encodeURIComponent(jobId), {
            method: 'GET', credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' },
        });
        const txt = await r.text();
        let json = null; try { json = JSON.parse(txt); } catch (e) {}
        if (json && json.success === false) throw new Error('Create failed: ' + (json.Message || (json.errors || []).join('; ')));
        const url = (json && json.redirectUrl) || r.url || '';
        const m = String(url).match(/\/Invoice\/Detail\/(\d+)/);
        if (!m) throw new Error('Could not read new invoice id from create response');
        return m[1];
    }

    // Set the Customer Order Number via the InvoiceDetailForm (POST /api/Invoice).
    async function setOrderNumber(invoiceId, reference) {
        const html = await fetchText('/Invoice/Detail/' + invoiceId);
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const form = doc.getElementById('InvoiceDetailForm');
        if (!form) throw new Error('InvoiceDetailForm not found on invoice ' + invoiceId);
        const token = (form.querySelector('input[name="__RequestVerificationToken"]') || {}).value || tokenFromHtml(html);
        const entries = [...form.querySelectorAll('[name]')].map(el => {
            let v = el.type === 'checkbox' ? (el.checked ? 'true' : 'false') : (el.value || '');
            if (el.name === 'OrderNumber') v = reference;
            return [el.name, v];
        });
        if (!entries.some(([k]) => k === 'OrderNumber')) entries.push(['OrderNumber', reference]);
        const body = entries.map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
        const r = await fetch('/api/Invoice', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', '__RequestVerificationToken': token },
            body,
        });
        const txt = await r.text();
        let json = {}; try { json = JSON.parse(txt); } catch (e) {}
        if (!r.ok || json.success === false) throw new Error('Set order number failed: ' + (json.Message || (json.errors || []).join('; ') || ('HTTP ' + r.status)));
        // Read back the invoice number (if now shown) for the output.
        return readInvoiceNumber(doc) || '';
    }

    function readInvoiceNumber(doc) {
        // Try a few likely spots; a draft may not have a number yet.
        const cand = doc.querySelector('[data-invoice-number], .invoice-number, #InvoiceNumber');
        if (cand) return (cand.value || cand.textContent || '').trim();
        const m = (doc.title || '').match(/Invoice\s*[-#]?\s*([A-Z0-9\/-]+)/i);
        return m ? m[1] : '';
    }

    async function approveInvoice(invoiceId) {
        const r = await fetch('/api/Invoice/Approve/' + invoiceId, {
            method: 'POST', credentials: 'same-origin',
            headers: { 'X-Requested-With': 'XMLHttpRequest', '__RequestVerificationToken': getToken() },
        });
        const txt = await r.text();
        let json = {}; try { json = JSON.parse(txt); } catch (e) {}
        if (!r.ok || json.success === false) throw new Error('Approve failed: ' + (json.Message || (json.errors || []).join('; ') || ('HTTP ' + r.status)));
        return true;
    }

    // =======================================================================
    // PREP PHASE — create + set order number + approve, all via API (no nav)
    // =======================================================================
    function parseRows(text) {
        const rows = [];
        text.split(/\r?\n/).forEach(line => {
            const t = line.trim();
            if (!t) return;
            const parts = t.split(/\t|,|\s{2,}|\s*\|\s*/).map(x => x.trim()).filter(Boolean);
            if (parts.length < 2) { rows.push({ jobNumber: parts[0] || t, po: '', bad: true }); return; }
            rows.push({ jobNumber: parts[0], po: parts[1] });
        });
        return rows;
    }

    async function runPrep() {
        const s = loadState();
        for (let i = 0; i < s.jobs.length; i++) {
            if (!loadState() || !loadState().running) { log('Stopped.', '#f55'); return; }
            const job = s.jobs[i];
            if (job.prepStatus === 'approved') continue; // resume-safe
            setProgress(`Preparing ${i + 1}/${s.jobs.length}: ${job.jobNumber}`);
            try {
                if (job.bad) throw new Error('Row needs Job number AND PO');
                // 1. resolve
                const info = await resolveJob(job.jobNumber);
                job.jobId = info.jobId;
                job.jobNumber = info.jobNumber;
                job.siteName = info.siteName;
                job.siteId = siteIdFrom(info.siteName);
                job.reference = buildReference(job.po, job.siteId);
                log(`[${i + 1}] ${job.jobNumber} → site "${job.siteName}" (${job.siteId}) | ${job.reference}`, '#0af');
                await sleep(DELAY);
                // 2. create
                job.invoiceId = await createInvoice(job.jobId);
                log(`    created invoice #${job.invoiceId}`, '#8fd');
                await sleep(DELAY);
                // 3. set order number
                job.invoiceNumber = await setOrderNumber(job.invoiceId, job.reference);
                log(`    order number set`, '#8fd');
                await sleep(DELAY);
                // 4. approve
                await approveInvoice(job.invoiceId);
                job.prepStatus = 'approved';
                job.emailStatus = 'pending';
                log(`    ✓ approved`, '#0fa');
            } catch (e) {
                job.prepStatus = 'error';
                job.error = e.message;
                log(`    ✗ ${job.jobNumber}: ${e.message}`, '#f55');
            }
            saveState(s);
            renderResults(s);
            await sleep(DELAY);
        }
    }

    // =======================================================================
    // EMAIL PHASE — drive the real Share→Email modal on each invoice page
    // =======================================================================
    function waitFor(fn, timeout = 12000, interval = 200) {
        return new Promise((resolve, reject) => {
            const t0 = Date.now();
            (function poll() {
                let v; try { v = fn(); } catch (e) { v = null; }
                if (v) return resolve(v);
                if (Date.now() - t0 > timeout) return reject(new Error('timeout waiting for element'));
                setTimeout(poll, interval);
            })();
        });
    }

    function nativeSet(el, value) {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Open the invoice email composer. Returns when the modal + recipient box exist.
    async function openEmailModal(invoiceId) {
        // Prefer the page's own handler; fall back to clicking the menu item.
        if (typeof window.onClickShareEmail === 'function') {
            window.onClickShareEmail('/Invoice/Email/' + invoiceId);
        } else {
            const btn = document.getElementById('emailButton') ||
                [...document.querySelectorAll('a,button')].find(b => /^\s*Email\s*$/.test((b.innerText || '').trim()));
            if (!btn) throw new Error('Email button not found');
            btn.click();
        }
        return waitFor(() => {
            const modal = document.getElementById('emailInvoice_modal');
            if (!modal) return null;
            const box = modal.querySelector('.email-dropdownlist, .v-select');
            const send = document.getElementById('sendEmailButton');
            return (box && send) ? { modal, box, send } : null;
        });
    }

    // Replace the recipient tokens in the vue-select with our fixed list.
    async function setRecipients(ui, emails) {
        const box = ui.box;
        // 1. Remove any pre-filled recipient tokens.
        box.querySelectorAll('.vs__deselect').forEach(x => x.click());
        await sleep(150);
        // 2. Add each email by typing it into the search box + Enter (vue-select "create tag").
        const search = box.querySelector('input.vs__search, input[type="search"], input');
        for (const email of emails) {
            if (search) {
                search.focus();
                nativeSet(search, email);
                await sleep(120);
                ['keydown', 'keypress', 'keyup'].forEach(type =>
                    search.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })));
                await sleep(180);
            }
        }
        // 3. Belt-and-braces: also set the hidden EmailAddress field the server reads.
        const hidden = document.getElementById('EmailAddress');
        if (hidden) nativeSet(hidden, emails.join(';'));
        const valid = document.getElementById('validEmailAddress');
        if (valid) nativeSet(valid, 'true');
        await sleep(150);
        // Report what tokens are actually present so the log is honest.
        const tokens = [...box.querySelectorAll('.vs__selected')].map(t => t.innerText.replace(/\s*×\s*$/, '').trim()).filter(Boolean);
        return tokens;
    }

    async function runEmailStep(job, autoSend) {
        const ui = await openEmailModal(job.invoiceId);
        const tokens = await setRecipients(ui, RECIPIENTS);
        const missing = RECIPIENTS.filter(r => !tokens.some(t => t.toLowerCase() === r.toLowerCase()));
        if (missing.length) log(`    ⚠ recipients not auto-added: ${missing.join(', ')} — add them before sending`, '#fd0');
        else log(`    recipients set: ${tokens.length}`, '#8fd');

        if (autoSend && !missing.length) {
            ui.send.click();
            // Give the send a moment; success usually closes the modal.
            await waitFor(() => !document.getElementById('emailInvoice_modal') || document.getElementById('emailInvoice_modal').offsetParent === null, 15000).catch(() => {});
            return { sent: true };
        }
        return { sent: false, missing };
    }

    // Boot-time resume of the email phase (runs after each navigation).
    async function resumeEmailPhase() {
        const s = loadState();
        if (!s || !s.running || s.phase !== 'email') return;
        const job = emailQueue(s)[s.emailIdx];
        if (!job) { finishRun(s); return; }
        const m = location.pathname.match(/\/Invoice\/Detail\/(\d+)/);
        if (!m || m[1] !== String(job.invoiceId)) {
            // Not on the right page yet — navigate there.
            setProgress(`Emailing ${s.emailIdx + 1}/${emailQueue(s).length}: opening invoice #${job.invoiceId}`);
            location.href = '/Invoice/Detail/' + job.invoiceId;
            return;
        }
        // We're on the right invoice — compose the email.
        try {
            log(`Email ${s.emailIdx + 1}/${emailQueue(s).length}: ${job.jobNumber} (invoice #${job.invoiceId})`, '#0af');
            const res = await runEmailStep(job, s.autoSend);
            if (res.sent) {
                job.emailStatus = 'sent';
                job.sentAt = nowStamp();
                log(`    ✓ sent`, '#0fa');
                saveState(s);
                renderResults(s);
                advanceEmail();
            } else {
                job.emailStatus = 'composed';
                saveState(s);
                renderResults(s);
                setProgress(`Review invoice #${job.invoiceId}, click Send, then press "Sent → Next".`);
                showNextButton(true);
            }
        } catch (e) {
            job.emailStatus = 'error';
            job.error = (job.error ? job.error + ' | ' : '') + 'Email: ' + e.message;
            log(`    ✗ email: ${e.message}`, '#f55');
            saveState(s);
            renderResults(s);
            setProgress(`Email failed for #${job.invoiceId}. Fix manually, then press "Sent → Next" to continue.`);
            showNextButton(true);
        }
    }

    function emailQueue(s) { return s.jobs.filter(j => j.prepStatus === 'approved'); }

    function advanceEmail() {
        const s = loadState();
        if (!s) return;
        // Mark current as sent if the user pressed Next after a manual send.
        const q = emailQueue(s);
        const cur = q[s.emailIdx];
        if (cur && cur.emailStatus === 'composed') { cur.emailStatus = 'sent'; cur.sentAt = nowStamp(); }
        s.emailIdx += 1;
        saveState(s);
        showNextButton(false);
        if (s.emailIdx >= q.length) { finishRun(s); return; }
        const next = q[s.emailIdx];
        location.href = '/Invoice/Detail/' + next.invoiceId;
    }

    function finishRun(s) {
        s.running = false;
        s.phase = 'done';
        saveState(s);
        renderResults(s);
        showNextButton(false);
        const sent = s.jobs.filter(j => j.emailStatus === 'sent').length;
        const errs = s.jobs.filter(j => j.prepStatus === 'error' || j.emailStatus === 'error').length;
        setProgress(`Done. ${sent} emailed, ${errs} error(s). Copy the results into Google Sheets.`);
        log('===== FINISHED =====', '#0af');
        setRunningUI(false);
    }

    // =======================================================================
    // Start
    // =======================================================================
    async function start() {
        const existing = loadState();
        if (existing && existing.running) { alert('A run is already in progress. Use Stop or Reset first.'); return; }

        const rows = parseRows(inputArea.value);
        if (!rows.length) { alert('Paste at least one "JobNumber <tab> PO" row.'); return; }

        const s = {
            running: true,
            autoSend: autoSendCheck.checked,
            skipEmail: skipEmailCheck.checked,
            phase: 'prep',
            emailIdx: 0,
            jobs: rows.map(r => ({
                jobNumber: r.jobNumber, po: r.po, bad: !!r.bad,
                jobId: null, siteName: '', siteId: '', reference: '',
                invoiceId: null, invoiceNumber: '',
                prepStatus: 'pending', emailStatus: '', sentAt: '', error: '',
            })),
        };
        saveState(s);
        logArea.innerHTML = '';
        setRunningUI(true);
        log(s.autoSend ? 'AUTO-SEND is ON — emails will be sent without pausing.' : 'DRY-RUN — each email will be composed and paused for your review.', s.autoSend ? '#f80' : '#ff0');
        if (s.skipEmail) log('SKIP EMAIL is ON — invoices will be created & approved only.', '#ff0');

        await runPrep();

        const s2 = loadState();
        if (!s2 || !s2.running) return; // stopped
        const q = emailQueue(s2);
        if (s2.skipEmail || !q.length) {
            finishRun(s2);
            return;
        }
        // Move to email phase — navigate to first approved invoice.
        s2.phase = 'email';
        s2.emailIdx = 0;
        saveState(s2);
        setProgress(`Prep done. Emailing ${q.length} invoice(s)...`);
        location.href = '/Invoice/Detail/' + q[0].invoiceId;
    }

    function stopRun() {
        const s = loadState();
        if (s) { s.running = false; saveState(s); }
        setRunningUI(false);
        setProgress('Stopped. Reset to start over, or Start to resume prep.');
    }

    function resetRun() {
        if (!confirm('Clear the current run and all results?')) return;
        clearState();
        if (logArea) logArea.innerHTML = '';
        if (resultsArea) resultsArea.value = '';
        setRunningUI(false);
        setProgress('Ready. Paste "JobNumber <tab> PO" rows and click Start.');
    }

    // =======================================================================
    // Output — TSV for Google Sheets
    // =======================================================================
    const TSV_HEADERS = ['Job Number', 'PO', 'Site', 'SITEID', 'Customer Order No', 'Invoice ID', 'Invoice No', 'Status', 'Sent At', 'Error'];
    function toTSV(s) {
        const lines = [TSV_HEADERS.join('\t')];
        s.jobs.forEach(j => {
            const status = j.prepStatus === 'error' ? 'ERROR (prep)'
                : j.emailStatus === 'sent' ? 'Sent'
                : j.emailStatus === 'composed' ? 'Composed (not sent)'
                : j.emailStatus === 'error' ? 'ERROR (email)'
                : j.prepStatus === 'approved' ? 'Approved' : 'Pending';
            lines.push([
                j.jobNumber, formatPO(j.po), j.siteName, j.siteId, j.reference,
                j.invoiceId || '', j.invoiceNumber || '', status, j.sentAt || '', j.error || '',
            ].map(x => String(x == null ? '' : x).replace(/\t/g, ' ').replace(/\r?\n/g, ' ')).join('\t'));
        });
        return lines.join('\n');
    }
    function renderResults(s) {
        if (resultsArea) resultsArea.value = toTSV(s);
    }

    // =======================================================================
    // UI
    // =======================================================================
    function createUI() {
        if (document.getElementById('jl-projinv-panel')) return;

        panel = document.createElement('div');
        panel.id = 'jl-projinv-panel';
        const c = document.createElement('div');
        c.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;background:#1a1a2e;color:#eee;border-radius:8px;padding:16px;width:560px;max-height:90vh;display:flex;flex-direction:column;font-family:monospace;font-size:12px;box-shadow:0 4px 20px rgba(0,0,0,0.5);';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;';
        const title = document.createElement('strong');
        title.style.fontSize = '14px';
        title.textContent = 'Project Invoicer';
        const closeBtn = document.createElement('button');
        closeBtn.style.cssText = 'background:none;border:none;color:#eee;font-size:18px;cursor:pointer;';
        closeBtn.textContent = 'X';
        closeBtn.addEventListener('click', () => { panel.style.display = 'none'; });
        header.appendChild(title); header.appendChild(closeBtn);

        const help = document.createElement('div');
        help.style.cssText = 'color:#9fb;margin-bottom:8px;line-height:1.4;';
        help.innerHTML = 'Paste one row per job: <b>Job Number</b> then a tab (or comma) then <b>PO number</b>.<br>Ref becomes <b>PROJ | PO-XXXX - SITEID</b> (SITEID = first 6 letters of the site, no spaces).';

        inputArea = document.createElement('textarea');
        inputArea.placeholder = 'PM0000579/001\tPO-01041292\nPM0000580/001\tPO-01041293';
        inputArea.style.cssText = 'width:100%;height:110px;box-sizing:border-box;background:#0a0a1a;color:#eee;border:1px solid #555;border-radius:4px;padding:8px;font-family:monospace;font-size:12px;margin-bottom:8px;';

        // Options row
        const opts = document.createElement('div');
        opts.style.cssText = 'display:flex;gap:16px;align-items:center;margin-bottom:8px;flex-wrap:wrap;';
        const mkCheck = (labelText, title) => {
            const l = document.createElement('label'); l.style.cssText = 'cursor:pointer;'; l.title = title || '';
            const cb = document.createElement('input'); cb.type = 'checkbox';
            l.appendChild(cb); l.appendChild(document.createTextNode(' ' + labelText));
            return { l, cb };
        };
        const a = mkCheck('Auto-send emails', 'When off (default), the script composes each email and stops so you can review and click Send yourself.');
        autoSendCheck = a.cb;
        const sk = mkCheck('Skip email (create + approve only)', 'Create and approve the invoices but do not open the email composer.');
        skipEmailCheck = sk.cb;
        opts.appendChild(a.l); opts.appendChild(sk.l);

        // Controls
        const ctl = document.createElement('div');
        ctl.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap;';
        startBtn = mkBtn('Start', '#0a8'); startBtn.addEventListener('click', start);
        stopBtn = mkBtn('Stop', '#a22'); stopBtn.style.display = 'none'; stopBtn.addEventListener('click', stopRun);
        nextBtn = mkBtn('Sent → Next ▶', '#c60'); nextBtn.style.display = 'none'; nextBtn.addEventListener('click', () => advanceEmail());
        resetBtn = mkBtn('Reset', '#555'); resetBtn.addEventListener('click', resetRun);
        ctl.appendChild(startBtn); ctl.appendChild(stopBtn); ctl.appendChild(nextBtn); ctl.appendChild(resetBtn);

        // Progress
        const pd = document.createElement('div');
        pd.style.cssText = 'margin-bottom:6px;';
        progressText = document.createElement('span');
        progressText.style.color = '#0fa';
        progressText.textContent = 'Ready. Paste "JobNumber <tab> PO" rows and click Start.';
        pd.appendChild(progressText);

        // Log
        logArea = document.createElement('div');
        logArea.style.cssText = 'flex:1;overflow-y:auto;background:#0a0a1a;padding:8px;border-radius:4px;max-height:34vh;min-height:80px;margin-bottom:8px;';

        // Results (TSV)
        const rHead = document.createElement('div');
        rHead.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;';
        const rLabel = document.createElement('span'); rLabel.textContent = 'Results (paste into Google Sheets):'; rLabel.style.color = '#aaa';
        copyBtn = mkBtn('Copy', '#08a');
        copyBtn.addEventListener('click', () => {
            resultsArea.select();
            navigator.clipboard.writeText(resultsArea.value).then(() => { copyBtn.textContent = 'Copied!'; setTimeout(() => copyBtn.textContent = 'Copy', 1200); }).catch(() => { document.execCommand('copy'); });
        });
        rHead.appendChild(rLabel); rHead.appendChild(copyBtn);
        resultsArea = document.createElement('textarea');
        resultsArea.readOnly = true;
        resultsArea.style.cssText = 'width:100%;height:90px;box-sizing:border-box;background:#0a0a1a;color:#9fd;border:1px solid #555;border-radius:4px;padding:8px;font-family:monospace;font-size:11px;';

        c.appendChild(header); c.appendChild(help); c.appendChild(inputArea);
        c.appendChild(opts); c.appendChild(ctl); c.appendChild(pd);
        c.appendChild(logArea); c.appendChild(rHead); c.appendChild(resultsArea);
        panel.appendChild(c);
        document.body.appendChild(panel);
        jlRegisterPanel(panel, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR, SCRIPT_DESC);

        // Restore prior run into the panel.
        const s = loadState();
        if (s) {
            renderResults(s);
            if (s.running) setRunningUI(true);
        }
    }

    function mkBtn(text, color) {
        const b = document.createElement('button');
        b.textContent = text;
        b.style.cssText = `background:${color};color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;`;
        return b;
    }
    function log(msg, color) {
        if (!logArea) return;
        const line = document.createElement('div');
        line.style.color = color || '#ccc';
        line.style.whiteSpace = 'pre-wrap';
        line.style.wordBreak = 'break-word';
        line.textContent = msg;
        logArea.appendChild(line);
        logArea.scrollTop = logArea.scrollHeight;
    }
    const setProgress = (m) => { if (progressText) progressText.textContent = m; };
    function setRunningUI(running) {
        if (!startBtn) return;
        startBtn.style.display = running ? 'none' : 'inline-block';
        stopBtn.style.display = running ? 'inline-block' : 'none';
    }
    function showNextButton(show) { if (nextBtn) nextBtn.style.display = show ? 'inline-block' : 'none'; }

    // --- BOOT ---
    function boot() {
        createUI();
        // Resume the email phase after a navigation.
        const s = loadState();
        if (s && s.running && s.phase === 'email') {
            // Auto-open the panel so the user sees progress.
            if (panel && panel.style.display === 'none') { const btn = document.getElementById('jl-launch-' + SCRIPT_ID); if (btn) btn.click(); }
            setTimeout(resumeEmailPhase, 800);
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
