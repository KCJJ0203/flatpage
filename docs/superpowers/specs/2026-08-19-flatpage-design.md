# Flatpage — design

- **Date:** 2026-08-19
- **Status:** approved design, not yet implemented
- **Author:** KC (with Claude)

## Problem

CamScanner has drifted into ads, watermarks and an account wall. The underlying job —
photograph a page, flatten it, get a clean PDF — is simple, decades old, and does not
require any of that.

Flatpage does that job with nothing attached: no account, no cloud, no watermark, no ads.
Every photo is processed on the device and nothing is ever uploaded.

Primary user is KC (scanning tutorials, notes and handouts into OneDrive / Obsidian).
If it is good enough for that, it is good enough to publish.

## Success criteria

1. A one-page scan, from opening the app to a PDF in iOS Files, takes under 20 seconds.
2. Output is legible enough to read a pencil-written tutorial answer.
3. A 10-page document exports without stalling or crashing Safari on KC's iPhone.
4. The app works with no network connection.
5. Nothing the app produces contains a watermark, and nothing it does requires an account.

## Non-goals (v1)

- No document library, folders, tags or search.
- No OCR / searchable PDF.
- No automatic edge detection (see "Deferred").
- No live camera viewfinder with page tracking.
- No sync, sharing, collaboration or backend of any kind.
- No settings screen.

## Product decisions

| Decision | Choice | Why |
|---|---|---|
| Platform | Web app / PWA, added to the iOS home screen | No Mac, no Apple Developer fee, no App Store review. A link is the distribution. |
| Cropping | Manual four-corner drag | Never guesses wrong, ships in days, and auto-detect layers on top later without rework. |
| Storage | Fire-and-forget | The user's filing system is already Files/OneDrive. An in-app library would be a second place to lose things, and iOS can evict site data after ~7 days unused. |
| Camera | Native iOS camera via a file input with `capture="environment"` | Full sensor resolution, real autofocus/flash/HDR, familiar shutter UI. A custom in-browser viewfinder yields a downscaled video frame and a permission prompt. |
| Image processing | Hand-written canvas maths, zero dependencies | Keeps the app a few hundred KB and instant to load. OpenCV.js would cost an ~8MB WASM download to use three functions. |
| PDF | Hand-written writer embedding the camera JPEGs untouched | No decode/re-encode round trip, so the PDF is exactly as sharp as what was approved on screen. |

### Amendment to fire-and-forget

Pages of the document currently being scanned ARE persisted to IndexedDB as they are
produced, and cleared on export. This is not a library — no list of past scans is ever
shown — it is crash insurance, because the camera round-trip can evict the page from
memory (see Risk 1). Without it a ten-page scan can be lost at page nine.

## User flow

1. Open from the home screen. One primary action: **Scan**.
2. Tap it. The native iOS camera opens, the page is shot, and the app receives a
   full-resolution photo.
3. The photo fills the screen with four draggable corner handles, pre-placed just inside the
   frame. A zoom loupe follows the finger during a drag, because a fingertip covers the pixel
   being aimed at.
4. Tap **Flatten**. The page snaps to a straight-on rectangle. Output modes:
   **Original / Greyscale / Scan (B&W) / Colour boost**. Scan is the default.
5. **Add page** (returns to the camera, keeps position in the document) or **Done**.
6. Thumbnail strip: drag to reorder, swipe to delete, tap to re-edit that page's corners.
7. **Export**. A filename of `Scan-YYYY-MM-DD.pdf` is proposed and can be edited, the iOS
   share sheet opens, and the app clears.

The screen that decides whether the app feels good is step 3. Handles must sit above the
fingertip rather than under it, and the loupe is required, not decorative.

## Architecture

A static site. No framework, no build step, no bundler — ES modules loaded directly by the
browser. A service worker caches the app shell so it works offline.

| Module | Responsibility | Depends on |
|---|---|---|
| `capture.js` | Wrap the file input, decode the photo, normalise EXIF rotation | browser APIs |
| `geometry.js` | Solve 4 corners into a 3x3 homography; derive output page size | nothing (pure) |
| `warp.js` | Apply the matrix to pixels, bilinear sampled | `geometry` (pure) |
| `enhance.js` | Greyscale, adaptive threshold, contrast | nothing (pure) |
| `pdfwriter.js` | Wrap JPEG pages into a valid PDF | nothing (pure) |
| `session.js` | Persist and restore in-progress pages to IndexedDB; clear on export | browser APIs |
| `ui/*.js` | Corner editor and loupe, page strip, export | all of the above |
| `sw.js` | Offline app-shell cache | — |

