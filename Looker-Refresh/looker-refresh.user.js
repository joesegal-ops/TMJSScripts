// ==UserScript==
// @name         Looker Studio Auto-Refresh
// @namespace    https://up-fm.com/
// @version      1.4.0
// @description  Automatically clicks the "Refresh data" button on Looker Studio / Data Studio reports on a configurable interval.
// @author       Joe Segal
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/Looker-Refresh/looker-refresh.user.js
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/Looker-Refresh/looker-refresh.user.js
// @match        https://datastudio.google.com/*
// @match        https://lookerstudio.google.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ---- Config -----------------------------------------------------------
    const VERSION = (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || '?';
    const DEFAULT_INTERVAL_MIN = 5;          // minutes between refreshes

    // Persisted state (survives reloads)
    let enabled     = GM_getValue('lkr_enabled', false);
    let intervalMin = GM_getValue('lkr_interval', DEFAULT_INTERVAL_MIN);

    let timer = null;

    // ---- Refresh button finder --------------------------------------------
    // Looker Studio renders a <refresh-button> containing a Material icon button
    // with aria-label="Refresh data". IMPORTANT: this button is deliberately kept
    // display:none ("hidden-refresh-button") in BOTH edit and view mode — Looker
    // drives it programmatically. Dispatching a click straight at it still fires
    // the handler and triggers a data refresh (verified live), so we must NOT gate
    // on visibility. We just match the aria-label and click it.
    const REFRESH_RE = /refresh (the )?data/i;

    function findRefreshTarget() {
        // Fast path: the exact control.
        const exact = document.querySelector('button[aria-label="Refresh data"]');
        if (exact) return exact;
        // Fallback: any button/role=button whose aria-label/title matches, ignoring
        // visibility (the button is normally hidden).
        for (const el of document.querySelectorAll('button, [role="button"]')) {
            const label = (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '');
            if (REFRESH_RE.test(label)) return el;
        }
        return null;
    }

    function fireClick(el) {
        // Native .click() is enough for this real <button> and — crucially — avoids
        // constructing a MouseEvent. Under TamperMonkey's sandbox `window` is not a
        // genuine Window, so `new MouseEvent(type, {view: window})` throws and would
        // silently abort the whole refresh. So prefer .click(); only fall back to
        // synthetic events (WITHOUT view) if .click() is somehow unavailable.
        try {
            el.click();
            return;
        } catch (e) { /* fall through */ }
        for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
            el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
        }
    }

    function refreshNow() {
        try {
            const target = findRefreshTarget();
            if (target) {
                fireClick(target);
                status('Refreshed ✓');
                return true;
            }
            status('Button not found ✗');
        } catch (e) {
            status('Error: ' + (e && e.message ? e.message : e));
            console.error('[Looker Auto-Refresh]', e);
        }
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
                <span>Looker Auto-Refresh <span style="opacity:.5;font-weight:400">v${VERSION}</span></span>
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
