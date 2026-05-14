// Vercel serverless proxy — fetches a Microsoft OneDrive/SharePoint shared Excel file
// and returns the raw .xlsx bytes to the browser (avoids CORS).
// No OAuth required: works with public "Anyone with the link" share URLs.

function encodeShareUrl(url) {
  const base64 = Buffer.from(url).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return 'u!' + base64;
}

export default async function handler(req, res) {
  const { url } = req.query;

  if (!url || !/1drv\.ms|onedrive\.live\.com|sharepoint\.com/i.test(url)) {
    return res.status(400).json({ error: 'Invalid or missing OneDrive URL' });
  }

  try {
    const shareToken = encodeShareUrl(url);
    const apiUrl = `https://api.onedrive.com/v1.0/shares/${shareToken}/root/content`;

    const response = await fetch(apiUrl, { redirect: 'follow' });

    if (!response.ok) {
      return res.status(response.status).json({
        error: `OneDrive returned ${response.status}. Make sure the file is shared as "Anyone with the link".`,
      });
    }

    const buffer = await response.arrayBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Cache-Control', 'no-store');
    res.send(Buffer.from(buffer));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
