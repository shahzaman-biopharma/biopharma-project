import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Navigate } from 'react-router-dom';
import {
  getAllDepartments, createDepartment, updateDepartment, deleteDepartment,
  getAllUsers, updateUserProfile, deleteUser,
  getReportSettings, saveReportSettings,
  createNotification,
  updateDeptUserPermission, getAdminTabPermissions, saveAdminTabPermissions,
} from '../services/firestore';
import { generateDepartmentPrompt } from '../services/openai';
import {
  Settings, Plus, Trash2, Edit2, Users, Bot, Database, Save,
  Loader2, X, Shield, UserPlus, ChevronDown, ChevronUp,
  Sparkles, Key, Globe, FileText, Check, Eye, EyeOff,
  ShieldCheck, Lock,
} from 'lucide-react';
import toast from 'react-hot-toast';

// ─── Tabs ───────────────────────────────────────────────────────────────────

const ALL_TABS = [
  { id: 'departments', label: 'Departments', icon: Bot },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'reports', label: 'Reports', icon: FileText },
  { id: 'access', label: 'Dept Access', icon: Lock },
];
const SUPER_TAB = { id: 'permissions', label: 'Role Permissions', icon: ShieldCheck };

const TIMEZONES = [
  { value: 'Asia/Karachi', label: 'Pakistan (PKT, UTC+5)' },
  { value: 'Asia/Kolkata', label: 'India (IST, UTC+5:30)' },
  { value: 'Asia/Dubai', label: 'UAE (GST, UTC+4)' },
  { value: 'Asia/Riyadh', label: 'Saudi Arabia (AST, UTC+3)' },
  { value: 'Europe/London', label: 'UK (GMT/BST)' },
  { value: 'America/New_York', label: 'USA Eastern (EST/EDT)' },
  { value: 'America/Chicago', label: 'USA Central (CST/CDT)' },
  { value: 'America/Los_Angeles', label: 'USA Pacific (PST/PDT)' },
  { value: 'UTC', label: 'UTC' },
];

const WEEKDAYS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

// ─── Department Form ─────────────────────────────────────────────────────────

