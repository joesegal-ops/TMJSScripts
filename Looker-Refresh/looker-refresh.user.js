// ==UserScript==
// @name         Looker Studio Auto-Refresh
// @namespace    https://up-fm.com/
// @version      1.0.0
// @description  Automatically clicks the "Refresh data" button on Looker Studio / Data Studio reports on a configurable interval.
// @author       Joe Segal
// @match        https://datastudio.google.com/*
// @match        https://lookerstudio.google.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ---- Config -----------------------------------------------------------
    const DEFAULT_INTERVAL_MIN = 5;          // minutes between refreshes
    const CLICK_SETTLE_MS      = 800;         // wait after opening a menu before looking for the item

    // Persisted state (survives reloads)
    let enabled     = GM_getValue('lkr_enabled', false);
    let intervalMin = GM_getValue('lkr_interval', DEFAULT_INTERVAL_MIN);

    let timer = null;

    // ---- Refresh button finder --------------------------------------------
    // Looker Studio renders the toolbar with Material components; the exact
    // markup shifts between edit/view mode and releases, so we search broadly
    // by aria-label / title / visible text rather than a brittle fixed selector.
    const REFRESH_RE = /refresh (the )?data/i;

    function isVisible(el) {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return false;
        const s = getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
    }

    // Return the first clickable element whose label/title/text matches REFRESH_RE.
    function findRefreshTarget(requireVisible = true) {
        const candidates = document.querySelectorAll(
            'button, [role="button"], [role="menuitem"], [aria-label], [title], md-menu-item, .mat-mdc-menu-item'
        );
        for (const el of candidates) {
            const label = (el.getAttribute('aria-label') || '') + ' ' +
                          (el.getAttribute('title') || '') + ' ' +
                          (el.textContent || '');
            if (REFRESH_RE.test(label)) {
                if (!requireVisible || isVisible(el)) return el;
            }
        }
        return null;
    }

    // The "More options" / overflow menu that sometimes hides Refresh in view mode.
    function findOverflowMenuButton() {
        const candidates = document.querySelectorAll('button, [role="button"], [aria-label], [title]');
        for (const el of candidates) {
            const label = (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '');
            if (/more options|more_vert|overflow/i.test(label) && isVisible(el)) return el;
        }
        return null;
    }

    function fireClick(el) {
        // Full gesture — Material/Angular components frequently ignore a bare .click().
        for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
            el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
        }
    }

    async function refreshNow() {
        // 1) Try a directly-visible refresh control.
        let target = findRefreshTarget(true);
        if (target) {
            fireClick(target);
            status('Refreshed ✓');
            return true;
        }

        // 2) Fall back to opening the overflow menu, then clicking Refresh inside it.
        const menuBtn = findOverflowMenuButton();
        if (menuBtn) {
            fireClick(menuBtn);
            await new Promise(r => setTimeout(r, CLICK_SETTLE_MS));
            target = findRefreshTarget(true);
            if (target) {
                fireClick(target);
                status('Refreshed ✓');
                return true;
            }
            // Close the menu again so we don't leave it hanging open.
            document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        }

        status('Button not found ✗');
        return false;
    }

    // ---- Scheduling -------------------------------------------------------
    function reschedule() {
        if (timer) { clearInterval(timer); timer = null; }
        if (enabled) {
            timer = setInterval(refreshNow, Math.max(1, intervalMin) * 60 * 1000);
        }
        renderPanel();
    }

    // ---- UI ---------------------------------------------------------------
    let panel, statusEl, toggleBtn, intervalInput;

    function status(msg) {
        if (statusEl) {
            const t = new Date().toLocaleTimeString();
            statusEl.textContent = `${msg} @ ${t}`;
        }
    }

    function buildPanel() {
        panel = document.createElement('div');
        panel.style.cssText = [
            'position:fixed', 'bottom:16px', 'right:16px', 'z-index:2147483647',
            'background:#1f1f1f', 'color:#fff', 'font:12px/1.4 Roboto,Arial,sans-serif',
            'padding:10px 12px', 'border-radius:8px', 'box-shadow:0 2px 12px rgba(0,0,0,.4)',
            'width:210px', 'user-select:none'
        ].join(';');

        panel.innerHTML = `
            <div style="font-weight:600;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
                <span>Looker Auto-Refresh</span>
                <span id="lkr-close" style="cursor:pointer;opacity:.6">–</span>
            </div>
            <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px">
                <span>Every</span>
                <input id="lkr-interval" type="number" min="1" step="1"
                       style="width:52px;background:#333;color:#fff;border:1px solid #555;border-radius:4px;padding:2px 4px">
                <span>min</span>
            </div>
            <button id="lkr-toggle"
                    style="width:100%;padding:6px;border:0;border-radius:4px;cursor:pointer;font-weight:600"></button>
            <div style="display:flex;gap:6px;margin-top:6px">
                <button id="lkr-now"
                        style="flex:1;padding:5px;border:0;border-radius:4px;cursor:pointer;background:#3c4043;color:#fff">
                    Refresh now
                </button>
            </div>
            <div id="lkr-status" style="margin-top:8px;opacity:.7;min-height:14px"></div>
        `;
        document.body.appendChild(panel);

        statusEl      = panel.querySelector('#lkr-status');
        toggleBtn     = panel.querySelector('#lkr-toggle');
        intervalInput = panel.querySelector('#lkr-interval');

        intervalInput.value = intervalMin;
        intervalInput.addEventListener('change', () => {
            intervalMin = Math.max(1, parseInt(intervalInput.value, 10) || DEFAULT_INTERVAL_MIN);
            GM_setValue('lkr_interval', intervalMin);
            reschedule();
        });

        toggleBtn.addEventListener('click', () => {
            enabled = !enabled;
            GM_setValue('lkr_enabled', enabled);
            reschedule();
        });

        panel.querySelector('#lkr-now').addEventListener('click', refreshNow);

        // Collapse to a small pill.
        panel.querySelector('#lkr-close').addEventListener('click', () => {
            panel.style.display = 'none';
            const pill = document.createElement('div');
            pill.textContent = '⟳';
            pill.title = 'Looker Auto-Refresh';
            pill.style.cssText = [
                'position:fixed', 'bottom:16px', 'right:16px', 'z-index:2147483647',
                'background:#1f1f1f', 'color:#fff', 'width:34px', 'height:34px',
                'border-radius:50%', 'display:flex', 'align-items:center', 'justify-content:center',
                'cursor:pointer', 'box-shadow:0 2px 12px rgba(0,0,0,.4)', 'font-size:18px'
            ].join(';');
            pill.addEventListener('click', () => { pill.remove(); panel.style.display = 'block'; });
            document.body.appendChild(pill);
        });
    }

    function renderPanel() {
        if (!toggleBtn) return;
        toggleBtn.textContent   = enabled ? `On – every ${intervalMin} min` : 'Off';
        toggleBtn.style.background = enabled ? '#1a73e8' : '#5f6368';
        toggleBtn.style.color      = '#fff';
    }

    // ---- Boot -------------------------------------------------------------
    function init() {
        if (!document.body) { setTimeout(init, 500); return; }
        if (document.getElementById('lkr-status')) return; // already injected
        buildPanel();
        reschedule();
    }

    init();
})();
