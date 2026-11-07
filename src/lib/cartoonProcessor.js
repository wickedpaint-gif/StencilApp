/**
 * Cartoon-only stencil pipeline.
 *
 * Stages
 *   1. Edge-aware (bilateral) smoothing — removes compression noise, keeps edges
 *   2. Black-outline protection mask — strong dark ridges become their own region
 *   3. Deterministic K-means colour quantisation in OKLab (outlines excluded)
 *   4. Spatial majority filter on the colour label map
 *   5. Connected-component cleanup — small / narrow fragments merge into a neighbour
 *   6. Clean label map, ready for solid binary mask generation by the caller
 *
 * Nothing in this module is used by Realistic mode.
 */

export const CARTOON_DEFAULTS = {
  edgeSmoothing: 'low',
  detailRemoval: 10,
  regionSimplification: 'medium',
};

const EDGE_PRESETS = {
  off: null,
  low: { radius: 1, sigmaRange: 30 },
  medium: { radius: 2, sigmaRange: 38 },
};

const SIMPLIFY_PRESETS = {
  off: { passes: 0, radius: 1, maxThickness: 0 },
  low: { passes: 1, radius: 1, maxThickness: 1.15 },
  medium: { passes: 2, radius: 1, maxThickness: 1.6 },
  high: { passes: 2, radius: 2, maxThickness: 2.2 },
};

const OUTLINE_LABEL = -2;
const MAX_NARROW_AREA = 20000; // narrow fragments larger than this are kept

// ─── Colour space helpers ───────────────────────────────────────────────────

function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** sRGB (0–255) → OKLab [L, a, b]. Perceptually uniform distance. */
export function rgbToOklab(r, g, b) {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ];
}

function labDist2(l1, a1, b1, l2, a2, b2) {
  const dl = l1 - l2;
  const da = a1 - a2;
  const db = b1 - b2;
  return dl * dl + da * da + db * db;
}

// ─── Stage 1: bilateral (edge-aware) smoothing ──────────────────────────────

function bilateralFilter(src, width, height, radius, sigmaRange) {
  const n = width * height;
  const out = new Uint8ClampedArray(src);

  const sigmaSpace = radius * 0.8 + 0.4;
  const taps = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > radius * radius) continue;
      taps.push({ dx, dy, w: Math.exp(-d2 / (2 * sigmaSpace * sigmaSpace)) });
    }
  }
  const maxDist = Math.ceil(Math.sqrt(3) * 255);
  const rangeLut = new Float32Array(maxDist + 1);
  const denom = 2 * sigmaRange * sigmaRange;
  for (let i = 0; i <= maxDist; i++) rangeLut[i] = Math.exp(-(i * i) / denom);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const o = i * 4;
      const a = src[o + 3];
      if (a < 10) continue;
      const cr = src[o];
      const cg = src[o + 1];
      const cb = src[o + 2];

      let sr = 0, sg = 0, sb = 0, sw = 0;
      for (let t = 0; t < taps.length; t++) {
        const tap = taps[t];
        const nx = x + tap.dx;
        const ny = y + tap.dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const no = (ny * width + nx) * 4;
        if (src[no + 3] < 10) continue;
        const dr = src[no] - cr;
        const dg = src[no + 1] - cg;
        const db = src[no + 2] - cb;
        const d = Math.sqrt(dr * dr + dg * dg + db * db) | 0;
        const w = tap.w * rangeLut[d];
        sr += src[no] * w;
        sg += src[no + 1] * w;
        sb += src[no + 2] * w;
        sw += w;
      }
      if (sw > 0) {
        out[o] = sr / sw;
        out[o + 1] = sg / sw;
        out[o + 2] = sb / sw;
      }
    }
  }
  return out;
}

// ─── Stage 2: outline protection ────────────────────────────────────────────

/**
 * Marks genuinely dark, neutral ridge pixels as protected outline material.
 * Dark but clearly saturated colours (dark green, purple shadows) fail the
 * saturation test and stay available for normal colour assignment.
 */
