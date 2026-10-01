// ==UserScript==
// @name         Joblogic - Project Invoice Lines → 202 Projects Income
// @namespace    http://tampermonkey.net/
// @version      0.1.0
// @description  When a DRAFT invoice is opened — raised from a job (/Invoice/Detail) or a Customer Grouped / consolidated invoice (/CGroupInvoice/Detail) — every line belonging to a job whose type is "Project" is re-coded to "202 - Projects Income". Re-checks after lines are added or edited. Approved invoices, PPM invoices and non-Project lines are never touched. Runs automatically; a toast reports what changed.
// @match        https://go.joblogic.com/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Projects/joblogic-project-invoice-nominal.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Projects/joblogic-project-invoice-nominal.user.js
// ==/UserScript==

(function () {
    'use strict';

    const VERSION = '0.1.0';
    const TARGET_JOB_TYPE = 'Project';
    const TARGET_NOMINAL_MATCH = /^202\s*-\s*Projects Income$/i;
    // "202 - Projects Income" as of 2026-10-01; re-resolved from /NominalCode/GetNominalCodes at runtime.
    const FALLBACK_NOMINAL = { Id: 'c5f5ae48-c11a-431a-a9a9-c28e149aee97', Description: '202 - Projects Income' };
    const DELAY_LINE = 300;
    const RELOAD_GUARD_KEY = 'jl-proj-inv-nominal-reloaded';

    // Two invoice flavours share one flow; only the URLs and the embedded model names differ.
    const KINDS = {
        standard: {
            pathRe: /^\/Invoice\/Detail\/(\d+)/i,
            linesUrl: (id) => '/Invoice/GetLines?invoiceId=' + id,
            linesVar: 'var MInvoices = ',
            modalUrl: (lineId, id) => '/Invoice/UpdateLine?id=' + encodeURIComponent(lineId) + '&invoiceId=' + encodeURIComponent(id),
            modalModel: 'var LineModel = ',
            saveUrl: '/api/Invoice/SaveLine',
        },
        cgroup: {
            pathRe: /^\/CGroupInvoice\/Detail\/([0-9a-f-]{36})/i,
            linesUrl: (id) => '/CGroupInvoice/GetLines?invoiceId=' + id,
            linesVar: 'var InvoicesPM = ',
            modalUrl: (lineId, id) => '/CGroupInvoice/UpdateLine?id=' + encodeURIComponent(lineId) + '&invoiceId=' + encodeURIComponent(id),
            modalModel: 'Model: ',
            saveUrl: '/CGroupInvoice/SaveInvoiceLine',
        },
    };

    let kind = null, invoiceId = null;
    for (const k of Object.keys(KINDS)) {
        const m = location.pathname.match(KINDS[k].pathRe);
        if (m) { kind = KINDS[k]; invoiceId = m[1]; break; }
    }
    if (!kind) return;

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const getHtml = (url) => fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url); return r.text(); });
    const pageToken = () => { const el = document.querySelector('input[name="__RequestVerificationToken"]'); return el ? el.value : ''; };

    // Balanced-bracket JSON extractor: the object starting at the first '{' after `needle`.
    function extractObject(html, needle) {
        const at = html.indexOf(needle);
        if (at < 0) return null;
        const start = html.indexOf('{', at);
        if (start < 0) return null;
        let depth = 0, inStr = false, esc = false;
        for (let i = start; i < html.length; i++) {
            const ch = html[i];
            if (esc) { esc = false; continue; }
            if (ch === '\\') { esc = true; continue; }
            if (ch === '"') { inStr = !inStr; continue; }
            if (inStr) continue;
            if (ch === '{') depth++;
            else if (ch === '}') { depth--; if (depth === 0) { try { return JSON.parse(html.slice(start, i + 1)); } catch (e) { return null; } } }
        }
        return null;
    }

    // ---------------- lookups (cached) ----------------
    let nominalPromise = null;
    function getNominal() {
        if (!nominalPromise) {
            nominalPromise = getHtml('/NominalCode/GetNominalCodes')
                .then(t => JSON.parse(t))
                .then(list => (Array.isArray(list) && list.find(n => TARGET_NOMINAL_MATCH.test(n.Description))) || FALLBACK_NOMINAL)
                .catch(() => FALLBACK_NOMINAL);
        }
        return nominalPromise;
    }

    const jobTypeCache = new Map();
    function getJobType(jobId) {
        jobId = String(jobId);
        if (!jobTypeCache.has(jobId)) {
            jobTypeCache.set(jobId, getHtml('/Job/Detail/' + jobId)
                .then(h => { const m = h.match(/"JobTypeDescription":"([^"]*)"/); return m ? m[1] : null; })
                .catch(() => null));
        }
        return jobTypeCache.get(jobId);
    }

    // A standard invoice's lines carry no JobId — the job is the one the invoice was raised from,
    // linked from the detail page header.
    let invoiceJobPromise = null;
    function getInvoiceJobId() {
        if (!invoiceJobPromise) {
            const fromDom = (document.documentElement.innerHTML.match(/\/Job\/Detail\/(\d+)/) || [])[1];
            invoiceJobPromise = fromDom ? Promise.resolve(fromDom)
                : getHtml(location.pathname).then(h => (h.match(/\/Job\/Detail\/(\d+)/) || [])[1] || null).catch(() => null);
        }
        return invoiceJobPromise;
    }

    async function readLines() {
        const model = extractObject(await getHtml(kind.linesUrl(invoiceId)), kind.linesVar);
        if (!model) throw new Error('could not read the invoice lines');
        return model;
    }

    // ---------------- save one line ----------------
    // Rebuild the line-edit modal's own form, override the nominal code, POST it back
    // the way the page's unobtrusive-ajax submit does (urlencoded, token as header).
    async function setLineNominal(line, nom) {
        const html = await getHtml(kind.modalUrl(line.Id, invoiceId));
        const token = (html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/) || [])[1] || pageToken();
        const model = extractObject(html, kind.modalModel) || {};
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const form = doc.querySelector('#addUpdateInvoiceLineForm') || doc;

        const params = new URLSearchParams();
        const count = {};
        const push = (n, v) => { params.append(n, v == null ? '' : String(v)); count[n] = (count[n] || 0) + 1; };

        form.querySelectorAll('input[name], select[name], textarea[name]').forEach(el => {
            const n = el.name;
            if (n === '__RequestVerificationToken') return;
            if (el.tagName === 'SELECT') {
                count[n] = count[n] || 0;
                [...el.options].filter(o => o.selected).forEach(o => push(n, o.value));
                return;
            }
            if (el.type === 'checkbox' || el.type === 'radio') {
                count[n] = count[n] || 0;
                if (el.checked) push(n, el.value || 'true');
                return;
            }
            push(n, n === 'NominalCodeId' ? nom.Id : (el.value || ''));
        });

        if (!count.NominalCodeId) push('NominalCodeId', nom.Id);
        // Kendo combobox companions — a real submit posts the visible text too.
        push('NominalCodeId_input', nom.Description);
        if (count.TaxCodeId) push('TaxCodeId_input', model.TaxCodeDescription || '');
        // Description is a Vue <ai-text-area>, so it is not in the raw HTML — send the
        // current wording back or the line would be blanked.
        if (!count.Description && model.IsInvoiceApproved !== true) push('Description', model.Description != null ? model.Description : (line.Description || ''));
        if (!count.TagIds && Array.isArray(model.TagIds)) model.TagIds.forEach(t => push('TagIds', t));

        const r = await fetch(kind.saveUrl, {
            method: 'POST', credentials: 'same-origin',
            headers: {
                'X-Requested-With': 'XMLHttpRequest',
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                '__RequestVerificationToken': token,
            },
            body: params.toString(),
        });
        const txt = await r.text().catch(() => '');
        if (!r.ok) throw new Error('save HTTP ' + r.status + ': ' + txt.slice(0, 160));
        let j = null; try { j = JSON.parse(txt); } catch (e) { /* html response is fine */ }
        if (j && j.success === false) throw new Error((j.errors && j.errors.join('; ')) || j.Message || 'save refused');
    }

    // ---------------- main pass ----------------
    let running = false, rerun = false;
    async function run() {
        if (running) { rerun = true; return; }
        running = true;
        try {
            const model = await readLines();
            if (model.IsInvoiceApproved) return;              // drafts only
            const nom = await getNominal();
            const invoiceJob = kind === KINDS.standard ? await getInvoiceJobId() : null;

            const todo = [];
            for (const line of model.Lines || []) {
                if (line.IsDiscountLine) continue;
                if ((line.NominalCode || '') === nom.Description) continue;
                const jobId = line.JobId || invoiceJob;
                if (!jobId) continue;
                if ((await getJobType(jobId)) === TARGET_JOB_TYPE) todo.push(line);
            }
            if (!todo.length) { sessionStorage.removeItem(RELOAD_GUARD_KEY); return; }

            const errors = [];
            for (const line of todo) {
                try { await setLineNominal(line, nom); }
                catch (e) { errors.push(e.message || String(e)); console.error('[Project invoice nominal]', line, e); }
                await sleep(DELAY_LINE);
            }

            // Verify against a fresh read — Joblogic can answer success and still drop a save.
            const after = await readLines();
            const byId = new Map((after.Lines || []).map(l => [String(l.Id), l]));
            const ok = todo.filter(l => (byId.get(String(l.Id)) || {}).NominalCode === nom.Description).length;

            if (ok === todo.length) {
                toast(`Project job: ${ok} line${ok > 1 ? 's' : ''} set to ${nom.Description} (v${VERSION})`);
            } else {
                toast(`Project job: only ${ok}/${todo.length} lines set to ${nom.Description} — check the rest manually`, true);
                if (errors.length) console.warn('[Project invoice nominal] errors:', errors);
            }
            // The lines grid shows the old codes until it is re-rendered; reload once
            // (guarded so a line that refuses to change can't loop the page).
            if (ok > 0 && !sessionStorage.getItem(RELOAD_GUARD_KEY)) {
                sessionStorage.setItem(RELOAD_GUARD_KEY, '1');
                setTimeout(() => location.reload(), 1500);
            } else {
                sessionStorage.removeItem(RELOAD_GUARD_KEY);
            }
        } catch (e) {
            console.error('[Project invoice nominal]', e);
            toast('Project invoice nominal script failed: ' + (e.message || e), true);
        } finally {
            running = false;
            if (rerun) { rerun = false; run(); }
        }
    }

    // ---------------- toast ----------------
    function toast(msg, isErr) {
        const d = document.createElement('div');
        d.textContent = msg;
        d.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:100001;padding:9px 14px;border-radius:4px;color:#fff;font:13px "Open Sans",sans-serif;box-shadow:0 2px 6px rgba(0,0,0,.3);max-width:480px;background:' + (isErr ? '#c0392b' : '#27ae60') + ';';
        document.body.appendChild(d);
        setTimeout(() => d.remove(), isErr ? 9000 : 5000);
    }

    // ---------------- re-check after the user adds / edits lines ----------------
    // The page's line add/edit/auto-update calls go through jQuery (XHR). Our own saves use
    // fetch, so they don't retrigger this.
    const LINE_CHANGE_RE = /\/(api\/)?(Invoice|CGroupInvoice)\/(?!GetLines)[A-Za-z]*(Line|AutoUpdate)[A-Za-z]*/i;
    let debounce = null;
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
        if (String(method).toUpperCase() === 'POST' && LINE_CHANGE_RE.test(String(url || ''))) {
            this.addEventListener('loadend', () => {
                clearTimeout(debounce);
                debounce = setTimeout(() => { sessionStorage.removeItem(RELOAD_GUARD_KEY); run(); }, 1500);
            });
        }
        return origOpen.apply(this, arguments);
    };

    run();
})();
