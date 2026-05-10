import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Navigate } from 'react-router-dom';
import {
  getAllDepartments, createDepartment, updateDepartment, deleteDepartment,
  getAllUsers, updateUserProfile, deleteUser,
} from '../services/firestore';
import { generateDepartmentPrompt } from '../services/openai';
import {
  Settings, Plus, Trash2, Edit2, Users, Bot, Database, Save,
  Loader2, X, Shield, UserPlus, ChevronDown, ChevronUp,
  Sparkles, Send, Key, Globe, FileText, Check,
} from 'lucide-react';
import toast from 'react-hot-toast';

// ─── Tabs ───────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'departments', label: 'Departments', icon: Bot },
  { id: 'users', label: 'Users', icon: Users },
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
    telegram: dept?.telegram || { botToken: '', botUsername: '', webhookUrl: '' },
    assignedUsers: dept?.assignedUsers || [],
  });
  const [generatingPrompt, setGeneratingPrompt] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newSource, setNewSource] = useState({ type: 'googlesheet', name: '', url: '', content: '' });
  const [showAddSource, setShowAddSource] = useState(false);

  const set = (field) => (e) => setForm(p => ({ ...p, [field]: e.target.value }));
  const setNested = (parent, field) => (e) =>
    setForm(p => ({ ...p, [parent]: { ...p[parent], [field]: e.target.value } }));

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

      {/* Telegram Bot */}
      <section>
        <h3 className="text-white font-semibold text-sm mb-3 flex items-center gap-2">
          <Send size={14} className="text-blue-400" /> Telegram Bot Setup
        </h3>

        {/* Step guide */}
        <div className="rounded-xl p-4 mb-4 space-y-2"
          style={{ background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.15)' }}>
          <p className="text-blue-400 text-xs font-semibold mb-2">Setup Steps:</p>
          <p className="text-slate-400 text-xs">1. Telegram mein <span className="text-white font-mono">@BotFather</span> ko message karein</p>
          <p className="text-slate-400 text-xs">2. <span className="text-white font-mono">/newbot</span> → name dein → token copy karein</p>
          <p className="text-slate-400 text-xs">3. Token neeche paste karein aur Save karein</p>
          <p className="text-slate-400 text-xs">4. Firebase deploy ke baad Webhook URL set hogi — copy karke BotFather mein <span className="text-white font-mono">/setwebhook</span> karein</p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-400 mb-1.5 block">Bot Token (from @BotFather)</label>
            <input className={inputCls} style={inputStyle} value={form.telegram.botToken}
              onChange={setNested('telegram', 'botToken')}
              placeholder="7xxxxxxxxxx:AAAAAAAAAAAAA..." type="password" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block">Bot Username</label>
              <input className={inputCls} style={inputStyle} value={form.telegram.botUsername}
                onChange={setNested('telegram', 'botUsername')} placeholder="@biopharma_dvl_bot" />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block">Webhook URL (after deploy)</label>
              <input className={inputCls} style={inputStyle} value={form.telegram.webhookUrl}
                onChange={setNested('telegram', 'webhookUrl')}
                placeholder="https://us-central1-biopharma-a07e0.cloudfunctions.net/telegramWebhook?token=..." />
            </div>
          </div>

          {/* Auto webhook URL hint */}
          {form.telegram.botToken && form.telegram.webhookUrl && (
            <div className="rounded-lg p-3" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }}>
              <p className="text-xs text-green-400 font-medium mb-1">✅ Webhook URL ready — set this in Telegram:</p>
              <code className="text-xs text-slate-300 break-all select-all block mb-2">
                {form.telegram.webhookUrl}
              </code>
              <p className="text-xs text-slate-500">Browser mein kholo: <code className="text-slate-400">https://api.telegram.org/bot{'{TOKEN}'}/setWebhook?url={'{WEBHOOK_URL}'}</code></p>
            </div>
          )}
          {form.telegram.botToken && !form.telegram.webhookUrl && (
            <div className="rounded-lg p-3" style={{ background: 'rgba(234,179,8,0.06)', border: '1px solid rgba(234,179,8,0.15)' }}>
              <p className="text-xs text-yellow-400 font-medium">⚠️ Vercel deploy ke baad apna URL yahan paste karein</p>
              <p className="text-xs text-slate-500 mt-1">Format: <code className="text-slate-400">https://your-app.vercel.app/api/telegram?token=BOT_TOKEN</code></p>
            </div>
          )}
        </div>
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

  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [depts, usrs] = await Promise.all([getAllDepartments(), getAllUsers()]);
      setDepartments(depts);
      setUsers(usrs);
      setLoading(false);
    };
    load();
  }, []);

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
          }
        }
      }
      // Remove dept from unassigned users
      for (const uid of oldAssigned) {
        if (!newAssigned.includes(uid)) {
          const u = users.find(u => u.id === uid);
          const current = u?.assignedDepartments || [];
          await updateUserProfile(uid, { assignedDepartments: current.filter(d => d !== editingDept.id) });
        }
      }
    } else {
      const ref = await createDepartment(form);
      // Assign dept to selected users
      for (const uid of form.assignedUsers || []) {
        const u = users.find(u => u.id === uid);
        const current = u?.assignedDepartments || [];
        await updateUserProfile(uid, { assignedDepartments: [...current, ref.id] });
      }
    }
    const depts = await getAllDepartments();
    setDepartments(depts);
    setShowForm(false);
    setEditingDept(null);
  };

  const handleDeleteDept = async (id) => {
    if (!confirm('Delete this department? This cannot be undone.')) return;
    await deleteDepartment(id);
    setDepartments(p => p.filter(d => d.id !== id));
    toast.success('Department deleted');
  };

  const handleRoleChange = async (uid, role) => {
    if (uid === userProfile?.uid && role !== 'superadmin') {
      toast.error('Cannot change your own role');
      return;
    }
    await updateUserProfile(uid, { role });
    setUsers(p => p.map(u => u.id === uid ? { ...u, role } : u));
    toast.success('Role updated');
  };

  const handleDeleteUser = async (uid) => {
    if (uid === userProfile?.uid) { toast.error('Cannot delete yourself'); return; }
    if (!confirm('Delete this user from database?')) return;
    await deleteUser(uid);
    setUsers(p => p.filter(u => u.id !== uid));
    toast.success('User removed from database');
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.25)' }}>
          <Settings size={20} className="text-purple-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">Settings</h1>
          <p className="text-slate-400 text-sm">Manage departments, users, and system configuration</p>
        </div>
        {isSuperAdmin && (
          <div className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-yellow-400"
            style={{ background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.2)' }}>
            <Shield size={12} /> Super Admin
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b" style={{ borderColor: 'rgba(59,130,246,0.1)' }}>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all -mb-px"
            style={tab === id ? {
              color: '#60a5fa',
              borderBottom: '2px solid #3b82f6',
            } : { color: '#64748b' }}
          >
            <Icon size={15} />
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
            <div className="glass rounded-2xl p-6 mb-6">
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
                  className="flex items-center gap-4 p-5 cursor-pointer"
                  onClick={() => setExpandedDept(expandedDept === dept.id ? null : dept.id)}
                >
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.2)' }}>
                    <Bot size={18} className="text-blue-400" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-white font-semibold">{dept.name}</h3>
                      {dept.tag && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-bold text-blue-400"
                          style={{ background: 'rgba(59,130,246,0.12)' }}>{dept.tag}</span>
                      )}
                    </div>
                    <p className="text-slate-500 text-xs mt-0.5">{dept.description?.substring(0, 80)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">{dept.dataSources?.length || 0} sources</span>
                    <span className="text-xs text-slate-500">{dept.assignedUsers?.length || 0} users</span>
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
                    <div className="grid grid-cols-2 gap-4 text-xs">
                      <div>
                        <p className="text-slate-500 mb-1">Data Sources</p>
                        {dept.dataSources?.length ? dept.dataSources.map(s => (
                          <p key={s.id} className="text-slate-300">{s.name}</p>
                        )) : <p className="text-slate-600">None</p>}
                      </div>
                      <div>
                        <p className="text-slate-500 mb-1">Telegram Bot</p>
                        <p className="text-slate-300">{dept.telegram?.botUsername || 'Not configured'}</p>
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
      ) : (
        /* ─── USERS TAB ─── */
        <div className="space-y-3">
          {users.map(u => (
            <div key={u.id} className="glass-card rounded-2xl p-5 flex items-center gap-4">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
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
              <p className="text-slate-400">No users yet.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
