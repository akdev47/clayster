# Clayster: open issues and ideas

Keep this file up to date: tick items when done (and move them to **Done**),
add new ones as they come up. Tags: **[bug]**, **[ux]**, **[backend]**,
**[idea]**, **[tech]**. Items marked *decide* need a decision before work starts.

Last updated: 2026-10-12

## Done

- [x] **[ux] PNG photos give poor results.** Help text explains it; a preview of the traced shape or a warning on very detailed images would be better.
- [x] **[ux] Keyboard use.** Elements cannot be moved with the arrow keys, visible focus outlines are removed on design elements, and the alignment buttons are not labelled correctly.
- [x] **[ux] Text alignment moved the whole element.** Alignment now positions the text lines inside the text box instead of moving the text around the stamp.
- [x] **[ux] Two sizes for text.** The "Text size" slider (font size in mm) and the element scale (corner handles / scale field) both change how big text is. Dragging a handle does not move the slider.
- [x] **[ux] Red (overflowing) elements have no quick fix.** Add a "Fit to stamp" button next to the warning.

## Open issues

## 3d render issue
- [ ] the 3d render sometimes shows triangle at bottem of mug.

### Order flow
- [x] **[ux] "Finalize order" vs "Save order details".** The flow now ends as: order page ("Continue to payment") → pay page → the customer's own order page `/order/<guid>/`, which is also emailed.
- [ ] **[ux] Order page is not a real route.** The URL never changes, so the browser back button and reload both return to the design page. The "Logo Here" placeholder is still in the navbar.
- [ ] **[ux] Nothing confirms how long saved details are kept.** The order form is still remembered on this device until the order is placed (then it is cleared), but nothing says so.
- [ ] **[tech] No tests for the page code.** `orderPage.js`, the red overflow overlay and the 3D order preview were only checked through logic tests, never in a real browser.

### Editor
- [ ] **[ux] Text shrinks silently.** Very long text is made smaller automatically, so the slider can show a larger size than what is used.
- [ ] **[ux] Hidden gesture.** Dragging the stamp in the 3D view resizes it, and nothing explains this.
- [ ] **[ux] 2D view is shown unmirrored, 3D mirrored.** The "Mirror design" help text explains it, but the 2D view itself says nothing.
- [ ] **[ux] "Add SVG" and "Add PNG" share the same icon.**
- [ ] **[bug?] Delete key on Mac.** Many Mac keyboards have no Delete key (Fn+Backspace). The button still works. *Decide* if another shortcut is needed.
- [ ] **[ux] Undo does not cover stamp settings** (face size, relief, margin, handle, mirror). Only design elements are in the history.
- [ ] **[ux] Design is lost on reload.** *Decided: think about it later* (local save vs. database).

### Accessibility and devices
- [ ] **[ux] Toggle buttons** (2D/3D, shapes, relief) do not expose their state to screen readers (`aria-pressed`).
- [ ] **[ux] Touch and small screens** are untested (dragging, resize handles, the right-hand panel).

### Language and wording
- [ ] **[ux] Translate everything to Dutch.** *Planned.* All UI text is currently English and written directly in `index.html` and the JS files; collect strings in one place before translating.
- [ ] **[ux] Jargon.** "Relief", "Emboss/Deboss", "Margin", "Base thickness", "Face", "Sample handle", "Triangles", "Diagnostic messages". The "?" buttons cover some of them; rename the rest.
- [ ] **[ux] Printability Check wording.** Show a plain status such as "Is my stamp ready?" and put the technical messages behind "Show details".

## Postponed on purpose

- [ ] **[ux] Simple vs Advanced mode.** *Will think about it.* Candidates for "Advanced": letter/line spacing, letter thickness, the X/Y/scale/rotation fields, face size mode, margin, base thickness, relief depth, mirror, STL/3MF export, diagnostics, custom font, PNG smoothing, source size.
- [ ] **[backend] Save the design on the device or in the database.**
- [x] **[backend] Delivery data in `localStorage`** is cleared once the order has been placed; until then it is only a draft for a failed or abandoned submit.
- [ ] **[backend] Connect to the Django order system** (done: the order is sent, validated and priced by the server, the STL is attached at submit time, the customer gets a private order page). Still open:
  - **Payment is a placeholder.** `src/orders/payments.py` accepts every payment immediately; connect a real provider there and in the pay page (`orders/public/pay.html`). Production jobs are already created only after payment.
  - **Email is a placeholder.** `src/orders/emails.py` prints the confirmation in the server log (console backend in `MAILERS`); configure a real mail backend and check the text in `orders/templates/orders/email/`.
  - Replace the placeholder price list and country list in `src/orders/pricing.py` (single source: the page receives it from the server; `src/orders/test_data/pricing_cases.json` keeps `pricing.js` and the server in agreement). VAT 21% and free shipping over 50 EUR are assumptions. `COUNTRY_OPTIONS` in `orderDraft.js` is still a copy of the server's list.
  - Upload the SVG/PNG/font files separately (only the finished STL and the design settings are stored now).
  - The "Account" link (currently hidden) and linking orders to a customer account.
  - Abuse protection for `POST /api/orders/` (rate limit per IP, e.g. at the reverse proxy) and a retention rule: unpaid orders and their STL files are never removed, and orders hold names and addresses.
  - "Other country" is a shipping zone only; the real country is not asked for.
  - A double click on "Continue to payment" is blocked in the browser, but the server has no idempotency key.
- [ ] **[idea] "Needed by" date.** *Decide first:* is a deadline real, does it change price or production time, and what is the earliest possible date?

## Nice to have

- [ ] **[idea] Element list** in the sidebar: select, hide, duplicate, delete and reorder elements, with a red dot for ones outside the stamp. (Designed earlier, not built.)
- [ ] **[idea] Snap guides** when dragging (to the centre lines).
- [ ] **[idea] Duplicate element** (copy with its style, offset slightly).
- [ ] **[idea] Order page extras:** delivery estimate, gift option and message, terms checkbox ("I have the rights to this design"), a final read-through step with edit links, saved drafts that reopen later.
- [ ] **[idea] Price breakdown** per extra, once real prices exist.
- [ ] **[idea] Real-size preview.** Built and removed on request; the idea was a bank-card calibration slider. Drop for good or revisit?

## Technical debt


