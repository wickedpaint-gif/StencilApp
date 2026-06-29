/**
 * StencilForge processor
 */
// ─── Island bridge import ────────────────────────────────────────────────────
import { burnCornerMarkers } from './islandBridge.js';
import { applyVectorBridges } from './vectorBridge.js';
import { applySmartBridges, buildUpperLayerMasks } from './smartBridge.js';
import ImageTracer from 'imagetracerjs';

/**
 * 
 * REALISTIC mode: Brightness-based tonal layers, stacked like a cake.
 *   Each layer includes all pixels DARKER than its threshold (cumulative / additive).
 *   Layer 1 = darkest tones only, Layer N = everything up to near-white.
 *   When stacked, each layer covers the next, like paint layers on a canvas.
 *
 * CARTOON mode: K-means color quantization separates by hue/color.
 *   Each layer is a distinct color region extracted from the palette.
 *
 * SVG export uses a scanline run-length encoder for clean vector rects,
 * then outputs a compact SVG path string.
 */

// ─── Grayscale extraction ────────────────────────────────────────────────────

export function imageToGrayscaleData(imageElement, maxSize = 4096) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  let w = imageElement.naturalWidth || imageElement.width;
  let h = imageElement.naturalHeight || imageElement.height;

  if (w > maxSize || h > maxSize) {
    const scale = maxSize / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }

  canvas.width = w;
  canvas.height = h;
  ctx.drawImage(imageElement, 0, 0, w, h);

  const imageData = ctx.getImageData(0, 0, w, h);
  const grayscale = new Uint8Array(w * h);
  const alpha = new Uint8Array(w * h);

  for (let i = 0; i < w * h; i++) {
    const r = imageData.data[i * 4];
    const g = imageData.data[i * 4 + 1];
    const b = imageData.data[i * 4 + 2];
    const a = imageData.data[i * 4 + 3];
    alpha[i] = a;
    // Compute luma for all pixels; transparent pixels are excluded at threshold time
    grayscale[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }

  return { grayscale, alpha, width: w, height: h, rawData: imageData };
}

// ─── Stencil cleanup: remove small opaque specks + fill small transparent holes ──────────
/**
 * Runs two passes on the canvas alpha channel in-place:
 *  1. Remove opaque connected components smaller than minSize (erase specks)
 *  2. Fill transparent connected components smaller than minSize that are fully
 *     surrounded by opaque pixels (fill holes/islands inside the stencil)
 *
 * Uses 4-connectivity BFS. Operates directly on the ImageData alpha channel.
 */
export function applyCleanup(canvas, minSize) {
  if (!minSize || minSize <= 0) return;

  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const imgData = ctx.getImageData(0, 0, w, h);
  const alpha = imgData.data; // stride 4, alpha at index [i*4+3]
  const total = w * h;
  const visited = new Uint8Array(total);

  // BFS returns { pixels: Int32Array of indices, touchesBorder: bool }
  const bfs = (start, isOpaque) => {
    const pixels = [];
    let touchesBorder = false;
    const queue = [start];
    visited[start] = 1;
    let head = 0;
    while (head < queue.length) {
      const idx = queue[head++];
      pixels.push(idx);
      const x = idx % w;
      const y = (idx / w) | 0;
      if (x === 0 || x === w - 1 || y === 0 || y === h - 1) touchesBorder = true;
      const neighbors = [idx - 1, idx + 1, idx - w, idx + w];
      for (const nb of neighbors) {
        if (nb < 0 || nb >= total) continue;
        const nx = nb % w;
        // prevent wrapping across left/right edge
        if (Math.abs(nx - x) > 1) continue;
        if (visited[nb]) continue;
        const nbOpaque = alpha[nb * 4 + 3] > 10;
        if (nbOpaque === isOpaque) {
          visited[nb] = 1;
          queue.push(nb);
        }
      }
    }
    return { pixels, touchesBorder };
  };

  // Pass 1: remove small opaque specks
  for (let i = 0; i < total; i++) {
    if (visited[i] || alpha[i * 4 + 3] <= 10) continue;
    const { pixels } = bfs(i, true);
    if (pixels.length < minSize) {
      for (const p of pixels) alpha[p * 4 + 3] = 0;
    }
  }

  // Reset visited for pass 2
  visited.fill(0);

  // Pass 2: fill small transparent holes that don't touch the border
  for (let i = 0; i < total; i++) {
    if (visited[i] || alpha[i * 4 + 3] > 10) continue;
    const { pixels, touchesBorder } = bfs(i, false);
    if (!touchesBorder && pixels.length < minSize) {
      for (const p of pixels) {
        alpha[p * 4 + 3] = 255;
        // colour the filled pixel black (stencil ink)
        alpha[p * 4] = 0;
        alpha[p * 4 + 1] = 0;
        alpha[p * 4 + 2] = 0;
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
}

// ─── Gaussian blur on grayscale array ───────────────────────────────────────

function gaussianBlur(src, width, height, radius) {
  if (radius < 1) return src;

  // Build 1-D kernel
  const sigma = radius / 2;
  const kSize = Math.ceil(radius) * 2 + 1;
  const kernel = new Float32Array(kSize);
  let kSum = 0;
  const half = Math.floor(kSize / 2);
  for (let i = 0; i < kSize; i++) {
    const x = i - half;
    kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
    kSum += kernel[i];
  }
  for (let i = 0; i < kSize; i++) kernel[i] /= kSum;

  const tmp = new Float32Array(width * height);
  const dst = new Uint8Array(width * height);

  // Horizontal pass
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = 0; k < kSize; k++) {
        const sx = Math.min(Math.max(x + k - half, 0), width - 1);
        acc += src[y * width + sx] * kernel[k];
      }
      tmp[y * width + x] = acc;
    }
  }

  // Vertical pass
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = 0; k < kSize; k++) {
        const sy = Math.min(Math.max(y + k - half, 0), height - 1);
        acc += tmp[sy * width + x] * kernel[k];
      }
      dst[y * width + x] = Math.round(acc);
    }
  }

  return dst;
}