`geometry`, `warp`, `enhance` and `pdfwriter` are pure functions: data in, data out, no DOM
and no globals. They are the testable core and carry all the correctness risk.

## Data flow (one page)

```
photo File
  -> ImageBitmap (rotation normalised)
  -> user drags 4 corners
  -> homography -> warped canvas, long edge capped at ~2500px (about 300 DPI on A4)
  -> enhance mode applied
  -> encoded to JPEG immediately; the uncompressed bitmap is released
  -> Blob pushed onto the page list and written to IndexedDB
```

**Memory strategy.** A 12MP photo is roughly 48MB as raw pixels; several held at once will
kill a Safari tab. Only the page being edited exists uncompressed. Everything else is a
compressed JPEG blob, so a ten-page document costs tens of MB rather than hundreds.

**Export** re-uses those same JPEGs, embedded via `DCTDecode` with no re-encoding. Expected
size for a 10-page B&W document: 2-4MB.

B&W mode is written as high-quality greyscale rather than true 1-bit. It is visually
identical at these resolutions, keeps files small, and avoids a second encoder for no
visible gain.

## Risks

1. **The app may not survive the camera round-trip.** On iOS, opening the camera can push
   Safari out of memory and reload the page on return, destroying an in-progress document.
   *Mitigation:* IndexedDB session persistence (above). Must be verified before real work
   starts — if the page does reload, the restore path is load-bearing, not optional.
2. **Safari may not hand a PDF to the share sheet.** `navigator.share()` with a file should
   work on modern iOS. If it does not, the app has no output. *Mitigation:* fall back to a
   blob download or open-in-new-tab. Verify before real work starts.
3. **Threshold quality is a tuning problem, not a coding problem.** It must hold up on lined
   paper, under a lamp casting a shadow, and on printed slides with grey backgrounds.
   *Mitigation:* tune against a fixture set of real photographed pages, with tests asserting
   measurable outcomes so a later tweak cannot silently wreck faint pencil.
4. **Corner precision on a small screen.** *Mitigation:* loupe, offset handles, generous hit
   targets; validated by manual checklist on the actual device.
5. **iOS may evict site data after about 7 days unused,** clearing the service worker cache
   and any in-progress session. Acceptable: the product never holds finished documents.

### Spike first

Risks 1 and 2 are device-level unknowns that would change the design. They get a throwaway
test page before any module is written.

## Testing

Pure modules are tested in Node (`node --test`), no browser required:

- **geometry** — push a known square through a known matrix; assert the corners land where
  the algebra says.
- **warp** — round trip: distort a clean image with a known perspective, warp it back, and
  assert recovery of the original within tolerance. A round-trip test cannot be satisfied by
  output that merely looks plausible.
- **enhance** — real page fixtures, asserting measurable outcomes (background reaches white,
  glyph strokes stay connected).
- **pdfwriter** — generate, then parse back. PDFs fail on byte-offset cross-reference tables
  in ways that still look fine until a particular viewer rejects the file.

Plus a short manual checklist on the iPhone for what Node cannot see: loupe tracking,
one-handed handle reach, ten-page export without stalling.

## Distribution

GitHub Pages (free, HTTPS, which a service worker requires; deploying is a push). A custom
domain can be pointed at it later without changing anything about the app.

## Legal

Functionality is not ownable, and photographing and flattening a page has extensive prior
art. What must be avoided is identity: the CamScanner name, logo, icon, screen artwork,
code, or a store listing that could be mistaken for theirs. Flatpage shares none of these.

## Deferred (v2+)

- Automatic edge detection. Layers on top of the manual editor as a pre-filled default
  quadrilateral, with manual correction always available. If hand-rolling proves painful,
  load OpenCV.js lazily and only when this feature is enabled, so the fast path stays fast.
- OCR / searchable PDF.
- Live viewfinder with page tracking and auto-snap.
- Monetisation. "Free, no ads, no watermark" and "profitable" are in tension: unlimited
  unwatermarked scanning must stay free, so any revenue has to come from something else
  (OCR, batch tools) or a one-time purchase. Not decided, and not v1's problem.
