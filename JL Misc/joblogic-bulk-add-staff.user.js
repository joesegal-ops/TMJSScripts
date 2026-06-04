// ==UserScript==
// @name         JL Bulk Add Staff
// @namespace    https://up-fm.com
// @version      1.13
// @description  Bulk-add staff to Joblogic by pasting Name/Email/Role from Google Sheets. v1.4: collapses to a launcher button in the shared dock (drag to reorder).
// @match        https://go.joblogic.com/Staff*
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Misc/joblogic-bulk-add-staff.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Misc/joblogic-bulk-add-staff.user.js
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

    const SCRIPT_ID = 'bulk-add-staff';
    const SCRIPT_LABEL = '👥 Bulk Add Staff';
    const SCRIPT_COLOR = '#072d3d';
    const SCRIPT_DESC = 'Bulk-adds staff from a Name / Email / Role list copied from Google Sheets. Paste the rows, then add.';

  const VERSION    = '1.3';
  const QUEUE_KEY  = 'jl_bs_queue';
  const DONE_KEY   = 'jl_bs_done';
  const FAILED_KEY = 'jl_bs_failed';
  const PROC_KEY   = 'jl_bs_processing';

  // Fields that mapDetails() serialises but we don't fill — must be '' not undefined
  const BLANK_FIELDS = ['Mobile','FullMobile','Telephone','FullTelephone',
                        'Address1','Address2','Address3','Address4',
                        'PostCode','OtherInformation','Reference'];

  // ── storage helpers ──────────────────────────────────────────────────────
  function load(key, fallback) {
    try { return JSON.parse(sessionStorage.getItem(key) ?? 'null') ?? fallback; }
    catch { return fallback; }
  }
  function save(key, val) { sessionStorage.setItem(key, JSON.stringify(val)); }
  function clear() {
    [QUEUE_KEY, DONE_KEY, FAILED_KEY, PROC_KEY].forEach(k => sessionStorage.removeItem(k));
  }

  function waitFor(fn, timeout = 10000, interval = 150) {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const id = setInterval(() => {
        const v = fn();
        if (v) { clearInterval(id); resolve(v); }
        else if (Date.now() - t0 > timeout) { clearInterval(id); reject(new Error('timeout')); }
      }, interval);
    });
  }

  // ── route dispatch ───────────────────────────────────────────────────────
  const path = location.pathname;

  if (path === '/Staff/CreateUser') return handleCreatePage();
  if (/^\/Staff\/Detail\//.test(path)) return handleDetailPage();
  if (/^\/Staff(\/|$|\?)/.test(path) || path === '/Staff') return injectPanel();

  // ── CREATE PAGE ──────────────────────────────────────────────────────────
  function handleCreatePage() {
    // Page reloaded mid-save → treat as failure to avoid silent duplicates
    if (load(PROC_KEY, null)) {
      const q = load(QUEUE_KEY, []);
      if (q[0]) markFailed(q[0], 'Page reloaded during save – check for duplicate');
      sessionStorage.removeItem(PROC_KEY);
      advanceQueue(q.slice(1));
      return;
    }

    const queue = load(QUEUE_KEY, []);
    if (!queue.length) return;

    const user    = queue[0];
    const doneLen = load(DONE_KEY, []).length;
    const failLen = load(FAILED_KEY, []).length;
    const total   = doneLen + failLen + queue.length;
    const current = doneLen + failLen + 1;

    injectProgressBanner(user, current, total);

    waitFor(() => {
      const el = document.querySelector('.initUsers');
      const vm = el?.__vue__;
      return (vm && vm.$data.RoleLists?.length > 0) ? vm : null;
    }).then(vm => {

      // Engineer → Mobile; everything else → Office
      const isMobile = /^engineer$/i.test(user.role.trim());
      if (isMobile) {
        if (!vm.$data.UserType.Mobile) document.getElementById('IsMobile')?.click();
      } else {
        if (!vm.$data.UserType.User) document.getElementById('IsUser')?.click();
      }

      // Wait for Vue to re-render after UserType click
      setTimeout(() => {
        vm.$set(vm.$data.Details, 'Name',  user.name);
        vm.$set(vm.$data.Details, 'Email', user.email);

        // Blank every field mapDetails() serialises so they're '' not 'undefined'
        BLANK_FIELDS.forEach(f => vm.$set(vm.$data.Details, f, ''));

        // Open the role vue-select dropdown
        const toggle = document.querySelector('.role-list .vs__dropdown-toggle');
        if (!toggle) {
          markFailed(user, 'Role dropdown not found after UserType click');
          advanceQueue(queue.slice(1));
          return;
        }
        ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach(evt =>
          toggle.dispatchEvent(new MouseEvent(evt, { bubbles: true, cancelable: true }))
        );

        // Wait for dropdown options to render
        setTimeout(() => {
          const want = user.role.toLowerCase().trim();
          const opts = document.querySelectorAll('.role-list .vs__dropdown-option');
          const opt  = Array.from(opts).find(o => o.textContent.trim().toLowerCase() === want);

          if (!opt) {
            document.body.click();
            const available = Array.from(opts).map(o => o.textContent.trim()).join(', ');
            markFailed(user, `Role "${user.role}" not found. Available: ${available || 'none visible'}`);
            advanceQueue(queue.slice(1));
            return;
          }

          // vue-select commits on mousedown (sets RolesSelected via @input handler)
          opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

          // Sync Role array (required by mapDetails validation) then save
          setTimeout(() => {
            if (vm.$data.RolesSelected) {
              vm.$data.Role = [vm.$data.RolesSelected];
            }

            save(PROC_KEY, '1');
            vm.addUserDetails();

            // Watch for URL change (success) or timeout (validation error kept us on page)
            const startUrl = location.href;
            let ticks = 0;
            const watchId = setInterval(() => {
              if (location.href !== startUrl) { clearInterval(watchId); return; }
              if (++ticks >= 50) {
                clearInterval(watchId);
                markFailed(user, 'Timed out – form may have a validation error');
                sessionStorage.removeItem(PROC_KEY);
                advanceQueue(queue.slice(1));
              }
            }, 200);
          }, 400);

        }, 400);

      }, 800);

    }).catch(() => {
      markFailed(queue[0], 'Vue VM not found on CreateUser page');
      advanceQueue(queue.slice(1));
    });
  }

  function injectProgressBanner(user, current, total) {
    const bar = document.createElement('div');
    bar.style.cssText = [
      'position:fixed','top:0','left:0','right:0','z-index:99999',
      'background:#1a2e44','color:#fff','padding:9px 16px',
      'font-family:-apple-system,BlinkMacSystemFont,sans-serif','font-size:13px',
      'display:flex','justify-content:space-between','align-items:center',
      'box-shadow:0 2px 8px rgba(0,0,0,.3)',
    ].join(';');
    bar.innerHTML = `
      <span>⏳ <strong>Bulk import</strong> — creating <strong>${user.name}</strong>
        <span style="opacity:.7">(${user.role})</span></span>
      <span style="opacity:.8;font-size:12px">user ${current} of ${total}</span>`;
    document.body.prepend(bar);
  }

  // ── DETAIL PAGE (successful save lands here) ─────────────────────────────
  function handleDetailPage() {
    if (!load(PROC_KEY, null)) return;
    sessionStorage.removeItem(PROC_KEY);

    const queue = load(QUEUE_KEY, []);
    if (!queue.length) return;

    const done = load(DONE_KEY, []);
    done.push(queue[0]);
    save(DONE_KEY, done);

    const remaining = queue.slice(1);
    save(QUEUE_KEY, remaining);

    setTimeout(() => {
      location.href = remaining.length ? '/Staff/CreateUser' : '/Staff';
    }, 300);
  }

  // ── helpers ──────────────────────────────────────────────────────────────
  function markFailed(user, error) {
    const failed = load(FAILED_KEY, []);
    failed.push({ ...user, error });
    save(FAILED_KEY, failed);
  }

  function advanceQueue(remaining) {
    save(QUEUE_KEY, remaining);
    setTimeout(() => { location.href = remaining.length ? '/Staff/CreateUser' : '/Staff'; }, 300);
  }

  // ── LIST PAGE: panel ─────────────────────────────────────────────────────
  function injectPanel() {
    const queue   = load(QUEUE_KEY,  []);
    const done    = load(DONE_KEY,   []);
    const failed  = load(FAILED_KEY, []);
    const running = queue.length > 0;

    const panel = document.createElement('div');
    panel.id = 'jl-bulk-staff';
    panel.style.cssText = [
      'position:fixed','bottom:20px','right:20px','z-index:99999',
      'background:#fff','border:1px solid #d1d5db','border-radius:8px',
      'box-shadow:0 4px 20px rgba(0,0,0,.15)','width:370px',
      'font-family:-apple-system,BlinkMacSystemFont,sans-serif','font-size:13px',
    ].join(';');

    const hdr = el('div', {
      style: 'background:#1a2e44;color:#fff;padding:10px 14px;border-radius:8px 8px 0 0;display:flex;justify-content:space-between;align-items:center;cursor:pointer',
      innerHTML: `<span><strong>📋 Bulk Add Staff</strong> <span style="opacity:.55;font-size:11px;font-weight:normal">v${VERSION}</span></span><span id="jl-bs-chev" style="font-size:16px">▾</span>`,
    });

    const body = el('div', { id: 'jl-bs-body', style: 'padding:14px' });

    if (running) {
      body.innerHTML = `
        <p style="margin:0 0 6px;color:#d97706;font-weight:600">⏳ Import in progress</p>
        <p style="margin:0 0 10px;color:#374151">${done.length} added · ${failed.length} failed · ${queue.length} remaining</p>
        <button id="jl-bs-cancel" style="${btnStyle('#dc3545')}">Cancel import</button>`;
    } else {
      const resultHtml = (done.length || failed.length) ? `
        <div style="margin-bottom:10px;padding:8px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:4px;font-size:12px">
          ✅ ${done.length} added${failed.length ? ` · ❌ ${failed.length} failed` : ''}
          ${failed.length ? `<br><span style="color:#dc2626">Failed: ${failed.map(f=>`${f.name} (${f.error})`).join(' · ')}</span>` : ''}
        </div>` : '';

      body.innerHTML = `
        ${resultHtml}
        <p style="margin:0 0 4px;font-weight:600;color:#111">Paste from Google Sheets</p>
        <p style="margin:0 0 8px;color:#6b7280;font-size:11px">
          Columns: <strong>Name · Email Address · Job Role</strong><br>
          Include/exclude a header row — it's detected automatically.<br>
          Roles: Administrator, Costing User, Engineer, Job Desk User
        </p>
        <textarea id="jl-bs-ta" placeholder="Paste rows here…" style="width:100%;box-sizing:border-box;height:130px;border:1px solid #d1d5db;border-radius:4px;padding:6px 8px;font-size:12px;resize:vertical;font-family:monospace"></textarea>
        <div id="jl-bs-preview" style="margin:5px 0 0;font-size:11px;color:#6b7280;min-height:16px"></div>
        <button id="jl-bs-start" style="margin-top:10px;${btnStyle('#1a7a4a')}">▶ Start import</button>
        ${(done.length || failed.length) ? `<button id="jl-bs-clear" style="margin-top:6px;${btnStyle('#6b7280', true)}">Clear results</button>` : ''}`;
    }

    panel.appendChild(hdr);
    panel.appendChild(body);
    document.body.appendChild(panel);

    jlRegisterPanel(panel, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR, SCRIPT_DESC);

    hdr.addEventListener('click', () => {
      const collapsed = body.style.display === 'none';
      body.style.display = collapsed ? '' : 'none';
      document.getElementById('jl-bs-chev').textContent = collapsed ? '▾' : '▸';
    });

    if (running) {
      document.getElementById('jl-bs-cancel').addEventListener('click', () => { clear(); location.reload(); });
      return;
    }

    const ta      = document.getElementById('jl-bs-ta');
    const preview = document.getElementById('jl-bs-preview');

    ta.addEventListener('input', () => {
      const rows = parsePaste(ta.value);
      const bad  = rows.filter(r => !r.name || !r.email || !r.role);
      if (!rows.length) { preview.textContent = ''; return; }
      preview.textContent = `${rows.length} user${rows.length !== 1 ? 's' : ''} detected${bad.length ? ` (${bad.length} incomplete)` : ''}`;
      preview.style.color = bad.length ? '#dc2626' : '#059669';
    });

    document.getElementById('jl-bs-start').addEventListener('click', () => {
      const rows  = parsePaste(ta.value);
      const valid = rows.filter(r => r.name && r.email && r.role);
      const bad   = rows.length - valid.length;
      if (!valid.length) { alert('No complete rows found.\nExpected columns: Name, Email Address, Job Role'); return; }
      if (bad && !confirm(`${bad} row(s) are missing fields and will be skipped.\nImport ${valid.length} user(s)?`)) return;
      clear();
      save(QUEUE_KEY, valid);
      save(DONE_KEY, []);
      save(FAILED_KEY, []);
      location.href = '/Staff/CreateUser';
    });

    document.getElementById('jl-bs-clear')?.addEventListener('click', () => { clear(); location.reload(); });
  }

  // ── paste parser ─────────────────────────────────────────────────────────
  function parsePaste(text) {
    const rows = text.trim().split('\n')
      .map(line => {
        const cols = line.split('\t');
        return { name: (cols[0]||'').trim(), email: (cols[1]||'').trim(), role: (cols[2]||'').trim() };
      })
      .filter(r => r.name || r.email || r.role);
    if (rows.length && /^name$/i.test(rows[0].name)) rows.shift();
    return rows;
  }

  function el(tag, props) { const e = document.createElement(tag); Object.assign(e, props); return e; }

  function btnStyle(bg, outline = false) {
    return outline
      ? 'width:100%;padding:6px;background:#f9fafb;color:#374151;border:1px solid #d1d5db;border-radius:4px;cursor:pointer;font-size:12px'
      : `width:100%;padding:8px;background:${bg};color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600`;
  }

})();
