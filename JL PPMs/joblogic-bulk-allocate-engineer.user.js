// ==UserScript==
// @name         Joblogic - Bulk Allocate Engineer
// @namespace    http://tampermonkey.net/
// @version      2.4
// @description  Paste CSV of Job Number, Appointment Date, Engineer. Script navigates each job's Visits tab, fills in the Allocate Engineer panel, clicks Allocate, and reports on existing + new visits.
// @match        https://go.joblogic.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // Prevent double-injection (e.g. when Tampermonkey reloads the script
    // without a hard page refresh — two closures would fight over the run).
    if (window.__jlBulkAllocLoaded) {
        console.log('[BulkAlloc] already loaded — skipping second init');
        return;
    }
    window.__jlBulkAllocLoaded = true;

    // ===========================================================================
    // CONFIG
    // ===========================================================================
    const STATE_KEY = 'jl-bulkalloc-state-v2';
    const LOG_KEY   = 'jl-bulkalloc-log-v2';
    const DEFAULT_APPT_TIME = '09:00';
    const DEFAULT_DURATION_MINS = 60;
    const PANEL_WAIT_MS = 15000;
    const AFTER_ALLOCATE_WAIT_MS = 5000;

    const HEADER_WORDS_ID = ['job id', 'job no', 'job no.', 'jobid', 'job number', 'id', 'ref', 'reference', 'job ref', 'job reference'];
    const HEADER_WORDS_DATE = ['date', 'appointment', 'appointment date', 'appt', 'scheduled', 'visit date'];
    const HEADER_WORDS_ENG = ['engineer', 'allocation engineer', 'allocated engineer', 'assigned', 'assigned to', 'assignee', 'resource', 'user'];

    // ===========================================================================
    // HELPERS
    // ===========================================================================
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const qs  = (s, r = document) => r.querySelector(s);
    const qsa = (s, r = document) => [...r.querySelectorAll(s)];

    function waitFor(testFn, { timeout = 10000, interval = 150 } = {}) {
        return new Promise((resolve, reject) => {
            const start = Date.now();
            (function tick() {
                let v;
                try { v = testFn(); } catch { v = null; }
                if (v) return resolve(v);
                if (Date.now() - start > timeout) return reject(new Error('waitFor timeout'));
                setTimeout(tick, interval);
            })();
        });
    }

    function fire(el, type, init = {}) {
        const E = (type.startsWith('mouse') || type === 'click') ? MouseEvent
                : type.startsWith('key')                          ? KeyboardEvent
                : Event;
        el.dispatchEvent(new E(type, { bubbles: true, cancelable: true, view: window, ...init }));
    }

    function setNativeValue(el, value) {
        const proto = (el.tagName === 'TEXTAREA') ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(el, value);
        fire(el, 'input');
        fire(el, 'change');
    }

    // ---------------------------------------------------------------------------
    // CSV PARSING + DATE NORMALIZE
    // ---------------------------------------------------------------------------
    function splitCsvLine(line) {
        if (line.includes('\t')) return line.split('\t').map(s => s.trim());
        const out = [];
        let cur = '', inQ = false;
        for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (c === '"') {
                if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
                else inQ = !inQ;
            } else if (c === ',' && !inQ) {
                out.push(cur.trim()); cur = '';
            } else cur += c;
        }
        out.push(cur.trim());
        return out.map(s => s.replace(/^"|"$/g, ''));
    }

    function normalizeDate(raw) {
        if (!raw) return null;
        const s = String(raw).trim();
        if (!s) return null;
        const pad = (n) => String(n).padStart(2, '0');
        const fmt = (d, h, m) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(h)}:${pad(m)}`;
        const [defH, defM] = DEFAULT_APPT_TIME.split(':').map(Number);

        let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::\d{2})?)?$/);
        if (m) {
            const day = +m[1], mon = +m[2], yrRaw = +m[3];
            const yr = yrRaw < 100 ? 2000 + yrRaw : yrRaw;
            const hh = m[4] != null ? +m[4] : defH;
            const mm = m[5] != null ? +m[5] : defM;
            const d = new Date(yr, mon - 1, day, hh, mm);
            if (!isNaN(d)) return fmt(d, hh, mm);
        }
        m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::\d{2})?)?/);
        if (m) {
            const yr = +m[1], mon = +m[2], day = +m[3];
            const hh = m[4] != null ? +m[4] : defH;
            const mm = m[5] != null ? +m[5] : defM;
            const d = new Date(yr, mon - 1, day, hh, mm);
            if (!isNaN(d)) return fmt(d, hh, mm);
        }
        const d = new Date(s);
        if (!isNaN(d)) {
            const h = d.getHours(), mi = d.getMinutes();
            if (h === 0 && mi === 0 && !s.includes(':')) return fmt(d, defH, defM);
            return fmt(d, h, mi);
        }
        return null;
    }

    function addMinutesToJlDate(jlDate, minutes) {
        const m = jlDate.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/);
        if (!m) return jlDate;
        const d = new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]);
        d.setMinutes(d.getMinutes() + minutes);
        const pad = (n) => String(n).padStart(2, '0');
        return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    function detectColumns(first) {
        const lc = (cell) => (cell || '').toLowerCase().trim();
        const matches = (cell, words) => words.some(w => lc(cell) === w || lc(cell).includes(w));
        const looksHeader =
            first.length >= 3 &&
            matches(first[0], HEADER_WORDS_ID) &&
            matches(first[1], HEADER_WORDS_DATE) &&
            matches(first[2], HEADER_WORDS_ENG);
        return { idIdx: 0, dateIdx: 1, engIdx: 2, isHeader: looksHeader };
    }

    // Look at the first cell after the job ref. If it looks like a date,
    // treat the line as Job + Date [+ Engineer]; otherwise as Job + Engineer.
    function looksLikeDate(s) {
        return /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(s) || /^\d{4}-\d{1,2}-\d{1,2}/.test(s);
    }

    function parseCsv(text) {
        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (!lines.length) return [];
        const first = splitCsvLine(lines[0]);
        const looksHeader = first.length >= 2
            && /(job|ref|reference|number|id)/i.test(first[0])
            && (HEADER_WORDS_DATE.some(w => (first[1] || '').toLowerCase().includes(w))
             || HEADER_WORDS_ENG.some(w => (first[1] || '').toLowerCase().includes(w)));
        const dataLines = looksHeader ? lines.slice(1) : lines;
        const out = [];
        for (const line of dataLines) {
            const c = splitCsvLine(line);
            if (!c.length) continue;
            const ref = (c[0] || '').trim();
            if (!ref) continue;
            // Decide column shape per row:
            //   1 col:        ref
            //   2 col:        ref + (date | engineer)
            //   3+ col:       ref + date + engineer
            let rawDate = '', engineerRaw = '';
            if (c.length === 1) {
                // both come from defaults later
            } else if (c.length === 2) {
                if (looksLikeDate(c[1])) rawDate = c[1].trim();
                else                     engineerRaw = c[1].trim();
            } else {
                rawDate = (c[1] || '').trim();
                engineerRaw = (c[2] || '').trim();
            }
            out.push({ ref, dateStr: rawDate ? normalizeDate(rawDate) : null, rawDate, engineerRaw });
        }
        return out;
    }

    // Apply panel defaults to fill any blank engineer/date on a row.
    function applyDefaultsToRows(rows) {
        const d = getDefaults();
        return rows.map(r => ({
            ...r,
            engineerRaw: r.engineerRaw || d.engineer || '',
            dateStr:     r.dateStr     || d.dateStr  || null,
            rawDate:     r.rawDate     || d.dateRaw  || ''
        }));
    }

    // Scrape the current page for /Job/Detail/<id> links — used when the user
    // is on a filtered Jobs list / search results / contract jobs view, etc.
    function captureFromPage() {
        const seen = new Map(); // internalId -> { ref, internalId }
        document.querySelectorAll('a[href*="/Job/Detail/"]').forEach(a => {
            const m = a.getAttribute('href').match(/\/Job\/Detail\/(\d+)/);
            if (!m) return;
            const internalId = m[1];
            const ref = (a.textContent || '').trim();
            if (!ref) return;
            if (!seen.has(internalId)) seen.set(internalId, { ref, internalId });
        });
        const captured = [...seen.values()];
        if (!captured.length) {
            log('Capture: no /Job/Detail/ links found on this page. Open a filtered Jobs list (or any page that lists job links) and click again.', '#fa0');
            return;
        }
        const d = getDefaults();
        const rows = captured.map(({ ref, internalId }) => ({
            ref,
            internalId,
            rawDate: d.dateRaw || '',
            dateStr: d.dateStr || null,
            engineerRaw: d.engineer || '',
            error: null,
            status: 'pending'
        }));
        const blocking = [];
        if (!d.engineer) blocking.push('engineer');
        if (!d.dateStr)  blocking.push('appointment date');
        const st = {
            running: false,
            dryRun: true,
            rows,
            currentIndex: 0,
            phase: 'idle'
        };
        saveState(st);
        clearLog();
        clearLogLines();
        if (logArea) logArea.innerHTML = '';
        renderFromState();
        log(`Captured ${rows.length} job(s) from this page.`, '#0af');
        rows.slice(0, 10).forEach(r => log(`  · ${r.ref} (id=${r.internalId})`, '#888'));
        if (rows.length > 10) log(`  ...and ${rows.length - 10} more`, '#888');
        if (blocking.length) {
            log(`Set Default ${blocking.join(' and ')} above before clicking Run Allocate.`, '#fa0');
        } else {
            log(`Default engineer: "${d.engineer}", default date: "${d.dateStr}". Click Run Report or Run Allocate.`, '#0af');
        }
        setRunButtonsEnabled(true);
    }

    // ---------------------------------------------------------------------------
    // NAME MATCHING (fuzzy)
    // ---------------------------------------------------------------------------
    function normName(s) {
        return (s || '').toLowerCase()
            .replace(/[._\-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/[^a-z0-9, ]/g, '')
            .trim();
    }
    function canonName(s) {
        return normName(s).replace(/,/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
    }
    function levenshtein(a, b) {
        if (a === b) return 0;
        if (!a.length) return b.length;
        if (!b.length) return a.length;
        const m = [];
        for (let i = 0; i <= b.length; i++) m[i] = [i];
        for (let j = 0; j <= a.length; j++) m[0][j] = j;
        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                m[i][j] = b[i - 1] === a[j - 1]
                    ? m[i - 1][j - 1]
                    : Math.min(m[i - 1][j - 1] + 1, m[i][j - 1] + 1, m[i - 1][j] + 1);
            }
        }
        return m[b.length][a.length];
    }
    function scoreCandidate(qNorm, qCanon, candLabel) {
        const cNorm = normName(candLabel);
        const cCanon = canonName(candLabel);
        if (cNorm === qNorm) return 1.0;
        if (cCanon === qCanon) return 0.98;
        const qT = new Set(qNorm.split(/\s+/).filter(t => t.length > 1));
        const cT = new Set(cNorm.split(/[ ,]+/).filter(t => t.length > 1));
        let shared = 0; for (const t of qT) if (cT.has(t)) shared++;
        const tokenScore = qT.size ? shared / qT.size : 0;
        const contains = cNorm.includes(qNorm) || qNorm.includes(cNorm);
        const maxLen = Math.max(cCanon.length, qCanon.length) || 1;
        const levScore = 1 - (levenshtein(cCanon, qCanon) / maxLen);
        if (tokenScore === 0 && !contains) return 0;
        return 0.4 * tokenScore + 0.3 * (contains ? 1 : 0) + 0.3 * levScore;
    }

    function fuzzyPickEngineer(name, options, getLabel) {
        const qNorm = normName(name);
        const qCanon = canonName(name);
        let best = null, bestScore = 0, second = 0, bestLabel = '';
        for (const opt of options) {
            let label = ''; try { label = String(getLabel(opt) || ''); } catch {}
            if (!label) continue;
            const s = scoreCandidate(qNorm, qCanon, label);
            if (s > bestScore) { second = bestScore; bestScore = s; best = opt; bestLabel = label; }
            else if (s > second) { second = s; }
        }
        if (!best || bestScore < 0.45) return null;
        return { option: best, label: bestLabel, score: bestScore, runnerUp: second };
    }

    // ---------------------------------------------------------------------------
    // JOB SEARCH API (pulled from DateComplete script pattern)
    // ---------------------------------------------------------------------------
    function getCsrf() {
        const el = qs('input[name="__RequestVerificationToken"]');
        return el ? el.value : '';
    }

    async function searchJob(jobRef) {
        const resp = await fetch('/api/Job/SearchJsonData', {
            method: 'POST', credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                '__RequestVerificationToken': getCsrf()
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

    // ===========================================================================
    // LIVE PAGE INTERACTION — Allocate Engineer panel
    // ===========================================================================

    // Find the Engineer dropdown inside #visitsTab. It's the only non-disabled
    // jl-select in that container that has a populated options array.
    function findEngineerDropdown() {
        const visTab = document.getElementById('visitsTab');
        if (!visTab) return null;
        const sels = qsa('.jl-select.jl--single.jl--searchable', visTab);
        for (const s of sels) {
            if (!s.__vue__ || !Array.isArray(s.__vue__.options)) continue;
            if (s.classList.contains('jl--disabled')) continue;
            if (s.__vue__.options.length === 0) continue;
            return s;
        }
        // Fallback: any non-disabled searchable jl-select in #visitsTab.
        for (const s of sels) {
            if (!s.__vue__) continue;
            if (s.classList.contains('jl--disabled')) continue;
            return s;
        }
        return null;
    }

    function getEngineerOptions() {
        const el = findEngineerDropdown();
        if (!el || !el.__vue__) return { options: [], getLabel: null, vue: null, el: null };
        const vue = el.__vue__;
        const labelProp = vue.$props.label || 'Name';
        // Prefer reading the label field directly. The component's default
        // getOptionLabel from jl-components reads `option.label`, but
        // Joblogic's engineer data uses `option.Name` — calling the default
        // throws and every candidate ends up empty.
        const getLabel = (o) => {
            if (o == null) return '';
            const fromField = o[labelProp];
            if (typeof fromField === 'string' && fromField) return fromField;
            try {
                if (typeof vue.$props.getOptionLabel === 'function') {
                    return String(vue.$props.getOptionLabel(o) || '');
                }
            } catch { /* fall through */ }
            return '';
        };
        return { options: vue.options || [], getLabel, vue, el };
    }

    function selectEngineer(engineerName) {
        const { options, getLabel, vue } = getEngineerOptions();
        if (!vue) throw new Error('Engineer dropdown not found on page');
        if (!options.length) throw new Error('Engineer dropdown has 0 options (not yet loaded?)');
        const match = fuzzyPickEngineer(engineerName, options, getLabel);
        if (!match) throw new Error(`Engineer "${engineerName}" not found in roster (${options.length} options)`);
        try {
            vue.select(match.option);
        } catch (e) {
            throw new Error('vue.select failed: ' + e.message);
        }
        return match;
    }

    function ensureEngineerRadioSelected() {
        const r = document.getElementById('Engineer');
        if (!r) return false;
        if (r.checked) return true;
        const lbl = r.closest('label') || qs(`label[for="${r.id}"]`);
        if (lbl) { fire(lbl, 'mousedown'); fire(lbl, 'mouseup'); lbl.click(); }
        if (!r.checked) r.checked = true;
        fire(r, 'input'); fire(r, 'change'); fire(r, 'click');
        return r.checked;
    }

    function ensureAppointmentChecked() {
        const cb = document.getElementById('Appointment');
        if (!cb) return false;
        if (cb.checked) return true;
        const lbl = cb.closest('label') || qs(`label[for="${cb.id}"]`);
        if (lbl) lbl.click(); else cb.click();
        fire(cb, 'input'); fire(cb, 'change');
        return cb.checked;
    }

    function setSendEmailSMS(shouldBeChecked) {
        const cb = document.getElementById('SendEmailSMS');
        if (!cb) return null;
        if (cb.checked === shouldBeChecked) return cb.checked;
        const lbl = cb.closest('label') || qs(`label[for="${cb.id}"]`);
        if (lbl) lbl.click(); else cb.click();
        fire(cb, 'input'); fire(cb, 'change');
        return cb.checked;
    }

    function setDateField(id, dateStr) {
        const el = document.getElementById(id);
        if (!el) throw new Error(`#${id} input not found`);
        setNativeValue(el, dateStr);
        // Fire blur so Kendo/Vue picker commits
        fire(el, 'blur');
    }

    function findAllocateButton() {
        const tab = document.getElementById('visitsTab') || document;
        return qsa('button', tab).find(b => (b.textContent || '').trim() === 'Allocate');
    }

    // Locate the visit row in the existing-visits table that matches a parsed
    // visit (by engineer + start date). Used to drive ReDeploy on a specific
    // row.
    function findVisitRowForVisit(visit) {
        const rows = qsa('.tr-group .tr.table-row');
        return rows.find(r => {
            if (/^Engineer\/Team/.test((r.textContent || '').trim())) return false;
            const t = (r.textContent || '').replace(/\s+/g, ' ');
            return t.includes(visit.engineer) && t.includes(visit.start);
        }) || null;
    }

    // Open the row's actions menu (the dots-vertical button) and click
    // "Cancel" inside it, then confirm the modal that appears.
    async function clickCancelForVisit(visit) {
        const row = findVisitRowForVisit(visit);
        if (!row) throw new Error(`Could not find visit row for ${visit.engineer} @ ${visit.start}`);
        const trigger = row.querySelector('.table-actions__trigger');
        if (!trigger) throw new Error('No actions trigger on visit row');
        ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach(t =>
            trigger.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }))
        );

        // Click the row's "Cancel" action button (visible after opening menu).
        const cancelActionBtn = await waitFor(() => {
            const btn = qsa('button', row).find(b =>
                /^cancel$/i.test((b.textContent || '').trim()) && b.offsetParent !== null
            );
            return btn || null;
        }, { timeout: 2500, interval: 120 }).catch(() => null);
        if (!cancelActionBtn) throw new Error('Cancel action did not appear in row menu');
        cancelActionBtn.click();

        // A Bootstrap modal appears with text "Are you sure want to cancel?".
        // The modal container class varies (.modal vs .modal-dialog vs other),
        // so locate it by walking up from any visible Confirm button until we
        // find an ancestor that contains the confirmation text.
        const confirmBtn = await waitFor(() => {
            const candidates = qsa('button').filter(b =>
                b.offsetParent !== null &&
                /^confirm$/i.test((b.textContent || '').trim())
            );
            for (const b of candidates) {
                let cur = b;
                for (let i = 0; i < 10 && cur; i++) {
                    cur = cur.parentElement;
                    if (!cur) break;
                    const t = (cur.textContent || '').toLowerCase();
                    if (/are you sure.*cancel/.test(t)) return b;
                }
            }
            return null;
        }, { timeout: 3500, interval: 150 }).catch(() => null);
        if (!confirmBtn) throw new Error('Cancel-confirmation modal did not appear');
        confirmBtn.click();

        // Wait for the modal text to disappear from the visible DOM.
        await waitFor(() => {
            const stillThere = qsa('.modal-body, .modal-content, .modal-dialog')
                .some(m => m.offsetParent !== null && /are you sure.*cancel/i.test(m.textContent || ''));
            return !stillThere;
        }, { timeout: 3000, interval: 150 }).catch(() => {});
        await sleep(500);
    }

    function allocatePanelState() {
        const radio = document.getElementById('Engineer');
        const startDate = document.getElementById('startDate');
        const endDate = document.getElementById('endDate');
        const allocBtn = findAllocateButton();
        const dd = findEngineerDropdown();
        const ddOpts = dd && dd.__vue__ && Array.isArray(dd.__vue__.options) ? dd.__vue__.options.length : -1;
        return { radio: !!radio, startDate: !!startDate, endDate: !!endDate, allocBtn: !!allocBtn, dd: !!dd, ddOpts };
    }

    async function waitForAllocatePanel() {
        try {
            return await waitFor(() => {
                const s = allocatePanelState();
                return s.radio && s.startDate && s.endDate && s.allocBtn && s.dd && s.ddOpts > 0;
            }, { timeout: PANEL_WAIT_MS, interval: 250 });
        } catch (e) {
            const s = allocatePanelState();
            throw new Error(`Allocate panel not ready: radio=${s.radio} startDate=${s.startDate} endDate=${s.endDate} allocBtn=${s.allocBtn} dropdown=${s.dd} options=${s.ddOpts}`);
        }
    }

    // Classify a visit's status icon filename (e.g. on_site_ic.svg) into a
    // coarse category used for the report's counts.
    function classifyVisitStatus(iconFile) {
        const s = (iconFile || '').toLowerCase();
        if (!s)                 return 'unknown';
        if (/reject/.test(s))   return 'rejected';
        if (/complet/.test(s))  return 'complete';
        if (/cancel/.test(s))   return 'cancelled';
        // Everything else — pending / allocated / accepted / on-way / on-site /
        // off-site / redeployed — counts as "incomplete" for our purposes.
        return 'incomplete';
    }

    // Make an icon filename human-readable ("on_site_ic" → "On Site").
    function humanizeIcon(iconFile) {
        if (!iconFile) return '';
        return iconFile.replace(/\.svg$/i, '')
                       .replace(/_?ic$/i, '')
                       .replace(/_+/g, ' ')
                       .trim()
                       .replace(/\b\w/g, c => c.toUpperCase());
    }

    // Read the existing visits table for the current job. One object per data
    // row: { engineer, start, end, iconFile, statusLabel, statusClass }.
    function readExistingVisitsSync() {
        const hdr = qsa('div, span, li, td, th').find(el =>
            el.children.length === 0 && (el.textContent || '').trim() === 'Engineer/Team'
        );
        if (!hdr) return null; // header not rendered yet
        let container = hdr;
        for (let i = 0; i < 15 && container; i++) {
            container = container.parentElement;
            if (!container) break;
            if (String(container.className || '').includes('jl-table-div')) break;
        }
        if (!container) return [];
        const rows = qsa('.tr-group .tr.table-row', container);
        return rows
            .filter(r => !/^Engineer\/Team/.test((r.textContent || '').trim()))
            .map(parseVisitRow)
            // Skip "ghost" rows (sub-row placeholders with no engineer + no dates)
            .filter(v => v.engineer || v.start);
    }

    // Async read: polls until the visits list actually renders. Rows in the
    // Joblogic Vue component appear after a short async fetch, so returning
    // `[]` too early misses them. We wait up to maxWaitMs; once any rows are
    // visible we confirm stability with one extra poll and return.
    async function readExistingVisits({ maxWaitMs = 5000, interval = 250 } = {}) {
        const start = Date.now();
        let best = [];
        while (Date.now() - start < maxWaitMs) {
            const res = readExistingVisitsSync();
            if (res === null) {
                // header not rendered yet — keep waiting
            } else if (res.length > 0) {
                await sleep(interval);
                const again = readExistingVisitsSync();
                if (again && again.length === res.length) return res;
                best = res;
                continue;
            } else {
                // header present but zero rows — might be really empty, or
                // still loading. Keep `best` as [] but do not return yet.
                best = res;
            }
            await sleep(interval);
        }
        return best;
    }

    function parseVisitRow(rowEl) {
        const engineer = rowEl.querySelector('a')?.textContent?.trim()
                      || rowEl.querySelector('.preview')?.textContent?.trim()
                      || '';
        const dateTds = qsa('.td', rowEl)
            .filter(td => /^\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}$/.test((td.textContent || '').trim()));
        const start = dateTds[0]?.textContent?.trim() || '';
        const end   = dateTds[1]?.textContent?.trim() || '';
        const img = rowEl.querySelector('.visit-status-icon img');
        const iconFile = (img?.src || '').split('/').pop() || '';
        const statusClass = classifyVisitStatus(iconFile);
        const statusLabel = humanizeIcon(iconFile) || '(none)';
        return { engineer, start, end, iconFile, statusLabel, statusClass };
    }

    // Wait for a new visit row to appear (success signal).
    async function waitForNewVisit(previousCount, timeoutMs = AFTER_ALLOCATE_WAIT_MS) {
        try {
            await waitFor(() => {
                const r = readExistingVisitsSync();
                return r && r.length > previousCount;
            }, { timeout: timeoutMs, interval: 300 });
            return true;
        } catch { return false; }
    }

    // Wait for ANY change to the visit list — either count change OR an
    // engineer/status change at an existing date. Used after ReDeploy where
    // the count may stay the same but the engineer should change.
    async function waitForVisitListChange(prevCount, prevSig, timeoutMs = AFTER_ALLOCATE_WAIT_MS) {
        try {
            await waitFor(() => {
                const r = readExistingVisitsSync();
                if (!r) return false;
                if (r.length !== prevCount) return true;
                const sig = r.map(v => `${v.start}|${v.engineer}|${v.statusLabel}`).join(';');
                return sig !== prevSig;
            }, { timeout: timeoutMs, interval: 300 });
            return true;
        } catch { return false; }
    }

    // ===========================================================================
    // STATE PERSISTENCE
    // ===========================================================================
    function loadState() {
        try {
            const raw = localStorage.getItem(STATE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch { return null; }
    }
    function saveState(s) {
        try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch {}
    }
    function clearState() {
        try { localStorage.removeItem(STATE_KEY); } catch {}
    }

    function loadLog() {
        try {
            const raw = localStorage.getItem(LOG_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch { return []; }
    }
    function appendLog(entry) {
        const arr = loadLog();
        arr.push({ ts: new Date().toISOString(), ...entry });
        try { localStorage.setItem(LOG_KEY, JSON.stringify(arr.slice(-2000))); } catch {}
    }
    function clearLog() {
        try { localStorage.removeItem(LOG_KEY); } catch {}
    }

    // ===========================================================================
    // UI PANEL
    // ===========================================================================
    let panelEl, logArea, progressText;

    function createUI() {
        if (document.getElementById('jl-bulkalloc-panel')) return;

        panelEl = document.createElement('div');
        panelEl.id = 'jl-bulkalloc-panel';
        panelEl.innerHTML = `
<style>
  #jl-bulkalloc-panel{position:fixed;top:10px;right:10px;z-index:99999;background:#1a1a2e;color:#eee;
    border-radius:8px;width:640px;max-height:88vh;display:flex;flex-direction:column;
    font-family:monospace;font-size:12px;box-shadow:0 4px 20px rgba(0,0,0,.5);}
  #jl-bulkalloc-panel header{display:flex;justify-content:space-between;align-items:center;
    padding:10px 14px;border-bottom:1px solid #333;cursor:move;user-select:none;}
  #jl-bulkalloc-panel header b{font-size:14px}
  #jl-bulkalloc-panel header .close{background:none;border:none;color:#eee;font-size:16px;cursor:pointer}
  #jl-bulkalloc-panel .body{padding:10px 14px;display:flex;flex-direction:column;gap:8px;
    overflow-y:auto;}
  #jl-bulkalloc-panel .progress{color:#0fa;font-weight:600}
  #jl-bulkalloc-panel .controls{display:flex;gap:6px;flex-wrap:wrap}
  #jl-bulkalloc-panel button{background:#2563eb;color:#fff;border:0;border-radius:4px;padding:7px 12px;
    cursor:pointer;font-family:inherit;font-size:12px;}
  #jl-bulkalloc-panel button.paste{background:#08a}
  #jl-bulkalloc-panel button.run-report{background:#ca8a04}
  #jl-bulkalloc-panel button.run-allocate{background:#0a8}
  #jl-bulkalloc-panel button.stop{background:#a22}
  #jl-bulkalloc-panel button.report{background:#648}
  #jl-bulkalloc-panel button.clear{background:#555}
  #jl-bulkalloc-panel button.capture{background:#9333ea}
  #jl-bulkalloc-panel button[disabled]{opacity:.45;cursor:not-allowed}
  #jl-bulkalloc-panel .defaults{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;
    background:#13132a;padding:8px 10px;border-radius:4px;}
  #jl-bulkalloc-panel .defaults label{display:inline-flex;flex-direction:column;gap:3px;font-size:11px;
    color:#9ca3af;}
  #jl-bulkalloc-panel .defaults input{background:#0a0a1a;color:#eee;border:1px solid #333;
    border-radius:3px;padding:4px 6px;font:inherit;width:200px;}
  #jl-bulkalloc-panel .defaults .default-hint{color:#6b7280;font-size:10.5px;flex:1;min-width:160px;}
  #jl-bulkalloc-panel .log{background:#0a0a1a;padding:8px;border-radius:4px;flex:1;overflow-y:auto;
    max-height:42vh;white-space:pre-wrap;word-break:break-word;}
  #jl-bulkalloc-panel .log div{padding:1px 0;line-height:1.35;}
</style>
<header>
  <b>Bulk Allocate Engineer <span style="font-weight:400;color:#9ca3af;font-size:11px;">v2.4</span></b>
  <div>
    <button class="close" title="Close panel">×</button>
  </div>
</header>
<div class="body">
  <div class="progress">Paste CSV, or capture jobs from the current filtered list.</div>
  <div class="defaults">
    <label>Default engineer
      <input class="default-engineer" type="text" placeholder="e.g. Joe Segal" autocomplete="off">
    </label>
    <label>Default appointment
      <input class="default-date" type="text" placeholder="DD/MM/YYYY HH:mm" autocomplete="off">
    </label>
    <span class="default-hint">Used when CSV row omits engineer/date, or with "Capture".</span>
  </div>
  <div class="controls">
    <button class="paste">Paste CSV</button>
    <button class="capture" title="Scrape Job/Detail links from the current page (filtered Jobs list, search results, etc.)">Capture from page</button>
    <button class="run-report" disabled title="Navigate each job read-only — collect existing visit info, then show the report">Run Report</button>
    <button class="run-allocate" disabled title="Navigate each job and actually allocate — commits changes">Run Allocate</button>
    <button class="stop" style="display:none">Stop</button>
    <button class="report" title="View the report modal for the current/last run">View Report</button>
    <button class="clear">Reset</button>
  </div>
  <div class="log"></div>
</div>`;
        document.body.appendChild(panelEl);

        logArea = panelEl.querySelector('.log');
        progressText = panelEl.querySelector('.progress');

        // Drag
        const hdr = panelEl.querySelector('header');
        let drag = null;
        hdr.addEventListener('mousedown', (e) => {
            if (e.target.closest('button')) return;
            drag = { x: e.clientX - panelEl.offsetLeft, y: e.clientY - panelEl.offsetTop };
        });
        window.addEventListener('mouseup', () => drag = null);
        window.addEventListener('mousemove', (e) => {
            if (!drag) return;
            panelEl.style.left = (e.clientX - drag.x) + 'px';
            panelEl.style.top  = (e.clientY - drag.y) + 'px';
            panelEl.style.right = 'auto';
        });

        panelEl.querySelector('.close').addEventListener('click', () => panelEl.remove());
        panelEl.querySelector('.paste').addEventListener('click', openPasteDialog);
        panelEl.querySelector('.capture').addEventListener('click', captureFromPage);
        panelEl.querySelector('.run-report').addEventListener('click', () => onStartClick(true));
        panelEl.querySelector('.run-allocate').addEventListener('click', () => onStartClick(false));
        panelEl.querySelector('.stop').addEventListener('click', onStopClick);
        panelEl.querySelector('.report').addEventListener('click', showReport);
        panelEl.querySelector('.clear').addEventListener('click', onResetClick);

        // Persist default engineer / date inputs across page navigations.
        const defEng = panelEl.querySelector('.default-engineer');
        const defDate = panelEl.querySelector('.default-date');
        try {
            defEng.value  = localStorage.getItem(DEFAULTS_KEY + ':engineer') || '';
            defDate.value = localStorage.getItem(DEFAULTS_KEY + ':date')     || '';
        } catch {}
        defEng.addEventListener('input',  () => { try { localStorage.setItem(DEFAULTS_KEY + ':engineer', defEng.value); } catch {} });
        defDate.addEventListener('input', () => { try { localStorage.setItem(DEFAULTS_KEY + ':date',    defDate.value); } catch {} });
    }

    const DEFAULTS_KEY = 'jl-bulkalloc-defaults-v1';

    function getDefaults() {
        const d = {
            engineer: panelEl?.querySelector('.default-engineer')?.value?.trim() || '',
            date: panelEl?.querySelector('.default-date')?.value?.trim() || ''
        };
        return { engineer: d.engineer, dateStr: d.date ? normalizeDate(d.date) : null, dateRaw: d.date };
    }

    const LOG_LINES_KEY = 'jl-bulkalloc-loglines-v2';
    const LOG_MAX_LINES = 600;

    function appendLogLine(msg, color) {
        try {
            const raw = localStorage.getItem(LOG_LINES_KEY);
            const arr = raw ? JSON.parse(raw) : [];
            arr.push({ msg, color });
            while (arr.length > LOG_MAX_LINES) arr.shift();
            localStorage.setItem(LOG_LINES_KEY, JSON.stringify(arr));
        } catch { /* quota / disabled */ }
    }
    function clearLogLines() {
        try { localStorage.removeItem(LOG_LINES_KEY); } catch {}
    }
    function replayLogLines() {
        if (!logArea) return;
        let arr = [];
        try {
            const raw = localStorage.getItem(LOG_LINES_KEY);
            arr = raw ? JSON.parse(raw) : [];
        } catch { arr = []; }
        const frag = document.createDocumentFragment();
        for (const { msg, color } of arr) {
            const line = document.createElement('div');
            line.style.color = color || '#ccc';
            line.textContent = msg;
            frag.appendChild(line);
        }
        logArea.appendChild(frag);
        logArea.scrollTop = logArea.scrollHeight;
    }

    function log(msg, color) {
        appendLogLine(msg, color);
        if (!logArea) return;
        const line = document.createElement('div');
        line.style.color = color || '#ccc';
        line.textContent = msg;
        logArea.appendChild(line);
        logArea.scrollTop = logArea.scrollHeight;
    }
    function setProgress(s) { if (progressText) progressText.textContent = s; }
    function setRunButtonsEnabled(b) {
        const rr = panelEl?.querySelector('.run-report');
        const ra = panelEl?.querySelector('.run-allocate');
        if (rr) rr.disabled = !b;
        if (ra) ra.disabled = !b;
    }
    function setRunningUI(running) {
        const rr   = panelEl?.querySelector('.run-report');
        const ra   = panelEl?.querySelector('.run-allocate');
        const stop = panelEl?.querySelector('.stop');
        [rr, ra].forEach(b => { if (b) b.style.display = running ? 'none' : ''; });
        if (stop) stop.style.display = running ? '' : 'none';
    }

    // ---------------------------------------------------------------------------
    // Paste dialog
    // ---------------------------------------------------------------------------
    function openPasteDialog() {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:100000;' +
            'display:flex;align-items:center;justify-content:center;';
        overlay.innerHTML = `
<div style="background:#fff;color:#111;border-radius:8px;width:640px;max-width:92vw;
     box-shadow:0 10px 40px rgba(0,0,0,.4);overflow:hidden;font-family:system-ui,sans-serif;">
  <div style="padding:12px 16px;background:#111827;color:#f9fafb;font-weight:600;">
    Paste Jobs (Job Number, Appointment Date, Engineer)
  </div>
  <div style="padding:14px 16px;">
    <textarea id="jl-paste-ta" style="width:100%;height:240px;font:13px monospace;padding:8px;
      border:1px solid #d1d5db;border-radius:4px;box-sizing:border-box;"
      placeholder="Three columns: Job Number, Appointment Date, Engineer

Example:
PM0001702/001, 28/04/2026 09:00, Joe Segal
J12346, 29/04/2026, Jane Doe"></textarea>
    <div style="color:#6b7280;font-size:12px;margin-top:6px;">
      Comma or tab separated. Header optional. Dates accept dd/MM/yyyy or yyyy-MM-dd
      (with or without time). Missing time defaults to ${DEFAULT_APPT_TIME}.
      End date defaults to Start + ${DEFAULT_DURATION_MINS} min.
    </div>
    <div id="jl-paste-count" style="color:#2563eb;font-size:12px;margin-top:6px;font-weight:600;">
      0 rows detected
    </div>
    <div id="jl-paste-preview" style="color:#374151;font-size:11px;margin-top:6px;
      max-height:120px;overflow-y:auto;font-family:monospace;"></div>
    <div style="text-align:right;margin-top:10px;">
      <button id="jl-paste-cancel" style="background:#9ca3af;color:#fff;border:0;border-radius:4px;
        padding:7px 14px;cursor:pointer;margin-right:6px;">Cancel</button>
      <button id="jl-paste-ok" style="background:#2563eb;color:#fff;border:0;border-radius:4px;
        padding:7px 14px;cursor:pointer;">Load</button>
    </div>
  </div>
</div>`;
        document.body.appendChild(overlay);
        const ta = overlay.querySelector('#jl-paste-ta');
        const count = overlay.querySelector('#jl-paste-count');
        const preview = overlay.querySelector('#jl-paste-preview');

        const refresh = () => {
            const parsed = applyDefaultsToRows(parseCsv(ta.value));
            const bad = parsed.filter(r => !r.dateStr || !r.engineerRaw);
            const d = getDefaults();
            const fillNote = (!d.engineer && !d.dateStr) ? ''
                : ' (filling missing fields from defaults: '
                  + [d.engineer && `engineer "${d.engineer}"`, d.dateStr && `date "${d.dateStr}"`].filter(Boolean).join(', ')
                  + ')';
            count.textContent = `${parsed.length} row${parsed.length === 1 ? '' : 's'} detected`
                + (bad.length ? ` — ${bad.length} incomplete` : '')
                + fillNote;
            count.style.color = bad.length ? '#dc2626' : '#2563eb';
            preview.innerHTML = parsed.slice(0, 8).map(r => {
                const ok = r.dateStr && r.engineerRaw;
                return `<div style="color:${ok ? '#374151' : '#dc2626'};">${r.ref} | ${r.dateStr || '[no date]'} | ${r.engineerRaw || '[no engineer]'}</div>`;
            }).join('') + (parsed.length > 8 ? `<div style="color:#9ca3af;">...and ${parsed.length - 8} more</div>` : '');
        };
        ta.addEventListener('input', refresh);
        overlay.querySelector('#jl-paste-cancel').onclick = () => overlay.remove();
        overlay.querySelector('#jl-paste-ok').onclick = () => {
            const parsed = applyDefaultsToRows(parseCsv(ta.value));
            // Keep all rows that have a job ref — defaults fill the rest.
            // We only require date + engineer at run-time; loading is permissive.
            const rows = parsed.filter(r => r.ref);
            overlay.remove();
            if (!rows.length) { setProgress('No rows found.'); return; }
            const st = {
                running: false,
                dryRun: true,
                rows: rows.map(r => ({ ...r, internalId: null, error: null, status: 'pending' })),
                currentIndex: 0,
                phase: 'idle'
            };
            saveState(st);
            clearLog();
            clearLogLines();
            if (logArea) logArea.innerHTML = '';
            renderFromState();
            const incomplete = rows.filter(r => !r.dateStr || !r.engineerRaw).length;
            log(`Loaded ${rows.length} row(s).`, '#0af');
            if (incomplete) {
                log(`${incomplete} row(s) still missing date or engineer — fill the Default fields above before Run Allocate.`, '#fa0');
            } else {
                log(`Click "Run Report" to survey, then "Run Allocate" to commit.`, '#0af');
            }
            setRunButtonsEnabled(true);
        };
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        setTimeout(() => ta.focus(), 50);
    }

    // ===========================================================================
    // WORKFLOW
    // ===========================================================================
    function onStopClick() {
        const st = loadState();
        if (!st) return;
        st.running = false;
        st.phase = 'stopped';
        saveState(st);
        setRunningUI(false);
        setRunButtonsEnabled(true);
        setProgress('Stopped. Click Run Report / Run Allocate to resume, or Reset to clear.');
    }

    function onResetClick() {
        if (!confirm('Reset will clear the current run and all logged results. Continue?')) return;
        clearState();
        clearLog();
        clearLogLines();
        if (logArea) logArea.innerHTML = '';
        setProgress('Cleared. Paste CSV to begin.');
        setRunButtonsEnabled(false);
        setRunningUI(false);
    }

    async function onStartClick(reportOnly) {
        const st = loadState();
        if (!st || !st.rows?.length) { setProgress('Nothing loaded — paste CSV or Capture from page first.'); return; }

        // Fill any blank engineer/date from the panel defaults at run-time.
        const filled = applyDefaultsToRows(st.rows);
        // Carry over already-resolved fields (internalId, status etc.) which
        // applyDefaultsToRows doesn't touch beyond engineer/date.
        st.rows = filled.map((r, i) => ({ ...st.rows[i], engineerRaw: r.engineerRaw, dateStr: r.dateStr, rawDate: r.rawDate }));

        // Validate: every row must have an engineer. Date is optional — when
        // missing, the row is processed as a ReDeploy of an existing
        // incomplete visit (using that visit's date).
        const missing = st.rows
            .map((r, i) => ({ i, r, lacks: !r.engineerRaw ? ['engineer'] : [] }))
            .filter(x => x.lacks.length);
        if (missing.length) {
            log(`Cannot start — ${missing.length} row(s) missing an engineer. Fill Default Engineer above, or edit the CSV.`, '#f55');
            missing.slice(0, 5).forEach(m => log(`  · ${m.r.ref}`, '#f55'));
            saveState(st);
            return;
        }
        const noDateCount = st.rows.filter(r => !r.dateStr).length;
        if (noDateCount && !reportOnly) {
            const ok = confirm(`${noDateCount} row(s) have no appointment date.\n\nFor those rows, the script will take the date from the first incomplete existing visit BEFORE cancelling it.\n\nFor every row, any incomplete existing visits will be CANCELLED, then a new visit allocated. Continue?`);
            if (!ok) {
                st.running = false;
                saveState(st);
                setRunningUI(false);
                return;
            }
        } else if (!reportOnly) {
            // Even when all rows have dates, warn the user that incomplete
            // existing visits will be cancelled.
            const ok = confirm(`Run Allocate will:\n  • Cancel any incomplete existing visits on each job\n  • Then allocate a new visit to the chosen engineer\n\nProceed for ${st.rows.length} job(s)?`);
            if (!ok) {
                st.running = false;
                saveState(st);
                setRunningUI(false);
                return;
            }
        }

        st.running = true;
        st.dryRun = !!reportOnly;
        // Keep existing progress if resuming; otherwise reset
        if (st.phase === 'done' || st.phase === 'idle' || st.phase === 'stopped') {
            if (st.phase === 'done' || st.phase === 'idle') {
                st.currentIndex = 0;
                st.rows.forEach(r => { r.status = 'pending'; r.error = null; });
            }
            st.phase = 'searching';
        }
        saveState(st);
        setRunningUI(true);
        await runDispatcher();
    }

    // Top-level controller — called on Start and on every page boot.
    // Single-flight guarded so a stray re-entry can't run handleCurrentJob
    // concurrently with itself.
    let __dispatcherBusy = false;
    async function runDispatcher() {
        if (__dispatcherBusy) return;
        __dispatcherBusy = true;
        try {
            let st = loadState();
            if (!st || !st.running) return;

            if (st.phase === 'searching') {
                await doSearchPhase(st);
                st = loadState();
                if (!st || !st.running) return;
            }

            if (st.phase === 'navigating' || st.phase === 'allocating') {
                const row = st.rows[st.currentIndex];
                if (!row) { finishRun('End of list.'); return; }
                const expectedPath = `/Job/Detail/${row.internalId}`;
                if (!location.pathname.startsWith(expectedPath)) {
                    // Navigate to the correct page; next page's boot resumes.
                    location.href = `/Job/Detail/${row.internalId}?pageIndex=1#visitsTab`;
                    return;
                }
                await handleCurrentJob(st);
            }
        } catch (e) {
            log('Dispatcher error: ' + e.message, '#f55');
            const s3 = loadState(); if (s3) { s3.running = false; saveState(s3); }
            setRunningUI(false);
        } finally {
            __dispatcherBusy = false;
        }
    }

    async function doSearchPhase(st) {
        log(`--- Resolving ${st.rows.length} job numbers to internal IDs ---`, '#0af');
        for (let i = 0; i < st.rows.length; i++) {
            if (!st.running) return;
            const r = st.rows[i];
            if (r.internalId) continue;
            setProgress(`Searching ${i + 1}/${st.rows.length}: ${r.ref}`);
            try {
                const j = await searchJob(r.ref);
                if (!j) { r.status = 'not-found'; r.error = 'not found in search'; log(`  ${r.ref} — NOT FOUND`, '#f55'); }
                else { r.internalId = j.id; r.jobNumber = j.number; log(`  ${r.ref} -> ${j.id}`, '#888'); }
            } catch (e) {
                r.status = 'error'; r.error = 'search: ' + e.message;
                log(`  ${r.ref} — search error: ${e.message}`, '#f55');
            }
            saveState({ ...loadState(), rows: st.rows });
            await sleep(120);
        }
        // Move on to first job that needs navigating.
        const next = st.rows.findIndex(r => r.internalId && r.status === 'pending');
        if (next < 0) {
            finishRun('No jobs to process.');
            return;
        }
        const ns = loadState();
        ns.currentIndex = next;
        ns.phase = 'navigating';
        saveState(ns);
        // Dispatcher's next tick handles nav-vs-handle — just return here.
    }

    async function handleCurrentJob(st) {
        const row = st.rows[st.currentIndex];
        if (!row) return finishRun('Reached end of list.');

        setProgress(`Job ${st.currentIndex + 1}/${st.rows.length}: ${row.ref} (${row.engineerRaw})`);
        log(`--- [${st.currentIndex + 1}/${st.rows.length}] ${row.ref} — appt=${row.dateStr}, engineer="${row.engineerRaw}" ---`, '#fff');

        try {
            // If not on the Visits tab, switch hash
            if (location.hash !== '#visitsTab') {
                location.hash = 'visitsTab';
                await sleep(800);
            }

            await waitForAllocatePanel();

            const existing = await readExistingVisits();
            log(`  existing visits (${existing.length}):`, '#0af');
            existing.forEach(v => log(`    · ${v.engineer} | ${v.start} → ${v.end} | [${v.statusLabel}]`, '#888'));

            // Decide effective dates:
            //   • If row has a date → use it.
            //   • If row has no date → take the dates from the first incomplete
            //     existing visit (BEFORE we cancel it).
            // Cancel ALL incomplete existing visits, then allocate the new one.
            const hasDate = !!row.dateStr;
            const toCancel = existing.filter(v => v.statusClass === 'incomplete');
            row.cancelTargets = toCancel.map(v => ({ engineer: v.engineer, start: v.start, end: v.end, statusLabel: v.statusLabel }));

            let effectiveStart, effectiveEnd;
            if (hasDate) {
                effectiveStart = row.dateStr;
                effectiveEnd   = addMinutesToJlDate(row.dateStr, DEFAULT_DURATION_MINS);
            } else if (toCancel.length) {
                effectiveStart = toCancel[0].start;
                effectiveEnd   = toCancel[0].end;
            } else {
                throw new Error('No appointment date provided AND no incomplete visit to take a date from.');
            }
            row.appliedStart = effectiveStart;
            row.appliedEnd = effectiveEnd;

            if (st.dryRun) {
                const { options, getLabel } = getEngineerOptions();
                const match = fuzzyPickEngineer(row.engineerRaw, options, getLabel);
                if (!match) {
                    log(`  [DRY] Engineer "${row.engineerRaw}" NOT FOUND in roster (${options.length} options)`, '#f55');
                    row.status = 'engineer-unresolved';
                    row.error = 'engineer name not matched';
                } else {
                    const confident = match.score >= 0.85;
                    log(`  [DRY] "${row.engineerRaw}" -> "${match.label}" (score ${match.score.toFixed(2)}${confident ? '' : ', LOW'})`,
                        confident ? '#0fa' : '#fa0');
                    if (toCancel.length) {
                        log(`  [DRY] Would cancel ${toCancel.length} incomplete visit(s):`, '#ff0');
                        toCancel.forEach(v => log(`    - ${v.engineer} | ${v.start} → ${v.end} | [${v.statusLabel}]`, '#ff0'));
                    } else {
                        log(`  [DRY] No incomplete visits to cancel.`, '#888');
                    }
                    log(`  [DRY] Would allocate new visit: "${match.label}" on ${effectiveStart} → ${effectiveEnd}${hasDate ? '' : ' (date taken from cancelled visit)'}`, '#ff0');
                    row.status = 'dry-ok';
                    row.resolvedEngineer = match.label;
                    row.resolvedScore = match.score;
                }
                row.existingVisits = existing;
                appendLog({ kind: 'dry', ref: row.ref, row });
            } else {
                // LIVE: cancel each incomplete visit first.
                for (const v of toCancel) {
                    log(`  cancelling visit: ${v.engineer} | ${v.start} → ${v.end}`, '#fa0');
                    await clickCancelForVisit(v);
                }
                if (toCancel.length) {
                    // Re-confirm the Allocate panel is still ready (visit list refreshed).
                    await waitForAllocatePanel();
                }

                ensureEngineerRadioSelected();
                await sleep(150);

                const picked = selectEngineer(row.engineerRaw);
                log(`  engineer set: "${picked.label}" (score ${picked.score.toFixed(2)})`,
                    picked.score >= 0.85 ? '#0fa' : '#fa0');
                row.resolvedEngineer = picked.label;
                row.resolvedScore = picked.score;

                ensureAppointmentChecked();
                await sleep(150);

                setDateField('startDate', effectiveStart);
                setDateField('endDate',   effectiveEnd);
                log(`  dates set: ${effectiveStart} → ${effectiveEnd}${hasDate ? '' : ' (kept from cancelled visit)'}`, '#0af');

                const allocBtn = findAllocateButton();
                if (!allocBtn) throw new Error('Allocate button not found');
                allocBtn.click();
                log('  Allocate clicked — waiting for confirmation...', '#0af');

                // After cancellations, the baseline incomplete count dropped.
                // Success = the active visit list now contains the new engineer
                // at the effective start.
                const after = await readExistingVisits();
                row.existingVisits = existing;
                row.visitsAfter = after;
                const newOne = after.find(v =>
                    v.start === effectiveStart && normName(v.engineer) === normName(picked.label)
                );
                if (newOne) {
                    log(`  SUCCESS — new visit: ${newOne.engineer} | ${newOne.start} → ${newOne.end}`, '#0fa');
                    row.status = 'ok';
                    row.newVisit = newOne;
                } else if (after.length > existing.length - toCancel.length) {
                    log(`  SUCCESS — new visit added (engineer match not exact in list)`, '#0fa');
                    row.status = 'ok';
                } else {
                    log('  no new visit detected — UNCONFIRMED', '#fa0');
                    row.status = 'unconfirmed';
                    row.error = 'new visit not found after Allocate';
                }
                appendLog({ kind: 'live', ref: row.ref, row });
            }
        } catch (e) {
            log('  ERROR: ' + e.message, '#f55');
            row.status = 'error';
            row.error = e.message;
            appendLog({ kind: 'error', ref: row.ref, error: e.message });
        }

        // Advance
        const cur = loadState();
        cur.rows[cur.currentIndex] = row;
        cur.currentIndex++;
        if (cur.currentIndex >= cur.rows.length) {
            cur.phase = 'done';
            cur.running = false;
            saveState(cur);
            finishRun(`Done — ${cur.rows.length} processed.`);
            return;
        }
        // Skip any rows without an internalId
        while (cur.currentIndex < cur.rows.length && !cur.rows[cur.currentIndex].internalId) {
            log(`  skipping ${cur.rows[cur.currentIndex].ref} (no internal id)`, '#fa0');
            cur.rows[cur.currentIndex].status = cur.rows[cur.currentIndex].status || 'not-found';
            cur.currentIndex++;
        }
        if (cur.currentIndex >= cur.rows.length) {
            cur.phase = 'done';
            cur.running = false;
            saveState(cur);
            finishRun(`Done — ${cur.rows.length} processed.`);
            return;
        }
        cur.phase = 'navigating';
        saveState(cur);
        await sleep(700);
        // Trigger navigation to the next job. location.href change ends this
        // page's script; new page's boot resumes via runDispatcher.
        location.href = `/Job/Detail/${cur.rows[cur.currentIndex].internalId}?pageIndex=1#visitsTab`;
    }

    function finishRun(msg) {
        const st = loadState();
        const wasReport = !!(st && st.dryRun);
        if (st) { st.running = false; st.phase = 'done'; saveState(st); }
        setRunningUI(false);
        setRunButtonsEnabled(!!st?.rows?.length);
        setProgress(msg + (wasReport ? ' Report opened — review, then Run Allocate.' : ' Click View Report.'));
        log(msg, '#0fa');
        // After a report-only pass, surface the review modal automatically.
        if (wasReport) setTimeout(() => { try { showReport(); } catch {} }, 400);
    }

    // ---------------------------------------------------------------------------
    // Report
    // ---------------------------------------------------------------------------
    function summarizeVisits(visits) {
        const v = visits || [];
        const counts = { rejected: 0, incomplete: 0, complete: 0, cancelled: 0, unknown: 0 };
        const breakdown = {}; // e.g. { "On Site": 2, "Completed": 1 }
        for (const x of v) {
            counts[x.statusClass] = (counts[x.statusClass] || 0) + 1;
            breakdown[x.statusLabel] = (breakdown[x.statusLabel] || 0) + 1;
        }
        return { total: v.length, counts, breakdown };
    }

    function showReport() {
        const st = loadState();
        if (!st || !st.rows?.length) { alert('No data yet — run some jobs first.'); return; }

        const rows = st.rows;
        const statusColour = (s) => ({
            'ok': '#16a34a', 'dry-ok': '#ca8a04', 'pending': '#6b7280',
            'not-found': '#dc2626', 'error': '#dc2626',
            'engineer-unresolved': '#dc2626', 'unconfirmed': '#ea580c'
        })[s] || '#111';

        const countCell = (n, colour) => n > 0
            ? `<span style="color:${colour};font-weight:600;">${n}</span>`
            : `<span style="color:#9ca3af;">0</span>`;

        const breakdownText = (breakdown) => {
            const entries = Object.entries(breakdown);
            if (!entries.length) return '';
            return entries.map(([k, n]) => `${escapeHtml(k)}${n > 1 ? ` ×${n}` : ''}`).join(', ');
        };

        const statusColourForClass = (cls) => ({
            rejected: '#dc2626', incomplete: '#ea580c',
            complete: '#16a34a', cancelled: '#6b7280', unknown: '#9ca3af'
        })[cls] || '#111';

        const visitDetailHtml = (visits) => {
            if (!visits || !visits.length) return '<em style="color:#9ca3af;">(none)</em>';
            return '<ul style="margin:0;padding-left:16px;">' + visits.map(v => {
                const col = statusColourForClass(v.statusClass);
                return `<li><span>${escapeHtml(v.engineer)}</span> <span style="color:#6b7280;">${escapeHtml(v.start)} → ${escapeHtml(v.end)}</span> <span style="color:${col};font-weight:600;">[${escapeHtml(v.statusLabel)}]</span></li>`;
            }).join('') + '</ul>';
        };

        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:100001;' +
            'display:flex;align-items:center;justify-content:center;';
        overlay.innerHTML = `
<div style="background:#fff;color:#111;border-radius:8px;width:94vw;max-width:1280px;max-height:92vh;
     overflow:hidden;display:flex;flex-direction:column;font-family:system-ui,sans-serif;
     box-shadow:0 10px 40px rgba(0,0,0,.4);">
  <div style="padding:12px 16px;background:#111827;color:#f9fafb;display:flex;justify-content:space-between;align-items:center;">
    <strong>Bulk Allocate — Report</strong>
    <div>
      <button id="jl-report-csv" style="background:#2563eb;color:#fff;border:0;border-radius:4px;padding:6px 12px;cursor:pointer;margin-right:6px;">Download CSV</button>
      <button id="jl-report-close" style="background:#9ca3af;color:#fff;border:0;border-radius:4px;padding:6px 12px;cursor:pointer;">Close</button>
    </div>
  </div>
  <div style="padding:12px 16px;overflow-y:auto;">
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead>
        <tr style="background:#f3f4f6;text-align:left;">
          <th style="padding:6px;border-bottom:1px solid #d1d5db;">#</th>
          <th style="padding:6px;border-bottom:1px solid #d1d5db;">Job</th>
          <th style="padding:6px;border-bottom:1px solid #d1d5db;">Appt</th>
          <th style="padding:6px;border-bottom:1px solid #d1d5db;">CSV engineer</th>
          <th style="padding:6px;border-bottom:1px solid #d1d5db;">Matched</th>
          <th style="padding:6px;border-bottom:1px solid #d1d5db;">Alloc status</th>
          <th style="padding:6px;border-bottom:1px solid #d1d5db;text-align:center;">Visits</th>
          <th style="padding:6px;border-bottom:1px solid #d1d5db;text-align:center;" title="Count of existing visits with a Rejected status icon">Rejected</th>
          <th style="padding:6px;border-bottom:1px solid #d1d5db;text-align:center;" title="Existing visits that aren't Complete, Cancelled or Rejected (e.g. on-way, on-site)">Incomplete</th>
          <th style="padding:6px;border-bottom:1px solid #d1d5db;text-align:center;">Complete</th>
          <th style="padding:6px;border-bottom:1px solid #d1d5db;">Existing visits (engineer, dates, status)</th>
          <th style="padding:6px;border-bottom:1px solid #d1d5db;">Error</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r, i) => {
            const s = summarizeVisits(r.existingVisits);
            const flag = (s.counts.rejected > 0 || s.counts.incomplete > 0);
            return `
          <tr style="border-bottom:1px solid #e5e7eb;vertical-align:top;${flag ? 'background:#fff7ed;' : ''}">
            <td style="padding:6px;">${i + 1}</td>
            <td style="padding:6px;">${escapeHtml(r.ref)}</td>
            <td style="padding:6px;">${escapeHtml(r.dateStr || '')}</td>
            <td style="padding:6px;">${escapeHtml(r.engineerRaw || '')}</td>
            <td style="padding:6px;">${escapeHtml(r.resolvedEngineer || '')}${r.resolvedScore != null ? ` <span style="color:#6b7280;">(${r.resolvedScore.toFixed(2)})</span>` : ''}</td>
            <td style="padding:6px;color:${statusColour(r.status)};font-weight:600;">${escapeHtml(r.status || '')}</td>
            <td style="padding:6px;text-align:center;">${s.total}</td>
            <td style="padding:6px;text-align:center;">${countCell(s.counts.rejected, '#dc2626')}</td>
            <td style="padding:6px;text-align:center;">${countCell(s.counts.incomplete, '#ea580c')}</td>
            <td style="padding:6px;text-align:center;">${countCell(s.counts.complete, '#16a34a')}</td>
            <td style="padding:6px;color:#374151;">${visitDetailHtml(r.existingVisits)}</td>
            <td style="padding:6px;color:#dc2626;">${escapeHtml(r.error || '')}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>
</div>`;
        document.body.appendChild(overlay);
        overlay.querySelector('#jl-report-close').onclick = () => overlay.remove();
        overlay.querySelector('#jl-report-csv').onclick = () => downloadReportCsv(rows);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g,
            c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function downloadReportCsv(rows) {
        const esc = (v) => {
            const s = String(v == null ? '' : v);
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const lines = [
            ['Job', 'AppointmentDate', 'CsvEngineer', 'ResolvedEngineer', 'Score', 'AllocStatus',
             'Visits', 'Rejected', 'Incomplete', 'Complete', 'VisitBreakdown',
             'ExistingVisits', 'Error'].map(esc).join(',')
        ];
        rows.forEach(r => {
            const s = summarizeVisits(r.existingVisits);
            const breakdown = Object.entries(s.breakdown).map(([k, n]) => `${k}×${n}`).join(' ; ');
            const existingStr = (r.existingVisits || []).map(v =>
                `${v.engineer} ${v.start}->${v.end} [${v.statusLabel}]`
            ).join(' | ');
            lines.push([
                r.ref, r.dateStr, r.engineerRaw, r.resolvedEngineer || '',
                r.resolvedScore != null ? r.resolvedScore.toFixed(2) : '',
                r.status || '',
                s.total, s.counts.rejected, s.counts.incomplete, s.counts.complete,
                breakdown, existingStr, r.error || ''
            ].map(esc).join(','));
        });
        const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `bulk-allocate-report-${new Date().toISOString().slice(0,16).replace(/[:T]/g,'-')}.csv`;
        document.body.appendChild(a); a.click(); a.remove();
    }

    // ---------------------------------------------------------------------------
    // Restore state on each page load
    // ---------------------------------------------------------------------------
    function renderFromState() {
        const st = loadState();
        if (!st) {
            setRunButtonsEnabled(false);
            setProgress('Paste CSV (Job Number, Appointment Date, Engineer) to begin.');
            setRunningUI(false);
            return;
        }
        setRunButtonsEnabled(!!st.rows?.length && !st.running);
        setRunningUI(!!st.running);
        const done = st.rows.filter(r => r.status && r.status !== 'pending').length;
        const mode = st.dryRun ? 'report' : 'allocate';
        setProgress(`${done}/${st.rows.length} processed — ${mode} phase=${st.phase}${st.running ? ' (running)' : ''}`);
    }

    // ===========================================================================
    // BOOT
    // ===========================================================================
    function boot() {
        createUI();
        replayLogLines();
        renderFromState();
        // Auto-continue the run if we're mid-navigation
        const st = loadState();
        if (st && st.running) {
            log('Resuming run...', '#0af');
            setTimeout(runDispatcher, 1200); // let the page settle
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
