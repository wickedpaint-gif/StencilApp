/**
 * Cartoon V2 — stage 1: image quality assessment.
 *
 * Estimates resolution, sensor/JPEG noise, block (compression) artefacts,
 * edge sharpness and overall complexity. The derived profile drives every
 * later stage (how hard to denoise, how big the superpixels are, how
 * aggressively regions may merge), so a 600px JPEG and a 4000px PNG both end
 * up with comparable output.
 */

export function assessImageQuality(rawData, width, height) {
  const d = rawData.data;
  const n = width * height;
  const luma = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    const o = i * 4;
    luma[i] = (d[o] * 77 + d[o + 1] * 150 + d[o + 2] * 29) >> 8;
  }

  const hist = new Float64Array(256);
  let gradSum = 0;
  let gradCount = 0;
  let edgeCount = 0;
  let noiseSum = 0;
  let noiseCount = 0;
  let blockSum = 0;
  let blockCount = 0;
  let allSum = 0;
  let allCount = 0;
  let chromaSum = 0;
  let chromaCount = 0;

  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = row + x;
      const o = i * 4;
      if (d[o + 3] < 10) continue;

      const gx = luma[i + 1] - luma[i - 1];
      const gy = luma[i + width] - luma[i - width];
      let mag = ((gx < 0 ? -gx : gx) + (gy < 0 ? -gy : gy)) >> 1;
      if (mag > 255) mag = 255;

      hist[mag]++;
      gradSum += mag;
      gradCount++;
      if (mag > 28) edgeCount++;

      if (mag <= 10) {
        const mean = (luma[i - 1] + luma[i + 1] + luma[i + width] + luma[i - width]) >> 2;
        noiseSum += Math.abs(luma[i] - mean);
        noiseCount++;
      }

      const horiz = luma[i] - luma[i - 1];
      const diff = horiz < 0 ? -horiz : horiz;
      allSum += diff;
      allCount++;
      if (x % 8 === 0) {
        blockSum += diff;
        blockCount++;
      }

      const r = d[o];
      const g = d[o + 1];
      const b = d[o + 2];
      chromaSum += Math.max(r, g, b) - Math.min(r, g, b);
      chromaCount++;
    }
  }

  // 90th-percentile gradient magnitude (edge sharpness reference)
  let p90 = 0;
  const target = gradCount * 0.9;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= target) { p90 = v; break; }
  }

  const noise = noiseCount ? noiseSum / noiseCount : 0;
  const meanGrad = gradCount ? gradSum / gradCount : 0;
  const blockiness = blockCount && allCount ? blockSum / blockCount - allSum / allCount : 0;
  const sharpness = meanGrad > 0 ? p90 / meanGrad : 1;
  const edgeDensity = gradCount ? edgeCount / gradCount : 0;
  const chroma = chromaCount ? chromaSum / chromaCount : 0;
  const resolution = Math.max(width, height);

  let score = 0;
  if (noise > 4) score += 1;
  if (noise > 8) score += 1;
  if (blockiness > 1.5) score += 1;
  if (blockiness > 4) score += 1;
  if (resolution < 900) score += 1;
  if (sharpness < 1.9) score += 1;

  const level = score >= 3 ? 'low' : score >= 2 ? 'medium' : 'high';

  return {
    luma,
    pixels: n,
    width,
    height,
    noise,
    blockiness,
    sharpness,
    edgeDensity,
    chroma,
    resolution,
    level,
  };
}