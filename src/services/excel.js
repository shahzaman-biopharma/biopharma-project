import * as XLSX from 'xlsx';

// ─── Local Excel / CSV file upload ───────────────────────────────────────────

export async function parseExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheets = {};
        workbook.SheetNames.forEach(name => {
          sheets[name] = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1 });
        });
        resolve(sheets);
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

export async function parseCsvFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const workbook = XLSX.read(text, { type: 'string' });
        const sheets = {};
        workbook.SheetNames.forEach(name => {
          sheets[name] = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '' });
        });
        resolve(sheets);
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

const MAX_ROWS_PER_SHEET = 200; // keep context small → fewer tokens → fewer 429s

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
      text += headers.map((_, i) => String(row[i] ?? '')).join(' | ') + '\n';
    });
  });
  return text.trim();
}

// ─── CSV URL detection & fetching ────────────────────────────────────────────

function isCsvUrl(url) {
  // Matches: ?output=csv  |  &output=csv  |  .csv  |  .csv?...
  return /[?&]output=csv/i.test(url) || /\.csv(\?.*)?$/i.test(url);
}

function csvSheetName(url) {
  try {
    const u = new URL(url);
    // Google Sheets published to web — URL ends in /pub
    if (u.hostname.includes('google') && /\/pub/.test(u.pathname)) return 'Sheet Data';
    // Generic .csv file — use filename without extension
    const file = u.pathname.split('/').pop().replace(/\.csv$/i, '').replace(/[_-]/g, ' ').trim();
    return file || 'CSV Data';
  } catch {
    return 'CSV Data';
  }
}

async function fetchAndParseCsv(url) {
  // Proxy through server to handle CORS restrictions
  const res = await fetch(`/api/fetch-csv?url=${encodeURIComponent(url)}`);
  if (!res.ok) {
    let msg = `CSV fetch failed (${res.status}).`;
    try { const j = await res.json(); msg = j.error || msg; } catch {}
    throw new Error(msg);
  }
  const csvText = await res.text();
  const workbook = XLSX.read(csvText, { type: 'string' });
  const name = csvSheetName(url);
  // XLSX parses CSV as a single sheet named "Sheet1" — rename it
  const originalName = workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[originalName], { header: 1, defval: '' });
  return { sheets: { [name]: rows }, sheetNames: [name] };
}

// ─── OneDrive / SharePoint ────────────────────────────────────────────────────

function isOneDriveUrl(url) {
  return /1drv\.ms|onedrive\.live\.com|sharepoint\.com/i.test(url);
}

async function fetchOneDriveData(url) {
  const res = await fetch(`/api/fetch-excel?url=${encodeURIComponent(url)}`);
  if (!res.ok) {
    let msg = `OneDrive access failed (${res.status}).`;
    try { const j = await res.json(); msg = j.error || msg; } catch {}
    throw new Error(msg + ' Make sure the file is shared as "Anyone with the link".');
  }
  const arrayBuffer = await (await res.blob()).arrayBuffer();
  const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
  const sheets = {};
  workbook.SheetNames.forEach(name => {
    sheets[name] = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1 });
  });
  return { text: sheetsToText(sheets), sheetNames: workbook.SheetNames };
}

// ─── Google Sheets via Service Account ───────────────────────────────────────
// rtpof=true  → Excel file on Google Drive  → Drive API
// ?output=csv → Published CSV              → direct fetch via proxy
// default     → Native Google Sheet        → Sheets API v4

function isGoogleDriveExcel(url) {
  return /spreadsheets\/d\//.test(url) && url.includes('rtpof=true');
}

function buildSheetsApiUrl(sheetId, isExcel) {
  return `/api/sheets?sheetId=${sheetId}${isExcel ? '&excel=1' : ''}`;
}

export async function fetchGoogleSheetData(url) {
  if (isOneDriveUrl(url)) return fetchOneDriveData(url);

  // Published CSV (Google Sheets pub or any .csv link)
  if (isCsvUrl(url)) {
    const { sheets, sheetNames } = await fetchAndParseCsv(url);
    return { text: sheetsToText(sheets), sheetNames };
  }

  // Native Google Sheets or Google Drive Excel
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) throw new Error('Invalid Google Sheets URL. Supported formats: native sheet link, published CSV link (?output=csv), OneDrive/SharePoint link.');
  const sheetId = match[1];
  if (sheetId === 'e') throw new Error('This looks like a published CSV link — please add the full URL including ?output=csv');
  const isExcel = isGoogleDriveExcel(url);

  const res = await fetch(buildSheetsApiUrl(sheetId, isExcel));
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to fetch sheet');

  const sheets = {};
  (data.sheets || []).forEach(({ name, rows }) => { sheets[name] = rows; });
  return { text: sheetsToText(sheets), sheetNames: data.sheetNames || [] };
}

// ─── Raw sheet data for dashboard (returns rows[][], not text) ───────────────

async function fetchOneDriveRaw(url) {
  const res = await fetch(`/api/fetch-excel?url=${encodeURIComponent(url)}`);
  if (!res.ok) {
    let msg = `OneDrive access failed (${res.status}).`;
    try { const j = await res.json(); msg = j.error || msg; } catch {}
    throw new Error(msg);
  }
  const arrayBuffer = await (await res.blob()).arrayBuffer();
  const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
  const sheets = {};
  workbook.SheetNames.forEach(name => {
    sheets[name] = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1 });
  });
  return { sheets, sheetNames: workbook.SheetNames };
}

export async function fetchGoogleSheetRaw(url) {
  if (isOneDriveUrl(url)) return fetchOneDriveRaw(url);

  // Published CSV
  if (isCsvUrl(url)) return fetchAndParseCsv(url);

  // Native Google Sheets or Google Drive Excel
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) throw new Error('Invalid Google Sheets URL');
  const sheetId = match[1];
  if (sheetId === 'e') throw new Error('Published CSV link — make sure URL includes ?output=csv');
  const isExcel = isGoogleDriveExcel(url);

  const res = await fetch(buildSheetsApiUrl(sheetId, isExcel));
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to fetch sheet');

  const sheets = {};
  (data.sheets || []).forEach(({ name, rows }) => { sheets[name] = rows; });
  return { sheets, sheetNames: data.sheetNames || [] };
}
