// 生成项目基础图标 assets/icon.png（512x512 鱼形图标），纯 Node 实现，无第三方依赖。
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 512;

// ---------- PNG 编码 ----------
const crcTable = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c;
}
function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- 基本向量运算 ----------
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (d) => clamp(0.5 - d, 0, 1); // SDF 距离 -> 覆盖率（抗锯齿）

function sdCircle(px, py, cx, cy, r) {
  const dx = px - cx;
  const dy = py - cy;
  return Math.sqrt(dx * dx + dy * dy) - r;
}
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const dx = Math.abs(px - cx) - (hw - r);
  const dy = Math.abs(py - cy) - (hh - r);
  const ox = Math.max(dx, 0);
  const oy = Math.max(dy, 0);
  return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(dx, dy), 0) - r;
}
function sdEllipse(px, py, cx, cy, rx, ry) {
  const nx = (px - cx) / rx;
  const ny = (py - cy) / ry;
  const f = Math.sqrt(nx * nx + ny * ny);
  return (f - 1) * Math.min(rx, ry);
}
function sdTriangle(px, py, a, b, c) {
  const e0x = b[0] - a[0], e0y = b[1] - a[1];
  const e1x = c[0] - b[0], e1y = c[1] - b[1];
  const e2x = a[0] - c[0], e2y = a[1] - c[1];
  const v0x = px - a[0], v0y = py - a[1];
  const v1x = px - b[0], v1y = py - b[1];
  const v2x = px - c[0], v2y = py - c[1];
  const dot = (ux, uy, vx, vy) => ux * vx + uy * vy;

  const t0 = clamp(dot(v0x, v0y, e0x, e0y) / dot(e0x, e0y, e0x, e0y), 0, 1);
  const pq0x = v0x - e0x * t0, pq0y = v0y - e0y * t0;

  const t1 = clamp(dot(v1x, v1y, e1x, e1y) / dot(e1x, e1y, e1x, e1y), 0, 1);
  const pq1x = v1x - e1x * t1, pq1y = v1y - e1y * t1;

  const t2 = clamp(dot(v2x, v2y, e2x, e2y) / dot(e2x, e2y, e2x, e2y), 0, 1);
  const pq2x = v2x - e2x * t2, pq2y = v2y - e2y * t2;

  const s = Math.sign(e0x * e2y - e0y * e2x);
  const d0x = dot(pq0x, pq0y, pq0x, pq0y), d0y = s * (v0x * e0y - v0y * e0x);
  const d1x = dot(pq1x, pq1y, pq1x, pq1y), d1y = s * (v1x * e1y - v1y * e1x);
  const d2x = dot(pq2x, pq2y, pq2x, pq2y), d2y = s * (v2x * e2y - v2y * e2x);

  let dx = d0x, dy = d0y;
  if (d1x < dx) { dx = d1x; dy = d1y; }
  if (d2x < dx) { dx = d2x; dy = d2y; }

  return -Math.sqrt(dx) * Math.sign(dy);
}
const lerp = (a, b, t) => a + (b - a) * t;

// ---------- 颜色（参考 FishOne：扁平薄荷绿底 + 深青色鱼 + 白色眼睛） ----------
const cTop = [92, 214, 192]; // #5CD6C0 薄荷绿
const cBottom = [92, 214, 192]; // 扁平纯色
const cFish = [10, 30, 28]; // #0A1E1C 深青（近黑）
const cEye = [255, 255, 255]; // 白色

const rgba = Buffer.alloc(SIZE * SIZE * 4);

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let r = 0, g = 0, b = 0, a = 0;

    // 圆角方形渐变背景
    const dBg = sdRoundRect(x, y, SIZE / 2, SIZE / 2, SIZE / 2, SIZE / 2, 96);
    const bgA = smooth(dBg * 1.0);
    if (bgA > 0) {
      const t = clamp(y / SIZE, 0, 1);
      r = lerp(cTop[0], cBottom[0], t);
      g = lerp(cTop[1], cBottom[1], t);
      b = lerp(cTop[2], cBottom[2], t);
      a = bgA;
    }

    // 鱼身（椭圆）+ 实心三角形尾巴，深青色
    const dB = sdEllipse(x, y, 345, 256, 125, 80);
    const dTail = sdTriangle(x, y, [105, 256], [220, 180], [220, 332]);
    const dFish = Math.min(dB, dTail);
    const fishA = smooth(dFish * 1.6);
    if (fishA > 0) {
      r = lerp(r, cFish[0], fishA);
      g = lerp(g, cFish[1], fishA);
      b = lerp(b, cFish[2], fishA);
      a = lerp(a, 1, fishA);
    }

    // 眼睛（白色圆点）
    const dEye = sdCircle(x, y, 430, 228, 24);
    const eyeA = smooth(dEye * 2.0);
    if (eyeA > 0) {
      r = lerp(r, cEye[0], eyeA);
      g = lerp(g, cEye[1], eyeA);
      b = lerp(b, cEye[2], eyeA);
      a = lerp(a, 1, eyeA);
    }

    const i = (y * SIZE + x) * 4;
    rgba[i] = Math.round(r);
    rgba[i + 1] = Math.round(g);
    rgba[i + 2] = Math.round(b);
    rgba[i + 3] = Math.round(a * 255);
  }
}

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'icon.png');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, encodePng(SIZE, SIZE, rgba));
console.log('图标已生成:', out);