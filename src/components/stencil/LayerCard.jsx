import React, { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Eye, EyeOff, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { canvasToSVG, downloadSVG, downloadPNG, getRealisticLayerColors } from '@/lib/stencilProcessor';
import { burnCornerMarkers } from '@/lib/islandBridge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

function WhiteMaskThumbnail({ layer }) {
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
            // Show actual image color sampled into the canvas
            outData.data[i * 4]     = imgData.data[i * 4];
            outData.data[i * 4 + 1] = imgData.data[i * 4 + 1];
            outData.data[i * 4 + 2] = imgData.data[i * 4 + 2];
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
  }, [layer.canvas, layer.dataUrl, layer.colorized, layer.previewColor, layer.addCornerMarkers, layer.markerOptions]);

  return (
    <canvas
      ref={canvasRef}
      className={`w-full h-full object-contain transition-opacity duration-200 ${
        layer.visible ? 'opacity-100' : 'opacity-20'
      }`}
      style={{ imageRendering: 'auto' }}
    />
  );
}

export default function LayerCard({
  layer,
  index,
  totalLayers,
  onToggleVisibility,
  cornerMarkers = true,
  layerThreshold,
  onThresholdChange,
  onMerge,
  layerColors,
  onColorChange,
  // Add marker customization props for export
  markerArmLength = 14,
  markerArmWidth = 3,
  markerMargin = 24,
  markerColor = 'black',
  bridgeIslands = false,
  bridgeWidth = 3,
}) {
  // Determine the swatch color
  let swatchColor = '#333';

  if (layer.mode === 'cartoon') {
    swatchColor = layer.paletteColor || '#333';
  } else {
    swatchColor = (layerColors && layerColors[index]) || '#333';
  }

  const handleExportSVG = () => {
    const useMarkers = layer.addCornerMarkers ?? cornerMarkers;

    // Use the layer's swatch color as the SVG fill color
    const svg = canvasToSVG(
      layer.canvas,
      swatchColor,
      {
        cornerMarkers: useMarkers,
        markerMargin: markerMargin,
        markerSize: markerArmLength,
        markerThickness: markerArmWidth,
        markerColor: markerColor,
      }
    );

    downloadSVG(
      svg,
      `stencil-${layer.mode}-layer-${index + 1}.svg`
    );
  };

  const handleExportPNG = () => {
    const copy = document.createElement('canvas');
    copy.width = layer.canvas.width;
    copy.height = layer.canvas.height;
    copy.getContext('2d').drawImage(layer.canvas, 0, 0);

    if (layer.addCornerMarkers) {
      burnCornerMarkers(copy, markerArmLength, markerArmWidth, markerMargin, markerColor);
    }

    downloadPNG(copy.toDataURL('image/png'), `stencil-${layer.mode}-layer-${index + 1}.png`);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06 }}
      className="group relative bg-card rounded-xl border border-border overflow-hidden hover:border-primary/30 transition-all duration-200 hover:shadow-sm"
    >
      {/* Thumbnail - markers are now burned into the canvas, no overlay needed */}
      <div className="relative aspect-square bg-[repeating-conic-gradient(hsl(220,12%,88%)_0%_25%,white_0%_50%)] bg-[length:14px_14px]">
        <WhiteMaskThumbnail
          layer={{
            ...layer,
            previewColor: swatchColor
          }}
        />

        {/* REMOVED: Old red corner marker overlay - now handled by canvas directly */}

        {!layer.visible && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/10">
            <span className="text-[10px] font-body text-foreground bg-card/90 px-2 py-0.5 rounded-full">
              Hidden
            </span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-2.5">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5">

            {layer.mode === 'realistic' && onColorChange && (
              <input
                type="color"
                value={swatchColor}
                onChange={(e) => onColorChange(index, e.target.value)}
                className="w-4 h-4 rounded-full border-0 cursor-pointer"
              />
            )}

            {layer.mode !== 'realistic' && (
              <div
                className="w-3 h-3 rounded-full border border-border/60 flex-shrink-0"
                style={{ backgroundColor: swatchColor }}
              />
            )}

            <span className="text-xs font-heading font-semibold truncate">
              {layer.name}
            </span>
          </div>

          <div className="flex items-center gap-0.5">

            {(index === 0 || index === 1) && onMerge && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-primary"
                onClick={() => onMerge(index)}
                title={index === 0
                  ? "Merge L1 into L0 (black base)"
                  : "Merge L0 into L1"}
              >
                <div className="w-3 h-3 border border-current rounded-sm" />
              </Button>
            )}

            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => onToggleVisibility(layer.id)}
            >
              {layer.visible
                ? <Eye className="w-3 h-3" />
                : <EyeOff className="w-3 h-3 text-muted-foreground" />
              }
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6">
                  <Download className="w-3 h-3" />
                </Button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="end" className="text-xs">
                <DropdownMenuItem
                  onClick={handleExportSVG}
                  className="text-xs"
                >
                  Export as SVG (vector)
                </DropdownMenuItem>

                <DropdownMenuItem
                  onClick={handleExportPNG}
                  className="text-xs"
                >
                  Export as PNG
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <p className="text-[9px] text-muted-foreground font-body truncate leading-tight">
          {layer.description}
        </p>

        {/* Per-layer threshold slider for realistic mode (skip index 1, shares with 0) */}
        {onThresholdChange && layerThreshold !== undefined && index !== 1 && (
          <div className="mt-2 space-y-1">
            <div className="flex items-center justify-between">

              <span className="text-[9px] text-muted-foreground font-body">
                {index === 0
                  ? 'Threshold (L1 & L2)'
                  : 'Threshold'}
              </span>

              <span className="text-[9px] font-heading font-bold text-primary tabular-nums">
                {layerThreshold}
              </span>
            </div>

            <Slider
              value={[layerThreshold]}
              onValueChange={([v]) => onThresholdChange(v)}
              min={1}
              max={254}
              step={1}
            />
          </div>
        )}
      </div>
    </motion.div>
  );
}