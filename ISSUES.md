# Clayster: open issues and ideas

Keep this file up to date: tick items when done (and move them to **Done**),
add new ones as they come up. Tags: **[bug]**, **[ux]**, **[backend]**,
**[idea]**, **[tech]**. Items marked *decide* need a decision before work starts.

Last updated: 2026-10-23. Every item was checked against the code on that date;
nothing was checked in a real browser.

## Done

- [x] **[ux] Rounded corners as an option.** A "Rounded corners" switch in the stamp settings softens the corners of a Square or Minimal plate seen from above (a Round plate has none, so the switch is hidden for it). It is off by default (`roundedCorners` in `DEFAULT_STAMP`) and is shown in the review summary. The radius is `stamp.cornerRadiusMm` in `settings.js` (2 mm); the settings check keeps it at or under the edge distance, so the usable area for artwork stays a plain square and the editor limit needs no change. The 2D view and the 3D plate both come from the same outline. Tests: `tests/roundedCorners.test.mjs`.
- [x] **[bug] Round stamp: an element at the edge limit counted as overflowing and blocked export.** The editor lets the lines come up to the edge distance from the ideal circle, but the final check measured against the straight sides of the 96-sided plate, which lie up to 0.03 mm inside it. An element dragged against the rim (288 of 288 directions tried) and the result of "Fit to stamp" both got "Artwork extends beyond the usable stamp area", and export and ordering stopped. The check now allows 0.05 mm (`CLEARANCE_TOLERANCE_MM` in `stampLayout.js`), which also covers the facets of rounded corners. Tests in `tests/roundedCorners.test.mjs`: an element at the editor's limit passes, one 0.2 mm further out does not, for Round, Square and Square with rounded corners.
- [x] **[ux] Rounded plate edges.** The edges of the plate are rounded all the way round with a quarter circle, bigger on the clay side (the side with the letters, 2 mm, so the curve starts 2 mm in from the edge) than on the handle side (the back, 1 mm, which keeps the overhang for the printer to about 54 degrees). The radii are `stamp.edgeRoundingClaySideMm` and `stamp.edgeRoundingHandleSideMm` in `settings.js`; 0 leaves an edge sharp, and the settings check keeps both at or under the edge distance so letters stay on the flat top. A "Rounded edges" switch in the stamp settings lets the customer turn it off; it starts on (`roundedEdges` in `DEFAULT_STAMP`) and is shown in the review summary. The plate is built in `extrudeRoundedPlate` (`solidGeometry.js`) from the same outline as the 2D view and the overflow check, as the convex hull of the outline at a few heights. A round stamp's file goes from 33 KB to 146 KB, a square one from 15 KB to 20 KB. Tests: `tests/edgeRounding.test.mjs`.
- [x] **[bug] Overlapping text and shapes could fail with "Relief mesh is not a closed manifold solid".** The relief was raised with three.js's `ExtrudeGeometry`, which joins a hole to the outline with a straight bridge. When other points of the shape lie exactly on that line (for example along the straight edge of a rectangle that text overlaps), the mesh got overlapping edges and Manifold refused it. It only happened at certain sizes and positions: in the test scene "BOA8" failed at 9 of the 69 sizes tried (16.5 to 20.5 mm, right next to the 16 mm default). The relief is now raised by Manifold itself (`extrudeOutline` in `solidGeometry.js`), which gave a valid solid at all 69 sizes in the same time. Tests: `tests/extrudeOutline.test.mjs` (with the failing shape as a fixture) and four sizes in `tests/validationRegression.test.mjs`. The unused SVG helpers that still used `ExtrudeGeometry` (`extrudeShapes`, `buildSVGGeometry`, `svgFitFactor`) were removed.
- [x] **[tech] Older tests follow the settings.** About 40 tests repeated numbers from `settings.js` (a 6 mm stamp height, the 0.5 mm arrow-key step, the 0.8 mm thin limit, the default text size). They now read them from `SETTINGS`, so changing a value never needs a test edit. Checked by running the whole suite with 22 settings changed at once, in two opposite directions. Tests whose artwork sits at fixed coordinates pin their own face size instead.
- [x] **[tech] Stale Django test and dead code.** `products.tests` now matches `create_dummy_product()`; the old unused `ui.js` entry point and the unused `loadSTLGeometry` are gone.
- [x] **[ux] Maximum stamp size 200 x 200 mm.** A stamp whose plate is wider or longer than `stamp.maxWidthMm` / `stamp.maxLengthMm` (settings.js) shows an error that names the size and the maximum, and cannot be exported or ordered until the design is smaller. The server refuses the same orders (`MAX_STAMP_WIDTH_MM` / `MAX_STAMP_LENGTH_MM` in `orders/pricing.py`).
- [x] **[tech] One settings file for the tweakable numbers.** `js/settings.js` holds the stamp size and thickness, edge distance, handle size, the thin-details and narrow-gap warnings, text and element defaults and limits, PNG limits and the maximum quantity, each with an English and Dutch comment. The form fields get their min/max/step from it (`data-limits`), and a test keeps the values the server also checks (`MAX_QUANTITY`, `MAX_STAMP_WIDTH_MM`, `MAX_STAMP_LENGTH_MM`) in agreement. Not in it on purpose: the internal geometry tolerances.
- [x] **[ux] Small handle on every stamp.** New stamps start with a really small rectangular handle (free, no price line); "No handle" is still in the Handle dropdown. The old 21 mm sample handle and its €3 price are gone. The handle's shape and size are in `settings.js` (`handle`); adjust them once the reference picture's measurements are known.
- [x] **[ux] Text shrinks silently.** Text keeps the size the customer set; too-wide text is reported by the overflow warning instead, and the size field shows the size that is used.
- [x] **[ux] Hidden gesture.** The 3D view now says "Drag the stamp to resize the selected artwork."
- [x] **[ux] Delete key on Mac.** Backspace deletes the selected element as well as Delete, so no extra shortcut is needed.
- [x] **[ux] Duplicate element.** The "Duplicate Element" button copies an element with its style, offset slightly.
- [x] **[ux] "Finalize order" vs "Save order details".** The flow ends as: order page ("Continue to payment") → pay page → the customer's own order page `/order/<guid>/`, which is also emailed.
- [x] **[backend] Delivery data in `localStorage`** is cleared once the order has been placed; until then it is only a draft for a failed or abandoned submit.
- [x] **[ux] PNG photos give poor results.** Help text explains it; a preview of the traced shape or a warning on very detailed images would be better.
- [x] **[ux] Keyboard use.** Elements move with the arrow keys, visible focus outlines are kept on design elements, and the alignment buttons are labelled.
- [x] **[ux] Text alignment moved the whole element.** Alignment now positions the text lines inside the text box instead of moving the text around the stamp.
- [x] **[ux] Two sizes for text.** The text size field and the element scale both change how big text is. Dragging a handle updates the field.
- [x] **[ux] Red (overflowing) elements have no quick fix.** A "Fit to stamp" button sits next to the warning.

