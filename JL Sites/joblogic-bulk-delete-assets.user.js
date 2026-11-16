// ==UserScript==
// @name         Joblogic - Bulk Delete Assets
// @namespace    https://go.joblogic.com/
// @version      1.00
// @description  Paste a column of JL Asset Ids (e.g. from a Google Sheet) and delete those assets through Joblogic's own Delete Asset dialog. Site guard, asset-number suffix guard (default -LGT / -ELE), refuses assets with job history, preview first, typed confirmation, verifies each delete, downloads a CSV of what was deleted.
// @match        https://go.joblogic.com/Asset*
// @match        https://go.joblogic.com/Site/Detail*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Sites/joblogic-bulk-delete-assets.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Sites/joblogic-bulk-delete-assets.user.js
// ==/UserScript==

/*
 * How it works: for each asset the script reads /Asset/Detail/<id> (site, number, description, the asset's
 * GUID and a fresh security token) and its job history (POST /Asset/GetJobHistory/<guid>, the Jobs tab).
 * Preview refuses anything on another site, anything whose number doesn't end with one of the allowed
 * suffixes, and anything with jobs. Apply posts the same form the "Delete Asset" dialog posts
 * (POST /api/Asset/Delete, Id = GUID), then re-reads the asset page to confirm it is gone.
 * Joblogic deletes are permanent: the log CSV is the only record of what was removed.
 * If the first delete can't be confirmed the run stops, so a wrong guess about the endpoint costs one asset at most.
 */
