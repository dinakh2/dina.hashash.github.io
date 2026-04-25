#!/usr/bin/env node
'use strict';

/**
 * scripts/generate_sample.js
 *
 * Samples assets/images/ref_front.png and ref_side.png at low resolution (~80x120px).
 * Maps pixel darkness to particle density and writes two coordinate arrays to
 * assets/js/portrait_data.js, which the canvas pixel engine loads at runtime.
 *
 * Usage (from repo root):  node scripts/generate_sample.js
 * No npm dependencies — uses Node.js built-ins only (fs, zlib, path).
 *
 * Output format:  each entry is [normX, normY, density]
 *   normX / normY : 0.0–1.0  (position within the sampling grid)
 *   density       : 0.0–1.0  (1 = pure black, 0 = pure white)
 */

const fs   = require('fs');
const zlib = require('zlib');
const path = require('path');

// ─────────────────────────────────────────────
// Paeth predictor (PNG spec §9.4)
// ─────────────────────────────────────────────
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

// ─────────────────────────────────────────────
// Minimal PNG decoder
// Supports 8-bit: Grayscale(0), RGB(2), Indexed(3), Grayscale+A(4), RGBA(6)
// ─────────────────────────────────────────────
function decodePNG(buffer) {
  // Verify signature
  const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) {
    if (buffer[i] !== SIG[i]) throw new Error('Not a valid PNG file');
  }

  let offset = 8;
  let width, height, bitDepth, colorType;
  const idatChunks = [];
  let palette = null;

  // ── Parse chunks ──────────────────────────
  while (offset < buffer.length) {
    const len = buffer.readUInt32BE(offset);
    const type = buffer.slice(offset + 4, offset + 8).toString('ascii');
    const chunkData = buffer.slice(offset + 8, offset + 8 + len);
    offset += 12 + len; // 4 (len) + 4 (type) + len (data) + 4 (CRC)

    if (type === 'IHDR') {
      width = chunkData.readUInt32BE(0);
      height = chunkData.readUInt32BE(4);
      bitDepth  = chunkData[8];
      colorType = chunkData[9];
      if (bitDepth !== 8) throw new Error(`Unsupported bit depth: ${bitDepth}`);
      if (chunkData[12] !== 0) throw new Error('Interlaced PNGs not supported');
    } else if (type === 'PLTE') {
      palette = [];

      for (let i = 0; i < chunkData.length; i += 3) {
        palette.push([chunkData[i], chunkData[i + 1], chunkData[i + 2]]);
      }

    } else if (type === 'IDAT') {
      idatChunks.push(chunkData);
    } else if (type === 'IEND') {
      break;
    }
  }

  // ── Inflate IDAT stream ───────────────────
  const compressed = Buffer.concat(idatChunks);
  const raw = zlib.inflateSync(compressed);

  // Bytes-per-pixel for each color type
  const BPP_MAP = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const bpp = BPP_MAP[colorType];
  if (!bpp) throw new Error(`Unsupported color type: ${colorType}`);

  const stride = width * bpp;
  const pixels = Buffer.alloc(height * stride);

  // ── Reconstruct filtered scanlines ────────
  let rawOff = 0;
  for (let y = 0; y < height; y++) {
    const filterType = raw[rawOff++];
    const srcRow = raw.slice(rawOff, rawOff + stride);
    rawOff += stride;

    const dstRow = pixels.slice(y * stride, (y + 1) * stride);
    const prevRow = y > 0 ? pixels.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride, 0);

    for (let x = 0; x < stride; x++) {
      const byte = srcRow[x];
      const left = x >= bpp ? dstRow[x - bpp]   : 0;
      const up = prevRow[x];
      const upLeft = x >= bpp ? prevRow[x - bpp]  : 0;

      switch (filterType) {
        case 0: dstRow[x] = byte;                                            break;
        case 1: dstRow[x] = (byte + left)                            & 0xFF; break;
        case 2: dstRow[x] = (byte + up)                              & 0xFF; break;
        case 3: dstRow[x] = (byte + Math.floor((left + up) / 2))    & 0xFF; break;
        case 4: dstRow[x] = (byte + paeth(left, up, upLeft))        & 0xFF; break;
        default: throw new Error(`Unknown PNG filter type: ${filterType}`);
      }
    }
  }

  return { width, height, colorType, bpp, pixels, palette };
}

