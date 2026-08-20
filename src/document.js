/**
 * The document being scanned: an ordered list of finished pages.
 *
 * A page holds only compressed bytes — the full-resolution JPEG and a small
 * thumbnail. Nothing here ever holds raw pixels, which is what keeps a
 * ten-page scan inside a phone's memory budget.
 */

function assertPage(page) {
  if (!(page && page.jpeg && page.jpeg.length)) {
    throw new Error('a page needs jpeg bytes');
  }
  if (!(page.jpeg instanceof Uint8Array)) {
    throw new Error('a page jpeg must be Uint8Array');
  }
  if (page.thumbnail && !(page.thumbnail instanceof Uint8Array)) {
    throw new Error('a page thumbnail must be Uint8Array');
  }
  if (!(page.width > 0) || !(page.height > 0)) {
    throw new Error('a page needs positive dimensions');
  }
}

export function createDocument() {
  let pages = [];

  const assertIndex = (i, limit = pages.length) => {
    if (!Number.isInteger(i) || i < 0 || i >= limit) {
      throw new Error(`page index ${i} out of range (0..${limit - 1})`);
    }
  };

  return {
    addPage(page) {
      assertPage(page);
      pages.push(page);
    },
    removePage(index) {
      assertIndex(index);
      pages.splice(index, 1);
    },
    movePage(from, to) {
      assertIndex(from);
      assertIndex(to);
      const [moved] = pages.splice(from, 1);
      pages.splice(to, 0, moved);
    },
    replacePage(index, page) {
      assertIndex(index);
      assertPage(page);
      pages[index] = page;
    },
    pages: () => pages.slice(),
    count: () => pages.length,
    clear() { pages = []; },
    restore(next) {
      next.forEach(assertPage);
      pages = next.slice();
    },
  };
}
