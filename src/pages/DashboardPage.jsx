import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { subscribeToDepartments } from '../services/firestore';
import { ensureDVLDepartment } from '../utils/seedDVL';
import DepartmentCard from '../components/dashboard/DepartmentCard';
import DashboardChatBar from '../components/dashboard/DashboardChatBar';
import { Bot, Plus, Shield, Sparkles, TrendingUp, Users, FileText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div className="glass-card rounded-xl px-4 py-4 flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center"
        style={{ background: `${color}22`, border: `1px solid ${color}33` }}>
        <Icon size={18} style={{ color }} />
      </div>
      <div>
        <p className="text-2xl font-bold text-white">{value}</p>
        <p className="text-slate-500 text-xs">{label}</p>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { userProfile, isSuperAdmin, isAdmin } = useAuth();
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // Auto-seed DVL department for superadmin on first login
  useEffect(() => {
    if (isSuperAdmin) ensureDVLDepartment();
  }, [isSuperAdmin]);

  useEffect(() => {
    const unsub = subscribeToDepartments((depts) => {
      if (isSuperAdmin || isAdmin) {
        setDepartments(depts);
      } else {
        // Users only see their assigned departments
        const assigned = userProfile?.assignedDepartments || [];
        setDepartments(depts.filter(d => assigned.includes(d.id)));
      }
      setLoading(false);
    });
    return unsub;
  }, [isSuperAdmin, isAdmin, userProfile]);

  const visibleDepts = departments;

  return (
    <div className="flex flex-col h-full p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            {isSuperAdmin && <Shield size={16} className="text-yellow-400" />}
            <h1 className="text-xl font-bold text-white">
              Welcome back, {userProfile?.displayName?.split(' ')[0]}
            </h1>
          </div>
          <p className="text-slate-400 text-sm">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => navigate('/settings')}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-blue-400 transition-all"
            style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)' }}
          >
            <Plus size={16} />
            New Department
          </button>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatCard icon={Bot} label="Active Bots" value={departments.length} color="#3b82f6" />
        <StatCard icon={FileText} label="Reports" value="Auto" color="#06b6d4" />
        <StatCard icon={TrendingUp} label="Status" value="Live" color="#10b981" />
      </div>

      {/* Departments grid */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
            <Sparkles size={14} className="text-blue-400" />
            Department Bots
          </h2>
          <span className="text-xs text-slate-500">{visibleDepts.length} department{visibleDepts.length !== 1 ? 's' : ''}</span>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="glass-card rounded-2xl h-48 animate-pulse" />
            ))}
          </div>
        ) : visibleDepts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
              style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)' }}>
              <Bot size={28} className="text-blue-400" />
            </div>
            <h3 className="text-white font-semibold mb-2">No departments yet</h3>
            <p className="text-slate-500 text-sm mb-4">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {visibleDepts.map(dept => (
              <DepartmentCard key={dept.id} department={dept} />
            ))}
          </div>
        )}
      </div>

      {/* Bottom chat bar — always visible */}
      <div className="mt-6 pt-4 border-t" style={{ borderColor: 'rgba(59,130,246,0.1)' }}>
        <DashboardChatBar departments={departments} />
      </div>
    </div>
  );
}