function DepartmentForm({ dept, onSave, onCancel, users }) {
  const [form, setForm] = useState({
    name: dept?.name || '',
    tag: dept?.tag || '',
    description: dept?.description || '',
    businessContext: dept?.businessContext || '',
    systemPrompt: dept?.systemPrompt || '',
    dataSources: dept?.dataSources || [],
    assignedUsers: dept?.assignedUsers || [],
  });
  const [generatingPrompt, setGeneratingPrompt] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newSource, setNewSource] = useState({ type: 'googlesheet', name: '', url: '', content: '' });
  const [showAddSource, setShowAddSource] = useState(false);

  const set = (field) => (e) => setForm(p => ({ ...p, [field]: e.target.value }));

  const handleGeneratePrompt = async () => {
    if (!form.name || !form.description) {
      toast.error('Enter department name and description first');
      return;
    }
    setGeneratingPrompt(true);
    try {
      const prompt = await generateDepartmentPrompt({
        name: form.name,
        description: form.description,
        businessContext: form.businessContext,
      });
      setForm(p => ({ ...p, systemPrompt: prompt }));
      toast.success('System prompt generated!');
    } catch {
      toast.error('Failed to generate prompt. Check OpenAI API key.');
    } finally {
      setGeneratingPrompt(false);
    }
  };

  const addDataSource = () => {
    if (!newSource.name) { toast.error('Enter source name'); return; }
    if (newSource.type === 'googlesheet' && !newSource.url) { toast.error('Enter Google Sheet URL'); return; }
    setForm(p => ({ ...p, dataSources: [...p.dataSources, { ...newSource, id: Date.now() }] }));
    setNewSource({ type: 'googlesheet', name: '', url: '', content: '' });
    setShowAddSource(false);
  };

  const removeSource = (id) =>
    setForm(p => ({ ...p, dataSources: p.dataSources.filter(s => s.id !== id) }));

  const toggleUser = (uid) => {
    setForm(p => ({
      ...p,
      assignedUsers: p.assignedUsers.includes(uid)
        ? p.assignedUsers.filter(u => u !== uid)
        : [...p.assignedUsers, uid],
    }));
  };

  const handleSave = async () => {
    if (!form.name) { toast.error('Department name required'); return; }
    setSaving(true);
    try {
      await onSave(form);
      toast.success(dept ? 'Department updated!' : 'Department created!');
    } catch {
      toast.error('Failed to save department');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = "w-full px-3 py-2.5 rounded-xl text-white text-sm outline-none transition-all placeholder-slate-500";
  const inputStyle = { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(59,130,246,0.15)' };

  return (
    <div className="space-y-6">
      {/* Basic Info */}
      <section>
        <h3 className="text-white font-semibold text-sm mb-3 flex items-center gap-2">
          <Bot size={14} className="text-blue-400" /> Basic Information
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 sm:col-span-1">
            <label className="text-xs text-slate-400 mb-1.5 block">Department Name *</label>
            <input className={inputCls} style={inputStyle} value={form.name}
              onChange={set('name')} placeholder="e.g. Data Verification Log" />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className="text-xs text-slate-400 mb-1.5 block">Short Tag (3 letters)</label>
            <input className={inputCls} style={inputStyle} value={form.tag}
              onChange={set('tag')} placeholder="DVL" maxLength={4} />
          </div>
          <div className="col-span-2">
            <label className="text-xs text-slate-400 mb-1.5 block">Description</label>
            <textarea className={inputCls} style={inputStyle} value={form.description}
              onChange={set('description')} rows={2}
              placeholder="What does this department do?" />
          </div>
          <div className="col-span-2">
            <label className="text-xs text-slate-400 mb-1.5 block">Business Context (for prompt generation)</label>
            <textarea className={inputCls} style={inputStyle} value={form.businessContext}
              onChange={set('businessContext')} rows={2}
              placeholder="Describe business processes, key workflows, data types..." />
          </div>
        </div>
      </section>

      {/* System Prompt */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-white font-semibold text-sm flex items-center gap-2">
            <Sparkles size={14} className="text-purple-400" /> AI System Prompt
          </h3>
          <button
            onClick={handleGeneratePrompt}
            disabled={generatingPrompt}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-purple-300 transition-all"
            style={{ background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)' }}
          >
            {generatingPrompt ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            Auto-Generate via GPT
          </button>
        </div>
        <textarea
          className={inputCls}
          style={inputStyle}
          value={form.systemPrompt}
          onChange={set('systemPrompt')}
          rows={6}
          placeholder="The AI system prompt that defines how this department's bot behaves. You can auto-generate it using GPT above."
        />
      </section>

      {/* Data Sources */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-white font-semibold text-sm flex items-center gap-2">
            <Database size={14} className="text-cyan-400" /> Data Sources
          </h3>
          <button
            onClick={() => setShowAddSource(!showAddSource)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-cyan-300 transition-all"
            style={{ background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.25)' }}
          >
            <Plus size={12} /> Add Source
          </button>
        </div>

        {/* Existing sources */}
        {form.dataSources.map(src => (
          <div key={src.id} className="flex items-center gap-3 p-3 rounded-xl mb-2"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <Globe size={14} className="text-cyan-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-white text-xs font-medium">{src.name}</p>
              <p className="text-slate-500 text-xs truncate">{src.url || 'Text content'}</p>
            </div>
            <span className="text-xs px-2 py-0.5 rounded-full text-cyan-400"
              style={{ background: 'rgba(6,182,212,0.1)' }}>
              {src.type === 'googlesheet' ? 'G.Sheet' : 'Text'}
            </span>
            <button onClick={() => removeSource(src.id)}
              className="text-slate-500 hover:text-red-400 transition-colors">
              <X size={14} />
            </button>
          </div>
        ))}

        {/* Add source form */}
        {showAddSource && (
          <div className="p-4 rounded-xl space-y-3 mt-2"
            style={{ background: 'rgba(6,182,212,0.05)', border: '1px solid rgba(6,182,212,0.15)' }}>
            <div className="flex gap-2">
              {['googlesheet', 'text'].map(t => (
                <button key={t} onClick={() => setNewSource(p => ({ ...p, type: t }))}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all"
                  style={newSource.type === t ? {
                    background: 'rgba(6,182,212,0.2)', border: '1px solid rgba(6,182,212,0.4)', color: '#22d3ee',
                  } : { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#64748b' }}>
                  {t === 'googlesheet' ? 'Google Sheet' : 'Text / Notes'}
                </button>
              ))}
            </div>
            <input className={inputCls} style={inputStyle} value={newSource.name}
              onChange={e => setNewSource(p => ({ ...p, name: e.target.value }))} placeholder="Source name" />
            {newSource.type === 'googlesheet' ? (
              <input className={inputCls} style={inputStyle} value={newSource.url}
                onChange={e => setNewSource(p => ({ ...p, url: e.target.value }))}
                placeholder="https://docs.google.com/spreadsheets/d/..." />
            ) : (
              <textarea className={inputCls} style={inputStyle} value={newSource.content}
                onChange={e => setNewSource(p => ({ ...p, content: e.target.value }))}
                rows={3} placeholder="Paste data or notes here..." />
            )}
            <div className="flex gap-2">
              <button onClick={addDataSource}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white"
                style={{ background: 'linear-gradient(135deg, #06b6d4, #3b82f6)' }}>
                <Check size={12} /> Add Source
              </button>
              <button onClick={() => setShowAddSource(false)}
                className="px-3 py-2 rounded-lg text-xs text-slate-400 hover:text-white transition-colors"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Assign Users */}
      <section>
        <h3 className="text-white font-semibold text-sm mb-3 flex items-center gap-2">
          <Users size={14} className="text-green-400" /> Assign Users
        </h3>
        <div className="space-y-2">
          {users.filter(u => u.role === 'user').map(u => (
            <div key={u.id} onClick={() => toggleUser(u.id)}
              className="flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all"
              style={{
                background: form.assignedUsers.includes(u.id)
                  ? 'rgba(59,130,246,0.1)' : 'rgba(255,255,255,0.04)',
                border: form.assignedUsers.includes(u.id)
                  ? '1px solid rgba(59,130,246,0.3)' : '1px solid rgba(255,255,255,0.06)',
              }}>
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                style={{ background: 'linear-gradient(135deg, #3b82f6, #06b6d4)' }}>
                {u.displayName?.[0]?.toUpperCase()}
              </div>
              <div className="flex-1">
                <p className="text-white text-xs font-medium">{u.displayName}</p>
                <p className="text-slate-500 text-xs">{u.email}</p>
              </div>
              {form.assignedUsers.includes(u.id) && (
                <Check size={14} className="text-blue-400" />
              )}
            </div>
          ))}
          {users.filter(u => u.role === 'user').length === 0 && (
            <p className="text-slate-500 text-xs py-2">No regular users found. Create users from the Users tab.</p>
          )}
        </div>
      </section>

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-2 border-t" style={{ borderColor: 'rgba(59,130,246,0.1)' }}>
        <button onClick={onCancel}
          className="px-4 py-2 rounded-xl text-sm text-slate-400 hover:text-white transition-colors"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
          Cancel
        </button>
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white gradient-btn disabled:opacity-50">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {dept ? 'Save Changes' : 'Create Department'}
        </button>
      </div>
    </div>
  );
}

// ─── Permission Toggle Button ─────────────────────────────────────────────────

function PermToggle({ label, active, saving, color, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={saving}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all"
      style={active ? {
        background: `${color}1a`,
        border: `1px solid ${color}40`,
        color,
      } : {
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        color: '#475569',
      }}
    >
      {saving ? <Loader2 size={11} className="animate-spin" /> : active ? <Check size={11} /> : <X size={11} />}
      {label}
    </button>
  );
}

// ─── Dept Access Tab ──────────────────────────────────────────────────────────

function DeptAccessTab({ departments, users, userProfile, onPermissionChange }) {
  const [selectedDept, setSelectedDept] = useState(departments[0]?.id ?? null);
  const [saving, setSaving] = useState({});

  const dept = departments.find(d => d.id === selectedDept);
  const deptUsers = users.filter(u => dept?.assignedUsers?.includes(u.id));

  const handlePermToggle = async (userId, permType) => {
    const current = dept?.userPermissions?.[userId] ?? { read: true, write: false };
    const updated = { ...current, [permType]: !current[permType] };
    const key = `${userId}_${permType}`;
    setSaving(p => ({ ...p, [key]: true }));
    try {
      await updateDeptUserPermission(selectedDept, userId, updated);
      onPermissionChange(selectedDept, userId, updated);
      const permLabel = permType === 'write' ? 'write (bot commands)' : 'read';
      createNotification({
        type: 'permission_changed',
        title: `${dept.name} Access ${updated[permType] ? 'Granted' : 'Revoked'}`,
        message: `Your ${permLabel} permission in "${dept.name}" has been ${updated[permType] ? 'enabled' : 'disabled'}.`,
        recipientId: userId,
        triggeredBy: userProfile?.uid,
        triggeredByName: userProfile?.displayName || userProfile?.email,
        departmentId: selectedDept,
        departmentName: dept.name,
      }).catch(console.error);
      toast.success('Permission updated');
    } catch {
      toast.error('Failed to update permission');
    } finally {
      setSaving(p => ({ ...p, [key]: false }));
    }
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {/* Left: dept list */}
      <div className="sm:col-span-1">
        <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-3 font-semibold">Select Department</p>
        <div className="space-y-1.5">
          {departments.map(d => (
            <button
              key={d.id}
              onClick={() => setSelectedDept(d.id)}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all"
              style={selectedDept === d.id ? {
                background: 'rgba(59,130,246,0.15)',
                border: '1px solid rgba(59,130,246,0.3)',
                color: '#60a5fa',
              } : {
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.06)',
                color: '#64748b',
              }}
            >
              <Bot size={13} className="flex-shrink-0" />
              <span className="flex-1 truncate text-sm font-medium">{d.name}</span>
              {d.tag && (
                <span className="text-xs px-1.5 py-0.5 rounded font-bold flex-shrink-0"
                  style={{ background: 'rgba(59,130,246,0.1)', color: '#3b82f6' }}>
                  {d.tag}
                </span>
              )}
            </button>
          ))}
          {departments.length === 0 && (
            <p className="text-slate-600 text-xs py-6 text-center">No departments yet.</p>
          )}
        </div>
      </div>

      {/* Right: user permissions */}
      <div className="sm:col-span-2">
        {dept ? (
          <>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-3 font-semibold">
              Access Control — {dept.name}
            </p>
            {deptUsers.length === 0 ? (
              <div className="text-center py-10 rounded-2xl"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <Users size={28} className="text-slate-600 mx-auto mb-2" />
                <p className="text-slate-500 text-sm">No users assigned to this department.</p>
                <p className="text-slate-600 text-xs mt-1">Assign users via the Departments tab.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {deptUsers.map(u => {
                  const perms = dept?.userPermissions?.[u.id] ?? { read: true, write: false };
                  return (
                    <div key={u.id} className="flex items-center gap-3 p-3.5 rounded-xl"
                      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                        style={{ background: 'linear-gradient(135deg, #3b82f6, #06b6d4)' }}>
                        {u.displayName?.[0]?.toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium">{u.displayName}</p>
                        <p className="text-slate-500 text-xs">{u.email}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <PermToggle
                          label="Read"
                          active={perms.read}
                          saving={!!saving[`${u.id}_read`]}
                          color="#10b981"
                          onClick={() => handlePermToggle(u.id, 'read')}
                        />
                        <PermToggle
                          label="Write"
                          active={perms.write}
                          saving={!!saving[`${u.id}_write`]}
                          color="#f59e0b"
                          onClick={() => handlePermToggle(u.id, 'write')}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="mt-4 p-3 rounded-xl"
              style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <p className="text-slate-500 text-xs font-medium mb-1.5">Permission Guide</p>
              <div className="space-y-0.5 text-xs">
                <p className="text-slate-500">
                  <span className="text-emerald-400 font-semibold">Read</span> — can view data and query the AI bot
                </p>
                <p className="text-slate-500">
                  <span className="text-yellow-400 font-semibold">Write</span> — can add, update, delete records via bot commands
                </p>
              </div>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-40 rounded-2xl"
            style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <p className="text-slate-600 text-sm">Select a department to manage access</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Role Permissions Tab (superadmin only) ───────────────────────────────────

function RolePermissionsTab({ adminTabPerms, onSave, saving }) {
  const [perms, setPerms] = useState({ ...adminTabPerms });

  const CONFIGURABLE = [
    { id: 'departments', label: 'Departments', icon: Bot, desc: 'Create, edit and delete departments and AI bot configs' },
    { id: 'users', label: 'Users', icon: Users, desc: 'Manage user accounts, roles, and create new users' },
    { id: 'reports', label: 'Reports', icon: FileText, desc: 'View report history and configure auto-scheduling' },
    { id: 'access', label: 'Dept Access', icon: Lock, desc: 'Manage read/write bot permissions for users in departments' },
  ];

  const isOn = (id) => perms[id] !== false;
  const toggle = (id) => setPerms(p => ({ ...p, [id]: !isOn(id) }));

  return (
    <div className="max-w-2xl">
      <div className="glass rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck size={15} className="text-yellow-400" />
          <h2 className="text-white font-semibold">Admin Tab Permissions</h2>
        </div>
        <p className="text-slate-400 text-xs mb-5">
          Choose which Settings tabs admins can access. SuperAdmin always sees all tabs.
        </p>

        <div className="space-y-2.5">
          {CONFIGURABLE.map(item => (
            <div
              key={item.id}
              className="flex items-center gap-4 p-4 rounded-xl transition-all"
              style={{
                background: isOn(item.id) ? 'rgba(59,130,246,0.06)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${isOn(item.id) ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.07)'}`,
              }}
            >
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{
                  background: isOn(item.id) ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${isOn(item.id) ? 'rgba(59,130,246,0.25)' : 'rgba(255,255,255,0.08)'}`,
                }}>
                <item.icon size={15} className={isOn(item.id) ? 'text-blue-400' : 'text-slate-500'} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium" style={{ color: isOn(item.id) ? '#f1f5f9' : '#475569' }}>
                  {item.label}
                </p>
                <p className="text-xs mt-0.5" style={{ color: isOn(item.id) ? '#64748b' : '#334155' }}>
                  {item.desc}
                </p>
              </div>
              {/* Toggle switch */}
              <button
                onClick={() => toggle(item.id)}
                className="flex-shrink-0"
                style={{ width: 40, height: 22, position: 'relative' }}
                aria-label={`Toggle ${item.label}`}
              >
                <div style={{
                  width: 40, height: 22, borderRadius: 11,
                  background: isOn(item.id) ? '#3b82f6' : 'rgba(255,255,255,0.1)',
                  border: `1px solid ${isOn(item.id) ? '#2563eb' : 'rgba(255,255,255,0.15)'}`,
                  transition: 'background 0.2s, border-color 0.2s',
                  position: 'relative',
                }}>
                  <div style={{
                    position: 'absolute',
                    top: 2,
                    left: isOn(item.id) ? 20 : 2,
                    width: 16, height: 16, borderRadius: 8,
                    background: isOn(item.id) ? 'white' : 'rgba(255,255,255,0.4)',
                    transition: 'left 0.2s, background 0.2s',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                  }} />
                </div>
              </button>
            </div>
          ))}
        </div>

        <div className="mt-4 p-3 rounded-xl"
          style={{ background: 'rgba(234,179,8,0.06)', border: '1px solid rgba(234,179,8,0.15)' }}>
          <p className="text-yellow-400 text-xs font-medium mb-1">Note</p>
          <p className="text-slate-400 text-xs">
            Changes take effect immediately. Admins may need to reload Settings to see updated tabs.
            SuperAdmin always retains full access.
          </p>
        </div>

        <div className="flex justify-end mt-5">
          <button
            onClick={() => onSave(perms)}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white gradient-btn disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save Permissions
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Settings Page ───────────────────────────────────────────────────────

export default function SettingsPage() {
  const { isAdmin, isSuperAdmin, userProfile } = useAuth();
  const [tab, setTab] = useState('departments');
  const [departments, setDepartments] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingDept, setEditingDept] = useState(null);
  const [expandedDept, setExpandedDept] = useState(null);

  // Report settings state
  const [reportSettings, setReportSettings] = useState({
    enabled: false,
    timezone: 'Asia/Karachi',
    weeklyDay: 1,
    weeklyHour: 8,
    monthlyDay: 1,
    monthlyHour: 8,
    departmentAccess: {},
  });
  const [savingReportSettings, setSavingReportSettings] = useState(false);

  // User creation state
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', email: '', password: '', role: 'user' });
  const [showCreatePwd, setShowCreatePwd] = useState(false);
  const [visiblePasswords, setVisiblePasswords] = useState({});
  const [adminTabPerms, setAdminTabPerms] = useState({ departments: true, users: true, reports: true, access: true });
  const [savingAdminPerms, setSavingAdminPerms] = useState(false);

  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [depts, usrs] = await Promise.all([getAllDepartments(), getAllUsers()]);
        setDepartments(depts);
        setUsers(usrs);
      } catch (e) {
        console.error('Failed to load departments/users:', e);
        toast.error('Failed to load data. Check Firestore permissions.');
      }
      try {
        const rptSettings = await getReportSettings();
        if (rptSettings) setReportSettings(rptSettings);
      } catch {
        // settings collection not accessible yet — rules not deployed
      }
      try {
        const ap = await getAdminTabPermissions();
        if (ap) setAdminTabPerms(ap);
      } catch { /* no adminPermissions doc yet — use defaults */ }
      setLoading(false);
    };
    load();
  }, []);

  const handleSaveReportSettings = async () => {
    setSavingReportSettings(true);
    try {
      await saveReportSettings(reportSettings);
      toast.success('Report settings saved!');
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setSavingReportSettings(false);
    }
  };

  const setAccess = (deptId, field, value) => {
    setReportSettings(p => ({
      ...p,
      departmentAccess: {
        ...p.departmentAccess,
        [deptId]: { ...(p.departmentAccess?.[deptId] || {}), [field]: value },
      },
    }));
  };

  const handleSaveDept = async (form) => {
    if (editingDept) {
      await updateDepartment(editingDept.id, form);
      // Update assigned users in their profiles
      const oldAssigned = editingDept.assignedUsers || [];
      const newAssigned = form.assignedUsers || [];
      // Add dept to newly assigned users
      for (const uid of newAssigned) {
        if (!oldAssigned.includes(uid)) {
          const u = users.find(u => u.id === uid);
          const current = u?.assignedDepartments || [];
          if (!current.includes(editingDept.id)) {
            await updateUserProfile(uid, { assignedDepartments: [...current, editingDept.id] });
            createNotification({
              type: 'department_assigned',
              title: 'Department Assigned',
              message: `You have been assigned to the "${form.name}" department.`,
              recipientId: uid,
              triggeredBy: userProfile?.uid,
              triggeredByName: userProfile?.displayName || userProfile?.email,
              departmentId: editingDept.id,
              departmentName: form.name,
            }).catch(console.error);
          }
        }
      }
      // Remove dept from unassigned users
      for (const uid of oldAssigned) {
        if (!newAssigned.includes(uid)) {
          const u = users.find(u => u.id === uid);
          const current = u?.assignedDepartments || [];
          await updateUserProfile(uid, { assignedDepartments: current.filter(d => d !== editingDept.id) });
          createNotification({
            type: 'department_removed',
            title: 'Department Access Removed',
            message: `You have been removed from the "${form.name}" department.`,
            recipientId: uid,
            triggeredBy: userProfile?.uid,
            triggeredByName: userProfile?.displayName || userProfile?.email,
            departmentId: editingDept.id,
            departmentName: form.name,
          }).catch(console.error);
        }
      }
    } else {
      const ref = await createDepartment(form);
      // Assign dept to selected users
      for (const uid of form.assignedUsers || []) {
        const u = users.find(u => u.id === uid);
        const current = u?.assignedDepartments || [];
        await updateUserProfile(uid, { assignedDepartments: [...current, ref.id] });
        createNotification({
          type: 'department_assigned',
          title: 'Department Assigned',
          message: `You have been assigned to the "${form.name}" department.`,
          recipientId: uid,
          triggeredBy: userProfile?.uid,
          triggeredByName: userProfile?.displayName || userProfile?.email,
          departmentId: ref.id,
          departmentName: form.name,
        }).catch(console.error);
      }
      createNotification({
        type: 'department_created',
        title: 'New Department Created',
        message: `"${form.name}" department has been added to the platform.`,
        recipientId: 'admins',
        triggeredBy: userProfile?.uid,
        triggeredByName: userProfile?.displayName || userProfile?.email,
        departmentId: ref.id,
        departmentName: form.name,
      }).catch(console.error);
    }
    const depts = await getAllDepartments();
    setDepartments(depts);
    setShowForm(false);
    setEditingDept(null);
  };

  const handleDeleteDept = async (id) => {
    if (!confirm('Delete this department? This cannot be undone.')) return;
    const dept = departments.find(d => d.id === id);
    await deleteDepartment(id);
    setDepartments(p => p.filter(d => d.id !== id));
    toast.success('Department deleted');
    // Notify each dept member
    for (const uid of dept?.assignedUsers || []) {
      createNotification({
        type: 'department_deleted',
        title: 'Department Removed',
        message: `The "${dept.name}" department has been deleted from the platform.`,
        recipientId: uid,
        triggeredBy: userProfile?.uid,
        triggeredByName: userProfile?.displayName || userProfile?.email,
        departmentName: dept.name,
      }).catch(console.error);
    }
    // Notify admins
    createNotification({
      type: 'department_deleted',
      title: 'Department Deleted',
      message: `"${dept?.name}" department has been permanently removed.`,
      recipientId: 'admins',
      triggeredBy: userProfile?.uid,
      triggeredByName: userProfile?.displayName || userProfile?.email,
      departmentName: dept?.name,
    }).catch(console.error);
  };

  const handleRoleChange = async (uid, role) => {
    if (uid === userProfile?.uid && role !== 'superadmin') {
      toast.error('Cannot change your own role');
      return;
    }
    await updateUserProfile(uid, { role });
    setUsers(p => p.map(u => u.id === uid ? { ...u, role } : u));
    toast.success('Role updated');
    createNotification({
      type: 'role_changed',
      title: 'Your Role Has Been Updated',
      message: `Your account role has been changed to "${role}".`,
      recipientId: uid,
      triggeredBy: userProfile?.uid,
      triggeredByName: userProfile?.displayName || userProfile?.email,
    }).catch(console.error);
  };

  const handleDeleteUser = async (uid) => {
    if (uid === userProfile?.uid) { toast.error('Cannot delete yourself'); return; }
    if (!confirm('Delete this user from database?')) return;
    await deleteUser(uid);
    setUsers(p => p.filter(u => u.id !== uid));
    toast.success('User removed from database');
  };

  const handlePermissionChange = (deptId, userId, permissions) => {
    setDepartments(prev => prev.map(d => d.id !== deptId ? d : {
      ...d,
      userPermissions: { ...(d.userPermissions ?? {}), [userId]: permissions },
    }));
  };

  const handleSaveAdminPerms = async (perms) => {
    setSavingAdminPerms(true);
    try {
      await saveAdminTabPermissions(perms);
      setAdminTabPerms(perms);
      toast.success('Permissions saved!');
      createNotification({
        type: 'permission_changed',
        title: 'Settings Access Updated',
        message: 'Admin tab permissions in Settings have been updated by Super Admin.',
        recipientId: 'admins',
        triggeredBy: userProfile?.uid,
        triggeredByName: userProfile?.displayName || userProfile?.email,
      }).catch(console.error);
    } catch {
      toast.error('Failed to save permissions');
    } finally {
      setSavingAdminPerms(false);
    }
  };

  const handleCreateUser = async () => {
    const { name, email, password, role } = createForm;
    if (!name || !email || !password) { toast.error('All fields are required'); return; }
    if (password.length < 6) { toast.error('Password must be at least 6 characters'); return; }
    setCreatingUser(true);
    try {
      const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;
      // Create user via REST API (does not sign out the current admin)
      const signUpRes = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, returnSecureToken: true }),
        }
      );
      const signUpData = await signUpRes.json();
      if (signUpData.error) throw new Error(signUpData.error.message);

      const { localId: uid, idToken } = signUpData;

      // Set display name
      await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:update?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken, displayName: name }),
        }
      );

      // Save profile to Firestore (password stored for superadmin visibility)
      const { createUserProfile } = await import('../services/firestore');
      const newProfile = {
        uid,
        email,
        displayName: name,
        role,
        assignedDepartments: [],
        isActive: true,
        createdAt: new Date().toISOString(),
        createdBy: userProfile?.uid,
        _password: password,
      };
      await createUserProfile(uid, newProfile);
      createNotification({
        type: 'new_user',
        title: 'New User Created',
        message: `${name} (${email}) has been added as ${role}.`,
        recipientId: 'admins',
        triggeredBy: userProfile?.uid,
        triggeredByName: userProfile?.displayName || userProfile?.email,
      }).catch(console.error);

      setUsers(p => [...p, { id: uid, ...newProfile }]);
      setShowCreateUser(false);
      setCreateForm({ name: '', email: '', password: '', role: 'user' });
      toast.success(`User "${name}" created successfully!`);
    } catch (e) {
      toast.error(e.message || 'Failed to create user');
    } finally {
      setCreatingUser(false);
    }
  };

  const visibleTabs = isSuperAdmin
    ? [...ALL_TABS, SUPER_TAB]
    : ALL_TABS.filter(t => adminTabPerms[t.id] !== false);

  return (
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.25)' }}>
          <Settings size={18} className="text-purple-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg sm:text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Settings</h1>
          <p className="text-xs sm:text-sm hidden sm:block" style={{ color: 'var(--text-secondary)' }}>
            Manage departments, users, and system configuration
          </p>
        </div>
        {isSuperAdmin && (
          <div className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-xs text-yellow-400 flex-shrink-0"
            style={{ background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.2)' }}>
            <Shield size={11} />
            <span className="hidden sm:inline">Super Admin</span>
          </div>
        )}
      </div>

      {/* Tabs — scrollable on mobile */}
      <div className="flex gap-1 mb-5 border-b overflow-x-auto pb-px" style={{ borderColor: 'rgba(59,130,246,0.1)' }}>
        {visibleTabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="flex items-center gap-1.5 px-3 sm:px-4 py-2.5 text-xs sm:text-sm font-medium transition-all -mb-px whitespace-nowrap flex-shrink-0"
            style={tab === id ? {
              color: '#60a5fa',
              borderBottom: '2px solid #3b82f6',
            } : { color: '#64748b' }}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin text-blue-400" />
        </div>
      ) : tab === 'departments' ? (
        /* ─── DEPARTMENTS TAB ─── */
        <div>
          {!showForm && (
            <div className="flex justify-end mb-4">
              <button
                onClick={() => { setShowForm(true); setEditingDept(null); }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white gradient-btn"
              >
                <Plus size={15} /> New Department
              </button>
            </div>
          )}

          {/* Create/Edit Form */}
          {showForm && (
            <div className="glass rounded-2xl p-4 sm:p-6 mb-6">
              <h2 className="text-white font-semibold mb-5">
                {editingDept ? `Edit: ${editingDept.name}` : 'Create New Department'}
              </h2>
              <DepartmentForm
                dept={editingDept}
                users={users}
                onSave={handleSaveDept}
                onCancel={() => { setShowForm(false); setEditingDept(null); }}
              />
            </div>
          )}

          {/* Departments list */}
          <div className="space-y-3">
            {departments.map(dept => (
              <div key={dept.id} className="glass-card rounded-2xl overflow-hidden">
                <div
                  className="flex items-center gap-3 p-4 sm:p-5 cursor-pointer"
                  onClick={() => setExpandedDept(expandedDept === dept.id ? null : dept.id)}
                >
                  <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.2)' }}>
                    <Bot size={17} className="text-blue-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-white font-semibold text-sm truncate">{dept.name}</h3>
                      {dept.tag && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-bold text-blue-400 flex-shrink-0"
                          style={{ background: 'rgba(59,130,246,0.12)' }}>{dept.tag}</span>
                      )}
                    </div>
                    <p className="text-slate-500 text-xs mt-0.5 truncate">{dept.description?.substring(0, 80)}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs text-slate-500 hidden sm:inline">{dept.dataSources?.length || 0} src</span>
                    <span className="text-xs text-slate-500 hidden sm:inline">{dept.assignedUsers?.length || 0} usr</span>
                    {expandedDept === dept.id ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                  </div>
                </div>

                {expandedDept === dept.id && (
                  <div className="border-t px-5 pb-5 pt-4" style={{ borderColor: 'rgba(59,130,246,0.1)' }}>
                    <div className="flex justify-end gap-2 mb-4">
                      <button
                        onClick={() => { setEditingDept(dept); setShowForm(true); setExpandedDept(null); }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-blue-400 transition-all"
                        style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)' }}
                      >
                        <Edit2 size={12} /> Edit
                      </button>
                      <button
                        onClick={() => handleDeleteDept(dept.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-red-400 transition-all"
                        style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}
                      >
                        <Trash2 size={12} /> Delete
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                      <div>
                        <p className="text-slate-500 mb-1">Data Sources</p>
                        {dept.dataSources?.length ? dept.dataSources.map(s => (
                          <p key={s.id} className="text-slate-300">{s.name}</p>
                        )) : <p className="text-slate-600">None</p>}
                      </div>
                      <div>
                        <p className="text-slate-500 mb-1">Telegram Bot</p>
                        <p className="text-green-400 text-xs">✓ Connected — BioPharma CRA Bot</p>
                      </div>
                      <div className="col-span-2">
                        <p className="text-slate-500 mb-1">System Prompt Preview</p>
                        <p className="text-slate-400 line-clamp-3 leading-relaxed">
                          {dept.systemPrompt?.substring(0, 200) || 'No prompt set'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {departments.length === 0 && (
              <div className="text-center py-16">
                <Bot size={40} className="text-slate-600 mx-auto mb-3" />
                <p className="text-slate-400">No departments yet. Create your first one above.</p>
              </div>
            )}
          </div>
        </div>
      ) : tab === 'users' ? (
        /* ─── USERS TAB ─── */
        <div>
          {/* Header row with Create User button */}
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-slate-400">{users.length} user{users.length !== 1 ? 's' : ''}</p>
            {isAdmin && (
              <button
                onClick={() => setShowCreateUser(v => !v)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white gradient-btn"
              >
                <UserPlus size={15} /> Create User
              </button>
            )}
          </div>

          {/* Create User Form */}
          {showCreateUser && (
            <div className="glass rounded-2xl p-5 mb-5">
              <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                <UserPlus size={15} className="text-blue-400" /> New User
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1.5 block">Full Name *</label>
                  <input
                    className="w-full px-3 py-2.5 rounded-xl text-white text-sm outline-none"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(59,130,246,0.15)' }}
                    placeholder="John Doe"
                    value={createForm.name}
                    onChange={e => setCreateForm(p => ({ ...p, name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1.5 block">Email *</label>
                  <input
                    type="email"
                    className="w-full px-3 py-2.5 rounded-xl text-white text-sm outline-none"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(59,130,246,0.15)' }}
                    placeholder="john@company.com"
                    value={createForm.email}
                    onChange={e => setCreateForm(p => ({ ...p, email: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1.5 block">Password *</label>
                  <div className="relative">
                    <input
                      type={showCreatePwd ? 'text' : 'password'}
                      className="w-full px-3 py-2.5 pr-10 rounded-xl text-white text-sm outline-none"
                      style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(59,130,246,0.15)' }}
                      placeholder="Min. 6 characters"
                      value={createForm.password}
                      onChange={e => setCreateForm(p => ({ ...p, password: e.target.value }))}
                    />
                    <button
                      type="button"
                      onClick={() => setShowCreatePwd(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                    >
                      {showCreatePwd ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1.5 block">Role</label>
                  <select
                    className="w-full px-3 py-2.5 rounded-xl text-white text-sm outline-none"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(59,130,246,0.15)' }}
                    value={createForm.role}
                    onChange={e => setCreateForm(p => ({ ...p, role: e.target.value }))}
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                    {isSuperAdmin && <option value="superadmin">Super Admin</option>}
                  </select>
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => { setShowCreateUser(false); setCreateForm({ name: '', email: '', password: '', role: 'user' }); }}
                  className="px-4 py-2 rounded-xl text-sm text-slate-400 hover:text-white transition-colors"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateUser}
                  disabled={creatingUser}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white gradient-btn disabled:opacity-50"
                >
                  {creatingUser ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
                  Create User
                </button>
              </div>
            </div>
          )}

          {/* User list */}
          <div className="space-y-3">
            {users.map(u => (
              <div key={u.id} className="glass-card rounded-2xl p-4 sm:p-5 flex items-center gap-3 sm:gap-4">
                <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                  style={{ background: 'linear-gradient(135deg, #3b82f6, #06b6d4)' }}>
                  {u.displayName?.[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-white font-medium text-sm">{u.displayName}</p>
                    {u.role === 'superadmin' && <Shield size={12} className="text-yellow-400" />}
                  </div>
                  <p className="text-slate-500 text-xs">{u.email}</p>
                  <p className="text-slate-600 text-xs mt-0.5">
                    Departments: {u.assignedDepartments?.length || 0}
                  </p>
                  {/* Password visible only to superadmin */}
                  {isSuperAdmin && u._password && (
                    <div className="flex items-center gap-1.5 mt-1">
                      <Key size={10} className="text-slate-600" />
                      <span className="text-xs font-mono text-slate-500">
                        {visiblePasswords[u.id] ? u._password : '••••••••'}
                      </span>
                      <button
                        onClick={() => setVisiblePasswords(p => ({ ...p, [u.id]: !p[u.id] }))}
                        className="text-slate-600 hover:text-slate-400 transition-colors"
                      >
                        {visiblePasswords[u.id] ? <EyeOff size={10} /> : <Eye size={10} />}
                      </button>
                    </div>
                  )}
                </div>

                {/* Role selector */}
                {isSuperAdmin && u.role !== 'superadmin' && (
                  <select
                    value={u.role}
                    onChange={e => handleRoleChange(u.id, e.target.value)}
                    className="px-3 py-1.5 rounded-lg text-xs text-white outline-none"
                    style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)' }}
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                )}

                {u.role === 'superadmin' && (
                  <span className="px-2 py-1 rounded-lg text-xs text-yellow-400"
                    style={{ background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.2)' }}>
                    Super Admin
                  </span>
                )}

                {isSuperAdmin && u.id !== userProfile?.uid && (
                  <button
                    onClick={() => handleDeleteUser(u.id)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-red-400 transition-colors"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}

            {users.length === 0 && (
              <div className="text-center py-16">
                <Users size={40} className="text-slate-600 mx-auto mb-3" />
                <p className="text-slate-400">No users yet. Create your first user above.</p>
              </div>
            )}
          </div>
        </div>
      ) : tab === 'reports' ? (
        /* ─── REPORTS SETTINGS TAB ─── */
        <div className="space-y-6 max-w-3xl">

          {/* Auto-Schedule Card */}
          <div className="glass rounded-2xl p-4 sm:p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-white font-semibold flex items-center gap-2">
                <FileText size={16} className="text-blue-400" /> Auto-Report Schedule
              </h2>
              {/* Enable toggle */}
              <button
                onClick={() => setReportSettings(p => ({ ...p, enabled: !p.enabled }))}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all"
                style={reportSettings.enabled ? {
                  background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', color: '#34d399',
                } : {
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#64748b',
                }}
              >
                <div className={`w-4 h-4 rounded-full ${reportSettings.enabled ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                {reportSettings.enabled ? 'Enabled' : 'Disabled'}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Timezone */}
              <div className="sm:col-span-2">
                <label className="text-xs text-slate-400 mb-1.5 block">Timezone</label>
                <select
                  value={reportSettings.timezone}
                  onChange={e => setReportSettings(p => ({ ...p, timezone: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl text-white text-sm outline-none"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(59,130,246,0.2)' }}
                >
                  {TIMEZONES.map(tz => (
                    <option key={tz.value} value={tz.value}>{tz.label}</option>
                  ))}
                </select>
              </div>

              {/* Weekly */}
              <div className="p-4 rounded-xl" style={{ background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.15)' }}>
                <p className="text-blue-400 text-xs font-semibold mb-3 uppercase tracking-wide">Weekly Report</p>
                <div className="space-y-2">
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Day</label>
                    <select
                      value={reportSettings.weeklyDay}
                      onChange={e => setReportSettings(p => ({ ...p, weeklyDay: parseInt(e.target.value) }))}
                      className="w-full px-3 py-2 rounded-lg text-white text-sm outline-none"
                      style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(59,130,246,0.15)' }}
                    >
                      {WEEKDAYS.map(d => (
                        <option key={d.value} value={d.value}>{d.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Time (in selected timezone)</label>
                    <select
                      value={reportSettings.weeklyHour}
                      onChange={e => setReportSettings(p => ({ ...p, weeklyHour: parseInt(e.target.value) }))}
                      className="w-full px-3 py-2 rounded-lg text-white text-sm outline-none"
                      style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(59,130,246,0.15)' }}
                    >
                      {Array.from({ length: 24 }, (_, i) => (
                        <option key={i} value={i}>
                          {String(i).padStart(2, '0')}:00 {i < 12 ? 'AM' : 'PM'}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Monthly */}
              <div className="p-4 rounded-xl" style={{ background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.15)' }}>
                <p className="text-purple-400 text-xs font-semibold mb-3 uppercase tracking-wide">Monthly Report</p>
                <div className="space-y-2">
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Day of Month</label>
                    <select
                      value={reportSettings.monthlyDay}
                      onChange={e => setReportSettings(p => ({ ...p, monthlyDay: parseInt(e.target.value) }))}
                      className="w-full px-3 py-2 rounded-lg text-white text-sm outline-none"
                      style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(139,92,246,0.2)' }}
                    >
                      {Array.from({ length: 28 }, (_, i) => (
                        <option key={i + 1} value={i + 1}>{i + 1}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Time (in selected timezone)</label>
                    <select
                      value={reportSettings.monthlyHour}
                      onChange={e => setReportSettings(p => ({ ...p, monthlyHour: parseInt(e.target.value) }))}
                      className="w-full px-3 py-2 rounded-lg text-white text-sm outline-none"
                      style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(139,92,246,0.2)' }}
                    >
                      {Array.from({ length: 24 }, (_, i) => (
                        <option key={i} value={i}>
                          {String(i).padStart(2, '0')}:00 {i < 12 ? 'AM' : 'PM'}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>

            {/* Info box */}
            <div className="mt-4 rounded-xl p-3" style={{ background: 'rgba(234,179,8,0.06)', border: '1px solid rgba(234,179,8,0.15)' }}>
              <p className="text-yellow-400 text-xs font-medium mb-1">How it works</p>
              <p className="text-slate-400 text-xs">
                Reports auto-generate on the scheduled day/time in your selected timezone. The cron job runs daily at 08:00 AM PKT (03:00 UTC).
                Weekly reports generate on the selected weekday, monthly on the selected date.
              </p>
            </div>

            <div className="flex justify-end mt-4">
              <button
                onClick={handleSaveReportSettings}
                disabled={savingReportSettings}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white gradient-btn disabled:opacity-50"
              >
                {savingReportSettings ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save Schedule
              </button>
            </div>
          </div>

          {/* Per-Department Access Control */}
          <div className="glass rounded-2xl p-4 sm:p-6">
            <h2 className="text-white font-semibold flex items-center gap-2 mb-5">
              <Shield size={16} className="text-yellow-400" /> Report Access Control
            </h2>
            <p className="text-slate-400 text-xs mb-4">
              Control who can see each department's reports. SuperAdmin always has access.
            </p>

            <div className="space-y-3">
              {departments.map(dept => {
                const access = reportSettings.departmentAccess?.[dept.id] || { allowAdmins: true, allowedUsers: [] };
                return (
                  <div key={dept.id} className="p-4 rounded-xl" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                          style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.2)' }}>
                          <Bot size={13} className="text-blue-400" />
                        </div>
                        <p className="text-white text-sm font-medium">{dept.name}</p>
                        {dept.tag && (
                          <span className="px-1.5 py-0.5 rounded text-xs font-bold text-blue-400"
                            style={{ background: 'rgba(59,130,246,0.1)' }}>
                            {dept.tag}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center gap-3 text-xs">
                      {/* Allow admins toggle */}
                      <label className="flex items-center gap-2 cursor-pointer flex-shrink-0">
                        <input
                          type="checkbox"
                          checked={access.allowAdmins !== false}
                          onChange={e => setAccess(dept.id, 'allowAdmins', e.target.checked)}
                          className="w-3.5 h-3.5 accent-blue-500"
                        />
                        <span className="text-slate-300">Admins can view</span>
                      </label>

                      {/* Specific users */}
                      <div className="flex flex-wrap gap-x-3 gap-y-1.5 items-center">
                        <span className="text-slate-500">Users:</span>
                        {users.filter(u => u.role === 'user').map(u => (
                          <label key={u.id} className="inline-flex items-center gap-1 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={(access.allowedUsers || []).includes(u.id)}
                              onChange={e => {
                                const current = access.allowedUsers || [];
                                setAccess(dept.id, 'allowedUsers',
                                  e.target.checked
                                    ? [...current, u.id]
                                    : current.filter(id => id !== u.id)
                                );
                              }}
                              className="w-3.5 h-3.5 accent-blue-500"
                            />
                            <span className="text-slate-400">{u.displayName}</span>
                          </label>
                        ))}
                        {users.filter(u => u.role === 'user').length === 0 && (
                          <span className="text-slate-600">No regular users yet</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end mt-4">
              <button
                onClick={handleSaveReportSettings}
                disabled={savingReportSettings}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white gradient-btn disabled:opacity-50"
              >
                {savingReportSettings ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save Access
              </button>
            </div>
          </div>
        </div>
      ) : tab === 'access' ? (
        /* ─── DEPT ACCESS TAB ─── */
        <div className="glass-card rounded-2xl p-4 sm:p-6">
          <h2 className="text-white font-semibold flex items-center gap-2 mb-5">
            <Lock size={16} className="text-blue-400" /> Department Access Control
          </h2>
          <DeptAccessTab
            departments={departments}
            users={users}
            userProfile={userProfile}
            onPermissionChange={handlePermissionChange}
          />
        </div>
      ) : tab === 'permissions' ? (
        /* ─── ROLE PERMISSIONS TAB (superadmin only) ─── */
        <RolePermissionsTab
          adminTabPerms={adminTabPerms}
          onSave={handleSaveAdminPerms}
          saving={savingAdminPerms}
        />
      ) : null}
    </div>
  );
}
