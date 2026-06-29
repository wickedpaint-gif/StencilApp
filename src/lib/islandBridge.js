/**
 * Island bridge logic for stencil layers.
 *
 * The problem: When you cut a stencil, any opaque region that is completely
 * ENCLOSED by other opaque material (i.e. it has a "hole" of transparent
 * pixels around it that is isolated from the outside) will cause the enclosed
 * piece to fall out when cut.
 *
 * The correct mental model (matching the C++ reference implementation):
 *  - We flood-fill TRANSPARENT regions (the cut-out areas).
 *  - The LARGEST transparent component = the outside/background.
 *  - SMALLER transparent components = enclosed holes surrounded by opaque material.
 *  - Fix: erase (make transparent) a thin bridge from the hole boundary to the
 *    outer boundary, so the enclosed opaque piece becomes connected to the outside.
 *
 * In other words: we're cutting a gap through the opaque material to let the
 * enclosed transparent pocket "breathe" to the outside — so nothing gets trapped.
 */

/**
 * @param {Uint8ClampedArray} data   - RGBA flat array (from ImageData)
 * @param {number} width
 * @param {number} height
 * @param {number} bridgeWidth       - thickness of the erased bridge in pixels
 * @returns {Uint8ClampedArray}      - modified copy of data with bridges added
 */
