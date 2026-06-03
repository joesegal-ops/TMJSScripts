// ==UserScript==
// @name         Joblogic - Bulk Set Job Category (CSV)
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  Paste a CSV of job numbers + category names; script updates each job's category via API. v1.3: collapses to a launcher button in the shared dock (drag to reorder).
// @match        https://go.joblogic.com/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/joblogic-bulk-set-category.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/joblogic-bulk-set-category.user.js
// ==/UserScript==

(function () {
    'use strict';

    // ===== Shared JL userscript launcher dock (identical in every script) =====
    const JL_DOCK_ID = 'jl-userscript-dock', JL_ORDER_KEY = 'jl-userscript-dock-order';
    function jlReadOrder() { try { return JSON.parse(localStorage.getItem(JL_ORDER_KEY)) || []; } catch (e) { return []; } }
    function jlSaveOrder() { const d = document.getElementById(JL_DOCK_ID); if (!d) return; localStorage.setItem(JL_ORDER_KEY, JSON.stringify([...d.children].map(b => b.dataset.scriptId).filter(Boolean))); }
    function jlApplyOrder() { const d = document.getElementById(JL_DOCK_ID); if (!d) return; [...d.children].sort((a, b) => { const o = jlReadOrder(); let ia = o.indexOf(a.dataset.scriptId), ib = o.indexOf(b.dataset.scriptId); if (ia < 0) ia = 1e9; if (ib < 0) ib = 1e9; return ia - ib; }).forEach(b => d.appendChild(b)); }
    function jlAfter(d, y) { let c = { o: -Infinity, el: null }; for (const el of d.querySelectorAll('button:not(.jl-dragging)')) { const r = el.getBoundingClientRect(); const off = y - (r.top + r.height / 2); if (off < 0 && off > c.o) c = { o: off, el }; } return c.el; }
    function jlGetDock() {
        let d = document.getElementById(JL_DOCK_ID);
        if (!d) {
            d = document.createElement('div');
            d.id = JL_DOCK_ID;
            d.style.cssText = 'position:fixed;top:80px;right:8px;z-index:100000;display:flex;flex-direction:column;gap:8px;align-items:flex-end;';
            document.body.appendChild(d);
        }
        if (!d.dataset.dnd) {
            d.dataset.dnd = '1';
            d.addEventListener('dragover', e => { e.preventDefault(); const dr = d.querySelector('.jl-dragging'); if (!dr) return; const a = jlAfter(d, e.clientY); if (a == null) d.appendChild(dr); else d.insertBefore(dr, a); });
            d.addEventListener('drop', e => { e.preventDefault(); jlSaveOrder(); });
        }
        return d;
    }
    function jlDockButton(id, label, color, onClick) {
        const d = jlGetDock();
        let b = document.getElementById('jl-launch-' + id);
        if (b) return b;
        b = document.createElement('button');
        b.id = 'jl-launch-' + id;
        b.dataset.scriptId = id;
        b.textContent = label;
        b.title = 'Show / hide ' + label + '  (drag to reorder)';
        b.draggable = true;
        b.style.cssText = `background:${color};color:#fff;border:none;padding:8px 13px;border-radius:18px;cursor:grab;font-family:monospace;font-size:12px;box-shadow:0 2px 8px rgba(0,0,0,.4);white-space:nowrap;`;
        b.addEventListener('click', () => { if (b.dataset.justDragged) { delete b.dataset.justDragged; return; } onClick(); });
        b.addEventListener('dragstart', () => { b.classList.add('jl-dragging'); b.style.opacity = '0.4'; });
        b.addEventListener('dragend', () => { b.classList.remove('jl-dragging'); b.style.opacity = '1'; b.dataset.justDragged = '1'; setTimeout(() => { delete b.dataset.justDragged; }, 60); jlSaveOrder(); });
        d.appendChild(b);
        jlApplyOrder();
        return b;
    }
    // Collapse a panel to a dock button. panelEl = the OUTERMOST element of the
    // script's floating UI. Returns the dock button.
    function jlRegisterPanel(panelEl, id, label, color) {
        const shown = (panelEl.style.display && panelEl.style.display !== 'none') ? panelEl.style.display : 'block';
        panelEl.style.display = 'none';
        const btn = jlDockButton(id, label, color, () => {
            const opening = panelEl.style.display === 'none';
            panelEl.style.display = opening ? shown : 'none';
            btn.style.boxShadow = opening ? '0 0 0 2px #fff, 0 2px 8px rgba(0,0,0,.4)' : '0 2px 8px rgba(0,0,0,.4)';
        });
        return btn;
    }
    // ===== end shared dock =====

    const SCRIPT_ID = 'bulk-set-category';
    const SCRIPT_LABEL = '🏷 Bulk Set Category';
    const SCRIPT_COLOR = '#a60';

    // --- CONFIG ---
    const DELAY_BETWEEN_JOBS = 400;

    // Column header aliases (case-insensitive; underscores normalised to spaces)
    const JOB_HEADERS = ['job no', 'job no.', 'job number', 'jobno', 'jobnumber', 'job ref', 'job reference', 'reference', 'ref', 'id', 'job id'];
    const CAT_HEADERS = ['category', 'job category', 'jobcategory', 'cat'];

    // --- STATE ---
    let panel, logArea, startBtn, stopBtn, pasteBtn, progressText, dryCheck;
    let running = false;
    let rows = []; // [{jobRef, category}]
    const categoryCache = {}; // "siteId-customerId" -> normalised-name -> {id, name}

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const norm = (s) => String(s || '').toLowerCase().trim();

    // =======================================================================
    // UI
    // =======================================================================
    function createUI() {
        if (document.getElementById('jl-bulkcat-panel')) return;

        panel = document.createElement('div');
        panel.id = 'jl-bulkcat-panel';

        const container = document.createElement('div');
        container.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;background:#1a1a2e;color:#eee;border-radius:8px;padding:16px;width:600px;max-height:88vh;display:flex;flex-direction:column;font-family:monospace;font-size:12px;box-shadow:0 4px 20px rgba(0,0,0,0.5);';

        // Header
        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;';
        const title = document.createElement('strong');
        title.style.fontSize = '14px';
        title.textContent = 'Bulk Set Job Category (CSV)';
        const closeBtn = document.createElement('button');
        closeBtn.style.cssText = 'background:none;border:none;color:#eee;font-size:18px;cursor:pointer;';
        closeBtn.textContent = '✕';
        closeBtn.addEventListener('click', () => { panel.style.display = 'none'; });
        header.appendChild(title);
        header.appendChild(closeBtn);

        // Progress
        const progressDiv = document.createElement('div');
        progressDiv.style.marginBottom = '10px';
        progressText = document.createElement('span');
        progressText.style.color = '#0fa';
        progressText.textContent = 'Paste a CSV to begin.';
        progressDiv.appendChild(progressText);

        // Controls
        const controlsDiv = document.createElement('div');
        controlsDiv.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;';

        pasteBtn = document.createElement('button');
        pasteBtn.style.cssText = 'background:#08a;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;';
        pasteBtn.textContent = 'Paste CSV';
        pasteBtn.addEventListener('click', openPasteDialog);

        startBtn = document.createElement('button');
        startBtn.style.cssText = 'background:#0a8;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;';
        startBtn.textContent = 'Start';
        startBtn.disabled = true;
        startBtn.addEventListener('click', startProcess);

        stopBtn = document.createElement('button');
        stopBtn.style.cssText = 'background:#a22;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;display:none;';
        stopBtn.textContent = 'Stop';
        stopBtn.addEventListener('click', () => { running = false; });

        const dryLabel = document.createElement('label');
        dryLabel.style.cssText = 'cursor:pointer;';
        dryCheck = document.createElement('input');
        dryCheck.type = 'checkbox';
        dryLabel.appendChild(dryCheck);
        dryLabel.appendChild(document.createTextNode(' Dry Run'));

        controlsDiv.appendChild(pasteBtn);
        controlsDiv.appendChild(startBtn);
        controlsDiv.appendChild(stopBtn);
        controlsDiv.appendChild(dryLabel);

        // Help text
        const help = document.createElement('div');
        help.style.cssText = 'font-size:11px;color:#888;margin-bottom:10px;';
        help.textContent = 'CSV must have a Job No column and a Category column. Header row auto-detected.';

        // Log area
        logArea = document.createElement('div');
        logArea.style.cssText = 'flex:1;overflow-y:auto;background:#0a0a1a;padding:8px;border-radius:4px;max-height:60vh;';

        container.appendChild(header);
        container.appendChild(progressDiv);
        container.appendChild(controlsDiv);
        container.appendChild(help);
        container.appendChild(logArea);
        panel.appendChild(container);
        document.body.appendChild(panel);

        jlRegisterPanel(panel, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR);
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
    // CSV parsing
    // =======================================================================
    function parseCsv(text) {
        // Split into lines, handle \r\n and \r
        const rawLines = text.split(/\r?\n|\r/).map(l => l.trim()).filter(Boolean);
        if (!rawLines.length) return { rows: [], error: 'Empty input' };

        // Detect delimiter: tab if first line contains a tab, else comma
        const delim = rawLines[0].includes('\t') ? '\t' : ',';

        // Tokeniser: tab-delimited is simple split; CSV handles quotes
        function tokenise(line) {
            if (delim === '\t') return line.split('\t').map(f => f.trim());
            const fields = [];
            let cur = '', inQuote = false;
            for (let i = 0; i < line.length; i++) {
                const c = line[i];
                if (c === '"') {
                    if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
                    else inQuote = !inQuote;
                } else if (c === ',' && !inQuote) {
                    fields.push(cur.trim());
                    cur = '';
                } else {
                    cur += c;
                }
            }
            fields.push(cur.trim());
            return fields;
        }

        // Normalise header text: lowercase, underscores → spaces
        const normHeader = (s) => norm(s).replace(/_/g, ' ');

        const allRows = rawLines.map(tokenise);
        const firstRow = allRows[0].map(normHeader);

        // Detect header row
        let jobCol = -1, catCol = -1, dataStart = 0;
        for (let i = 0; i < firstRow.length; i++) {
            if (jobCol < 0 && JOB_HEADERS.includes(firstRow[i])) jobCol = i;
            if (catCol < 0 && CAT_HEADERS.includes(firstRow[i])) catCol = i;
        }
        if (jobCol >= 0 && catCol >= 0) {
            dataStart = 1; // header found
        } else {
            // No header — assume col 0 = job, col 1 = category
            jobCol = 0;
            catCol = 1;
            dataStart = 0;
        }

        const rows = [];
        for (let i = dataStart; i < allRows.length; i++) {
            const r = allRows[i];
            const jobRef = (r[jobCol] || '').trim();
            const category = (r[catCol] || '').trim();
            if (jobRef && category) rows.push({ jobRef, category });
        }
        return { rows, jobCol, catCol, dataStart };
    }

    // =======================================================================
    // Paste dialog
    // =======================================================================
    function openPasteDialog() {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:100000;display:flex;align-items:center;justify-content:center;';
        overlay.innerHTML = `
            <div style="background:#fff;color:#111;border-radius:8px;width:580px;max-width:94vw;box-shadow:0 10px 40px rgba(0,0,0,.4);overflow:hidden;font-family:system-ui,sans-serif;">
                <div style="padding:12px 16px;background:#111827;color:#f9fafb;font-weight:600;">Paste CSV — Job No, Category</div>
                <div style="padding:14px 16px;">
                    <textarea id="jl-cat-ta" style="width:100%;height:220px;font:13px monospace;padding:8px;border:1px solid #d1d5db;border-radius:4px;box-sizing:border-box;" placeholder="Paste from Google Sheets (tab-separated) or comma CSV:&#10;Job_Number	Job_Category&#10;RE0017205	Plumbing&#10;RE0017026	Heating and Cooling (HVAC)"></textarea>
                    <div style="color:#6b7280;font-size:12px;margin-top:6px;">Tab-separated (Google Sheets paste) or comma CSV. Header row optional. Underscores in headers treated as spaces.</div>
                    <div id="jl-cat-count" style="color:#2563eb;font-size:12px;margin-top:6px;font-weight:600;">0 rows detected</div>
                    <div style="text-align:right;margin-top:10px;">
                        <button id="jl-cat-cancel" style="background:#9ca3af;color:#fff;border:0;border-radius:4px;padding:7px 14px;cursor:pointer;margin-right:6px;">Cancel</button>
                        <button id="jl-cat-ok" style="background:#2563eb;color:#fff;border:0;border-radius:4px;padding:7px 14px;cursor:pointer;">Load</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        const ta = overlay.querySelector('#jl-cat-ta');
        const countEl = overlay.querySelector('#jl-cat-count');

        ta.addEventListener('input', () => {
            const { rows: r } = parseCsv(ta.value);
            countEl.textContent = `${r.length} row${r.length === 1 ? '' : 's'} detected`;
        });

        overlay.querySelector('#jl-cat-cancel').onclick = () => overlay.remove();
        overlay.querySelector('#jl-cat-ok').onclick = () => {
            const { rows: parsed, error } = parseCsv(ta.value);
            overlay.remove();
            if (error || !parsed.length) {
                setProgress('No valid rows found. Check CSV format.');
                startBtn.disabled = true;
                return;
            }
            rows = parsed;
            logArea.innerHTML = '';
            log(`Loaded ${rows.length} row${rows.length === 1 ? '' : 's'}:`, '#0af');
            rows.slice(0, 6).forEach(r => log(`  ${r.jobRef}  →  ${r.category}`, '#ccc'));
            if (rows.length > 6) log(`  … and ${rows.length - 6} more`, '#888');
            setProgress(`${rows.length} rows ready. Click Start.`);
            startBtn.disabled = false;
            Object.keys(categoryCache).forEach(k => delete categoryCache[k]); // reset cache
        };
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        setTimeout(() => ta.focus(), 50);
    }

    // =======================================================================
    // API helpers
    // =======================================================================
    function getCsrf(doc = document) {
        const el = doc.querySelector('input[name="__RequestVerificationToken"]');
        return el ? el.value : '';
    }

    async function fetchText(url) {
        const resp = await fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        if (!resp.ok) throw new Error('HTTP ' + resp.status + ' on ' + url);
        return resp.text();
    }

    async function searchJob(jobRef) {
        const token = getCsrf();
        const resp = await fetch('/api/Job/SearchJsonData', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                '__RequestVerificationToken': token
            },
            body: JSON.stringify({
                SearchTerm: jobRef,
                PageSize: 10, PageIndex: 1,
                EngineerType: 0,
                IncludePPMJobs: true, IncludeReactiveJobs: true,
                StartLoggedDate: '', EndLoggedDate: '',
                StartDate: '', EndDate: '',
                StartCompleteDate: '', EndCompleteDate: '',
                StartNextContactDate: '', EndNextContactDate: ''
            })
        });
        if (!resp.ok) throw new Error('Search HTTP ' + resp.status);
        const data = await resp.json();
        const jobs = (data.AdditionalData && data.AdditionalData.Jobs) || data.Data || [];
        if (!jobs.length) return null;
        return jobs.find(j => j.JobNumber === jobRef || j.ReferenceNumber === jobRef) || jobs[0];
    }

    // Pull embedded job-state JSON from the detail page HTML
    function extractJobState(html, internalId) {
        const anchor = `"Id":${internalId}`;
        const i = html.indexOf(anchor);
        if (i < 0) throw new Error(`Job state anchor not found in detail page`);
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

    // Fetch category list for a given job state, cached per siteId+customerId.
    // Endpoint discovered by inspecting the jl-select Vue component network call:
    // GET /api/Library/GetJobCategories?text=&siteId=X&customerId=Y&isLogAssociatedCustomer=Z
    // Response: [{ Id: <int>, Description: "Plumbing", ... }]
    async function loadCategoriesForJob(job) {
        const siteId = (job.Site && job.Site.Id) || '';
        const customerId = job.CustomerId || '';
        const isAssoc = job.IsLogAssociatedCustomer || false;
        const cacheKey = `${siteId}-${customerId}`;
        if (categoryCache[cacheKey]) return categoryCache[cacheKey];

        const url = `/api/Library/GetJobCategories?text=&siteId=${siteId}&customerId=${customerId}&isLogAssociatedCustomer=${isAssoc}`;
        const resp = await fetch(url, {
            credentials: 'same-origin',
            headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' }
        });
        if (!resp.ok) throw new Error(`GetJobCategories HTTP ${resp.status}`);
        const list = await resp.json();
        if (!Array.isArray(list) || !list.length) throw new Error('GetJobCategories returned empty list');

        const map = {};
        for (const item of list) {
            if (item.Id && item.Description) map[norm(item.Description)] = { id: String(item.Id), name: item.Description };
        }
        log(`Categories loaded (${Object.keys(map).length} entries, siteId=${siteId})`, '#0a8');
        categoryCache[cacheKey] = map;
        return map;
    }

    // Post updated category to /api/Job/EditDetail.
    // Accepts pre-fetched html+job to avoid double-fetching the detail page.
    async function updateJobCategory(internalId, newCategoryId, dryRun, prefetchedHtml, prefetchedJob, _retry = 0) {
        const html = prefetchedHtml || await fetchText('/Job/Detail/' + internalId);
        const job = prefetchedJob || extractJobState(html, internalId);

        const tokenMatch = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
        const csrfToken = tokenMatch ? tokenMatch[1] : '';

        const entries = [];
        const push = (k, v) => entries.push([k, v == null ? '' : String(v)]);

        push('Id', job.Id);
        push('AssignedToUserId', job.AssignedToUserId);
        const existingTagIds = Array.isArray(job.TagIds)
            ? job.TagIds
            : (Array.isArray(job.Tags) ? job.Tags.map(t => t.Id || t.TagId || t) : []);
        existingTagIds.forEach((id, idx) => push(`TagIds[${idx}]`, id));
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

        push('JobCategoryId', newCategoryId); // ← the change
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

        if (dryRun) {
            return { dry: true, oldCategoryId: job.JobCategoryId, newCategoryId };
        }

        const headers = {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
            'Accept': 'application/json'
        };
        if (csrfToken) headers['__RequestVerificationToken'] = csrfToken;

        const resp = await fetch('/api/Job/EditDetail', {
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
                return updateJobCategory(internalId, newCategoryId, dryRun, null, null, _retry + 1);
            }
            throw new Error(`EditDetail HTTP ${resp.status}: ${respText.slice(0, 300)}`);
        }
        let json = {};
        try { json = JSON.parse(respText); } catch (_) {}
        if (json.success === false) throw new Error('EditDetail success=false: ' + (json.Message || respText.slice(0, 200)));
        return { oldCategoryId: job.JobCategoryId };
    }

    // =======================================================================
    // Main loop
    // =======================================================================
    async function startProcess() {
        if (running || !rows.length) return;
        running = true;
        startBtn.style.display = 'none';
        stopBtn.style.display = 'inline-block';
        logArea.innerHTML = '';

        const dryRun = dryCheck.checked;
        log(dryRun ? 'DRY RUN — no changes will be made' : 'LIVE MODE — categories will be updated', dryRun ? '#ff0' : '#f55');
        log(`Processing ${rows.length} jobs…`, '#0af');
        log('');

        const stats = { updated: 0, notFound: 0, unknownCat: 0, errors: 0 };
        const failed = [];
        const unknownCats = new Set();

        for (let i = 0; i < rows.length; i++) {
            if (!running) { log('Stopped by user.', '#f55'); break; }
            const { jobRef, category } = rows[i];
            setProgress(`Processing ${i + 1}/${rows.length}: ${jobRef}`);
            log(`--- [${i + 1}/${rows.length}] ${jobRef}  →  ${category} ---`, '#fff');

            try {
                // Resolve job number → internal ID
                const found = await searchJob(jobRef);
                if (!found) {
                    log('  Not found', '#f55');
                    stats.notFound++;
                    failed.push(`${jobRef} (not found)`);
                    continue;
                }
                const internalId = found.Id || found.JobId;
                log(`  Resolved → internalId=${internalId}`, '#0af');

                // Fetch job state (needed for siteId/customerId to look up categories)
                const html = await fetchText('/Job/Detail/' + internalId);
                const job = extractJobState(html, internalId);

                // Load categories for this job's site/customer (cached after first fetch)
                const catMap = await loadCategoriesForJob(job);

                const catKey = norm(category);
                const catEntry = catMap[catKey];
                if (!catEntry) {
                    // Try partial / contains match
                    const partial = Object.values(catMap).find(c => norm(c.name).includes(catKey) || catKey.includes(norm(c.name)));
                    if (!partial) {
                        log(`  Unknown category: "${category}"`, '#f55');
                        if (!unknownCats.has(catKey)) {
                            unknownCats.add(catKey);
                            const available = Object.values(catMap).map(c => c.name).sort().join(', ');
                            log(`  Available: ${available || '(none)'}`, '#888');
                        }
                        stats.unknownCat++;
                        failed.push(`${jobRef} (unknown category: ${category})`);
                        continue;
                    }
                    log(`  Category fuzzy-matched: "${category}" → "${partial.name}"`, '#fa0');
                    var resolvedCat = partial;
                } else {
                    var resolvedCat = catEntry;
                }

                // Update (pass pre-fetched html+job to avoid a second fetch)
                const result = await updateJobCategory(internalId, resolvedCat.id, dryRun, html, job);
                if (result.dry) {
                    log(`  [DRY] Would set category to "${resolvedCat.name}" (id=${resolvedCat.id}), was ${result.oldCategoryId || '?'}`, '#ff0');
                } else {
                    log(`  Updated to "${resolvedCat.name}"`, '#0fa');
                }
                stats.updated++;

            } catch (e) {
                log(`  ERROR: ${e.message}`, '#f55');
                stats.errors++;
                failed.push(`${jobRef} (${e.message})`);
            }

            await sleep(DELAY_BETWEEN_JOBS);
        }

        log('');
        log('===== SUMMARY =====', '#0af');
        log(`Updated:       ${stats.updated}`,     '#0fa');
        log(`Unknown cat:   ${stats.unknownCat}`,  stats.unknownCat ? '#fa0' : '#888');
        log(`Not found:     ${stats.notFound}`,    stats.notFound  ? '#fa0' : '#888');
        log(`Errors:        ${stats.errors}`,      stats.errors    ? '#f55' : '#888');
        if (failed.length) {
            log('');
            log('Failed:', '#f55');
            failed.forEach(f => log('  ' + f, '#f99'));
        }
        setProgress(`Done. ${stats.updated}/${rows.length} updated.`);

        running = false;
        startBtn.style.display = 'inline-block';
        stopBtn.style.display = 'none';
    }

    // --- BOOT ---
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createUI);
    } else {
        createUI();
    }
})();
