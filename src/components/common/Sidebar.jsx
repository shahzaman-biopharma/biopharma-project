import { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { subscribeToNotifications } from '../../services/firestore';
import {
  Dna, LayoutDashboard, FileText, Settings,
  LogOut, ChevronRight, Shield, Sun, Moon, X, Bell,
} from 'lucide-react';
import toast from 'react-hot-toast';

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/reports', icon: FileText, label: 'Reports' },
];

const adminItems = [
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export default function Sidebar({ onClose }) {
  const { userProfile, logout, isSuperAdmin, isAdmin } = useAuth();
  const { isDark, toggle } = useTheme();
  const navigate = useNavigate();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!userProfile?.uid) return;
    const unsub = subscribeToNotifications(userProfile.uid, isAdmin, (notifs) => {
      setUnreadCount(notifs.filter(n =>
        n.recipientId === 'admins'
          ? !(n.readBy || []).includes(userProfile.uid)
          : !n.read
      ).length);
    });
    return unsub;
  }, [userProfile?.uid, isAdmin]);

  const handleLogout = async () => {
    await logout();
    toast.success('Logged out');
    navigate('/login');
  };

  const handleNav = () => {
    if (onClose) onClose();
  };

  return (
    <aside className="flex flex-col h-full" style={{
      width: '240px',
      background: 'var(--sidebar-bg)',
      borderRight: '1px solid var(--border-clr)',
      transition: 'background 0.25s ease, border-color 0.25s ease',
    }}>
      {/* Logo + Theme Toggle + Mobile Close */}
      <div className="flex items-center gap-3 px-5 py-4 border-b" style={{ borderColor: 'var(--border-clr)' }}>
        <div className="flex items-center justify-center w-8 h-8 rounded-xl flex-shrink-0"
          style={{ background: 'linear-gradient(135deg, #3b82f6, #06b6d4)' }}>
          <Dna size={17} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm leading-none" style={{ color: 'var(--text-primary)' }}>BioPharma</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>CRA Platform</p>
        </div>

        {/* Theme Toggle */}
        <button
          onClick={toggle}
          title={isDark ? 'Light mode' : 'Dark mode'}
          className="w-7 h-7 rounded-lg flex items-center justify-center transition-all flex-shrink-0"
          style={{
            background: isDark ? 'rgba(251,191,36,0.12)' : 'rgba(59,130,246,0.12)',
            border: isDark ? '1px solid rgba(251,191,36,0.25)' : '1px solid rgba(59,130,246,0.25)',
            color: isDark ? '#fbbf24' : '#3b82f6',
          }}
        >
          {isDark ? <Sun size={13} /> : <Moon size={13} />}
        </button>

        {/* Mobile close button */}
        {onClose && (
          <button
            onClick={onClose}
            className="lg:hidden w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors"
            style={{ color: 'var(--text-muted)', background: 'rgba(255,255,255,0.05)' }}
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <p className="text-xs font-semibold uppercase tracking-wider px-3 mb-2" style={{ color: 'var(--text-muted)' }}>
          Navigation
        </p>
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            onClick={handleNav}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all group ${
                isActive ? '' : ''
              }`
            }
            style={({ isActive }) => isActive ? {
              color: 'white',
              background: 'linear-gradient(135deg, rgba(59,130,246,0.2), rgba(6,182,212,0.1))',
              border: '1px solid rgba(59,130,246,0.3)',
            } : { color: 'var(--text-secondary)' }}
          >
            {({ isActive }) => (
              <>
                <Icon size={17} className={isActive ? 'text-blue-400' : 'text-slate-500 group-hover:text-blue-400'} />
                {label}
                {isActive && <ChevronRight size={13} className="ml-auto text-blue-400" />}
              </>
            )}
          </NavLink>
        ))}

        {/* Notifications — below Reports, visible to all logged-in users */}
        <NavLink
          to="/notifications"
          onClick={handleNav}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all group"
          style={({ isActive }) => isActive ? {
            color: 'white',
            background: 'linear-gradient(135deg, rgba(59,130,246,0.2), rgba(6,182,212,0.1))',
            border: '1px solid rgba(59,130,246,0.3)',
          } : { color: 'var(--text-secondary)' }}
        >
          {({ isActive }) => (
            <>
              <Bell size={17} className={isActive ? 'text-blue-400' : 'text-slate-500 group-hover:text-blue-400'} />
              Notifications
              {unreadCount > 0 && !isActive ? (
                <span
                  className="ml-auto flex-shrink-0 min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-bold"
                  style={{ background: '#ef4444', color: 'white' }}
                >
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              ) : isActive ? (
                <ChevronRight size={13} className="ml-auto text-blue-400" />
              ) : null}
            </>
          )}
        </NavLink>

        {isAdmin && (
          <>
            <p className="text-xs font-semibold uppercase tracking-wider px-3 mb-2 mt-5" style={{ color: 'var(--text-muted)' }}>
              Admin
            </p>
            {adminItems.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                onClick={handleNav}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all group ${
                    isActive ? '' : ''
                  }`
                }
                style={({ isActive }) => isActive ? {
                  color: 'white',
                  background: 'linear-gradient(135deg, rgba(139,92,246,0.2), rgba(59,130,246,0.1))',
                  border: '1px solid rgba(139,92,246,0.3)',
                } : { color: 'var(--text-secondary)' }}
              >
                {({ isActive }) => (
                  <>
                    <Icon size={17} className={isActive ? 'text-purple-400' : 'text-slate-500 group-hover:text-purple-400'} />
                    {label}
                    {isActive && <ChevronRight size={13} className="ml-auto text-purple-400" />}
                  </>
                )}
              </NavLink>
            ))}
          </>
        )}
      </nav>

      {/* User info */}
      <div className="px-3 pb-4 border-t pt-3" style={{ borderColor: 'var(--border-clr)' }}>
        <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl mb-2"
          style={{ background: 'var(--hover-bg)' }}>
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #3b82f6, #06b6d4)' }}>
            {userProfile?.displayName?.[0]?.toUpperCase() || 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>
              {userProfile?.displayName}
            </p>
            <div className="flex items-center gap-1">
              {isSuperAdmin && <Shield size={9} className="text-yellow-400" />}
              <p className="text-xs capitalize" style={{ color: 'var(--text-muted)' }}>
                {userProfile?.role || 'user'}
              </p>
            </div>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm w-full transition-colors group"
          style={{ color: 'var(--text-secondary)' }}
        >
          <LogOut size={15} className="group-hover:text-red-400 transition-colors" />
          <span className="group-hover:text-red-400 transition-colors">Sign out</span>
        </button>
      </div>
    </aside>
  );
}