export function addBridgesToIslands(data, width, height, bridgeWidth = 2, minIslandSize = 0) {
  const n = width * height;
  const output = new Uint8ClampedArray(data);

  const isTransparent = (idx) => output[idx * 4 + 3] <= 128;

  // ── Step 1: Find all connected components of TRANSPARENT pixels ──────────
  const compId = new Int32Array(n).fill(-1);
  const components = []; // each: { pixels: [idx,...] }

  for (let i = 0; i < n; i++) {
    if (!isTransparent(i) || compId[i] !== -1) continue;

    const comp = { pixels: [] };
    const bfsQ = [i];
    compId[i] = components.length;
    const cid = components.length;

    let head = 0;
    while (head < bfsQ.length) {
      const idx = bfsQ[head++];
      comp.pixels.push(idx);
      const x = idx % width;
      const y = Math.floor(idx / width);

      const tryAdd = (nidx) => {
        if (isTransparent(nidx) && compId[nidx] === -1) {
          compId[nidx] = cid;
          bfsQ.push(nidx);
        }
      };
      if (x > 0)          tryAdd(idx - 1);
      if (x < width - 1)  tryAdd(idx + 1);
      if (y > 0)          tryAdd(idx - width);
      if (y < height - 1) tryAdd(idx + width);
    }

    components.push(comp);
  }

  if (components.length <= 1) return output;

  // ── Step 2: Largest transparent component = outside/background ───────────
  let largestIdx = 0;
  for (let i = 1; i < components.length; i++) {
    if (components[i].pixels.length > components[largestIdx].pixels.length) {
      largestIdx = i;
    }
  }

  // ── Step 3: Smaller transparent components = enclosed holes ──────────────
  // For each hole, find its boundary pixels and the nearest outside boundary
  // pixel, then erase a bridge between them.

  // Build boundary pixel lists for each component
  // A boundary pixel is a transparent pixel that has at least one opaque neighbour
  function getBoundary(comp, cid) {
    const boundary = [];
    for (const idx of comp.pixels) {
      const x = idx % width;
      const y = Math.floor(idx / width);
      let isBoundary = false;
      if (x > 0          && !isTransparent(idx - 1))     isBoundary = true;
      if (!isBoundary && x < width - 1  && !isTransparent(idx + 1))     isBoundary = true;
      if (!isBoundary && y > 0          && !isTransparent(idx - width))  isBoundary = true;
      if (!isBoundary && y < height - 1 && !isTransparent(idx + width))  isBoundary = true;
      if (isBoundary) boundary.push(idx);
    }
    return boundary;
  }

  const outsideBoundary = getBoundary(components[largestIdx], largestIdx);
  if (outsideBoundary.length === 0) return output;

  // ── Step 4: Draw bridges ─────────────────────────────────────────────────
  // Erase a thin line from the hole's nearest boundary point to the outside.

  const eraseBridge = (x1, y1, x2, y2) => {
    const dx = Math.abs(x2 - x1), dy = Math.abs(y2 - y1);
    const sx = x1 < x2 ? 1 : -1, sy = y1 < y2 ? 1 : -1;
    let err = dx - dy;
    let cx = x1, cy = y1;
    const half = Math.floor(bridgeWidth / 2);

    while (true) {
      for (let bx = -half; bx <= half; bx++) {
        for (let by = -half; by <= half; by++) {
          const px = cx + bx, py = cy + by;
          if (px < 0 || py < 0 || px >= width || py >= height) continue;
          const pidx = py * width + px;
          output[pidx * 4 + 3] = 0; // make transparent (erase)
        }
      }
      if (cx === x2 && cy === y2) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; cx += sx; }
      if (e2 < dx)  { err += dx; cy += sy; }
    }
  };

  // Helper: find nearest mainland anchor to a given point
  const findNearestMainland = (hx, hy) => {
    const numAnchors = Math.max(5, Math.floor(outsideBoundary.length / 200));
    let bestOx = -1, bestOy = -1, bestDist = Infinity;
    for (let a = 0; a < numAnchors; a++) {
      const mid = Math.floor(((a + 0.5) / numAnchors) * outsideBoundary.length);
      if (mid >= outsideBoundary.length) continue;
      const oidx = outsideBoundary[mid];
      const ox = oidx % width, oy = Math.floor(oidx / width);
      const d = (hx - ox) ** 2 + (hy - oy) ** 2;
      if (d < bestDist) { bestDist = d; bestOx = ox; bestOy = oy; }
    }
    return { ox: bestOx, oy: bestOy };
  };

  const totalPixels = width * height;
  const thresholdPixels = totalPixels * 0.03;

  // Track which island indices have been given a mainland bridge (directly or via chain).
  // We use a Union-Find to group islands that are bridged together,
  // then ensure each group has at least one mainland connection.
  const parent = Array.from({ length: components.length }, (_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { parent[find(a)] = find(b); };

  // Mark mainland as its own root (largestIdx)
  // Any island unioned with largestIdx is considered mainland-connected.

  // First pass: draw all island-to-island and island-to-mainland bridges
  for (let i = 0; i < components.length; i++) {
    if (i === largestIdx) continue;
    const hole = components[i];
    const holeSize = hole.pixels.length;

    // Skip islands below the minimum size threshold
    if (holeSize < minIslandSize) continue;
    const holeBoundary = getBoundary(hole, i);
    if (holeBoundary.length === 0) continue;

    const isSmallIsland = holeSize < 1500;

    let numBridges = 1;
    if (holeSize > thresholdPixels) {
      const sizePercent = holeSize / totalPixels;
      numBridges = Math.max(2, Math.ceil(sizePercent * 50));
    }

    const anchorIndices = [];
    if (numBridges === 1) {
      anchorIndices.push(Math.floor(holeBoundary.length / 2));
    } else {
      for (let b = 0; b < numBridges; b++) {
        anchorIndices.push(Math.floor((b / numBridges) * holeBoundary.length));
      }
    }

    for (const anchorIdx of anchorIndices) {
      const hidx = holeBoundary[anchorIdx];
      const hx = hidx % width, hy = Math.floor(hidx / width);

      let bestOx = -1, bestOy = -1, bestDist = Infinity;
      let bridgedToIslandIdx = -1;

      if (isSmallIsland) {
        // Try island-to-island: find nearest non-self island boundary
        for (let j = 0; j < components.length; j++) {
          if (j === largestIdx || j === i) continue;
          const otherBoundary = getBoundary(components[j], j);
          for (const oidx of otherBoundary) {
            const ox = oidx % width, oy = Math.floor(oidx / width);
            const d = (hx - ox) ** 2 + (hy - oy) ** 2;
            if (d < bestDist) { bestDist = d; bestOx = ox; bestOy = oy; bridgedToIslandIdx = j; }
          }
        }
      }

      if (bestOx === -1) {
        // Fall back to mainland
        const { ox, oy } = findNearestMainland(hx, hy);
        bestOx = ox; bestOy = oy;
        union(i, largestIdx);
      } else {
        union(i, bridgedToIslandIdx);
      }

      if (bestOx !== -1) eraseBridge(hx, hy, bestOx, bestOy);
    }
  }

  // Second pass: any island cluster not yet connected to the mainland gets one extra bridge
  for (let i = 0; i < components.length; i++) {
    if (i === largestIdx) continue;
    if (find(i) === find(largestIdx)) continue; // already mainland-connected

    const hole = components[i];
    // Also skip small islands in the second pass
    if (hole.pixels.length < minIslandSize) continue;
    const holeBoundary = getBoundary(hole, i);
    if (holeBoundary.length === 0) continue;

    // Pick a representative anchor point (middle of boundary)
    const hidx = holeBoundary[Math.floor(holeBoundary.length / 2)];
    const hx = hidx % width, hy = Math.floor(hidx / width);
    const { ox, oy } = findNearestMainland(hx, hy);

    if (ox !== -1) {
      eraseBridge(hx, hy, ox, oy);
      union(i, largestIdx);
    }
  }

  return output;
}

/**
 * Apply island bridging to a canvas in-place, return updated dataUrl.
 * Uses the full realistic bridge logic (island-to-island + mainland).
 */
export function bridgeIslandsOnCanvas(canvas, bridgeWidth = 2, minIslandSize = 0) {
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const fixed = addBridgesToIslands(imageData.data, canvas.width, canvas.height, bridgeWidth, minIslandSize);
  const newImageData = new ImageData(fixed, canvas.width, canvas.height);
  ctx.putImageData(newImageData, 0, 0);
  return canvas.toDataURL('image/png');
}

/**
 * Burns crosshair (+) registration marks OUTSIDE the image bounds by
 * expanding the canvas with a margin, then drawing the crosshairs in that margin.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {number} armLength  - half-length of each crosshair arm in pixels
 * @param {number} armWidth   - thickness of each arm in pixels
 * @param {number} margin     - distance from image edge to crosshair centre
 */
export function burnCornerMarkers(canvas, armLength = 14, armWidth = 3, margin = 24) {
  const origW = canvas.width;
  const origH = canvas.height;

  // Snapshot existing content
  const ctx = canvas.getContext('2d');
  const origImageData = ctx.getImageData(0, 0, origW, origH);

  // Expand canvas by margin on all sides
  const newW = origW + margin * 2;
  const newH = origH + margin * 2;
  canvas.width = newW;
  canvas.height = newH;

  // Re-draw original content offset by margin (canvas cleared on resize)
  ctx.putImageData(origImageData, margin, margin);

  // Now draw crosshairs in the margin area at each corner
  const imageData = ctx.getImageData(0, 0, newW, newH);
  const data = imageData.data;

  const corners = [
    { cx: margin / 2, cy: margin / 2 },
    { cx: newW - margin / 2, cy: margin / 2 },
    { cx: margin / 2, cy: newH - margin / 2 },
    { cx: newW - margin / 2, cy: newH - margin / 2 },
  ];

  const half = Math.floor(armWidth / 2);

  for (const { cx, cy } of corners) {
    // Horizontal arm
    for (let x = Math.round(cx - armLength); x <= Math.round(cx + armLength); x++) {
      for (let dy = -half; dy <= half; dy++) {
        const py = Math.round(cy) + dy;
        if (x < 0 || x >= newW || py < 0 || py >= newH) continue;
        const idx = (py * newW + x) * 4;
        data[idx] = 0; data[idx + 1] = 0; data[idx + 2] = 0; data[idx + 3] = 255;
      }
    }
    // Vertical arm
    for (let y = Math.round(cy - armLength); y <= Math.round(cy + armLength); y++) {
      for (let dx = -half; dx <= half; dx++) {
        const px = Math.round(cx) + dx;
        if (px < 0 || px >= newW || y < 0 || y >= newH) continue;
        const idx = (y * newW + px) * 4;
        data[idx] = 0; data[idx + 1] = 0; data[idx + 2] = 0; data[idx + 3] = 255;
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
}