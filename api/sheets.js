// Vercel serverless proxy — fetches spreadsheet data using a Service Account.
// Supports two modes:
//   1. Native Google Sheets (spreadsheets.readonly scope) — default
//   2. Google Drive Excel .xlsx (drive.readonly scope) — pass ?excel=1
//      Used when the URL contains rtpof=true (Excel file viewed in Sheets)
// Sheet/file must be shared with the service account email (Viewer role).

import { createSign } from 'crypto';
import XLSX from 'xlsx';

const MAX_ROWS = 1000;

function makeJWT(sa, scope) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })).toString('base64url');
  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  return `${header}.${payload}.${sign.sign(sa.private_key, 'base64url')}`;
}

async function getToken(sa, scope) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${makeJWT(sa, scope)}`,
  });
  const { access_token, error } = await res.json();
  if (!access_token) throw new Error(error || 'Service account auth failed');
  return access_token;
}

function sheetRange(name) {
  return "'" + name.replace(/'/g, "''") + "'";
}

export default async function handler(req, res) {
  const { sheetId, excel } = req.query;
  if (!sheetId) return res.status(400).json({ error: 'Missing sheetId' });

  const saKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!saKey) return res.status(500).json({ error: 'GOOGLE_SERVICE_ACCOUNT_KEY not configured on server' });

  let sa;
  try { sa = JSON.parse(saKey); } catch {
    return res.status(500).json({ error: 'Invalid service account JSON in env var' });
  }

  res.setHeader('Cache-Control', 'no-store');

  // ── Mode 1: Google Drive Excel (.xlsx) ────────────────────────────────────
  if (excel === '1') {
    try {
      const token = await getToken(sa, 'https://www.googleapis.com/auth/drive.readonly');
      const driveRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${sheetId}?alt=media`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!driveRes.ok) {
        const errText = await driveRes.text().catch(() => '');
        return res.status(driveRes.status).json({
          error: driveRes.status === 403
            ? `Access denied. Share the file with: ${sa.client_email} (Viewer)`
            : `Google Drive API error ${driveRes.status}. ${errText.slice(0, 150)}`,
        });
      }

      const arrayBuffer = await driveRes.arrayBuffer();
      const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
      const sheetNames = workbook.SheetNames;

      // namesOnly mode — return only sheet names (fast)
      if (req.query.namesOnly === '1') return res.json({ sheetNames });

      const targetNames = req.query.sheet
        ? sheetNames.filter(n => n === req.query.sheet)
        : sheetNames;
      const sheets = targetNames.map(name => ({
        name,
        rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '' })
          .slice(0, MAX_ROWS + 1),
      })).filter(s => s.rows.length > 0);

      return res.json({ sheetNames, sheets });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── Mode 2: Native Google Sheets ──────────────────────────────────────────
  try {
    const token = await getToken(sa, 'https://www.googleapis.com/auth/spreadsheets.readonly');

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

    // namesOnly mode — return only sheet names, no data fetch (very fast)
    if (req.query.namesOnly === '1') return res.json({ sheetNames });

    const targetNames = req.query.sheet
      ? sheetNames.filter(n => n === req.query.sheet)
      : sheetNames.slice(0, 10);
    const sheets = [];

    for (const name of targetNames) {
      const valRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(sheetRange(name))}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (valRes.ok) {
        const { values } = await valRes.json();
        if (values?.length) sheets.push({ name, rows: values.slice(0, MAX_ROWS + 1) });
      }
    }

    res.json({ sheetNames, sheets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
