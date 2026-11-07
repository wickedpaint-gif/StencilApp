/**
 * Cartoon V2 — stage 5: Region Adjacency Graph + region merging.
 *
 * Superpixels are treated as nodes; shared borders become weighted edges.
 * Merging is agglomerative: cheapest edge first, where the cost mixes
 * perceptual colour difference with the strength of the boundary between the
 * two regions. Boundaries protected by ink outlines carry a large penalty and
 * are hard-blocked, so separate shapes stay separate while shading variation
 * across the same surface collapses into one clean region.
 */

import { rgbToLab } from './lab.js';

export function buildRegionGraph(labels, count, rgba, protection, width, height, maxCost, targetRegions) {
  const n = width * height;

  const area = new Float64Array(count);
  const sumR = new Float64Array(count);
  const sumG = new Float64Array(count);
  const sumB = new Float64Array(count);

  // Transparent pixels (the alpha channel produced by the background remover)
  // carry no label, so they are already excluded from every statistic here and
  // can never steal a colour layer.
  for (let i = 0; i < n; i++) {
    const l = labels[i];
    if (l < 0) continue;
    const o = i * 4;
    area[l]++;
    sumR[l] += rgba[o];
    sumG[l] += rgba[o + 1];
    sumB[l] += rgba[o + 2];
  }

  // ── Union-find with area-weighted colour accumulation ─────────────────────
  const parent = new Int32Array(count);
  for (let i = 0; i < count; i++) parent[i] = i;

  const find = (x) => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    while (parent[x] !== r) { const nx = parent[x]; parent[x] = r; x = nx; }
    return r;
  };

  const uArea = Float64Array.from(area);
  const uL = new Float32Array(count);
  const uA = new Float32Array(count);
  const uB = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    if (area[i] < 1) continue;
    const lab = rgbToLab(
      Math.round(sumR[i] / area[i]),
      Math.round(sumG[i] / area[i]),
      Math.round(sumB[i] / area[i])
    );
    uL[i] = lab[0];
    uA[i] = lab[1];
    uB[i] = lab[2];
  }

  // ── Adjacency ─────────────────────────────────────────────────────────────
  const edgeMap = new Map();
  const addEdge = (a, b, prot) => {
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const key = lo * count + hi;
    let e = edgeMap.get(key);
    if (!e) {
      e = { a: lo, b: hi, len: 0, prot: 0, cost: 0 };
      edgeMap.set(key, e);
    }
    e.len++;
    e.prot += prot;
  };

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const i = row + x;
      const l = labels[i];
      if (l < 0) continue;
      const prot = protection[i];
      if (x + 1 < width) {
        const r = labels[i + 1];
        if (r >= 0 && r !== l) addEdge(l, r, prot);
      }
      if (y + 1 < height) {
        const d = labels[i + width];
        if (d >= 0 && d !== l) addEdge(l, d, prot);
      }
    }
  }

  const edges = Array.from(edgeMap.values());
  const costOf = (e) => {
    const a = find(e.a);
    const b = find(e.b);
    if (a === b) return Infinity;
    const dl = uL[a] - uL[b];
    const da = uA[a] - uA[b];
    const db = uB[a] - uB[b];
    const dE = Math.sqrt(dl * dl + da * da + db * db);
    const protFrac = e.prot / (e.len * 255);
    return dE + 90 * protFrac;
  };

  for (const e of edges) e.cost = costOf(e);
  edges.sort((p, q) => p.cost - q.cost);

  let regions = 0;
  for (let i = 0; i < count; i++) if (area[i] > 0) regions++;

  const mergeRoots = (ra, rb) => {
    const A = uArea[ra];
    const B = uArea[rb];
    const tot = A + B;
    if (tot > 0) {
      uL[ra] = (uL[ra] * A + uL[rb] * B) / tot;
      uA[ra] = (uA[ra] * A + uA[rb] * B) / tot;
      uB[ra] = (uB[ra] * A + uB[rb] * B) / tot;
      uArea[ra] = tot;
    }
    parent[rb] = ra;
  };

  const HARD_BLOCK = 0.42;

  const runPass = (limit) => {
    for (const e of edges) {
      const a = find(e.a);
      const b = find(e.b);
      if (a === b) continue;
      // Never merge across a boundary protected by an ink outline
      if (e.prot / (e.len * 255) > HARD_BLOCK) continue;
      if (costOf(e) <= limit) {
        mergeRoots(a, b);
        regions--;
      }
    }
  };

  // The quality-driven pass always runs — otherwise a small image (fewer
  // superpixels than the safety cap) would never merge at all. Relaxed passes
  // only kick in while the graph is still too fragmented for clean layers.
  runPass(maxCost);
  for (const relax of [1.4, 2, 2.9]) {
    if (regions <= targetRegions) break;
    runPass(maxCost * relax);
  }

  // ── Materialise dense region ids + statistics ─────────────────────────────
  const denseOf = new Int32Array(count).fill(-1);
  let R = 0;
  const regionOfPixel = new Int32Array(n).fill(-1);

  for (let i = 0; i < n; i++) {
    const l = labels[i];
    if (l < 0) continue;
    const root = find(l);
    let dense = denseOf[root];
    if (dense < 0) {
      dense = R++;
      denseOf[root] = dense;
    }
    regionOfPixel[i] = dense;
  }

  const rArea = new Float64Array(R);
  const rR = new Float64Array(R);
  const rG = new Float64Array(R);
  const rB = new Float64Array(R);

  for (let i = 0; i < n; i++) {
    const reg = regionOfPixel[i];
    if (reg < 0) continue;
    const o = i * 4;
    rArea[reg]++;
    rR[reg] += rgba[o];
    rG[reg] += rgba[o + 1];
    rB[reg] += rgba[o + 2];
  }

  const rLab = new Float32Array(R * 3);
  for (let r = 0; r < R; r++) {
    if (rArea[r] < 1) continue;
    // (regions are already free of background pixels)
    const lab = rgbToLab(
      Math.round(rR[r] / rArea[r]),
      Math.round(rG[r] / rArea[r]),
      Math.round(rB[r] / rArea[r])
    );
    rLab[r * 3] = lab[0];
    rLab[r * 3 + 1] = lab[1];
    rLab[r * 3 + 2] = lab[2];
  }

  return { regionOfPixel, regionCount: R, rArea, rR, rG, rB, rLab };
}