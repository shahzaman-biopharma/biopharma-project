import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { subscribeToDepartment } from '../services/firestore';
import { fetchGoogleSheetRaw } from '../services/excel';
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import {
  ArrowLeft, Bot, RefreshCw, Database,
  Loader2, AlertCircle, BarChart2, TableIcon, Settings,
} from 'lucide-react';
import toast from 'react-hot-toast';

const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4'];

function isNumeric(val) {
  if (val === null || val === undefined || val === '') return false;
  return !isNaN(parseFloat(String(val).replace(/,/g, ''))) && isFinite(String(val).replace(/,/g, ''));
}

function cleanNum(val) {
  const n = parseFloat(String(val).replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

function detectColumnTypes(rows) {
  if (!rows || rows.length < 2) return { labelCol: 0, numericCols: [] };
  const headers = rows[0] || [];
  const sample = rows.slice(1, Math.min(rows.length, 15));
  const numericCols = [];
  let labelCol = -1;
  headers.forEach((_, i) => {
    const vals = sample.map(r => r?.[i]).filter(v => v !== null && v !== undefined && v !== '');
    const numCount = vals.filter(v => isNumeric(v)).length;
    if (vals.length > 0 && numCount / vals.length >= 0.6) {
      numericCols.push(i);
    } else if (labelCol === -1) {
      labelCol = i;
    }
  });
  if (labelCol === -1) labelCol = 0;
  return { labelCol, numericCols };
}

function buildChartData(rows, labelCol, numericCols) {
  if (!rows || rows.length < 2) return [];
  const headers = rows[0] || [];
  return rows.slice(1)
    .filter(r => r && r.length > 0 && String(r[labelCol] ?? '').trim() !== '')
    .map(row => {
      const obj = { _label: String(row[labelCol] ?? '') };
      numericCols.forEach(i => {
        obj[String(headers[i] || `Col ${i + 1}`)] = cleanNum(row[i]);
      });
      return obj;
    });
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'rgba(15,23,42,0.97)',
      border: '1px solid rgba(59,130,246,0.3)',
      borderRadius: 8,
      padding: '10px 14px',
      fontSize: 12,
      maxWidth: 220,
    }}>
      <p style={{ color: '#94a3b8', marginBottom: 6, marginTop: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color, margin: '2px 0', fontWeight: 600 }}>
          {p.name}: {typeof p.value === 'number' ? p.value.toLocaleString() : p.value}
        </p>
      ))}
    </div>
  );
}

function ChartPanel({ title, data, cols, headers, useLine, colorOffset = 0 }) {
  if (!cols.length || !data.length) return null;
  const ChartComponent = useLine ? LineChart : BarChart;
  return (
    <div style={{
      background: 'var(--glass-bg)',
      border: '1px solid var(--border-clr)',
      borderRadius: 14,
      padding: '14px 12px 10px',
    }}>
      <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        {title}
      </p>
      <ResponsiveContainer width="100%" height={190}>
        <ChartComponent data={data} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.08)" />
          <XAxis
            dataKey="_label"
            tick={{ fontSize: 10, fill: '#64748b' }}
            interval="preserveStartEnd"
            tickFormatter={v => String(v).length > 12 ? String(v).slice(0, 12) + '…' : v}
          />
          <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v} />
          <Tooltip content={<CustomTooltip />} />
          {cols.length > 1 && <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />}
          {cols.map((colIdx, ci) => {
            const key = String(headers[colIdx] || `Col ${colIdx + 1}`);
            const color = CHART_COLORS[(ci + colorOffset) % CHART_COLORS.length];
            return useLine
              ? <Line key={colIdx} type="monotone" dataKey={key} stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              : <Bar key={colIdx} dataKey={key} fill={color} radius={[3, 3, 0, 0]} maxBarSize={40} />;
          })}
        </ChartComponent>
      </ResponsiveContainer>
    </div>
  );
}

