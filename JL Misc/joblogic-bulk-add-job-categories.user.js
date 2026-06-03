// ==UserScript==
// @name         JL Bulk Add Job Categories
// @namespace    https://up-fm.com
// @version      1.5
// @description  Bulk-add Job Categories on the Joblogic Library/Misc page. v1.1: collapses to a launcher button in the shared dock (drag to reorder).
// @match        https://go.joblogic.com/Library/Misc*
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Misc/joblogic-bulk-add-job-categories.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Misc/joblogic-bulk-add-job-categories.user.js
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

    const SCRIPT_ID = 'add-job-categories';
    const SCRIPT_LABEL = '🏷 Add Job Categories';
    const SCRIPT_COLOR = '#a60';

  const VERSION      = '1.0';
  const DEFAULT_COLOR = '66c2c9';

  // Only run on the Job Categories tab
  function isJobCategoryTab() {
    return location.hash === '#JOB_CATEGORY' || location.hash === '' || !location.hash;
  }

  function waitFor(fn, timeout = 10000, interval = 100) {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const id = setInterval(() => {
        const v = fn();
        if (v) { clearInterval(id); resolve(v); }
        else if (Date.now() - t0 > timeout) { clearInterval(id); reject(new Error('timeout')); }
      }, interval);
    });
  }

  // Get CSRF token by briefly opening the native modal, grabbing the token, then closing it
  async function getCsrfToken() {
    const addBtn = document.querySelector('button[onclick*="JobCategory"], .jl-custom-btn.jl-button-green');
    // Try finding the "Add Job Category" button more reliably
    const allBtns = Array.from(document.querySelectorAll('button'));
    const addJobCatBtn = allBtns.find(b => b.textContent.trim().includes('Add Job Category'));

    if (!addJobCatBtn) throw new Error('Add Job Category button not found');

    addJobCatBtn.click();

    const token = await waitFor(() => {
      const input = document.querySelector('.modal.in input[name="__RequestVerificationToken"], .modal[style*="display: block"] input[name="__RequestVerificationToken"], .modal.show input[name="__RequestVerificationToken"]');
      return input?.value || null;
    }, 5000);

    // Close the modal
    const closeBtn = document.querySelector('.modal.in .close, .modal[style*="display: block"] .close, .modal.show .close');
    if (closeBtn) closeBtn.click();

    return token;
  }

  // POST a single category
  async function createCategory(name, color, csrfToken) {
    const body = new URLSearchParams({
      Type: '10',
      Description: name,
      BackgroundColor: color.replace(/^#/, ''),
      __RequestVerificationToken: csrfToken,
    });

    const res = await fetch('/api/Library/Create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: body.toString(),
      credentials: 'include',
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json().catch(() => null);
    // API returns { success: true } or similar
    if (json && json.success === false) throw new Error(json.message || 'API returned failure');
    return true;
  }

  // ── UI helpers ───────────────────────────────────────────────────────────

  function el(tag, props = {}, children = []) {
    const e = document.createElement(tag);
    const { style: styleObj, ...rest } = props;
    if (styleObj && typeof styleObj === 'object') {
      Object.assign(e.style, styleObj);
    } else if (styleObj) {
      e.style.cssText = styleObj;
    }
    Object.assign(e, rest);
    children.forEach(c => e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return e;
  }

  function btnStyle(bg, full = true) {
    return {
      display: 'block',
      width: full ? '100%' : 'auto',
      padding: '8px 14px',
      background: bg,
      color: '#fff',
      border: 'none',
      borderRadius: '4px',
      cursor: 'pointer',
      fontSize: '13px',
      fontWeight: '600',
    };
  }

  // ── Panel ────────────────────────────────────────────────────────────────

  function injectPanel() {
    if (document.getElementById('jl-bulk-cats')) return;

    const panel = el('div', {
      id: 'jl-bulk-cats',
      style: {
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        zIndex: '99999',
        background: '#fff',
        border: '1px solid #d1d5db',
        borderRadius: '8px',
        boxShadow: '0 4px 20px rgba(0,0,0,.15)',
        width: '360px',
        fontFamily: '-apple-system,BlinkMacSystemFont,sans-serif',
        fontSize: '13px',
      }
    });

    const hdr = el('div', {
      style: {
        background: '#1a2e44',
        color: '#fff',
        padding: '10px 14px',
        borderRadius: '8px 8px 0 0',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        cursor: 'pointer',
      }
    });
    hdr.innerHTML = `<span><strong>📋 Bulk Add Job Categories</strong> <span style="opacity:.55;font-size:11px;font-weight:normal">v${VERSION}</span></span><span id="jl-bc-chev" style="font-size:16px">▾</span>`;

    const body = el('div', { id: 'jl-bc-body', style: { padding: '14px' } });

    body.innerHTML = `
      <p style="margin:0 0 4px;font-weight:600;color:#111">Category names (one per line)</p>
      <textarea id="jl-bc-ta" placeholder="e.g.&#10;Plumbing&#10;Electrical&#10;HVAC" style="width:100%;box-sizing:border-box;height:120px;border:1px solid #d1d5db;border-radius:4px;padding:6px 8px;font-size:12px;resize:vertical;font-family:monospace;margin-bottom:8px"></textarea>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <label for="jl-bc-color" style="font-size:12px;color:#374151;white-space:nowrap">Category colour:</label>
        <input id="jl-bc-color" type="color" value="#${DEFAULT_COLOR}" style="width:40px;height:28px;border:1px solid #d1d5db;border-radius:4px;cursor:pointer;padding:1px">
      </div>
      <div id="jl-bc-preview" style="min-height:16px;font-size:11px;color:#6b7280;margin-bottom:8px"></div>
      <button id="jl-bc-start" style="width:100%;padding:8px;background:#1a7a4a;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600">▶ Add All Categories</button>
      <div id="jl-bc-status" style="margin-top:10px;font-size:12px;display:none"></div>
    `;

    panel.appendChild(hdr);
    panel.appendChild(body);
    document.body.appendChild(panel);

    jlRegisterPanel(panel, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR);

    // Collapse toggle
    hdr.addEventListener('click', () => {
      const collapsed = body.style.display === 'none';
      body.style.display = collapsed ? '' : 'none';
      document.getElementById('jl-bc-chev').textContent = collapsed ? '▾' : '▸';
    });

    // Live preview
    const ta = document.getElementById('jl-bc-ta');
    const preview = document.getElementById('jl-bc-preview');
    ta.addEventListener('input', () => {
      const names = parseNames(ta.value);
      preview.textContent = names.length ? `${names.length} categor${names.length === 1 ? 'y' : 'ies'} to add` : '';
      preview.style.color = names.length ? '#059669' : '#6b7280';
    });

    // Start
    document.getElementById('jl-bc-start').addEventListener('click', () => startImport());
  }

  function parseNames(text) {
    return text.split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0);
  }

  async function startImport() {
    const names = parseNames(document.getElementById('jl-bc-ta').value);
    if (!names.length) { alert('Enter at least one category name.'); return; }

    const color = document.getElementById('jl-bc-color').value;
    const startBtn = document.getElementById('jl-bc-start');
    const status = document.getElementById('jl-bc-status');

    startBtn.disabled = true;
    startBtn.style.opacity = '0.6';
    startBtn.textContent = '⏳ Working…';
    status.style.display = 'block';
    status.innerHTML = '<span style="color:#374151">Fetching security token…</span>';

    let csrfToken;
    try {
      csrfToken = await getCsrfToken();
    } catch (err) {
      status.innerHTML = `<span style="color:#dc2626">❌ Could not get security token: ${err.message}</span>`;
      startBtn.disabled = false;
      startBtn.style.opacity = '';
      startBtn.textContent = '▶ Add All Categories';
      return;
    }

    let done = 0;
    let failed = [];

    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      status.innerHTML = `<span style="color:#374151">Adding <strong>${escHtml(name)}</strong> (${i + 1}/${names.length})…</span>`;
      try {
        await createCategory(name, color, csrfToken);
        done++;
      } catch (err) {
        failed.push({ name, error: err.message });
      }
      // Small delay to avoid hammering the server
      await new Promise(r => setTimeout(r, 300));
    }

    // Done
    startBtn.disabled = false;
    startBtn.style.opacity = '';
    startBtn.textContent = '▶ Add All Categories';

    let html = `<div style="padding:8px;border-radius:4px;border:1px solid;margin-bottom:6px;`;
    if (!failed.length) {
      html += `background:#f0fdf4;border-color:#bbf7d0;color:#166534">✅ All ${done} categor${done === 1 ? 'y' : 'ies'} added successfully!</div>`;
    } else {
      html += `background:#fef2f2;border-color:#fecaca;color:#991b1b">`;
      html += `✅ ${done} added · ❌ ${failed.length} failed<br>`;
      html += `<span style="font-size:11px">${failed.map(f => `${escHtml(f.name)}: ${escHtml(f.error)}`).join('<br>')}</span></div>`;
    }
    status.innerHTML = html;

    // Reload the category list
    if (done > 0) {
      const searchBtn = document.querySelector('button[type="submit"].jl-button-search') ||
                        Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Search');
      if (searchBtn) setTimeout(() => searchBtn.click(), 600);
    }
  }

  function escHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Init ─────────────────────────────────────────────────────────────────

  function init() {
    // Wait for the page chrome to settle, then inject
    setTimeout(injectPanel, 1200);
  }

  // Handle both direct load and hash-change navigation (Joblogic is a SPA-ish app)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.addEventListener('hashchange', () => {
    const existing = document.getElementById('jl-bulk-cats');
    if (existing) existing.remove();
    setTimeout(injectPanel, 800);
  });

})();
