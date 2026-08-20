/**
 * Write the app icons as PNGs with no dependencies.
 *
 * A flat mark: an accent-coloured page shape on the app's dark background.
 * Run with: node tools/make-icons.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [18, 21, 26];
const INK = [61, 220, 132];

function render(size) {
  const px = new Uint8Array(size * size * 3);
  const set = (x, y, [r, g, b]) => {
    const i = (y * size + x) * 3;
    px[i] = r; px[i + 1] = g; px[i + 2] = b;
  };

  const m = Math.round(size * 0.22);          // margin
  const w = size - m * 2;
  const h = Math.round(w * 1.28);
  const top = Math.round((size - h) / 2);
  const fold = Math.round(w * 0.34);          // folded corner
  const stroke = Math.max(2, Math.round(size * 0.045));

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let colour = BG;
      const inX = x >= m && x < m + w;
      const inY = y >= top && y < top + h;
      if (inX && inY) {
        const cutCorner = (x - (m + w - fold)) + (y - top) > fold && y - top < fold;
        if (!cutCorner) {
          const nearEdge =
            x < m + stroke || x >= m + w - stroke ||
            y < top + stroke || y >= top + h - stroke;
          const nearFold = Math.abs((x - (m + w - fold)) + (y - top) - fold) < stroke;
          colour = (nearEdge || nearFold) ? INK : BG;
        }
      }
      set(x, y, colour);
    }
  }

  // Three "text" rules across the page.
  for (let n = 1; n <= 3; n++) {
    const y0 = top + Math.round(h * (0.42 + n * 0.14));
    for (let y = y0; y < y0 + stroke; y++) {
      for (let x = m + stroke * 2; x < m + w - stroke * 2; x++) set(x, y, INK);
    }
  }
  return px;
}

function png(size, rgb) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;                        // filter: none
    Buffer.from(rgb.subarray(y * size * 3, (y + 1) * size * 3))
      .copy(raw, y * (size * 3 + 1) + 1);
  }

  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const cr = Buffer.alloc(4);
    cr.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, cr]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 2;    // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('icons', { recursive: true });
for (const size of [180, 192, 512]) {
  writeFileSync(`icons/icon-${size}.png`, png(size, render(size)));
  console.log(`icons/icon-${size}.png`);
}