// ─── REALISTIC: Banded tonal layers ─────────────────────────────────────────
//
// Mirrors the C++ Photoshop plugin logic:
//
//   1. Blur the grayscale with blurAmount (Gaussian)
//   2. Split the 0–255 luma range into N bands via N threshold values
//   3. Layer 0 (base/darkest): pixels where luma < T[0]            → opaque (ink)
//   4. Layer k (k≥1):         pixels where T[k-1] ≤ luma < T[k]   → opaque (ink)
//   5. All other pixels (including originally-transparent ones)     → transparent (cut)
//
// Stacking darkest→lightest reconstructs the full image.
// Thresholds are evenly distributed across 0–255.

/**
 * Compute N evenly-spaced thresholds across 0–255 for N layers.
 * Each threshold is the upper boundary for that layer's tone band.
 *   T[0] = 255/N * 1  (darkest band, base layer)
 *   ...
 *   T[N-1] = 255      (lightest band, topmost layer — captures all remaining tones up to white)
 */
export const REALISTIC_PRESETS = {
  2: [
    { limit: 90, color: "000000" },
    { limit: 90, color: "FFFFFF" },
  ],
  3: [
    { limit: 85, color: "000000" },
    { limit: 85, color: "7F7F7F" },
    { limit: 138, color: "FFFFFF" },
  ],
  4: [
    { limit: 60, color: "000000" },
    { limit: 60, color: "525252" },
    { limit: 100, color: "A0A0A0" },
    { limit: 150, color: "FFFFFF" },
  ],
  5: [
    { limit: 50, color: "000000" },
    { limit: 50, color: "434343" },
    { limit: 90, color: "7F7F7F" },
    { limit: 130, color: "B2B2B2" },
    { limit: 170, color: "FFFFFF" },
  ],
  6: [
    { limit: 40, color: "000000" },
    { limit: 40, color: "3D3D3D" },
    { limit: 70, color: "676767" },
    { limit: 100, color: "848484" },
    { limit: 130, color: "B2B2B2" },
    { limit: 160, color: "FFFFFF" },
  ],
  7: [
    { limit: 30, color: "000000" },
    { limit: 30, color: "313131" },
    { limit: 60, color: "585858" },
    { limit: 90, color: "7C7C7C" },
    { limit: 120, color: "B0B0B0" },
    { limit: 150, color: "CBCBCB" },
    { limit: 180, color: "FFFFFF" },
  ],
  8: [
    { limit: 30, color: "000000" },
    { limit: 30, color: "2B2B2B" },
    { limit: 50, color: "484848" },
    { limit: 75, color: "5F5F5F" },
    { limit: 100, color: "7C7C7C" },
    { limit: 130, color: "B0B0B0" },
    { limit: 160, color: "CBCBCB" },
    { limit: 190, color: "FFFFFF" },
  ],
  9: [
    { limit: 20, color: "000000" },
    { limit: 20, color: "202020" },
    { limit: 45, color: "505050" },
    { limit: 70, color: "646464" },
    { limit: 95, color: "818181" },
    { limit: 120, color: "A7A7A7" },
    { limit: 145, color: "C2C2C2" },
    { limit: 170, color: "D5D5D5" },
    { limit: 190, color: "FFFFFF" },
  ],
  10: [
    { limit: 15, color: "000000" },
    { limit: 15, color: "262626" },
    { limit: 45, color: "3F3F3F" },
    { limit: 70, color: "505050" },
    { limit: 95, color: "6C6C6C" },
    { limit: 120, color: "8B8B8B" },
    { limit: 145, color: "ABABAB" },
    { limit: 165, color: "C4C4C4" },
    { limit: 180, color: "DFDFDF" },
    { limit: 195, color: "FFFFFF" },
  ],
  11: [
    { limit: 20, color: "000000" },
    { limit: 20, color: "1D1D1D" },
    { limit: 40, color: "303030" },
    { limit: 60, color: "4A4A4A" },
    { limit: 80, color: "5B5B5B" },
    { limit: 100, color: "808080" },
    { limit: 120, color: "9E9E9E" },
    { limit: 140, color: "BABABA" },
    { limit: 160, color: "D0D0D0" },
    { limit: 180, color: "E3E3E3" },
    { limit: 200, color: "FFFFFF" },
  ],
  12: [
    { limit: 10, color: "000000" },
    { limit: 10, color: "1B1B1B" },
    { limit: 20, color: "313131" },
    { limit: 40, color: "3E3E3E" },
    { limit: 60, color: "5A5A5A" },
    { limit: 80, color: "676767" },
    { limit: 100, color: "7C7C7C" },
    { limit: 120, color: "9E9E9E" },
    { limit: 140, color: "BABABA" },
    { limit: 160, color: "D0D0D0" },
    { limit: 180, color: "E3E3E3" },
    { limit: 200, color: "FFFFFF" },
  ],
};

