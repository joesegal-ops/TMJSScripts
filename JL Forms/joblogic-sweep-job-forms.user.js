// ==UserScript==
// @name         Joblogic - Sweep Job → Forms
// @namespace    http://tampermonkey.net/
// @version      1.1.0
// @description  Record which form VERSION every open job currently holds. Job form-rules store a version-specific FormUniqueGuid, so deploying a new version of a form leaves already-assigned jobs pointing at the old one. This sweep builds the before-picture: one JSONL row per job+form rule, plus a snapshot of the currently-deployed form guids, so a repoint run afterwards knows exactly which jobs to move. Paced under the Azure WAF, resumable, writes part files to Downloads. READ-ONLY — it never changes a job or a form.
// @match        https://go.joblogic.com/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Forms/joblogic-sweep-job-forms.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Forms/joblogic-sweep-job-forms.user.js
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
    const VERSION = '1.1.0';
    const SCRIPT_ID = 'sweep-job-forms';
    const SCRIPT_LABEL = '🧾 Sweep Job → Forms';
    const SCRIPT_COLOR = '#2f5d62';
    const SCRIPT_DESC = 'Read-only. Records which form version every job currently holds, so a later version bump can be repointed precisely. Writes JSONL part files to Downloads. Resumable: Stop and reload, then Start again.';

    // Pacing: see jl-azure-waf-rate-limit. ~2,900 jobs at 1400 ms is a little over an hour.
    const MIN_INTERVAL = 1400;
    const MAX_INTERVAL = 4000;
    const WAF_BACKOFF = [1500, 3000, 6000, 12000, 20000];
    const INDEX_PAGE_SIZE = 2000;   // SearchJsonData honours big pages
    const FORMS_PAGE_SIZE = 50;     // FormsSearch / JobFormsSearch cap
    const FLUSH_EVERY = 300;        // jobs per part file
    const LOG_MAX_LINES = 400;

    const STORE = 'jl-sweep-job-forms-v1';

    // Where the job list comes from. 'Incomplete' is Joblogic's OWN deploy scope — the set the
    // deploy modal counts and the "Select manually" picker lists (CompanyForm/SearchIncompleteJobs,
    // ~3k jobs). The other two are the job-list quick-filter tabs on SearchJsonData, which are a
    // far wider net (Open = 12.6k) and take hours. Start with Incomplete: a form rule outside it
    // belongs to a job nobody is going to attend.
    const SOURCES = [
        { value: 'Incomplete', label: 'Incomplete jobs — Joblogic\u2019s deploy scope (recommended)' },
        { value: 'Open', label: 'Job list: Open tab (12k+, hours)' },
        { value: 'All', label: 'Job list: every job (54k+, very slow)' }
    ];
    const INCOMPLETE_PAGE_SIZE = 50;   // SearchIncompleteJobs ignores anything larger

    function SessionError(msg) { const e = new Error(msg); e.name = 'SessionError'; return e; }

    let running = false;
    let stopRequested = false;

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    async function sleepInterruptible(ms) {
        const step = 250;
        for (let left = ms; left > 0 && !stopRequested; left -= step) await sleep(Math.min(step, left));
    }

    function getCsrf(doc = document) {
        const el = doc.querySelector('input[name="__RequestVerificationToken"]');
        return el ? el.value : '';
    }

    function downloadText(filename, text, mime) {
        const url = URL.createObjectURL(new Blob([text], { type: mime || 'application/x-ndjson' }));
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    }

    // =======================================================================
    // Resume state. Only the plan and the cursor live here — never the rows,
    // which go straight to disk in part files (localStorage would blow its
    // quota long before 2,900 jobs' worth of form rules).
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
            // Ease back toward the floor after a clean stretch.
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
    let panel, progressText, logArea, tabSelect;
    let startBtn, stopBtn, formsBtn, resetBtn;

    function mkBtn(label, color, onClick) {
        const b = document.createElement('button');
        b.textContent = label;
        b.style.cssText = 'background:' + color + ';color:#fff;border:none;border-radius:4px;padding:6px 12px;cursor:pointer;font-family:monospace;font-size:12px;';
        b.addEventListener('click', onClick);
        return b;
    }

    function createUI() {
        if (document.getElementById('jl-sweepforms-panel')) return;

        panel = document.createElement('div');
        panel.id = 'jl-sweepforms-panel';

        const box = document.createElement('div');
        box.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;background:#1a1a2e;color:#eee;border-radius:8px;padding:16px;width:660px;max-height:88vh;display:flex;flex-direction:column;font-family:monospace;font-size:12px;box-shadow:0 4px 20px rgba(0,0,0,0.5);';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;';
        const title = document.createElement('strong');
        title.style.fontSize = '14px';
        title.innerHTML = 'Sweep Job → Forms <span style="font-weight:400;color:#8a8ab5;font-size:11px;">v' + VERSION + ' · read-only</span>';
        const closeBtn = document.createElement('button');
        closeBtn.style.cssText = 'background:none;border:none;color:#eee;font-size:18px;cursor:pointer;';
        closeBtn.textContent = '✕';
        closeBtn.addEventListener('click', () => { panel.style.display = 'none'; });
        header.appendChild(title); header.appendChild(closeBtn);

        const blurb = document.createElement('div');
        blurb.style.cssText = 'color:#9fb6c4;margin-bottom:10px;line-height:1.5;';
        blurb.textContent = 'Job form-rules store a version-specific guid, so deploying a new form version strands every job already holding the old one. This records what each job holds today. Nothing is written to Joblogic.';

        const progressDiv = document.createElement('div');
        progressDiv.style.marginBottom = '10px';
        progressText = document.createElement('span');
        progressText.style.color = '#0fa';
        progressDiv.appendChild(progressText);

        const optsDiv = document.createElement('div');
        optsDiv.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;';
        const tabLabel = document.createElement('label');
        tabLabel.textContent = 'Sweep: ';
        tabSelect = document.createElement('select');
        tabSelect.style.cssText = 'background:#0a0a1a;color:#eee;border:1px solid #444;border-radius:4px;padding:4px;';
        SOURCES.forEach(t => {
            const o = document.createElement('option');
            o.value = t.value; o.textContent = t.label;
            tabSelect.appendChild(o);
        });
        tabLabel.appendChild(tabSelect);
        optsDiv.appendChild(tabLabel);

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;';
        startBtn = mkBtn('Start', '#2f5d62', () => start());
        stopBtn = mkBtn('Stop', '#8c3b3b', () => { stopRequested = true; setProgressNote('stopping…'); });
        formsBtn = mkBtn('Deployed forms only', '#3d4a6b', () => dumpFormIndex());
        resetBtn = mkBtn('Discard saved run', '#555', () => {
            if (!confirm('Discard the saved sweep and start over? Part files already downloaded are kept.')) return;
            clearState(); log('Saved run discarded.', '#e2a33c'); refresh();
        });
        [startBtn, stopBtn, formsBtn, resetBtn].forEach(b => btnRow.appendChild(b));

        logArea = document.createElement('div');
        logArea.style.cssText = 'flex:1;overflow-y:auto;background:#0a0a1a;border-radius:4px;padding:8px;min-height:160px;';

        box.appendChild(header); box.appendChild(blurb); box.appendChild(progressDiv);
        box.appendChild(optsDiv); box.appendChild(btnRow); box.appendChild(logArea);
        panel.appendChild(box);
        document.body.appendChild(panel);

        jlRegisterPanel(panel, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR, SCRIPT_DESC);
        refresh();
    }

    function log(msg, color) {
        if (!logArea) { console.log('[sweep]', msg); return; }
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
        if (!s) setProgress('Ready. Start builds a job index, then reads each job’s forms.');
        else setProgress(`Saved sweep ${s.stamp} (${s.tab}): ${s.cursor}/${s.jobs.length} jobs done, ${s.part} part file(s) written. Start to resume.`);
        startBtn.disabled = running;
        formsBtn.disabled = resetBtn.disabled = running;
        tabSelect.disabled = running || !!s;
        [startBtn, formsBtn, resetBtn].forEach(b => { b.style.opacity = b.disabled ? '0.45' : '1'; });
        startBtn.style.display = running ? 'none' : 'inline-block';
        stopBtn.style.display = running ? 'inline-block' : 'none';
        if (s && !running) startBtn.textContent = `Resume (${s.jobs.length - s.cursor} left)`;
        else if (!running) startBtn.textContent = 'Start';
    }

    // =======================================================================
    // Joblogic calls
    // =======================================================================
    async function postForm(url, fields) {
        const fd = new FormData();
        for (const k in fields) fd.append(k, fields[k]);
        const resp = await jlFetch(url, {
            method: 'POST',
            headers: { 'X-Requested-With': 'XMLHttpRequest', '__RequestVerificationToken': getCsrf() },
            body: fd
        });
        if (!/json/i.test(resp.headers.get('content-type') || '')) {
            throw SessionError('Joblogic returned a page instead of JSON — session expired?');
        }
        return resp.json();
    }

    // Every job on the chosen tab. SearchJsonData honours big pages, so this is ~2 calls
    // for Open and ~28 for All — the sweep's cost is the per-job form lookups, not this.
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
                    '__RequestVerificationToken': getCsrf()
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
                out.push({
                    id: j.Id,
                    number: j.JobNumber || '',
                    status: j.StatusDescription || '',
                    site: j.SiteName || '',
                    siteId: j.SiteId == null ? null : j.SiteId
                });
            }
            if (!jobs.length) break;
            page++;
        }
        return out;
    }

    // Joblogic's own deploy scope: the jobs the deploy modal counts and the "Select manually"
    // picker lists. JSON body, and it CAPS AT 50 PER PAGE however large a PageSize you ask for.
    // Note formUniqueGuid is accepted but IGNORED — it never filters, so this is the whole set.
    async function buildIncompleteIndex() {
        const out = [];
        let page = 1, total = Infinity;
        while (out.length < total) {
            if (stopRequested) throw new Error('Stopped');
            setProgress(`Listing incomplete jobs\u2026 ${out.length}${isFinite(total) ? '/' + total : ''}`);
            const resp = await jlFetch('/CompanyForm/SearchIncompleteJobs', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                    '__RequestVerificationToken': getCsrf()
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
                out.push({
                    id: j.Id,
                    number: j.JobNumber || '',
                    status: j.StatusDescription || '',
                    site: j.SiteName || '',
                    siteId: j.SiteId == null ? null : j.SiteId
                });
            }
            if (!jobs.length) break;
            page++;
        }
        return out;
    }

    // The currently-deployed form versions. FormsSearch returns ONE row per form family —
    // the deployed version — and its FormUniqueGuid is that VERSION's guid, which is what
    // job rules store. Anything a job holds that is not in this set is already stale.
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
                form_id: f.FormId == null ? null : f.FormId,
                form_type: f.FormType == null ? null : String(f.FormType),
                show_on_rules: f.ShowOnRules == null ? '' : String(f.ShowOnRules),
                is_required: !!f.IsRequired,
                is_required_on_asset: !!f.IsRequiredOnAsset,
                show_in_forms_list: f.ShowInFormsList !== false,
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

    // =======================================================================
    // Output
    // =======================================================================
    // One line per job+rule. A job with no forms still gets a line (form_guid null) so the
    // loader can tell "swept, holds nothing" from "never swept".
    function rowsFor(job, rules, deployedSet) {
        if (!rules.length) {
            return [JSON.stringify({
                job_id: job.id, job_number: job.number, job_status: job.status,
                site_name: job.site, site_id: job.siteId,
                rule_id: null, default_company_form_id: null,
                form_guid: null, form_name: null,
                show_on_rules: null, is_required: null, is_required_on_asset: null,
                is_deployed_version: null
            })];
        }
        return rules.map(f => JSON.stringify({
            job_id: job.id, job_number: job.number, job_status: job.status,
            site_name: job.site, site_id: job.siteId,
            rule_id: f.Id == null ? null : String(f.Id),
            default_company_form_id: f.DefaultCompanyFormId == null ? null : String(f.DefaultCompanyFormId),
            form_guid: f.FormUniqueGuid || null,
            form_name: f.FormName || null,
            show_on_rules: f.ShowOnRules == null ? '' : String(f.ShowOnRules),
            is_required: !!f.IsRequired,
            is_required_on_asset: !!f.IsRequiredOnAsset,
            is_deployed_version: f.FormUniqueGuid ? deployedSet.has(f.FormUniqueGuid) : null
        }));
    }

    async function dumpFormIndex() {
        if (running) return;
        running = true; stopRequested = false; refresh();
        try {
            setProgress('Reading deployed forms…');
            const forms = await fetchDeployedForms();
            const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
            downloadText(`jl-deployed-forms-${stamp}.jsonl`, forms.map(f => JSON.stringify(f)).join('\n') + '\n');
            log(`Deployed forms: ${forms.length} → jl-deployed-forms-${stamp}.jsonl`, '#0fa');
            setProgress(`${forms.length} deployed forms written.`);
        } catch (e) {
            log('Failed: ' + e.message, '#ff6b6b');
        } finally {
            running = false; stopRequested = false; refresh();
        }
    }

    // =======================================================================
    // The sweep
    // =======================================================================
    async function start() {
        if (running) return;
        running = true; stopRequested = false; refresh();

        let state = loadState();
        try {
            if (!state) {
                const tab = tabSelect.value;
                setProgress('Reading deployed forms…');
                const deployed = await fetchDeployedForms();
                const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
                downloadText(`jl-deployed-forms-${stamp}.jsonl`, deployed.map(f => JSON.stringify(f)).join('\n') + '\n');
                log(`${deployed.length} deployed form versions snapshotted.`, '#0fa');

                const jobs = tab === 'Incomplete' ? await buildIncompleteIndex() : await buildJobIndex(tab);
                if (!jobs.length) throw new Error('No jobs returned for source ' + tab);
                state = {
                    stamp, tab,
                    deployed: deployed.map(f => f.form_guid),
                    jobs: jobs,
                    cursor: 0, part: 0, rules: 0, blank: 0, stale: 0, errors: []
                };
                saveState(state);
                const mins = Math.round(jobs.length * MIN_INTERVAL / 60000);
                log(`${jobs.length} jobs to sweep — roughly ${mins} min at the WAF-safe pace. Leave this tab open; Stop and reload is safe.`, '#e2a33c');
            } else {
                log(`Resuming ${state.stamp}: ${state.cursor}/${state.jobs.length} already done.`, '#e2a33c');
            }

            const deployedSet = new Set(state.deployed);
            let buffer = [];
            let sweptInPart = 0;

            const flush = () => {
                if (!buffer.length) return;
                state.part += 1;
                const name = `jl-job-forms-${state.stamp}-part${String(state.part).padStart(3, '0')}.jsonl`;
                downloadText(name, buffer.join('\n') + '\n');
                log(`Wrote ${name} (${buffer.length} rows, ${sweptInPart} jobs)`, '#0fa');
                buffer = []; sweptInPart = 0;
                saveState(state);          // cursor only advances once the rows are on disk
            };

            while (state.cursor < state.jobs.length) {
                if (stopRequested) break;
                const job = state.jobs[state.cursor];
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
                const lines = rowsFor(job, rules, deployedSet);
                buffer.push(...lines);
                if (!rules.length) state.blank += 1;
                state.rules += rules.length;
                state.stale += rules.filter(f => f.FormUniqueGuid && !deployedSet.has(f.FormUniqueGuid)).length;
                state.cursor += 1;
                sweptInPart += 1;

                if (sweptInPart >= FLUSH_EVERY) flush();
                setProgress(`${state.cursor}/${state.jobs.length} jobs · ${state.rules} form rules · ${state.stale} already on an undeployed version`);
            }

            flush();

            if (state.cursor >= state.jobs.length) {
                log(`Done. ${state.jobs.length} jobs, ${state.rules} form rules, ${state.blank} jobs with no forms, ${state.stale} rules already pointing at an undeployed version.`, '#0fa');
                if (state.errors.length) log(`${state.errors.length} job(s) errored — see the list above.`, '#e2a33c');
                setProgress(`Sweep complete: ${state.part} part file(s) in Downloads.`);
                clearState();
            } else {
                saveState(state);
                setProgress(`Stopped at ${state.cursor}/${state.jobs.length}. Start again to resume.`);
            }
        } catch (e) {
            if (e.name === 'SessionError') log('Session lost — log in to Joblogic again, then Start to resume. ' + e.message, '#ff6b6b');
            else log('Sweep failed: ' + e.message, '#ff6b6b');
            if (state) saveState(state);
        } finally {
            running = false; stopRequested = false; refresh();
        }
    }

    // --- BOOT ---
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', createUI);
    else createUI();
})();
