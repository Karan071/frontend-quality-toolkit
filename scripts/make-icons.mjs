// Generates the extension icons (no image dependencies): a rounded square with a viewfinder.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function png(size) {
  const SS = 4; // supersample for smooth edges
  const S = size * SS;
  const px = new Float32Array(size * size * 4);
  const bg = [0x33, 0x50, 0xd4];
  const radius = S * 0.26;
  const inRounded = (x, y) => {
    const cx = Math.min(Math.max(x, radius), S - radius);
    const cy = Math.min(Math.max(y, radius), S - radius);
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
  };
  const stroke = S * 0.075;
  const m = S * 0.25; // corner inset
  const arm = S * 0.17;
  const inCorner = (x, y) => {
    for (const [ax, ay, dx, dy] of [[m, m, 1, 1], [S - m, m, -1, 1], [S - m, S - m, -1, -1], [m, S - m, 1, -1]]) {
      const hx = dx > 0 ? x >= ax - stroke / 2 && x <= ax + arm : x <= ax + stroke / 2 && x >= ax - arm;
      const hy = dy > 0 ? y >= ay - stroke / 2 && y <= ay + stroke / 2 : y <= ay + stroke / 2 && y >= ay - stroke / 2;
      const vx = dx > 0 ? x >= ax - stroke / 2 && x <= ax + stroke / 2 : x <= ax + stroke / 2 && x >= ax - stroke / 2;
      const vy = dy > 0 ? y >= ay - stroke / 2 && y <= ay + arm : y <= ay + stroke / 2 && y >= ay - arm;
      if ((hx && hy) || (vx && vy)) return true;
    }
    return false;
  };
  const inDot = (x, y) => (x - S / 2) ** 2 + (y - S / 2) ** 2 <= (S * 0.085) ** 2;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (!inRounded(x + 0.5, y + 0.5)) continue;
      const white = inCorner(x + 0.5, y + 0.5) || inDot(x + 0.5, y + 0.5);
      const o = ((Math.floor(y / SS) * size) + Math.floor(x / SS)) * 4;
      const c = white ? [255, 255, 255] : bg;
      px[o] += c[0]; px[o + 1] += c[1]; px[o + 2] += c[2]; px[o + 3] += 1;
    }
  }
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      const n = px[o + 3];
      const d = y * (size * 4 + 1) + 1 + x * 4;
      raw[d] = n ? Math.round(px[o] / n) : 0;
      raw[d + 1] = n ? Math.round(px[o + 1] / n) : 0;
      raw[d + 2] = n ? Math.round(px[o + 2] / n) : 0;
      raw[d + 3] = Math.round((n / (SS * SS)) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('extension/icons', { recursive: true });
for (const s of [16, 32, 48, 128]) writeFileSync(`extension/icons/icon-${s}.png`, png(s));
console.log('icons written');
