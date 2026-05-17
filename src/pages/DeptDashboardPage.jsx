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

/* ── Comparison panel ─────────────────────────────────────────────────────── */
function CompKpiRow({ kpi, compareTo }) {
  const match = !compareTo || compareTo.formatted === kpi.formatted;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 10px', background: C.panel2, borderRadius: 9 }}>
      <span style={{ fontSize: 12, color: C.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '55%' }}>{kpi.label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: C.ink, fontFamily: "'IBM Plex Mono',monospace" }}>{kpi.formatted}</span>
        {compareTo && (
          <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 10, background: match ? 'rgba(95,184,120,0.12)' : 'rgba(225,95,95,0.12)', color: match ? C.green : C.red, border: `1px solid ${match ? 'rgba(95,184,120,0.3)' : 'rgba(225,95,95,0.3)'}` }}>
            {match ? '✓' : '≠'}
          </span>
        )}
      </div>
    </div>
  );
}

function ComparisonPanel({ source1, source2, validationMode }) {
  const rows1 = source1?.sheets?.[0]?.rows || [];
  const rows2 = source2?.sheets?.[0]?.rows || [];
  const kpis1 = computeKPIs(rows1);
  const kpis2 = computeKPIs(rows2);
  const maxLen = Math.max(kpis1.length, kpis2.length);
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, overflow: 'hidden', marginBottom: 20 }}>
      <div style={{ padding: '11px 18px', borderBottom: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>Source Comparison</span>
        {validationMode && (
          <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 20, background: 'rgba(91,141,239,0.1)', color: C.blue, border: '1px solid rgba(91,141,239,0.3)', fontWeight: 600 }}>Validation Mode</span>
        )}
        <span style={{ fontSize: 11, color: C.faint, marginLeft: 'auto' }}>KPI match · first sheet per source</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
        <div style={{ padding: '14px 16px', borderRight: `1px solid ${C.line}` }}>
          <div style={{ fontSize: 11, color: C.sub, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 10 }}>{source1.name}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {Array.from({ length: maxLen }).map((_, i) =>
              kpis1[i] ? <CompKpiRow key={i} kpi={kpis1[i]} compareTo={kpis2[i]} /> : null
            )}
          </div>
        </div>
        <div style={{ padding: '14px 16px' }}>
          <div style={{ fontSize: 11, color: C.sub, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 10 }}>{source2.name}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {Array.from({ length: maxLen }).map((_, i) =>
              kpis2[i] ? <CompKpiRow key={i} kpi={kpis2[i]} compareTo={kpis1[i]} /> : null
            )}
          </div>
        </div>
      </div>
    </div>
  );
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
      {children}
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
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState(null);
  const [activeTab, setActiveTab] = useState('charts');
  const [chartType, setChartType] = useState('bar'); // 'bar' | 'line' | 'area' | 'pie'

  useEffect(() => {
    const unsub = subscribeToDepartment(deptId, (dept) => {
      setDepartment(dept);
      setPageLoading(false);
    });
    return unsub;
  }, [deptId]);

  // Apply dashboard config whenever department loads or is edited+saved
  const config = department?.dashboardConfig ?? null;
  const accentColor = config?.accentColor || C.blue;
  const validationMode = !!(config?.validationMode);
  const showComparison = !!(config?.showComparison);

  useEffect(() => {
    if (config?.defaultChartType) setChartType(config.defaultChartType);
  }, [config?.defaultChartType]);

  // Re-trigger analysis if dashboard is pending or got stuck in 'analyzing'
  const analysisStartedRef = useRef(false);
  useEffect(() => {
    if (!department || analysisStartedRef.current) return;
    const status = department.dashboardStatus;
    if (status === 'pending' || status === 'analyzing' || status === 'error') {
      analysisStartedRef.current = true;
      analyzeAndBuildDashboard(department, deptId).catch(() => { analysisStartedRef.current = false; });
    }
  }, [department?.dashboardStatus, department?.id]);

  const fetchData = useCallback(async (dept) => {
    if (!dept?.dataSources?.length) {
      setAllSheets([]);
      setDataError('No data sources configured for this department.');
      return;
    }
    const valid = dept.dataSources.filter(s => (s.type === 'googlesheet' || s.type === 'onedrive') && s.url);
    if (!valid.length) {
      setAllSheets([]);
      setDataError('No spreadsheet sources found. Add a Google Sheet or Excel file in Settings.');
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
    setSelectedIdx(0);
    setDataLoading(false);
    if (!sheets.length) setDataError('Could not load any data. Make sure the file is shared with the service account (Viewer).');
  }, []);

  useEffect(() => {
    if (department) fetchData(department);
  }, [department, fetchData]);

  /* ── Computed ──────────────────────────────────────────────────────────── */
  const current = allSheets[selectedIdx];
  const rows = useMemo(() => current?.rows || [], [current]);
  const headers = rows[0] || [];
  const dataRows = useMemo(
    () => rows.slice(1).filter(r => r && r.some(c => c !== null && c !== undefined && c !== '')),
    [rows]
  );
  const { labelCol, numericCols } = useMemo(() => detectColumns(rows), [rows]);
  const kpis = useMemo(() => computeKPIs(rows), [rows]);
  const barData = useMemo(() => buildBarData(rows, labelCol, numericCols), [rows, labelCol, numericCols]);
  const barDataLimited = barData.slice(0, 50);
  const useLineChart = barDataLimited.length > 18;
  const multiSource = useMemo(() => new Set(allSheets.map(s => s.sourceName)).size > 1, [allSheets]);

  const sourceGroups = useMemo(() => {
    const map = new Map();
    allSheets.forEach(s => {
      if (!map.has(s.sourceName)) map.set(s.sourceName, []);
      map.get(s.sourceName).push(s);
    });
    return [...map.entries()].map(([name, sheets]) => ({ name, sheets }));
  }, [allSheets]);

  const chart1Cols = numericCols.slice(0, 3);
  const chart2Cols = numericCols.slice(3, 6);

  /* ── Attainment panel data ─────────────────────────────────────────────── */
  const firstNumKey = chart1Cols.length ? String(headers[chart1Cols[0]] || `Col${chart1Cols[0] + 1}`) : null;
  const maxVal = firstNumKey ? Math.max(...barDataLimited.map(r => r[firstNumKey] || 0)) : 0;

  /* ── Pie data (≤12 rows) ────────────────────────────────────────────────── */
  const showPie = barDataLimited.length <= 12 && firstNumKey;
  const pieData = showPie ? barDataLimited.map(r => ({ name: r._label, value: r[firstNumKey] })) : [];

  if (pageLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: C.bg }}>
        <Loader2 size={26} style={{ animation: 'spin 1s linear infinite', color: C.blue }} />
      </div>
    );
  }

  const dashStatus = department?.dashboardStatus;
  const isAnalyzing = dashStatus === 'analyzing' || dashStatus === 'pending';
  const hasCustom   = dashStatus === 'ready' && department?.dashboardSpec;

  const sharedHeader = (onRefresh, refreshing) => (
    <div style={{ background: `linear-gradient(180deg,${C.panel},${C.bg})`, borderBottom: `1px solid ${C.line}`, padding: '14px 22px', display: 'flex', alignItems: 'center', gap: 12, position: 'sticky', top: 0, zIndex: 20 }}>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      <button className="dd-btn" onClick={() => navigate('/dashboard')}
        style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: '6px 9px', color: C.sub, display: 'flex', alignItems: 'center' }}>
        <ArrowLeft size={15} />
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 15, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{department?.name}</div>
        <div style={{ fontSize: 11, color: C.sub, letterSpacing: '.08em', textTransform: 'uppercase' }}>
          {isAnalyzing ? 'Building custom dashboard…' : hasCustom ? 'Custom Dashboard' : 'Analytics Dashboard'}
        </div>
      </div>
      {onRefresh && (
        <button className="dd-btn" onClick={onRefresh} disabled={refreshing} title={hasCustom ? 'Re-analyze' : 'Refresh data'}
          style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: '6px 9px', color: C.sub, display: 'flex', alignItems: 'center', opacity: refreshing ? 0.5 : 1 }}>
          <RefreshCw size={14} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
        </button>
      )}
    </div>
  );

  // ── Custom dashboard (GPT-generated spec) ──────────────────────────────
  if (hasCustom) {
    return (
      <div style={{ background: '#0a0c14', minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
        <style>{`.dd-btn{background:transparent;cursor:pointer;transition:background .15s}.dd-btn:hover{background:rgba(255,255,255,.06)}`}</style>
        {sharedHeader(() => {
          analysisStartedRef.current = false;
          updateDepartment(deptId, { dashboardStatus: 'pending' })
            .then(() => analyzeAndBuildDashboard(department, deptId))
            .catch(() => {});
        }, false)}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <CustomDashboard spec={department.dashboardSpec} departmentName={department?.name} />
        </div>
        <motion.button onClick={() => navigate(`/bot/${deptId}`)} whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }}
          style={{ position: 'fixed', bottom: 24, right: 24, width: 52, height: 52, borderRadius: '50%', background: `linear-gradient(135deg,${C.blue},#6366f1)`, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 22px rgba(91,141,239,0.5)', zIndex: 50 }}>
          <Bot size={22} color="white" />
        </motion.button>
      </div>
    );
  }

  // ── Analyzing / building state ─────────────────────────────────────────
  if (isAnalyzing) {
    const STEPS = [
      'Reading data source files…',
      'Analyzing sheet structure & column stats…',
      'Understanding department purpose & context…',
      'Generating custom dashboard with GPT…',
    ];
    return (
      <div style={{ background: C.bg, minHeight: '100%', display: 'flex', flexDirection: 'column', color: C.ink, fontFamily: "'Inter',system-ui,sans-serif" }}>
        <style>{`.dd-btn{background:transparent;cursor:pointer;transition:background .15s}.dd-btn:hover{background:rgba(255,255,255,.06)}`}</style>
        {sharedHeader(null, false)}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 24px' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(91,141,239,0.1)', border: '1px solid rgba(91,141,239,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 22 }}>
            <Settings size={28} color={C.blue} style={{ animation: 'spin 2s linear infinite' }} />
          </div>
          <h3 style={{ color: C.ink, fontWeight: 800, fontSize: 20, margin: '0 0 10px', textAlign: 'center' }}>Building Your Custom Dashboard</h3>
          <p style={{ color: C.sub, fontSize: 13, textAlign: 'center', maxWidth: 380, lineHeight: 1.7, margin: '0 0 28px' }}>
            GPT is reading your data files, understanding your department's purpose, and generating a unique analytics dashboard tailored specifically for <b style={{ color: C.ink }}>{department?.name}</b>.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 340 }}>
            {STEPS.map((step, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: 'rgba(91,141,239,0.06)', borderRadius: 12, border: '1px solid rgba(91,141,239,0.15)' }}>
                <Loader2 size={14} color={C.blue} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: C.sub }}>{step}</span>
              </div>
            ))}
          </div>
          <p style={{ color: C.faint, fontSize: 11, marginTop: 24, textAlign: 'center' }}>
            This runs once and is saved permanently. Do not close the tab.
          </p>
        </div>
        <motion.button onClick={() => navigate(`/bot/${deptId}`)} whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }}
          style={{ position: 'fixed', bottom: 24, right: 24, width: 52, height: 52, borderRadius: '50%', background: `linear-gradient(135deg,${C.blue},#6366f1)`, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 22px rgba(91,141,239,0.5)', zIndex: 50 }}>
          <Bot size={22} color="white" />
        </motion.button>
      </div>
    );
  }

  return (
    <div style={{ background: C.bg, minHeight: '100%', color: C.ink, fontFamily: "'Inter',system-ui,sans-serif", paddingBottom: 80 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=IBM+Plex+Mono:wght@500;600;700&display=swap');
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .dd-btn { background: transparent; cursor: pointer; transition: background .15s; }
        .dd-btn:hover { background: rgba(255,255,255,.06); }
        tr.dd-row:hover td { background: #1e2630; }
        ::-webkit-scrollbar { height: 7px; width: 7px; }
        ::-webkit-scrollbar-thumb { background: #2a3340; border-radius: 4px; }
      `}</style>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{
        background: `linear-gradient(180deg,${C.panel},${C.bg})`,
        borderBottom: `1px solid ${C.line}`,
        padding: '14px 22px',
        display: 'flex', alignItems: 'center', gap: 12,
        position: 'sticky', top: 0, zIndex: 20,
      }}>
        <button className="dd-btn" onClick={() => navigate('/dashboard')}
          style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: '6px 9px', color: C.sub, display: 'flex', alignItems: 'center' }}>
          <ArrowLeft size={15} />
        </button>

        <div style={{ width: 36, height: 36, borderRadius: 9, background: hexAlpha(accentColor, 0.12), border: `1px solid ${hexAlpha(accentColor, 0.3)}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <BarChart2 size={17} color={accentColor} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{department?.name}</div>
          <div style={{ fontSize: 11, color: C.sub, letterSpacing: '.08em', textTransform: 'uppercase' }}>{config?.summaryText || 'Analytics Dashboard'}</div>
        </div>

        <button className="dd-btn" onClick={() => fetchData(department)} disabled={dataLoading} title="Refresh data"
          style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: '6px 9px', color: C.sub, display: 'flex', alignItems: 'center', opacity: dataLoading ? 0.5 : 1 }}>
          <RefreshCw size={14} style={{ animation: dataLoading ? 'spin 1s linear infinite' : 'none' }} />
        </button>
      </div>

      {/* ── Loading ──────────────────────────────────────────────────────── */}
      {dataLoading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60, gap: 10 }}>
          <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', color: C.blue }} />
          <span style={{ color: C.sub, fontSize: 13 }}>Loading spreadsheet data...</span>
        </div>
      )}

      {/* ── Error ──────────────────────────────────────────────────────── */}
      {!dataLoading && dataError && (
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

      {/* ── Dashboard content ──────────────────────────────────────────── */}
      {!dataLoading && current && (
        <div style={{ padding: '22px 22px 0' }}>

          {/* Comparison panel for validation/multi-source departments */}
          {showComparison && sourceGroups.length >= 2 && (
            <ComparisonPanel source1={sourceGroups[0]} source2={sourceGroups[1]} validationMode={validationMode} />
          )}

          {/* KPI strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(175px,1fr))', gap: 13, marginBottom: 20 }}>
            {kpis.map((kpi, i) => <KpiCard key={i} {...kpi} />)}
          </div>

          {/* Sheet filter + view tabs */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            {allSheets.length > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, overflowX: 'auto', flexWrap: 'nowrap', scrollbarWidth: 'none' }}>
                <Database size={11} color={C.faint} style={{ flexShrink: 0 }} />
                {allSheets.map((s, i) => (
                  <button key={i} onClick={() => setSelectedIdx(i)} style={{
                    padding: '4px 13px', borderRadius: 20, border: `1px solid ${i === selectedIdx ? C.teal : C.line}`,
                    background: i === selectedIdx ? 'rgba(63,184,175,0.1)' : 'transparent',
                    color: i === selectedIdx ? C.teal : C.sub, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
                    fontWeight: i === selectedIdx ? 700 : 400, transition: 'all .15s',
                  }}>
                    {multiSource ? `${s.sourceName} › ${s.sheetName}` : s.sheetName}
                  </button>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 5, marginLeft: allSheets.length > 1 ? 'auto' : 0, flexWrap: 'wrap' }}>
              {[['charts', 'Charts'], ['table', 'Data Table']].map(([k, l]) => (
                <button key={k} onClick={() => setActiveTab(k)} style={{
                  padding: '7px 16px', borderRadius: 8, border: `1px solid ${activeTab === k ? C.teal : C.line}`,
                  background: activeTab === k ? C.panel2 : 'transparent', color: activeTab === k ? C.ink : C.sub,
                  fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all .15s',
                }}>{l}</button>
              ))}

              {activeTab === 'charts' && numericCols.length > 0 && (
                <div style={{ display: 'flex', gap: 4, marginLeft: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: C.faint, marginRight: 2 }}>Type:</span>
                  {[['bar', 'Bar'], ['line', 'Line'], ['area', 'Area'], ['pie', 'Pie']].map(([k, l]) => (
                    <button key={k} onClick={() => setChartType(k)} style={{
                      padding: '3px 9px', borderRadius: 6, border: `1px solid ${chartType === k ? C.amber : C.line}`,
                      background: chartType === k ? 'rgba(232,168,56,0.12)' : 'transparent',
                      color: chartType === k ? C.amber : C.faint,
                      fontSize: 11, fontWeight: chartType === k ? 700 : 400, cursor: 'pointer', transition: 'all .15s',
                    }}>{l}</button>
                  ))}
                </div>
              )}
            </div>

            <span style={{ color: C.faint, fontSize: 11, whiteSpace: 'nowrap', fontFamily: "'IBM Plex Mono',monospace" }}>
              {dataRows.length} rows · {headers.length} cols
            </span>
          </div>

          {/* Animated content */}
          <AnimatePresence mode="wait">
            <motion.div
              key={`${selectedIdx}-${activeTab}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >

              {/* ── Charts view ── */}
              {activeTab === 'charts' && (
                <>
                  {numericCols.length === 0 && (
                    <div style={{ padding: 18, borderRadius: 12, background: C.panel, border: `1px solid ${C.line}`, color: C.sub, fontSize: 13 }}>
                      No numeric columns detected. Switch to Data Table to view records.
                    </div>
                  )}

                  {numericCols.length > 0 && barDataLimited.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>

                      {/* Main chart */}
                      <ChartCard
                        title={chart1Cols.map(i => String(headers[i] || '')).join(' · ')}
                        desc={`${barDataLimited.length} records · ${chartType} view`}
                      >
                        {chartType === 'pie' ? (
                          <>
                            <ResponsiveContainer width="100%" height={220}>
                              <PieChart>
                                <Pie data={barDataLimited.slice(0, 15).map(r => ({ name: r._label, value: r[String(headers[chart1Cols[0]] || `Col${chart1Cols[0]+1}`)] || 0 }))}
                                  dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={85}
                                  label={({ name }) => String(name).length > 10 ? String(name).slice(0, 9) + '…' : name} labelLine={false}>
                                  {barDataLimited.slice(0, 15).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                                </Pie>
                                <Tooltip contentStyle={{ background: '#0a0f1a', border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 12 }} />
                              </PieChart>
                            </ResponsiveContainer>
                          </>
                        ) : (
                          <ResponsiveContainer width="100%" height={300}>
                            {chartType === 'line' ? (
                              <LineChart data={barDataLimited} margin={{ top: 5, right: 10, bottom: 62, left: -10 }}>
                                <CartesianGrid stroke={C.line} vertical={false} />
                                <XAxis dataKey="_label" angle={-38} textAnchor="end" interval={0} tick={{ fill: C.sub, fontSize: 10 }} height={70} tickFormatter={v => String(v).length > 13 ? String(v).slice(0, 12) + '…' : v} />
                                <YAxis tick={{ fill: C.sub, fontSize: 10 }} tickFormatter={fmtNum} />
                                <Tooltip content={<DarkTooltip />} />
                                {chart1Cols.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
                                {chart1Cols.map((ci, idx) => (
                                  <Line key={ci} type="monotone" dataKey={String(headers[ci] || `Col${ci + 1}`)} stroke={COLORS[idx]} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
                                ))}
                              </LineChart>
                            ) : chartType === 'area' ? (
                              <AreaChart data={barDataLimited} margin={{ top: 5, right: 10, bottom: 62, left: -10 }}>
                                <defs>
                                  {chart1Cols.map((ci, idx) => (
                                    <linearGradient key={ci} id={`agrad${idx}`} x1="0" y1="0" x2="0" y2="1">
                                      <stop offset="5%" stopColor={COLORS[idx]} stopOpacity={0.3} />
                                      <stop offset="95%" stopColor={COLORS[idx]} stopOpacity={0} />
                                    </linearGradient>
                                  ))}
                                </defs>
                                <CartesianGrid stroke={C.line} vertical={false} />
                                <XAxis dataKey="_label" angle={-38} textAnchor="end" interval={0} tick={{ fill: C.sub, fontSize: 10 }} height={70} tickFormatter={v => String(v).length > 13 ? String(v).slice(0, 12) + '…' : v} />
                                <YAxis tick={{ fill: C.sub, fontSize: 10 }} tickFormatter={fmtNum} />
                                <Tooltip content={<DarkTooltip />} />
                                {chart1Cols.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
                                {chart1Cols.map((ci, idx) => (
                                  <Area key={ci} type="monotone" dataKey={String(headers[ci] || `Col${ci + 1}`)} stroke={COLORS[idx]} strokeWidth={2} fill={`url(#agrad${idx})`} />
                                ))}
                              </AreaChart>
                            ) : (
                              <BarChart data={barDataLimited} margin={{ top: 5, right: 10, bottom: 62, left: -10 }}>
                                <CartesianGrid stroke={C.line} vertical={false} />
                                <XAxis dataKey="_label" angle={-38} textAnchor="end" interval={0} tick={{ fill: C.sub, fontSize: 10 }} height={70} tickFormatter={v => String(v).length > 13 ? String(v).slice(0, 12) + '…' : v} />
                                <YAxis tick={{ fill: C.sub, fontSize: 10 }} tickFormatter={fmtNum} />
                                <Tooltip content={<DarkTooltip />} cursor={{ fill: 'rgba(255,255,255,.04)' }} />
                                {chart1Cols.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
                                {chart1Cols.map((ci, idx) => (
                                  <Bar key={ci} dataKey={String(headers[ci] || `Col${ci + 1}`)} fill={COLORS[idx]} radius={[3, 3, 0, 0]} maxBarSize={38} />
                                ))}
                              </BarChart>
                            )}
                          </ResponsiveContainer>
                        )}
                      </ChartCard>

                      {/* Right panel: chart2 OR pie OR distribution bars */}
                      {chart2Cols.length > 0 ? (
                        <ChartCard
                          title={chart2Cols.map(i => String(headers[i] || '')).join(' · ')}
                          desc="Additional metrics"
                        >
                          <ResponsiveContainer width="100%" height={300}>
                            <BarChart data={barDataLimited} margin={{ top: 5, right: 10, bottom: 62, left: -10 }}>
                              <CartesianGrid stroke={C.line} vertical={false} />
                              <XAxis dataKey="_label" angle={-38} textAnchor="end" interval={0} tick={{ fill: C.sub, fontSize: 10 }} height={70} tickFormatter={v => String(v).length > 13 ? String(v).slice(0, 12) + '…' : v} />
                              <YAxis tick={{ fill: C.sub, fontSize: 10 }} tickFormatter={fmtNum} />
                              <Tooltip content={<DarkTooltip />} cursor={{ fill: 'rgba(255,255,255,.04)' }} />
                              {chart2Cols.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
                              {chart2Cols.map((ci, idx) => (
                                <Bar key={ci} dataKey={String(headers[ci] || `Col${ci + 1}`)} fill={COLORS[idx + 3]} radius={[3, 3, 0, 0]} maxBarSize={38} />
                              ))}
                            </BarChart>
                          </ResponsiveContainer>
                        </ChartCard>
                      ) : showPie ? (
                        <ChartCard
                          title={`${String(headers[chart1Cols[0]] || 'Value')} distribution`}
                          desc={`By ${String(headers[labelCol] || 'category')} · ${pieData.length} items`}
                        >
                          <ResponsiveContainer width="100%" height={220}>
                            <PieChart>
                              <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={85} label={({ name }) => String(name).length > 10 ? String(name).slice(0, 9) + '…' : name} labelLine={false}>
                                {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                              </Pie>
                              <Tooltip contentStyle={{ background: '#0a0f1a', border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 12 }} />
                            </PieChart>
                          </ResponsiveContainer>
                          <div style={{ marginTop: 4 }}>
                            {pieData.slice(0, 6).map((r, i) => (
                              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: `1px solid ${C.line}`, fontSize: 12 }}>
                                <span style={{ color: C.ink, display: 'flex', alignItems: 'center', gap: 7 }}>
                                  <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: COLORS[i % COLORS.length] }} />
                                  {String(r.name).length > 22 ? String(r.name).slice(0, 21) + '…' : r.name}
                                </span>
                                <span style={{ color: C.sub, fontFamily: "'IBM Plex Mono',monospace" }}>{fmtNum(r.value)}</span>
                              </div>
                            ))}
                          </div>
                        </ChartCard>
                      ) : firstNumKey && (
                        <ChartCard
                          title="Attainment"
                          desc={`${String(headers[numericCols[0]] || 'Value')} ranked by ${String(headers[labelCol] || 'label')}`}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 330, overflowY: 'auto', paddingRight: 4 }}>
                            {barDataLimited.slice(0, 25).map((row, ri) => {
                              const pct = maxVal > 0 ? Math.round((row[firstNumKey] / maxVal) * 100) : 0;
                              const tone = pct >= 80 ? 'green' : pct >= 50 ? 'teal' : 'amber';
                              return (
                                <div key={ri}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 5 }}>
                                    <span style={{ color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '68%' }}>{row._label}</span>
                                    <span style={{ color: C[tone], fontFamily: "'IBM Plex Mono',monospace", fontWeight: 700 }}>{fmtNum(row[firstNumKey])}</span>
                                  </div>
                                  <MiniBar pct={pct} tone={tone} />
                                </div>
                              );
                            })}
                          </div>
                        </ChartCard>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* ── Table view ── */}
              {activeTab === 'table' && (
                <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, overflow: 'hidden' }}>
                  <div style={{ padding: '12px 18px', borderBottom: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <TableIcon size={14} color={C.blue} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>Full Data — {current.sheetName}</span>
                    <span style={{ fontSize: 11, color: C.faint, marginLeft: 4 }}>
                      {dataRows.length > 200 ? `first 200 of ${dataRows.length}` : `${dataRows.length} rows`}
                    </span>
                  </div>
                  <div style={{ overflowX: 'auto', maxHeight: 520, overflowY: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                      <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
                        <tr style={{ background: '#0a0f1a', borderBottom: `1px solid ${C.line}` }}>
                          {headers.map((h, i) => (
                            <th key={i} style={{ padding: '9px 13px', textAlign: 'left', color: C.sub, fontWeight: 700, whiteSpace: 'nowrap', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                              {String(h || `Col ${i + 1}`)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {dataRows.slice(0, 200).map((row, ri) => (
                          <tr key={ri} className="dd-row" style={{ borderBottom: `1px solid rgba(42,51,64,0.5)` }}>
                            {headers.map((_, ci) => {
                              const val = row?.[ci] ?? '';
                              const num = isNumeric(val);
                              return (
                                <td key={ci} style={{ padding: '8px 13px', color: num ? C.teal : C.ink, whiteSpace: 'nowrap', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: num ? "'IBM Plex Mono',monospace" : 'inherit', fontSize: num ? 12 : 12.5 }}>
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
              )}

            </motion.div>
          </AnimatePresence>
        </div>
      )}

      {/* ── Floating Bot FAB ─────────────────────────────────────────────── */}
      <motion.button
        onClick={() => navigate(`/bot/${deptId}`)}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        title="Open Bot Chat"
        style={{
          position: 'fixed', bottom: 24, right: 24,
          width: 52, height: 52, borderRadius: '50%',
          background: `linear-gradient(135deg, ${C.blue}, #6366f1)`,
          border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 22px rgba(91,141,239,0.5)', zIndex: 50,
        }}
      >
        <Bot size={22} color="white" />
      </motion.button>
    </div>
  );
}
