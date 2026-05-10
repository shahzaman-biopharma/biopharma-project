import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getDepartment } from '../services/firestore';
import { getChatHistory, saveChatMessage } from '../services/firestore';
import { chatWithBot } from '../services/openai';
import { fetchGoogleSheetData } from '../services/excel';
import {
  ArrowLeft, Send, Bot, User, Loader2,
  Database, RefreshCw, Paperclip, Sparkles,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

function ChatMessage({ msg }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''} animate-fade-in`}>
      {/* Avatar */}
      <div className={`w-8 h-8 rounded-xl flex-shrink-0 flex items-center justify-center ${
        isUser
          ? 'bg-gradient-to-br from-blue-500 to-cyan-500'
          : 'bg-gradient-to-br from-slate-700 to-slate-600'
      }`}
        style={isUser ? {} : { border: '1px solid rgba(59,130,246,0.2)' }}>
        {isUser ? <User size={14} className="text-white" /> : <Bot size={14} className="text-blue-400" />}
      </div>

      {/* Bubble */}
      <div className={`max-w-[75%] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
        <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
          isUser
            ? 'chat-bubble-user text-white rounded-tr-sm'
            : 'chat-bubble-bot text-slate-200 rounded-tl-sm'
        }`}>
          {msg.content}
        </div>
        <span className="text-slate-600 text-xs px-1">
          {msg.timestamp ? format(new Date(msg.timestamp), 'HH:mm') : ''}
        </span>
      </div>
    </div>
  );
}

export default function BotPage() {
  const { deptId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, userProfile } = useAuth();

  const [department, setDepartment] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [dataContext, setDataContext] = useState('');
  const [dataLoaded, setDataLoaded] = useState(false);

  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  // Load department + chat history
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
            content: `Hello! I'm the **${dept.name}** AI assistant. I'm here to help you analyze data and answer questions about this department.\n\nYou can ask me about data trends, specific records, summaries, or anything related to ${dept.name}. How can I assist you today?`,
            timestamp: Date.now(),
          }]);
        }

        // Load data sources
        await loadDataSources(dept);
      } catch (err) {
        toast.error('Failed to load bot');
      } finally {
        setPageLoading(false);
      }
    };
    init();
  }, [deptId, user.uid]);

  // Handle initial message from dashboard chat bar
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
      } catch {
        // Continue with other sources
      }
    }
    setDataContext(ctx);
    setDataLoaded(true);
  };

  // Auto scroll to bottom
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

      const reply = await chatWithBot({
        systemPrompt: department.systemPrompt || `You are the AI assistant for ${department.name} department in a CRA biopharma company. Be professional, data-driven, and concise.`,
        messages: apiMessages,
        dataContext,
      });

      const botMessage = { role: 'assistant', content: reply, timestamp: Date.now() };
      const finalMessages = [...newMessages, botMessage];
      setMessages(finalMessages);

      // Save to Firestore
      await saveChatMessage(user.uid, deptId, finalMessages);
    } catch (err) {
      const errMsg = err.message?.includes('API key')
        ? 'OpenAI API key not configured. Please add it in .env file.'
        : 'Failed to get response. Please try again.';
      toast.error(errMsg);
      const errMessage = { role: 'assistant', content: `Sorry, I encountered an error: ${errMsg}`, timestamp: Date.now() };
      setMessages(prev => [...prev, errMessage]);
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
          <p className="text-slate-400 text-sm">Loading bot...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-4 border-b"
        style={{ borderColor: 'rgba(59,130,246,0.12)', background: 'rgba(10,15,30,0.8)' }}>
        <button
          onClick={() => navigate('/dashboard')}
          className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-white transition-colors"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <ArrowLeft size={16} />
        </button>

        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, #3b82f6, #06b6d4)' }}>
          <Bot size={20} className="text-white" />
        </div>

        <div className="flex-1">
          <h1 className="text-white font-semibold">{department?.name}</h1>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
            <span>AI Assistant Active</span>
            {dataLoaded && department?.dataSources?.length > 0 && (
              <>
                <span>•</span>
                <Database size={10} />
                <span>{department.dataSources.length} data source{department.dataSources.length > 1 ? 's' : ''} loaded</span>
              </>
            )}
          </div>
        </div>

        <button
          onClick={clearChat}
          title="Clear chat"
          className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-white transition-colors"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <RefreshCw size={15} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
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
              style={{ background: 'rgba(17,24,39,0.9)', border: '1px solid rgba(59,130,246,0.2)' }}>
              <div className="flex items-center gap-2">
                <Loader2 size={14} className="animate-spin text-blue-400" />
                <span className="text-slate-400 text-sm">Analyzing...</span>
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="px-6 pb-6 pt-3 border-t" style={{ borderColor: 'rgba(59,130,246,0.1)' }}>
        <div className="flex items-end gap-3 px-4 py-3 rounded-2xl"
          style={{
            background: 'rgba(17,24,39,0.9)',
            border: '1px solid rgba(59,130,246,0.2)',
          }}>
          <Sparkles size={16} className="text-blue-400 flex-shrink-0 mb-1" />
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder={`Ask ${department?.name} anything...`}
            rows={1}
            className="flex-1 bg-transparent text-white placeholder-slate-500 text-sm outline-none resize-none"
            style={{ maxHeight: '120px' }}
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || loading}
            className="w-9 h-9 rounded-xl flex items-center justify-center gradient-btn disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
          >
            <Send size={15} className="text-white" />
          </button>
        </div>
        <p className="text-xs text-slate-600 text-center mt-2">Press Enter to send, Shift+Enter for new line</p>
      </div>
    </div>
  );
}