## Open issues

### 3D preview
- [ ] **[bug?] A triangle sometimes shows at the bottom of the mug.** Not reproduced from the mesh: the mug floor is an ordinary disc, the mesh is two pieces (mug and handle), and the only odd thing is a few zero-area slivers at the rim (z = 96) whose normals are fine. Probably lighting, shadow or material, so it needs the steps to reproduce (which stamp, which view, which browser) and a look in the browser.

### Distance to the stamp edge
Checked on 2026-10-23 with a 50 mm stamp and a 2 mm distance. The suspicion that the 2 mm is measured from the box around an element is **not right for Round and Square**: the drag limit, the red overflow marking and "Fit to stamp" all measure the real outline points. Dragging an element to the rim leaves exactly 2.000 mm between its lines and the edge (a box-based rule would give 0.96 mm, and even -0.9 mm for a round logo). The one real bug found there (Round plates) is fixed, see Done. What is still box-like:

- [ ] **[ux] Minimal: the 2 mm only holds at the outermost points.** The plate is the rectangle around everything, so the gap is 2 mm only where the artwork touches the rectangle. For a 20 mm circle logo the plate corners are 7 mm from the artwork, for a diamond 12 mm. *Decide:* keep it and say so in the "?" help (cheapest), or add a plate that follows the lines at 2 mm all the way round (the artwork grown by 2 mm and joined into one plate; `offsetOutline` in `solidGeometry.js` already does the growing). The removed "Artwork" shape did not give an even 2 mm either: it moved each corner of a convex hull straight away from the centre.
- [ ] **[ux] The maximum text size follows the box, not the lines.** The size field stops at the usable width (46 mm on a 50 mm stamp, `maximumTextSizeMm` in `main.js`). A single "I" or "H" at 46 mm is only 32.8 mm tall while 46 mm is free; by its lines it would fit up to about size 64. *Solution:* use the same limit as Minimal (`text.sizeMm.max` in `settings.js`) for every shape and let the overflow warning and "Fit to stamp" deal with text that is too big.
- [ ] **[ux] "Fit to stamp" on a Round stamp centres by the box.** It centres the element's bounding box and then shrinks it, so the result can be up to about 2.5 % smaller than the biggest size that fits (a 30 mm "CLAY": scale 0.598 instead of 0.613). Square is exact. *Solution:* centre on the smallest circle around the outline points.

- [ ] **[tech] Test-print the rounded edge and corners.** Print a stamp with "Rounded edges" off and one with it on (2 mm clay side, 1 mm handle side), and a square one with "Rounded corners" on and off, and press them into clay. Look at the clay impression and the curve on the clay side, and at the first layers of the handle side, where the rounding is an overhang (about 54 degrees at 1 mm). Then decide the radii, and whether corners should be on by default.


