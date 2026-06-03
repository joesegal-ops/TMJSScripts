// ==UserScript==
// @name         Joblogic - Add Note Everywhere (JL desc + JL note + SF chatter)
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  Floating panel: type one note, prepend "dd/mm - <note>" to the job's Description, add it as a public Job note, and (if an SF Case ID is on the job) post it to the Salesforce Case Chatter feed. v1.3: collapses to a launcher button in the shared dock (drag to reorder).
// @match        https://go.joblogic.com/*
// @match        https://wecompany.lightning.force.com/*
// @connect      wecompany.my.salesforce.com
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ===== Shared JL userscript launcher dock (identical in every script) =====
    const JL_DOCK_ID = 'jl-userscript-dock', JL_ORDER_KEY = 'jl-userscript-dock-order';
    function jlReadOrder() { try { return JSON.parse(localStorage.getItem(JL_ORDER_KEY)) || []; } catch (e) { return []; } }
    function jlSaveOrder() { const d = document.getElementById(JL_DOCK_ID); if (!d) return; localStorage.setItem(JL_ORDER_KEY, JSON.stringify([...d.children].map(b => b.dataset.scriptId).filter(Boolean))); }
    function jlApplyOrder() { const d = document.getElementById(JL_DOCK_ID); if (!d) return; [...d.children].sort((a, b) => { const o = jlReadOrder(); let ia = o.indexOf(a.dataset.scriptId), ib = o.indexOf(b.dataset.scriptId); if (ia < 0) ia = 1e9; if (ib < 0) ib = 1e9; return ia - ib; }).forEach(b => d.appendChild(b)); }
    function jlAfter(d, y) { let c = { o: -Infinity, el: null }; for (const el of d.querySelectorAll('button:not(.jl-dragging)')) { const r = el.getBoundingClientRect(); const off = y - (r.top + r.height / 2); if (off < 0 && off > c.o) c = { o: off, el }; } return c.el; }
    function jlGetDock() {
        let d = document.getElementById(JL_DOCK_ID);
        if (!d) {
            d = document.createElement('div');
            d.id = JL_DOCK_ID;
            d.style.cssText = 'position:fixed;top:80px;left:8px;z-index:100000;display:flex;flex-direction:column;gap:8px;align-items:flex-start;';
            document.body.appendChild(d);
        }
        if (!d.dataset.dnd) {
            d.dataset.dnd = '1';
            d.addEventListener('dragover', e => { e.preventDefault(); const dr = d.querySelector('.jl-dragging'); if (!dr) return; const a = jlAfter(d, e.clientY); if (a == null) d.appendChild(dr); else d.insertBefore(dr, a); });
            d.addEventListener('drop', e => { e.preventDefault(); jlSaveOrder(); });
        }
        return d;
    }
    function jlDockButton(id, label, color, onClick) {
        const d = jlGetDock();
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
        d.appendChild(b);
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

    const SCRIPT_ID = 'add-note-everywhere';
    const SCRIPT_LABEL = '📝 Add Note Everywhere';
    const SCRIPT_COLOR = '#a60';

    // ========================================================================
    // CONFIG
    // ========================================================================
    const SCRIPT_VERSION = '1.0';
    const QUEUE_KEY      = 'jl_add_note_sf_queue_v1';   // own queue, separate from sibling scripts
    const ON_JL          = location.hostname === 'go.joblogic.com';
    const ON_SF          = /\.lightning\.force\.com$/.test(location.hostname);
    const SF_ID_RE       = /\b1\d{7}\b/;
    const SF_CLASSIC_SEARCH = caseNumber =>
        `https://wecompany.my.salesforce.com/_ui/search/ui/UnifiedSearchResults?searchType=2&sen=500&str=${encodeURIComponent(caseNumber)}`;
    const NOTE_VISIBILITY_PUBLIC = 1;   // confirmed via the Add Note dropdown (1=Public, 2=Private, 3=Private+mobile)

    const sleep   = ms => new Promise(r => setTimeout(r, ms));
    const visible = e => e && e.offsetParent !== null;

    // ========================================================================
    // SHARED HELPERS
    // ========================================================================
    const readQueue  = () => { try { return JSON.parse(GM_getValue(QUEUE_KEY, '[]')); } catch { return []; } };
    const writeQueue = q  => GM_setValue(QUEUE_KEY, JSON.stringify(q));

    function gmXhr(opts) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                ...opts,
                onload:    r => resolve(r),
                onerror:   e => reject(new Error('xhr error: ' + (e.error || e.statusText || 'network'))),
                ontimeout: () => reject(new Error('xhr timeout'))
            });
        });
    }

    async function waitFor(fn, timeoutMs = 15000, intervalMs = 250) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            try { const r = fn(); if (r) return r; } catch {}
            await sleep(intervalMs);
        }
        return null;
    }

    function ddmm(date = new Date()) {
        const dd = String(date.getDate()).padStart(2, '0');
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        return `${dd}/${mm}`;
    }

    // ========================================================================
    // JOBLOGIC — API
    // ========================================================================
    const jlCsrfToken = () => document.querySelector('input[name="__RequestVerificationToken"]')?.value || '';

    function jlInternalIdFromUrl() {
        const m = location.pathname.match(/\/Job\/Detail\/(\d+)/i);
        return m ? m[1] : null;
    }

    async function jlSearchJob(ref) {
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
                StartLoggedDate:'', EndLoggedDate:'', StartDate:'', EndDate:'',
                StartCompleteDate:'', EndCompleteDate:'', StartNextContactDate:'', EndNextContactDate:''
            })
        });
        if (!r.ok) throw new Error('Search HTTP ' + r.status);
        const d = await r.json();
        const jobs = d.AdditionalData?.Jobs || d.Data || [];
        if (!jobs.length) return null;
        const match = jobs.find(j => j.JobNumber === ref || j.ReferenceNumber === ref) || jobs[0];
        return { id: match.Id || match.JobId, jobNumber: match.JobNumber || match.ReferenceNumber || ref };
    }

    // /Job/Detail page has a JS object literal with the job's full state. Parse it
    // by anchoring on `"Id":<internalId>` and walking matching braces — same trick
    // joblogic-bulk-close uses, since EditDetail expects the *full* field set echoed
    // back, not just the changed ones.
    function extractJobState(html, internalId) {
        const anchor = `"Id":${internalId}`;
        const i = html.indexOf(anchor);
        if (i < 0) throw new Error(`Job state anchor "${anchor}" not in HTML`);
        let depth = 0, start = -1;
        for (let p = i; p >= 0; p--) {
            const c = html[p];
            if (c === '}') depth++;
            else if (c === '{') {
                if (depth === 0) { start = p; break; }
                depth--;
            }
        }
        if (start < 0) throw new Error('Job state open brace not found');
        let d = 0, inStr = false, esc = false, end = -1;
        for (let j = start; j < html.length; j++) {
            const c = html[j];
            if (esc) { esc = false; continue; }
            if (c === '\\') { esc = true; continue; }
            if (c === '"') { inStr = !inStr; continue; }
            if (inStr) continue;
            if (c === '{') d++;
            else if (c === '}') { d--; if (d === 0) { end = j + 1; break; } }
        }
        if (end < 0) throw new Error('Job state close brace not found');
        return JSON.parse(html.slice(start, end));
    }

    async function jlFetchJobState(internalId) {
        const r = await fetch('/Job/Detail/' + internalId, { credentials: 'same-origin' });
        if (!r.ok) throw new Error('Detail HTTP ' + r.status);
        const html = await r.text();
        const job = extractJobState(html, internalId);
        const csrf = (html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/) || [])[1] || jlCsrfToken();
        return { job, csrf };
    }

    // Re-save all preserved fields with the new Description — mirrors the captured
    // /api/Job/EditDetail payload from joblogic-bulk-close.user.js so the server
    // doesn't null-out fields we forget to send.
    async function jlPrependDescription(internalId, prependLine) {
        const { job, csrf: _csrf } = await jlFetchJobState(internalId);
        const old = job.Description || '';
        const updated = old.trim() ? `${prependLine}\n${old}` : prependLine;
        const existingTagIds = Array.isArray(job.TagIds)
            ? job.TagIds.map(String)
            : (Array.isArray(job.Tags) ? job.Tags.map(t => String(t.Id || t.TagId || t)) : []);

        const entries = [];
        const push = (k, v) => entries.push([k, v == null ? '' : String(v)]);
        push('Id', job.Id);
        push('AssignedToUserId', job.AssignedToUserId);
        existingTagIds.forEach((id, idx) => push(`TagIds[${idx}]`, id));
        push('TradeId', job.TradeId);
        push('IsRecuring', job.IsRecuring);
        push('JobTypeId', job.JobTypeId);
        push('StatusId', job.StatusId);
        push('Description', updated);
        push('DateLogged', job.DateLogged);
        push('AppointmentDate', job.AppointmentDate);
        push('TargetCompletionDate', job.TargetCompletionDate);
        push('DateComplete', job.DateComplete);
        push('TargetAttendanceDate', job.TargetAttendanceDate);
        push('NextContactDate', job.NextContactDate);
        const fc = job.JobFaultCode || {};
        push('JobFaultCode[ReportedFaultCodeId]',      fc.ReportedFaultCodeId);
        push('JobFaultCode[ReportedFaultCodeName]',    fc.ReportedFaultCodeName);
        push('JobFaultCode[ReportedSubFaultCodeId]',   fc.ReportedSubFaultCodeId);
        push('JobFaultCode[ReportedSubFaultCodeName]', fc.ReportedSubFaultCodeName);
        push('JobFaultCode[ActualFaultCodeId]',        fc.ActualFaultCodeId);
        push('JobFaultCode[ActualFaultCodeName]',      fc.ActualFaultCodeName);
        push('JobFaultCode[ActualSubFaultCodeId]',     fc.ActualSubFaultCodeId);
        push('JobFaultCode[ActualSubFaultCodeName]',   fc.ActualSubFaultCodeName);
        push('JobCategoryId', job.JobCategoryId);
        push('PriorityId', job.PriorityId);
        push('OrderNumber', job.OrderNumber);
        push('CustomReference', job.CustomReference);
        push('IsRequireApproval', job.IsRequireApproval);
        push('CompletionTimeSinceOnSite', job.CompletionTimeSinceOnSite);
        push('JobUserReferenceFieldValue', job.JobUserReferenceFieldValue);
        push('JobUserReferenceDropdownListValue', job.JobUserReferenceDropdownListValue);
        push('CustomerContractId', job.CustomerContractId);
        push('ProjectNumber', job.ProjectNumber);
        push('MilestoneId', job.MilestoneId);
        push('ProjectMilestoneId', job.ProjectMilestoneId);
        push('ProjectId', job.ProjectId);
        push('BaseCurrencyCode', job.BaseCurrencyCode);
        push('BaseCurrencyName', job.BaseCurrencyName);
        push('ToCurrencyCode', job.ToCurrencyCode);
        push('ToCurrencyName', job.ToCurrencyName);
        push('ConversionRate', job.ConversionRate);
        push('ExchangeRateDate', job.ExchangeRateDate);
        push('IsEnabledMultipleCurrencies', job.IsEnabledMultipleCurrencies);
        push('PreferredCurrencyId', job.PreferredCurrencyId);
        push('CustomerId', job.CustomerId);
        push('IsAssociatedCustomer', job.IsAssociatedCustomer);

        const body = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
        const headers = {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
            'Accept': 'application/json'
        };
        if (_csrf) headers['__RequestVerificationToken'] = _csrf;

        const resp = await fetch('/api/Job/EditDetail', {
            method: 'POST', credentials: 'same-origin',
            referrer: `${location.origin}/Job/Detail/${internalId}`,
            referrerPolicy: 'unsafe-url', headers, body
        });
        const txt = await resp.text().catch(() => '');
        if (!resp.ok) throw new Error(`EditDetail HTTP ${resp.status}: ${txt.slice(0,300)}`);
        let j = {};
        try { j = JSON.parse(txt); } catch {}
        if (j.success === false) throw new Error('EditDetail success=false: ' + (j.Message || txt.slice(0,200)));

        return {
            jobNumber: job.JobNumber || '',
            customerOrderNo: job.OrderNumber || '',
            customReference: job.CustomReference || '',
            existingDescription: old   // pre-prepend, used for SF-ID extraction
        };
    }

    // POST /Note/AddNote — body shape captured live from the in-page form on
    // 30/04/2026 against go.joblogic.com. Form fields: KeyId, EntityType=3,
    // IsPinned=false, NoteText, jl-multiselect-newnote.tagids, NoteVisibility,
    // __RequestVerificationToken.
    async function jlAddNote(internalId, noteText) {
        const csrf = jlCsrfToken();
        const fd = new FormData();
        fd.append('KeyId', String(internalId));
        fd.append('EntityType', '3');
        fd.append('IsPinned', 'false');
        fd.append('NoteText', noteText);
        fd.append('jl-multiselect-newnote.tagids', '');
        fd.append('NoteVisibility', String(NOTE_VISIBILITY_PUBLIC));
        fd.append('__RequestVerificationToken', csrf);
        const r = await fetch('/Note/AddNote', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'X-Requested-With': 'XMLHttpRequest', '__RequestVerificationToken': csrf, 'Accept': 'application/json' },
            body: fd
        });
        const txt = await r.text().catch(() => '');
        if (!r.ok) throw new Error(`AddNote HTTP ${r.status}: ${txt.slice(0,200)}`);
        let j = {};
        try { j = JSON.parse(txt); } catch {}
        if (j.success === false) throw new Error('AddNote success=false: ' + (j.Message || txt.slice(0,200)));
        return j;
    }

    function extractSFId(fields) {
        for (const key of ['customReference','customerOrderNo','existingDescription']) {
            const m = (fields[key] || '').toString().match(SF_ID_RE);
            if (m) return { sfId: m[0], source: key };
        }
        return null;
    }

    async function sfResolveCaseId(caseNumber) {
        const r = await gmXhr({ method: 'GET', url: SF_CLASSIC_SEARCH(caseNumber), anonymous: false });
        const html = r.responseText || '';
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const link = [...doc.querySelectorAll('a')].find(a => a.textContent.trim() === caseNumber);
        if (link) {
            const m = (link.getAttribute('href') || '').match(/\/(500[a-zA-Z0-9]{12,15})/);
            if (m) return m[1];
        }
        const m2 = html.match(/\/(500[a-zA-Z0-9]{12})\b/);
        return m2 ? m2[1] : null;
    }

    // ========================================================================
    // JOBLOGIC — UI (collapsed pill ↔ expanded panel)
    // ========================================================================
    function renderJoblogicPanel() {
        if (document.getElementById('jl-add-note-root')) return;

        const root = document.createElement('div');
        root.id = 'jl-add-note-root';
        root.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:99999;font-family:system-ui,sans-serif;';
        document.body.append(root);

        // Expanded panel — shown whenever the root is visible (dock controls root)
        const panel = document.createElement('div');
        panel.id = 'jl-add-note-panel';
        panel.style.cssText = 'display:block;background:#1a1a2e;color:#eee;border-radius:8px;padding:14px;width:340px;box-shadow:0 4px 20px rgba(0,0,0,0.5);';

        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;';
        const title = document.createElement('strong');
        title.textContent = 'Add Note Everywhere';
        title.style.fontSize = '13px';
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '_';
        closeBtn.title = 'Collapse';
        closeBtn.style.cssText = 'background:none;border:0;color:#eee;font-size:18px;cursor:pointer;line-height:1;padding:0 4px;';
        header.append(title, closeBtn);
        panel.append(header);

        const ta = document.createElement('textarea');
        ta.placeholder = 'Type your note...';
        ta.style.cssText = 'width:100%;height:90px;background:#0a0a1a;color:#eee;border:1px solid #333;border-radius:4px;padding:6px;font:12px monospace;box-sizing:border-box;';
        panel.append(ta);

        const previewLine = document.createElement('div');
        previewLine.style.cssText = 'color:#0af;font-size:11px;margin-top:4px;';
        previewLine.textContent = `Prepends "${ddmm()} - ..." to description, adds public job note, posts to SF if Case ID found.`;
        panel.append(previewLine);

        const btn = document.createElement('button');
        btn.textContent = 'Add Note Everywhere';
        btn.style.cssText = 'background:#0a8;color:#fff;border:0;border-radius:4px;padding:8px 14px;font-weight:600;cursor:pointer;margin-top:10px;width:100%;';
        panel.append(btn);

        const status = document.createElement('div');
        status.style.cssText = 'margin-top:8px;font:11px monospace;white-space:pre-wrap;word-break:break-word;color:#ccc;max-height:150px;overflow-y:auto;';
        panel.append(status);
        const setStatus = (msg, color) => { status.style.color = color || '#ccc'; status.textContent = msg; };

        root.append(panel);

        // Collapse to the shared dock button instead of a standalone FAB.
        jlRegisterPanel(root, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR);
        closeBtn.onclick = () => { root.style.display = 'none'; };

        btn.onclick = async () => {
            const noteText = ta.value.trim();
            if (!noteText) { setStatus('Please type a note.', '#f55'); return; }
            const internalId = jlInternalIdFromUrl();
            if (!internalId) { setStatus('Not on a job detail page.', '#f55'); return; }

            btn.disabled = true; btn.style.opacity = '0.6'; btn.textContent = 'Working...';
            try {
                const prependLine = `${ddmm()} - ${noteText}`;

                setStatus('Prepending to job description...', '#0af');
                const fields = await jlPrependDescription(internalId, prependLine);

                setStatus('Adding public job note...', '#0af');
                await jlAddNote(internalId, noteText);

                const sfInfo = extractSFId(fields);
                if (!sfInfo) {
                    setStatus(`Done. JL description + note updated for ${fields.jobNumber || internalId}.\nNo Salesforce Case ID on this job — skipping SF.`, '#0fa');
                    return;
                }

                setStatus(`Resolving Salesforce Case ${sfInfo.sfId}...`, '#0af');
                const caseId = await sfResolveCaseId(sfInfo.sfId);
                if (!caseId) throw new Error(`Could not resolve Salesforce Case ${sfInfo.sfId}. Are you signed into Salesforce?`);

                const queue = readQueue();
                queue.push({
                    jobNumber: fields.jobNumber || String(internalId),
                    sfId:      sfInfo.sfId,
                    caseId,
                    noteText,
                    queuedAt:  new Date().toISOString()
                });
                writeQueue(queue);

                setStatus(`Done. Opening Salesforce Case ${sfInfo.sfId}...`, '#0fa');
                window.open(`https://wecompany.lightning.force.com/lightning/r/Case/${caseId}/view`, '_blank');
            } catch (e) {
                setStatus('ERROR: ' + e.message, '#f55');
            } finally {
                btn.disabled = false; btn.style.opacity = '1';
                btn.textContent = 'Add Note Everywhere';
            }
        };
    }

    function removeJoblogicPanel() {
        document.getElementById('jl-add-note-root')?.remove();
        // Drop the dock button too so a later re-render rewires a fresh panel.
        document.getElementById('jl-launch-' + SCRIPT_ID)?.remove();
    }

    // ========================================================================
    // SALESFORCE — DOM helpers (Quill publisher)
    // ========================================================================
    // Read the 8-digit Support Request Number from anywhere we can find it.
    // Tab title format "11397532 | Support Request | Salesforce" works for
    // some user profiles, but layouts vary. Fall back to scanning the DOM for
    // the "Support Request Number" field, then plain-text extraction.
    function currentCaseNumber() {
        const titleMatch = document.title.match(/\b(1\d{7})\b/);
        if (titleMatch) return titleMatch[1];
        const labels = [...document.querySelectorAll('span, label, div')]
            .filter(e => /^support request number$/i.test((e.textContent || '').trim()) && visible(e));
        for (const lab of labels) {
            let el = lab;
            for (let i = 0; i < 6 && el; i++, el = el.parentElement) {
                const v = el.querySelector?.('[class*="output"], [class*="value"], lightning-formatted-text, output');
                if (v) {
                    const m = (v.textContent || '').match(/\b(1\d{7})\b/);
                    if (m) return m[1];
                }
            }
        }
        const top = document.body.innerText.slice(0, 2000);
        const m = top.match(/\b(1\d{7})\b/);
        return m ? m[1] : null;
    }
    const onCasePage = () => /\/lightning\/r\/Case\//.test(location.pathname);

    function findPublisherEditor() {
        const hasSharePlaceholder = e => {
            const p = e.getAttribute('data-placeholder') || e.getAttribute('placeholder') || e.getAttribute('aria-label') || '';
            return /share an update/i.test(p);
        };
        const selectors = [
            '.ql-editor',
            '[contenteditable="true"]',
            '[class*="cuf-publisher"] .ql-editor, [class*="publisher"] .ql-editor, forceChatterPublisher .ql-editor',
            '.ql-editor.slds-rich-text-area__content'
        ];
        for (const sel of selectors) {
            const cand = [...document.querySelectorAll(sel)].find(e => visible(e) && (sel.includes('rich-text-area') || hasSharePlaceholder(e)));
            if (cand) return cand;
        }
        return null;
    }

    const findPublisherDummyButton = () =>
        [...document.querySelectorAll('button[title="Share an update..."]')].find(visible) || null;

    // Broad search across all shapes Lightning case-feed sub-tabs take. Some
    // users see "Email | Post | Email Translation"; others "Post | Email
    // Translation". When Email is the default, we MUST switch to Post or the
    // publisher is the wrong one ("Write an email..." vs "Share an update...").
    function findTabByLabel(label) {
        const re = new RegExp(`^${label}$`, 'i');
        const all = document.querySelectorAll(
            'a[role="tab"], li[role="tab"], button[role="tab"], ' +
            'a.slds-tabs_default__link, a.slds-vertical-tabs__link, ' +
            '[role="tablist"] a, [role="tablist"] button, ' +
            'lightning-tab-bar a, lightning-tab a'
        );
        return [...all].find(t => re.test(t.textContent.trim()) && visible(t)) || null;
    }

    async function ensurePublisherVisible() {
        const convTab = findTabByLabel('conversation');
        if (convTab && convTab.getAttribute('aria-selected') !== 'true') {
            convTab.click();
            await sleep(600);
        }
        const postTab = findTabByLabel('post');
        if (postTab && postTab.getAttribute('aria-selected') !== 'true') {
            postTab.click();
            await sleep(400);
        }
        if (!findPublisherEditor()) {
            const dummy = await waitFor(findPublisherDummyButton, 10000, 300);
            if (dummy) {
                dummy.scrollIntoView({ block: 'center' });
                await sleep(200);
                dummy.click();
                await sleep(600);
            }
        }
        if (!findPublisherEditor()) {
            for (const y of [0, 400, 800, 1200]) {
                window.scrollTo({ top: y, behavior: 'instant' });
                await sleep(200);
                if (findPublisherEditor()) return true;
            }
        }
        return !!findPublisherEditor();
    }

    const escapeHtml = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const textToQuillHtml = text => text.split('\n').map(l => l ? `<p>${escapeHtml(l)}</p>` : '<p><br></p>').join('');

    async function fillPublisher(text) {
        const editor = await waitFor(findPublisherEditor);
        if (!editor) throw new Error('Publisher editor not found — open the Conversation tab and scroll to "Share an update..."');
        editor.focus();
        editor.innerHTML = textToQuillHtml(text);
        editor.classList.remove('ql-blank');
        editor.dispatchEvent(new Event('input',  { bubbles: true }));
        editor.dispatchEvent(new Event('change', { bubbles: true }));
        return editor;
    }

    function makeSfStatus() {
        document.getElementById('jl-add-note-sf-status')?.remove();
        const wrap = document.createElement('div');
        wrap.id = 'jl-add-note-sf-status';
        wrap.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:99999;background:#1a1a2e;color:#eee;border-radius:6px;padding:10px 14px;font:12px monospace;max-width:380px;box-shadow:0 4px 14px rgba(0,0,0,0.4);';
        document.body.append(wrap);
        return {
            set: (msg, color) => { wrap.style.color = color || '#eee'; wrap.textContent = msg; },
            close: () => wrap.remove()
        };
    }

    function consumeQueueItem(sfId) {
        const q = readQueue();
        const i = q.findIndex(it => it.sfId === sfId);
        if (i < 0) return null;
        const [item] = q.splice(i, 1);
        writeQueue(q);
        return item;
    }

    let lastHandledKey = null;
    async function handleSalesforceCase() {
        if (!onCasePage()) return;
        const cn = await waitFor(() => currentCaseNumber(), 10000, 300);
        if (!cn) return;
        const key = `${location.pathname}|${cn}`;
        if (lastHandledKey === key) return;
        const peek = readQueue().find(it => it.sfId === cn);
        if (!peek) return;
        lastHandledKey = key;

        const item = consumeQueueItem(cn);
        if (!item) return;

        const status = makeSfStatus();
        status.set(`Filling publisher for ${item.jobNumber || cn}...`, '#0af');
        try {
            await ensurePublisherVisible();
            await fillPublisher(item.noteText);
            status.set('Ready — review and click Share.', '#0fa');
            setTimeout(() => status.close(), 5000);
        } catch (e) {
            status.set('ERROR: ' + e.message + '\n(Note left in the publisher area for manual posting.)', '#f55');
            setTimeout(() => status.close(), 10000);
        }
    }

    // ========================================================================
    // BOOT
    // ========================================================================
    function boot() {
        if (ON_JL) {
            // Only mount on /Job/Detail/<id>; tear down when navigating away.
            const sync = () => {
                if (jlInternalIdFromUrl()) renderJoblogicPanel();
                else removeJoblogicPanel();
            };
            sync();
            let lastHref = location.href;
            setInterval(() => {
                if (location.href === lastHref) return;
                lastHref = location.href;
                sync();
            }, 800);
        } else if (ON_SF) {
            handleSalesforceCase();
            let lastHref = location.href;
            setInterval(() => {
                if (location.href === lastHref) return;
                lastHref = location.href;
                handleSalesforceCase();
            }, 800);
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
