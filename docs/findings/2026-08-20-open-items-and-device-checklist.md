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

## ANSWERED 2026-09-09 — the 10-page PDF size question

> *"Whether a 10-page B&W PDF lands under 6MB, and whether it opens on the PC."*

Both settled, without a phone.

Built a 10-page document from the two **real** fixture photos put through the
shipped pipeline (warp, Scan mode, `pixelsToJpeg` at 0.8) and assembled with
`buildPdf` at A4:

| | |
|---|---|
| source pages | 1552x2500 and 1492x2500, 2.99% and 3.43% ink |
| per-page JPEG | 203 KB and 255 KB |
| **10-page PDF** | **2.24 MB — comfortably under 6 MB** |
| assembly time | 2 ms |
| opens on PC | yes — 10 pages, every MediaBox 595x842, one image each, renders correctly |

**The caveat that makes the number meaningful.** My first attempt used a synthetic
page and returned 6.23 MB, i.e. over budget. That fixture was 14.56% ink against
2.99-3.43% on real pages — four to five times too dense — so it was measuring an
imaginary document. Real pages come in at about a third of the budget.

Read it this way: a normal ten-page scan is ~2.2 MB, and it would take a page set
roughly four times denser than real handwriting or printed slides to reach 6 MB.
That is not a realistic document, but it is not impossible either (a page of solid
dark diagrams would approach it), so the ceiling is worth remembering rather than
treating 6 MB as unreachable.

Still needs the actual phone: whether Safari survives holding ten full-resolution
photos, the canvas-area cap, the file-input `cancel` event, and corner-drag latency.
Nothing here substitutes for those.

## ANSWERED 2026-09-09 — the browser layer, exercised rather than reviewed

The section above says the browser layer "is untested by design and was reviewed
instead." That is still true of the unit suite, but the layer has now been driven
end to end in a real browser (desktop Chrome, served over localhost so the service
worker and secure-context paths are live), using KC's two real photographs.

The whole flow: home, "Scan a page", auto-detect, corner editor, Flatten, mode
switch, Keep page, then "Add photos" for a second page, Keep, and Export PDF.

**Zero console errors and zero warnings across the entire run.**

What this establishes that source review could not:

| | |
|---|---|
| default mode | Colour is genuinely the selected button at runtime, not just in markup |
| flatten | 1728x2500 photo to a 2113x2500 page |
| Scan output | clean white ground, crisp text, fully legible — the original "worse than CamScanner" complaint confirmed fixed on a real photo, in a real browser |
| `session.js` | both pages persisted to IndexedDB (jpeg + width + height + thumbnail; 315 KB and 392 KB) |
| `buildPdf` in-browser | `%PDF-1.4`, ends `%%EOF`, 2 page objects, 2 images, both MediaBoxes A4, 692 KB, 0.3 ms |
| **no watermark** | **no `/Producer` and no `/Info` in the emitted bytes — verified at runtime, not only by reading the source** |
| pages after export | correctly retained on the download path, as designed |

### Two things the run surfaced

**1. Detection fails loudly on a loose sheet and quietly on a notebook spread.**
On the printed slide lying on a desk it tracked the page edges well. On the
notebook spread it returned a *confidently wrong* quad — the top-left corner
landed out in the dark background — rather than returning `null` and letting
`detectQuad` fall back to `defaultQuad`. Both are recoverable, because the corner
editor opens on top and the instruction says to drag the corners. But a wrong quad
presented as a found one is a weaker failure mode than an honest default, and
`MIN_FILL` did not catch it. Worth revisiting only if it annoys in use — it is the
documented boundary of the assumption (page lighter than background), not a bug.

**2. `navigator.share` may never fire on iOS, and would degrade silently.**
`app.js:343` calls `prompt('File name', ...)` and only then, at line 356, calls
`exportPdf`, which is where `navigator.share` lives. With the searchable box ticked
an OCR pass sits between them as well, which can take a long time. Safari requires
`share()` to be called under transient user activation, and a modal plus a long
`await` is exactly what spends it.