export function defaultRealisticThresholds(numLayers) {
  if (REALISTIC_PRESETS[numLayers]) {
    return REALISTIC_PRESETS[numLayers].map(p => p.limit);
  }
  const thresholds = [];
  for (let i = 1; i < numLayers; i++) {
    thresholds.push(Math.round((255 / numLayers) * i));
  }
  thresholds.push(255);
  return thresholds;
}

export function getPresetColors(numLayers) {
  if (REALISTIC_PRESETS[numLayers]) {
    return REALISTIC_PRESETS[numLayers].map(p => `#${p.color}`);
  }
  return Array(numLayers).fill('#333');
}

/**
 * Generate realistic tonal layers, matching the C++ plugin logic.
 *
 * Each layer is a binary mask (black=ink, transparent=cut) for one tone band:
 *   Layer 0 (base):  luma ∈ [0,   T[0])
 *   Layer k (k≥1):  luma ∈ [T[k-1], T[k])
 *
 * Transparent source pixels are always excluded (they are "no material").
 *
 * @param {Uint8Array} grayscale - per-pixel luma values
 * @param {number} width
 * @param {number} height
 * @param {number} numLayers
 * @param {number[]|null} thresholds - N upper-boundary values; auto-computed if null
 * @param {boolean} bridgeIslands
 * @param {number} bridgeWidth
 * @param {number} blurRadius
 * @param {boolean} cornerMarkers
 * @param {Uint8Array|null} alpha - source alpha channel (to exclude transparent pixels)
 * @param {number} minIslandSize
 * @param {boolean} colorize
 * @param {ImageData|null} rawData
 * @param {Object} markerOptions - Corner marker customization options
 * @param {boolean} debugBridges - Enable bridge debug visualisation
 */
