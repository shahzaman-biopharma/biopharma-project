import { useNotifications } from '../context/NotificationsContext';
import {
  Bell, BellOff,
  UserPlus, Building2, UserCheck, UserMinus,
  FileText, Shield, Trash2,
} from 'lucide-react';

// ─── All business notification types ─────────────────────────────────────────
const TYPE = {
  new_user:            { icon: UserPlus,  color: '#3b82f6', bg: 'rgba(59,130,246,0.12)',  border: 'rgba(59,130,246,0.25)',  label: 'New User'       },
  department_created:  { icon: Building2, color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)', border: 'rgba(139,92,246,0.25)', label: 'New Department' },
  department_assigned: { icon: UserCheck, color: '#10b981', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.25)', label: 'Dept Assigned'  },
  department_removed:  { icon: UserMinus, color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.25)', label: 'Dept Removed'   },
  report_generated:    { icon: FileText,  color: '#06b6d4', bg: 'rgba(6,182,212,0.12)',  border: 'rgba(6,182,212,0.25)',  label: 'Report Ready'   },
  role_changed:        { icon: Shield,    color: '#ec4899', bg: 'rgba(236,72,153,0.12)', border: 'rgba(236,72,153,0.25)', label: 'Role Updated'   },
  department_deleted:  { icon: Trash2,    color: '#ef4444', bg: 'rgba(239,68,68,0.12)',  border: 'rgba(239,68,68,0.25)',  label: 'Dept Deleted'   },
};

function timeAgo(ts) {
  if (!ts) return '';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60)  return 'just now';
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function NotificationsPage() {
  const { notifications, unreadCount, isUnread, markRead, markAllRead } = useNotifications();
  const loading = notifications === null;

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.25)' }}
          >
            <Bell size={18} className="text-blue-400" />
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              Notifications
            </h1>
            <p className="text-xs sm:text-sm" style={{ color: 'var(--text-secondary)' }}>
              {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
            </p>
          </div>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={markAllRead}
            className="text-xs font-medium px-3 py-1.5 rounded-lg transition-all"
            style={{
              color: '#3b82f6',
              background: 'rgba(59,130,246,0.1)',
              border: '1px solid rgba(59,130,246,0.2)',
            }}
          >
            Mark all read
          </button>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
        </div>
      ) : notifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{ background: 'var(--glass-bg)', border: '1px solid var(--border-clr)' }}
          >
            <BellOff size={24} style={{ color: 'var(--text-muted)' }} />
          </div>
          <p className="font-medium" style={{ color: 'var(--text-secondary)' }}>No notifications yet</p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>You're all caught up!</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map(n => {
            const unread = isUnread(n);
            const cfg    = TYPE[n.type] ?? TYPE.new_user;
            const Icon   = cfg.icon;
            return (
              <div
                key={n.id}
                onClick={() => unread && markRead(n.id)}
                className="flex gap-3 p-4 rounded-xl transition-all"
                style={{
                  cursor: unread ? 'pointer' : 'default',
                  background: unread ? 'var(--glass-bg)' : 'var(--hover-bg)',
                  border: `1px solid ${unread ? cfg.border : 'var(--border-clr)'}`,
                  opacity: unread ? 1 : 0.6,
                }}
              >
                {/* Icon */}
                <div
                  className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}
                >
                  <Icon size={15} style={{ color: cfg.color }} />
                </div>

                {/* Body */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: cfg.color }}>
                      {cfg.label}
                    </span>
                    {unread && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#3b82f6' }} />}
                  </div>
                  <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                    {n.title}
                  </p>
                  <p className="text-xs mt-0.5 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                    {n.message}
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                    {timeAgo(n.createdAt)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