This is a **hypothesis, not a measurement** — it cannot be confirmed without the
phone. It is worth writing down because the failure is invisible: `exportPdf`
catches a non-`AbortError` share failure and falls through to the download path, so
the app keeps working and the share sheet simply never appears. If that turns out to
be what happens, the fix is to take the filename before the export begins (or drop
the prompt for a default name) so the share call stays inside the gesture.

Desktop Chrome cannot answer the iOS-specific questions — memory ceiling, the
canvas-area cap, the file-input `cancel` event, corner-drag latency. Those still
need the phone.

## FIXED 2026-09-09 — the share gesture, and a bug found underneath it

Two changes, the second more consequential than the first.

### 1. The filename prompt is gone

`doExport` used to call `prompt('File name', ...)` and only then reach
`navigator.share`. The problem is not the modal itself — it is the *unbounded human
delay* inside it. Transient user activation expires a few seconds after the tap, and
someone typing a filename easily outlasts that, so `share()` would reject.

The name now comes from `defaultFilename()` and Export is one tap. Rename the file
afterwards in Files or Drive; that costs a second, and a share sheet that never
opens costs the whole feature.

**Still a hypothesis for the OCR path.** With the searchable box ticked, an OCR pass
of seconds to minutes sits between the tap and the share, and no amount of
reordering keeps activation alive across it. That path will likely always fall back
to a download on iOS. That is inherent, it degrades gracefully, and it needs the
phone to confirm.

### 2. `cache.addAll` was serving stale code — bumping VERSION was not enough

Found while trying to verify the fix above: the change was on disk and on the wire,
but the running page kept executing the old code.

Measured, not inferred:

| | |
|---|---|
| app.js on disk and over HTTP | 16694 bytes, no `prompt` |
| what the page actually ran | **16182 bytes, with the `prompt`** |
| after bumping VERSION v7 → v8 | **still 16182 — the new cache was filled with the old file** |

The install handler used `cache.addAll(SHELL)`, which fetches with ordinary HTTP
cache semantics. A shell file sitting in the browser's own cache is copied into the
new version cache unchanged, so **a released fix can silently never reach an
installed PWA even though the version was bumped.**

The install handler now fetches each shell entry with `cache: 'reload'`, forcing the
network. Any failure rejects, install fails, and the previous shell stays whole —
preserving the atomicity the version scheme exists for. Verified: under `v9` the
cache holds the 16694-byte file, `v8` was evicted, and Export now goes straight to
the export with no dialog.

This one is worth remembering beyond Flatpage. Bumping a service-worker version
proves nothing on its own; check what the *cache* actually holds.

### A note on measuring in an automated browser

`doExport` awaits two `requestAnimationFrame` ticks. An automated browser is not
painting frames, so rAF is throttled and the export appears to hang for tens of
seconds. It completes and the PDF is correct. This is the same effect already noted
above for a backgrounded PWA — not a new defect, but it makes wall-clock timings
taken this way meaningless.

## ANSWERED 2026-09-09 — the OCR path works, and how long it takes

The searchable-PDF feature had never been run end to end in a browser. It has now
been, against page 1 of a real scanned session (2113x2500, the CACM formula sheet),
with the engine served from `vendor/tesseract/`.

| | |
|---|---|
| recognition | 44 lines, **1.6 s** for the page |
| engine load | all five vendor files served and used; no network beyond the origin |
| text quality | body text good — "Basic Derivatives", "ferentiation of Trigonometric Functions". The letterhead logo garbles, as expected of a stylised mark |
| text layer | invisible render mode `3 Tr`, Helvetica declared |
| searchable | all three probe phrases found in the emitted PDF |
| cost of the layer | **2.9 KB** on a 316 KB page |
| watermark | still none, with the text layer present |
| console | 0 errors. 20 warnings, all from inside the tesseract WASM core, complaining about 1-2 px slivers it cannot read — almost certainly the thin dark edge band left by a generous crop. Benign. |