export function generateRealisticLayers(
  grayscale, width, height, numLayers,
  thresholds = null, bridgeIslands = false, bridgeWidth = 2,
  blurRadius = 0, cornerMarkers = false, alpha = null, minIslandSize = 0,
  colorize = false, rawData = null,
  markerOptions = { armLength: 14, armWidth: 3, margin: 24, color: 'black' },
  debugBridges = false, cleanupSize = 0
) {
  const blurred = blurRadius > 0 ? gaussianBlur(grayscale, width, height, blurRadius) : grayscale;
  const thr = (thresholds && thresholds.length === numLayers)
    ? thresholds
    : defaultRealisticThresholds(numLayers);

  const layers = [];

  for (let layer = 0; layer < numLayers; layer++) {
    // Band boundaries
    const lowerT = layer === 0 ? 0 : thr[layer - 1];
    const upperT = thr[layer];

    // Compute average color for this band if colorize is on
    let avgR = 0, avgG = 0, avgB = 0;
    if (colorize && rawData) {
      let sumR = 0, sumG = 0, sumB = 0, count = 0;
      for (let i = 0; i < width * height; i++) {
        const luma = blurred[i];
        const srcAlpha = alpha ? alpha[i] : 255;
        const inBand = srcAlpha >= 10 && luma >= lowerT && luma < upperT;
        if (inBand) {
          sumR += rawData.data[i * 4];
          sumG += rawData.data[i * 4 + 1];
          sumB += rawData.data[i * 4 + 2];
          count++;
        }
      }
      if (count > 0) {
        avgR = Math.round(sumR / count);
        avgG = Math.round(sumG / count);
        avgB = Math.round(sumB / count);
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(width, height);

    for (let i = 0; i < width * height; i++) {
      const luma = blurred[i];
      const srcAlpha = alpha ? alpha[i] : 255;
      // Layer 0 (base): exclusive band [lowerT, upperT)
      // Layers 1+: cumulative — all tones BELOW upperT (so each layer stacks on top of darker ones)
      const inLayer = srcAlpha >= 10 && (
        layer === 0 ? (luma >= lowerT && luma < upperT) : luma < upperT
      );

      // Color: use flat average color per band if colorize mode is on, otherwise black
      if (colorize && rawData) {
        imageData.data[i * 4]     = avgR;
        imageData.data[i * 4 + 1] = avgG;
        imageData.data[i * 4 + 2] = avgB;
      } else {
        imageData.data[i * 4]     = 0;
        imageData.data[i * 4 + 1] = 0;
        imageData.data[i * 4 + 2] = 0;
      }
      // Layer 0 (black): opaque where inLayer is true
      // Layers 1+: invert — opaque where inLayer is FALSE
      // Preserve original transparency: AND with srcAlpha
      const layerAlpha = layer === 0 ? (inLayer ? 255 : 0) : (inLayer ? 0 : 255);
      imageData.data[i * 4 + 3] = (layerAlpha > 0 && srcAlpha >= 10) ? layerAlpha : 0;
    }

    ctx.putImageData(imageData, 0, 0);

    // Cleanup: remove specks and fill small holes
    if (cleanupSize > 0) applyCleanup(canvas, cleanupSize);

    // Keep a clean (bridge-free) copy for use during merge operations
    const cleanCanvas = document.createElement('canvas');
    cleanCanvas.width = width;
    cleanCanvas.height = height;
    cleanCanvas.getContext('2d').drawImage(canvas, 0, 0);

    if (bridgeIslands) {
      // upperLayerCanvases = canvases already generated for darker layers (index < layer)
      const upperCanvases = layers.map(l => l.canvas);
      const upperMasks = buildUpperLayerMasks(upperCanvases);
      applySmartBridges(canvas, bridgeWidth, upperMasks, { minIslandSize, debug: debugBridges });
    }

    const lowerPct = Math.round((lowerT / 255) * 100);
    const upperPct = Math.round((upperT / 255) * 100);
    const isBase = layer === 0;
    const isTop = layer === numLayers - 1;

    layers.push({
      id: layer,
      name: isBase ? 'Layer 1 (Black)' : isTop ? `Layer ${layer + 1} (White)` : `Layer ${layer + 1}`,
      canvas,
      cleanCanvas,
      dataUrl: canvas.toDataURL('image/png'),
      description: isBase ? `Darkest (0–${upperPct}%)` : `Tones ${lowerPct}–${upperPct}%`,
      lowerThreshold: lowerT,
      upperThreshold: upperT,
      visible: true,
      mode: 'realistic',
      alpha: alpha || null,
      colorized: colorize,
      addCornerMarkers: cornerMarkers,
      markerOptions,
    });
  }

  return layers;
}

// ─── CARTOON: K-means color quantization ────────────────────────────────────

function colorDistSq(r1, g1, b1, r2, g2, b2) {
  return (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2;
}

/**
 * Estimates a good number of distinct colors for cartoon mode by
 * sampling pixel colors and counting perceptually distinct groups.
 * Returns a value clamped between 2 and 10.
 */
export function estimateColorCount(rawData, whiteTolerance = 15) {
  const total = rawData.data.length / 4;
  const step = Math.max(1, Math.floor(total / 5000));
  const threshold = 50 * 50 * 3; // perceptual distance squared
  const representatives = [];

  for (let i = 0; i < total; i += step) {
    const a = rawData.data[i * 4 + 3];
    if (a < 10) continue;
    const r = rawData.data[i * 4];
    const g = rawData.data[i * 4 + 1];
    const b = rawData.data[i * 4 + 2];
    if (r > 255 - whiteTolerance && g > 255 - whiteTolerance && b > 255 - whiteTolerance) continue;

    let found = false;
    for (const rep of representatives) {
      if (colorDistSq(r, g, b, rep[0], rep[1], rep[2]) < threshold) { found = true; break; }
    }
    if (!found) representatives.push([r, g, b]);
    if (representatives.length >= 20) break;
  }

  return Math.min(20, Math.max(2, representatives.length));
}

function kMeansPlusPlus(samples, k) {
  // samples: Float32Array of [r,g,b, r,g,b, ...]
  const n = samples.length / 3;
  const centroids = [];
  const dists = new Float32Array(n).fill(Infinity);

  // Pick first centroid randomly
  let idx = Math.floor(Math.random() * n);
  centroids.push([samples[idx * 3], samples[idx * 3 + 1], samples[idx * 3 + 2]]);

  for (let c = 1; c < k; c++) {
    // Update distances
    const [cr, cg, cb] = centroids[centroids.length - 1];
    let total = 0;
    for (let i = 0; i < n; i++) {
      const d = colorDistSq(samples[i * 3], samples[i * 3 + 1], samples[i * 3 + 2], cr, cg, cb);
      if (d < dists[i]) dists[i] = d;
      total += dists[i];
    }

    // Weighted random selection
    let r = Math.random() * total;
    for (let i = 0; i < n; i++) {
      r -= dists[i];
      if (r <= 0) {
        centroids.push([samples[i * 3], samples[i * 3 + 1], samples[i * 3 + 2]]);
        break;
      }
    }
    if (centroids.length <= c) {
      centroids.push([samples[Math.floor(Math.random() * n) * 3],
                      samples[Math.floor(Math.random() * n) * 3 + 1],
                      samples[Math.floor(Math.random() * n) * 3 + 2]]);
    }
  }
  return centroids;
}

export function kMeansQuantize(rawData, width, height, k, maxIter = 12) {
  // Collect opaque pixel samples (subsample if huge)
  const total = width * height;
  const maxSamples = 80000;
  const step = Math.max(1, Math.floor(total / maxSamples));

  const sampleList = [];
  for (let i = 0; i < total; i += step) {
    const alpha = rawData.data[i * 4 + 3];
    if (alpha < 10) continue;
    const r = rawData.data[i * 4];
    const g = rawData.data[i * 4 + 1];
    const b = rawData.data[i * 4 + 2];
    sampleList.push(r, g, b);
  }

  const samples = new Float32Array(sampleList);
  const n = samples.length / 3;
  if (n === 0) return null;

  // Init centroids via K-means++
  let centroids = kMeansPlusPlus(samples, k);
  const assignments = new Int32Array(n);

  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;

    // Assign
    for (let i = 0; i < n; i++) {
      let bestDist = Infinity, best = 0;
      for (let c = 0; c < k; c++) {
        const d = colorDistSq(samples[i * 3], samples[i * 3 + 1], samples[i * 3 + 2],
                              centroids[c][0], centroids[c][1], centroids[c][2]);
        if (d < bestDist) { bestDist = d; best = c; }
      }
      if (assignments[i] !== best) { assignments[i] = best; changed = true; }
    }

    if (!changed) break;

    // Update centroids
    const sumR = new Float64Array(k);
    const sumG = new Float64Array(k);
    const sumB = new Float64Array(k);
    const counts = new Int32Array(k);

    for (let i = 0; i < n; i++) {
      const c = assignments[i];
      sumR[c] += samples[i * 3];
      sumG[c] += samples[i * 3 + 1];
      sumB[c] += samples[i * 3 + 2];
      counts[c]++;
    }

    for (let c = 0; c < k; c++) {
      if (counts[c] > 0) {
        centroids[c] = [sumR[c] / counts[c], sumG[c] / counts[c], sumB[c] / counts[c]];
      }
    }
  }

  return centroids.map(c => [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])]);
}

