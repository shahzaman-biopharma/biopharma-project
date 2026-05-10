import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Send, Bot, Sparkles } from 'lucide-react';

const DEPT_COMMANDS = {
  '/dvl': 'dvl',
  '/qc': 'qc',
  '/crm': 'crm',
  '/reg': 'reg',
};

export default function DashboardChatBar({ departments }) {
  const [input, setInput] = useState('');
  const [suggestion, setSuggestion] = useState(null);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  const handleInput = (val) => {
    setInput(val);
    const lower = val.toLowerCase();
    const matchedCmd = Object.keys(DEPT_COMMANDS).find(cmd => lower.startsWith(cmd));
    if (matchedCmd) {
      const tag = DEPT_COMMANDS[matchedCmd];
      const dept = departments.find(d =>
        d.tag?.toLowerCase() === tag ||
        d.name?.toLowerCase().includes(tag)
      );
      setSuggestion(dept ? { dept, cmd: matchedCmd } : null);
    } else {
      setSuggestion(null);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    const lower = input.toLowerCase();
    const matchedCmd = Object.keys(DEPT_COMMANDS).find(cmd => lower.startsWith(cmd));

    if (matchedCmd) {
      const tag = DEPT_COMMANDS[matchedCmd];
      const dept = departments.find(d =>
        d.tag?.toLowerCase() === tag ||
        d.name?.toLowerCase().includes(tag)
      );
      if (dept) {
        const question = input.slice(matchedCmd.length).trim();
        navigate(`/bot/${dept.id}`, { state: { initialMessage: question } });
        setInput('');
        setSuggestion(null);
        return;
      }
    }

    // No command — show help
    setInput('');
    setSuggestion(null);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Tab' && suggestion) {
      e.preventDefault();
      setInput(suggestion.cmd + ' ');
      setSuggestion(null);
    }
  };

  return (
    <div className="relative">
      {/* Suggestion popup */}
      {suggestion && (
        <div className="absolute bottom-full left-0 right-0 mb-2 animate-fade-in">
          <div className="glass rounded-xl px-4 py-3 flex items-center gap-3">
            <Bot size={16} className="text-blue-400 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-white text-xs font-medium">Opening <span className="text-blue-400">{suggestion.dept.name}</span> bot</p>
              <p className="text-slate-500 text-xs">Press Tab to confirm or Enter to open</p>
            </div>
            <div className="px-2 py-1 rounded-md text-xs text-slate-400"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
              Tab
            </div>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="flex items-center gap-3 px-4 py-3 rounded-2xl"
          style={{
            background: 'rgba(17,24,39,0.9)',
            border: '1px solid rgba(59,130,246,0.2)',
            backdropFilter: 'blur(12px)',
          }}>

          <div className="flex items-center gap-2 flex-shrink-0">
            <Sparkles size={16} className="text-blue-400" />
          </div>

          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => handleInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything... or type /dvl to open DVL bot"
            className="flex-1 bg-transparent text-white placeholder-slate-500 text-sm outline-none"
          />

          <div className="flex items-center gap-2 text-xs text-slate-600 flex-shrink-0">
            {Object.keys(DEPT_COMMANDS).slice(0, 2).map(cmd => (
              <button
                key={cmd}
                type="button"
                onClick={() => { setInput(cmd + ' '); inputRef.current?.focus(); }}
                className="px-2 py-1 rounded-md text-slate-400 hover:text-blue-400 transition-colors"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                {cmd}
              </button>
            ))}
          </div>

          <button
            type="submit"
            className="w-8 h-8 rounded-lg flex items-center justify-center gradient-btn flex-shrink-0"
          >
            <Send size={14} className="text-white" />
          </button>
        </div>
      </form>
    </div>
  );
}
