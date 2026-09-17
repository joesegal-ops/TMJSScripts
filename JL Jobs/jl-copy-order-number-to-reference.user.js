// ==UserScript==
// @name         Joblogic - Copy Customer Order Number to Reference Number
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  On the /Job list page: captures the current search filter, walks every page of results, and copies each job's Customer Order Number (OrderNumber) into its Reference Number field (CustomReference) via the API. Jobs with a blank Order Number are skipped, as are jobs that already match. Optional "only fill blank References" guard, Dry Run by default. Also works on a Customer detail page, where it targets all of that customer's jobs.
// @match        https://go.joblogic.com/*
// @grant        none
// @run-at       document-start
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/jl-copy-order-number-to-reference.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/jl-copy-order-number-to-reference.user.js
// ==/UserScript==

(function () {
    'use strict';

    // =======================================================================
    // Capture the Job list page's own search request (installed at
    // document-start so the initial page-load search is caught too).
    // The page posts JSON to /api/Job/SearchJsonData via axios (XHR).
    // A hand-built body is rejected ("payload is empty") — we must replay
    // the page's own body and only swap PageIndex.
    // =======================================================================
    const capture = { body: null, totalCount: null, pageSize: null, when: null, paused: false, synthetic: false };
    let onCaptureUpdate = null; // set later by the UI

    function noteSearchRequest(body) {
        if (capture.paused || !body) return;
        capture.body = String(body);
        capture.when = new Date();
    }
    function noteSearchResponse(text) {
        if (capture.paused || !text) return;
        try {
            const j = JSON.parse(text);
            const ad = j.AdditionalData || {};
            if (typeof ad.TotalCount === 'number') {
                capture.totalCount = ad.TotalCount;
                capture.pageSize = ad.PageSize || capture.pageSize;
            }
        } catch (e) { /* ignore */ }
        if (onCaptureUpdate) onCaptureUpdate();
    }

    const SEARCH_RE = /\/api\/Job\/SearchJsonData/i;
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
        this.__jlCopyRefUrl = url;
        return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (body) {
        try {
            if (SEARCH_RE.test(this.__jlCopyRefUrl || '')) {
                noteSearchRequest(body);
                this.addEventListener('load', () => {
                    try { noteSearchResponse(this.responseText); } catch (e) {}
                });
            }
        } catch (e) { /* never break the page */ }
        return origSend.apply(this, arguments);
    };
    const origFetch = window.fetch;
    window.fetch = function (input, init) {
        let url = '';
        try { url = typeof input === 'string' ? input : (input && input.url) || ''; } catch (e) {}
        const isSearch = SEARCH_RE.test(url);
        const selfCall = init && init.headers && init.headers['X-JL-CopyRef'];
        if (isSearch && !selfCall) {
            try { if (init && init.body) noteSearchRequest(init.body); } catch (e) {}
            return origFetch.apply(this, arguments).then(resp => {
                try { resp.clone().text().then(noteSearchResponse).catch(() => {}); } catch (e) {}
                return resp;
            });
        }
        return origFetch.apply(this, arguments);
    };

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
    const SCRIPT_ID = 'copy-order-to-reference';
    const SCRIPT_LABEL = '🔁 Order No → Reference';
    const SCRIPT_COLOR = '#7a4a1f';
    const SCRIPT_DESC = 'Copies the Customer Order Number into the Reference Number on EVERY job matching the current view (all pages). On the Jobs list: apply your filter and click Search first. On a Customer page: targets all of that customer\'s jobs. Jobs with a blank Order Number are skipped. Dry Run first!';

    // --- CONFIG ---
    // Job detail field labels (verified on a live /Job/Detail page):
    //   "Customer Order Number" = OrderNumber            <- source
    //   "Reference Number"      = CustomReference        <- destination
    //   "Job Ref 1"             = JobUserReferenceFieldValue (untouched)
    const SOURCE_FIELD = 'OrderNumber';
    const TARGET_FIELD = 'CustomReference';

    // go.joblogic.com sits behind an Azure App Gateway WAF that rate-limits per
    // IP. 1400ms (~43 req/min) is the measured-safe pacing; it is a token
    // bucket, not a lockout, so retries can be short.
    const PACING_OPTIONS = [
        { id: '1400', label: 'Safe — 1400ms (recommended)' },
        { id: '900',  label: 'Brisk — 900ms' },
        { id: '500',  label: 'Fast — 500ms (risks gateway 403s)' }
    ];
    const WAF_BACKOFFS = [1500, 3000, 6000, 12000, 20000];

    // --- STATE ---
    let panel, logArea, startBtn, stopBtn, progressText, dryCheck, blankOnlyCheck, paceSel, captureLine;
    let running = false;
    let currentInterval = 1400;
    let lastRequestAt = 0;

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    // Sleep in slices so Stop stays responsive during a long backoff.
    async function interruptibleSleep(ms) {
        const until = Date.now() + ms;
        while (Date.now() < until && running) await sleep(Math.min(500, until - Date.now()));
    }

    // =======================================================================
    // API helpers (every call goes through jlFetch: throttled + WAF-aware)
    // =======================================================================
    function getCsrf(doc = document) {
        const el = doc.querySelector('input[name="__RequestVerificationToken"]');
        return el ? el.value : '';
    }

    // A gateway block is HTML/Azure-flavoured; a genuine Joblogic 403 is JSON
    // and must be allowed to throw straight away.
    function isWafBlock(resp, text) {
        if (resp.status !== 403 && resp.status !== 429 && resp.status !== 503) return false;
        const server = resp.headers.get('server') || '';
        const ctype = resp.headers.get('content-type') || '';
        return /azure/i.test(server) || /text\/html/i.test(ctype) || /<title>\s*403/i.test(text || '');
    }

    async function throttle() {
        const wait = lastRequestAt + currentInterval - Date.now();
        if (wait > 0) await sleep(wait);
        lastRequestAt = Date.now();
    }

    async function jlFetch(url, opts) {
        const options = Object.assign({ credentials: 'same-origin' }, opts || {});
        for (let attempt = 0; ; attempt++) {
            await throttle();
            const resp = await origFetch(url, options);
            if (resp.ok) return resp;
            const peek = await resp.clone().text().catch(() => '');
            if (isWafBlock(resp, peek) && attempt < WAF_BACKOFFS.length && running) {
                currentInterval = Math.min(4000, currentInterval + 200);
                log(`Gateway rate-limit (HTTP ${resp.status}) — waiting ${WAF_BACKOFFS[attempt]}ms, pacing now ${currentInterval}ms`, '#fa0');
                await interruptibleSleep(WAF_BACKOFFS[attempt]);
                if (!running) return resp;
                continue;
            }
            return resp;
        }
    }

    async function fetchText(url) {
        const resp = await jlFetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        if (!resp.ok) throw new Error('HTTP ' + resp.status + ' on ' + url);
        return resp.text();
    }

    // Replay the captured search body with a different page index.
    async function searchPage(bodyObj, pageIndex) {
        const body = Object.assign({}, bodyObj, { PageIndex: pageIndex });
        const resp = await jlFetch('/api/Job/SearchJsonData', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                '__RequestVerificationToken': getCsrf(),
                'X-JL-CopyRef': '1'
            },
            body: JSON.stringify(body)
        });
        if (!resp.ok) throw new Error('SearchJsonData HTTP ' + resp.status);
        const data = await resp.json();
        const ad = data.AdditionalData || {};
        return { jobs: ad.Jobs || [], totalCount: ad.TotalCount || 0, pageSize: ad.PageSize || (ad.Jobs || []).length };
    }

    // ----- job state extraction: the detail page embeds the job's form state
    // as JSON; find `"Id":<id>` and brace-walk out to the enclosing object.
    function extractJobState(html, internalId) {
        const anchor = `"Id":${internalId}`;
        const i = html.indexOf(anchor);
        if (i < 0) throw new Error('Job state anchor not found in detail page');
        let depth = 0, start = -1;
        for (let p = i; p >= 0; p--) {
            const c = html[p];
            if (c === '}') depth++;
            else if (c === '{') {
                if (depth === 0) { start = p; break; }
                depth--;
            }
        }
        if (start < 0) throw new Error('Job state open brace not found');
        let d = 0, inStr = false, esc = false, end = -1;
        for (let j = start; j < html.length; j++) {
            const c = html[j];
            if (esc) { esc = false; continue; }
            if (c === '\\') { esc = true; continue; }
            if (c === '"') { inStr = !inStr; continue; }
            if (inStr) continue;
            if (c === '{') d++;
            else if (c === '}') { d--; if (d === 0) { end = j + 1; break; } }
        }
        if (end < 0) throw new Error('Job state close brace not found');
        return JSON.parse(html.slice(start, end));
    }

    function currentTagIds(job) {
        const ids = Array.isArray(job.TagIds)
            ? job.TagIds
            : (Array.isArray(job.Tags) ? job.Tags.map(t => t.Id || t.TagId || t) : []);
        return ids.map(String);
    }

    // Post the full job form to /api/Job/EditDetail with `overrides` applied.
    // The field list must be complete — a partial form makes the save misbehave.
    async function postEditDetail(internalId, job, html, overrides, _retry = 0) {
        const tokenMatch = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
        const csrfToken = tokenMatch ? tokenMatch[1] : getCsrf();

        const entries = [];
        const push = (k, v) => entries.push([k, v == null ? '' : String(v)]);
        const val = (key) => (overrides[key] !== undefined ? overrides[key] : job[key]);

        push('Id', job.Id);
        push('AssignedToUserId', job.AssignedToUserId);
        currentTagIds(job).forEach((id, idx) => push(`TagIds[${idx}]`, id));
        push('TradeId', job.TradeId);
        push('IsRecuring', job.IsRecuring);
        push('JobTypeId', job.JobTypeId);
        push('StatusId', job.StatusId);
        push('Description', job.Description);
        push('DateLogged', job.DateLogged);
        push('AppointmentDate', job.AppointmentDate);
        push('TargetCompletionDate', job.TargetCompletionDate);
        push('DateComplete', job.DateComplete);
        push('TargetAttendanceDate', job.TargetAttendanceDate);
        push('NextContactDate', job.NextContactDate);

        const fc = job.JobFaultCode || {};
        push('JobFaultCode[ReportedFaultCodeId]',      fc.ReportedFaultCodeId);
        push('JobFaultCode[ReportedFaultCodeName]',    fc.ReportedFaultCodeName);
        push('JobFaultCode[ReportedSubFaultCodeId]',   fc.ReportedSubFaultCodeId);
        push('JobFaultCode[ReportedSubFaultCodeName]', fc.ReportedSubFaultCodeName);
        push('JobFaultCode[ActualFaultCodeId]',        fc.ActualFaultCodeId);
        push('JobFaultCode[ActualFaultCodeName]',      fc.ActualFaultCodeName);
        push('JobFaultCode[ActualSubFaultCodeId]',     fc.ActualSubFaultCodeId);
        push('JobFaultCode[ActualSubFaultCodeName]',   fc.ActualSubFaultCodeName);

        push('JobCategoryId', job.JobCategoryId);
        push('PriorityId', job.PriorityId);
        push('OrderNumber', val('OrderNumber'));
        push('CustomReference', val('CustomReference'));
        push('IsRequireApproval', job.IsRequireApproval);
        push('CompletionTimeSinceOnSite', job.CompletionTimeSinceOnSite);
        push('JobUserReferenceFieldValue', job.JobUserReferenceFieldValue);
        push('JobUserReferenceDropdownListValue', job.JobUserReferenceDropdownListValue);
        push('CustomerContractId', job.CustomerContractId);
        push('ProjectNumber', job.ProjectNumber);
        push('MilestoneId', job.MilestoneId);
        push('ProjectMilestoneId', job.ProjectMilestoneId);
        push('ProjectId', job.ProjectId);
        push('BaseCurrencyCode', job.BaseCurrencyCode);
        push('BaseCurrencyName', job.BaseCurrencyName);
        push('ToCurrencyCode', job.ToCurrencyCode);
        push('ToCurrencyName', job.ToCurrencyName);
        push('ConversionRate', job.ConversionRate);
        push('ExchangeRateDate', job.ExchangeRateDate);
        push('IsEnabledMultipleCurrencies', job.IsEnabledMultipleCurrencies);
        push('PreferredCurrencyId', job.PreferredCurrencyId);
        push('CustomerId', job.CustomerId);
        push('IsAssociatedCustomer', job.IsAssociatedCustomer);

        const body = entries
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
            .join('&');

        const headers = {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
            'Accept': 'application/json'
        };
        if (csrfToken) headers['__RequestVerificationToken'] = csrfToken;

        const resp = await jlFetch('/api/Job/EditDetail', {
            method: 'POST',
            referrer: `${location.origin}/Job/Detail/${internalId}`,
            referrerPolicy: 'unsafe-url',
            headers,
            body
        });
        const respText = await resp.text().catch(() => '');
        if (!resp.ok) {
            // A 400 here is usually a stale form token — refetch once and retry.
            if (resp.status === 400 && _retry < 1) {
                await sleep(2500);
                const freshHtml = await fetchText('/Job/Detail/' + internalId);
                const freshJob = extractJobState(freshHtml, internalId);
                return postEditDetail(internalId, freshJob, freshHtml, overrides, _retry + 1);
            }
            throw new Error(`EditDetail HTTP ${resp.status}: ${respText.slice(0, 300)}`);
        }
        let json = {};
        try { json = JSON.parse(respText); } catch (_) {}
        if (json.success === false) throw new Error('EditDetail success=false: ' + (json.Message || respText.slice(0, 200)));
        return true;
    }

    // =======================================================================
    // UI
    // =======================================================================
    function createUI() {
        if (document.getElementById('jl-copyref-panel')) return;

        panel = document.createElement('div');
        panel.id = 'jl-copyref-panel';

        const container = document.createElement('div');
        container.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;background:#1a1a2e;color:#eee;border-radius:8px;padding:16px;width:640px;max-height:88vh;display:flex;flex-direction:column;font-family:monospace;font-size:12px;box-shadow:0 4px 20px rgba(0,0,0,0.5);';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;';
        const title = document.createElement('strong');
        title.style.fontSize = '14px';
        title.textContent = `Customer Order Number → Reference Number (v${VERSION})`;
        const closeBtn = document.createElement('button');
        closeBtn.style.cssText = 'background:none;border:none;color:#eee;font-size:18px;cursor:pointer;';
        closeBtn.textContent = '✕';
        closeBtn.addEventListener('click', () => { panel.style.display = 'none'; });
        header.appendChild(title);
        header.appendChild(closeBtn);

        // Captured-filter status line
        captureLine = document.createElement('div');
        captureLine.style.cssText = 'margin-bottom:10px;color:#fa0;';
        captureLine.textContent = 'No search captured yet — set your filters and click Search on the page first.';

        const explain = document.createElement('div');
        explain.style.cssText = 'margin-bottom:10px;color:#9ab;line-height:1.5;';
        explain.textContent = 'For every job in the filtered view: reads "Customer Order Number" and writes it into "Reference Number". Jobs with a blank Order Number, or where the two already match, are skipped.';

        // Options
        const optRow = document.createElement('div');
        optRow.style.cssText = 'display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:10px;';

        const mkCheck = (labelText, checked, titleText) => {
            const l = document.createElement('label');
            l.style.cssText = 'cursor:pointer;';
            if (titleText) l.title = titleText;
            const c = document.createElement('input');
            c.type = 'checkbox';
            c.checked = checked;
            l.appendChild(c);
            l.appendChild(document.createTextNode(' ' + labelText));
            optRow.appendChild(l);
            return c;
        };

        dryCheck = mkCheck('Dry Run', true, 'Preview every change without writing anything.');
        blankOnlyCheck = mkCheck('Only fill blank Reference Numbers', true, 'Leave any job that already has a Reference Number untouched. Uncheck to overwrite existing references.');

        paceSel = document.createElement('select');
        paceSel.style.cssText = 'background:#0a0a1a;color:#eee;border:1px solid #444;border-radius:4px;padding:5px;';
        paceSel.title = 'Request pacing. Joblogic sits behind a gateway that rate-limits per IP — closing spare Joblogic tabs helps too.';
        for (const p of PACING_OPTIONS) {
            const o = document.createElement('option');
            o.value = p.id;
            o.textContent = p.label;
            paceSel.appendChild(o);
        }
        const paceLabel = document.createElement('span');
        paceLabel.textContent = 'Pace:';
        optRow.appendChild(paceLabel);
        optRow.appendChild(paceSel);

        // Controls
        const controlsDiv = document.createElement('div');
        controlsDiv.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;';

        startBtn = document.createElement('button');
        startBtn.style.cssText = 'background:#0a8;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;';
        startBtn.textContent = 'Start';
        startBtn.addEventListener('click', startProcess);

        stopBtn = document.createElement('button');
        stopBtn.style.cssText = 'background:#a22;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;display:none;';
        stopBtn.textContent = 'Stop';
        stopBtn.addEventListener('click', () => { running = false; });

        controlsDiv.appendChild(startBtn);
        controlsDiv.appendChild(stopBtn);

        const progressDiv = document.createElement('div');
        progressDiv.style.marginBottom = '10px';
        progressText = document.createElement('span');
        progressText.style.color = '#0fa';
        progressText.textContent = 'Search the jobs you want, then Start.';
        progressDiv.appendChild(progressText);

        logArea = document.createElement('div');
        logArea.style.cssText = 'flex:1;overflow-y:auto;background:#0a0a1a;padding:8px;border-radius:4px;max-height:55vh;';

        container.appendChild(header);
        container.appendChild(captureLine);
        container.appendChild(explain);
        container.appendChild(optRow);
        container.appendChild(controlsDiv);
        container.appendChild(progressDiv);
        container.appendChild(logArea);
        panel.appendChild(container);
        document.body.appendChild(panel);

        jlRegisterPanel(panel, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR, SCRIPT_DESC);

        onCaptureUpdate = () => {
            if (!capture.body) return;
            const n = capture.totalCount != null ? capture.totalCount : '?';
            captureLine.style.color = '#0fa';
            captureLine.textContent = capture.synthetic
                ? `Targeting all jobs for this customer — ${n} job(s).`
                : `Filter captured ${capture.when ? capture.when.toLocaleTimeString() : ''} — ${n} job(s) match the current search.`;
        };
        onCaptureUpdate();

        // On a Customer page there is no AJAX search to capture (the Jobs tab is
        // server-rendered and pages via ?pageIndex=). Synthesize a filter that
        // targets every job for this customer via the same SearchJsonData backend.
        const custId = customerIdFromUrl();
        if (custId) primeCustomerFilter(custId);
    }

    function customerIdFromUrl() {
        const m = location.pathname.match(/\/Customer\/Detail\/(\d+)/i);
        return m ? m[1] : null;
    }

    async function primeCustomerFilter(custId) {
        const body = {
            SearchTerm: '', PageSize: 50, PageIndex: 1, EngineerType: 0,
            IncludePPMJobs: true, IncludeReactiveJobs: true, CustomerId: custId,
            StartLoggedDate: '', EndLoggedDate: '', StartDate: '', EndDate: '',
            StartCompleteDate: '', EndCompleteDate: '', StartNextContactDate: '', EndNextContactDate: ''
        };
        capture.body = JSON.stringify(body);
        capture.synthetic = true;
        capture.when = new Date();
        capture.paused = true; // never let an unrelated search overwrite the customer filter
        try {
            const page = await searchPage(body, 1);
            capture.totalCount = page.totalCount;
            capture.pageSize = page.pageSize || 50;
        } catch (e) { /* count is best-effort */ }
        if (onCaptureUpdate) onCaptureUpdate();
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
    const setProgress = (msg) => { if (progressText) progressText.textContent = msg; };

    // =======================================================================
    // Main
    // =======================================================================
    async function collectFilteredJobs(bodyObj) {
        const seen = new Set();
        const jobs = [];
        let pageIndex = 1, total = Infinity;
        const pageSize = bodyObj.PageSize || capture.pageSize || 50;
        bodyObj.PageSize = pageSize;
        while (jobs.length < total) {
            if (!running) break;
            setProgress(`Collecting jobs… page ${pageIndex} (${jobs.length}${total !== Infinity ? '/' + total : ''})`);
            const page = await searchPage(bodyObj, pageIndex);
            total = page.totalCount;
            if (!page.jobs.length) break;
            for (const j of page.jobs) {
                if (!seen.has(j.Id)) {
                    seen.add(j.Id);
                    jobs.push({ id: j.Id, jobNumber: j.JobNumber });
                }
            }
            if (pageIndex > Math.ceil(total / pageSize) + 2) break; // safety
            pageIndex++;
        }
        return { jobs, total };
    }

    const clean = (v) => (v == null ? '' : String(v).trim());

    async function startProcess() {
        if (running) return;
        if (!capture.body) {
            log('No search captured. Set your filters and click Search on the page, then try again.', '#f55');
            return;
        }

        let bodyObj;
        try {
            bodyObj = JSON.parse(capture.body);
        } catch (e) {
            log('Captured search body is not JSON — cannot replay it. Click Search on the page and retry.', '#f55');
            return;
        }

        running = true;
        capture.paused = true; // our own replays must not overwrite the capture
        currentInterval = parseInt(paceSel.value, 10) || 1400;
        lastRequestAt = 0;
        startBtn.style.display = 'none';
        stopBtn.style.display = 'inline-block';
        logArea.innerHTML = '';

        const dryRun = dryCheck.checked;
        const blankOnly = blankOnlyCheck.checked;
        log(dryRun ? 'DRY RUN — no changes will be made' : 'LIVE MODE — jobs will be updated', dryRun ? '#ff0' : '#f55');
        log(`Action: Customer Order Number (${SOURCE_FIELD}) → Reference Number (${TARGET_FIELD})`, '#0af');
        log(blankOnly ? 'Guard: only jobs whose Reference Number is currently empty.' : 'Guard: OFF — existing Reference Numbers will be overwritten.', blankOnly ? '#0af' : '#fa0');
        log(`Pacing: ${currentInterval}ms between requests (2 requests per job).`, '#888');
        log('');

        const stats = { updated: 0, noOrder: 0, alreadySame: 0, hasRef: 0, errors: 0 };
        const failed = [];

        try {
            const { jobs, total } = await collectFilteredJobs(bodyObj);
            log(`Collected ${jobs.length} job(s) from the filtered view (server total: ${total}).`, '#0af');

            if (!jobs.length) {
                log('Nothing to do.', '#fa0');
            } else if (!dryRun && !window.confirm(
                `Copy the Customer Order Number into the Reference Number on ${jobs.length} job(s)?\n\n` +
                (blankOnly
                    ? 'Only jobs with an empty Reference Number will be changed.'
                    : 'WARNING: existing Reference Numbers WILL be overwritten.') +
                '\n\nThis cannot be bulk-undone.')) {
                log('Cancelled at confirmation.', '#fa0');
            } else {
                for (let i = 0; i < jobs.length; i++) {
                    if (!running) { log('Stopped by user.', '#f55'); break; }
                    const { id, jobNumber } = jobs[i];
                    const tag = `[${i + 1}/${jobs.length}] ${jobNumber}`;
                    setProgress(`Processing ${i + 1}/${jobs.length}: ${jobNumber}`);

                    try {
                        const html = await fetchText('/Job/Detail/' + id);
                        const job = extractJobState(html, id);
                        const order = clean(job[SOURCE_FIELD]);
                        const ref = clean(job[TARGET_FIELD]);

                        if (!order) {
                            log(`${tag} — no Customer Order Number, skipped`, '#888');
                            stats.noOrder++;
                        } else if (ref === order) {
                            log(`${tag} — already "${order}", skipped`, '#888');
                            stats.alreadySame++;
                        } else if (ref && blankOnly) {
                            log(`${tag} — Reference already set to "${ref}", left alone`, '#888');
                            stats.hasRef++;
                        } else if (dryRun) {
                            log(`${tag} — [DRY] would set Reference "${ref || '(empty)'}" → "${order}"`, '#ff0');
                            stats.updated++;
                        } else {
                            await postEditDetail(id, job, html, { [TARGET_FIELD]: order });
                            log(`${tag} — Reference "${ref || '(empty)'}" → "${order}"`, '#0fa');
                            stats.updated++;
                        }
                    } catch (e) {
                        log(`${tag} — ERROR: ${e.message}`, '#f55');
                        stats.errors++;
                        failed.push(`${jobNumber} (${e.message})`);
                    }
                }

                log('');
                log('===== SUMMARY =====', '#0af');
                log(`${dryRun ? 'Would update' : 'Updated'}: ${stats.updated}`, '#0fa');
                log(`Skipped — blank Customer Order Number: ${stats.noOrder}`, '#888');
                log(`Skipped — Reference already matches: ${stats.alreadySame}`, '#888');
                if (blankOnly) log(`Skipped — Reference already set (guard on): ${stats.hasRef}`, '#888');
                log(`Errors: ${stats.errors}`, stats.errors ? '#f55' : '#888');
                if (failed.length) {
                    log('');
                    log('Failed:', '#f55');
                    failed.forEach(f => log('  ' + f, '#f99'));
                }
                setProgress(`Done. ${stats.updated} ${dryRun ? 'would be ' : ''}updated, ${stats.noOrder + stats.alreadySame + stats.hasRef} skipped, ${stats.errors} errors.`);
                if (!dryRun && stats.updated) log('Refresh the page (or click Search) to see the new References in the grid.', '#0af');
            }
        } catch (e) {
            log('FATAL: ' + e.message, '#f55');
            setProgress('Failed: ' + e.message);
        }

        running = false;
        capture.paused = !!capture.synthetic;
        startBtn.style.display = 'inline-block';
        stopBtn.style.display = 'none';
    }

    // --- BOOT (UI on the Job list page and on Customer detail pages; capture hook runs everywhere) ---
    function boot() {
        const onJobList = /^\/Job\/?$/i.test(location.pathname);
        const onCustomer = /^\/Customer\/Detail\/\d+/i.test(location.pathname);
        if (!onJobList && !onCustomer) return;
        createUI();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
