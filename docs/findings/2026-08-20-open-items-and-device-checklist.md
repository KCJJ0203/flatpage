# Flatpage — open items and device checklist

Written 2026-08-20, when the v1 branch was finished. Everything here is a decision
that was made deliberately, or a thing that cannot be known without a phone.

## What is done

Twelve tasks, 73 tests (72 passing, 1 skipped for want of fixtures — see below).
Every module that carries correctness risk is tested under plain Node with no
browser: the homography solver, the perspective warp, the Sauvola binarisation and
the PDF writer. The browser layer is untested by design and was reviewed instead.

Two properties were verified in code rather than assumed:

- **Nothing leaves the device.** An exhaustive grep for `fetch`, `XMLHttpRequest`,
  `WebSocket`, `EventSource`, `sendBeacon`, `importScripts`, off-origin URLs,
  `<script src>`, `<link>` and `@import` found only `blob:` object URLs and
  same-directory relative assets. The single literal `fetch` in the project is in
  `sw.js` and is guarded two lines above by an origin check. No analytics, no auth,
  no tokens.
- **No watermark.** `pdfwriter.js` writes no `/Info` or `/Producer` string, and the
  content stream is exactly `q · cm · /Im0 Do · Q` with nothing painted over the image.

## Blocked on you — the device run

These were never skipped; they simply cannot be done without the phone.

### 1. Publish the repo (blocks everything else)

The app must be served over HTTPS: `http://192.168.x.x` is not a secure context, so
`navigator.share` and the service worker are both unavailable there. GitHub Pages on
a free plan only serves **public** repos, so this is a decision, not a step:

- public repo + Pages, or
- a different host, or
- a paid plan for private Pages.

### 2. Run the device spike

`spike/device-check.html` was deleted in Task 11, so recreate it from
`docs/superpowers/plans/2026-08-19-flatpage-v1.md` (Task 1, Step 5) if you want the
isolated version — or just exercise the real app and watch for the same three things:

1. **Does the page survive the camera round-trip?** Shoot three photos in a row. If
   the app reloads underneath you, `session.js` stops being insurance and becomes
   load-bearing.
2. **Does the share sheet accept a PDF?** If `navigator.share` with a file fails, the
   download fallback is the primary path — and it now deliberately keeps your pages
   rather than clearing them, because a started download cannot be observed.
3. **Memory.** How many full-resolution photos can be held before the tab dies.

### 3. Watch-list — things only the device can answer

- Near iOS's canvas-area cap, `getImageData` on a full 12MP canvas can return
  **silently blank** pixels rather than failing. That would produce a valid, empty
  PDF with no error anywhere. Check the first scan actually contains the page.
- Does Safari fire the file input's `cancel` event on your iOS version? If not,
  backing out of the camera leaves a promise unsettled (recoverable — the button
  still works — but it accumulates).
- `requestAnimationFrame` is paused while a PWA is backgrounded. Backgrounding
  mid-flatten leaves the busy overlay up until you return. It resumes correctly and
  loses nothing, but confirm it feels acceptable.
- Time the `saveSession` write at page 10. Persisting the whole page list after every
  page is quadratic — about 16.5MB written across a 10-page scan, 63MB across 20. If
  that stalls, the fix is per-page records keyed by a page id; if it does not, leave
  it alone. **Measure before redesigning.**
- Corner-drag latency and loupe tracking. The canvas backing store is capped at a
  1400px long edge (an 8.29x reduction in per-frame composite work on a 12MP photo);
  if dragging still feels heavy, the next step is throttling `pointermove` with
  `requestAnimationFrame`.
- Whether a 10-page B&W PDF lands under 6MB, and whether it opens on the PC.

### 4. Real-page threshold fixtures — the one genuinely unfinished thing

`test/enhance-real.test.js` **skips**, visibly, because `test/fixtures/pages/` is
empty. The Sauvola parameters (`k = 0.2`, window = short edge / 20) have never been
tuned against a single real photograph. Synthetic fixtures prove the algorithm is
correct; they cannot prove it produces a good-looking scan.

Follow `docs/findings/2026-08-19-fixture-capture-guide.md`. Photograph five pages:
a printed slide with a grey title band, lined tutorial paper, faint pencil working,
a page with a shadow across it, and a creased page. Each breaks thresholding
differently. Once five fixtures exist the skipped tests activate automatically.

Until then, **spec success criterion 2 — "legible enough to read a pencil-written
tutorial answer" — is unverified.**

## Deliberately not built

- **Drag-to-reorder and swipe-to-delete.** The spec's flow named them. Reorder fights
  the corner editor for pointer events, and a destructive swipe with no undo is the
  wrong default. `document.js` keeps a working `movePage` for when reorder is wanted.
- **Tap a thumbnail to re-edit that page's corners.** It reopens the camera and
  replaces the page instead. It cannot do otherwise: a stored page keeps only the
  flattened JPEG, no source photo and no quad. Preserving the crop means storing the
  original photo per page, which the fire-and-forget storage model deliberately avoids.
- **Automatic edge detection, OCR, a live viewfinder, and any monetisation.** All v2.

## Known minor issues, all judged not worth fixing now

- `buildPdf` has no runtime guard that a supplied JPEG is 3-component. Safe today
  because canvas `toBlob` always emits 3-component YCbCr; revisit if true 1-bit
  output is ever added.
- `pages()` returns an array-level copy only — mutating a returned page's fields
  mutates the store. Deep-copying JPEG bytes on every call would cost far more than
  the aliasing risks.
- The maskable icon's outline corners get cropped by circular Android launcher masks.
  The fold detail, which is what makes it recognisable, stays inside the safe zone,
  and iOS ignores `purpose: maskable` entirely.
- `renderPreview` is called un-awaited from the mode buttons, so a throw inside
  becomes an unhandled rejection rather than an uncaught handler error.
- The mode cache holds a second full-resolution buffer alongside the flattened page
  for the review screen's lifetime — a deliberate CPU-for-memory trade, released on
  commit or discard.
