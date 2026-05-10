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

export async function fetchGoogleSheetData(url) {
  // Convert Google Sheets URL to CSV export URL
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) throw new Error('Invalid Google Sheets URL');

  const sheetId = match[1];
  const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;

  try {
    const res = await fetch(csvUrl);
    if (!res.ok) throw new Error('Failed to fetch Google Sheet. Make sure it is publicly accessible.');
    const text = await res.text();
    return text;
  } catch {
    throw new Error('Could not access Google Sheet. Ensure sharing is set to "Anyone with the link".');
  }
}
