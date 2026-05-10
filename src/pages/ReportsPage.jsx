import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { subscribeToReports, saveReport, getAllDepartments } from '../services/firestore';
import { generateReport } from '../services/openai';
import { fetchGoogleSheetData } from '../services/excel';
import {
  FileText, Plus, Loader2, Download, Calendar,
  Clock, Bot, ChevronDown, ChevronUp, Sparkles,
} from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';

function ReportCard({ report }) {
  const [expanded, setExpanded] = useState(false);
  const date = report.generatedAt?.toDate?.() || new Date(report.generatedAt || Date.now());

  const downloadTxt = () => {
    const blob = new Blob([report.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${report.departmentName}_${report.type}_${format(date, 'yyyy-MM-dd')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
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
            <button
              onClick={downloadTxt}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-blue-400 transition-colors"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
              title="Download report"
            >
              <Download size={14} />
            </button>
            <button
              onClick={() => setExpanded(!expanded)}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white transition-colors"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
        </div>

        {/* Preview */}
        <p className="text-slate-400 text-xs leading-relaxed line-clamp-2">
          {report.content?.substring(0, 150)}...
        </p>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t px-5 pb-5 pt-4" style={{ borderColor: 'rgba(59,130,246,0.1)' }}>
          <div className="rounded-xl p-4 text-sm text-slate-300 leading-relaxed whitespace-pre-wrap font-mono text-xs"
            style={{ background: 'rgba(0,0,0,0.3)', maxHeight: '400px', overflowY: 'auto' }}>
            {report.content}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ReportsPage() {
  const { isAdmin, user } = useAuth();
  const [reports, setReports] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [selectedDept, setSelectedDept] = useState('');
  const [reportType, setReportType] = useState('weekly');
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    const unsub = subscribeToReports(setReports);
    getAllDepartments().then(setDepartments);
    return unsub;
  }, []);

  const handleGenerate = async () => {
    if (!selectedDept) { toast.error('Select a department'); return; }
    setGenerating(true);
    try {
      const dept = departments.find(d => d.id === selectedDept);
      if (!dept) throw new Error('Department not found');

      let dataCtx = `Department: ${dept.name}\nDescription: ${dept.description}\n`;

      // Load data sources
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

      await saveReport({
        departmentId: dept.id,
        departmentName: dept.name,
        type: reportType,
        content,
        generatedBy: user.uid,
      });

      toast.success(`${reportType.charAt(0).toUpperCase() + reportType.slice(1)} report generated!`);
    } catch (err) {
      toast.error(err.message || 'Failed to generate report');
    } finally {
      setGenerating(false);
    }
  };

  const filtered = filter === 'all'
    ? reports
    : reports.filter(r => r.type === filter);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <FileText size={20} className="text-blue-400" />
            Reports
          </h1>
          <p className="text-slate-400 text-sm mt-1">Weekly & monthly AI-generated department reports</p>
        </div>
      </div>

      {/* Generate panel (admin only) */}
      {isAdmin && (
        <div className="glass rounded-2xl p-5 mb-6">
          <h2 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
            <Sparkles size={14} className="text-blue-400" />
            Generate New Report
          </h2>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-40">
              <label className="block text-xs text-slate-400 mb-1.5">Department</label>
              <select
                value={selectedDept}
                onChange={e => setSelectedDept(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl text-white text-sm outline-none"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(59,130,246,0.2)' }}
              >
                <option value="">Select department...</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Report Type</label>
              <div className="flex gap-2">
                {['weekly', 'monthly'].map(type => (
                  <button
                    key={type}
                    onClick={() => setReportType(type)}
                    className="px-4 py-2.5 rounded-xl text-sm font-medium capitalize transition-all"
                    style={reportType === type ? {
                      background: 'linear-gradient(135deg, #3b82f6, #06b6d4)',
                      color: 'white',
                    } : {
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      color: '#94a3b8',
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
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white gradient-btn disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {generating ? (
                <><Loader2 size={15} className="animate-spin" /> Generating...</>
              ) : (
                <><Plus size={15} /> Generate</>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2 mb-5">
        {['all', 'weekly', 'monthly'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="px-4 py-2 rounded-xl text-sm font-medium capitalize transition-all"
            style={filter === f ? {
              background: 'rgba(59,130,246,0.15)',
              border: '1px solid rgba(59,130,246,0.3)',
              color: '#60a5fa',
            } : {
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: '#64748b',
            }}
          >
            {f === 'all' ? 'All Reports' : f}
          </button>
        ))}
        <span className="ml-auto text-xs text-slate-500 flex items-center">{filtered.length} report{filtered.length !== 1 ? 's' : ''}</span>
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
