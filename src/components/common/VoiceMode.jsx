import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Mic } from 'lucide-react';
import OpenAI from 'openai';
import { chatWithBot } from '../../services/openai';

const openai = new OpenAI({
  apiKey: import.meta.env.VITE_OPENAI_API_KEY,
  dangerouslyAllowBrowser: true,
});

const MEMORY_WINDOW = 10;

function buildApiMessages(all) {
  const filtered = all.filter(m => m.role !== 'system');
  const win = filtered.length > MEMORY_WINDOW
    ? [filtered[0], ...filtered.slice(-(MEMORY_WINDOW - 1))]
    : filtered;
  return win.map(m => ({ role: m.role, content: m.content }));
}

// ─── Orb visual config per phase ─────────────────────────────────────────────
const ORB = {
  idle:       { bg: 'radial-gradient(circle at 35% 30%, #1e293b, #334155)', glow: '#475569', ring: false },
  listening:  { bg: 'radial-gradient(circle at 35% 30%, #064e3b, #10b981)', glow: '#10b981', ring: true },
  thinking:   { bg: 'radial-gradient(circle at 35% 30%, #1e1b4b, #6366f1)', glow: '#6366f1', ring: false },
  speaking:   { bg: 'radial-gradient(circle at 35% 30%, #2e1065, #8b5cf6)', glow: '#8b5cf6', ring: true },
  error:      { bg: 'radial-gradient(circle at 35% 30%, #450a0a, #ef4444)', glow: '#ef4444', ring: false },
};

const LABEL = {
  idle:      'Tap × to close',
  listening: 'Listening…',
  thinking:  'Thinking…',
  speaking:  'Speaking…',
  error:     '',
};