/**
 * Flood-fill from the image border to identify background pixels
 * (near-white pixels reachable from the edges). Returns a boolean mask.
 */
function buildBackgroundMask(rawData, width, height, whiteTolerance) {
  const total = width * height;
  const isNearWhite = new Uint8Array(total);
  const threshold = 255 - whiteTolerance;

  for (let i = 0; i < total; i++) {
    const a = rawData.data[i * 4 + 3];
    const r = rawData.data[i * 4];
    const g = rawData.data[i * 4 + 1];
    const b = rawData.data[i * 4 + 2];
    if (a >= 10 && r >= threshold && g >= threshold && b >= threshold) {
      isNearWhite[i] = 1;
    }
  }

  // BFS from all border pixels that are near-white
  const isBackground = new Uint8Array(total);
  const queue = [];

  const enqueue = (idx) => {
    if (isNearWhite[idx] && !isBackground[idx]) {
      isBackground[idx] = 1;
      queue.push(idx);
    }
  };

  for (let x = 0; x < width; x++) {
    enqueue(x);                          // top row
    enqueue((height - 1) * width + x);  // bottom row
  }
  for (let y = 0; y < height; y++) {
    enqueue(y * width);                  // left col
    enqueue(y * width + width - 1);     // right col
  }

  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++];
    const x = idx % width;
    const y = Math.floor(idx / width);
    if (x > 0)          enqueue(idx - 1);
    if (x < width - 1)  enqueue(idx + 1);
    if (y > 0)          enqueue(idx - width);
    if (y < height - 1) enqueue(idx + width);
  }

  return isBackground;
}

/**
 * Morphological dilation — grows opaque regions outward by `radius` pixels.
 * Used to add bleed to cartoon color layers so there are no gaps when painted.
 */
