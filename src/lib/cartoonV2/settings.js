/**
 * Cartoon V2 — parameter derivation.
 *
 * Translates the existing Cartoon controls + the measured image quality into
 * engine parameters. Keeping this in one place means the UI contract stays the
 * same as Cartoon V1 (Colors, Edge Smoothing, Detail Removal, Region
 * Simplification, Bleed, Bridges, Markers) while the internals differ.
 */

export function deriveV2Params(quality, { numColors, edgeSmoothing, detailRemoval, regionSimplification }) {
  const n = quality.pixels;

  // ── Preparation strength ──────────────────────────────────────────────────
  const radiusBySmoothing = { off: 1, low: 2, medium: 3 };
  const prepRadius = radiusBySmoothing[edgeSmoothing] ?? 2;
  let sigmaR = prepRadius === 3 ? 34 : prepRadius === 2 ? 26 : 16;
  if (quality.level === 'low') sigmaR *= 1.2;
  else if (quality.level === 'high') sigmaR *= 0.85;

  // ── Superpixel sizing ─────────────────────────────────────────────────────
  // ~1 superpixel per 320px keeps the graph manageable without merging blobs
  // of unrelated detail together before colour reduction.
  const targetSuperpixels = Math.round(Math.min(55000, Math.max(800, n / 320)));
  const compactness = quality.level === 'low' ? 20 : quality.level === 'high' ? 12 : 15;
  const iterations = n > 8e6 ? 4 : n > 3e6 ? 5 : 7;

  // ── Region merging aggressiveness ─────────────────────────────────────────
  const costBySimplification = { off: 9, low: 14, medium: 20, high: 27 };
  const maxCost = costBySimplification[regionSimplification] ?? 20;
  // Safety cap only: merging normally stops on cost. Kept independent of the
  // layer count so changing Colors never invalidates the cached stages.
  const targetRegions = 320;

  // ── Cuttable geometry ─────────────────────────────────────────────────────
  const smoothPassesBySimplification = { off: 1, low: 1, medium: 2, high: 3 };
  const smoothPasses = smoothPassesBySimplification[regionSimplification] ?? 2;

  const minWidth = Math.max(0, Math.round(detailRemoval || 0));
  const minArea = minWidth > 0 ? minWidth * minWidth : 0;
  const holeArea = minArea > 0 ? Math.max(minArea, 24) : 0;
  const smoothVotes = minWidth >= 4 ? 5 : minWidth >= 2 ? 4 : 3;

  return {
    prepRadius,
    sigmaR,
    targetSuperpixels,
    compactness,
    iterations,
    maxCost,
    targetRegions,
    smoothPasses,
    smoothVotes,
    minArea,
    holeArea,
  };
}