const LABEL_COLOR = {
  idle:     '#475569',
  listening:'#34d399',
  thinking: '#818cf8',
  speaking: '#c4b5fd',
  error:    '#f87171',
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function VoiceMode({ department, messages, getDataContext, onClose, onVoiceMessage }) {
  const [phase, setPhase]       = useState('idle');
  const [transcript, setTrans]  = useState('');
  const [reply, setReply]       = useState('');
  const [errMsg, setErrMsg]     = useState('');

  const activeRef          = useRef(true);
  const recognitionRef     = useRef(null);
  const audioRef           = useRef(null);
  const transcriptRef      = useRef('');
  const processingRef      = useRef(false);
  // Always call the latest version of getDataContext (avoids stale closure)
  const getDataContextRef  = useRef(getDataContext);
  useEffect(() => { getDataContextRef.current = getDataContext; }, [getDataContext]);

  // ── Stop everything ────────────────────────────────────────────────────────
  const stopAll = useCallback(() => {
    try { recognitionRef.current?.abort(); } catch {}
    if (audioRef.current) {
      audioRef.current.pause();
      try { URL.revokeObjectURL(audioRef.current.src); } catch {}
      audioRef.current = null;
    }
  }, []);

  // ── Close handler ──────────────────────────────────────────────────────────
  const handleClose = useCallback(() => {
    activeRef.current = false;
    stopAll();
    onClose();
  }, [stopAll, onClose]);

  // ── Start listening ────────────────────────────────────────────────────────
  const startListening = useCallback(() => {
    if (!activeRef.current || processingRef.current) return;

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setPhase('error');
      setErrMsg('Speech recognition is not supported in this browser.\nPlease use Chrome or Edge.');
      return;
    }

    const rec = new SR();
    rec.continuous      = false;
    rec.interimResults  = true;
    rec.maxAlternatives = 1;
    // Accept any language — bot will always reply in English
    rec.lang = '';

    transcriptRef.current = '';

    rec.onstart = () => {
      if (!activeRef.current) { rec.abort(); return; }
      setPhase('listening');
      setTrans('');
      setReply('');
      setErrMsg('');
    };

    rec.onresult = (e) => {
      let text = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        text += e.results[i][0].transcript;
      }
      if (text) {
        transcriptRef.current = text;
        setTrans(text);
      }
    };

    rec.onend = () => {
      if (!activeRef.current) return;
      const text = transcriptRef.current.trim();
      transcriptRef.current = '';
      if (text) {
        processUserSpeech(text);
      } else {
        setTimeout(() => { if (activeRef.current) startListening(); }, 300);
      }
    };

    rec.onerror = (e) => {
      if (!activeRef.current) return;
      if (e.error === 'no-speech' || e.error === 'aborted') {
        setTimeout(() => { if (activeRef.current && !processingRef.current) startListening(); }, 400);
      } else if (e.error === 'not-allowed') {
        setPhase('error');
        setErrMsg('Microphone access denied.\nPlease allow microphone in browser settings and reload.');
      } else {
        setPhase('error');
        setErrMsg(`Microphone error: ${e.error}`);
        setTimeout(() => { if (activeRef.current) startListening(); }, 2000);
      }
    };

    recognitionRef.current = rec;
    try { rec.start(); } catch {}
  }, []);  // eslint-disable-line

  // ── Process user speech → AI → TTS ────────────────────────────────────────
  const processUserSpeech = useCallback(async (text) => {
    if (!activeRef.current) return;
    processingRef.current = true;
    setPhase('thinking');

    try {
      const historyWithUser = [...messages, { role: 'user', content: text }];
      const apiMessages     = buildApiMessages(historyWithUser);

      const deptPrompt = department?.systemPrompt || `You are the AI assistant for ${department?.name}.`;

      // Fetch live data from the sheet before every voice query
      const liveContext = await getDataContextRef.current();

      const replyText = await chatWithBot({
        systemPrompt: deptPrompt,
        messages:     apiMessages,
        dataContext:  liveContext,
        voiceMode:    true,
      });

      if (!activeRef.current) { processingRef.current = false; return; }
      setReply(replyText);
      onVoiceMessage(text, replyText);

      // ── TTS via OpenAI ──────────────────────────────────────────────────
      setPhase('speaking');
      const ttsRes = await openai.audio.speech.create({
        model: 'tts-1',
        voice: 'alloy',
        input: replyText.slice(0, 4096),
      });

      if (!activeRef.current) { processingRef.current = false; return; }

      const buf  = await ttsRes.arrayBuffer();
      const blob = new Blob([buf], { type: 'audio/mpeg' });
      const url  = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;

      audio.onended = () => {
        try { URL.revokeObjectURL(url); } catch {}
        audioRef.current = null;
        processingRef.current = false;
        if (activeRef.current) {
          setTrans('');
          setReply('');
          setTimeout(() => { if (activeRef.current) startListening(); }, 600);
        }
      };

      audio.onerror = () => {
        processingRef.current = false;
        if (activeRef.current) startListening();
      };

      audio.play().catch(() => {
        processingRef.current = false;
        if (activeRef.current) startListening();
      });

    } catch (err) {
      processingRef.current = false;
      if (!activeRef.current) return;
      const msg = err?.status === 429
        ? 'API rate limit reached. Please wait a moment.'
        : 'Something went wrong. Trying again…';
      setPhase('error');
      setErrMsg(msg);
      setTimeout(() => {
        if (activeRef.current) {
          setErrMsg('');
          startListening();
        }
      }, 3000);
    }
  }, [department, messages, onVoiceMessage, startListening]);

  // ── Auto-start on mount ────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(startListening, 500);
    return () => {
      clearTimeout(t);
      activeRef.current = false;
      stopAll();
    };
  }, []); // eslint-disable-line

  // ── Keyboard: Escape to close ──────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleClose]);

  const orb = ORB[phase] ?? ORB.idle;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Voice mode"
      style={{
        position: 'fixed', inset: 0, zIndex: 9990,
        background: 'rgba(3,6,14,0.97)',
        backdropFilter: 'blur(32px)', WebkitBackdropFilter: 'blur(32px)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 24, padding: '24px 20px',
        overflowY: 'auto',
      }}
    >
      <style>{`
        @keyframes vm-pulse {
          0%,100% { transform:scale(1);   box-shadow:0 0 40px var(--vg,#10b981)40; }
          50%      { transform:scale(1.1); box-shadow:0 0 80px var(--vg,#10b981)80; }
        }
        @keyframes vm-breathe {
          0%,100% { transform:scale(1);    box-shadow:0 0 50px var(--vg,#6366f1)50; }
          50%      { transform:scale(1.04); box-shadow:0 0 90px var(--vg,#6366f1)90; }
        }
        @keyframes vm-ring {
          0%   { transform:scale(0.9); opacity:0.7; }
          100% { transform:scale(1.9); opacity:0; }
        }
        @keyframes vm-fade-in {
          from { opacity:0; transform:translateY(8px); }
          to   { opacity:1; transform:translateY(0); }
        }
      `}</style>

      {/* ── Close button ─────────────────────────────────────────────────── */}
      <button
        onClick={handleClose}
        style={{
          position: 'absolute', top: 20, right: 20,
          width: 46, height: 46, borderRadius: '50%',
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.1)',
          color: '#94a3b8', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background 0.18s, color 0.18s',
          flexShrink: 0,
        }}
        onMouseOver={e => { e.currentTarget.style.background='rgba(255,255,255,0.14)'; e.currentTarget.style.color='#f1f5f9'; }}
        onMouseOut ={e => { e.currentTarget.style.background='rgba(255,255,255,0.06)'; e.currentTarget.style.color='#94a3b8'; }}
        aria-label="Close voice mode"
      >
        <X size={20} />
      </button>

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div style={{ textAlign: 'center', userSelect: 'none' }}>
        <p style={{ color: '#334155', fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          Voice Mode
        </p>
        <p style={{ color: '#64748b', fontSize: 15, fontWeight: 600, marginTop: 4 }}>
          {department?.name}
        </p>
      </div>

      {/* ── Orb ──────────────────────────────────────────────────────────── */}
      <div style={{ position: 'relative', width: 220, height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {/* Ripple rings */}
        {orb.ring && [0, 1, 2].map(i => (
          <div key={i} style={{
            position: 'absolute',
            width: 180, height: 180, borderRadius: '50%',
            border: `1.5px solid ${orb.glow}`,
            animation: `vm-ring 2.2s ease-out ${i * 0.65}s infinite`,
            opacity: 0,
            pointerEvents: 'none',
          }} />
        ))}

        {/* Main orb sphere */}
        <div style={{
          width: 170, height: 170, borderRadius: '50%',
          background: orb.bg,
          boxShadow: `0 0 50px ${orb.glow}55, 0 0 15px ${orb.glow}22, inset 0 0 50px rgba(0,0,0,0.4)`,
          '--vg': orb.glow,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative', overflow: 'hidden',
          animation: phase === 'listening' ? 'vm-pulse 1.5s ease-in-out infinite'
            : (phase === 'thinking' || phase === 'speaking') ? 'vm-breathe 1.8s ease-in-out infinite'
            : 'none',
          transition: 'background 0.6s ease, box-shadow 0.6s ease',
        }}>
          {/* Glass highlight */}
          <div style={{
            position: 'absolute', top: 14, left: 22,
            width: 64, height: 44, borderRadius: '50%',
            background: 'rgba(255,255,255,0.11)',
            filter: 'blur(8px)',
            pointerEvents: 'none',
          }} />
          <Mic size={36} color="rgba(255,255,255,0.82)" style={{ position: 'relative', zIndex: 1 }} />
        </div>
      </div>

      {/* ── Phase label ──────────────────────────────────────────────────── */}
      <p style={{
        fontSize: 17, fontWeight: 500,
        color: LABEL_COLOR[phase] ?? '#94a3b8',
        textAlign: 'center', userSelect: 'none',
        minHeight: 28, letterSpacing: '0.01em',
        animation: 'vm-fade-in 0.3s ease',
        whiteSpace: 'pre-line',
      }}>
        {phase === 'error' ? errMsg : LABEL[phase]}
      </p>

      {/* ── User transcript ───────────────────────────────────────────────── */}
      {transcript && (
        <div style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 16, padding: '10px 18px',
          maxWidth: 340, width: '100%',
          textAlign: 'center',
          animation: 'vm-fade-in 0.25s ease',
        }}>
          <p style={{ color: '#94a3b8', fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 4 }}>
            You
          </p>
          <p style={{ color: '#e2e8f0', fontSize: 14, lineHeight: 1.55, fontStyle: 'italic' }}>
            "{transcript}"
          </p>
        </div>
      )}

      {/* ── Bot reply ─────────────────────────────────────────────────────── */}
      {reply && (
        <div style={{
          background: 'rgba(99,102,241,0.07)',
          border: '1px solid rgba(99,102,241,0.18)',
          borderRadius: 16, padding: '10px 18px',
          maxWidth: 340, width: '100%',
          textAlign: 'center',
          animation: 'vm-fade-in 0.25s ease',
        }}>
          <p style={{ color: '#6366f1', fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 4 }}>
            Assistant
          </p>
          <p style={{ color: '#c7d2fe', fontSize: 14, lineHeight: 1.6 }}>
            {reply}
          </p>
        </div>
      )}

      {/* ── Bottom hint ───────────────────────────────────────────────────── */}
      {phase === 'listening' && !transcript && (
        <p style={{ color: '#1e293b', fontSize: 12, textAlign: 'center', userSelect: 'none' }}>
          Speak in any language — bot replies in English
        </p>
      )}
    </div>
  );
}