export default function DeptDashboardPage() {
  const { deptId } = useParams();
  const navigate = useNavigate();

  const [department, setDepartment] = useState(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [allSheets, setAllSheets] = useState([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState(null);

  useEffect(() => {
    const unsub = subscribeToDepartment(deptId, (dept) => {
      setDepartment(dept);
      setPageLoading(false);
    });
    return unsub;
  }, [deptId]);

  const fetchData = useCallback(async (dept) => {
    if (!dept?.dataSources?.length) {
      setAllSheets([]);
      setDataError('No data sources configured for this department.');
      return;
    }
    const validSources = dept.dataSources.filter(
      s => (s.type === 'googlesheet' || s.type === 'onedrive') && s.url
    );
    if (!validSources.length) {
      setAllSheets([]);
      setDataError('No spreadsheet data sources found. Add a Google Sheet or OneDrive Excel in Settings.');
      return;
    }
    setDataLoading(true);
    setDataError(null);

    const sheets = [];
    for (const src of validSources) {
      try {
        const { sheets: rawSheets, sheetNames } = await fetchGoogleSheetRaw(src.url);
        sheetNames.forEach(name => {
          sheets.push({ sourceName: src.name || 'Data', sheetName: name, rows: rawSheets[name] || [] });
        });
      } catch (err) {
        toast.error(`${src.name || 'Source'}: ${err.message}`);
      }
    }

    setAllSheets(sheets);
    setSelectedIdx(0);
    setDataLoading(false);
    if (!sheets.length) setDataError('Could not load data from the configured sources.');
  }, []);

  useEffect(() => {
    if (department) fetchData(department);
  }, [department, fetchData]);

  const multiSource = new Set(allSheets.map(s => s.sourceName)).size > 1;

  const current = allSheets[selectedIdx];
  const rows = current?.rows || [];
  const headers = rows[0] || [];
  const dataRows = rows.slice(1).filter(r => r && r.some(c => c !== null && c !== undefined && c !== ''));
  const { labelCol, numericCols } = detectColumnTypes(rows);
  const allChartData = buildChartData(rows, labelCol, numericCols);
  const chartData = allChartData.slice(0, 60);
  const useLineChart = chartData.length > 18;
  const chart1Cols = numericCols.slice(0, 3);
  const chart2Cols = numericCols.slice(3, 6);

  if (pageLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Loader2 size={26} style={{ animation: 'spin 1s linear infinite', color: '#3b82f6' }} />
      </div>
    );
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: 'var(--bg-primary)', position: 'relative', fontFamily: 'system-ui, sans-serif' }}>

      {/* ── Header ── */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 20,
        background: 'var(--glass-bg)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderBottom: '1px solid var(--border-clr)',
        padding: '10px 14px',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <button
          onClick={() => navigate('/dashboard')}
          style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border-clr)', background: 'transparent', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', flexShrink: 0 }}
        >
          <ArrowLeft size={15} />
        </button>

        <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <BarChart2 size={16} color="#3b82f6" />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{department?.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Dashboard</div>
        </div>

        <button
          onClick={() => fetchData(department)}
          disabled={dataLoading}
          title="Refresh data"
          style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border-clr)', background: 'transparent', cursor: dataLoading ? 'not-allowed' : 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', opacity: dataLoading ? 0.5 : 1 }}
        >
          <RefreshCw size={14} style={{ animation: dataLoading ? 'spin 1s linear infinite' : 'none' }} />
        </button>
      </div>

      {/* ── Sheet filter tabs ── */}
      {allSheets.length > 1 && (
        <div style={{
          padding: '8px 14px',
          borderBottom: '1px solid var(--border-clr)',
          display: 'flex', alignItems: 'center', gap: 6,
          overflowX: 'auto', flexWrap: 'nowrap',
          scrollbarWidth: 'none',
        }}>
          <Database size={12} color="#64748b" style={{ flexShrink: 0 }} />
          {allSheets.map((s, i) => (
            <button
              key={i}
              onClick={() => setSelectedIdx(i)}
              style={{
                padding: '4px 12px',
                borderRadius: 20,
                border: `1px solid ${i === selectedIdx ? 'rgba(59,130,246,0.5)' : 'var(--border-clr)'}`,
                background: i === selectedIdx ? 'rgba(59,130,246,0.12)' : 'transparent',
                color: i === selectedIdx ? '#60a5fa' : 'var(--text-muted)',
                fontSize: 12,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                fontWeight: i === selectedIdx ? 600 : 400,
                transition: 'all 0.15s',
                flexShrink: 0,
              }}
            >
              {multiSource ? `${s.sourceName} › ${s.sheetName}` : s.sheetName}
            </button>
          ))}
        </div>
      )}

      {/* ── Loading ── */}
      {dataLoading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 48, gap: 10 }}>
          <Loader2 size={18} style={{ animation: 'spin 1s linear infinite', color: '#3b82f6' }} />
          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading data...</span>
        </div>
      )}

      {/* ── Error ── */}
      {!dataLoading && dataError && (
        <div style={{ margin: 16, padding: 14, borderRadius: 12, background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <AlertCircle size={16} color="#ef4444" style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <p style={{ margin: '0 0 6px', fontSize: 13, color: '#f87171', fontWeight: 600 }}>{dataError}</p>
            <button
              onClick={() => navigate('/settings')}
              style={{ fontSize: 12, color: '#60a5fa', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <Settings size={12} /> Configure in Settings
            </button>
          </div>
        </div>
      )}

      {/* ── Dashboard content ── */}
      {!dataLoading && current && (
        <AnimatePresence mode="wait">
          <motion.div
            key={selectedIdx}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            style={{ padding: '14px 14px 100px' }}
          >
            {/* Sheet info bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                {allSheets.length === 1 ? current.sheetName : `${current.sourceName} › ${current.sheetName}`}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', background: 'rgba(148,163,184,0.08)', border: '1px solid var(--border-clr)', borderRadius: 20, padding: '2px 8px' }}>
                {dataRows.length} rows · {headers.length} cols
              </span>
            </div>

            {/* Charts */}
            {numericCols.length > 0 && chartData.length > 0 ? (
              <div style={{
                display: 'grid',
                gridTemplateColumns: chart2Cols.length > 0 ? 'repeat(2, 1fr)' : '1fr',
                gap: 12,
                marginBottom: 14,
              }}>
                <ChartPanel
                  title={chart1Cols.map(i => String(headers[i] || `Col ${i + 1}`)).join(' · ')}
                  data={chartData}
                  cols={chart1Cols}
                  headers={headers}
                  useLine={useLineChart}
                  colorOffset={0}
                />
                {chart2Cols.length > 0 && (
                  <ChartPanel
                    title={chart2Cols.map(i => String(headers[i] || `Col ${i + 1}`)).join(' · ')}
                    data={chartData}
                    cols={chart2Cols}
                    headers={headers}
                    useLine={useLineChart}
                    colorOffset={3}
                  />
                )}
              </div>
            ) : (
              !numericCols.length && dataRows.length > 0 && (
                <div style={{ marginBottom: 14, padding: 12, borderRadius: 10, background: 'rgba(59,130,246,0.05)', border: '1px solid rgba(59,130,246,0.12)', fontSize: 12, color: 'var(--text-muted)' }}>
                  No numeric columns detected — showing table only.
                </div>
              )
            )}

            {/* Data Table */}
            {headers.length > 0 && (
              <div style={{
                background: 'var(--glass-bg)',
                border: '1px solid var(--border-clr)',
                borderRadius: 14,
                overflow: 'hidden',
              }}>
                <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-clr)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <TableIcon size={13} color="#60a5fa" />
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>Data</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 2 }}>
                    {dataRows.length > 200 ? `${dataRows.length} rows (showing 200)` : `${dataRows.length} rows`}
                  </span>
                </div>
                <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
                      <tr style={{ background: 'rgba(15,23,42,0.95)', borderBottom: '1px solid var(--border-clr)' }}>
                        {headers.map((h, i) => (
                          <th key={i} style={{ padding: '8px 12px', textAlign: 'left', color: '#60a5fa', fontWeight: 700, whiteSpace: 'nowrap', fontSize: 11, letterSpacing: '0.03em' }}>
                            {String(h || `Col ${i + 1}`)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {dataRows.slice(0, 200).map((row, ri) => (
                        <tr
                          key={ri}
                          style={{
                            borderBottom: '1px solid rgba(148,163,184,0.06)',
                            background: ri % 2 === 0 ? 'transparent' : 'rgba(148,163,184,0.025)',
                          }}
                        >
                          {headers.map((_, ci) => (
                            <td key={ci} style={{ padding: '6px 12px', color: isNumeric(row?.[ci]) ? '#a5b4fc' : 'var(--text-secondary)', whiteSpace: 'nowrap', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {String(row?.[ci] ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      )}

      {/* ── Floating Bot Icon ── */}
      <motion.button
        onClick={() => navigate(`/bot/${deptId}`)}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        title="Open Bot Chat"
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          width: 52,
          height: 52,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #3b82f6, #6366f1)',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 20px rgba(59,130,246,0.45)',
          zIndex: 50,
        }}
      >
        <Bot size={22} color="white" />
      </motion.button>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
