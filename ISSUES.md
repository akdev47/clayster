# Clayster: open issues and ideas

Keep this file up to date: tick items when done (and move them to **Done**),
add new ones as they come up. Tags: **[bug]**, **[ux]**, **[backend]**,
**[idea]**, **[tech]**. Items marked *decide* need a decision before work starts.

Last updated: 2026-10-05

## Open issues

### Order flow
- [ ] **[ux] "Finalize order" vs "Save order details".** Nothing is placed or sent yet, but the wording suggests a final order. *Decide* the end of the flow (confirmation step, order number), then rename the buttons.
- [ ] **[ux] Order page is not a real route.** The URL never changes, so the browser back button and reload both return to the design page. The "Logo Here" placeholder is still in the navbar.
- [ ] **[ux] Nothing confirms how long saved details are kept.** "Saved on this device" gives no hint that clearing browser data deletes them.
- [ ] **[tech] No tests for the page code.** `orderPage.js`, the red overflow overlay and the 3D order preview were only checked through logic tests, never in a real browser.

### Editor
- [ ] **[ux] Two sizes for text.** The "Text size" slider (font size in mm) and the element scale (corner handles / scale field) both change how big text is. Dragging a handle does not move the slider.
- [ ] **[ux] Text shrinks silently.** Very long text is made smaller automatically, so the slider can show a larger size than what is used.
- [ ] **[ux] Red (overflowing) elements have no quick fix.** Add a "Fit to stamp" button next to the warning.
- [ ] **[ux] Hidden gesture.** Dragging the stamp in the 3D view resizes it, and nothing explains this.
- [ ] **[ux] 2D view is shown unmirrored, 3D mirrored.** The "Mirror design" help text explains it, but the 2D view itself says nothing.
- [ ] **[ux] "Add SVG" and "Add PNG" share the same icon.**
- [ ] **[ux] PNG photos give poor results.** Help text explains it; a preview of the traced shape or a warning on very detailed images would be better.
- [ ] **[bug?] Delete key on Mac.** Many Mac keyboards have no Delete key (Fn+Backspace). The button still works. *Decide* if another shortcut is needed.
- [ ] **[ux] Undo does not cover stamp settings** (face size, relief, margin, handle, mirror). Only design elements are in the history.
- [ ] **[ux] Design is lost on reload.** *Decided: think about it later* (local save vs. database).

### Accessibility and devices
- [ ] **[ux] Keyboard use.** Elements cannot be moved with the arrow keys, visible focus outlines are removed on design elements, and the alignment buttons are not labelled.
- [ ] **[ux] Toggle buttons** (2D/3D, shapes, relief) do not expose their state to screen readers (`aria-pressed`).
- [ ] **[ux] Touch and small screens** are untested (dragging, resize handles, the right-hand panel).

### Language and wording
- [ ] **[ux] Translate everything to Dutch.** *Planned.* All UI text is currently English and written directly in `index.html` and the JS files; collect strings in one place before translating.
- [ ] **[ux] Jargon.** "Relief", "Emboss/Deboss", "Margin", "Base thickness", "Face", "Sample handle", "Triangles", "Diagnostic messages". The "?" buttons cover some of them; rename the rest.
- [ ] **[ux] Printability Check wording.** Show a plain status such as "Is my stamp ready?" and put the technical messages behind "Show details".

## Postponed on purpose

- [ ] **[ux] Simple vs Advanced mode.** *Will think about it.* Candidates for "Advanced": letter/line spacing, letter thickness, the X/Y/scale/rotation fields, face size mode, margin, base thickness, relief depth, mirror, STL/3MF export, diagnostics, custom font, PNG smoothing, source size.
- [ ] **[backend] Save the design on the device or in the database.**
- [ ] **[backend] Delivery data in `localStorage`** (name, email, address) stays on a shared computer. To be solved with the backend.
- [ ] **[backend] Connect to the Django order system:**
  - replace `PRICING` in `src/pricing.js` with the real price list (all values are placeholders; VAT 21% and free shipping over 50 EUR are assumptions)
  - replace `COUNTRY_OPTIONS` in `src/orderDraft.js` with the countries the backend delivers to
  - send `buildOrderPayload()` and upload the SVG/PNG/font files separately
  - server-side validation, authentication (cookie + CSRF or token), and the "Account" link (currently hidden)
  - export file (STL/3MF) attached at submit time instead of a user download
- [ ] **[idea] "Needed by" date.** *Decide first:* is a deadline real, does it change price or production time, and what is the earliest possible date?

## Nice to have

- [ ] **[idea] Element list** in the sidebar: select, hide, duplicate, delete and reorder elements, with a red dot for ones outside the stamp. (Designed earlier, not built.)
- [ ] **[idea] Snap guides** when dragging (to the centre lines).
- [ ] **[idea] Duplicate element** (copy with its style, offset slightly).
- [ ] **[idea] Order page extras:** delivery estimate, gift option and message, terms checkbox ("I have the rights to this design"), a final read-through step with edit links, saved drafts that reopen later.
- [ ] **[idea] Price breakdown** per extra, once real prices exist.
- [ ] **[idea] Real-size preview.** Built and removed on request; the idea was a bank-card calibration slider. Drop for good or revisit?

## Technical debt


