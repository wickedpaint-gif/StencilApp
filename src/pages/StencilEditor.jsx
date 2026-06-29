import React, { useState, useCallback, useEffect, useRef } from 'react';
import { removeBackground } from '@/services/backgroundRemoval';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Layers, ArrowLeft, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Logo from "@/assets/Logo.png";

import ImageUploader from '@/components/stencil/ImageUploader';
import CompositePreview from '@/components/stencil/CompositePreview';
import LayerCard from '@/components/stencil/LayerCard';
import ControlsPanel from '@/components/stencil/ControlsPanel';

import {
  imageToGrayscaleData,
  generateRealisticLayers,
  generateCartoonLayers,
  generateComposite,
  estimateColorCount,
  defaultRealisticThresholds,
  getPresetColors } from
'@/lib/stencilProcessor';

export default function StencilEditor() {
  const [originalUrl, setOriginalUrl] = useState(null);
  const [imageData, setImageData] = useState(null); // { grayscale, rawData, width, height }
  const [layers, setLayers] = useState([]);
  const [compositeUrl, setCompositeUrl] = useState(null);
  const [mode, setMode] = useState('realistic');
  const [numLayers, setNumLayers] = useState(4);
  const [detectedColors, setDetectedColors] = useState(null);
  const [layerThresholds, setLayerThresholds] = useState(() => defaultRealisticThresholds(4));
  const [layerColors, setLayerColors] = useState(() => getPresetColors(4));
  const [whiteTolerance, setWhiteTolerance] = useState(15);
  const [bridgeIslands, setBridgeIslands] = useState(false);
  const [bridgeWidth, setBridgeWidth] = useState(2);
  const [minIslandSize, setMinIslandSize] = useState(200);
  const [cornerMarkers, setCornerMarkers] = useState(true);
  const [colorizeRealistic, setColorizeRealistic] = useState(false);
  const [blurRadius, setBlurRadius] = useState(0);
  const [cleanupSize, setCleanupSize] = useState(0);
  const [bleedRadius, setBleedRadius] = useState(1);
  const [debugBridges, setDebugBridges] = useState(false);
  const [removeBg, setRemoveBg] = useState(false);
  const [removingBg, setRemovingBg] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const debounceRef = useRef(null);
  const originalImageRef = useRef(null); // stores the original img element

  // New corner marker customization states
  const [markerArmLength, setMarkerArmLength] = useState(14);
  const [markerArmWidth, setMarkerArmWidth] = useState(3);
  const [markerMargin, setMarkerMargin] = useState(24);
  const [markerColor, setMarkerColor] = useState('black');

  // Compute marker scale factor: 500px baseline, scales linearly with image width
  const markerScale = imageData ? Math.max(1, imageData.width / 500) : 1;
  const scaledMarkerArmLength = Math.round(markerArmLength * markerScale);
  const scaledMarkerArmWidth = Math.max(1, Math.round(markerArmWidth * markerScale));
  const scaledMarkerMargin = Math.round(markerMargin * markerScale);

  const handleImageLoad = useCallback((img, dataUrl) => {
    setOriginalUrl(dataUrl);
    originalImageRef.current = img;
    setRemoveBg(false);
    const data = imageToGrayscaleData(img);
    setImageData(data);
    const detected = estimateColorCount(data.rawData, whiteTolerance);
    setDetectedColors(detected);
    if (mode === 'cartoon') setNumLayers(detected);
  }, [mode, whiteTolerance]);

  // Pick up image passed from Home page via sessionStorage
  useEffect(() => {
    const stored = sessionStorage.getItem('sf_initial_image_url');
    if (!stored) return;
    sessionStorage.removeItem('sf_initial_image_url');
    const img = new Image();
    img.onload = () => handleImageLoad(img, stored);
    img.src = stored;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRemoveBgToggle = useCallback(async (enabled) => {
    setRemoveBg(enabled);
    if (!enabled) {
      // Restore original image
      const img = originalImageRef.current;
      if (img) {
        const data = imageToGrayscaleData(img);
        setImageData(data);
        const detected = estimateColorCount(data.rawData, whiteTolerance);
        setDetectedColors(detected);
        if (mode === 'cartoon') setNumLayers(detected);
      }
      return;
    }
    // Run background removal via Photoroom proxy
    setRemovingBg(true);
    setError(null);

    const originalDataUrl = originalImageRef.current?.src || originalUrl;
    const result = await removeBackground(originalDataUrl);

    if (!result.success) {
      setError(result.error || 'Background removal failed. You can continue without it.');
      setRemoveBg(false);
      setRemovingBg(false);
      return;
    }

    const img = new Image();
    img.onload = () => {
      const data = imageToGrayscaleData(img);
      setImageData(data);
      const detected = estimateColorCount(data.rawData, whiteTolerance);
      setDetectedColors(detected);
      if (mode === 'cartoon') setNumLayers(detected);
      setRemovingBg(false);
    };
    img.onerror = () => {
      setError('Background removal failed — the processed image could not be loaded. Try again.');
      setRemoveBg(false);
      setRemovingBg(false);
    };
    img.src = result.imageUrl;
  }, [originalUrl, whiteTolerance, mode]);

  // Debounced re-generation when any setting changes
  useEffect(() => {
    if (!imageData) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      setProcessing(true);
      setError(null);

      // Use setTimeout so React renders the "processing" state first
      setTimeout(() => {
        try {
          let newLayers;

          if (mode === 'realistic') {
            newLayers = generateRealisticLayers(
              imageData.grayscale,
              imageData.width,
              imageData.height,
              numLayers,
              layerThresholds,
              bridgeIslands,
              bridgeWidth,
              blurRadius,
              cornerMarkers,
              imageData.alpha,
              minIslandSize,
              colorizeRealistic,
              imageData.rawData,
              {
                armLength: scaledMarkerArmLength,
                armWidth: scaledMarkerArmWidth,
                margin: scaledMarkerMargin,
                color: markerColor
              },
              debugBridges,
              cleanupSize
            );
          } else {
            newLayers = generateCartoonLayers(
              imageData.rawData,
              imageData.width,
              imageData.height,
              numLayers,
              whiteTolerance,
              bridgeIslands,
              bridgeWidth,
              cornerMarkers,
              {
                armLength: scaledMarkerArmLength,
                armWidth: scaledMarkerArmWidth,
                margin: scaledMarkerMargin,
                color: markerColor
              },
              minIslandSize,
              bleedRadius
            );
          }

          setLayers(newLayers);
          const composite = generateComposite(newLayers, imageData.width, imageData.height, mode, mode === 'realistic' ? layerColors : null, false, colorizeRealistic);
          setCompositeUrl(composite);
        } catch (e) {
          console.error(e);
          setError('Failed to process image. Try adjusting settings.');
        } finally {
          setProcessing(false);
        }
      }, 30);
    }, 400);

    return () => clearTimeout(debounceRef.current);
  }, [imageData, mode, numLayers, layerThresholds, whiteTolerance, bridgeIslands, bridgeWidth, minIslandSize, blurRadius, cleanupSize, bleedRadius, cornerMarkers, colorizeRealistic, markerArmLength, markerArmWidth, markerMargin, markerColor, debugBridges]);

  const handleToggleVisibility = (layerId) => {
    setLayers((prev) => {
      const updated = prev.map((l) => l.id === layerId ? { ...l, visible: !l.visible } : l);
      if (imageData) {
        const composite = generateComposite(updated, imageData.width, imageData.height, mode, mode === 'realistic' ? layerColors : null, false, colorizeRealistic);
        setCompositeUrl(composite);
      }
      return updated;
    });
  };

  const handleNumLayersChange = (n) => {
    setNumLayers(n);
    setLayerThresholds(defaultRealisticThresholds(n));
    setLayerColors(getPresetColors(n));
  };

  const handleLayerThresholdChange = (layerIndex, newThreshold) => {
    setLayerThresholds((prev) => {
      const updated = [...prev];
      // Clamp to valid range
      const clamped = Math.max(1, Math.min(254, newThreshold));

      // Layers 0 and 1 always use the same threshold (no gap, perfect alignment)
      if (layerIndex === 0 || layerIndex === 1) {
        updated[0] = clamped;
        updated[1] = clamped;
      } else {
        updated[layerIndex] = clamped;
      }
      return updated;
    });
  };

  const handleLayerColorChange = (layerIndex, newColor) => {
    setLayerColors((prev) => {
      const updated = [...prev];
      updated[layerIndex] = newColor;
      return updated;
    });
    // Regenerate composite with new colors
    if (imageData && layers.length > 0) {
      const composite = generateComposite(layers, imageData.width, imageData.height, mode, mode === 'realistic' ? layerColors : null, false);
      setCompositeUrl(composite);
    }
  };

  // When switching to cartoon, snap numLayers to detected count
  const handleModeChange = (newMode) => {
    setMode(newMode);
    if (newMode === 'cartoon' && detectedColors !== null) {
      setNumLayers(detectedColors);
    }
  };

  const duplicateLayer = (layer) => {
    const newCanvas = document.createElement('canvas');
    newCanvas.width = layer.canvas.width;
    newCanvas.height = layer.canvas.height;
    const ctx = newCanvas.getContext('2d');
    ctx.drawImage(layer.canvas, 0, 0);
    return {
      ...layer,
      id: `${layer.id}-dup-${Date.now()}`,
      canvas: newCanvas,
      dataUrl: newCanvas.toDataURL('image/png')
    };
  };

  const handleMergeLayers = (mergeIndex) => {
    setLayers((prev) => {
      const updated = [...prev];

      if (mergeIndex === 0) {
        // Merge L1 into L0 using clean (bridge-free) canvases so tiny bridge cuts don't appear
        const clean0 = updated[0].cleanCanvas || updated[0].canvas;
        const clean1 = updated[1].cleanCanvas || updated[1].canvas;
        const canvas0 = updated[0].canvas;
        const ctx0 = canvas0.getContext('2d');

        const imgData0 = clean0.getContext('2d').getImageData(0, 0, canvas0.width, canvas0.height);
        const imgData1 = clean1.getContext('2d').getImageData(0, 0, canvas0.width, canvas0.height);

        // Merge: if either clean layer has opaque pixels, make it opaque
        for (let i = 0; i < imgData0.data.length; i += 4) {
          if (imgData0.data[i + 3] > 128 || imgData1.data[i + 3] > 128) {
            imgData0.data[i + 3] = 255;
          }
        }
        ctx0.putImageData(imgData0, 0, 0);
        updated[0].cleanCanvas = canvas0; // merged result IS the clean canvas now
        updated[0].dataUrl = canvas0.toDataURL('image/png');
        // L1 stays in the array — it remains visible in the preview
      } else if (mergeIndex === 1) {
        // Duplicate layer 0 (bridge-free copy), merge into layer 1
        const duplicate = duplicateLayer(updated[0]);

        // Merge using clean (bridge-free) canvases
        const clean0 = updated[0].cleanCanvas || updated[0].canvas;
        const clean1 = updated[1].cleanCanvas || updated[1].canvas;
        const canvas1 = updated[1].canvas;
        const ctx1 = canvas1.getContext('2d');

        const imgData0 = clean0.getContext('2d').getImageData(0, 0, canvas1.width, canvas1.height);
        const imgData1 = clean1.getContext('2d').getImageData(0, 0, canvas1.width, canvas1.height);

        // Merge: if either clean layer has opaque pixels, make it opaque
        for (let i = 0; i < imgData1.data.length; i += 4) {
          if (imgData0.data[i + 3] > 128 || imgData1.data[i + 3] > 128) {
            imgData1.data[i + 3] = 255;
          }
        }
        ctx1.putImageData(imgData1, 0, 0);
        updated[1].cleanCanvas = canvas1; // merged result IS the clean canvas now
        updated[1].dataUrl = canvas1.toDataURL('image/png');

        // Replace layer 0 with duplicate, keep L1 at position 1
        updated[0] = duplicate;
      }

      // Regenerate composite
      if (imageData) {
        const composite = generateComposite(updated, imageData.width, imageData.height, mode, mode === 'realistic' ? layerColors : null, false, colorizeRealistic);
        setCompositeUrl(composite);
      }

      return updated;
    });
  };

  const handleReset = () => {
    setOriginalUrl(null);
    setImageData(null);
    setLayers([]);
    setCompositeUrl(null);
    setMode('realistic');
    setNumLayers(4);
    setLayerThresholds(defaultRealisticThresholds(4));
    setLayerColors(getPresetColors(4));
    setWhiteTolerance(15);
    setBridgeIslands(false);
    setBridgeWidth(2);
    setMinIslandSize(200);
    setDebugBridges(false);
    setCornerMarkers(true);
    setColorizeRealistic(false);
    setBlurRadius(0);
    setCleanupSize(0);
    setBleedRadius(1);
    setRemoveBg(false);
    setDetectedColors(null);
    setError(null);
    // Reset marker settings
    setMarkerArmLength(14);
    setMarkerArmWidth(3);
    setMarkerMargin(24);
    setMarkerColor('black');
  };

  const hasImage = !!imageData;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-4 md:px-8 py-3 border-b border-border bg-black sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <Link to="/">
            <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:text-white hover:bg-white/10">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <img
            src={Logo}
            alt="Stencil App"
            className="h-10 w-auto" />
          
        </div>

        {hasImage &&
        <div className="flex items-center gap-2 text-xs font-body text-muted-foreground">
            {processing ?
          <span className="flex items-center gap-1.5">
                <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                Processing…
              </span> :

          <span className="capitalize">{mode} · {layers.length} layers</span>
          }
          </div>
        }
      </header>

      {/* Main */}
      <main className="flex-1 px-4 md:px-8 py-6">
        <AnimatePresence mode="wait">
          {!hasImage ?
          <motion.div
            key="upload"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="max-w-xl mx-auto mt-10 md:mt-20">
            
              <div className="text-center mb-8">
                <h2 className="font-heading text-2xl font-bold">Upload an Image</h2>
                <p className="text-muted-foreground font-body text-sm mt-2">Supports photos and cartoons

              </p>
              </div>
              <ImageUploader onImageLoad={handleImageLoad} />
            </motion.div> :

          <motion.div
            key="editor"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="max-w-7xl mx-auto">
            
              {error &&
            <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-xl px-4 py-3 mb-4">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {error}
                </div>
            }

              <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-6">
                {/* Left */}
                <div className="space-y-5">
                  {/* Composite */}
                  {compositeUrl &&
                <CompositePreview
                  compositeUrl={compositeUrl}
                  originalUrl={originalUrl}
                  cornerMarkers={false} />

                }

                  {/* Layer grid */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-heading font-semibold text-sm flex items-center gap-1.5">
                        <Layers className="w-4 h-4 text-primary" />
                        {mode === 'cartoon' ? 'Color Layers' : 'Tonal Layers'}
                      </h3>
                      <span className="text-xs text-muted-foreground font-body">
                        {mode === 'realistic' ?
                      'Stacked darkest → lightest' :
                      'Sorted darkest color first'}
                      </span>
                    </div>

                    {processing ?
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                        {Array.from({ length: numLayers }).map((_, i) =>
                    <div
                      key={i}
                      className="aspect-square rounded-xl bg-muted animate-pulse" />

                    )}
                      </div> :

                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                        {layers.map((layer, idx) =>
                    <LayerCard
                      key={`${layer.id}-${mode}`}
                      layer={layer}
                      index={idx}
                      totalLayers={layers.length}
                      onToggleVisibility={handleToggleVisibility}
                      cornerMarkers={cornerMarkers}
                      layerThreshold={mode === 'realistic' ? layerThresholds[idx] : undefined}
                      onThresholdChange={mode === 'realistic' ? (v) => handleLayerThresholdChange(idx, v) : undefined}
                      onMerge={mode === 'realistic' ? handleMergeLayers : undefined}
                      layerColors={mode === 'realistic' ? layerColors : undefined}
                      onColorChange={mode === 'realistic' ? handleLayerColorChange : undefined}
                      markerArmLength={scaledMarkerArmLength}
                      markerArmWidth={scaledMarkerArmWidth}
                      markerMargin={scaledMarkerMargin}
                      markerColor={markerColor}
                      bridgeIslands={bridgeIslands}
                      bridgeWidth={bridgeWidth} />

                    )}
                      </div>
                  }

                    {mode === 'realistic' && !processing &&
                  <p className="text-[10px] text-muted-foreground font-body mt-3 flex items-start gap-1">
                        <span className="mt-0.5">ℹ️</span>
                        Cake-stack: cut Layer 1 (darkest) from your base, paint, then add Layer 2 on top, and so on up to the lightest.
                      </p>
                  }
                    {mode === 'cartoon' && !processing &&
                  <p className="text-[10px] text-muted-foreground font-body mt-3 flex items-start gap-1">
                        <span className="mt-0.5">ℹ️</span>
                        Each layer is an isolated color region. Cut and paint each one with its corresponding color.
                      </p>
                  }
                  </div>
                </div>

                {/* Right: Controls */}
                <div className="lg:sticky lg:top-20 lg:self-start">
                  <div className="bg-card rounded-2xl border border-border p-5">
                    <h3 className="font-heading font-semibold text-sm mb-4">Settings</h3>
                    <ControlsPanel
                    mode={mode}
                    onModeChange={handleModeChange}
                    numLayers={numLayers}
                    onNumLayersChange={handleNumLayersChange}
                    detectedColors={detectedColors}
                    whiteTolerance={whiteTolerance}
                    onWhiteToleranceChange={setWhiteTolerance}
                    blurRadius={blurRadius}
                    onBlurRadiusChange={setBlurRadius}
                    cleanupSize={cleanupSize}
                    onCleanupSizeChange={setCleanupSize}
                    bleedRadius={bleedRadius}
                    onBleedRadiusChange={setBleedRadius}
                    removeBackground={removeBg}
                    onRemoveBackgroundChange={handleRemoveBgToggle}
                    removingBackground={removingBg}
                    bridgeIslands={bridgeIslands}
                    onBridgeIslandsChange={setBridgeIslands}
                    bridgeWidth={bridgeWidth}
                    onBridgeWidthChange={setBridgeWidth}
                    minIslandSize={minIslandSize}
                    onMinIslandSizeChange={setMinIslandSize}
                    cornerMarkers={cornerMarkers}
                    onCornerMarkersChange={setCornerMarkers}
                    markerArmLength={markerArmLength}
                    onMarkerArmLengthChange={setMarkerArmLength}
                    markerArmWidth={markerArmWidth}
                    onMarkerArmWidthChange={setMarkerArmWidth}
                    markerMargin={markerMargin}
                    onMarkerMarginChange={setMarkerMargin}
                    markerColor={markerColor}
                    onMarkerColorChange={setMarkerColor}
                    colorizeRealistic={colorizeRealistic}
                    onColorizeRealisticChange={setColorizeRealistic}
                    debugBridges={debugBridges}
                    onDebugBridgesChange={setDebugBridges}
                    layers={layers}
                    layerColors={layerColors}
                    onReset={handleReset} />
                  
                  </div>
                </div>
              </div>
            </motion.div>
          }
        </AnimatePresence>
      </main>
    </div>);

}