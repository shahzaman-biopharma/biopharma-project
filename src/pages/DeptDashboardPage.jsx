import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { subscribeToDepartment, updateDepartment } from '../services/firestore';
import { fetchGoogleSheetRaw } from '../services/excel';
import CustomDashboard from '../components/CustomDashboard';
import { analyzeAndBuildDashboard } from '../utils/analyzeAndBuildDashboard';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
  ArrowLeft, Bot, RefreshCw, Database,
  Loader2, AlertCircle, BarChart2, TableIcon, Settings,
  Layers, ArrowLeftRight, ChevronDown, X,
} from 'lucide-react';
import toast from 'react-hot-toast';

/* ── Theme ────────────────────────────────────────────────────────────────── */
const C = {
  bg: '#0f1419', panel: '#171d26', panel2: '#1e2630', line: '#2a3340',
  ink: '#e8eef5', sub: '#8a99ad', faint: '#5a6878',
  teal: '#3fb8af', amber: '#e8a838', red: '#e15f5f',
  green: '#5fb878', blue: '#5b8def', violet: '#9b7fe8',
};
const TONES = ['teal', 'blue', 'violet', 'amber', 'green', 'red'];
const COLORS = [C.teal, C.blue, C.violet, C.amber, C.green, C.red];

/* ── Helpers ──────────────────────────────────────────────────────────────── */
function isNumeric(val) {
  if (val === null || val === undefined || val === '') return false;
  return !isNaN(parseFloat(String(val).replace(/,/g, ''))) && isFinite(String(val).replace(/,/g, ''));
}
function cleanNum(val) {
  const n = parseFloat(String(val).replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}
function fmtNum(n) {
  if (n === null || n === undefined) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (abs >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return Number(n.toFixed(0)).toLocaleString();
}
function detectColumns(rows) {
  if (!rows || rows.length < 2) return { labelCol: 0, numericCols: [] };
  const headers = rows[0] || [];
  const sample = rows.slice(1, Math.min(rows.length, 20));
  let labelCol = -1;
  const numericCols = [];
  headers.forEach((_, i) => {
    const vals = sample.map(r => r?.[i]).filter(v => v !== null && v !== undefined && v !== '');
    const numCount = vals.filter(v => isNumeric(v)).length;
    if (vals.length > 0 && numCount / vals.length >= 0.6) numericCols.push(i);
    else if (labelCol === -1) labelCol = i;
  });
  if (labelCol === -1) labelCol = 0;
  return { labelCol, numericCols };
}
function computeKPIs(rows) {
  if (!rows || rows.length < 2) return [];
  const headers = rows[0] || [];
  const dataRows = rows.slice(1).filter(r => r && r.some(c => c !== null && c !== undefined && c !== ''));
  const kpis = [{ label: 'Total Records', formatted: String(dataRows.length), hint: 'Data rows in this sheet', tone: 'blue' }];
  let ti = 0;
  headers.forEach((h, i) => {
    if (kpis.length >= 5) return;
    const vals = dataRows.map(r => r?.[i]).filter(isNumeric).map(cleanNum);
    if (vals.length < Math.max(1, dataRows.length * 0.4)) return;
    const sum = vals.reduce((a, b) => a + b, 0);
    const label = String(h || '').trim();
    if (!label) return;
    kpis.push({ label, formatted: fmtNum(sum), hint: `Sum · ${vals.length} values`, tone: TONES[ti++ % TONES.length] });
  });
  return kpis;
}
function buildBarData(rows, labelCol, numericCols) {
  if (!rows || rows.length < 2) return [];
  const headers = rows[0] || [];
  return rows.slice(1)
    .filter(r => r && String(r?.[labelCol] ?? '').trim() !== '')
    .map(row => {
      const obj = { _label: String(row[labelCol] ?? '') };
      numericCols.forEach(i => { obj[String(headers[i] || `Col${i + 1}`)] = cleanNum(row[i]); });
      return obj;
    });
}
function hexAlpha(hex, alpha) {
  try {
    const h = (hex || '#5b8def').replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  } catch { return `rgba(91,141,239,${alpha})`; }
}

/* ── UI atoms ─────────────────────────────────────────────────────────────── */
function DarkTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#0a0f1a', border: `1px solid ${C.line}`, borderRadius: 9, padding: '10px 14px', fontSize: 12, maxWidth: 230 }}>
      <p style={{ color: C.sub, margin: '0 0 6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color, margin: '2px 0', fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600 }}>
          {p.name}: {typeof p.value === 'number' ? p.value.toLocaleString() : p.value}
        </p>
      ))}
    </div>
  );
}
function KpiCard({ label, formatted, hint, tone }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: '18px 20px', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: C[tone] || C.teal, borderRadius: '14px 0 0 14px' }} />
      <div style={{ fontSize: 11, letterSpacing: '.07em', textTransform: 'uppercase', color: C.sub, fontWeight: 700, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 800, color: C.ink, fontFamily: "'IBM Plex Mono',monospace", lineHeight: 1 }}>{formatted}</div>
      {hint && <div style={{ fontSize: 11, color: C.faint, marginTop: 8 }}>{hint}</div>}
    </div>
  );
}
function MiniBar({ pct, tone }) {
  return (
    <div style={{ background: C.panel2, borderRadius: 5, height: 8, overflow: 'hidden' }}>
      <div style={{ width: `${Math.min(Math.max(pct || 0, 0), 100)}%`, height: '100%', background: C[tone] || C.teal, borderRadius: 5, transition: 'width .5s' }} />
    </div>
  );
}
function ChartCard({ title, desc, children }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: '22px 18px 14px', overflow: 'hidden' }}>
      <h3 style={{ margin: '0 0 2px', fontSize: 16, fontWeight: 700, color: C.ink }}>{title}</h3>
      {desc && <p style={{ margin: '0 0 16px', fontSize: 12, color: C.sub, lineHeight: 1.5 }}>{desc}</p>}
      {!desc && <div style={{ height: 14 }} />}
      {children}
    </div>
  );
}

