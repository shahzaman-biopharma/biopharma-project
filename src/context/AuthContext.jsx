import { createContext, useContext, useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  setPersistence,
  browserLocalPersistence,
} from 'firebase/auth';
import { auth } from '../services/firebase';
import { createUserProfile, getUserProfile } from '../services/firestore';

const AuthContext = createContext(null);

const SUPER_ADMIN_EMAIL = import.meta.env.VITE_SUPER_ADMIN_EMAIL || 'shahzaman.biopharma@gmail.com';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(true);

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
