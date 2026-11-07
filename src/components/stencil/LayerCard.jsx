import React from 'react';
import { motion } from 'framer-motion';
import { Eye, EyeOff, Download, Maximize2 } from 'lucide-react';
import LayerMaskCanvas from './LayerMaskCanvas';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { canvasToSVG, downloadSVG, downloadPNG, renderColoredCanvas } from '@/lib/stencilProcessor';
import { burnCornerMarkers } from '@/lib/islandBridge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

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
  colorOverride = null,
  // Inspecting a layer in the main preview
  selected = false,
  onSelect,
}) {
  // Determine the swatch color
  let swatchColor = '#333';

  if (layer.mode === 'cartoon') {
    swatchColor = layer.paletteColor || '#333';
  } else {
    swatchColor = (layerColors && layerColors[index]) || '#333';
  }

  // Clicking the card inspects this layer in the main preview; clicking it
  // again returns to the stacked view. Controls inside the card are ignored.
  const handleCardClick = (e) => {
    if (!onSelect) return;
    if (e.target.closest('button, input, a, [role="slider"]')) return;
    onSelect(index);
  };

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
    const copy = renderColoredCanvas(layer.canvas, {
      mode: layer.mode,
      colorized: layer.colorized,
      paletteColor: layer.paletteColor,
      swatchColor,
    });

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
      onClick={handleCardClick}
      title="Click to view this layer in the preview"
      className={`group relative bg-card rounded-xl border overflow-hidden transition-all duration-200 cursor-pointer ${
        selected
          ? 'border-primary ring-2 ring-primary/30 shadow-sm'
          : 'border-border hover:border-primary/30 hover:shadow-sm'
      }`}
    >
      {/* Thumbnail - markers are now burned into the canvas, no overlay needed */}
      <div className="relative aspect-square bg-[repeating-conic-gradient(hsl(220,12%,88%)_0%_25%,white_0%_50%)] bg-[length:14px_14px]">
        <LayerMaskCanvas
          layer={{
            ...layer,
            previewColor: swatchColor,
            colorOverride
          }}
          className="w-full h-full object-contain"
        />

        {/* Hover hint */}
        {!selected && (
          <div className="absolute inset-0 flex items-end justify-center pb-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            <span className="flex items-center gap-1 text-[9px] font-body bg-card/95 border border-border rounded-full px-2 py-0.5 shadow-sm">
              <Maximize2 className="w-2.5 h-2.5" />
              View
            </span>
          </div>
        )}

        {/* Selected badge */}
        {selected && (
          <div className="absolute top-1.5 right-1.5 flex items-center gap-1 text-[9px] font-heading font-semibold bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 shadow">
            <Maximize2 className="w-2.5 h-2.5" />
            Viewing
          </div>
        )}

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
          <div className="mt-2 space-y-1" onClick={(e) => e.stopPropagation()}>
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