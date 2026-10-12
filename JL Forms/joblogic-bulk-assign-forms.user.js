// ==UserScript==
// @name         Joblogic - Bulk Assign Forms to Jobs
// @namespace    com.joesegal.joblogic
// @version      1.2.1
// @description  Floating panel: paste a tab-separated table of [Job Number, Form Name, Shown On, Req. Visit, Req. Asset] and bulk-assign (or bulk-remove) each form to/from its job via the CompanyForm API. "Required on Visit" / "Required on Asset" come from panel defaults, overridable per row. Works from any go.joblogic.com page (jobs are resolved by number).
// @match        https://go.joblogic.com/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Forms/joblogic-bulk-assign-forms.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Forms/joblogic-bulk-assign-forms.user.js
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

    const SCRIPT_ID = 'bulk-assign-forms';
    const SCRIPT_LABEL = '🗂️ Bulk Assign Forms';
    const SCRIPT_COLOR = '#0b7285';
    const SCRIPT_DESC = 'Paste a tab-separated table — Job Number | Form Name | Shown On | Req. Visit | Req. Asset (last three optional). Required on Visit / Asset default to the panel checkboxes; Y/N in a row overrides. Works from any Joblogic page.';

    // --- "Shown On" stage -> visit-status TypeId (from the Joblogic form rule component) ---
    const SHOW_ON = {
        'accept': 0,
        'travel': 1,
        'arrive': 2,
        'complete': 3,
        'abandon travel': 4,
        'leave site': 5,
        'reject': 6,
        'abort': 7,
    };
    const SHOW_ON_LABELS = ['Accept', 'Travel', 'Arrive', 'Complete', 'Abandon Travel', 'Leave Site', 'Reject', 'Abort'];

    // =======================================================================
    // API helpers
    // =======================================================================
    const jlCsrfToken = () => document.querySelector('input[name="__RequestVerificationToken"]')?.value || '';

    // POST form-data with the CSRF token (matches JL_SERVICES.post isJsonToFormData).
    async function jlPostForm(url, fields) {
        const fd = new FormData();
        Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
        const r = await fetch(url, {
            method: 'POST', credentials: 'same-origin',
            headers: { '__RequestVerificationToken': jlCsrfToken(), 'X-Requested-With': 'XMLHttpRequest' },
            body: fd
        });
        const txt = await r.text();
        let j = null; try { j = JSON.parse(txt); } catch (e) {}
        return { ok: r.ok, status: r.status, j, txt };
    }

    // Resolve a job number / reference to its internal job id.
    const _jobCache = new Map();
    async function resolveJob(ref) {
        if (_jobCache.has(ref)) return _jobCache.get(ref);
        const r = await fetch('/api/Job/SearchJsonData', {
            method: 'POST', credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                '__RequestVerificationToken': jlCsrfToken()
            },
            body: JSON.stringify({
                SearchTerm: ref, PageSize: 10, PageIndex: 1, EngineerType: 0,
                IncludePPMJobs: true, IncludeReactiveJobs: true,
                StartLoggedDate: '', EndLoggedDate: '', StartDate: '', EndDate: '',
                StartCompleteDate: '', EndCompleteDate: '', StartNextContactDate: '', EndNextContactDate: ''
            })
        });
        if (!r.ok) throw new Error('Job search HTTP ' + r.status);
        const d = await r.json();
        const jobs = d.AdditionalData?.Jobs || d.Data || [];
        const match = jobs.find(j => (j.JobNumber === ref || j.ReferenceNumber === ref)) || (jobs.length === 1 ? jobs[0] : null);
        if (!match) { _jobCache.set(ref, null); return null; }
        const out = { id: match.Id || match.JobId, jobNumber: match.JobNumber || match.ReferenceNumber || ref };
        _jobCache.set(ref, out);
        return out;
    }

    // Resolve a form name to its FormUniqueGuid (exact, case-insensitive; else sole match).
    // ShowInFormsList / ShowInAssetsList say which "Required on" toggles apply to the form.
    const formOut = f => ({ guid: f.FormUniqueGuid, name: f.FormName, visitForm: f.ShowInFormsList !== false, assetForm: f.ShowInAssetsList === true });
    const _formCache = new Map();
    async function resolveForm(name) {
        const key = name.toLowerCase();
        if (_formCache.has(key)) return _formCache.get(key);
        const res = await jlPostForm('/companyform/FormsSearch', {
            SearchTerm: name, orderBy: '1', pageIndex: '1', pageSize: '50'
        });
        const forms = res.j?.AdditionalData?.Forms || [];
        let out;
        if (!forms.length) {
            out = { error: 'no form matching "' + name + '"' };
        } else {
            const exact = forms.filter(f => (f.FormName || '').toLowerCase() === key);
            if (exact.length === 1) out = formOut(exact[0]);
            else if (exact.length > 1) out = { error: 'multiple forms named "' + name + '" (' + exact.length + ')' };
            else if (forms.length === 1) out = formOut(forms[0]);
            else out = { error: forms.length + ' forms match "' + name + '" but none exactly — use the exact form name' };
        }
        _formCache.set(key, out);
        return out;
    }

    // JL puts failure text in errors[] (Message is null), e.g. "A rule already exists for this form."
    const jlError = res => (res.j?.errors || []).join('; ') || res.j?.Message || ('HTTP ' + res.status);

    // Set Show On + Required on Visit/Asset on an existing rule.
    async function changeFormRule(jobId, rule, showOnRules, isRequired, isRequiredOnAsset) {
        const res = await jlPostForm('/companyform/ChangeFormRuleById', {
            jobId: jobId,
            showOnRules: showOnRules,
            defaultCompanyFormId: rule.DefaultCompanyFormId || '',
            companyFormId: rule.Id,
            isRequired: isRequired ? 'true' : 'false',
            isRequiredOnAsset: isRequiredOnAsset ? 'true' : 'false'
        });
        return { ok: res.j?.success === true, message: res.j?.success === true ? 'OK' : jlError(res) };
    }

    // Assign a form to a job + set its Show On rules and Required-on-Visit flag (one call).
    // AddFormRuleByJobId ignores isRequiredOnAsset, so when that's wanted we follow up with
    // ChangeFormRuleById on the created rule (verified live). If the form is already on the
    // job, JL rejects the add — update the existing rule(s) instead.
    async function assignFormRule(jobId, form, showOnTypeIds, isRequired, isRequiredOnAsset) {
        const showOnRules = showOnTypeIds.join(',');   // '' when no stage
        const res = await jlPostForm('/companyform/AddFormRuleByJobId', {
            jobId: jobId,
            formUniqueGuid: form.guid,
            showOnRules: showOnRules,
            isRequired: isRequired ? 'true' : 'false'
        });
        if (res.j?.success !== true) {
            if (!/already exists/i.test(jlError(res))) return { ok: false, message: jlError(res) };
            const existing = await findAssignedForms(jobId, form.name);
            if (!existing.length) return { ok: false, message: jlError(res) };
            const errs = [];
            for (const rule of existing) {
                const ch = await changeFormRule(jobId, rule, showOnRules, isRequired, isRequiredOnAsset);
                if (!ch.ok) errs.push(ch.message);
            }
            if (errs.length) return { ok: false, message: 'already assigned; update failed: ' + errs.join('; ') };
            return { ok: true, updated: true };
        }
        if (!isRequiredOnAsset) return { ok: true };

        const created = res.j?.AdditionalData?.CreatedForm;
        if (!created?.Id) return { ok: false, message: 'added, but no rule id returned — set Required on Asset manually' };
        const ch = await changeFormRule(jobId, created, showOnRules, isRequired, true);
        if (ch.ok) return { ok: true };
        return { ok: false, message: 'added, but Required on Asset failed: ' + ch.message };
    }

    // Find the form rules already assigned to a job that match a form name (exact, case-insensitive).
    async function findAssignedForms(jobId, name) {
        const res = await jlPostForm('/companyform/JobFormsSearch', {
            jobId: jobId, SearchTerm: name, orderBy: '1', pageIndex: '1', pageSize: '50'
        });
        const forms = res.j?.AdditionalData?.Forms || [];
        const key = name.toLowerCase();
        return forms.filter(f => (f.FormName || '').toLowerCase() === key);
    }

    // Remove one assigned form rule. Uses DefaultCompanyFormId when present, else the rule's own Id.
    async function removeFormRule(jobId, rule) {
        const fields = { jobId: jobId };
        if (rule.DefaultCompanyFormId) fields.defaultCompanyFormId = rule.DefaultCompanyFormId;
        else fields.companyFormId = rule.Id;
        const res = await jlPostForm('/companyform/RemoveFormRuleById', fields);
        const ok = res.j?.success === true;
        return { ok, message: ok ? 'OK' : jlError(res) };
    }

    // =======================================================================
    // Parsing: tab-separated  Job Number | Form Name | Shown On
    // =======================================================================
    function parseStages(cell) {
        const raw = (cell || '').trim();
        if (!raw) return { ids: [], labels: [] };          // blank = no stage
        const parts = raw.split(/[,/;]+/).map(s => s.trim()).filter(Boolean);
        const ids = [], labels = [], unknown = [];
        for (const p of parts) {
            const id = SHOW_ON[p.toLowerCase()];
            if (id === undefined) unknown.push(p);
            else if (!ids.includes(id)) { ids.push(id); labels.push(SHOW_ON_LABELS[id]); }
        }
        if (unknown.length) return { error: 'unknown stage: ' + unknown.join(', ') };
        return { ids, labels };
    }

    // Y/N cell -> true/false; blank -> fallback (panel default).
    function parseFlag(cell, fallback) {
        const v = (cell || '').trim().toLowerCase();
        if (!v) return { value: fallback };
        if (/^(y|yes|true|1|on|x|✓|✔)$/.test(v)) return { value: true };
        if (/^(n|no|false|0|off)$/.test(v)) return { value: false };
        return { error: 'bad Y/N value "' + cell.trim() + '"' };
    }

    function parseTable(text, withStages, defaults) {
        const rows = [];
        text.split(/\r?\n/).forEach((line, i) => {
            if (!line.trim()) return;
            const cols = line.split('\t');
            const jobNo = (cols[0] || '').trim();
            const formName = (cols[1] || '').trim();
            const shownOnCell = (cols[2] || '').trim();
            const reqVisitCell = (cols[3] || '').trim();
            const reqAssetCell = (cols[4] || '').trim();
            // Skip an obvious header row.
            if (i === 0 && /^job/i.test(jobNo) && /form/i.test(formName)) return;
            if (!jobNo && !formName) return;
            const row = { lineNo: i + 1, jobNo, formName, shownOnCell };
            if (!jobNo) row.error = 'missing job number';
            else if (!formName) row.error = 'missing form name';
            else if (withStages) {
                const st = parseStages(shownOnCell);
                const rv = parseFlag(reqVisitCell, defaults.reqVisit);
                const ra = parseFlag(reqAssetCell, defaults.reqAsset);
                if (st.error) row.error = st.error;
                else if (rv.error) row.error = 'Req. Visit: ' + rv.error;
                else if (ra.error) row.error = 'Req. Asset: ' + ra.error;
                else { row.stageIds = st.ids; row.stageLabels = st.labels; row.reqVisit = rv.value; row.reqAsset = ra.value; }
            }
            rows.push(row);
        });
        return rows;
    }

    // =======================================================================
    // UI
    // =======================================================================
    function buildUI() {
        if (document.getElementById('jl-baf-root')) return;

        const root = document.createElement('div');
        root.id = 'jl-baf-root';
        root.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:99999;font-family:system-ui,sans-serif;';

        const panel = document.createElement('div');
        panel.style.cssText = 'display:block;background:#1a1a2e;color:#eee;border-radius:8px;padding:14px;width:420px;box-shadow:0 4px 20px rgba(0,0,0,0.5);';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;';
        const title = document.createElement('strong');
        title.textContent = 'Bulk Assign Forms to Jobs';
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '×';
        closeBtn.title = 'Collapse to dock';
        closeBtn.style.cssText = 'background:none;border:0;color:#eee;font-size:18px;cursor:pointer;line-height:1;padding:0 4px;';
        closeBtn.addEventListener('click', () => document.getElementById('jl-launch-' + SCRIPT_ID)?.click());
        header.append(title, closeBtn);
        panel.append(header);

        let mode = 'assign';   // 'assign' | 'remove'
        const modeWrap = document.createElement('div');
        modeWrap.style.cssText = 'display:flex;gap:6px;margin-bottom:8px;';
        const mkModeBtn = (val, label) => {
            const b = document.createElement('button');
            b.textContent = label;
            b.dataset.mode = val;
            b.style.cssText = 'flex:1;border:1px solid #333;border-radius:4px;padding:6px;cursor:pointer;font-weight:600;background:#0a0a1a;color:#9fb6c4;';
            b.addEventListener('click', () => setMode(val));
            return b;
        };
        const assignModeBtn = mkModeBtn('assign', 'Assign');
        const removeModeBtn = mkModeBtn('remove', 'Remove');
        modeWrap.append(assignModeBtn, removeModeBtn);
        panel.append(modeWrap);

        const help = document.createElement('div');
        help.style.cssText = 'color:#9fb6c4;font-size:11px;line-height:1.45;margin-bottom:8px;';
        panel.append(help);

        // Defaults for Required on Visit / Asset (assign mode only).
        const reqWrap = document.createElement('div');
        reqWrap.style.cssText = 'display:flex;gap:16px;margin-bottom:8px;font-size:12px;';
        const mkReq = (label, checked) => {
            const l = document.createElement('label');
            l.style.cssText = 'display:flex;align-items:center;gap:5px;cursor:pointer;';
            const cb = document.createElement('input');
            cb.type = 'checkbox'; cb.checked = checked;
            cb.addEventListener('change', () => refreshPreview());
            l.append(cb, document.createTextNode(label));
            reqWrap.append(l);
            return cb;
        };
        const reqVisitCb = mkReq('Required on Visit', true);
        const reqAssetCb = mkReq('Required on Asset', false);
        panel.append(reqWrap);
        const defaults = () => ({ reqVisit: reqVisitCb.checked, reqAsset: reqAssetCb.checked });

        const ta = document.createElement('textarea');
        ta.placeholder = 'AT0000001\tEmergency Light Testing Certificate\tComplete';
        ta.style.cssText = 'width:100%;height:120px;background:#0a0a1a;color:#eee;border:1px solid #333;border-radius:4px;padding:6px;font:12px monospace;box-sizing:border-box;white-space:pre;overflow:auto;';
        panel.append(ta);

        const preview = document.createElement('div');
        preview.style.cssText = 'color:#0af;font-size:11px;margin-top:6px;min-height:14px;';
        panel.append(preview);

        const btn = document.createElement('button');
        btn.textContent = 'Assign Forms';
        btn.style.cssText = 'background:#0a8;color:#fff;border:0;border-radius:4px;padding:8px 14px;font-weight:600;cursor:pointer;margin-top:10px;width:100%;';
        panel.append(btn);

        const status = document.createElement('div');
        status.style.cssText = 'margin-top:8px;font:11px monospace;white-space:pre-wrap;word-break:break-word;color:#ccc;max-height:220px;overflow-y:auto;';
        panel.append(status);

        root.append(panel);
        document.body.append(root);
        jlRegisterPanel(root, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR, SCRIPT_DESC);

        const ASSIGN_HELP = 'Paste <b>tab-separated</b> columns (copy straight from a spreadsheet):<br>' +
            '<code style="color:#7fd">Job Number&nbsp;⇥&nbsp;Form Name&nbsp;⇥&nbsp;Shown On&nbsp;⇥&nbsp;Req. Visit&nbsp;⇥&nbsp;Req. Asset</code><br>' +
            'Stages: ' + SHOW_ON_LABELS.join(', ') + ' (blank = no stage). ' +
            '<i>Req. Visit</i> / <i>Req. Asset</i> are optional Y/N — blank uses the checkboxes below.';
        const REMOVE_HELP = 'Paste 2 <b>tab-separated</b> columns (copy straight from a spreadsheet):<br>' +
            '<code style="color:#f9a">Job Number&nbsp;⇥&nbsp;Form Name</code><br>' +
            'Each form matching the name (exactly, case-insensitive) is <b>removed</b> from its job. ' +
            'Any further columns are ignored.';

        const refreshPreview = () => {
            const rows = parseTable(ta.value, mode === 'assign', defaults());
            const bad = rows.filter(r => r.error).length;
            preview.textContent = rows.length
                ? `${rows.length} row(s)` + (bad ? ` — ${bad} with errors (will be skipped)` : ' — all parse OK')
                : '';
        };
        ta.addEventListener('input', refreshPreview);

        function setMode(m) {
            mode = m;
            [assignModeBtn, removeModeBtn].forEach(b => {
                const on = b.dataset.mode === m;
                b.style.background = on ? (m === 'remove' ? '#c0392b' : '#0a8') : '#0a0a1a';
                b.style.color = on ? '#fff' : '#9fb6c4';
                b.style.borderColor = on ? (m === 'remove' ? '#c0392b' : '#0a8') : '#333';
            });
            reqWrap.style.display = m === 'remove' ? 'none' : 'flex';
            if (m === 'remove') {
                help.innerHTML = REMOVE_HELP;
                ta.placeholder = 'AT0000001\tEmergency Light Testing Certificate';
                btn.textContent = 'Remove Forms';
                btn.style.background = '#c0392b';
            } else {
                help.innerHTML = ASSIGN_HELP;
                ta.placeholder = 'AT0000001\tEmergency Light Testing Certificate\tComplete';
                btn.textContent = 'Assign Forms';
                btn.style.background = '#0a8';
            }
            refreshPreview();
        }

        btn.addEventListener('click', async () => {
            const removing = mode === 'remove';
            const rows = parseTable(ta.value, !removing, defaults());
            if (!rows.length) { status.textContent = 'Nothing to process — paste some rows first.'; return; }
            btn.disabled = true; btn.style.opacity = '0.6'; btn.textContent = removing ? 'Removing…' : 'Assigning…';
            const log = [];
            const write = () => { status.textContent = log.join('\n'); status.scrollTop = status.scrollHeight; };
            let done = 0, ok = 0, fail = 0;

            for (const row of rows) {
                done++;
                const tag = `[${done}/${rows.length}] ${row.jobNo || '?'} · ${row.formName || '?'}`;
                if (row.error) { log.push(`✗ ${tag} — ${row.error}`); fail++; write(); continue; }
                try {
                    const job = await resolveJob(row.jobNo);
                    if (!job || !job.id) { log.push(`✗ ${tag} — job not found`); fail++; write(); continue; }
                    if (removing) {
                        const matches = await findAssignedForms(job.id, row.formName);
                        if (!matches.length) { log.push(`✗ ${tag} — not assigned to this job`); fail++; write(); continue; }
                        let removed = 0; const errs = [];
                        for (const rule of matches) {
                            const res = await removeFormRule(job.id, rule);
                            if (res.ok) removed++; else errs.push(res.message);
                        }
                        if (removed && !errs.length) { log.push(`✓ ${tag} — removed${matches.length > 1 ? ' ×' + removed : ''}`); ok++; }
                        else if (removed) { log.push(`✓ ${tag} — removed ${removed}/${matches.length} (${errs.join('; ')})`); ok++; }
                        else { log.push(`✗ ${tag} — ${errs.join('; ')}`); fail++; }
                    } else {
                        const form = await resolveForm(row.formName);
                        if (form.error) { log.push(`✗ ${tag} — ${form.error}`); fail++; write(); continue; }
                        // Only set a "Required on" flag the form actually supports (JL hides the toggle otherwise).
                        const notes = [];
                        let reqVisit = row.reqVisit, reqAsset = row.reqAsset;
                        if (reqVisit && !form.visitForm) { reqVisit = false; notes.push('not a visit form — Req. Visit skipped'); }
                        if (reqAsset && !form.assetForm) { reqAsset = false; notes.push('not an asset form — Req. Asset skipped'); }
                        const res = await assignFormRule(job.id, form, row.stageIds, reqVisit, reqAsset);
                        const stageTxt = row.stageLabels.length ? row.stageLabels.join('+') : 'no stage';
                        const reqTxt = [reqVisit && 'req. visit', reqAsset && 'req. asset'].filter(Boolean).join(' + ') || 'not required';
                        if (res.ok) { log.push(`✓ ${tag} → ${res.updated ? 'updated existing: ' : ''}${stageTxt}, ${reqTxt}` + (notes.length ? ` (${notes.join('; ')})` : '')); ok++; }
                        else { log.push(`✗ ${tag} — ${res.message}`); fail++; }
                    }
                } catch (e) {
                    log.push(`✗ ${tag} — ${e.message || e}`); fail++;
                }
                write();
            }
            log.push(`\nDone: ${ok} ${removing ? 'removed' : 'assigned'}, ${fail} failed.`);
            write();
            btn.disabled = false; btn.style.opacity = '1'; btn.textContent = removing ? 'Remove Forms' : 'Assign Forms';
        });

        setMode('assign');
    }

    // SPA-safe: keep the dock button alive across re-renders.
    function ensureUI() { if (!document.getElementById('jl-launch-' + SCRIPT_ID)) buildUI(); }
    ensureUI();
    new MutationObserver(() => ensureUI()).observe(document.documentElement, { childList: true, subtree: true });
})();
