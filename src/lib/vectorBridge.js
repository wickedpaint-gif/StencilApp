/**
 * Vector-based island bridge system.
 *
 * Pipeline:
 *  1. Extract closed contours from an ImageTracer SVG string.
 *  2. Classify: mainland = largest area contour, rest = islands.
 *  3. Douglas-Peucker simplify every contour.
 *  4. For each island find the shortest valid bridge to the mainland
 *     (shortest segment-to-segment distance, reject if the line crosses
 *     any other contour).
 *  5. Build a rectangular bridge polygon of the requested width.
 *  6. Boolean-union the bridge into the island contour using polygon-clipping.
 *  7. Re-serialise everything back to SVG <path> elements.
 */

import polygonClipping from 'polygon-clipping';

// ─── 1. SVG path → point arrays ──────────────────────────────────────────────

/**
 * Parse a single SVG <path d="…"> string into an array of closed rings.
 * Handles M/L/H/V/C/S/Q/T/Z (absolute only — ImageTracer outputs absolute).
 * Returns Array<Array<{x,y}>>
 */
function parseSVGPath(d) {
  const rings = [];
  let current = [];
  let cx = 0, cy = 0;

  // Tokenise
  const tokens = d
    .trim()
    .replace(/([MLHVCSQTAZmlhvcsqtaz])/g, ' $1 ')
    .split(/[\s,]+/)
    .filter(Boolean);

  let i = 0;
  const num = () => parseFloat(tokens[i++]);

  while (i < tokens.length) {
    const cmd = tokens[i++];
    switch (cmd) {
      case 'M': { cx = num(); cy = num(); current = [{ x: cx, y: cy }]; break; }
      case 'L': { cx = num(); cy = num(); current.push({ x: cx, y: cy }); break; }
      case 'H': { cx = num(); current.push({ x: cx, y: cy }); break; }
      case 'V': { cy = num(); current.push({ x: cx, y: cy }); break; }
      case 'C': {
        // Cubic bezier — sample 8 points along the curve
        const x1 = num(), y1 = num(), x2 = num(), y2 = num(), x3 = num(), y3 = num();
        for (let t = 0.125; t <= 1; t += 0.125) {
          const mt = 1 - t;
          current.push({
            x: mt**3*cx + 3*mt**2*t*x1 + 3*mt*t**2*x2 + t**3*x3,
            y: mt**3*cy + 3*mt**2*t*y1 + 3*mt*t**2*y2 + t**3*y3,
          });
        }
        cx = x3; cy = y3; break;
      }
      case 'S': {
        const x2 = num(), y2 = num(), x3 = num(), y3 = num();
        for (let t = 0.125; t <= 1; t += 0.125) {
          const mt = 1 - t;
          current.push({
            x: mt**2*cx + 2*mt*t*x2 + t**2*x3,
            y: mt**2*cy + 2*mt*t*y2 + t**2*y3,
          });
        }
        cx = x3; cy = y3; break;
      }
      case 'Q': {
        const x1 = num(), y1 = num(), x2 = num(), y2 = num();
        for (let t = 0.125; t <= 1; t += 0.125) {
          const mt = 1 - t;
          current.push({
            x: mt**2*cx + 2*mt*t*x1 + t**2*x2,
            y: mt**2*cy + 2*mt*t*y1 + t**2*y2,
          });
        }
        cx = x2; cy = y2; break;
      }
      case 'T': { cx = num(); cy = num(); current.push({ x: cx, y: cy }); break; }
      case 'A': { num(); num(); num(); num(); num(); cx = num(); cy = num(); current.push({ x: cx, y: cy }); break; }
      case 'Z': case 'z': {
        if (current.length >= 3) rings.push([...current]);
        current = [];
        break;
      }
      default: break;
    }
  }
  if (current.length >= 3) rings.push(current);
  return rings;
}

/**
 * Extract all closed contours from an ImageTracer SVG string.
 * Returns Array<{id, points: Array<{x,y}>, area}>
 */
export function extractContours(svgString) {
  const pathRe = /d="([^"]+)"/g;
  const contours = [];
  let match;
  let id = 0;

  while ((match = pathRe.exec(svgString)) !== null) {
    const rings = parseSVGPath(match[1]);
    for (const pts of rings) {
      if (pts.length < 3) continue;
      contours.push({ id: id++, points: pts, area: polygonArea(pts) });
    }
  }
  return contours;
}

// ─── 2. Geometry helpers ──────────────────────────────────────────────────────

/** Signed polygon area (shoelace). Positive = CCW. */
function polygonArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const j = (i + 1) % n;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(a / 2);
}