### What the 1.6 s means for the share sheet

This is the number the activation question turns on. Transient user activation lasts
a few seconds after the tap. One page at 1.6 s on a desktop might just stay inside
it; a phone at three to five times slower, or any document of more than a page or
two, certainly will not.

So the expectation for iOS is: **plain export should now reach the share sheet,
searchable export will fall back to a download.** Both are usable, the fallback is
handled, and the difference is invisible unless you know to look for it. Still needs
the phone to confirm.

## MEASURED 2026-09-09 — a crease turns into a black stripe

The `crease` fixture is still missing, and a folded page cannot be conjured up. But
what a fold does to a page *can* be modelled: the valley of the crease sits in
shadow, so a narrow band is darker than the paper around it. Applying that to the
two real fixtures and running Scan mode gives a clear answer.

`tools/crease-probe.mjs` reproduces all of this.

`valley` below is how dark the fold line is against the paper — 1.00 is no fold,
0.70 is a shadow 30% darker than the page.

| valley | ink in the fold strip (slides) | control strip |
|---|---|---|
| no fold | 0.75% | 10.53% |
| 0.95 – 0.85 | 0.83% – 1.31% | 10.53% |
| 0.80 | 1.67% | 10.53% |
| **0.70** | **13.61%** | 10.53% |
| 0.60 | 34.06% | 10.53% |
| 0.55 | 34.42% | 10.53% |

`lined` behaves the same way, 2.83% to 37.42%.

**Read the control column first.** It does not move at all across the whole sweep.
The page did not darken overall; the fold alone went black.

So: a fold shadow around **30% darker than the paper** starts turning into a stripe,
and by 45% darker it is a solid black band running the height of the page. A 30%
shadow is not an extreme crease — it is an ordinary one under a single light.

**Flattening does not rescue it.** `flattenIllumination` was the obvious candidate,
since it is what fixed the dingy-scan complaint for Colour mode. It moves the fold
strip from 34.06% to 31.69% — nothing. The fold is far narrower than the background
radius, so the background estimate smooths straight over it and the valley survives
as a local dark feature. The existing comment in `enhance.js` — that Scan measures
much the same with or without flattening — holds here too.

### Deliberately not fixed

No change has been made to the thresholding. Tuning it against a fold this probe
invented would be the same mistake as tuning the page detector against a single
photograph: the model would end up fitting itself. Any real fix needs a real
photograph of a real crease to tune against and to verify.

What this does change is the priority of that photograph. `crease` was the last
unticked box on a checklist; it is now the one case with **measured evidence that it
breaks**, and the fix cannot be designed without it.

## ANSWERED 2026-09-09 — it genuinely works offline

`shell.test.js` asserts every source file is listed in the service worker's SHELL,
but nothing had ever confirmed the app actually boots and works with no network. For
something whose header says "on your device only", that is worth more than an
inventory check.

Tested by priming both caches and then **killing the server outright** — a truer
offline than any emulation, since there is nothing left to answer.

| with the server dead | |
|---|---|
| app boots | yes — full UI, both pages restored from IndexedDB |
| all five core modules import | yes |
| plain PDF | built, 692 KB |
| **OCR from the cached engine** | **works — 1385 ms, 44 lines** |
| searchable PDF | built, phrases present |
| console | 1 error, and it is the deliberate control below |

**The control that makes this mean something.** A test that passes because something
quietly served the files from elsewhere proves nothing, so the run fetches a URL
that cannot exist and requires it to fail. It did (`net::ERR_FAILED`) — that is the
one console error. The network really was dead.

Worth noting the engine cache is separate and unversioned (`flatpage-ocr-engine`),
which is what lets OCR survive offline across shell releases: a version bump
replaces the shell without throwing away the 7 MB of engine and re-downloading it.
That design is now confirmed working rather than assumed.
