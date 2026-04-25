#!/usr/bin/env node
'use strict';

/**
 * scripts/generate_3d.js
 *
 * Combine ref_front.png and ref_side.png to produce 3-D particle coordinates.
 *
 * Front view → normX, normY, density (same as generate_sample.js)
 * Side view → for each Y row, the dark-pixel X positions encode depth (Z).
 *             Side normX is mapped to Z in [-0.5, 0.5].
 *
 * For every front particle, find the matching Y row in the side depth map and 
 * draw a Z value from that row's dark-pixel distribution.
 *
 * Usage (from repo root):  node scripts/generate_3d.js
 * Requires: npm install canvas
 *
 * Output: assets/js/portrait_data_3d.js
 *   const PORTRAIT_DATA_3D = [ [normX, normY, normZ, density], ... ]
 */

const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');

const TARGET_W = 80;
const TARGET_H = 120;
const DENSITY_THRESHOLD = 0.15;   // skip pixels brighter than this
const Z_MIN = -0.5;
const Z_MAX = 0.5;

const ROOT = path.join(__dirname, '..');
const frontIn = path.join(ROOT, 'assets', 'images', 'ref_front.png');
const sideIn = path.join(ROOT, 'assets', 'images', 'ref_side.png');
const outFile = path.join(ROOT, 'assets', 'js', 'portrait_data_3d.js');

// ─────────────────────────────────────────────────────────────────────────────
// Sample an image down to TARGET_W × TARGET_H.
// Return a Float32Array of shape [TARGET_H][TARGET_W] for density values,
// plus the raw 2-D array of [normX, normY, density] triples for dark pixels.
// ─────────────────────────────────────────────────────────────────────────────
async function sampleImage(imgPath) {
  console.log(`  Reading: ${imgPath}`);
  const img = await loadImage(imgPath);
  console.log(`  Source:  ${img.width} × ${img.height} px`);

  const canvas  = createCanvas(TARGET_W, TARGET_H);
  const ctx = canvas.getContext('2d');

  // Draw source image scaled to sampling grid
  ctx.drawImage(img, 0, 0, TARGET_W, TARGET_H);
  const { data } = ctx.getImageData(0, 0, TARGET_W, TARGET_H); // RGBA, row-major

  // densityGrid[ty][tx] = density value (0 = white, 1 = black)
  const densityGrid = Array.from({ length: TARGET_H }, () => new Float32Array(TARGET_W));
  const particles = []; // [normX, normY, density]

  for (let ty = 0; ty < TARGET_H; ty++) {
    for (let tx = 0; tx < TARGET_W; tx++) {
      const idx   = (ty * TARGET_W + tx) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3];

      if (a < 64) continue;  // transparent

      const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
      const density = 1 - brightness / 255;

      densityGrid[ty][tx] = density;

      if (density > DENSITY_THRESHOLD) {
        particles.push([
          parseFloat((tx / TARGET_W).toFixed(4)),
          parseFloat((ty / TARGET_H).toFixed(4)),
          parseFloat(density.toFixed(3))
        ]);
      }
    }
  }

  console.log(`  Output:  ${particles.length} particles  (${TARGET_W}×${TARGET_H} grid, threshold=${DENSITY_THRESHOLD})`);
  return { densityGrid, particles };
}

// ─────────────────────────────────────────────────────────────────────────────
// Build a depth map from the side image:
//   depthMap[ty] = array of { normZ, weight } for dark pixels in that row.
// Side image: X axis = depth (front→back), Y axis = height (matches front Y).
// normX 0→1 maps to Z in [Z_MIN, Z_MAX].
// ─────────────────────────────────────────────────────────────────────────────
function buildDepthMap(sideDensityGrid) {
  const depthMap = [];
  for (let ty = 0; ty < TARGET_H; ty++) {
    const row = [];
    for (let tx = 0; tx < TARGET_W; tx++) {
      const density = sideDensityGrid[ty][tx];
      if (density > DENSITY_THRESHOLD) {
        const normZ = Z_MIN + (tx / TARGET_W) * (Z_MAX - Z_MIN);
        row.push({ normZ: parseFloat(normZ.toFixed(4)), weight: density });
      }
    }
    depthMap.push(row);
  }
  return depthMap;
}

// ─────────────────────────────────────────────────────────────────────────────
// Weighted-random sample from a depth-map row.
// Fall back to Z=0 if no depth data in row.
// ─────────────────────────────────────────────────────────────────────────────
function sampleDepth(depthRow) {
  if (depthRow.length === 0) return 0;

  const totalWeight = depthRow.reduce((s, d) => s + d.weight, 0);
  let r = Math.random() * totalWeight;
  for (const d of depthRow) {
    r -= d.weight;
    if (r <= 0) return d.normZ;
  }
  return depthRow[depthRow.length - 1].normZ;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
(async () => {
  console.log('=== 3-D portrait particle generator ===\n');

  console.log('Front view:');
  const { particles: frontParticles } = await sampleImage(frontIn);

  console.log('\nSide view:');
  const { densityGrid: sideDensity } = await sampleImage(sideIn);

  console.log('\nBuilding depth map from side view…');
  const depthMap = buildDepthMap(sideDensity);
  const rowsWithData = depthMap.filter(r => r.length > 0).length;
  console.log(`  Rows with depth data: ${rowsWithData} / ${TARGET_H}`);

  console.log('\nAssigning Z to front particles…');

  const particles3d = frontParticles.map(([normX, normY, density]) => {
    // Map normY back to the grid row index for the depth map
    const ty = Math.min(Math.round(normY * TARGET_H), TARGET_H - 1);
    const normZ = sampleDepth(depthMap[ty]);
    return [normX, normY, normZ, density];
  });

  // ── Sanity ────────────────────────────
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (const [x, y, z] of particles3d) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  // ── Write output ────────────────────────────
  const js = `// Auto-generated by scripts/generate_3d.js — do not edit by hand.
// Run:  node scripts/generate_3d.js
//
// Sampled at ${TARGET_W}×${TARGET_H}  |  density threshold: ${DENSITY_THRESHOLD}
// Total particles: ${particles3d.length}
//
// Each entry: [normX, normY, normZ, density]
//   normX, normY : 0–1, front-view grid position
//   normZ : ${Z_MIN}–${Z_MAX}, depth assigned from side-view profile
//   density : 1 = black, 0 = white

const PORTRAIT_DATA_3D = ${JSON.stringify(particles3d)};
`;

  fs.writeFileSync(outFile, js, 'utf8');

  // ── Summary ──────────────────────────────────
  console.log('\n════════════════════════════════════════');
  console.log(`✓ Written → ${outFile}`);
  console.log(`\n  Total particles : ${particles3d.length}`);
  console.log(`  X range         : ${minX.toFixed(4)} → ${maxX.toFixed(4)}`);
  console.log(`  Y range         : ${minY.toFixed(4)} → ${maxY.toFixed(4)}`);
  console.log(`  Z range         : ${minZ.toFixed(4)} → ${maxZ.toFixed(4)}`);
  console.log(`\n  Z spread check  : ${(maxZ - minZ).toFixed(4)} (expect ≈ ${Z_MAX - Z_MIN})`);
  console.log(`  Rows with depth : ${rowsWithData}/${TARGET_H}`);

  if (particles3d.length < 10) {
    console.warn('\n⚠  Very few particles - check images and threshold.');
  }
  if (maxZ - minZ < 0.1) {
    console.warn('\n⚠  Z spread is very small - side image may lack dark pixels.');
  }
})();
