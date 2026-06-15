// ==UserScript==
// @name         Joblogic PPM — Bulk Edit Visits
// @namespace    https://go.joblogic.com/
// @version      0.13
// @description  Bulk-edit Description / Assignee type / Engineer / Duration / Job Category / Trade for all filtered visits on a PPM contract. v0.2: collapses to a launcher button in the shared dock (drag to reorder).
// @match        https://go.joblogic.com/PPMContract/Detail/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20PPMs/ppm-bulk-edit-visits.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20PPMs/ppm-bulk-edit-visits.user.js
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

    const SCRIPT_ID = 'ppm-bulk-edit-visits';
    const SCRIPT_LABEL = '🗓 PPM Edit Visits';
    const SCRIPT_COLOR = '#ff7919';
    const SCRIPT_DESC = 'Bulk-edit Description, Assignee type, Engineer, Duration, Job Category and Trade across all filtered visits on a PPM contract. Filter the visits, set the fields, then apply.';

    // ---------------------------------------------------------------------
    // CONFIG — tweak selectors here once you've inspected the real DOM.
    // The script is defensive: each lookup tries several strategies, so
    // even a partial match should work. Open the browser console to see
    // what it found / missed on each visit.
    // ---------------------------------------------------------------------
    const CFG = {
        visitsTabId: 'visitsTab',
        visitRowSel: '#ppmVisits ul.list-group > li.list-group-item',

        // Labels used to locate form fields inside an expanded visit.
        fieldLabels: {
            description: ['Description', 'Visit Description', 'Notes'],
            duration:    ['Duration', 'Duration (minutes)', 'Duration (mins)'],
            jobCategory: ['Job Category', 'Category'],
            trade:       ['Trade'],
        },

        assigneeRadioNames: ['AssigneeType', 'assigneeType', 'ResourceType'],
        assigneeRadioLabels: {
            Engineer:       ['Engineer'],
            EngineerTeam:   ['Engineer Team', 'Team'],
            Subcontractor:  ['Subcontractor'],
        },

        perVisitDelayMs: 400,
    };

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    const log = (...a) => console.log('[BulkEdit]', ...a);
    const warn = (...a) => console.warn('[BulkEdit]', ...a);

    function waitFor(testFn, { timeout = 8000, interval = 150 } = {}) {
        return new Promise((resolve, reject) => {
            const start = Date.now();
            (function tick() {
                const v = testFn();
                if (v) return resolve(v);
                if (Date.now() - start > timeout) return reject(new Error('waitFor timeout'));
                setTimeout(tick, interval);
            })();
        });
    }

    function qsa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }
    function qs(sel, root = document)  { return root.querySelector(sel); }

    // Find an input/textarea/select whose associated <label> text matches
    // one of the candidate labels.
    function findFieldByLabel(candidates, root = document) {
        const wanted = candidates.map((s) => s.toLowerCase().trim());
        const labels = qsa('label', root);
        for (const lbl of labels) {
            const text = (lbl.textContent || '').toLowerCase().trim().replace(/\*$/, '').trim();
            if (!wanted.some((w) => text === w || text.startsWith(w))) continue;
            // `for` attribute route
            const forId = lbl.getAttribute('for');
            if (forId) {
                const f = root.querySelector(`#${CSS.escape(forId)}`);
                if (f) return f;
            }
            // Sibling / descendant route — prefer widget wrappers over
            // inner inputs so we get the full widget root.
            const parent = lbl.parentElement;
            if (parent) {
                const widget = parent.querySelector('.k-widget, .v-select, .jl-select, .k-dropdown, .k-combobox, .k-multiselect');
                if (widget && widget !== lbl) return widget;
                const plain = parent.querySelector('input, textarea, select');
                if (plain && plain !== lbl) return plain;
            }
        }
        return null;
    }

    // Set a plain input/textarea value and fire events so frameworks react.
    function setInputValue(el, value) {
        if (!el) return false;
        const tag = (el.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea') {
            const proto = tag === 'input' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
            setter.call(el, value);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }
        if (tag === 'select') {
            // try match by visible text first, then by value
            const opts = Array.from(el.options);
            const match = opts.find((o) => o.text.trim().toLowerCase() === value.toLowerCase())
                       || opts.find((o) => o.value.toLowerCase() === value.toLowerCase());
            if (!match) { warn('No <option> match for', value, 'in', el); return false; }
            el.value = match.value;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }
        return false;
    }

    // Kendo dropdown / combobox setter (Joblogic heavily uses these)
    function setKendoValue(wrapperEl, value) {
        if (!wrapperEl) return false;
        const $ = window.jQuery || window.$;
        if (!$) { warn('jQuery missing — can\'t set Kendo widget'); return false; }
        const hiddenInput = wrapperEl.querySelector('input[data-role], select');
        const target = hiddenInput || wrapperEl.querySelector('input, select');
        if (!target) return false;

        const widget = $(target).data('kendoDropDownList')
                    || $(target).data('kendoComboBox')
                    || $(target).data('kendoMultiSelect')
                    || $(target).data('kendoAutoComplete');
        if (widget) {
            if (typeof widget.text === 'function') {
                // Try selecting by text
                const data = widget.dataSource && widget.dataSource.data && widget.dataSource.data();
                if (data && data.length) {
                    const item = data.find((d) => {
                        const t = (d.text || d.Name || d.name || d.Description || '').toString();
                        return t.toLowerCase() === value.toLowerCase();
                    });
                    if (item) {
                        widget.value(item.value || item.Id || item.id || item);
                        widget.trigger('change');
                        return true;
                    }
                }
                widget.text(value);
                widget.trigger('change');
                return true;
            }
            widget.value(value);
            widget.trigger('change');
            return true;
        }
        // Fallback — treat as plain input
        return setInputValue(target, value);
    }

    // Pick a radio. `which` is 'Engineer' | 'EngineerTeam' | 'Subcontractor'.
    // Clicks the label (better for custom-styled radios) and fires the full
    // event suite so Vue / jQuery bindings see the change.
    function setAssignee(which, root) {
        const labels = CFG.assigneeRadioLabels[which] || [which];

        const matchesLabel = (txt) => labels.some((l) => {
            const L = l.toLowerCase();
            return txt === L || txt.startsWith(L) || txt.includes(L);
        });

        const commit = (radio) => {
            if (!radio) return false;
            const lbl = radio.closest('label') || root.querySelector(`label[for="${radio.id}"]`);
            // Prefer label.click() (drives framework bindings on custom-styled radios).
            if (lbl) {
                fire(lbl, 'mousedown');
                fire(lbl, 'mouseup');
                lbl.click();
            }
            // Ensure the underlying input is checked and events fire.
            if (!radio.checked) {
                radio.checked = true;
            }
            fire(radio, 'input');
            fire(radio, 'change');
            fire(radio, 'click');
            log(`assignee radio committed: ${which} (radio name="${radio.name}" id="${radio.id}")`);
            return true;
        };

        // Route 1 — radios with a matching name attribute
        for (const name of CFG.assigneeRadioNames) {
            const radios = qsa(`input[type="radio"][name="${name}"]`, root);
            for (const r of radios) {
                const lbl = r.closest('label') || root.querySelector(`label[for="${r.id}"]`);
                const txt = (lbl?.textContent || r.value || '').toLowerCase().trim();
                if (matchesLabel(txt)) return commit(r);
            }
        }
        // Route 2 — any radio whose nearby label matches
        for (const r of qsa('input[type="radio"]', root)) {
            const lbl = r.closest('label') || root.querySelector(`label[for="${r.id}"]`);
            const txt = (lbl?.textContent || '').toLowerCase().trim();
            if (matchesLabel(txt)) return commit(r);
        }
        warn(`setAssignee: no radio matched "${which}" in scope`, root);
        return false;
    }

    function findButtonByText(root, text) {
        const t = text.toLowerCase();
        return qsa('button, a.btn, input[type="submit"]', root).find((b) => {
            const s = (b.textContent || b.value || '').trim().toLowerCase();
            return s === t;
        });
    }

    // ---------------------------------------------------------------------
    // Dropdown setter — dispatches by widget type. Joblogic mixes:
    //   • Kendo combobox/dropdownlist  (Category, Trade, Engineer)
    //   • vue-select                    (some top filters)
    //   • .jl-select                    (other top filters)
    // ---------------------------------------------------------------------
    function fire(el, type, init = {}) {
        const ev = type.startsWith('key')
            ? new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init })
            : type.startsWith('mouse') || type === 'click'
            ? new MouseEvent(type, { bubbles: true, cancelable: true, view: window, ...init })
            : new Event(type, { bubbles: true, ...init });
        el.dispatchEvent(ev);
    }

    // Return the most specific widget root inside/around `wrapper`.
    function widgetRoot(wrapper) {
        if (!wrapper) return null;
        return wrapper.closest('.k-widget')          // Kendo (most specific)
            || wrapper.closest('.v-select')          // vue-select
            || wrapper.closest('.jl-select')         // jl-select
            || (wrapper.querySelector && (
                    wrapper.querySelector('.k-widget')
                 || wrapper.querySelector('.v-select')
                 || wrapper.querySelector('.jl-select')))
            || wrapper;
    }

    // Drive a Kendo ComboBox / DropDownList via its jQuery widget API.
    async function setKendoCombo(root, value) {
        const $ = window.jQuery || window.$;
        if (!$) { warn('jQuery not available — cannot drive Kendo widget'); return false; }

        // Find the underlying input that Kendo was initialised on. Inside a
        // `.k-widget.k-combobox` span, the hidden original input sits as a
        // sibling of the visible kendo-generated controls.
        let input = root.querySelector('input[data-role="combobox"], input[data-role="dropdownlist"]');
        if (!input) {
            // Fallback: look for the hidden input (original form field) by
            // scanning the span's sibling or the wrapper's children.
            const siblings = Array.from((root.parentElement || root).querySelectorAll('input'));
            input = siblings.find((i) => i.id && (i.id.startsWith('Visit_') || /JobCategory|Trade|Engineer|Resource/i.test(i.name || i.id)));
        }
        if (!input) {
            // Final fallback: any input whose kendo widget we can fetch
            input = Array.from(root.querySelectorAll('input')).find((i) => {
                const w = $(i).data('kendoComboBox') || $(i).data('kendoDropDownList');
                return !!w;
            });
        }
        if (!input) { warn('Kendo: underlying input not found for', value, root); return false; }

        const widget = $(input).data('kendoComboBox') || $(input).data('kendoDropDownList');
        if (!widget) { warn('Kendo: widget instance not on', input); return false; }

        // Re-enable if the widget is currently disabled (Joblogic sometimes
        // initialises them disabled until the user interacts). Setting the
        // value while disabled is a no-op.
        try { widget.enable(true); } catch {}

        // Try to select by visible text first (user-supplied `value` is text).
        // Kendo ComboBox has .search(text) which filters and highlights; but
        // a more reliable path is to resolve via dataSource.
        const ds = widget.dataSource;
        const textField = widget.options.dataTextField || 'Name';
        const valueField = widget.options.dataValueField || 'Id';

        // If data is not yet loaded and the source is remote, trigger a
        // search to fetch matches.
        let items = ds.data ? ds.data() : [];
        const needle = value.toLowerCase().trim();
        const findMatch = (arr) => arr.find((d) => String(d[textField] || '').toLowerCase() === needle)
                               || arr.find((d) => String(d[textField] || '').toLowerCase().includes(needle));

        let match = findMatch(items);
        if (!match) {
            // Remote-fetch the filtered set
            try {
                await new Promise((resolve) => {
                    ds.one('change', resolve);
                    widget.search(value);
                    // Safety timeout in case no change fires
                    setTimeout(resolve, 2000);
                });
                items = ds.data ? ds.data() : [];
                match = findMatch(items);
            } catch (e) { warn('Kendo search failed', e); }
        }

        if (match) {
            widget.value(match[valueField]);
            widget.trigger('change');
            log(`Kendo combo set to "${match[textField]}" (id=${match[valueField]})`);
            return true;
        }

        // As a last resort, push text into the field directly — for
        // ComboBox (free-form allowed) Kendo will use the literal text.
        try {
            widget.text(value);
            widget.trigger('change');
            log(`Kendo combo text set to "${value}" (no id match)`);
            return true;
        } catch (e) {
            warn('Kendo combo: could not set', value, e);
            return false;
        }
    }

    async function setDropdown(wrapper, value) {
        if (!wrapper) return false;

        const root = widgetRoot(wrapper);

        // Kendo widget? (most common inside a visit: Category / Trade / Engineer)
        if (root.classList && (root.classList.contains('k-combobox') || root.classList.contains('k-dropdown') || root.querySelector('[data-role="combobox"], [data-role="dropdownlist"]'))) {
            return await setKendoCombo(root, value);
        }

        const isVueSelect = root.classList.contains('v-select') || !!root.querySelector('.vs__dropdown-toggle');

        // Short-circuit — already has the right value?
        const currentText = (root.querySelector('.vs__selected, .jl-select__selected, .jl-select__single')?.textContent || '').trim();
        if (currentText.toLowerCase() === value.toLowerCase()) {
            log(`dropdown already set to "${value}"`);
            return true;
        }

        // Open the dropdown. Vue-select opens on a full mouse gesture on
        // .vs__dropdown-toggle (mousedown→mouseup→click). A simple focus
        // on .vs__search does NOT open it.
        if (isVueSelect) {
            const toggle = root.querySelector('.vs__dropdown-toggle');
            const search = root.querySelector('input.vs__search');
            if (toggle) {
                fire(toggle, 'pointerdown');
                fire(toggle, 'mousedown');
                fire(toggle, 'mouseup');
                fire(toggle, 'click');
            }
            // Then focus the search so typing works
            if (search) search.focus();
        } else {
            const opener = root.querySelector('.jl-select__control, .jl-select__selection, .jl-select__current')
                        || root.querySelector('input')
                        || root;
            opener.click();
        }

        // Wait for options list
        const listSel = isVueSelect
            ? '.vs__dropdown-menu'
            : '.jl-select__options, .jl-select__list, .jl-select__dropdown, [class*="jl-select"][class*="option"]';
        let list = null;
        try {
            list = await waitFor(() => {
                const inRoot = root.querySelector(listSel);
                if (inRoot && inRoot.offsetParent !== null) return inRoot;
                const any = qsa(listSel).find((c) => c.offsetParent !== null);
                return any || null;
            }, { timeout: 4000, interval: 80 });
        } catch { /* fall through */ }

        if (!list) {
            warn('dropdown options list not found for', value, root);
            return false;
        }

        // Type into the search — use native setter + input event (vue-select listens to `input`).
        const search = isVueSelect
            ? root.querySelector('input.vs__search')
            : list.querySelector('input[type="text"], input:not([type])');
        if (search) {
            search.focus();
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            setter.call(search, value);
            fire(search, 'input');
            // Some variants also listen for keyup; fire a synthetic one.
            fire(search, 'keyup', { key: value.slice(-1) });
            await sleep(450); // async filter / remote fetch
        }

        // Find matching option — wait a bit more if list is still loading
        const optionSel = isVueSelect
            ? '.vs__dropdown-option:not(.vs__dropdown-option--disabled)'
            : '[class*="option"], li, .jl-select__option';
        let options = qsa(optionSel, list);
        const want = value.toLowerCase().trim();
        let match = options.find((o) => (o.textContent || '').trim().toLowerCase() === want)
                 || options.find((o) => (o.textContent || '').trim().toLowerCase().includes(want));

        if (!match) {
            // Retry once after more wait — remote autocomplete may still be loading
            await sleep(700);
            options = qsa(optionSel, list);
            match = options.find((o) => (o.textContent || '').trim().toLowerCase() === want)
                 || options.find((o) => (o.textContent || '').trim().toLowerCase().includes(want));
        }

        if (!match) {
            warn('dropdown: no option matched', value, '| available:',
                options.slice(0, 10).map((o) => (o.textContent || '').trim()));
            // close dropdown by pressing Escape
            if (search) fire(search, 'keydown', { key: 'Escape' });
            document.body.click();
            return false;
        }

        // Vue-select selects on mousedown, not click (click fires after blur).
        if (isVueSelect) {
            fire(match, 'mousedown');
            fire(match, 'mouseup');
            fire(match, 'click');
        } else {
            match.click();
        }
        await sleep(250);
        return true;
    }

    // ---------------------------------------------------------------------
    // Core: edit one visit row (inline expansion)
    // ---------------------------------------------------------------------
    async function editRow(row, updates) {
        // 1) Expand the row if not already expanded.
        const details = row.querySelector('.visit-details');
        const isExpanded = details && getComputedStyle(details).display !== 'none' && details.childElementCount > 0;

        if (!isExpanded) {
            const clickTarget = row.querySelector('.visit-info-description')
                              || row.querySelector('.visit-info')
                              || row;
            clickTarget.click();
            try {
                await waitFor(() => {
                    const d = row.querySelector('.visit-details');
                    return d && getComputedStyle(d).display !== 'none' && d.childElementCount > 0 ? d : null;
                }, { timeout: 4000, interval: 100 });
            } catch {
                throw new Error('Row did not expand');
            }
            await sleep(250); // let widgets render
        }

        const scope = row.querySelector('.visit-details') || row;

        // Make sure we're on the "Details" tab (it's the default, but the
        // user may have navigated elsewhere on a prior row).
        const detailsTab = qsa('button, a', scope).find((b) => (b.textContent || '').trim().toLowerCase() === 'details');
        if (detailsTab && !detailsTab.classList.contains('active') && !/jl-button-(blue|green)/.test(detailsTab.className)) {
            // Only click if clearly not active — Joblogic marks it with a class
            // we can't fully predict. Safer to leave alone if ambiguous.
        }

        // 2) Apply updates.
        if (updates.assignee) {
            const ok = setAssignee(updates.assignee, scope);
            log('assignee', updates.assignee, ok ? 'ok' : 'FAIL');
            await sleep(300); // radio change may swap visible fields
        }

        if (updates.description !== undefined) {
            const el = findFieldByLabel(CFG.fieldLabels.description, scope);
            const ok = setInputValue(el, updates.description);
            log('description', ok ? 'ok' : 'FAIL');
        }

        if (updates.duration !== undefined) {
            const el = findFieldByLabel(CFG.fieldLabels.duration, scope);
            const ok = setInputValue(el, String(updates.duration));
            log('duration', ok ? 'ok' : 'FAIL');
        }

        if (updates.engineer !== undefined) {
            // Vue re-renders the widget after a type switch; wait for the
            // right input to appear.
            const typeKey = updates.assignee === 'EngineerTeam' ? 'team'
                         : updates.assignee === 'Subcontractor' ? 'sub'
                         : 'engineer';
            const idPatterns = typeKey === 'team'
                ? [/EngineerTeamId$/i, /TeamId$/i]
                : typeKey === 'sub'
                ? [/SubcontractorId$/i, /ContractorId$/i, /SupplierId$/i]
                : [/EngineerId$/i, /ResourceId$/i, /AssigneeId$/i];

            const findInput = () => qsa('input', scope).find((i) => {
                const nm = i.id || i.name || '';
                // Skip the radio inputs and the visible kendo text field (name=..._input)
                if (i.type === 'radio') return false;
                if (nm.endsWith('_input')) return false;
                return idPatterns.some((re) => re.test(nm));
            });

            let input;
            try {
                input = await waitFor(() => findInput() || null, { timeout: 2500, interval: 100 });
            } catch { input = findInput(); }

            let engWrapper = null;
            if (input) {
                engWrapper = input.closest('.k-widget, .v-select, .jl-select')
                          || (input.parentElement && input.parentElement.querySelector('.k-widget, .v-select, .jl-select'));
                // If still not a widget, try the Kendo pattern: the
                // data-role="combobox" input has a generated <span.k-widget>
                // sibling as its previousElementSibling.
                if (!engWrapper && input.previousElementSibling && input.previousElementSibling.classList.contains('k-widget')) {
                    engWrapper = input.previousElementSibling;
                }
            }

            if (!engWrapper) {
                // Diagnostic: show all candidate inputs so we can refine patterns
                const sample = qsa('input', scope)
                    .map((i) => `${i.tagName.toLowerCase()}[id="${i.id}" name="${i.name}" type="${i.type}"]`)
                    .filter((s) => !/ type="radio"/.test(s) && !/ type="checkbox"/.test(s))
                    .slice(0, 15)
                    .join('\n  ');
                warn(`engineer widget not located for type="${typeKey}". Inputs in scope:\n  ${sample}`);
                status(`Engineer widget not found (type=${typeKey}). See console for input list — paste it back.`);
            } else {
                log(`engineer locator: type="${typeKey}" input="${input?.id || input?.name}" wrapper=${engWrapper.tagName.toLowerCase()}.${engWrapper.className}`);
                const ok = await setDropdown(engWrapper, updates.engineer);
                log('engineer/resource', ok ? 'ok' : 'FAIL');
                if (!ok) status(`Engineer name not set for ${typeKey}="${updates.engineer}" — check console.`);
            }
        }

        if (updates.jobCategory !== undefined) {
            const el = findFieldByLabel(CFG.fieldLabels.jobCategory, scope);
            const ok = await setDropdown(el, updates.jobCategory);
            log('jobCategory', ok ? 'ok' : 'FAIL');
        }

        if (updates.trade !== undefined) {
            const el = findFieldByLabel(CFG.fieldLabels.trade, scope);
            const ok = await setDropdown(el, updates.trade);
            log('trade', ok ? 'ok' : 'FAIL');
        }

        // 3) Do NOT save per-row — Joblogic has one global Save button at the
        //    top of the visits tab that commits all in-memory changes.
    }

    // Click the global "Save" button in the visits toolbar.
    async function globalSave() {
        const saveBtn = qsa('#visitsTab button, #ppmVisits button')
            .find((b) => (b.textContent || '').trim().toLowerCase() === 'save');
        if (!saveBtn) throw new Error('Global Save button not found');
        saveBtn.click();
        // Give the request time to fire; Joblogic usually shows a toast.
        await sleep(2000);
    }

    // ---------------------------------------------------------------------
    // UI
    // ---------------------------------------------------------------------
    function buildPanel() {
        if (document.getElementById('bulkEditPanel')) return;
        const host = document.createElement('div');
        host.id = 'bulkEditPanel';
        host.innerHTML = `
<style>
  #bulkEditPanel{position:fixed;top:80px;right:16px;width:320px;background:#fff;border:1px solid #ccc;
    box-shadow:0 4px 14px rgba(0,0,0,.15);z-index:99999;font:13px system-ui,sans-serif;border-radius:6px}
  #bulkEditPanel header{background:#0b5ed7;color:#fff;padding:8px 12px;border-radius:6px 6px 0 0;
    display:flex;justify-content:space-between;align-items:center;cursor:move;user-select:none}
  #bulkEditPanel header b{font-size:13px}
  #bulkEditPanel .body{padding:10px 12px;max-height:70vh;overflow-y:auto}
  #bulkEditPanel .row{margin-bottom:8px}
  #bulkEditPanel label{display:block;font-weight:600;margin-bottom:3px}
  #bulkEditPanel input[type=text],#bulkEditPanel input[type=number],#bulkEditPanel textarea,
  #bulkEditPanel select{width:100%;padding:4px 6px;border:1px solid #bbb;border-radius:3px;
    font:inherit;box-sizing:border-box}
  #bulkEditPanel textarea{height:50px;resize:vertical}
  #bulkEditPanel .chk{display:inline-flex;align-items:center;gap:4px;font-weight:600;margin-bottom:2px}
  #bulkEditPanel .footer{padding:8px 12px;border-top:1px solid #eee;display:flex;gap:6px}
  #bulkEditPanel button.run{flex:1;background:#0b5ed7;color:#fff;border:none;padding:6px;
    border-radius:3px;cursor:pointer;font-weight:600}
  #bulkEditPanel button.run:hover{background:#0a4fb0}
  #bulkEditPanel button.stop{background:#dc3545;color:#fff;border:none;padding:6px 10px;
    border-radius:3px;cursor:pointer;font-weight:600}
  #bulkEditPanel button.stop:hover:not(:disabled){background:#b52a37}
  #bulkEditPanel button.stop:disabled{opacity:.4;cursor:not-allowed}
  #bulkEditPanel button.close{background:transparent;color:#fff;border:none;font-size:16px;cursor:pointer}
  #bulkEditPanel .status{padding:6px 12px;background:#f6f6f6;font-family:monospace;font-size:11px;
    max-height:80px;overflow-y:auto;border-top:1px solid #eee}
</style>
<header>
  <b>Bulk Edit Visits</b>
  <button class="close" title="Close">×</button>
</header>
<div class="body">
  <div class="row">
    <label class="chk"><input type="checkbox" id="be_chk_desc"> Description</label>
    <textarea id="be_desc" placeholder="New description"></textarea>
  </div>
  <div class="row">
    <label class="chk"><input type="checkbox" id="be_chk_assignee"> Assignee type</label>
    <label><input type="radio" name="be_assignee" value="Engineer" checked> Engineer</label>
    <label><input type="radio" name="be_assignee" value="EngineerTeam"> Engineer Team</label>
    <label><input type="radio" name="be_assignee" value="Subcontractor"> Subcontractor</label>
  </div>
  <div class="row">
    <label class="chk"><input type="checkbox" id="be_chk_eng"> Engineer / Team / Subcontractor name</label>
    <input type="text" id="be_eng" placeholder="Exact name as shown in dropdown">
  </div>
  <div class="row">
    <label class="chk"><input type="checkbox" id="be_chk_dur"> Duration (minutes)</label>
    <input type="number" id="be_dur" min="1" step="1" placeholder="e.g. 60">
  </div>
  <div class="row">
    <label class="chk"><input type="checkbox" id="be_chk_cat"> Job Category</label>
    <input type="text" id="be_cat" placeholder="Exact category name">
  </div>
  <div class="row">
    <label class="chk"><input type="checkbox" id="be_chk_trade"> Trade</label>
    <input type="text" id="be_trade" placeholder="Exact trade name">
  </div>
  <div class="row">
    <label class="chk"><input type="checkbox" id="be_dry" checked> Dry-run (log only, don't save)</label>
  </div>
</div>
<div class="footer">
  <button class="run">Apply to visible visits</button>
  <button class="stop" disabled title="Stop the current run">Stop</button>
</div>
<div class="status" id="be_status">Idle. Load the Visits tab, apply your filter, tick fields to update, then click Apply.</div>
`;
        document.body.appendChild(host);
        jlRegisterPanel(host, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR, SCRIPT_DESC);

        // drag to move
        const header = host.querySelector('header');
        let drag = null;
        header.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('close')) return;
            drag = { x: e.clientX - host.offsetLeft, y: e.clientY - host.offsetTop };
        });
        window.addEventListener('mouseup', () => drag = null);
        window.addEventListener('mousemove', (e) => {
            if (!drag) return;
            host.style.left = (e.clientX - drag.x) + 'px';
            host.style.top  = (e.clientY - drag.y) + 'px';
            host.style.right = 'auto';
        });

        host.querySelector('.close').addEventListener('click', () => { host.style.display = 'none'; });
        host.querySelector('.run').addEventListener('click', runBulk);
        host.querySelector('.stop').addEventListener('click', () => {
            state.stop = true;
            status('Stop requested — finishing current row and halting.');
        });
    }

    // Shared run-state — only one run at a time.
    const state = { running: false, stop: false };

    function readUpdates() {
        const u = {};
        if (qs('#be_chk_desc').checked)      u.description = qs('#be_desc').value;
        if (qs('#be_chk_assignee').checked)  u.assignee    = qs('input[name="be_assignee"]:checked').value;
        if (qs('#be_chk_eng').checked)       u.engineer    = qs('#be_eng').value.trim();
        if (qs('#be_chk_dur').checked)       u.duration    = parseInt(qs('#be_dur').value, 10);
        if (qs('#be_chk_cat').checked)       u.jobCategory = qs('#be_cat').value.trim();
        if (qs('#be_chk_trade').checked)     u.trade       = qs('#be_trade').value.trim();
        return u;
    }

    function status(msg) {
        const el = qs('#be_status');
        if (!el) return;
        el.textContent = msg + '\n' + el.textContent;
    }

    async function runBulk() {
        if (state.running) { status('Already running.'); return; }
        const updates = readUpdates();
        const dry = qs('#be_dry').checked;
        if (Object.keys(updates).length === 0) {
            status('Nothing ticked — pick at least one field.');
            return;
        }
        const rows = qsa(CFG.visitRowSel).filter((r) => r.offsetParent !== null);
        if (!rows.length) {
            status('No visit rows found — check CFG.visitRowSel.');
            return;
        }
        status(`Found ${rows.length} visit row(s). ${dry ? 'DRY RUN (first row only).' : 'Editing all…'}`);
        log('updates:', updates, 'rows:', rows.length, 'dry:', dry);

        state.running = true;
        state.stop = false;
        const stopBtn = qs('#bulkEditPanel button.stop');
        const runBtn  = qs('#bulkEditPanel button.run');
        if (stopBtn) stopBtn.disabled = false;
        if (runBtn)  runBtn.disabled = true;

        try {
            if (dry) {
                try {
                    await editRow(rows[0], updates);
                    status('Dry-run: first visit edited in-memory. Check it visually. Nothing has been saved.');
                    status('Click the page\'s Save button manually if you want to commit it, or Undo Changes to revert.');
                } catch (e) {
                    warn(e);
                    status('Dry-run error: ' + e.message);
                }
                return;
            }

            let ok = 0, fail = 0, stopped = false;
            for (let i = 0; i < rows.length; i++) {
                if (state.stop) { stopped = true; break; }
                status(`Editing ${i + 1}/${rows.length}…`);
                try {
                    await editRow(rows[i], updates);
                    ok++;
                } catch (e) {
                    warn('row', i, 'failed', e);
                    fail++;
                }
                await sleep(CFG.perVisitDelayMs);
            }

            if (stopped) {
                status(`Stopped. ${ok} edited, ${fail} failed. NOT saving — use page's Undo Changes to revert, or click Save manually.`);
                return;
            }

            status(`Edited ${ok}/${rows.length}. Clicking global Save…`);
            try {
                await globalSave();
                status(`Done — ${ok} ok, ${fail} failed. Global save triggered.`);
            } catch (e) {
                status(`Edits complete (${ok} ok, ${fail} failed) BUT global Save failed: ${e.message}. Click Save manually.`);
            }
        } finally {
            state.running = false;
            state.stop = false;
            if (stopBtn) stopBtn.disabled = true;
            if (runBtn)  runBtn.disabled = false;
        }
    }

    // ---------------------------------------------------------------------
    // Boot — show the panel when the visits tab is visible
    // ---------------------------------------------------------------------
    function forceShow() {
        // Ensure the panel exists (collapsed by default into the shared dock),
        // then make it visible.
        buildPanel();
        const p = document.getElementById('bulkEditPanel');
        if (p) p.style.display = 'flex';
    }

    // Expose a manual escape hatch — if the panel ever disappears again,
    // open DevTools and run:  window.__showBulkEdit()
    window.__showBulkEdit = forceShow;

    // Keyboard shortcut: Ctrl+Shift+B toggles the panel
    window.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.shiftKey && (e.key === 'B' || e.key === 'b')) {
            e.preventDefault();
            const existing = document.getElementById('bulkEditPanel');
            if (existing) existing.style.display = existing.style.display === 'none' ? 'flex' : 'none';
            else buildPanel();
        }
    });

    // Build the panel (collapsed into the shared dock — click the dock button
    // to open it). No visitsTab gating.
    buildPanel();
    setTimeout(() => { if (!document.getElementById('bulkEditPanel')) buildPanel(); }, 1500);
    setTimeout(() => { if (!document.getElementById('bulkEditPanel')) buildPanel(); }, 4000);
})();
