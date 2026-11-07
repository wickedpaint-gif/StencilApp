/**
 * Cartoon V2 — debug stage previews.
 *
 * Each snapshot is taken from the real output of that pipeline stage (the
 * stage arrays themselves), only spatially subsampled so a 4000px image can be
 * inspected in a dialog. Used exclusively by the development debug view.
 */

const MAX_PREVIEW = 720;

export function previewGeometry(width, height) {
  const stride = Math.max(1, Math.ceil(Math.max(width, height) / MAX_PREVIEW));
  return { stride, w: Math.ceil(width / stride), h: Math.ceil(height / stride) };
}

export function snapshotRGBA(src, width, height) {
  const { stride, w, h } = previewGeometry(width, height);
  const out = new Uint8ClampedArray(w * h * 4);

  for (let y = 0; y < h; y++) {
    const sy = Math.min(height - 1, y * stride);
    for (let x = 0; x < w; x++) {
      const sx = Math.min(width - 1, x * stride);
      const si = (sy * width + sx) * 4;
      const di = (y * w + x) * 4;
      const a = src[si + 3] / 255;
      out[di] = src[si] * a + 255 * (1 - a);
      out[di + 1] = src[si + 1] * a + 255 * (1 - a);
      out[di + 2] = src[si + 2] * a + 255 * (1 - a);
      out[di + 3] = 255;
    }
  }

  return { width: w, height: h, data: out, stride };
}

export function snapshotProtection(protection, width, height) {
  const { stride, w, h } = previewGeometry(width, height);
  const out = new Uint8ClampedArray(w * h * 4);

  for (let y = 0; y < h; y++) {
    const sy = Math.min(height - 1, y * stride);
    for (let x = 0; x < w; x++) {
      const sx = Math.min(width - 1, x * stride);
      const p = protection[sy * width + sx] / 255;
      const di = (y * w + x) * 4;
      // White = free to merge, red = protected boundary
      out[di] = 255;
      out[di + 1] = 255 - p * 220;
      out[di + 2] = 255 - p * 220;
      out[di + 3] = 255;
    }
  }

  return { width: w, height: h, data: out, stride };
}

export function snapshotLabels(labels, width, height, colorFor) {
  const { stride, w, h } = previewGeometry(width, height);
  const out = new Uint8ClampedArray(w * h * 4);
  const cache = new Map();

  const colourOf = (label) => {
    if (label < 0) return [255, 255, 255];
    let c = cache.get(label);
    if (!c) {
      c = colorFor(label);
      cache.set(label, c);
    }
    return c;
  };

  for (let y = 0; y < h; y++) {
    const sy = Math.min(height - 1, y * stride);
    for (let x = 0; x < w; x++) {
      const sx = Math.min(width - 1, x * stride);
      const label = labels[sy * width + sx];
      const c = colourOf(label);

      // Draw region outlines so segmentation boundaries are visible
      const right = labels[sy * width + Math.min(width - 1, sx + stride)];
      const down = labels[Math.min(height - 1, sy + stride) * width + sx];
      const edge = right !== label || down !== label;

      const di = (y * w + x) * 4;
      if (edge) {
        out[di] = 30;
        out[di + 1] = 30;
        out[di + 2] = 30;
      } else {
        out[di] = c[0];
        out[di + 1] = c[1];
        out[di + 2] = c[2];
      }
      out[di + 3] = 255;
    }
  }

  return { width: w, height: h, data: out, stride };
}

/** Distinct, stable colour per label id (golden-angle hue walk). */
export function hashedLabelColour(label) {
  const hue = (label * 137.508) % 360;
  const s = 0.55 + ((label * 37) % 30) / 100;
  const l = 0.45 + ((label * 53) % 25) / 100;
  return hslToRgb(hue / 360, s, l);
}

function hslToRgb(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h * 12) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

export function stageToDataUrl(stage) {
  const canvas = document.createElement('canvas');
  canvas.width = stage.width;
  canvas.height = stage.height;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(stage.width, stage.height);
  img.data.set(stage.data);
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}