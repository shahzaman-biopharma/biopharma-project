import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { subscribeToDepartment, getChatHistory, saveChatMessage, getGoogleSheetToken, getUserGoogleToken } from '../services/firestore';
import { chatWithBot, generateFileData } from '../services/openai';
import { fetchGoogleSheetData } from '../services/excel';
import {
  ArrowLeft, Send, Bot, User, Loader2,
  Database, RefreshCw, Sparkles,
  FileSpreadsheet, FileDown, Table2, BrainCircuit, Mic,
} from 'lucide-react';
import VoiceMode from '../components/common/VoiceMode';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './BotPage.css';

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
    wsData.push([fileData.title]);
    wsData.push([fileData.subtitle || '']);
    wsData.push([]);
    wsData.push(sheet.headers);
    for (const row of sheet.rows) wsData.push(row);
    wsData.push([]);
    wsData.push(['Summary:', fileData.summary]);

    const ws = XLSX.utils.aoa_to_sheet(wsData);

    const colWidths = sheet.headers.map((h, i) => ({
      wch: Math.max(
        h.length + 4,
        ...sheet.rows.map(r => String(r[i] || '').length + 2)
      ),
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
      styles: {
        fontSize: 8, cellPadding: 3,
        lineColor: [226, 232, 240], lineWidth: 0.3, textColor: [30, 41, 59],
      },
      headStyles: {
        fillColor: [59, 130, 246], textColor: [255, 255, 255],
        fontStyle: 'bold', fontSize: 8.5,
      },
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
            <button
              className="bp-excel-btn"
              onClick={() => handleDownload('excel')}
              disabled={generating.excel}
            >
              {generating.excel
                ? <Loader2 size={11} className="bp-animate-spin" />
                : <FileSpreadsheet size={11} />}
              Excel
            </button>
            <button
              className="bp-pdf-btn"
              onClick={() => handleDownload('pdf')}
              disabled={generating.pdf}
            >
              {generating.pdf
                ? <Loader2 size={11} className="bp-animate-spin" />
                : <FileDown size={11} />}
              PDF
            </button>
          </div>
        )}

        <span className="bp-time">
          {msg.timestamp ? format(new Date(msg.timestamp), 'HH:mm') : ''}
        </span>
      </div>
    </div>
  );
}

// ─── Conversation memory window ──────────────────────────────────────────────
const MEMORY_WINDOW = 10;

// Strip all markdown tables, bullet-data blocks, and numbered data rows from
// old assistant messages. The live DATA CONTEXT is the only source of facts —
// history is kept only so the bot understands what was ASKED, not what was answered.
function stripDataFromAssistantMsg(content) {
  return content
    // Remove markdown tables entirely
    .replace(/^\|.+$/gm, '')
    // Remove numbered list rows that look like data (e.g. "1. John | 10192 | ...")
    .replace(/^\d+\.\s.{40,}$/gm, '')
    // Remove bullet rows that look like data
    .replace(/^[-*]\s.{60,}$/gm, '')
    // Collapse excess blank lines
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    // If still very long, keep first 400 chars
    .slice(0, 400);
}

function buildApiMessages(allMessages) {
  const filtered = allMessages.filter(m => m.role !== 'system');
  const windowed = filtered.length > MEMORY_WINDOW
    ? [filtered[0], ...filtered.slice(-(MEMORY_WINDOW - 1))]
    : filtered;

  return windowed.map((m, i) => {
    if (m.role !== 'assistant') return { role: m.role, content: m.content };
    // Keep the very last bot message as-is (follow-up context)
    if (i === windowed.length - 1) return { role: 'assistant', content: m.content };
    // All older bot messages: strip tables and data — bot will re-derive from live DATA CONTEXT
    const stripped = stripDataFromAssistantMsg(m.content);
    return { role: 'assistant', content: stripped || '[previous response — re-derive from DATA CONTEXT]' };
  });
}

