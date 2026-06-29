import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Eye } from 'lucide-react';

/**
 * Draws red crosshair registration marks at the four corners of the image
 * as an SVG overlay, matching what gets exported to SVG files.
 */
function CornerMarkersOverlay({ imgRect, containerRect }) {
  if (!imgRect || !containerRect) return null;

  // Image position relative to the container
  const left = imgRect.left - containerRect.left;
  const top = imgRect.top - containerRect.top;
  const w = imgRect.width;
  const h = imgRect.height;

  const margin = 16;
  const arm = 10;
  const color = 'red';
  const sw = 1.5;

  const corners = [
    { cx: left - margin, cy: top - margin },
    { cx: left + w + margin, cy: top - margin },
    { cx: left - margin, cy: top + h + margin },
    { cx: left + w + margin, cy: top + h + margin },
  ];

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      style={{ width: containerRect.width, height: containerRect.height }}
    >
      {/* Dashed border */}
      <rect
        x={left} y={top} width={w} height={h}
        fill="none"
        stroke={color}
        strokeWidth={0.75}
        strokeDasharray="5 5"
        opacity={0.5}
      />
      {/* Crosshairs */}
      {corners.map(({ cx, cy }, i) => (
        <g key={i}>
          <line x1={cx - arm} y1={cy} x2={cx + arm} y2={cy} stroke={color} strokeWidth={sw} strokeLinecap="round" />
          <line x1={cx} y1={cy - arm} x2={cx} y2={cy + arm} stroke={color} strokeWidth={sw} strokeLinecap="round" />
        </g>
      ))}
    </svg>
  );
}

export default function CompositePreview({ compositeUrl, originalUrl, cornerMarkers = false }) {
  const [showOriginal, setShowOriginal] = useState(false);
  const imgRef = useRef(null);
  const containerRef = useRef(null);
  const [rects, setRects] = useState(null);

  // Measure image + container after render / resize
  useEffect(() => {
    function measure() {
      if (!imgRef.current || !containerRef.current) return;
      setRects({
        img: imgRef.current.getBoundingClientRect(),
        container: containerRef.current.getBoundingClientRect(),
      });
    }

    measure();
    const ro = new ResizeObserver(measure);
    if (imgRef.current) ro.observe(imgRef.current);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [compositeUrl, showOriginal]);

  return (
    <div className="relative rounded-2xl overflow-hidden border border-border bg-card">
      {/* Checkerboard bg */}
      <div
        ref={containerRef}
        className="relative flex items-center justify-center min-h-[280px] bg-[repeating-conic-gradient(hsl(220,12%,90%)_0%_25%,white_0%_50%)] bg-[length:20px_20px]"
      >
        <motion.img
          ref={imgRef}
          key={showOriginal ? 'original' : 'composite'}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25 }}
          src={showOriginal ? originalUrl : compositeUrl}
          alt="Stencil preview"
          className="max-w-full max-h-[460px] object-contain"
          onLoad={() => {
            if (!imgRef.current || !containerRef.current) return;
            setRects({
              img: imgRef.current.getBoundingClientRect(),
              container: containerRef.current.getBoundingClientRect(),
            });
          }}
        />

        {/* Corner marker overlay — only shown on stencil view */}
        {cornerMarkers && !showOriginal && rects && (
          <CornerMarkersOverlay imgRect={rects.img} containerRect={rects.container} />
        )}
      </div>

      {/* Toggle */}
      <button
        onClick={() => setShowOriginal(s => !s)}
        className="absolute bottom-3 right-3 flex items-center gap-1.5 bg-card/90 backdrop-blur border border-border rounded-full px-3 py-1.5 text-xs font-heading font-medium hover:bg-card transition-colors shadow"
      >
        <Eye className="w-3 h-3" />
        {showOriginal ? 'Show Stencil' : 'Show Original'}
      </button>
    </div>
  );
}