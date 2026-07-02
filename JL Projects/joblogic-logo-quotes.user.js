// ==UserScript==
// @name         Joblogic - WeWork Member Logo Quotes (Monday → Quote → Email)
// @namespace    http://tampermonkey.net/
// @version      0.2.0
// @description  Pulls the "Members' logos Wework" Monday board, drops Artwork-Rejected items, and builds quotes from the "Logo - WeWork Member" template: one consolidated quote per site for WeWork-paid logos, one quote per logo for Member-paid. Per quote it sets the reference "Members Logos | MMMYY", rewrites the last description lines to "Office Number - Member Name", adds the site contact, sets the "per logo" quantity (sum) and "batch delivery cost" quantity (distinct logged weeks; 1 for member-paid), then Share→Email. Finally flips the Monday Financial Status to "Added To Quote". DRY-RUN by default: it stops at each email for you to review + Send, and only writes back to Monday after the email step. Collapses to a launcher in the shared dock.
// @match        https://go.joblogic.com/*
// @connect      api.monday.com
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Projects/joblogic-logo-quotes.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Projects/joblogic-logo-quotes.user.js
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

    const VERSION = (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) ? GM_info.script.version : '';
    const SCRIPT_ID = 'logo-quotes';
    const SCRIPT_LABEL = '🏷️ Logo Quotes';
    const SCRIPT_COLOR = '#7A4FBF';
    const SCRIPT_DESC = 'Build WeWork member-logo quotes from the Monday board. Load the board, review the plan (one quote per site for WeWork-paid, one per logo for member-paid), then run. DRY-RUN stops at each email for you to Send; Monday Financial Status is only set after the email step.';

    // ---- Monday board config (validated against board 5085864777) ----
    const MB = {
        boardId: '5085864777',
        col: {
            status:    'color_mkxpqdhg',        // Status (has "Artwork rejected")
            site:      'dropdown_mkxtdfay',      // Site (e.g. "1 Mark Square LON19")
            office:    'short_texttgw2o656',     // Office Number
            member:    'short_text1yjshdf2',     // Member Name
            qty:       'numbers5sb2pe8',         // Quantity Required
            logged:    'pulse_log_mky16syk',     // Date Logged (creation log)
            finance:   'color_mm0ahj9a',         // Financial Status (target: "Added To Quote")
            payer:     'single_select2dyoprb',   // Wework of Member Paid?
        },
        REJECTED: 'Artwork rejected',
        ONHOLD: 'ON HOLD',
        FIN_ADDED: 'Added To Quote',
        PAYER_WW: 'Wework Paid',
        PAYER_MEMBER: 'Member Paid',
    };

    // ---- Joblogic config ----
    const JL = {
        customerName: 'WeWork Ltd',
        customerId: '5595606',                  // WeWork Ltd (fallback; UI resolves by name too)
        templateName: 'Logo - WeWork Member',
        linePerLogo: "WW members' vinyl logo - per logo",
        lineBatch: "WW members' vinyl logo - batch delivery cost",
    };

    const STATE_KEY = 'jl-logo-quotes-state';
    const TOKEN_KEY = 'jl-logo-quotes-monday-token';   // stored via GM_setValue, NOT in the file
    const DELAY = 500;
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    // --- STATE (persisted across navigations) ---
    function loadState() { try { return JSON.parse(localStorage.getItem(STATE_KEY)); } catch (e) { return null; } }
    function saveState(s) { localStorage.setItem(STATE_KEY, JSON.stringify(s)); }
    function clearState() { localStorage.removeItem(STATE_KEY); }

    // --- UI refs ---
    let panel, tokenInput, autoSendCheck, planArea, logArea, progressText, loadBtn, startBtn, stopBtn, resetBtn, nextBtn;

    // =======================================================================
    // Small helpers
    // =======================================================================
    function getToken() { const el = document.querySelector('input[name="__RequestVerificationToken"]'); return el ? el.value : ''; }
    function log(msg, color) {
        if (!logArea) return;
        const line = document.createElement('div');
        if (color) line.style.color = color;
        line.textContent = msg;
        logArea.appendChild(line);
        logArea.scrollTop = logArea.scrollHeight;
    }
    function setProgress(t) { if (progressText) progressText.textContent = t || ''; }
    function waitFor(fn, timeout = 15000, interval = 200) {
        return new Promise((resolve, reject) => {
            const t0 = Date.now();
            (function poll() {
                let v; try { v = fn(); } catch (e) { v = null; }
                if (v) return resolve(v);
                if (Date.now() - t0 > timeout) return reject(new Error('timeout waiting for element'));
                setTimeout(poll, interval);
            })();
        });
    }
    function nativeSet(el, value) {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    // Month grouping/tagging from a Monday "date logged" string ("2026-05-27 …").
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    function monthKey(dateStr) { const m = String(dateStr || '').match(/(\d{4})-(\d{2})/); return m ? m[1] + '-' + m[2] : '0000-00'; }
    function monthTag(dateStr) { const m = String(dateStr || '').match(/(\d{4})-(\d{2})/); return m ? MONTHS[(+m[2]) - 1] + String((+m[1]) % 100).padStart(2, '0') : '??'; }
    // ISO year-week bucket from a Monday "date logged" string ("2026-01-27 13:21:53 UTC")
    function isoWeek(dateStr) {
        const m = String(dateStr || '').match(/(\d{4})-(\d{2})-(\d{2})/);
        if (!m) return null;
        const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
        const day = (d.getUTCDay() + 6) % 7;               // Mon=0..Sun=6
        d.setUTCDate(d.getUTCDate() - day + 3);            // nearest Thursday
        const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
        const week = 1 + Math.round(((d - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
        return d.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
    }
    // Contact name = site label without the trailing WeWork location code.
    // "1 Mark Square LON19" -> "1 Mark Square"; "17 St Helen's Place WE-GB-10735" -> "17 St Helen's Place"
    function contactNameFromSite(siteLabel) {
        return String(siteLabel || '').replace(/\s+(?:WE-[A-Z]{2}-\d+|[A-Z]{2,4}\d{1,4})\s*$/, '').trim();
    }

    // =======================================================================
    // Monday API (cross-origin via GM_xmlhttpRequest; token from GM storage)
    // =======================================================================
    function mondayToken() { try { return GM_getValue(TOKEN_KEY, '') || ''; } catch (e) { return ''; } }
    function mondayQuery(query, variables) {
        const token = mondayToken();
        if (!token) return Promise.reject(new Error('No Monday API token saved. Paste one in the panel first.'));
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: 'https://api.monday.com/v2',
                headers: { 'Content-Type': 'application/json', 'Authorization': token, 'API-Version': '2024-10' },
                data: JSON.stringify({ query, variables: variables || {} }),
                onload: (r) => {
                    try {
                        const j = JSON.parse(r.responseText);
                        if (j.errors) return reject(new Error('Monday API: ' + JSON.stringify(j.errors).slice(0, 300)));
                        resolve(j.data);
                    } catch (e) { reject(new Error('Monday API bad response: ' + r.responseText.slice(0, 200))); }
                },
                onerror: () => reject(new Error('Monday API network error')),
            });
        });
    }
    // Pull every item + the columns we need (paginates).
    async function fetchBoardItems() {
        const colIds = Object.values(MB.col);
        const q = `query ($board: ID!, $cursor: String, $cols: [String!]) {
            boards(ids: [$board]) {
                items_page(limit: 250, cursor: $cursor) {
                    cursor
                    items {
                        id name
                        column_values(ids: $cols) { id text }
                    }
                }
            }
        }`;
        let cursor = null, all = [];
        do {
            const data = await mondayQuery(q, { board: MB.boardId, cursor, cols: colIds });
            const page = data.boards[0].items_page;
            for (const it of page.items) {
                const cv = {};
                for (const c of it.column_values) cv[c.id] = c.text || '';
                all.push({ id: it.id, name: it.name, cv });
            }
            cursor = page.cursor;
        } while (cursor);
        return all;
    }
    // Set an item's Financial Status to "Added To Quote".
    async function setFinancialAdded(itemId) {
        const q = `mutation ($board: ID!, $item: ID!, $val: JSON!) {
            change_column_value(board_id: $board, item_id: $item, column_id: "${MB.col.finance}", value: $val) { id }
        }`;
        await mondayQuery(q, { board: MB.boardId, item: itemId, val: JSON.stringify({ label: MB.FIN_ADDED }) });
    }

    // =======================================================================
    // Build the plan from board items
    // =======================================================================
    function lineOf(it) {
        return `${(it.cv[MB.col.office] || '').trim()} - ${(it.cv[MB.col.member] || '').trim()}`.replace(/^ - | - $/g, '').trim();
    }
    function buildPlan(items) {
        const included = items.filter(it =>
            (it.cv[MB.col.status] || '') !== MB.REJECTED &&
            (it.cv[MB.col.status] || '') !== MB.ONHOLD &&
            (it.cv[MB.col.finance] || '').trim() === ''            // un-quoted only
        );

        const quotes = [];
        // ---- WeWork-paid: one quote per site PER MONTH (of Date Logged) ----
        const ww = included.filter(it => (it.cv[MB.col.payer] || '') === MB.PAYER_WW);
        const groups = {};
        for (const it of ww) {
            const key = (it.cv[MB.col.site] || '(no site)') + ' @@ ' + monthKey(it.cv[MB.col.logged]);
            (groups[key] = groups[key] || []).push(it);
        }
        Object.keys(groups).sort().forEach(key => {
            const group = groups[key];
            const site = group[0].cv[MB.col.site] || '(no site)';
            const mKey = monthKey(group[0].cv[MB.col.logged]);
            const perLogoQty = group.reduce((a, it) => a + (parseFloat(it.cv[MB.col.qty]) || 0), 0);
            const weeks = [...new Set(group.map(it => isoWeek(it.cv[MB.col.logged])).filter(Boolean))];
            quotes.push({
                kind: 'ww', site, siteLabel: site, month: mKey, contact: contactNameFromSite(site),
                reference: 'Members Logos | ' + monthTag(group[0].cv[MB.col.logged]),
                lines: group.map(lineOf),
                perLogoQty, batchQty: weeks.length || 1, weeks,
                itemIds: group.map(it => it.id),
                phase: 'pending', quoteId: null,
            });
        });
        // ---- Member-paid: one quote per logo (its own month) ----
        const mp = included.filter(it => (it.cv[MB.col.payer] || '') === MB.PAYER_MEMBER);
        for (const it of mp) {
            quotes.push({
                kind: 'member', site: it.cv[MB.col.site] || '(no site)', siteLabel: it.cv[MB.col.site] || '(no site)',
                month: monthKey(it.cv[MB.col.logged]), contact: contactNameFromSite(it.cv[MB.col.site] || ''),
                reference: 'Members Logos | ' + monthTag(it.cv[MB.col.logged]),
                lines: [lineOf(it), 'Member-paid logo'],
                perLogoQty: parseFloat(it.cv[MB.col.qty]) || 1, batchQty: 1, weeks: [isoWeek(it.cv[MB.col.logged])].filter(Boolean),
                itemIds: [it.id],
                phase: 'pending', quoteId: null,
            });
        }
        return { quotes, skipped: items.length - included.length, total: items.length };
    }

    // =======================================================================
    // Joblogic quote description rewrite
    //  Template description ends with:  "Logo x " / "Member 1:" / "Member 2:" / "Member 3:"
    //  We drop the last three (Member N:) lines and append one line per logo.
    // =======================================================================
    function rewriteDescription(templateDesc, lines) {
        const rows = String(templateDesc || '').split('\n');
        // strip trailing blank + the placeholder "Member N:" lines
        while (rows.length && /^\s*(Member\s*\d+\s*:|)\s*$/i.test(rows[rows.length - 1])) rows.pop();
        return rows.join('\n').replace(/\s+$/, '') + '\n' + lines.join('\n') + '\n';
    }

    // =======================================================================
    // ============  JL UI DRIVERS  (need a live dry-run shakedown)  =========
    //  Each of these drives a real Joblogic Vue/Kendo widget. They are built
    //  from the mapped DOM but the intricate widgets (jl-select, contact modal,
    //  price-edit modal, email composer) are best tuned on the first live run.
    //  They log loudly and throw on trouble so the driver stops on a known step.
    // =======================================================================

    // Drive a JL custom "jl-select" combobox: type text, wait for the list, click the match.
    async function pickJlSelect(rootSel, text, matchFn) {
        const root = await waitFor(() => document.querySelector(rootSel));
        const search = root.querySelector('input.jl__search, input[type="search"]');
        if (!search) throw new Error('jl-select search input not found: ' + rootSel);
        search.focus();
        nativeSet(search, text);
        search.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: text.slice(-1) }));
        // wait for options to load
        const ul = root.querySelector('ul[role="listbox"]') || document.querySelector('[id$="__listbox"]');
        const opt = await waitFor(() => {
            const list = root.querySelector('ul[role="listbox"]');
            if (!list) return null;
            const items = [...list.querySelectorAll('li')];
            const m = items.find(li => (matchFn ? matchFn(li.textContent.trim()) : li.textContent.trim().toLowerCase().includes(text.toLowerCase())));
            return m || null;
        }, 12000);
        opt.click();
        await sleep(300);
        return true;
    }

    // Create the quote from template on /Quote/Create, then submit → /Quote/Detail/{id}.
    async function jlCreateQuote(q) {
        if (!/\/Quote\/Create/i.test(location.pathname)) { location.href = '/Quote/Create'; return 'navigating'; }
        setProgress(`Creating quote — ${q.site}`);
        // 1. Customer
        await pickJlSelect('#jl-select-customerjob_id, [id*="customerjob"]', JL.customerName,
            t => t.toLowerCase().includes('wework'));
        await sleep(400);
        // 2. Site (JL site name == Monday label)
        await pickJlSelect('#jl-select-sitejob_id, [id*="sitejob"]', q.siteLabel,
            t => t.trim().toLowerCase() === q.siteLabel.trim().toLowerCase());
        await sleep(400);
        // 3. Toggle "Log Quote from Template" ON
        const toggle = document.querySelector('#quoteTemplateVM label.jl-toggle-enable');
        if (toggle && (document.querySelector('#jl-switch-isapplyquote') || {}).value !== 'true') {
            toggle.click();
            await sleep(500);
        }
        // 4. Pick the template
        await pickJlSelect('#quoteTemplateVM .jl-select, #jl3__combobox', JL.templateName,
            t => t.trim().toLowerCase() === JL.templateName.toLowerCase());
        await sleep(500);
        // 5. Submit
        const submit = [...document.querySelectorAll('button,a,input[type=submit]')]
            .find(b => /^\s*(save|log quote|create)\s*$/i.test((b.innerText || b.value || '').trim()));
        if (!submit) throw new Error('Create/Save button not found on /Quote/Create');
        submit.click();
        return 'submitted'; // page will navigate to /Quote/Detail/{id}; boot() resumes there
    }

    // On /Quote/Detail/{id}: set reference + rewrite description, then Save.
    async function jlFillDetail(q) {
        const descEl = await waitFor(() => document.querySelector('#quote-detail-form-description'));
        const refEl = document.querySelector('[name="CustomReference"]');
        if (refEl) nativeSet(refEl, q.reference);
        nativeSet(descEl, rewriteDescription(descEl.value, q.lines));
        await sleep(300);
        // Save (detail tab). The detail Save is a plain "Save" button (not the modal #btnSave).
        const save = [...document.querySelectorAll('button')].find(b => /^\s*save\s*$/i.test((b.innerText || '').trim()) && !b.closest('.modal'));
        if (!save) throw new Error('Detail Save button not found');
        save.click();
        await sleep(1500);
        return true;
    }

    // Contacts tab: add the site contact (name ~ site name).
    async function jlAddContact(q) {
        const tab = [...document.querySelectorAll('a[href="#contactsTab"]')][0];
        if (tab) { tab.click(); await sleep(800); }
        // TODO(live): confirm the "Add contact" affordance + assign-existing vs create modal.
        // Expected: an "Add Contact" button opens a picker; choose the contact whose name
        // matches q.contact. Endpoints seen on create page: /Contact/GetContactsToAssignForLog,
        // /Contact/CreateContactModal.
        const addBtn = [...document.querySelectorAll('#contactsTab a,#contactsTab button')]
            .find(b => /add.*contact|assign.*contact|add contact/i.test((b.innerText || '') + (b.title || '')));
        if (!addBtn) { log('   ⚠ contacts: "Add contact" control not found — add "' + q.contact + '" manually', '#fd0'); return false; }
        addBtn.click();
        await sleep(800);
        log('   contacts: opened add-contact for "' + q.contact + '" (verify + confirm on first run)', '#8fd');
        return true;
    }

    // Prices tab: set quantities on the two vinyl-logo lines via the edit modal.
    async function jlSetPrices(q) {
        const tab = [...document.querySelectorAll('a[href="#priceTab"]')][0];
        if (tab) { tab.click(); await sleep(1000); }
        await setLineQty(JL.linePerLogo, q.perLogoQty);
        await setLineQty(JL.lineBatch, q.batchQty);
        return true;
    }
    async function setLineQty(lineText, qty) {
        const pt = document.querySelector('#priceTab');
        const row = [...pt.querySelectorAll('tr')].find(r => r.textContent.toLowerCase().includes(lineText.toLowerCase()));
        if (!row) throw new Error('Price line not found: "' + lineText + '"');
        const edit = row.querySelector('a.quotecost_edit, .quotecost_add_edit');
        if (!edit) throw new Error('Edit affordance not found for line: "' + lineText + '"');
        edit.click();
        // The edit modal loads its Quantity field asynchronously.
        const qEl = await waitFor(() => {
            const m = [...document.querySelectorAll('.modal')].filter(x => x.offsetParent !== null).pop();
            if (!m) return null;
            return m.querySelector('input[name*="uantity" i], input[id*="uantity" i], input.jl-quantity');
        }, 12000);
        nativeSet(qEl, String(qty));
        await sleep(300);
        const modal = qEl.closest('.modal');
        const save = [...modal.querySelectorAll('button,a,input[type=submit]')].find(b => /save|update|ok|apply|add/i.test(b.innerText || b.value || ''));
        if (!save) throw new Error('Save button not found in line-edit modal');
        save.click();
        await sleep(1200);
        log(`   price: "${lineText}" qty=${qty}`, '#8fd');
        return true;
    }

    // Share → Email. In dry-run we open the composer and stop for manual Send.
    async function jlOpenEmail(q, autoSend) {
        const quoteId = q.quoteId || (location.pathname.match(/\/Quote\/Detail\/(\d+)/) || [])[1];
        if (typeof window.onClickShareEmail === 'function') {
            window.onClickShareEmail('/Quote/Email/' + quoteId);
        } else {
            const btn = [...document.querySelectorAll('a,button')].find(b => /^\s*email\s*$/i.test((b.innerText || '').trim()));
            if (!btn) throw new Error('Email button not found');
            btn.click();
        }
        const ok = await waitFor(() => {
            const m = [...document.querySelectorAll('.modal')].filter(x => x.offsetParent !== null).pop();
            return m && (m.querySelector('#sendEmailButton, button.send, [id*="send" i]')) ? m : null;
        }, 15000);
        // Recipient should default to the site contact we added. Leave JL's default in place.
        if (autoSend) {
            const send = ok.querySelector('#sendEmailButton') || [...ok.querySelectorAll('button')].find(b => /send/i.test(b.innerText));
            if (send) send.click();
            await sleep(2000);
            return 'sent';
        }
        return 'composed';
    }

    // =======================================================================
    // The sequential driver — resumes on every JL page load via boot().
    // =======================================================================
    async function drive() {
        let s = loadState();
        if (!s || !s.running) return;
        if (s.idx >= s.quotes.length) { finishRun(s); return; }
        const q = s.quotes[s.idx];
        try {
            // If we're on a fresh quote and not yet on the detail page, kick off create.
            if (q.phase === 'pending') {
                setProgress(`Quote ${s.idx + 1}/${s.quotes.length}: ${q.site} — creating`);
                log(`▶ [${s.idx + 1}/${s.quotes.length}] ${q.kind === 'member' ? 'MEMBER' : 'SITE'}: ${q.site}  (perLogo ${q.perLogoQty}, batch ${q.batchQty})`, '#0af');
                const r = await jlCreateQuote(q);
                if (r === 'navigating') return;   // navigating to /Quote/Create; boot() re-enters
                if (r === 'submitted') return;     // navigating to /Quote/Detail; boot() re-enters
            }
            // On the detail page: capture the quote id, then run the remaining phases.
            const detMatch = location.pathname.match(/\/Quote\/Detail\/(\d+)/);
            if (detMatch) {
                if (!q.quoteId) { q.quoteId = detMatch[1]; commitQuote(s.idx, q); }
                if (q.phase === 'pending') { q.phase = 'detail'; commitQuote(s.idx, q); }

                if (q.phase === 'detail') { await jlFillDetail(q); log('   details saved', '#8fd'); q.phase = 'contacts'; commitQuote(s.idx, q); }
                if (q.phase === 'contacts') { await jlAddContact(q); q.phase = 'prices'; commitQuote(s.idx, q); }
                if (q.phase === 'prices') { await jlSetPrices(q); q.phase = 'email'; commitQuote(s.idx, q); }
                if (q.phase === 'email') {
                    const res = await jlOpenEmail(q, loadState().autoSend);
                    if (res === 'composed') {
                        q.phase = 'awaiting-send'; commitQuote(s.idx, q);
                        setProgress(`Review the email for ${q.site}, click Send, then press "Sent → Next ▶".`);
                        showNext(true);
                        return;
                    }
                    q.phase = 'monday'; commitQuote(s.idx, q);
                }
                if (q.phase === 'monday') { await writeMonday(q); q.phase = 'done'; commitQuote(s.idx, q); }
                if (q.phase === 'done') { advance(); }
            }
        } catch (e) {
            q.error = e.message; q.phase = q.phase + ':error'; commitQuote(s.idx, q);
            log(`   ✗ ${q.site}: ${e.message}`, '#f55');
            setProgress(`Stopped on "${q.site}" at ${q.phase}. Fix/complete manually, then press "Sent → Next ▶" to continue.`);
            showNext(true);
        }
    }
    async function writeMonday(q) {
        for (const id of q.itemIds) { await setFinancialAdded(id); await sleep(200); }
        log(`   Monday: set ${q.itemIds.length} item(s) → "${MB.FIN_ADDED}"`, '#0fa');
    }
    function commitQuote(idx, q) { const s = loadState(); if (!s) return; s.quotes[idx] = q; saveState(s); renderPlan(s); }
    function advance() {
        const s = loadState(); if (!s) return;
        s.idx += 1; saveState(s); showNext(false);
        if (s.idx >= s.quotes.length) { finishRun(s); return; }
        // next quote starts by navigating to /Quote/Create
        location.href = '/Quote/Create';
    }
    function finishRun(s) {
        s.running = false; saveState(s);
        setProgress(`Done. ${s.quotes.filter(q => q.phase === 'done').length}/${s.quotes.length} quotes completed.`);
        log('✔ Run finished.', '#0fa');
        showNext(false);
    }

    // =======================================================================
    // UI panel
    // =======================================================================
    function showNext(on) { if (nextBtn) nextBtn.style.display = on ? 'inline-block' : 'none'; }
    function renderPlan(s) {
        if (!planArea) return;
        if (!s || !s.quotes || !s.quotes.length) { planArea.innerHTML = '<div style="color:#9ab;">No plan loaded.</div>'; return; }
        const rows = s.quotes.map((q, i) => {
            const mark = q.phase === 'done' ? '✅' : /error/.test(q.phase) ? '⚠️' : (i === s.idx && s.running) ? '⏳' : '·';
            const lines = q.lines.join(' · ').slice(0, 80);
            return `<tr style="border-top:1px solid #14415a;${i === s.idx && s.running ? 'background:#123;' : ''}">
                <td style="padding:3px 5px;">${mark}</td>
                <td style="padding:3px 5px;">${q.kind === 'member' ? '👤' : '🏢'}</td>
                <td style="padding:3px 5px;white-space:nowrap;">${q.site}</td>
                <td style="padding:3px 5px;white-space:nowrap;color:#9cf;">${(q.reference || '').replace('Members Logos | ', '')}</td>
                <td style="padding:3px 5px;text-align:center;">${q.perLogoQty}</td>
                <td style="padding:3px 5px;text-align:center;">${q.batchQty}</td>
                <td style="padding:3px 5px;color:#9cf;">${q.contact}</td>
                <td style="padding:3px 5px;color:#9ab;font-size:10px;">${lines}</td>
                <td style="padding:3px 5px;color:${/error/.test(q.phase) ? '#f88' : '#8fd'};font-size:10px;">${q.phase}${q.error ? ' — ' + q.error : ''}</td>
            </tr>`;
        }).join('');
        const wwn = s.quotes.filter(q => q.kind === 'ww').length, mpn = s.quotes.length - wwn;
        planArea.innerHTML = `<div style="color:#cde;margin-bottom:4px;"><b>${s.quotes.length}</b> quotes (${wwn} site×month, ${mpn} member) · ${s.skipped} skipped of ${s.total}</div>
            <table style="width:100%;border-collapse:collapse;font-size:11px;color:#dbe7ee;">
            <tr style="color:#7fb0c7;text-align:left;"><th></th><th></th><th>Site</th><th>Month</th><th>PerLogo</th><th>Batch</th><th>Contact</th><th>Lines</th><th>Phase</th></tr>
            ${rows}</table>`;
    }

    function buildPanel() {
        panel = document.createElement('div');
        panel.style.cssText = 'position:fixed;top:120px;right:8px;width:640px;max-height:78vh;overflow:auto;z-index:99999;background:#0a2231;color:#e7eef2;border:1px solid #14415a;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.4);font-family:"Open Sans",sans-serif;font-size:12px;padding:12px;';
        panel.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <b style="font-size:14px;">🏷️ WeWork Logo Quotes <span style="color:#7fb0c7;font-weight:400;">v${VERSION}</span></b>
            </div>
            <div style="background:#3a1f1f;border-left:3px solid #ff7919;padding:7px 9px;border-radius:4px;font-size:11px;line-height:1.4;margin-bottom:8px;">
                <b>First-run shakedown:</b> the Monday side is validated; the Joblogic write steps (customer/site/template pickers, contact, price modal, email) should be watched on the first quote and tuned. Keep <b>Auto-send OFF</b> until confirmed. Nothing writes to Monday until after the email step.
            </div>
            <div style="margin-bottom:6px;">
                <label>Monday API token <span style="color:#9ab;">(stored locally, never in the file)</span></label>
                <input id="lq-token" type="password" placeholder="paste token…" style="width:100%;box-sizing:border-box;padding:5px;background:#06202d;color:#cfe;border:1px solid #14415a;border-radius:4px;">
            </div>
            <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px;">
                <span style="color:#9ab;">Reference month is derived per quote from Date Logged (one quote per site per month).</span>
                <label><input id="lq-autosend" type="checkbox"> Auto-send emails</label>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">
                <button id="lq-load" style="background:#0b6e99;color:#fff;border:0;border-radius:4px;padding:6px 12px;cursor:pointer;">1 ▸ Load from Monday</button>
                <button id="lq-start" style="background:#1a8f4a;color:#fff;border:0;border-radius:4px;padding:6px 12px;cursor:pointer;">2 ▸ Start run</button>
                <button id="lq-next" style="display:none;background:#c67a00;color:#fff;border:0;border-radius:4px;padding:6px 12px;cursor:pointer;">Sent → Next ▶</button>
                <button id="lq-stop" style="background:#8a1f2f;color:#fff;border:0;border-radius:4px;padding:6px 12px;cursor:pointer;">Stop</button>
                <button id="lq-reset" style="background:#3a4a55;color:#fff;border:0;border-radius:4px;padding:6px 12px;cursor:pointer;">Reset</button>
            </div>
            <div id="lq-progress" style="color:#ffd27f;margin-bottom:6px;min-height:16px;"></div>
            <div id="lq-plan" style="margin-bottom:8px;"></div>
            <div id="lq-log" style="background:#06202d;border:1px solid #14415a;border-radius:4px;padding:6px;height:160px;overflow:auto;font-family:monospace;font-size:11px;line-height:1.4;"></div>
        `;
        document.body.appendChild(panel);

        tokenInput = panel.querySelector('#lq-token');
        autoSendCheck = panel.querySelector('#lq-autosend');
        planArea = panel.querySelector('#lq-plan');
        logArea = panel.querySelector('#lq-log');
        progressText = panel.querySelector('#lq-progress');
        loadBtn = panel.querySelector('#lq-load');
        startBtn = panel.querySelector('#lq-start');
        stopBtn = panel.querySelector('#lq-stop');
        resetBtn = panel.querySelector('#lq-reset');
        nextBtn = panel.querySelector('#lq-next');

        if (mondayToken()) tokenInput.placeholder = '•••• saved ••••';
        tokenInput.addEventListener('change', () => { if (tokenInput.value.trim()) { GM_setValue(TOKEN_KEY, tokenInput.value.trim()); tokenInput.value = ''; tokenInput.placeholder = '•••• saved ••••'; log('Monday token saved.', '#8fd'); } });

        loadBtn.addEventListener('click', onLoad);
        startBtn.addEventListener('click', onStart);
        stopBtn.addEventListener('click', () => { const s = loadState(); if (s) { s.running = false; saveState(s); } setProgress('Stopped.'); log('Stopped by user.', '#fd0'); });
        resetBtn.addEventListener('click', () => { clearState(); planArea.innerHTML = ''; setProgress(''); log('State cleared.', '#fd0'); });
        nextBtn.addEventListener('click', onNext);

        jlRegisterPanel(panel, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR, SCRIPT_DESC);
    }

    async function onLoad() {
        try {
            setProgress('Loading board from Monday…');
            log('Fetching board ' + MB.boardId + '…', '#0af');
            const items = await fetchBoardItems();
            log(`Fetched ${items.length} items.`, '#8fd');
            const plan = buildPlan(items);
            const s = { running: false, idx: 0, autoSend: autoSendCheck.checked, ...plan };
            saveState(s);
            renderPlan(s);
            const wwn = plan.quotes.filter(q => q.kind === 'ww').length, mpn = plan.quotes.filter(q => q.kind === 'member').length;
            setProgress(`Plan ready: ${plan.quotes.length} quotes (${wwn} site×month / ${mpn} member). Review, then Start.`);
            log(`Plan: ${wwn} WeWork-paid site×month quotes + ${mpn} member-paid quotes. ${plan.skipped} items skipped (rejected/on-hold/already-quoted).`, '#0fa');
        } catch (e) { log('Load failed: ' + e.message, '#f55'); setProgress('Load failed — see log.'); }
    }
    function onStart() {
        const s = loadState();
        if (!s || !s.quotes || !s.quotes.length) { log('Load the plan first.', '#fd0'); return; }
        s.running = true; s.autoSend = autoSendCheck.checked; if (s.idx == null) s.idx = 0;
        saveState(s);
        log(`Starting run — ${s.quotes.length} quotes, auto-send ${s.autoSend ? 'ON' : 'OFF'}.`, '#0af');
        if (!/\/Quote\/(Create|Detail)/i.test(location.pathname)) { location.href = '/Quote/Create'; return; }
        drive();
    }
    function onNext() {
        // Used after a manual Send (dry-run) or after fixing an error step.
        const s = loadState(); if (!s) return;
        const q = s.quotes[s.idx];
        if (q && q.phase === 'awaiting-send') { q.phase = 'monday'; commitQuote(s.idx, q); }
        else if (q && /error/.test(q.phase)) { q.phase = q.phase.replace(/:error$/, ''); commitQuote(s.idx, q); }
        showNext(false);
        drive();
    }

    // =======================================================================
    // Boot — build panel + resume any in-flight run on each JL page load.
    // =======================================================================
    function boot() {
        if (!document.body) { setTimeout(boot, 300); return; }
        if (!document.getElementById('jl-launch-' + SCRIPT_ID)) buildPanel();
        const s = loadState();
        if (s) { renderPlan(s); if (s.running) setTimeout(drive, 1200); }
    }
    boot();
})();
