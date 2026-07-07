/* eslint-disable no-undef */
/**
 * Vercel serverless function — Photoroom background removal proxy.
 * Keeps PHOTOROOM_API_KEY server-side, never exposed to the browser.
 * Add PHOTOROOM_API_KEY to Vercel → Settings → Environment Variables.
 */
export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.PHOTOROOM_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Photoroom API key not configured' });
  }

  // Stream the incoming multipart body directly to Photoroom
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const bodyBuffer = Buffer.concat(chunks);

  const contentType = req.headers['content-type'];

  const photoroomRes = await fetch('https://sdk.photoroom.com/v1/segment', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'content-type': contentType,
    },
    body: bodyBuffer,
  });

  if (!photoroomRes.ok) {
    let detail = `Photoroom error (${photoroomRes.status})`;
    try {
      const errJson = await photoroomRes.json();
      if (errJson?.message) detail = errJson.message;
    } catch { /* ignore */ }
    return res.status(photoroomRes.status).json({ error: detail });
  }

  const imageBuffer = Buffer.from(await photoroomRes.arrayBuffer());
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Content-Length', imageBuffer.length);
  return res.status(200).send(imageBuffer);
}