/* ── Sheet mini chart (reused in SheetView + CompareView) ─────────────────── */
function SheetChart({ rows, chartType = 'bar', height = 260 }) {
  const { labelCol, numericCols } = detectColumns(rows);
  const headers = rows[0] || [];
  const barData = buildBarData(rows, labelCol, numericCols).slice(0, 40);
  const chart1Cols = numericCols.slice(0, 3);
  if (!chart1Cols.length || !barData.length) {
    return <p style={{ color: C.faint, fontSize: 12, padding: '20px 0' }}>No numeric data to chart.</p>;
  }
  const margin = { top: 4, right: 6, bottom: 58, left: -10 };
  const xProps = {
    dataKey: '_label', angle: -38, textAnchor: 'end', interval: 0,
    tick: { fill: C.sub, fontSize: 9 }, height: 65,
    tickFormatter: v => String(v).length > 13 ? String(v).slice(0, 12) + '…' : v,
  };
  return (
    <ResponsiveContainer width="100%" height={height}>
      {chartType === 'line' ? (
        <LineChart data={barData} margin={margin}>
          <CartesianGrid stroke={C.line} vertical={false} />
          <XAxis {...xProps} />
          <YAxis tick={{ fill: C.sub, fontSize: 9 }} tickFormatter={fmtNum} />
          <Tooltip content={<DarkTooltip />} />
          {chart1Cols.length > 1 && <Legend wrapperStyle={{ fontSize: 10 }} />}
          {chart1Cols.map((ci, idx) => (
            <Line key={ci} type="monotone" dataKey={String(headers[ci] || `Col${ci+1}`)} stroke={COLORS[idx]} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
          ))}
        </LineChart>
      ) : chartType === 'area' ? (
        <AreaChart data={barData} margin={margin}>
          <defs>
            {chart1Cols.map((ci, idx) => (
              <linearGradient key={ci} id={`ag${idx}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={COLORS[idx]} stopOpacity={0.3} />
                <stop offset="95%" stopColor={COLORS[idx]} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke={C.line} vertical={false} />
          <XAxis {...xProps} />
          <YAxis tick={{ fill: C.sub, fontSize: 9 }} tickFormatter={fmtNum} />
          <Tooltip content={<DarkTooltip />} />
          {chart1Cols.length > 1 && <Legend wrapperStyle={{ fontSize: 10 }} />}
          {chart1Cols.map((ci, idx) => (
            <Area key={ci} type="monotone" dataKey={String(headers[ci] || `Col${ci+1}`)} stroke={COLORS[idx]} strokeWidth={2} fill={`url(#ag${idx})`} />
          ))}
        </AreaChart>
      ) : (
        <BarChart data={barData} margin={margin}>
          <CartesianGrid stroke={C.line} vertical={false} />
          <XAxis {...xProps} />
          <YAxis tick={{ fill: C.sub, fontSize: 9 }} tickFormatter={fmtNum} />
          <Tooltip content={<DarkTooltip />} cursor={{ fill: 'rgba(255,255,255,.04)' }} />
          {chart1Cols.length > 1 && <Legend wrapperStyle={{ fontSize: 10 }} />}
          {chart1Cols.map((ci, idx) => (
            <Bar key={ci} dataKey={String(headers[ci] || `Col${ci+1}`)} fill={COLORS[idx]} radius={[3, 3, 0, 0]} maxBarSize={34} />
          ))}
        </BarChart>
      )}
    </ResponsiveContainer>
  );
}

/* ── DataTable ────────────────────────────────────────────────────────────── */
function DataTable({ rows, label }) {
  const headers = rows[0] || [];
  const dataRows = rows.slice(1).filter(r => r && r.some(c => c !== null && c !== undefined && c !== ''));
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, overflow: 'hidden', marginTop: 12 }}>
      <div style={{ padding: '10px 16px', borderBottom: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', gap: 8 }}>
        <TableIcon size={13} color={C.blue} />
        <span style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{label || 'Data Table'}</span>
        <span style={{ fontSize: 11, color: C.faint, marginLeft: 'auto', fontFamily: "'IBM Plex Mono',monospace" }}>
          {dataRows.length > 200 ? `first 200 of ${dataRows.length}` : `${dataRows.length} rows`} · {headers.length} cols
        </span>
      </div>
      <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
            <tr style={{ background: '#0a0f1a', borderBottom: `1px solid ${C.line}` }}>
              {headers.map((h, i) => (
                <th key={i} style={{ padding: '8px 12px', textAlign: 'left', color: C.sub, fontWeight: 700, whiteSpace: 'nowrap', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                  {String(h || `Col ${i + 1}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dataRows.slice(0, 200).map((row, ri) => (
              <tr key={ri} style={{ borderBottom: `1px solid rgba(42,51,64,0.4)` }}>
                {headers.map((_, ci) => {
                  const val = row?.[ci] ?? '';
                  const num = isNumeric(val);
                  return (
                    <td key={ci} style={{ padding: '7px 12px', color: num ? C.teal : C.ink, whiteSpace: 'nowrap', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: num ? "'IBM Plex Mono',monospace" : 'inherit', fontSize: 12 }}>
                      {String(val)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── SheetView — individual sheet dashboard ───────────────────────────────── */
function SheetView({ allSheets, multiSource }) {
  const [selIdx, setSelIdx] = useState(0);
  const [showTable, setShowTable] = useState(false);
  const [chartType, setChartType] = useState('bar');

  const sheet = allSheets[selIdx];
  const rows = sheet?.rows || [];
  const headers = rows[0] || [];
  const dataRows = rows.slice(1).filter(r => r && r.some(c => c !== null && c !== undefined && c !== ''));
  const kpis = computeKPIs(rows);
  const { numericCols } = detectColumns(rows);
  const hasChart = numericCols.length > 0 && dataRows.length > 0;

  return (
    <div style={{ padding: '16px 22px 80px' }}>
      {/* Sheet pills */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 18, alignItems: 'center' }}>
        <Layers size={12} color={C.faint} style={{ flexShrink: 0 }} />
        {allSheets.map((s, i) => (
          <button key={i} onClick={() => { setSelIdx(i); setShowTable(false); }} style={{
            padding: '5px 14px', borderRadius: 20,
            border: `1px solid ${i === selIdx ? C.teal : C.line}`,
            background: i === selIdx ? 'rgba(63,184,175,0.1)' : 'transparent',
            color: i === selIdx ? C.teal : C.sub,
            fontSize: 12, fontWeight: i === selIdx ? 700 : 400, cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all .15s',
          }}>
            {multiSource ? `${s.sourceName} › ${s.sheetName}` : s.sheetName}
          </button>
        ))}
      </div>

      {sheet && (
        <>
          {/* Source badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <Database size={12} color={C.faint} />
            <span style={{ fontSize: 11, color: C.sub }}>{sheet.sourceName}</span>
            <span style={{ fontSize: 11, color: C.line }}>›</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.ink }}>{sheet.sheetName}</span>
            <span style={{ fontSize: 11, color: C.faint, fontFamily: "'IBM Plex Mono',monospace", marginLeft: 'auto' }}>
              {dataRows.length} rows · {headers.length} cols
            </span>
          </div>

          {/* KPIs */}
          {kpis.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(155px,1fr))', gap: 11, marginBottom: 16 }}>
              {kpis.map((kpi, i) => <KpiCard key={i} {...kpi} />)}
            </div>
          )}

          {/* Chart */}
          {hasChart && (
            <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: '18px 18px 14px', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: C.ink, flex: 1 }}>{sheet.sheetName} — Chart</span>
                {/* Chart type buttons */}
                <div style={{ display: 'flex', gap: 4 }}>
                  {[['bar', 'Bar'], ['line', 'Line'], ['area', 'Area']].map(([k, l]) => (
                    <button key={k} onClick={() => setChartType(k)} style={{
                      padding: '3px 10px', borderRadius: 6,
                      border: `1px solid ${chartType === k ? C.amber : C.line}`,
                      background: chartType === k ? 'rgba(232,168,56,0.12)' : 'transparent',
                      color: chartType === k ? C.amber : C.faint,
                      fontSize: 11, fontWeight: chartType === k ? 700 : 400, cursor: 'pointer',
                    }}>{l}</button>
                  ))}
                </div>
              </div>
              <SheetChart rows={rows} chartType={chartType} height={260} />
              {/* Show Table toggle */}
              <button onClick={() => setShowTable(p => !p)} style={{
                marginTop: 12, display: 'flex', alignItems: 'center', gap: 6,
                background: showTable ? 'rgba(63,184,175,0.1)' : 'transparent',
                border: `1px solid ${showTable ? C.teal : C.line}`,
                color: showTable ? C.teal : C.sub,
                borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all .15s',
              }}>
                <TableIcon size={13} />
                {showTable ? 'Hide Table' : 'Show Table'}
              </button>
            </div>
          )}

          {/* Table */}
          <AnimatePresence>
            {showTable && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }}>
                <DataTable rows={rows} label={`${sheet.sheetName} — Full Data`} />
              </motion.div>
            )}
          </AnimatePresence>

          {!hasChart && !showTable && (
            <button onClick={() => setShowTable(true)} style={{
              display: 'flex', alignItems: 'center', gap: 7, padding: '10px 18px', borderRadius: 10,
              background: 'rgba(91,141,239,0.08)', border: `1px solid rgba(91,141,239,0.25)`,
              color: C.blue, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}>
              <TableIcon size={14} /> View Data Table
            </button>
          )}
        </>
      )}
    </div>
  );
}

/* ── CompareView — two sheets side by side ────────────────────────────────── */
function CompareView({ sourceGroups }) {
  const g1 = sourceGroups[0];
  const g2 = sourceGroups[1];

  // All sheets from both sources available for left/right pickers
  const [leftIdx, setLeftIdx] = useState(0);
  const [rightIdx, setRightIdx] = useState(0);
  const [showTables, setShowTables] = useState(false);

  const leftSheet = g1.sheets[leftIdx];
  const rightSheet = g2.sheets[rightIdx];
  const leftRows = leftSheet?.rows || [];
  const rightRows = rightSheet?.rows || [];
  const leftKpis = computeKPIs(leftRows);
  const rightKpis = computeKPIs(rightRows);
  const maxKpis = Math.max(leftKpis.length, rightKpis.length);

  const leftHeaders = leftRows[0] || [];
  const rightHeaders = rightRows[0] || [];
  const leftData = leftRows.slice(1).filter(r => r && r.some(c => c !== null && c !== undefined && c !== ''));
  const rightData = rightRows.slice(1).filter(r => r && r.some(c => c !== null && c !== undefined && c !== ''));

  return (
    <div style={{ padding: '16px 22px 80px' }}>
      {/* Source pickers — left and right */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 10, alignItems: 'center', marginBottom: 20 }}>
        {/* Left picker */}
        <div>
          <div style={{ fontSize: 10, color: C.faint, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>
            {g1.name}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {g1.sheets.map((s, i) => (
              <button key={i} onClick={() => setLeftIdx(i)} style={{
                padding: '5px 13px', borderRadius: 20,
                border: `1px solid ${i === leftIdx ? C.blue : C.line}`,
                background: i === leftIdx ? 'rgba(91,141,239,0.12)' : 'transparent',
                color: i === leftIdx ? C.blue : C.sub,
                fontSize: 12, fontWeight: i === leftIdx ? 700 : 400, cursor: 'pointer', whiteSpace: 'nowrap',
              }}>{s.sheetName}</button>
            ))}
          </div>
        </div>

        {/* Vs badge */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <ArrowLeftRight size={18} color={C.amber} />
          <span style={{ fontSize: 10, color: C.amber, fontWeight: 700 }}>VS</span>
        </div>

        {/* Right picker */}
        <div>
          <div style={{ fontSize: 10, color: C.faint, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>
            {g2.name}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {g2.sheets.map((s, i) => (
              <button key={i} onClick={() => setRightIdx(i)} style={{
                padding: '5px 13px', borderRadius: 20,
                border: `1px solid ${i === rightIdx ? C.violet : C.line}`,
                background: i === rightIdx ? 'rgba(155,127,232,0.12)' : 'transparent',
                color: i === rightIdx ? C.violet : C.sub,
                fontSize: 12, fontWeight: i === rightIdx ? 700 : 400, cursor: 'pointer', whiteSpace: 'nowrap',
              }}>{s.sheetName}</button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI comparison */}
      {maxKpis > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, overflow: 'hidden', marginBottom: 16 }}>
          {/* Left KPIs */}
          <div style={{ padding: '14px 16px', borderRight: `1px solid ${C.line}` }}>
            <div style={{ fontSize: 11, color: C.blue, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 10 }}>
              {leftSheet?.sheetName}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {Array.from({ length: maxKpis }).map((_, i) => leftKpis[i] ? (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 10px', background: C.panel2, borderRadius: 9 }}>
                  <span style={{ fontSize: 12, color: C.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '55%' }}>{leftKpis[i].label}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: C.ink, fontFamily: "'IBM Plex Mono',monospace" }}>{leftKpis[i].formatted}</span>
                    {rightKpis[i] && (
                      <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 10, background: rightKpis[i].formatted === leftKpis[i].formatted ? 'rgba(95,184,120,0.12)' : 'rgba(225,95,95,0.12)', color: rightKpis[i].formatted === leftKpis[i].formatted ? C.green : C.red, border: `1px solid ${rightKpis[i].formatted === leftKpis[i].formatted ? 'rgba(95,184,120,0.3)' : 'rgba(225,95,95,0.3)'}` }}>
                        {rightKpis[i].formatted === leftKpis[i].formatted ? '✓' : '≠'}
                      </span>
                    )}
                  </div>
                </div>
              ) : null)}
            </div>
          </div>
          {/* Right KPIs */}
          <div style={{ padding: '14px 16px' }}>
            <div style={{ fontSize: 11, color: C.violet, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 10 }}>
              {rightSheet?.sheetName}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {Array.from({ length: maxKpis }).map((_, i) => rightKpis[i] ? (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 10px', background: C.panel2, borderRadius: 9 }}>
                  <span style={{ fontSize: 12, color: C.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '55%' }}>{rightKpis[i].label}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: C.ink, fontFamily: "'IBM Plex Mono',monospace" }}>{rightKpis[i].formatted}</span>
                    {leftKpis[i] && (
                      <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 10, background: leftKpis[i].formatted === rightKpis[i].formatted ? 'rgba(95,184,120,0.12)' : 'rgba(225,95,95,0.12)', color: leftKpis[i].formatted === rightKpis[i].formatted ? C.green : C.red, border: `1px solid ${leftKpis[i].formatted === rightKpis[i].formatted ? 'rgba(95,184,120,0.3)' : 'rgba(225,95,95,0.3)'}` }}>
                        {leftKpis[i].formatted === rightKpis[i].formatted ? '✓' : '≠'}
                      </span>
                    )}
                  </div>
                </div>
              ) : null)}
            </div>
          </div>
        </div>
      )}

      {/* Charts side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 12 }}>
        <ChartCard title={leftSheet?.sheetName || '—'} desc={`${leftData.length} rows · ${leftHeaders.length} cols`}>
          <SheetChart rows={leftRows} height={220} />
        </ChartCard>
        <ChartCard title={rightSheet?.sheetName || '—'} desc={`${rightData.length} rows · ${rightHeaders.length} cols`}>
          <SheetChart rows={rightRows} height={220} />
        </ChartCard>
      </div>

      {/* Show Tables toggle */}
      <button onClick={() => setShowTables(p => !p)} style={{
        display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14,
        background: showTables ? 'rgba(63,184,175,0.1)' : 'transparent',
        border: `1px solid ${showTables ? C.teal : C.line}`,
        color: showTables ? C.teal : C.sub,
        borderRadius: 8, padding: '7px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all .15s',
      }}>
        <TableIcon size={13} />
        {showTables ? 'Hide Tables' : 'Show Both Tables'}
      </button>

      {/* Tables side by side */}
      <AnimatePresence>
        {showTables && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <DataTable rows={leftRows} label={leftSheet?.sheetName} />
              <DataTable rows={rightRows} label={rightSheet?.sheetName} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Main page ────────────────────────────────────────────────────────────── */
export default function DeptDashboardPage() {
  const { deptId } = useParams();
  const navigate = useNavigate();

  const [department, setDepartment] = useState(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [allSheets, setAllSheets] = useState([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState(null);

  // View mode: 'overview' | 'sheets' | 'compare'
  const [viewMode, setViewMode] = useState('overview');
  const [sheetDropOpen, setSheetDropOpen] = useState(false);
  const sheetDropRef = useRef(null);

  useEffect(() => {
    const unsub = subscribeToDepartment(deptId, (dept) => {
      setDepartment(dept);
      setPageLoading(false);
    });
    return unsub;
  }, [deptId]);

  const config = department?.dashboardConfig ?? null;
  const accentColor = config?.accentColor || C.blue;

  // Re-trigger analysis if pending/stuck
  const analysisStartedRef = useRef(false);
  useEffect(() => {
    if (!department || analysisStartedRef.current) return;
    const status = department.dashboardStatus;
    if (status === 'pending' || status === 'analyzing') {
      analysisStartedRef.current = true;
      analyzeAndBuildDashboard(department, deptId).catch(() => { analysisStartedRef.current = false; });
    }
  }, [department?.dashboardStatus, department?.id]);

  const fetchData = useCallback(async (dept) => {
    if (!dept?.dataSources?.length) {
      setAllSheets([]);
      setDataError('No data sources configured.');
      return;
    }
    const valid = dept.dataSources.filter(s => (s.type === 'googlesheet' || s.type === 'onedrive') && s.url);
    if (!valid.length) {
      setAllSheets([]);
      setDataError('No spreadsheet sources found. Add a Google Sheet in Settings.');
      return;
    }
    setDataLoading(true);
    setDataError(null);
    const sheets = [];
    for (const src of valid) {
      try {
        const { sheets: raw, sheetNames } = await fetchGoogleSheetRaw(src.url);
        sheetNames.forEach(name => {
          if ((raw[name] || []).length > 1)
            sheets.push({ sourceName: src.name || 'Data', sheetName: name, rows: raw[name] });
        });
      } catch (err) {
        toast.error(`${src.name || 'Source'}: ${err.message}`);
      }
    }
    setAllSheets(sheets);
    setDataLoading(false);
    if (!sheets.length) setDataError('Could not load any data. Make sure the file is shared (Viewer).');
  }, []);

  useEffect(() => {
    if (department) fetchData(department);
  }, [department, fetchData]);

  // Close sheet dropdown on outside click
  useEffect(() => {
    function h(e) { if (sheetDropRef.current && !sheetDropRef.current.contains(e.target)) setSheetDropOpen(false); }
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const sourceGroups = useMemo(() => {
    const map = new Map();
    allSheets.forEach(s => {
      if (!map.has(s.sourceName)) map.set(s.sourceName, []);
      map.get(s.sourceName).push(s);
    });
    return [...map.entries()].map(([name, sheets]) => ({ name, sheets }));
  }, [allSheets]);

  const multiSource = sourceGroups.length > 1;
  const showCompareTab = sourceGroups.length >= 2;

  const dashStatus = department?.dashboardStatus;
  const isAnalyzing = dashStatus === 'analyzing' || dashStatus === 'pending';
  const hasCustom = dashStatus === 'ready' && department?.dashboardSpec;

  if (pageLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: C.bg }}>
        <Loader2 size={26} style={{ animation: 'spin 1s linear infinite', color: C.blue }} />
      </div>
    );
  }

  return (
    <div style={{ background: C.bg, minHeight: '100%', color: C.ink, fontFamily: "'Inter',system-ui,sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=IBM+Plex+Mono:wght@500;600;700&display=swap');
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .dd-btn { background: transparent; cursor: pointer; transition: background .15s; border: none; }
        .dd-btn:hover { background: rgba(255,255,255,.06); }
      `}</style>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{ background: `linear-gradient(180deg,${C.panel},${C.bg})`, borderBottom: `1px solid ${C.line}`, padding: '13px 18px', display: 'flex', alignItems: 'center', gap: 10, position: 'sticky', top: 0, zIndex: 30 }}>
        <button className="dd-btn" onClick={() => navigate('/dashboard')}
          style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: '6px 9px', color: C.sub, display: 'flex', alignItems: 'center' }}>
          <ArrowLeft size={15} />
        </button>

        <div style={{ width: 34, height: 34, borderRadius: 9, background: hexAlpha(accentColor, 0.12), border: `1px solid ${hexAlpha(accentColor, 0.3)}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <BarChart2 size={16} color={accentColor} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{department?.name}</div>
          <div style={{ fontSize: 10, color: C.sub, letterSpacing: '.07em', textTransform: 'uppercase' }}>
            {isAnalyzing ? 'Building dashboard…' : hasCustom ? 'Custom Dashboard' : 'Analytics Dashboard'}
          </div>
        </div>

        {/* Sheet picker icon */}
        {!isAnalyzing && allSheets.length > 0 && (
          <div ref={sheetDropRef} style={{ position: 'relative' }}>
            <button onClick={() => setSheetDropOpen(p => !p)}
              title="Pick a sheet"
              style={{
                border: `1px solid ${sheetDropOpen ? C.teal : C.line}`, borderRadius: 8,
                padding: '6px 10px', color: sheetDropOpen ? C.teal : C.sub,
                display: 'flex', alignItems: 'center', gap: 5, background: sheetDropOpen ? 'rgba(63,184,175,0.08)' : 'transparent', cursor: 'pointer',
              }}>
              <Layers size={14} />
              <ChevronDown size={12} style={{ transition: 'transform .2s', transform: sheetDropOpen ? 'rotate(180deg)' : 'none' }} />
            </button>

            {sheetDropOpen && (
              <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 200, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 8, minWidth: 240, maxHeight: 340, overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 6px 8px' }}>
                  <span style={{ fontSize: 11, color: C.faint, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' }}>Select Sheet</span>
                  <button onClick={() => setSheetDropOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.faint, display: 'flex', padding: 2 }}>
                    <X size={13} />
                  </button>
                </div>
                {/* All sheets option */}
                <button onClick={() => { setViewMode('overview'); setSheetDropOpen(false); }} style={{ width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 8, background: viewMode === 'overview' ? 'rgba(63,184,175,0.1)' : 'transparent', border: `1px solid ${viewMode === 'overview' ? C.teal : 'transparent'}`, color: viewMode === 'overview' ? C.teal : C.sub, fontSize: 12, cursor: 'pointer', marginBottom: 2, fontWeight: viewMode === 'overview' ? 700 : 400 }}>
                  All Sheets (Overview)
                </button>
                {/* Individual sheets */}
                {allSheets.map((s, i) => (
                  <button key={i} onClick={() => { setViewMode('sheets'); setSheetDropOpen(false); }} style={{ width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 8, background: 'transparent', border: '1px solid transparent', cursor: 'pointer', marginBottom: 2 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.ink }}>{s.sheetName}</div>
                    <div style={{ fontSize: 10, color: C.faint, marginTop: 1 }}>{s.sourceName}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Compare icon — only for multi-source */}
        {!isAnalyzing && showCompareTab && (
          <button onClick={() => setViewMode(viewMode === 'compare' ? 'overview' : 'compare')}
            title="Compare sheets"
            style={{
              border: `1px solid ${viewMode === 'compare' ? C.amber : C.line}`, borderRadius: 8,
              padding: '6px 10px', color: viewMode === 'compare' ? C.amber : C.sub,
              display: 'flex', alignItems: 'center', gap: 5,
              background: viewMode === 'compare' ? 'rgba(232,168,56,0.08)' : 'transparent', cursor: 'pointer',
            }}>
            <ArrowLeftRight size={14} />
          </button>
        )}

        {/* Refresh */}
        <button className="dd-btn" onClick={() => {
          if (hasCustom) {
            analysisStartedRef.current = false;
            updateDepartment(deptId, { dashboardStatus: 'pending' })
              .then(() => analyzeAndBuildDashboard(department, deptId))
              .catch(() => {});
          } else {
            fetchData(department);
          }
        }} disabled={dataLoading}
          style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: '6px 9px', color: C.sub, display: 'flex', alignItems: 'center', opacity: dataLoading ? 0.5 : 1 }}>
          <RefreshCw size={14} style={{ animation: dataLoading ? 'spin 1s linear infinite' : 'none' }} />
        </button>
      </div>

      {/* ── View mode tab bar ─────────────────────────────────────────────── */}
      {!isAnalyzing && (
        <div style={{ display: 'flex', gap: 2, padding: '10px 18px 0', borderBottom: `1px solid ${C.line}`, background: C.bg, position: 'sticky', top: 61, zIndex: 20 }}>
          {[
            ['overview', 'Overview'],
            ['sheets', `Sheets${allSheets.length > 0 ? ` (${allSheets.length})` : ''}`],
            ...(showCompareTab ? [['compare', 'Compare']] : []),
          ].map(([k, l]) => (
            <button key={k} onClick={() => setViewMode(k)} style={{
              padding: '8px 18px', borderRadius: '8px 8px 0 0',
              border: 'none', background: viewMode === k ? C.panel : 'transparent',
              color: viewMode === k ? C.ink : C.sub,
              fontSize: 13, fontWeight: viewMode === k ? 700 : 500,
              borderBottom: viewMode === k ? `2px solid ${C.teal}` : '2px solid transparent',
              cursor: 'pointer', transition: 'all .15s',
            }}>{l}</button>
          ))}
        </div>
      )}

      {/* ── Analyzing state ──────────────────────────────────────────────── */}
      {isAnalyzing && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 24px', minHeight: 400 }}>
          <div style={{ width: 60, height: 60, borderRadius: '50%', background: 'rgba(91,141,239,0.1)', border: '1px solid rgba(91,141,239,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
            <Settings size={26} color={C.blue} style={{ animation: 'spin 2s linear infinite' }} />
          </div>
          <h3 style={{ color: C.ink, fontWeight: 800, fontSize: 18, margin: '0 0 10px', textAlign: 'center' }}>Building Custom Dashboard</h3>
          <p style={{ color: C.sub, fontSize: 13, textAlign: 'center', maxWidth: 360, lineHeight: 1.7, margin: '0 0 24px' }}>
            GPT is reading your files and generating a unique dashboard for <b style={{ color: C.ink }}>{department?.name}</b>.
          </p>
          {['Reading data source files…', 'Analyzing sheet structure…', 'Understanding department context…', 'Generating dashboard with GPT…'].map((step, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px', background: 'rgba(91,141,239,0.06)', borderRadius: 10, border: '1px solid rgba(91,141,239,0.15)', width: '100%', maxWidth: 340, marginBottom: 8 }}>
              <Loader2 size={13} color={C.blue} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: C.sub }}>{step}</span>
            </div>
          ))}
          <p style={{ color: C.faint, fontSize: 11, marginTop: 20, textAlign: 'center' }}>Runs once — do not close the tab.</p>
        </div>
      )}

      {/* ── Data loading ─────────────────────────────────────────────────── */}
      {!isAnalyzing && dataLoading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60, gap: 10 }}>
          <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', color: C.blue }} />
          <span style={{ color: C.sub, fontSize: 13 }}>Loading spreadsheet data…</span>
        </div>
      )}

      {/* ── Data error ───────────────────────────────────────────────────── */}
      {!isAnalyzing && !dataLoading && dataError && (
        <div style={{ margin: '20px 22px 0', padding: 16, borderRadius: 12, background: 'rgba(225,95,95,0.07)', border: '1px solid rgba(225,95,95,0.2)', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <AlertCircle size={16} color={C.red} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <p style={{ margin: '0 0 7px', fontSize: 13, color: '#f87171', fontWeight: 700 }}>{dataError}</p>
            <button onClick={() => navigate('/settings')} style={{ fontSize: 12, color: C.blue, background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
              <Settings size={12} /> Configure in Settings
            </button>
          </div>
        </div>
      )}

      {/* ── Overview tab ─────────────────────────────────────────────────── */}
      {!isAnalyzing && !dataLoading && viewMode === 'overview' && (
        <>
          {hasCustom ? (
            <CustomDashboard spec={department.dashboardSpec} departmentName={department?.name} />
          ) : (
            /* Generic overview: combined KPIs from all sheets + first sheet chart */
            <GenericOverview allSheets={allSheets} department={department} />
          )}
        </>
      )}

      {/* ── Sheets tab ───────────────────────────────────────────────────── */}
      {!isAnalyzing && !dataLoading && viewMode === 'sheets' && (
        allSheets.length > 0
          ? <SheetView allSheets={allSheets} multiSource={multiSource} />
          : <EmptyState navigate={navigate} />
      )}

      {/* ── Compare tab ──────────────────────────────────────────────────── */}
      {!isAnalyzing && !dataLoading && viewMode === 'compare' && showCompareTab && (
        <CompareView sourceGroups={sourceGroups} />
      )}

      {/* ── Bot FAB ──────────────────────────────────────────────────────── */}
      <motion.button
        onClick={() => navigate(`/bot/${deptId}`)}
        whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }}
        title="Open Bot Chat"
        style={{ position: 'fixed', bottom: 24, right: 24, width: 52, height: 52, borderRadius: '50%', background: `linear-gradient(135deg,${C.blue},#6366f1)`, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 22px rgba(91,141,239,0.5)', zIndex: 50 }}>
        <Bot size={22} color="white" />
      </motion.button>
    </div>
  );
}

/* ── Generic overview (all sheets combined KPIs + chart) ──────────────────── */
function GenericOverview({ allSheets, department }) {
  const [chartType, setChartType] = useState('bar');
  const [showTable, setShowTable] = useState(false);

  // Use all sheets combined for KPIs — show sum of first sheet for chart
  const firstSheet = allSheets[0];
  const rows = firstSheet?.rows || [];
  const headers = rows[0] || [];
  const dataRows = rows.slice(1).filter(r => r && r.some(c => c !== null && c !== undefined && c !== ''));
  const kpis = useMemo(() => computeKPIs(rows), [rows]);
  const { numericCols } = detectColumns(rows);
  const hasChart = numericCols.length > 0 && dataRows.length > 0;

  if (!allSheets.length) return <EmptyState />;

  return (
    <div style={{ padding: '18px 22px 80px' }}>
      {/* Overview summary */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, padding: '10px 14px', background: 'rgba(91,141,239,0.06)', borderRadius: 12, border: '1px solid rgba(91,141,239,0.15)' }}>
        <Database size={14} color={C.blue} />
        <span style={{ fontSize: 12, color: C.sub }}>
          {allSheets.length} sheet{allSheets.length !== 1 ? 's' : ''} loaded across {new Set(allSheets.map(s => s.sourceName)).size} source{new Set(allSheets.map(s => s.sourceName)).size !== 1 ? 's' : ''}
        </span>
        <span style={{ fontSize: 11, color: C.faint, marginLeft: 'auto' }}>
          {allSheets.map(s => s.sheetName).join(' · ')}
        </span>
      </div>

      {/* KPIs from first sheet */}
      {kpis.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(155px,1fr))', gap: 11, marginBottom: 16 }}>
          {kpis.map((kpi, i) => <KpiCard key={i} {...kpi} />)}
        </div>
      )}

      {/* Main chart */}
      {hasChart && (
        <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: '18px 18px 14px', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: C.ink, flex: 1 }}>{firstSheet?.sheetName} — Overview Chart</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {[['bar', 'Bar'], ['line', 'Line'], ['area', 'Area']].map(([k, l]) => (
                <button key={k} onClick={() => setChartType(k)} style={{ padding: '3px 10px', borderRadius: 6, border: `1px solid ${chartType === k ? C.amber : C.line}`, background: chartType === k ? 'rgba(232,168,56,0.12)' : 'transparent', color: chartType === k ? C.amber : C.faint, fontSize: 11, fontWeight: chartType === k ? 700 : 400, cursor: 'pointer' }}>{l}</button>
              ))}
            </div>
          </div>
          <SheetChart rows={rows} chartType={chartType} height={260} />
          <button onClick={() => setShowTable(p => !p)} style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 6, background: showTable ? 'rgba(63,184,175,0.1)' : 'transparent', border: `1px solid ${showTable ? C.teal : C.line}`, color: showTable ? C.teal : C.sub, borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all .15s' }}>
            <TableIcon size={13} /> {showTable ? 'Hide Table' : 'Show Table'}
          </button>
        </div>
      )}

      <AnimatePresence>
        {showTable && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }}>
            <DataTable rows={rows} label={firstSheet?.sheetName} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Empty state ──────────────────────────────────────────────────────────── */
function EmptyState({ navigate }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 24px', textAlign: 'center' }}>
      <div style={{ width: 52, height: 52, borderRadius: 14, background: 'rgba(91,141,239,0.1)', border: '1px solid rgba(91,141,239,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
        <Database size={22} color={C.blue} />
      </div>
      <h3 style={{ color: C.ink, margin: '0 0 8px', fontWeight: 700 }}>No data sources</h3>
      <p style={{ color: C.sub, fontSize: 13, margin: '0 0 20px', maxWidth: 300, lineHeight: 1.6 }}>
        Add a Google Sheet or Excel file in Settings to see your analytics dashboard.
      </p>
      {navigate && (
        <button onClick={() => navigate('/settings')} style={{ padding: '10px 22px', borderRadius: 10, background: 'rgba(91,141,239,0.12)', border: '1px solid rgba(91,141,239,0.3)', color: C.blue, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          Go to Settings
        </button>
      )}
    </div>
  );
}
