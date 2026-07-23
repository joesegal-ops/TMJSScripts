// ==UserScript==
// @name         JL - Renew / Duplicate PPM Contracts (next year)
// @namespace    https://up-fm.com/joblogic
// @version      1.2.0
// @description  Bulk-renews (duplicates) a list of PPM Contracts into the next year using Joblogic's native Renew flow. Paste PM numbers (or plan references), one per line. For each contract it opens the Renew form, rolls the visits by the rule — MORE THAN 12 visits → 52 weeks later, otherwise → 365 days later — keeps Joblogic's +1-year start date, and posts to /api/PPMContract/RenewPPMContract. Preview (dry-run) first; nothing is created until you click Renew all and confirm.
// @match        https://go.joblogic.com/PPMContract
// @match        https://go.joblogic.com/PPMContract/*
// @run-at       document-idle
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20PPMs/ppm-renew-contracts.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20PPMs/ppm-renew-contracts.user.js
// ==/UserScript==

/*
 * WHAT THIS DOES
 *  - You paste a list of PPM contracts to renew (PM numbers like PM0001723, one per
 *    line — plan references also work). For each one it uses Joblogic's own "Renew PPM
 *    Contract" page (the same thing the Renew button opens) to create a duplicate for
 *    the next period.
 *  - The new contract keeps Joblogic's suggested start date (source start + 1 year) and
 *    everything the native Renew form carries over (visits, tasks, assets, invoices …).
 *  - The ONLY thing this script changes vs. clicking Renew by hand is the VISIT roll-on,
 *    per your rule:
 *        • more than 12 visits on the contract → roll visits 52 WEEKS later
 *        • 12 or fewer visits                  → roll visits 365 DAYS later
 *    (Invoice dates keep the native default roll — 365 days.)
 *  - Renew options (renew visits / tasks / assets / engineers / invoices, include
 *    action-required notes, consider leap year) are shown as tick-boxes, defaulted to
 *    Joblogic's own defaults. Change them before you run if you need to.
 *
 * HOW TO USE
 *  1. Open the PPM Contracts list (or any PPMContract page).
 *  2. Open "Renew PPM Contracts" from the Advanced Controls dock (top-right).
 *  3. Paste your PM numbers (one per line) and click Preview. This resolves each
 *     contract, counts its visits, and shows the roll it WILL apply — nothing is created.
 *  4. Review, then Renew all and confirm. Each renewal creates a NEW contract, so
 *     running twice creates DUPLICATES — the preview flags any that already look renewed.
 */

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

  const SCRIPT_ID = 'ppm-renew-contracts';
  const SCRIPT_LABEL = '🔁 Renew PPM Contracts';
  const SCRIPT_COLOR = '#ff7919';
  const SCRIPT_DESC = 'Paste a list of PPM contracts to duplicate into the next year (PM numbers like PM0001723, one per line — plan references also work). Each one is renewed through Joblogic\'s native Renew flow: it keeps Joblogic\'s +1-year start date and carries everything over, and rolls the VISITS by your rule — more than 12 visits → 52 weeks later, otherwise → 365 days later. Renew options default to Joblogic\'s defaults; adjust the tick-boxes if needed. Click Preview first (nothing is created); then Renew all and confirm. Each renewal creates a NEW contract — running twice makes duplicates.';

  // ----------------------------------------------------------------------------
  // CONFIG
  // ----------------------------------------------------------------------------
  const CFG = {
    renewPageUrl: '/PPMContract/Renew',                 // ?ppmContractId=<guid>  (GET → form HTML)
    renewApiUrl: '/api/PPMContract/RenewPPMContract',   // POST FormData
    searchUrl: '/api/PPMContract/SearchPPMContract',    // form-encoded search
    visitThreshold: 12,                                  // MORE THAN this ⇒ weeks roll
    rollManyVisits: { unit: 'Week', value: '52' },       // > threshold visits
    rollFewVisits: { unit: 'Day', value: '365' },        // <= threshold visits
    postDelayMs: 1500,                                   // pause between renewals (WAF)
    maxRetries: 3,
    backoffMs: [15000, 30000, 45000]
  };

  // Renew tick-box options, defaulted to Joblogic's own Renew-page defaults.
  // Each maps to a checkbox field name on the Renew form.
  const OPTIONS = [
    { key: 'RenewVisits', label: 'Renew visits', def: true },
    { key: 'RenewVisitTasks', label: 'Renew visit tasks', def: true },
    { key: 'RenewVisitAssets', label: 'Renew visit assets', def: true },
    { key: 'RenewVisitEngineers', label: 'Renew visit engineers (assign same engineer)', def: false },
    { key: 'RenewInvoices', label: 'Renew invoices (if invoiced)', def: true },
    { key: 'IncludeActionRequiredNotes', label: 'Include action-required notes', def: true },
    { key: 'IsLeapYearConsidered', label: 'Consider leap year on end date', def: false }
  ];

  // ----------------------------------------------------------------------------
  // PLUMBING
  // ----------------------------------------------------------------------------
  function getToken() {
    const el = document.querySelector('input[name="__RequestVerificationToken"]');
    return el ? el.value : null;
  }

  // Parse the pasted list → array of { term, isPM }.  One entry per non-blank line;
  // if a line contains a PMxxxxxxx token we search by that, else by the whole line.
  function parseList(text) {
    const out = [];
    const seen = new Set();
    String(text || '').split(/\r?\n/).forEach(line => {
      const raw = line.trim();
      if (!raw) return;
      const m = raw.match(/PM\d{4,}/i);
      const term = m ? m[0].toUpperCase() : raw;
      const key = term.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ term, isPM: !!m });
    });
    return out;
  }

  async function searchContracts(term) {
    const token = getToken();
    const r = await fetch(CFG.searchUrl, {
      method: 'POST',
      credentials: 'include',
      headers: Object.assign({ 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }, token ? { '__RequestVerificationToken': token } : {}),
      body: new URLSearchParams({ SearchTerm: term, PageNumber: 1, PageSize: 50 }).toString()
    });
    const d = await r.json().catch(() => null);
    return (d && d.AdditionalData && d.AdditionalData.PPMContracts) || [];
  }

  // term → the single matching source contract, or throws with a helpful message.
  async function resolveContract(entry) {
    const list = await searchContracts(entry.term);
    if (!list.length) throw new Error('no contract found matching "' + entry.term + '"');
    if (entry.isPM) {
      const hit = list.find(c => (c.PPMContractNumber || '').toUpperCase() === entry.term);
      if (!hit) throw new Error('no contract numbered ' + entry.term + ' (got ' + list.length + ' fuzzy result(s))');
      return hit;
    }
    // plan-reference / free text: prefer an exact PlanReference match
    const exact = list.filter(c => (c.PlanReference || '').trim().toLowerCase() === entry.term.trim().toLowerCase());
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) throw new Error(exact.length + ' contracts share plan reference "' + entry.term + '" — use the PM number instead');
    if (list.length === 1) return list[0];
    throw new Error('"' + entry.term + '" matched ' + list.length + ' contracts — use the PM number instead');
  }

  // Fetch + parse the native Renew page for a source contract guid.
  async function fetchRenewForm(guid) {
    const r = await fetch(CFG.renewPageUrl + '?ppmContractId=' + encodeURIComponent(guid), { credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    if (r.status !== 200) throw new Error('Renew page HTTP ' + r.status);
    const html = await r.text();
    if (/^\s*<(?:!doctype|html)[^>]*>\s*<head/i.test(html) && /login/i.test(html) && !/ppmRenewForm/i.test(html)) throw new Error('not logged in / session expired');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const form = doc.querySelector('form#ppmRenewForm');
    if (!form) throw new Error('Renew form not found (contract may not be renewable)');
    const val = sel => { const el = doc.querySelector(sel); return el ? (el.value || el.getAttribute('value') || '') : ''; };
    return {
      form,
      doc,
      startDate: val('#StartDate'),
      endDate: val('#EndDate'),
      planReference: val('#PlanReference'),
      billingType: val('input[name="BillingType"]'),
      token: val('input[name="__RequestVerificationToken"]'),
      visitCount: doc.querySelectorAll('tr.visitTableRow').length,
      invoiceCount: doc.querySelectorAll('tr.invoiceTableRow').length,
      hasField: name => !!form.querySelector('[name="' + name + '"]')
    };
  }

  // The visit roll this contract will get, from the count + rule.
  function rollFor(visitCount) {
    return visitCount > CFG.visitThreshold ? CFG.rollManyVisits : CFG.rollFewVisits;
  }
  const rollLabel = roll => roll.value + ' ' + roll.unit.toLowerCase() + (roll.value === '1' ? '' : 's');

  // Serialize a parsed (DOMParser'd) Renew form to FormData, replicating browser
  // form submission, with overrides:
  //   checks  {name:bool}    – force a checkbox on/off (affects the value= input only;
  //                            the paired hidden name=…,value=false is a plain hidden,
  //                            so it is always included — matches ASP.NET binding)
  //   radios  {name:value}   – within a radio group, include only this value
  //   values  {name:string}  – replace the value of a text/select field
  function serializeForm(form, { checks = {}, radios = {}, values = {} } = {}) {
    const fd = new FormData();
    form.querySelectorAll('input, select, textarea').forEach(el => {
      const name = el.getAttribute('name');
      if (!name || el.disabled) return;
      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute('type') || tag).toLowerCase();
      if (type === 'radio') {
        const v = el.getAttribute('value');
        if (name in radios) { if (radios[name] === v) fd.append(name, v); }
        else if (el.hasAttribute('checked')) fd.append(name, v);
        return;
      }
      if (type === 'checkbox') {
        const checked = (name in checks) ? checks[name] : el.hasAttribute('checked');
        if (checked) fd.append(name, el.getAttribute('value') || 'on');
        return;
      }
      if (tag === 'select') {
        const opt = el.querySelector('option[selected]') || el.querySelector('option');
        const v = opt ? (opt.getAttribute('value') != null ? opt.getAttribute('value') : opt.textContent) : '';
        fd.append(name, (name in values) ? values[name] : v);
        return;
      }
      const v = tag === 'textarea' ? el.textContent : (el.getAttribute('value') || '');
      fd.append(name, (name in values) ? values[name] : v);
    });
    return fd;
  }

  // Build the FormData for one renewal from a fetched form + the desired options/roll.
  function buildRenewBody(rf, optState, roll) {
    const checks = {};
    OPTIONS.forEach(o => { if (rf.hasField(o.key)) checks[o.key] = !!optState[o.key]; });
    const radios = {};
    const values = {};
    if (rf.hasField('RollOnUnit_Visits')) radios.RollOnUnit_Visits = roll.unit;
    if (rf.hasField('RollOnValue_Visits')) values.RollOnValue_Visits = roll.value;
    return serializeForm(rf.form, { checks, radios, values });
  }

  async function postRenew(fd, token) {
    if (token && !fd.get('__RequestVerificationToken')) fd.append('__RequestVerificationToken', token);
    const r = await fetch(CFG.renewApiUrl, {
      method: 'POST',
      credentials: 'include',
      headers: Object.assign({ 'X-Requested-With': 'XMLHttpRequest' }, token ? { '__RequestVerificationToken': token } : {}),
      body: fd
    });
    const raw = await r.text();
    let d = null; try { d = JSON.parse(raw); } catch (e) {}
    if (d && d.success) return { ok: true, id: d.AdditionalData, resp: d };
    const throttled = r.status === 403 || (!d && /^\s*<(?:!doctype|html)/i.test(raw));
    return { ok: false, status: r.status, throttled, resp: d, raw: raw.slice(0, 200) };
  }

  // Has this contract already been renewed to this plan ref + start date? (best-effort)
  async function alreadyRenewed(planRef, startDate) {
    try {
      const list = await searchContracts(planRef);
      return list.some(c => (c.PlanReference || '').trim().toLowerCase() === planRef.trim().toLowerCase() && (c.StartDate || '') === startDate);
    } catch (e) { return false; }
  }

  // ----------------------------------------------------------------------------
  // UI
  // ----------------------------------------------------------------------------
  const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  let running = false;

  function buildPanel() {
    const p = document.createElement('div');
    p.id = SCRIPT_ID + '-panel';
    p.style.cssText = 'position:fixed;top:70px;right:8px;z-index:99999;width:480px;max-height:86vh;overflow:auto;background:#fff;border:1px solid #c9d4da;border-radius:6px;box-shadow:0 4px 18px rgba(0,0,0,.25);font-family:"Open Sans",sans-serif;font-size:12px;color:#243b46;padding:12px;';
    const optRows = OPTIONS.map(o =>
      '<label style="display:flex;align-items:center;gap:6px;margin:2px 0;">' +
      '<input type="checkbox" id="rc-opt-' + o.key + '"' + (o.def ? ' checked' : '') + '> ' + esc(o.label) + '</label>'
    ).join('');
    p.innerHTML = `
      <div style="font-weight:700;font-size:14px;margin-bottom:8px;">🔁 Renew PPM Contracts <span style="font-weight:400;color:#888;">v1.2</span></div>
      <div style="background:#f4f6f9;border:1px solid #e2e7ee;border-radius:4px;padding:8px;margin-bottom:8px;line-height:1.55;">
        Duplicates each contract into the next year via Joblogic's native Renew.<br>
        <b>Visit roll:</b> &gt; ${CFG.visitThreshold} visits → <b>${rollLabel(CFG.rollManyVisits)}</b> later · otherwise → <b>${rollLabel(CFG.rollFewVisits)}</b> later.<br>
        Start date = Joblogic's suggestion (source start + 1 year). Invoice roll = native default.
      </div>
      <label style="display:block;margin-bottom:8px;">Paste PM numbers (one per line — plan references also work):<br>
        <textarea id="rc-list" spellcheck="false" placeholder="PM0001723&#10;PM0001724&#10;PM0001725" style="width:100%;height:110px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;white-space:pre;box-sizing:border-box;"></textarea>
      </label>
      <div style="margin-bottom:8px;border:1px solid #e2e7ee;border-radius:4px;padding:6px 8px;">
        <div style="font-weight:600;margin-bottom:4px;">Renew options <span style="font-weight:400;color:#888;">(Joblogic defaults)</span></div>
        ${optRows}
        <label style="display:flex;align-items:center;gap:6px;margin:2px 0;border-top:1px solid #eef1f5;padding-top:4px;">
          <input type="checkbox" id="rc-skip-suspended" checked> Skip suspended / cancelled contracts</label>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center;">
        <button id="rc-preview" class="jl-button-green" style="padding:5px 14px;">Preview</button>
        <button id="rc-renew" class="jl-button-green" style="padding:5px 14px;">Renew all</button>
        <button id="rc-copyfail" title="Copy the not-renewed rows as tab-separated text you can paste straight into Google Sheets" style="padding:5px 12px;margin-left:auto;background:#fff2e8;color:#8a4b00;border:1px solid #f0c39a;border-radius:4px;cursor:pointer;opacity:.5;" disabled>Copy failures</button>
        <button id="rc-copy" style="padding:5px 12px;background:#eef1f5;color:#243b46;border:1px solid #c9d4da;border-radius:4px;cursor:pointer;">Copy log</button>
      </div>
      <div id="rc-status" style="margin-bottom:6px;font-weight:600;"></div>
      <div id="rc-out" style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;line-height:1.5;max-height:40vh;overflow:auto;background:#fbfcfe;border:1px solid #e2e7ee;border-radius:4px;padding:8px;white-space:pre-wrap;">Paste PM numbers above, then click Preview — nothing is created.</div>`;
    document.body.appendChild(p);
    return p;
  }

  function init() {
    const panel = buildPanel();
    jlRegisterPanel(panel, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR, SCRIPT_DESC);

    const $ = id => panel.querySelector('#rc-' + id);
    const outEl = $('out'), statusEl = $('status');
    const prevBtn = $('preview'), goBtn = $('renew');
    const COL = { ok: '#1b7a3a', err: '#b71c1c', warn: '#9a6b00' };
    const status = (msg, cls) => { statusEl.textContent = msg; statusEl.style.color = cls ? COL[cls] : '#243b46'; };
    const log = (msg, cls) => { const s = document.createElement('span'); if (cls) s.style.color = COL[cls]; s.textContent = msg + '\n'; outEl.appendChild(s); outEl.scrollTop = outEl.scrollHeight; };
    const logHtml = html => { outEl.insertAdjacentHTML('beforeend', html); outEl.scrollTop = outEl.scrollHeight; };
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const optState = () => { const s = {}; OPTIONS.forEach(o => { s[o.key] = panel.querySelector('#rc-opt-' + o.key).checked; }); return s; };

    const failBtn = $('copyfail');
    let failTsv = '';
    const setFailTsv = tsv => {
      failTsv = tsv || '';
      failBtn.disabled = !failTsv;
      failBtn.style.opacity = failTsv ? '1' : '.5';
    };
    failBtn.onclick = () => { if (failTsv) navigator.clipboard.writeText(failTsv); };
    $('copy').onclick = () => { navigator.clipboard.writeText(outEl.textContent); };
    prevBtn.onclick = () => run(true);
    goBtn.onclick = () => run(false);

    async function run(dryRun) {
      if (running) return;
      const entries = parseList($('list').value);
      outEl.textContent = '';
      setFailTsv('');
      // Rows that did NOT renew — collected for the copy-to-Sheets summary.
      const report = [];
      const addReport = (term, pm, site, statusTxt, detail) => report.push({ term, pm: pm || '', site: site || '', status: statusTxt, detail: detail || '' });
      if (!entries.length) { status('Paste at least one PM number first.', 'err'); return; }
      if (!getToken()) log('! Anti-forgery token not found on page — try reloading if requests are rejected.', 'warn');
      log('Parsed ' + entries.length + ' contract(s) to renew.');
      const opts = optState();
      const skipSuspended = panel.querySelector('#rc-skip-suspended').checked;

      if (!dryRun) {
        const yes = window.confirm(
          'Renew (DUPLICATE) ' + entries.length + ' PPM contract(s) into the next year?\n\n' +
          'Visits roll: >' + CFG.visitThreshold + ' → ' + rollLabel(CFG.rollManyVisits) + ', else ' + rollLabel(CFG.rollFewVisits) + '.\n' +
          'Each creates a NEW contract. This cannot be undone in bulk.'
        );
        if (!yes) { status('Cancelled.', 'warn'); return; }
      }

      running = true; prevBtn.disabled = goBtn.disabled = true; prevBtn.style.opacity = goBtn.style.opacity = '.5';
      log(dryRun ? '── PREVIEW (dry run, nothing is created) ──' : '── RENEWING ──');

      let done = 0, failed = 0, skipped = 0;
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const tag = (i + 1) + '/' + entries.length + '  ' + entry.term;
        status((dryRun ? 'Checking ' : 'Renewing ') + (i + 1) + ' of ' + entries.length + '…');
        try {
          const src = await resolveContract(entry);
          const flag = src.IsCancelled ? 'cancelled' : (src.IsSuspended ? 'suspended' : '');
          if (flag && skipSuspended) {
            log('↷ ' + tag + ' — ' + src.PPMContractNumber + ' is ' + flag + '; skipped', 'warn');
            addReport(entry.term, src.PPMContractNumber, src.SiteName, flag.charAt(0).toUpperCase() + flag.slice(1) + ' (skipped)', '');
            skipped++; await sleep(200); continue;
          }
          const rf = await fetchRenewForm(src.UniqueId);
          const roll = rollFor(rf.visitCount);
          const info = src.PPMContractNumber + ' · ' + (src.SiteName || '') +
            (flag ? ' · ⚠ ' + flag.toUpperCase() : '') +
            ' · src ' + (src.StartDate || '?') + '→' + (src.EndDate || '?') +
            ' · ' + rf.visitCount + ' visit' + (rf.visitCount === 1 ? '' : 's') +
            (rf.invoiceCount ? ' / ' + rf.invoiceCount + ' invoice' + (rf.invoiceCount === 1 ? '' : 's') : '');

          const dup = await alreadyRenewed(rf.planReference, rf.startDate);

          if (dryRun) {
            log('• ' + tag, 'ok');
            log('    ' + info);
            log('    NEW: "' + rf.planReference + '"  start ' + rf.startDate + (rf.endDate ? ' → ' + rf.endDate : ''));
            log('    roll visits ' + rollLabel(roll) + ' later' + (rf.visitCount > CFG.visitThreshold ? '  (>' + CFG.visitThreshold + ' visits)' : ''));
            if (dup) { log('    ⚠ a contract with this plan ref + start date already exists — would DUPLICATE', 'warn'); addReport(entry.term, src.PPMContractNumber, src.SiteName, 'Would duplicate', 'plan ref "' + rf.planReference + '" + start ' + rf.startDate + ' already exists'); }
            continue;
          }

          if (dup) { log('↷ ' + tag + ' — already renewed (plan ref + start date exist); skipped', 'warn'); addReport(entry.term, src.PPMContractNumber, src.SiteName, 'Duplicate (skipped)', 'plan ref "' + rf.planReference + '" + start ' + rf.startDate + ' already exists'); skipped++; await sleep(300); continue; }

          let created = false, failReason = '';
          for (let attempt = 0; attempt <= CFG.maxRetries && !created; attempt++) {
            const fd = buildRenewBody(rf, opts, roll);
            const res = await postRenew(fd, rf.token || getToken());
            if (res.ok) {
              created = true;
              const url = res.id ? '/PPMContract/Detail/' + res.id : null;
              logHtml('<span style="color:' + COL.ok + '">✓ ' + esc(tag) + ' — renewed (' + esc(rollLabel(roll)) + ', ' + rf.visitCount + ' visits)</span>' +
                (url ? ' <a href="' + url + '" target="_blank" style="color:#1b6fb3;">open</a>' : '') + '\n');
              break;
            }
            // A WAF 403 may hide a real success — re-check by searching for the new ref.
            if (await alreadyRenewed(rf.planReference, rf.startDate)) {
              created = true;
              log('✓ ' + tag + ' — renewed (server confirmed after HTTP ' + res.status + ')', 'ok');
              break;
            }
            if (attempt < CFG.maxRetries && (res.throttled || !res.resp)) {
              const wait = CFG.backoffMs[Math.min(attempt, CFG.backoffMs.length - 1)];
              log('… ' + tag + ' — HTTP ' + res.status + ' (rate-limited); retrying in ' + Math.round(wait / 1000) + 's', 'warn');
              await sleep(wait);
            } else {
              failReason = 'HTTP ' + (res.status || '?') + (res.resp ? ' ' + JSON.stringify(res.resp).slice(0, 160) : (res.raw ? ' ' + res.raw : ''));
              log('✗ ' + tag + ' — FAILED (' + failReason + ')', 'err');
              break;
            }
          }
          if (created) done++;
          else { failed++; addReport(entry.term, src.PPMContractNumber, src.SiteName, 'Failed', failReason || 'renew did not confirm after ' + (CFG.maxRetries + 1) + ' attempt(s)'); }
          await sleep(CFG.postDelayMs);
        } catch (e) {
          failed++;
          const msg = (e && e.message ? e.message : String(e));
          log('✗ ' + tag + ' — ' + msg, 'err');
          addReport(entry.term, '', '', 'Error', msg);
        }
      }

      const tail = skipped ? (', ' + skipped + ' skipped') : '';
      status('Done: ' + done + ' ' + (dryRun ? 'to renew' : 'renewed') + ', ' + failed + ' problem(s)' + tail + '.', failed ? 'warn' : 'ok');
      log('── DONE: ' + done + ' ' + (dryRun ? 'to renew' : 'renewed') + ', ' + failed + ' problem(s)' + tail + ' ──', failed ? 'warn' : 'ok');

      // Copy-to-Sheets summary of every row that did NOT renew.
      if (report.length) {
        const cell = s => String(s == null ? '' : s).replace(/[\t\r\n]+/g, ' ').trim();
        const header = ['Input', 'PM Number', 'Site', 'Status', 'Detail'];
        const tsv = [header.join('\t')].concat(report.map(r => [r.term, r.pm, r.site, r.status, r.detail].map(cell).join('\t'))).join('\n');
        setFailTsv(tsv);
        log('');
        log(report.length + ' row(s) did not renew — click "Copy failures" to copy them (tab-separated) for Google Sheets:', 'warn');
        log(tsv);
      } else {
        log('No problems — nothing to copy.', 'ok');
      }

      if (dryRun && !failed) log('Preview looks clean. Click "Renew all" to proceed.', 'ok');
      running = false; prevBtn.disabled = goBtn.disabled = false; prevBtn.style.opacity = goBtn.style.opacity = '1';
    }
  }

  // ----------------------------------------------------------------------------
  // BOOT
  // ----------------------------------------------------------------------------
  let tries = 0;
  const boot = setInterval(() => {
    tries++;
    if (document.body || tries > 80) {
      clearInterval(boot);
      if (document.body && !document.getElementById(SCRIPT_ID + '-panel')) init();
    }
  }, 250);
})();
