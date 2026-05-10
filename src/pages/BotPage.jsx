import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getDepartment, getChatHistory, saveChatMessage } from '../services/firestore';
import { chatWithBot, generateFileData } from '../services/openai';
import { fetchGoogleSheetData } from '../services/excel';
import {
  ArrowLeft, Send, Bot, User, Loader2,
  Database, RefreshCw, Sparkles,
  FileSpreadsheet, FileDown, Table2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// ─── Detect if user is asking for a file ─────────────────────────────────────

const FILE_KEYWORDS = [
  'pdf', 'excel', 'xlsx', 'spreadsheet', 'table mein', 'file mein',
  'download', 'export', 'sheet banao', 'report banao', 'file bana',
  'table bana', 'summary pdf', 'summary excel', 'chart bana',
];

function isFileRequest(text) {
  const lower = text.toLowerCase();
  return FILE_KEYWORDS.some(k => lower.includes(k));
}

// ─── Excel generator ─────────────────────────────────────────────────────────

function generateExcel(fileData) {
  const wb = XLSX.utils.book_new();

  for (const sheet of fileData.sheets) {
    const wsData = [];

    // Title rows
    wsData.push([fileData.title]);
    wsData.push([fileData.subtitle || '']);
    wsData.push([]);
    wsData.push(sheet.headers);
    for (const row of sheet.rows) wsData.push(row);
    wsData.push([]);
    wsData.push(['Summary:', fileData.summary]);

    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Column widths
    const colWidths = sheet.headers.map((h, i) => ({
      wch: Math.max(
        h.length + 4,
        ...sheet.rows.map(r => String(r[i] || '').length + 2)
      ),
    }));
    ws['!cols'] = colWidths;

    // Merge title cell across columns
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

  // Header background
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageW, 38, 'F');

  // Title
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text(fileData.title, pageW / 2, 16, { align: 'center' });

  // Subtitle
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(148, 163, 184);
  doc.text(fileData.subtitle || `Generated: ${format(new Date(), 'PPpp')}`, pageW / 2, 24, { align: 'center' });
  doc.text(`BioPharma CRA Platform  •  ${format(new Date(), 'PPpp')}`, pageW / 2, 30, { align: 'center' });

  let yPos = 46;

  // Summary box
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

  // Tables
  for (const sheet of fileData.sheets) {
    // Sheet name header
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
      styles: {
        fontSize: 8,
        cellPadding: 3,
        lineColor: [226, 232, 240],
        lineWidth: 0.3,
        textColor: [30, 41, 59],
      },
      headStyles: {
        fillColor: [59, 130, 246],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 8.5,
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
      tableLineColor: [203, 213, 225],
      tableLineWidth: 0.3,
    });

    yPos = doc.lastAutoTable.finalY + 14;
  }

  // Footer on every page
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

  return (
    <div className={`flex gap-2 w-full ${isUser ? 'flex-row-reverse' : ''} animate-fade-in`}>
      {/* Avatar — fixed 32px, never shrinks */}
      <div className="w-8 h-8 rounded-xl flex-shrink-0 flex items-center justify-center"
        style={isUser ? {
          background: 'linear-gradient(135deg, #3b82f6, #06b6d4)',
        } : {
          background: 'rgba(59,130,246,0.15)',
          border: '1px solid rgba(59,130,246,0.2)',
        }}>
        {isUser ? <User size={14} className="text-white" /> : <Bot size={14} className="text-blue-400" />}
      </div>

      {/* Wrapper — flex-1 takes all remaining width after avatar+gap, min-w-0 prevents overflow */}
      <div className={`flex-1 min-w-0 flex flex-col gap-1.5 ${isUser ? 'items-end' : 'items-start'}`}>

        {/* Bubble */}
        <div
          className={`px-4 py-3 rounded-2xl ${isUser ? 'rounded-tr-sm' : 'rounded-tl-sm'}`}
          style={isUser ? {
            maxWidth: '85%',
            background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
            color: 'white',
            fontSize: '0.875rem',
            lineHeight: '1.65',
            wordBreak: 'break-word',
            overflowWrap: 'break-word',
          } : {
            maxWidth: '100%',
            background: 'var(--card-bg)',
            border: '1px solid var(--border-clr)',
            overflowWrap: 'break-word',
            wordBreak: 'break-word',
          }}
        >
          {isUser ? (
            <span className="text-sm leading-relaxed" style={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{msg.content}</span>
          ) : (
            <ReactMarkdown
              className="bot-markdown"
              remarkPlugins={[remarkGfm]}
              components={{
                table: ({ children }) => (
                  <div className="bot-table-wrap">
                    <table>{children}</table>
                  </div>
                ),
              }}
            >
              {msg.content}
            </ReactMarkdown>
          )}
        </div>

        {/* File download buttons */}
        {msg.fileData && (
          <div className="flex items-center gap-2 mt-1">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs"
              style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.15)' }}>
              <Table2 size={11} className="text-blue-400" />
              <span style={{ color: 'var(--text-secondary)' }}>
                {msg.fileData.sheets?.length} sheet{msg.fileData.sheets?.length !== 1 ? 's' : ''} ready
              </span>
            </div>
            <button
              onClick={() => handleDownload('excel')}
              disabled={generating.excel}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-emerald-400 transition-all disabled:opacity-50"
              style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)' }}
            >
              {generating.excel ? <Loader2 size={11} className="animate-spin" /> : <FileSpreadsheet size={11} />}
              Excel
            </button>
            <button
              onClick={() => handleDownload('pdf')}
              disabled={generating.pdf}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-400 transition-all disabled:opacity-50"
              style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}
            >
              {generating.pdf ? <Loader2 size={11} className="animate-spin" /> : <FileDown size={11} />}
              PDF
            </button>
          </div>
        )}

        <span className="text-xs px-1" style={{ color: 'var(--text-muted)' }}>
          {msg.timestamp ? format(new Date(msg.timestamp), 'HH:mm') : ''}
        </span>
      </div>
    </div>
  );
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
  const [dataContext, setDataContext] = useState('');
  const [dataLoaded, setDataLoaded] = useState(false);

  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const init = async () => {
      setPageLoading(true);
      try {
        const dept = await getDepartment(deptId);
        if (!dept) { navigate('/dashboard'); return; }
        setDepartment(dept);

        const history = await getChatHistory(user.uid, deptId);
        if (history.length > 0) {
          setMessages(history);
        } else {
          setMessages([{
            role: 'assistant',
            content: `Hello! I'm the **${dept.name}** AI assistant.\n\nI can help you analyze data, answer questions, and generate downloadable reports.\n\nTip: Ask me to "generate an Excel report" or "create a PDF summary" and I'll build a formatted file for you!\n\nHow can I help you today?`,
            timestamp: Date.now(),
          }]);
        }
        await loadDataSources(dept);
      } catch {
        toast.error('Failed to load bot');
      } finally {
        setPageLoading(false);
      }
    };
    init();
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
    let ctx = `Department: ${dept.name}\nDescription: ${dept.description}\n\n`;
    for (const src of dept.dataSources) {
      try {
        if (src.type === 'googlesheet' && src.url) {
          const csv = await fetchGoogleSheetData(src.url);
          ctx += `\n--- Data Source: ${src.name} ---\n${csv}\n`;
        } else if (src.type === 'text' && src.content) {
          ctx += `\n--- Data Source: ${src.name} ---\n${src.content}\n`;
        }
      } catch { /* skip failed source */ }
    }
    setDataContext(ctx);
    setDataLoaded(true);
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(async (text) => {
    const userMsg = text || input.trim();
    if (!userMsg || loading || !department) return;
    setInput('');

    const userMessage = { role: 'user', content: userMsg, timestamp: Date.now() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setLoading(true);

    try {
      const apiMessages = newMessages
        .filter(m => m.role !== 'system')
        .map(m => ({ role: m.role, content: m.content }));

      const wantsFile = isFileRequest(userMsg);

      if (wantsFile) {
        // Parallel: text reply + structured file data
        const [reply, fileData] = await Promise.all([
          chatWithBot({
            systemPrompt: department.systemPrompt || `You are the AI assistant for ${department.name}.`,
            messages: apiMessages,
            dataContext,
          }),
          generateFileData({
            userRequest: userMsg,
            dataContext: dataContext || `Department: ${department.name}\nDescription: ${department.description}`,
            departmentName: department.name,
          }).catch(() => null),
        ]);

        const botMessage = {
          role: 'assistant',
          content: reply,
          timestamp: Date.now(),
          fileData: fileData || undefined,
        };
        const finalMessages = [...newMessages, botMessage];
        setMessages(finalMessages);
        await saveChatMessage(user.uid, deptId, finalMessages.map(m => {
          const { fileData: _, ...rest } = m;
          return rest;
        }));
      } else {
        const reply = await chatWithBot({
          systemPrompt: department.systemPrompt || `You are the AI assistant for ${department.name}.`,
          messages: apiMessages,
          dataContext,
        });
        const botMessage = { role: 'assistant', content: reply, timestamp: Date.now() };
        const finalMessages = [...newMessages, botMessage];
        setMessages(finalMessages);
        await saveChatMessage(user.uid, deptId, finalMessages);
      }
    } catch (err) {
      const errMsg = err.message?.includes('API key')
        ? 'OpenAI API key not configured.'
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
  }, [input, messages, loading, department, dataContext, user.uid, deptId]);

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const clearChat = async () => {
    const welcome = [{
      role: 'assistant',
      content: `Chat cleared. Hello again! I'm your ${department?.name} assistant. How can I help you?`,
      timestamp: Date.now(),
    }];
    setMessages(welcome);
    await saveChatMessage(user.uid, deptId, welcome);
    toast.success('Chat cleared');
  };

  if (pageLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Loading bot...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-base)' }}>
      {/* Header */}
      <div className="flex items-center gap-2 sm:gap-4 px-3 sm:px-6 py-3 sm:py-4 border-b flex-shrink-0"
        style={{ borderColor: 'var(--border-clr)', background: 'var(--sidebar-bg)' }}>
        <button
          onClick={() => navigate('/dashboard')}
          className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center transition-colors flex-shrink-0"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--text-secondary)' }}
        >
          <ArrowLeft size={15} />
        </button>

        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'linear-gradient(135deg, #3b82f6, #06b6d4)' }}>
          <Bot size={18} className="text-white" />
        </div>

        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-sm sm:text-base truncate" style={{ color: 'var(--text-primary)' }}>
            {department?.name}
          </h1>
          <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
            <span className="hidden sm:inline">AI Assistant Active</span>
            <span className="sm:hidden">Active</span>
            {dataLoaded && department?.dataSources?.length > 0 && (
              <>
                <span className="hidden sm:inline">•</span>
                <Database size={10} className="hidden sm:block" />
                <span className="hidden sm:inline">{department.dataSources.length} source{department.dataSources.length > 1 ? 's' : ''}</span>
              </>
            )}
          </div>
        </div>

        <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs flex-shrink-0"
          style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.15)', color: 'var(--text-secondary)' }}>
          <FileSpreadsheet size={11} className="text-blue-400" />
          PDF / Excel
        </div>

        <button
          onClick={clearChat}
          title="Clear chat"
          className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center transition-colors flex-shrink-0"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--text-secondary)' }}
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-5">
        {messages.map((msg, i) => (
          <ChatMessage key={i} msg={msg} />
        ))}

        {loading && (
          <div className="flex gap-3 animate-fade-in">
            <div className="w-8 h-8 rounded-xl flex-shrink-0 flex items-center justify-center"
              style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.2)' }}>
              <Bot size={14} className="text-blue-400" />
            </div>
            <div className="px-4 py-3 rounded-2xl rounded-tl-sm"
              style={{ background: 'var(--card-bg)', border: '1px solid var(--border-clr)' }}>
              <div className="flex items-center gap-2">
                <Loader2 size={14} className="animate-spin text-blue-400" />
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Analyzing...</span>
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="px-3 sm:px-6 pb-4 sm:pb-6 pt-3 border-t flex-shrink-0" style={{ borderColor: 'var(--border-clr)' }}>
        <div className="flex items-end gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-2xl"
          style={{ background: 'var(--glass-bg)', border: '1px solid rgba(59,130,246,0.2)' }}>
          <Sparkles size={15} className="text-blue-400 flex-shrink-0 mb-1" />
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder={`Ask anything... or "generate Excel report"`}
            rows={1}
            className="flex-1 bg-transparent placeholder-slate-500 text-sm outline-none resize-none"
            style={{ color: 'var(--text-primary)', maxHeight: '100px' }}
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || loading}
            className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center gradient-btn disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
          >
            <Send size={14} className="text-white" />
          </button>
        </div>
        <p className="text-xs text-center mt-1.5 hidden sm:block" style={{ color: 'var(--text-muted)' }}>
          Enter to send • Shift+Enter for new line • Ask for PDF/Excel to download files
        </p>
      </div>
    </div>
  );
}
