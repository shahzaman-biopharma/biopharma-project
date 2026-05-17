// Server-side proxy for public CSV URLs (Google Sheets published CSV, direct .csv links)
// Avoids browser CORS restrictions on some CSV hosts.

export default async function handler(req, res) {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url parameter' });

  res.setHeader('Cache-Control', 'no-store');

  try {
    const csvRes = await fetch(decodeURIComponent(url), {
      headers: { 'User-Agent': 'BioPharma-Bot/1.0' },
    });
    if (!csvRes.ok) {
      return res.status(csvRes.status).json({ error: `CSV source returned ${csvRes.status}` });
    }
    const text = await csvRes.text();
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(text);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
