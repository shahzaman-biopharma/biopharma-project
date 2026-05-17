// Vercel serverless — secure OpenAI proxy
// API key lives on the server (OPENAI_API_KEY env var) — never exposed to browser
// Model fallback: gpt-4o → gpt-4o-mini  (no client can override this)

const MODELS = ['gpt-4o', 'gpt-4o-mini'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: {
        message:
          'OPENAI_API_KEY is not set. Go to Vercel → Settings → Environment Variables and add it.',
      },
    });
  }

  // Strip any client-sent model — model selection is controlled server-side only
  const { model: _ignored, ...body } = req.body;

  for (const model of MODELS) {
    let response;
    try {
      response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model, ...body }),
      });
    } catch {
      continue; // network error — try next model
    }

    if (response.ok) {
      const data = await response.json();
      return res.status(200).json(data);
    }

    // 404 / 400 = model not available → try next
    if (response.status === 404 || response.status === 400) continue;

    // 429 or any other error → pass back to client (client handles backoff + retry)
    const data = await response.json().catch(() => ({}));
    return res.status(response.status).json(data);
  }

  return res.status(503).json({
    error: { message: 'AI service temporarily unavailable. Please try again in a moment.' },
  });
}
