import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  Dna, LayoutDashboard, FileText, Settings,
  LogOut, ChevronRight, Shield, Bot,
} from 'lucide-react';
import toast from 'react-hot-toast';

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/reports', icon: FileText, label: 'Reports' },
];

const adminItems = [
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export default function Sidebar() {
  const { userProfile, logout, isSuperAdmin, isAdmin } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    toast.success('Logged out');
    navigate('/login');
  };

  return (
    <aside className="flex flex-col h-full" style={{
      width: '240px',
      background: 'rgba(10, 15, 30, 0.95)',
      borderRight: '1px solid rgba(59,130,246,0.12)',
    }}>
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-5 border-b" style={{ borderColor: 'rgba(59,130,246,0.12)' }}>
        <div className="flex items-center justify-center w-9 h-9 rounded-xl"
          style={{ background: 'linear-gradient(135deg, #3b82f6, #06b6d4)' }}>
          <Dna size={20} className="text-white" />
        </div>
        <div>
          <p className="text-white font-bold text-sm leading-none">BioPharma</p>
          <p className="text-slate-500 text-xs mt-0.5">CRA Platform</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <p className="text-slate-600 text-xs font-semibold uppercase tracking-wider px-3 mb-2">Navigation</p>
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all group ${
                isActive
                  ? 'text-white'
                  : 'text-slate-400 hover:text-white'
              }`
            }
            style={({ isActive }) => isActive ? {
              background: 'linear-gradient(135deg, rgba(59,130,246,0.2), rgba(6,182,212,0.1))',
              border: '1px solid rgba(59,130,246,0.3)',
            } : {}}
          >
            {({ isActive }) => (
              <>
                <Icon size={18} className={isActive ? 'text-blue-400' : 'text-slate-500 group-hover:text-blue-400'} />
                {label}
                {isActive && <ChevronRight size={14} className="ml-auto text-blue-400" />}
              </>
            )}
          </NavLink>
        ))}

        {isAdmin && (
          <>
            <p className="text-slate-600 text-xs font-semibold uppercase tracking-wider px-3 mb-2 mt-5">Admin</p>
            {adminItems.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all group ${
                    isActive ? 'text-white' : 'text-slate-400 hover:text-white'
                  }`
                }
                style={({ isActive }) => isActive ? {
                  background: 'linear-gradient(135deg, rgba(139,92,246,0.2), rgba(59,130,246,0.1))',
                  border: '1px solid rgba(139,92,246,0.3)',
                } : {}}
              >
                {({ isActive }) => (
                  <>
                    <Icon size={18} className={isActive ? 'text-purple-400' : 'text-slate-500 group-hover:text-purple-400'} />
                    {label}
                    {isActive && <ChevronRight size={14} className="ml-auto text-purple-400" />}
                  </>
                )}
              </NavLink>
            ))}
          </>
        )}
      </nav>

      {/* User info */}
      <div className="px-3 pb-4 border-t pt-4" style={{ borderColor: 'rgba(59,130,246,0.12)' }}>
        <div className="flex items-center gap-3 px-3 py-2 rounded-xl mb-2"
          style={{ background: 'rgba(255,255,255,0.03)' }}>
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
            style={{ background: 'linear-gradient(135deg, #3b82f6, #06b6d4)' }}>
            {userProfile?.displayName?.[0]?.toUpperCase() || 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-xs font-medium truncate">{userProfile?.displayName}</p>
            <div className="flex items-center gap-1">
              {isSuperAdmin && <Shield size={10} className="text-yellow-400" />}
              <p className="text-slate-500 text-xs capitalize">{userProfile?.role || 'user'}</p>
            </div>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-slate-400 hover:text-red-400 text-sm w-full transition-colors hover:bg-red-400/5"
        >
          <LogOut size={16} />
          Sign out
        </button>
      </div>
    </aside>
  );
}
