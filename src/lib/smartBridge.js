/**
 * Visibility Aware Smart Bridging for StencilForge
 *
 * Goals:
 *  - 3 bridges per island, ~120° apart (angular sector selection)
 *  - Prioritise bridges hidden by upper stencil layers
 *  - Score-based candidate ranking: coverage * 10000 - length - penalties
 *  - Tiered coverage thresholds: 0.90 → 0.80 → 0.70 → 0.60 → 0.0
 *  - Spatial hash for fast nearest-point lookups
 *  - Debug mode: blue=candidates, green=selected
 */

// ─── Spatial Hash ──────────────────────────────────────────────────────────

class SpatialHash {
  constructor(cellSize) {
    this.cellSize = cellSize;
    this.cells = new Map();
  }

  _key(x, y) {
    return `${Math.floor(x / this.cellSize)},${Math.floor(y / this.cellSize)}`;
  }

  insert(x, y, data) {
    const k = this._key(x, y);
    if (!this.cells.has(k)) this.cells.set(k, []);
    this.cells.get(k).push({ x, y, data });
  }

  queryRadius(qx, qy, r) {
    const cr = Math.ceil(r / this.cellSize);
    const cx0 = Math.floor(qx / this.cellSize) - cr;
    const cy0 = Math.floor(qy / this.cellSize) - cr;
    const cx1 = Math.floor(qx / this.cellSize) + cr;
    const cy1 = Math.floor(qy / this.cellSize) + cr;
    const r2 = r * r;
    const results = [];
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const pts = this.cells.get(`${cx},${cy}`);
        if (!pts) continue;
        for (const p of pts) {
          const dx = p.x - qx, dy = p.y - qy;
          if (dx * dx + dy * dy <= r2) results.push(p);
        }
      }
    }
    return results;
  }

  nearest(qx, qy) {
    // Expand search radius until we find something
    for (let r = this.cellSize; r < 100000; r *= 2) {
      const candidates = this.queryRadius(qx, qy, r);
      if (candidates.length === 0) continue;
      let best = null, bestD2 = Infinity;
      for (const c of candidates) {
        const d2 = (c.x - qx) ** 2 + (c.y - qy) ** 2;
        if (d2 < bestD2) { bestD2 = d2; best = c; }
      }
      return best;
    }
    return null;
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function centroid(pixels, width) {
  let sx = 0, sy = 0;
  for (const idx of pixels) {
    sx += idx % width;
    sy += Math.floor(idx / width);
  }
  return { x: sx / pixels.length, y: sy / pixels.length };
}

function sampleArray(arr, maxSamples) {
  if (arr.length <= maxSamples) return arr;
  const step = arr.length / maxSamples;
  const out = [];
  for (let i = 0; i < maxSamples; i++) out.push(arr[Math.floor(i * step)]);
  return out;
}

/** Bresenham pixel walk, returns array of [x,y] pairs */
function bresenhamPixels(x1, y1, x2, y2) {
  const pts = [];
  let dx = Math.abs(x2 - x1), dy = Math.abs(y2 - y1);
  const sx = x1 < x2 ? 1 : -1, sy = y1 < y2 ? 1 : -1;
  let err = dx - dy, cx = x1, cy = y1;
  while (true) {
    pts.push([cx, cy]);
    if (cx === x2 && cy === y2) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; cx += sx; }
    if (e2 < dx)  { err += dx; cy += sy; }
  }
  return pts;
}

/**
 * Compute fraction of bridge pixels covered by at least one upper-layer mask.
 * upperMasks: array of Uint8Array (1=opaque, 0=transparent), same size as current layer.
 */