function detectOutlines(src, width, height) {
  const n = width * height;
  const mask = new Uint8Array(n);
  const luma = new Uint8Array(n);
  const sat = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const r = src[o];
    const g = src[o + 1];
    const b = src[o + 2];
    luma[i] = (0.299 * r + 0.587 * g + 0.114 * b) | 0;
    const mx = r > g ? (r > b ? r : b) : g > b ? g : b;
    const mn = r < g ? (r < b ? r : b) : g < b ? g : b;
    sat[i] = mx > 0 ? (((mx - mn) * 255) / mx) | 0 : 0;
  }

  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (src[i * 4 + 3] < 10) continue;
      const l = luma[i];
      const s = sat[i];

      // Near-black core — outlines, regardless of a slight colour cast
      if (l <= 42 && s <= 175) { mask[i] = 1; count++; continue; }

      // Dark ridge: darker than its immediate surroundings
      if (l <= 95 && s <= 120) {
        let sum = 0, cnt = 0;
        if (x > 0) { sum += luma[i - 1]; cnt++; }
        if (x < width - 1) { sum += luma[i + 1]; cnt++; }
        if (y > 0) { sum += luma[i - width]; cnt++; }
        if (y < height - 1) { sum += luma[i + width]; cnt++; }
        if (cnt > 0 && sum / cnt - l >= 6) { mask[i] = 1; count++; }
      }
    }
  }

  return { mask, count };
}

// ─── Background mask (border-reachable near-white) ──────────────────────────

function buildBackgroundMask(src, width, height, whiteTolerance, scratch) {
  const n = width * height;
  const t = 255 - whiteTolerance;
  const isNearWhite = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (src[o + 3] >= 10 && src[o] >= t && src[o + 1] >= t && src[o + 2] >= t) {
      isNearWhite[i] = 1;
    }
  }

  const isBackground = new Uint8Array(n);
  let head = 0;
  let tail = 0;

  const enqueue = (idx) => {
    if (isNearWhite[idx] && !isBackground[idx]) {
      isBackground[idx] = 1;
      scratch[tail++] = idx;
    }
  };

  for (let x = 0; x < width; x++) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }

  while (head < tail) {
    const idx = scratch[head++];
    const x = idx % width;
    const y = (idx / width) | 0;
    if (x > 0) enqueue(idx - 1);
    if (x < width - 1) enqueue(idx + 1);
    if (y > 0) enqueue(idx - width);
    if (y < height - 1) enqueue(idx + width);
  }

  return isBackground;
}

// ─── Stage 3: deterministic K-means in OKLab ────────────────────────────────

function collectSamples(src, width, height, outline, background) {
  const n = width * height;
  const targetSamples = 40000;
  const step = Math.max(1, Math.floor(n / targetSamples));
  const values = [];

  for (let i = 0; i < n; i += step) {
    if (src[i * 4 + 3] < 10) continue;
    if (outline[i] || (background && background[i])) continue;
    const o = i * 4;
    const lab = rgbToOklab(src[o], src[o + 1], src[o + 2]);
    values.push(lab[0], lab[1], lab[2]);
  }
  return new Float32Array(values);
}

/** Farthest-first initialisation → identical input always gives identical palette. */
function kMeansOklab(samples, k, maxIter = 14) {
  const n = samples.length / 3;
  if (n === 0) return [];
  const kk = Math.min(k, n);

  let mL = 0, mA = 0, mB = 0;
  for (let i = 0; i < n; i++) {
    mL += samples[i * 3];
    mA += samples[i * 3 + 1];
    mB += samples[i * 3 + 2];
  }
  mL /= n; mA /= n; mB /= n;

  let start = 0;
  let bestD = Infinity;
  for (let i = 0; i < n; i++) {
    const d = labDist2(samples[i * 3], samples[i * 3 + 1], samples[i * 3 + 2], mL, mA, mB);
    if (d < bestD) { bestD = d; start = i; }
  }

  const centroids = [[samples[start * 3], samples[start * 3 + 1], samples[start * 3 + 2]]];
  const minD = new Float32Array(n).fill(Infinity);

  while (centroids.length < kk) {
    const c = centroids[centroids.length - 1];
    let pick = -1;
    let pickD = -1;
    for (let i = 0; i < n; i++) {
      const d = labDist2(samples[i * 3], samples[i * 3 + 1], samples[i * 3 + 2], c[0], c[1], c[2]);
      if (d < minD[i]) minD[i] = d;
      if (minD[i] > pickD) { pickD = minD[i]; pick = i; }
    }
    if (pick < 0 || pickD <= 0) break;
    centroids.push([samples[pick * 3], samples[pick * 3 + 1], samples[pick * 3 + 2]]);
  }

  const kActual = centroids.length;
  const assign = new Int32Array(n);

  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      const sl = samples[i * 3], sa = samples[i * 3 + 1], sb = samples[i * 3 + 2];
      let best = 0;
      let bestDist = Infinity;
      for (let c = 0; c < kActual; c++) {
        const d = labDist2(sl, sa, sb, centroids[c][0], centroids[c][1], centroids[c][2]);
        if (d < bestDist) { bestDist = d; best = c; }
      }
      if (assign[i] !== best) { assign[i] = best; changed = true; }
    }
    if (!changed && iter > 0) break;

    const sums = new Float64Array(kActual * 3);
    const counts = new Int32Array(kActual);
    for (let i = 0; i < n; i++) {
      const c = assign[i];
      sums[c * 3] += samples[i * 3];
      sums[c * 3 + 1] += samples[i * 3 + 1];
      sums[c * 3 + 2] += samples[i * 3 + 2];
      counts[c]++;
    }
    for (let c = 0; c < kActual; c++) {
      if (counts[c] > 0) {
        centroids[c][0] = sums[c * 3] / counts[c];
        centroids[c][1] = sums[c * 3 + 1] / counts[c];
        centroids[c][2] = sums[c * 3 + 2] / counts[c];
      }
    }
  }

  return centroids;
}

