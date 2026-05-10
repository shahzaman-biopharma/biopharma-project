import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  subscribeToNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from '../services/firestore';
import { Bell, BellOff, UserPlus, Building2, UserCheck } from 'lucide-react';

const TYPE_CONFIG = {
  new_user: {
    icon: UserPlus,
    color: 'text-blue-400',
    bg: 'rgba(59,130,246,0.12)',
    border: 'rgba(59,130,246,0.25)',
  },
  department_assigned: {
    icon: UserCheck,
    color: 'text-green-400',
    bg: 'rgba(16,185,129,0.12)',
    border: 'rgba(16,185,129,0.25)',
  },
  department_created: {
    icon: Building2,
    color: 'text-purple-400',
    bg: 'rgba(139,92,246,0.12)',
    border: 'rgba(139,92,246,0.25)',
  },
};

function timeAgo(ts) {
  if (!ts) return '';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function NotificationsPage() {
  const { userProfile, isAdmin } = useAuth();
  const [notifs, setNotifs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userProfile?.uid) return;
    const unsub = subscribeToNotifications(userProfile.uid, isAdmin, (data) => {
      setNotifs(data);
      setLoading(false);
    });
    return unsub;
  }, [userProfile?.uid, isAdmin]);

  const isUnread = (n) => {
    if (!userProfile) return false;
    if (n.recipientId === 'admins') return !(n.readBy || []).includes(userProfile.uid);
    return !n.read;
  };

  const unreadCount = notifs.filter(isUnread).length;

  const handleRead = (n) => {
    if (!isUnread(n)) return;
    markNotificationRead(n.id, userProfile.uid).catch(console.error);
  };

  const handleMarkAll = () => {
    if (unreadCount === 0) return;
    markAllNotificationsRead(userProfile.uid, isAdmin).catch(console.error);
  };

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
            onClick={handleMarkAll}
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
      ) : notifs.length === 0 ? (
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
          {notifs.map(n => {
            const unread = isUnread(n);
            const cfg = TYPE_CONFIG[n.type] || TYPE_CONFIG.new_user;
            const Icon = cfg.icon;
            return (
              <div
                key={n.id}
                onClick={() => handleRead(n)}
                className="flex gap-3 p-4 rounded-xl transition-all"
                style={{
                  cursor: unread ? 'pointer' : 'default',
                  background: unread ? 'var(--glass-bg)' : 'var(--hover-bg)',
                  border: `1px solid ${unread ? cfg.border : 'var(--border-clr)'}`,
                  opacity: unread ? 1 : 0.65,
                }}
              >
                <div
                  className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}
                >
                  <Icon size={16} className={cfg.color} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                      {n.title}
                    </p>
                    {unread && <span className="flex-shrink-0 w-2 h-2 bg-blue-500 rounded-full" />}
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{n.message}</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{timeAgo(n.createdAt)}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