function bridgeCoverage(x1, y1, x2, y2, upperMasks, width, height) {
  if (!upperMasks || upperMasks.length === 0) return 0;
  const pts = bresenhamPixels(x1, y1, x2, y2);
  if (pts.length === 0) return 0;
  let covered = 0;
  for (const [px, py] of pts) {
    if (px < 0 || py < 0 || px >= width || py >= height) continue;
    const idx = py * width + px;
    for (const m of upperMasks) {
      if (m[idx]) { covered++; break; }
    }
  }
  return covered / pts.length;
}

/** Segment-segment intersection test (endpoints exclusive) */
function segmentsIntersect(ax1, ay1, ax2, ay2, bx1, by1, bx2, by2) {
  const cross = (ux, uy, vx, vy) => ux * vy - uy * vx;
  const dx1 = ax2 - ax1, dy1 = ay2 - ay1;
  const dx2 = bx2 - bx1, dy2 = by2 - by1;
  const denom = cross(dx1, dy1, dx2, dy2);
  if (Math.abs(denom) < 1e-10) return false;
  const t = cross(bx1 - ax1, by1 - ay1, dx2, dy2) / denom;
  const u = cross(bx1 - ax1, by1 - ay1, dx1, dy1) / denom;
  return t > 0.01 && t < 0.99 && u > 0.01 && u < 0.99;
}

/** Erase a bridge on the pixel data */
function eraseBridgeOnData(output, x1, y1, x2, y2, width, height, bridgeWidth) {
  const pts = bresenhamPixels(x1, y1, x2, y2);
  const half = Math.floor(bridgeWidth / 2);
  for (const [cx, cy] of pts) {
    for (let bx = -half; bx <= half; bx++) {
      for (let by = -half; by <= half; by++) {
        const px = cx + bx, py = cy + by;
        if (px < 0 || py < 0 || px >= width || py >= height) continue;
        output[(py * width + px) * 4 + 3] = 0;
      }
    }
  }
}

/** Draw a coloured debug line (doesn't erase) */
function drawDebugLine(output, x1, y1, x2, y2, width, height, r, g, b, lineWidth = 2) {
  const pts = bresenhamPixels(x1, y1, x2, y2);
  const half = Math.floor(lineWidth / 2);
  for (const [cx, cy] of pts) {
    for (let bx = -half; bx <= half; bx++) {
      for (let by = -half; by <= half; by++) {
        const px = cx + bx, py = cy + by;
        if (px < 0 || py < 0 || px >= width || py >= height) continue;
        const i = (py * width + px) * 4;
        output[i] = r; output[i + 1] = g; output[i + 2] = b; output[i + 3] = 255;
      }
    }
  }
}

// ─── Pre-compute upper-layer masks ─────────────────────────────────────────

/**
 * Convert an array of canvases (upper stencil layers) to binary Uint8Arrays.
 * 1 = opaque (covered), 0 = transparent (visible cut area).
 */
export function buildUpperLayerMasks(upperCanvases) {
  return upperCanvases.map(canvas => {
    const ctx = canvas.getContext('2d');
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const mask = new Uint8Array(canvas.width * canvas.height);
    for (let i = 0; i < mask.length; i++) {
      mask[i] = data[i * 4 + 3] > 128 ? 1 : 0;
    }
    return mask;
  });
}

// ─── Core smart bridge algorithm ───────────────────────────────────────────

/**
 * Apply Visibility Aware Smart Bridging to a canvas in-place.
 *
 * @param {HTMLCanvasElement} canvas         - layer canvas to modify
 * @param {number}            bridgeWidth    - pixel thickness of bridges
 * @param {Uint8Array[]}      upperMasks     - pre-computed masks from buildUpperLayerMasks()
 * @param {Object}            opts
 * @param {boolean}           opts.debug     - draw debug visualisation
 * @param {number}            opts.bridgesPerIsland - default 3
 * @param {number}            opts.candidatesPerSector - perimeter sample count per sector
 * @param {number}            opts.minIslandSize
 * @param {boolean}           opts.mainlandOnly - cartoon mode: skip island-to-island, always bridge direct to mainland
 * @param {boolean}           opts.opposingPairs - place bridges in opposing pairs (~180° apart) for extra stability
 * @returns {{ islandCount, bridgesCreated, averageCoverage, averageBridgeLength, hiddenBridgePercentage }}
 */