/**
 * Assigns every opaque, non-background pixel to a cluster using a 15-bit RGB
 * lookup cache. Outline pixels are tagged with OUTLINE_LABEL for now.
 */
function assignClusterLabels(src, width, height, centroids, outline, background) {
  const n = width * height;
  const labels = new Int16Array(n).fill(-1);
  const k = centroids.length;
  const lut = new Int16Array(32768).fill(-1);

  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (src[o + 3] < 10) continue;
    if (background && background[i]) continue;
    if (outline[i]) { labels[i] = OUTLINE_LABEL; continue; }

    const r = src[o], g = src[o + 1], b = src[o + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let idx = lut[key];
    if (idx < 0) {
      const lab = rgbToOklab(r, g, b);
      let best = 0;
      let bestDist = Infinity;
      for (let c = 0; c < k; c++) {
        const d = labDist2(lab[0], lab[1], lab[2], centroids[c][0], centroids[c][1], centroids[c][2]);
        if (d < bestDist) { bestDist = d; best = c; }
      }
      idx = best;
      lut[key] = idx;
    }
    labels[i] = idx;
  }

  return labels;
}

// ─── Stage 4: spatial majority filter ───────────────────────────────────────

function majorityFilter(labels, width, height, numLabels, protectedLabel, radius, passes) {
  if (passes <= 0) return labels;
  const n = width * height;
  let src = labels;
  let dst = new Int16Array(n);

  const counts = new Int32Array(numLabels);
  const seen = new Int32Array(numLabels).fill(-1);
  const touched = new Int32Array(numLabels);
  let stamp = 0;

  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const cur = src[i];
        if (cur < 0 || cur === protectedLabel) { dst[i] = cur; continue; }

        // Fast path: identical orthogonal neighbours → nothing to simplify
        const left = x > 0 ? src[i - 1] : cur;
        const right = x < width - 1 ? src[i + 1] : cur;
        const up = y > 0 ? src[i - width] : cur;
        const down = y < height - 1 ? src[i + width] : cur;
        if (left === cur && right === cur && up === cur && down === cur) {
          dst[i] = cur;
          continue;
        }

        stamp++;
        let total = 0;
        let touchedCount = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -radius; dx <= radius; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= width) continue;
            const l = src[ny * width + nx];
            if (l < 0 || l === protectedLabel) continue;
            if (seen[l] !== stamp) {
              seen[l] = stamp;
              counts[l] = 1;
              touched[touchedCount++] = l;
            } else {
              counts[l]++;
            }
            total++;
          }
        }
        if (total === 0) { dst[i] = cur; continue; }

        let best = cur;
        let bestCount = 0;
        for (let t = 0; t < touchedCount; t++) {
          const l = touched[t];
          if (counts[l] > bestCount) { bestCount = counts[l]; best = l; }
        }

        // Conservative: only replace a clear minority with a clear majority
        const isMinority = counts[cur] <= Math.max(1, Math.floor(total * 0.3));
        if (best !== cur && isMinority && bestCount >= total * 0.5) {
          dst[i] = best;
        } else {
          dst[i] = cur;
        }
      }
    }
    const swap = src;
    src = dst;
    dst = swap;
  }

  return src;
}

// ─── Stage 5: connected-component region cleanup ────────────────────────────

/**
 * Merges insignificant regions (tiny area, or long thin slivers such as the
 * coloured fringes that follow black outlines) into the most appropriate
 * neighbouring colour, chosen by shared boundary length and colour similarity.
 * Protected outline regions are never merged and are never used as a target.
 */
