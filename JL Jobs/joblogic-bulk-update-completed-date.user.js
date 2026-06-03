// ==UserScript==
// @name         Joblogic - Bulk Update Completed Date
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Paste CSV of JobID,CompletedDate; script sets/updates DateComplete for each job via API. Collapses to a launcher button in the shared dock (drag to reorder).
// @match        https://go.joblogic.com/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/joblogic-bulk-update-completed-date.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/joblogic-bulk-update-completed-date.user.js
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

    const SCRIPT_ID = 'update-completed-date';
    const SCRIPT_LABEL = '📅 Update Completed Date';
    const SCRIPT_COLOR = '#08a';

    // --- CONFIG ---
    const DELAY_BETWEEN_JOBS = 400;
    const HEADER_WORDS_ID = ['job id', 'job no', 'job no.', 'jobid', 'job number', 'id', 'ref', 'reference', 'job ref', 'job reference'];
    const HEADER_WORDS_DATE = ['date', 'completed', 'completed date', 'complete date', 'completion date', 'datecomplete', 'date complete'];

    // --- STATE ---
    let panel, logArea, startBtn, stopBtn, pasteBtn, progressText, dryCheck;
    let running = false;
    let rows = []; // [{ ref, dateStr }]

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    // =======================================================================
    // UI
    // =======================================================================
    function createUI() {
        if (document.getElementById('jl-bulkdate-panel')) return;

        panel = document.createElement('div');
        panel.id = 'jl-bulkdate-panel';
        const container = document.createElement('div');
        container.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;background:#1a1a2e;color:#eee;border-radius:8px;padding:16px;width:580px;max-height:85vh;display:flex;flex-direction:column;font-family:monospace;font-size:12px;box-shadow:0 4px 20px rgba(0,0,0,0.5);';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;';
        const title = document.createElement('strong');
        title.style.fontSize = '14px';
        title.textContent = 'Bulk Update Completed Date';
        const closeBtn = document.createElement('button');
        closeBtn.style.cssText = 'background:none;border:none;color:#eee;font-size:18px;cursor:pointer;';
        closeBtn.textContent = 'X';
        closeBtn.addEventListener('click', () => { panel.style.display = 'none'; });
        header.appendChild(title);
        header.appendChild(closeBtn);

        const progressDiv = document.createElement('div');
        progressDiv.style.marginBottom = '10px';
        progressText = document.createElement('span');
        progressText.style.color = '#0fa';
        progressText.textContent = 'Paste CSV (Job ID, Completed Date) to begin.';
        progressDiv.appendChild(progressText);

        const controlsDiv = document.createElement('div');
        controlsDiv.style.marginBottom = '10px';

        pasteBtn = document.createElement('button');
        pasteBtn.style.cssText = 'background:#08a;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;margin-right:8px;';
        pasteBtn.textContent = 'Paste CSV';
        pasteBtn.addEventListener('click', openPasteDialog);

        startBtn = document.createElement('button');
        startBtn.style.cssText = 'background:#0a8;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;margin-right:8px;';
        startBtn.textContent = 'Start';
        startBtn.disabled = true;
        startBtn.addEventListener('click', startProcess);

        stopBtn = document.createElement('button');
        stopBtn.style.cssText = 'background:#a22;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;display:none;';
        stopBtn.textContent = 'Stop';
        stopBtn.addEventListener('click', () => { running = false; });

        const dryLabel = document.createElement('label');
        dryLabel.style.cssText = 'margin-left:8px;cursor:pointer;';
        dryCheck = document.createElement('input');
        dryCheck.type = 'checkbox';
        dryCheck.id = 'jl-bulkdate-dryrun';
        dryLabel.appendChild(dryCheck);
        dryLabel.appendChild(document.createTextNode(' Dry Run (log only, no changes)'));

        controlsDiv.appendChild(pasteBtn);
        controlsDiv.appendChild(startBtn);
        controlsDiv.appendChild(stopBtn);
        controlsDiv.appendChild(dryLabel);

        logArea = document.createElement('div');
        logArea.style.cssText = 'flex:1;overflow-y:auto;background:#0a0a1a;padding:8px;border-radius:4px;max-height:55vh;';

        container.appendChild(header);
        container.appendChild(progressDiv);
        container.appendChild(controlsDiv);
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
    // CSV / date parsing
    // =======================================================================

    // Split a single CSV line respecting quoted commas. Also accepts tabs.
    function splitCsvLine(line) {
        if (line.includes('\t')) return line.split('\t').map(s => s.trim());
        const out = [];
        let cur = '';
        let inQ = false;
        for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (c === '"') {
                if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
                else inQ = !inQ;
            } else if (c === ',' && !inQ) {
                out.push(cur.trim()); cur = '';
            } else {
                cur += c;
            }
        }
        out.push(cur.trim());
        return out.map(s => s.replace(/^"|"$/g, ''));
    }

    // Normalize to dd/MM/yyyy HH:mm — the format Joblogic's DateComplete field uses
    function normalizeDate(raw) {
        if (!raw) return null;
        const s = String(raw).trim();
        if (!s) return null;
        const pad = (n) => String(n).padStart(2, '0');
        const fmt = (d, h, m) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(h)}:${pad(m)}`;

        // dd/MM/yyyy [HH:mm[:ss]] or dd-MM-yyyy
        let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::\d{2})?)?$/);
        if (m) {
            const day = +m[1], mon = +m[2], yrRaw = +m[3];
            const yr = yrRaw < 100 ? 2000 + yrRaw : yrRaw;
            const hh = m[4] != null ? +m[4] : 0;
            const mm = m[5] != null ? +m[5] : 0;
            const d = new Date(yr, mon - 1, day, hh, mm);
            if (!isNaN(d)) return fmt(d, hh, mm);
        }

        // yyyy-MM-dd [HH:mm[:ss]] (ISO-ish from spreadsheets)
        m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::\d{2})?)?/);
        if (m) {
            const yr = +m[1], mon = +m[2], day = +m[3];
            const hh = m[4] != null ? +m[4] : 0;
            const mm = m[5] != null ? +m[5] : 0;
            const d = new Date(yr, mon - 1, day, hh, mm);
            if (!isNaN(d)) return fmt(d, hh, mm);
        }

        // Last resort — let Date parse it
        const d = new Date(s);
        if (!isNaN(d)) return fmt(d, d.getHours(), d.getMinutes());
        return null;
    }

    function parseCsv(text) {
        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (!lines.length) return [];
        const first = splitCsvLine(lines[0]);
        const firstLooksLikeHeader =
            first.length >= 2 &&
            HEADER_WORDS_ID.includes((first[0] || '').toLowerCase()) &&
            HEADER_WORDS_DATE.some(w => (first[1] || '').toLowerCase().includes(w.split(' ')[0]));
        const dataLines = firstLooksLikeHeader ? lines.slice(1) : lines;

        const out = [];
        for (const line of dataLines) {
            const cols = splitCsvLine(line);
            if (cols.length < 2) continue;
            const ref = cols[0].trim();
            const dateStr = normalizeDate(cols[1]);
            if (!ref) continue;
            out.push({ ref, dateStr, rawDate: cols[1] });
        }
        return out;
    }

    function openPasteDialog() {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:100000;display:flex;align-items:center;justify-content:center;';
        overlay.innerHTML = `
            <div style="background:#fff;color:#111;border-radius:8px;width:560px;max-width:92vw;box-shadow:0 10px 40px rgba(0,0,0,.4);overflow:hidden;font-family:system-ui,sans-serif;">
                <div style="padding:12px 16px;background:#111827;color:#f9fafb;font-weight:600;">Paste Job IDs and Completed Dates</div>
                <div style="padding:14px 16px;">
                    <textarea id="jl-paste-ta" style="width:100%;height:220px;font:13px monospace;padding:8px;border:1px solid #d1d5db;border-radius:4px;box-sizing:border-box;" placeholder="Two columns: Job ID, Completed Date&#10;&#10;Example:&#10;J12345, 15/01/2026 14:30&#10;J12346, 2026-01-16&#10;J12347, 17/01/2026"></textarea>
                    <div style="color:#6b7280;font-size:12px;margin-top:6px;">Comma or tab separated. Header row optional. Accepts dd/MM/yyyy, yyyy-MM-dd, with or without time. Missing time defaults to 00:00.</div>
                    <div id="jl-paste-count" style="color:#2563eb;font-size:12px;margin-top:6px;font-weight:600;">0 rows detected</div>
                    <div id="jl-paste-preview" style="color:#374151;font-size:11px;margin-top:6px;max-height:100px;overflow-y:auto;font-family:monospace;"></div>
                    <div style="text-align:right;margin-top:10px;">
                        <button id="jl-paste-cancel" style="background:#9ca3af;color:#fff;border:0;border-radius:4px;padding:7px 14px;cursor:pointer;margin-right:6px;">Cancel</button>
                        <button id="jl-paste-ok" style="background:#2563eb;color:#fff;border:0;border-radius:4px;padding:7px 14px;cursor:pointer;">Load</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        const ta = overlay.querySelector('#jl-paste-ta');
        const count = overlay.querySelector('#jl-paste-count');
        const preview = overlay.querySelector('#jl-paste-preview');

        const refreshPreview = () => {
            const parsed = parseCsv(ta.value);
            const bad = parsed.filter(r => !r.dateStr);
            count.textContent = `${parsed.length} row${parsed.length === 1 ? '' : 's'} detected` + (bad.length ? ` — ${bad.length} with unparseable date` : '');
            count.style.color = bad.length ? '#dc2626' : '#2563eb';
            preview.innerHTML = parsed.slice(0, 6).map(r =>
                `<div style="color:${r.dateStr ? '#374151' : '#dc2626'};">${r.ref} &rarr; ${r.dateStr || '[bad date: ' + (r.rawDate || '') + ']'}</div>`
            ).join('') + (parsed.length > 6 ? `<div style="color:#9ca3af;">...and ${parsed.length - 6} more</div>` : '');
        };

        ta.addEventListener('input', refreshPreview);
        overlay.querySelector('#jl-paste-cancel').onclick = () => overlay.remove();
        overlay.querySelector('#jl-paste-ok').onclick = () => {
            const parsed = parseCsv(ta.value);
            const valid = parsed.filter(r => r.dateStr);
            const bad = parsed.filter(r => !r.dateStr);
            rows = valid;
            overlay.remove();
            if (rows.length) {
                log(`Loaded ${rows.length} rows.`, '#0af');
                if (bad.length) log(`Skipped ${bad.length} rows with unparseable dates: ${bad.map(r => r.ref).join(', ')}`, '#fa0');
                setProgress(`${rows.length} rows ready. Click Start.`);
                startBtn.disabled = false;
            } else {
                setProgress('No valid rows found.');
                startBtn.disabled = true;
            }
        };
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        setTimeout(() => ta.focus(), 50);
    }

    // =======================================================================
    // API helpers
    // =======================================================================
    function getCsrfTokenFromDoc(doc = document) {
        const el = doc.querySelector('input[name="__RequestVerificationToken"]');
        return el ? el.value : '';
    }

    async function fetchText(url) {
        const resp = await fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        if (!resp.ok) throw new Error('HTTP ' + resp.status + ' on ' + url);
        return await resp.text();
    }

    async function searchJob(jobRef) {
        const token = getCsrfTokenFromDoc();
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
        const match = jobs.find(j => j.JobNumber === jobRef || j.ReferenceNumber === jobRef) || jobs[0];
        return {
            id: match.Id || match.JobId,
            number: match.JobNumber || match.ReferenceNumber || jobRef,
            status: match.Status || match.JobStatus || ''
        };
    }

    // Extract embedded job-state JSON blob from the detail page HTML
    function extractJobState(html, internalId) {
        const anchor = `"Id":${internalId}`;
        const i = html.indexOf(anchor);
        if (i < 0) throw new Error(`Job state anchor "${anchor}" not in HTML`);
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

    // Update DateComplete via /api/Job/EditDetail (works on completed jobs too)
    async function updateDateCompleteViaEditDetail(internalId, newDateStr, dryRun, _retry = 0) {
        const html = await fetchText('/Job/Detail/' + internalId);
        const job = extractJobState(html, internalId);
        const tokenMatch = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
        const csrfToken = tokenMatch ? tokenMatch[1] : '';

        const existingTagIds = Array.isArray(job.TagIds)
            ? job.TagIds.map(String)
            : (Array.isArray(job.Tags) ? job.Tags.map(t => String(t.Id || t.TagId || t)) : []);

        const entries = [];
        const push = (k, v) => entries.push([k, v == null ? '' : String(v)]);

        push('Id', job.Id);
        push('AssignedToUserId', job.AssignedToUserId);
        existingTagIds.forEach((id, idx) => push(`TagIds[${idx}]`, id));
        push('TradeId', job.TradeId);
        push('IsRecuring', job.IsRecuring);
        push('JobTypeId', job.JobTypeId);
        push('StatusId', job.StatusId);
        push('Description', job.Description);
        push('DateLogged', job.DateLogged);
        push('AppointmentDate', job.AppointmentDate);
        push('TargetCompletionDate', job.TargetCompletionDate);
        push('DateComplete', newDateStr); // <-- the one field we're changing
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

        const existingDate = job.DateComplete || '(empty)';

        if (dryRun) return { dry: true, existingDate, newDate: newDateStr, fieldCount: entries.length };

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
                return updateDateCompleteViaEditDetail(internalId, newDateStr, dryRun, _retry + 1);
            }
            throw new Error(`EditDetail HTTP ${resp.status}: ${respText.slice(0, 400)}`);
        }
        let json = {};
        try { json = JSON.parse(respText); } catch (e) {}
        if (json.success === false) {
            throw new Error('EditDetail success=false: ' + (json.Message || respText.slice(0, 300)));
        }
        return { status: resp.status, existingDate, newDate: newDateStr };
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
        log(dryRun ? 'DRY RUN — no changes will be made' : 'LIVE MODE — DateComplete will be updated',
            dryRun ? '#ff0' : '#f55');
        log(`Processing ${rows.length} jobs...`, '#0af');
        log('');

        const stats = { updated: 0, unchanged: 0, notFound: 0, errors: 0 };
        const failed = [];

        for (let i = 0; i < rows.length; i++) {
            if (!running) { log('Stopped by user.', '#f55'); break; }
            const { ref, dateStr } = rows[i];
            setProgress(`Processing ${i + 1}/${rows.length}: ${ref}`);
            log(`--- [${i + 1}/${rows.length}] ${ref} -> ${dateStr} ---`, '#fff');

            try {
                const job = await searchJob(ref);
                if (!job) {
                    log('  Not found in search', '#f55');
                    stats.notFound++;
                    failed.push(ref + ' (not found)');
                    continue;
                }
                log(`  Resolved -> internalId=${job.id}`, '#0af');

                const res = await updateDateCompleteViaEditDetail(job.id, dateStr, dryRun);
                if (res.dry) {
                    log(`  [DRY] Would set DateComplete: "${res.existingDate}" -> "${res.newDate}" (${res.fieldCount} fields)`, '#ff0');
                    stats.updated++;
                } else if (res.existingDate === res.newDate) {
                    log(`  DateComplete already "${res.newDate}" — posted anyway`, '#0a8');
                    stats.unchanged++;
                } else {
                    log(`  DateComplete updated: "${res.existingDate}" -> "${res.newDate}"`, '#0fa');
                    stats.updated++;
                }
            } catch (e) {
                log(`  ERROR: ${e.message}`, '#f55');
                stats.errors++;
                failed.push(ref + ' (' + e.message + ')');
            }

            await sleep(DELAY_BETWEEN_JOBS);
        }

        log('');
        log('===== SUMMARY =====', '#0af');
        log(`Updated:   ${stats.updated}`, '#0fa');
        log(`Unchanged: ${stats.unchanged}`, '#888');
        log(`Not found: ${stats.notFound}`, '#fa0');
        log(`Errors:    ${stats.errors}`, stats.errors ? '#f55' : '#888');
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
