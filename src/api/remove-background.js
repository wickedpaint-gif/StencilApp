export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const apiKey = process.env.FAPIHUB_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: "Missing API key" });
    }

    const response = await fetch("https://fapihub.com/v2/rembg/", {
      method: "POST",
      headers: {
        ApiKey: apiKey,
        // IMPORTANT: forward only what is needed
        "Content-Type": req.headers["content-type"],
      },
      body: req, // 👈 let Node stream handle it directly
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({
        error: text || "FAPIhub error",
      });
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    res.setHeader("Content-Type", "image/png");
    return res.status(200).send(buffer);

  } catch (err) {
    console.error("Background removal error:", err);
    return res.status(500).json({
      error: "Server error during background removal",
    });
  }
}