/**
 * Cartoon V2 — public entry point.
 *
 * Produces the exact same layer objects as Cartoon V1 (binary masks, palette
 * colour, luminance ordering, bleed, smart bridging, corner markers) by reusing
 * the existing Cartoon assembly step, so previews and every export path keep
 * working untouched.
 */

import { assembleCartoonLayers } from '@/lib/stencilProcessor';
import { buildCartoonV2Segments } from './pipeline.js';

export function generateCartoonV2Layers(rawData, width, height, numColors, opts = {}) {
  const { labels, palette, stages, quality } = buildCartoonV2Segments(
    rawData,
    width,
    height,
    numColors,
    opts
  );

  const layers = palette.length
    ? assembleCartoonLayers({
        labels,
        palette,
        width,
        height,
        bridgeIslands: opts.bridgeIslands,
        bridgeWidth: opts.bridgeWidth,
        cornerMarkers: opts.cornerMarkers,
        markerOptions: opts.markerOptions,
        minIslandSize: opts.minIslandSize,
        bleedRadius: opts.bleedRadius,
      })
    : [];

  return { layers, stages: stages || [], quality };
}