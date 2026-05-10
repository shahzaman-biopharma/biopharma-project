import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Eye, EyeOff, Dna, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

const SUPER_ADMIN_EMAIL = import.meta.env.VITE_SUPER_ADMIN_EMAIL || 'shahzaman.biopharma@gmail.com';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const { login, signup } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
      toast.success('Welcome back!');
      navigate('/dashboard');
    } catch (err) {
      // Super admin pehli baar login kar raha hai — auto create account
      if (
        email === SUPER_ADMIN_EMAIL &&
        (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found')
      ) {
        try {
          toast.loading('First time setup — creating super admin account...', { id: 'setup' });
          await signup(email, password, 'Super Admin');
          toast.success('Super admin account created! Welcome.', { id: 'setup' });
          navigate('/dashboard');
          return;
        } catch (signupErr) {
          toast.error(
            signupErr.code === 'auth/email-already-in-use'
              ? 'Account exists but password is wrong. Use admin123.'
              : 'Setup failed: ' + signupErr.message,
            { id: 'setup' }
          );
          return;
        }
      }

      const msg =
        err.code === 'auth/invalid-credential' ? 'Invalid email or password' :
        err.code === 'auth/user-not-found' ? 'No account found. Please sign up first.' :
        err.code === 'auth/too-many-requests' ? 'Too many attempts. Try again later.' :
        'Login failed. Check credentials and try again.';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #0a0f1e 0%, #0d1a35 50%, #0a0f1e 100%)' }}>

      {/* Background glow effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -left-40 w-80 h-80 rounded-full opacity-20"
          style={{ background: 'radial-gradient(circle, #3b82f6, transparent)' }} />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full opacity-15"
          style={{ background: 'radial-gradient(circle, #06b6d4, transparent)' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-5"
          style={{ background: 'radial-gradient(circle, #8b5cf6, transparent)' }} />
      </div>

      <div className="w-full max-w-md px-6 animate-slide-up relative z-10">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4"
            style={{ background: 'linear-gradient(135deg, #3b82f6, #06b6d4)', boxShadow: '0 0 30px rgba(59,130,246,0.4)' }}>
            <Dna size={32} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold gradient-text">BioPharma</h1>
          <p className="text-slate-400 mt-1 text-sm">Clinical Research Intelligence Platform</p>
        </div>

        {/* Card */}
        <div className="glass rounded-2xl p-8 glow-blue">
          <h2 className="text-xl font-semibold text-white mb-6">Sign in to your account</h2>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Email Address</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                placeholder="you@company.com"
                className="w-full px-4 py-3 rounded-xl text-white placeholder-slate-500 outline-none transition-all"
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(59,130,246,0.2)',
                }}
                onFocus={e => e.target.style.borderColor = 'rgba(59,130,246,0.6)'}
                onBlur={e => e.target.style.borderColor = 'rgba(59,130,246,0.2)'}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Password</label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  className="w-full px-4 py-3 pr-12 rounded-xl text-white placeholder-slate-500 outline-none transition-all"
                  style={{
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(59,130,246,0.2)',
                  }}
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

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl font-semibold text-white gradient-btn flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? <><Loader2 size={18} className="animate-spin" /> Signing in...</> : 'Sign In'}
            </button>
          </form>

          <p className="text-center mt-6 text-slate-400 text-sm">
            Don't have an account?{' '}
            <Link to="/signup" className="text-blue-400 hover:text-blue-300 font-medium transition-colors">
              Create account
            </Link>
          </p>
        </div>

        <p className="text-center mt-6 text-slate-600 text-xs">
          Biopharma CRA Platform &copy; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
