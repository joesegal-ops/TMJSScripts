// ==UserScript==
// @name         JobLogic Report Designer — Bulk Row Insert
// @namespace    com.joesegal.joblogic
// @version      1.0.6
// @description  Paste tab- or comma-separated data (3 columns: Location, Result, Comments) and bulk-insert rows into DataBand1 on Page 1 of the Stimulsoft Report Designer. v1.0.2: collapses to a launcher button in the shared dock (drag to reorder).
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
    const jlDockList = () => document.getElementById('jl-userscript-dock-list');
    function jlReadOrder() { try { return JSON.parse(localStorage.getItem(JL_ORDER_KEY)) || []; } catch (e) { return []; } }
    function jlSaveOrder() { const l = jlDockList(); if (!l) return; localStorage.setItem(JL_ORDER_KEY, JSON.stringify([...l.children].map(b => b.dataset.scriptId).filter(Boolean))); }
    function jlApplyOrder() { const l = jlDockList(); if (!l) return; [...l.children].sort((a, b) => { const o = jlReadOrder(); let ia = o.indexOf(a.dataset.scriptId), ib = o.indexOf(b.dataset.scriptId); if (ia < 0) ia = 1e9; if (ib < 0) ib = 1e9; return ia - ib; }).forEach(b => l.appendChild(b)); }
    function jlAfter(l, y) { let c = { o: -Infinity, el: null }; for (const el of l.querySelectorAll('button:not(.jl-dragging)')) { const r = el.getBoundingClientRect(); const off = y - (r.top + r.height / 2); if (off < 0 && off > c.o) c = { o: off, el }; } return c.el; }
    function jlSetDockMin(min) { const l = jlDockList(), t = document.getElementById('jl-userscript-dock-toggle'); if (l) l.style.display = min ? 'none' : 'flex'; if (t) t.textContent = (min ? '▸' : '▾') + ' Advanced Controls'; try { localStorage.setItem(JL_MIN_KEY, min ? '1' : '0'); } catch (e) {} }
    function jlGetDock() {
        let d = document.getElementById(JL_DOCK_ID);
        if (!d) { d = document.createElement('div'); d.id = JL_DOCK_ID; document.body.appendChild(d); }
        d.style.cssText = 'position:fixed;top:80px;right:8px;z-index:100000;display:flex;flex-direction:column;gap:8px;align-items:flex-end;';
        const savedTop = localStorage.getItem(JL_TOP_KEY); if (savedTop !== null) d.style.top = savedTop + 'px';
        let t = document.getElementById('jl-userscript-dock-toggle');
        if (!t) {
            t = document.createElement('button');
            t.id = 'jl-userscript-dock-toggle';
            t.title = 'Drag to move up/down • click to expand/collapse';
            t.style.cssText = 'background:#11111a;color:#fff;border:1px solid #555;padding:6px 12px;border-radius:18px;cursor:grab;font-family:monospace;font-size:12px;box-shadow:0 2px 8px rgba(0,0,0,.4);white-space:nowrap;touch-action:none;';
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
        jlSetDockMin(localStorage.getItem(JL_MIN_KEY) !== '0');
        return d;
    }
    function jlDockButton(id, label, color, onClick) {
        jlGetDock();
        const l = jlDockList();
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
            btn.style.boxShadow = opening ? '0 0 0 2px #fff, 0 2px 8px rgba(0,0,0,.4)' : '0 2px 8px rgba(0,0,0,.4)';
        });
        return btn;
    }
    // ===== end shared dock =====

  const SCRIPT_ID = 'report-bulk-rows';
  const SCRIPT_LABEL = '📋 Report Bulk Rows';
  const SCRIPT_COLOR = '#6a0';

  // --- Column layout (inches, Stimulsoft units) — matches existing row 1 template on Page 1 ---
  const LAYOUT = {
    loc: { left: 0.1, width: 3.1 },
    res: { left: 3.2, width: 1.3 },
    com: { left: 4.5, width: 3.1 },
    rowHeight: 0.2,
    headerTop: 0, // within DataBand1
  };

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

    jlDockButton(SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR, openModal);

    const modal = document.createElement('div');
    modal.id = 'jlbr-modal';
    modal.innerHTML = `
      <div id="jlbr-panel">
        <header>
          <h3>Insert rows into Page 1 · DataBand1</h3>
          <button id="jlbr-close" title="Close">×</button>
        </header>
        <div id="jlbr-body">
          <label for="jlbr-ta">Paste 3 columns (Location, Result, Comments) — tab- or comma-separated. One row per line.</label>
          <textarea id="jlbr-ta" placeholder="LIFT LOBBY EMLG/1\t{location1.Result}\t{location1.Comments}
LIFT LOBBY EMLG/2\t{location2.Result}\t{location2.Comments}
..."></textarea>
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

    document.getElementById('jlbr-close').onclick = closeModal;
    document.getElementById('jlbr-cancel').onclick = closeModal;
    document.getElementById('jlbr-run').onclick = runInsert;
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

    // Validate + normalise to [loc, res, com]
    const rows = raw
      .map(r => [r[0] || '', r[1] || '', r[2] || ''])
      .filter(r => r.some(c => String(c).trim() !== ''));

    if (!rows.length) { log('⚠ All rows empty after parsing.'); return; }
    log(`Parsed ${rows.length} rows.`);

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

    // Grab a template cell from existing DataBand1 (for font/border formatting).
    // Row 1 (top=0) has all 3 columns; fall back to the first available cell.
    const existing = dataBand.components.list;
    const template = existing.find(c => Math.abs(c.top) < 0.001) || existing[0] || null;
    if (!template) log('⚠ No existing template cell found — using bare defaults.');

    // Confirm destructive action
    if (clearFirst && existing.length > 0) {
      const ok = confirm(`This will remove ${existing.length} existing cells from DataBand1 and replace them with ${rows.length} new rows (${rows.length * 3} cells). Continue?`);
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
        c.name = name;
        c.left = LAYOUT[col].left;
        c.width = LAYOUT[col].width;
        c.top = top;
        c.height = LAYOUT.rowHeight;
        c.text = String(text);
        if (template) {
          try { c.border = template.border; } catch (e) {}
          try { c.font = template.font; } catch (e) {}
          try { c.horAlignment = template.horAlignment; } catch (e) {}
          try { c.vertAlignment = template.vertAlignment; } catch (e) {}
          try { c.brush = template.brush; } catch (e) {}
          try { c.textBrush = template.textBrush; } catch (e) {}
        }
        return c;
      };

      const saveEvery = saveMode === '20' ? 20 : null;

      for (let i = 0; i < rows.length; i++) {
        const [loc, res, com] = rows[i];
        const top = i * LAYOUT.rowHeight;
        const idx = i + 1;
        dataBand.components.add(makeCell(`TM_Loc_${idx}`, 'loc', top, loc));
        dataBand.components.add(makeCell(`TM_Res_${idx}`, 'res', top, res));
        dataBand.components.add(makeCell(`TM_Com_${idx}`, 'com', top, com));

        if (saveEvery && idx % saveEvery === 0) {
          // Refresh + save intermediate
          inner.jsObject.assignReport(report);
          log(`Row ${idx}/${rows.length} — saving checkpoint…`);
          await triggerSave(d);
          await sleep(250);
        }
      }

      // Expand DataBand height to fit all rows + a little padding
      dataBand.height = Math.max(dataBand.height, rows.length * LAYOUT.rowHeight + 0.2);

      // Final re-render
      inner.jsObject.assignReport(report);
      log(`Inserted ${rows.length} rows (${rows.length * 3} cells).`);

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