// ─────────────────────────────────────────────
// Read RGBA values for a single pixel
// ─────────────────────────────────────────────
function getPixel(png, px, py) {
  const { width, colorType, bpp, pixels, palette } = png;
  const idx = (py * width + px) * bpp;
  let r, g, b, a = 255;

  switch (colorType) {
    case 0: r = g = b = pixels[idx]; break;
    case 2: r = pixels[idx]; g = pixels[idx + 1]; b = pixels[idx + 2]; break;
    case 3: {
      if (!palette) throw new Error('Missing palette');
      const p = palette[pixels[idx]];
      r = p[0]; g = p[1]; b = p[2]; break;
    }
    case 4: r = g = b = pixels[idx]; a = pixels[idx + 1]; break;
    case 6: r = pixels[idx]; g = pixels[idx + 1]; b = pixels[idx + 2]; a = pixels[idx + 3]; break;
  }

  const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
  return { brightness, alpha: a };
}

// ─────────────────────────────────────────────
// Sample an image at targetW × targetH and return
// [normX, normY, density] triples for non-background pixels.
//
// density: 1.0 = pure black, 0.0 = pure white
// DENSITY_THRESHOLD: skip pixels brighter than this density value
//   0.15 ≈ brightness > 217  (near-white background filtered out)
//   Lower = stricter (only very dark pixels), Higher = more inclusive
// ─────────────────────────────────────────────
function samplePortrait(pngPath, targetW, targetH, densityThreshold = 0.15) {
  console.log(`  Reading: ${pngPath}`);
  const png = decodePNG(fs.readFileSync(pngPath));
  console.log(`  Source:  ${png.width} × ${png.height} px  (color type ${png.colorType})`);

  const coords = [];

  for (let ty = 0; ty < targetH; ty++) {
    for (let tx = 0; tx < targetW; tx++) {
      // Nearest-neighbor downscale with half-pixel offset
      const sx = Math.min(Math.round((tx + 0.5) * png.width  / targetW), png.width  - 1);
      const sy = Math.min(Math.round((ty + 0.5) * png.height / targetH), png.height - 1);

      const { brightness, alpha } = getPixel(png, sx, sy);

      if (alpha < 64) continue;  // transparent, skip

      const density = 1 - brightness / 255;
      if (density <= densityThreshold) continue;  // too bright — background

      coords.push([
        parseFloat((tx / targetW).toFixed(4)),  // normX
        parseFloat((ty / targetH).toFixed(4)),  // normY
        parseFloat(density.toFixed(3))  // density
      ]);
    }
  }

  console.log(`  Output:  ${coords.length} particles  (${targetW}×${targetH} grid, threshold=${densityThreshold})`);
  return coords;
}

// ─────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────
const TARGET_W = 80;
const TARGET_H = 120;
const DENSITY_THRESHOLD = 0.15;  // tune if too few / too many particles

const ROOT = path.join(__dirname, '..');
const frontIn = path.join(ROOT, 'assets', 'images', 'ref_front.png');
const sideIn = path.join(ROOT, 'assets', 'images', 'ref_side.png');
const outFile = path.join(ROOT, 'assets', 'js', 'portrait_data.js');

console.log('=== Portrait particle data generator ===\n');
console.log('Front view:');
const front = samplePortrait(frontIn, TARGET_W, TARGET_H, DENSITY_THRESHOLD);

console.log('\nSide view:');
const side  = samplePortrait(sideIn,  TARGET_W, TARGET_H, DENSITY_THRESHOLD);

// Sanity check
if (front.length < 10) {
  console.warn('\n⚠  Very few front particles - image may be near-white or threshold too strict.');
  console.warn('   Try lowering DENSITY_THRESHOLD (e.g. 0.05) or check the source image.');
}
if (side.length < 10) {
  console.warn('\n⚠  Very few side particles - image may be near-white or threshold too strict.');
}

const js = `// Auto-generated by scripts/generate_sample.js - do not edit by hand.
// Run:  node scripts/generate_sample.js
//
// Sampled at ${TARGET_W}×${TARGET_H}  |  density threshold: ${DENSITY_THRESHOLD}
// Front: ${front.length} particles   Side: ${side.length} particles
//
// Each entry: [normX, normY, density]
//   normX, normY : position in [0, 1] relative to the sampling grid
//   density      : 1 = black, 0 = white  (maps to particle brightness & count)

const PORTRAIT_DATA = {
  front: ${JSON.stringify(front)},
  side:  ${JSON.stringify(side)}
};
`;

fs.writeFileSync(outFile, js, 'utf8');
console.log(`\n✓ Written → ${outFile}`);
console.log(`  Front: ${front.length} particles`);
console.log(`  Side:  ${side.length} particles`);
