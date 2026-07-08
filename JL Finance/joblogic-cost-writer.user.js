// ==UserScript==
// @name         Joblogic - Enter checked costs into jobs (Cost Reconciler writer)
// @namespace    http://tampermonkey.net/
// @version      1.5
// @description  Companion to the Cost Reconciler. Paste the reconciler's exported rows (after you've filtered out the ones you don't want to touch, header row included). Two actions per row, decided by the Status column: (1) NO COSTS / NOT IN JOB -> ADD a new Material line (cost = Net, qty 1, 20% VAT, the job's default uplift, Xero/Cost description + date; quoted/project jobs flagged Chargeable=No are added NON-chargeable, sell 0). (2) INCORRECT with a Line ID -> FIX the existing line's unit cost to Net (sell follows the line's own uplift) UNLESS it has been invoiced, in which case it is skipped. Every fix is re-read to confirm it applied. Dry-run first, then Confirm & write. No engineer is set (assign in JobLogic).
// @match        https://go.joblogic.com/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Finance/joblogic-cost-writer.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Finance/joblogic-cost-writer.user.js
// ==/UserScript==

(function () {
    'use strict';

    // ===================================================================
    // CONFIG (same material-line defaults as the reconciler's Stage 2)
    // ===================================================================
    const CFG = {
        taxCodeId: 'c1d73a68-7887-4f91-9124-26100ef712b0', taxCodeValue: '20.00',
        taxCodeDesc: '20% (VAT on Income) (20.00%)',
        payBandId: 'f76846b0-674b-4410-8473-c2f22508f51c', payBandDesc: 'Basic',
        libraryId: 54838, libraryName: 'Standard Parts Library'
    };
    const DELAY_BETWEEN_WRITES = 400; // ms politeness delay between writes
    const VAT_FALLBACK = 0.20;

    // ===================================================================
    // STATE
    // ===================================================================
    let panel, pasteArea, logArea, parseBtn, writeBtn, stopBtn, progressText, resultsBox;
    let items = [], running = false;
    const searchCache = new Map();  // jobNumber -> {id, jobNumber} | null
    const upliftCache = new Map();  // jobId -> {uplift, pct}

    const SCRIPT_ID = 'cost-writer';
    const SCRIPT_LABEL = '📥 Enter checked costs into jobs';
    const SCRIPT_VERSION = ((typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || '1.5');
    const SCRIPT_COLOR = '#4c9f01';
    const SCRIPT_DESC = 'Paste the Cost Reconciler export (with header row) AFTER filtering out rows you do not want. NO COSTS / NOT IN JOB rows are ADDED as Material lines (non-chargeable for quoted/project jobs); INCORRECT rows have the existing line\'s cost FIXED to Net (skipped if invoiced). Dry-run, review, then Confirm & write.';

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const csrf = () => document.querySelector('input[name="__RequestVerificationToken"]')?.value || '';

    // ===================================================================
    // NUMBER / TEXT HELPERS  (matched to the reconciler)
    // ===================================================================
    function money(v) {
        if (v == null) return null;
        const s = String(v).replace(/[£$,\s]/g, '').replace(/[()]/g, '');
        const n = parseFloat(s);
        return isNaN(n) ? null : Math.abs(n);
    }
    const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();
    // "30-05-2026" / "30/05/26" -> "30/05/2026" (JobLogic DateIncurred date part)
    function normalizeDate(s) {
        const m = String(s || '').match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
        if (!m) return '';
        const d = m[1].padStart(2, '0'), mo = m[2].padStart(2, '0'), y = m[3].length === 2 ? '20' + m[3] : m[3];
        return `${d}/${mo}/${y}`;
    }
    function todayDMY() {
        const d = new Date();
        return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    }
    function parseChargeable(v) {
        const s = norm(v);
        if (!s) return true;                                   // default: chargeable
        return !/^(no|n|non-?chargeable|false|0)$/.test(s);
    }

    // ===================================================================
    // SHEET PARSING (TSV preferred, CSV supported) — copy of the reconciler's
    // ===================================================================
    function parseSheet(text) {
        const raw = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
        if (!raw.trim()) return { headers: [], rows: [] };
        const firstLine = raw.split('\n')[0];
        const delim = firstLine.includes('\t') ? '\t' : ',';
        // Quote-aware for both tab and comma: cells copied from Google Sheets that contain
        // newlines/tabs/quotes come back "…"-quoted, so a naive split() would shred them.
        const recs = parseDelimited(raw, delim);
        const headers = recs[0].map(h => h.trim());
        const rows = recs.slice(1).filter(r => r.some(c => (c || '').trim() !== ''))
            .map(r => { const o = {}; headers.forEach((h, i) => o[h] = (r[i] || '').trim()); return o; });
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
    function col(row, names) {
        const keys = Object.keys(row);
        for (const n of names) {
            const k = keys.find(k => norm(k) === norm(n));
            if (k != null && row[k] !== '') return row[k];
        }
        for (const n of names) {
            const k = keys.find(k => norm(k).includes(norm(n)));
            if (k != null && row[k] !== '') return row[k];
        }
        return '';
    }

    // ===================================================================
    // ROW -> WRITE ITEM
    // The reconciler export carries a plain "Job ID" column (the Job Found
    // hyperlink flattens to text when pasted through a sheet, so we cannot
    // rely on it). Fall back to the hyperlink URL, then to a job-number search.
    // ===================================================================
    function rowJobId(row) {
        const direct = col(row, ['Job ID', 'JobId', 'Job Id']);
        if (direct && /^\d+$/.test(direct.trim())) return direct.trim();
        const found = col(row, ['Job Found', 'Job']);
        const m = String(found).match(/\/Job\/Detail\/(\d+)/);
        return m ? m[1] : null;
    }
    function rowJobNumber(row) {
        const found = col(row, ['Job Found', 'Job']);
        const hm = String(found).match(/=HYPERLINK\([^,]+,\s*"([^"]+)"/i);
        return (hm ? hm[1] : String(found)).trim();
    }
    function mapRow(row, idx) {
        const net = money(col(row, ['Net', 'Net Amount']));
        const desc = (col(row, ['Cost description', 'Xero description', 'Xero Description', 'Xero desc'])
            || col(row, ['Merchant', 'Source description', 'Description']) || 'Materials').trim().slice(0, 250);
        const dateRaw = normalizeDate(col(row, ['Date']));
        const lineIdRaw = (col(row, ['Line ID', 'LineId', 'Line Id']) || '').trim();
        return {
            idx,
            jobId: rowJobId(row),
            jobNumber: rowJobNumber(row) || ('row ' + (idx + 1)),
            status: (col(row, ['Status']) || '').toUpperCase(),
            owner: col(row, ['Owner']),
            description: desc,
            date: dateRaw,                       // '' if missing — defaulted to today at write
            dateGiven: !!dateRaw,
            net,
            chargeable: parseChargeable(col(row, ['Chargeable'])),
            lineId: /^\d+$/.test(lineIdRaw) ? lineIdRaw : '',     // for INCORRECT auto-fix
            lineInvoicedSheet: col(row, ['Line invoiced', 'Line Invoiced'])
        };
    }

    // ===================================================================
    // API: JOB SEARCH (fallback only — when no Job ID survived the export)
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
            res = { id: m.Id || m.JobId, jobNumber: m.JobNumber || m.ReferenceNumber || term, exact: !!exact };
        }
        searchCache.set(term, res);
        return res;
    }

    // ===================================================================
    // API: ADD MATERIAL LINE  (verified: POST /api/JobLine/AddMaterialCosts)
    // ===================================================================
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
    function buildMaterialBody(jobId, description, dateStr, net, uplift, pct, chargeable) {
        const c = CFG, cost = Number(net);
        // Non-chargeable: no margin and no sell value (the customer is billed off the quote, not this line).
        const up = chargeable ? (Number(uplift) || 0) : 0;
        const v = cost.toFixed(2);
        const sell = chargeable ? (cost * (1 + up / 100)).toFixed(2) : '0.00';
        const dPart = dateStr || todayDMY();
        const dt = /\d{1,2}:\d{2}/.test(dPart) ? dPart : (dPart + ' 09:00');
        return {
            JobId: jobId, TimeId: null, VirtualTimeId: null,
            CostLines: [{
                Id: null, PartNumber: null, Quantity: '1', ReturnQuantity: 0, IsReturnItemToStock: false,
                CostPerUnit: v, CostPerHour: '0.00', Uplift: up.toFixed(2), SellPerUnit: sell, SellPerHour: '0.00',
                CreateLibraryAllowed: true, CategoryId: null, CategoryDescription: null, ForEquipmentUse: false,
                Make: null, Model: null, HasFixedSell: false, SetupSell: 0,
                TaxCodeId: c.taxCodeId, TaxCodeValue: c.taxCodeValue, TaxCodeDescription: c.taxCodeDesc,
                IsChargeable: !!chargeable, PriceCalculationType: pct != null ? pct : 1,
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
    async function addMaterialLine(it) {
        const d = await jobMaterialDefaults(it.jobId);
        const r = await fetch('/api/JobLine/AddMaterialCosts', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', '__RequestVerificationToken': csrf() },
            body: JSON.stringify(buildMaterialBody(it.jobId, it.description, it.date, it.net, d.uplift, d.pct, it.chargeable))
        });
        const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (e) {}
        if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + txt.slice(0, 120));
        if (j && j.success === false) throw new Error(j.Message || j.message || 'AddMaterialCosts returned success=false');
        return true;
    }

    // ===================================================================
    // API: EDIT AN EXISTING COST LINE  (verified for Material AND Expense)
    //   Material -> GET GetEditMaterialCostMetadata, POST /api/JobLine/SaveMaterialCost
    //   Expense  -> GET GetEditExpenseCostMetadata,  POST /api/JobLine/SaveExpenseCost
    // The save body is the FLAT line object (JobId inside, money as strings,
    // Status:'Required') — captured/verified from the live editor. We build it from the
    // line's OWN edit-metadata so description/date/tax/chargeable/engineer are preserved.
    // To fix the cost we target the LINE TOTAL: set Quantity=1 and unit=Net, so the total
    // equals the receipt net exactly regardless of the original quantity (per user: the
    // total must be right; the quantity split does not matter). Sell follows the line's
    // own uplift. HasBeenInvoiced is the authoritative gate — invoiced lines are skipped.
    // ===================================================================
    // Returns { meta, type } where type is 'Material' | 'Expense', or null if not found.
    async function fetchEditMeta(jobId, lineId) {
        for (const type of ['Material', 'Expense']) {
            try {
                const r = await fetch(`/api/JobCost/GetEdit${type}CostMetadata?jobId=${jobId}&id=${lineId}`, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
                if (!r.ok) continue;
                const j = await r.json();
                if (j && j.success !== false && j.AdditionalData && String(j.AdditionalData.Id) === String(lineId)) {
                    return { meta: j.AdditionalData, type };
                }
            } catch (e) { /* try next type */ }
        }
        return null;
    }
    function buildEditBody(meta, type, net) {
        const chargeable = !!meta.IsChargeable;
        const uplift = Number(meta.Uplift) || 0;
        const unit = Number(net);                       // qty forced to 1 -> total = net exactly
        const sell = meta.HasFixedSell ? (Number(meta.SellPerUnit) || 0)
                   : (chargeable ? unit * (1 + uplift / 100) : 0);
        const s = (n) => (Number(n) || 0).toFixed(2);
        const body = {
            Id: meta.Id, PartNumber: meta.PartNumber ?? null, Quantity: 1, ReturnQuantity: meta.ReturnQuantity ?? 0,
            IsReturnItemToStock: !!meta.IsReturnItemToStock,
            CostPerUnit: s(unit), CostPerHour: '0.00', Uplift: s(uplift), SellPerUnit: s(sell), SellPerHour: '0.00',
            CategoryId: meta.CategoryId ?? null, CategoryDescription: meta.CategoryDescription || '',
            ForEquipmentUse: !!meta.ForEquipmentUse, Make: meta.Make ?? null, Model: meta.Model ?? null,
            HasFixedSell: !!meta.HasFixedSell, SetupSell: meta.SetupSell ?? 0,
            TaxCodeId: meta.TaxCodeId, TaxCodeValue: meta.TaxCodeValue, TaxCodeDescription: meta.TaxCodeDescription,
            IsChargeable: chargeable, PriceCalculationType: meta.PriceCalculationType ?? (type === 'Expense' ? 0 : 1),
            Description: meta.Description, CreatePayBandAllowed: !!meta.CreatePayBandAllowed,
            DateIncurred: meta.DateIncurred, HasQuote: !!meta.HasQuote, ItemId: meta.ItemId || 0, JobLineOption: meta.LineType,
            QuotedValueTaxCodeId: meta.QuotedValueTaxCodeId, QuotedValueTaxCodeDescription: meta.QuotedValueTaxCodeDescription,
            forEquipmentUse: !!meta.ForEquipmentUse, IsIssueFromStock: !!meta.IsIssueFromStock,
            CurrencySymbol: meta.CurrencySymbol || '£', AssignType: meta.AssignType || 0,
            RackShelfId: meta.RackShelfId ?? null, LocationId: meta.LocationId ?? null,
            DepotId: meta.DepotId ?? null, StoreId: meta.StoreId ?? null, Discount: '0.00', TagIds: meta.TagIds || [],
            Status: 'Required', LimitedSORAccess: !!meta.LimitedSORAccess, PartSerial: meta.PartSerial ?? null,
            SellingRateId: meta.SellingRateId ?? null, JobId: meta.JobId
        };
        if (type === 'Material') {
            body.CreateLibraryAllowed = !!meta.CreateLibraryAllowed;
            body.LibraryId = meta.LibraryId ?? null;
            body.LibraryName = meta.LibraryName ?? null;
        } else { // Expense: preserve the expense link, engineer and trade
            body.ExpenseId = meta.ExpenseId ?? null;
            body.ExpenseDescription = meta.ExpenseDescription ?? '';
            body.EngineerId = meta.EngineerId ?? null;
            body.EngineerName = meta.EngineerName || '';
            body.EngineerTeamId = meta.EngineerTeamId ?? null;
            body.EngineerTeamName = meta.EngineerTeamName || '';
            body.TradeId = meta.TradeId ?? null;
            body.TradeDescription = meta.TradeDescription ?? null;
            body.PayBandId = meta.PayBandId ?? null;
            body.PayBandDescription = meta.PayBandDescription ?? null;
        }
        return body;
    }
    async function saveEdit(it) {
        const endpoint = it.lineType === 'Expense' ? '/api/JobLine/SaveExpenseCost' : '/api/JobLine/SaveMaterialCost';
        const r = await fetch(endpoint, {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', '__RequestVerificationToken': csrf() },
            body: JSON.stringify(buildEditBody(it.meta, it.lineType, it.net))
        });
        const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (e) {}
        if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + txt.slice(0, 120));
        if (j && j.success === false) throw new Error((j.errors && j.errors.join('; ')) || j.Message || 'Save returned success=false');
        // self-verify: re-read the line and confirm the new TOTAL (qty 1 × unit) = net
        const re = await fetchEditMeta(it.jobId, it.lineId);
        if (!re) throw new Error('saved but could not re-read line to verify');
        const total = Number(re.meta.CostPerUnit) * (Number(re.meta.Quantity) || 1);
        if (Math.abs(total - Number(it.net)) > 0.02) throw new Error(`saved but total not applied (line total now £${total.toFixed(2)})`);
        return true;
    }

    // ===================================================================
    // STAGE 1 — PARSE & DRY RUN
    // ===================================================================
    // Status -> action. ADD = a genuinely missing cost; FIX = wrong value on an
    // existing line. Anything else is skipped (it is either already on the job,
    // on a PO, or needs a human).
    // POSSIBLE MATCH is included: the reconciler only flags it as "a similar line may
    // exist" — if the user kept the row after filtering, they want the cost added.
    const ADD_OK = new Set(['NO COSTS', 'NOT IN JOB', 'POSSIBLE MATCH', '']);

    async function dryRun() {
        if (running) return;
        const parsed = parseSheet(pasteArea.value);
        if (!parsed.rows.length) { alert('Paste the reconciler export (including the header row) first.'); return; }
        running = true;
        parseBtn.style.display = 'none'; writeBtn.style.display = 'none'; stopBtn.style.display = 'inline-block';
        logArea.innerHTML = ''; resultsBox.innerHTML = '';
        log(`Parsed ${parsed.headers.length} columns, ${parsed.rows.length} rows.`, '#0af');
        if (!parsed.headers.some(h => /chargeable/i.test(h))) log('⚠ No "Chargeable" column — added rows default to CHARGEABLE. Re-export from reconciler v2.2+ for the flag.', '#fb0');
        if (!parsed.headers.some(h => /job id/i.test(h))) log('No "Job ID" column — resolving jobs by job number (slower, needs an exact number).', '#9cf');
        if (!parsed.headers.some(h => /line id/i.test(h))) log('No "Line ID" column — INCORRECT rows cannot be auto-fixed (re-export from reconciler v2.5+).', '#9cf');

        const mapped = parsed.rows.map(mapRow);
        items = [];
        let skip = 0, addN = 0, editN = 0;
        setProgress('Dry run — resolving jobs & lines…');
        for (const it of mapped) {
            if (!running) { log('Stopped by user.', '#f55'); break; }
            it.action = (it.status === 'INCORRECT' && it.lineId) ? 'edit'
                      : (ADD_OK.has(it.status) ? 'add' : 'skip');

            // resolve job id if it didn't survive the export
            if (!it.jobId) {
                try { const j = await searchJob(it.jobNumber); if (j) { it.jobId = j.id; it.jobNumber = j.jobNumber; } }
                catch (e) { /* reported below */ }
            }

            if (it.action === 'skip') {
                skip++;
                const why = it.status === 'INCORRECT'
                    ? 'INCORRECT but no Line ID (quoted/combined line) — fix manually'
                    : `status "${it.status || '(blank)'}" is not an add/fix row`;
                renderItem(it, { kind: 'skip', text: why }); continue;
            }
            if (it.net == null) { skip++; renderItem(it, { kind: 'skip', text: 'no Net value' }); continue; }
            if (!it.jobId) { skip++; renderItem(it, { kind: 'skip', text: 'job not found (' + it.jobNumber + ')' }); continue; }

            if (it.action === 'edit') {
                let res = null;
                try { res = await fetchEditMeta(it.jobId, it.lineId); } catch (e) { /* handled below */ }
                if (!res) { skip++; renderItem(it, { kind: 'skip', text: `line ${it.lineId} not found as a Material/Expense line (changed/removed)` }); continue; }
                const meta = res.meta;
                if (meta.HasBeenInvoiced) { skip++; renderItem(it, { kind: 'skip', text: 'line HAS been invoiced — ignored (raise a credit instead)' }); continue; }
                const uplift = Number(meta.Uplift) || 0;
                it.meta = meta;
                it.lineType = res.type;
                it.currentCost = Number(meta.CostPerUnit) * (Number(meta.Quantity) || 1);   // current line TOTAL
                it.chargeable = !!meta.IsChargeable;
                it.uplift = uplift;
                it.sell = meta.HasFixedSell ? (Number(meta.SellPerUnit) || 0).toFixed(2) : (it.chargeable ? (it.net * (1 + uplift / 100)).toFixed(2) : '0.00');
                it.description = meta.Description || it.description;
                it._ready = true; editN++;
                items.push(it);
                renderItem(it, { kind: 'ok' });
                continue;
            }

            // action === 'add'
            const d = await jobMaterialDefaults(it.jobId);
            const up = it.chargeable ? (d.uplift || 0) : 0;
            it.sell = it.chargeable ? (it.net * (1 + up / 100)).toFixed(2) : '0.00';
            it.uplift = up;
            it._ready = true; addN++;
            items.push(it);
            renderItem(it, { kind: 'ok' });
        }

        const ready = items.length;
        log('');
        log(`DRY RUN: ${ready} ready (${addN} add, ${editN} fix), ${skip} skipped.`, '#0af');
        log('ADD: new Material line — cost = Net, qty 1, 20% VAT, job uplift (0 if non-chargeable), date = sheet date or today. No engineer.', '#9cf');
        log('FIX: existing Material/Expense line set so its TOTAL = Net (qty 1 × Net; sell follows the line\'s uplift); invoiced lines skipped; each fix re-read to confirm the total.', '#9cf');
        setProgress(`Dry run: ${ready} ready, ${skip} skipped. Review, then Confirm & write.`);
        running = false;
        parseBtn.style.display = 'inline-block'; stopBtn.style.display = 'none';
        if (ready) writeBtn.style.display = 'inline-block';
    }

    // ===================================================================
    // STAGE 2 — WRITE
    // ===================================================================
    async function write() {
        if (running || !items.length) return;
        const adds = items.filter(i => i.action === 'add');
        const edits = items.filter(i => i.action === 'edit');
        const charge = adds.filter(i => i.chargeable).length;
        if (!confirm(`Write to live jobs now?\n\nADD ${adds.length} new line(s) (${charge} chargeable, ${adds.length - charge} non-chargeable)\nFIX ${edits.length} existing line(s): unit cost → Net\n\nInvoiced lines were already skipped. This cannot be undone from here.`)) return;
        running = true; writeBtn.style.display = 'none'; parseBtn.style.display = 'none'; stopBtn.style.display = 'inline-block';
        log(''); log('WRITING…', '#f55');
        let ok = 0, fail = 0;
        for (let i = 0; i < items.length; i++) {
            if (!running) { log('Stopped by user.', '#f55'); break; }
            const it = items[i];
            setProgress(`Writing ${i + 1}/${items.length}: ${it.jobNumber}`);
            try {
                if (it.action === 'edit') {
                    await saveEdit(it);
                    log(`  ✓ ${it.jobNumber}: FIXED ${it.lineType} total £${it.currentCost.toFixed(2)} → £${it.net.toFixed(2)} "${(it.description || '').slice(0, 28)}"`, '#0fa');
                } else {
                    await addMaterialLine(it);
                    log(`  ✓ ${it.jobNumber}: ADDED £${it.net.toFixed(2)} ${it.chargeable ? 'chargeable' : 'NON-chargeable'} "${it.description.slice(0, 30)}"`, '#0fa');
                }
                it._written = true; ok++;
            } catch (e) {
                log(`  ✗ ${it.jobNumber}: ${e.message}`, '#f55'); fail++;
            }
            renderItem(it, it._written ? { kind: 'done' } : { kind: 'fail' });
            await sleep(DELAY_BETWEEN_WRITES);
        }
        log(''); log(`DONE — ${ok} written, ${fail} failed.`, '#0af');
        setProgress(`Done: ${ok} written, ${fail} failed.`);
        running = false; stopBtn.style.display = 'none'; parseBtn.style.display = 'inline-block';
        items = items.filter(i => !i._written);   // leave failures available for a retry
        if (items.length) writeBtn.style.display = 'inline-block';
    }

    // ===================================================================
    // UI RENDER
    // ===================================================================
    const KIND_COLOR = { ok: '#0fa', warn: '#fb0', skip: '#888', done: '#0f8', fail: '#f55' };
    function renderItem(it, state) {
        const id = 'cw-item-' + it.idx;
        let card = document.getElementById(id);
        if (!card) {
            card = document.createElement('div');
            card.id = id;
            card.style.cssText = 'background:#11111f;margin:6px 0;padding:8px 10px;border-radius:4px;border-left:4px solid #888;';
            resultsBox.appendChild(card);
        }
        const color = KIND_COLOR[state.kind] || '#888';
        card.style.borderLeftColor = color;
        const act = it.action === 'edit' ? 'FIX' : (it.action === 'add' ? 'ADD' : '');
        const base = { ok: act ? act + ' READY' : 'READY', warn: 'REVIEW', skip: 'SKIP', done: act ? act + ' ✓' : 'WRITTEN ✓', fail: 'FAILED ✗' }[state.kind] || '';
        const chg = it.chargeable ? '<span style="color:#0fa">chargeable</span>' : '<span style="color:#fb0">NON-chargeable</span>';
        const valText = it.action === 'edit'
            ? `£${it.currentCost != null ? it.currentCost.toFixed(2) : '?'} → £${it.net != null ? it.net.toFixed(2) : '?'}`
            : `£${it.net != null ? it.net.toFixed(2) : '?'}`;
        const whenText = it.action === 'edit' ? ('line ' + it.lineId) : (it.date || todayDMY() + ' (today)');
        card.innerHTML =
            `<div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline;">
               <strong style="color:${color}">${base}</strong>
               <span style="color:#6cf">${it.jobNumber}${it.jobId ? '' : ' (?)'}</span>
             </div>
             <div style="color:#bbb;font-size:11px;margin-top:3px;">
               ${valText} · ${chg}${it.sell != null ? ` · sell £${it.sell}` : ''} · ${whenText} · "${(it.description || '').slice(0, 44)}"
             </div>` +
            (state.text ? `<div style="color:${state.kind === 'skip' ? '#f99' : '#fc8'};font-size:11px;margin-top:3px;">➜ ${state.text}</div>` : '');
        resultsBox.scrollTop = resultsBox.scrollHeight;
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

    function createUI() {
        if (document.getElementById('jl-costwriter-panel')) return;

        panel = document.createElement('div');
        panel.id = 'jl-costwriter-panel';
        const c = document.createElement('div');
        c.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;background:#1a1a2e;color:#eee;border-radius:8px;padding:14px;width:560px;max-height:92vh;display:flex;flex-direction:column;font-family:monospace;font-size:12px;box-shadow:0 4px 20px rgba(0,0,0,.5);';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;';
        const title = document.createElement('strong'); title.style.fontSize = '14px'; title.textContent = 'Enter checked costs into jobs' + (SCRIPT_VERSION ? '  (v' + SCRIPT_VERSION + ')' : '');
        const x = document.createElement('button'); x.textContent = '–'; x.title = 'Collapse';
        x.style.cssText = 'background:none;border:none;color:#eee;font-size:20px;cursor:pointer;line-height:1;';
        x.addEventListener('click', () => { panel.style.display = 'none'; });
        header.appendChild(title); header.appendChild(x);

        const hint = document.createElement('div');
        hint.style.cssText = 'color:#9ab;font-size:11px;margin-bottom:6px;';
        hint.textContent = 'Paste the Cost Reconciler export INCLUDING the header row, after deleting rows you do not want. NO COSTS / NOT IN JOB → ADD a line; INCORRECT (with Line ID) → FIX the existing line (skipped if invoiced). Dry-run, review, then Confirm & write.';

        pasteArea = document.createElement('textarea');
        pasteArea.placeholder = 'Receipt\tMerchant\t…\tJob ID\t…\tCost description\tChargeable   (paste header + filtered rows here)';
        pasteArea.style.cssText = 'width:100%;height:90px;background:#0a0a1a;color:#eee;border:1px solid #555;border-radius:4px;font-family:monospace;font-size:11px;padding:6px;box-sizing:border-box;resize:vertical;';

        const controls = document.createElement('div');
        controls.style.cssText = 'margin:8px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap;';
        parseBtn = mkBtn('Parse & dry-run', '#0a8', dryRun);
        writeBtn = mkBtn('Confirm & write', '#a22', write); writeBtn.style.display = 'none';
        stopBtn = mkBtn('Stop', '#a22', () => { running = false; }); stopBtn.style.display = 'none';
        progressText = document.createElement('span'); progressText.style.color = '#0fa';
        progressText.textContent = 'Ready.';
        controls.appendChild(parseBtn); controls.appendChild(writeBtn); controls.appendChild(stopBtn); controls.appendChild(progressText);

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
