// ==UserScript==
// @name         Joblogic - Bulk Print Job Reports (Merged PDF)
// @namespace    http://tampermonkey.net/
// @version      1.11
// @description  On /Job with a filter applied, iterates all jobs across all pages, downloads each Job Report (Share > Download), and saves a single merged PDF. v1.3: collapses to a launcher button in the shared dock (drag to reorder).
// @match        https://go.joblogic.com/Job*
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      cdn.jsdelivr.net
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/joblogic-bulk-print-reports.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/joblogic-bulk-print-reports.user.js
// ==/UserScript==

(function () {
    'use strict';

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
    function jlDockButton(id, label, color, onClick) {
        jlGetDock();
        const l = jlDockList();
        let b = document.getElementById('jl-launch-' + id);
        if (b) return b;
        const bg = color || '#072d3d';
        b = document.createElement('button');
        b.id = 'jl-launch-' + id;
        b.dataset.scriptId = id;
        b.textContent = label;
        b.title = 'Show / hide ' + label + '  (drag to reorder)';
        b.draggable = true;
        b.style.cssText = JL_BTN_CSS + 'background:' + bg + ';border-color:' + bg + ';';
        b.addEventListener('click', () => { if (b.dataset.justDragged) { delete b.dataset.justDragged; return; } onClick(); });
        b.addEventListener('dragstart', () => { b.classList.add('jl-dragging'); b.style.opacity = '0.4'; });
        b.addEventListener('dragend', () => { b.classList.remove('jl-dragging'); b.style.opacity = '1'; b.dataset.justDragged = '1'; setTimeout(() => { delete b.dataset.justDragged; }, 60); jlSaveOrder(); });
        l.appendChild(b);
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
            btn.style.boxShadow = opening ? '0 0 0 2px #fff, 0 1px 3px rgba(0,0,0,.25)' : '0 1px 3px rgba(0,0,0,.25)';
        });
        return btn;
    }
    // ===== end shared dock =====

    const SCRIPT_ID = 'bulk-print-reports';
    const SCRIPT_LABEL = '🖨 Bulk Print Reports';
    const SCRIPT_COLOR = '#072d3d';

    // --- CONFIG ---
    const DELAY_BETWEEN_FETCHES = 250;
    const PAGINATION_TIMEOUT_MS = 12000;

    // --- STATE ---
    let panel, logArea, progressText, startBtn, stopBtn;
    let running = false;

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const ts = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    // =======================================================================
    // UI
    // =======================================================================
    function createUI() {
        if (document.getElementById('jl-bulkprint-panel')) return;

        panel = document.createElement('div');
        panel.id = 'jl-bulkprint-panel';
        panel.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;background:#1a1a2e;color:#eee;border-radius:8px;padding:16px;width:560px;max-height:85vh;display:flex;flex-direction:column;font-family:monospace;font-size:12px;box-shadow:0 4px 20px rgba(0,0,0,0.5);';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;';
        const title = document.createElement('strong');
        title.style.fontSize = '14px';
        title.textContent = 'Bulk Print Job Reports';
        const closeBtn = document.createElement('button');
        closeBtn.textContent = 'X';
        closeBtn.style.cssText = 'background:none;border:none;color:#eee;font-size:18px;cursor:pointer;';
        closeBtn.onclick = () => { panel.style.display = 'none'; };
        header.appendChild(title);
        header.appendChild(closeBtn);

        const progressDiv = document.createElement('div');
        progressDiv.style.marginBottom = '10px';
        progressText = document.createElement('span');
        progressText.style.color = '#0fa';
        progressText.textContent = 'Apply your filter on /Job, then click Start.';
        progressDiv.appendChild(progressText);

        const controls = document.createElement('div');
        controls.style.marginBottom = '10px';
        startBtn = document.createElement('button');
        startBtn.textContent = 'Start';
        startBtn.style.cssText = 'background:#0a8;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;margin-right:8px;';
        startBtn.onclick = start;
        stopBtn = document.createElement('button');
        stopBtn.textContent = 'Stop';
        stopBtn.style.cssText = 'background:#a22;color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;display:none;';
        stopBtn.onclick = () => { running = false; };
        controls.appendChild(startBtn);
        controls.appendChild(stopBtn);

        logArea = document.createElement('div');
        logArea.style.cssText = 'flex:1;overflow-y:auto;background:#0a0a1a;padding:8px;border-radius:4px;max-height:55vh;';

        panel.appendChild(header);
        panel.appendChild(progressDiv);
        panel.appendChild(controls);
        panel.appendChild(logArea);
        document.body.appendChild(panel);

        // Start hidden; the shared dock button toggles visibility.
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
    const setProgress = (m) => { progressText.textContent = m; };

    // =======================================================================
    // Scrape jobs from current list page
    // =======================================================================
    function scrapeJobsOnPage() {
        const jobs = [];
        const seen = new Set();
        document.querySelectorAll('a[href*="/Job/Detail/"]').forEach(a => {
            const m = a.getAttribute('href').match(/\/Job\/Detail\/(\d+)/);
            if (!m) return;
            const id = m[1];
            if (seen.has(id)) return;
            seen.add(id);
            jobs.push({ id, number: (a.textContent || '').trim() || id });
        });
        return jobs;
    }

    // =======================================================================
    // Pagination — click the visible "next page" control
    // =======================================================================
    function findNextPageButton() {
        // Try the common Joblogic/Kendo/Bootstrap patterns
        const selectors = [
            'a.k-pager-nav[aria-label="Go to the next page"]',
            'a.k-pager-nav[title="Go to the next page"]',
            '.k-pager-nav[aria-label*="next" i]',
            '.pagination li.next:not(.disabled) a',
            'li.next:not(.disabled) > a',
            'a[rel="next"]',
            'button[aria-label="Next page"]',
            'button[aria-label="Next"]'
        ];
        for (const s of selectors) {
            const el = document.querySelector(s);
            if (!el) continue;
            const disabled = el.classList.contains('k-state-disabled')
                || el.classList.contains('disabled')
                || el.getAttribute('aria-disabled') === 'true'
                || el.hasAttribute('disabled');
            if (!disabled) return el;
        }
        return null;
    }

    async function gotoNextPage() {
        const btn = findNextPageButton();
        if (!btn) return false;
        const firstBefore = (scrapeJobsOnPage()[0] || {}).id;
        btn.click();
        const deadline = Date.now() + PAGINATION_TIMEOUT_MS;
        while (Date.now() < deadline) {
            await sleep(200);
            const firstAfter = (scrapeJobsOnPage()[0] || {}).id;
            if (firstAfter && firstAfter !== firstBefore) return true;
        }
        return false;
    }

    async function collectAllJobs() {
        const all = [];
        const seen = new Set();
        let page = 0;
        while (running) {
            page++;
            const jobs = scrapeJobsOnPage();
            let added = 0;
            for (const j of jobs) {
                if (seen.has(j.id)) continue;
                seen.add(j.id);
                all.push(j);
                added++;
            }
            log(`Page ${page}: scraped ${jobs.length} rows (${added} new, ${all.length} total)`);
            setProgress(`Collecting — page ${page}, ${all.length} jobs`);
            const advanced = await gotoNextPage();
            if (!advanced) { log('No next page — collection complete.', '#0fa'); break; }
        }
        return all;
    }

    // =======================================================================
    // Discover the Share > Download URL by fetching the detail page HTML and
    // scanning for URL-ish strings that reference the sample job id with
    // report/print/pdf/download-style keywords. Same-origin fetch — no iframe,
    // no cross-origin issues.
    // =======================================================================
    async function discoverDownloadUrl(sampleId) {
        const resp = await fetch('/Job/Detail/' + sampleId, { credentials: 'same-origin' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status + ' fetching /Job/Detail/' + sampleId);
        const html = await resp.text();

        // Find all quoted URLs in the HTML that contain the sample id anywhere.
        const candidates = new Set();
        const urlRe = new RegExp(
            '["\']((?:https?:)?/[^"\'\\s<>]*' + sampleId + '[^"\'\\s<>]*)["\']',
            'gi'
        );
        let m;
        while ((m = urlRe.exec(html)) !== null) {
            candidates.add(m[1].replace(/&amp;/g, '&'));
        }

        // Score each candidate. The manual flow is Share > Download, so /Download/
        // endpoints win strongly; penalize data/compliance/detail-style endpoints.
        const scored = [...candidates].map(url => {
            const l = url.toLowerCase();
            let score = 0;
            if (/\/download\//.test(l))           score += 25;
            if (/(jobcard|jobreport|printjob)/.test(l)) score += 15;
            if (/\/print\//.test(l))              score += 8;
            if (/report/.test(l))                 score += 3;
            if (/pdf/.test(l))                    score += 3;
            if (/invoice|quote|cert|attach|document|audit|compliance|asset/.test(l)) score -= 15;
            if (/\/(detail|edit|view|index|history|timeline|get[A-Z])/.test(url))    score -= 10;
            return { url, score };
        }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);

        return { best: scored[0] ? scored[0].url : null, all: scored };
    }

    function promptUserForUrl(sampleId) {
        const msg =
            'Auto-discovery could not find the Share > Download URL.\n\n' +
            'Please open any job in Joblogic, right-click the "Download" option in the Share menu, and copy its link.\n' +
            'Paste it below. Make sure it contains the job id ' + sampleId + ' somewhere in the URL.';
        const pasted = prompt(msg, '');
        if (!pasted) return null;
        const trimmed = pasted.trim();
        if (!trimmed.includes(sampleId)) {
            alert('The URL you pasted does not contain the job id ' + sampleId + '. Cannot template it for other jobs.');
            return null;
        }
        return trimmed.startsWith('http') ? trimmed : (location.origin + trimmed);
    }

    function templateUrl(exampleUrl, sampleId, newId) {
        // Swap the sample id out for the new one (works for /Print/{id} and ?jobId={id})
        return exampleUrl.split(sampleId).join(newId);
    }

    // =======================================================================
    // Fetch each PDF and merge with pdf-lib
    // =======================================================================
    async function fetchPdfBytes(url, depth = 0, logJson = false) {
        if (depth > 4) throw new Error('Too many redirects while resolving PDF');
        const r = await fetch(url, { credentials: 'same-origin' });
        if (!r.ok) throw new Error('HTTP ' + r.status + ' on ' + url);
        const ct = (r.headers.get('content-type') || '').toLowerCase();
        const buf = await r.arrayBuffer();
        const bytes = new Uint8Array(buf);
        const head = String.fromCharCode.apply(null, bytes.slice(0, 4));

        if (head === '%PDF') return bytes;

        if (ct.includes('application/json')) {
            const text = new TextDecoder().decode(bytes);
            let json;
            try { json = JSON.parse(text); } catch (e) { throw new Error('Invalid JSON response from ' + url); }
            if (logJson) log(`  JSON from ${url}: ${text.slice(0, 600)}`, '#888');

            // Walk the JSON and collect every string that looks like a URL
            const strings = [];
            (function walk(o) {
                if (o == null) return;
                if (typeof o === 'string') strings.push(o);
                else if (Array.isArray(o)) o.forEach(walk);
                else if (typeof o === 'object') Object.values(o).forEach(walk);
            })(json);

            const scored = strings
                .filter(s => typeof s === 'string' && (s.startsWith('/') || s.startsWith('http')))
                .map(u => {
                    const l = u.toLowerCase();
                    let score = 0;
                    if (/\.pdf(?:$|\?)/.test(l))           score += 30;
                    if (/\/download\//.test(l))            score += 10;
                    if (/report|print|jobcard|jobprint/.test(l)) score += 5;
                    if (/pdf/.test(l))                     score += 3;
                    if (/thumb|preview|icon|logo/.test(l)) score -= 15;
                    return { u, score };
                })
                .filter(x => x.score > 0)
                .sort((a, b) => b.score - a.score);

            if (!scored.length) {
                throw new Error(`JSON response had no PDF-like URL. Body (first 400): ${text.slice(0, 400)}`);
            }
            const next = scored[0].u.startsWith('http') ? scored[0].u : (location.origin + scored[0].u);
            if (logJson) log(`  Following JSON URL: ${next}`, '#0af');
            return fetchPdfBytes(next, depth + 1, false);
        }

        const text = new TextDecoder().decode(bytes);
        throw new Error(`Response is not a PDF (content-type=${ct}, head="${head}"). First 200 chars: ${text.slice(0, 200)}`);
    }

    const PDFLIB_URL = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';

    function gmXhr(url) {
        const fn = (typeof GM_xmlhttpRequest !== 'undefined' && GM_xmlhttpRequest)
            || (typeof GM !== 'undefined' && GM.xmlHttpRequest);
        if (!fn) return Promise.reject(new Error('GM_xmlhttpRequest not granted'));
        return new Promise((resolve, reject) => {
            fn({
                method: 'GET', url,
                onload: (r) => (r.status >= 200 && r.status < 300) ? resolve(r.responseText) : reject(new Error('HTTP ' + r.status)),
                onerror: (e) => reject(new Error('GM_xmlhttpRequest error: ' + (e && e.error || 'unknown'))),
            });
        });
    }

    let _pdfLibCache = null;
    async function loadPDFLib() {
        if (_pdfLibCache) return _pdfLibCache;
        if (typeof window !== 'undefined' && window.PDFLib && window.PDFLib.PDFDocument) {
            _pdfLibCache = window.PDFLib;
            return _pdfLibCache;
        }

        // Fetch the source via GM_xmlhttpRequest (Tampermonkey sandbox blocks
        // dynamic <script src=...> and also prevents the UMD from attaching to
        // the sandbox's window). We evaluate pdf-lib in CommonJS mode by
        // passing fake `module`/`exports` — its UMD wrapper takes that branch
        // first, so it populates our `module.exports` directly.
        const code = await gmXhr(PDFLIB_URL);
        const fakeExports = {};
        const fakeModule = { exports: fakeExports };
        try {
            (new Function('exports', 'module', code))(fakeExports, fakeModule);
        } catch (e) {
            throw new Error('pdf-lib eval failed: ' + e.message);
        }
        const lib = fakeModule.exports || fakeExports;
        if (!lib || !lib.PDFDocument) {
            throw new Error('pdf-lib loaded but PDFDocument not found in exports');
        }
        _pdfLibCache = lib;
        return lib;
    }

    async function mergePdfs(pdfBytesList) {
        const PDFLib = await loadPDFLib();
        const { PDFDocument } = PDFLib;
        const out = await PDFDocument.create();
        for (const bytes of pdfBytesList) {
            const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
            const pages = await out.copyPages(src, src.getPageIndices());
            pages.forEach(p => out.addPage(p));
        }
        return await out.save();
    }

    function downloadBlob(bytes, filename) {
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
    }

    // =======================================================================
    // Main
    // =======================================================================
    async function start() {
        if (running) return;
        running = true;
        startBtn.style.display = 'none';
        stopBtn.style.display = 'inline-block';
        logArea.innerHTML = '';

        try {
            // 1. Collect every job across all pages of the current filter
            setProgress('Collecting jobs from all pages...');
            const jobs = await collectAllJobs();
            if (!running) throw new Error('Stopped by user during collection');
            if (!jobs.length) { log('No jobs found on current filter.', '#f55'); return; }
            log(`Collected ${jobs.length} jobs total.`, '#0af');

            // 2. Discover the Download URL by scanning the first job's detail page HTML
            log(`Discovering Share > Download URL from job ${jobs[0].number} (id ${jobs[0].id})...`, '#0af');
            setProgress('Calibrating Download URL...');
            const info = await discoverDownloadUrl(jobs[0].id);
            let exampleUrl = info.best;
            if (info.all.length) {
                log('Candidates found:', '#0af');
                info.all.slice(0, 8).forEach(c => log(`  score=${c.score}  ${c.url}`, '#ccc'));
            }
            if (!exampleUrl) {
                log('Auto-discovery failed. Prompting for manual URL...', '#fa0');
                exampleUrl = promptUserForUrl(jobs[0].id);
                if (!exampleUrl) throw new Error('No Download URL provided');
            }
            log(`Using Download URL: ${exampleUrl}`, '#0fa');

            // 3. Fetch each PDF. For the first job, dump the intermediate JSON
            // (if any) so misrouting is obvious in the log.
            const pdfs = [];
            const failed = [];
            for (let i = 0; i < jobs.length; i++) {
                if (!running) { log('Stopped by user.', '#f55'); break; }
                const job = jobs[i];
                const url = templateUrl(exampleUrl, jobs[0].id, job.id);
                setProgress(`Downloading ${i + 1}/${jobs.length}: ${job.number}`);
                try {
                    const bytes = await fetchPdfBytes(url, 0, i === 0);
                    pdfs.push(bytes);
                    log(`  [${i + 1}/${jobs.length}] ${job.number} — ${bytes.length} bytes`, '#0fa');
                } catch (e) {
                    log(`  [${i + 1}/${jobs.length}] ${job.number} — FAIL: ${e.message}`, '#f55');
                    failed.push(`${job.number}: ${e.message}`);
                }
                await sleep(DELAY_BETWEEN_FETCHES);
            }

            if (!pdfs.length) { log('No PDFs collected. Nothing to merge.', '#f55'); return; }

            // 4. Merge and save
            setProgress('Merging PDFs...');
            log(`Merging ${pdfs.length} PDFs...`, '#0af');
            const merged = await mergePdfs(pdfs);
            const filename = `JobReports_${ts()}.pdf`;
            downloadBlob(merged, filename);
            log(`Saved: ${filename}`, '#0fa');
            setProgress(`Done. ${pdfs.length}/${jobs.length} merged into ${filename}.`);

            if (failed.length) {
                log('');
                log('Failures:', '#f55');
                failed.forEach(f => log('  ' + f, '#f99'));
            }
        } catch (e) {
            log('ERROR: ' + (e && e.stack ? e.stack : e && e.message ? e.message : e), '#f55');
            setProgress('Error — see log.');
        } finally {
            running = false;
            startBtn.style.display = 'inline-block';
            stopBtn.style.display = 'none';
        }
    }

    // --- BOOT ---
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createUI);
    } else {
        createUI();
    }
})();
