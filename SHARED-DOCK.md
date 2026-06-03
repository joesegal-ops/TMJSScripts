# Shared launcher dock — retrofit recipe

All Joblogic userscripts collapse to a small launcher button in ONE shared dock
(a single `#jl-userscript-dock` element). Whichever script loads first creates the
dock; the rest append their button to it. Buttons line up down the **right edge**,
are **draggable to reorder**, and the order is **remembered in localStorage**.

## 1. Paste this block verbatim inside the IIFE (right after `'use strict';`)

It is byte-for-byte identical in every script — do not customise it. Only the
3 constants in step 2 change per script.

```js
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
            d.style.cssText = 'position:fixed;top:80px;right:8px;z-index:100000;display:flex;flex-direction:column;gap:8px;align-items:flex-end;';
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
```

## 2. Per-script constants

Set these once per script (see the assignment table given to you):

```js
    const SCRIPT_ID = '<unique-kebab-id>';
    const SCRIPT_LABEL = '<emoji + short name>';
    const SCRIPT_COLOR = '#08a';
```

## 3. Wire it up

The goal: the script no longer shows its panel (or a floating FAB) on load — it
shows **only** the dock button, and clicking the button toggles the panel.

Find where the script creates its floating UI and adapt to ONE of these cases:

- **Case A — script builds a panel and appends it to `document.body` on load**
  (most scripts). After the panel element is created and appended, add:
  ```js
  jlRegisterPanel(<panelVar>, SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR);
  ```
  where `<panelVar>` is the outermost panel element. Then:
  - Change any existing **close/X button** handler from `panel.remove()` (or hide)
    to: `<panelVar>.style.display = 'none';` (collapse, don't destroy — so the
    dock button can reopen it).
  - If the script already had its **own** floating open/launch button or FAB that
    is separate from the panel, REMOVE that element (the dock button replaces it).

- **Case B — script builds the panel lazily inside a FAB click handler**
  (e.g. a "Create PO" floating button that opens a modal). Replace the FAB with a
  dock button that calls the same open function:
  ```js
  jlDockButton(SCRIPT_ID, SCRIPT_LABEL, SCRIPT_COLOR, openTheModalFn);
  ```
  Remove the old FAB element creation. If the modal is a one-shot (no persistent
  panel), the dock button just re-runs the open function each click.

Do NOT change any business logic, API calls, selectors, or processing — only the
UI entry point and visibility.

## 4. Required finishing steps for every file

1. Bump `// @version` (e.g. 1.6 -> 1.7) and append to `@description`:
   `vX.Y: collapses to a launcher button in the shared dock (drag to reorder).`
2. Syntax-check before finishing:
   ```
   osascript -l JavaScript -e 'ObjC.import("Foundation"); var s=$.NSString.stringWithContentsOfFileEncodingError("<ABS_PATH>",$.NSUTF8StringEncoding,null).js; try{new Function(s);"SYNTAX OK"}catch(e){"ERR: "+e.message}'
   ```
   It MUST print `SYNTAX OK`.
3. Report: the file, the SCRIPT_ID/label used, which case (A/B), and the exact
   edits made.
