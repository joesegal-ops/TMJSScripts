// ==UserScript==
// @name         Procurement -> Joblogic Supplier PO
// @namespace    http://tampermonkey.net/
// @version      1.18
// @description  Floating button on the Procurement Google Group AND Gmail: per email, prompts for job number and creates a Joblogic Supplier PO with "PO Only Supplier" + delivers to the job. v1.1 adds email metadata parsing + Page 2 Additional Instructions / Items autofill. v1.2 force-rebuilds the FAB on script reload so updates take effect, plus console-logs version + click events. v1.3 fixes Trusted Types CSP error on Google Groups (replaces innerHTML with DOM building). v1.4 adds Lightbulbs Direct-style multi-line item parser ("Qty: N" markers); normalises price to unit cost across all parsers. v1.5 adds in-flight guards (prevents duplicate runs from hashchange/popstate) + step-by-step console logging in the Page 2 / Items flow + waits for modal inputs to mount before filling. v1.6 auto-clicks Save in the items modal after filling. v1.7 polls up to 15s for the Add Item button instead of a fixed 600ms sleep (handles slow Page 2 renders). v1.8 handles Heat-and-Plumb-style "Quantity : N    Price : £X.XX" inline format and "Item in this order" header; tabular fallback no longer mistakes qty/price lines for descriptions. v1.9 adds Claude Haiku 4.5 LLM extraction (auto-fallback when regex finds 0 items, plus a manual Re-extract button) with prompt caching, structured outputs, and a settings dialog for the API key. v1.10 adds a Reset button that re-reads the current conversation so the panel can be reused for another email without closing it. v1.11 verifies each item field after setting (retries up to 3x) and runs a final sweep to re-fill any field that got wiped by a later setter — fixes intermittent empty Description. v1.12 detects VAT-inclusive emails (Subtotal == Total with non-zero Taxes line) and divides regex-extracted item prices to net; LLM prompt also instructed to handle VAT correctly. v1.13 also runs the VAT detector on LLM output (it was returning gross prices despite the prompt) — detector compares items_sum against gross/net to decide adjust-or-skip, so it never double-discounts. v1.14 adds Gmail support — same FAB and Create PO flow when an email is open in mail.google.com (uses h2.hP / .gD[email] / .a3s selectors). Collapses to a launcher button in the shared dock (drag to reorder).
// @match        https://groups.google.com/a/up-fm.com/g/procurement*
// @match        https://mail.google.com/*
// @match        https://go.joblogic.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @connect      api.anthropic.com
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Procurement/joblogic-procurement-create-po.user.js
// @updateURL    https://raw.githubusercontent.com/joesegal-ops/TMJSScripts/main/JL%20Procurement/joblogic-procurement-create-po.user.js
// ==/UserScript==

