// ==UserScript==
// @name         Joblogic - Repoint Job → Forms
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Move job form-rules onto the CURRENTLY DEPLOYED version of each form. Job rules store a version-specific FormUniqueGuid, so deploying a new form version leaves every already-assigned job pointing at the old one (Joblogic's own "assign to all incomplete jobs" reaches only ~3k of 12.6k open jobs). For each job this adds the new version's rule — carrying Show On and Required across — then removes the stale one. Probed live 2026-11-19: the duplicate check is per version guid, so the job is never without the form, and removing a rule does NOT destroy submitted answers. Paced under the Azure WAF, resumable, dry-run by default, and every write is logged to a JSONL part file so a run can be reversed.
// @match        https://go.joblogic.com/Job
// @match        https://go.joblogic.com/Job?*
// @match        https://go.joblogic.com/CompanyForm*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Forms/joblogic-repoint-job-forms.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Forms/joblogic-repoint-job-forms.user.js
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

    const VERSION = '1.0.0';
    const SCRIPT_ID = 'repoint-job-forms';
    const SCRIPT_LABEL = '🎯 Repoint Job → Forms';
    const SCRIPT_COLOR = '#6b3d8c';
    const SCRIPT_DESC = 'Moves job form-rules onto the currently deployed version of each form, carrying Show On and Required across. Dry-run by default. Every write is logged to a JSONL part file so a run can be reversed. Resumable: Stop and reload, then Start again.';

    // Pacing: see jl-azure-waf-rate-limit. Writes are likelier to draw the gateway's attention
    // than reads, so the floor is the same 1400 ms and the backoff is unchanged.
    const MIN_INTERVAL = 1400;
    const MAX_INTERVAL = 4000;
    const WAF_BACKOFF = [1500, 3000, 6000, 12000, 20000];
    const INDEX_PAGE_SIZE = 2000;   // SearchJsonData honours big pages
    const FORMS_PAGE_SIZE = 50;     // FormsSearch / JobFormsSearch cap
    const FLUSH_EVERY = 200;        // jobs per action-log part file
    const LOG_MAX_LINES = 400;

    const STORE = 'jl-repoint-job-forms-v1';

    const SOURCES = [
        { value: 'Open', label: 'Job list: Open tab (12.6k — the real population)' },
        { value: 'Incomplete', label: 'Incomplete jobs only (Joblogic’s own ~3k deploy scope)' },
        { value: 'All', label: 'Job list: every job (54k+, very slow)' }
    ];
    const INCOMPLETE_PAGE_SIZE = 50;   // SearchIncompleteJobs ignores anything larger

    const TEST_SITE = 'test site';     // the only site the guard lets through when it is on

    function SessionError(msg) { const e = new Error(msg); e.name = 'SessionError'; return e; }

    let running = false;
    let stopRequested = false;

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    async function sleepInterruptible(ms) {
        const step = 250;
        for (let left = ms; left > 0 && !stopRequested; left -= step) await sleep(Math.min(step, left));
    }

    // The DOM's antiforgery token is minted at page load and goes stale after ~30 min; a stale
    // one makes these endpoints answer HTTP 400 with an EMPTY BODY, which reads exactly like a
    // dead session. Refresh on a timer, not per failure — reactively it costs a ~7.6 s page
    // fetch per job and collapses throughput (measured 2026-11-17).
    const TOKEN_TTL_MS = 10 * 60 * 1000;
    let _token = '', _tokenAt = 0;

    function domCsrf(doc = document) {
        const el = doc.querySelector('input[name="__RequestVerificationToken"]');
        return el ? el.value : '';
    }

    async function fetchToken() {
        const html = await fetch('/CompanyForm', { credentials: 'same-origin' }).then(r => r.text());
        const m = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
        if (!m) throw SessionError('No antiforgery token on /CompanyForm — logged out?');
        _token = m[1]; _tokenAt = Date.now();
        return _token;
    }

    async function getCsrf(force) {
        if (!_token) { _token = domCsrf(); _tokenAt = Date.now(); }
        if (force || !_token || Date.now() - _tokenAt > TOKEN_TTL_MS) await fetchToken();
        return _token;
    }

    function downloadText(filename, text, mime) {
        const url = URL.createObjectURL(new Blob([text], { type: mime || 'application/x-ndjson' }));
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    }

    // =======================================================================
    // Resume state. Plan + cursor only — the action log goes straight to disk
    // in part files, the way the sweep writes its rows.
    // =======================================================================
    function loadState() {
        try { return JSON.parse(localStorage.getItem(STORE)) || null; } catch (e) { return null; }
    }
    function saveState(s) {
        try { localStorage.setItem(STORE, JSON.stringify(s)); }
        catch (e) { log('Could not save resume state: ' + e.message, '#e2a33c'); }
    }
    function clearState() { try { localStorage.removeItem(STORE); } catch (e) {} }

    // =======================================================================
    // Paced fetch with Azure WAF retry
    // =======================================================================
    let lastRequestAt = 0;
    let currentInterval = MIN_INTERVAL;
    let okStreak = 0;

    async function throttle() {
        const wait = lastRequestAt + currentInterval - Date.now();
        if (wait > 0) await sleep(wait);
        lastRequestAt = Date.now();
    }

    async function isWafBlock(resp) {
        if (![403, 429, 503].includes(resp.status)) return false;
        if (/Azure-Application-Gateway/i.test(resp.headers.get('server') || '')) return true;
        return /text\/html/i.test(resp.headers.get('content-type') || '');
    }

    const isLoginUrl = (u) => /\/Account\/|\/login|identity\./i.test(u || '');

    async function jlFetch(url, opts = {}) {
        for (let attempt = 0; ; attempt++) {
            await throttle();
            let resp;
            try {
                resp = await fetch(url, Object.assign({ credentials: 'same-origin' }, opts));
            } catch (e) {
                if (attempt < WAF_BACKOFF.length && running) { await sleepInterruptible(WAF_BACKOFF[attempt]); continue; }
                throw e;
            }
            if (resp.redirected && isLoginUrl(resp.url)) throw new SessionError('Logged out of Joblogic');
            if (await isWafBlock(resp)) {
                okStreak = 0;
                currentInterval = Math.min(MAX_INTERVAL, currentInterval + 200);
                if (attempt < WAF_BACKOFF.length && running) {
                    setProgressNote(`rate-limited — retry in ${WAF_BACKOFF[attempt] / 1000}s (pace now ${currentInterval} ms)`);
                    await sleepInterruptible(WAF_BACKOFF[attempt]);
                    continue;
                }
                throw new Error('Rate-limited by Azure WAF (403) — gave up after retries');
            }
            if (++okStreak >= 60 && currentInterval > MIN_INTERVAL) { currentInterval = Math.max(MIN_INTERVAL, currentInterval - 100); okStreak = 0; }
            return resp;
        }
    }

    let progressNote = '';
    let renderProgress = () => {};
    function setProgressNote(n) { progressNote = n; renderProgress(); }

    // =======================================================================
    // UI
    // =======================================================================
    let panel, progressText, logArea, tabSelect, scopeBox, jobsBox, dryChk, testChk;
    let startBtn, stopBtn, planBtn, resetBtn;

    function mkBtn(label, color, onClick) {
        const b = document.createElement('button');
        b.textContent = label;
        b.style.cssText = 'background:' + color + ';color:#fff;border:none;border-radius:4px;padding:6px 12px;cursor:pointer;font-family:monospace;font-size:12px;';
        b.addEventListener('click', onClick);
        return b;
    }

    function mkArea(ph, rows) {
        const t = document.createElement('textarea');
        t.rows = rows; t.placeholder = ph;
        t.style.cssText = 'width:100%;background:#0a0a1a;color:#eee;border:1px solid #444;border-radius:4px;padding:6px;font-family:monospace;font-size:11px;resize:vertical;';
        return t;
    }

    function mkCheck(labelText, checked, title) {
        const l = document.createElement('label');
        l.style.cssText = 'display:inline-flex;align-items:center;gap:5px;cursor:pointer;';
        if (title) l.title = title;
        const c = document.createElement('input');
        c.type = 'checkbox'; c.checked = checked;
        l.appendChild(c); l.appendChild(document.createTextNode(labelText));
        return { label: l, input: c };
    }

    function createUI() {
        if (document.getElementById('jl-repoint-panel')) return;

        panel = document.createElement('div');
        panel.id = 'jl-repoint-panel';

        const box = document.createElement('div');
        box.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;background:#1a1a2e;color:#eee;border-radius:8px;padding:16px;width:680px;max-height:90vh;display:flex;flex-direction:column;font-family:monospace;font-size:12px;box-shadow:0 4px 20px rgba(0,0,0,0.5);';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;';
        const title = document.createElement('strong');
        title.style.fontSize = '14px';
        title.innerHTML = 'Repoint Job → Forms <span style="font-weight:400;color:#b59ad6;font-size:11px;">v' + VERSION + '</span>';
        const closeBtn = document.createElement('button');
        closeBtn.style.cssText = 'background:none;border:none;color:#eee;font-size:18px;cursor:pointer;';
        closeBtn.textContent = '✕';
        closeBtn.addEventListener('click', () => { panel.style.display = 'none'; });
        header.appendChild(title); header.appendChild(closeBtn);

        const blurb = document.createElement('div');
        blurb.style.cssText = 'color:#9fb6c4;margin-bottom:10px;line-height:1.5;';
        blurb.textContent = 'For every job holding an out-of-date version of a form, adds the deployed version (carrying Show On and Required across) and removes the stale rule. The new rule goes on first, so the job is never without the form. Submitted answers are not affected.';

        const progressDiv = document.createElement('div');
        progressDiv.style.marginBottom = '10px';
        progressText = document.createElement('span');
        progressText.style.color = '#0fa';
        progressDiv.appendChild(progressText);

        const optsDiv = document.createElement('div');
        optsDiv.style.cssText = 'display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:8px;';
        const tabLabel = document.createElement('label');
        tabLabel.textContent = 'Jobs from: ';
        tabSelect = document.createElement('select');
        tabSelect.style.cssText = 'background:#0a0a1a;color:#eee;border:1px solid #444;border-radius:4px;padding:4px;';
        SOURCES.forEach(t => {
            const o = document.createElement('option');
            o.value = t.value; o.textContent = t.label;
            tabSelect.appendChild(o);
        });
        tabLabel.appendChild(tabSelect);
        optsDiv.appendChild(tabLabel);

        const dry = mkCheck('Dry run (write nothing)', true, 'Works out exactly what it would change and downloads the plan, without touching Joblogic.');
        dryChk = dry.input;
        const test = mkCheck('Test site only', true, 'Hard guard: skips every job whose site is not "Test site". Leave on until a dry run looks right.');
        testChk = test.input;
        optsDiv.appendChild(dry.label); optsDiv.appendChild(test.label);

        const scopeLab = document.createElement('div');
        scopeLab.style.cssText = 'color:#9fb6c4;margin:4px 0 3px;';
        scopeLab.textContent = 'Forms to repoint — one name per line. Blank = every deployed form. Version suffixes are ignored, so "HVAC Health Check Report Form" matches V5 and V6.';
        scopeBox = mkArea('UP HVAC Deep Clean Form\nFGAS\n…', 4);

        const jobsLab = document.createElement('div');
        jobsLab.style.cssText = 'color:#9fb6c4;margin:8px 0 3px;';
        jobsLab.textContent = 'Restrict to these job numbers — one per line (paste a wave from the workbook). Blank = every job on the chosen tab.';
        jobsBox = mkArea('PM0001234/001\nPM0001234/002\n…', 4);

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin:10px 0;';
        startBtn = mkBtn('Start', '#6b3d8c', () => start());
        stopBtn = mkBtn('Stop', '#8c3b3b', () => { stopRequested = true; setProgressNote('stopping…'); });
        planBtn = mkBtn('Deployed forms', '#3d4a6b', () => dumpFormIndex());
        resetBtn = mkBtn('Discard saved run', '#555', () => {
            if (!confirm('Discard the saved run and start over? Part files already downloaded are kept.')) return;
            clearState(); log('Saved run discarded.', '#e2a33c'); refresh();
        });
        [startBtn, stopBtn, planBtn, resetBtn].forEach(b => btnRow.appendChild(b));

        logArea = document.createElement('div');
        logArea.style.cssText = 'flex:1;overflow-y:auto;background:#0a0a1a;border-radius:4px;padding:8px;min-height:150px;';

        box.appendChild(header); box.appendChild(blurb); box.appendChild(progressDiv);
        box.appendChild(optsDiv);
        box.appendChild(scopeLab); box.appendChild(scopeBox);
        box.appendChild(jobsLab); box.appendChild(jobsBox);
        box.appendChild(btnRow); box.appendChild(logArea);
        panel.appendChild(box);
        document.body.appendChild(panel);

        jlRegisterPanel(panel, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR, SCRIPT_DESC);
        refresh();
    }

    function log(msg, color) {
        if (!logArea) { console.log('[repoint]', msg); return; }
        const line = document.createElement('div');
        line.style.color = color || '#ccc';
        line.style.whiteSpace = 'pre-wrap';
        line.style.wordBreak = 'break-word';
        line.textContent = msg;
        logArea.appendChild(line);
        while (logArea.childElementCount > LOG_MAX_LINES) logArea.removeChild(logArea.firstChild);
        logArea.scrollTop = logArea.scrollHeight;
    }

    let progressBase = '';
    const setProgress = (msg) => { progressBase = msg; renderProgress(); };
    renderProgress = () => {
        if (progressText) progressText.textContent = progressBase + (progressNote ? '  (' + progressNote + ')' : '');
    };

    function refresh() {
        const s = loadState();
        if (!s) setProgress('Ready. Start reads the deployed forms, indexes the jobs, then repoints each one.');
        else setProgress(`Saved run ${s.stamp}${s.dry ? ' (dry run)' : ''}: ${s.cursor}/${s.jobs.length} jobs done, ${s.added} added, ${s.removed} removed. Start to resume.`);
        startBtn.disabled = running;
        planBtn.disabled = resetBtn.disabled = running;
        tabSelect.disabled = scopeBox.disabled = jobsBox.disabled = running || !!s;
        dryChk.disabled = testChk.disabled = running || !!s;
        [startBtn, planBtn, resetBtn].forEach(b => { b.style.opacity = b.disabled ? '0.45' : '1'; });
        startBtn.style.display = running ? 'none' : 'inline-block';
        stopBtn.style.display = running ? 'inline-block' : 'none';
        if (s && !running) startBtn.textContent = `Resume (${s.jobs.length - s.cursor} left)`;
        else if (!running) startBtn.textContent = dryChk.checked ? 'Dry run' : 'Start repointing';
    }

    // =======================================================================
    // Joblogic calls
    // =======================================================================
    async function postForm(url, fields, _retried) {
        const fd = new FormData();
        for (const k in fields) fd.append(k, fields[k]);
        const started = Date.now();
        const resp = await jlFetch(url, {
            method: 'POST',
            headers: { 'X-Requested-With': 'XMLHttpRequest', '__RequestVerificationToken': await getCsrf() },
            body: fd
        });
        const body = await resp.text();
        noteLatency(Date.now() - started);
        // Stale token: HTTP 400 with nothing in the body. Re-mint once and retry before
        // concluding anything about the session — this is NOT a logout.
        if ((resp.status === 400 || !body) && !_retried) {
            await getCsrf(true);
            return postForm(url, fields, true);
        }
        if (!/json/i.test(resp.headers.get('content-type') || '')) {
            throw SessionError('Joblogic returned a page instead of JSON — session expired?');
        }
        return JSON.parse(body);
    }

    // Joblogic throttles a long run by getting SLOWER, not by erroring (0.7 s/call early vs
    // 12.1 s after ~7,200 calls, zero errors throughout). Latency is the health signal.
    const SLOW_MS = 4000, VERY_SLOW_MS = 9000;
    let slowStreak = 0;
    function noteLatency(ms) {
        if (ms > VERY_SLOW_MS) slowStreak += 2;
        else if (ms > SLOW_MS) slowStreak += 1;
        else slowStreak = Math.max(0, slowStreak - 1);
        if (slowStreak >= 6) {
            currentInterval = Math.min(MAX_INTERVAL, currentInterval + 400);
            setProgressNote(`server slowing (${(ms / 1000).toFixed(1)}s/call) — pace now ${currentInterval} ms`);
            slowStreak = 0;
        }
    }

    // JL puts failure text in errors[] and leaves Message null, e.g. "A rule already exists
    // for this form." — which, probed 2026-11-19, only fires for the SAME version guid.
    const jlError = (res) => (res && res.errors || []).join('; ') || (res && res.Message) || 'unknown error';

    async function buildJobIndex(tab) {
        const out = [];
        let page = 1, total = Infinity;
        while (out.length < total) {
            if (stopRequested) throw new Error('Stopped');
            setProgress(`Indexing jobs… ${out.length}${isFinite(total) ? '/' + total : ''}`);
            const resp = await jlFetch('/api/Job/SearchJsonData', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                    '__RequestVerificationToken': await getCsrf()
                },
                body: JSON.stringify({
                    SearchTerm: '', SelectedTab: tab,
                    PageSize: INDEX_PAGE_SIZE, PageIndex: page,
                    EngineerType: 0,
                    IncludePPMJobs: true, IncludeReactiveJobs: true,
                    StatusIds: '',
                    StartLoggedDate: '', EndLoggedDate: '',
                    StartDate: '', EndDate: '',
                    StartCompleteDate: '', EndCompleteDate: '',
                    StartNextContactDate: '', EndNextContactDate: ''
                })
            });
            if (!/json/i.test(resp.headers.get('content-type') || '')) {
                throw SessionError('Job search returned a page instead of JSON — session expired?');
            }
            const data = await resp.json();
            if (data.success === false) throw new Error('Job search failed: ' + (data.errors || []).join('; '));
            const ad = data.AdditionalData || {};
            const jobs = ad.Jobs || [];
            total = ad.TotalCount || 0;
            for (const j of jobs) {
                if (!j.Id) continue;
                out.push({ id: j.Id, number: j.JobNumber || '', status: j.StatusDescription || '', site: j.SiteName || '' });
            }
            if (!jobs.length) break;
            page++;
        }
        return out;
    }

    // Joblogic's own deploy scope. JSON body, and it CAPS AT 50 PER PAGE whatever you ask.
    async function buildIncompleteIndex() {
        const out = [];
        let page = 1, total = Infinity;
        while (out.length < total) {
            if (stopRequested) throw new Error('Stopped');
            setProgress(`Listing incomplete jobs… ${out.length}${isFinite(total) ? '/' + total : ''}`);
            const resp = await jlFetch('/CompanyForm/SearchIncompleteJobs', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                    '__RequestVerificationToken': await getCsrf()
                },
                body: JSON.stringify({ formUniqueGuid: '', PageIndex: page, PageSize: INCOMPLETE_PAGE_SIZE, SearchTerm: '' })
            });
            if (!/json/i.test(resp.headers.get('content-type') || '')) {
                throw SessionError('Incomplete-jobs search returned a page instead of JSON — session expired?');
            }
            const ad = (await resp.json()).AdditionalData || {};
            const jobs = ad.Jobs || [];
            total = ad.TotalCount || 0;
            for (const j of jobs) {
                if (!j.Id) continue;
                out.push({ id: j.Id, number: j.JobNumber || '', status: j.StatusDescription || '', site: j.SiteName || '' });
            }
            if (!jobs.length) break;
            page++;
        }
        return out;
    }

    // FormsSearch returns ONE row per form family — the DEPLOYED version — and its
    // FormUniqueGuid is that version's guid, which is exactly what job rules store.
    async function fetchDeployedForms() {
        const out = [];
        let page = 1;
        for (;;) {
            if (stopRequested) throw new Error('Stopped');
            const j = await postForm('/companyform/FormsSearch', {
                SearchTerm: '', orderBy: '1', pageIndex: String(page), pageSize: String(FORMS_PAGE_SIZE)
            });
            const forms = (j && j.AdditionalData && j.AdditionalData.Forms) || [];
            forms.forEach(f => out.push({
                form_guid: f.FormUniqueGuid,
                form_name: f.FormName,
                form_type: f.FormType == null ? null : String(f.FormType),
                show_in_assets_list: f.ShowInAssetsList === true
            }));
            if (forms.length < FORMS_PAGE_SIZE) break;
            page++;
        }
        return out;
    }

    async function jobForms(jobId) {
        const j = await postForm('/companyform/JobFormsSearch', {
            jobId: String(jobId), SearchTerm: '', orderBy: '1', pageIndex: '1', pageSize: String(FORMS_PAGE_SIZE)
        });
        return (j && j.AdditionalData && j.AdditionalData.Forms) || [];
    }

    /** Add the deployed version's rule. Returns the created rule, which the add hands back. */
    async function addRule(jobId, guid, showOnRules, isRequired) {
        const res = await postForm('/companyform/AddFormRuleByJobId', {
            jobId: String(jobId), formUniqueGuid: guid,
            showOnRules: showOnRules, isRequired: isRequired ? 'true' : 'false'
        });
        if (res && res.success === true) {
            return { ok: true, created: (res.AdditionalData || {}).CreatedForm || null };
        }
        return { ok: false, message: jlError(res) };
    }

    /** Remove one rule. DefaultCompanyFormId when the rule has one, else its own Id. */
    async function removeRule(jobId, rule) {
        const fields = { jobId: String(jobId) };
        if (rule.DefaultCompanyFormId) fields.defaultCompanyFormId = rule.DefaultCompanyFormId;
        else fields.companyFormId = rule.Id;
        const res = await postForm('/companyform/RemoveFormRuleById', fields);
        return (res && res.success === true) ? { ok: true } : { ok: false, message: jlError(res) };
    }

    /** AddFormRuleByJobId ignores isRequiredOnAsset, so set it on the created rule afterwards. */
    async function changeRule(jobId, rule, showOnRules, isRequired, isRequiredOnAsset) {
        const res = await postForm('/companyform/ChangeFormRuleById', {
            jobId: String(jobId), showOnRules: showOnRules,
            defaultCompanyFormId: rule.DefaultCompanyFormId || '',
            companyFormId: rule.Id,
            isRequired: isRequired ? 'true' : 'false',
            isRequiredOnAsset: isRequiredOnAsset ? 'true' : 'false'
        });
        return (res && res.success === true) ? { ok: true } : { ok: false, message: jlError(res) };
    }

    async function dumpFormIndex() {
        if (running) return;
        running = true; refresh();
        try {
            setProgress('Reading deployed forms…');
            const deployed = await fetchDeployedForms();
            const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
            downloadText(`jl-deployed-forms-${stamp}.jsonl`, deployed.map(f => JSON.stringify(f)).join('\n') + '\n');
            log(`${deployed.length} deployed form versions written to Downloads.`, '#0fa');
            setProgress('Done.');
        } catch (e) {
            log('Failed: ' + e.message, '#ff6b6b');
        } finally { running = false; refresh(); }
    }

    // =======================================================================
    // Planning
    // =======================================================================
    // A new version is normally created with a "- V<n>" suffix on the name (NewVersion renames
    // unless the original Description is passed back), so "HVAC Health Check Report Form - V5"
    // and "- V6" are the same family. Strip the suffix to match a stale rule to its deployed
    // successor; FormUniqueGuid cannot do it, since that is what differs between versions.
    const familyOf = (name) => String(name || '').replace(/\s*[-–—]?\s*[vV]\d+\s*$/, '').trim().toLowerCase();

    const showOnString = (rule) =>
        ((rule && rule.ShowOnRules) || []).map(r => (r && r.TypeId != null) ? r.TypeId : r).filter(v => v !== '' && v != null).join(',');

    /**
     * What this job needs, as a list of actions. Never returns a plan that would leave the job
     * without the form: the add always precedes the removes, and when the deployed version is
     * already on the job the add is skipped and only the stale rules go.
     */
    function planFor(rules, deployedByFamily, scopeSet) {
        const byFamily = new Map();
        for (const r of rules) {
            if (!r.FormUniqueGuid) continue;
            const fam = familyOf(r.FormName);
            if (!byFamily.has(fam)) byFamily.set(fam, []);
            byFamily.get(fam).push(r);
        }

        const actions = [];
        for (const [fam, famRules] of byFamily) {
            if (scopeSet && !scopeSet.has(fam)) continue;
            const dep = deployedByFamily.get(fam);
            if (!dep || dep.ambiguous) continue;

            const stale = famRules.filter(r => r.FormUniqueGuid !== dep.guid);
            if (!stale.length) continue;
            const current = famRules.filter(r => r.FormUniqueGuid === dep.guid);

            // Carry the strictest settings off the stale rules: if the form was mandatory on
            // this job under the old version, it stays mandatory under the new one.
            const model = stale.find(r => r.IsRequired) || stale[0];
            const show = showOnString(model);
            const req = stale.some(r => r.IsRequired);
            const reqAsset = dep.assets && stale.some(r => r.IsRequiredOnAsset);

            if (!current.length) {
                actions.push({ action: 'add', family: fam, form_name: dep.name, guid: dep.guid,
                               show_on_rules: show, is_required: req, is_required_on_asset: reqAsset });
            }
            for (const r of stale) {
                actions.push({ action: 'remove', family: fam, form_name: r.FormName, guid: r.FormUniqueGuid,
                               rule: r, rule_id: r.Id, show_on_rules: showOnString(r),
                               is_required: !!r.IsRequired, is_required_on_asset: !!r.IsRequiredOnAsset });
            }
        }
        return actions;
    }

    // =======================================================================
    // The run
    // =======================================================================
    async function start() {
        if (running) return;
        running = true; stopRequested = false; refresh();

        let state = loadState();
        try {
            if (!state) {
                const dry = dryChk.checked;
                const testOnly = testChk.checked;
                const tab = tabSelect.value;

                setProgress('Reading deployed forms…');
                const deployed = await fetchDeployedForms();
                if (!deployed.length) throw new Error('No deployed forms returned');

                // family -> deployed version. A family two deployed forms both reduce to is
                // ambiguous and is never touched; say so rather than guessing.
                const famMap = new Map();
                for (const f of deployed) {
                    const fam = familyOf(f.form_name);
                    if (famMap.has(fam)) famMap.get(fam).ambiguous = true;
                    else famMap.set(fam, { guid: f.form_guid, name: f.form_name, assets: f.show_in_assets_list });
                }
                const ambiguous = [...famMap.entries()].filter(([, v]) => v.ambiguous).map(([k]) => k);
                if (ambiguous.length) log(`${ambiguous.length} form name(s) match more than one deployed form and will be skipped: ${ambiguous.slice(0, 5).join(', ')}`, '#e2a33c');

                const wanted = scopeBox.value.split('\n').map(s => familyOf(s)).filter(Boolean);
                let scope = null;
                if (wanted.length) {
                    const missing = wanted.filter(w => !famMap.has(w));
                    if (missing.length) log(`${missing.length} form name(s) matched no deployed form and will be ignored: ${missing.slice(0, 5).join(', ')}`, '#e2a33c');
                    scope = wanted.filter(w => famMap.has(w));
                    if (!scope.length) throw new Error('None of the form names given match a deployed form');
                    log(`Scope: ${scope.length} form famil${scope.length === 1 ? 'y' : 'ies'}.`, '#9fb6c4');
                } else {
                    log('Scope: every deployed form.', '#9fb6c4');
                }

                let jobs = tab === 'Incomplete' ? await buildIncompleteIndex() : await buildJobIndex(tab);
                if (!jobs.length) throw new Error('No jobs returned for source ' + tab);

                const only = new Set(jobsBox.value.split('\n').map(s => s.trim().toUpperCase()).filter(Boolean));
                if (only.size) {
                    const before = jobs.length;
                    jobs = jobs.filter(j => only.has(String(j.number).toUpperCase()));
                    log(`Restricted to the ${only.size} job number(s) pasted — ${jobs.length} of ${before} matched.`, '#9fb6c4');
                    if (!jobs.length) throw new Error('None of the pasted job numbers are on this tab');
                }
                if (testOnly) {
                    const before = jobs.length;
                    jobs = jobs.filter(j => String(j.site || '').trim().toLowerCase() === TEST_SITE);
                    log(`Test-site guard ON — ${jobs.length} of ${before} jobs are on "Test site".`, '#e2a33c');
                    if (!jobs.length) throw new Error('No Test site jobs in this selection — untick the guard to run for real');
                }

                const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
                downloadText(`jl-deployed-forms-${stamp}.jsonl`, deployed.map(f => JSON.stringify(f)).join('\n') + '\n');

                state = {
                    stamp, tab, dry, testOnly, scope,
                    deployed: deployed.map(f => ({ g: f.form_guid, n: f.form_name, a: f.show_in_assets_list })),
                    jobs, cursor: 0, part: 0,
                    touched: 0, added: 0, removed: 0, changed: 0, failed: 0, errors: []
                };
                saveState(state);
                const mins = Math.round(jobs.length * MIN_INTERVAL / 60000);
                log(`${jobs.length} jobs to check — at least ~${mins} min at the WAF-safe pace, plus two writes per stale rule. Leave this tab open; Stop and reload is safe.`,
                    '#e2a33c');
                if (dry) log('DRY RUN — nothing will be written. The plan downloads as a part file.', '#0fa');
            } else {
                log(`Resuming ${state.stamp}${state.dry ? ' (dry run)' : ''}: ${state.cursor}/${state.jobs.length} already done.`, '#e2a33c');
            }

            // Rebuild the family map from the snapshot stored with the run, so a resumed run
            // keeps aiming at the versions it started with.
            const famMap = new Map();
            for (const f of state.deployed) {
                const fam = familyOf(f.n);
                if (famMap.has(fam)) famMap.get(fam).ambiguous = true;
                else famMap.set(fam, { guid: f.g, name: f.n, assets: f.a });
            }
            const scopeSet = state.scope ? new Set(state.scope) : null;

            let buffer = [];
            let jobsInPart = 0;

            const flush = () => {
                if (!buffer.length) { saveState(state); return; }
                state.part += 1;
                const kind = state.dry ? 'plan' : 'actions';
                const name = `jl-repoint-${kind}-${state.stamp}-part${String(state.part).padStart(3, '0')}.jsonl`;
                downloadText(name, buffer.join('\n') + '\n');
                log(`Wrote ${name} (${buffer.length} lines, ${jobsInPart} jobs)`, '#0fa');
                buffer = []; jobsInPart = 0;
                saveState(state);      // the cursor only advances once the log is on disk
            };

            while (state.cursor < state.jobs.length) {
                if (stopRequested) break;
                const job = state.jobs[state.cursor];

                // Belt and braces: the guard is re-checked per job, not just at planning time.
                if (state.testOnly && String(job.site || '').trim().toLowerCase() !== TEST_SITE) {
                    state.cursor += 1;
                    continue;
                }

                let rules;
                try {
                    rules = await jobForms(job.id);
                } catch (e) {
                    if (e.name === 'SessionError') throw e;
                    state.errors.push({ job: job.number, id: job.id, msg: e.message });
                    log(`${job.number}: ${e.message}`, '#ff6b6b');
                    state.cursor += 1;
                    continue;
                }

                const actions = planFor(rules, famMap, scopeSet);
                if (actions.length) {
                    state.touched += 1;
                    const base = { ts: new Date().toISOString(), job_id: job.id, job_number: job.number, site: job.site };

                    if (state.dry) {
                        for (const a of actions) {
                            buffer.push(JSON.stringify(Object.assign({}, base, {
                                action: a.action, form_name: a.form_name, family: a.family, guid: a.guid,
                                rule_id: a.rule_id || null, show_on_rules: a.show_on_rules,
                                is_required: a.is_required, is_required_on_asset: a.is_required_on_asset,
                                dry: true
                            })));
                        }
                        log(`${job.number}: would ${actions.filter(a => a.action === 'add').length} add / ${actions.filter(a => a.action === 'remove').length} remove`, '#9fb6c4');
                    } else {
                        // Add first, remove second — the probe showed the duplicate check is per
                        // version guid, so both can sit on the job and it is never left bare.
                        const addedFamilies = new Set();
                        for (const a of actions.filter(x => x.action === 'add')) {
                            const res = await addRule(job.id, a.guid, a.show_on_rules, a.is_required);
                            let msg = res.ok ? 'OK' : res.message;
                            let createdId = res.ok && res.created ? res.created.Id : null;
                            if (res.ok && a.is_required_on_asset && res.created) {
                                const ch = await changeRule(job.id, res.created, a.show_on_rules, a.is_required, true);
                                if (ch.ok) state.changed += 1;
                                else msg = 'added, but Required-on-Asset failed: ' + ch.message;
                            }
                            if (res.ok) { state.added += 1; addedFamilies.add(a.family); }
                            else { state.failed += 1; log(`${job.number} ${a.form_name}: add failed — ${msg}`, '#ff6b6b'); }
                            buffer.push(JSON.stringify(Object.assign({}, base, {
                                action: 'add', form_name: a.form_name, family: a.family, guid: a.guid,
                                rule_id: createdId, show_on_rules: a.show_on_rules,
                                is_required: a.is_required, is_required_on_asset: a.is_required_on_asset,
                                ok: res.ok, message: msg
                            })));
                        }
                        for (const a of actions.filter(x => x.action === 'remove')) {
                            // Never strip the old rule when its replacement did not go on.
                            const needed = actions.some(x => x.action === 'add' && x.family === a.family);
                            if (needed && !addedFamilies.has(a.family)) {
                                log(`${job.number} ${a.form_name}: left in place — the new version did not go on`, '#e2a33c');
                                continue;
                            }
                            const res = await removeRule(job.id, a.rule);
                            if (res.ok) state.removed += 1;
                            else { state.failed += 1; log(`${job.number} ${a.form_name}: remove failed — ${res.message}`, '#ff6b6b'); }
                            buffer.push(JSON.stringify(Object.assign({}, base, {
                                action: 'remove', form_name: a.form_name, family: a.family, guid: a.guid,
                                rule_id: a.rule_id, show_on_rules: a.show_on_rules,
                                is_required: a.is_required, is_required_on_asset: a.is_required_on_asset,
                                ok: res.ok, message: res.ok ? 'OK' : res.message
                            })));
                        }
                    }
                }

                state.cursor += 1;
                jobsInPart += 1;
                if (jobsInPart >= FLUSH_EVERY) flush();
                setProgress(`${state.cursor}/${state.jobs.length} jobs · ${state.touched} needing work · ` +
                            (state.dry ? 'dry run' : `${state.added} added, ${state.removed} removed`) +
                            (state.failed ? ` · ${state.failed} failed` : ''));
            }

            flush();

            if (state.cursor >= state.jobs.length) {
                log(state.dry
                    ? `Dry run complete. ${state.touched} of ${state.jobs.length} jobs would change — see the plan file(s) in Downloads.`
                    : `Done. ${state.touched} jobs changed: ${state.added} rules added, ${state.removed} removed, ${state.changed} Required-on-Asset follow-ups.`,
                    '#0fa');
                if (state.failed) log(`${state.failed} call(s) failed — the action log records each one.`, '#e2a33c');
                if (state.errors.length) log(`${state.errors.length} job(s) could not be read.`, '#e2a33c');
                setProgress(`Complete: ${state.part} part file(s) in Downloads.`);
                clearState();
            } else {
                saveState(state);
                setProgress(`Stopped at ${state.cursor}/${state.jobs.length}. Start again to resume.`);
            }
        } catch (e) {
            if (e.name === 'SessionError') log('Session lost — log in to Joblogic again, then Start to resume. ' + e.message, '#ff6b6b');
            else log('Run failed: ' + e.message, '#ff6b6b');
            if (state) saveState(state);
        } finally {
            running = false; stopRequested = false; refresh();
        }
    }

    // --- BOOT ---
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', createUI);
    else createUI();
})();
