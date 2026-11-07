/**
 * Cartoon V2 — colour helpers.
 * sRGB → CIELAB (D65). Used for perceptual region-merge and colour-reduction
 * decisions (per-pixel work stays in cheap weighted RGB; Lab is only computed
 * for region means, so this never becomes a hot loop).
 */

const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

const EPS = 0.008856;
const KAPPA = 7.787;

function fTable(t) {
  return t > EPS ? Math.cbrt(t) : KAPPA * t + 16 / 116;
}

export function rgbToLab(r, g, b) {
  const R = LIN[r & 255];
  const G = LIN[g & 255];
  const B = LIN[b & 255];
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const fx = fTable(x);
  const fy = fTable(y);
  const fz = fTable(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Rec.601 luma 0–255. */
export function lumaOf(r, g, b) {
  return (r * 77 + g * 150 + b * 29) >> 8;
}

/** Squared ΔE76 between two Lab triples stored in flat arrays. */
export function labDistSq(L, i, j) {
  const dl = L[i] - L[j];
  const da = L[i + 1] - L[j + 1];
  const db = L[i + 2] - L[j + 2];
  return dl * dl + da * da + db * db;
}

export function luminanceOfRgb(r, g, b) {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export function rgbToHex(r, g, b) {
  return ('#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')).toUpperCase();
}