import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { subscribeToDepartments } from '../services/firestore';
import { ensureDVLDepartment, ensureDVLvDepartment } from '../utils/seedDVL';
import DepartmentCard from '../components/dashboard/DepartmentCard';
import DashboardChatBar from '../components/dashboard/DashboardChatBar';
import { Bot, Plus, Shield, Sparkles, TrendingUp, FileText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div className="glass-card rounded-xl px-4 py-3 flex items-center gap-3">
      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: `${color}22`, border: `1px solid ${color}33` }}>
        <Icon size={17} style={{ color }} />
      </div>
      <div>
        <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{value}</p>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</p>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { userProfile, isSuperAdmin, isAdmin } = useAuth();
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    if (isSuperAdmin) {
      ensureDVLDepartment();
      ensureDVLvDepartment();
    }
  }, [isSuperAdmin]);

  useEffect(() => {
    const unsub = subscribeToDepartments((depts) => {
      if (isSuperAdmin || isAdmin) {
        setDepartments(depts);
      } else {
        const assigned = userProfile?.assignedDepartments || [];
        setDepartments(depts.filter(d => assigned.includes(d.id)));
      }
      setLoading(false);
    });
    return unsub;
  }, [isSuperAdmin, isAdmin, userProfile]);

  return (
    <div className="flex flex-col h-full p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-start sm:items-center justify-between mb-5 gap-3">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            {isSuperAdmin && <Shield size={15} className="text-yellow-400 flex-shrink-0" />}
            <h1 className="text-lg sm:text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              Welcome, {userProfile?.displayName?.split(' ')[0]}
            </h1>
          </div>
          <p className="text-xs sm:text-sm" style={{ color: 'var(--text-secondary)' }}>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => navigate('/settings')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-medium text-blue-400 transition-all flex-shrink-0"
            style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)' }}
          >
            <Plus size={14} />
            <span className="hidden sm:inline">New Department</span>
            <span className="sm:hidden">New</span>
          </button>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <StatCard icon={Bot} label="Active Bots" value={departments.length} color="#3b82f6" />
        <StatCard icon={FileText} label="Reports" value="Auto" color="#06b6d4" />
        <StatCard icon={TrendingUp} label="Status" value="Live" color="#10b981" />
      </div>

      {/* Departments grid */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
            <Sparkles size={13} className="text-blue-400" />
            Department Bots
          </h2>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {departments.length} dept{departments.length !== 1 ? 's' : ''}
          </span>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="glass-card rounded-2xl h-44 animate-pulse" />
            ))}
          </div>
        ) : departments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
              style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)' }}>
              <Bot size={26} className="text-blue-400" />
            </div>
            <h3 className="font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>No departments yet</h3>
            <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
              {isAdmin ? 'Create your first department bot from Settings' : 'You have no assigned departments'}
            </p>
            {isAdmin && (
              <button
                onClick={() => navigate('/settings')}
                className="px-4 py-2 rounded-xl text-sm font-medium text-white gradient-btn"
              >
                Create Department
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-2">
            {departments.map(dept => (
              <DepartmentCard key={dept.id} department={dept} />
            ))}
          </div>
        )}
      </div>

      {/* Chat bar */}
      <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--border-clr)' }}>
        <DashboardChatBar departments={departments} />
      </div>
    </div>
  );
}
