import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Eye, EyeOff, Dna, Loader2, User } from 'lucide-react';
import toast from 'react-hot-toast';

export default function SignupPage() {
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const { signup } = useAuth();
  const navigate = useNavigate();

  const handleChange = (field) => (e) => setForm(prev => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirm) {
      toast.error('Passwords do not match');
      return;
    }
    if (form.password.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }
    setLoading(true);
    try {
      await signup(form.email, form.password, form.name);
      toast.success('Account created! Welcome to BioPharma.');
      navigate('/dashboard');
    } catch (err) {
      const msg = err.code === 'auth/email-already-in-use'
        ? 'An account with this email already exists'
        : 'Failed to create account. Try again.';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(59,130,246,0.2)',
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden py-8"
      style={{ background: 'linear-gradient(135deg, #0a0f1e 0%, #0d1a35 50%, #0a0f1e 100%)' }}>

      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 rounded-full opacity-20"
          style={{ background: 'radial-gradient(circle, #3b82f6, transparent)' }} />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full opacity-15"
          style={{ background: 'radial-gradient(circle, #06b6d4, transparent)' }} />
      </div>

      <div className="w-full max-w-md px-6 animate-slide-up relative z-10">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4"
            style={{ background: 'linear-gradient(135deg, #3b82f6, #06b6d4)', boxShadow: '0 0 30px rgba(59,130,246,0.4)' }}>
            <Dna size={32} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold gradient-text">BioPharma</h1>
          <p className="text-slate-400 mt-1 text-sm">Clinical Research Intelligence Platform</p>
        </div>

        <div className="glass rounded-2xl p-8 glow-blue">
          <h2 className="text-xl font-semibold text-white mb-6">Create your account</h2>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Full Name</label>
              <div className="relative">
                <User size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={form.name}
                  onChange={handleChange('name')}
                  required
                  placeholder="Dr. John Smith"
                  className="w-full pl-10 pr-4 py-3 rounded-xl text-white placeholder-slate-500 outline-none transition-all"
                  style={inputStyle}
                  onFocus={e => e.target.style.borderColor = 'rgba(59,130,246,0.6)'}
                  onBlur={e => e.target.style.borderColor = 'rgba(59,130,246,0.2)'}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Email Address</label>
              <input
                type="email"
                value={form.email}
                onChange={handleChange('email')}
                required
                placeholder="you@company.com"
                className="w-full px-4 py-3 rounded-xl text-white placeholder-slate-500 outline-none transition-all"
                style={inputStyle}
                onFocus={e => e.target.style.borderColor = 'rgba(59,130,246,0.6)'}
                onBlur={e => e.target.style.borderColor = 'rgba(59,130,246,0.2)'}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Password</label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  value={form.password}
                  onChange={handleChange('password')}
                  required
                  placeholder="Min 6 characters"
                  className="w-full px-4 py-3 pr-12 rounded-xl text-white placeholder-slate-500 outline-none transition-all"
                  style={inputStyle}
                  onFocus={e => e.target.style.borderColor = 'rgba(59,130,246,0.6)'}
                  onBlur={e => e.target.style.borderColor = 'rgba(59,130,246,0.2)'}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors"
                >
                  {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Confirm Password</label>
              <input
                type="password"
                value={form.confirm}
                onChange={handleChange('confirm')}
                required
                placeholder="Re-enter password"
                className="w-full px-4 py-3 rounded-xl text-white placeholder-slate-500 outline-none transition-all"
                style={inputStyle}
                onFocus={e => e.target.style.borderColor = 'rgba(59,130,246,0.6)'}
                onBlur={e => e.target.style.borderColor = 'rgba(59,130,246,0.2)'}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl font-semibold text-white gradient-btn flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? <><Loader2 size={18} className="animate-spin" /> Creating account...</> : 'Create Account'}
            </button>
          </form>

          <p className="text-center mt-6 text-slate-400 text-sm">
            Already have an account?{' '}
            <Link to="/login" className="text-blue-400 hover:text-blue-300 font-medium transition-colors">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
