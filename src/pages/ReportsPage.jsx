import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { subscribeToReports, saveReport, getAllDepartments, getReportSettings, deliverReportToBot } from '../services/firestore';
import { generateReport } from '../services/openai';
import { fetchGoogleSheetData } from '../services/excel';
import {
  FileText, Plus, Loader2, Calendar,
  Clock, ChevronDown, ChevronUp, Sparkles, FileDown,
} from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// ─── Status colours for table cells ──────────────────────────────────────────

const STATUS_CLASSES = {
  verified: 'bot-td-green', resolved: 'bot-td-green', complete: 'bot-td-green',
  pass: 'bot-td-green', passed: 'bot-td-green', yes: 'bot-td-green', active: 'bot-td-green',
  pending: 'bot-td-red', open: 'bot-td-red', failed: 'bot-td-red',
  critical: 'bot-td-red', missing: 'bot-td-red', no: 'bot-td-red', overdue: 'bot-td-red',
  'n/a': 'bot-td-yellow', partial: 'bot-td-yellow', review: 'bot-td-yellow',
  'in progress': 'bot-td-yellow',
};

function tdCls(children) {
  const t = Array.isArray(children)
    ? children.filter(c => typeof c === 'string').join('').trim().toLowerCase()
    : typeof children === 'string' ? children.trim().toLowerCase() : '';
  return STATUS_CLASSES[t] || '';
}

// ─── Strip markdown bold/italic for PDF text ─────────────────────────────────

const strip = (s) => String(s)
  .replace(/\*\*(.*?)\*\*/g, '$1')
  .replace(/\*(.*?)\*/g, '$1')
  .replace(/`(.*?)`/g, '$1');

// ─── PDF generator ────────────────────────────────────────────────────────────

function downloadReportPDF(report, date) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();
  const M = 14;
  const CW = PW - M * 2;

  // ── Decorative header ──────────────────────────────────────────────────────
  doc.setFillColor(7, 94, 84);
  doc.rect(0, 0, PW, 46, 'F');

  // Accent stripe
  doc.setFillColor(4, 65, 58);
  doc.rect(0, 40, PW, 6, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text(report.departmentName, PW / 2, 16, { align: 'center' });

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(180, 222, 216);
  const typeLabel = report.type === 'monthly' ? 'MONTHLY REPORT' : 'WEEKLY REPORT';
  doc.text(typeLabel, PW / 2, 26, { align: 'center' });

  doc.setFontSize(8.5);
  doc.setTextColor(160, 210, 204);
  doc.text(`Generated: ${format(date, 'MMMM dd, yyyy  •  HH:mm')}`, PW / 2, 34, { align: 'center' });
  doc.text('BioPharma CRA Platform  •  Confidential', PW / 2, 41, { align: 'center' });

  let y = 56;

  // ── Page helpers ───────────────────────────────────────────────────────────
  const newPage = () => {
    doc.addPage();
    doc.setFillColor(7, 94, 84);
    doc.rect(0, 0, PW, 7, 'F');
    y = 16;
  };
  const need = (n) => { if (y + n > PH - 18) newPage(); };

  // ── Table renderer ─────────────────────────────────────────────────────────
  const flushTable = (buf) => {
    if (!buf.length) return;
    // Filter separator rows (only contains |, -, :, space)
    const parsed = buf
      .filter(l => !/^[\|\ \-:]+$/.test(l.trim()))
      .map(l =>
        l.split('|')
          .slice(1, -1)
          .map(c => strip(c.trim()))
      );
    if (parsed.length < 2) return;

    need(35);
    autoTable(doc, {
      head: [parsed[0]],
      body: parsed.slice(1),
      startY: y,
      margin: { left: M, right: M },
      styles: {
        fontSize: 8.5,
        cellPadding: 3.5,
        lineColor: [207, 216, 220],
        lineWidth: 0.3,
        textColor: [30, 41, 59],
        overflow: 'linebreak',
      },
      headStyles: {
        fillColor: [7, 94, 84],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 9,
      },
      alternateRowStyles: { fillColor: [249, 251, 252] },
      tableLineColor: [207, 216, 220],
      tableLineWidth: 0.3,
      didDrawPage: (data) => {
        if (data.pageNumber > 1) {
          doc.setFillColor(7, 94, 84);
          doc.rect(0, 0, PW, 7, 'F');
        }
      },
    });
    y = doc.lastAutoTable.finalY + 9;
  };

  // ── Line-by-line markdown parser ───────────────────────────────────────────
  const lines = (report.content || '').split('\n');
  let tableBuf = [];
  let inTable = false;

  for (const line of lines) {
    // Collect table rows
    if (line.trim().startsWith('|')) {
      tableBuf.push(line.trim());
      inTable = true;
      continue;
    }
    if (inTable) { flushTable(tableBuf); tableBuf = []; inTable = false; }

    const raw = strip(line);

    if (line.startsWith('## ')) {
      need(16);
      doc.setFontSize(12.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(7, 94, 84);
      doc.text(strip(line.slice(3)), M, y);
      doc.setDrawColor(7, 94, 84);
      doc.setLineWidth(0.5);
      doc.line(M, y + 2, M + CW, y + 2);
      y += 10;

    } else if (line.startsWith('### ')) {
      need(10);
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 64, 175);
      doc.text(strip(line.slice(4)), M, y);
      y += 7;

    } else if (/^[-*] /.test(line)) {
      need(7);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(30, 41, 59);
      const wrapped = doc.splitTextToSize(`• ${strip(line.slice(2))}`, CW - 6);
      wrapped.forEach((l, i) => {
        need(5);
        doc.text(l, M + (i === 0 ? 3 : 7), y);
        y += 5;
      });
      y += 1;

    } else if (/^\d+\. /.test(line)) {
      need(7);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(30, 41, 59);
      const wrapped = doc.splitTextToSize(raw.trim(), CW - 6);
      wrapped.forEach(l => { need(5); doc.text(l, M + 3, y); y += 5; });
      y += 1;

    } else if (line.startsWith('>')) {
      const text = strip(line.slice(1).trim());
      const wrapped = doc.splitTextToSize(text, CW - 12);
      const bh = wrapped.length * 5 + 6;
      need(bh + 2);
      doc.setFillColor(232, 248, 244);
      doc.roundedRect(M, y - 3.5, CW, bh, 1.5, 1.5, 'F');
      doc.setFillColor(7, 94, 84);
      doc.rect(M, y - 3.5, 2.5, bh, 'F');
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(71, 85, 105);
      doc.text(wrapped, M + 6, y);
      y += bh + 3;

    } else if (/^---+$/.test(line.trim())) {
      need(5);
      doc.setDrawColor(203, 213, 225);
      doc.setLineWidth(0.3);
      doc.line(M, y, M + CW, y);
      y += 5;

    } else if (raw.trim()) {
      need(7);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(30, 41, 59);
      const wrapped = doc.splitTextToSize(raw.trim(), CW);
      wrapped.forEach(l => { need(5); doc.text(l, M, y); y += 5; });
      y += 2;

    } else {
      y += 2.5; // blank line spacing
    }
  }
  if (inTable) flushTable(tableBuf);

  // ── Footer on every page ───────────────────────────────────────────────────
  const total = doc.internal.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text('BioPharma CRA Platform — Confidential', M, PH - 7);
    doc.text(`Page ${i} of ${total}`, PW - M, PH - 7, { align: 'right' });
  }

  doc.save(`${report.departmentName}_${report.type}_${format(date, 'yyyy-MM-dd')}.pdf`);
}

