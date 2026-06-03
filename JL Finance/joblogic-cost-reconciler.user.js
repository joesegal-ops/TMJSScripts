// ==UserScript==
// @name         Joblogic - Cost Reconciler (Pleo expenses vs Job Logic costs)
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Paste a Pleo/CSV expense export. For each row the script finds the job (by Job ref / Salesforce ref / Quote UP-number), reads the Costs page (and parent/related Quote + delivered PO costs), and checks whether the receipt's NET value is already in the job. Flags rows as Already in the job / Incorrect (with a why) / Not found. READ-ONLY — it never changes anything. v1.1: collapses to a launcher button in a shared dock so multiple JL scripts line up.
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
    let panel, pasteArea, logArea, scanBtn, runBtn, stopBtn, copyBtn, progressText, resultsBox;

    // This script's identity in the shared dock (keep unique per script).
    const SCRIPT_ID = 'cost-reconciler';
    const SCRIPT_LABEL = '💷 Cost Reconciler';
    const SCRIPT_COLOR = '#0a8';
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
    const RE_JOBREF = /\b(?:RE|PROJ|MOB|M|R)\s?0*\d{2,}\b/gi; // reactive/project/maintenance/job
    const RE_SF      = /\b1\d{7}\b/g;                          // Salesforce: 8 digits starting with 1
    const RE_QUOTE   = /\bUP\s?0*\d{2,}\b/gi;                  // Quote number UP....

    function normJobRef(raw) {
        // "PROJ 1393" -> "PROJ1393" ; "Re0021779" -> "RE0021779"
        return raw.replace(/\s+/g, '').toUpperCase();
    }
    function extractRefs(text) {
        const t = String(text || '');
        const out = { job: [], sf: [], quote: [] };
        (t.match(RE_QUOTE) || []).forEach(m => out.quote.push(m.replace(/\s+/g, '').toUpperCase()));
        // remove quote hits before scanning job refs so "UP02443" isn't read as job "P02443"
        let t2 = t.replace(RE_QUOTE, ' ');
        (t2.match(RE_JOBREF) || []).forEach(m => out.job.push(normJobRef(m)));
        (t.match(RE_SF) || []).forEach(m => out.sf.push(m));
        out.job = [...new Set(out.job)];
        out.sf = [...new Set(out.sf)];
        out.quote = [...new Set(out.quote)];
        return out;
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
            res = { id: m.Id || m.JobId, jobNumber: m.JobNumber || m.ReferenceNumber || term, multiple: jobs.length };
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
                        id: l.Id,
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

    // API: RELATED WORKS -> related/parent quote(s) + their embedded cost lines
    async function getRelatedWorks(jobId) {
        const r = await fetch(`/Job/GetRelatedWorks?jobId=${jobId}`, {
            credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });
        if (!r.ok) throw new Error('GetRelatedWorks HTTP ' + r.status);
        const html = await r.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');

        // Quote reference(s)
        const quoteLinks = [...doc.querySelectorAll('a[href*="/Quote/Detail/"]')]
            .map(a => ({ num: a.textContent.replace(/\s+/g, ' ').trim(), href: a.getAttribute('href') }));
        const quoteLabel = quoteLinks.length ? quoteLinks.map(q => q.num).join(', ') : 'related quote';

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
        return { quoteLabel: quoteLinks.length ? quoteLabel : null, quoteLinks, lines };
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
        // Sometimes the line has qty>1 and the receipt net is the line subtotal (ex-VAT) — also correct.
        if (eqMoney(sub, net) && (q == null || q <= 1)) {
            return { verdict: 'OK', why: `Line subtotal £${sub.toFixed(2)} = receipt net £${net.toFixed(2)}`, score: 0 };
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
        const recs = delim === '\t'
            ? raw.split('\n').map(l => l.split('\t'))
            : parseCSV(raw);
        const headers = recs[0].map(h => h.trim());
        const rows = recs.slice(1).filter(r => r.some(c => (c || '').trim() !== ''))
            .map(r => { const o = {}; headers.forEach((h, i) => o[h] = (r[i] || '').trim()); o.__cells = r; return o; });
        return { headers, rows };
    }
    function parseCSV(text) {
        const out = []; let row = [], field = '', inQ = false;
        for (let i = 0; i < text.length; i++) {
            const c = text[i];
            if (inQ) {
                if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
                else field += c;
            } else {
                if (c === '"') inQ = true;
                else if (c === ',') { row.push(field); field = ''; }
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
            receipt: col(row, ['Receipt', 'Expense ID', 'Document Number'])
        };
    }
    // "30-05-2026" -> "30/05/2026" (JobLogic DateIncurred format)
    function normalizeDate(s) {
        const m = String(s || '').match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
        if (!m) return '';
        const d = m[1].padStart(2, '0'), mo = m[2].padStart(2, '0'), y = m[3].length === 2 ? '20' + m[3] : m[3];
        return `${d}/${mo}/${y}`;
    }

    // ===================================================================
    // PER-ROW PROCESSING
    // ===================================================================
    async function resolveJob(refs) {
        // returns {id, jobNumber, via, quoteNote} or null
        for (const ref of refs.job) {
            const j = await searchJob(ref); if (j) return { ...j, via: 'job ref ' + ref };
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
        const base = { idx, receipt: m.receipt, merchant: m.merchant, owner: m.owner, date: m.date, net: m.net, gross: m.gross };

        if (m.net == null) {
            return { ...base, status: 'NO VALUE', detail: 'No Net/Amount could be read from this row.' };
        }
        const anyRef = m.refs.job.length || m.refs.sf.length || m.refs.quote.length;
        if (!anyRef) {
            return { ...base, status: 'NO REFERENCE', detail: `No job ref / SF number / quote in Note or Source. Note: "${(m.note || '').slice(0, 60)}"` };
        }

        const job = await resolveJob(m.refs);
        if (!job) {
            const tried = [...m.refs.job, ...m.refs.sf, ...m.refs.quote].join(', ');
            return { ...base, status: 'JOB NOT FOUND', detail: `Could not locate a job from: ${tried}` };
        }
        if (!job.id) {
            return { ...base, status: 'NO JOB', jobNumber: job.jobNumber, detail: `${job.via} — quote not yet upgraded to a job.` };
        }

        // 1) Costs on the job (includes delivered Supplier PO costs)
        const { lines, parseOk } = await getJobCosts(job.id);
        let allLines = lines.slice();
        let best = matchAgainstLines(m.net, m.gross, m.vat, allLines, m.owner, m.date);

        // 2) If nothing on the job, look at parent/related quote (+ its embedded costs)
        let secondaryNote = '';
        if (!best) {
            try {
                const rw = await getRelatedWorks(job.id);
                if (rw.lines.length) {
                    best = matchAgainstLines(m.net, m.gross, m.vat, rw.lines, m.owner, m.date);
                    if (best) secondaryNote = ' (found in ' + best.line.source + ')';
                } else if (rw.quoteLabel) {
                    secondaryNote = ` (related quote ${rw.quoteLabel} has no matching cost line)`;
                }
            } catch (e) { /* related works optional */ }
        }

        const jobUrl = `${location.origin}/Job/Detail/${job.id}`;
        if (!best) {
            return {
                ...base, jobNumber: job.jobNumber, jobId: job.id, jobUrl, via: job.via,
                status: 'NOT IN JOB',
                detail: `Job ${job.jobNumber} found (${job.via}) but no cost line near £${m.net.toFixed(2)} net${secondaryNote}.` +
                        (parseOk ? '' : ' [could not read cost model]')
            };
        }

        const soft = [];
        if (best.ownerMatch) soft.push('owner ✓'); else if (m.owner && best.line.engineer) soft.push(`owner: sheet "${m.owner}" vs JL "${best.line.engineer}"`);
        if (best.dateMatch) soft.push('date ✓'); else if (m.date && best.line.date) soft.push(`date: sheet ${m.date} vs JL ${best.line.date}`);

        if (best.verdict === 'OK') {
            return {
                ...base, jobNumber: job.jobNumber, jobId: job.id, jobUrl, via: job.via,
                status: 'ALREADY IN JOB',
                detail: best.why + secondaryNote + (soft.length ? '  [' + soft.join('; ') + ']' : '')
            };
        }
        return {
            ...base, jobNumber: job.jobNumber, jobId: job.id, jobUrl, via: job.via,
            status: 'INCORRECT', factor: best.factor,
            detail: best.why + secondaryNote + (soft.length ? '  [' + soft.join('; ') + ']' : ''),
            suggest: `Change ${best.line.source} "${(best.line.desc || '').slice(0, 40)}" unit cost to £${m.net.toFixed(2)} (net).`
        };
    }

    // ===================================================================
    // MAIN LOOP
    // ===================================================================
    async function run() {
        if (running) return;
        const parsed = parseSheet(pasteArea.value);
        if (!parsed.rows.length) { alert('Paste your sheet rows (with the header row) first.'); return; }
        rows = parsed.rows; results = [];
        running = true;
        runBtn.style.display = 'none'; stopBtn.style.display = 'inline-block'; copyBtn.style.display = 'none';
        logArea.innerHTML = ''; resultsBox.innerHTML = '';
        log(`Parsed ${parsed.headers.length} columns, ${rows.length} rows.`, '#0af');

        const stats = { ok: 0, incorrect: 0, notin: 0, notfound: 0, noref: 0, noval: 0, err: 0 };
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
        log(`Not in job:     ${stats.notin}`, '#f90');
        log(`Job not found:  ${stats.notfound}`, '#f55');
        log(`No reference:   ${stats.noref}`, '#999');
        log(`No value:       ${stats.noval}`, '#999');
        if (stats.err) log(`Errors:         ${stats.err}`, '#f55');
        setProgress(`Done — ${rows.length} rows.`);
        running = false;
        runBtn.style.display = 'inline-block'; stopBtn.style.display = 'none';
        copyBtn.style.display = 'inline-block';
    }

    function tallyAndRender(res, stats) {
        const map = { 'ALREADY IN JOB': 'ok', 'INCORRECT': 'incorrect', 'NOT IN JOB': 'notin',
            'JOB NOT FOUND': 'notfound', 'NO JOB': 'notfound', 'NO REFERENCE': 'noref', 'NO VALUE': 'noval' };
        if (map[res.status]) stats[map[res.status]]++;
        renderResult(res);
    }

    // ===================================================================
    // UI
    // ===================================================================
    const STATUS_COLOR = {
        'ALREADY IN JOB': '#0fa', 'INCORRECT': '#fb0', 'NOT IN JOB': '#f90',
        'JOB NOT FOUND': '#f55', 'NO JOB': '#f77', 'NO REFERENCE': '#999',
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
        resultsBox.appendChild(card);
        resultsBox.scrollTop = resultsBox.scrollHeight;
    }

    function copyResults() {
        const headers = ['Receipt', 'Merchant', 'Owner', 'Date', 'Net', 'Gross', 'Status', 'Factor', 'Job', 'Explanation', 'Suggested fix'];
        const lines = [headers.join('\t')];
        results.forEach(r => lines.push([
            r.receipt || '', r.merchant || '', r.owner || '', r.date || '',
            r.net != null ? r.net.toFixed(2) : '', r.gross != null ? r.gross.toFixed(2) : '',
            r.status, r.factor || '', r.jobNumber || '', (r.detail || '').replace(/\t/g, ' '),
            (r.suggest || '').replace(/\t/g, ' ')
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

    function createUI() {
        if (document.getElementById('jl-costrec-panel')) return;

        panel = document.createElement('div');
        panel.id = 'jl-costrec-panel';
        const c = document.createElement('div');
        c.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;background:#1a1a2e;color:#eee;border-radius:8px;padding:14px;width:560px;max-height:92vh;display:flex;flex-direction:column;font-family:monospace;font-size:12px;box-shadow:0 4px 20px rgba(0,0,0,.5);';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;';
        const title = document.createElement('strong'); title.style.fontSize = '14px'; title.textContent = 'Cost Reconciler  (read-only)';
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
        stopBtn = mkBtn('Stop', '#a22', () => { running = false; }); stopBtn.style.display = 'none';
        copyBtn = mkBtn('Copy results', '#08a', copyResults); copyBtn.style.display = 'none';
        progressText = document.createElement('span'); progressText.style.color = '#0fa';
        progressText.textContent = 'Ready.';
        controls.appendChild(runBtn); controls.appendChild(stopBtn); controls.appendChild(copyBtn); controls.appendChild(progressText);

        resultsBox = document.createElement('div');
        resultsBox.style.cssText = 'overflow-y:auto;max-height:46vh;margin-bottom:6px;';

        const logLabel = document.createElement('div'); logLabel.style.cssText = 'color:#888;font-size:10px;margin-top:4px;'; logLabel.textContent = 'log';
        logArea = document.createElement('div');
        logArea.style.cssText = 'overflow-y:auto;background:#0a0a1a;padding:6px;border-radius:4px;max-height:18vh;font-size:11px;';

        c.appendChild(header); c.appendChild(hint); c.appendChild(pasteArea);
        c.appendChild(controls); c.appendChild(resultsBox); c.appendChild(logLabel); c.appendChild(logArea);
        panel.appendChild(c); document.body.appendChild(panel);
        jlRegisterPanel(panel, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR);
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