function cleanCartoonRegions(labels, width, height, numLabels, paletteLab, protectedLabel, minArea, maxThickness, scratch) {
  if (minArea <= 0 && maxThickness <= 0) return labels;
  const n = width * height;

  const comp = new Int32Array(n).fill(-1);
  const compLabel = [];
  const compArea = [];

  for (let i = 0; i < n; i++) {
    const lab = labels[i];
    if (lab < 0 || comp[i] !== -1) continue;

    const id = compLabel.length;
    compLabel.push(lab);
    compArea.push(0);

    let sp = 0;
    let area = 0;
    scratch[sp++] = i;
    comp[i] = id;

    while (sp > 0) {
      const p = scratch[--sp];
      area++;
      const x = p % width;
      if (x > 0) {
        const q = p - 1;
        if (comp[q] === -1 && labels[q] === lab) { comp[q] = id; scratch[sp++] = q; }
      }
      if (x < width - 1) {
        const q = p + 1;
        if (comp[q] === -1 && labels[q] === lab) { comp[q] = id; scratch[sp++] = q; }
      }
      if (p >= width) {
        const q = p - width;
        if (comp[q] === -1 && labels[q] === lab) { comp[q] = id; scratch[sp++] = q; }
      }
      if (p + width < n) {
        const q = p + width;
        if (comp[q] === -1 && labels[q] === lab) { comp[q] = id; scratch[sp++] = q; }
      }
    }
    compArea[id] = area;
  }

  const compCount = compLabel.length;
  if (compCount === 0) return labels;

  // Shared boundary length per (component, neighbouring label)
  const adj = new Map();
  const bump = (id, l) => {
    const key = id * numLabels + l;
    adj.set(key, (adj.get(key) || 0) + 1);
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (labels[i] < 0) continue;
      const id = comp[i];
      if (x > 0) {
        const q = i - 1;
        if (labels[q] >= 0 && comp[q] !== id) bump(id, labels[q]);
      }
      if (x < width - 1) {
        const q = i + 1;
        if (labels[q] >= 0 && comp[q] !== id) bump(id, labels[q]);
      }
      if (y > 0) {
        const q = i - width;
        if (labels[q] >= 0 && comp[q] !== id) bump(id, labels[q]);
      }
      if (y < height - 1) {
        const q = i + width;
        if (labels[q] >= 0 && comp[q] !== id) bump(id, labels[q]);
      }
    }
  }

  const target = new Int32Array(compCount).fill(-1);

  for (let id = 0; id < compCount; id++) {
    const lab = compLabel[id];
    if (lab === protectedLabel) continue;

    const area = compArea[id];
    let perimeter = 0;
    let bestLab = -1;
    let bestScore = 0;

    const pl = paletteLab[lab];
    for (let l = 0; l < numLabels; l++) {
      const shared = adj.get(id * numLabels + l) || 0;
      if (!shared) continue;
      perimeter += shared;
      if (l === protectedLabel) continue; // never fold colour into the outline
      let score = shared;
      if (paletteLab[l] && pl) {
        const d = Math.sqrt(labDist2(pl[0], pl[1], pl[2], paletteLab[l][0], paletteLab[l][1], paletteLab[l][2]));
        // Similar colours win ties between equal-length boundaries
        score *= 0.4 + Math.max(0, Math.min(1, 1 - d / 0.35));
      }
      if (score > bestScore) { bestScore = score; bestLab = l; }
    }

    if (bestLab < 0) continue;

    const thickness = perimeter > 0 ? (2 * area) / perimeter : Infinity;
    const tiny = minArea > 0 && area < minArea;
    const narrow = maxThickness > 0 && thickness < maxThickness && area < MAX_NARROW_AREA;
    if (tiny || narrow) target[id] = bestLab;
  }

  for (let i = 0; i < n; i++) {
    const id = comp[i];
    if (id < 0) continue;
    const t = target[id];
    if (t >= 0) labels[i] = t;
  }

  return labels;
}

// ─── Pipeline entry point ───────────────────────────────────────────────────

/**
 * Produces a cleaned colour label map.
 *
 * labels[i] = -1   → transparent / background (no material)
 * labels[i] >= 0   → index into the returned palette
 *
 * @returns {{ labels: Int16Array, palette: {r:number,g:number,b:number}[], width:number, height:number }}
 */
