// ==UserScript==
// @name         JobLogic Electronic Forms — Add Standard Field
// @namespace    com.joesegal.joblogic
// @version      1.1.0
// @description  Adds a standard question SET (the Remedials + H&S preset, or one field you type) to many custom form templates at once. Deployed templates are locked, so for each form it creates a new version, saves the edited definition and deploys it — keeping the ORIGINAL form name so no "- V2" rename or duplicate appears. Dry run first; "Run first only" does a single form so you can check it on mobile before the rest.
// @match        https://go.joblogic.com/CompanyForm*
// @run-at       document-idle
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Forms/joblogic-add-form-field.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Forms/joblogic-add-form-field.user.js
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

    const SCRIPT_ID = 'add-form-field';
    const SCRIPT_LABEL = '➕ Add Standard Field';

    // The agreed PPM standard (see JL API BigQuery Connection/FORM_FIELD_SPEC.md).
    // PAGE LEVEL, so the visibleIf expressions carry NO `row.` prefix — the per-row
    // RemedialActions columns on the 21 Water Temperature forms use `{row.…}` and are a
    // different question at a different grain. Copying their form here silently breaks
    // every conditional: the expression never matches and the comment never appears,
    // which is already the live state of "Water Temperature Monitoring - No Assets".
    const PRESET_REMEDIALS_HS = [
        { type: 'boolean', name: 'VisitRemedialsRequired', title: 'Remedials Required?', isRequired: true },
        { type: 'comment', name: 'VisitRemedialDetail', title: 'What is the remedial?',
          isRequired: true, visibleIf: '{VisitRemedialsRequired} = true' },
        { type: 'dropdown', name: 'VisitRemedialPriority', title: 'Remedial priority',
          isRequired: true, visibleIf: '{VisitRemedialsRequired} = true',
          choices: ['Urgent - P1', 'High - P2', 'Medium - P3', 'Low - P4', 'Routine - P5'] },
        { type: 'boolean', name: 'HealthSafetyRisk', title: 'Is this a Health and Safety Risk?', isRequired: true },
        { type: 'comment', name: 'HealthSafetyDetail', title: 'Describe the risk',
          isRequired: true, visibleIf: '{HealthSafetyRisk} = true' }
    ];
    const SCRIPT_COLOR = '#6b3fa0';
    const SCRIPT_DESC = 'Adds one standard question to many custom form templates. Paste the form names, Dry run to see the plan, then "Run first only" to do a single form and check it on an engineer\'s mobile before running the rest. Each form gets a new version carrying its ORIGINAL name, so nothing is renamed to "- V2".';

    // =======================================================================
    // API helpers  (same WAF-aware throttle as the other JL bulk scripts)
    // =======================================================================
    const jlCsrfToken = () => document.querySelector('input[name="__RequestVerificationToken"]')?.value || '';
    const MIN_REQUEST_INTERVAL = 1400;
    const WAF_BACKOFF_MS = [1500, 3000, 6000, 12000, 20000];
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    let lastRequestAt = 0, currentInterval = MIN_REQUEST_INTERVAL, onWafRetry = null;

    async function throttle() {
        const wait = currentInterval - (Date.now() - lastRequestAt);
        if (wait > 0) await sleep(wait);
        lastRequestAt = Date.now();
    }
    function isWafBlock(r, txt) {
        if (r.status !== 403 && r.status !== 429 && r.status !== 503) return false;
        if (/Application-Gateway/i.test(r.headers.get('server') || '')) return true;
        return /text\/html/i.test(r.headers.get('content-type') || '') || /403 Forbidden/i.test(txt || '');
    }
    async function jlFetch(url, opts) {
        for (let attempt = 0; ; attempt++) {
            await throttle();
            const r = await fetch(url, opts);
            const txt = await r.text().catch(() => '');
            if (!r.ok && isWafBlock(r, txt) && attempt < WAF_BACKOFF_MS.length) {
                const pause = WAF_BACKOFF_MS[attempt];
                if (currentInterval < 4000) currentInterval += 200;
                onWafRetry?.(pause, currentInterval);
                await sleep(pause);
                continue;
            }
            let j = null; try { j = JSON.parse(txt); } catch (e) {}
            return { ok: r.ok, status: r.status, j, txt };
        }
    }
    const hdrs = () => ({ '__RequestVerificationToken': jlCsrfToken(), 'X-Requested-With': 'XMLHttpRequest' });
    async function postForm(url, fields) {
        const fd = new FormData();
        Object.entries(fields || {}).forEach(([k, v]) => fd.append(k, v));
        return jlFetch(url, { method: 'POST', credentials: 'same-origin', headers: hdrs(), body: fd });
    }
    async function postQuery(url, params) {
        const qs = new URLSearchParams(params).toString();
        return jlFetch(url + (qs ? '?' + qs : ''), { method: 'POST', credentials: 'same-origin', headers: hdrs() });
    }

    // =======================================================================
    // DynamicForm endpoints  (payloads captured live 2026-11-13 — see HANDOFF)
    // NOTE the inconsistency: NewVersion/Delete take QUERY params with capitalised
    // names, Deploy/Undeploy take FORM-DATA with lower-case first letters.
    // =======================================================================
    const detail = id => postForm('/api/DynamicForm/Detail', { id });

    const newVersion = (id, description, opts) => postQuery('/api/DynamicForm/NewVersion', {
        Id: id,
        Description: description,                       // keep the ORIGINAL name — no "- V2" rename
        AffectToExistingJobs: !!opts.nvRemoveFromJobs,  // "Remove from existing jobs"
        IsReDeployIncompleteVisits: !!opts.nvRedeployVisits
    });

    const saveSurveyForm = (id, description, def) => {
        const fd = new FormData();
        fd.append('id', id);
        fd.append('description', description);
        fd.append('content', new Blob([JSON.stringify(def)], { type: 'application/json' }), 'contentBlob');
        return jlFetch('/api/DynamicForm/SaveSurveyForm', { method: 'POST', credentials: 'same-origin', headers: hdrs(), body: fd });
    };

    const deployForm = (id, isGeneralForm, opts) => postForm('/api/DynamicForm/Deploy', {
        Id: id,
        isGeneralForm: !!isGeneralForm,
        isReDeployIncompleteVisits: !!opts.depRedeployVisits,
        affectToExistingJobs: !!opts.depAffectExistingJobs   // true = assign to all existing incomplete jobs
    });

    // =======================================================================
    // Template listing + definition helpers
    // =======================================================================
    // The custom forms list has no JSON endpoint — read the Vue model, paging by clicking the pager.
    async function listCustomForms(say) {
        const tab = document.querySelector('a[href="#customForms"]');
        if (tab) { tab.click(); await sleep(2500); }
        const vmEl = document.querySelector('#customFormsVM');
        if (!vmEl || !vmEl.__vue__) throw new Error('custom forms list not found — open Settings > Electronic Forms first');
        const model = () => vmEl.__vue__._data.Model;
        if (!model()) throw new Error('custom forms list is empty — click the Custom Forms tab and try again');
        const pane = document.querySelector('#customForms');
        const all = new Map();
        // Description is TRUNCATED for display ("Flushing Infrequently Used Outlets - Weekly - No D...").
        // Description_origin carries the real name — matching on the truncated one silently loses forms.
        const take = () => (model().DynamicForms || []).forEach(f => all.set(f.Id, {
            id: f.Id, name: f.Description_origin || f.Description, ver: f.FormVersion,
            deployed: f.IsFormDeployed, locked: f.IsLocked, isGeneralForm: f.IsGeneralForm
        }));
        take();
        const pages = Math.ceil((model().TotalCount || 0) / (model().PageSize || 50));
        for (let p = 2; p <= pages; p++) {
            const link = [...pane.querySelectorAll('a')].find(a => a.textContent.trim() === String(p));
            if (!link) break;
            say?.('listing templates… page ' + p + ' of ' + pages);
            link.click();
            await sleep(2500);
            take();
        }
        return [...all.values()];
    }

    // Every question/column in a definition, so we can tell whether the field already exists
    // ANYWHERE — including as a matrix column, which is how the Water Temperature forms carry
    // RemedialActions (cellType, often with no `type`, so a type-only walker misses it).
    function allFieldNames(def) {
        const out = [];
        const walk = n => {
            if (!n || typeof n !== 'object') return;
            if (Array.isArray(n)) return n.forEach(walk);
            if (n.name) out.push(String(n.name));
            ['pages', 'elements', 'templateElements', 'columns', 'rows', 'choices'].forEach(k => n[k] && walk(n[k]));
        };
        walk(def.pages);
        return out;
    }

    // Append the new questions to the END of the LAST page, in order, so they read as
    // closing questions. Order matters: a field's visibleIf must refer to one already above it.
    function addFields(def, fields) {
        const copy = JSON.parse(JSON.stringify(def));
        if (!Array.isArray(copy.pages) || !copy.pages.length) throw new Error('definition has no pages');
        const page = copy.pages[copy.pages.length - 1];
        page.elements = page.elements || [];
        fields.forEach(f => page.elements.push(JSON.parse(JSON.stringify(f))));
        return copy;
    }

    const hasField = (def, name) =>
        allFieldNames(def).some(n => n.toLowerCase() === String(name).toLowerCase());

    /** The fields of the set this form does not already carry, in the set's own order. */
    const missingFields = (def, fields) => fields.filter(f => !hasField(def, f.name));

    /**
     * Every {Token} a field's visibleIf leans on must exist on the form once the set is
     * added, or the question silently never shows. Checked before anything is written.
     */
    function brokenConditionals(def, fields) {
        const after = allFieldNames(def).concat(fields.map(f => f.name)).map(n => n.toLowerCase());
        const bad = [];
        for (const f of fields) {
            if (!f.visibleIf) continue;
            for (const m of String(f.visibleIf).matchAll(/\{([^}]+)\}/g)) {
                const token = m[1].trim();
                if (/^row\./i.test(token)) { bad.push(f.name + ' → ' + m[0] + ' (row-scoped, but this field is page level)'); continue; }
                if (!after.includes(token.toLowerCase())) bad.push(f.name + ' → ' + m[0] + ' (no such field)');
            }
        }
        return bad;
    }

    // =======================================================================
    // The run: one form = NewVersion -> Save -> Deploy -> verify
    // =======================================================================
    async function processForm(tpl, fields, opts, say) {
        // 1. read the current definition
        const d = await detail(tpl.id);
        if (!d.j?.success) throw new Error('Detail failed (HTTP ' + d.status + ')');
        const def = JSON.parse(d.j.AdditionalData.JsonData || '{}');

        // Add only what is missing, so a re-run after a part-failure tops up rather than
        // duplicating, and a form that already has some of the set still gets the rest.
        const todo = missingFields(def, fields);
        if (!todo.length) return { status: 'skipped', note: 'already has all ' + fields.length + ' field(s)' };

        const broken = brokenConditionals(def, todo);
        if (broken.length) throw new Error('would create a conditional that never fires: ' + broken.join('; '));

        const updated = addFields(def, todo);

        // 2. new version, carrying the ORIGINAL name
        const nv = await newVersion(tpl.id, tpl.name, opts);
        if (!nv.j?.success) throw new Error('NewVersion failed: ' + (nv.j?.errors?.join('; ') || 'HTTP ' + nv.status));

        // 3. find the draft it created (the newest live version that is not the original)
        const after = await detail(tpl.id);
        const rel = (after.j?.AdditionalData?.RelatedForms || []).filter(r => !r.IsDeleted);
        const draft = rel.filter(r => r.Id !== tpl.id).sort((a, b) => b.FormVersion - a.FormVersion)[0];
        if (!draft) throw new Error('new version created but its id could not be found');

        // 4. save the edited definition onto the draft
        const sv = await saveSurveyForm(draft.Id, tpl.name, updated);
        if (!sv.j?.success) throw new Error('Save failed: ' + (sv.j?.errors?.join('; ') || 'HTTP ' + sv.status));

        // 5. deploy it (this deactivates the previous version)
        const dep = await deployForm(draft.Id, tpl.isGeneralForm, opts);
        if (!dep.j?.success) throw new Error('Deploy failed: ' + (dep.j?.errors?.join('; ') || 'HTTP ' + dep.status)
            + ' — draft v' + draft.FormVersion + ' saved but NOT deployed');

        // 6. verify from the server rather than trusting the deploy response
        const check = await detail(draft.Id);
        const a = check.j?.AdditionalData;
        const live = a && a.JsonData ? JSON.parse(a.JsonData) : null;
        const absent = live ? todo.filter(f => !hasField(live, f.name)).map(f => f.name) : todo.map(f => f.name);
        if (!a || !a.IsFormDeployed || absent.length)
            throw new Error('deployed but verification failed'
                + (absent.length ? ' — missing on the server: ' + absent.join(', ') : '')
                + ' — check this form by hand');
        return { status: 'done', note: 'v' + a.Version + ' deployed as "' + a.Description + '" (+'
                 + todo.length + ' field' + (todo.length === 1 ? '' : 's') + ')' };
    }

    // =======================================================================
    // UI
    // =======================================================================
    function buildUI() {
        if (document.getElementById('jl-aff-root')) return;

        const root = document.createElement('div');
        root.id = 'jl-aff-root';
        root.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:99999;font-family:system-ui,sans-serif;';
        const panel = document.createElement('div');
        panel.style.cssText = 'display:block;background:#1a1a2e;color:#eee;border-radius:8px;padding:14px;width:470px;box-shadow:0 4px 20px rgba(0,0,0,0.5);max-height:86vh;overflow:auto;';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;';
        const title = document.createElement('strong');
        title.textContent = 'Add Standard Field';
        const ver = typeof GM_info !== 'undefined' ? GM_info.script?.version : '';
        if (ver) { const v = document.createElement('span'); v.textContent = ' v' + ver; v.style.cssText = 'font-weight:400;font-size:11px;color:#9fb6c4;margin-left:6px;'; title.append(v); }
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '×';
        closeBtn.style.cssText = 'background:none;border:0;color:#eee;font-size:18px;cursor:pointer;line-height:1;padding:0 4px;';
        closeBtn.addEventListener('click', () => document.getElementById('jl-launch-' + SCRIPT_ID)?.click());
        header.append(title, closeBtn);
        panel.append(header);

        const mkRow = () => { const d = document.createElement('div'); d.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;'; panel.append(d); return d; };
        const mkField = (row, label, value, flex) => {
            const l = document.createElement('label');
            l.style.cssText = 'flex:' + (flex || 1) + ';display:flex;flex-direction:column;gap:3px;font-size:12px;';
            const s = document.createElement('span'); s.textContent = label; s.style.color = '#9fb6c4';
            const i = document.createElement('input');
            i.value = value;
            i.style.cssText = 'background:#0a0a1a;color:#eee;border:1px solid #333;border-radius:4px;padding:5px;font-family:inherit;';
            l.append(s, i); row.append(l); return i;
        };
        const mkCheck = (row, label, checked, hint) => {
            const l = document.createElement('label');
            l.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;flex:1;';
            const c = document.createElement('input'); c.type = 'checkbox'; c.checked = checked;
            const s = document.createElement('span'); s.textContent = label;
            if (hint) l.title = hint;
            l.append(c, s); row.append(l); return c;
        };

        const r1 = mkRow();
        const r0 = mkRow();
        const presetCb = mkCheck(r0, 'Use the Remedials + H&S standard (5 fields)', true,
            'VisitRemedialsRequired, VisitRemedialDetail, VisitRemedialPriority, HealthSafetyRisk, '
            + 'HealthSafetyDetail — all page level, per FORM_FIELD_SPEC.md. Untick to add one field of your own.');

        const nameIn = mkField(r1, 'Field name (data key)', 'RemedialsRequired', 1);
        const r2 = mkRow();
        const titleIn = mkField(r2, 'Question shown to the engineer', 'Remedials Required?', 1);
        const r3 = mkRow();
        const requiredCb = mkCheck(r3, 'Required (blocks visit completion)', true, 'isRequired: engineers must answer before completing the visit');
        const defaultCb = mkCheck(r3, 'Default to No', false, 'defaultValue:false — leave off so a blank stays distinguishable from a real No');

        const depHdr = document.createElement('div');
        depHdr.style.cssText = 'color:#9fb6c4;font-size:11px;margin:6px 0 4px;border-top:1px solid #333;padding-top:8px;';
        depHdr.textContent = 'Deploy options — these decide what happens to open jobs';
        panel.append(depHdr);
        const r4 = mkRow();
        // OFF by default, unlike Joblogic's own dialog. Its "assign to all existing incomplete
        // jobs" reaches only ~3k of the 12.6k open jobs, so it half-does the job and hides that
        // it did. Deploy for future jobs only, then repoint deliberately with
        // joblogic-repoint-job-forms.user.js, which works off the real job population.
        const depAffectCb = mkCheck(r4, 'Assign to existing open jobs', false, 'Deploy: affectToExistingJobs. Joblogic\u2019s dialog defaults this ON; it is OFF here on purpose — it only reaches the ~3k "incomplete" jobs, not the 12.6k open ones. Leave off and use the Repoint script afterwards.');
        const depVisitsCb = mkCheck(r4, 'Redeploy incomplete visits', true, 'Deploy: isReDeployIncompleteVisits');
        const r5 = mkRow();
        const nvRemoveCb = mkCheck(r5, 'Remove old version from jobs', false, 'NewVersion: AffectToExistingJobs — strips the OLD version off existing jobs. Off by default: untested against part-filled forms.');
        const nvVisitsCb = mkCheck(r5, 'Redeploy visits on removal', false, 'NewVersion: IsReDeployIncompleteVisits');

        const namesLabel = document.createElement('div');
        namesLabel.style.cssText = 'color:#9fb6c4;font-size:11px;margin:6px 0 4px;border-top:1px solid #333;padding-top:8px;';
        namesLabel.textContent = 'Form names, one per line (paste ppm_forms_to_edit.txt)';
        panel.append(namesLabel);
        const namesTa = document.createElement('textarea');
        namesTa.rows = 5;
        namesTa.placeholder = 'Weekly Flushing - 120 Moorgate\nDaily Cooling Tower Log Sheet\n…';
        namesTa.style.cssText = 'width:100%;box-sizing:border-box;background:#0a0a1a;color:#eee;border:1px solid #333;border-radius:4px;padding:6px;font-family:ui-monospace,monospace;font-size:11px;margin-bottom:8px;';
        panel.append(namesTa);

        const btnWrap = document.createElement('div');
        btnWrap.style.cssText = 'display:flex;gap:6px;margin-bottom:8px;';
        const mkBtn = (label, bg) => {
            const b = document.createElement('button');
            b.textContent = label;
            b.style.cssText = 'flex:1;border:0;border-radius:4px;padding:8px 4px;cursor:pointer;font-weight:600;color:#fff;font-size:12px;background:' + bg + ';';
            btnWrap.append(b); return b;
        };
        const dryBtn = mkBtn('Dry run', '#0b7285');
        const oneBtn = mkBtn('Run first only', '#6b3fa0');
        const allBtn = mkBtn('Run all', '#a04f1f');
        const stopBtn = mkBtn('Stop', '#8a2f2f');
        panel.append(btnWrap);

        const status = document.createElement('div');
        status.style.cssText = 'font-size:12px;color:#cfe3ec;margin-bottom:6px;min-height:16px;';
        panel.append(status);
        const log = document.createElement('div');
        log.style.cssText = 'background:#0a0a1a;border-radius:4px;padding:8px;max-height:220px;overflow:auto;font-family:ui-monospace,monospace;font-size:11px;line-height:1.5;color:#b9c9d4;';
        panel.append(log);

        root.append(panel);
        document.body.append(root);
        jlRegisterPanel(panel, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR, SCRIPT_DESC);

        let running = false, stopRequested = false;
        const syncPreset = () => {
            const on = presetCb.checked;
            [nameIn, titleIn, requiredCb, defaultCb].forEach(el => {
                el.disabled = on;
                const box = el.closest ? el.closest('label') : null;
                if (box) box.style.opacity = on ? '0.45' : '1';
                el.style.opacity = on ? '0.45' : '1';
            });
        };
        presetCb.addEventListener('change', syncPreset);
        syncPreset();

        const say = (msg, color) => {
            const line = document.createElement('div');
            if (color) line.style.color = color;
            line.textContent = msg;
            log.append(line); log.scrollTop = log.scrollHeight;
        };
        onWafRetry = (pause, interval) => say('⏸ gateway throttled us — waiting ' + (pause / 1000) + 's, pace now ' + interval + 'ms', '#e8b339');
        const setRunning = on => {
            running = on;
            [dryBtn, oneBtn, allBtn].forEach(b => { b.disabled = on; b.style.opacity = on ? '0.5' : '1'; });
            stopBtn.disabled = !on; stopBtn.style.opacity = on ? '1' : '0.5';
        };

        const readFields = () => {
            if (presetCb && presetCb.checked) return PRESET_REMEDIALS_HS;
            const f = { type: 'boolean', name: nameIn.value.trim(), title: titleIn.value.trim() };
            if (requiredCb.checked) f.isRequired = true;
            if (defaultCb.checked) f.defaultValue = false;
            return [f];
        };
        const describeFields = (fs) => fs.map(f => f.name + ' [' + f.type + ']'
            + (f.isRequired ? ' REQ' : '') + (f.visibleIf ? ' if ' + f.visibleIf : '')).join('\n   · ');
        const readOpts = () => ({
            depAffectExistingJobs: depAffectCb.checked, depRedeployVisits: depVisitsCb.checked,
            nvRemoveFromJobs: nvRemoveCb.checked, nvRedeployVisits: nvVisitsCb.checked
        });
        const readNames = () => [...new Set(namesTa.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean))];

        // Match pasted names to deployed templates; report anything that doesn't resolve.
        async function resolve(names) {
            const templates = await listCustomForms(m => status.textContent = m);
            const deployed = templates.filter(t => t.deployed);
            const byName = new Map();
            deployed.forEach(t => byName.set((t.name || '').trim().toLowerCase(), t));
            const matched = [], missing = [];
            names.forEach(n => {
                const t = byName.get(n.toLowerCase());
                t ? matched.push(t) : missing.push(n);
            });
            return { matched, missing, deployedCount: deployed.length };
        }

        async function run(mode) {
            const fields = readFields();
            if (fields.some(f => !f.name || !f.title)) { say('✗ field name and question text are both needed', '#ff8f8f'); return; }
            say('Field set (' + fields.length + '):', '#9fb6c4');
            say('   · ' + describeFields(fields), '#9fb6c4');
            const names = readNames();
            if (!names.length) { say('✗ paste the form names first', '#ff8f8f'); return; }
            setRunning(true); stopRequested = false;
            log.textContent = '';
            try {
                say('Listing deployed templates…');
                const { matched, missing, deployedCount } = await resolve(names);
                say(deployedCount + ' deployed templates; ' + matched.length + ' of your ' + names.length + ' names matched.');
                if (missing.length) {
                    say('Not deployed / not found (' + missing.length + ') — skipped:', '#e8b339');
                    missing.forEach(n => say('   · ' + n, '#e8b339'));
                }
                if (!matched.length) { say('Nothing to do.', '#e8b339'); return; }

                // Which already have the field?
                say('Checking which already have the set…');
                const todo = [], already = [];
                for (const t of matched) {
                    if (stopRequested) break;
                    const d = await detail(t.id);
                    if (!d.j?.success) { say('✗ ' + t.name + ' — could not read definition', '#ff8f8f'); continue; }
                    const def = JSON.parse(d.j.AdditionalData.JsonData || '{}');
                    const miss = missingFields(def, fields);
                    t.missing = miss.map(f => f.name);
                    (miss.length ? todo : already).push(t);
                    status.textContent = 'checked ' + (todo.length + already.length) + ' / ' + matched.length;
                }
                if (already.length) say(already.length + ' already have it — they will be left alone.', '#9fb6c4');
                say(todo.length + ' form(s) to edit.');

                if (mode === 'dry') {
                    say('— DRY RUN, nothing written —', '#7bd88f');
                    todo.forEach(t => say('   would edit: ' + t.name + '  (v' + t.ver + ')  +'
                        + (t.missing || []).length + ': ' + (t.missing || []).join(', ')));
                    const o = readOpts();
                    say('Deploy would use: assign to existing open jobs = ' + o.depAffectExistingJobs
                        + ', redeploy incomplete visits = ' + o.depRedeployVisits, '#9fb6c4');
                    return;
                }

                const queue = mode === 'one' ? todo.slice(0, 1) : todo;
                if (mode === 'one' && queue.length) say('Doing ONE form only: ' + queue[0].name, '#e8b339');
                const opts = readOpts();
                let done = 0, failed = 0, skipped = 0;
                for (let i = 0; i < queue.length; i++) {
                    if (stopRequested) break;
                    const t = queue[i];
                    status.textContent = (i + 1) + ' / ' + queue.length + ' — ' + t.name;
                    try {
                        const res = await processForm(t, fields, opts, say);
                        if (res.status === 'skipped') { skipped++; say('· ' + t.name + ' — ' + res.note, '#9fb6c4'); }
                        else { done++; say('✔ ' + t.name + ' — ' + res.note, '#7bd88f'); }
                    } catch (e) {
                        failed++;
                        say('✗ ' + t.name + ' — ' + e.message, '#ff8f8f');
                    }
                }
                say('Finished: ' + done + ' edited, ' + skipped + ' skipped, ' + failed + ' failed'
                    + (stopRequested ? ' (stopped early)' : '') + '.', failed ? '#e8b339' : '#7bd88f');
                if (mode === 'one' && done) say('Check it on an engineer\'s mobile before running the rest.', '#e8b339');
            } catch (e) {
                say('✗ ' + e.message, '#ff8f8f');
            } finally {
                setRunning(false);
                status.textContent = '';
            }
        }

        dryBtn.addEventListener('click', () => run('dry'));
        oneBtn.addEventListener('click', () => {
            if (confirm('Edit and DEPLOY one form for real?\n\nIt will be assigned to existing open jobs if that box is ticked.')) run('one');
        });
        allBtn.addEventListener('click', () => {
            const o = readOpts();
            if (confirm('Edit and DEPLOY every listed form for real.\n\n'
                + 'Assign to existing open jobs: ' + (o.depAffectExistingJobs ? 'YES' : 'no') + '\n'
                + 'Fields: ' + readFields().map(f => f.name).join(', ') + '\n'
                + 'Required question: ' + (readFields().some(f => f.isRequired) ? 'YES — engineers cannot complete a visit without answering' : 'no') + '\n\n'
                + 'Run "Run first only" and check a visit on mobile before doing this. Continue?')) run('all');
        });
        stopBtn.addEventListener('click', () => { stopRequested = true; status.textContent = 'stopping after this form…'; });
        setRunning(false);
    }

    function waitForPage(attempts = 40) {
        if (document.querySelector('input[name="__RequestVerificationToken"]') && document.querySelector('#customFormsVM')) return buildUI();
        if (attempts <= 0) return;
        setTimeout(() => waitForPage(attempts - 1), 500);
    }
    waitForPage();
})();
