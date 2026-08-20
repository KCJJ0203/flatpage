import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

// The default output mode is stated twice: as app.js's initial `mode`, and as
// the mode button that starts out carrying `class="selected"`. If they drift,
// the app opens showing one mode highlighted while producing another.
test('the highlighted mode button matches the mode app.js starts in', () => {
  const selected = read('index.html').match(/<button[^>]*class="selected"[^>]*>/);
  assert.ok(selected, 'exactly one mode button should start selected');
  const shown = selected[0].match(/data-mode="([a-z]+)"/);
  assert.ok(shown, `the selected button should carry a data-mode: ${selected[0]}`);

  const initial = read('src/app.js').match(/^let mode = '([a-z]+)';$/m);
  assert.ok(initial, "app.js should declare `let mode = '<mode>';`");
  assert.equal(shown[1], initial[1],
    `index.html highlights ${shown[1]} but app.js starts in ${initial[1]}`);
});

test('exactly one mode button starts selected', () => {
  const all = read('index.html').match(/class="selected"/g) ?? [];
  assert.equal(all.length, 1, `expected 1 selected button, found ${all.length}`);
});

// A stale service worker serves the old shell forever, so the version constant
// has to move whenever the shell does. This catches the copy-paste case.
test('the service worker declares a version', () => {
  assert.match(read('sw.js'), /^const VERSION = 'flatpage-v\d+';$/m);
});

// Every source file has to be listed in the service worker's SHELL. Miss one
// and the app keeps working online, then breaks the first time it is opened
// without a connection — the failure is invisible until it matters most.
test('the service worker caches every source file', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const walk = (dir, prefix = '') => readdirSync(root + dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory()
      ? walk(`${dir}/${e.name}`, `${prefix}${e.name}/`)
      : (/\.(js|css)$/.test(e.name) ? [`${prefix}${e.name}`] : [])));

  const shell = read('sw.js');
  const missing = walk('src').map((f) => `src/${f}`).filter((f) => !shell.includes(`'${f}'`));
  assert.deepEqual(missing, [], `not cached by the service worker: ${missing.join(', ')}`);
});

// app.js wires every control by id at startup. A typo or a removed element
// makes getElementById return null, the addEventListener on it throws, and the
// module dies before anything renders -- so a missing id is not a broken
// button, it is a blank app.
test('every element app.js looks up by id exists in index.html', () => {
  const html = read('index.html');
  const ids = [...read('src/app.js').matchAll(/getElementById\('([^']+)'\)/g)]
    .map((m) => m[1]);
  assert.ok(ids.length > 5, `expected to find id lookups, found ${ids.length}`);
  const missing = [...new Set(ids)].filter((id) => !html.includes(`id="${id}"`));
  assert.deepEqual(missing, [], `app.js looks up ids that index.html does not define: ${missing}`);
});
