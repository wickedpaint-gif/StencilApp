/**
 * Cartoon V2 — stage 3: outline / boundary detection.
 *
 * Produces two maps:
 *   magnitude  — raw gradient strength (debug + soft merge penalty)
 *   protection — 0–255 boundary-protection. 255 = an ink outline that regions
 *                must not merge across.
 *
 * Ink is detected as "a strong edge whose centre is significantly darker than
 * its local surroundings". A broad dark shadow has no strong gradient inside it
 * and is NOT darker than its own neighbourhood mean, so it is never tagged as
 * an outline — it stays available for segmentation as a colour region.
 */

import { boxMean } from './prepare.js';

export function lumaFromRGBA(rgba, n) {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    out[i] = (rgba[o] * 77 + rgba[o + 1] * 150 + rgba[o + 2] * 29) >> 8;
  }
  return out;
}

export function computeEdgeMaps(luma, width, height) {
  const n = width * height;
  const magnitude = new Uint8Array(n);
  const protection = new Uint8Array(n);
  const local = boxMean(luma, width, height, 4);

  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = row + x;
      const gx = luma[i + 1] - luma[i - 1];
      const gy = luma[i + width] - luma[i - width];
      let mag = ((gx < 0 ? -gx : gx) + (gy < 0 ? -gy : gy)) >> 1;
      if (mag > 255) mag = 255;
      magnitude[i] = mag;

      const darkerThanSurroundings = local[i] - luma[i];
      if (mag > 18 && darkerThanSurroundings > 10) {
        protection[i] = 255;
      } else if (mag > 10) {
        const soft = 40 + (mag - 10) * 6;
        protection[i] = soft > 200 ? 200 : soft;
      } else {
        protection[i] = 0;
      }
    }
  }

  // Close 1px gaps in ink lines so regions cannot leak through them
  const dilated = Uint8Array.from(protection);
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = row + x;
      if (protection[i] === 255) continue;
      if (
        protection[i - 1] === 255 ||
        protection[i + 1] === 255 ||
        protection[i - width] === 255 ||
        protection[i + width] === 255
      ) {
        dilated[i] = 255;
      }
    }
  }

  return { magnitude, protection: dilated };
}