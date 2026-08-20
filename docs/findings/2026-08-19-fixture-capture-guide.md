# Capturing real-page fixtures for the Sauvola regression tests

`test/enhance-real.test.js` asserts on the output of `adaptiveThreshold` when
run against **real photographed pages**, not synthetic ones — that is the
whole point of Task 12. As of this guide, `test/fixtures/pages/` is empty and
the regression suite is skipped for that reason (see the skipped test's
message). This guide is everything needed to produce the five fixtures and
turn that skip into real, passing assertions. No re-deriving required.

## The five pages, and why each one is here

Each of these breaks adaptive thresholding in a different way. A synthetic
fixture can't reproduce the failure mode because it doesn't have the
underlying physical cause — real camera noise, real uneven light, real paper.

1. **`slides`** — a printed lecture slide with a grey-filled title band.
   Grey fills sit between paper-white and ink-black; a threshold tuned only
   on plain paper can call the whole band "ink" or miss text sitting on it.
2. **`lined`** — handwritten answers on lined tutorial paper. The printed
   ruling lines are faint but regular ink themselves — they must not get
   thresholded as heavily as handwriting, and must not vanish along with the
   background.
3. **`pencil`** — faint pencil working. Low-contrast strokes are the case
   most likely to wash out under a threshold tuned for pen ink (`k` too
   high, in the brief's tuning knobs).
4. **`shadow`** — a page with a hand or lamp shadow crossing it. This is the
   canonical case Sauvola thresholding exists for: a single global cutoff
   would call the shadowed half of the page "ink." It tests whether the
   window size tracks the lighting gradient without also hollowing out
   strokes.
5. **`crease`** — a folded or creased page. The crease itself catches a
   shadow line and sometimes a highlight, which can register as spurious
   ink or blow out to white and swallow nearby text.

## Step 1 — capture and flatten

Photograph each page type with the phone inside the Flatpage app, and carry
it through the normal flow to the review screen (crop, warp, and enhance
applied — this is the same "flattened image" the app would export).

## Step 2 — extract the raw grey data (browser console, on the review screen)

With the flattened page showing on the review screen, open the browser
console and run:

```js
const c = document.querySelector('#review-preview canvas');
const d = c.getContext('2d').getImageData(0, 0, c.width, c.height);
const g = new Uint8Array(c.width * c.height);
for (let i = 0, p = 0; i < d.data.length; i += 4, p++)
  g[p] = 0.299*d.data[i] + 0.587*d.data[i+1] + 0.114*d.data[i+2];
console.log(c.width, c.height);
const a = document.createElement('a');
a.href = URL.createObjectURL(new Blob([g]));
a.download = 'page.grey'; a.click();
```

Note the `width, height` the `console.log` prints — you need them for the
next step. This downloads a raw grey-byte file (`page.grey`) for that one
page.

## Step 3 — turn it into a fixture

From the repo root:

```
node tools/make-fixture.mjs <name> <width> <height> <raw-grey-file>
```

Worked example, for a slide photographed at 3024x4032 and saved to
`~/Downloads/page.grey`:

```
node tools/make-fixture.mjs slides 3024 4032 ~/Downloads/page.grey
```

This writes `test/fixtures/pages/slides.json` (downsampled to a 400px long
edge). Repeat steps 1-3 for each page, using these five names exactly —
the test suite has no opinion on filenames beyond `.json`, but the tuning
notes and this guide refer to them by name:

- `slides`
- `lined`
- `pencil`
- `shadow`
- `crease`

## Step 4 — re-run the suite

Once all five `.json` files are in `test/fixtures/pages/`, the skip
condition in `test/enhance-real.test.js` no longer applies and the real
regression assertions activate automatically — nothing in the test file
needs editing. Run:

```
npm test
```

and re-run it, to see the previously-skipped tests execute for real. If any
fail, that is Task 12 Step 4 in the original brief: tune `k` and the window
size in `src/enhance.js` in response, and record what moved in
`docs/findings/2026-08-19-threshold-tuning.md`.
