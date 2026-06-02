// ==UserScript==
// @name         Joblogic - Bulk Close Jobs & mark Quoted and Closed (API)
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  Paste a list of job numbers; script tags them "Quoted and Closed" and completes them via API.
// @match        https://go.joblogic.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // --- CONFIG ---
    const TAG_NAME = 'Quoted and Closed';
    const QUOTED_AND_CLOSED_ID = 'abc2e309-b7a1-4b8e-ab75-1e6c7549d063';
    const DELAY_BETWEEN_JOBS = 400;
    const HEADER_WORDS = [
        'job id', 'job no', 'job no.', 'jobid', 'job number', 'id',
        'job ref', 'ref', 'reference', 'job reference'
    ];

    // --- STATE ---
    let panel, logArea, startBtn, stopBtn, pasteBtn, progressText, dryCheck;
    let running = false;
    let jobRefs = [];

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    // =======================================================================
    // UI
    // =======================================================================
    function createUI() {
        if (document.getElementById('jl-bulkclose-quoted-panel')) return;

        panel = document.createElement('div');
        panel.id = 'jl-bulkclose-quoted-panel';
        const container = document.createElement('div');
        container.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;background:#1a1a2e;color:#eee;border-radius:8px;padding:16px;width:560px;max-height:85vh;display:flex;flex-direction:column;font-family:monospace;font-size:12px;box-shadow:0 4px 20px rgba(0,0,0,0.5);';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;';
        const title = document.createElement('strong');
        title.style.fontSize = '14px';
        title.textContent = 'Bulk Close Jobs (Quoted and Closed)';
        const closeBtn = document.createElement('button');
        closeBtn.style.cssText = 'background:none;border:none;color:#eee;font-size:18px;cursor:pointer;';
        closeBtn.textContent = 'X';
        closeBtn.addEventListener('click', () => panel.remove());
        header.appendChild(title);
        header.appendChild(closeBtn);

        const progressDiv = document.createElement('div');
        progressDiv.style.marginBottom = '10px';
        progressText = document.createElement('span');
        progressText.style.color = '#0fa';
        progressText.textContent = 'Paste job numbers to begin.';
        progressDiv.appendChild(progressText);

        const controlsDiv = document.createElement('div');
        controlsDiv.style.marginBottom = '10px';

        pasteBtn = document.createElement('button');
        pasteBtn.style.cssText = 'background:#08a;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;margin-right:8px;';
        pasteBtn.textContent = 'Paste Jobs';
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
        dryCheck.id = 'jl-bulkclose-quoted-dryrun';
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
    // Paste dialog
    // =======================================================================
    function parseJobRefs(text) {
        let tokens = text.split(/[\s,]+/).map(s => s.replace(/^"|"$/g, '').trim()).filter(Boolean);
        if (tokens.length && HEADER_WORDS.includes(tokens[0].toLowerCase())) tokens = tokens.slice(1);
        return [...new Set(tokens)];
    }

    function openPasteDialog() {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:100000;display:flex;align-items:center;justify-content:center;';
        overlay.innerHTML = `
            <div style="background:#fff;color:#111;border-radius:8px;width:520px;max-width:92vw;box-shadow:0 10px 40px rgba(0,0,0,.4);overflow:hidden;font-family:system-ui,sans-serif;">
                <div style="padding:12px 16px;background:#111827;color:#f9fafb;font-weight:600;">Paste job numbers</div>
                <div style="padding:14px 16px;">
                    <textarea id="jl-paste-quoted-ta" style="width:100%;height:200px;font:13px monospace;padding:8px;border:1px solid #d1d5db;border-radius:4px;box-sizing:border-box;" placeholder="Paste comma-, tab-, or newline-separated job numbers"></textarea>
                    <div style="color:#6b7280;font-size:12px;margin-top:6px;">Any separator works. Header row (e.g. "Job No") is ignored.</div>
                    <div id="jl-paste-quoted-count" style="color:#2563eb;font-size:12px;margin-top:6px;font-weight:600;">0 job IDs detected</div>
                    <div style="text-align:right;margin-top:10px;">
                        <button id="jl-paste-quoted-cancel" style="background:#9ca3af;color:#fff;border:0;border-radius:4px;padding:7px 14px;cursor:pointer;margin-right:6px;">Cancel</button>
                        <button id="jl-paste-quoted-ok" style="background:#2563eb;color:#fff;border:0;border-radius:4px;padding:7px 14px;cursor:pointer;">Load</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        const ta = overlay.querySelector('#jl-paste-quoted-ta');
        const count = overlay.querySelector('#jl-paste-quoted-count');
        ta.addEventListener('input', () => {
            const n = parseJobRefs(ta.value).length;
            count.textContent = `${n} job ID${n === 1 ? '' : 's'} detected`;
        });
        overlay.querySelector('#jl-paste-quoted-cancel').onclick = () => overlay.remove();
        overlay.querySelector('#jl-paste-quoted-ok').onclick = () => {
            jobRefs = parseJobRefs(ta.value);
            overlay.remove();
            if (jobRefs.length) {
                log(`Loaded ${jobRefs.length} job refs: ${jobRefs.slice(0, 10).join(', ')}${jobRefs.length > 10 ? '...' : ''}`, '#0af');
                setProgress(`${jobRefs.length} jobs ready. Click Start.`);
                startBtn.disabled = false;
            } else {
                setProgress('No valid job numbers found.');
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

    // Resolve job ref -> { id, number, status }
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

    // Complete a job (Cancel open visits = true)
    async function completeJobApi(internalId, dryRun) {
        const html = await fetchText('/Job/CompleteJob/' + internalId);
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const token = getCsrfTokenFromDoc(doc);
        if (!token) throw new Error('No CSRF token on /Job/CompleteJob modal');

        const dateInput = doc.querySelector('#DateComplete, input[name="DateComplete"]');
        let dateStr = dateInput && dateInput.value ? dateInput.value : null;
        if (!dateStr) {
            const now = new Date();
            const pad = (n) => String(n).padStart(2, '0');
            dateStr = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
        }

        const fd = new FormData();
        fd.append('Id', internalId);
        fd.append('DateComplete', dateStr);
        fd.append('CancelOpenVisits', 'true');
        fd.append('__RequestVerificationToken', token);

        if (dryRun) return { dry: true };

        const resp = await fetch('/api/Job/CompleteJobPost', {
            method: 'POST', credentials: 'same-origin', body: fd
        });
        if (!resp.ok) throw new Error('CompleteJobPost HTTP ' + resp.status);
        const result = await resp.json().catch(() => ({}));
        if (result.success === false) throw new Error(result.Message || 'CompleteJobPost success=false');
        return result;
    }

    // Extract embedded job-state JSON blob from the detail page HTML
    function extractJobState(html, internalId) {
        const anchor = `"Id":${internalId}`;
        const i = html.indexOf(anchor);
        if (i < 0) throw new Error(`Job state anchor "${anchor}" not in HTML`);
        // walk backward through nesting to find the outer "{"
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
        // walk forward matching braces, ignoring braces inside strings
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

    // Tag a job with "Quoted and Closed" via /api/Job/EditDetail
    async function addTag(internalId, jobNumber, dryRun, _retry = 0) {
        const html = await fetchText('/Job/Detail/' + internalId);
        const job = extractJobState(html, internalId);
        const tokenMatch = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
        const csrfToken = tokenMatch ? tokenMatch[1] : '';

        const existingTagIds = Array.isArray(job.TagIds)
            ? job.TagIds.map(String)
            : (Array.isArray(job.Tags) ? job.Tags.map(t => String(t.Id || t.TagId || t)) : []);
        if (existingTagIds.includes(QUOTED_AND_CLOSED_ID)) return { alreadyTagged: true };
        const newTagIds = [...existingTagIds, QUOTED_AND_CLOSED_ID];

        // Build urlencoded body matching the captured Save payload exactly
        const entries = [];
        const push = (k, v) => entries.push([k, v == null ? '' : String(v)]);

        push('Id', job.Id);
        push('AssignedToUserId', job.AssignedToUserId);
        newTagIds.forEach((id, idx) => push(`TagIds[${idx}]`, id));
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

        if (dryRun) return { dry: true, fieldCount: entries.length };

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
            // Retry once on 400 — server may be in transient state after a recent update
            if (resp.status === 400 && _retry < 1) {
                await sleep(2500);
                return addTag(internalId, jobNumber, dryRun, _retry + 1);
            }
            throw new Error(`EditDetail HTTP ${resp.status}: ${respText.slice(0, 400)}`);
        }
        let json = {};
        try { json = JSON.parse(respText); } catch (e) {}
        if (json.success === false) {
            throw new Error('EditDetail success=false: ' + (json.Message || respText.slice(0, 300)));
        }
        return { status: resp.status };
    }

    // =======================================================================
    // Main loop — tag first (while editable), then complete
    // =======================================================================
    async function startProcess() {
        if (running || !jobRefs.length) return;
        running = true;
        startBtn.style.display = 'none';
        stopBtn.style.display = 'inline-block';
        logArea.innerHTML = '';

        const dryRun = dryCheck.checked;
        log(dryRun ? 'DRY RUN — no changes will be made' : 'LIVE MODE — jobs will be completed and tagged',
            dryRun ? '#ff0' : '#f55');
        log(`Processing ${jobRefs.length} jobs...`, '#0af');
        log('');

        const stats = { completed: 0, tagged: 0, alreadyTagged: 0, notFound: 0, errors: 0 };
        const failed = [];

        for (let i = 0; i < jobRefs.length; i++) {
            if (!running) { log('Stopped by user.', '#f55'); break; }
            const ref = jobRefs[i];
            setProgress(`Processing ${i + 1}/${jobRefs.length}: ${ref}`);
            log(`--- [${i + 1}/${jobRefs.length}] ${ref} ---`, '#fff');

            try {
                const job = await searchJob(ref);
                if (!job) {
                    log('  Not found in search', '#f55');
                    stats.notFound++;
                    failed.push(ref + ' (not found)');
                    continue;
                }
                log(`  Resolved -> internalId=${job.id}`, '#0af');

                // Tag first (EditDetail rejects tag changes on completed jobs
                // without a fresh CSRF token; simpler to tag while still editable)
                let tagError = null;
                try {
                    const tagRes = await addTag(job.id, ref, dryRun);
                    if (tagRes.alreadyTagged) {
                        log(`  Tag "${TAG_NAME}" already present`, '#0a8');
                        stats.alreadyTagged++;
                    } else if (tagRes.dry) {
                        log(`  [DRY] Would tag "${TAG_NAME}" (${tagRes.fieldCount} fields)`, '#ff0');
                        stats.tagged++;
                    } else {
                        log(`  Tagged "${TAG_NAME}"`, '#0fa');
                        stats.tagged++;
                    }
                } catch (e) {
                    log(`  TAG FAILED: ${e.message}`, '#f55');
                    tagError = e.message;
                }

                try {
                    await completeJobApi(job.id, dryRun);
                    log(`  Completed${dryRun ? ' (DRY)' : ''}`, '#0fa');
                    stats.completed++;
                } catch (e) {
                    log(`  COMPLETE FAILED: ${e.message}`, '#f55');
                    stats.errors++;
                    failed.push(ref + ' (complete: ' + e.message + (tagError ? '; tag: ' + tagError : '') + ')');
                    continue;
                }

                if (tagError) {
                    stats.errors++;
                    failed.push(ref + ' (tag: ' + tagError + ')');
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
        log(`Completed:      ${stats.completed}`, '#0fa');
        log(`Tagged:         ${stats.tagged}`, '#0fa');
        log(`Already tagged: ${stats.alreadyTagged}`, '#888');
        log(`Not found:      ${stats.notFound}`, '#fa0');
        log(`Errors:         ${stats.errors}`, stats.errors ? '#f55' : '#888');
        if (failed.length) {
            log('');
            log('Failed:', '#f55');
            failed.forEach(f => log('  ' + f, '#f99'));
        }
        setProgress(`Done. ${stats.completed}/${jobRefs.length} completed.`);

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
