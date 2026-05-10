import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Send, Bot, Sparkles } from 'lucide-react';

export default function DashboardChatBar({ departments }) {
  const [input, setInput] = useState('');
  const [suggestion, setSuggestion] = useState(null);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  const findMatch = (val) => {
    const lower = val.toLowerCase().trim();
    for (const dept of departments) {
      if (!dept.tag) continue;
      const cmd = `/${dept.tag.toLowerCase()}`;
      if (lower === cmd || lower.startsWith(cmd + ' ')) {
        return { dept, cmd };
      }
    }
    return null;
  };

  const handleInput = (val) => {
    setInput(val);
    setSuggestion(findMatch(val));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!input.trim()) return;
    const match = findMatch(input);
    if (match) {
      const question = input.slice(match.cmd.length).trim();
      navigate(`/bot/${match.dept.id}`, { state: { initialMessage: question || undefined } });
      setInput('');
      setSuggestion(null);
    } else {
      setInput('');
      setSuggestion(null);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Tab' && suggestion) {
      e.preventDefault();
      setInput(suggestion.cmd + ' ');
      setSuggestion(null);
    }
  };

  const cmdHints = departments.filter(d => d.tag).slice(0, 3).map(d => `/${d.tag.toLowerCase()}`);

  return (
    <div className="relative">
      {suggestion && (
        <div className="absolute bottom-full left-0 right-0 mb-2 animate-fade-in">
          <div className="glass rounded-xl px-4 py-3 flex items-center gap-3">
            <Bot size={16} className="text-blue-400 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                Opening <span className="text-blue-400">{suggestion.dept.name}</span> bot
              </p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Press Tab to confirm or Enter to open</p>
            </div>
            <div className="px-2 py-1 rounded-md text-xs"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-secondary)' }}>
              Tab
            </div>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="flex items-center gap-3 px-4 py-3 rounded-2xl"
          style={{
            background: 'var(--glass-bg)',
            border: '1px solid rgba(59,130,246,0.2)',
            backdropFilter: 'blur(12px)',
          }}>
          <Sparkles size={16} className="text-blue-400 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => handleInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={cmdHints.length ? `Ask anything... or type ${cmdHints[0]} to open a bot` : 'Ask anything...'}
            className="flex-1 bg-transparent placeholder-slate-500 text-sm outline-none"
            style={{ color: 'var(--text-primary)' }}
          />
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {cmdHints.map(cmd => (
              <button
                key={cmd}
                type="button"
                onClick={() => { setInput(cmd + ' '); inputRef.current?.focus(); }}
                className="px-2 py-1 rounded-md text-xs text-slate-400 hover:text-blue-400 transition-colors"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                {cmd}
              </button>
            ))}
          </div>
          <button type="submit" className="w-8 h-8 rounded-lg flex items-center justify-center gradient-btn flex-shrink-0">
            <Send size={14} className="text-white" />
          </button>
        </div>
      </form>
    </div>
  );
}