// ─── 3. Douglas-Peucker simplification ───────────────────────────────────────

function perpDist(pt, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(pt.x - a.x, pt.y - a.y);
  const t = ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / (dx * dx + dy * dy);
  return Math.hypot(pt.x - (a.x + t * dx), pt.y - (a.y + t * dy));
}

function douglasPeucker(pts, tol) {
  if (pts.length <= 2) return pts;
  let maxD = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD > tol) {
    const l = douglasPeucker(pts.slice(0, idx + 1), tol);
    const r = douglasPeucker(pts.slice(idx), tol);
    return [...l.slice(0, -1), ...r];
  }
  return [pts[0], pts[pts.length - 1]];
}

export function simplifyContours(contours, tolerance = 1.5) {
  return contours.map(c => ({
    ...c,
    points: douglasPeucker(c.points, tolerance),
  }));
}

// ─── 4. Segment intersection test ────────────────────────────────────────────

function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1x = bx - ax, d1y = by - ay;
  const d2x = dx - cx, d2y = dy - cy;
  const cross = d1x * d2y - d1y * d2x;
  if (Math.abs(cross) < 1e-10) return false;
  const t = ((cx - ax) * d2y - (cy - ay) * d2x) / cross;
  const u = ((cx - ax) * d1y - (cy - ay) * d1x) / cross;
  return t > 1e-4 && t < 1 - 1e-4 && u > 1e-4 && u < 1 - 1e-4;
}

/**
 * Returns true if the segment (ax,ay)→(bx,by) intersects any edge of any
 * contour other than the two specified by skipIds.
 */
function bridgeIntersectsContour(ax, ay, bx, by, allContours, skipIds) {
  for (const c of allContours) {
    if (skipIds.includes(c.id)) continue;
    const pts = c.points;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      if (segmentsIntersect(ax, ay, bx, by, pts[i].x, pts[i].y, pts[j].x, pts[j].y)) {
        return true;
      }
    }
  }
  return false;
}

// ─── 5. Closest valid bridge between two contours ────────────────────────────

/**
 * Project point P onto segment AB, return the clamped foot and distance².
 */
function projectOntoSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { x: ax, y: ay, distSq: (px - ax) ** 2 + (py - ay) ** 2 };
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const fx = ax + t * dx, fy = ay + t * dy;
  return { x: fx, y: fy, distSq: (px - fx) ** 2 + (py - fy) ** 2 };
}

/**
 * Find the shortest valid bridge between `island` and `mainland`.
 * Returns { islandPt, mainlandPt, dist } or null if none found.
 *
 * Strategy: for each edge of the island, find the closest point on each edge
 * of the mainland, then validate the bridge doesn't cross other contours.
 */
export function findBridge(island, mainland, allContours) {
  const iPts = island.points;
  const mPts = mainland.points;

  // Subsample for speed on large contours
  const maxSamples = 200;
  const iStep = Math.max(1, Math.floor(iPts.length / maxSamples));
  const mStep = Math.max(1, Math.floor(mPts.length / maxSamples));

  let best = null;

  for (let ii = 0; ii < iPts.length; ii += iStep) {
    const ip = iPts[ii];

    for (let mi = 0; mi < mPts.length; mi += mStep) {
      const mj = (mi + 1) % mPts.length;
      const proj = projectOntoSegment(ip.x, ip.y, mPts[mi].x, mPts[mi].y, mPts[mj].x, mPts[mj].y);

      if (best && proj.distSq >= best.distSq) continue;

      // Check validity
      if (!bridgeIntersectsContour(ip.x, ip.y, proj.x, proj.y, allContours, [island.id, mainland.id])) {
        best = { islandPt: ip, mainlandPt: { x: proj.x, y: proj.y }, distSq: proj.distSq };
      }
    }
  }

  return best ? { ...best, dist: Math.sqrt(best.distSq) } : null;
}

// ─── 6. Bridge polygon ────────────────────────────────────────────────────────

/**
 * Build a rectangular bridge polygon (4 points) of `width` between two points.
 * Returns Array<{x,y}>
 */
export function buildBridgePolygon(p1, p2, width) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  const nx = -dy / len * (width / 2);
  const ny =  dx / len * (width / 2);
  return [
    { x: p1.x + nx, y: p1.y + ny },
    { x: p2.x + nx, y: p2.y + ny },
    { x: p2.x - nx, y: p2.y - ny },
    { x: p1.x - nx, y: p1.y - ny },
  ];
}

// ─── 7. Boolean union ─────────────────────────────────────────────────────────

