// ==UserScript==
// @name         Joblogic - Bulk Update Assets
// @namespace    https://go.joblogic.com/
// @version      1.01
// @description  Paste rows of "JL Asset Id | Proposed description | Proposed location" (e.g. copied from a Google Sheet) and update each asset's Description / Location through Joblogic's own asset edit screen. Site guard, preview first, verifies each save, downloads a before/after CSV you can paste back in to undo. v1.01: collapses to a launcher button in the shared dock (drag to reorder).
// @match        https://go.joblogic.com/Asset*
// @match        https://go.joblogic.com/Site/Detail*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Sites/joblogic-bulk-update-assets.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Sites/joblogic-bulk-update-assets.user.js
// ==/UserScript==

/*
 * How it works: for each asset the script reads the edit model Joblogic embeds in /Asset/Detail/<id>,
 * changes only Description / Location / Number, and posts the same form the asset edit screen posts
 * (POST /api/Asset/SaveAsset). Every other field (QR code, notes, class, dates...) is sent back as it
 * was. Tags are saved separately by Joblogic and are not touched. Hire assets are refused. It then
 * re-reads the asset to confirm the change stuck.
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

    const SCRIPT_ID = 'bulk-update-assets';
    const SCRIPT_LABEL = '🏢 Bulk Update Assets';
    const SCRIPT_COLOR = '#0b7285';

    const PACE_MS = 1400;                              // gap between assets (Azure WAF limit)
    const LOAD_TIMEOUT = 30000;
    const ID_H = ['jl asset id', 'asset id', 'id', 'jl id'];
    const DESC_H = ['proposed description', 'new description', 'description'];
    const LOC_H = ['proposed location', 'new location', 'location'];
    const NUM_H = ['proposed number', 'new number'];

    // ------------------------------------------------------------------ UI
    const css = `
      #jlba{position:fixed;right:260px;top:80px;width:760px;max-height:80vh;overflow:auto;z-index:99999;background:#fff;border:1px solid #ccc;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.3);font:13px Arial;padding:14px;display:none}
      #jlba h3{margin:0 0 8px;font-size:15px} #jlba textarea{width:100%;height:150px;font:12px monospace}
      #jlba .row{display:flex;gap:8px;align-items:center;margin:8px 0;flex-wrap:wrap}
      #jlba button{padding:6px 10px;border:1px solid #888;border-radius:4px;background:#f5f5f5;cursor:pointer}
      #jlba button.primary{background:#1f3864;color:#fff;border-color:#1f3864}
      #jlba table{border-collapse:collapse;width:100%;font-size:12px} #jlba td,#jlba th{border:1px solid #ddd;padding:3px 5px;text-align:left;vertical-align:top}
      #jlba .ok{color:#0a7a2f} #jlba .err{color:#c00} #jlba .muted{color:#777}
`;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const box = document.createElement('div'); box.id = 'jlba';
    box.innerHTML = `
      <h3>Bulk update assets</h3>
      <div class="muted">Paste rows with a header line. Needed columns: <b>JL Asset Id</b> and <b>Proposed description</b>.
      Optional: <b>Proposed location</b>, <b>Proposed number</b>. Copying straight from the "Asset renames" tab works.
      Rows whose description is blank or starts with "[" are skipped.</div>
      <textarea id="jlba-in" placeholder="JL Asset Id\tProposed description\tProposed location"></textarea>
      <div class="row">Only allow assets on site ID: <input id="jlba-site" size="10" placeholder="e.g. 16957546">
        <label><input type="checkbox" id="jlba-skipsame" checked> skip assets already correct</label></div>
      <div class="row"><button id="jlba-preview">1. Preview</button><button id="jlba-run" class="primary" disabled>2. Apply</button>
        <button id="jlba-stop" disabled>Stop</button><button id="jlba-csv" disabled>Download log CSV</button>
        <span id="jlba-status" class="muted"></span></div>
      <div id="jlba-out"></div>`;
    document.body.appendChild(box);
    jlRegisterPanel(box, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR,
        'Paste JL Asset Id + Proposed description (+ location) rows, set the site ID, Preview, then Apply. Download the log CSV afterwards: pasting it back in undoes the run.');
    const $ = id => document.getElementById(id);
    const status = t => { $('jlba-status').textContent = t; };
    const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    // ------------------------------------------------------------------ parse
    function parse(text) {
        const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim());
        if (lines.length < 2) throw new Error('Paste a header row plus at least one data row.');
        const delim = lines[0].includes('\t') ? '\t' : ',';
        const split = l => delim === '\t' ? l.split('\t') : l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map(c => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'));
        const head = split(lines[0]).map(h => h.trim().toLowerCase());
        const find = names => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; };
        const ic = find(ID_H), dc = find(DESC_H), lc = find(LOC_H), nc = find(NUM_H);
        if (ic < 0 || dc < 0) throw new Error('Header row needs "JL Asset Id" and "Proposed description" columns.');
        const items = new Map(); let skipped = 0;
        for (const l of lines.slice(1)) {
            const c = split(l).map(x => (x || '').trim());
            const id = c[ic]; const desc = c[dc];
            if (!/^\d+$/.test(id || '')) continue;
            if (!desc || desc.startsWith('[')) { skipped++; continue; }
            const want = { Description: desc };
            if (lc >= 0 && c[lc]) want.Location = c[lc];
            if (nc >= 0 && c[nc]) want.Number = c[nc];
            items.set(id, want);
        }
        return { items: [...items.entries()].map(([id, want]) => ({ id, want })), skipped };
    }

    // ------------------------------------------------------------------ page model + save
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    // Field order and defaults exactly as the asset edit screen posts them (captured 2026-11-09).
    const FORM_KEYS = ['Id','CustomerId','SiteId','IsNew','ForSite','ForJobAsset','PendingAttributesJson','ClassId','PartId',
        'TradeId','ServiceTypeId','Description','Make','Model','ServiceTypeFrequencies','DocumentTypeIds','RefrigerantTypeEnabled',
        'PanelInformationEnabled','Notes','TrimCharge','BaseCharge','RefrigerantCharge','RefrigerantTypeId','CO2','GWP','PanelNumber',
        'Width','Height','Number','Location','SerialNo','QRCode','CustomReference','InstallationDate','Quantity',
        'LabourWarrantyExpiryDate','WarrantyExpiryDate','EstimatedReplacementDate','LastServiceDate','BudgetReplacementCost',
        'IsSuspended','AssetConditionId','DepotId','Taps','IsDepreciation','DepreciationStartDate','PurchasePrice',
        'DepreciationMethod','DepreciationRate','ResidualValue','DepreciationPeriod','UsefulLifeYears','OwnershipType',
        'HireStartDate','HireEndDate','MarkupPercent','MarkupValue','HireRate','HireRateEvery','HireRatePeriod',
        'HireSupplierCost','HireSupplierCostEvery','HireSupplierCostPeriod','AnnualServiceFee'];
    const NOT_IN_MODEL = { IsDepreciation: 'false', DepreciationStartDate: '', PurchasePrice: '', DepreciationMethod: '',
        DepreciationRate: '', ResidualValue: '0', DepreciationPeriod: '1', UsefulLifeYears: '', OwnershipType: 'undefined',
        HireStartDate: 'undefined', HireEndDate: 'undefined', MarkupPercent: 'undefined', MarkupValue: 'undefined',
        HireRateEvery: '', HireSupplierCost: '', HireSupplierCostEvery: '', HireSupplierCostPeriod: '' };

    async function loadModel(id) {
        const r = await fetch(`/Asset/Detail/${id}`, { credentials: 'same-origin' });
        if (!r.ok) throw new Error(`asset page returned ${r.status}`);
        const html = await r.text();
        const i = html.indexOf('"Title":"Edit Asset"');
        if (i < 0) throw new Error('asset not found (no edit model on the page)');
        let d = 0, start = -1;
        for (let p = i; p >= 0; p--) { const c = html[p]; if (c === '}') d++; else if (c === '{') { if (d === 0) { start = p; break; } d--; } }
        let e = 0, end = -1;
        for (let p = start; p < html.length; p++) {
            const c = html[p];
            if (c === '"') { p++; while (html[p] !== '"') { if (html[p] === '\\') p++; p++; } continue; }
            if (c === '{') e++; else if (c === '}') { e--; if (e === 0) { end = p; break; } }
        }
        const m = JSON.parse(html.slice(start, end + 1));
        if (String(m.Id) !== String(id)) throw new Error(`page model is for asset ${m.Id}, not ${id}`);
        return m;
    }
    const view = m => ({ Description: m.Description || '', Location: m.Location || '', Number: m.Number || '',
                         site: String(m.SiteId || ''), siteName: m.SiteName || (m.Site && m.Site.Name) || '' });
    const fmt = v => v == null ? '' : (Array.isArray(v) ? v.join(',') : String(v));

    function buildForm(m, change) {
        const fd = new FormData();
        for (const k of FORM_KEYS) {
            let v = k in change ? change[k] : (k in m ? m[k] : NOT_IN_MODEL[k]);
            if (k === 'TrimCharge') v = Number(m.TrimCharge || 0).toFixed(3);
            if (k === 'AnnualServiceFee') v = Number(m.AnnualServiceFee || 0).toFixed(2);
            fd.append(k, fmt(v));
        }
        return fd;
    }
    function verificationToken() {
        const el = document.querySelector('input[name="__RequestVerificationToken"]');
        if (!el) throw new Error('no __RequestVerificationToken on this page - reload it');
        return el.value;
    }

    // ------------------------------------------------------------------ one asset
    async function processAsset(item, apply, siteGuard, skipSame) {
        const m = await loadModel(item.id);
        const before = view(m);
        const rec = { id: item.id, before, want: item.want };
        if (siteGuard && before.site !== siteGuard) { rec.result = 'refused'; rec.error = `asset is on site ${before.site}, not ${siteGuard}`; return rec; }
        if (m.IsHireAsset || m.HireAssetId) { rec.result = 'refused'; rec.error = 'hire asset - edit by hand'; return rec; }
        const change = Object.fromEntries(Object.entries(item.want).filter(([k, v]) => (before[k] || '') !== v));
        rec.change = change;
        if (!Object.keys(change).length && skipSame) { rec.result = 'already correct'; return rec; }
        if (!apply) { rec.result = 'would update'; return rec; }

        const r = await fetch('/api/Asset/SaveAsset', {
            method: 'POST', credentials: 'same-origin', body: buildForm(m, change),
            headers: { 'Accept': 'application/json', '__RequestVerificationToken': verificationToken(), 'X-Requested-With': 'XMLHttpRequest' },
        });
        const text = await r.text();
        rec.saveStatus = r.status;
        if (!r.ok) { rec.result = 'error'; rec.error = `save returned ${r.status}: ${text.slice(0, 200)}`; return rec; }
        try { const j = JSON.parse(text); if (j && j.success === false) { rec.result = 'error'; rec.error = 'Joblogic refused the save: ' + (j.Message || JSON.stringify(j.errors || j).slice(0, 200)); return rec; } } catch (e) { /* not JSON */ }
        await sleep(400);
        const after = view(await loadModel(item.id));
        rec.after = after;
        const bad = Object.entries(change).filter(([k, v]) => (after[k] || '') !== v).map(([k]) => `${k} did not save`);
        rec.result = bad.length ? 'CHECK' : 'updated';
        if (bad.length) rec.error = bad.join('; ');
        return rec;
    }

    // ------------------------------------------------------------------ run
    let items = [], log = [], stopFlag = false;
    function render() {
        const rows = log.map(r => `<tr><td>${esc(r.id)}</td><td>${esc(r.before && r.before.Description)}</td><td>${esc(r.want.Description)}</td>
            <td>${esc(r.before && r.before.Location)}${r.want.Location && r.before && r.want.Location !== r.before.Location ? ' &rarr; ' + esc(r.want.Location) : ''}</td>
            <td class="${/updated|already|would/.test(r.result) ? 'ok' : 'err'}">${esc(r.result)}${r.error ? ': ' + esc(r.error) : ''}</td></tr>`).join('');
        const counts = log.reduce((m, r) => (m[r.result] = (m[r.result] || 0) + 1, m), {});
        $('jlba-out').innerHTML = `<div class="muted">${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(' &nbsp; ')}</div>
          <table><tr><th>Id</th><th>Current description</th><th>New description</th><th>Location</th><th>Result</th></tr>${rows}</table>`;
    }
    async function run(apply) {
        const siteGuard = $('jlba-site').value.trim();
        if (apply && !/^\d+$/.test(siteGuard)) { alert('Enter the site ID the assets belong to before applying (8 Devonshire Square = 16957546).'); return; }
        stopFlag = false; log = [];
        ['jlba-preview', 'jlba-run'].forEach(b => $(b).disabled = true); $('jlba-stop').disabled = false;
        for (let i = 0; i < items.length && !stopFlag; i++) {
            status(`${apply ? 'Updating' : 'Checking'} ${i + 1} / ${items.length}...`);
            let rec;
            try { rec = await processAsset(items[i], apply, siteGuard, $('jlba-skipsame').checked); }
            catch (e) { rec = { id: items[i].id, want: items[i].want, result: 'error', error: e.message }; }
            log.push(rec); render();
            await sleep(PACE_MS);
        }
        status(stopFlag ? 'Stopped.' : (apply ? 'Done. Download the log CSV to keep the before values.' : 'Preview done. Check the list, then Apply.'));
        $('jlba-preview').disabled = false; $('jlba-run').disabled = apply; $('jlba-stop').disabled = true; $('jlba-csv').disabled = !log.length;
    }
    $('jlba-preview').onclick = () => {
        try { const p = parse($('jlba-in').value); items = p.items; status(`${items.length} assets to check, ${p.skipped} skipped (blank or [placeholder]).`); }
        catch (e) { alert(e.message); return; }
        if (!items.length) return;
        run(false).then(() => { $('jlba-run').disabled = !log.some(r => r.result === 'would update'); });
    };
    $('jlba-run').onclick = () => {
        const n = log.filter(r => r.result === 'would update').length;
        if (!confirm(`Update ${n} assets in Joblogic? Only Description / Location / Number change. A log with the old values can be downloaded afterwards.`)) return;
        items = items.filter(it => log.some(r => r.id === it.id && r.result === 'would update'));
        run(true);
    };
    $('jlba-stop').onclick = () => { stopFlag = true; status('Stopping after this asset...'); };
    $('jlba-csv').onclick = () => {
        const q = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
        // the "Undo" columns are laid out so the file can be pasted straight back in to reverse the run
        const lines = [['JL Asset Id', 'Proposed description', 'Proposed location', 'Proposed number', 'New description', 'New location', 'Result', 'Error'].map(q).join(',')];
        for (const r of log) lines.push([r.id, r.before && r.before.Description, r.before && r.before.Location, r.before && r.before.Number,
            r.want.Description, r.want.Location, r.result, r.error].map(q).join(','));
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
        a.download = `asset-update-log-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`;
        a.click();
    };
})();
