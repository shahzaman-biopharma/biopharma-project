import { useEffect, useState } from 'react';
import { Download, X, Smartphone } from 'lucide-react';

const DISMISSED_KEY = 'pwa-install-dismissed';

export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Already running as installed PWA — no prompt needed
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    // User already dismissed — don't nag again this session
    if (sessionStorage.getItem(DISMISSED_KEY)) return;

    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setVisible(true);
    };

    const installedHandler = () => {
      setVisible(false);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', installedHandler);
    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', installedHandler);
    };
  }, []);

  const dismiss = () => {
    sessionStorage.setItem(DISMISSED_KEY, '1');
    setVisible(false);
  };

  const install = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setVisible(false);
      setDeferredPrompt(null);
    }
  };

  if (!visible || !deferredPrompt) return null;

  return (
    <div
      role="banner"
      style={{
        position: 'fixed',
        bottom: 20,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9997,
        width: 'calc(100% - 32px)',
        maxWidth: 400,
        background: 'rgba(8,13,28,0.96)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(59,130,246,0.3)',
        borderRadius: 16,
        padding: '13px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)',
        animation: 'pwa-slide-up 0.35s cubic-bezier(0.34,1.56,0.64,1)',
      }}
    >
      <style>{`
        @keyframes pwa-slide-up {
          from { transform: translateX(-50%) translateY(20px); opacity: 0; }
          to   { transform: translateX(-50%) translateY(0);    opacity: 1; }
        }
      `}</style>

      {/* App icon */}
      <div style={{
        width: 42, height: 42, borderRadius: 12, flexShrink: 0,
        background: 'linear-gradient(135deg, rgba(99,102,241,0.25), rgba(59,130,246,0.25))',
        border: '1px solid rgba(99,102,241,0.3)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Smartphone size={19} style={{ color: '#818cf8' }} />
      </div>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ color: '#f1f5f9', fontSize: 13, fontWeight: 700, marginBottom: 2, lineHeight: 1.3 }}>
          Install BioPharma App
        </p>
        <p style={{ color: '#64748b', fontSize: 11.5, lineHeight: 1.4 }}>
          Add to home screen — works offline
        </p>
      </div>

      {/* Install button */}
      <button
        onClick={install}
        style={{
          flexShrink: 0,
          padding: '7px 14px',
          borderRadius: 10,
          background: 'linear-gradient(135deg, #6366f1, #3b82f6)',
          border: 'none',
          color: 'white',
          fontSize: 12,
          fontWeight: 700,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          whiteSpace: 'nowrap',
        }}
      >
        <Download size={13} />
        Install
      </button>

      {/* Dismiss */}
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          flexShrink: 0, background: 'none', border: 'none',
          cursor: 'pointer', color: '#475569', padding: 4, borderRadius: 6,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'color 0.15s',
        }}
        onMouseOver={e => { e.currentTarget.style.color = '#94a3b8'; }}
        onMouseOut={e => { e.currentTarget.style.color = '#475569'; }}
      >
        <X size={15} />
      </button>
    </div>
  );
}
