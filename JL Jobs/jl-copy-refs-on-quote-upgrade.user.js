// ==UserScript==
// @name         Joblogic - Copy Refs on Quote Upgrade
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  When a quote raised against a parent job is upgraded to a job, copy the parent job's Reference Number (CustomReference) and Job Ref 1 (JobUserReferenceFieldValue) onto the newly created child job. Runs silently on /Job/Detail/* and /Quote/Detail/* views, only fills fields that are empty, and never writes twice for the same pair. Shows a temporary note of what it wrote - click it to reload the page.
// @match        https://go.joblogic.com/Job/Detail/*
// @match        https://go.joblogic.com/Quote/Detail/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/jl-copy-refs-on-quote-upgrade.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/jl-copy-refs-on-quote-upgrade.user.js
// ==/UserScript==

/*
 * Chain handled:   Parent Job  >  Quote raised on it & upgraded  >  Child Job created
 *
 * On viewing either the quote or the child job, the script:
 *   1. resolves the quote (from the URL, or from the job model's "QuoteId"),
 *   2. reads OriginalJobNumber (parent) + UpgradedIntoJobNumber (child) off /Quote/Detail/{id},
 *   3. loads both job models,
 *   4. copies parent -> child for Reference Number and Job Ref 1, ONLY where the child field is
 *      empty (an existing child value is never overwritten - it is logged as skipped),
 *   5. saves via /api/Job/EditDetail with the child's full detail payload.
 *
 * Does nothing when the quote has no parent job, the quote is not upgraded, or both target
 * fields are already populated. Successful writes are cached in localStorage so revisiting the
 * page is a no-op; failures are not cached, so they retry on the next view.
 */

