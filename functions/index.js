const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');
const OpenAI = require('openai');
const fetch = require('node-fetch');

// Load .env for local dev (production uses Firebase env automatically)
try { require('dotenv').config(); } catch {}

admin.initializeApp();
const db = admin.firestore();

// ─── Telegram API helper ──────────────────────────────────────────────────────

async function sendTelegramMessage(botToken, chatId, text, options = {}) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      ...options,
    }),
  });
}

// ─── Find department by bot token ─────────────────────────────────────────────

async function getDepartmentByToken(botToken) {
  const snap = await db.collection('departments')
    .where('telegram.botToken', '==', botToken)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

// ─── Get/create Telegram session ─────────────────────────────────────────────

async function getTelegramSession(telegramUserId, departmentId) {
  const sessionId = `${telegramUserId}_${departmentId}`;
  const snap = await db.collection('telegramSessions').doc(sessionId).get();
  return snap.exists ? snap.data() : null;
}

async function saveTelegramSession(telegramUserId, departmentId, firebaseUid, email) {
  const sessionId = `${telegramUserId}_${departmentId}`;
  await db.collection('telegramSessions').doc(sessionId).set({
    telegramUserId,
    departmentId,
    firebaseUid,
    email,
    linkedAt: admin.firestore.FieldValue.serverTimestamp(),
    state: 'active',
  });
}

// ─── Firebase Auth verification via REST ─────────────────────────────────────

async function verifyFirebaseUser(email, password, apiKey) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
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

// ─── Load data sources for department ────────────────────────────────────────

async function loadDataContext(department) {
  let ctx = `Department: ${department.name}\nDescription: ${department.description || ''}\n\n`;
  for (const src of department.dataSources || []) {
    try {
      if (src.type === 'googlesheet' && src.url) {
        const match = src.url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
        if (match) {
          const csvUrl = `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv`;
          const res = await fetch(csvUrl);
          if (res.ok) {
            const text = await res.text();
            ctx += `\n--- ${src.name} ---\n${text.substring(0, 4000)}\n`;
          }
        }
      } else if (src.type === 'text' && src.content) {
        ctx += `\n--- ${src.name} ---\n${src.content}\n`;
      }
    } catch { /* skip failed source */ }
  }
  return ctx;
}

// ─── Get chat history for user+dept ──────────────────────────────────────────

async function getChatHistory(firebaseUid, departmentId) {
  const snap = await db.collection('chats').doc(`${firebaseUid}_${departmentId}`).get();
  if (!snap.exists) return [];
  const msgs = snap.data().messages || [];
  // Return last 20 messages for context window
  return msgs.slice(-20).filter(m => m.role !== 'system');
}

async function saveChatHistory(firebaseUid, departmentId, messages) {
  const ref = db.collection('chats').doc(`${firebaseUid}_${departmentId}`);
  const snap = await ref.get();
  if (snap.exists) {
    await ref.update({ messages, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  } else {
    await ref.set({
      userId: firebaseUid,
      departmentId,
      messages,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
}

// ─── Pending login state (for 2-step login) ───────────────────────────────────

const pendingLogins = new Map(); // telegramUserId -> { email, awaiting: 'email'|'password' }

// ─── Main Telegram Webhook ────────────────────────────────────────────────────

exports.telegramWebhook = onRequest(
  { region: 'us-central1', timeoutSeconds: 60 },
  async (req, res) => {
    res.status(200).send('OK'); // Always respond immediately to Telegram

    try {
      const update = req.body;
      if (!update?.message) return;

      const msg = update.message;
      const telegramUserId = String(msg.from.id);
      const chatId = msg.chat.id;
      const text = msg.text?.trim() || '';
      const firstName = msg.from.first_name || 'User';

      // Identify which department/bot this webhook is for
      // The bot token is passed as a query param when setting up the webhook
      const botToken = req.query.token;
      if (!botToken) return;

      const department = await getDepartmentByToken(botToken);
      if (!department) return;

      const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
      const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

      // ── /start command ────────────────────────────────────────────────────
      if (text === '/start') {
        const session = await getTelegramSession(telegramUserId, department.id);
        if (session) {
          await sendTelegramMessage(botToken, chatId,
            `✅ *Already logged in!*\n\nWelcome back! You are connected to *${department.name}* bot.\n\nAsk me anything about ${department.name} data.\n\nType /logout to disconnect.`
          );
        } else {
          pendingLogins.set(telegramUserId, { awaiting: 'email' });
          await sendTelegramMessage(botToken, chatId,
            `🤖 *Welcome to ${department.name} Bot!*\n\nThis is an AI assistant for *${department.name}* department of BioPharma CRA Platform.\n\nTo continue, please login with your BioPharma account.\n\n📧 Please enter your *email address*:`
          );
        }
        return;
      }

      // ── /logout command ───────────────────────────────────────────────────
      if (text === '/logout') {
        const sessionId = `${telegramUserId}_${department.id}`;
        await db.collection('telegramSessions').doc(sessionId).delete();
        pendingLogins.delete(telegramUserId);
        await sendTelegramMessage(botToken, chatId, '👋 Logged out successfully. Type /start to login again.');
        return;
      }

      // ── /help command ─────────────────────────────────────────────────────
      if (text === '/help') {
        await sendTelegramMessage(botToken, chatId,
          `*${department.name} Bot Commands*\n\n/start - Login to your account\n/logout - Disconnect account\n/help - Show this help\n\nJust type any question to ask the ${department.name} AI assistant!`
        );
        return;
      }

      // ── Login flow ────────────────────────────────────────────────────────
      const pending = pendingLogins.get(telegramUserId);

      if (pending?.awaiting === 'email') {
        pendingLogins.set(telegramUserId, { awaiting: 'password', email: text });
        await sendTelegramMessage(botToken, chatId, `🔑 Email received. Now enter your *password*:`);
        return;
      }

      if (pending?.awaiting === 'password') {
        try {
          await sendTelegramMessage(botToken, chatId, '⏳ Verifying your credentials...');
          const firebaseUser = await verifyFirebaseUser(pending.email, text, FIREBASE_API_KEY);
          await saveTelegramSession(telegramUserId, department.id, firebaseUser.uid, firebaseUser.email);
          pendingLogins.delete(telegramUserId);
          await sendTelegramMessage(botToken, chatId,
            `✅ *Login successful!*\n\nWelcome, *${firebaseUser.displayName || firebaseUser.email}*!\n\nYou are now connected to *${department.name}* bot. Your chat history will sync with the BioPharma web app.\n\nAsk me anything! 🚀`
          );
        } catch {
          pendingLogins.set(telegramUserId, { awaiting: 'email' });
          await sendTelegramMessage(botToken, chatId,
            '❌ *Invalid credentials.*\n\nPlease try again. Enter your *email address*:'
          );
        }
        return;
      }

      // ── Regular message — need to be logged in ────────────────────────────
      const session = await getTelegramSession(telegramUserId, department.id);
      if (!session) {
        pendingLogins.set(telegramUserId, { awaiting: 'email' });
        await sendTelegramMessage(botToken, chatId,
          '🔐 Please login first.\n\nEnter your *email address*:'
        );
        return;
      }

      // ── GPT Response ──────────────────────────────────────────────────────
      await sendTelegramMessage(botToken, chatId, '⏳ Analyzing...');

      const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
      const dataContext = await loadDataContext(department);
      const history = await getChatHistory(session.firebaseUid, department.id);

      const systemContent = dataContext
        ? `${department.systemPrompt}\n\n--- DATA CONTEXT ---\n${dataContext}`
        : department.systemPrompt || `You are the AI assistant for ${department.name}. Be professional and concise.`;

      const apiMessages = [
        ...history.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: text },
      ];

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemContent },
          ...apiMessages,
        ],
        temperature: 0.7,
        max_tokens: 1000,
      });

      const reply = completion.choices[0].message.content;

      // Save to Firestore (user's chat history)
      const userMsg = { role: 'user', content: text, timestamp: Date.now(), source: 'telegram' };
      const botMsg = { role: 'assistant', content: reply, timestamp: Date.now(), source: 'telegram' };
      const updatedHistory = [...history, userMsg, botMsg];
      await saveChatHistory(session.firebaseUid, department.id, updatedHistory);

      // Send reply (split if too long for Telegram's 4096 char limit)
      if (reply.length <= 4000) {
        await sendTelegramMessage(botToken, chatId, reply);
      } else {
        const chunks = reply.match(/.{1,4000}/gs) || [reply];
        for (const chunk of chunks) {
          await sendTelegramMessage(botToken, chatId, chunk);
        }
      }

    } catch (err) {
      console.error('Telegram webhook error:', err);
    }
  }
);

// ─── Auto Weekly Report Generator ────────────────────────────────────────────

exports.weeklyReports = onSchedule(
  { schedule: 'every monday 09:00', timeZone: 'Asia/Karachi', region: 'us-central1' },
  async () => {
    await generateAutoReports('weekly');
  }
);

// ─── Auto Monthly Report Generator ───────────────────────────────────────────

exports.monthlyReports = onSchedule(
  { schedule: '1 of month 09:00', timeZone: 'Asia/Karachi', region: 'us-central1' },
  async () => {
    await generateAutoReports('monthly');
  }
);

async function generateAutoReports(type) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

  const deptSnap = await db.collection('departments').get();
  for (const deptDoc of deptSnap.docs) {
    const dept = { id: deptDoc.id, ...deptDoc.data() };
    try {
      const dataContext = await loadDataContext(dept);

      const prompt = `You are a professional report generator for ${dept.name} department in a CRA biopharma company.
Generate a detailed ${type} report based on the following data:

${dataContext}

Department System Context:
${dept.systemPrompt || ''}

Create a comprehensive, professional ${type} report with:
1. Executive Summary
2. Key Metrics & Performance Indicators
3. Data Analysis & Trends
4. Issues & Findings
5. Recommendations
6. Next Steps

Format clearly with sections and bullet points. Be specific with data.`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.5,
        max_tokens: 2500,
      });

      await db.collection('reports').add({
        departmentId: dept.id,
        departmentName: dept.name,
        type,
        content: completion.choices[0].message.content,
        generatedBy: 'auto-scheduler',
        generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(`${type} report generated for ${dept.name}`);
    } catch (err) {
      console.error(`Failed report for ${dept.name}:`, err.message);
    }
  }
}
