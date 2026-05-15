// Vercel serverless proxy — fetches an OneDrive/SharePoint Excel file.
//
// Two modes:
//   1. OAuth (private files): MICROSOFT_REFRESH_TOKEN is set in env →
//      auto-refreshes access token, uses Graph API. Works for ANY file the account can access.
//   2. Public fallback: No token → tries anonymous Shares API.
//      Only works for "Anyone with the link" files.

function encodeShareUrl(url) {
  const base64 = Buffer.from(url).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return 'u!' + base64;
}

async function getMsAccessToken() {
  const { MICROSOFT_CLIENT_ID: clientId, MICROSOFT_CLIENT_SECRET: clientSecret, MICROSOFT_REFRESH_TOKEN: refreshToken } = process.env;
  if (!clientId || !clientSecret || !refreshToken) return null;

  const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: 'Files.Read offline_access',
    }),
  });
  const data = await res.json();
  if (!data.access_token) {
    console.error('MS token refresh failed:', data.error, data.error_description);
    return null;
  }
  return data.access_token;
}

export default async function handler(req, res) {
  const { url } = req.query;

  if (!url || !/1drv\.ms|onedrive\.live\.com|sharepoint\.com/i.test(url)) {
    return res.status(400).json({ error: 'Invalid or missing OneDrive URL' });
  }

  try {
    const shareToken = encodeShareUrl(url);

    // ── OAuth path (private files) ──────────────────────────────────────────
    const accessToken = await getMsAccessToken();
    if (accessToken) {
      const graphUrl = `https://graph.microsoft.com/v1.0/shares/${shareToken}/driveItem/content`;
      const response = await fetch(graphUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
        redirect: 'follow',
      });

      if (response.ok) {
        const buffer = await response.arrayBuffer();
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Cache-Control', 'no-store');
        return res.send(Buffer.from(buffer));
      }

      // 403 means the logged-in user doesn't have access to this specific file
      if (response.status === 403) {
        return res.status(403).json({
          error: 'Access denied. Make sure the Microsoft account you connected has access to this file.',
        });
      }
      // Other errors: fall through to public path
    }

    // ── Public fallback (no token or non-403 error) ─────────────────────────
    const publicUrl = `https://api.onedrive.com/v1.0/shares/${shareToken}/root/content`;
    const response = await fetch(publicUrl, { redirect: 'follow' });

    if (!response.ok) {
      return res.status(response.status).json({
        error: accessToken
          ? `File not accessible (${response.status}). Check sharing permissions.`
          : `OneDrive returned ${response.status}. File must be shared as "Anyone with the link", or connect Microsoft in Settings for private file access.`,
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