(function () {
    'use strict';

    const TAG = '[JL refs-on-upgrade]';
    const DONE_KEY = 'jl-copy-refs-on-upgrade-done';   // { "<childId>:<parentId>": ts }
    const log = (...a) => console.log(TAG, ...a);
    const warn = (...a) => console.warn(TAG, ...a);

    // Fields copied parent -> child. label is what the JL UI calls them.
    const COPY_FIELDS = [
        { key: 'CustomReference', label: 'Reference Number' },
        { key: 'JobUserReferenceFieldValue', label: 'Job Ref 1' }
    ];

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const clean = (v) => (v == null ? '' : String(v).trim());

    // =======================================================================
    // dedupe cache
    // =======================================================================
    function readDone() {
        try { return JSON.parse(localStorage.getItem(DONE_KEY)) || {}; } catch (e) { return {}; }
    }
    function markDone(key) {
        try {
            const d = readDone();
            d[key] = Date.now();
            // keep the cache from growing without bound
            const keys = Object.keys(d);
            if (keys.length > 400) keys.sort((a, b) => d[a] - d[b]).slice(0, keys.length - 400).forEach(k => delete d[k]);
            localStorage.setItem(DONE_KEY, JSON.stringify(d));
        } catch (e) { /* private mode etc - just means we may re-check next view */ }
    }
    function isDone(key) { return !!readDone()[key]; }

    // =======================================================================
    // toast
    // =======================================================================
    // reloadOnClick: clicking the note refreshes the page so the new values show.
    function toast(text, kind, reloadOnClick) {
        const bg = kind === 'error' ? '#7d2b1f' : (kind === 'info' ? '#0e3a4f' : '#1f5c3a');
        const el = document.createElement('div');
        el.style.cssText = 'position:fixed;bottom:18px;right:18px;z-index:100001;max-width:360px;' +
            'background:' + bg + ';color:#eef4f7;font-family:"Open Sans",sans-serif;font-size:12px;' +
            'line-height:1.5;padding:10px 12px;border-radius:4px;border-left:3px solid #ff7919;' +
            'box-shadow:0 2px 8px rgba(0,0,0,.35);cursor:pointer;white-space:pre-line;';
        el.textContent = text;
        el.title = reloadOnClick ? 'click to reload the page' : 'click to dismiss';
        el.addEventListener('click', () => {
            if (reloadOnClick) { el.style.opacity = '0.6'; location.reload(); return; }
            el.remove();
        });
        document.body.appendChild(el);
        setTimeout(() => el.remove(), kind === 'error' ? 20000 : 12000);
        return el;
    }

    // =======================================================================
    // API helpers  (same patterns as the other JL scripts)
    // =======================================================================
    async function fetchText(url) {
        const resp = await fetch(url, {
            credentials: 'same-origin',
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });
        if (!resp.ok) throw new Error('HTTP ' + resp.status + ' on ' + url);
        return await resp.text();
    }

    function csrfFromDoc(doc = document) {
        const el = doc.querySelector('input[name="__RequestVerificationToken"]');
        return el ? el.value : '';
    }
    function csrfFromHtml(html) {
        const m = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
        return m ? m[1] : '';
    }

    const rx = (text, re) => { const m = text.match(re); return m ? m[1] : null; };

    // Pull the embedded job-detail model out of a /Job/Detail/{id} page.
    function extractJobState(html, internalId) {
        const anchor = `"Id":${internalId}`;
        const i = html.indexOf(anchor);
        if (i < 0) throw new Error(`Job state anchor "${anchor}" not in HTML`);
        let depth = 0, start = -1;
        for (let p = i; p >= 0; p--) {
            const c = html[p];
            if (c === '}') depth++;
            else if (c === '{') { if (depth === 0) { start = p; break; } depth--; }
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

    async function loadJob(internalId) {
        const html = await fetchText('/Job/Detail/' + internalId);
        return { job: extractJobState(html, internalId), token: csrfFromHtml(html) };
    }

    // Job number (e.g. PROJ0000625) -> { id, number }
    async function searchJob(jobRef) {
        const resp = await fetch('/api/Job/SearchJsonData', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                '__RequestVerificationToken': csrfFromDoc()
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
        if (!resp.ok) throw new Error('SearchJsonData HTTP ' + resp.status);
        const data = await resp.json();
        const jobs = (data.AdditionalData && data.AdditionalData.Jobs) || data.Data || [];
        if (!jobs.length) return null;
        const target = clean(jobRef).toUpperCase();
        const match = jobs.find(j => clean(j.JobNumber).toUpperCase() === target ||
                                     clean(j.ReferenceNumber).toUpperCase() === target);
        if (!match) return null;   // never guess - a wrong job id here would write to the wrong record
        return { id: match.Id || match.JobId, number: match.JobNumber || match.ReferenceNumber || jobRef };
    }

    // Save the child job with the copied values, preserving every other detail field.
    async function saveJobDetail(job, overrides, token, _retry = 0) {
        const entries = [];
        const push = (k, v) => entries.push([k, v == null ? '' : String(v)]);
        const val = (k) => (Object.prototype.hasOwnProperty.call(overrides, k) ? overrides[k] : job[k]);

        push('Id', job.Id);
        push('AssignedToUserId', job.AssignedToUserId);
        const tagIds = Array.isArray(job.TagIds)
            ? job.TagIds.map(String)
            : (Array.isArray(job.Tags) ? job.Tags.map(t => String(t.Id || t.TagId || t)) : []);
        tagIds.forEach((id, idx) => push(`TagIds[${idx}]`, id));
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
        push('JobFaultCode[ReportedFaultCodeId]', fc.ReportedFaultCodeId);
        push('JobFaultCode[ReportedFaultCodeName]', fc.ReportedFaultCodeName);
        push('JobFaultCode[ReportedSubFaultCodeId]', fc.ReportedSubFaultCodeId);
        push('JobFaultCode[ReportedSubFaultCodeName]', fc.ReportedSubFaultCodeName);
        push('JobFaultCode[ActualFaultCodeId]', fc.ActualFaultCodeId);
        push('JobFaultCode[ActualFaultCodeName]', fc.ActualFaultCodeName);
        push('JobFaultCode[ActualSubFaultCodeId]', fc.ActualSubFaultCodeId);
        push('JobFaultCode[ActualSubFaultCodeName]', fc.ActualSubFaultCodeName);

        push('JobCategoryId', job.JobCategoryId);
        push('PriorityId', job.PriorityId);
        push('OrderNumber', val('OrderNumber'));
        push('CustomReference', val('CustomReference'));
        push('IsRequireApproval', job.IsRequireApproval);
        push('CompletionTimeSinceOnSite', job.CompletionTimeSinceOnSite);
        push('JobUserReferenceFieldValue', val('JobUserReferenceFieldValue'));
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
        if (token) headers['__RequestVerificationToken'] = token;

        const resp = await fetch('/api/Job/EditDetail', {
            method: 'POST',
            credentials: 'same-origin',
            referrer: `${location.origin}/Job/Detail/${job.Id}`,
            referrerPolicy: 'unsafe-url',
            headers,
            body
        });
        const text = await resp.text().catch(() => '');
        if (!resp.ok) {
            if (resp.status === 400 && _retry < 1) {          // transient right after an upgrade
                await sleep(2500);
                return saveJobDetail(job, overrides, token, _retry + 1);
            }
            throw new Error(`EditDetail HTTP ${resp.status}: ${text.slice(0, 300)}`);
        }
        let json = {};
        try { json = JSON.parse(text); } catch (e) { /* some saves return HTML */ }
        if (json && json.success === false) {
            throw new Error(json.Message || json.message || 'EditDetail returned success:false');
        }
        return json;
    }

    // =======================================================================
    // main
    // =======================================================================

    // Which quote does this page relate to, and (if we already know it) which child job?
    async function resolveContext() {
        let m = location.pathname.match(/\/Quote\/Detail\/(\d+)/);
        if (m) return { quoteId: m[1], childId: null, childJob: null, childToken: '' };

        m = location.pathname.match(/\/Job\/Detail\/(\d+)/);
        if (!m) return null;
        const childId = m[1];
        const { job, token } = await loadJob(childId);
        const quoteId = clean(job.QuoteId);
        if (!quoteId || quoteId === '0') return null;      // job did not come from a quote
        return { quoteId, childId, childJob: job, childToken: token };
    }

    async function run() {
        const ctx = await resolveContext();
        if (!ctx) return;

        const qHtml = await fetchText('/Quote/Detail/' + ctx.quoteId);
        const quoteNumber = rx(qHtml, /"QuoteNumber"\s*:\s*"([^"]*)"/) || ctx.quoteId;
        const parentNumber = clean(rx(qHtml, /"OriginalJobNumber"\s*:\s*"([^"]*)"/) ||
                                   rx(qHtml, /"ParentJobStringId"\s*:\s*"([^"]*)"/));
        const upgradedNumber = clean(rx(qHtml, /"UpgradedIntoJobNumber"\s*:\s*"([^"]*)"/));

        if (!parentNumber) { log('quote', quoteNumber, 'has no parent job - nothing to do'); return; }
        if (!upgradedNumber) { log('quote', quoteNumber, 'not upgraded yet - nothing to do'); return; }

        // Resolve the child job (already in hand on a job page).
        let childId = ctx.childId, childJob = ctx.childJob, childToken = ctx.childToken;
        if (!childId) {
            const found = await searchJob(upgradedNumber);
            if (!found) { warn('could not resolve upgraded job', upgradedNumber); return; }
            childId = found.id;
        }

        // On a job page, make sure this really is the job the quote was upgraded into
        // (a parent job also carries a QuoteId pointing at its quote).
        if (childJob) {
            const thisNumber = clean(childJob.JobNumber || childJob.ReferenceNumber);
            if (thisNumber && thisNumber.toUpperCase() !== upgradedNumber.toUpperCase()) {
                log('this job (' + thisNumber + ') is not the upgraded job (' + upgradedNumber + ') - skipping');
                return;
            }
        }

        const parent = await searchJob(parentNumber);
        if (!parent) { warn('could not resolve parent job', parentNumber); return; }
        if (String(parent.id) === String(childId)) { log('parent and child resolve to the same job - skipping'); return; }

        const doneKey = childId + ':' + parent.id;
        if (isDone(doneKey)) { log('already handled', doneKey); return; }

        const parentJob = (await loadJob(parent.id)).job;
        if (!childJob) {
            const loaded = await loadJob(childId);
            childJob = loaded.job;
            childToken = loaded.token;
        }
        if (!childToken) childToken = csrfFromDoc();

        const overrides = {}, applied = [], skipped = [];
        for (const f of COPY_FIELDS) {
            const src = clean(parentJob[f.key]);
            const dst = clean(childJob[f.key]);
            if (!src) { log(f.label + ': parent is empty - nothing to copy'); continue; }
            if (dst === src) { log(f.label + ': child already matches'); continue; }
            if (dst) { skipped.push(`${f.label}: kept "${dst}" (parent has "${src}")`); continue; }
            overrides[f.key] = parentJob[f.key];
            applied.push(`${f.label}: "${src}"`);
        }

        if (!applied.length) {
            if (skipped.length) log('nothing to write -', skipped.join(' | '));
            markDone(doneKey);          // no work needed; don't re-check this pair
            return;
        }

        log('writing to', upgradedNumber, 'from', parentNumber, overrides);
        try {
            await saveJobDetail(childJob, overrides, childToken);
        } catch (e) {
            warn('save failed', e);
            toast(`Ref copy FAILED\n${parentNumber} → ${upgradedNumber}\n${e.message}`, 'error');
            return;                     // not cached - retries on next view
        }
        markDone(doneKey);

        let msg = `Copied from parent ${parentNumber} → ${upgradedNumber}\n` + applied.join('\n');
        if (skipped.length) msg += '\nSkipped (already set):\n' + skipped.join('\n');
        msg += '\n\nClick this note to reload and see the new values.';
        toast(msg, 'ok', true);
        log('done', { parentNumber, upgradedNumber, quoteNumber, applied, skipped });
    }

    // ---- run on load, and again on SPA-style URL changes -------------------
    let lastPath = '';
    function maybeRun() {
        const path = location.pathname;                    // hash tab switches are ignored
        if (path === lastPath) return;
        lastPath = path;
        if (!/^\/(Job|Quote)\/Detail\/\d+/.test(path)) return;
        run().catch(e => { warn('error', e); });
    }

    maybeRun();
    (function () {
        const wrap = (fn) => function () { const r = fn.apply(this, arguments); setTimeout(maybeRun, 400); return r; };
        history.pushState = wrap(history.pushState);
        history.replaceState = wrap(history.replaceState);
        window.addEventListener('popstate', () => setTimeout(maybeRun, 400));
    })();
})();
