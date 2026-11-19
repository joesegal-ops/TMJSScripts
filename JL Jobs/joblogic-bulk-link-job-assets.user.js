// ==UserScript==
// @name         Joblogic - Bulk Link Assets to Jobs
// @namespace    https://go.joblogic.com/
// @version      1.00
// @description  Paste rows of "JL Job Id | JL Asset Id" (e.g. the Job matches tab of an asset-matching Google Sheet) and add each asset to its job, the same way the job's Assets tab does (move across, Save). Site guard, confidence filter, preview first, verifies each save, downloads a log CSV. Remove mode takes the same rows off again.
// @match        https://go.joblogic.com/Job*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/joblogic-bulk-link-job-assets.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/joblogic-bulk-link-job-assets.user.js
// ==/UserScript==

/*
 * How it works (mirrors /bundles/js/jobAssetVm.js, captured and tested on a Test site job 2026-11-19):
 *  - GET  /api/Job/GetAssetsForJob?jobId=..   -> AdditionalData {SiteId, JobId, LastUsedServiceOrder, EditJobAssetAllowed}
 *  - POST /api/Asset/GetJobAssetsPaging (jobId, loadAllRemain=true) -> assets already on the job
 *  - POST /api/Asset/GetSiteAssetsPaging?siteId=..  (loadAllRemain=true) -> every asset on the site, loaded once per site
 *  - Add:    clone the site asset, IsNew=true, IsJobAsset=true, SiteAssetId=Id
 *    Remove: the job's asset entry with IsDeleted=true
 *  - POST /api/Asset/SaveAssets, FormData "dataFile" = JSON blob {JobId, SiteId, Assets:[changed only], LastUsedServiceOrder}
 *  Only the asset in the row is sent, so other assets already on the job are left alone. Each save is re-read to confirm.
 */
