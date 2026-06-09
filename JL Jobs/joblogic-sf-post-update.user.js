// ==UserScript==
// @name         Joblogic -> Salesforce - Post Visit Update
// @namespace    http://tampermonkey.net/
// @version      2.15
// @description  Collect latest public visit note + same-day images from Joblogic jobs, post them to matching Salesforce Support Request Chatter feed. v2.5: collapses to a launcher button in the shared dock (drag to reorder).
// @match        https://go.joblogic.com/*
// @match        https://wecompany.lightning.force.com/*
// @connect      wecompany.my.salesforce.com
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/joblogic-sf-post-update.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Jobs/joblogic-sf-post-update.user.js
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

    const SCRIPT_ID = 'sf-post-update';
    const SCRIPT_LABEL = '🔗 SF Post Update';
    const SCRIPT_COLOR = '#072d3d';
    const SCRIPT_DESC = 'Collects the latest public visit note and same-day photos from jobs and posts them to the matching Salesforce Support Request Chatter. Scan the jobs, then run.';

    // ========================================================================
    // CONFIG
    // ========================================================================
    const SCRIPT_VERSION = '2.15';
    const SF_HOST        = 'https://wecompany.lightning.force.com';
    const sfCaseUrl      = caseId => `${SF_HOST}/lightning/r/Case/${caseId}/view`;
    const QUEUE_KEY      = 'jl_sf_queue_v1';
    const MESSAGE_KEY    = 'jl_sf_message_v1';
    const ON_JL          = location.hostname === 'go.joblogic.com';
    const ON_SF          = /\.lightning\.force\.com$/.test(location.hostname);
    const SF_ID_RE       = /\b1\d{7}\b/;     // 8 digits starting with 1
    const SF_CLASSIC_SEARCH = caseNumber =>
        `https://wecompany.my.salesforce.com/_ui/search/ui/UnifiedSearchResults?searchType=2&sen=500&str=${encodeURIComponent(caseNumber)}`;
    const DELAY_BETWEEN  = 400;
    const HEADER_WORDS   = ['job id','job no','job no.','jobid','job number','id','job ref','ref','reference','job reference'];

    const sleep   = ms => new Promise(r => setTimeout(r, ms));
    const visible = e => e && e.offsetParent !== null;

    // ========================================================================
    // SHARED — UI PANEL SHELL
    // ========================================================================
    function makePanel(title) {
        document.getElementById('jl-sf-panel')?.remove();
        const panel = document.createElement('div');
        panel.id = 'jl-sf-panel';
        const body = document.createElement('div');
        body.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;background:#1a1a2e;color:#eee;border-radius:8px;padding:14px;width:560px;max-height:85vh;display:flex;flex-direction:column;font-family:monospace;font-size:12px;box-shadow:0 4px 20px rgba(0,0,0,0.5);';
        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;';
        const t = document.createElement('strong'); t.style.fontSize = '14px'; t.textContent = title;
        const x = document.createElement('button');
        x.style.cssText = 'background:none;border:none;color:#eee;font-size:18px;cursor:pointer;';
        x.textContent = 'X'; x.onclick = () => { panel.style.display = 'none'; };
        header.append(t, x);
        body.append(header);
        panel.append(body);
        document.body.append(panel);
        jlRegisterPanel(panel, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR, SCRIPT_DESC);
        return { panel, body };
    }

    function makeButton(label, bg) {
        const b = document.createElement('button');
        b.style.cssText = `background:${bg};color:#fff;border:none;padding:8px 14px;border-radius:4px;cursor:pointer;margin-right:6px;`;
        b.textContent = label;
        return b;
    }

    function makeLogArea() {
        const a = document.createElement('div');
        a.style.cssText = 'flex:1;overflow-y:auto;background:#0a0a1a;padding:8px;border-radius:4px;max-height:55vh;margin-top:8px;';
        return a;
    }

    function logTo(area, msg, color) {
        const l = document.createElement('div');
        l.style.color = color || '#ccc';
        l.style.whiteSpace = 'pre-wrap';
        l.style.wordBreak = 'break-word';
        l.textContent = msg;
        area.append(l);
        area.scrollTop = area.scrollHeight;
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
    // SHARED — QUEUE + GM helpers
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

    // ========================================================================
    // JOBLOGIC — API CALLS
    // ========================================================================
    const jlCsrfToken = () => document.querySelector('input[name="__RequestVerificationToken"]')?.value || '';

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
        return {
            id: match.Id || match.JobId,
            jobNumber: match.JobNumber || match.ReferenceNumber || ref,
            orderNumber: match.OrderNumber || '',
            customReference: match.CustomReference || '',
            description: match.Description || ''
        };
    }

    // Fallback used when /api/Job/SearchJsonData doesn't return the fields the
    // SF-ID regex needs (rare, but some orgs strip Description from search hits).
    async function jlGetDetailFields(internalId) {
        const r = await fetch(`/Job/Detail/${internalId}`, { credentials: 'same-origin' });
        if (!r.ok) throw new Error('Detail HTTP ' + r.status);
        const html = await r.text();
        const grab = re => (html.match(re) || ['',''])[1];
        return {
            description:     grab(/id="Description"[^>]*>([\s\S]*?)<\/textarea>/i) || grab(/"Description"\s*:\s*"([^"]*)"/),
            orderNumber:     grab(/id="OrderNumber"[^>]*value="([^"]*)"/i)         || grab(/"OrderNumber"\s*:\s*"([^"]*)"/),
            customReference: grab(/id="CustomReference"[^>]*value="([^"]*)"/i)     || grab(/"CustomReference"\s*:\s*"([^"]*)"/)
        };
    }

    function extractSFId(fields) {
        for (const key of ['customReference','orderNumber','description']) {
            const m = (fields[key] || '').toString().match(SF_ID_RE);
            if (m) return { sfId: m[0], source: key };
        }
        return null;
    }

    async function jlGetPublicVisitNotes(internalId) {
        const fd = new FormData();
        fd.append('KeyId', internalId);
        fd.append('EntityType', '3');
        fd.append('NoteTypes[0]', '4');         // 4 = Visit
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
        // DateCreated is "DD/MM/YYYY HH:MM" — parse into sortable Date.
        const parseDate = s => {
            const m = (s||'').match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
            return m ? new Date(+m[3], +m[2]-1, +m[1], +m[4], +m[5]) : new Date(0);
        };
        return notes
            .filter(n => n.EntityType === 4 && n.NoteVisibilityName === 'Public')
            .sort((a, b) => parseDate(b.DateCreated) - parseDate(a.DateCreated))
            .map(n => ({
                text: n.NoteText || '',
                author: n.ModifiedByUser || n.Author || '',
                dateCreated: n.DateCreated || '',
                dateKey: (n.DateCreated || '').split(' ')[0],   // DD/MM/YYYY
                attachments: (n.Attachments || [])
                    .filter(a => a.IsImage)
                    .map(a => ({
                        id: a.Id,
                        name: a.FileName || (a.Id + (a.Extension || '')),
                        mime: extensionToMime(a.Extension),
                        noteVisibility: n.NoteVisibility,
                        entityType: n.EntityType
                    }))
            }));
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

    // ========================================================================
    // JOBLOGIC — UI PANEL
    // ========================================================================
    function parseJobRefs(text) {
        let t = text.split(/[\s,]+/).map(s => s.replace(/^"|"$/g,'').trim()).filter(Boolean);
        if (t.length && HEADER_WORDS.includes(t[0].toLowerCase())) t = t.slice(1);
        return [...new Set(t)];
    }

    function openPasteDialog(onLoad) {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:100000;display:flex;align-items:center;justify-content:center;';
        overlay.innerHTML = `
            <div style="background:#fff;color:#111;border-radius:8px;width:520px;max-width:92vw;box-shadow:0 10px 40px rgba(0,0,0,.4);overflow:hidden;font-family:system-ui,sans-serif;">
                <div style="padding:12px 16px;background:#111827;color:#f9fafb;font-weight:600;">Paste job numbers</div>
                <div style="padding:14px 16px;">
                    <textarea id="jl-sf-paste-ta" style="width:100%;height:200px;font:13px monospace;padding:8px;border:1px solid #d1d5db;border-radius:4px;box-sizing:border-box;" placeholder="Paste comma-, tab-, or newline-separated job numbers"></textarea>
                    <div style="color:#6b7280;font-size:12px;margin-top:6px;">Any separator. Header row ignored.</div>
                    <div id="jl-sf-paste-count" style="color:#2563eb;font-size:12px;margin-top:6px;font-weight:600;">0 job IDs detected</div>
                    <div style="text-align:right;margin-top:10px;">
                        <button id="jl-sf-paste-cancel" style="background:#9ca3af;color:#fff;border:0;border-radius:4px;padding:7px 14px;cursor:pointer;margin-right:6px;">Cancel</button>
                        <button id="jl-sf-paste-ok" style="background:#2563eb;color:#fff;border:0;border-radius:4px;padding:7px 14px;cursor:pointer;">Load</button>
                    </div>
                </div>
            </div>`;
        document.body.append(overlay);
        const ta = overlay.querySelector('#jl-sf-paste-ta');
        const count = overlay.querySelector('#jl-sf-paste-count');
        ta.addEventListener('input', () => {
            const n = parseJobRefs(ta.value).length;
            count.textContent = `${n} job ID${n===1?'':'s'} detected`;
        });
        overlay.querySelector('#jl-sf-paste-cancel').onclick = () => overlay.remove();
        overlay.querySelector('#jl-sf-paste-ok').onclick = () => {
            const refs = parseJobRefs(ta.value);
            overlay.remove();
            onLoad(refs);
        };
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
        setTimeout(() => ta.focus(), 50);
    }

    function renderJoblogicUI() {
        const { body } = makePanel(`JL -> SF — Collect from Joblogic  (v${SCRIPT_VERSION})`);

        const progress = document.createElement('div');
        progress.style.cssText = 'color:#0fa;margin-bottom:8px;';
        progress.textContent = 'Paste job numbers and add your message.';
        body.append(progress);

        const msgLabel = document.createElement('div');
        msgLabel.textContent = 'Personalised message (will appear above the engineer note):';
        msgLabel.style.cssText = 'color:#0af;margin-bottom:4px;';
        body.append(msgLabel);
        const msgTa = document.createElement('textarea');
        msgTa.style.cssText = 'width:100%;height:60px;background:#0a0a1a;color:#eee;border:1px solid #333;border-radius:4px;padding:6px;font:12px monospace;box-sizing:border-box;margin-bottom:10px;';
        msgTa.value = GM_getValue(MESSAGE_KEY, '');
        msgTa.addEventListener('input', () => GM_setValue(MESSAGE_KEY, msgTa.value));
        body.append(msgTa);

        const pasteBtn   = makeButton('Paste Jobs', '#08a');
        const collectBtn = makeButton('Collect & Queue', '#0a8');
        const openSfBtn  = makeButton('Open Salesforce', '#a08');
        const clearBtn   = makeButton('Clear Queue', '#555');
        collectBtn.disabled = true; collectBtn.style.opacity = '0.5';
        const controls = document.createElement('div');
        controls.append(pasteBtn, collectBtn, openSfBtn, clearBtn);
        body.append(controls);

        const qInfo = document.createElement('div');
        qInfo.style.cssText = 'color:#fa0;margin-top:8px;font-size:11px;';
        body.append(qInfo);
        const refreshQInfo = () => {
            const q = readQueue();
            qInfo.textContent = `Queue: ${q.length} item${q.length===1?'':'s'} waiting for Salesforce.`;
        };
        refreshQInfo();

        const logArea = makeLogArea();
        body.append(logArea);
        const log = (m,c) => logTo(logArea, m, c);

        let jobRefs = [];
        let running = false;

        pasteBtn.onclick = () => openPasteDialog(refs => {
            jobRefs = refs;
            if (refs.length) {
                log(`Loaded ${refs.length} job refs: ${refs.slice(0,10).join(', ')}${refs.length>10?'...':''}`, '#0af');
                progress.textContent = `${refs.length} jobs ready. Click Collect & Queue.`;
                collectBtn.disabled = false; collectBtn.style.opacity = '1';
            } else {
                progress.textContent = 'No valid job numbers found.';
                collectBtn.disabled = true; collectBtn.style.opacity = '0.5';
            }
        });

        collectBtn.onclick = async () => {
            if (running || !jobRefs.length) return;
            const message = msgTa.value.trim();
            if (!message) { log('Please enter a personalised message first.', '#f55'); return; }

            running = true;
            collectBtn.disabled = pasteBtn.disabled = true;
            collectBtn.style.opacity = pasteBtn.style.opacity = '0.5';
            logArea.innerHTML = '';
            log(`Script v${SCRIPT_VERSION}`, '#888');
            log(`Collecting ${jobRefs.length} jobs...`, '#0af');

            const queue = readQueue();
            const stats = { ok:0, noSfId:0, noNotes:0, err:0 };

            for (let i = 0; i < jobRefs.length; i++) {
                const ref = jobRefs[i];
                progress.textContent = `Collecting ${i+1}/${jobRefs.length}: ${ref}`;
                log(`--- [${i+1}/${jobRefs.length}] ${ref} ---`, '#fff');
                try {
                    const job = await jlSearchJob(ref);
                    if (!job) { log('  Not found', '#f55'); stats.err++; continue; }
                    log(`  Internal id: ${job.id}`);

                    let sfInfo = extractSFId(job);
                    if (!sfInfo) sfInfo = extractSFId(await jlGetDetailFields(job.id));
                    if (!sfInfo) { log('  No 8-digit SF ID (1xxxxxxx) found in CustomerOrderNo/ReferenceNo/Description', '#f55'); stats.noSfId++; continue; }
                    log(`  SF ID: ${sfInfo.sfId}  (from ${sfInfo.source})`, '#0af');

                    const notes = await jlGetPublicVisitNotes(job.id);
                    if (!notes.length) { log('  No public visit notes', '#fa0'); stats.noNotes++; continue; }
                    const latest = notes[0];
                    log(`  Latest note: ${latest.dateCreated} by ${latest.author}`, '#0a8');

                    // Include images attached to ANY public visit note dated the
                    // same day as the latest one — engineers often post the note
                    // and photos as separate notes within minutes of each other.
                    const sameDayAtts = notes.filter(n => n.dateKey === latest.dateKey).flatMap(n => n.attachments);

                    const images = [];
                    for (const a of sameDayAtts) {
                        try {
                            const b64 = await jlDownloadAttachmentAsBase64(a);
                            images.push({ name: a.name, mime: a.mime, b64 });
                            log(`  Image: ${a.name} (${(b64.length*3/4/1024).toFixed(0)} KB)`, '#888');
                        } catch (e) {
                            log(`  Image fail: ${a.name}: ${e.message}`, '#f55');
                        }
                    }

                    queue.push({
                        jobNumber: job.jobNumber,
                        sfId:      sfInfo.sfId,
                        message,
                        noteText:  latest.text,
                        noteAuthor: latest.author,
                        noteDate:  latest.dateCreated,
                        images,
                        queuedAt:  new Date().toISOString()
                    });
                    writeQueue(queue);
                    refreshQInfo();
                    stats.ok++;
                    log(`  Queued (${images.length} image${images.length===1?'':'s'})`, '#0fa');
                } catch (e) {
                    log(`  ERROR: ${e.message}`, '#f55');
                    stats.err++;
                }
                await sleep(DELAY_BETWEEN);
            }

            log('');
            log(`Done. Queued:${stats.ok}  NoSFId:${stats.noSfId}  NoNotes:${stats.noNotes}  Errors:${stats.err}`, '#0af');
            progress.textContent = `Collected. Open Salesforce to post the queue.`;
            running = false;
            collectBtn.disabled = pasteBtn.disabled = false;
            collectBtn.style.opacity = pasteBtn.style.opacity = '1';
        };

        openSfBtn.onclick = async () => {
            const q = readQueue();
            if (!q.length) { window.open(SF_HOST + '/', '_blank'); return; }
            const item = q[0];
            log(`Resolving SF Case Id for ${item.sfId}...`, '#0af');
            try {
                const caseId = await sfResolveCaseId(item.sfId);
                if (caseId) {
                    // Persist the resolved Case Id on the queue item so the SF
                    // tab can match by URL even when the title is generic.
                    const cur = readQueue();
                    const idx = cur.findIndex(it => it.queuedAt === item.queuedAt && it.sfId === item.sfId);
                    if (idx >= 0) { cur[idx].caseId = caseId; writeQueue(cur); }
                    window.open(sfCaseUrl(caseId), '_blank');
                    return;
                }
                log(`No Case found for ${item.sfId} — opening SF home.`, '#fa0');
            } catch (e) {
                log(`Resolve failed: ${e.message} — opening SF home.`, '#fa0');
            }
            window.open(SF_HOST + '/', '_blank');
        };

        clearBtn.onclick = () => {
            if (!confirm('Clear the entire Salesforce queue? Any collected-but-unposted jobs will be lost.')) return;
            writeQueue([]);
            refreshQInfo();
            log('Queue cleared.', '#f55');
        };
    }

    // ========================================================================
    // SALESFORCE — DOM HELPERS
    // ========================================================================
    function buildChatterBody(message, noteAuthor, noteDate, noteText) {
        const parts = [];
        if (message) parts.push(message);
        parts.push('');
        parts.push(`Last note from engineer (${noteAuthor}, ${noteDate}):`);
        parts.push(noteText || '(no text)');
        return parts.join('\n');
    }

    // Read the 8-digit Support Request Number from anywhere we can find it.
    // Tab title: "11397532 | Support Request | Salesforce" works for some
    // users, but layouts vary. Fall back to scanning the DOM for the
    // "Support Request Number" field, then to plain text extraction.
    function currentCaseNumber() {
        const titleMatch = document.title.match(/\b(1\d{7})\b/);
        if (titleMatch) return titleMatch[1];
        // DOM fallback: find a label with the field name and read its sibling
        const labels = [...document.querySelectorAll('span, label, div')]
            .filter(e => /^support request number$/i.test((e.textContent || '').trim()) && visible(e));
        for (const lab of labels) {
            // Walk up to a slds-form-element and grab the value inside
            let el = lab;
            for (let i = 0; i < 6 && el; i++, el = el.parentElement) {
                const v = el.querySelector?.('[class*="output"], [class*="value"], lightning-formatted-text, output');
                if (v) {
                    const m = (v.textContent || '').match(/\b(1\d{7})\b/);
                    if (m) return m[1];
                }
            }
        }
        // Last resort: any 8-digit "1xxxxxxx" near the top of the body text
        const top = document.body.innerText.slice(0, 2000);
        const m = top.match(/\b(1\d{7})\b/);
        return m ? m[1] : null;
    }
    const onCasePage = () => /\/lightning\/r\/Case\//.test(location.pathname);
    // The URL on a Case page contains the 15- or 18-char Case Id (e.g.
    // /lightning/r/Case/500Uz000010B9h3IAC/view). The first 15 chars are the
    // canonical short Id; SF guarantees uniqueness on those 15.
    function caseIdFromUrl() {
        const m = location.pathname.match(/\/Case\/(500[a-zA-Z0-9]{12,15})/);
        return m ? m[1].slice(0, 15) : null;
    }
    const sameCaseId = (a, b) => a && b && a.slice(0, 15) === b.slice(0, 15);

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

    // The publisher renders as a collapsed "Share an update..." dummy button
    // until clicked; clicking expands it into the real Quill editor.
    const findPublisherDummyButton = () =>
        [...document.querySelectorAll('button[title="Share an update..."]')].find(visible) || null;

    // Broad search across all the shapes Lightning case-feed sub-tabs take.
    // Some users see "Email | Post | Email Translation"; others "Post | Email
    // Translation". When Email is the default, we MUST switch to Post or the
    // publisher is the wrong one ("Write an email..." instead of
    // "Share an update...").
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

    async function ensurePublisherVisible(log) {
        const convTab = findTabByLabel('conversation');
        if (convTab && convTab.getAttribute('aria-selected') !== 'true') {
            log?.('  Clicking Conversation tab', '#888');
            convTab.click();
            await sleep(600);
        }
        const postTab = findTabByLabel('post');
        if (!postTab) {
            log?.('  WARN: Post sub-tab not found (case-feed layout may differ).', '#fa0');
        } else if (postTab.getAttribute('aria-selected') !== 'true') {
            log?.('  Clicking Post sub-tab', '#888');
            postTab.click();
            await sleep(400);
        }
        if (!findPublisherEditor()) {
            const dummy = await waitFor(findPublisherDummyButton, 10000, 300);
            if (dummy) {
                log?.('  Clicking dummy "Share an update..." to expand editor', '#888');
                dummy.scrollIntoView({ block: 'center' });
                await sleep(200);
                dummy.click();
                await sleep(600);
            } else {
                log?.('  WARN: dummy "Share an update..." button never appeared.', '#fa0');
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

    // Lightning's "Upload Files" creates an ephemeral <input type="file">,
    // calls .click() on it to open the OS picker, then removes it.
    // We intercept that .click() and inject our File list via DataTransfer
    // instead, so no OS dialog appears.
    async function attachFilesViaPaperclip(images, log) {
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
                throw new Error('File input .click() was not intercepted (Lightning may have changed its upload flow)');
            }
            log?.(`  Injected ${files.length} file${files.length===1?'':'s'} via intercepted file input`, '#888');

            await sleep(3000);
            const closeBtn = [...document.querySelectorAll('button')].find(b =>
                visible(b) && !b.disabled && /^(Add|Done|Attach)$/i.test(b.textContent.trim())
            );
            if (closeBtn) {
                closeBtn.click();
                log?.(`  Clicked "${closeBtn.textContent.trim()}"`, '#888');
            } else {
                log?.('  Dialog likely auto-closed after upload.', '#888');
            }
        } finally {
            HTMLInputElement.prototype.click = origClick;
        }
        return files.length;
    }

    // Resolve 8-digit Case Number -> 15-char Salesforce Id via Classic search.
    // GM_xhr bypasses CORS to my.salesforce.com; session cookie auto-attached.
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
    // SALESFORCE — UI PANEL
    // ========================================================================
    function renderSalesforceUI() {
        const { body } = makePanel(`JL -> SF — Post to Salesforce  (v${SCRIPT_VERSION})`);

        const progress = document.createElement('div');
        progress.style.cssText = 'color:#0fa;margin-bottom:8px;';
        body.append(progress);

        const nextBtn  = makeButton('Mark Posted ▸ Next', '#0a8');
        const clearBtn = makeButton('Clear Queue', '#555');
        const controls = document.createElement('div');
        controls.append(nextBtn, clearBtn);
        body.append(controls);

        const qInfo = document.createElement('div');
        qInfo.style.cssText = 'color:#fa0;margin-top:8px;font-size:11px;';
        body.append(qInfo);

        const logArea = makeLogArea();
        body.append(logArea);
        const log = (m,c) => logTo(logArea, m, c);
        log(`Script v${SCRIPT_VERSION}`, '#888');

        const currentMatchedItem = () => {
            if (!onCasePage()) return null;
            const q = readQueue();
            // Prefer URL-based match (works regardless of tab title / DOM state).
            const cid = caseIdFromUrl();
            if (cid) {
                const byCid = q.find(it => sameCaseId(it.caseId, cid));
                if (byCid) return byCid;
            }
            // Fallback: extract Case Number from title / DOM and match by sfId.
            const cn = currentCaseNumber();
            return cn ? q.find(it => it.sfId === cn) || null : null;
        };

        const refresh = () => {
            const q = readQueue();
            qInfo.textContent = `Queue: ${q.length} item${q.length===1?'':'s'} pending.`;
            const empty = !q.length;
            const onMatch = !!currentMatchedItem();
            // Primary button label adapts: post-and-advance vs just-open-next
            nextBtn.textContent = onMatch ? 'Mark Posted ▸ Next' : 'Open Next Case';
            nextBtn.disabled = empty;
            nextBtn.style.opacity = empty ? '0.5' : '1';
            if (empty) { progress.textContent = 'Queue is empty.'; return; }
            const preview = q.slice(0,3).map(it => `${it.jobNumber} -> ${it.sfId} (${it.images.length} img)`).join('  |  ');
            progress.textContent = preview + (q.length > 3 ? `  (+${q.length-3} more)` : '');
        };

        async function doPrep(item) {
            try {
                await ensurePublisherVisible(log);
                const bodyText = buildChatterBody(item.message, item.noteAuthor, item.noteDate, item.noteText);
                await fillPublisher(bodyText);
                log('Publisher filled.', '#0fa');
                if (item.images.length) {
                    try {
                        const n = await attachFilesViaPaperclip(item.images, log);
                        log(`Attached ${n} file${n===1?'':'s'}. Wait for upload before Share.`, '#0fa');
                    } catch (e) {
                        log(`File attach failed: ${e.message}`, '#f55');
                    }
                } else {
                    log('No images to attach.', '#888');
                }
                log('READY — review, click Share in Salesforce, then click "Mark Posted ▸ Next".', '#0fa');
                refresh();
            } catch (e) {
                log(`Prep failed: ${e.message}`, '#f55');
            }
        }

        async function navigateToNext() {
            const q = readQueue();
            if (!q.length) { log('Queue empty — done.', '#0fa'); refresh(); return; }
            const item = q[0];
            let caseId = item.caseId;
            if (!caseId) {
                log(`Resolving SF Case Id for ${item.sfId}...`, '#0af');
                try {
                    caseId = await sfResolveCaseId(item.sfId);
                } catch (e) {
                    log(`Resolve failed: ${e.message}`, '#f55');
                    return;
                }
                if (!caseId) { log(`No Case found for ${item.sfId}.`, '#f55'); return; }
                // Persist so currentMatchedItem() can match by URL after nav.
                const cur = readQueue();
                const idx = cur.findIndex(it => it.queuedAt === item.queuedAt && it.sfId === item.sfId);
                if (idx >= 0) { cur[idx].caseId = caseId; writeQueue(cur); }
            }
            log(`Navigating to ${item.jobNumber} -> ${item.sfId}`, '#0fa');
            location.href = `/lightning/r/Case/${caseId}/view`;
        }

        function removeFromQueue(item) {
            const cur = readQueue();
            const j = cur.findIndex(it => it.jobNumber === item.jobNumber && it.sfId === item.sfId && it.queuedAt === item.queuedAt);
            if (j >= 0) { cur.splice(j, 1); writeQueue(cur); }
        }

        nextBtn.onclick = async () => {
            const item = currentMatchedItem();
            if (item) {
                removeFromQueue(item);
                log(`Marked ${item.jobNumber} posted.`, '#0fa');
            }
            await navigateToNext();
        };

        clearBtn.onclick = () => {
            if (!confirm('Clear the entire Salesforce queue?')) return;
            writeQueue([]);
            refresh();
            log('Queue cleared.', '#f55');
        };

        refresh();

        // Auto-prep once per Case landing. The key combines path + queuedAt so
        // revisiting a Case after a skip/mark doesn't double-fire.
        let lastAutoPreppedKey = null;
        async function maybeAutoPrep(reason) {
            const item = currentMatchedItem();
            if (!item) {
                if (onCasePage()) {
                    const cid = caseIdFromUrl();
                    const cn  = currentCaseNumber();
                    log(`Auto-prep (${reason}) skipped: URL caseId=${cid||'?'} caseNumber=${cn||'?'} — not in queue (or queue items don't yet have cached caseId; click "Open Next Case" once to seed).`, '#fa0');
                }
                return;
            }
            const key = `${location.pathname}|${item.queuedAt}`;
            if (lastAutoPreppedKey === key) return;
            lastAutoPreppedKey = key;
            log(`Auto-prep (${reason}): ${item.jobNumber} -> ${item.sfId}`, '#0af');
            await sleep(1500);
            let editor = findPublisherEditor();
            if (!editor) {
                log('  Publisher not in DOM yet — clicking Conversation + scrolling.', '#888');
                await ensurePublisherVisible(log);
                editor = await waitFor(findPublisherEditor, 15000, 500);
            }
            if (!editor) {
                log('Publisher still not found. Click "Prep Here" once the "Share an update..." box is on screen.', '#fa0');
                return;
            }
            await doPrep(item);
        }

        maybeAutoPrep('initial');

        let lastHref = location.href;
        setInterval(() => {
            if (location.href === lastHref) return;
            lastHref = location.href;
            log(`URL changed: ${location.pathname}`, '#888');
            refresh();
            maybeAutoPrep('spa-nav');
        }, 800);
    }

    // ========================================================================
    // BOOT
    // ========================================================================
    function boot() {
        if (ON_JL)      renderJoblogicUI();
        else if (ON_SF) renderSalesforceUI();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
