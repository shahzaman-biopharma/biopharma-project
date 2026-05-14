import { createContext, useContext, useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  setPersistence,
  browserLocalPersistence,
  signInWithPopup,
  linkWithPopup,
  reauthenticateWithPopup,
  GoogleAuthProvider,
} from 'firebase/auth';
import { auth, googleProvider } from '../services/firebase';
import { createUserProfile, getUserProfile, createNotification } from '../services/firestore';

// ─── Google token helpers (55-min session storage) ───────────────────────────
const G_TOKEN_KEY = 'bp_g_token';

function readStoredGoogleToken() {
  try {
    const s = sessionStorage.getItem(G_TOKEN_KEY);
    if (!s) return null;
    const { token, expiry } = JSON.parse(s);
    if (Date.now() > expiry) { sessionStorage.removeItem(G_TOKEN_KEY); return null; }
    return token;
  } catch { return null; }
}

function persistGoogleToken(token) {
  sessionStorage.setItem(G_TOKEN_KEY, JSON.stringify({
    token,
    expiry: Date.now() + 55 * 60 * 1000,
  }));
}

const AuthContext = createContext(null);

const SUPER_ADMIN_EMAIL = import.meta.env.VITE_SUPER_ADMIN_EMAIL || 'shahzaman.biopharma@gmail.com';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [googleToken, setGoogleToken] = useState(readStoredGoogleToken);

  const saveGoogleToken = (token) => {
    persistGoogleToken(token);
    setGoogleToken(token);
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      setLoading(true);
      if (firebaseUser) {
        let profile = await getUserProfile(firebaseUser.uid);
        if (!profile) {
          const isSuperAdmin = firebaseUser.email === SUPER_ADMIN_EMAIL;
          const newProfile = {
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            displayName: firebaseUser.displayName || firebaseUser.email.split('@')[0],
            role: isSuperAdmin ? 'superadmin' : 'user',
            assignedDepartments: [],
            isActive: true,
          };
          await createUserProfile(firebaseUser.uid, newProfile);
          profile = newProfile;
        }
        setUser(firebaseUser);
        setUserProfile(profile);
      } else {
        setUser(null);
        setUserProfile(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  const login = async (email, password) => {
    await setPersistence(auth, browserLocalPersistence);
    return signInWithEmailAndPassword(auth, email, password);
  };

  // Sign in with Google — also stores Google access token for Sheets API
  const loginWithGoogle = async () => {
    await setPersistence(auth, browserLocalPersistence);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const cred = GoogleAuthProvider.credentialFromResult(result);
      if (cred?.accessToken) saveGoogleToken(cred.accessToken);
      return result;
    } catch (err) {
      if (err.code === 'auth/account-exists-with-different-credential') {
        throw new Error(
          'This email is already registered with email & password. ' +
          'Sign in with email/password first, then connect Google in Settings → Google Sheets.'
        );
      }
      throw err;
    }
  };

  // For already-logged-in users: link Google to get Sheets access token without changing auth
  const connectGoogleSheets = async () => {
    const provider = new GoogleAuthProvider();
    provider.addScope('https://www.googleapis.com/auth/spreadsheets.readonly');
    try {
      const result = await linkWithPopup(auth.currentUser, provider);
      const cred = GoogleAuthProvider.credentialFromResult(result);
      if (cred?.accessToken) saveGoogleToken(cred.accessToken);
      return true;
    } catch (err) {
      if (err.code === 'auth/provider-already-linked' || err.code === 'auth/credential-already-in-use') {
        // Already linked — re-auth to get fresh token
        const result = await reauthenticateWithPopup(auth.currentUser, provider);
        const cred = GoogleAuthProvider.credentialFromResult(result);
        if (cred?.accessToken) saveGoogleToken(cred.accessToken);
        return true;
      }
      if (err.code === 'auth/popup-closed-by-user') return false;
      throw err;
    }
  };

  const signup = async (email, password, displayName) => {
    await setPersistence(auth, browserLocalPersistence);
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName });
    const isSuperAdmin = email === SUPER_ADMIN_EMAIL;
    await createUserProfile(cred.user.uid, {
      uid: cred.user.uid,
      email,
      displayName,
      role: isSuperAdmin ? 'superadmin' : 'user',
      assignedDepartments: [],
      isActive: true,
    });
    if (!isSuperAdmin) {
      createNotification({
        type: 'new_user',
        title: 'New User Signed Up',
        message: `${displayName} (${email}) has registered and is awaiting department access.`,
        recipientId: 'admins',
        triggeredBy: cred.user.uid,
        triggeredByName: displayName,
      }).catch(e => console.warn('Signup notification skipped:', e.message));
    }
    return cred;
  };

  const logout = () => signOut(auth);

  const refreshProfile = async () => {
    if (user) {
      const profile = await getUserProfile(user.uid);
      setUserProfile(profile);
    }
  };

  const isSuperAdmin = userProfile?.role === 'superadmin';
  const isAdmin = userProfile?.role === 'admin' || isSuperAdmin;

  return (
    <AuthContext.Provider value={{
      user, userProfile, loading,
      login, signup, logout, refreshProfile,
      loginWithGoogle, connectGoogleSheets,
      googleToken,
      isSuperAdmin, isAdmin,
    }}>
      {!loading && children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
