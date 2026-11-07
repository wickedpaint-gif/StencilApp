/**
 * Cartoon V2 — stage 6: colour reduction.
 *
 * Whole regions are assigned to colour layers — never individual pixels — so
 * the boundaries established during merging survive intact and layers stay
 * as coherent shapes instead of pixel confetti.
 *
 * Cluster centres are seeded deterministically (largest region first, then
 * farthest-first weighted by area) so the same image always yields the same
 * palette.
 */

import { rgbToLab, luminanceOfRgb } from './lab.js';

export function reduceToPalette(regionOfPixel, regionCount, rArea, rR, rG, rB, rLab, numColors) {
  const R = regionCount;
  if (R === 0) return { labelMap: new Int16Array(regionOfPixel.length).fill(-1), palette: [] };

  const k = Math.max(1, Math.min(numColors, R));
  const centers = new Float32Array(k * 3);
  const chosen = new Uint8Array(R);
  const minDist = new Float32Array(R).fill(Infinity);

  let seed = 0;
  let seedArea = -1;
  for (let i = 0; i < R; i++) if (rArea[i] > seedArea) { seedArea = rArea[i]; seed = i; }

  const setCenter = (c, i) => {
    centers[c * 3] = rLab[i * 3];
    centers[c * 3 + 1] = rLab[i * 3 + 1];
    centers[c * 3 + 2] = rLab[i * 3 + 2];
  };

  setCenter(0, seed);
  chosen[seed] = 1;

  for (let c = 1; c < k; c++) {
    const cl = centers[(c - 1) * 3];
    const ca = centers[(c - 1) * 3 + 1];
    const cb = centers[(c - 1) * 3 + 2];

    let best = -1;
    let bestScore = -1;
    for (let i = 0; i < R; i++) {
      const dl = rLab[i * 3] - cl;
      const da = rLab[i * 3 + 1] - ca;
      const db = rLab[i * 3 + 2] - cb;
      const d = dl * dl + da * da + db * db;
      if (d < minDist[i]) minDist[i] = d;
      if (chosen[i]) continue;
      const score = minDist[i] * Math.sqrt(rArea[i] + 1);
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best < 0) best = seed;
    setCenter(c, best);
    chosen[best] = 1;
  }

  const assign = new Int32Array(R).fill(-1);

  for (let iter = 0; iter < 12; iter++) {
    let changed = false;

    for (let i = 0; i < R; i++) {
      const l = rLab[i * 3];
      const a = rLab[i * 3 + 1];
      const b = rLab[i * 3 + 2];
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const dl = l - centers[c * 3];
        const da = a - centers[c * 3 + 1];
        const db = b - centers[c * 3 + 2];
        const d = dl * dl + da * da + db * db;
        if (d < bestD) { bestD = d; best = c; }
      }
      if (assign[i] !== best) { assign[i] = best; changed = true; }
    }

    if (!changed && iter > 0) break;

    const sum = new Float64Array(k);
    const sL = new Float64Array(k);
    const sA = new Float64Array(k);
    const sB = new Float64Array(k);

    for (let i = 0; i < R; i++) {
      const c = assign[i];
      const w = rArea[i] + 1;
      sum[c] += w;
      sL[c] += rLab[i * 3] * w;
      sA[c] += rLab[i * 3 + 1] * w;
      sB[c] += rLab[i * 3 + 2] * w;
    }

    for (let c = 0; c < k; c++) {
      if (sum[c] === 0) continue;
      centers[c * 3] = sL[c] / sum[c];
      centers[c * 3 + 1] = sA[c] / sum[c];
      centers[c * 3 + 2] = sB[c] / sum[c];
    }
  }

  // Palette RGB comes from the actual pixel means (keeps true artwork colours)
  const cArea = new Float64Array(k);
  const cR = new Float64Array(k);
  const cG = new Float64Array(k);
  const cB = new Float64Array(k);

  for (let i = 0; i < R; i++) {
    const c = assign[i];
    cArea[c] += rArea[i];
    cR[c] += rR[i];
    cG[c] += rG[i];
    cB[c] += rB[i];
  }

  const used = [];
  for (let c = 0; c < k; c++) {
    if (cArea[c] < 1) continue;
    const r = Math.round(cR[c] / cArea[c]);
    const g = Math.round(cG[c] / cArea[c]);
    const b = Math.round(cB[c] / cArea[c]);
    used.push({ cluster: c, r, g, b, lum: luminanceOfRgb(r, g, b) });
  }

  // Darkest → lightest, so layers stack in spray-paint order
  used.sort((p, q) => p.lum - q.lum);

  const clusterToLayer = new Int32Array(k).fill(-1);
  used.forEach((entry, idx) => { clusterToLayer[entry.cluster] = idx; });

  const palette = used.map((e) => ({ r: e.r, g: e.g, b: e.b, lum: e.lum }));

  const n = regionOfPixel.length;
  const labelMap = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const reg = regionOfPixel[i];
    labelMap[i] = reg < 0 ? -1 : clusterToLayer[assign[reg]];
  }

  return { labelMap, palette };
}

/** Mean Lab of a region, useful for debug readouts. */
export function regionLabOf(rR, rG, rB, rArea, i) {
  return rgbToLab(Math.round(rR[i] / rArea[i]), Math.round(rG[i] / rArea[i]), Math.round(rB[i] / rArea[i]));
}