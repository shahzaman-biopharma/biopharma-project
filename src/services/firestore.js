import {
  collection, doc, setDoc, getDoc, getDocs, addDoc,
  updateDoc, deleteDoc, query, where, orderBy, limit,
  serverTimestamp, onSnapshot, writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';

// ─── Users ───────────────────────────────────────────────────────────────────

export async function createUserProfile(uid, data) {
  await setDoc(doc(db, 'users', uid), {
    ...data,
    createdAt: serverTimestamp(),
  });
}

export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function getAllUsers() {
  const snap = await getDocs(collection(db, 'users'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function updateUserProfile(uid, data) {
  await updateDoc(doc(db, 'users', uid), data);
}

export async function deleteUser(uid) {
  await deleteDoc(doc(db, 'users', uid));
}

// ─── Departments ──────────────────────────────────────────────────────────────

export async function createDepartment(data) {
  return await addDoc(collection(db, 'departments'), {
    ...data,
    createdAt: serverTimestamp(),
  });
}

export async function getDepartment(id) {
  const snap = await getDoc(doc(db, 'departments', id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function getAllDepartments() {
  const snap = await getDocs(query(collection(db, 'departments'), orderBy('createdAt', 'asc')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function updateDepartment(id, data) {
  await updateDoc(doc(db, 'departments', id), data);
}

export async function deleteDepartment(id) {
  await deleteDoc(doc(db, 'departments', id));
}

export function subscribeToDepartments(callback) {
  return onSnapshot(
    query(collection(db, 'departments'), orderBy('createdAt', 'asc')),
    snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  );
}

// ─── Chats ────────────────────────────────────────────────────────────────────

export async function saveChatMessage(userId, departmentId, messages) {
  const chatRef = doc(db, 'chats', `${userId}_${departmentId}`);
  const snap = await getDoc(chatRef);
  if (snap.exists()) {
    await updateDoc(chatRef, { messages, updatedAt: serverTimestamp() });
  } else {
    await setDoc(chatRef, {
      userId,
      departmentId,
      messages,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
}

export async function getChatHistory(userId, departmentId) {
  const snap = await getDoc(doc(db, 'chats', `${userId}_${departmentId}`));
  return snap.exists() ? snap.data().messages || [] : [];
}

export function subscribeToChat(userId, departmentId, callback) {
  return onSnapshot(
    doc(db, 'chats', `${userId}_${departmentId}`),
    snap => callback(snap.exists() ? snap.data().messages || [] : [])
  );
}

// ─── Reports ──────────────────────────────────────────────────────────────────

export async function saveReport(data) {
  return await addDoc(collection(db, 'reports'), {
    ...data,
    generatedAt: serverTimestamp(),
  });
}

export async function deliverReportToBot(departmentId, departmentName, content, type, period) {
  try {
    const botUrl = import.meta.env.VITE_BOT_API_URL || 'https://biopharma-project.onrender.com';
    await fetch(`${botUrl}/deliver-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ departmentId, departmentName, content, type, period }),
    });
  } catch (e) {
    console.warn('Bot delivery skipped:', e.message);
  }
}

export async function getReports(departmentId) {
  const q = query(
    collection(db, 'reports'),
    where('departmentId', '==', departmentId),
    orderBy('generatedAt', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getAllReports() {
  const snap = await getDocs(query(collection(db, 'reports'), orderBy('generatedAt', 'desc')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export function subscribeToReports(callback) {
  return onSnapshot(
    query(collection(db, 'reports'), orderBy('generatedAt', 'desc'), limit(50)),
    snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  );
}

// ─── Report Settings ──────────────────────────────────────────────────────────

export async function getReportSettings() {
  const snap = await getDoc(doc(db, 'settings', 'reports'));
  return snap.exists() ? snap.data() : {
    enabled: false,
    timezone: 'Asia/Karachi',
    weeklyDay: 1,
    weeklyHour: 8,
    monthlyDay: 1,
    monthlyHour: 8,
    lastWeeklyGen: null,
    lastMonthlyGen: null,
    departmentAccess: {},
  };
}

export async function saveReportSettings(data) {
  await setDoc(doc(db, 'settings', 'reports'), data, { merge: true });
}

// ─── Notifications ────────────────────────────────────────────────────────────
// recipientId: userId for personal | 'admins' for broadcast to all admins/superadmins

export async function createNotification({ type, title, message, recipientId, triggeredBy, triggeredByName, departmentId, departmentName }) {
  return await addDoc(collection(db, 'notifications'), {
    type,
    title,
    message,
    recipientId,
    read: false,
    readBy: [],
    triggeredBy: triggeredBy || null,
    triggeredByName: triggeredByName || null,
    departmentId: departmentId || null,
    departmentName: departmentName || null,
    createdAt: serverTimestamp(),
  });
}

export function subscribeToNotifications(userId, isAdmin, callback) {
  const recipientIds = isAdmin ? [userId, 'admins'] : [userId];
  // No orderBy — avoids composite index requirement; sort client-side instead
  const q = query(
    collection(db, 'notifications'),
    where('recipientId', 'in', recipientIds)
  );
  return onSnapshot(
    q,
    snap => {
      const docs = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
          const ta = a.createdAt?.toMillis?.() ?? 0;
          const tb = b.createdAt?.toMillis?.() ?? 0;
          return tb - ta;
        })
        .slice(0, 50);
      callback(docs);
    },
    err => console.error('[Notifications] subscription failed:', err.code, err.message)
  );
}

export async function markNotificationRead(notifId, userId) {
  const ref = doc(db, 'notifications', notifId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const data = snap.data();
  if (data.recipientId === 'admins') {
    const readBy = data.readBy || [];
    if (!readBy.includes(userId)) await updateDoc(ref, { readBy: [...readBy, userId] });
  } else {
    await updateDoc(ref, { read: true });
  }
}

export async function markAllNotificationsRead(userId, isAdmin) {
  const recipientIds = isAdmin ? [userId, 'admins'] : [userId];
  const q = query(
    collection(db, 'notifications'),
    where('recipientId', 'in', recipientIds)
  );
  const snap = await getDocs(q);
  const batch = writeBatch(db);
  snap.docs.forEach(d => {
    const data = d.data();
    if (data.recipientId === 'admins') {
      const readBy = data.readBy || [];
      if (!readBy.includes(userId)) batch.update(d.ref, { readBy: [...readBy, userId] });
    } else if (!data.read) {
      batch.update(d.ref, { read: true });
    }
  });
  await batch.commit();
}
