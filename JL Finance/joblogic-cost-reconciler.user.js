// ==UserScript==
// @name         Joblogic - Cost Reconciler (Pleo expenses vs Job Logic costs)
// @namespace    http://tampermonkey.net/
// @version      2.14
// @description  Paste a Pleo/CSV expense export. For each row the script finds the job (by Job ref / Salesforce ref / Quote UP-number), reads the Costs page (and parent/related Quote + delivered PO costs), and checks whether the receipt's NET value is already in the job. Flags rows as Already in job / Incorrect / Possible / On undelivered PO / Not in job / No costs / etc. Stage 1 is read-only analysis; Stage 2 can bulk-add the NO-COSTS rows to their jobs as chargeable material lines (Net, qty 1, 20% VAT, Xero description + date; engineer left blank). v2.0: adds Stage 2 writer. v2.2: Copy results now also emits Job ID, Cost description and Chargeable (No for project/quoted jobs) columns so the companion "Enter checked costs into jobs" writer can consume the filtered export.
// @match        https://go.joblogic.com/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Finance/joblogic-cost-reconciler.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Finance/joblogic-cost-reconciler.user.js
// ==/UserScript==

(function () {
    'use strict';

    // ===================================================================
    // CONFIG
    // ===================================================================
    const DELAY_BETWEEN_ROWS = 250;     // ms politeness delay between sheet rows
    const MONEY_TOL_ABS = 0.02;         // absolute £ tolerance for a "match"
    const MONEY_TOL_PCT = 0.005;        // + 0.5% relative tolerance (rounding)
    const VAT_FALLBACK = 0.20;          // assumed VAT rate when sheet has none

    // ===================================================================
    // STATE
    // ===================================================================
    let panel, pasteArea, logArea, scanBtn, runBtn, stopBtn, copyBtn, stage2Btn, confirmBtn, progressText, resultsBox;
    let stage2Items = [], stage2Running = false;

    // This script's identity in the shared dock (keep unique per script).
    const SCRIPT_ID = 'cost-reconciler';
    const SCRIPT_LABEL = '💷 Check costs are in Jobs correctly';
    const SCRIPT_VERSION = ((typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || '2.14');
    const SCRIPT_COLOR = '#4c9f01';
    const SCRIPT_DESC = 'Checks whether Pleo receipts are entered correctly on their jobs. Paste the Pleo export including the header row and click Check costs. Each row is flagged Already in job, Incorrect (with the reason), or Not found. Read-only.';
    let running = false;
    let rows = [];          // parsed sheet rows
    let results = [];       // per-row outcome (for Copy)
    const jobCache = new Map();   // jobId -> { lines:[...] }
    const searchCache = new Map();// term -> {id, jobNumber} | null

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const csrf = () => document.querySelector('input[name="__RequestVerificationToken"]')?.value || '';

    // ===================================================================
    // NUMBER / TEXT HELPERS
    // ===================================================================
    // "£1,234.56" / "-29.98" / "25" -> 1234.56 / 29.98 / 25 (always positive magnitude)
    function money(v) {
        if (v == null) return null;
        const s = String(v).replace(/[£$,\s]/g, '').replace(/[()]/g, '');
        const n = parseFloat(s);
        return isNaN(n) ? null : Math.abs(n);
    }
    // "20.00%" / "20% (VAT on Expenses)" / "0.2" -> 0.20
    function vatRate(v) {
        if (v == null || v === '') return null;
        const s = String(v);
        const pct = s.match(/(\d+(?:\.\d+)?)\s*%/);
        if (pct) return parseFloat(pct[1]) / 100;
        const num = parseFloat(s);
        if (isNaN(num)) return null;
        return num > 1 ? num / 100 : num;   // 20 -> 0.20, 0.2 -> 0.2
    }
    // "1.00" -> 1 ; "0h 0m" / "1h 30m" -> hours as decimal ; "" -> null
    function qtyNum(v) {
        if (v == null || v === '') return null;
        const s = String(v).trim();
        const hm = s.match(/(\d+)\s*h\s*(\d+)?\s*m?/i);
        if (hm) return parseInt(hm[1], 10) + (hm[2] ? parseInt(hm[2], 10) / 60 : 0);
        const n = parseFloat(s.replace(/,/g, ''));
        return isNaN(n) ? null : n;
    }
    const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();

    // Two money values "equal" within tolerance
    function eqMoney(a, b) {
        if (a == null || b == null) return false;
        const tol = Math.max(MONEY_TOL_ABS, Math.abs(b) * MONEY_TOL_PCT, Math.abs(a) * MONEY_TOL_PCT);
        return Math.abs(a - b) <= tol;
    }
    // is `ratio` close to integer k (>=2)?  returns k or null
    function nearInteger(ratio) {
        if (!isFinite(ratio) || ratio < 1.5) return null;
        const k = Math.round(ratio);
        return Math.abs(ratio - k) <= 0.02 ? k : null;
    }

    // ===================================================================
    // REFERENCE EXTRACTION
    // Pull every candidate reference out of free text (Note, Source desc).
    // Priority: Job ref (RE/PROJ/R/M) > Salesforce (8 digits, leading 1) > Quote (UP).
    // ===================================================================
    const RE_JOBREF = /\b(?:RE|PROJ|PM|M|R)\s?0*\d{2,}\b/gi; // reactive/project/PPM(PM)/maintenance jobs
    const RE_SF      = /\b1\d{7}\b/g;                          // Salesforce: 8 digits starting with 1
    const RE_QUOTE   = /\bUP\s?0*\d{2,}\b/gi;                  // Quote number UP....

    function normJobRef(raw) {
        // "PROJ 1393" -> "PROJ1393" ; "Re0021779" -> "RE0021779"
        return raw.replace(/\s+/g, '').toUpperCase();
    }
    function extractRefs(text) {
        const t = String(text || '');
        const out = { job: [], sf: [], quote: [], internal: [] };
        (t.match(RE_QUOTE) || []).forEach(m => {
            const code = m.replace(/\s+/g, '').toUpperCase();
            // Real quotes look like UP0xxxx (leading zero). Codes like UP1000 are
            // internal materials codes, NOT quotes (per Finance) — don't job-search them.
            if (/^UP0\d+$/.test(code)) out.quote.push(code);
            else out.internal.push(code);
        });
        let t2 = t.replace(RE_QUOTE, ' ');
        (t2.match(RE_JOBREF) || []).forEach(m => out.job.push(normJobRef(m)));
        (t.match(RE_SF) || []).forEach(m => out.sf.push(m));
        out.job = [...new Set(out.job)];
        out.sf = [...new Set(out.sf)];
        out.quote = [...new Set(out.quote)];
        out.internal = [...new Set(out.internal)];
        return out;
    }
    // JL job numbers are PREFIX + 7 zero-padded digits (e.g. PROJ0001393); staff
    // often drop the zeros ("PROJ 1393" / "PROJ1393"). Return forms to try.
    function jobRefCandidates(ref) {
        const m = String(ref).toUpperCase().match(/^(RE|PROJ|PM|M|R)0*(\d+)$/);
        if (!m) return [ref];
        const prefix = m[1], num = m[2];
        return [...new Set([prefix + num.padStart(7, '0'), ref, prefix + ' ' + num, prefix + num])];
    }

    // ===================================================================
    // API: JOB SEARCH
    // ===================================================================
    async function searchJob(term) {
        if (searchCache.has(term)) return searchCache.get(term);
        const r = await fetch('/api/Job/SearchJsonData', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', '__RequestVerificationToken': csrf() },
            body: JSON.stringify({
                SearchTerm: term, PageSize: 10, PageIndex: 1, EngineerType: 0,
                IncludePPMJobs: true, IncludeReactiveJobs: true,
                StartLoggedDate: '', EndLoggedDate: '', StartDate: '', EndDate: '',
                StartCompleteDate: '', EndCompleteDate: '', StartNextContactDate: '', EndNextContactDate: ''
            })
        });
        if (!r.ok) throw new Error('Job search HTTP ' + r.status);
        const d = await r.json();
        const jobs = d.AdditionalData?.Jobs || d.Data || [];
        let res = null;
        if (jobs.length) {
            const exact = jobs.find(j => norm(j.JobNumber) === norm(term) || norm(j.ReferenceNumber) === norm(term));
            const m = exact || jobs[0];
            res = { id: m.Id || m.JobId, jobNumber: m.JobNumber || m.ReferenceNumber || term, multiple: jobs.length, exact: !!exact, jobStatus: m.StatusDescription || '', totalInvoiced: m.TotalInvoiced || '' };
        }
        searchCache.set(term, res);
        return res;
    }

    // API: QUOTE SEARCH -> returns {id, quoteNumber, parentJobId, parentJobNumber}
    let quoteFormNames = null;
    function getQuoteFieldNames() {
        // Canonical field list captured from the live Quotes search form.
        return ['CustomerId', 'SiteId', 'AssetId', 'searchTerm', 'statusIds', 'startDate', 'endDate',
            'ownerIds', 'QuoteDepositStatus', 'chanceOfSale', 'expiryStartDate', 'expiryEndDate',
            'nextContactStartDate', 'nextContactEndDate', 'saleStartDate', 'saleEndDate', 'tagIds',
            'excludeTagIds', 'tradeIds', 'priorityIds', 'assetClassIds', 'areaIds', 'siteTypeIds',
            'OrderBy', 'SelectedTab'];
    }
    async function searchQuote(quoteNumber) {
        const key = 'Q:' + quoteNumber;
        if (searchCache.has(key)) return searchCache.get(key);
        const fd = new FormData();
        getQuoteFieldNames().forEach(n => fd.append(n, n === 'searchTerm' ? quoteNumber : (n === 'SelectedTab' ? 'All' : '')));
        fd.append('PageIndex', '1');
        fd.append('PageSize', '25');
        const r = await fetch('/api/Quote/QuoteSearchJson', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'X-Requested-With': 'XMLHttpRequest', '__RequestVerificationToken': csrf() },
            body: fd
        });
        if (!r.ok) throw new Error('Quote search HTTP ' + r.status);
        const d = await r.json();
        const quotes = d.AdditionalData?.Quotes || [];
        let res = null;
        if (quotes.length) {
            const exact = quotes.find(q => norm(q.QuoteNumber) === norm(quoteNumber)) || quotes[0];
            res = {
                id: exact.Id,
                quoteNumber: exact.QuoteNumber,
                parentJobId: exact.ParentJobAutoId || exact.JobId || null,
                parentJobNumber: exact.ParentJobStringId || exact.JobNumber || null
            };
        }
        searchCache.set(key, res);
        return res;
    }

    // ===================================================================
    // API: EXTRACT EMBEDDED JS OBJECT/ARRAY (var X = {...};) FROM HTML
    // ===================================================================
    function extractJsLiteral(html, varName) {
        const i = html.indexOf(varName);
        if (i < 0) return null;
        const eq = html.indexOf('=', i);
        if (eq < 0) return null;
        let s = eq + 1;
        while (s < html.length && /\s/.test(html[s])) s++;
        if (html[s] !== '{' && html[s] !== '[') return null;
        let depth = 0, inStr = false, esc = false, end = -1;
        for (let j = s; j < html.length; j++) {
            const c = html[j];
            if (esc) { esc = false; continue; }
            if (c === '\\') { esc = true; continue; }
            if (c === '"') { inStr = !inStr; continue; }
            if (inStr) continue;
            if (c === '{' || c === '[') depth++;
            else if (c === '}' || c === ']') { depth--; if (depth === 0) { end = j + 1; break; } }
        }
        if (end < 0) return null;
        try { return JSON.parse(html.slice(s, end)); } catch (e) { return null; }
    }

    // API: JOB COSTS -> flat list of cost lines
    async function getJobCosts(jobId) {
        if (jobCache.has(jobId)) return jobCache.get(jobId);
        const r = await fetch(`/Job/GetCosts?jobId=${jobId}&isReadOnly=False`, {
            credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });
        if (!r.ok) throw new Error('GetCosts HTTP ' + r.status);
        const html = await r.text();
        const model = extractJsLiteral(html, 'JobLinesPM');
        const lines = [];
        if (model && Array.isArray(model.GroupedLines)) {
            model.GroupedLines.forEach(g => {
                (g.Lines || []).forEach(l => {
                    lines.push({
                        source: 'job',
                        category: g.Heading || l.LineType || '',
                        lineType: l.LineType || g.Heading || '',
                        id: l.Id,
                        invoiced: !!l.HasBeenInvoiced,
                        desc: l.Description || '',
                        date: l.DateIncurred || '',
                        engineer: l.EngineerName || '',
                        qtyRaw: l.Quantity,
                        qty: qtyNum(l.Quantity),
                        unit: money(l.CostPerUnit),
                        vat: vatRate(l.VatRate),
                        subtotal: money(l.SubTotalCost)
                    });
                });
            });
        }
        const out = { lines, parseOk: !!model };
        jobCache.set(jobId, out);
        return out;
    }

    // API: UNDELIVERED Supplier PO line items — ordered but not yet delivered, so not
    // on the job's cost page yet. A match means "deliver the PO" (no manual line needed).
    async function getUndeliveredPOLines(jobId) {
        const out = [];
        try {
            const r = await fetch(`/api/JobCost/GetRemainingUndeliveredPOLineItems?jobId=${jobId}`, {
                credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });
            if (!r.ok) return out;
            const j = await r.json();
            (j.AdditionalData?.Items || []).forEach(it => {
                const unit = money(it.ListPrice), q = qtyNum(it.Quantity);
                out.push({
                    source: 'undelivered PO ' + (it.PurchaseOrderNo || ''), poNo: it.PurchaseOrderNo || '', poId: it.PurchaseOrderId || '',
                    category: 'Material', desc: it.Description || '', date: it.Date || '', engineer: '',
                    qtyRaw: it.Quantity, qty: q, unit: unit, vat: null,
                    subtotal: (unit != null && q != null) ? unit * q : unit
                });
            });
        } catch (e) { /* optional */ }
        return out;
    }

    // API: RELATED WORKS -> related/parent quote(s) + their embedded cost lines
    async function getRelatedWorks(jobId) {
        const r = await fetch(`/Job/GetRelatedWorks?jobId=${jobId}`, {
            credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });
        if (!r.ok) throw new Error('GetRelatedWorks HTTP ' + r.status);
        const html = await r.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');

        // Related quote(s). Newer JobLogic embeds them in a `relatedJobsModel` JS object
        // (RelatedQuotes.Quotes) and NO LONGER renders <a href="/Quote/Detail/…"> links, so
        // scraping anchors alone misses every quote. Read the model first, then fall back to
        // any anchor links (older markup). hasActiveQuote ignores rejected/cancelled quotes —
        // those don't make the job "quoted" for charge purposes.
        const quotes = [];
        const seen = new Set();
        const addQuote = (num, id, status) => {
            const key = String(num || id || '').toUpperCase();
            if (!key || seen.has(key)) return;
            seen.add(key);
            quotes.push({
                num: num || ('quote ' + id), id: id || null, status: status || '',
                rejected: /reject|cancel|declin|lost/i.test(status || ''),
                href: id ? (location.origin + '/Quote/Detail/' + id) : null
            });
        };
        const model = extractJsLiteral(html, 'relatedJobsModel');
        ((model && model.RelatedQuotes && model.RelatedQuotes.Quotes) || [])
            .forEach(q => addQuote(q.QuoteNumber || q.QuoteStringId, q.Id || q.QuoteId, q.StatusDescription));
        [...doc.querySelectorAll('a[href*="/Quote/Detail/"]')].forEach(a => {
            const href = a.getAttribute('href') || '';
            const idm = href.match(/\/Quote\/Detail\/(\d+)/);
            addQuote(a.textContent.replace(/\s+/g, ' ').trim(), idm ? idm[1] : null, '');
        });
        const quoteLinks = quotes.map(q => ({ num: q.num, href: q.href }));
        const quoteLabel = quotes.length ? quotes.map(q => q.num).join(', ') : null;
        const hasActiveQuote = quotes.some(q => !q.rejected);

        // Embedded cost table (parsed by header, since column order differs from the Costs tab)
        const lines = [];
        const costTable = [...doc.querySelectorAll('table')]
            .find(t => [...t.querySelectorAll('thead th')].some(h => /subtotal cost/i.test(h.textContent)));
        if (costTable) {
            const heads = [...costTable.querySelectorAll('thead th')].map(h => norm(h.textContent));
            const col = (re) => heads.findIndex(h => re.test(h));
            const cDesc = col(/description/), cQty = col(/quantity/), cCost = col(/^cost/),
                  cVat = col(/vat/), cSub = col(/subtotal cost/);
            [...costTable.querySelectorAll('tbody tr')].forEach(tr => {
                const cells = [...tr.children].map(td => td.textContent.replace(/\s+/g, ' ').trim());
                const unit = money(cells[cCost]);
                // skip category header rows (no unit cost / no qty)
                if (cQty < 0 || cells[cQty] === '') return;
                lines.push({
                    source: 'quote (' + quoteLabel + ')',
                    category: 'Quote line',
                    desc: cDesc >= 0 ? cells[cDesc] : '',
                    date: '',
                    engineer: '',
                    qtyRaw: cQty >= 0 ? cells[cQty] : '',
                    qty: qtyNum(cQty >= 0 ? cells[cQty] : ''),
                    unit,
                    vat: cVat >= 0 ? vatRate(cells[cVat]) : null,
                    subtotal: cSub >= 0 ? money(cells[cSub]) : null
                });
            });
        }
        return { quoteLabel, quoteLinks, lines, hasActiveQuote };
    }

    // ===================================================================
    // MATCHING ENGINE
    // The value that SHOULD be in Job Logic is the receipt NET (ex-VAT) unit value.
    // We test each JL cost line's unit cost AND line subtotal against the sheet's
    // net and gross under the known mis-entry transforms.
    // ===================================================================
    function classifyLine(net, gross, vat, line) {
        // returns null if this line is unrelated, else {verdict, factor, why, score}
        const r = (vat != null ? vat : VAT_FALLBACK);
        const u = line.unit, sub = line.subtotal, q = line.qty;
        if (u == null && sub == null) return null;

        // ---- CORRECT: unit equals net ----
        if (eqMoney(u, net)) {
            return { verdict: 'OK', why: `Unit cost £${u.toFixed(2)} = receipt net £${net.toFixed(2)}`, score: 0 };
        }
        // The receipt net can equal the line SUBTOTAL (total ex-VAT) even when qty>1
        // (e.g. 7 × £38.55 = £269.85). The full net is on the job, so that's correct —
        // do NOT require qty<=1 here, or correct multi-qty lines get missed and a wrong
        // duplicate line elsewhere gets matched as INCORRECT instead.
        if (eqMoney(sub, net)) {
            return { verdict: 'OK', why: `Line subtotal £${sub.toFixed(2)}${q != null && q > 1 ? ` (qty ${q} × unit £${u != null ? u.toFixed(2) : '?'})` : ''} = receipt net £${net.toFixed(2)}`, score: 0 };
        }

        // ---- WRONG forms (what's there vs what should be there = net) ----
        // Test the unit cost first (the field people fill in), then the subtotal.
        const tests = [];
        const push = (val, label) => { if (val != null) tests.push({ val, label }); };
        push(u, 'unit cost');
        push(sub, 'line subtotal');

        for (const t of tests) {
            // VAT-inclusive entered instead of net  ->  value ≈ net*(1+r)  (≈ gross)
            if (eqMoney(t.val, gross) || eqMoney(t.val, net * (1 + r))) {
                return {
                    verdict: 'INCORRECT',
                    factor: '×(1+VAT)',
                    why: `${cap(t.label)} £${t.val.toFixed(2)} is the VAT-inclusive figure. It should be the net £${net.toFixed(2)} (the £${(net * (1 + r)).toFixed(2)} includes ${Math.round(r * 100)}% VAT, which JobLogic adds on top).`,
                    score: 1
                };
            }
        }
        // Total entered as unit:  unit ≈ net * k  (k = an integer, the quantity)
        const kNet = nearInteger(u / net);
        if (kNet) {
            return {
                verdict: 'INCORRECT',
                factor: `×${kNet}`,
                why: `Unit cost £${u.toFixed(2)} ≈ ${kNet} × the net £${net.toFixed(2)}. Looks like the line TOTAL was entered as the per-unit cost (qty ${kNet}), so the job is over-costed ${kNet}×.`,
                score: 2
            };
        }
        // Combined: unit ≈ net * (1+r) * k
        const kGross = nearInteger(u / (net * (1 + r)));
        if (kGross) {
            return {
                verdict: 'INCORRECT',
                factor: `×${kGross}×(1+VAT)`,
                why: `Unit cost £${u.toFixed(2)} ≈ ${kGross} × the VAT-inclusive £${(net * (1 + r)).toFixed(2)}. Both errors: VAT-inclusive AND the total used as the unit cost.`,
                score: 3
            };
        }
        // Reverse VAT: unit ≈ net / (1+r) (they double-removed VAT) — rare, flag softly
        if (eqMoney(u, net / (1 + r))) {
            return {
                verdict: 'INCORRECT',
                factor: '÷(1+VAT)',
                why: `Unit cost £${u.toFixed(2)} ≈ net £${net.toFixed(2)} with VAT removed AGAIN (£${(net / (1 + r)).toFixed(2)}). Net is already ex-VAT — this under-costs the job.`,
                score: 2
            };
        }
        return null;
    }
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

    // Find the best line match across job + secondary sources.
    // For NOT-IN-JOB rows, rank the job/quote cost lines by how close their value is
    // to the receipt (nearest of net/gross vs nearest of unit/subtotal), and flag any
    // whose description shares a word with the merchant. Lets a human spot near-misses
    // (delivery charges, rounding, slightly different descriptions).
    function candidateLines(net, gross, lines, merchant) {
        const tokens = (String(merchant || '').toLowerCase().match(/[a-z]{4,}/g) || []);
        const scored = [];
        for (const l of lines) {
            // only purchasable lines — a receipt is never labour/travel/mileage
            if (/labour|travel|mileage|overtime|call-?out/i.test(l.category || '')) continue;
            const vals = [l.unit, l.subtotal].filter(v => v != null && v > 0);
            if (!vals.length) continue;
            let dist = Infinity;
            vals.forEach(v => [net, gross].forEach(b => { if (b > 0) dist = Math.min(dist, Math.abs(v - b) / b); }));
            const desc = String(l.desc || '').toLowerCase();
            scored.push({ line: l, dist, descMatch: tokens.some(tok => desc.includes(tok)) });
        }
        scored.sort((a, b) => a.dist - b.dist);
        return scored;
    }
    // Some receipts are split across MULTIPLE cost lines that together sum to the
    // total. Find a combination of 2-3 material lines whose unit costs sum to the
    // net (correct) or the gross (VAT-inclusive — should be net). Returns a best-shaped obj.
    function matchCombination(net, gross, vat, lines, sourceLabel) {
        const r = (vat != null ? vat : VAT_FALLBACK);
        const mats = lines.filter(l => l.unit && l.unit > 0 && !/labour|travel|mileage|overtime|call-?out/i.test(l.category || ''));
        if (mats.length < 2) return null;
        const mk = (idxs, verdict, factor) => {
            const ls = idxs.map(i => mats[i]);
            const sum = ls.reduce((a, l) => a + l.unit, 0);
            const list = ls.map(l => `"${(l.desc || '').slice(0, 24)}" £${l.unit.toFixed(2)}`).join(' + ');
            const why = verdict === 'OK'
                ? `${ls.length} cost lines sum to the net £${net.toFixed(2)} — ${list}`
                : `${ls.length} cost lines sum to £${sum.toFixed(2)} = the VAT-inclusive total; they should be net (£${net.toFixed(2)}) — ${list}`;
            return { verdict, factor: factor || '', why, line: { source: ls[0].source || sourceLabel, desc: ls.map(l => l.desc).join(' + ') }, combo: ls, ownerMatch: false, dateMatch: false };
        };
        const test = (sum, idxs) => {
            if (eqMoney(sum, net)) return mk(idxs, 'OK');
            if (eqMoney(sum, gross) || eqMoney(sum, net * (1 + r))) return mk(idxs, 'INCORRECT', '×(1+VAT)');
            return null;
        };
        const n = mats.length;
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const res = test(mats[i].unit + mats[j].unit, [i, j]); if (res) return res; }
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) { const res = test(mats[i].unit + mats[j].unit + mats[k].unit, [i, j, k]); if (res) return res; }
        return null;
    }
    function matchAgainstLines(net, gross, sheetVat, lines, ownerName, dateStr) {
        let best = null;
        for (const line of lines) {
            const c = classifyLine(net, gross, line.vat != null ? line.vat : sheetVat, line);
            if (!c) continue;
            // soft signals (never blockers)
            const ownerMatch = ownerName && line.engineer && norm(line.engineer).includes(norm(ownerName).split(' ')[0]);
            const dateMatch = dateStr && line.date && line.date === dateStr;
            const cand = { ...c, line, ownerMatch, dateMatch };
            if (!best) { best = cand; continue; }
            // prefer OK over INCORRECT; then lower score; then owner/date agreement
            const rank = (x) => (x.verdict === 'OK' ? 0 : 10) + (x.score || 0) - (x.ownerMatch ? 0.5 : 0) - (x.dateMatch ? 0.3 : 0);
            if (rank(cand) < rank(best)) best = cand;
        }
        return best;
    }

    // ===================================================================
    // SHEET PARSING (TSV preferred, CSV supported)
    // ===================================================================
    function parseSheet(text) {
        const raw = text.replace(/\r\n?/g, '\n').replace(/\n+$/,'');
        if (!raw.trim()) return { headers: [], rows: [] };
        const firstLine = raw.split('\n')[0];
        const delim = firstLine.includes('\t') ? '\t' : ',';
        // Pleo notes often contain line breaks. Depending on how the export is copied those
        // breaks may or may not be wrapped in quotes, so we can't rely on quote-awareness
        // alone. Instead, fold physical lines back into logical rows: every Pleo data row
        // starts with a Date in column 1, so any line whose first cell is NOT a date is a
        // continuation of the previous row's multi-line cell — join it back with a space.
        const headerFirst = (firstLine.split(delim)[0] || '').trim().toLowerCase();
        const dateFirstFormat = headerFirst === 'date' || headerFirst.indexOf('date') === 0;
        let toParse = raw;
        if (dateFirstFormat) {
            const isRowStart = ln => /^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}(?:\t|,|$)/.test(ln.replace(/^"/, ''));
            const lines = raw.split('\n');
            const folded = [];
            lines.forEach((ln, i) => {
                if (i === 0 || folded.length === 0 || isRowStart(ln)) folded.push(ln);
                else folded[folded.length - 1] += ' ' + ln;   // continuation of a multi-line cell
            });
            toParse = folded.join('\n');
        }
        // Quote-aware field split (handles any remaining "…"-quoted cells cleanly).
        const recs = parseDelimited(toParse, delim);
        const headers = recs[0].map(h => h.trim());
        const rows = recs.slice(1).filter(r => r.some(c => (c || '').trim() !== ''))
            .map(r => { const o = {}; headers.forEach((h, i) => o[h] = (r[i] || '').trim()); o.__cells = r; return o; });
        return { headers, rows };
    }
    function parseDelimited(text, delim) {
        const out = []; let row = [], field = '', inQ = false;
        for (let i = 0; i < text.length; i++) {
            const c = text[i];
            if (inQ) {
                if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
                else field += c;
            } else {
                if (c === '"' && field === '') inQ = true;   // opening quote only at field start
                else if (c === delim) { row.push(field); field = ''; }
                else if (c === '\n') { row.push(field); out.push(row); row = []; field = ''; }
                else field += c;
            }
        }
        row.push(field); out.push(row);
        return out;
    }

    // Map the Pleo columns we care about (by header name, case-insensitive).
    function col(row, names) {
        const keys = Object.keys(row);
        for (const n of names) {
            const k = keys.find(k => norm(k) === norm(n));
            if (k != null && row[k] !== '') return row[k];
        }
        // loose contains-match fallback
        for (const n of names) {
            const k = keys.find(k => norm(k).includes(norm(n)));
            if (k != null && row[k] !== '') return row[k];
        }
        return '';
    }
    function mapRow(row) {
        const note = col(row, ['Note']);
        const srcDesc = col(row, ['Source description', 'Source desc', 'Merchant', 'Description']);
        const refText = [note, srcDesc, col(row, ['Receipt'])].join('  ||  ');
        const netRaw = col(row, ['Net Amount', 'Net']);
        const grossRaw = col(row, ['Orig. amount', 'Orig amount', 'Amount']);
        const vr = vatRate(col(row, ['Tax Rate', 'VAT Rate'])) ;
        let net = money(netRaw);
        let gross = money(grossRaw);
        // derive whichever is missing
        const r = (vr != null ? vr : VAT_FALLBACK);
        if (net == null && gross != null) net = gross / (1 + r);
        if (gross == null && net != null) gross = net * (1 + r);
        return {
            note, srcDesc,
            refs: extractRefs(refText),
            net, gross, vat: vr,
            owner: col(row, ['Owner']),
            date: normalizeDate(col(row, ['Date'])),
            merchant: srcDesc,
            xeroDesc: col(row, ['Xero description', 'Xero Description', 'Xero desc']),
            receipt: col(row, ['Receipt', 'Expense ID', 'Document Number'])
        };
    }
    // Normalise a sheet date to JobLogic's DD/MM/YYYY. The tricky part is the order:
    // Pleo exports are US M/D/YY ("6/26/26" = 26 June) but other sources are D/M/Y. Getting
    // it wrong yields an invalid month (e.g. 26) and JobLogic silently rejects the cost line.
    // Per value: whichever field is >12 must be the day; when neither is (ambiguous), use the
    // order detected across the whole batch (inputDateMDY, defaulting to M/D/Y for Pleo).
    function normalizeDate(s) {
        const m = String(s || '').match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
        if (!m) return '';
        const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
        const y = m[3].length === 2 ? '20' + m[3] : m[3];
        let day, mo;
        if (a > 12) { day = a; mo = b; }              // first field can only be a day -> D/M/Y
        else if (b > 12) { mo = a; day = b; }         // second field can only be a day -> M/D/Y
        else if (inputDateMDY) { mo = a; day = b; }   // ambiguous -> batch order (M/D/Y default)
        else { day = a; mo = b; }
        if (mo < 1 || mo > 12) return '';             // still invalid -> leave blank, never emit month>12
        return `${String(day).padStart(2, '0')}/${String(mo).padStart(2, '0')}/${y}`;
    }
    // Detected once per run from the batch: true = source dates are M/D/Y (Pleo/US).
    let inputDateMDY = true;
    function detectDateOrder(rows) {
        let mdy = 0, dmy = 0;
        for (const r of rows) {
            const m = String(col(r, ['Date']) || '').match(/(\d{1,2})[-/.](\d{1,2})[-/.]/);
            if (!m) continue;
            const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
            if (a > 12 && b <= 12) dmy++;
            else if (b > 12 && a <= 12) mdy++;
        }
        return mdy >= dmy;   // tie / none decisive -> M/D/Y (Pleo default)
    }

    // ===================================================================
    // PER-ROW PROCESSING
    // ===================================================================
    async function resolveJob(refs) {
        // returns {id, jobNumber, via, quoteNote} or null
        for (const ref of refs.job) {
            let fallback = null;
            for (const cand of jobRefCandidates(ref)) {
                const j = await searchJob(cand);
                if (j && j.exact) return { ...j, via: 'job ref ' + j.jobNumber };
                if (j && !fallback) fallback = { ...j, via: 'job ref ' + ref + ' \u2192 ' + j.jobNumber };
            }
            if (fallback) return fallback;
        }
        for (const ref of refs.sf) {
            const j = await searchJob(ref); if (j) return { ...j, via: 'Salesforce ' + ref };
        }
        for (const q of refs.quote) {
            const qr = await searchQuote(q);
            if (qr && qr.parentJobId) {
                const jn = qr.parentJobNumber || ('job ' + qr.parentJobId);
                return { id: qr.parentJobId, jobNumber: jn, via: `quote ${qr.quoteNumber} → ${jn}`, quoteId: qr.id };
            }
            if (qr && qr.id) return { id: null, quoteId: qr.id, jobNumber: null, via: `quote ${qr.quoteNumber} (no upgraded job)` };
        }
        return null;
    }

    async function processRow(row, idx) {
        const m = mapRow(row);
        const label = m.receipt ? `#${m.receipt}` : `row ${idx + 1}`;
        const base = { idx, receipt: m.receipt, merchant: m.merchant, note: m.note, owner: m.owner, date: m.date, net: m.net, gross: m.gross, xeroDesc: m.xeroDesc };

        if (m.net == null) {
            return { ...base, status: 'NO VALUE', detail: 'No Net/Amount could be read from this row.' };
        }
        const anyRef = m.refs.job.length || m.refs.sf.length || m.refs.quote.length;
        if (!anyRef) {
            const blob = `${m.note} ${m.srcDesc}`.toLowerCase();
            const internalNote = m.refs.internal.length ? ` (${m.refs.internal.join(', ')} looks like an internal code, e.g. materials — not a job or quote)` : '';
            if (/\brefund|credit note|returned/.test(blob))
                return { ...base, status: 'IGNORE', detail: `Looks like a REFUND / return — Note: "${(m.note || '').slice(0, 70)}"`, suggest: 'Refund — not a job cost, can be ignored.' };
            if (/personal|accidental|reimburse|by mistake|wrong card/.test(blob))
                return { ...base, status: 'IGNORE', detail: `Looks like a PERSONAL expense — Note: "${(m.note || '').slice(0, 70)}"`, suggest: 'Personal expense — not a job cost, can be ignored.' };
            const mailto = 'mailto:?subject=' + encodeURIComponent('Job reference needed for Pleo expense ' + (m.receipt || '')) +
                '&body=' + encodeURIComponent(`Hi ${m.owner || ''},\n\nPlease can you supply the Joblogic job reference for this Pleo expense so it can be costed:\n\nMerchant: ${m.merchant || ''}\nAmount: £${(m.gross != null ? m.gross : m.net).toFixed(2)}\nDate: ${m.date || ''}\nReceipt: ${m.receipt || ''}\nNote: ${m.note || '(none)'}\n\nThanks.`);
            return { ...base, status: 'NO REFERENCE', mailto,
                detail: `No job ref / SF number / quote in Note or Source${internalNote}. Note: "${(m.note || '').slice(0, 60)}"`,
                suggest: `No reference — ask ${m.owner || 'the owner'} for the job number.` };
        }

        const job = await resolveJob(m.refs);
        if (!job) {
            const tried = [...m.refs.job, ...m.refs.sf, ...m.refs.quote].join(', ');
            return { ...base, status: 'JOB NOT FOUND', detail: `Could not locate a job from: ${tried}` };
        }
        if (!job.id) {
            return { ...base, status: 'NO JOB', jobNumber: job.jobNumber, detail: `${job.via} — quote not yet upgraded to a job.` };
        }

        // ---- gather everything once (used for matching AND the report columns) ----
        const { lines, parseOk } = await getJobCosts(job.id);
        const jobLines = lines.slice();
        let quoteLabel = null, quoteUrl = '', rwLines = [], hasActiveQuote = false;
        try {
            const rw = await getRelatedWorks(job.id);
            quoteLabel = rw.quoteLabel; rwLines = rw.lines || []; hasActiveQuote = !!rw.hasActiveQuote;
            const ql = (rw.quoteLinks || []).find(q => q.href);
            if (ql) quoteUrl = ql.href.indexOf('http') === 0 ? ql.href : location.origin + ql.href;
        } catch (e) { /* optional */ }
        const poLines = await getUndeliveredPOLines(job.id);

        const jobUrl = `${location.origin}/Job/Detail/${job.id}`;
        const isProject = /^PROJ/i.test(job.jobNumber || '');
        const cancelled = /cancel|suspend/i.test(job.jobStatus || '');
        const statusNote = cancelled ? `  \u26a0 Job status: ${job.jobStatus}.` : '';
        const poNos = [...new Set(poLines.map(l => l.poNo).filter(Boolean))];
        const cols = {
            jobId: job.id,
            jobFound: job.jobNumber || '', jobLink: jobUrl,
            spoText: poNos.length ? poNos.join(', ') : 'No',
            spoUrl: (poLines[0] && poLines[0].poId) ? `${location.origin}/PurchaseOrder/Detail/${poLines[0].poId}` : '',
            quoteText: quoteLabel || 'No', quoteUrl,
            jobStatusText: job.jobStatus || '',
            // Project jobs and jobs with an ACTIVE (non-rejected) related quote are billed
            // off the quote, so any cost added to them should be NON-chargeable. Carry the
            // flag on every job row so the writer honours it whichever status is chosen.
            chargeable: (isProject || hasActiveQuote) ? 'No' : 'Yes'
        };
        const valOf = l => (l.unit && l.unit > 0) ? l.unit : l.subtotal;
        const fmtLineObj = l => `"${(l.desc || l.category || 'line').slice(0, 48)}" ${valOf(l) != null ? '£' + valOf(l).toFixed(2) : ''}${(l.source || '').indexOf('quote') === 0 ? ' [' + l.source + ']' : ''}`;

        // ---- match against the JOB's own cost lines only (job line -> job combo) ----
        let best = matchAgainstLines(m.net, m.gross, m.vat, jobLines, m.owner, m.date);
        if (!best) best = matchCombination(m.net, m.gross, m.vat, jobLines, 'job');
        let secondaryNote = '';
        // We deliberately do NOT match against the related QUOTE. A quote line is a
        // forecast, not an actual job cost — even when it matches (or was mis-entered as
        // gross instead of net), the real cost still needs to go ON the job. Quoted/project
        // jobs get it added as a NON-chargeable line via the "not in job" path below; the
        // quote remains informational (shown in the Related Quote column).

        // ---- ON UNDELIVERED PO (ordered but not yet delivered) ----
        if (!best && poLines.length) {
            const poBest = matchAgainstLines(m.net, m.gross, m.vat, poLines, m.owner, m.date) || matchCombination(m.net, m.gross, m.vat, poLines, 'PO');
            if (poBest) {
                return { ...base, ...cols, status: 'ON UNDELIVERED PO', factor: poBest.verdict !== 'OK' ? poBest.factor : '',
                    costNear: 'On undelivered PO', costLine: fmtLineObj(poBest.combo ? poBest.combo[0] : poBest.line),
                    other: cancelled ? `\u26a0 ${job.jobStatus}` : '',
                    detail: `On ${poBest.line.source}: ${poBest.why}.${statusNote}`,
                    suggest: `Deliver PO ${poBest.line.poNo || poNos.join(', ')} and the cost posts to the job — no manual line needed.` + (cancelled ? ' NOTE: job is Cancelled — confirm status first.' : '') };
            }
        }

        if (!best) {
            const valued = l => (l.unit && l.unit > 0) || (l.subtotal && l.subtotal > 0);
            const isMat = l => !/labour|travel|mileage|overtime|call-?out/i.test(l.category || '');
            const jobValued = jobLines.filter(valued);
            const jobMats = jobValued.filter(isMat);
            const quoteValued = rwLines.filter(valued);
            let landscape = jobValued.length
                ? `Job has ${jobValued.length} cost line${jobValued.length === 1 ? '' : 's'} (${jobMats.length} material/expense)`
                : 'Job has NO costs entered yet';
            if (quoteLabel) landscape += `; related quote${quoteLabel.indexOf(',') >= 0 ? 's' : ''} ${quoteLabel}${quoteValued.length ? ` (${quoteValued.length} line${quoteValued.length === 1 ? '' : 's'})` : ''}`;
            else landscape += '; no related quote';
            if (poLines.length) landscape += `; ${poLines.length} undelivered PO line${poLines.length === 1 ? '' : 's'}`;

            // Candidates are the job's own lines (+ undelivered PO) only — NOT quote lines,
            // which are forecasts and must not block adding the real cost to the job.
            const cands = candidateLines(m.net, m.gross, jobLines.concat(poLines), m.merchant);
            const top = cands.slice(0, 2);
            const plausible = top.find(c => c.dist <= 0.30 || c.descMatch);
            const candText = top.length ? '  Closest: ' + top.map(c => fmtLineObj(c.line)).join(' ; ') : '';

            if (plausible) {
                return { ...base, ...cols, status: 'POSSIBLE MATCH', costNear: 'Possible', costLine: fmtLineObj(plausible.line),
                    other: cancelled ? `\u26a0 ${job.jobStatus}` : '',
                    detail: `${landscape}. No exact match for £${m.net.toFixed(2)} net, but a similar line exists — value differs (delivery / rounding / description?).${candText}${statusNote}`,
                    suggest: `Review — may already be on the job as ${fmtLineObj(plausible.line)}. Confirm before adding.` };
            }
            let action;
            if (isProject || hasActiveQuote) action = `Project/quoted job${quoteLabel ? ' (quote ' + quoteLabel + ')' : ''} — likely covered/forecasted in the quote. Add it as a NON-CHARGEABLE materials line (£${m.net.toFixed(2)} net).`;
            else if (quoteLabel) action = `Add it as a materials line (£${m.net.toFixed(2)} net). NOTE: related quote ${quoteLabel} is rejected/cancelled, so the cost is chargeable.`;
            else action = `Not on the job — add it as a materials line (£${m.net.toFixed(2)} net).`;
            // Labour / Travel / Mileage are not material/expense costs — a job whose
            // only lines are those has no costs to reconcile against, so treat it as
            // NO COSTS (a fresh material line to add), not NOT IN JOB.
            // NO COSTS only when there is genuinely NOTHING: no material/expense cost lines,
            // no related quote, and no undelivered PO. A job with a related quote is NOT
            // "no costs" — it's a quoted job the cost isn't on yet, so NOT IN JOB.
            const noMatchStatus = (jobMats.length || quoteLabel || poLines.length) ? 'NOT IN JOB' : 'NO COSTS';
            return { ...base, ...cols, status: noMatchStatus, costNear: 'No', costLine: top.length ? fmtLineObj(top[0].line) + ' (not a match)' : '',
                other: landscape + (cancelled ? `  \u26a0 ${job.jobStatus}` : ''),
                detail: `Job ${job.jobNumber} found (${job.via}). ${landscape}. No cost line near £${m.net.toFixed(2)} net.${candText}${statusNote}` + (parseOk ? '' : ' [could not read cost model]'),
                suggest: action };
        }

        // ---- matched (single line or combination) ----
        const soft = [];
        if (best.ownerMatch) soft.push('owner ✓'); else if (m.owner && best.line.engineer) soft.push(`owner: sheet "${m.owner}" vs JL "${best.line.engineer}"`);
        if (best.dateMatch) soft.push('date ✓'); else if (m.date && best.line.date) soft.push(`date: sheet ${m.date} vs JL ${best.line.date}`);
        const matchedLineText = best.combo ? best.combo.map(fmtLineObj).join(' + ') : fmtLineObj(best.line);
        const otherBits = [];
        if (best.factor) otherBits.push(best.factor);
        soft.forEach(s => otherBits.push(s));
        if (cancelled) otherBits.push(`\u26a0 ${job.jobStatus}`);
        const otherText = otherBits.join('; ');

        if (best.verdict === 'OK') {
            return { ...base, ...cols, status: 'ALREADY IN JOB', costNear: 'Yes', costLine: matchedLineText, other: otherText,
                detail: best.why + secondaryNote + statusNote + (soft.length ? '  [' + soft.join('; ') + ']' : '') };
        }
        const inQuote = (best.line.source || '').indexOf('quote') === 0;
        if (best.verdict === 'INCORRECT' && /×\d/.test(best.factor || '') && inQuote && !best.combo) {
            return { ...base, ...cols, status: 'UNCLEAR', factor: best.factor, costNear: 'Possible', costLine: matchedLineText, other: otherText,
                detail: `Unclear — ${best.why}. The spend does not cleanly match; it may be part of a quoted line (e.g. sundries / fittings) rather than a direct match.${statusNote}`,
                suggest: `Flag for manual review — unclear which line/quote covers this £${m.net.toFixed(2)} receipt. Do not change quote lines.` };
        }
        const invoicedAmt = String(job.totalInvoiced || '').replace(/[£,\s]/g, '');
        const jobInvoiced = invoicedAmt && !/^0(\.00)?$/.test(invoicedAmt);
        const r2 = (m.vat != null ? m.vat : VAT_FALLBACK);
        let fix;
        if (best.combo) {
            fix = `${best.combo.length} cost lines are VAT-inclusive and should be net — divide each by 1+VAT: ` +
                best.combo.map(l => `"${(l.desc || '').slice(0, 24)}" £${l.unit.toFixed(2)} → £${(l.unit / (1 + r2)).toFixed(2)}`).join(' ; ') +
                (inQuote ? ' (Quote lines — flag, do not change.)' : (jobInvoiced ? ' \u26a0 Job has invoiced amounts — flag, do not change totals if invoiced.' : ''));
        } else if (inQuote) {
            fix = `Found in ${best.line.source}. Do NOT change quote lines — quoted values are fixed forecasts (spend under and the margin is kept). Flag for manual review: confirm this £${m.net.toFixed(2)} receipt against the quoted material line(s).`;
        } else {
            fix = `Set job "${(best.line.desc || '').slice(0, 40)}" so the line TOTAL = £${m.net.toFixed(2)} (net).` +
                (jobInvoiced ? ' \u26a0 This job already has invoiced amounts — if this line is invoiced do NOT change the total; flag it and raise a credit/adjustment instead.'
                             : ' If the line has already been invoiced, do NOT change the total — flag it and raise a credit/adjustment instead.');
        }
        // A single job (non-quote, non-combo) Material/Expense INCORRECT line can be
        // auto-fixed by the writer: surface its id + invoiced flag. Labour/Travel/Mileage
        // and other types are not auto-fixable, so don't export a Line ID for them.
        const editable = !inQuote && !best.combo && best.line && best.line.id != null
            && /material|expense/i.test(best.line.lineType || best.line.category || '');
        const lineId = editable ? best.line.id : '';
        const lineInvoiced = editable ? (best.line.invoiced ? 'Yes' : 'No') : '';
        return { ...base, ...cols, status: 'INCORRECT', factor: best.factor, costNear: 'Yes', costLine: matchedLineText, other: otherText,
            lineId, lineInvoiced,
            detail: best.why + secondaryNote + statusNote + (soft.length ? '  [' + soft.join('; ') + ']' : ''),
            suggest: fix };
    }

    // ===================================================================
    // MAIN LOOP
    // ===================================================================
    async function run() {
        if (running) return;
        const parsed = parseSheet(pasteArea.value);
        if (!parsed.rows.length) { alert('Paste your sheet rows (with the header row) first.'); return; }
        rows = parsed.rows; results = [];
        inputDateMDY = detectDateOrder(rows);   // decide M/D/Y vs D/M/Y once for the whole batch
        running = true;
        runBtn.style.display = 'none'; stopBtn.style.display = 'inline-block'; copyBtn.style.display = 'none';
        logArea.innerHTML = ''; resultsBox.innerHTML = '';
        log(`Parsed ${parsed.headers.length} columns, ${rows.length} rows. Dates read as ${inputDateMDY ? 'M/D/Y (US/Pleo)' : 'D/M/Y'}.`, '#0af');

        const stats = { ok: 0, incorrect: 0, unclear: 0, possible: 0, po: 0, notin: 0, nocosts: 0, notfound: 0, noref: 0, ignore: 0, noval: 0, err: 0 };
        for (let i = 0; i < rows.length; i++) {
            if (!running) { log('Stopped by user.', '#f55'); break; }
            setProgress(`Row ${i + 1}/${rows.length}`);
            let res;
            try { res = await processRow(rows[i], i); }
            catch (e) { res = { idx: i, status: 'ERROR', detail: e.message }; stats.err++; }
            results.push(res);
            tallyAndRender(res, stats);
            await sleep(DELAY_BETWEEN_ROWS);
        }

        log('');
        log('===== SUMMARY =====', '#0af');
        log(`Already in job: ${stats.ok}`, '#0fa');
        log(`Incorrect:      ${stats.incorrect}`, '#fb0');
        log(`Unclear:        ${stats.unclear}`, '#f6c');
        log(`Possible match: ${stats.possible}`, '#3cc');
        log(`Not in job:     ${stats.notin}`, '#f90');
        log(`No costs:       ${stats.nocosts}`, '#b388ff');
        log(`On undeliv. PO: ${stats.po}`, '#4af');
        log(`Ignore (refund/personal): ${stats.ignore}`, '#888');
        log(`Job not found:  ${stats.notfound}`, '#f55');
        log(`No reference:   ${stats.noref}`, '#999');
        log(`No value:       ${stats.noval}`, '#999');
        if (stats.err) log(`Errors:         ${stats.err}`, '#f55');
        setProgress(`Done — ${rows.length} rows.`);
        running = false;
        runBtn.style.display = 'inline-block'; stopBtn.style.display = 'none';
        copyBtn.style.display = 'inline-block';
        if (results.some(r => r.status === 'NO COSTS' && r.jobId)) stage2Btn.style.display = 'inline-block';
    }

    function tallyAndRender(res, stats) {
        const map = { 'ALREADY IN JOB': 'ok', 'INCORRECT': 'incorrect', 'UNCLEAR': 'unclear', 'POSSIBLE MATCH': 'possible', 'ON UNDELIVERED PO': 'po', 'NOT IN JOB': 'notin', 'NO COSTS': 'nocosts',
            'JOB NOT FOUND': 'notfound', 'NO JOB': 'notfound', 'NO REFERENCE': 'noref', 'IGNORE': 'ignore', 'NO VALUE': 'noval' };
        if (map[res.status]) stats[map[res.status]]++;
        renderResult(res);
    }

    // ===================================================================
    // UI
    // ===================================================================
    const STATUS_COLOR = {
        'ALREADY IN JOB': '#0fa', 'INCORRECT': '#fb0', 'UNCLEAR': '#f6c', 'POSSIBLE MATCH': '#3cc', 'ON UNDELIVERED PO': '#4af', 'NOT IN JOB': '#f90', 'NO COSTS': '#b388ff',
        'JOB NOT FOUND': '#f55', 'NO JOB': '#f77', 'NO REFERENCE': '#999', 'IGNORE': '#888',
        'NO VALUE': '#999', 'ERROR': '#f55'
    };
    function renderResult(res) {
        const card = document.createElement('div');
        card.style.cssText = 'border-left:4px solid ' + (STATUS_COLOR[res.status] || '#888') +
            ';background:#11111f;margin:6px 0;padding:8px 10px;border-radius:4px;';
        const head = document.createElement('div');
        head.style.cssText = 'display:flex;justify-content:space-between;gap:8px;align-items:baseline;';
        const left = document.createElement('span');
        left.innerHTML = `<strong style="color:${STATUS_COLOR[res.status] || '#ccc'}">${res.status}</strong>` +
            (res.factor ? ` <span style="color:#fb0">${res.factor}</span>` : '') +
            ` <span style="color:#888">${res.merchant || ''} · £${res.net != null ? res.net.toFixed(2) : '?'} net</span>`;
        const right = document.createElement('span');
        right.style.color = '#67a';
        if (res.jobUrl) {
            const a = document.createElement('a');
            a.href = res.jobUrl; a.target = '_blank'; a.textContent = res.jobNumber || 'job';
            a.style.color = '#6cf';
            right.appendChild(a);
        } else { right.textContent = res.receipt ? '#' + res.receipt : ''; }
        head.appendChild(left); head.appendChild(right);
        const detail = document.createElement('div');
        detail.style.cssText = 'color:#bbb;font-size:11px;margin-top:3px;white-space:pre-wrap;';
        detail.textContent = res.detail || '';
        card.appendChild(head); card.appendChild(detail);
        if (res.suggest) {
            const s = document.createElement('div');
            s.style.cssText = 'color:#fc8;font-size:11px;margin-top:3px;';
            s.textContent = '➜ ' + res.suggest;
            card.appendChild(s);
        }
        if (res.mailto) {
            const a = document.createElement('a');
            a.href = res.mailto;
            a.textContent = '✉ Draft email to ' + (res.owner || 'owner');
            a.style.cssText = 'display:inline-block;color:#6cf;font-size:11px;margin-top:3px;text-decoration:underline;';
            card.appendChild(a);
        }
        resultsBox.appendChild(card);
        resultsBox.scrollTop = resultsBox.scrollHeight;
    }

    // ===================================================================
    // STAGE 2 — add the NO-COSTS rows to their jobs as material lines
    // (verified: POST /api/JobLine/AddMaterialCosts; net unit, qty 1, chargeable,
    // 20% VAT, Xero description, sheet date. No engineer — JobLogic exposes no API
    // to resolve the roster, so per spec we add WITHOUT the engineer.)
    // ===================================================================
    const STAGE2_CFG = {
        taxCodeId: 'c1d73a68-7887-4f91-9124-26100ef712b0', taxCodeValue: '20.00',
        taxCodeDesc: '20% (VAT on Income) (20.00%)',
        payBandId: 'f76846b0-674b-4410-8473-c2f22508f51c', payBandDesc: 'Basic',
        libraryId: 54838, libraryName: 'Standard Parts Library'
    };
    const upliftCache = new Map();
    // Each job has a default Uplift % (markup) from its selling rate. Read it from the
    // Add-Material metadata so the Sell price carries the right margin (Sell = Cost x (1 + uplift/100)).
    async function jobMaterialDefaults(jobId) {
        if (upliftCache.has(jobId)) return upliftCache.get(jobId);
        let d = { uplift: 0, pct: 1 };
        try {
            const r = await fetch('/api/JobCost/GetAddMaterialCostMetadata?jobId=' + jobId, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
            const j = await r.json(); const ad = j.AdditionalData || j;
            d = { uplift: Number(ad.Uplift) || 0, pct: ad.PriceCalculationType != null ? ad.PriceCalculationType : 1 };
        } catch (e) { /* default 0 */ }
        upliftCache.set(jobId, d);
        return d;
    }
    function buildMaterialBody(jobId, description, dateStr, net, uplift, pct) {
        const c = STAGE2_CFG, cost = Number(net), up = Number(uplift) || 0;
        const v = cost.toFixed(2);
        const sell = (cost * (1 + up / 100)).toFixed(2);
        const dt = /\d{1,2}:\d{2}/.test(dateStr || '') ? dateStr : ((dateStr || '') + ' 09:00');
        return {
            JobId: jobId, TimeId: null, VirtualTimeId: null,
            CostLines: [{
                Id: null, PartNumber: null, Quantity: '1', ReturnQuantity: 0, IsReturnItemToStock: false,
                CostPerUnit: v, CostPerHour: '0.00', Uplift: up.toFixed(2), SellPerUnit: sell, SellPerHour: '0.00',
                CreateLibraryAllowed: true, CategoryId: null, CategoryDescription: null, ForEquipmentUse: false,
                Make: null, Model: null, HasFixedSell: false, SetupSell: 0,
                TaxCodeId: c.taxCodeId, TaxCodeValue: c.taxCodeValue, TaxCodeDescription: c.taxCodeDesc,
                IsChargeable: true, PriceCalculationType: pct != null ? pct : 1,
                PayBandId: c.payBandId, PayBandDescription: c.payBandDesc, SellPayBandId: c.payBandId,
                Description: description, CreatePayBandAllowed: true, LibraryId: c.libraryId, LibraryName: c.libraryName,
                DateIncurred: dt, HasQuote: false, ItemId: 0, JobLineOption: 5,
                QuotedValueTaxCodeId: c.taxCodeId, QuotedValueTaxCodeDescription: c.taxCodeDesc,
                forEquipmentUse: false, IsIssueFromStock: false, CurrencySymbol: '£', AssignType: 0,
                RackShelfId: null, LocationId: null, Discount: '0.00', TagIds: null, Status: 'Required',
                LimitedSORAccess: false, PartSerial: null, SellingRateId: null
            }]
        };
    }
    async function addMaterialLine(jobId, description, dateStr, net) {
        const d = await jobMaterialDefaults(jobId);
        const r = await fetch('/api/JobLine/AddMaterialCosts', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', '__RequestVerificationToken': csrf() },
            body: JSON.stringify(buildMaterialBody(jobId, description, dateStr, net, d.uplift, d.pct))
        });
        const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (e) {}
        if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + txt.slice(0, 120));
        if (j && j.success === false) throw new Error(j.Message || j.message || 'AddMaterialCosts returned success=false');
        return true;
    }
    function noCostItems() {
        return results.filter(r => r.status === 'NO COSTS' && r.jobId && r.net != null).map(r => ({
            jobId: r.jobId, jobNumber: r.jobFound || r.jobNumber || ('job ' + r.jobId), owner: r.owner || '',
            description: String(r.xeroDesc || r.merchant || 'Materials').trim().slice(0, 250),
            date: r.date || '', net: r.net
        }));
    }
    async function stage2DryRun() {
        if (stage2Running) return;
        const items = noCostItems();
        if (!items.length) { alert('No "NO COSTS" rows to add. Run a check first.'); return; }
        stage2Items = items;
        resultsBox.innerHTML = ''; logArea.innerHTML = '';
        log(`STAGE 2 — DRY RUN: ${items.length} NO-COSTS line(s) would be added (nothing written yet):`, '#0af');
        setProgress('Stage 2 dry run — reading job uplifts...');
        const missingDesc = items.filter(i => !i.description || i.description === 'Materials').length;
        for (const it of items) {
            const d = await jobMaterialDefaults(it.jobId);
            const sell = (it.net * (1 + (d.uplift || 0) / 100)).toFixed(2);
            log(`  ${it.jobNumber}: "${it.description.slice(0, 44)}"  cost £${it.net.toFixed(2)} -> sell £${sell} (uplift ${(d.uplift || 0)}%) · ${it.date || '(no date)'} · chargeable · no engineer (owner: ${it.owner || '?'})`, '#9cf');
        }
        if (missingDesc) log(`  ⚠ ${missingDesc} row(s) have no Xero description — they will use the merchant/"Materials".`, '#fb0');
        log('Each is a chargeable Material line: cost = NET, sell = cost + the job default uplift, 20% VAT. Engineer NOT set (assign in JobLogic — owner shown).', '#fb0');
        log('Click "Confirm & write" to add them to JobLogic.', '#fb0');
        confirmBtn.style.display = 'inline-block';
        setProgress(`Stage 2 dry run: ${items.length} line(s) ready. Review, then Confirm & write.`);
    }
    async function stage2Write() {
        if (stage2Running || !stage2Items.length) return;
        if (!confirm(`Add ${stage2Items.length} material line(s) to JobLogic now? This writes to live jobs.`)) return;
        stage2Running = true; confirmBtn.style.display = 'none'; stage2Btn.style.display = 'none'; stopBtn.style.display = 'inline-block';
        log('', '#fff'); log('WRITING...', '#f55');
        let ok = 0, fail = 0;
        for (let i = 0; i < stage2Items.length; i++) {
            if (!stage2Running) { log('Stopped by user.', '#f55'); break; }
            const it = stage2Items[i];
            setProgress(`Adding ${i + 1}/${stage2Items.length}: ${it.jobNumber}`);
            try { await addMaterialLine(it.jobId, it.description, it.date, it.net); log(`  ✓ ${it.jobNumber}: added £${it.net.toFixed(2)} "${it.description.slice(0, 34)}"`, '#0fa'); ok++; }
            catch (e) { log(`  ✗ ${it.jobNumber}: ${e.message}`, '#f55'); fail++; }
            await sleep(400);
        }
        log('', '#fff'); log(`STAGE 2 DONE — ${ok} added, ${fail} failed.`, '#0af');
        setProgress(`Stage 2 done: ${ok} added, ${fail} failed.`);
        stage2Running = false; stopBtn.style.display = 'none';
    }

    function copyResults() {
        const hl = (url, label) => url ? `=HYPERLINK("${url}","${String(label || '').replace(/"/g, '""')}")` : (label || '');
        // Flatten anything that would break a TSV paste into Google Sheets: tabs/newlines
        // (row/column splitters) -> space, and double-quotes -> single (a stray " otherwise
        // makes Sheets swallow following cells and mangles the =HYPERLINK formulas).
        const cell = v => String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' ').replace(/"/g, "'").trim();
        const headers = ['Receipt', 'Merchant', 'Note', 'Owner', 'Date', 'Net', 'Gross', 'Status',
            'Job Found', 'Job ID', 'Undelivered SPO', 'Related Quote', 'Cost near value', 'Matched / closest line', 'Other info', 'Suggested fix',
            'Cost description', 'Chargeable', 'Line ID', 'Line invoiced'];
        const lines = [headers.join('\t')];
        results.forEach(r => lines.push([
            cell(r.receipt), cell(r.merchant), cell(r.note), cell(r.owner), cell(r.date),
            r.net != null ? r.net.toFixed(2) : '', r.gross != null ? r.gross.toFixed(2) : '',
            cell(r.status),
            r.jobFound ? hl(r.jobLink, r.jobFound) : 'No',
            cell(r.jobId),
            (r.spoText && r.spoText !== 'No') ? hl(r.spoUrl, r.spoText) : 'No',
            (r.quoteText && r.quoteText !== 'No') ? hl(r.quoteUrl, r.quoteText) : 'No',
            cell(r.costNear), cell(r.costLine), cell(r.other), cell(r.suggest),
            cell(r.xeroDesc || r.merchant), cell(r.chargeable || ''),
            cell(r.lineId || ''), cell(r.lineInvoiced || '')
        ].join('\t')));
        navigator.clipboard.writeText(lines.join('\n')).then(
            () => setProgress('Results copied — paste into your sheet.'),
            () => setProgress('Copy failed — select the log manually.')
        );
    }

    function log(msg, color) {
        const line = document.createElement('div');
        line.style.cssText = `color:${color || '#ccc'};white-space:pre-wrap;word-break:break-word;`;
        line.textContent = msg;
        logArea.appendChild(line);
        logArea.scrollTop = logArea.scrollHeight;
    }
    const setProgress = (m) => { progressText.textContent = m; };

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
    // A small help banner prepended inside a panel the first time it opens.
    function jlHelpBanner(text) {
        const b = document.createElement('div');
        b.className = 'jl-help-banner';
        b.style.cssText = 'background:#0e3a4f;color:#e3edf2;font-family:"Open Sans",sans-serif;font-size:11px;line-height:1.45;padding:8px 10px;border-radius:4px;margin:0 0 8px 0;border-left:3px solid #ff7919;';
        b.textContent = text;
        return b;
    }
    // Collapse a panel to a dock button. panelEl = the OUTERMOST element of the
    // script's floating UI. desc = on-hover + in-panel summary text.
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

    function createUI() {
        if (document.getElementById('jl-costrec-panel')) return;

        panel = document.createElement('div');
        panel.id = 'jl-costrec-panel';
        const c = document.createElement('div');
        c.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;background:#1a1a2e;color:#eee;border-radius:8px;padding:14px;width:560px;max-height:92vh;display:flex;flex-direction:column;font-family:monospace;font-size:12px;box-shadow:0 4px 20px rgba(0,0,0,.5);';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;';
        const title = document.createElement('strong'); title.style.fontSize = '14px'; title.textContent = 'Check costs are in Jobs correctly' + (SCRIPT_VERSION ? '  (v' + SCRIPT_VERSION + ')' : '');
        const x = document.createElement('button'); x.textContent = '–'; x.title = 'Collapse';
        x.style.cssText = 'background:none;border:none;color:#eee;font-size:20px;cursor:pointer;line-height:1;';
        x.addEventListener('click', () => { panel.style.display = 'none'; });
        header.appendChild(title); header.appendChild(x);

        const hint = document.createElement('div');
        hint.style.cssText = 'color:#9ab;font-size:11px;margin-bottom:6px;';
        hint.textContent = 'Paste the expense rows INCLUDING the header row (copy straight from the sheet = tab-separated). Refs are read from Note + Source description.';

        pasteArea = document.createElement('textarea');
        pasteArea.placeholder = 'Date\tReceipt\t…\tNote\t…  (paste header + rows here)';
        pasteArea.style.cssText = 'width:100%;height:90px;background:#0a0a1a;color:#eee;border:1px solid #555;border-radius:4px;font-family:monospace;font-size:11px;padding:6px;box-sizing:border-box;resize:vertical;';

        const controls = document.createElement('div');
        controls.style.cssText = 'margin:8px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap;';
        runBtn = mkBtn('Check costs', '#0a8', run);
        stopBtn = mkBtn('Stop', '#a22', () => { running = false; stage2Running = false; }); stopBtn.style.display = 'none';
        copyBtn = mkBtn('Copy results', '#08a', copyResults); copyBtn.style.display = 'none';
        stage2Btn = mkBtn('➕ Add NO-COSTS to jobs', '#6b4226', stage2DryRun); stage2Btn.style.display = 'none';
        confirmBtn = mkBtn('Confirm & write', '#a22', stage2Write); confirmBtn.style.display = 'none';
        progressText = document.createElement('span'); progressText.style.color = '#0fa';
        progressText.textContent = 'Ready.';
        controls.appendChild(runBtn); controls.appendChild(stopBtn); controls.appendChild(copyBtn); controls.appendChild(stage2Btn); controls.appendChild(confirmBtn); controls.appendChild(progressText);

        resultsBox = document.createElement('div');
        resultsBox.style.cssText = 'overflow-y:auto;max-height:46vh;margin-bottom:6px;';

        const logLabel = document.createElement('div'); logLabel.style.cssText = 'color:#888;font-size:10px;margin-top:4px;'; logLabel.textContent = 'log';
        logArea = document.createElement('div');
        logArea.style.cssText = 'overflow-y:auto;background:#0a0a1a;padding:6px;border-radius:4px;max-height:18vh;font-size:11px;';

        c.appendChild(header); c.appendChild(hint); c.appendChild(pasteArea);
        c.appendChild(controls); c.appendChild(resultsBox); c.appendChild(logLabel); c.appendChild(logArea);
        panel.appendChild(c); document.body.appendChild(panel);
        jlRegisterPanel(panel, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR, SCRIPT_DESC);
    }
    function mkBtn(text, bg, fn) {
        const b = document.createElement('button');
        b.textContent = text;
        b.style.cssText = `background:${bg};color:#fff;border:none;padding:7px 13px;border-radius:4px;cursor:pointer;`;
        b.addEventListener('click', fn);
        return b;
    }

    // --- BOOT ---
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', createUI);
    else createUI();
})();