(function () {
    'use strict';
    if (window.top !== window.self) return;

    'use strict';
    if (window.top !== window.self) return;

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

    const SCRIPT_ID = 'bulk-link-job-assets';
    const SCRIPT_LABEL = '🔗 Link Assets to Jobs';
    const SCRIPT_VERSION = (() => { try { return GM_info.script.version; } catch (e) { return '?'; } })();
    const SCRIPT_COLOR = '#5f3dc4';
    const PACE_MS = 1400;                              // gap between jobs (Azure WAF limit)
    const JOB_H = ['jl job id', 'job id'];
    const ASSET_H = ['jl asset id', 'asset id'];
    const NUM_H = ['job number'];
    const CONF_H = ['confidence'];
    const DESC_H = ['asset description'];

    // ------------------------------------------------------------------ UI
    const css = `
      #jlla{position:fixed;right:260px;top:80px;width:780px;max-height:80vh;overflow:auto;z-index:99999;background:#fff;border:1px solid #ccc;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.3);font:13px Arial;padding:14px;display:none}
      #jlla h3{margin:0 0 8px;font-size:15px} #jlla textarea{width:100%;height:150px;font:12px monospace}
      #jlla .row{display:flex;gap:10px;align-items:center;margin:8px 0;flex-wrap:wrap}
      #jlla button{padding:6px 10px;border:1px solid #888;border-radius:4px;background:#f5f5f5;cursor:pointer}
      #jlla button.primary{background:#1f3864;color:#fff;border-color:#1f3864}
      #jlla table{border-collapse:collapse;width:100%;font-size:12px} #jlla td,#jlla th{border:1px solid #ddd;padding:3px 5px;text-align:left;vertical-align:top}
      #jlla .ok{color:#0a7a2f} #jlla .err{color:#c00} #jlla .muted{color:#777}
`;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const box = document.createElement('div'); box.id = 'jlla';
    box.innerHTML = `
      <h3>Link assets to jobs <span class="muted" style="font-weight:normal;font-size:12px">v${SCRIPT_VERSION}</span></h3>
      <div class="muted">Paste rows with a header line. Needed columns: <b>JL Job Id</b> and <b>JL Asset Id</b>.
      Optional: <b>Job Number</b>, <b>Asset description</b>, <b>Confidence</b> (used by the filter below). Copying the whole "Job matches" tab works;
      rows with no asset id are skipped.</div>
      <textarea id="jlla-in" placeholder="Job Number\tJL Job Id\tJL Asset Id\tConfidence"></textarea>
      <div class="row">Only allow jobs on site ID: <input id="jlla-site" size="10" placeholder="e.g. 16957546">
        Confidence: <label><input type="checkbox" class="jlla-conf" value="high" checked> High</label>
        <label><input type="checkbox" class="jlla-conf" value="medium"> Medium</label>
        <label><input type="checkbox" class="jlla-conf" value="low"> Low</label></div>
      <div class="row">Mode: <label><input type="radio" name="jlla-mode" value="add" checked> Add asset to job</label>
        <label><input type="radio" name="jlla-mode" value="remove"> Remove asset from job (undo)</label></div>
      <div class="row"><button id="jlla-preview">1. Preview</button><button id="jlla-run" class="primary" disabled>2. Apply</button>
        <button id="jlla-stop" disabled>Stop</button><button id="jlla-csv" disabled>Download log CSV</button>
        <span id="jlla-status" class="muted"></span></div>
      <div id="jlla-out"></div>`;
    document.body.appendChild(box);
    jlRegisterPanel(box, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR,
        'Paste JL Job Id + JL Asset Id rows (e.g. the Job matches tab), set the site ID and confidence, Preview, then Apply. Remove mode undoes a run.');
    const $ = id => document.getElementById(id);
    const status = t => { $('jlla-status').textContent = t; };
    const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const mode = () => document.querySelector('input[name="jlla-mode"]:checked').value;

    // ------------------------------------------------------------------ parse
    function parse(text) {
        const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim());
        if (lines.length < 2) throw new Error('Paste a header row plus at least one data row.');
        const delim = lines[0].includes('\t') ? '\t' : ',';
        const split = l => delim === '\t' ? l.split('\t') : l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map(c => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'));
        const head = split(lines[0]).map(h => h.trim().toLowerCase());
        const find = names => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; };
        const jc = find(JOB_H), ac = find(ASSET_H), nc = find(NUM_H), cc = find(CONF_H), dc = find(DESC_H);
        if (jc < 0 || ac < 0) throw new Error('Header row needs "JL Job Id" and "JL Asset Id" columns.');
        const confs = [...document.querySelectorAll('.jlla-conf:checked')].map(x => x.value);
        const items = [], seen = new Set(); let noAsset = 0, filtered = 0;
        for (const l of lines.slice(1)) {
            const c = split(l).map(x => (x || '').trim());
            const job = c[jc], asset = c[ac];
            if (!/^\d+$/.test(job || '')) continue;
            if (!/^\d+$/.test(asset || '')) { noAsset++; continue; }
            if (cc >= 0 && mode() === 'add' && !confs.includes((c[cc] || '').toLowerCase())) { filtered++; continue; }   // remove (undo) takes every row
            const k = job + ':' + asset;
            if (seen.has(k)) continue;
            seen.add(k);
            items.push({ job, asset, num: nc >= 0 ? c[nc] : '', desc: dc >= 0 ? c[dc] : '', conf: cc >= 0 ? c[cc] : '' });
        }
        return { items, noAsset, filtered };
    }

    // ------------------------------------------------------------------ Joblogic calls
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    function token() {
        const el = document.querySelector('input[name="__RequestVerificationToken"]');
        if (!el) throw new Error('no __RequestVerificationToken on this page - reload it');
        return el.value;
    }
    const HDR = () => ({ 'Accept': 'application/json', '__RequestVerificationToken': token(), 'X-Requested-With': 'XMLHttpRequest' });
    async function getJson(url, init) {
        let r = await fetch(url, Object.assign({ credentials: 'same-origin', headers: HDR() }, init || {}));
        if (r.status === 400 || r.status === 403) { await sleep(2500); r = await fetch(url, Object.assign({ credentials: 'same-origin', headers: HDR() }, init || {})); }
        const text = await r.text();
        if (!r.ok) throw new Error(`${url.split('?')[0]} returned ${r.status}` + (text.trim() ? ': ' + text.slice(0, 150) : ' (empty: reload the page and sign in again)'));
        try { return JSON.parse(text); } catch (e) { throw new Error(`${url.split('?')[0]} did not return JSON (signed out?)`); }
    }
    async function jobAssets(jobId) {
        const j = await getJson(`/api/Job/GetAssetsForJob?jobId=${jobId}&isReadOnly=False`);
        const m = j && j.AdditionalData;
        if (!m || String(m.JobId) !== String(jobId)) throw new Error('job not found');
        // the assets already on the job come from a separate paging call (GetAssetsForJob leaves Assets empty)
        const fd = new FormData();
        Object.entries({ jobId, page: 1, pageSize: 50, searchTerm: '', orderBy: 1, loadAllRemain: true }).forEach(([k, v]) => fd.append(k, v));
        const ja = await getJson('/api/Asset/GetJobAssetsPaging', { method: 'POST', body: fd });
        m.Assets = (ja && ja.AdditionalData) || [];
        return m;
    }
    const siteCache = {};
    async function siteAssets(siteId, jobId) {
        if (siteCache[siteId]) return siteCache[siteId];
        const fd = new FormData();
        Object.entries({ jobId, page: 1, pageSize: 50, searchTerm: '', orderBy: 1, loadAllRemain: true }).forEach(([k, v]) => fd.append(k, v));
        const j = await getJson(`/api/Asset/GetSiteAssetsPaging?siteId=${siteId}`, { method: 'POST', body: fd });
        const list = (j && j.AdditionalData) || [];
        siteCache[siteId] = new Map(list.map(a => [String(a.Id), a]));
        return siteCache[siteId];
    }
    const onJob = (m, assetId) => (m.Assets || []).find(a => String(a.Id) === String(assetId) && !a.IsDeleted);
    async function save(m, assetObj) {
        const payload = { JobId: m.JobId, SiteId: m.SiteId, Assets: [assetObj], LastUsedServiceOrder: m.LastUsedServiceOrder == null ? null : m.LastUsedServiceOrder };
        const fd = new FormData();
        fd.append('dataFile', new Blob([JSON.stringify(payload)], { type: 'application/json' }), 'dataFileBlob');
        const j = await getJson('/api/Asset/SaveAssets', { method: 'POST', body: fd });
        if (!j || j.success === false) throw new Error('Joblogic refused the save: ' + ((j && (j.Message || JSON.stringify(j.errors))) || 'no reason given'));
    }

    // ------------------------------------------------------------------ one row
    async function processRow(it, apply, siteGuard) {
        const rec = Object.assign({}, it);
        const m = await jobAssets(it.job);
        rec.site = String(m.SiteId);
        if (siteGuard && rec.site !== siteGuard) { rec.result = 'refused'; rec.error = `job is on site ${rec.site}, not ${siteGuard}`; return rec; }
        if (m.EditJobAssetAllowed === false) { rec.result = 'refused'; rec.error = 'Joblogic does not allow editing assets on this job'; return rec; }
        const existing = onJob(m, it.asset);
        if (mode() === 'add') {
            if (existing) { rec.result = 'already linked'; return rec; }
            const sa = (await siteAssets(m.SiteId, it.job)).get(String(it.asset));
            if (!sa) { rec.result = 'error'; rec.error = `asset ${it.asset} is not on the job's site`; return rec; }
            rec.assetName = sa.Description;
            if (!apply) { rec.result = 'would add'; return rec; }
            const o = JSON.parse(JSON.stringify(sa));
            Object.assign(o, { IsNew: true, IsJobAsset: true, IsHighlighted: false, IsDeleted: false, Edited: false, SiteAssetId: sa.Id });
            await save(m, o);
        } else {
            if (!existing) { rec.result = 'not on job'; return rec; }
            rec.assetName = existing.Description;
            if (!apply) { rec.result = 'would remove'; return rec; }
            const o = JSON.parse(JSON.stringify(existing));
            o.IsDeleted = true;
            await save(m, o);
        }
        await sleep(400);
        const after = onJob(await jobAssets(it.job), it.asset);
        const okNow = mode() === 'add' ? !!after : !after;
        rec.result = okNow ? (mode() === 'add' ? 'added' : 'removed') : 'CHECK';
        if (!okNow) rec.error = 'saved, but the job does not show the change - check it by hand';
        return rec;
    }

    // ------------------------------------------------------------------ run
    let items = [], log = [], stopFlag = false;
    function render() {
        const good = /added|removed|already|would|not on job/;
        const rows = log.map(r => `<tr><td>${esc(r.num || r.job)}</td><td>${esc(r.asset)}</td><td>${esc(r.assetName || r.desc)}</td><td>${esc(r.conf)}</td>
            <td class="${good.test(r.result) ? 'ok' : 'err'}">${esc(r.result)}${r.error ? ': ' + esc(r.error) : ''}</td></tr>`).join('');
        const counts = log.reduce((m, r) => (m[r.result] = (m[r.result] || 0) + 1, m), {});
        $('jlla-out').innerHTML = `<div class="muted">${Object.entries(counts).map(([k, v]) => `${esc(k)}: ${v}`).join(' &nbsp; ')}</div>
          <table><tr><th>Job</th><th>Asset Id</th><th>Asset</th><th>Confidence</th><th>Result</th></tr>${rows}</table>`;
    }
    async function run(apply) {
        const siteGuard = $('jlla-site').value.trim();
        if (apply && !/^\d+$/.test(siteGuard)) { alert('Enter the site ID the jobs belong to before applying (8 Devonshire Square = 16957546).'); return; }
        stopFlag = false; log = [];
        ['jlla-preview', 'jlla-run'].forEach(b => $(b).disabled = true); $('jlla-stop').disabled = false;
        for (let i = 0; i < items.length && !stopFlag; i++) {
            status(`${apply ? 'Saving' : 'Checking'} ${i + 1} / ${items.length}...`);
            let rec;
            try { rec = await processRow(items[i], apply, siteGuard); }
            catch (e) { rec = Object.assign({}, items[i], { result: 'error', error: e.message }); }
            log.push(rec); render();
            await sleep(PACE_MS);
        }
        status(stopFlag ? 'Stopped.' : (apply ? 'Done. Download the log CSV to keep a record.' : 'Preview done. Check the list, then Apply.'));
        $('jlla-preview').disabled = false; $('jlla-run').disabled = apply; $('jlla-stop').disabled = true; $('jlla-csv').disabled = !log.length;
    }
    const pending = () => log.filter(r => /^would /.test(r.result));
    $('jlla-preview').onclick = () => {
        try { const p = parse($('jlla-in').value); items = p.items; status(`${items.length} job/asset pairs to check; ${p.noAsset} rows with no asset id and ${p.filtered} outside the confidence filter skipped.`); }
        catch (e) { alert(e.message); return; }
        if (!items.length) return;
        run(false).then(() => { $('jlla-run').disabled = !pending().length; });
    };
    $('jlla-run').onclick = () => {
        const n = pending().length;
        if (!confirm(`${mode() === 'add' ? 'Add' : 'Remove'} ${n} asset links in Joblogic? Only the asset in each row is changed on its job.`)) return;
        const keep = new Set(pending().map(r => r.job + ':' + r.asset));
        items = items.filter(it => keep.has(it.job + ':' + it.asset));
        run(true);
    };
    $('jlla-stop').onclick = () => { stopFlag = true; status('Stopping after this job...'); };
    $('jlla-csv').onclick = () => {
        const q = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
        // same JL Job Id / JL Asset Id headers, so the file can be pasted back in with Remove mode to undo
        const lines = [['Job Number', 'JL Job Id', 'JL Asset Id', 'Asset description', 'Confidence', 'Mode', 'Result', 'Error'].map(q).join(',')];
        for (const r of log) lines.push([r.num, r.job, r.asset, r.assetName || r.desc, r.conf, mode(), r.result, r.error].map(q).join(','));
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
        a.download = `job-asset-link-log-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`;
        a.click();
    };
})();
