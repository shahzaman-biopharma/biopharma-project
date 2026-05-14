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

const MAX_ROWS_PER_SHEET = 500;

export function sheetsToText(sheets) {
  let text = '';
  Object.entries(sheets).forEach(([sheetName, rows]) => {
    if (!rows.length) return;
    const headers = rows[0] || [];
    const dataRows = rows.slice(1);
    const limited = dataRows.slice(0, MAX_ROWS_PER_SHEET);
    const truncated = dataRows.length > MAX_ROWS_PER_SHEET;

    text += `\n=== Sheet: ${sheetName} ===\n`;
    text += `Columns (${headers.length}): ${headers.join(' | ')}\n`;
    text += `Total rows: ${dataRows.length}${truncated ? ` (showing first ${MAX_ROWS_PER_SHEET})` : ''}\n\n`;
    text += headers.join(' | ') + '\n';
    limited.forEach(row => {
      const padded = headers.map((_, i) => String(row[i] ?? ''));
      text += padded.join(' | ') + '\n';
    });
  });
  return text.trim();
}

// Read stored Google OAuth token (written by AuthContext — stored in localStorage)
function getStoredGoogleToken() {
  try {
    const s = localStorage.getItem('bp_g_token');
    if (!s) return null;
    const { token, expiry } = JSON.parse(s);
    if (Date.now() > expiry) { localStorage.removeItem('bp_g_token'); return null; }
    return token;
  } catch { return null; }
}

// Wrap sheet name in single quotes for proper Google Sheets API A1 notation
// Handles sheet names with spaces, special chars (e.g. "Medical Records Tracker BIRC")
function sheetRange(name) {
  return "'" + name.replace(/'/g, "''") + "'";
}

// Returns { text: string, sheetNames: string[] }
export async function fetchGoogleSheetData(url, externalToken = null) {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) throw new Error('Invalid Google Sheets URL');
  const sheetId = match[1];

  // ── Authenticated path — private sheets + ALL tabs ────────────────────────
  const token = externalToken || getStoredGoogleToken();
  if (token) {
    try {
      const metaRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties.title`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (metaRes.ok) {
        const meta = await metaRes.json();
        const sheetNames = meta.sheets?.map(s => s.properties.title) || [];
        const parts = [];
        for (const name of sheetNames.slice(0, 10)) {
          const valRes = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(sheetRange(name))}`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (valRes.ok) {
            const data = await valRes.json();
            const rows = data.values || [];
            if (rows.length) {
              const headers = rows[0] || [];
              const dataRows = rows.slice(1);
              const limited = dataRows.slice(0, MAX_ROWS_PER_SHEET);
              const truncated = dataRows.length > MAX_ROWS_PER_SHEET;
              const lines = [
                `=== Sheet: ${name} ===`,
                `Columns (${headers.length}): ${headers.join(' | ')}`,
                `Total rows: ${dataRows.length}${truncated ? ` (showing first ${MAX_ROWS_PER_SHEET})` : ''}`,
                '',
                headers.join(' | '),
                ...limited.map(r => {
                  const padded = headers.map((_, i) => String(r[i] ?? ''));
                  return padded.join(' | ');
                }),
              ];
              parts.push(lines.join('\n'));
            }
          }
        }
        if (parts.length) return { text: parts.join('\n\n'), sheetNames };
      }
    } catch { /* fall through */ }
  }

  // ── Public CSV fallback (first sheet only) ────────────────────────────────
  const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
  const res = await fetch(csvUrl);
  if (!res.ok) {
    throw new Error(
      'Cannot access this Google Sheet. ' +
      'Either make it public ("Anyone with the link") or connect Google in Settings → Departments.'
    );
  }
  const rawCsv = await res.text();
  // Convert CSV to pipe-separated with metadata
  const csvRows = rawCsv.trim().split('\n').map(line => line.split(','));
  const csvHeaders = csvRows[0] || [];
  const csvData = csvRows.slice(1).slice(0, MAX_ROWS_PER_SHEET);
  const csvTrunc = csvRows.length - 1 > MAX_ROWS_PER_SHEET;
  const text = [
    '=== Sheet: Sheet1 ===',
    `Columns (${csvHeaders.length}): ${csvHeaders.join(' | ')}`,
    `Total rows: ${csvRows.length - 1}${csvTrunc ? ` (showing first ${MAX_ROWS_PER_SHEET})` : ''}`,
    '',
    csvHeaders.join(' | '),
    ...csvData.map(r => csvHeaders.map((_, i) => String(r[i] ?? '')).join(' | ')),
  ].join('\n');
  return { text, sheetNames: ['Sheet1 (public access — only first tab visible)'] };
}
