import { fetchGoogleSheetRaw } from '../services/excel';
import { generateDashboardSpec } from '../services/openai';
import { updateDepartment } from '../services/firestore';

export function summarizeSheetsForGpt(rawSheets) {
  const results = [];
  for (const [sheetName, rows] of Object.entries(rawSheets)) {
    if (!rows || rows.length < 2) continue;
    const headers = (rows[0] || []).map(h => String(h || ''));
    const dataRows = rows.slice(1).filter(r => r && r.some(c => c !== null && c !== '' && c !== undefined));
    if (!dataRows.length) continue;
    const colStats = headers.map((h, i) => {
      const vals = dataRows.map(r => r?.[i]).filter(v => v !== null && v !== '' && v !== undefined);
      const nums = vals.map(v => parseFloat(String(v).replace(/,/g, ''))).filter(n => !isNaN(n));
      if (nums.length >= Math.max(1, vals.length * 0.5)) {
        const sum = nums.reduce((a, b) => a + b, 0);
        return {
          header: h, type: 'numeric', count: nums.length,
          sum: +sum.toFixed(2), min: +Math.min(...nums).toFixed(2),
          max: +Math.max(...nums).toFixed(2), avg: +(sum / nums.length).toFixed(2),
        };
      } else {
        const uniq = [...new Set(vals.map(String))];
        return { header: h, type: 'categorical', totalUnique: uniq.length, topValues: uniq.slice(0, 8), sample: vals.slice(0, 3).map(String) };
      }
    });
    results.push({ sheetName, totalRows: dataRows.length, colStats, sampleRow: headers.map((_, i) => String(dataRows[0]?.[i] ?? '')) });
  }
  return results;
}

export async function analyzeAndBuildDashboard(dept, deptId) {
  try {
    await updateDepartment(deptId, { dashboardStatus: 'analyzing', dashboardError: null });

    const valid = (dept.dataSources || []).filter(s => (s.type === 'googlesheet' || s.type === 'onedrive') && s.url);
    const allSheetSummaries = [];

    for (const src of valid) {
      try {
        const { sheets } = await fetchGoogleSheetRaw(src.url);
        const summaries = summarizeSheetsForGpt(sheets);
        summaries.forEach(s => allSheetSummaries.push({ ...s, sourceName: src.name || 'Data' }));
      } catch (err) {
        console.warn(`analyzeAndBuildDashboard: cannot fetch "${src.name || 'source'}":`, err.message);
      }
    }

    const spec = await generateDashboardSpec({
      name: dept.name || '',
      tag: dept.tag || '',
      description: dept.description || '',
      businessContext: dept.businessContext || '',
      systemPrompt: (dept.systemPrompt || '').slice(0, 600),
      dataSourceNames: (dept.dataSources || []).map(s => s.name || 'Data'),
      sheetSummaries: allSheetSummaries,
    });

    await updateDepartment(deptId, { dashboardSpec: spec, dashboardStatus: 'ready', dashboardError: null });
    return spec;
  } catch (err) {
    console.error('analyzeAndBuildDashboard failed:', err);
    await updateDepartment(deptId, { dashboardStatus: 'error', dashboardError: err.message }).catch(() => {});
    throw err;
  }
}
