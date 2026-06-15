// ==UserScript==
// @name         Joblogic - Bulk Update Filtered Jobs
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  On the /Job list page: captures the current search filter, walks every page of results, and bulk-updates Status, Category, Job Type, or Tags (add/remove) on every matching job via the API. Also works on Customer detail pages, where it targets all of that customer's jobs.
// @match        https://go.joblogic.com/*
// @grant        none
// @run-at       document-start
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/joblogic-bulk-update-filtered-jobs.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/joblogic-bulk-update-filtered-jobs.user.js
// ==/UserScript==

(function () {
    'use strict';

    // =======================================================================
    // Capture the Job list page's own search request (installed at
    // document-start so the initial page-load search is caught too).
    // The page posts JSON to /api/Job/SearchJsonData via axios (XHR).
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
        this.__jlBulkUrl = url;
        return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (body) {
        try {
            if (SEARCH_RE.test(this.__jlBulkUrl || '')) {
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
        const selfCall = init && init.headers && init.headers['X-JL-Bulk'];
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

    const SCRIPT_ID = 'bulk-update-filtered';
    const SCRIPT_LABEL = '📋 Bulk Update Filtered Jobs';
    const SCRIPT_COLOR = '#1f4e6b';
    const SCRIPT_DESC = 'Updates Status, Category, Job Type or Tags on EVERY job matching the current view (all pages). On the Jobs list: apply your filter and click Search first. On a Customer page: targets all of that customer\'s jobs automatically. Pick the field + value, then Start. Dry Run first!';

    // --- CONFIG ---
    const DELAY_BETWEEN_JOBS = 400;
    const DELAY_BETWEEN_PAGES = 250;
    // Filter pseudo-entries in the status dropdown ("All Jobs"/"All Open"/"All Closed")
    const STATUS_PSEUDO_VALUES = ['0', '-1', '-2'];

    const FIELDS = {
        status:    { label: 'Status',         jobKey: 'StatusId' },
        category:  { label: 'Job Category',   jobKey: 'JobCategoryId' },
        jobtype:   { label: 'Job Type',       jobKey: 'JobTypeId' },
        addtag:    { label: 'Add Tag',        jobKey: 'TagIds' },
        removetag: { label: 'Remove Tag',     jobKey: 'TagIds' }
    };

    // --- STATE ---
    let panel, logArea, startBtn, stopBtn, progressText, dryCheck, fieldSel, valueSel, captureLine, reloadBtn;
    let running = false;
    const optionCache = {}; // fieldKind -> [{id, label}]

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    // =======================================================================
    // API helpers
    // =======================================================================
    function getCsrf(doc = document) {
        const el = doc.querySelector('input[name="__RequestVerificationToken"]');
        return el ? el.value : '';
    }

    async function apiGet(url) {
        const resp = await origFetch(url, {
            credentials: 'same-origin',
            headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' }
        });
        if (!resp.ok) throw new Error('HTTP ' + resp.status + ' on ' + url);
        return resp.json();
    }

    async function fetchText(url) {
        const resp = await origFetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        if (!resp.ok) throw new Error('HTTP ' + resp.status + ' on ' + url);
        return resp.text();
    }

    // Replay the captured search body with a different page index.
    async function searchPage(bodyObj, pageIndex) {
        const body = Object.assign({}, bodyObj, { PageIndex: pageIndex });
        const resp = await origFetch('/api/Job/SearchJsonData', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                '__RequestVerificationToken': getCsrf(),
                'X-JL-Bulk': '1'
            },
            body: JSON.stringify(body)
        });
        if (!resp.ok) throw new Error('SearchJsonData HTTP ' + resp.status);
        const data = await resp.json();
        const ad = data.AdditionalData || {};
        return { jobs: ad.Jobs || [], totalCount: ad.TotalCount || 0, pageSize: ad.PageSize || (ad.Jobs || []).length };
    }

    // ----- option lists for the value dropdown -----
    async function loadOptions(kind) {
        if (optionCache[kind]) return optionCache[kind];
        let opts = [];
        if (kind === 'status') {
            const data = await apiGet('/api/Job/GetStatusesForDropdown');
            const list = (data.AdditionalData || data.Data || data) || [];
            opts = list
                .filter(o => o.Value != null && !STATUS_PSEUDO_VALUES.includes(String(o.Value)))
                .map(o => ({ id: String(o.Value), label: o.Text }));
        } else if (kind === 'category') {
            const list = await apiGet('/api/Library/GetJobCategories?text=');
            opts = (list || []).filter(c => c.Id && c.Description).map(c => ({ id: String(c.Id), label: c.Description }));
            opts.sort((a, b) => a.label.localeCompare(b.label));
        } else if (kind === 'jobtype') {
            const list = await apiGet('/DocumentNumberingSetting/GetJobTypesDropdown');
            opts = (list || []).filter(t => t.JobTypeAutoId).map(t => ({ id: String(t.JobTypeAutoId), label: t.Description + (t.StringId ? ` (${t.StringId})` : '') }));
        } else { // addtag / removetag
            const list = await apiGet('/api/Tag/GetTags?entityType=Job');
            opts = (list || []).filter(t => t.Id != null).map(t => ({ id: String(t.Id), label: t.Title || t.Name || ('Tag ' + t.Id) }));
            opts.sort((a, b) => a.label.localeCompare(b.label));
        }
        // tag lists share one cache entry
        if (kind === 'addtag' || kind === 'removetag') { optionCache.addtag = opts; optionCache.removetag = opts; }
        else optionCache[kind] = opts;
        return opts;
    }

    // ----- job state extraction (same approach as bulk-set-category) -----
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

    // Post the full job form to /api/Job/EditDetail with `overrides` applied
    // ({StatusId} | {JobCategoryId} | {JobTypeId} | {TagIds: [...]}).
    async function postEditDetail(internalId, job, html, overrides, _retry = 0) {
        const tokenMatch = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
        const csrfToken = tokenMatch ? tokenMatch[1] : getCsrf();

        const entries = [];
        const push = (k, v) => entries.push([k, v == null ? '' : String(v)]);

        push('Id', job.Id);
        push('AssignedToUserId', job.AssignedToUserId);
        const tagIds = overrides.TagIds !== undefined ? overrides.TagIds : currentTagIds(job);
        tagIds.forEach((id, idx) => push(`TagIds[${idx}]`, id));
        push('TradeId', job.TradeId);
        push('IsRecuring', job.IsRecuring);
        push('JobTypeId', overrides.JobTypeId !== undefined ? overrides.JobTypeId : job.JobTypeId);
        push('StatusId', overrides.StatusId !== undefined ? overrides.StatusId : job.StatusId);
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

        push('JobCategoryId', overrides.JobCategoryId !== undefined ? overrides.JobCategoryId : job.JobCategoryId);
        push('PriorityId', job.PriorityId);
        push('OrderNumber', job.OrderNumber);
        push('CustomReference', job.CustomReference);
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

        const resp = await origFetch('/api/Job/EditDetail', {
            method: 'POST',
            credentials: 'same-origin',
            referrer: `${location.origin}/Job/Detail/${internalId}`,
            referrerPolicy: 'unsafe-url',
            headers,
            body
        });
        const respText = await resp.text().catch(() => '');
        if (!resp.ok) {
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
        if (document.getElementById('jl-bulkupd-panel')) return;

        panel = document.createElement('div');
        panel.id = 'jl-bulkupd-panel';

        const container = document.createElement('div');
        container.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;background:#1a1a2e;color:#eee;border-radius:8px;padding:16px;width:620px;max-height:88vh;display:flex;flex-direction:column;font-family:monospace;font-size:12px;box-shadow:0 4px 20px rgba(0,0,0,0.5);';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;';
        const title = document.createElement('strong');
        title.style.fontSize = '14px';
        title.textContent = 'Bulk Update Filtered Jobs';
        const closeBtn = document.createElement('button');
        closeBtn.style.cssText = 'background:none;border:none;color:#eee;font-size:18px;cursor:pointer;';
        closeBtn.textContent = '✕';
        closeBtn.addEventListener('click', () => { panel.style.display = 'none'; });
        header.appendChild(title);
        header.appendChild(closeBtn);

        // Captured-filter status line
        captureLine = document.createElement('div');
        captureLine.style.cssText = 'margin-bottom:10px;color:#fa0;';
        captureLine.textContent = 'No search captured yet — click Search on the page first.';

        // Field + value pickers
        const pickRow = document.createElement('div');
        pickRow.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;';

        const selCss = 'background:#0a0a1a;color:#eee;border:1px solid #444;border-radius:4px;padding:6px;max-width:260px;';
        fieldSel = document.createElement('select');
        fieldSel.style.cssText = selCss;
        for (const [k, f] of Object.entries(FIELDS)) {
            const o = document.createElement('option');
            o.value = k;
            o.textContent = f.label;
            fieldSel.appendChild(o);
        }

        valueSel = document.createElement('select');
        valueSel.style.cssText = selCss + 'min-width:220px;';

        reloadBtn = document.createElement('button');
        reloadBtn.style.cssText = 'background:#08a;color:#fff;border:none;padding:6px 10px;border-radius:4px;cursor:pointer;';
        reloadBtn.textContent = '⟳';
        reloadBtn.title = 'Reload value list';

        pickRow.appendChild(document.createTextNode('Set'));
        pickRow.appendChild(fieldSel);
        pickRow.appendChild(document.createTextNode('to'));
        pickRow.appendChild(valueSel);
        pickRow.appendChild(reloadBtn);

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

        const dryLabel = document.createElement('label');
        dryLabel.style.cssText = 'cursor:pointer;';
        dryCheck = document.createElement('input');
        dryCheck.type = 'checkbox';
        dryCheck.checked = true;
        dryLabel.appendChild(dryCheck);
        dryLabel.appendChild(document.createTextNode(' Dry Run'));

        controlsDiv.appendChild(startBtn);
        controlsDiv.appendChild(stopBtn);
        controlsDiv.appendChild(dryLabel);

        const progressDiv = document.createElement('div');
        progressDiv.style.marginBottom = '10px';
        progressText = document.createElement('span');
        progressText.style.color = '#0fa';
        progressText.textContent = 'Pick a field and value, then Start.';
        progressDiv.appendChild(progressText);

        logArea = document.createElement('div');
        logArea.style.cssText = 'flex:1;overflow-y:auto;background:#0a0a1a;padding:8px;border-radius:4px;max-height:55vh;';

        container.appendChild(header);
        container.appendChild(captureLine);
        container.appendChild(pickRow);
        container.appendChild(controlsDiv);
        container.appendChild(progressDiv);
        container.appendChild(logArea);
        panel.appendChild(container);
        document.body.appendChild(panel);

        jlRegisterPanel(panel, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR, SCRIPT_DESC);

        const refreshValues = async (force) => {
            const kind = fieldSel.value;
            if (force) { delete optionCache[kind]; if (kind === 'addtag' || kind === 'removetag') { delete optionCache.addtag; delete optionCache.removetag; } }
            valueSel.innerHTML = '<option>Loading…</option>';
            try {
                const opts = await loadOptions(kind);
                valueSel.innerHTML = '';
                if (!opts.length) {
                    valueSel.innerHTML = '<option value="">(none available)</option>';
                    return;
                }
                for (const o of opts) {
                    const el = document.createElement('option');
                    el.value = o.id;
                    el.textContent = o.label;
                    valueSel.appendChild(el);
                }
            } catch (e) {
                valueSel.innerHTML = `<option value="">(failed: ${e.message})</option>`;
            }
        };
        fieldSel.addEventListener('change', () => refreshValues(false));
        reloadBtn.addEventListener('click', () => refreshValues(true));
        refreshValues(false);

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
        const line = document.createElement('div');
        line.style.color = color || '#ccc';
        line.style.whiteSpace = 'pre-wrap';
        line.style.wordBreak = 'break-word';
        line.textContent = msg;
        logArea.appendChild(line);
        logArea.scrollTop = logArea.scrollHeight;
    }
    const setProgress = (msg) => { progressText.textContent = msg; };

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
            await sleep(DELAY_BETWEEN_PAGES);
        }
        return { jobs, total };
    }

    // Decide the change for one job; returns null if nothing to do.
    function buildOverrides(kind, valueId, job) {
        if (kind === 'status') {
            if (String(job.StatusId) === valueId) return null;
            return { StatusId: valueId };
        }
        if (kind === 'category') {
            if (String(job.JobCategoryId) === valueId) return null;
            return { JobCategoryId: valueId };
        }
        if (kind === 'jobtype') {
            if (String(job.JobTypeId) === valueId) return null;
            return { JobTypeId: valueId };
        }
        const tags = currentTagIds(job);
        if (kind === 'addtag') {
            if (tags.includes(valueId)) return null;
            return { TagIds: tags.concat([valueId]) };
        }
        if (kind === 'removetag') {
            if (!tags.includes(valueId)) return null;
            return { TagIds: tags.filter(t => t !== valueId) };
        }
        return null;
    }

    async function startProcess() {
        if (running) return;
        if (!capture.body) {
            log('No search captured. Set your filters and click Search on the page, then try again.', '#f55');
            return;
        }
        const kind = fieldSel.value;
        const valueId = valueSel.value;
        const valueLabel = valueSel.selectedOptions[0] ? valueSel.selectedOptions[0].textContent : '';
        if (!valueId) {
            log('Pick a value first.', '#f55');
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
        startBtn.style.display = 'none';
        stopBtn.style.display = 'inline-block';
        logArea.innerHTML = '';

        const dryRun = dryCheck.checked;
        const fieldLabel = FIELDS[kind].label;
        log(dryRun ? 'DRY RUN — no changes will be made' : 'LIVE MODE — jobs will be updated', dryRun ? '#ff0' : '#f55');
        log(`Action: ${fieldLabel} → "${valueLabel}"`, '#0af');
        log('');

        const stats = { updated: 0, skipped: 0, errors: 0 };
        const failed = [];

        try {
            const { jobs, total } = await collectFilteredJobs(bodyObj);
            log(`Collected ${jobs.length} job(s) from the filtered view (server total: ${total}).`, '#0af');

            if (!jobs.length) {
                log('Nothing to do.', '#fa0');
            } else if (!dryRun && !window.confirm(`Set ${fieldLabel} to "${valueLabel}" on ${jobs.length} job(s)?\n\nThis cannot be bulk-undone.`)) {
                log('Cancelled at confirmation.', '#fa0');
            } else {
                for (let i = 0; i < jobs.length; i++) {
                    if (!running) { log('Stopped by user.', '#f55'); break; }
                    const { id, jobNumber } = jobs[i];
                    setProgress(`Processing ${i + 1}/${jobs.length}: ${jobNumber}`);

                    try {
                        const html = await fetchText('/Job/Detail/' + id);
                        const job = extractJobState(html, id);
                        const overrides = buildOverrides(kind, valueId, job);
                        if (!overrides) {
                            log(`[${i + 1}/${jobs.length}] ${jobNumber} — already set, skipped`, '#888');
                            stats.skipped++;
                        } else if (dryRun) {
                            log(`[${i + 1}/${jobs.length}] ${jobNumber} — [DRY] would set ${fieldLabel} → "${valueLabel}"`, '#ff0');
                            stats.updated++;
                        } else {
                            await postEditDetail(id, job, html, overrides);
                            log(`[${i + 1}/${jobs.length}] ${jobNumber} — updated`, '#0fa');
                            stats.updated++;
                        }
                    } catch (e) {
                        log(`[${i + 1}/${jobs.length}] ${jobNumber} — ERROR: ${e.message}`, '#f55');
                        stats.errors++;
                        failed.push(`${jobNumber} (${e.message})`);
                    }

                    await sleep(DELAY_BETWEEN_JOBS);
                }

                log('');
                log('===== SUMMARY =====', '#0af');
                log(`${dryRun ? 'Would update' : 'Updated'}: ${stats.updated}`, '#0fa');
                log(`Skipped (already set): ${stats.skipped}`, '#888');
                log(`Errors: ${stats.errors}`, stats.errors ? '#f55' : '#888');
                if (failed.length) {
                    log('');
                    log('Failed:', '#f55');
                    failed.forEach(f => log('  ' + f, '#f99'));
                }
                setProgress(`Done. ${stats.updated} ${dryRun ? 'would be ' : ''}updated, ${stats.skipped} skipped, ${stats.errors} errors.`);
                if (!dryRun && stats.updated) log('Refresh the page (or click Search) to see updated values in the grid.', '#0af');
            }
        } catch (e) {
            log('FATAL: ' + e.message, '#f55');
            setProgress('Failed: ' + e.message);
        }

        running = false;
        capture.paused = false;
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
