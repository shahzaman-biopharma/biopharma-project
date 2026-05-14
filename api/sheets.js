// Vercel serverless proxy — fetches Google Sheets data using a Service Account.
// No user OAuth required. No 55-minute token expiry.
// Sheet must be shared with the service account email (Viewer role).

import { createSign } from 'crypto';

const MAX_ROWS = 500;

function makeJWT(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })).toString('base64url');
  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  return `${header}.${payload}.${sign.sign(sa.private_key, 'base64url')}`;
}

async function getToken(sa) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${makeJWT(sa)}`,
  });
  const { access_token, error } = await res.json();
  if (!access_token) throw new Error(error || 'Service account auth failed');
  return access_token;
}

function sheetRange(name) {
  return "'" + name.replace(/'/g, "''") + "'";
}

export default async function handler(req, res) {
  const { sheetId } = req.query;
  if (!sheetId) return res.status(400).json({ error: 'Missing sheetId' });

  const saKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!saKey) return res.status(500).json({ error: 'GOOGLE_SERVICE_ACCOUNT_KEY not configured on server' });

  let sa;
  try { sa = JSON.parse(saKey); } catch {
    return res.status(500).json({ error: 'Invalid service account JSON in env var' });
  }

  try {
    const token = await getToken(sa);

    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties.title`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!metaRes.ok) {
      return res.status(metaRes.status).json({
        error: metaRes.status === 403
          ? `Access denied. Share this Google Sheet with: ${sa.client_email}`
          : `Google Sheets API error ${metaRes.status}`,
      });
    }

    const meta = await metaRes.json();
    const sheetNames = meta.sheets?.map(s => s.properties.title) || [];
    const sheets = [];

    for (const name of sheetNames.slice(0, 10)) {
      const valRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(sheetRange(name))}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (valRes.ok) {
        const { values } = await valRes.json();
        if (values?.length) sheets.push({ name, rows: values });
      }
    }

    res.setHeader('Cache-Control', 'no-store');
    res.json({ sheetNames, sheets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
