import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { subscribeToDepartment, getChatHistory, saveChatMessage } from '../services/firestore';
import { chatWithBot, generateFileData } from '../services/openai';
import { fetchGoogleSheetData, fetchGoogleSheetRaw } from '../services/excel';
import {
  ArrowLeft, Send, Bot, User, Loader2,
  Database, RefreshCw, Sparkles,
  FileSpreadsheet, FileDown, Table2, Mic, BarChart2, Layers, X,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';
import VoiceMode from '../components/common/VoiceMode';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './BotPage.css';

// ─── Inline dashboard theme (matches DeptDashboardPage) ──────────────────────

const C = {
  bg: '#0f1419', panel: '#171d26', panel2: '#1e2630', line: '#2a3340',
  ink: '#e8eef5', sub: '#8a99ad', faint: '#5a6878',
  teal: '#3fb8af', amber: '#e8a838', red: '#e15f5f',
  green: '#5fb878', blue: '#5b8def', violet: '#9b7fe8',
};
const COLORS = [C.teal, C.blue, C.violet, C.amber, C.green, C.red];
const TONES = ['teal', 'blue', 'violet', 'amber', 'green', 'red'];

// ─── Dashboard helpers (shared logic with DeptDashboardPage) ─────────────────

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
  const kpis = [{ label: 'Total Records', formatted: String(dataRows.length), hint: 'rows', tone: 'blue' }];
  let ti = 0;
  headers.forEach((h, i) => {
    if (kpis.length >= 5) return;
    const vals = dataRows.map(r => r?.[i]).filter(isNumeric).map(cleanNum);
    if (vals.length < Math.max(1, dataRows.length * 0.4)) return;
    const sum = vals.reduce((a, b) => a + b, 0);
    const label = String(h || '').trim();
    if (!label) return;
    kpis.push({ label, formatted: fmtNum(sum), hint: `${vals.length} values`, tone: TONES[ti++ % TONES.length] });
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
function sheetToText(sheet) {
  const { sheetName, sourceName, rows } = sheet;
  const headers = rows[0] || [];
  const dataRows = rows.slice(1).slice(0, 500);
  return `=== Sheet: ${sheetName} (${sourceName}) ===\nColumns (${headers.length}): ${headers.join(' | ')}\nTotal rows: ${rows.length - 1}\n\n${headers.join(' | ')}\n${dataRows.map(r => headers.map((_, i) => String(r[i] ?? '')).join(' | ')).join('\n')}`;
}

// ─── Detect file request ──────────────────────────────────────────────────────

const FILE_KEYWORDS = [
  'pdf', 'excel', 'xlsx', 'spreadsheet', 'table mein', 'file mein',
  'download', 'export', 'sheet banao', 'report banao', 'file bana',
  'table bana', 'summary pdf', 'summary excel', 'chart bana',
];
function isFileRequest(text) {
  const lower = text.toLowerCase();
  return FILE_KEYWORDS.some(k => lower.includes(k));
}

// ─── Detect inline dashboard request ─────────────────────────────────────────

const DASHBOARD_KEYWORDS = [
  'dashboard', 'kpi', 'show chart', 'show graph', 'graph banao',
  'chart dikhao', 'visualize', 'visualization', 'analytics dikhao',
  'stats dikhao', 'kpi dikhao', 'dashboard banao', 'dashboard dikhao',
  'data visualize', 'show analytics', 'show stats', 'show kpi',
  'data dashboard', 'inline dashboard',
];
function isDashboardRequest(text) {
  const lower = text.toLowerCase();
  return DASHBOARD_KEYWORDS.some(k => lower.includes(k));
}

// ─── Excel generator ──────────────────────────────────────────────────────────

function generateExcel(fileData) {
  const wb = XLSX.utils.book_new();
  for (const sheet of fileData.sheets) {
    const wsData = [];
    wsData.push([fileData.title]);
    wsData.push([fileData.subtitle || '']);
    wsData.push([]);
    wsData.push(sheet.headers);
    for (const row of sheet.rows) wsData.push(row);
    wsData.push([]);
    wsData.push(['Summary:', fileData.summary]);
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const colWidths = sheet.headers.map((h, i) => ({
      wch: Math.max(h.length + 4, ...sheet.rows.map(r => String(r[i] || '').length + 2)),
    }));
    ws['!cols'] = colWidths;
    const cols = sheet.headers.length;
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: cols - 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: cols - 1 } },
    ];
    XLSX.utils.book_append_sheet(wb, ws, sheet.name.substring(0, 31));
  }
  const fileName = `${fileData.title.replace(/[^a-zA-Z0-9 ]/g, '').trim()}_${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
  XLSX.writeFile(wb, fileName);
}

// ─── PDF generator ────────────────────────────────────────────────────────────

function generatePDF(fileData) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageW, 38, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text(fileData.title, pageW / 2, 16, { align: 'center' });
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(148, 163, 184);
  doc.text(fileData.subtitle || `Generated: ${format(new Date(), 'PPpp')}`, pageW / 2, 24, { align: 'center' });
  doc.text(`BioPharma CRA Platform  •  ${format(new Date(), 'PPpp')}`, pageW / 2, 30, { align: 'center' });
  let yPos = 46;
  if (fileData.summary) {
    doc.setFillColor(239, 246, 255);
    doc.setDrawColor(59, 130, 246);
    doc.roundedRect(14, yPos, pageW - 28, 18, 2, 2, 'FD');
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    const lines = doc.splitTextToSize(fileData.summary, pageW - 38);
    doc.text(lines.slice(0, 2), 20, yPos + 7);
    yPos += 24;
  }
  for (const sheet of fileData.sheets) {
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 41, 59);
    doc.text(sheet.name, 14, yPos + 4);
    yPos += 8;
    autoTable(doc, {
      head: [sheet.headers],
      body: sheet.rows,
      startY: yPos,
      margin: { left: 14, right: 14 },
      styles: { fontSize: 8, cellPadding: 3, lineColor: [226, 232, 240], lineWidth: 0.3, textColor: [30, 41, 59] },
      headStyles: { fillColor: [59, 130, 246], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.5 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      tableLineColor: [203, 213, 225], tableLineWidth: 0.3,
    });
    yPos = doc.lastAutoTable.finalY + 14;
  }
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text('BioPharma CRA Platform — Confidential', 14, doc.internal.pageSize.getHeight() - 8);
    doc.text(`Page ${i} of ${pageCount}`, pageW - 14, doc.internal.pageSize.getHeight() - 8, { align: 'right' });
  }
  const fileName = `${fileData.title.replace(/[^a-zA-Z0-9 ]/g, '').trim()}_${format(new Date(), 'yyyy-MM-dd')}.pdf`;
  doc.save(fileName);
}

// ─── Status colour for table cells ───────────────────────────────────────────

const STATUS_CLASSES = {
  verified: 'bp-td-green', resolved: 'bp-td-green', complete: 'bp-td-green',
  pass: 'bp-td-green', passed: 'bp-td-green', yes: 'bp-td-green', active: 'bp-td-green',
  pending: 'bp-td-red', open: 'bp-td-red', failed: 'bp-td-red',
  critical: 'bp-td-red', missing: 'bp-td-red', no: 'bp-td-red', overdue: 'bp-td-red',
  'n/a': 'bp-td-yellow', partial: 'bp-td-yellow', review: 'bp-td-yellow',
  'in progress': 'bp-td-yellow',
};
function cellClass(children) {
  const text = Array.isArray(children)
    ? children.filter(c => typeof c === 'string').join('').trim().toLowerCase()
    : typeof children === 'string' ? children.trim().toLowerCase() : '';
  return STATUS_CLASSES[text] || '';
}

// ─── Inline Dashboard component ───────────────────────────────────────────────

function InlineDashboard({ rows, sheetName }) {
  const kpis = computeKPIs(rows);
  const { labelCol, numericCols } = detectColumns(rows);
  const headers = rows[0] || [];
  const barData = buildBarData(rows, labelCol, numericCols).slice(0, 20);
  const chart1Cols = numericCols.slice(0, 3);
  const dataRows = rows.slice(1).filter(r => r && r.some(c => c !== null && c !== undefined && c !== ''));
  const firstNumKey = chart1Cols.length ? String(headers[chart1Cols[0]] || `Col${chart1Cols[0] + 1}`) : null;
  const showPie = barData.length > 0 && barData.length <= 10 && firstNumKey;
  const pieData = showPie ? barData.map(r => ({ name: r._label, value: r[firstNumKey] || 0 })) : [];

  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, overflow: 'hidden', marginTop: 4, fontFamily: "'Inter',system-ui,sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@600;700&display=swap');`}</style>

      {/* Header */}
      <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', gap: 8 }}>
        <BarChart2 size={14} color={C.teal} />
        <span style={{ fontSize: 13, fontWeight: 700, color: C.ink, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sheetName}</span>
        <span style={{ fontSize: 11, color: C.faint, whiteSpace: 'nowrap', fontFamily: "'IBM Plex Mono',monospace" }}>{dataRows.length} rows</span>
      </div>

      {/* KPI strip */}
      {kpis.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))', gap: 8, padding: '12px 14px 0' }}>
          {kpis.map((kpi, i) => (
            <div key={i} style={{ background: C.panel2, borderRadius: 10, padding: '10px 12px', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: C[kpi.tone] || C.teal, borderRadius: '10px 0 0 10px' }} />
              <div style={{ fontSize: 10, color: C.sub, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4, paddingLeft: 2 }}>{kpi.label}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: C.ink, fontFamily: "'IBM Plex Mono',monospace", lineHeight: 1 }}>{kpi.formatted}</div>
              <div style={{ fontSize: 10, color: C.faint, marginTop: 3, paddingLeft: 2 }}>{kpi.hint}</div>
            </div>
          ))}
        </div>
      )}

      {/* Chart */}
      {chart1Cols.length > 0 && barData.length > 0 && (
        <div style={{ padding: '12px 14px 4px' }}>
          {showPie ? (
            <ResponsiveContainer width="100%" height={190}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75}
                  label={({ name }) => String(name).length > 10 ? String(name).slice(0, 9) + '…' : name}
                  labelLine={false} fontSize={10}>
                  {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ background: '#0a0f1a', border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <ResponsiveContainer width="100%" height={190}>
              <BarChart data={barData} margin={{ top: 5, right: 5, bottom: 55, left: -10 }}>
                <CartesianGrid stroke={C.line} vertical={false} />
                <XAxis dataKey="_label" angle={-38} textAnchor="end" interval={0}
                  tick={{ fill: C.sub, fontSize: 9 }} height={65}
                  tickFormatter={v => String(v).length > 12 ? String(v).slice(0, 11) + '…' : v} />
                <YAxis tick={{ fill: C.sub, fontSize: 9 }} tickFormatter={fmtNum} />
                <Tooltip contentStyle={{ background: '#0a0f1a', border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 11 }}
                  cursor={{ fill: 'rgba(255,255,255,.04)' }} />
                {chart1Cols.map((ci, idx) => (
                  <Bar key={ci} dataKey={String(headers[ci] || `Col${ci + 1}`)} fill={COLORS[idx]}
                    radius={[3, 3, 0, 0]} maxBarSize={28} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      )}

      {/* Mini table */}
      {headers.length > 0 && dataRows.length > 0 && (
        <div style={{ margin: '8px 14px 14px', borderRadius: 8, overflow: 'hidden', border: `1px solid ${C.line}` }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ background: C.panel2 }}>
                  {headers.slice(0, 6).map((h, i) => (
                    <th key={i} style={{ padding: '6px 10px', textAlign: 'left', color: C.sub, fontWeight: 700, whiteSpace: 'nowrap', borderBottom: `1px solid ${C.line}` }}>
                      {String(h || '')}
                    </th>
                  ))}
                  {headers.length > 6 && (
                    <th style={{ padding: '6px 10px', color: C.faint, borderBottom: `1px solid ${C.line}`, fontSize: 10 }}>+{headers.length - 6} more</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {dataRows.slice(0, 8).map((row, ri) => (
                  <tr key={ri} style={{ borderBottom: `1px solid ${C.line}` }}>
                    {headers.slice(0, 6).map((_, ci) => (
                      <td key={ci} style={{ padding: '5px 10px', color: C.ink, whiteSpace: 'nowrap' }}>
                        {String(row?.[ci] ?? '')}
                      </td>
                    ))}
                    {headers.length > 6 && <td style={{ padding: '5px 10px', color: C.faint }}>…</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {dataRows.length > 8 && (
            <div style={{ padding: '5px 10px', color: C.faint, fontSize: 10, textAlign: 'center', background: C.panel2, borderTop: `1px solid ${C.line}` }}>
              Showing 8 of {dataRows.length} rows — open Dashboard for full view
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function ChatMessage({ msg }) {
  const isUser = msg.role === 'user';
  const [generating, setGenerating] = useState({ pdf: false, excel: false });

  const handleDownload = async (type) => {
    if (!msg.fileData) return;
    setGenerating(p => ({ ...p, [type]: true }));
    try {
      if (type === 'excel') generateExcel(msg.fileData);
      else generatePDF(msg.fileData);
      toast.success(`${type.toUpperCase()} downloaded!`);
    } catch {
      toast.error(`Failed to generate ${type.toUpperCase()}`);
    } finally {
      setGenerating(p => ({ ...p, [type]: false }));
    }
  };

  // Inline dashboard message
  if (msg.type === 'dashboard') {
    return (
      <div className="bp-msg-row">
        <div className="bp-avatar bot"><Bot size={13} color="#60a5fa" /></div>
        <div className="bp-bubble-col" style={{ flex: 1, minWidth: 0, maxWidth: '100%' }}>
          {msg.rows ? (
            <>
              {msg.content && (
                <div className="bp-bubble received" style={{ marginBottom: 8 }}>
                  <ReactMarkdown className="bp-markdown" remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                </div>
              )}
              <InlineDashboard rows={msg.rows} sheetName={msg.sheetName} />
            </>
          ) : (
            <div className="bp-bubble received" style={{ fontStyle: 'italic', color: '#8a99ad', fontSize: 12 }}>
              📊 Dashboard was shown here — ask again to regenerate.
            </div>
          )}
          <span className="bp-time">{msg.timestamp ? format(new Date(msg.timestamp), 'HH:mm') : ''}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`bp-msg-row${isUser ? ' is-user' : ''}`}>
      <div className={`bp-avatar ${isUser ? 'user' : 'bot'}`}>
        {isUser
          ? <User size={13} color="#fff" />
          : <Bot size={13} color="#60a5fa" />}
      </div>

      <div className="bp-bubble-col">
        <div className={`bp-bubble ${isUser ? 'sent' : 'received'}`}>
          {isUser ? (
            msg.content
          ) : (
            <ReactMarkdown
              className="bp-markdown"
              remarkPlugins={[remarkGfm]}
              components={{
                table: ({ children }) => (
                  <>
                    <div className="bp-table-wrapper">
                      <table className="bp-table">{children}</table>
                    </div>
                    <p className="bp-scroll-hint">← swipe to see more →</p>
                  </>
                ),
                td: ({ children }) => (
                  <td className={cellClass(children) || undefined}>{children}</td>
                ),
              }}
            >
              {msg.content}
            </ReactMarkdown>
          )}
        </div>

        {msg.fileData && (
          <div className="bp-file-row">
            <div className="bp-file-info">
              <Table2 size={11} color="#60a5fa" />
              <span>{msg.fileData.sheets?.length} sheet{msg.fileData.sheets?.length !== 1 ? 's' : ''} ready</span>
            </div>
            <button className="bp-excel-btn" onClick={() => handleDownload('excel')} disabled={generating.excel}>
              {generating.excel ? <Loader2 size={11} className="bp-animate-spin" /> : <FileSpreadsheet size={11} />}
              Excel
            </button>
            <button className="bp-pdf-btn" onClick={() => handleDownload('pdf')} disabled={generating.pdf}>
              {generating.pdf ? <Loader2 size={11} className="bp-animate-spin" /> : <FileDown size={11} />}
              PDF
            </button>
          </div>
        )}

        <span className="bp-time">{msg.timestamp ? format(new Date(msg.timestamp), 'HH:mm') : ''}</span>
      </div>
    </div>
  );
}

// ─── Live data fetcher (full context — all sources) ───────────────────────────

async function fetchDeptContext(dept) {
  let ctx = `Department: ${dept.name}\nDescription: ${dept.description}\n\n`;
  if (!dept?.dataSources?.length) return ctx;
  const sheetIndex = [];
  for (const src of dept.dataSources) {
    try {
      if ((src.type === 'googlesheet' || src.type === 'onedrive') && src.url) {
        const result = await fetchGoogleSheetData(src.url);
        ctx += `\n--- Data Source: "${src.name}" ---\n${result.text}\n`;
        if (result.sheetNames?.length)
          sheetIndex.push(`"${src.name}": ${result.sheetNames.length} tab(s) — [${result.sheetNames.join(', ')}]`);
      } else if (src.type === 'text' && src.content) {
        ctx += `\n--- Data Source: "${src.name}" ---\n${src.content}\n`;
      }
    } catch (err) {
      ctx += `\n--- Data Source: "${src.name}" ---\nError loading: ${err.message}\n`;
    }
  }
  if (sheetIndex.length) ctx += `\n\n--- SHEET INDEX ---\n${sheetIndex.join('\n')}\n`;
  return ctx;
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function BotPage() {
  const { deptId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [department, setDepartment] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);

  // Sheet selector state
  const [allSheets, setAllSheets] = useState([]);     // {sourceName, sheetName, rows}[]
  const [selectedSheet, setSelectedSheet] = useState(null); // null = all sheets
  const [sheetPickerOpen, setSheetPickerOpen] = useState(false);

  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const sheetPickerRef = useRef(null);
  const departmentRef = useRef(null);
  const selectedSheetRef = useRef(null);
  const allSheetsRef = useRef([]);

  useEffect(() => { departmentRef.current = department; }, [department]);
  useEffect(() => { selectedSheetRef.current = selectedSheet; }, [selectedSheet]);
  useEffect(() => { allSheetsRef.current = allSheets; }, [allSheets]);

  // Close sheet picker when clicking outside
  useEffect(() => {
    function handleClick(e) {
      if (sheetPickerRef.current && !sheetPickerRef.current.contains(e.target))
        setSheetPickerOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    setPageLoading(true);
    let historyLoaded = false;
    const unsub = subscribeToDepartment(deptId, async (dept) => {
      if (!dept) { navigate('/dashboard'); return; }
      setDepartment(dept);
      if (!historyLoaded) {
        historyLoaded = true;
        try {
          const history = await getChatHistory(user.uid, deptId);
          if (history.length > 0) {
            setMessages(history);
          } else {
            setMessages([{
              role: 'assistant',
              content: `Hello! I'm the **${dept.name}** AI assistant.\n\nI can help you analyze data, answer questions, and generate downloadable reports.\n\nTip: Ask me for a **dashboard** to see KPIs and charts inline, or ask me to "generate an Excel report"!\n\nHow can I help you today?`,
              timestamp: Date.now(),
            }]);
          }
          await loadDataSources(dept);
        } catch {
          toast.error('Failed to load bot');
        } finally {
          setPageLoading(false);
        }
      }
    });
    return () => unsub();
  }, [deptId, user.uid]);

  useEffect(() => {
    if (location.state?.initialMessage && department && !pageLoading) {
      const msg = location.state.initialMessage;
      if (msg) {
        handleSend(msg);
        window.history.replaceState({}, '');
      }
    }
  }, [department, pageLoading]);

  const loadDataSources = async (dept) => {
    if (!dept.dataSources?.length) { setDataLoaded(true); return; }
    const sheets = [];
    for (const src of dept.dataSources) {
      try {
        if ((src.type === 'googlesheet' || src.type === 'onedrive') && src.url) {
          const { sheets: raw, sheetNames } = await fetchGoogleSheetRaw(src.url);
          sheetNames.forEach(name => {
            if ((raw[name] || []).length > 1)
              sheets.push({ sourceName: src.name || 'Data', sheetName: name, rows: raw[name] });
          });
        }
      } catch { /* individual source failures are non-fatal */ }
    }
    setAllSheets(sheets);
    setDataLoaded(true);
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(async (text) => {
    const dept = departmentRef.current;
    const userMsg = text || input.trim();
    if (!userMsg || loading || !dept) return;
    setInput('');

    const userMessage = { role: 'user', content: userMsg, timestamp: Date.now() };
    setMessages(prev => [...prev, userMessage]);
    setLoading(true);

    try {
      // ── Inline dashboard request ──────────────────────────────────────────
      if (isDashboardRequest(userMsg)) {
        const targetSheet = selectedSheetRef.current || allSheetsRef.current[0];
        if (targetSheet) {
          const dashMsg = {
            role: 'assistant',
            type: 'dashboard',
            rows: targetSheet.rows,
            sheetName: `${targetSheet.sheetName}`,
            content: `Here's the **${targetSheet.sheetName}** dashboard from **${targetSheet.sourceName}**:`,
            timestamp: Date.now(),
          };
          setMessages(prev => {
            const next = [...prev, dashMsg];
            // Strip rows before saving to Firestore (too large)
            saveChatMessage(user.uid, deptId, next.map(({ rows: _, ...m }) => m)).catch(() => {});
            return next;
          });
          setLoading(false);
          inputRef.current?.focus();
          return;
        }
        // No sheets loaded — fall through to normal bot response
      }

      // ── Normal / file request ─────────────────────────────────────────────
      const wantsFile = isFileRequest(userMsg);
      setSyncing(true);

      let freshContext;
      const activeSingleSheet = selectedSheetRef.current;
      if (activeSingleSheet) {
        freshContext = `Department: ${dept.name}\nDescription: ${dept.description}\n\n${sheetToText(activeSingleSheet)}`;
      } else {
        freshContext = await fetchDeptContext(dept);
      }
      setSyncing(false);

      const systemPrompt = dept.systemPrompt || `You are the AI assistant for ${dept.name}.`;

      if (wantsFile) {
        const [reply, fileData] = await Promise.all([
          chatWithBot({ systemPrompt, userMessage: userMsg, dataContext: freshContext }),
          generateFileData({
            userRequest: userMsg,
            dataContext: freshContext || `Department: ${dept.name}\nDescription: ${dept.description}`,
            departmentName: dept.name,
          }).catch(() => null),
        ]);
        const botMsg = { role: 'assistant', content: reply, timestamp: Date.now(), fileData: fileData || undefined };
        setMessages(prev => {
          const next = [...prev, botMsg];
          saveChatMessage(user.uid, deptId, next.map(({ fileData: _, ...m }) => m)).catch(() => {});
          return next;
        });
      } else {
        const reply = await chatWithBot({ systemPrompt, userMessage: userMsg, dataContext: freshContext });
        const botMsg = { role: 'assistant', content: reply, timestamp: Date.now() };
        setMessages(prev => {
          const next = [...prev, botMsg];
          saveChatMessage(user.uid, deptId, next).catch(() => {});
          return next;
        });
      }
    } catch (err) {
      setSyncing(false);
      const status = err?.status ?? 0;
      const msg = (err?.message ?? '').toLowerCase();
      const errMsg = status === 429 || msg.includes('rate limit') || msg.includes('quota') || msg.includes('exceeded')
        ? 'Rate limit reached. Please wait a moment and try again.'
        : msg.includes('api key') || msg.includes('authentication') || msg.includes('unauthorized')
          ? 'OpenAI API key not configured. Check settings.'
          : 'Failed to get response. Please try again.';
      toast.error(errMsg);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Sorry, I encountered an error: ${errMsg}`,
        timestamp: Date.now(),
      }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [input, loading, user.uid, deptId]);

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const clearChat = () => {
    const welcome = [{
      role: 'assistant',
      content: `Chat cleared. Hello again! I'm your ${departmentRef.current?.name} assistant. How can I help you?`,
      timestamp: Date.now(),
    }];
    setMessages(welcome);
    saveChatMessage(user.uid, deptId, welcome).catch(() => {});
    toast.success('Chat cleared');
  };

  const handleVoiceMessage = useCallback((userText, botText) => {
    setMessages(prev => {
      const next = [
        ...prev,
        { role: 'user', content: userText, timestamp: Date.now() },
        { role: 'assistant', content: botText, timestamp: Date.now() },
      ];
      saveChatMessage(user.uid, deptId, next).catch(() => {});
      return next;
    });
  }, [user.uid, deptId]);

  if (pageLoading) {
    return (
      <div className="bp-page-loading">
        <div className="bp-spinner-wrap">
          <div className="bp-spinner" />
          <p className="bp-spinner-text">Loading bot...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bp-page">

      {/* ── Header ── */}
      <div className="bp-header">
        <button className="bp-header-btn" onClick={() => navigate('/dashboard')}>
          <ArrowLeft size={15} />
        </button>

        <div className="bp-header-icon">
          <Bot size={17} color="#fff" />
        </div>

        <div className="bp-header-info">
          <div className="bp-header-title">{department?.name}</div>
          <div className="bp-header-status">
            <div className="bp-status-dot" />
            <span>AI Assistant Active</span>
            {selectedSheet ? (
              <>
                <span>•</span>
                <Layers size={10} color="#3fb8af" />
                <span style={{ color: '#3fb8af' }}>{selectedSheet.sheetName}</span>
              </>
            ) : dataLoaded && department?.dataSources?.length > 0 ? (
              <>
                <span>•</span>
                <Database size={10} />
                <span>{department.dataSources.length} source{department.dataSources.length > 1 ? 's' : ''}</span>
              </>
            ) : null}
          </div>
        </div>

        <div className="bp-header-badge">
          <FileSpreadsheet size={11} color="#60a5fa" />
          PDF / Excel
        </div>

        <button
          className="bp-header-btn bp-mic-btn"
          onClick={() => setVoiceMode(true)}
          title="Voice mode"
        >
          <Mic size={14} />
        </button>

        {/* Sheet picker button */}
        <div ref={sheetPickerRef} style={{ position: 'relative' }}>
          <button
            className="bp-header-btn"
            onClick={() => setSheetPickerOpen(prev => !prev)}
            title={selectedSheet ? `Filtered: ${selectedSheet.sheetName}` : 'Filter by sheet'}
            style={selectedSheet ? { color: '#3fb8af', borderColor: '#3fb8af' } : {}}
          >
            <Layers size={14} />
          </button>

          {sheetPickerOpen && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 200,
              background: '#171d26', border: '1px solid #2a3340', borderRadius: 12,
              padding: '8px', minWidth: 230, maxHeight: 320, overflowY: 'auto',
              boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 6px 8px' }}>
                <span style={{ fontSize: 11, color: '#5a6878', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' }}>Filter Sheet</span>
                <button onClick={() => setSheetPickerOpen(false)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#5a6878', display: 'flex', alignItems: 'center', padding: 2 }}>
                  <X size={13} />
                </button>
              </div>

              {/* All sheets option */}
              <button onClick={() => { setSelectedSheet(null); setSheetPickerOpen(false); }}
                style={{
                  width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 8,
                  background: !selectedSheet ? 'rgba(63,184,175,0.12)' : 'transparent',
                  border: `1px solid ${!selectedSheet ? '#3fb8af' : 'transparent'}`,
                  color: !selectedSheet ? '#3fb8af' : '#8a99ad',
                  fontSize: 12, cursor: 'pointer', marginBottom: 2, fontWeight: !selectedSheet ? 700 : 400,
                }}>
                All Sheets (default)
              </button>

              {allSheets.map((s, i) => (
                <button key={i} onClick={() => { setSelectedSheet(s); setSheetPickerOpen(false); }}
                  style={{
                    width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 8,
                    background: selectedSheet === s ? 'rgba(63,184,175,0.12)' : 'transparent',
                    border: `1px solid ${selectedSheet === s ? '#3fb8af' : 'transparent'}`,
                    cursor: 'pointer', marginBottom: 2,
                  }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: selectedSheet === s ? '#3fb8af' : '#e8eef5' }}>{s.sheetName}</div>
                  <div style={{ fontSize: 10, color: '#5a6878', marginTop: 1 }}>{s.sourceName}</div>
                </button>
              ))}

              {!allSheets.length && (
                <div style={{ padding: '8px 10px', color: '#5a6878', fontSize: 12 }}>No sheets loaded yet</div>
              )}
            </div>
          )}
        </div>

        <button className="bp-header-btn" onClick={clearChat} title="Clear chat">
          <RefreshCw size={14} />
        </button>
      </div>

      {/* ── Messages ── */}
      <div className="bp-messages">
        {messages.map((msg, i) => (
          <div key={i}>
            <ChatMessage msg={msg} />
          </div>
        ))}

        {loading && (
          <div className="bp-loading-row">
            <div className="bp-avatar bot">
              <Bot size={13} color="#60a5fa" />
            </div>
            <div className="bp-loading-bubble">
              <Loader2 size={14} color={syncing ? '#34d399' : '#60a5fa'} className="bp-animate-spin" />
              <span className="bp-loading-text" style={{ color: syncing ? '#34d399' : undefined }}>
                {syncing ? 'Syncing live data...' : 'Analyzing...'}
              </span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Input bar ── */}
      <div className="bp-input-area">
        <div className="bp-input-wrap">
          <Sparkles size={15} color="#60a5fa" style={{ flexShrink: 0, marginBottom: 2 }} />
          <textarea
            ref={inputRef}
            className="bp-textarea"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder={selectedSheet
              ? `Asking about "${selectedSheet.sheetName}" — or type "dashboard"`
              : `Ask anything... or "dashboard" for charts`}
            rows={1}
          />
          <button
            className="bp-send-btn"
            onClick={() => handleSend()}
            disabled={!input.trim() || loading}
          >
            <Send size={14} color="#fff" />
          </button>
        </div>
        <p className="bp-input-hint">
          Enter to send • Shift+Enter for new line • Say "dashboard" for inline KPIs &amp; charts
        </p>
      </div>

      {/* ── Floating Dashboard Icon ── */}
      <button
        onClick={() => navigate(`/dept/${deptId}`)}
        title="Open Dashboard"
        style={{
          position: 'fixed', bottom: 24, right: 24,
          width: 48, height: 48, borderRadius: '50%',
          background: 'linear-gradient(135deg, #10b981, #06b6d4)',
          border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 20px rgba(16,185,129,0.4)', zIndex: 50,
          transition: 'transform 0.2s, box-shadow 0.2s',
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.1)'; e.currentTarget.style.boxShadow = '0 6px 26px rgba(16,185,129,0.6)'; }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(16,185,129,0.4)'; }}
      >
        <BarChart2 size={20} color="white" />
      </button>

      {/* ── Voice Mode overlay ── */}
      {voiceMode && (
        <VoiceMode
          department={department}
          messages={messages}
          getDataContext={() => fetchDeptContext(departmentRef.current)}
          onClose={() => setVoiceMode(false)}
          onVoiceMessage={handleVoiceMessage}
        />
      )}

    </div>
  );
}
