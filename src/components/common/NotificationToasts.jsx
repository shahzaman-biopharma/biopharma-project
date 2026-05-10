import { useEffect, useState } from 'react';
import { useNotifications } from '../../context/NotificationsContext';
import {
  UserPlus, Building2, UserCheck, UserMinus,
  FileText, Shield, Trash2, X,
} from 'lucide-react';

// ─── Per-type visual config ───────────────────────────────────────────────────
const TYPE = {
  new_user:            { icon: UserPlus,  color: '#3b82f6', label: 'New User'       },
  department_created:  { icon: Building2, color: '#8b5cf6', label: 'New Department' },
  department_assigned: { icon: UserCheck, color: '#10b981', label: 'Dept Assigned'  },
  department_removed:  { icon: UserMinus, color: '#f59e0b', label: 'Dept Removed'   },
  report_generated:    { icon: FileText,  color: '#06b6d4', label: 'Report Ready'   },
  role_changed:        { icon: Shield,    color: '#ec4899', label: 'Role Updated'   },
  department_deleted:  { icon: Trash2,    color: '#ef4444', label: 'Dept Deleted'   },
};

const VISIBLE_MS  = 3400; // how long toast stays visible
const SLIDE_MS    = 420;  // slide animation duration

function Toast({ notif, onDismiss }) {
  // phase: 'enter' (off-screen) → 'in' (visible) → 'out' (off-screen)
  const [phase, setPhase] = useState('enter');
  const cfg  = TYPE[notif.type] ?? TYPE.new_user;
  const Icon = cfg.icon;

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('in'),  20);
    const t2 = setTimeout(() => setPhase('out'), VISIBLE_MS);
    const t3 = setTimeout(() => onDismiss(notif.id), VISIBLE_MS + SLIDE_MS);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  const close = () => {
    setPhase('out');
    setTimeout(() => onDismiss(notif.id), SLIDE_MS);
  };

  const visible = phase === 'in';
  const easing  = phase === 'in'
    ? `transform ${SLIDE_MS}ms cubic-bezier(0.34,1.56,0.64,1), opacity ${SLIDE_MS * 0.8}ms ease`
    : `transform ${SLIDE_MS * 0.85}ms cubic-bezier(0.4,0,1,1), opacity ${SLIDE_MS * 0.7}ms ease`;

  return (
    <div
      role="alert"
      style={{
        position: 'relative',
        transform: visible ? 'translateX(0)' : 'translateX(calc(100% + 28px))',
        opacity: visible ? 1 : 0,
        transition: phase === 'enter' ? 'none' : easing,
        background: 'var(--glass-bg, rgba(8,13,28,0.94))',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderLeft: `3px solid ${cfg.color}`,
        borderRadius: '14px',
        boxShadow: `0 6px 28px rgba(0,0,0,0.38), 0 0 0 1px rgba(255,255,255,0.025), inset 0 1px 0 rgba(255,255,255,0.05)`,
        padding: '13px 12px 14px 13px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '11px',
        width: '316px',
        overflow: 'hidden',
      }}
    >
      {/* Icon bubble */}
      <div style={{
        flexShrink: 0,
        width: 34, height: 34, borderRadius: 10,
        background: `${cfg.color}1a`,
        border: `1px solid ${cfg.color}30`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon size={15} style={{ color: cfg.color }} />
      </div>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.07em',
          textTransform: 'uppercase', color: cfg.color, marginBottom: 3,
        }}>
          {cfg.label}
        </p>
        <p style={{
          fontSize: 13, fontWeight: 600, lineHeight: 1.3,
          color: 'var(--text-primary, #f1f5f9)',
          marginBottom: 2,
          overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
        }}>
          {notif.title}
        </p>
        <p style={{
          fontSize: 11.5, lineHeight: 1.45,
          color: 'var(--text-secondary, #94a3b8)',
        }}>
          {notif.message}
        </p>
      </div>

      {/* Close button */}
      <button
        onClick={close}
        style={{
          flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--text-muted, #64748b)', padding: '2px 2px', borderRadius: 6,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'color 0.15s, background 0.15s',
        }}
        onMouseOver={e => { e.currentTarget.style.color = 'var(--text-primary, #f1f5f9)'; e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; }}
        onMouseOut={e => { e.currentTarget.style.color = 'var(--text-muted, #64748b)'; e.currentTarget.style.background = 'none'; }}
        aria-label="Dismiss"
      >
        <X size={13} />
      </button>

      {/* Countdown progress bar */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: 2,
        background: `${cfg.color}1a`,
      }}>
        <div style={{
          height: '100%',
          background: `linear-gradient(90deg, ${cfg.color}88, ${cfg.color})`,
          animationName: 'nb-drain',
          animationDuration: `${VISIBLE_MS}ms`,
          animationTimingFunction: 'linear',
          animationFillMode: 'forwards',
        }} />
      </div>
    </div>
  );
}

// ─── Container rendered in Layout ─────────────────────────────────────────────
export default function NotificationToasts() {
  const { toastQueue, dismissToast } = useNotifications();
  if (!toastQueue.length) return null;

  return (
    <>
      <style>{`@keyframes nb-drain { from { width:100% } to { width:0 } }`}</style>
      <div
        aria-live="polite"
        style={{
          position: 'fixed', top: 20, right: 20, zIndex: 9999,
          display: 'flex', flexDirection: 'column', gap: 10,
          pointerEvents: 'none',
        }}
      >
        {toastQueue.map(n => (
          <div key={n.id} style={{ pointerEvents: 'all' }}>
            <Toast notif={n} onDismiss={dismissToast} />
          </div>
        ))}
      </div>
    </>
  );
}