// ─── Report card ──────────────────────────────────────────────────────────────

function ReportCard({ report }) {
  const [expanded, setExpanded] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const date = report.generatedAt?.toDate?.() || new Date(report.generatedAt || Date.now());

  const handlePDF = async () => {
    setPdfLoading(true);
    try {
      downloadReportPDF(report, date);
      toast.success('PDF downloaded!');
    } catch {
      toast.error('Failed to generate PDF');
    } finally {
      setPdfLoading(false);
    }
  };

  const typeColor = report.type === 'monthly' ? '#8b5cf6' : '#3b82f6';

  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      <div className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: `${typeColor}22`, border: `1px solid ${typeColor}33` }}>
              <FileText size={18} style={{ color: typeColor }} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-white font-semibold text-sm">{report.departmentName}</h3>
                <span className="px-2 py-0.5 rounded-full text-xs font-medium capitalize"
                  style={{ background: `${typeColor}22`, color: typeColor }}>
                  {report.type}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                <div className="flex items-center gap-1">
                  <Calendar size={11} />
                  <span>{format(date, 'MMM dd, yyyy')}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Clock size={11} />
                  <span>{format(date, 'HH:mm')}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* PDF download */}
            <button
              onClick={handlePDF}
              disabled={pdfLoading}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-50"
              style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}
              title="Download PDF"
            >
              {pdfLoading
                ? <Loader2 size={11} className="animate-spin" />
                : <FileDown size={11} />}
              <span className="hidden sm:inline">PDF</span>
            </button>

            {/* Expand/collapse */}
            <button
              onClick={() => setExpanded(!expanded)}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white transition-colors"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
        </div>

        {/* Preview snippet */}
        <p className="text-slate-400 text-xs leading-relaxed line-clamp-2">
          {report.content?.substring(0, 150)}...
        </p>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t px-5 pb-5 pt-4" style={{ borderColor: 'rgba(59,130,246,0.1)' }}>
          <div className="rounded-xl p-4"
            style={{ background: 'rgba(0,0,0,0.25)', maxHeight: '600px', overflowY: 'auto' }}>
            <ReactMarkdown
              className="bot-markdown"
              remarkPlugins={[remarkGfm]}
              components={{
                table: ({ children }) => (
                  <>
                    <div className="bot-table-wrap">
                      <table>{children}</table>
                    </div>
                    <p className="bot-scroll-hint">← swipe to see more →</p>
                  </>
                ),
                td: ({ children }) => (
                  <td className={tdCls(children) || undefined}>{children}</td>
                ),
              }}
            >
              {report.content}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const { isAdmin, isSuperAdmin, user } = useAuth();
  const [reports, setReports] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [selectedDept, setSelectedDept] = useState('');
  const [reportType, setReportType] = useState('weekly');
  const [filter, setFilter] = useState('all');
  const [accessSettings, setAccessSettings] = useState({});

  useEffect(() => {
    const unsub = subscribeToReports(setReports);
    getAllDepartments().then(setDepartments);
    getReportSettings().then(s => setAccessSettings(s?.departmentAccess || {}));
    return unsub;
  }, []);

  const canViewReport = (report) => {
    if (isSuperAdmin) return true;
    const access = accessSettings[report.departmentId];
    if (!access) return isAdmin;
    if (isAdmin && access.allowAdmins !== false) return true;
    if ((access.allowedUsers || []).includes(user?.uid)) return true;
    return false;
  };

  const handleGenerate = async () => {
    if (!selectedDept) { toast.error('Select a department'); return; }
    setGenerating(true);
    try {
      const dept = departments.find(d => d.id === selectedDept);
      if (!dept) throw new Error('Department not found');

      let dataCtx = `Department: ${dept.name}\nDescription: ${dept.description}\n`;

      for (const src of dept.dataSources || []) {
        try {
          if (src.type === 'googlesheet' && src.url) {
            const csv = await fetchGoogleSheetData(src.url);
            dataCtx += `\n--- ${src.name} ---\n${csv}\n`;
          } else if (src.type === 'text' && src.content) {
            dataCtx += `\n--- ${src.name} ---\n${src.content}\n`;
          }
        } catch { /* skip failed source */ }
      }

      const content = await generateReport({
        systemPrompt: dept.systemPrompt || '',
        dataContext: dataCtx,
        reportType,
        departmentName: dept.name,
      });

      const period = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
      await saveReport({
        departmentId: dept.id,
        departmentName: dept.name,
        type: reportType,
        content,
        period,
        generatedBy: user.uid,
      });

      // Silently push to Telegram users logged into this department
      deliverReportToBot(dept.id, dept.name, content, reportType, period);

      toast.success(`${reportType.charAt(0).toUpperCase() + reportType.slice(1)} report generated!`);
    } catch (err) {
      toast.error(err.message || 'Failed to generate report');
    } finally {
      setGenerating(false);
    }
  };

  const filtered = reports
    .filter(r => canViewReport(r))
    .filter(r => filter === 'all' || r.type === filter);

  return (
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg sm:text-xl font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <FileText size={19} className="text-blue-400" />
            Reports
          </h1>
          <p className="text-xs sm:text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            Weekly & monthly AI-generated department reports
          </p>
        </div>
      </div>

      {/* Generate panel (admin only) */}
      {isAdmin && (
        <div className="glass rounded-2xl p-4 sm:p-5 mb-5">
          <h2 className="font-semibold text-sm mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Sparkles size={14} className="text-blue-400" />
            Generate New Report
          </h2>
          <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-end gap-3">
            <div className="flex-1 min-w-0 sm:min-w-40">
              <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>Department</label>
              <select
                value={selectedDept}
                onChange={e => setSelectedDept(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                style={{ border: '1px solid rgba(59,130,246,0.2)' }}
              >
                <option value="">Select department...</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>Report Type</label>
              <div className="flex gap-2">
                {['weekly', 'monthly'].map(type => (
                  <button
                    key={type}
                    onClick={() => setReportType(type)}
                    className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl text-sm font-medium capitalize transition-all"
                    style={reportType === type ? {
                      background: 'linear-gradient(135deg, #3b82f6, #06b6d4)', color: 'white',
                    } : {
                      background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8',
                    }}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={handleGenerate}
              disabled={generating || !selectedDept}
              className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white gradient-btn disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {generating
                ? <><Loader2 size={15} className="animate-spin" /> Generating...</>
                : <><Plus size={15} /> Generate</>}
            </button>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1">
        {['all', 'weekly', 'monthly'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-medium capitalize transition-all whitespace-nowrap flex-shrink-0"
            style={filter === f ? {
              background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)', color: '#60a5fa',
            } : {
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#64748b',
            }}
          >
            {f === 'all' ? 'All' : f}
          </button>
        ))}
        <span className="ml-auto text-xs flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
          {filtered.length} report{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Reports list */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)' }}>
            <FileText size={28} className="text-blue-400" />
          </div>
          <h3 className="text-white font-semibold mb-2">No reports yet</h3>
          <p className="text-slate-500 text-sm">
            {isAdmin ? 'Generate your first report above' : 'No reports available yet'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map(r => <ReportCard key={r.id} report={r} />)}
        </div>
      )}
    </div>
  );
}