### Order flow
- [ ] **[ux] Order page is not a real route.** The URL never changes, so the browser back button and reload both return to the design page. (The "Logo Here" placeholder in the navbar is gone.)
- [ ] **[ux] The saved-details notice is outdated.** The order form says "These details are saved on this device and sent with your stamp once ordering is available", but ordering works now, and it does not say that the details are cleared once the order is placed.
- [ ] **[tech] No tests for the page code.** `orderPage.js`, the red overflow overlay and the 3D order preview are only checked through logic tests, never in a real browser (there is no Playwright or similar).

### Editor
- [ ] **[ux] 2D view is shown unmirrored, 3D mirrored.** Only the "?" help for "Mirror design" explains it; the 2D view itself says nothing.
- [ ] **[ux] "Add SVG" and "Add PNG" share the same icon** (▧).
- [ ] **[ux] Undo does not cover stamp settings** (face size, relief, margin, handle, mirror). Only design elements are in the history (`designHistory.js`).
- [ ] **[ux] Design is lost on reload.** Nothing stores the design; only the order form is kept. *Decided: think about it later* (local save vs. database).

### Accessibility and devices
- [ ] **[ux] Toggle buttons do not expose their state to screen readers.** `aria-pressed` is set on the alignment buttons and the font options, but not on 2D/3D, Stamp/On Clay, the face shapes or Raised/Recessed (`selectSegment` in `pipelineControls.js` and the view toggle in `main.js`).
- [ ] **[ux] Touch and small screens** are untested (dragging, resize handles, the right-hand panel). There are a few `@media` rules but no tests.

### Language and wording
- [ ] **[ux] Translate everything to Dutch.** *Planned.* All UI text is currently English and written directly in `index.html` and the JS files; collect strings in one place before translating.
- [ ] **[ux] Jargon.** "Relief", "Margin", "Base thickness", "Face size", "Triangles" and "Diagnostic messages" are still in the UI. ("Raised/Recessed" replaced Emboss/Deboss.) The "?" buttons cover some of them; rename the rest.
- [ ] **[ux] Printability Check wording.** Partly done: the status line is plain ("Ready to export", "Ready with warnings", "Not ready to export") and the messages are simpler, with details behind each row. The panel is still called "Printability Check" with a "Diagnostic messages" section; something like "Is my stamp ready?" would be clearer.

## Postponed on purpose

- [ ] **[ux] Simple vs Advanced mode.** *Will think about it.* Candidates for "Advanced": letter/line spacing, letter thickness, the X/Y/scale/rotation fields, face size, margin, base thickness, relief depth, mirror, STL export, diagnostics, custom font, PNG smoothing, source size.
- [ ] **[backend] Save the design on the device or in the database.**
- [ ] **[backend] Connect to the Django order system** (done: the order is sent, validated and priced by the server, the STL is attached at submit time, the customer gets a private order page). Still open:
  - **Payment is a placeholder.** `src/orders/payments.py` accepts every payment immediately; connect a real provider there and in the pay page (`orders/public/pay.html`). Production jobs are already created only after payment.
  - **Email is a placeholder.** `src/orders/emails.py` prints the confirmation in the server log (console backend in `MAILERS`); configure a real mail backend and check the text in `orders/templates/orders/email/`.
  - Replace the placeholder price list and country list in `src/orders/pricing.py` (single source: the page receives it from the server; `src/orders/test_data/pricing_cases.json` keeps `pricing.js` and the server in agreement). VAT 21% and free shipping over 50 EUR are assumptions. `COUNTRY_OPTIONS` in `orderDraft.js` is still a copy of the server's list.
  - Upload the SVG/PNG/font files separately (only the finished STL and the design settings are stored now).
  - The "Account" link and linking orders to a customer account (the dashboard sidebar shows "Profile — Unavailable").
  - Abuse protection for `POST /api/orders/` (rate limit per IP, e.g. at the reverse proxy; none exists yet) and a retention rule: unpaid orders and their STL files are never removed, and orders hold names and addresses.
  - "Other country" is a shipping zone only; the real country is not asked for.
  - A double click on "Continue to payment" is blocked in the browser, but the server has no idempotency key.
- [ ] **[idea] "Needed by" date.** *Decide first:* is a deadline real, does it change price or production time, and what is the earliest possible date?

## Nice to have

- [ ] **[idea] Element list** in the sidebar: select, hide, duplicate, delete and reorder elements, with a red dot for ones outside the stamp. (Designed earlier, not built.)
- [ ] **[idea] Snap guides** when dragging (to the centre lines).
- [ ] **[idea] Order page extras:** delivery estimate, gift option and message, terms checkbox ("I have the rights to this design"), a final read-through step with edit links, saved drafts that reopen later.
- [ ] **[idea] Price breakdown** per extra, once real prices exist. (The order page already lists the base price and the size.)
- [ ] **[idea] Real-size preview.** Built and removed on request; the idea was a bank-card calibration slider. Drop for good or revisit?

## Technical debt

- [ ] **[tech] 3MF export code is kept but not offered.** `export3MF` / `create3MF` in `exporters.js` are covered by tests, while the page only exports STL (a test asserts there is no 3MF button). *Decide* whether to keep or remove it.
