// ==UserScript==
// @name         Joblogic -> Salesforce - Copy Latest Note (single job)
// @namespace    http://tampermonkey.net/
// @version      1.9
// @description  One-click copy of the latest public note (and same-day images) from the open Joblogic job to the related Salesforce Case Chatter publisher. v1.1: collapses to a launcher button in the shared dock (drag to reorder).
// @match        https://go.joblogic.com/*
// @match        https://wecompany.lightning.force.com/*
// @connect      wecompany.my.salesforce.com
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/joblogic-sf-copy-latest-note.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/joblogic-sf-copy-latest-note.user.js
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
    function jlDockButton(id, label, color, onClick) {
        jlGetDock();
        const l = jlDockList();
        let b = document.getElementById('jl-launch-' + id);
        if (b) return b;
        const bg = color || '#072d3d';
        b = document.createElement('button');
        b.id = 'jl-launch-' + id;
        b.dataset.scriptId = id;
        b.textContent = label;
        b.title = 'Show / hide ' + label + '  (drag to reorder)';
        b.draggable = true;
        b.style.cssText = JL_BTN_CSS + 'background:' + bg + ';border-color:' + bg + ';';
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
            btn.style.boxShadow = opening ? '0 0 0 2px #fff, 0 1px 3px rgba(0,0,0,.25)' : '0 1px 3px rgba(0,0,0,.25)';
        });
        return btn;
    }
    // ===== end shared dock =====

    const SCRIPT_ID = 'sf-copy-latest-note';
    const SCRIPT_LABEL = '🔗 SF Copy Latest Note';
    const SCRIPT_COLOR = '#072d3d';

    // ========================================================================
    // CONFIG
    // ========================================================================
    const SCRIPT_VERSION = '1.0';
    const QUEUE_KEY      = 'jl_sf_copy_queue_v1';   // separate from bulk script's queue
    const ON_JL          = location.hostname === 'go.joblogic.com';
    const ON_SF          = /\.lightning\.force\.com$/.test(location.hostname);
    const SF_ID_RE       = /\b1\d{7}\b/;
    const SF_CLASSIC_SEARCH = caseNumber =>
        `https://wecompany.my.salesforce.com/_ui/search/ui/UnifiedSearchResults?searchType=2&sen=500&str=${encodeURIComponent(caseNumber)}`;

    const sleep   = ms => new Promise(r => setTimeout(r, ms));
    const visible = e => e && e.offsetParent !== null;

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

    // ========================================================================
    // JOBLOGIC — API CALLS
    // ========================================================================
    const jlCsrfToken = () => document.querySelector('input[name="__RequestVerificationToken"]')?.value || '';

    function jlInternalIdFromUrl() {
        const m = location.pathname.match(/\/Job\/Detail\/(\d+)/i);
        return m ? m[1] : null;
    }

    // Fetch the raw /Job/Detail HTML and regex out the fields. More reliable
    // than reading the live DOM — Vue rehydration sometimes mangles IDs and
    // some inputs only render once their tab has been opened.
    async function jlGetDetailFields(internalId) {
        const r = await fetch(`/Job/Detail/${internalId}`, { credentials: 'same-origin' });
        if (!r.ok) throw new Error('Detail HTTP ' + r.status);
        const html = await r.text();
        const grab = re => (html.match(re) || ['',''])[1];
        return {
            description:     grab(/id="Description"[^>]*>([\s\S]*?)<\/textarea>/i) || grab(/"Description"\s*:\s*"([^"]*)"/),
            orderNumber:     grab(/id="OrderNumber"[^>]*value="([^"]*)"/i)         || grab(/"OrderNumber"\s*:\s*"([^"]*)"/),
            customReference: grab(/id="CustomReference"[^>]*value="([^"]*)"/i)     || grab(/"CustomReference"\s*:\s*"([^"]*)"/),
            jobNumber:       grab(/id="JobNumber"[^>]*value="([^"]*)"/i)           || grab(/"JobNumber"\s*:\s*"([^"]*)"/)
        };
    }

    function jlReadJobFieldsFromPage() {
        return {
            description:     document.getElementById('Description')?.value || '',
            orderNumber:     document.getElementById('OrderNumber')?.value || '',
            customReference: document.getElementById('CustomReference')?.value || '',
            jobNumber:       document.getElementById('JobNumber')?.value || ''
        };
    }

    // Latest PUBLIC note across Job (1) + Visit (4) types — engineers may post
    // from either context. Same-day attachments are bundled because photos and
    // text are often saved as separate notes minutes apart.
    async function jlGetLatestPublicNote(internalId) {
        const fd = new FormData();
        fd.append('KeyId', internalId);
        fd.append('EntityType', '3');
        fd.append('NoteTypes[0]', '1');         // Job
        fd.append('NoteTypes[1]', '4');         // Visit
        fd.append('SeePublic',  'true');
        fd.append('SeePrivate', 'false');
        fd.append('SearchText', '');
        fd.append('PageIndex',  '1');
        fd.append('PageSize',   '50');
        fd.append('NoteOrderBy','0');
        fd.append('TagIds', '');
        const r = await fetch('/Note/GetNotes', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'X-Requested-With': 'XMLHttpRequest', '__RequestVerificationToken': jlCsrfToken(), 'Accept': 'application/json' },
            body: fd
        });
        if (!r.ok) throw new Error('GetNotes HTTP ' + r.status);
        const j = await r.json();
        const notes = j.AdditionalData?.Notes || [];
        const parseDate = s => {
            const m = (s||'').match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
            return m ? new Date(+m[3], +m[2]-1, +m[1], +m[4], +m[5]) : new Date(0);
        };
        const publicNotes = notes
            .filter(n => n.NoteVisibilityName === 'Public')
            .sort((a, b) => parseDate(b.DateCreated) - parseDate(a.DateCreated));
        if (!publicNotes.length) return null;
        const latest = publicNotes[0];
        const latestDateKey = (latest.DateCreated || '').split(' ')[0];
        const sameDayAttachments = publicNotes
            .filter(n => (n.DateCreated || '').split(' ')[0] === latestDateKey)
            .flatMap(n => (n.Attachments || [])
                .filter(a => a.IsImage)
                .map(a => ({
                    id: a.Id,
                    name: a.FileName || (a.Id + (a.Extension || '')),
                    mime: extensionToMime(a.Extension),
                    noteVisibility: n.NoteVisibility,
                    entityType: n.EntityType
                })));
        return {
            text: latest.NoteText || '',
            author: latest.ModifiedByUser || latest.Author || '',
            dateCreated: latest.DateCreated || '',
            attachments: sameDayAttachments
        };
    }

    function extensionToMime(ext) {
        const e = (ext || '').toLowerCase().replace(/^\./, '');
        return {
            jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', gif:'image/gif',
            webp:'image/webp', heic:'image/heic', bmp:'image/bmp'
        }[e] || 'application/octet-stream';
    }

    async function jlDownloadAttachmentAsBase64(att) {
        const url = `/Note/DownloadAttachment?attachmentId=${encodeURIComponent(att.id)}&noteVisibility=${encodeURIComponent(att.noteVisibility)}&EntityType=${encodeURIComponent(att.entityType)}`;
        const r = await fetch(url, { credentials: 'same-origin' });
        if (!r.ok) throw new Error('DownloadAttachment HTTP ' + r.status);
        return blobToBase64(await r.blob());
    }

    function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload  = () => resolve(fr.result.split(',')[1]);
            fr.onerror = () => reject(fr.error);
            fr.readAsDataURL(blob);
        });
    }

    function extractSFId(fields) {
        for (const key of ['customReference','orderNumber','description']) {
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
    // JOBLOGIC — FLOATING BUTTON
    // ========================================================================
    function renderJoblogicButton() {
        if (!jlInternalIdFromUrl()) {
            document.getElementById('jl-sf-copy-btn')?.remove();
            document.getElementById('jl-launch-' + SCRIPT_ID)?.remove();
            return;
        }
        if (document.getElementById('jl-sf-copy-btn')) return;

        const wrap = document.createElement('div');
        wrap.id = 'jl-sf-copy-btn';
        wrap.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:99999;font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:flex-end;gap:6px;';

        const btn = document.createElement('button');
        btn.textContent = 'Copy Latest Note to Salesforce';
        btn.style.cssText = 'background:#0a8;color:#fff;border:0;border-radius:6px;padding:12px 18px;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,0.25);';

        const status = document.createElement('div');
        status.style.cssText = 'background:#1a1a2e;color:#eee;padding:6px 10px;border-radius:4px;font:11px monospace;display:none;max-width:340px;white-space:pre-wrap;word-break:break-word;position:relative;padding-right:24px;';
        const statusText = document.createElement('span');
        const statusClose = document.createElement('button');
        statusClose.textContent = 'X';
        statusClose.style.cssText = 'position:absolute;top:2px;right:4px;background:none;border:0;color:#eee;font-size:12px;cursor:pointer;padding:2px 4px;';
        statusClose.onclick = () => { status.style.display = 'none'; };
        status.append(statusText, statusClose);

        wrap.append(btn, status);
        document.body.append(wrap);
        jlRegisterPanel(wrap, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR);

        const setStatus = (msg, color) => {
            status.style.display = 'block';
            status.style.color = color || '#eee';
            statusText.textContent = msg;
        };

        btn.onclick = async () => {
            btn.disabled = true;
            btn.style.opacity = '0.6';
            const original = btn.textContent;
            btn.textContent = 'Working...';
            try {
                const internalId = jlInternalIdFromUrl();
                if (!internalId) throw new Error('Not on a job detail page');

                setStatus('Reading job fields...', '#0af');
                let fields = jlReadJobFieldsFromPage();
                let sfInfo = extractSFId(fields);
                if (!sfInfo) {
                    // DOM read missed it — fall back to fetching /Job/Detail and regex-grepping the HTML.
                    setStatus('DOM read empty — fetching job detail HTML...', '#0af');
                    fields = await jlGetDetailFields(internalId);
                    sfInfo = extractSFId(fields);
                }
                if (!sfInfo) throw new Error('No 8-digit SF ID (1xxxxxxx) found in CustomerOrderNo / ReferenceNo / Description');

                setStatus(`SF ID: ${sfInfo.sfId} (from ${sfInfo.source})\nFetching latest public note...`, '#0af');
                const note = await jlGetLatestPublicNote(internalId);
                if (!note) throw new Error('No public notes found on this job');

                setStatus(`Note by ${note.author} on ${note.dateCreated}\nDownloading ${note.attachments.length} same-day image${note.attachments.length===1?'':'s'}...`, '#0af');
                const images = [];
                for (const a of note.attachments) {
                    try {
                        const b64 = await jlDownloadAttachmentAsBase64(a);
                        images.push({ name: a.name, mime: a.mime, b64 });
                    } catch { /* skip individual image, keep going */ }
                }

                setStatus(`Resolving Case ${sfInfo.sfId}...`, '#0af');
                const caseId = await sfResolveCaseId(sfInfo.sfId);
                if (!caseId) throw new Error(`Could not resolve Salesforce Case ${sfInfo.sfId} — make sure you are signed into Salesforce`);

                const queue = readQueue();
                // Replace any existing entry for the same case so a re-click overwrites cleanly.
                const existing = queue.findIndex(it => it.sfId === sfInfo.sfId);
                if (existing >= 0) queue.splice(existing, 1);
                queue.push({
                    jobNumber:  fields.jobNumber || '',
                    sfId:       sfInfo.sfId,
                    noteText:   note.text,
                    noteAuthor: note.author,
                    noteDate:   note.dateCreated,
                    images,
                    queuedAt:   new Date().toISOString()
                });
                writeQueue(queue);

                setStatus(`Opening Salesforce Case ${sfInfo.sfId}...`, '#0fa');
                window.open(`https://wecompany.lightning.force.com/lightning/r/Case/${caseId}/view`, '_blank');
            } catch (e) {
                setStatus('ERROR: ' + e.message, '#f55');
            } finally {
                btn.textContent = original;
                btn.disabled = false;
                btn.style.opacity = '1';
            }
        };
    }

    // ========================================================================
    // SALESFORCE — DOM HELPERS
    // ========================================================================
    function buildChatterBody(noteAuthor, noteDate, noteText) {
        return [
            `Last note from engineer (${noteAuthor}, ${noteDate}):`,
            noteText || '(no text)'
        ].join('\n');
    }

    const currentCaseNumberFromTitle = () => (document.title.match(/^\s*(\d{7,9})\s*\|/) || [])[1] || null;
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

    async function ensurePublisherVisible() {
        const convTab = [...document.querySelectorAll('a[role="tab"], li[role="tab"], a.slds-tabs_default__link')]
            .find(t => /^conversation$/i.test(t.textContent.trim()) && visible(t));
        if (convTab && convTab.getAttribute('aria-selected') !== 'true') {
            convTab.click();
            await sleep(600);
        }
        const postTab = [...document.querySelectorAll('a[role="tab"], li[role="tab"], a.slds-tabs_default__link, button')]
            .find(t => /^post$/i.test(t.textContent.trim()) && visible(t));
        if (postTab && postTab.getAttribute('aria-selected') !== 'true') {
            postTab.click();
            await sleep(300);
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

    function base64ToFile(b64, name, mime) {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new File([bytes], name, { type: mime });
    }

    function findAttachButton() {
        let b = [...document.querySelectorAll('button.cuf-publisherAttachmentButton')].find(visible);
        if (b) return b;
        return [...document.querySelectorAll('button')].find(btn => {
            if (!visible(btn)) return false;
            const txt = (btn.textContent || '') + ' ' + (btn.getAttribute('title') || '') + ' ' + (btn.getAttribute('aria-label') || '');
            return /attach up to \d+ files/i.test(txt);
        }) || null;
    }

    // Lightning's "Upload Files" creates an ephemeral <input type="file"> and
    // calls .click() to trigger the OS picker. We intercept that .click() and
    // inject our File list via DataTransfer — no OS dialog appears.
    async function attachFilesViaPaperclip(images) {
        if (!images.length) return 0;
        const files = images.map(img => base64ToFile(img.b64, img.name, img.mime));
        const dt = new DataTransfer();
        files.forEach(f => dt.items.add(f));

        const origClick = HTMLInputElement.prototype.click;
        let injected = false;
        HTMLInputElement.prototype.click = function() {
            if (this.type === 'file' && !injected) {
                try { this.files = dt.files; }
                catch { Object.defineProperty(this, 'files', { value: dt.files, configurable: true }); }
                this.dispatchEvent(new Event('change', { bubbles: true }));
                this.dispatchEvent(new Event('input',  { bubbles: true }));
                injected = true;
                return;
            }
            return origClick.apply(this, arguments);
        };

        try {
            const paper = findAttachButton();
            if (!paper) throw new Error('Paperclip "Attach up to N files" button not found');
            paper.click();

            const uploadBtn = await waitFor(() =>
                [...document.querySelectorAll('button')].find(b =>
                    /^upload files$/i.test((b.textContent||'').trim()) && visible(b)
                ), 8000, 200
            );
            if (!uploadBtn) throw new Error('"Upload Files" button not found in Select Files dialog');
            uploadBtn.click();

            if (!await waitFor(() => injected, 4000, 100)) {
                throw new Error('File input .click() was not intercepted');
            }

            await sleep(3000);
            const closeBtn = [...document.querySelectorAll('button')].find(b =>
                visible(b) && !b.disabled && /^(Add|Done|Attach)$/i.test(b.textContent.trim())
            );
            closeBtn?.click();
        } finally {
            HTMLInputElement.prototype.click = origClick;
        }
        return files.length;
    }

    // ========================================================================
    // SALESFORCE — AUTO-FILL PUBLISHER
    // ========================================================================
    function makeSfStatus() {
        document.getElementById('jl-sf-copy-status')?.remove();
        const wrap = document.createElement('div');
        wrap.id = 'jl-sf-copy-status';
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
        const cn = await waitFor(() => currentCaseNumberFromTitle(), 10000, 300);
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
            const bodyText = buildChatterBody(item.noteAuthor, item.noteDate, item.noteText);
            await fillPublisher(bodyText);
            if (item.images.length) {
                status.set(`Attaching ${item.images.length} image${item.images.length===1?'':'s'}...`, '#0af');
                try {
                    await attachFilesViaPaperclip(item.images);
                } catch (e) {
                    status.set('Filled, but image attach failed: ' + e.message, '#fa0');
                    setTimeout(() => status.close(), 8000);
                    return;
                }
            }
            status.set('Ready — review and click Share.', '#0fa');
            setTimeout(() => status.close(), 5000);
        } catch (e) {
            status.set('ERROR: ' + e.message, '#f55');
            setTimeout(() => status.close(), 8000);
        }
    }

    // ========================================================================
    // BOOT
    // ========================================================================
    function boot() {
        if (ON_JL) {
            renderJoblogicButton();
            let lastHref = location.href;
            setInterval(() => {
                if (location.href !== lastHref) {
                    lastHref = location.href;
                    renderJoblogicButton();
                }
            }, 800);
        } else if (ON_SF) {
            handleSalesforceCase();
            let lastHref = location.href;
            setInterval(() => {
                if (location.href !== lastHref) {
                    lastHref = location.href;
                    handleSalesforceCase();
                }
            }, 800);
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