// ─── Live data fetcher ────────────────────────────────────────────────────────
// Called on every bot query so the bot always sees current sheet data.
// Never caches — each call pulls a fresh snapshot from Google Sheets API.
async function fetchDeptContext(dept, googleToken) {
  let ctx = `Department: ${dept.name}\nDescription: ${dept.description}\n\n`;
  if (!dept?.dataSources?.length) return ctx;

  let sharedToken = googleToken;
  if (!sharedToken) {
    try {
      const stored = await getGoogleSheetToken();
      if (stored?.connected && stored.token && Date.now() < stored.expiry) sharedToken = stored.token;
    } catch {}
  }

  const sheetIndex = [];
  for (const src of dept.dataSources) {
    try {
      if (src.type === 'googlesheet' && src.url) {
        let tokenForSrc = sharedToken;
        if (src.addedByUid) {
          try {
            const userToken = await getUserGoogleToken(src.addedByUid);
            if (userToken?.token && Date.now() < userToken.expiry) tokenForSrc = userToken.token;
          } catch {}
        }
        const result = await fetchGoogleSheetData(src.url, tokenForSrc);
        ctx += `\n--- Data Source: "${src.name}" ---\n${result.text}\n`;
        if (result.sheetNames?.length) {
          sheetIndex.push(`"${src.name}": ${result.sheetNames.length} tab(s) — [${result.sheetNames.join(', ')}]`);
        }
      } else if (src.type === 'text' && src.content) {
        ctx += `\n--- Data Source: "${src.name}" ---\n${src.content}\n`;
      }
    } catch {}
  }

  if (sheetIndex.length) ctx += `\n\n--- SHEET INDEX ---\n${sheetIndex.join('\n')}\n`;
  return ctx;
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function BotPage() {
  const { deptId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, googleToken } = useAuth();

  const [department, setDepartment] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [dataContext, setDataContext] = useState('');
  const [dataLoaded, setDataLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);

  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  // Always holds the latest department — handleSend reads this to avoid stale closure
  const departmentRef = useRef(null);
  useEffect(() => { departmentRef.current = department; }, [department]);

  useEffect(() => {
    setPageLoading(true);
    let historyLoaded = false;

    // Real-time subscription — if admin changes data sources, this fires instantly
    const unsub = subscribeToDepartment(deptId, async (dept) => {
      if (!dept) { navigate('/dashboard'); return; }
      setDepartment(dept);

      // Load chat history only once (on first snapshot)
      if (!historyLoaded) {
        historyLoaded = true;
        try {
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
      }
      // On subsequent snapshots (admin updated dept): dataLoaded badge refreshes,
      // next query auto-fetches from new data source (fetchDeptContext uses dept state)
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
    const ctx = await fetchDeptContext(dept, googleToken);
    setDataContext(ctx);
    setDataLoaded(true);
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(async (text) => {
    const dept = departmentRef.current; // always latest — updated by real-time subscription
    const userMsg = text || input.trim();
    if (!userMsg || loading || !dept) return;
    setInput('');

    const userMessage = { role: 'user', content: userMsg, timestamp: Date.now() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setLoading(true);

    try {
      const apiMessages = buildApiMessages(newMessages);
      const wantsFile = isFileRequest(userMsg);

      // Fetch live data from the sheet — always fresh, never cached
      setSyncing(true);
      const freshContext = await fetchDeptContext(dept, googleToken);
      setSyncing(false);
      setDataContext(freshContext);

      if (wantsFile) {
        const [reply, fileData] = await Promise.all([
          chatWithBot({
            systemPrompt: dept.systemPrompt || `You are the AI assistant for ${dept.name}.`,
            messages: apiMessages,
            dataContext: freshContext,
          }),
          generateFileData({
            userRequest: userMsg,
            dataContext: freshContext || `Department: ${dept.name}\nDescription: ${dept.description}`,
            departmentName: dept.name,
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
          systemPrompt: dept.systemPrompt || `You are the AI assistant for ${dept.name}.`,
          messages: apiMessages,
          dataContext: freshContext,
        });
        const botMessage = { role: 'assistant', content: reply, timestamp: Date.now() };
        const finalMessages = [...newMessages, botMessage];
        setMessages(finalMessages);
        await saveChatMessage(user.uid, deptId, finalMessages);
      }
    } catch (err) {
      setSyncing(false);
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
  }, [input, messages, loading, googleToken, user.uid, deptId]);

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const clearChat = async () => {
    const welcome = [{
      role: 'assistant',
      content: `Chat cleared. Hello again! I'm your ${departmentRef.current?.name} assistant. How can I help you?`,
      timestamp: Date.now(),
    }];
    setMessages(welcome);
    await saveChatMessage(user.uid, deptId, welcome);
    toast.success('Chat cleared');
  };

  const handleVoiceMessage = useCallback(async (userText, botText) => {
    const userMsg = { role: 'user', content: userText, timestamp: Date.now() };
    const botMsg  = { role: 'assistant', content: botText, timestamp: Date.now() };
    const newMessages = [...messages, userMsg, botMsg];
    setMessages(newMessages);
    await saveChatMessage(user.uid, deptId, newMessages.map(m => {
      const { fileData: _, ...rest } = m;
      return rest;
    }));
  }, [messages, user.uid, deptId]);

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
            {dataLoaded && department?.dataSources?.length > 0 && (
              <>
                <span>•</span>
                <Database size={10} />
                <span>{department.dataSources.length} source{department.dataSources.length > 1 ? 's' : ''}</span>
              </>
            )}
          </div>
        </div>

        <div className="bp-header-badge" title="Bot remembers the last 10 messages in this conversation">
          <BrainCircuit size={11} color="#a78bfa" />
          <span className="bp-memory-label">Mem ×10</span>
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
        <button className="bp-header-btn" onClick={clearChat} title="Clear chat">
          <RefreshCw size={14} />
        </button>
      </div>

      {/* ── Messages ── */}
      <div className="bp-messages">
        {messages.map((msg, i) => (
          <div key={i}>
            {/* Show memory boundary marker when sliding window begins */}
            {i === messages.length - MEMORY_WINDOW && messages.length > MEMORY_WINDOW + 1 && (
              <div className="bp-memory-divider">
                <BrainCircuit size={11} />
                <span>Bot remembers from here (last {MEMORY_WINDOW} messages)</span>
              </div>
            )}
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
            placeholder={`Ask anything... or "generate Excel report"`}
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
          Enter to send • Shift+Enter for new line • Ask for PDF/Excel to download files
        </p>
      </div>

      {/* ── Voice Mode overlay ── */}
      {voiceMode && (
        <VoiceMode
          department={department}
          messages={messages}
          getDataContext={() => fetchDeptContext(departmentRef.current, googleToken)}
          onClose={() => setVoiceMode(false)}
          onVoiceMessage={handleVoiceMessage}
        />
      )}

    </div>
  );
}
