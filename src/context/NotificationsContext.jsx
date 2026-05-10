import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { subscribeToNotifications, markNotificationRead, markAllNotificationsRead } from '../services/firestore';

const Ctx = createContext(null);

export function NotificationsProvider({ children }) {
  const { userProfile, isAdmin } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [toastQueue, setToastQueue]       = useState([]);
  const seenRef    = useRef(new Set());
  const readyRef   = useRef(false);

  useEffect(() => {
    if (!userProfile?.uid) {
      setNotifications([]);
      setToastQueue([]);
      readyRef.current = false;
      return;
    }

    const key = `nb_seen_${userProfile.uid}`;
    seenRef.current = new Set(JSON.parse(localStorage.getItem(key) || '[]'));
    readyRef.current = false;

    const unsub = subscribeToNotifications(userProfile.uid, isAdmin, (notifs) => {
      setNotifications(notifs);

      if (!readyRef.current) {
        // Initial snapshot — seed seen set so we don't toast on page load/refresh
        notifs.forEach(n => seenRef.current.add(n.id));
        localStorage.setItem(key, JSON.stringify([...seenRef.current]));
        readyRef.current = true;
        return;
      }

      // Real-time update — only toast truly new arrivals
      const fresh = notifs.filter(n => !seenRef.current.has(n.id));
      if (fresh.length) {
        fresh.forEach(n => seenRef.current.add(n.id));
        localStorage.setItem(key, JSON.stringify([...seenRef.current]));
        setToastQueue(q => [...q, ...fresh]);
      }
    });

    return () => { unsub(); readyRef.current = false; };
  }, [userProfile?.uid, isAdmin]);

  const isUnread = (n) => {
    if (!userProfile) return false;
    return n.recipientId === 'admins'
      ? !(n.readBy || []).includes(userProfile.uid)
      : !n.read;
  };

  const unreadCount   = notifications.filter(isUnread).length;
  const dismissToast  = (id) => setToastQueue(q => q.filter(n => n.id !== id));
  const markRead      = (id) => markNotificationRead(id, userProfile.uid).catch(console.error);
  const markAllRead   = () => markAllNotificationsRead(userProfile.uid, isAdmin).catch(console.error);

  return (
    <Ctx.Provider value={{ notifications, toastQueue, dismissToast, unreadCount, isUnread, markRead, markAllRead }}>
      {children}
    </Ctx.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useNotifications must be used within NotificationsProvider');
  return ctx;
}