function dilateCanvas(canvas, radius) {
  if (!radius || radius <= 0) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const src = ctx.getImageData(0, 0, w, h);
  const dst = ctx.createImageData(w, h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      // If already opaque, keep as-is
      if (src.data[i * 4 + 3] > 128) {
        dst.data[i * 4]     = src.data[i * 4];
        dst.data[i * 4 + 1] = src.data[i * 4 + 1];
        dst.data[i * 4 + 2] = src.data[i * 4 + 2];
        dst.data[i * 4 + 3] = 255;
        continue;
      }
      // Check if any pixel within radius is opaque
      let found = false;
      outer: for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy > radius * radius) continue; // circular
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          const ni = ny * w + nx;
          if (src.data[ni * 4 + 3] > 128) { found = true; break outer; }
        }
      }
      if (found) {
        dst.data[i * 4]     = 0;
        dst.data[i * 4 + 1] = 0;
        dst.data[i * 4 + 2] = 0;
        dst.data[i * 4 + 3] = 255;
      }
    }
  }
  ctx.putImageData(dst, 0, 0);
}

export function generateCartoonLayers(rawData, width, height, numColors, whiteTolerance = 15, bridgeIslands = false, bridgeWidth = 2, cornerMarkers = false, markerOptions = { armLength: 14, armWidth: 3, margin: 24, color: 'black' }, minIslandSize = 200, bleedRadius = 1) {
  // Get palette via K-means
  const palette = kMeansQuantize(rawData, width, height, numColors);
  if (!palette) return [];

  // Build background mask — only removes whites reachable from image border
  const backgroundMask = whiteTolerance > 0
    ? buildBackgroundMask(rawData, width, height, whiteTolerance)
    : null;

  const layers = palette.map((color, idx) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(width, height);

    for (let i = 0; i < width * height; i++) {
      const alpha = rawData.data[i * 4 + 3];
      if (alpha < 10) {
        imageData.data[i * 4 + 3] = 0;
        continue;
      }

      // Only skip pixels that are background (border-reachable near-white)
      if (backgroundMask && backgroundMask[i]) {
        imageData.data[i * 4 + 3] = 0;
        continue;
      }

      const r = rawData.data[i * 4];
      const g = rawData.data[i * 4 + 1];
      const b = rawData.data[i * 4 + 2];

      // Find nearest palette color
      let bestDist = Infinity, bestIdx = 0;
      for (let c = 0; c < palette.length; c++) {
        const d = colorDistSq(r, g, b, palette[c][0], palette[c][1], palette[c][2]);
        if (d < bestDist) { bestDist = d; bestIdx = c; }
      }

      const inLayer = bestIdx === idx;
      imageData.data[i * 4] = 0;
      imageData.data[i * 4 + 1] = 0;
      imageData.data[i * 4 + 2] = 0;
      imageData.data[i * 4 + 3] = inLayer ? 255 : 0;
    }

    ctx.putImageData(imageData, 0, 0);

    const [pr, pg, pb] = color;
    const hex = '#' + [pr, pg, pb].map(v => v.toString(16).padStart(2, '0')).join('');
    const luminance = (0.299 * pr + 0.587 * pg + 0.114 * pb) / 255;

    return {
      id: idx,
      name: `Color ${idx + 1}`,
      canvas,
      dataUrl: canvas.toDataURL('image/png'),
      description: hex.toUpperCase(),
      paletteColor: hex,
      luminance,
      visible: true,
      mode: 'cartoon',
    };
  });

      // Sort by luminance (darkest first, like paint order)
  const sorted = layers.sort((a, b) => a.luminance - b.luminance);

  // Apply bleed (dilation) to all color layers except the darkest (outline/black) layer
  sorted.forEach((layer, layerIndex) => {
    if (layerIndex > 0 && bleedRadius > 0) {
      dilateCanvas(layer.canvas, bleedRadius);
      layer.dataUrl = layer.canvas.toDataURL('image/png');
    }
  });

  // Apply smart bridging per cartoon layer
  sorted.forEach((layer, layerIndex) => {
    if (bridgeIslands) {
      // Upper layers = all layers with higher luminance (already sorted darker→lighter)
      const upperCanvases = sorted.slice(layerIndex + 1).map(l => l.canvas);
      const upperMasks = buildUpperLayerMasks(upperCanvases);

      // Darkest layer (index 0) = black outline: needs 3 bridges at opposing sides
      const isOutlineLayer = layerIndex === 0;
      applySmartBridges(layer.canvas, bridgeWidth, upperMasks, {
        bridgesPerIsland: isOutlineLayer ? 3 : 1,
        candidatesPerSector: 8,
        minIslandSize,
        mainlandOnly: true,    // cartoon: no island-to-island chaining
        opposingPairs: isOutlineLayer, // outline layer: pair bridges at opposing sides
      });
      layer.dataUrl = layer.canvas.toDataURL('image/png');
    }
    layer.addCornerMarkers = cornerMarkers;
    layer.markerOptions = markerOptions;
  });

  return sorted;
}