export function buildCartoonSegments(rawData, width, height, numColors, whiteTolerance = 15, settings = null) {
  const n = width * height;
  const opts = { ...CARTOON_DEFAULTS, ...(settings || {}) };
  const edge = EDGE_PRESETS[opts.edgeSmoothing] || EDGE_PRESETS.low;
  const simplify = SIMPLIFY_PRESETS[opts.regionSimplification] || SIMPLIFY_PRESETS.medium;
  const minArea = Math.max(0, Math.round(opts.detailRemoval || 0));

  const scratch = new Int32Array(n);

  // Stage 1 — edge-aware smoothing
  const src = edge
    ? bilateralFilter(rawData.data, width, height, edge.radius, edge.sigmaRange)
    : new Uint8ClampedArray(rawData.data);

  // Stage 2 — outline protection
  const { mask: outline, count: outlineCount } = detectOutlines(src, width, height);

  const background = whiteTolerance > 0
    ? buildBackgroundMask(src, width, height, whiteTolerance, scratch)
    : null;

  // Stage 3 — quantisation (one colour slot is reserved for the outline region)
  const hasOutline = outlineCount > 0;
  const k = hasOutline ? Math.max(1, numColors - 1) : Math.max(1, numColors);
  const samples = collectSamples(src, width, height, outline, background);
  const centroids = kMeansOklab(samples, k);
  if (centroids.length === 0) {
    return { labels: new Int16Array(n).fill(-1), palette: [], width, height };
  }

  let labels = assignClusterLabels(src, width, height, centroids, outline, background);

  // Mean RGB per cluster + outline mean
  const sums = new Float64Array(centroids.length * 3);
  const counts = new Int32Array(centroids.length);
  let oR = 0, oG = 0, oB = 0, oN = 0;

  for (let i = 0; i < n; i++) {
    const lab = labels[i];
    const o = i * 4;
    if (lab === OUTLINE_LABEL) {
      oR += src[o]; oG += src[o + 1]; oB += src[o + 2]; oN++;
    } else if (lab >= 0) {
      sums[lab * 3] += src[o];
      sums[lab * 3 + 1] += src[o + 1];
      sums[lab * 3 + 2] += src[o + 2];
      counts[lab]++;
    }
  }

  // Compact palette (drops empty clusters), outline last
  const palette = [];
  const paletteLab = [];
  const remap = new Int16Array(centroids.length).fill(-1);

  for (let c = 0; c < centroids.length; c++) {
    if (counts[c] === 0) continue;
    const col = {
      r: Math.round(sums[c * 3] / counts[c]),
      g: Math.round(sums[c * 3 + 1] / counts[c]),
      b: Math.round(sums[c * 3 + 2] / counts[c]),
    };
    remap[c] = palette.length;
    palette.push(col);
    paletteLab.push(rgbToOklab(col.r, col.g, col.b));
  }

  if (palette.length === 0) {
    return { labels: new Int16Array(n).fill(-1), palette: [], width, height };
  }

  let outlineLabel = -1;
  if (hasOutline && oN > 0) {
    const oc = { r: Math.round(oR / oN), g: Math.round(oG / oN), b: Math.round(oB / oN) };
    const ocLab = rgbToOklab(oc.r, oc.g, oc.b);

    let nearest = -1;
    let nearestD = Infinity;
    for (let c = 0; c < palette.length; c++) {
      const d = labDist2(ocLab[0], ocLab[1], ocLab[2], paletteLab[c][0], paletteLab[c][1], paletteLab[c][2]);
      if (d < nearestD) { nearestD = d; nearest = c; }
    }

    if (nearest >= 0 && nearestD < 0.0009) {
      outlineLabel = nearest; // an existing colour is already the outline colour
    } else {
      outlineLabel = palette.length;
      palette.push(oc);
      paletteLab.push(ocLab);
    }
  }

  // Final label map
  for (let i = 0; i < n; i++) {
    const lab = labels[i];
    if (lab === OUTLINE_LABEL) labels[i] = outlineLabel >= 0 ? outlineLabel : -1;
    else if (lab >= 0) labels[i] = remap[lab];
  }

  // Stage 4 — spatial cleanup
  labels = majorityFilter(labels, width, height, palette.length, outlineLabel, simplify.radius, simplify.passes);

  // Stage 5 — connected-component cleanup
  labels = cleanCartoonRegions(
    labels, width, height, palette.length, paletteLab, outlineLabel,
    minArea, simplify.maxThickness, scratch
  );

  return { labels, palette, width, height };
}