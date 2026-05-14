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
  const [googleLoading, setGoogleLoading] = useState(false);
  const { login, signup, loginWithGoogle } = useAuth();
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

  const handleGoogleLogin = async () => {
    setGoogleLoading(true);
    try {
      await loginWithGoogle();
      toast.success('Welcome!');
      navigate('/dashboard');
    } catch (err) {
      toast.error(err.message || 'Google sign-in failed');
    } finally {
      setGoogleLoading(false);
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

          {/* Divider */}
          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t" style={{ borderColor: 'rgba(255,255,255,0.1)' }} />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="px-3 text-slate-500" style={{ background: 'rgba(13,26,53,0.95)' }}>or</span>
            </div>
          </div>

          {/* Google Sign-In */}
          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={loading || googleLoading}
            className="w-full py-3 rounded-xl font-medium text-slate-200 flex items-center justify-center gap-3 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
            onMouseOver={e => { if (!loading && !googleLoading) e.currentTarget.style.background = 'rgba(255,255,255,0.11)'; }}
            onMouseOut={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
          >
            {googleLoading ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M17.64 9.2c0-.74-.06-1.28-.19-1.84H9v3.34h4.96c-.1.83-.64 2.08-1.84 2.92l2.84 2.2c1.7-1.57 2.68-3.88 2.68-6.62z" fill="#4285F4"/>
                <path d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.84-2.2c-.76.53-1.78.9-3.12.9-2.38 0-4.4-1.57-5.12-3.74L.97 13.04C2.45 15.98 5.48 18 9 18z" fill="#34A853"/>
                <path d="M3.88 10.78A5.54 5.54 0 0 1 3.58 9c0-.62.11-1.22.29-1.78L.96 4.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.04l2.92-2.26z" fill="#FBBC05"/>
                <path d="M9 3.48c1.69 0 2.83.73 3.48 1.34l2.54-2.54C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.96l2.91 2.26C4.6 5.05 6.62 3.48 9 3.48z" fill="#EA4335"/>
              </svg>
            )}
            Continue with Google
          </button>

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
