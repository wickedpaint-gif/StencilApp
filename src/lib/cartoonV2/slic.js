/**
 * Cartoon V2 — stage 4: SLIC superpixel segmentation.
 *
 * Simple Linear Iterative Clustering over weighted RGB + spatial proximity.
 * Output is a label map where every superpixel is spatially connected (a
 * connectivity pass splits any label that ended up in two places), which the
 * region-merging stage relies on.
 */

export function computeSLIC(rgba, luma, width, height, targetSuperpixels, compactness, iterations) {
  const n = width * height;
  const S = Math.max(4, Math.round(Math.sqrt(n / Math.max(1, targetSuperpixels))));
  const gw = Math.max(1, Math.round(width / S));
  const gh = Math.max(1, Math.round(height / S));
  const k = gw * gh;

  let labels = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) if (rgba[i * 4 + 3] < 10) labels[i] = -2;
  let dist = new Float32Array(n);

  const cx = new Float32Array(k);
  const cy = new Float32Array(k);
  const cr = new Float32Array(k);
  const cg = new Float32Array(k);
  const cb = new Float32Array(k);

  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const id = gy * gw + gx;
      const bx = Math.min(width - 1, Math.round((gx + 0.5) * S));
      const by = Math.min(height - 1, Math.round((gy + 0.5) * S));

      // Perturb the seed to the lowest-gradient pixel nearby (keeps seeds off edges)
      let best = Infinity;
      let px = bx;
      let py = by;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = by + dy;
        if (ny < 1 || ny >= height - 1) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = bx + dx;
          if (nx < 1 || nx >= width - 1) continue;
          const i = ny * width + nx;
          const g = Math.abs(luma[i + 1] - luma[i - 1]) + Math.abs(luma[i + width] - luma[i - width]);
          if (g < best) { best = g; px = nx; py = ny; }
        }
      }

      cx[id] = px;
      cy[id] = py;
      const o = (py * width + px) * 4;
      cr[id] = rgba[o];
      cg[id] = rgba[o + 1];
      cb[id] = rgba[o + 2];
    }
  }

  const invS2 = 1 / (S * S);
  const spatial = compactness * compactness * invS2;

  const sumX = new Float64Array(k);
  const sumY = new Float64Array(k);
  const sumR = new Float64Array(k);
  const sumG = new Float64Array(k);
  const sumB = new Float64Array(k);
  const sums = new Float64Array(k);

  for (let iter = 0; iter < iterations; iter++) {
    dist.fill(Infinity);

    for (let id = 0; id < k; id++) {
      const cxi = cx[id];
      const cyi = cy[id];
      const lr = cr[id];
      const lg = cg[id];
      const lb = cb[id];
      const x0 = Math.max(0, Math.floor(cxi - S));
      const x1 = Math.min(width - 1, Math.ceil(cxi + S));
      const y0 = Math.max(0, Math.floor(cyi - S));
      const y1 = Math.min(height - 1, Math.ceil(cyi + S));

      for (let y = y0; y <= y1; y++) {
        const dy = y - cyi;
        const base = dy * dy * spatial;
        const row = y * width;
        const rowo = row * 4;
        for (let x = x0; x <= x1; x++) {
          const i = row + x;
          const dx = x - cxi;
          const spatialTerm = dx * dx * spatial;
          // The colour term is never negative, so a pixel whose spatial term
          // alone already loses cannot win: skip it before touching colour.
          if (spatialTerm + base >= dist[i]) continue;
          const o = rowo + x * 4;
          if (rgba[o + 3] < 10) continue;
          const dr = rgba[o] - lr;
          const dg = rgba[o + 1] - lg;
          const db = rgba[o + 2] - lb;
          // /81 normalises the weighted RGB distance to SLIC's colour range
          const dcol = (3 * dr * dr + 4 * dg * dg + 2 * db * db) / 81;
          const d = dcol + spatialTerm + base;
          if (d < dist[i]) {
            dist[i] = d;
            labels[i] = id;
          }
        }
      }
    }

    sums.fill(0);
    sumX.fill(0);
    sumY.fill(0);
    sumR.fill(0);
    sumG.fill(0);
    sumB.fill(0);

    // Row walk instead of `i % width` / `(i / width) | 0` per pixel — same values,
    // no division.
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        const i = row + x;
        const l = labels[i];
        if (l < 0) continue;
        const o = i * 4;
        sums[l]++;
        sumX[l] += x;
        sumY[l] += y;
        sumR[l] += rgba[o];
        sumG[l] += rgba[o + 1];
        sumB[l] += rgba[o + 2];
      }
    }

    for (let id = 0; id < k; id++) {
      const c = sums[id];
      if (c === 0) continue;
      cx[id] = sumX[id] / c;
      cy[id] = sumY[id] / c;
      cr[id] = sumR[id] / c;
      cg[id] = sumG[id] / c;
      cb[id] = sumB[id] / c;
    }
  }

  dist = null;

  // ── Connectivity enforcement ──────────────────────────────────────────────
  // Every original superpixel keeps its biggest component; stray fragments get
  // their own new id so the region graph never sees a split region.
  const out = new Int32Array(n).fill(-1);
  const claimed = new Uint8Array(k);
  const queue = new Int32Array(n);
  let next = k;

  for (let start = 0; start < n; start++) {
    const lab = labels[start];
    if (lab < 0 || out[start] !== -1) continue;

    let id;
    if (!claimed[lab]) {
      claimed[lab] = 1;
      id = lab;
    } else {
      id = next++;
    }

    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    out[start] = id;

    while (head < tail) {
      const idx = queue[head++];
      const x = idx % width;
      if (x > 0) {
        const nb = idx - 1;
        if (out[nb] === -1 && labels[nb] === lab) { out[nb] = id; queue[tail++] = nb; }
      }
      if (x < width - 1) {
        const nb = idx + 1;
        if (out[nb] === -1 && labels[nb] === lab) { out[nb] = id; queue[tail++] = nb; }
      }
      if (idx >= width) {
        const nb = idx - width;
        if (out[nb] === -1 && labels[nb] === lab) { out[nb] = id; queue[tail++] = nb; }
      }
      if (idx < n - width) {
        const nb = idx + width;
        if (out[nb] === -1 && labels[nb] === lab) { out[nb] = id; queue[tail++] = nb; }
      }
    }
  }

  labels = null;

  return { labels: out, count: next };
}