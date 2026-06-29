import React, { useState } from 'react';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Download, RotateCcw, Layers, Palette, Crosshair, GitBranch, ScanSearch, Paintbrush, Ruler, Maximize2, Scissors, Sparkles, Droplets } from 'lucide-react';
import { downloadPNG } from '@/lib/stencilProcessor';
import ModeSelector from './ModeSelector';
import SvgExportDialog from './SvgExportDialog';
import KofiDialog from './KofiDialog';

export default function ControlsPanel({
  mode,
  onModeChange,
  numLayers,
  onNumLayersChange,
  detectedColors,
  whiteTolerance,
  onWhiteToleranceChange,
  blurRadius,
  onBlurRadiusChange,
  cleanupSize = 0,
  onCleanupSizeChange,
  bleedRadius = 1,
  onBleedRadiusChange,
  removeBackground: removeBackgroundEnabled,
  onRemoveBackgroundChange,
  removingBackground,
  bridgeIslands,
  onBridgeIslandsChange,
  bridgeWidth,
  onBridgeWidthChange,
  minIslandSize,
  onMinIslandSizeChange,
  cornerMarkers,
  onCornerMarkersChange,
  markerArmLength = 14,
  onMarkerArmLengthChange,
  markerArmWidth = 3,
  onMarkerArmWidthChange,
  markerMargin = 24,
  onMarkerMarginChange,
  colorizeRealistic,
  onColorizeRealisticChange,
  debugBridges,
  onDebugBridgesChange,
  layers,
  layerColors,
  onReset
}) {
  const [svgDialogOpen, setSvgDialogOpen] = useState(false);
  const [kofiOpen, setKofiOpen] = useState(false);

  const handleExportAllPng = () => {
    layers.forEach((layer, idx) => {
      setTimeout(() => {
        downloadPNG(layer.dataUrl, `stencil-layer-${String(idx + 1).padStart(2, '0')}.png`);
      }, idx * 250);
    });
    setTimeout(() => setKofiOpen(true), layers.length * 250 + 500);
  };

  return (
    <div className="space-y-5">
      {/* Mode */}
      <div className="space-y-2">
        <Label className="text-xs font-heading font-semibold uppercase tracking-wide text-muted-foreground">
          Stencil Mode
        </Label>
        <ModeSelector value={mode} onChange={onModeChange} />
      </div>

      <div className="h-px bg-border" />

      {/* Layer count */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-heading font-medium flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-primary" />
            {mode === 'cartoon' ? 'Colors' : 'Layers'}
          </Label>
          <span className="text-sm font-heading font-bold text-primary tabular-nums">
            {numLayers}
            {mode === 'cartoon' && detectedColors !== null && numLayers === detectedColors &&
            <span className="text-[9px] font-normal text-muted-foreground ml-1">(auto)</span>
            }
          </span>
        </div>
        {mode === 'realistic' &&
        <Slider
          value={[numLayers]}
          onValueChange={([v]) => onNumLayersChange(v)}
          min={2}
          max={12}
          step={1} />

        }
        {mode === 'cartoon' &&
        <Slider
          value={[numLayers]}
          onValueChange={([v]) => onNumLayersChange(v)}
          min={2}
          max={20}
          step={1} />

        }
        </div>

      {/* Detail / blur (realistic only) */}
      {mode === 'realistic' &&
      <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-heading font-medium flex items-center gap-1.5">
              <ScanSearch className="w-3.5 h-3.5 text-primary" />
              Detail
            </Label>
            <span className="text-sm font-heading font-bold text-primary tabular-nums">
              {blurRadius === 0 ? 'Max' : blurRadius <= 3 ? 'High' : blurRadius <= 6 ? 'Med' : 'Low'}
            </span>
          </div>
          <Slider
          value={[blurRadius]}
          onValueChange={([v]) => onBlurRadiusChange(v)}
          min={0}
          max={10}
          step={1} />
        
          

        
        </div>
      }

      {/* Cleanup (realistic only) */}
      {mode === 'realistic' &&
      <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-heading font-medium flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-primary" />
              Cleanup
            </Label>
            <span className="text-sm font-heading font-bold text-primary tabular-nums">
              {cleanupSize === 0 ? 'Off' : `${cleanupSize}px²`}
            </span>
          </div>
          <Slider
          value={[cleanupSize]}
          onValueChange={([v]) => onCleanupSizeChange(v)}
          min={0}
          max={80}
          step={5} />
        
          <p className="text-[10px] text-muted-foreground font-body leading-snug">
            Removes isolated specks and fills small holes smaller than this area.
          </p>
        </div>
      }

      {/* White tolerance (cartoon only) */}
      {mode === 'cartoon' &&
      <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-heading font-medium flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5 text-primary" />
              White Tolerance
            </Label>
            <span className="text-sm font-heading font-bold text-primary tabular-nums">
              {whiteTolerance}
            </span>
          </div>
          <Slider
          value={[whiteTolerance]}
          onValueChange={([v]) => onWhiteToleranceChange(v)}
          min={0}
          max={60}
          step={1} />
        
          <p className="text-[10px] text-muted-foreground font-body">
            Skip near-white pixels (background removal)
          </p>
        </div>
      }

      {/* Bleed (cartoon only) */}
      {mode === 'cartoon' &&
      <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-heading font-medium flex items-center gap-1.5">
              <Droplets className="w-3.5 h-3.5 text-primary" />
              Bleed
            </Label>
            <span className="text-sm font-heading font-bold text-primary tabular-nums">
              {bleedRadius === 0 ? 'Off' : `${bleedRadius}px`}
            </span>
          </div>
          <Slider
          value={[bleedRadius]}
          onValueChange={([v]) => onBleedRadiusChange(v)}
          min={0}
          max={4}
          step={1} />
        
          <p className="text-[10px] text-muted-foreground font-body leading-snug">
            Grows color layers outward to eliminate gaps between stencil layers. Black outline layer is unaffected.
          </p>
        </div>
      }

      <div className="h-px bg-border" />

      {/* Background Removal */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-heading font-medium flex items-center gap-1.5 cursor-pointer" htmlFor="bg-remove-toggle">
            <Scissors className="w-3.5 h-3.5 text-primary" />
            Remove Background
          </Label>
          <Switch
            id="bg-remove-toggle"
            checked={removeBackgroundEnabled}
            onCheckedChange={onRemoveBackgroundChange}
            disabled={removingBackground} />
          
        </div>
        {removingBackground &&
        <div className="flex items-center gap-2 text-[10px] text-primary font-body">
            <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin flex-shrink-0" />
            Removing background with AI… this may take a moment
          </div>
        }
        {!removingBackground &&
        <p className="text-[10px] text-muted-foreground font-body leading-snug">
            AI-powered background removal — runs locally in your browser.
          </p>
        }
      </div>

      {/* Bridge islands */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-heading font-medium flex items-center gap-1.5 cursor-pointer" htmlFor="bridge-toggle">
            <GitBranch className="w-3.5 h-3.5 text-primary" />
            Bridge Islands
          </Label>
          <Switch
            id="bridge-toggle"
            checked={bridgeIslands}
            onCheckedChange={onBridgeIslandsChange} />
          
        </div>
        

        
        {bridgeIslands &&
        <div className="space-y-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-[11px] text-muted-foreground">Bridge width</Label>
                <span className="text-xs font-heading font-bold text-primary tabular-nums">{bridgeWidth}px</span>
              </div>
              <Slider
              value={[bridgeWidth]}
              onValueChange={([v]) => onBridgeWidthChange(v)}
              min={1}
              max={6}
              step={1} />
            
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-[11px] text-muted-foreground">Min island size</Label>
                <span className="text-xs font-heading font-bold text-primary tabular-nums">{minIslandSize}px²</span>
              </div>
              <Slider
              value={[minIslandSize]}
              onValueChange={([v]) => onMinIslandSizeChange(v)}
              min={0}
              max={2000}
              step={50} />
            
              <p className="text-[10px] text-muted-foreground font-body">
                Islands smaller than this are ignored (no bridge drawn)
              </p>
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-[11px] text-muted-foreground cursor-pointer" htmlFor="debug-bridge-toggle">
                Debug bridges
              </Label>
              <Switch
              id="debug-bridge-toggle"
              checked={debugBridges}
              onCheckedChange={onDebugBridgesChange} />
            
            </div>
            {debugBridges &&
          <p className="text-[10px] text-muted-foreground font-body">
                Blue = candidates · Green = selected bridges
              </p>
          }
          </div>
        }
      </div>

      {/* Corner markers - with size, thickness, margin controls (no color picker) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-heading font-medium flex items-center gap-1.5 cursor-pointer" htmlFor="corner-toggle">
            <Crosshair className="w-3.5 h-3.5 text-primary" />
            Corner Markers
          </Label>
          <Switch
            id="corner-toggle"
            checked={cornerMarkers}
            onCheckedChange={onCornerMarkersChange} />
          
        </div>
        

        

        {/* Advanced corner marker controls - only show when enabled */}
        {cornerMarkers &&
        <div className="space-y-3 pl-2 border-l-2 border-primary/20 mt-2">
            {/* Marker Size (Arm Length) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Ruler className="w-3 h-3" />
                  Marker Size
                </Label>
                <span className="text-xs font-heading font-bold text-primary tabular-nums">{markerArmLength}px</span>
              </div>
              <Slider
              value={[markerArmLength]}
              onValueChange={([v]) => onMarkerArmLengthChange(v)}
              min={8}
              max={40}
              step={1} />
            
              

            
            </div>

            {/* Line Thickness (Arm Width) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Maximize2 className="w-3 h-3" />
                  Line Thickness
                </Label>
                <span className="text-xs font-heading font-bold text-primary tabular-nums">{markerArmWidth}px</span>
              </div>
              <Slider
              value={[markerArmWidth]}
              onValueChange={([v]) => onMarkerArmWidthChange(v)}
              min={1}
              max={8}
              step={1} />
            
              

            
            </div>

            {/* Margin from Edge */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-[11px] text-muted-foreground">Margin from Edge</Label>
                <span className="text-xs font-heading font-bold text-primary tabular-nums">{markerMargin}px</span>
              </div>
              <Slider
              value={[markerMargin]}
              onValueChange={([v]) => onMarkerMarginChange(v)}
              min={10}
              max={80}
              step={2} />
            
              

            
            </div>
          </div>
        }
      </div>

      {/* Colorize realistic (realistic mode only) */}
      {mode === 'realistic' &&
      <>
          <div className="flex items-center justify-between">
            <Label className="text-xs font-heading font-medium flex items-center gap-1.5 cursor-pointer" htmlFor="colorize-toggle">
              <Paintbrush className="w-3.5 h-3.5 text-primary" />
              Image Colors
            </Label>
            <Switch
            id="colorize-toggle"
            checked={colorizeRealistic}
            onCheckedChange={onColorizeRealisticChange} />
          
          </div>
          <p className="text-[10px] text-muted-foreground font-body -mt-2 leading-snug">
            Samples colors from the original image instead of using black — each tonal layer carries its true hue.
          </p>
        </>
      }

      <div className="h-px bg-border" />

      {/* Export */}
      <div className="space-y-2">
        <Label className="text-xs font-heading font-semibold uppercase tracking-wide text-muted-foreground">
          Export All Layers
        </Label>
        <Button
          onClick={() => setSvgDialogOpen(true)}
          className="w-full justify-start gap-2 text-xs h-8"
          size="sm"
          disabled={layers.length === 0}>
          
          <Download className="w-3.5 h-3.5" />
          All as SVG (vectors)
        </Button>
        <Button
          onClick={handleExportAllPng}
          variant="outline"
          className="w-full justify-start gap-2 text-xs h-8"
          size="sm"
          disabled={layers.length === 0}>
          
          <Download className="w-3.5 h-3.5" />
          All as PNG
        </Button>
      </div>

      <KofiDialog open={kofiOpen} onOpenChange={setKofiOpen} />

      <SvgExportDialog
        open={svgDialogOpen}
        onOpenChange={setSvgDialogOpen}
        layers={layers}
        mode={mode}
        layerColors={layerColors}
        cornerMarkers={cornerMarkers}
        markerArmLength={markerArmLength}
        markerArmWidth={markerArmWidth}
        markerMargin={markerMargin}
        bridgeIslands={bridgeIslands}
        bridgeWidth={bridgeWidth} />
      

      <Button
        onClick={onReset}
        variant="ghost"
        className="w-full justify-start gap-2 text-xs h-8 text-muted-foreground">
        
        <RotateCcw className="w-3.5 h-3.5" />
        Start Over
      </Button>
    </div>);

}