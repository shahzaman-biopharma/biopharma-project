import { Bot, ChevronRight, Database, Users, Activity } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const DEPT_COLORS = {
  DVL: { from: '#3b82f6', to: '#06b6d4', glow: 'rgba(59,130,246,0.2)' },
  QC: { from: '#8b5cf6', to: '#6366f1', glow: 'rgba(139,92,246,0.2)' },
  CRM: { from: '#10b981', to: '#06b6d4', glow: 'rgba(16,185,129,0.2)' },
  REG: { from: '#f59e0b', to: '#ef4444', glow: 'rgba(245,158,11,0.2)' },
  DEFAULT: { from: '#3b82f6', to: '#8b5cf6', glow: 'rgba(59,130,246,0.2)' },
};

export default function DepartmentCard({ department, onClick }) {
  const navigate = useNavigate();
  const tag = department.tag || department.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 3);
  const colors = DEPT_COLORS[tag] || DEPT_COLORS.DEFAULT;

  const handleClick = () => {
    if (onClick) onClick(department);
    navigate(`/bot/${department.id}`);
  };

  return (
    <div
      onClick={handleClick}
      className="glass-card rounded-2xl p-5 cursor-pointer relative overflow-hidden group"
      style={{ boxShadow: `0 0 0 1px rgba(59,130,246,0.1)` }}
    >
      {/* Gradient accent top bar */}
      <div className="absolute top-0 left-0 right-0 h-0.5"
        style={{ background: `linear-gradient(90deg, ${colors.from}, ${colors.to})` }} />

      {/* Glow effect on hover */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl pointer-events-none"
        style={{ background: `radial-gradient(circle at 50% 0%, ${colors.glow}, transparent 70%)` }} />

      {/* Header */}
      <div className="flex items-start justify-between mb-4 relative">
        <div>
          <div className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold mb-2"
            style={{ background: `linear-gradient(135deg, ${colors.from}22, ${colors.to}22)`, color: colors.from, border: `1px solid ${colors.from}33` }}>
            {tag}
          </div>
          <h3 className="text-white font-semibold text-sm leading-tight">{department.name}</h3>
        </div>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: `linear-gradient(135deg, ${colors.from}33, ${colors.to}22)`, border: `1px solid ${colors.from}33` }}>
          <Bot size={18} style={{ color: colors.from }} />
        </div>
      </div>

      {/* Description */}
      <p className="text-slate-400 text-xs leading-relaxed mb-4 line-clamp-2">
        {department.description || 'AI-powered department assistant'}
      </p>

      {/* Stats row */}
      <div className="flex items-center gap-3 text-xs text-slate-500 mb-4">
        <div className="flex items-center gap-1">
          <Database size={12} />
          <span>{department.dataSources?.length || 0} sources</span>
        </div>
        <div className="flex items-center gap-1">
          <Users size={12} />
          <span>{department.assignedUsers?.length || 0} users</span>
        </div>
        <div className="flex items-center gap-1">
          <Activity size={12} className="text-green-400" />
          <span className="text-green-400">Active</span>
        </div>
      </div>

      {/* CTA */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium" style={{ color: colors.from }}>Open Bot Chat</span>
        <ChevronRight size={16} style={{ color: colors.from }} className="group-hover:translate-x-1 transition-transform" />
      </div>
    </div>
  );
}
