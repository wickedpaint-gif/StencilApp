/**
 * Cartoon V2 — stage 2: adaptive preparation.
 *
 * Edge-preserving smoothing only (bilateral). Unlike a Gaussian blur it kills
 * sensor/JPEG noise inside flat areas while keeping ink outlines and colour
 * boundaries crisp, which is exactly what the superpixel stage needs.
 * Strength comes from the quality profile, never from a fixed preset.
 */

const MAX_D2 = 3 * 255 * 255;
const RANGE_STEPS = 4096;

export const RANGE_TABLE = (() => {
  const table = new Float32Array(RANGE_STEPS + 1);
  return table;
})();

// d² is always a non-negative integer in [0, MAX_D2], so the range-table index
// is precomputed once per value instead of dividing on every tap of every
// pixel. The index expression is exactly the one previously evaluated inline,
// so the weights stay bit-identical.
const RANGE_INDEX = new Uint16Array(MAX_D2 + 1);

function buildRangeTable(sigmaR) {
  const inv = 1 / (2 * sigmaR * sigmaR);
  for (let i = 0; i <= RANGE_STEPS; i++) {
    RANGE_TABLE[i] = Math.exp(-((i / RANGE_STEPS) * MAX_D2) * inv);
  }
  for (let i = 0; i <= MAX_D2; i++) {
    RANGE_INDEX[i] = ((i * RANGE_STEPS) / MAX_D2) | 0;
  }
}

export function bilateralFilter(src, width, height, radius, sigmaR) {
  const r = Math.max(0, Math.round(radius));
  if (r < 1) return src;

  const sigmaS = r * 0.6 + 0.5;
  const taps = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > r * r) continue;
      taps.push(dx, dy, Math.exp(-d2 / (2 * sigmaS * sigmaS)));
    }
  }
  const tapCount = taps.length / 3;

  buildRangeTable(sigmaR);
  const table = RANGE_TABLE;
  const index = RANGE_INDEX;

  const out = new Uint8ClampedArray(src.length);

  // Rows are walked explicitly so the per-pixel `/` and `%` disappear; taps keep
  // their original order, so every accumulator sums in exactly the same sequence
  // as before and the output bytes are unchanged.
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const i = row + x;
      const o = i * 4;
      const a = src[o + 3];
      const cr = src[o];
      const cg = src[o + 1];
      const cb = src[o + 2];
      out[o + 3] = a;

      if (a < 10) {
        out[o] = cr;
        out[o + 1] = cg;
        out[o + 2] = cb;
        continue;
      }

      let sw = 0;
      let sr = 0;
      let sg = 0;
      let sb = 0;

      for (let t = 0; t < tapCount; t++) {
        const nx = x + taps[t * 3];
        if (nx < 0 || nx >= width) continue;
        const ny = y + taps[t * 3 + 1];
        if (ny < 0 || ny >= height) continue;
        const no = (ny * width + nx) * 4;
        if (src[no + 3] < 10) continue;

        const dr = src[no] - cr;
        const dg = src[no + 1] - cg;
        const db = src[no + 2] - cb;
        const d2 = dr * dr + dg * dg + db * db;
        const w = taps[t * 3 + 2] * table[index[d2]];

        sw += w;
        sr += src[no] * w;
        sg += src[no + 1] * w;
        sb += src[no + 2] * w;
      }

      if (sw > 0) {
        out[o] = sr / sw;
        out[o + 1] = sg / sw;
        out[o + 2] = sb / sw;
      } else {
        out[o] = cr;
        out[o + 1] = cg;
        out[o + 2] = cb;
      }
    }
  }

  return out;
}

/** Cheap separable box mean (used for local-contrast decisions). */
export function boxMean(src, width, height, radius) {
  const tmp = new Float32Array(width * height);
  const out = new Float32Array(width * height);
  const w = radius * 2 + 1;

  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    for (let x = -radius; x <= radius; x++) {
      sum += src[row + Math.min(width - 1, Math.max(0, x))];
    }
    for (let x = 0; x < width; x++) {
      tmp[row + x] = sum / w;
      const add = src[row + Math.min(width - 1, x + radius + 1)];
      const sub = src[row + Math.max(0, x - radius)];
      sum += add - sub;
    }
  }

  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) {
      sum += tmp[Math.min(height - 1, Math.max(0, y)) * width + x];
    }
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / w;
      const add = tmp[Math.min(height - 1, y + radius + 1) * width + x];
      const sub = tmp[Math.max(0, y - radius) * width + x];
      sum += add - sub;
    }
  }

  return out;
}