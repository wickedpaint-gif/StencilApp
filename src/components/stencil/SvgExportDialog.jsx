import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Download, Link, Unlink } from 'lucide-react';
import { canvasToSVG, downloadSVG } from '@/lib/stencilProcessor';
import KofiDialog from './KofiDialog';

function applySvgDimensions(svgString, widthMm, heightMm) {
  return svgString
    .replace(/(<svg[^>]*)\swidth="[^"]*"/, `$1 width="${widthMm}mm"`)
    .replace(/(<svg[^>]*)\sheight="[^"]*"/, `$1 height="${heightMm}mm"`);
}

export default function SvgExportDialog({ open, onOpenChange, layers, cornerMarkers, markerArmLength, markerArmWidth, markerMargin, bridgeIslands, bridgeWidth, layerColors, mode }) {
  const [widthMm, setWidthMm] = useState('');
  const [heightMm, setHeightMm] = useState('');
  const [linked, setLinked] = useState(true);
  const [kofiOpen, setKofiOpen] = useState(false);

  const aspectRatio = layers[0]?.canvas
    ? layers[0].canvas.width / layers[0].canvas.height
    : null;

  const handleWidthChange = (val) => {
    setWidthMm(val);
    if (linked && aspectRatio && val !== '') {
      const w = parseFloat(val);
      if (!isNaN(w) && w > 0) setHeightMm(String(Math.round(w / aspectRatio)));
    }
  };

  const handleHeightChange = (val) => {
    setHeightMm(val);
    if (linked && aspectRatio && val !== '') {
      const h = parseFloat(val);
      if (!isNaN(h) && h > 0) setWidthMm(String(Math.round(h * aspectRatio)));
    }
  };

  const handleExport = () => {
    layers.forEach((layer, idx) => {
      setTimeout(() => {
        let inkColor = '#000000';
        if (mode === 'cartoon') {
          inkColor = layer.paletteColor || '#000000';
        } else if (layerColors && layerColors[idx]) {
          inkColor = layerColors[idx];
        }

        let svg = canvasToSVG(layer.canvas, inkColor, {
          cornerMarkers,
          markerSize: markerArmLength,
          markerThickness: markerArmWidth,
          markerMargin,
          markerColor: 'black',
        });

        const w = parseFloat(widthMm);
        const h = parseFloat(heightMm);
        if (w > 0 && h > 0) {
          svg = applySvgDimensions(svg, w, h);
        }

        downloadSVG(svg, `stencil-layer-${String(idx + 1).padStart(2, '0')}.svg`);
      }, idx * 250);
    });
    onOpenChange(false);
    // Show Ko-fi donation prompt after all downloads have kicked off
    setTimeout(() => setKofiOpen(true), layers.length * 250 + 500);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading text-sm">Export All Layers as SVG</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <p className="text-[11px] text-muted-foreground font-body leading-snug">
              Optionally set physical print dimensions in millimetres. Leave blank to keep pixel dimensions.
            </p>

            <div className="flex items-end gap-2">
              <div className="space-y-1.5 flex-1">
                <Label className="text-xs font-body">Width (mm)</Label>
                <Input
                  type="number"
                  min="1"
                  placeholder="e.g. 210"
                  value={widthMm}
                  onChange={(e) => handleWidthChange(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>

              <button
                type="button"
                onClick={() => setLinked(l => !l)}
                className={`mb-0.5 p-1.5 rounded-md border transition-colors ${linked ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}
                title={linked ? 'Unlink dimensions' : 'Link dimensions (keep ratio)'}
              >
                {linked ? <Link className="w-3.5 h-3.5" /> : <Unlink className="w-3.5 h-3.5" />}
              </button>

              <div className="space-y-1.5 flex-1">
                <Label className="text-xs font-body">Height (mm)</Label>
                <Input
                  type="number"
                  min="1"
                  placeholder="e.g. 297"
                  value={heightMm}
                  onChange={(e) => handleHeightChange(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            </div>

            <p className="text-[10px] text-muted-foreground font-body">
              Common sizes: A4 = 210 × 297 mm · A3 = 297 × 420 mm · Letter = 216 × 279 mm
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="text-xs h-8">
              Cancel
            </Button>
            <Button size="sm" onClick={handleExport} className="text-xs h-8 gap-1.5">
              <Download className="w-3.5 h-3.5" />
              Download {layers.length} SVG{layers.length !== 1 ? 's' : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <KofiDialog open={kofiOpen} onOpenChange={setKofiOpen} />
    </>
  );
}