// ─── SVG Export: Scanline run-length path encoding + corner markers ─────────
// Corner markers are crosshairs drawn OUTSIDE the image area in a margin,
// so they appear on the stencil sheet for physical alignment when cutting/painting.

export function canvasToSVG(canvas, fillColor = 'black', options = {}) {
  const {
    cornerMarkers = true,
    markerMargin = 20,
    markerSize = 12,
    markerThickness = 2,
    markerColor = 'black',
  } = options;

  const w = canvas.width;
  const h = canvas.height;

  const ctx = canvas.getContext('2d');
  const src = ctx.getImageData(0, 0, w, h);

  // Build clean black/white image for ImageTracer
  const clean = new ImageData(w, h);

  for (let i = 0; i < w * h; i++) {
    const a = src.data[i * 4 + 3];
    const v = a > 10 ? 0 : 255;
    clean.data[i * 4] = v;
    clean.data[i * 4 + 1] = v;
    clean.data[i * 4 + 2] = v;
    clean.data[i * 4 + 3] = 255;
  }

  let svgString = ImageTracer.imagedataToSVG(clean, {
    ltres: 0.1,
    qtres: 0.1,
    pathomit: 0.1,
    colorsampling: 0,
    numberofcolors: 2,
    mincolorratio: 0,
    colorquantcycles: 1,
    scale: 1,
    strokewidth: 0,
    linefilter: false,
    roundcoords: 2,
    viewbox: true,
    desc: false,
    lcpr: 0,
    qcpr: 0,
    blurradius: 0,
    blurdelta: 0,
  });

  // ImageTracer may produce "rgb(0,0,0)" or "rgb(0, 0, 0)" — handle both
  svgString = svgString
    .replace(/<path[^>]*fill="rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)"[^>]*\/?>/g, '')
    .replace(/fill="rgb\(\s*0\s*,\s*0\s*,\s*0\s*\)"/g, `fill="${fillColor}"`);

  if (cornerMarkers) {
    // Match burnCornerMarkers exactly:
    // - Expand the SVG canvas by markerMargin on all sides (image content offset by margin)
    // - Place crosshair centres at (margin/2, margin/2) in each corner of the expanded area
    const totalW = w + markerMargin * 2;
    const totalH = h + markerMargin * 2;

    // Shift the viewBox and image paths by expanding the SVG dimensions and translating content
    svgString = svgString
      .replace(/viewBox="[^"]*"/, `viewBox="0 0 ${totalW} ${totalH}"`)
      .replace(/(<svg[^>]*width=")[^"]*(")/,  `$1${totalW}$2`)
      .replace(/(<svg[^>]*height=")[^"]*(")/,  `$1${totalH}$2`);

    // Wrap all existing content in a group translated by margin so image sits in centre
    svgString = svgString.replace(
      /(<svg[^>]*>)/,
      `$1<rect width="${totalW}" height="${totalH}" fill="white"/><g transform="translate(${markerMargin},${markerMargin})">`
    );
    svgString = svgString.replace('</svg>', `</g></svg>`);

    // Draw crosshairs in the margin at each corner — matching burnCornerMarkers positions exactly
    const cx = markerMargin / 2;
    const cy = markerMargin / 2;
    const corners = [
      { cx, cy },
      { cx: totalW - cx, cy },
      { cx, cy: totalH - cy },
      { cx: totalW - cx, cy: totalH - cy },
    ];

    const markersSVG = `<g id="corner-markers">${
      corners.map(({ cx, cy }) => `
        <line x1="${cx - markerSize}" y1="${cy}" x2="${cx + markerSize}" y2="${cy}" stroke="${markerColor}" stroke-width="${markerThickness}" stroke-linecap="round"/>
        <line x1="${cx}" y1="${cy - markerSize}" x2="${cx}" y2="${cy + markerSize}" stroke="${markerColor}" stroke-width="${markerThickness}" stroke-linecap="round"/>
      `).join('')
    }</g>`;

    svgString = svgString.replace('</svg>', `${markersSVG}</svg>`);
  } else {
    // No markers — just add white background
    svgString = svgString.replace(
      /(<svg[^>]*>)/,
      `$1<rect width="${w}" height="${h}" fill="white"/>`
    );
  }

  return svgString;
}

// ─── Composite preview ───────────────────────────────────────────────────────

export function generateComposite(layers, width, height, mode, customColors = null, addCornerMarkers = false, colorizeRealistic = false) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  if (mode === 'cartoon') {
    // Cartoon preserves transparency like realistic mode (shows checkerboard in preview)

    // Draw each cartoon layer with its palette color
    layers.forEach((layer) => {
      if (!layer.visible) return;

      const tmp = document.createElement('canvas');
      tmp.width = width;
      tmp.height = height;
      const tCtx = tmp.getContext('2d');
      tCtx.drawImage(layer.canvas, 0, 0);

      const imgData = tCtx.getImageData(0, 0, width, height);
      const { r, g, b } = hexToRgb(layer.paletteColor);
      for (let i = 0; i < width * height; i++) {
        if (imgData.data[i * 4 + 3] > 0) {
          imgData.data[i * 4] = r;
          imgData.data[i * 4 + 1] = g;
          imgData.data[i * 4 + 2] = b;
        }
      }
      tCtx.putImageData(imgData, 0, 0);
      ctx.drawImage(tmp, 0, 0);
    });
  } else {
    // Realistic composite: transparent background to preserve original image transparency.
    // Layers array is ordered darkest(0) → lightest(N-1), so draw forward.
    const visibleLayers = layers.filter(l => l.visible);

    if (colorizeRealistic) {
      // Canvas pixels already carry the original image color — draw directly
      visibleLayers.forEach((layer) => {
        ctx.drawImage(layer.canvas, 0, 0);
      });
    } else {
      const colors = customColors || getRealisticLayerColors(layers.length);
      visibleLayers.forEach((layer) => {
        const tmp = document.createElement('canvas');
        tmp.width = width;
        tmp.height = height;
        const tCtx = tmp.getContext('2d');
        tCtx.drawImage(layer.canvas, 0, 0);

        const imgData = tCtx.getImageData(0, 0, width, height);
        const { r, g, b } = hexToRgb(colors[layer.id % colors.length]);
        for (let i = 0; i < width * height; i++) {
          if (imgData.data[i * 4 + 3] > 128) {
            imgData.data[i * 4]     = r;
            imgData.data[i * 4 + 1] = g;
            imgData.data[i * 4 + 2] = b;
            imgData.data[i * 4 + 3] = 255;
          }
        }
        tCtx.putImageData(imgData, 0, 0);
        ctx.globalAlpha = 1;
        ctx.drawImage(tmp, 0, 0);
      });
    }
  }

  // Note: We're NOT adding corner markers to the main composite preview
  // This keeps the preview clean while individual layers show markers

  return canvas.toDataURL('image/png');
}

// ─── Color helpers ───────────────────────────────────────────────────────────

export function getRealisticLayerColors(count) {
  // Dark to light gradient palette for cake stacking
  const palette = [
    '#0f0f0f', '#2a1f3d', '#4a3560', '#6b5080',
    '#9b7fa8', '#c4aed0', '#ddd0e8', '#f0eaf6',
  ];
  return palette.slice(0, Math.max(count, 1));
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
    : { r: 0, g: 0, b: 0 };
}

// ─── Download helpers ────────────────────────────────────────────────────────

export function downloadSVG(svgString, filename) {
  const blob = new Blob([svgString], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadPNG(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ─── High Quality PNG Export (SVG-based) ────────────────────────────────────
async function downloadHighQualityPNG(
  canvas,
  filename,
  fillColor = '#000000',
  scale = 4,
  options = {}
) {
  const {
    cornerMarkers = false,
    markerMargin = 20,
    markerSize = 12,
    markerThickness = 2,
    markerColor = 'red'
  } = options;

  // Generate SVG from canvas
  const svgString = canvasToSVG(canvas, fillColor, {
    cornerMarkers: cornerMarkers,
    markerMargin: markerMargin,
    markerSize: markerSize,
    markerThickness: markerThickness,
    markerColor: markerColor
  });

  const svgBlob = new Blob([svgString], {
    type: 'image/svg+xml;charset=utf-8',
  });

  const url = URL.createObjectURL(svgBlob);

  const img = new Image();

  return new Promise((resolve, reject) => {
    img.onload = () => {
      const exportCanvas = document.createElement('canvas');

      exportCanvas.width = canvas.width * scale;
      exportCanvas.height = canvas.height * scale;

      const ctx = exportCanvas.getContext('2d');

      // High-quality scaling settings
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      // Optional: Add white background for better color rendering
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

      ctx.drawImage(
        img,
        0,
        0,
        exportCanvas.width,
        exportCanvas.height
      );

      URL.revokeObjectURL(url);

      // Use maximum PNG quality
      exportCanvas.toBlob(
        (blob) => {
          const a = document.createElement('a');
          const blobUrl = URL.createObjectURL(blob);
          a.href = blobUrl;
          a.download = filename;

          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);

          URL.revokeObjectURL(blobUrl);
          resolve();
        },
        'image/png',
        1.0 // Maximum quality
      );
    };

    img.onerror = (error) => {
      URL.revokeObjectURL(url);
      reject(error);
    };

    img.src = url;
  });
}