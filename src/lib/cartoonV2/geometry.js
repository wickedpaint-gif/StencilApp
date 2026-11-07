/**
 * Cartoon V2 — stage 7: stencil geometry simplification.
 *
 * Converts label maps into geometry that can actually be cut from card:
 *  - majority smoothing rounds pixel staircases and removes 1px slivers
 *  - components below the minimum feature area are absorbed by their
 *    dominant neighbour (never deleted, so masks stay gapless)
 *  - enclosed holes/gaps too small to cut are filled
 *
 * Thresholds are in source pixels and derived from the user's Detail Removal
 * control, so the same setting behaves consistently across resolutions.
 */

/**
 * Majority vote over the 3×3 neighbourhood of one pixel (border aware).
 * Identical result to the inline version: ties resolve to the lowest label
 * index and a label only writes when it holds at least `minVotes` pixels.
 */
function majorityAt(src, i, x, y, width, height, counts, colorCount, minVotes) {
  const y0 = y > 0 ? y - 1 : 0;
  const y1 = y < height - 1 ? y + 1 : height - 1;
  const x0 = x > 0 ? x - 1 : 0;
  const x1 = x < width - 1 ? x + 1 : width - 1;

  counts.fill(0);

  for (let ny = y0; ny <= y1; ny++) {
    const r = ny * width;
    for (let nx = x0; nx <= x1; nx++) {
      const l = src[r + nx];
      counts[l < 0 ? 0 : l + 1]++;
    }
  }

  const cur = src[i];
  const curIdx = cur < 0 ? 0 : cur + 1;

  let bestIdx = 0;
  let bestCount = counts[0];
  for (let c = 1; c <= colorCount; c++) {
    if (counts[c] > bestCount) { bestCount = counts[c]; bestIdx = c; }
  }

  // Strict-majority writes only, so thin intentional details survive
  if (bestIdx !== curIdx && bestCount >= minVotes) {
    return bestIdx === 0 ? -1 : bestIdx - 1;
  }
  return cur;
}

export function smoothLabels(labels, width, height, passes, minVotes, colorCount) {
  const n = width * height;
  let src = labels;
  let dst = new Int16Array(n);
  const counts = new Int32Array(colorCount + 1);

  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < height; y++) {
      const row = y * width;
      const interiorRow = y > 0 && y < height - 1;
      for (let x = 0; x < width; x++) {
        const i = row + x;
        const cur = src[i];

        // Fast path: when all nine neighbours already carry the current label
        // the majority is that label and nothing can change. This is the common
        // case inside large flat areas, where the vote is skipped entirely.
        if (interiorRow && x > 0 && x < width - 1) {
          if (
            src[i - width - 1] === cur && src[i - width] === cur && src[i - width + 1] === cur &&
            src[i - 1] === cur && src[i + 1] === cur &&
            src[i + width - 1] === cur && src[i + width] === cur && src[i + width + 1] === cur
          ) {
            dst[i] = cur;
            continue;
          }
        }

        dst[i] = majorityAt(src, i, x, y, width, height, counts, colorCount, minVotes);
      }
    }

    const tmp = src;
    src = dst;
    dst = tmp;
  }

  return src;
}

export function removeSmallComponents(labels, width, height, minArea, holeArea, colorCount, visited, queue) {
  const n = width * height;
  visited.fill(0);
  const counts = new Int32Array(colorCount + 1);

  for (let start = 0; start < n; start++) {
    if (visited[start]) continue;

    const lab = labels[start];
    let head = 0;
    let tail = 0;
    let touchesBorder = false;
    const touched = [];

    queue[tail++] = start;
    visited[start] = 1;

    while (head < tail) {
      const idx = queue[head++];
      const x = idx % width;
      const y = (idx - x) / width;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesBorder = true;

      for (let k = 0; k < 4; k++) {
        let nb;
        if (k === 0) { if (x === 0) continue; nb = idx - 1; }
        else if (k === 1) { if (x === width - 1) continue; nb = idx + 1; }
        else if (k === 2) { if (y === 0) continue; nb = idx - width; }
        else { if (y === height - 1) continue; nb = idx + width; }

        if (labels[nb] === lab) {
          if (!visited[nb]) { visited[nb] = 1; queue[tail++] = nb; }
        } else {
          const c = labels[nb] < 0 ? 0 : labels[nb] + 1;
          if (counts[c] === 0) touched.push(c);
          counts[c]++;
        }
      }
    }

    const size = tail;
    let reassign = null;

    if (lab < 0) {
      // A small enclosed gap is not cuttable — fill it with the surrounding colour
      if (!touchesBorder && size < holeArea) reassign = pickDominant(touched, counts);
    } else if (size < minArea) {
      reassign = pickDominant(touched, counts);
    }

    if (reassign !== null) {
      for (let q = 0; q < tail; q++) labels[queue[q]] = reassign;
    }

    for (let t = 0; t < touched.length; t++) counts[touched[t]] = 0;
  }
}

function pickDominant(touched, counts) {
  let best = 0;
  let bestCount = -1;
  for (let t = 0; t < touched.length; t++) {
    const c = touched[t];
    if (counts[c] > bestCount) { bestCount = counts[c]; best = c; }
  }
  if (bestCount <= 0) return null;
  return best === 0 ? -1 : best - 1;
}

export function simplifyLabelMap(labelMap, width, height, colorCount, opts) {
  const { smoothPasses = 2, smoothVotes = 4, minArea = 0, holeArea = 0 } = opts;
  const n = width * height;

  let cur = labelMap;
  if (smoothPasses > 0) {
    cur = smoothLabels(cur, width, height, smoothPasses, smoothVotes, colorCount);
  }

  if (minArea > 0) {
    const visited = new Uint8Array(n);
    const queue = new Int32Array(n);
    removeSmallComponents(cur, width, height, minArea, holeArea, colorCount, visited, queue);

    if (smoothPasses > 1) {
      cur = smoothLabels(cur, width, height, 1, smoothVotes, colorCount);
    }

    removeSmallComponents(cur, width, height, minArea, holeArea, colorCount, visited, queue);
  }

  return cur;
}