(function () {
    'use strict';

    // ===== Shared JL userscript launcher dock (identical in every script) =====
    const JL_DOCK_ID = 'jl-userscript-dock', JL_ORDER_KEY = 'jl-userscript-dock-order', JL_MIN_KEY = 'jl-userscript-dock-min';
    const jlDockList = () => document.getElementById('jl-userscript-dock-list');
    function jlReadOrder() { try { return JSON.parse(localStorage.getItem(JL_ORDER_KEY)) || []; } catch (e) { return []; } }
    function jlSaveOrder() { const l = jlDockList(); if (!l) return; localStorage.setItem(JL_ORDER_KEY, JSON.stringify([...l.children].map(b => b.dataset.scriptId).filter(Boolean))); }
    function jlApplyOrder() { const l = jlDockList(); if (!l) return; [...l.children].sort((a, b) => { const o = jlReadOrder(); let ia = o.indexOf(a.dataset.scriptId), ib = o.indexOf(b.dataset.scriptId); if (ia < 0) ia = 1e9; if (ib < 0) ib = 1e9; return ia - ib; }).forEach(b => l.appendChild(b)); }
    function jlAfter(l, y) { let c = { o: -Infinity, el: null }; for (const el of l.querySelectorAll('button:not(.jl-dragging)')) { const r = el.getBoundingClientRect(); const off = y - (r.top + r.height / 2); if (off < 0 && off > c.o) c = { o: off, el }; } return c.el; }
    function jlSetDockMin(min) { const l = jlDockList(), t = document.getElementById('jl-userscript-dock-toggle'); if (l) l.style.display = min ? 'none' : 'flex'; if (t) t.textContent = (min ? '▸' : '▾') + ' Advanced Controls'; try { localStorage.setItem(JL_MIN_KEY, min ? '1' : '0'); } catch (e) {} }
    function jlGetDock() {
        let d = document.getElementById(JL_DOCK_ID);
        if (!d) { d = document.createElement('div'); d.id = JL_DOCK_ID; document.body.appendChild(d); }
        d.style.cssText = 'position:fixed;top:80px;right:8px;z-index:100000;display:flex;flex-direction:column;gap:8px;align-items:flex-end;';
        let t = document.getElementById('jl-userscript-dock-toggle');
        if (!t) {
            t = document.createElement('button');
            t.id = 'jl-userscript-dock-toggle';
            t.style.cssText = 'background:#11111a;color:#fff;border:1px solid #555;padding:6px 12px;border-radius:18px;cursor:pointer;font-family:monospace;font-size:12px;box-shadow:0 2px 8px rgba(0,0,0,.4);white-space:nowrap;';
            t.addEventListener('click', () => jlSetDockMin(jlDockList().style.display !== 'none'));
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
        jlSetDockMin(localStorage.getItem(JL_MIN_KEY) !== '0');
        return d;
    }
    function jlDockButton(id, label, color, onClick) {
        jlGetDock();
        const l = jlDockList();
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
            btn.style.boxShadow = opening ? '0 0 0 2px #fff, 0 2px 8px rgba(0,0,0,.4)' : '0 2px 8px rgba(0,0,0,.4)';
        });
        return btn;
    }
    // ===== end shared dock =====

    const SCRIPT_ID = 'create-po';
    const SCRIPT_LABEL = '📦 Create PO';
    const SCRIPT_COLOR = '#08a';

    // ---- shared config ----
    const VERSION = '1.14';
    const STATE_KEY = 'jl_procure_po_request_v1';
    const SETTINGS_KEY = 'jl_procure_po_settings_v1';
    const SUPPLIER_NAME = 'PO Only Supplier';
    const LLM_MODEL = 'claude-haiku-4-5';
    const HOST = location.hostname;
    const ON_GROUPS = HOST.endsWith('groups.google.com');
    const ON_GMAIL = HOST === 'mail.google.com';
    const ON_EMAIL_HOST = ON_GROUPS || ON_GMAIL;
    const ON_JL = HOST.endsWith('joblogic.com');

    // GM polyfill (in case @grant is missing for some reason)
    const gm = {
        get: (k, d) => (typeof GM_getValue === 'function' ? GM_getValue(k, d) : JSON.parse(localStorage.getItem(k) || 'null') ?? d),
        set: (k, v) => (typeof GM_setValue === 'function' ? GM_setValue(k, v) : localStorage.setItem(k, JSON.stringify(v))),
        del: (k) => (typeof GM_deleteValue === 'function' ? GM_deleteValue(k) : localStorage.removeItem(k))
    };

    function getSettings() {
        return gm.get(SETTINGS_KEY, null) || { apiKey: '', forceLLM: false };
    }
    function saveSettings(s) { gm.set(SETTINGS_KEY, s); }

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // GM_xmlhttpRequest wrapper — bypasses page CORS / CSP for the Anthropic API call.
    function gmRequest(opts) {
        return new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest !== 'function') {
                return reject(new Error('GM_xmlhttpRequest not available — re-install the userscript so Tampermonkey grants it.'));
            }
            GM_xmlhttpRequest({
                method: opts.method || 'GET',
                url: opts.url,
                headers: opts.headers || {},
                data: opts.body,
                timeout: opts.timeout || 60000,
                onload: (resp) => {
                    if (resp.status >= 200 && resp.status < 300) {
                        try { resolve(JSON.parse(resp.responseText)); }
                        catch (e) { resolve(resp.responseText); }
                    } else {
                        reject(new Error('HTTP ' + resp.status + ': ' + (resp.responseText || '').slice(0, 300)));
                    }
                },
                onerror: () => reject(new Error('Network error contacting ' + opts.url)),
                ontimeout: () => reject(new Error('Timeout contacting ' + opts.url))
            });
        });
    }

    // Claude API extraction. Throws on error; returns {supplierName, orderNumber, senderEmail, items[]}.
    async function extractWithClaude(emailSubject, emailBody, apiKey) {
        const body = {
            model: LLM_MODEL,
            max_tokens: 2048,
            system: [{
                type: 'text',
                text: [
                    'You extract structured procurement data from order confirmation emails.',
                    'Identify the supplier brand name (not the generic sender prefix), order/invoice number, sender email address, and line items.',
                    'For each item return description, integer qty, and unit_price (the per-unit cost EXCLUDING VAT/sales tax).',
                    '',
                    'VAT/tax handling — read the totals block carefully:',
                    '- If the email shows Subtotal == Total but lists a non-zero Taxes/VAT amount, the taxes are INCLUDED in the displayed prices. Compute the net unit price as (line_total - tax_share) / qty, or equivalently divide each displayed price by (1 + tax_rate) where tax_rate = tax / (total - tax).',
                    '- If the email shows Subtotal + VAT == Total, the displayed prices are usually already net (ex-VAT). Use them as-is.',
                    '- If the line price is clearly gross (e.g. labelled "inc VAT") and a Subtotal (ex VAT) is shown, divide gross by (1 + tax_rate) to get net.',
                    '- UK VAT is typically 20%.',
                    '',
                    'Use empty string for missing strings and 0 for missing numbers. Do not invent items.'
                ].join('\n'),
                cache_control: { type: 'ephemeral' }
            }],
            output_config: {
                format: {
                    type: 'json_schema',
                    schema: {
                        type: 'object',
                        properties: {
                            supplier_name: { type: 'string' },
                            order_number: { type: 'string' },
                            sender_email: { type: 'string' },
                            items: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        sku: { type: 'string' },
                                        description: { type: 'string' },
                                        qty: { type: 'integer' },
                                        unit_price: { type: 'number' }
                                    },
                                    required: ['sku', 'description', 'qty', 'unit_price'],
                                    additionalProperties: false
                                }
                            }
                        },
                        required: ['supplier_name', 'order_number', 'sender_email', 'items'],
                        additionalProperties: false
                    }
                }
            },
            messages: [{
                role: 'user',
                content: 'Subject: ' + (emailSubject || '') + '\n\nBody:\n' + (emailBody || '').slice(0, 16000)
            }]
        };
        const resp = await gmRequest({
            method: 'POST',
            url: 'https://api.anthropic.com/v1/messages',
            headers: {
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true',
                'content-type': 'application/json'
            },
            body: JSON.stringify(body)
        });
        const textBlock = (resp.content || []).find((b) => b.type === 'text');
        if (!textBlock) throw new Error('No text block in Claude response');
        let parsed;
        try { parsed = JSON.parse(textBlock.text); }
        catch (e) { throw new Error('Claude returned non-JSON: ' + textBlock.text.slice(0, 200)); }
        return {
            supplierName: parsed.supplier_name || '',
            orderNumber: parsed.order_number || '',
            senderEmail: parsed.sender_email || '',
            items: (parsed.items || []).map((it) => {
                const out = { qty: it.qty || 1, description: it.description || '', price: typeof it.unit_price === 'number' ? it.unit_price : 0 };
                if (it.sku) out.sku = it.sku;
                return out;
            }),
            usage: resp.usage || null
        };
    }

    function waitFor(predicate, opts) {
        opts = opts || {};
        const timeout = opts.timeout || 15000;
        const interval = opts.interval || 200;
        return new Promise((resolve, reject) => {
            const start = Date.now();
            (function tick() {
                let val;
                try { val = predicate(); } catch (e) { /* ignore */ }
                if (val) return resolve(val);
                if (Date.now() - start > timeout) return reject(new Error('waitFor timeout'));
                setTimeout(tick, interval);
            })();
        });
    }

    // =================================================================
    // GOOGLE GROUPS SIDE
    // =================================================================

    function initEmailHost() {
        // Always rebuild FAB so reloading the userscript picks up the latest handlers/version.
        const old = document.getElementById('proc-po-fab');
        if (old && old.dataset.version === VERSION) return;
        if (old) old.remove();
        const oldPanel = document.getElementById('proc-po-panel');
        if (oldPanel) oldPanel.remove();

        const fab = document.createElement('div');
        fab.id = 'proc-po-fab';
        fab.dataset.version = VERSION;
        fab.title = 'Create Joblogic POs from these emails  (v' + VERSION + ')';
        fab.textContent = 'PO';
        fab.style.cssText = [
            'position:fixed', 'right:18px', 'bottom:18px', 'z-index:2147483647',
            'width:42px', 'height:42px', 'border-radius:50%',
            'background:#0a8', 'color:#fff', 'font-weight:700', 'font-family:monospace',
            'display:flex', 'align-items:center', 'justify-content:center',
            'cursor:pointer', 'box-shadow:0 4px 14px rgba(0,0,0,0.35)',
            'user-select:none', 'font-size:14px'
        ].join(';');
        fab.addEventListener('click', (e) => {
            console.log('[ProcPO v' + VERSION + '] FAB click received');
            try { togglePanel(); } catch (err) { console.error('[ProcPO] togglePanel error:', err); }
        });
        jlDockButton(SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR, () => {
            try { togglePanel(); } catch (err) { console.error('[ProcPO] togglePanel error:', err); }
        });
        console.log('[ProcPO v' + VERSION + '] FAB installed on ' + (ON_GMAIL ? 'Gmail' : 'Google Groups'));
    }

    function togglePanel() {
        const existing = document.getElementById('proc-po-panel');
        if (existing) { existing.remove(); console.log('[ProcPO] panel closed'); return; }
        try { renderPanel(); console.log('[ProcPO] panel opened'); }
        catch (err) { console.error('[ProcPO] renderPanel error:', err); }
    }

    function renderPanel() {
        const panel = document.createElement('div');
        panel.id = 'proc-po-panel';
        panel.style.cssText = [
            'position:fixed', 'right:18px', 'bottom:70px', 'z-index:2147483647',
            'width:520px', 'max-height:78vh', 'background:#1a1a2e', 'color:#eee',
            'border-radius:8px', 'box-shadow:0 6px 24px rgba(0,0,0,0.5)',
            'font-family:monospace', 'font-size:12px',
            'display:flex', 'flex-direction:column', 'overflow:hidden'
        ].join(';');

        const header = document.createElement('div');
        header.style.cssText = 'padding:10px 12px;background:#11111a;display:flex;align-items:center;justify-content:space-between;gap:6px;';
        const title = document.createElement('strong');
        title.style.fontSize = '13px';
        title.textContent = 'Procurement Emails -> Joblogic PO  v' + VERSION;
        const headerBtns = document.createElement('div');
        headerBtns.style.cssText = 'display:flex;gap:4px;align-items:center;';
        const settingsBtn = document.createElement('button');
        settingsBtn.title = 'Settings';
        settingsBtn.textContent = '⚙';
        settingsBtn.style.cssText = 'background:none;border:none;color:#eee;font-size:16px;cursor:pointer;padding:0 6px;';
        settingsBtn.addEventListener('click', openSettingsDialog);
        const closeBtn = document.createElement('button');
        closeBtn.textContent = 'X';
        closeBtn.style.cssText = 'background:none;border:none;color:#eee;font-size:16px;cursor:pointer;';
        closeBtn.addEventListener('click', () => panel.remove());
        headerBtns.appendChild(settingsBtn);
        headerBtns.appendChild(closeBtn);
        header.appendChild(title);
        header.appendChild(headerBtns);

        const sub = document.createElement('div');
        sub.style.cssText = 'padding:8px 12px;background:#15152a;font-size:11px;color:#9cd;border-bottom:1px solid #222;';

        const list = document.createElement('div');
        list.style.cssText = 'flex:1;overflow-y:auto;padding:4px 0;';

        panel.appendChild(header);
        panel.appendChild(sub);

        if (isConversationView()) {
            // Single email open: show one big Create PO action for this email
            sub.textContent = 'Enter the job number to create a Joblogic Supplier PO for this email.';
            renderSingleEmailAction(list);
            panel.appendChild(list);
            document.body.appendChild(panel);
            return;
        }

        // Gmail: row-listing extraction isn't supported (per-row metadata is sparse on the inbox).
        // Just prompt the user to open an email.
        if (ON_GMAIL) {
            sub.textContent = 'Open the email you want to PO, then click the badge again.';
            const msg = document.createElement('div');
            msg.style.cssText = 'padding:18px 16px;color:#a99;font-size:12px;line-height:1.5;';
            msg.textContent = 'No email is currently open. Click an email in the inbox, then click the green PO badge again.';
            list.appendChild(msg);
            panel.appendChild(list);
            document.body.appendChild(panel);
            return;
        }

        sub.textContent = 'Click "Create PO" on a row, enter the job number (e.g. RE0010016). A new Joblogic tab opens and auto-fills the supplier.';

        const filterBar = document.createElement('div');
        filterBar.style.cssText = 'padding:6px 12px;background:#15152a;display:flex;gap:8px;align-items:center;border-bottom:1px solid #222;';
        const filterLbl = document.createElement('label');
        filterLbl.style.cssText = 'font-size:11px;display:flex;align-items:center;gap:4px;';
        const filterChk = document.createElement('input');
        filterChk.type = 'checkbox';
        filterChk.id = 'proc-po-filter-orders';
        filterChk.checked = true;
        filterLbl.appendChild(filterChk);
        filterLbl.appendChild(document.createTextNode(' Hide marketing emails'));
        filterBar.appendChild(filterLbl);
        const refreshBtn = document.createElement('button');
        refreshBtn.textContent = 'Refresh';
        refreshBtn.style.cssText = 'background:#226;color:#fff;border:none;padding:3px 8px;border-radius:3px;cursor:pointer;font-size:11px;margin-left:auto;';
        refreshBtn.addEventListener('click', () => populateRows(list, filterChk.checked));
        filterBar.appendChild(refreshBtn);
        filterChk.addEventListener('change', () => populateRows(list, filterChk.checked));

        panel.appendChild(filterBar);
        panel.appendChild(list);
        document.body.appendChild(panel);

        populateRows(list, filterChk.checked);
    }

    function isConversationView() {
        if (ON_GROUPS) return /\/c\/[^/?#]+/.test(location.pathname);
        if (ON_GMAIL) {
            // Gmail single-message view: hash like "#inbox/abc..." OR the subject heading exists
            if (/^#[a-z]+\/[a-zA-Z0-9_-]+/i.test(location.hash || '')) return true;
            if (document.querySelector('h2.hP')) return true;
            return false;
        }
        return false;
    }

    // Host-specific extractor — returns {subject, body, senderEmail}.
    function extractEmailFields() {
        if (ON_GMAIL) {
            // Subject — the conversation heading
            const subjEl = document.querySelector('h2.hP');
            let subject = (subjEl ? subjEl.textContent : '').trim();
            if (!subject) {
                subject = (document.title || '').replace(/^Inbox.*?-\s*/, '').replace(/\s*-\s*Gmail.*$/i, '').replace(/\s*-\s*[\w.+-]+@[\w-]+(?:\.[\w-]+)+.*$/, '').trim();
            }

            // Sender — last visible .gD[email] in the open thread (typically the most-recent message header).
            // Falling back to first .gD[email] if none are visible.
            const gDs = Array.from(document.querySelectorAll('.gD[email]'));
            const visibleGDs = gDs.filter((el) => el.offsetParent !== null);
            const senderEmail = ((visibleGDs[visibleGDs.length - 1] || gDs[0])?.getAttribute('email') || '').trim();

            // Body — pick the largest visible rendered email body. Threads contain multiple .a3s nodes;
            // we want the primary message, typically the last one expanded.
            const bodies = Array.from(document.querySelectorAll('.a3s, .ii.gt > div'));
            let body = '';
            for (const el of bodies) {
                if (el.offsetParent === null) continue;
                const txt = el.innerText || '';
                if (txt.length > body.length) body = txt;
            }
            if (!body && bodies.length) body = bodies[bodies.length - 1].innerText || '';

            return { subject: subject || '(no subject)', body, senderEmail };
        }

        // Google Groups
        const t = document.title || '';
        const subject = (t.replace(/\s*-\s*Procurement.*$/i, '').replace(/\s*-\s*Google Groups.*$/i, '').trim()) || '(no subject)';
        const region = document.querySelector('[role="region"].ptW7te') || document.querySelector('[role="region"]');
        const body = (region && region.innerText) ? region.innerText : '';
        const pageTop = document.body.innerText.slice(0, 4000);
        const allEmails = pageTop.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) || [];
        const senderEmail = allEmails.find((e) => !/^procurement@/i.test(e) && !/up-fm\.com$/i.test(e)) || allEmails[0] || '';
        return { subject, body, senderEmail };
    }

    function readCurrentEmail() {
        const fields = extractEmailFields();
        const subject = fields.subject;
        const body = fields.body;
        const senderEmail = fields.senderEmail;

        // Supplier name from sender domain, with common transactional prefixes skipped
        let supplierName = '';
        if (senderEmail) {
            const domain = (senderEmail.split('@')[1] || '').toLowerCase();
            const labels = domain.split('.').filter((s) => !/^(com|co|uk|net|org|io|app|email|mail|us|biz)$/.test(s));
            const generic = /^(noreply|no-reply|order|orders|info|hello|support|sales|confirmation|customerservice|service|mail|email|donotreply|news|do-not-reply)$/i;
            const main = labels.find((s) => !generic.test(s)) || labels[0] || '';
            supplierName = main ? main.charAt(0).toUpperCase() + main.slice(1) : '';
        }

        // Order number — try body first, then subject. Capture the first ID-looking token after order/invoice keywords.
        const orderRe = /(?:order\s*(?:number|no\.?|#)?|invoice|ref(?:erence)?\s*(?:number|no\.?|#)?)\s*:?\s*#?\s*([A-Z]?[\d][A-Z\d-]{3,})/i;
        let orderNumber = '';
        const m1 = body.match(orderRe) || subject.match(orderRe);
        if (m1) orderNumber = m1[1];

        // Line items — best-effort parse. Look for an "Items" section, capture lines until a totals/footer line.
        const rawItems = parseLineItems(body);
        const adjusted = applyVATAdjustment(body, rawItems);

        return {
            id: ((location.pathname + location.hash).match(/\/c\/([^/?#]+)/) || (location.hash.match(/^#[a-z]+\/([a-zA-Z0-9_-]+)/i)) || [])[1] || '',
            href: location.href,
            subject: subject,
            senderEmail: senderEmail,
            sender: senderEmail, // backwards-compat field for the listing-row UI
            supplierName: supplierName,
            orderNumber: orderNumber,
            items: adjusted.items,
            vatAdjustment: adjusted.adjustment,
            bodyText: body.slice(0, 8000), // cap so GM storage stays small
            snippet: '',
            dateStr: ''
        };
    }

    // Look at the email's totals block to decide whether the captured line prices
    // already include VAT. Compares items_sum (qty × price) against the Total/Subtotal
    // amounts so it works regardless of whether the items came from regex or LLM.
    // Returns { adjust: bool, divisor: number, reason: string, taxRate: number, ... }.
    function detectVATAdjustment(body, items) {
        if (!body) return null;
        // Parse Subtotal / Tax / Total — handles both same-line "Label £X" and
        // label-then-amount-on-next-line (Simple Lighting style).
        const lines = body.split('\n').map((l) => l.trim());
        const found = { subtotal: null, tax: null, total: null };
        const labelOf = (s) => {
            const t = s.toLowerCase().replace(/[^a-z]/g, '');
            if (t === 'subtotal' || t === 'subttl') return 'subtotal';
            if (t === 'vat' || t === 'tax' || t === 'taxes') return 'tax';
            if (t === 'total' || t === 'grandtotal' || t === 'ordertotal') return 'total';
            return null;
        };
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const sameLine = line.match(/^([A-Za-z][A-Za-z\s]*?)\s*£\s*([\d,]+\.?\d*)/);
            if (sameLine) {
                const k = labelOf(sameLine[1]);
                if (k && found[k] == null) found[k] = parseFloat(sameLine[2].replace(/,/g, ''));
                continue;
            }
            const k = labelOf(line);
            if (k && found[k] == null) {
                for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
                    if (!lines[j]) continue;
                    const m = lines[j].match(/^£\s*([\d,]+\.?\d*)/);
                    if (m) { found[k] = parseFloat(m[1].replace(/,/g, '')); break; }
                }
            }
        }
        if (found.subtotal == null && found.total == null) return null;

        const close = (a, b) => Math.abs(a - b) < Math.max(0.5, Math.max(a, b) * 0.02);
        const sub = found.subtotal, tax = found.tax, tot = found.total;
        const itemsSum = items && items.length ? items.reduce((s, it) => s + (it.qty || 1) * (it.price || 0), 0) : null;

        // Case A — Subtotal ≈ Total AND Tax > 0: the email's prices include the tax
        // (taxes-included receipt; e.g. Simple Lighting). Net = Total - Tax.
        if (sub != null && tot != null && tax != null && tax > 0 && close(sub, tot)) {
            const net = tot - tax;
            if (net > 0) {
                const divisor = 1 + (tax / net);
                const taxRate = tax / net;
                if (itemsSum != null) {
                    // If items already sum to net (e.g. LLM followed instructions), don't divide again.
                    if (close(itemsSum, net)) {
                        return { adjust: false, divisor: divisor, reason: 'taxes-included; items already net (sum=' + itemsSum.toFixed(2) + ')', taxRate: taxRate, sub: sub, tax: tax, total: tot };
                    }
                    // Items match the gross/total — they're inc-VAT, divide.
                    if (close(itemsSum, tot)) {
                        return { adjust: true, divisor: divisor, reason: 'taxes-included; items match gross Total', taxRate: taxRate, sub: sub, tax: tax, total: tot };
                    }
                    return { adjust: false, divisor: divisor, reason: 'taxes-included; items_sum ' + itemsSum.toFixed(2) + ' matches neither net (' + net.toFixed(2) + ') nor gross (' + tot.toFixed(2) + ') — left as-is', taxRate: taxRate, sub: sub, tax: tax, total: tot };
                }
                return { adjust: true, divisor: divisor, reason: 'taxes-included (no items to compare)', taxRate: taxRate, sub: sub, tax: tax, total: tot };
            }
        }

        // Case B — Subtotal + Tax ≈ Total: VAT is added on top. Divisor = 1 + tax/sub.
        if (sub != null && tot != null && tax != null && tax > 0 && close(sub + tax, tot) && sub > 0) {
            const divisor = 1 + (tax / sub);
            const taxRate = tax / sub;
            if (itemsSum != null) {
                if (close(itemsSum, sub)) {
                    return { adjust: false, divisor: divisor, reason: 'VAT added on top; items already net (sum=' + itemsSum.toFixed(2) + ')', taxRate: taxRate, sub: sub, tax: tax, total: tot };
                }
                if (close(itemsSum, tot)) {
                    return { adjust: true, divisor: divisor, reason: 'VAT added on top; items match gross Total', taxRate: taxRate, sub: sub, tax: tax, total: tot };
                }
            }
        }

        return { adjust: false, reason: 'no clear VAT pattern detected', sub: sub, tax: tax, total: tot };
    }

    // Helper: apply the detector's adjustment to an items array. Returns
    // { items, adjustment } — adjustment field is the detector result for UI display.
    function applyVATAdjustment(body, items) {
        const adj = detectVATAdjustment(body, items);
        if (adj && adj.adjust) {
            items = items.map((it) => Object.assign({}, it, {
                price: typeof it.price === 'number' ? it.price / adj.divisor : it.price,
                _vatAdjusted: true
            }));
        }
        return { items: items, adjustment: adj };
    }

    function parseLineItems(body) {
        if (!body) return [];
        // Locate the items section if a heading is present; otherwise scan the whole body.
        const startRe = /(Item(?:s)?\s+(?:in\s+(?:this\s+)?order|shipped|for\s+delivery|ordered)|Order\s+(?:items|details|summary)|Items?\s*:?\s*Description|Product\s+details|Your\s+items|What\s+you\s+ordered)/i;
        const startMatch = body.match(startRe);
        let section;
        if (startMatch) {
            const startIdx = body.indexOf(startMatch[0]) + startMatch[0].length;
            const tail = body.slice(startIdx);
            const endMatch = tail.match(/(Sub\s*total|Subtotal|Total\s+(?:\(|excluding|including|ex|inc)|Price\s+Breakdown|Delivery\s+\(|Grand\s*total|Order\s*total|Discount\s*:|Shipping\s*:|VAT\s*:|Payment\s+method|Shipping\s+method|Shipping\s+address|Billing\s+address|Forward\s+planning|Disclaimer|Requested\s+delivery)/i);
            section = endMatch ? tail.slice(0, endMatch.index) : tail.slice(0, 4000);
        } else {
            section = body.slice(0, 6000);
        }

        // Try tabular format first (Screwfix-style: "SKU x N\tdesc\t£price" on one line)
        const tabular = parseTabularItems(section);
        if (tabular.length) return tabular;

        // Fallback: scan for "Qty: N" markers (Lightbulbs Direct-style multi-line block)
        return parseQtyMarkerItems(section);
    }

    // Returns items where `price` is the UNIT price (what JL's Cost field expects).
    function parseTabularItems(section) {
        const lines = section.split('\n').map((l) => l.trim()).filter(Boolean);
        const items = [];
        for (const line of lines) {
            // SKU x qty<TAB>description<TAB>£price   (Screwfix-style — £ is line total)
            let m = line.match(/^([A-Z0-9-]+)\s*[xX×]\s*(\d+)\s+(.+?)\s+£\s*([\d,]+\.?\d*)$/);
            if (m) {
                const qty = parseInt(m[2], 10);
                const lineTotal = parseFloat(m[4].replace(/,/g, ''));
                items.push({ sku: m[1], qty: qty, description: m[3].trim(), price: qty > 0 ? lineTotal / qty : lineTotal });
                continue;
            }
            // qty <whitespace> description <whitespace> £price
            m = line.match(/^(\d+)\s+(.{4,}?)\s+£\s*([\d,]+\.?\d*)$/);
            if (m) {
                const qty = parseInt(m[1], 10);
                const lineTotal = parseFloat(m[3].replace(/,/g, ''));
                items.push({ qty: qty, description: m[2].trim(), price: qty > 0 ? lineTotal / qty : lineTotal });
                continue;
            }
            // description ... £price (qty defaults to 1)
            m = line.match(/^(.{6,}?)\s+£\s*([\d,]+\.?\d*)$/);
            if (m && !/total|delivery|vat|shipping|discount|grand|order|payment|method|qty|quantity|price\s*:|requested|subtotal|sub-total/i.test(m[1])) {
                items.push({ qty: 1, description: m[1].trim(), price: parseFloat(m[2].replace(/,/g, '')) });
            }
        }
        return items.slice(0, 30);
    }

    function parseQtyMarkerItems(section) {
        const lines = section.split('\n').map((l) => l.trim()).filter(Boolean);
        const items = [];
        const skipRe = /^(£|Brand\s*:|Qty\s*:|Quantity\s*:|SKU\s*:|Code\s*:|Item\s*Code\s*:|Item\s*No\s*:|Product\s*ID\s*:|Total|Subtotal|Sub-total|Grand|Price\s*:|Delivery|VAT|Discount|Shipping|Payment|Requested)/i;
        // Match either "Qty: N" / "Quantity: N" alone, OR "Quantity : N    Price : £X.XX" (Heat and Plumb-style).
        const qtyLineRe = /^(?:Qty|Quantity)\s*:?\s*(\d+)\s*(?:Price\s*:?\s*£\s*([\d,]+\.?\d*))?\s*$/i;
        for (let i = 0; i < lines.length; i++) {
            const qm = lines[i].match(qtyLineRe);
            if (!qm) continue;
            const qty = parseInt(qm[1], 10);
            if (!qty || qty > 9999) continue;
            // If "Price : £X.XX" was on the same line, treat it as the line total.
            const inlineLineTotal = qm[2] ? parseFloat(qm[2].replace(/,/g, '')) : null;

            const back = Math.max(0, i - 10);
            const fwd = Math.min(lines.length, i + 6);

            let unitPrice = null;
            let lineTotal = inlineLineTotal;

            if (inlineLineTotal === null) {
                // Walk back for unit price
                for (let j = i - 1; j >= back; j--) {
                    const pm = lines[j].match(/^£\s*([\d,]+\.?\d*)$/);
                    if (pm) { unitPrice = parseFloat(pm[1].replace(/,/g, '')); break; }
                }
                // Walk forward for line total
                for (let j = i + 1; j < fwd; j++) {
                    const pm = lines[j].match(/^£\s*([\d,]+\.?\d*)$/);
                    if (pm) { lineTotal = parseFloat(pm[1].replace(/,/g, '')); break; }
                }
            }

            // Description and SKU: walk back through the block
            let description = '';
            let sku = '';
            for (let j = i - 1; j >= back; j--) {
                const ln = lines[j];
                if (!ln || skipRe.test(ln)) continue;
                if (/^[A-Z0-9-]{3,15}$/.test(ln) && /\d/.test(ln) && !sku) { sku = ln; continue; }
                if (ln.length >= 8 && /[a-z]{3}/i.test(ln)) {
                    if (!description || ln.length > description.length) description = ln;
                }
            }
            // Prefer the unit price; fall back to line total / qty
            const unit = unitPrice !== null ? unitPrice : (lineTotal !== null && qty ? lineTotal / qty : 0);
            if (description || unit > 0) {
                const it = { qty: qty, description: description, price: unit };
                if (sku) it.sku = sku;
                items.push(it);
            }
        }
        return items.slice(0, 30);
    }

    function renderSingleEmailAction(list) {
        let r = readCurrentEmail();
        let extractionSource = 'regex';
        const card = document.createElement('div');
        card.style.cssText = 'padding:14px 16px;display:flex;flex-direction:column;gap:10px;';

        const subj = document.createElement('div');
        subj.style.cssText = 'font-weight:600;color:#fff;font-size:13px;';
        subj.textContent = r.subject;

        const meta = document.createElement('div');
        meta.style.cssText = 'font-size:11px;color:#9ab;';
        meta.textContent = r.senderEmail || 'Sender unknown';

        // Parsed metadata preview (DOM-built; Google Groups Trusted Types CSP blocks innerHTML strings)
        const parsed = document.createElement('div');
        parsed.style.cssText = 'background:#0e0e1a;border:1px solid #2a2a3a;border-radius:4px;padding:8px 10px;font-size:11px;color:#cde;line-height:1.6;';

        function renderParsedSummary() {
            while (parsed.firstChild) parsed.removeChild(parsed.firstChild);
            const parsedHeader = document.createElement('div');
            parsedHeader.style.cssText = 'color:#9cd;margin-bottom:3px;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;';
            parsedHeader.textContent = 'Parsed from email (' + extractionSource + ')';
            parsed.appendChild(parsedHeader);
            const addRow = (label, value) => {
                const row = document.createElement('div');
                row.appendChild(document.createTextNode(label + ': '));
                const b = document.createElement('b');
                b.textContent = value || '—';
                row.appendChild(b);
                parsed.appendChild(row);
            };
            addRow('Supplier', r.supplierName);
            addRow('Order #', r.orderNumber);
            addRow('From', r.senderEmail);
            addRow('Items found', String((r.items || []).length || 0));
            if (r.vatAdjustment) {
                const v = r.vatAdjustment;
                const note = document.createElement('div');
                note.style.cssText = 'margin-top:4px;font-size:10px;color:' + (v.adjust ? '#fd6' : '#788') + ';';
                if (v.adjust) {
                    note.textContent = 'VAT: divided prices by ' + v.divisor.toFixed(3) + ' (' + v.reason + ', tax ' + Math.round(v.taxRate * 100) + '%)';
                } else {
                    note.textContent = 'VAT: ' + v.reason;
                }
                parsed.appendChild(note);
            }
        }
        renderParsedSummary();

        const lbl = document.createElement('label');
        lbl.style.cssText = 'font-size:11px;color:#cde;display:flex;flex-direction:column;gap:4px;margin-top:6px;';
        lbl.textContent = 'Job number';
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'e.g. RE0010016';
        input.style.cssText = 'background:#0e0e1a;border:1px solid #334;color:#fff;padding:7px 10px;border-radius:4px;font-family:monospace;font-size:13px;';
        lbl.appendChild(input);

        // "Re-extract with Claude" button — surfaced separately so the user can run LLM extraction
        // without committing to creating the PO yet (see what the LLM returns first).
        const reExtractBtn = document.createElement('button');
        reExtractBtn.textContent = 'Re-extract with Claude (Haiku 4.5)';
        reExtractBtn.style.cssText = 'background:#226;color:#fff;border:1px solid #449;padding:6px 10px;border-radius:4px;cursor:pointer;font-size:11px;';
        reExtractBtn.addEventListener('click', async () => {
            const settings = getSettings();
            if (!settings.apiKey) {
                alert('Set your Anthropic API key in Settings first (gear icon).');
                return;
            }
            reExtractBtn.disabled = true;
            reExtractBtn.textContent = 'Calling Claude...';
            try {
                const llm = await extractWithClaude(r.subject, r.bodyText, settings.apiKey);
                // Apply VAT detector to LLM output too — even with explicit prompt instructions,
                // the model sometimes returns gross prices and we need to reduce them to net.
                const adjusted = applyVATAdjustment(r.bodyText, llm.items || []);
                r = Object.assign({}, r, {
                    supplierName: llm.supplierName || r.supplierName,
                    orderNumber: llm.orderNumber || r.orderNumber,
                    senderEmail: llm.senderEmail || r.senderEmail,
                    items: adjusted.items,
                    vatAdjustment: adjusted.adjustment
                });
                extractionSource = 'Claude ' + LLM_MODEL;
                renderParsedSummary();
                reExtractBtn.textContent = 'Re-extracted with Claude ✓';
                setTimeout(() => { reExtractBtn.disabled = false; reExtractBtn.textContent = 'Re-extract with Claude (Haiku 4.5)'; }, 2000);
            } catch (err) {
                console.error('[ProcPO] Claude extraction error:', err);
                reExtractBtn.textContent = 'Failed: ' + err.message.slice(0, 40);
                setTimeout(() => { reExtractBtn.disabled = false; reExtractBtn.textContent = 'Re-extract with Claude (Haiku 4.5)'; }, 4000);
            }
        });

        const btn = document.createElement('button');
        btn.textContent = 'Create PO in Joblogic';
        btn.style.cssText = 'background:#0a8;color:#fff;border:none;padding:9px 14px;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;';
        btn.addEventListener('click', async () => {
            const job = (input.value || '').trim();
            if (!job) { input.focus(); input.style.borderColor = '#f55'; return; }

            // Auto-fallback: if regex found 0 items (or settings.forceLLM), try Claude before submitting.
            const settings = getSettings();
            const noItems = !r.items || r.items.length === 0;
            if (settings.apiKey && (settings.forceLLM || noItems) && extractionSource === 'regex') {
                btn.disabled = true;
                btn.textContent = 'Asking Claude for items...';
                try {
                    const llm = await extractWithClaude(r.subject, r.bodyText, settings.apiKey);
                    const adjusted = applyVATAdjustment(r.bodyText, llm.items || r.items);
                    r = Object.assign({}, r, {
                        supplierName: llm.supplierName || r.supplierName,
                        orderNumber: llm.orderNumber || r.orderNumber,
                        senderEmail: llm.senderEmail || r.senderEmail,
                        items: adjusted.items,
                        vatAdjustment: adjusted.adjustment
                    });
                    extractionSource = 'Claude ' + LLM_MODEL;
                    renderParsedSummary();
                } catch (err) {
                    console.error('[ProcPO] Claude fallback failed:', err);
                    btn.textContent = 'Claude failed — proceeding with regex';
                    await sleep(1200);
                }
                btn.disabled = false;
            }

            const req = {
                jobNumber: job,
                emailSubject: r.subject || '',
                emailSender: r.senderEmail || '',
                senderEmail: r.senderEmail || '',
                supplierName: r.supplierName || '',
                orderNumber: r.orderNumber || '',
                items: r.items || [],
                emailHref: r.href || '',
                ts: Date.now()
            };
            gm.set(STATE_KEY, req);
            window.open('https://go.joblogic.com/Job', '_blank');
            btn.textContent = 'Opened Joblogic tab ✓';
            btn.style.background = '#557';
            btn.disabled = true;
            // Surface the Reset row so the user can move on to the next email
            // without closing/reopening the panel.
            resetRow.style.display = 'flex';
        });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') btn.click(); });

        // Reset row — hidden until a PO has been opened. Click re-reads the
        // current email (after the user opens a new conversation) and rebuilds
        // the panel content from scratch.
        const resetRow = document.createElement('div');
        resetRow.style.cssText = 'display:none;flex-direction:column;gap:6px;margin-top:6px;';
        const resetBtn = document.createElement('button');
        resetBtn.textContent = 'Reset for another email';
        resetBtn.style.cssText = 'background:#0a8;color:#fff;border:none;padding:9px 14px;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;';
        resetBtn.addEventListener('click', () => {
            while (list.firstChild) list.removeChild(list.firstChild);
            renderSingleEmailAction(list);
        });
        const resetNote = document.createElement('div');
        resetNote.style.cssText = 'font-size:10px;color:#889;line-height:1.4;';
        resetNote.textContent = 'Open another email in this tab first, then click Reset to refresh the parsed data.';
        resetRow.appendChild(resetBtn);
        resetRow.appendChild(resetNote);

        const note = document.createElement('div');
        note.style.cssText = 'font-size:10px;color:#889;line-height:1.5;margin-top:6px;';
        note.textContent = 'If the regex parser misses items, Claude (Haiku 4.5) is called automatically — set API key in Settings.';

        card.appendChild(subj);
        card.appendChild(meta);
        card.appendChild(parsed);
        card.appendChild(reExtractBtn);
        card.appendChild(lbl);
        card.appendChild(btn);
        card.appendChild(resetRow);
        card.appendChild(note);
        list.appendChild(card);
        setTimeout(() => input.focus(), 50);
    }

    // ---- Settings dialog ----
    function openSettingsDialog() {
        const existing = document.getElementById('proc-po-settings');
        if (existing) { existing.remove(); return; }
        const settings = getSettings();

        const overlay = document.createElement('div');
        overlay.id = 'proc-po-settings';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;font-family:monospace;';

        const box = document.createElement('div');
        box.style.cssText = 'background:#1a1a2e;color:#eee;border-radius:8px;padding:18px 20px;width:480px;max-width:90vw;box-shadow:0 8px 28px rgba(0,0,0,0.6);display:flex;flex-direction:column;gap:12px;';

        const head = document.createElement('div');
        head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';
        const title = document.createElement('strong');
        title.textContent = 'Procurement -> Joblogic PO  ·  Settings';
        title.style.fontSize = '13px';
        const closeBtn = document.createElement('button');
        closeBtn.textContent = 'X';
        closeBtn.style.cssText = 'background:none;border:none;color:#eee;font-size:16px;cursor:pointer;';
        closeBtn.addEventListener('click', () => overlay.remove());
        head.appendChild(title);
        head.appendChild(closeBtn);

        const keyLbl = document.createElement('label');
        keyLbl.style.cssText = 'display:flex;flex-direction:column;gap:4px;font-size:11px;color:#cde;';
        keyLbl.textContent = 'Anthropic API key (sk-ant-...)';
        const keyInput = document.createElement('input');
        keyInput.type = 'password';
        keyInput.placeholder = 'sk-ant-api03-...';
        keyInput.value = settings.apiKey || '';
        keyInput.style.cssText = 'background:#0e0e1a;border:1px solid #334;color:#fff;padding:7px 10px;border-radius:4px;font-family:monospace;font-size:12px;';
        keyLbl.appendChild(keyInput);

        const keyNote = document.createElement('div');
        keyNote.style.cssText = 'font-size:10px;color:#889;line-height:1.5;';
        keyNote.textContent = 'Stored locally via Tampermonkey (GM_setValue) — never sent anywhere except api.anthropic.com. Get a key at console.anthropic.com → API Keys.';

        const forceLbl = document.createElement('label');
        forceLbl.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:11px;color:#cde;cursor:pointer;';
        const forceChk = document.createElement('input');
        forceChk.type = 'checkbox';
        forceChk.checked = !!settings.forceLLM;
        forceLbl.appendChild(forceChk);
        forceLbl.appendChild(document.createTextNode(' Always use Claude (skip regex parser)'));

        const modelInfo = document.createElement('div');
        modelInfo.style.cssText = 'font-size:10px;color:#9ab;line-height:1.5;background:#0e0e1a;border:1px solid #2a2a3a;border-radius:4px;padding:7px 9px;';
        modelInfo.textContent = 'Model: ' + LLM_MODEL + ' · roughly £0.001 per email · system prompt is cached so repeat calls are cheaper.';

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:6px;';
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = 'background:#444;color:#fff;border:none;padding:7px 14px;border-radius:4px;cursor:pointer;font-size:12px;';
        cancelBtn.addEventListener('click', () => overlay.remove());
        const saveBtn = document.createElement('button');
        saveBtn.textContent = 'Save';
        saveBtn.style.cssText = 'background:#0a8;color:#fff;border:none;padding:7px 14px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;';
        saveBtn.addEventListener('click', () => {
            saveSettings({ apiKey: (keyInput.value || '').trim(), forceLLM: !!forceChk.checked });
            overlay.remove();
        });
        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(saveBtn);

        box.appendChild(head);
        box.appendChild(keyLbl);
        box.appendChild(keyNote);
        box.appendChild(forceLbl);
        box.appendChild(modelInfo);
        box.appendChild(btnRow);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        setTimeout(() => keyInput.focus(), 50);
    }

    // Marketing patterns to filter out by default
    const MARKETING_RE = /(forget something|basket is waiting|drop[a-z ]*by|opinion matters|catalogue|% off|last chance|upgrade your|meet the|don.t miss|beat the|end[- ]of[- ]term|fresh website|free delivery|view online version|new arrivals|sale ends|spring sale|summer sale|flash sale|buy now)/i;
    const ORDER_RE = /(confirmation of your order|copy of invoice|order confirmed|order #?\d|invoice [a-z0-9]|your order|purchase confirmation|despatched|dispatched|delivery scheduled|consignment|shipment|important information about your order)/i;

    function readEmailRows() {
        // Each conversation in Groups is reachable via an <a href*="/c/...">.
        // Walk up to its row container, dedupe by topic id.
        const rows = [];
        const seen = new Set();
        document.querySelectorAll('a[href*="/c/"]').forEach((a) => {
            const m = a.href.match(/\/c\/([^/?#]+)/);
            if (!m) return;
            const id = m[1];
            if (seen.has(id)) return;
            seen.add(id);
            // Walk up to a row-ish container with the date column
            let row = a;
            for (let i = 0; i < 8 && row; i++) {
                if (row.querySelector && (row.querySelector('[role="cell"]') || row.querySelectorAll('span').length > 4)) break;
                row = row.parentElement;
            }
            const txt = (row ? row.innerText : a.innerText).trim().replace(/\s+/g, ' ');
            // Try to split sender / subject / snippet / date
            // Format observed: "<sender> [N] unread, <subject> <snippet> <date>"
            const dateMatch = txt.match(/\b(\d{1,2}:\d{2}|\d{1,2} [A-Z][a-z]{2}|yesterday)\s*$/);
            const dateStr = dateMatch ? dateMatch[1] : '';
            const senderEnd = txt.search(/(?:\s\d+)?\s*unread,/i);
            let sender = '', subject = '', snippet = '';
            if (senderEnd > -1) {
                sender = txt.slice(0, senderEnd).trim();
                const rest = txt.slice(senderEnd).replace(/^\s*\d*\s*unread,\s*/i, '');
                // First sentence-ish chunk = subject; remainder up to date = snippet
                const restNoDate = dateStr ? rest.replace(new RegExp('\\s*' + dateStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$'), '') : rest;
                const split = restNoDate.split(/\s{2,}|(?<=[.!?])\s/);
                subject = (split[0] || '').trim().slice(0, 140);
                snippet = restNoDate.slice(subject.length).trim().slice(0, 200);
            } else {
                sender = a.innerText.trim().slice(0, 80);
                subject = txt.slice(sender.length).trim().slice(0, 140);
            }
            rows.push({ id, href: a.href, sender, subject, snippet, dateStr, raw: txt.slice(0, 400) });
        });
        return rows.slice(0, 25);
    }

    function classifyRow(r) {
        const blob = (r.subject + ' ' + r.snippet).toLowerCase();
        if (ORDER_RE.test(blob)) return 'order';
        if (MARKETING_RE.test(blob)) return 'marketing';
        return 'other';
    }

    function emptyState(list, msg) {
        while (list.firstChild) list.removeChild(list.firstChild);
        const div = document.createElement('div');
        div.style.cssText = 'padding:16px;color:#a99';
        div.textContent = msg;
        list.appendChild(div);
    }

    function populateRows(list, hideMarketing) {
        while (list.firstChild) list.removeChild(list.firstChild);
        const rows = readEmailRows();
        if (!rows.length) {
            emptyState(list, 'No conversations found on this page.');
            return;
        }
        let shown = 0;
        rows.forEach((r) => {
            const kind = classifyRow(r);
            if (hideMarketing && kind === 'marketing') return;
            shown++;
            const row = document.createElement('div');
            row.style.cssText = 'padding:8px 12px;border-bottom:1px solid #2a2a3a;display:flex;gap:8px;align-items:flex-start;';
            const tag = document.createElement('span');
            tag.style.cssText = 'flex:0 0 auto;width:14px;height:14px;border-radius:50%;margin-top:2px;background:' + (kind === 'order' ? '#0a8' : kind === 'marketing' ? '#a55' : '#557') + ';';
            tag.title = kind;
            const main = document.createElement('div');
            main.style.cssText = 'flex:1;min-width:0;';
            const subj = document.createElement('div');
            subj.style.cssText = 'font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
            subj.textContent = r.subject || '(no subject)';
            const meta = document.createElement('div');
            meta.style.cssText = 'font-size:10px;color:#9ab;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
            meta.textContent = (r.sender || 'unknown') + (r.dateStr ? ' • ' + r.dateStr : '');
            const snip = document.createElement('div');
            snip.style.cssText = 'font-size:10px;color:#aab;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
            snip.textContent = r.snippet || '';
            main.appendChild(subj);
            main.appendChild(meta);
            main.appendChild(snip);
            const action = document.createElement('button');
            action.textContent = 'Create PO';
            action.style.cssText = 'flex:0 0 auto;background:#0a8;color:#fff;border:none;padding:5px 10px;border-radius:3px;cursor:pointer;font-size:11px;align-self:center;';
            action.addEventListener('click', () => createPOForEmail(r));
            row.appendChild(tag);
            row.appendChild(main);
            row.appendChild(action);
            list.appendChild(row);
        });
        if (!shown) {
            emptyState(list, 'All ' + rows.length + ' rows look like marketing. Untick "Hide marketing emails" to see them.');
        }
    }

    function createPOForEmail(r) {
        const job = prompt('Job number for this PO?\n\n' + (r.subject || r.sender) + '\n\nExamples: RE0010016, PROJ0000705', '');
        if (!job) return;
        const jobNumber = job.trim();
        if (!jobNumber) return;
        const req = {
            jobNumber: jobNumber,
            emailSubject: r.subject || '',
            emailSender: r.sender || '',
            emailHref: r.href || '',
            ts: Date.now()
        };
        gm.set(STATE_KEY, req);
        // Land on a logged-in JL page; the JL side resolves jobNumber -> jobId via API and redirects.
        window.open('https://go.joblogic.com/Job', '_blank');
    }

    // =================================================================
    // JOBLOGIC SIDE
    // =================================================================

    const __inFlight = { create: false, page2: false };

    function initJL() {
        const req = gm.get(STATE_KEY, null);
        if (!req) return;
        // Older requests > 1h are stale
        if (Date.now() - (req.ts || 0) > 60 * 60 * 1000) { gm.del(STATE_KEY); return; }

        showBanner(req);

        // Routing by URL
        const path = location.pathname;
        if (/^\/PurchaseOrder\/Create/i.test(path) && /[?&]jobId=/i.test(location.search)) {
            // Page 1 of PO creation: auto-fill
            if (__inFlight.create) return;
            __inFlight.create = true;
            runPOCreate(req).catch((e) => bannerStatus('Auto-fill failed: ' + e.message, '#f88')).finally(() => { __inFlight.create = false; });
        } else if (/^\/PurchaseOrder\/Detail\//i.test(path)) {
            // Page 2 (post-save): fill Additional Instructions + add line items
            if (__inFlight.page2) return;
            __inFlight.page2 = true;
            runPOPage2(req).catch((e) => bannerStatus('Page 2 fill failed: ' + e.message, '#f88')).finally(() => { __inFlight.page2 = false; });
        } else if (/^\/Job\/Detail\/(\d+)/i.test(path)) {
            const id = path.match(/^\/Job\/Detail\/(\d+)/i)[1];
            // Navigate to the PO Create page for this job
            bannerStatus('Opening Add Supplier PO for jobId=' + id + '...', '#fd6');
            setTimeout(() => { location.href = '/PurchaseOrder/Create?jobId=' + id; }, 600);
        } else {
            // Anywhere else with a pending request: resolve the job number via API and jump to PO Create
            resolveAndRedirect(req).catch((e) => bannerStatus('Lookup failed: ' + e.message, '#f88'));
        }
    }

    function getCsrfToken() {
        const el = document.querySelector('input[name="__RequestVerificationToken"]');
        return el ? el.value : '';
    }

    async function resolveAndRedirect(req) {
        bannerStatus('Resolving job ' + req.jobNumber + '...', '#fd6');
        const token = getCsrfToken();
        const resp = await fetch('/api/Job/SearchJsonData', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                '__RequestVerificationToken': token
            },
            body: JSON.stringify({
                SearchTerm: req.jobNumber,
                PageSize: 10, PageIndex: 1,
                EngineerType: 0,
                IncludePPMJobs: true, IncludeReactiveJobs: true,
                StartLoggedDate: '', EndLoggedDate: '',
                StartDate: '', EndDate: '',
                StartCompleteDate: '', EndCompleteDate: '',
                StartNextContactDate: '', EndNextContactDate: ''
            })
        });
        if (!resp.ok) throw new Error('Search HTTP ' + resp.status);
        const data = await resp.json();
        const jobs = (data.AdditionalData && data.AdditionalData.Jobs) || data.Data || [];
        if (!jobs.length) throw new Error('Job number not found: ' + req.jobNumber);
        const target = req.jobNumber.toUpperCase();
        const match = jobs.find((j) => String(j.JobNumber || j.ReferenceNumber || '').toUpperCase() === target) || jobs[0];
        const id = match.Id || match.JobId;
        if (!id) throw new Error('Job match returned no Id');
        bannerStatus('Found jobId=' + id + ' — opening PO form...', '#0fa');
        location.href = '/PurchaseOrder/Create?jobId=' + id;
    }

    let bannerEl = null;

    function showBanner(req) {
        if (bannerEl) return;
        bannerEl = document.createElement('div');
        bannerEl.id = 'proc-po-banner';
        bannerEl.style.cssText = [
            'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:2147483647',
            'background:#0a8', 'color:#fff', 'padding:8px 14px',
            'font-family:monospace', 'font-size:12px',
            'display:flex', 'gap:12px', 'align-items:center',
            'box-shadow:0 2px 8px rgba(0,0,0,0.3)'
        ].join(';');
        const txt = document.createElement('div');
        txt.style.cssText = 'flex:1;';
        const strong = document.createElement('strong');
        strong.textContent = 'Procurement PO v' + VERSION;
        txt.appendChild(strong);
        txt.appendChild(document.createTextNode('   Job: '));
        const jobB = document.createElement('b');
        jobB.textContent = req.jobNumber || '';
        txt.appendChild(jobB);
        txt.appendChild(document.createTextNode('   Email: ' + (req.emailSubject || req.emailSender || '').slice(0, 80)));
        const status = document.createElement('div');
        status.id = 'proc-po-banner-status';
        status.style.cssText = 'opacity:0.9;font-style:italic;max-width:40%;text-align:right;';
        status.textContent = 'Initialising...';
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = 'background:#a33;color:#fff;border:none;padding:4px 10px;border-radius:3px;cursor:pointer;';
        cancelBtn.addEventListener('click', () => {
            gm.del(STATE_KEY);
            bannerEl.remove();
            bannerEl = null;
        });
        bannerEl.appendChild(txt);
        bannerEl.appendChild(status);
        bannerEl.appendChild(cancelBtn);
        document.body.appendChild(bannerEl);
        // Push page down so banner doesn't cover top nav
        document.body.style.paddingTop = '36px';
    }

    function bannerStatus(msg, color) {
        const el = document.getElementById('proc-po-banner-status');
        if (el) {
            el.textContent = msg;
            if (color) el.style.color = color;
        }
        console.log('[ProcPO/JL]', msg);
    }

    function removeBannerSoon() {
        setTimeout(() => {
            if (bannerEl) { bannerEl.remove(); bannerEl = null; }
            document.body.style.paddingTop = '';
        }, 6000);
    }



    async function runPOCreate(req) {
        bannerStatus('Selecting supplier "' + SUPPLIER_NAME + '"...', '#fd6');

        // 1. Drive supplier combobox
        const supplierInput = document.getElementById('SupplierId');
        if (!supplierInput) throw new Error('SupplierId input not found');
        const $ = unsafeWindow.jQuery || window.jQuery;
        if (!$) throw new Error('jQuery not available on this page');
        const supplier = $(supplierInput).data('kendoComboBox');
        if (!supplier) throw new Error('SupplierId is not a kendoComboBox');
        try { supplier.enable(true); } catch (e) { /* */ }

        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('supplier search timeout')), 12000);
            supplier.dataSource.one('change', () => { clearTimeout(timer); resolve(); });
            supplier.search(SUPPLIER_NAME);
        });
        const matches = supplier.dataSource.data();
        let chosen = null;
        for (let i = 0; i < matches.length; i++) {
            const item = matches[i];
            // text/value fields
            const tf = supplier.options.dataTextField;
            const vf = supplier.options.dataValueField;
            const txt = (tf ? item[tf] : (item.Name || item.text || '')) || '';
            if (txt && String(txt).trim().toLowerCase() === SUPPLIER_NAME.toLowerCase()) {
                chosen = item;
                supplier.value(vf ? item[vf] : item.Id || item.value);
                break;
            }
        }
        if (!chosen && matches.length === 1) {
            const tf = supplier.options.dataTextField;
            const vf = supplier.options.dataValueField;
            chosen = matches[0];
            supplier.value(vf ? chosen[vf] : chosen.Id || chosen.value);
        }
        if (!chosen) {
            // Fallback: free-text
            supplier.text(SUPPLIER_NAME);
        }
        $(supplierInput).trigger('change');
        await sleep(400);

        // 2. Open Delivery Address modal and click "Deliver to Job"
        bannerStatus('Setting delivery address to job site...', '#fd6');
        const modalBtn = document.getElementById('selectDeliveryAddressModal');
        if (!modalBtn) throw new Error('Delivery address button not found');
        modalBtn.click();
        const modal = await waitFor(() => {
            const m = document.getElementById('select-delivery-address-modal');
            return (m && (m.classList.contains('in') || m.classList.contains('show') || getComputedStyle(m).display !== 'none')) ? m : null;
        }, { timeout: 8000 });

        // Make sure the "Job" tab is active (it's the default)
        const jobTab = modal.querySelector('a[href="#deliveryToJob"], a[data-target="#deliveryToJob"]') ||
            Array.from(modal.querySelectorAll('a, [role=tab]')).find((t) => /^\s*Job\s*$/i.test(t.textContent.trim()));
        if (jobTab && !jobTab.classList.contains('active')) {
            jobTab.click();
            await sleep(300);
        }

        // Click "Deliver to Job". The modal has one .changeDeliveryAddress link per tab (Job/Storeroom/Engineer/Supplier Branch); only the active tab's is visible.
        const deliverBtn = Array.from(modal.querySelectorAll('a.changeDeliveryAddress, .changeDeliveryAddress'))
            .find((b) => b.offsetParent !== null && /Deliver to Job/i.test((b.textContent || '').trim()));
        if (!deliverBtn) throw new Error('"Deliver to Job" link not found in modal (.changeDeliveryAddress)');
        deliverBtn.click();
        await sleep(700);

        // 3. Click Save
        bannerStatus('Saving Page 1...', '#fd6');
        const saveBtn = Array.from(document.querySelectorAll('button, a.btn'))
            .find((b) => /^\s*Save\s*$/i.test((b.textContent || '').trim()) && !b.closest('.modal') && !b.disabled);
        if (!saveBtn) throw new Error('Save button not found');
        saveBtn.click();
        bannerStatus('Saved. Loading PO Detail page...', '#0fa');
        // The page navigates to /PurchaseOrder/Detail/<guid>; runPOPage2 picks up there.
    }

    function formatInstructions(req) {
        const parts = [];
        if (req.supplierName) parts.push('Supplier: ' + req.supplierName);
        if (req.orderNumber) parts.push('Order #: ' + req.orderNumber);
        if (req.senderEmail) parts.push('From: ' + req.senderEmail);
        if (req.emailSubject) parts.push('Subject: ' + req.emailSubject);
        return parts.join('\n');
    }

    function setNativeValue(el, value) {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    async function runPOPage2(req) {
        const log = (...a) => console.log('[ProcPO v' + VERSION + '] page2:', ...a);
        log('start, items=' + (req.items ? req.items.length : 0));
        bannerStatus('Page 2: filling Additional Instructions...', '#fd6');

        // 1. Additional Instructions textarea
        const ta = await waitFor(() => document.getElementById('POAdditionalInstructionsArea'), { timeout: 10000 }).catch(() => null);
        if (ta) {
            const text = formatInstructions(req);
            log('Additional Instructions found, writing', text.length, 'chars');
            if (text) setNativeValue(ta, (ta.value ? ta.value + '\n' : '') + text);
        } else {
            log('Additional Instructions textarea NOT found');
            bannerStatus('Additional Instructions field not found.', '#f88');
        }

        // Give the page another moment to settle (Kendo grids etc. mount async).
        await sleep(800);

        // 2. Items: switch to Items tab, click Add Item, fill rows
        const items = Array.isArray(req.items) ? req.items : [];
        if (items.length) {
            try {
                await fillItems(items, log);
                bannerStatus('Filled ' + items.length + ' item(s) in modal. Pick Part for each, then Save.', '#0fa');
                log('done');
            } catch (e) {
                log('fillItems failed:', e.message, e.stack);
                bannerStatus('Items fill: ' + e.message + ' — add manually.', '#f88');
            }
        } else {
            log('no items parsed; nothing to add');
            bannerStatus('No items parsed from email — add manually if needed.', '#fd6');
        }

        gm.del(STATE_KEY);
        removeBannerSoon();
    }

    async function fillItems(items, log) {
        log = log || (() => {});
        // Switch to Items tab
        const itemTabLink = document.querySelector('a[href="#itemTab"]');
        if (itemTabLink) {
            log('clicking Items tab link');
            itemTabLink.click();
        } else {
            log('Items tab link not found (may already be active)');
        }

        // Poll for the "Add Item" button — the tab pane mounts async on a fresh PO.
        const addBtn = await waitFor(() => {
            const t = document.getElementById('itemTab');
            if (!t) return null;
            return Array.from(t.querySelectorAll('button, a')).find((b) => /^\s*Add Item\s*$/i.test((b.textContent || '').trim())) || null;
        }, { timeout: 15000 }).catch(() => null);

        if (!addBtn) {
            const itemTab = document.getElementById('itemTab');
            const seen = itemTab ? Array.from(itemTab.querySelectorAll('button, a')).map((b) => (b.textContent || '').trim()).filter(Boolean) : [];
            log('Add Item not found after 15s. #itemTab present:', !!itemTab, 'buttons seen:', seen);
            throw new Error('"Add Item" button not found (waited 15s)');
        }
        log('clicking Add Item button');
        addBtn.click();

        // Wait for the Add Purchase Order Item modal
        const modal = await waitFor(() => {
            const m = document.getElementById('multiple-lines-modal');
            if (!m) return null;
            const visible = getComputedStyle(m).display !== 'none' && m.getBoundingClientRect().height > 100;
            return visible ? m : null;
        }, { timeout: 12000 }).catch(() => null);

        if (!modal) throw new Error('"Add Purchase Order Item" modal did not open');
        log('modal opened, waiting for inputs...');

        // The modal mounts its inputs async (Kendo widgets bind after open) — give it time
        await waitFor(() => modal.querySelector('input[name="Number1"]'), { timeout: 8000 }).catch(() => null);
        await sleep(400);

        for (let i = 0; i < items.length; i++) {
            const idx = i + 1;
            if (i > 0) {
                const addRowBtn = Array.from(modal.querySelectorAll('button, a')).find((b) => /Add a New Item/i.test((b.textContent || '').trim()));
                if (!addRowBtn) { log('Add a New Item button missing at row ' + idx); break; }
                log('clicking Add a New Item for row ' + idx);
                addRowBtn.click();
                await sleep(600);
            }
            const result = await fillItemRow(modal, idx, items[i], log);
            log('row ' + idx + ' fill result:', JSON.stringify(result));
            await sleep(150);
        }

        // Click Save inside the modal. If Part is required and not set, JL will show a
        // validation error — user can pick Part and click Save again.
        await sleep(300);
        const saveBtn = Array.from(modal.querySelectorAll('button, a.btn'))
            .find((b) => /^\s*Save\s*$/i.test((b.textContent || '').trim()) && !b.disabled);
        if (!saveBtn) { log('modal Save button not found'); return; }
        log('clicking modal Save');
        saveBtn.click();
    }

    // setNativeValue + read-back. Sometimes Vue/Kendo overwrites the value
    // immediately (e.g. Description gets cleared when Cost change triggers a
    // recalc), so retry up to `attempts` times until the value sticks.
    async function setAndVerify(el, value, label, log, attempts) {
        attempts = attempts || 3;
        if (!el) return false;
        const expected = String(value);
        for (let n = 1; n <= attempts; n++) {
            setNativeValue(el, expected);
            await sleep(120);
            const actual = (el.value == null ? '' : String(el.value));
            if (actual === expected || actual.trim() === expected.trim()) {
                if (n > 1 && log) log('  ' + label + ': stuck after attempt ' + n);
                return true;
            }
            if (log) log('  ' + label + ' attempt ' + n + ' mismatch — expected "' + expected.slice(0, 40) + '" got "' + actual.slice(0, 40) + '"');
        }
        return false;
    }

    async function fillItemRow(modal, idx, item, log) {
        log = log || (() => {});
        const out = { idx: idx, found: {}, ok: {} };

        const numberInput = modal.querySelector('input[name="Number' + idx + '"]');
        out.found.Number = !!numberInput;
        if (numberInput && item.sku) {
            out.ok.Number = await setAndVerify(numberInput, String(item.sku), 'Number' + idx, log);
        }

        const qtyInput = modal.querySelector('input[name="Quantity' + idx + '"]');
        out.found.Quantity = !!qtyInput;
        if (qtyInput && item.qty) {
            out.ok.Quantity = await setAndVerify(qtyInput, String(item.qty), 'Quantity' + idx, log);
        }

        const costInput = modal.querySelector('input[name="Cost' + idx + '"]');
        out.found.Cost = !!costInput;
        if (costInput && typeof item.price === 'number' && !isNaN(item.price)) {
            out.ok.Cost = await setAndVerify(costInput, item.price.toFixed(2), 'Cost' + idx, log);
        }

        // Description goes LAST and waits a beat first — setting Cost can
        // trigger a recalc that clears Description on some JL builds.
        await sleep(200);
        const descTa = modal.querySelector('#Description' + idx + ', textarea[name="Description' + idx + '"]');
        out.found.Description = !!descTa;
        if (descTa) {
            out.ok.Description = await setAndVerify(descTa, item.description || '', 'Description' + idx, log);
        }

        // Final sweep — any field that is empty or wrong gets one more try.
        // This catches the case where a later field's setter triggered a
        // re-render that wiped an earlier field.
        await sleep(150);
        const finalChecks = [
            { el: numberInput, val: item.sku ? String(item.sku) : null, label: 'Number' + idx },
            { el: qtyInput, val: item.qty ? String(item.qty) : null, label: 'Quantity' + idx },
            { el: costInput, val: (typeof item.price === 'number' && !isNaN(item.price)) ? item.price.toFixed(2) : null, label: 'Cost' + idx },
            { el: descTa, val: item.description || null, label: 'Description' + idx }
        ];
        for (const c of finalChecks) {
            if (!c.el || c.val == null) continue;
            const actual = (c.el.value == null ? '' : String(c.el.value));
            if (actual.trim() !== String(c.val).trim()) {
                log('  ' + c.label + ' was wiped after fill — re-setting');
                await setAndVerify(c.el, c.val, c.label + ' (re-fill)', log, 2);
            }
        }

        return out;
    }

    // =================================================================
    // BOOTSTRAP
    // =================================================================

    function unsafeWindowFallback() {
        try { return unsafeWindow; } catch (e) { return window; }
    }

    if (ON_EMAIL_HOST) {
        // Both Groups and Gmail are SPAs — the FAB needs to survive route changes.
        // MutationObserver re-installs the FAB if Gmail's virtual DOM removes it,
        // and hashchange covers conversation navigation in both products.
        const ensure = () => initEmailHost();
        ensure();
        const mo = new MutationObserver(() => ensure());
        mo.observe(document.body, { childList: true, subtree: false });
        window.addEventListener('hashchange', () => setTimeout(ensure, 200));
    } else if (ON_JL) {
        // Run once + once on hashchange/popstate (Joblogic uses normal navigations mostly)
        const ensure = () => initJL();
        ensure();
        window.addEventListener('popstate', () => setTimeout(ensure, 400));
        window.addEventListener('hashchange', () => setTimeout(ensure, 400));
    }
})();
