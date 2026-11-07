import React, { useEffect, useRef } from 'react';
import { burnCornerMarkers } from '@/lib/islandBridge';

/**
 * Renders one stencil layer as a coloured canvas with a transparent background.
 * Shared by the layer cards (thumbnail) and the main preview (enlarged), so an
 * inspected layer looks exactly like its thumbnail — no extra processing pass.
 *
 * Set `previewColor` on the layer for realistic layers that are not colorized,
 * and `colorOverride` for a user-picked colour in colorize mode.
 */
export default function LayerMaskCanvas({ layer, className = '', dimHidden = true }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const out = canvasRef.current;
    if (!out || !layer.canvas) return;

    // Work on a copy so we don't mutate the original canvas
    const src = document.createElement('canvas');
    src.width = layer.canvas.width;
    src.height = layer.canvas.height;
    src.getContext('2d').drawImage(layer.canvas, 0, 0);

    // Burn markers onto the copy for preview only
    if (layer.addCornerMarkers && layer.markerOptions) {
      const mo = layer.markerOptions;
      burnCornerMarkers(src, mo.armLength, mo.armWidth, mo.margin, mo.color);
    }

    out.width = src.width;
    out.height = src.height;

    const ctx = out.getContext('2d');

    const srcCtx = src.getContext('2d');
    const imgData = srcCtx.getImageData(0, 0, src.width, src.height);
    const outData = ctx.createImageData(src.width, src.height);

    const isRealistic = layer.mode === 'realistic';

    // Parse cartoon palette color
    let pr = 0, pg = 0, pb = 0;

    if (!isRealistic && layer.paletteColor) {
      const hex = layer.paletteColor.replace('#', '');

      pr = parseInt(hex.slice(0, 2), 16);
      pg = parseInt(hex.slice(2, 4), 16);
      pb = parseInt(hex.slice(4, 6), 16);
    }

    for (let i = 0; i < src.width * src.height; i++) {
      const a = imgData.data[i * 4 + 3];

      if (isRealistic) {
        if (a > 0) {
          if (layer.colorized) {
            if (layer.colorOverride) {
              // User overrode this layer's color in colorize mode
              const hex = layer.colorOverride.replace('#', '');
              outData.data[i * 4]     = parseInt(hex.slice(0, 2), 16) || 0;
              outData.data[i * 4 + 1] = parseInt(hex.slice(2, 4), 16) || 0;
              outData.data[i * 4 + 2] = parseInt(hex.slice(4, 6), 16) || 0;
            } else {
              // Show actual image color sampled into the canvas
              outData.data[i * 4]     = imgData.data[i * 4];
              outData.data[i * 4 + 1] = imgData.data[i * 4 + 1];
              outData.data[i * 4 + 2] = imgData.data[i * 4 + 2];
            }
          } else {
            // Use selected swatch color instead of black
            const hex = (layer.previewColor || '#333').replace('#', '');

            outData.data[i * 4]     = parseInt(hex.slice(0, 2), 16);
            outData.data[i * 4 + 1] = parseInt(hex.slice(2, 4), 16);
            outData.data[i * 4 + 2] = parseInt(hex.slice(4, 6), 16);
          }

          // Preserve original alpha for smooth transparency
          outData.data[i * 4 + 3] = a;
        } else {
          // Fully transparent outside stencil area
          outData.data[i * 4]     = 0;
          outData.data[i * 4 + 1] = 0;
          outData.data[i * 4 + 2] = 0;
          outData.data[i * 4 + 3] = 0;
        }
      } else {
        // Cartoon: opaque = palette color, transparent = background
        outData.data[i * 4]     = pr;
        outData.data[i * 4 + 1] = pg;
        outData.data[i * 4 + 2] = pb;
        outData.data[i * 4 + 3] = a > 128 ? 255 : 0;
      }
    }

    ctx.putImageData(outData, 0, 0);
  }, [layer.canvas, layer.dataUrl, layer.colorized, layer.previewColor, layer.colorOverride, layer.addCornerMarkers, layer.markerOptions]);

  return (
    <canvas
      ref={canvasRef}
      className={`${className} ${dimHidden && !layer.visible ? 'opacity-20' : 'opacity-100'} transition-opacity duration-200`}
      style={{ imageRendering: 'auto' }}
    />
  );
}