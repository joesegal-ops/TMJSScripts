// ==UserScript==
// @name         JobLogic Report Designer — Bulk Row Insert
// @namespace    com.joesegal.joblogic
// @version      1.1.3
// @description  Paste tab- or comma-separated data (any number of columns, e.g. Location, Result, Comments) and bulk-insert rows into DataBand1 on Page 1 of the Stimulsoft Report Designer. v1.0.2: collapses to a launcher button in the shared dock (drag to reorder).
// @match        https://go.joblogic.com/Form/Designer/*
// @run-at       document-idle
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Forms/joblogic-report-bulk-rows.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Forms/joblogic-report-bulk-rows.user.js
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

  const SCRIPT_ID = 'report-bulk-rows';
  const SCRIPT_LABEL = '📋 Report Bulk Rows';
  const SCRIPT_COLOR = '#0b7285';
  const SCRIPT_DESC = 'Bulk-inserts rows into the Stimulsoft Report Designer. Open a report, paste tab or comma separated data with any number of columns (e.g. Location, Result, Comments or Location, Outlet Type, Hot, Cold, Mixed, Remedial, Issues), then insert. Column positions come from the existing row 1 in DataBand1 when it has the same number of columns, else from the widths you enter, else they are spread evenly.';

  // --- Layout defaults (inches, Stimulsoft units) ---
  const LAYOUT = {
    rowHeight: 0.2,
    defaultLeft: 0.1, // first column's left edge when there is no template row
  };
  const WIDTHS_KEY = 'jlbr-col-widths';
  const HEIGHT_KEY = 'jlbr-row-height';

  // --- Small UI: floating launcher + modal panel ---
  const STYLE = `
    #jlbr-launcher {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483600;
      background: #0f9d58; color: #fff; border: none; border-radius: 24px;
      padding: 10px 16px; font: 600 13px system-ui; cursor: pointer;
      box-shadow: 0 2px 10px rgba(0,0,0,.25);
    }
    #jlbr-launcher:hover { background: #0b7c45; }
    #jlbr-modal {
      position: fixed; inset: 0; z-index: 2147483601;
      background: rgba(0,0,0,.4); display: none; align-items: center; justify-content: center;
    }
    #jlbr-modal.open { display: flex; }
    #jlbr-panel {
      background: #fff; width: 560px; max-width: 94vw; max-height: 86vh;
      border-radius: 8px; display: flex; flex-direction: column;
      box-shadow: 0 10px 40px rgba(0,0,0,.3); font: 13px system-ui;
    }
    #jlbr-panel header {
      padding: 14px 18px; border-bottom: 1px solid #eee;
      display: flex; justify-content: space-between; align-items: center;
    }
    #jlbr-panel header h3 { margin: 0; font-size: 15px; }
    #jlbr-close { background: none; border: 0; font-size: 20px; cursor: pointer; color: #777; }
    #jlbr-body { padding: 14px 18px; overflow: auto; display: flex; flex-direction: column; gap: 10px; }
    #jlbr-body label { font-weight: 600; }
    #jlbr-body textarea {
      width: 100%; min-height: 180px; font: 12px ui-monospace, monospace;
      border: 1px solid #ccc; border-radius: 4px; padding: 8px; box-sizing: border-box;
    }
    #jlbr-body .row { display: flex; gap: 12px; align-items: center; }
    #jlbr-log {
      font: 12px ui-monospace, monospace; background: #f6f8fa; border: 1px solid #e1e4e8;
      border-radius: 4px; padding: 8px; min-height: 48px; max-height: 140px; overflow: auto;
      white-space: pre-wrap;
    }
    #jlbr-panel footer {
      padding: 12px 18px; border-top: 1px solid #eee;
      display: flex; justify-content: flex-end; gap: 8px;
    }
    #jlbr-panel button.primary {
      background: #0f9d58; color: #fff; border: 0; padding: 8px 16px;
      border-radius: 4px; cursor: pointer; font-weight: 600;
    }
    #jlbr-panel button.secondary {
      background: #fff; color: #333; border: 1px solid #ccc; padding: 8px 14px;
      border-radius: 4px; cursor: pointer;
    }
    #jlbr-panel button:disabled { opacity: .5; cursor: not-allowed; }
  `;

  function injectUI() {
    if (document.getElementById('jlbr-modal')) return;
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    jlDockButton(SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR, openModal, SCRIPT_DESC);

    const modal = document.createElement('div');
    modal.id = 'jlbr-modal';
    modal.innerHTML = `
      <div id="jlbr-panel">
        <header>
          <h3>Insert rows into Page 1 · DataBand1</h3>
          <button id="jlbr-close" title="Close">×</button>
        </header>
        <div id="jlbr-body">
          <label for="jlbr-ta">Paste any number of columns — tab- or comma-separated. One row per line. Column count = the widest row.</label>
          <textarea id="jlbr-ta" placeholder="LIFT LOBBY EMLG/1\t{location1.Result}\t{location1.Comments}
LIFT LOBBY EMLG/2\t{location2.Result}\t{location2.Comments}
..."></textarea>
          <div class="row" style="flex-wrap:wrap">
            <label for="jlbr-widths">Column widths (inches, optional):</label>
            <input id="jlbr-widths" type="text" style="flex:1;min-width:200px;padding:4px 6px" placeholder="blank = match row 1, else spread evenly · e.g. 2,1,0.8,0.8,0.8,1,1.5">
          </div>
          <div class="row">
            <label for="jlbr-height">Row height (inches, optional):</label>
            <input id="jlbr-height" type="text" style="width:90px;padding:4px 6px" placeholder="blank = auto">
            <span style="color:#777;font-size:12px">auto = original row 1, else header row height</span>
          </div>
          <div class="row">
            <label><input type="checkbox" id="jlbr-clear" checked> Clear existing DataBand1 rows first</label>
          </div>
          <div class="row">
            <label>After inserting:</label>
            <select id="jlbr-savemode">
              <option value="once">Save once at end (fastest)</option>
              <option value="20">Save every 20 rows</option>
              <option value="none">Don't save (UI only)</option>
            </select>
          </div>
          <div id="jlbr-log">Ready.</div>
        </div>
        <footer>
          <button class="secondary" id="jlbr-cancel">Cancel</button>
          <button class="primary" id="jlbr-run">Run</button>
        </footer>
      </div>`;
    document.body.appendChild(modal);
    { const _b = document.getElementById('jlbr-body'); if (_b && typeof jlHelpBanner === 'function') _b.insertBefore(jlHelpBanner(SCRIPT_DESC), _b.firstChild); }

    document.getElementById('jlbr-close').onclick = closeModal;
    document.getElementById('jlbr-cancel').onclick = closeModal;
    document.getElementById('jlbr-run').onclick = runInsert;
    try { document.getElementById('jlbr-widths').value = localStorage.getItem(WIDTHS_KEY) || ''; } catch (e) {}
    try { document.getElementById('jlbr-height').value = localStorage.getItem(HEIGHT_KEY) || ''; } catch (e) {}
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  }

  function openModal() { document.getElementById('jlbr-modal').classList.add('open'); }
  function closeModal() { document.getElementById('jlbr-modal').classList.remove('open'); }

  function log(msg) {
    const el = document.getElementById('jlbr-log');
    const ts = new Date().toTimeString().slice(0, 8);
    el.textContent += `\n[${ts}] ${msg}`;
    el.scrollTop = el.scrollHeight;
  }
  function clearLog() { document.getElementById('jlbr-log').textContent = 'Ready.'; }

  // --- CSV/TSV parsing (auto-detect separator; supports quoted multi-line fields) ---
  function parseRows(text) {
    text = text.replace(/\r\n?/g, '\n').trim();
    if (!text) return [];
    // Detect separator from the first unquoted character that's tab or comma.
    // If a tab appears before any comma at top-level, treat as TSV; else CSV.
    let sep = ',';
    let scanQuote = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (scanQuote) {
        if (c === '"' && text[i + 1] === '"') { i++; }
        else if (c === '"') scanQuote = false;
      } else {
        if (c === '"') scanQuote = true;
        else if (c === '\t') { sep = '\t'; break; }
        else if (c === ',') { sep = ','; break; }
      }
    }

    const out = [];
    let row = [], field = '', inQuote = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuote) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') inQuote = false;
        else field += c;
      } else {
        if (c === '"' && field === '') inQuote = true;
        else if (c === sep) { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); out.push(row); row = []; field = ''; }
        else field += c;
      }
    }
    row.push(field);
    out.push(row);
    return out;
  }

  // --- Core: apply rows to the designer ---
  async function runInsert() {
    clearLog();
    const taText = document.getElementById('jlbr-ta').value;
    const clearFirst = document.getElementById('jlbr-clear').checked;
    const saveMode = document.getElementById('jlbr-savemode').value;

    const raw = parseRows(taText);
    if (!raw.length) { log('⚠ No data pasted.'); return; }

    // Drop blank lines, then pad every row to the widest row's column count
    const nonEmpty = raw.filter(r => r.some(c => String(c).trim() !== ''));
    if (!nonEmpty.length) { log('⚠ All rows empty after parsing.'); return; }
    const nCols = Math.max(...nonEmpty.map(r => r.length));
    const rows = nonEmpty.map(r => Array.from({ length: nCols }, (_, i) => r[i] || ''));
    const short = nonEmpty.filter(r => r.length < nCols).length;
    log(`Parsed ${rows.length} rows × ${nCols} columns.` + (short ? ` (${short} short row(s) padded with blanks)` : ''));

    const widthsText = document.getElementById('jlbr-widths').value.trim();
    try { localStorage.setItem(WIDTHS_KEY, widthsText); } catch (e) {}
    let userWidths = null;
    if (widthsText) {
      userWidths = widthsText.split(/[,\s]+/).filter(Boolean).map(Number);
      if (userWidths.some(w => !(w > 0))) { log('✗ Column widths must be positive numbers, e.g. 2,1,0.8'); return; }
      if (userWidths.length !== nCols) { log(`✗ You entered ${userWidths.length} widths but the data has ${nCols} columns.`); return; }
    }

    const heightText = document.getElementById('jlbr-height').value.trim();
    try { localStorage.setItem(HEIGHT_KEY, heightText); } catch (e) {}
    const userHeight = heightText ? Number(heightText) : null;
    if (heightText && !(userHeight > 0)) { log('✗ Row height must be a positive number, e.g. 0.3'); return; }

    // Access Stimulsoft designer
    const d = window.jsStiDesigner;
    if (!d || !d.designer || !d.designer.report) {
      log('✗ Stimulsoft designer not found on page. Are you on the Report Designer tab?');
      return;
    }
    const inner = d.designer;
    const report = inner.report;
    const page = report.pages.list[0]; // Page 1 only
    if (!page) { log('✗ Page 1 not found.'); return; }
    const dataBand = page.components.list.find(c => c.name === 'DataBand1');
    if (!dataBand) { log('✗ DataBand1 not found on Page 1.'); return; }

    const StiText = Stimulsoft.Report.Components.StiText;
    if (!StiText) { log('✗ Stimulsoft.Report.Components.StiText not available.'); return; }

    // Row 1 of DataBand1 (top≈0), sorted left→right, is the template for formatting.
    // Cells this script made (TM_*) are never used for column POSITIONS — otherwise a
    // second run just "matches" the first run's guess.
    const existing = dataBand.components.list;
    const templateRow = existing.filter(c => Math.abs(c.top) < 0.001).sort((a, b) => a.left - b.left);
    const isOurs = c => /^TM_/.test(c.name || '');
    const originalRow = templateRow.filter(c => !isOurs(c));
    const fallbackTemplate = templateRow[0] || existing[0] || null;
    if (!fallbackTemplate) log('⚠ No existing template cell found — using bare defaults.');

    // Column header row: the nearest band above DataBand1 that has a line of exactly
    // nCols text cells (e.g. Location | Outlet Type | Hot | Cold | Mixed | Remedial | Issues).
    const fmt = cs => cs.map(c => `${(+c.left).toFixed(2)}+${(+c.width).toFixed(2)}`).join(', ');
    const headerRow = (() => {
      const bands = page.components.list
        .filter(b => b !== dataBand && b.components && b.components.list && b.components.list.length && b.top < dataBand.top)
        .sort((a, b) => b.top - a.top); // nearest above first
      for (const band of bands) {
        const byTop = {};
        band.components.list.forEach(c => { const k = (+c.top).toFixed(2); (byTop[k] = byTop[k] || []).push(c); });
        const lines = Object.keys(byTop).sort((a, b) => b - a).map(k => byTop[k]); // lowest line (closest to data) first
        const hit = lines.find(l => l.length === nCols);
        if (hit) return { band, cells: hit.slice().sort((a, b) => a.left - b.left) };
      }
      return null;
    })();

    // Work out each column's {left, width, template}
    let cols;
    if (userWidths) {
      const ref = headerRow ? headerRow.cells : (originalRow.length ? originalRow : templateRow);
      let x = ref.length ? ref[0].left : LAYOUT.defaultLeft;
      cols = userWidths.map((w, i) => { const c = { left: x, width: w, template: templateRow[i] || fallbackTemplate }; x += w; return c; });
      log(`Layout: your widths (${userWidths.join(', ')}).`);
    } else if (headerRow) {
      cols = headerRow.cells.map((h, i) => ({ left: h.left, width: h.width, template: templateRow[i] || fallbackTemplate }));
      log(`Layout: lined up with the ${nCols} header cells in ${headerRow.band.name} (${headerRow.cells.map(c => (c.text && String(c.text.value != null ? c.text.value : c.text)) || c.name).join(' | ')}).`);
    } else if (originalRow.length === nCols) {
      cols = originalRow.map(t => ({ left: t.left, width: t.width, template: t }));
      log(`Layout: matched the ${nCols} original cells in DataBand1 row 1.`);
    } else {
      const start = templateRow.length ? templateRow[0].left : LAYOUT.defaultLeft;
      const end = templateRow.length
        ? Math.max(...templateRow.map(t => t.left + t.width))
        : Math.max(start + 1, dataBand.width - LAYOUT.defaultLeft);
      const w = Math.round(((end - start) / nCols) * 1000) / 1000;
      cols = Array.from({ length: nCols }, (_, i) => ({ left: start + i * w, width: w, template: templateRow[i] || fallbackTemplate }));
      log(`Layout: row 1 has ${templateRow.length} cells, data has ${nCols} — spreading ${nCols} columns evenly (${w}" each) across ${(end - start).toFixed(2)}". No header row with ${nCols} cells found — enter widths to control this.`);
    }
    log(`Columns (left+width, inches): ${fmt(cols)}`);

    // Row height: your value → original (non-script) row 1 → header row → default
    const tallest = cs => Math.max(...cs.map(c => +c.height || 0));
    let rowHeight, heightSrc;
    if (userHeight) { rowHeight = userHeight; heightSrc = 'your value'; }
    else if (originalRow.length && tallest(originalRow) > 0) { rowHeight = tallest(originalRow); heightSrc = 'original row 1'; }
    else if (headerRow && tallest(headerRow.cells) > 0) { rowHeight = tallest(headerRow.cells); heightSrc = `header row in ${headerRow.band.name}`; }
    else { rowHeight = LAYOUT.rowHeight; heightSrc = 'default'; }
    log(`Row height: ${(+rowHeight).toFixed(2)}" (${heightSrc}).`);

    // Confirm destructive action
    if (clearFirst && existing.length > 0) {
      const ok = confirm(`This will remove ${existing.length} existing cells from DataBand1 and replace them with ${rows.length} new rows × ${nCols} columns (${rows.length * nCols} cells). Continue?`);
      if (!ok) { log('Cancelled.'); return; }
    }

    document.getElementById('jlbr-run').disabled = true;

    try {
      // Clear existing
      if (clearFirst) {
        // Clone list before iterating since remove() mutates
        const toRemove = existing.slice();
        toRemove.forEach(c => dataBand.components.remove(c));
        log(`Removed ${toRemove.length} existing cells.`);
      }

      // Build new cells
      const makeCell = (name, col, top, text) => {
        const c = new StiText();
        const template = col.template;
        c.name = name;
        c.left = col.left;
        c.width = col.width;
        c.top = top;
        c.height = rowHeight;
        c.text = String(text);
        if (template) copyCellSettings(template, c);
        return c;
      };

      const saveEvery = saveMode === '20' ? 20 : null;

      for (let i = 0; i < rows.length; i++) {
        const top = i * rowHeight;
        const idx = i + 1;
        cols.forEach((col, j) => dataBand.components.add(makeCell(`TM_C${j + 1}_${idx}`, col, top, rows[i][j])));

        if (saveEvery && idx % saveEvery === 0) {
          // Refresh + save intermediate
          inner.jsObject.assignReport(report);
          log(`Row ${idx}/${rows.length} — saving checkpoint…`);
          await triggerSave(d);
          await sleep(250);
        }
      }

      // Fit DataBand to the rows: exact when we replaced everything, else only grow
      const needed = rows.length * rowHeight;
      dataBand.height = clearFirst ? needed : Math.max(dataBand.height, needed);

      // Final re-render
      inner.jsObject.assignReport(report);
      log(`Inserted ${rows.length} rows (${rows.length * nCols} cells).`);

      if (saveMode !== 'none') {
        log('Saving…');
        await triggerSave(d);
        log('Save command dispatched. (If the form is locked, the server will reject the save — check the UI.)');
      } else {
        log('Skipped save (UI only).');
      }
    } catch (err) {
      console.error(err);
      log(`✗ Error: ${err && err.message || err}`);
    } finally {
      document.getElementById('jlbr-run').disabled = false;
    }
  }

  function triggerSave(d) {
    return new Promise((resolve) => {
      try {
        if (typeof d.SendCommandSavePage === 'function') {
          d.SendCommandSavePage();
        } else if (d.designer && d.designer.jsObject && typeof d.designer.jsObject.SendCommandSavePage === 'function') {
          d.designer.jsObject.SendCommandSavePage();
        } else {
          console.warn('No SendCommandSavePage found');
        }
      } catch (e) { console.error(e); }
      // SendCommand* is fire-and-forget; give the network a moment.
      setTimeout(resolve, 500);
    });
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // Every StiText setting worth carrying over from the template cell (position,
  // size, name and text are set separately). Objects are cloned so cells don't
  // share one border/font/margins instance.
  const CELL_PROPS = [
    // Appearance
    'border', 'font', 'brush', 'textBrush', 'horAlignment', 'vertAlignment',
    'margins', 'angle', 'lineSpacing', 'textOptions', 'textFormat', 'textQuality',
    'componentStyle', 'useParentStyles', 'evenStyle', 'oddStyle',
    // Behaviour (Word Wrap, Can Grow, etc.)
    'wordWrap', 'canGrow', 'canShrink', 'canBreak', 'growToHeight', 'autoWidth',
    'shrinkFontToFit', 'shrinkFontToFitMinimumSize', 'trimming', 'maxNumberOfLines',
    'allowHtmlTags', 'hideZeros', 'onlyText', 'linesOfUnderline', 'renderTo',
    'processAt', 'processingDuplicates', 'excelValue', 'exportAsImage',
    'printable', 'printOn', 'enabled', 'locked', 'linked', 'shiftMode',
    'interaction', 'editableText',
  ];
  function copyCellSettings(src, dst) {
    for (const p of CELL_PROPS) {
      let v;
      try { v = src[p]; } catch (e) { continue; }
      if (v === undefined) continue;
      try { if (v && typeof v === 'object' && typeof v.clone === 'function') v = v.clone(); } catch (e) {}
      try { dst[p] = v; } catch (e) {}
    }
  }

  // Inject UI once the designer page is rendered. Poll briefly for jsStiDesigner.
  function waitForDesigner(cb, attempts = 40) {
    if (window.jsStiDesigner && window.jsStiDesigner.designer && window.jsStiDesigner.designer.report) return cb();
    if (attempts <= 0) return; // give up silently (we may be on Survey Designer tab)
    setTimeout(() => waitForDesigner(cb, attempts - 1), 500);
  }

  // Inject UI on load, and re-inject when the hash changes (user switching tabs)
  function tryInject() {
    injectUI();
    waitForDesigner(() => { /* ready */ });
  }
  tryInject();
  window.addEventListener('hashchange', tryInject);

})();