(function () {
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

    const SCRIPT_ID = 'bulk-delete-assets';
    const SCRIPT_LABEL = '🗑️ Bulk Delete Assets';
    // Read from the @version header (TamperMonkey exposes GM_info even with @grant none)
    const SCRIPT_VERSION = (() => { try { return GM_info.script.version; } catch (e) { return '?'; } })();
    const SCRIPT_COLOR = '#a61e4d';

    const PACE_MS = 1400;                              // gap between assets (Azure WAF limit)
    const ID_H = ['jl asset id', 'asset id', 'id', 'jl id'];

    // ------------------------------------------------------------------ UI
    const css = `
      #jlbd{position:fixed;right:260px;top:80px;width:760px;max-height:80vh;overflow:auto;z-index:99999;background:#fff;border:1px solid #ccc;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.3);font:13px Arial;padding:14px;display:none}
      #jlbd h3{margin:0 0 8px;font-size:15px} #jlbd textarea{width:100%;height:150px;font:12px monospace}
      #jlbd .row{display:flex;gap:8px;align-items:center;margin:8px 0;flex-wrap:wrap}
      #jlbd button{padding:6px 10px;border:1px solid #888;border-radius:4px;background:#f5f5f5;cursor:pointer}
      #jlbd button.danger{background:#a61e4d;color:#fff;border-color:#a61e4d}
      #jlbd table{border-collapse:collapse;width:100%;font-size:12px} #jlbd td,#jlbd th{border:1px solid #ddd;padding:3px 5px;text-align:left;vertical-align:top}
      #jlbd .ok{color:#0a7a2f} #jlbd .err{color:#c00} #jlbd .muted{color:#777}
`;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const box = document.createElement('div'); box.id = 'jlbd';
    box.innerHTML = `
      <h3>Bulk delete assets <span class="muted" style="font-weight:normal;font-size:12px">v${SCRIPT_VERSION}</span></h3>
      <div class="muted">Paste rows with a header line containing <b>JL Asset Id</b> (other columns are ignored), or just a list of Ids.
      <b>Deleting is permanent.</b> Preview first; download the log CSV afterwards as the record of what was removed.</div>
      <textarea id="jlbd-in" placeholder="JL Asset Id&#10;13615485&#10;13615486"></textarea>
      <div class="row">Only allow assets on site ID: <input id="jlbd-site" size="10" placeholder="e.g. 16957546">
        Asset number must end with: <input id="jlbd-suffix" size="14" value="-LGT,-ELE" title="Comma-separated. Leave blank to allow any number.">
        <label><input type="checkbox" id="jlbd-nojobs" checked> refuse assets with jobs</label></div>
      <div class="row"><button id="jlbd-preview">1. Preview</button><button id="jlbd-run" class="danger" disabled>2. Delete</button>
        <button id="jlbd-stop" disabled>Stop</button><button id="jlbd-csv" disabled>Download log CSV</button>
        <span id="jlbd-status" class="muted"></span></div>
      <div id="jlbd-out"></div>`;
    document.body.appendChild(box);
    jlRegisterPanel(box, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR,
        'Paste JL Asset Ids, set the site ID, Preview, then Delete. Deletes are permanent: download the log CSV afterwards.');
    const $ = id => document.getElementById(id);
    const status = t => { $('jlbd-status').textContent = t; };
    const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // ------------------------------------------------------------------ parse
    function parse(text) {
        const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim());
        if (!lines.length) throw new Error('Paste some JL Asset Ids.');
        const delim = lines[0].includes('\t') ? '\t' : ',';
        const head = lines[0].split(delim).map(h => h.replace(/"/g, '').trim().toLowerCase());
        let ic = -1; for (const n of ID_H) { ic = head.indexOf(n); if (ic >= 0) break; }
        const body = ic >= 0 ? lines.slice(1) : lines;
        if (ic < 0) ic = 0;
        const ids = [];
        for (const l of body) { const id = (l.split(delim)[ic] || '').replace(/"/g, '').trim(); if (/^\d+$/.test(id) && !ids.includes(id)) ids.push(id); }
        return ids;
    }

    // ------------------------------------------------------------------ Joblogic
    function editModel(html) {
        const i = html.indexOf('"Title":"Edit Asset"');
        if (i < 0) return null;
        let d = 0, start = -1;
        for (let p = i; p >= 0; p--) { const c = html[p]; if (c === '}') d++; else if (c === '{') { if (d === 0) { start = p; break; } d--; } }
        let e = 0, end = -1;
        for (let p = start; p < html.length; p++) {
            const c = html[p];
            if (c === '"') { p++; while (html[p] !== '"') { if (html[p] === '\\') p++; p++; } continue; }
            if (c === '{') e++; else if (c === '}') { e--; if (e === 0) { end = p; break; } }
        }
        return JSON.parse(html.slice(start, end + 1));
    }
    // null = the asset no longer exists
    async function loadAsset(id) {
        const r = await fetch(`/Asset/Detail/${id}`, { credentials: 'same-origin' });
        if (r.status === 404) return null;
        if (!r.ok) throw new Error(`asset page returned ${r.status}`);
        if (/\/Account\/|\/login/i.test(r.url)) throw new Error('signed out of Joblogic - reload the page and sign in');
        const html = await r.text();
        const m = editModel(html);
        if (!m) return null;
        if (String(m.Id) !== String(id)) throw new Error(`page model is for asset ${m.Id}, not ${id}`);
        const t = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
        return { id: String(m.Id), uid: m.UniqueId, site: String(m.SiteId || ''), siteName: m.SiteName || '',
                 Number: m.Number || '', Description: m.Description || '', Location: m.Location || '',
                 Class: m.ClassDescription || '', QRCode: m.QRCode || '',
                 hire: !!(m.IsHireAsset || m.HireAssetId), token: t ? t[1] : '' };
    }
    async function jobCount(a) {
        const r = await fetch(`/Asset/GetJobHistory/${a.uid}`, { method: 'POST', credentials: 'same-origin',
            headers: { 'X-Requested-With': 'XMLHttpRequest', '__RequestVerificationToken': a.token } });
        if (!r.ok) throw new Error(`job history returned ${r.status}`);
        const t = await r.text();
        const i = t.indexOf('initJobHistory');
        if (i < 0) throw new Error('could not read the job history');
        const j = t.indexOf('"Items":[', i);
        if (j < 0) throw new Error('could not read the job history');
        // count JobNumber entries inside the Items array
        let d = 0, end = -1;
        for (let p = j + 8; p < t.length; p++) { const c = t[p]; if (c === '"') { p++; while (t[p] !== '"') { if (t[p] === '\\') p++; p++; } continue; } if (c === '[') d++; else if (c === ']') { d--; if (d === 0) { end = p; break; } } }
        const items = JSON.parse(t.slice(j + 8, end + 1));
        return items.map(x => x.JobNumber).filter(Boolean);
    }

    // ------------------------------------------------------------------ one asset
    async function processAsset(id, apply, opt) {
        const a = await loadAsset(id);
        if (!a) return { id, result: 'not found', error: 'asset does not exist (already deleted?)' };
        const rec = { id, before: a };
        if (opt.site && a.site !== opt.site) return { ...rec, result: 'refused', error: `asset is on site ${a.site} (${a.siteName}), not ${opt.site}` };
        if (a.hire) return { ...rec, result: 'refused', error: 'hire asset - delete by hand' };
        if (opt.suffixes.length && !opt.suffixes.some(s => a.Number.toUpperCase().endsWith(s))) return { ...rec, result: 'refused', error: `number "${a.Number}" doesn't end with ${opt.suffixes.join(' / ')}` };
        const jobs = await jobCount(a);
        rec.jobs = jobs;
        if (jobs.length && opt.noJobs) return { ...rec, result: 'refused', error: `has ${jobs.length} job(s): ${jobs.slice(0, 3).join(', ')}${jobs.length > 3 ? '...' : ''}` };
        if (!apply) return { ...rec, result: 'would delete' };

        const body = new URLSearchParams({ Id: a.uid, __RequestVerificationToken: a.token });
        const r = await fetch('/api/Asset/Delete', { method: 'POST', credentials: 'same-origin', body,
            headers: { 'Accept': 'application/json, text/javascript, */*', 'X-Requested-With': 'XMLHttpRequest', '__RequestVerificationToken': a.token } });
        const text = await r.text();
        rec.deleteStatus = r.status;
        if (!r.ok) return { ...rec, result: 'error', error: `delete returned ${r.status}: ` + (text.trim() ? text.slice(0, 200) : '(empty response)') };
        try { const j = JSON.parse(text); if (j && (j.success === false || j.Success === false)) return { ...rec, result: 'error', error: 'Joblogic refused: ' + (j.Message || j.message || JSON.stringify(j).slice(0, 200)) }; } catch (e) { /* not JSON */ }
        await sleep(500);
        const after = await loadAsset(id);
        if (after) return { ...rec, result: 'CHECK', error: 'delete returned OK but the asset is still there' };
        return { ...rec, result: 'deleted' };
    }

    // ------------------------------------------------------------------ run
    let ids = [], log = [], stopFlag = false;
    function render() {
        const rows = log.map(r => `<tr><td>${esc(r.id)}</td><td>${esc(r.before && r.before.Number)}</td><td>${esc(r.before && r.before.Description)}</td>
            <td>${esc(r.before && r.before.Location)}</td>
            <td class="${/deleted|would/.test(r.result) ? 'ok' : 'err'}">${esc(r.result)}${r.error ? ': ' + esc(r.error) : ''}</td></tr>`).join('');
        const counts = log.reduce((m, r) => (m[r.result] = (m[r.result] || 0) + 1, m), {});
        $('jlbd-out').innerHTML = `<div class="muted">${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(' &nbsp; ')}</div>
          <table><tr><th>Id</th><th>Number</th><th>Description</th><th>Location</th><th>Result</th></tr>${rows}</table>`;
    }
    async function run(apply) {
        const opt = { site: $('jlbd-site').value.trim(), noJobs: $('jlbd-nojobs').checked,
            suffixes: $('jlbd-suffix').value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) };
        if (!/^\d+$/.test(opt.site)) { alert('Enter the site ID the assets belong to (8 Devonshire Square = 16957546).'); return; }
        stopFlag = false; log = [];
        ['jlbd-preview', 'jlbd-run'].forEach(b => $(b).disabled = true); $('jlbd-stop').disabled = false;
        let errorsInRow = 0, confirmedOne = false;
        for (let i = 0; i < ids.length && !stopFlag; i++) {
            status(`${apply ? 'Deleting' : 'Checking'} ${i + 1} / ${ids.length}...`);
            let rec;
            try { rec = await processAsset(ids[i], apply, opt); }
            catch (e) { rec = { id: ids[i], result: 'error', error: e.message }; }
            log.push(rec); render();
            if (apply) {
                if (rec.result === 'deleted') { confirmedOne = true; errorsInRow = 0; }
                else if (rec.result === 'error' || rec.result === 'CHECK') {
                    errorsInRow++;
                    if (!confirmedOne) { status('Stopped: the first delete could not be confirmed. Nothing else was touched.'); stopFlag = true; break; }
                    if (errorsInRow >= 3) { status('Stopped after 3 failures in a row.'); stopFlag = true; break; }
                }
            }
            await sleep(PACE_MS);
        }
        if (!/^Stopped/.test($('jlbd-status').textContent)) status(stopFlag ? 'Stopped.' : (apply ? 'Done. Download the log CSV as the record of what was deleted.' : 'Preview done. Check the list, then Delete.'));
        $('jlbd-preview').disabled = false; $('jlbd-run').disabled = true; $('jlbd-stop').disabled = true; $('jlbd-csv').disabled = !log.length;
    }
    $('jlbd-preview').onclick = () => {
        try { ids = parse($('jlbd-in').value); } catch (e) { alert(e.message); return; }
        status(`${ids.length} assets to check.`);
        if (!ids.length) return;
        run(false).then(() => { $('jlbd-run').disabled = !log.some(r => r.result === 'would delete'); });
    };
    $('jlbd-run').onclick = () => {
        const n = log.filter(r => r.result === 'would delete').length;
        const typed = prompt(`Permanently delete ${n} assets from Joblogic? This can't be undone.\n\nType DELETE ${n} to confirm.`);
        if (typed == null || typed.trim().toUpperCase() !== `DELETE ${n}`) { status('Not confirmed - nothing deleted.'); return; }
        ids = ids.filter(id => log.some(r => r.id === id && r.result === 'would delete'));
        run(true);
    };
    $('jlbd-stop').onclick = () => { stopFlag = true; status('Stopping after this asset...'); };
    $('jlbd-csv').onclick = () => {
        const q = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
        const lines = [['JL Asset Id', 'Asset GUID', 'Number', 'QR Code', 'Description', 'Location', 'Class', 'Site Id', 'Jobs', 'Result', 'Error'].map(q).join(',')];
        for (const r of log) { const b = r.before || {}; lines.push([r.id, b.uid, b.Number, b.QRCode, b.Description, b.Location, b.Class, b.site, (r.jobs || []).join(' '), r.result, r.error].map(q).join(',')); }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
        a.download = `asset-delete-log-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`;
        a.click();
    };
})();
