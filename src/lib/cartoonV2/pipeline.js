/**
 * Cartoon V2 — pipeline orchestrator.
 *
 *   input → quality assessment → adaptive preparation → outline/edge maps →
 *   SLIC superpixels → region adjacency graph + merging → colour reduction →
 *   stencil geometry simplification → binary masks (assembled by the caller)
 *
 * Everything is cached per source image in tiers, so a change only re-runs the
 * work that genuinely depends on it:
 *   stages   — quality, preparation, edges, SLIC, region graph
 *              (invalidated by a new image, Edge Smoothing, Region Simplification)
 *   colour   — palette + label map (invalidated by the colour count)
 *   geometry — cut geometry (invalidated by Detail Removal / simplification)
 * Bleed, bridging and corner markers are applied by the assembly step, so they
 * never touch this module at all.
 */

import { assessImageQuality } from './quality.js';
import { bilateralFilter } from './prepare.js';
import { computeEdgeMaps, lumaFromRGBA } from './edges.js';
import { computeSLIC } from './slic.js';
import { buildRegionGraph } from './rag.js';
import { reduceToPalette } from './reduce.js';
import { simplifyLabelMap } from './geometry.js';
import { deriveV2Params } from './settings.js';
import {
  snapshotRGBA,
  snapshotProtection,
  snapshotLabels,
  hashedLabelColour,
} from './debugStages.js';

const stageCache = new WeakMap();

function runStages(rawData, width, height, ui, debug) {
  const n = width * height;

  const quality = assessImageQuality(rawData, width, height);
  const params = deriveV2Params(quality, ui);

  // Transparency comes from the source image itself — either an already
  // transparent PNG or the alpha the background remover returned. There is no
  // colour-based background guessing anywhere in this engine.
  const prep = bilateralFilter(rawData.data, width, height, params.prepRadius, params.sigmaR);
  const luma = lumaFromRGBA(prep, n);
  const { protection } = computeEdgeMaps(luma, width, height);
  const slic = computeSLIC(
    prep,
    luma,
    width,
    height,
    params.targetSuperpixels,
    params.compactness,
    params.iterations
  );

  const snapshots = debug
    ? {
        original: snapshotRGBA(rawData.data, width, height),
        prepared: snapshotRGBA(prep, width, height),
        outline: snapshotProtection(protection, width, height),
        slic: snapshotLabels(slic.labels, width, height, hashedLabelColour),
      }
    : null;

  const graph = buildRegionGraph(
    slic.labels,
    slic.count,
    prep,
    protection,
    width,
    height,
    params.maxCost,
    params.targetRegions
  );

  return { quality, graph, snapshots };
}

export function buildCartoonV2Segments(rawData, width, height, numColors, opts = {}) {
  const {
    edgeSmoothing = 'low',
    detailRemoval = 10,
    regionSimplification = 'medium',
    cacheToken = null,
    debug = false,
  } = opts;

  const ui = { numColors, edgeSmoothing, detailRemoval, regionSimplification };
  const stageSig = `${edgeSmoothing}|${regionSimplification}|${debug ? 1 : 0}`;

  let entry = cacheToken ? stageCache.get(cacheToken) : null;
  if (!entry || entry.stageSig !== stageSig) {
    entry = runStages(rawData, width, height, ui, debug);
    entry.stageSig = stageSig;
    entry.colour = null;
    entry.geometry = null;
    if (cacheToken) stageCache.set(cacheToken, entry);
  }

  const { graph, quality, snapshots } = entry;
  const geometry = deriveV2Params(quality, ui);

  // ── Colour reduction (depends on the region graph + colour count only) ─────
  let colour = entry.colour;
  if (!colour || colour.key !== String(numColors)) {
    colour = {
      key: String(numColors),
      ...reduceToPalette(
        graph.regionOfPixel,
        graph.regionCount,
        graph.rArea,
        graph.rR,
        graph.rG,
        graph.rB,
        graph.rLab,
        numColors
      ),
    };
    if (cacheToken) entry.colour = colour;
  }

  // ── Cut geometry (depends on the label map + simplification settings) ─────
  const geomKey = `${colour.key}|${geometry.smoothPasses}|${geometry.smoothVotes}|${geometry.minArea}|${geometry.holeArea}`;
  let cut = entry.geometry;
  if (!cut || cut.key !== geomKey) {
    // simplifyLabelMap works on a private buffer whenever smoothing runs, so the
    // cached label map stays pristine for the next geometry key.
    const input = geometry.smoothPasses > 0 ? colour.labelMap : Int16Array.from(colour.labelMap);
    cut = {
      key: geomKey,
      labels: simplifyLabelMap(input, width, height, colour.palette.length, {
        smoothPasses: geometry.smoothPasses,
        smoothVotes: geometry.smoothVotes,
        minArea: geometry.minArea,
        holeArea: geometry.holeArea,
      }),
    };
    if (cacheToken) entry.geometry = cut;
  }

  const palette = colour.palette;
  const labels = cut.labels;

  let stages = null;
  if (debug && snapshots) {
    const paletteRgb = (l) =>
      palette[l] ? [palette[l].r, palette[l].g, palette[l].b] : [255, 255, 255];

    stages = [
      { key: 'original', label: '1 · Original', ...snapshots.original },
      { key: 'prepared', label: '2 · Prepared', ...snapshots.prepared },
      { key: 'outline', label: '3 · Outlines', ...snapshots.outline },
      { key: 'slic', label: '4 · Superpixels', ...snapshots.slic },
      {
        key: 'merged',
        label: '5 · Merged regions',
        ...snapshotLabels(graph.regionOfPixel, width, height, hashedLabelColour),
      },
      { key: 'reduced', label: '6 · Reduced colours', ...snapshotLabels(colour.labelMap, width, height, paletteRgb) },
      { key: 'final', label: '7 · Final layers', ...snapshotLabels(labels, width, height, paletteRgb) },
    ];
  }

  return { labels, palette, stages, quality };
}