/** Convert points array to polygon-clipping ring [[x,y], ...] */
const toRing = (pts) => pts.map(p => [p.x, p.y]);

/** Convert polygon-clipping ring back to points */
const fromRing = (ring) => ring.map(([x, y]) => ({ x, y }));

/**
 * Merge a bridge rectangle into a contour using polygon-clipping union.
 * Returns the merged contour points (largest ring of the result).
 */
export function unionBridgeIntoContour(contourPts, bridgePts) {
  try {
    const result = polygonClipping.union(
      [toRing(contourPts)],
      [toRing(bridgePts)]
    );
    if (!result || result.length === 0) return contourPts;

    // Return the largest outer ring
    let best = contourPts;
    let bestArea = 0;
    for (const poly of result) {
      for (const ring of poly) {
        const pts = fromRing(ring);
        const a = polygonArea(pts);
        if (a > bestArea) { bestArea = a; best = pts; }
      }
    }
    return best;
  } catch {
    return contourPts;
  }
}

// ─── 8. Points → SVG path string ─────────────────────────────────────────────

export function pointsToPath(pts) {
  if (pts.length === 0) return '';
  const r = (n) => Math.round(n * 100) / 100;
  return (
    `M ${r(pts[0].x)} ${r(pts[0].y)} ` +
    pts.slice(1).map(p => `L ${r(p.x)} ${r(p.y)}`).join(' ') +
    ' Z'
  );
}

// ─── 9. Main entry point ──────────────────────────────────────────────────────

/**
 * Given an ImageTracer SVG string and bridge settings, return a new SVG string
 * with vector bridges injected and all geometry merged.
 *
 * @param {string}  svgString    - Raw SVG from ImageTracer
 * @param {number}  bridgeWidth  - Bridge rectangle width in pixels
 * @param {string}  fillColor    - Fill colour for stencil paths
 * @returns {string} Modified SVG string
 */
export function applyVectorBridges(svgString, bridgeWidth = 3, fillColor = 'black') {
  // Extract contours
  let contours = extractContours(svgString);
  if (contours.length <= 1) return svgString; // nothing to bridge

  // Remove background (white) shapes — ImageTracer often has a white rect/path
  // Already stripped in canvasToSVG, so all remaining shapes are stencil ink.

  // Classify: mainland = largest contour
  let mainlandIdx = 0;
  for (let i = 1; i < contours.length; i++) {
    if (contours[i].area > contours[mainlandIdx].area) mainlandIdx = i;
  }
  const mainland = contours[mainlandIdx];
  const islands = contours.filter((_, i) => i !== mainlandIdx);

  // Simplify
  const simplified = simplifyContours([mainland, ...islands], 1.5);
  const simplMainland = simplified[0];
  const simplIslands = simplified.slice(1);
  const allSimplified = simplified;

  // For each island, find and apply bridge
  const bridgedIslands = simplIslands.map(island => {
    const bridge = findBridge(island, simplMainland, allSimplified);
    if (!bridge) return island;

    const bridgePoly = buildBridgePolygon(bridge.islandPt, bridge.mainlandPt, bridgeWidth);
    if (!bridgePoly) return island;

    // Merge bridge into island
    const mergedIslandPts = unionBridgeIntoContour(island.points, bridgePoly);
    // Also merge into mainland so the bridge connects
    const mergedMainlandPts = unionBridgeIntoContour(simplMainland.points, bridgePoly);
    simplMainland.points = mergedMainlandPts;

    return { ...island, points: mergedIslandPts };
  });

  // Rebuild SVG: strip all <path> elements, re-inject merged geometry
  const viewBoxMatch = svgString.match(/viewBox="([^"]+)"/);
  const widthMatch = svgString.match(/width="([^"]+)"/);
  const heightMatch = svgString.match(/height="([^"]+)"/);

  const vb = viewBoxMatch ? `viewBox="${viewBoxMatch[1]}"` : '';
  const w = widthMatch ? `width="${widthMatch[1]}"` : '';
  const h = heightMatch ? `height="${heightMatch[1]}"` : '';

  const allPaths = [simplMainland, ...bridgedIslands]
    .map(c => `<path d="${pointsToPath(c.points)}" fill="${fillColor}" fill-rule="evenodd"/>`)
    .join('\n');

  // Preserve any non-path content (e.g. corner marker group already in svgString)
  const markerGroup = (() => {
    const m = svgString.match(/<g id="corner-markers">[\s\S]*?<\/g>/);
    return m ? m[0] : '';
  })();

  return `<svg xmlns="http://www.w3.org/2000/svg" ${vb} ${w} ${h}>\n${allPaths}\n${markerGroup}\n</svg>`;
}