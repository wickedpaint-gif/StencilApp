/* eslint-disable no-undef */
/**
 * Vercel serverless function — FAPIhub background removal proxy.
 * Keeps FAPIHUB_API_KEY server-side, never exposed to the browser.
 * Add FAPIHUB_API_KEY to Vercel → Settings → Environment Variables.
 */
export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.FAPIHUB_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'FAPIhub API key not configured' });
  }

  // Read the incoming multipart body
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const bodyBuffer = Buffer.concat(chunks);

  const contentType = req.headers['content-type'];

  // Forward to FAPIhub — same multipart body, swap in our API key
  const fapihubRes = await fetch('https://fapihub.com/v2/rembg/', {
    method: 'POST',
    headers: {
      'ApiKey': apiKey,
      'content-type': contentType,
    },
    body: bodyBuffer,
  });

  if (!fapihubRes.ok) {
    let detail = `FAPIhub error (${fapihubRes.status})`;
    try {
      const errJson = await fapihubRes.json();
      if (errJson?.error || errJson?.message) detail = errJson.error || errJson.message;
    } catch { /* ignore */ }
    return res.status(fapihubRes.status).json({ error: detail });
  }

  const imageBuffer = Buffer.from(await fapihubRes.arrayBuffer());
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Content-Length', imageBuffer.length);
  return res.status(200).send(imageBuffer);
}