export function applySmartBridges(canvas, bridgeWidth = 2, upperMasks = [], opts = {}) {
  const {
    debug = false,
    bridgesPerIsland = 3,
    candidatesPerSector = 20,
    minIslandSize = 0,
    mainlandOnly = false,
    opposingPairs = false,
  } = opts;

  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const imageData = ctx.getImageData(0, 0, w, h);
  const output = new Uint8ClampedArray(imageData.data);
  const n = w * h;

  const isOpaque = (idx) => output[idx * 4 + 3] > 128;

  // ── 1. BFS to find transparent components ────────────────────────────────
  const compId = new Int32Array(n).fill(-1);
  const components = [];

  for (let i = 0; i < n; i++) {
    if (isOpaque(i) || compId[i] !== -1) continue;
    const comp = { pixels: [] };
    const q = [i];
    compId[i] = components.length;
    const cid = components.length;
    let head = 0;
    while (head < q.length) {
      const idx = q[head++];
      comp.pixels.push(idx);
      const x = idx % w, y = Math.floor(idx / w);
      const tryAdd = (nidx) => {
        if (nidx >= 0 && nidx < n && !isOpaque(nidx) && compId[nidx] === -1) {
          compId[nidx] = cid; q.push(nidx);
        }
      };
      if (x > 0)      tryAdd(idx - 1);
      if (x < w - 1)  tryAdd(idx + 1);
      if (y > 0)      tryAdd(idx - w);
      if (y < h - 1)  tryAdd(idx + w);
    }
    components.push(comp);
  }

  if (components.length <= 1) {
    ctx.putImageData(new ImageData(output, w, h), 0, 0);
    return { islandCount: 0, bridgesCreated: 0, averageCoverage: 0, averageBridgeLength: 0, hiddenBridgePercentage: 0 };
  }

  // Mainland = largest transparent component
  let mainlandIdx = 0;
  for (let i = 1; i < components.length; i++) {
    if (components[i].pixels.length > components[mainlandIdx].pixels.length) mainlandIdx = i;
  }

  // ── 2. Build boundary lists and spatial hash for mainland ─────────────────
  function getBoundaryPixels(comp) {
    const b = [];
    for (const idx of comp.pixels) {
      const x = idx % w, y = Math.floor(idx / w);
      if ((x > 0      && isOpaque(idx - 1)) ||
          (x < w - 1  && isOpaque(idx + 1)) ||
          (y > 0      && isOpaque(idx - w))  ||
          (y < h - 1  && isOpaque(idx + w))) {
        b.push(idx);
      }
    }
    return b;
  }

  // Spatial hash for mainland boundary (cell size ~32px for large images)
  const cellSize = Math.max(16, Math.floor(Math.max(w, h) / 256));
  const mainlandHash = new SpatialHash(cellSize);
  const mainlandBoundary = getBoundaryPixels(components[mainlandIdx]);
  const mainlandSampled = sampleArray(mainlandBoundary, Math.min(mainlandBoundary.length, 2000));
  for (const idx of mainlandSampled) {
    mainlandHash.insert(idx % w, Math.floor(idx / w), idx);
  }

  // ── 3. Build island boundary hashes for large islands ────────────────────
  const islandBoundaries = new Map(); // compIdx → sampled boundary array
  const islandHashes = new Map();     // compIdx → SpatialHash

  for (let i = 0; i < components.length; i++) {
    if (i === mainlandIdx) continue;
    if (components[i].pixels.length < minIslandSize) continue;
    const b = getBoundaryPixels(components[i]);
    const sampled = sampleArray(b, Math.min(b.length, 1000));
    islandBoundaries.set(i, sampled);
    const hash = new SpatialHash(cellSize);
    for (const idx of sampled) hash.insert(idx % w, Math.floor(idx / w), idx);
    islandHashes.set(i, hash);
  }

  // ── 4. Track placed bridges (for crossing detection) ─────────────────────
  const placedBridges = []; // [{x1,y1,x2,y2}]

  // ── 5. Stats accumulators ─────────────────────────────────────────────────
  let islandCount = 0, bridgesCreated = 0;
  let totalCoverage = 0, totalLength = 0, hiddenBridges = 0;

  const COVERAGE_THRESHOLDS = [0.90, 0.80, 0.70, 0.60, 0.0];

  // ── 6. Process each island ────────────────────────────────────────────────
  for (let islandIdx = 0; islandIdx < components.length; islandIdx++) {
    if (islandIdx === mainlandIdx) continue;
    const island = components[islandIdx];
    if (island.pixels.length < minIslandSize) continue;

    islandCount++;
    const boundary = islandBoundaries.get(islandIdx);
    if (!boundary || boundary.length === 0) continue;

    const cen = centroid(island.pixels, w);

    // ── 6a. Divide perimeter into angular sectors ─────────────────────────
    // opposingPairs mode: use fixed sector center angles that guarantee
    // opposing placement. For 3 bridges: 0°, 180°, 90° — first two are
    // directly opposite, third is perpendicular.
    // Each boundary point is assigned to the nearest sector center.
    let sectorCenters; // array of angles in [0, 2π)

    if (opposingPairs && bridgesPerIsland === 3) {
      // Fixed: right (0°), left (180°), bottom (90°) — guarantees two opposing + one cross
      sectorCenters = [0, Math.PI, Math.PI / 2];
    } else if (opposingPairs && bridgesPerIsland % 2 === 0) {
      // Even count: interleave pairs at 0°/180°, 90°/270°, etc.
      sectorCenters = [];
      const half = bridgesPerIsland / 2;
      for (let i = 0; i < half; i++) {
        const base = (i * Math.PI) / half;
        sectorCenters.push(base);
        sectorCenters.push(base + Math.PI);
      }
    } else {
      // Default: evenly spaced sectors
      const sectorSize = (2 * Math.PI) / bridgesPerIsland;
      sectorCenters = Array.from({ length: bridgesPerIsland }, (_, i) => i * sectorSize);
    }

    // Assign each boundary point to the nearest sector center (angular distance)
    const sectors = Array.from({ length: bridgesPerIsland }, () => []);
    for (const idx of boundary) {
      const bx = idx % w, by = Math.floor(idx / w);
      const angle = Math.atan2(by - cen.y, bx - cen.x) + Math.PI; // [0, 2π)
      let bestSector = 0, bestAngDist = Infinity;
      for (let s = 0; s < bridgesPerIsland; s++) {
        // Shortest angular distance (wrap-around)
        let d = Math.abs(angle - sectorCenters[s]);
        if (d > Math.PI) d = 2 * Math.PI - d;
        if (d < bestAngDist) { bestAngDist = d; bestSector = s; }
      }
      sectors[bestSector].push(idx);
    }

    // Collect selected bridges for this island
    const selectedBridges = [];

    // ── 6b. For each sector, generate candidates and pick best ────────────
    for (let s = 0; s < bridgesPerIsland; s++) {
      const sectorPixels = sectors[s];
      if (sectorPixels.length === 0) continue;

      // Sample candidates from this sector
      const srcSamples = sampleArray(sectorPixels, candidatesPerSector);

      // Build target candidates: mainland + larger islands
      const candidates = [];

      for (const srcIdx of srcSamples) {
        const sx = srcIdx % w, sy = Math.floor(srcIdx / w);

        // Targets: mainland
        const mlNearest = mainlandHash.nearest(sx, sy);
        if (mlNearest) {
          candidates.push({ sx, sy, tx: mlNearest.x, ty: mlNearest.y, targetType: 0 });
        }

        // Targets: other larger islands (skipped in mainlandOnly / cartoon mode)
        if (!mainlandOnly) {
          for (const [otherIdx, hash] of islandHashes.entries()) {
            if (otherIdx === islandIdx) continue;
            if (components[otherIdx].pixels.length <= island.pixels.length) continue;
            const nearest = hash.nearest(sx, sy);
            if (nearest) {
              candidates.push({ sx, sy, tx: nearest.x, ty: nearest.y, targetType: 2 });
            }
          }
        }
      }

      if (candidates.length === 0) continue;

      // ── 6c. Score candidates ──────────────────────────────────────────
      let bestCandidate = null;
      let bestScore = -Infinity;

      // Try coverage thresholds in order
      for (const threshold of COVERAGE_THRESHOLDS) {
        for (const cand of candidates) {
          const { sx, sy, tx, ty, targetType } = cand;
          const coverage = bridgeCoverage(sx, sy, tx, ty, upperMasks, w, h);
          if (coverage < threshold) continue;

          const len = Math.sqrt((tx - sx) ** 2 + (ty - sy) ** 2);

          // Overlap penalty: does this bridge come near already-selected bridges' source points?
          let overlapPenalty = 0;
          for (const sel of selectedBridges) {
            const da = Math.sqrt((sx - sel.sx) ** 2 + (sy - sel.sy) ** 2);
            if (da < bridgeWidth * 4) overlapPenalty += 500;
          }

          // Crossing penalty
          let crossingPenalty = 0;
          for (const placed of [...placedBridges, ...selectedBridges]) {
            if (segmentsIntersect(sx, sy, tx, ty, placed.sx, placed.sy, placed.tx, placed.ty)) {
              crossingPenalty += 1000;
            }
          }

          // Angle penalty: prefer shorter (more perpendicular) bridges
          const anglePenalty = len * 0.1;

          // Target type bonus: mainland preferred (0), large island neutral (10)
          const targetBonus = targetType === 0 ? 200 : 0;

          const score = coverage * 10000 - len - overlapPenalty - crossingPenalty - anglePenalty + targetBonus;

          if (debug) {
            drawDebugLine(output, sx, sy, tx, ty, w, h, 0, 0, 200, 1); // blue candidates
          }

          if (score > bestScore) { bestScore = score; bestCandidate = { sx, sy, tx, ty, coverage, len }; }
        }
        if (bestCandidate) break; // found viable candidate at this threshold
      }

      if (bestCandidate) {
        selectedBridges.push(bestCandidate);
      }
    }

    // ── 6d. Erase selected bridges ────────────────────────────────────────
    for (const br of selectedBridges) {
      if (debug) {
        drawDebugLine(output, br.sx, br.sy, br.tx, br.ty, w, h, 0, 200, 0, bridgeWidth + 1); // green selected
      } else {
        eraseBridgeOnData(output, br.sx, br.sy, br.tx, br.ty, w, h, bridgeWidth);
      }

      placedBridges.push(br);
      bridgesCreated++;
      totalCoverage += br.coverage;
      totalLength += br.len;
      if (br.coverage >= 0.60) hiddenBridges++;
    }
  }

  ctx.putImageData(new ImageData(output, w, h), 0, 0);

  const avgCoverage = bridgesCreated > 0 ? totalCoverage / bridgesCreated : 0;
  const avgLength   = bridgesCreated > 0 ? totalLength   / bridgesCreated : 0;
  const hiddenPct   = bridgesCreated > 0 ? (hiddenBridges / bridgesCreated) * 100 : 0;

  return {
    islandCount,
    bridgesCreated,
    averageCoverage: Math.round(avgCoverage * 100),
    averageBridgeLength: Math.round(avgLength),
    hiddenBridgePercentage: Math.round(hiddenPct),
  };
}