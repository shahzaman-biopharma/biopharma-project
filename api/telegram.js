import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import OpenAI from 'openai';

// ─── Firebase Admin init ──────────────────────────────────────────────────────

let db;
function getDB() {
  if (!db) {
    if (!getApps().length) {
      initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
      });
    }
    db = getFirestore();
  }
  return db;
}

// ─── Telegram helper ──────────────────────────────────────────────────────────

async function sendMsg(token, chatId, text) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  });
}

// ─── Firebase helpers ─────────────────────────────────────────────────────────

async function getDeptByToken(token) {
  const snap = await getDB().collection('departments')
    .where('telegram.botToken', '==', token).limit(1).get();
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}

async function getSession(telegramId, deptId) {
  const snap = await getDB().collection('telegramSessions')
    .doc(`${telegramId}_${deptId}`).get();
  return snap.exists ? snap.data() : null;
}

async function saveSession(telegramId, deptId, uid, email) {
  await getDB().collection('telegramSessions')
    .doc(`${telegramId}_${deptId}`).set({
      telegramUserId: telegramId, departmentId: deptId,
      firebaseUid: uid, email,
      linkedAt: new Date().toISOString(), state: 'active',
    });
}

async function getChatHistory(uid, deptId) {
  const snap = await getDB().collection('chats').doc(`${uid}_${deptId}`).get();
  const msgs = snap.exists ? (snap.data().messages || []) : [];
  return msgs.slice(-20).filter(m => m.role !== 'system');
}

async function saveChat(uid, deptId, messages) {
  const ref = getDB().collection('chats').doc(`${uid}_${deptId}`);
  const snap = await ref.get();
  const payload = { userId: uid, departmentId: deptId, messages, updatedAt: new Date().toISOString() };
  if (snap.exists) {
    await ref.update(payload);
  } else {
    await ref.set({ ...payload, createdAt: new Date().toISOString() });
  }
}

// ─── Firebase Auth verify via REST ───────────────────────────────────────────

async function verifyUser(email, password) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.FIREBASE_WEB_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return { uid: data.localId, email: data.email, displayName: data.displayName };
}

// ─── Load data sources ────────────────────────────────────────────────────────

async function loadData(dept) {
  let ctx = `Department: ${dept.name}\nDescription: ${dept.description || ''}\n\n`;
  for (const src of dept.dataSources || []) {
    try {
      if (src.type === 'googlesheet' && src.url) {
        const m = src.url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
        if (m) {
          const r = await fetch(`https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv`);
          if (r.ok) ctx += `\n--- ${src.name} ---\n${(await r.text()).substring(0, 4000)}\n`;
        }
      } else if (src.type === 'text' && src.content) {
        ctx += `\n--- ${src.name} ---\n${src.content}\n`;
      }
    } catch { /* skip */ }
  }
  return ctx;
}

// ─── Pending login state ──────────────────────────────────────────────────────

// NOTE: Vercel serverless functions are stateless — using Firestore for pending state
async function getPending(telegramId) {
  const snap = await getDB().collection('telegramPending').doc(telegramId).get();
  return snap.exists ? snap.data() : null;
}
async function setPending(telegramId, data) {
  await getDB().collection('telegramPending').doc(telegramId).set(data);
}
async function clearPending(telegramId) {
  await getDB().collection('telegramPending').doc(telegramId).delete();
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // Always respond 200 immediately to Telegram
  res.status(200).json({ ok: true });

  if (req.method !== 'POST') return;

  try {
    const update = req.body;
    if (!update?.message) return;

    const msg = update.message;
    const telegramId = String(msg.from.id);
    const chatId = msg.chat.id;
    const text = msg.text?.trim() || '';
    const firstName = msg.from.first_name || 'User';
    const token = req.query.token;

    if (!token) return;

    const dept = await getDeptByToken(token);
    if (!dept) return;

    // /start
    if (text === '/start') {
      const session = await getSession(telegramId, dept.id);
      if (session) {
        await sendMsg(token, chatId, `✅ *Already logged in!*\n\nWelcome back! You're connected to *${dept.name}* bot.\n\nAsk me anything! Type /logout to disconnect.`);
      } else {
        await setPending(telegramId, { awaiting: 'email' });
        await sendMsg(token, chatId, `🤖 *Welcome to ${dept.name} Bot!*\n\nI'm the AI assistant for *${dept.name}* — BioPharma CRA Platform.\n\nPlease login with your BioPharma account.\n\n📧 Enter your *email address*:`);
      }
      return;
    }

    // /logout
    if (text === '/logout') {
      await getDB().collection('telegramSessions').doc(`${telegramId}_${dept.id}`).delete();
      await clearPending(telegramId);
      await sendMsg(token, chatId, '👋 Logged out. Type /start to login again.');
      return;
    }

    // /help
    if (text === '/help') {
      await sendMsg(token, chatId, `*${dept.name} Bot*\n\n/start — Login\n/logout — Disconnect\n/help — Help\n\nJust type any question!`);
      return;
    }

    // Login flow
    const pending = await getPending(telegramId);

    if (pending?.awaiting === 'email') {
      await setPending(telegramId, { awaiting: 'password', email: text });
      await sendMsg(token, chatId, `🔑 Got it. Now enter your *password*:`);
      return;
    }

    if (pending?.awaiting === 'password') {
      try {
        await sendMsg(token, chatId, '⏳ Verifying...');
        const user = await verifyUser(pending.email, text);
        await saveSession(telegramId, dept.id, user.uid, user.email);
        await clearPending(telegramId);
        await sendMsg(token, chatId,
          `✅ *Login successful!*\n\nWelcome *${user.displayName || user.email}*!\n\nYou're now connected to *${dept.name}*. Your chats sync with the BioPharma web app.\n\nAsk me anything! 🚀`
        );
      } catch {
        await setPending(telegramId, { awaiting: 'email' });
        await sendMsg(token, chatId, '❌ *Wrong credentials.* Try again.\n\nEnter your *email*:');
      }
      return;
    }

    // Regular message — must be logged in
    const session = await getSession(telegramId, dept.id);
    if (!session) {
      await setPending(telegramId, { awaiting: 'email' });
      await sendMsg(token, chatId, '🔐 Please login first.\n\nEnter your *email*:');
      return;
    }

    // GPT response
    await sendMsg(token, chatId, '⏳ Analyzing...');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const dataCtx = await loadData(dept);
    const history = await getChatHistory(session.firebaseUid, dept.id);

    const systemContent = dataCtx
      ? `${dept.systemPrompt}\n\n--- DATA CONTEXT ---\n${dataCtx}`
      : dept.systemPrompt || `You are the AI assistant for ${dept.name}. Be professional and concise.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemContent },
        ...history.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: text },
      ],
      temperature: 0.7,
      max_tokens: 1000,
    });

    const reply = completion.choices[0].message.content;

    // Save chat
    const userMsg = { role: 'user', content: text, timestamp: Date.now(), source: 'telegram' };
    const botMsg = { role: 'assistant', content: reply, timestamp: Date.now(), source: 'telegram' };
    await saveChat(session.firebaseUid, dept.id, [...history, userMsg, botMsg]);

    // Send (split if >4000 chars)
    for (const chunk of (reply.length <= 4000 ? [reply] : reply.match(/.{1,4000}/gs) || [reply])) {
      await sendMsg(token, chatId, chunk);
    }

  } catch (err) {
    console.error('Webhook error:', err);
  }
}
