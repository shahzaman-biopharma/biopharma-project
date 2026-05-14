import * as XLSX from 'xlsx';

export async function parseExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheets = {};
        workbook.SheetNames.forEach(name => {
          const ws = workbook.Sheets[name];
          sheets[name] = XLSX.utils.sheet_to_json(ws, { header: 1 });
        });
        resolve(sheets);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

export function sheetsToText(sheets) {
  let text = '';
  Object.entries(sheets).forEach(([sheetName, rows]) => {
    text += `\n=== Sheet: ${sheetName} ===\n`;
    rows.forEach(row => {
      text += row.join(' | ') + '\n';
    });
  });
  return text.trim();
}

// Read stored Google OAuth token (written by AuthContext)
function getStoredGoogleToken() {
  try {
    const s = sessionStorage.getItem('bp_g_token');
    if (!s) return null;
    const { token, expiry } = JSON.parse(s);
    if (Date.now() > expiry) { sessionStorage.removeItem('bp_g_token'); return null; }
    return token;
  } catch { return null; }
}

export async function fetchGoogleSheetData(url) {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) throw new Error('Invalid Google Sheets URL');
  const sheetId = match[1];

  // ── Authenticated path (private sheets) ──────────────────────────────────
  const token = getStoredGoogleToken();
  if (token) {
    try {
      // Get all sheet names first
      const metaRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties.title`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (metaRes.ok) {
        const meta = await metaRes.json();
        const sheetNames = meta.sheets?.map(s => s.properties.title) || ['Sheet1'];
        const parts = [];
        for (const name of sheetNames.slice(0, 6)) {
          const valRes = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(name)}`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (valRes.ok) {
            const data = await valRes.json();
            const rows = data.values || [];
            if (rows.length) {
              parts.push(
                `=== ${name} ===\n` +
                rows.map(r => r.map(c => String(c ?? '')).join(',')).join('\n')
              );
            }
          }
        }
        if (parts.length) return parts.join('\n\n');
      }
    } catch { /* fall through to public path */ }
  }

  // ── Public CSV fallback ───────────────────────────────────────────────────
  const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
  const res = await fetch(csvUrl);
  if (!res.ok) {
    throw new Error(
      'Cannot access this Google Sheet. ' +
      'Either make it public ("Anyone with the link") or connect your Google account in Settings → Google Sheets.'
    );
  }
  return res.text();
}
