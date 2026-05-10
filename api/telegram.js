// Telegram Webhook — uses Firestore REST API (no firebase-admin / service account needed)

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'biopharma-a07e0';
const WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// ─── Firestore value converters ───────────────────────────────────────────────

function toVal(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toVal) } };
  if (typeof v === 'object') return { mapValue: { fields: toFields(v) } };
  return { stringValue: String(v) };
}

function toFields(obj) {
  const f = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) f[k] = toVal(v);
  }
  return f;
}

function fromVal(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return parseInt(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromVal);
  if ('mapValue' in v) return fromFields(v.mapValue.fields || {});
  return null;
}

function fromFields(fields) {
  const obj = {};
  for (const [k, v] of Object.entries(fields || {})) obj[k] = fromVal(v);
  return obj;
}

// ─── Firestore REST operations ────────────────────────────────────────────────

async function fsGet(path) {
  const r = await fetch(`${FS_BASE}/${path}?key=${WEB_API_KEY}`);
  if (!r.ok) return null;
  const doc = await r.json();
  return doc.fields ? { ...fromFields(doc.fields) } : null;
}

async function fsSet(path, data) {
  await fetch(`${FS_BASE}/${path}?key=${WEB_API_KEY}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFields(data) }),
  });
}

async function fsDelete(path) {
  await fetch(`${FS_BASE}/${path}?key=${WEB_API_KEY}`, { method: 'DELETE' });
}

async function fsQuery(collection, fieldPath, value) {
  const body = {
    structuredQuery: {
      from: [{ collectionId: collection }],
      where: { fieldFilter: { field: { fieldPath }, op: 'EQUAL', value: { stringValue: value } } },
      limit: 1,
    },
  };
  const r = await fetch(`${FS_BASE}:runQuery?key=${WEB_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const results = await r.json();
  if (!Array.isArray(results) || !results[0]?.document) return null;
  const doc = results[0].document;
  return { id: doc.name.split('/').pop(), ...fromFields(doc.fields) };
}

// ─── App helpers ──────────────────────────────────────────────────────────────

async function getDept(token) {
  return fsQuery('departments', 'telegram.botToken', token);
}

async function getSession(tid, deptId) {
  return fsGet(`telegramSessions/${tid}_${deptId}`);
}

async function saveSession(tid, deptId, uid, email) {
  await fsSet(`telegramSessions/${tid}_${deptId}`, {
    telegramUserId: tid, departmentId: deptId,
    firebaseUid: uid, email, linkedAt: new Date().toISOString(), state: 'active',
  });
}

async function getPending(tid) {
  return fsGet(`telegramPending/${tid}`);
}

async function setPending(tid, data) {
  await fsSet(`telegramPending/${tid}`, data);
}

async function clearPending(tid) {
  await fsDelete(`telegramPending/${tid}`);
}

async function getHistory(uid, deptId) {
  const doc = await fsGet(`chats/${uid}_${deptId}`);
  const msgs = doc?.messages || [];
  return msgs.slice(-20).filter(m => m.role !== 'system');
}

async function saveHistory(uid, deptId, messages) {
  await fsSet(`chats/${uid}_${deptId}`, {
    userId: uid, departmentId: deptId,
    messages, updatedAt: new Date().toISOString(),
  });
}

// ─── Firebase Auth verify ─────────────────────────────────────────────────────

async function verifyUser(email, password) {
  const r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${WEB_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  const d = await r.json();
  if (d.error) throw new Error(d.error.message);
  return { uid: d.localId, email: d.email, displayName: d.displayName };
}

// ─── Telegram send ────────────────────────────────────────────────────────────

async function send(token, chatId, text) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  });
}

// ─── Load department data sources ─────────────────────────────────────────────

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

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).json({ ok: true });

  const token = req.query.token;
  if (!token) return res.status(200).json({ ok: true });

  try {
    const update = req.body;
    if (!update?.message) return res.status(200).json({ ok: true });

    const msg = update.message;
    const tid = String(msg.from.id);
    const chatId = msg.chat.id;
    const text = (msg.text || '').trim();

    // Find department
    const dept = await getDept(token);
    if (!dept) {
      await send(token, chatId, '❌ Bot not configured. Contact admin.');
      return res.status(200).json({ ok: true });
    }

    // /start
    if (text === '/start') {
      const session = await getSession(tid, dept.id);
      if (session) {
        await send(token, chatId,
          `✅ *Already logged in!*\n\nWelcome back! Connected to *${dept.name}* bot.\n\nAsk me anything! Type /logout to disconnect.`
        );
      } else {
        await setPending(tid, { awaiting: 'email' });
        await send(token, chatId,
          `🤖 *Welcome to ${dept.name} Bot!*\n\nBioPharma CRA Platform ka AI assistant hun.\n\nLogin karein apne BioPharma account se.\n\n📧 Apna *email address* enter karein:`
        );
      }
      return res.status(200).json({ ok: true });
    }

    // /logout
    if (text === '/logout') {
      await fsDelete(`telegramSessions/${tid}_${dept.id}`);
      await clearPending(tid);
      await send(token, chatId, '👋 Logout ho gaye. /start se dobara login karein.');
      return res.status(200).json({ ok: true });
    }

    // /help
    if (text === '/help') {
      await send(token, chatId,
        `*${dept.name} Bot Commands*\n\n/start — Login\n/logout — Disconnect\n/help — Help\n\nLogin ke baad koi bhi sawal karo!`
      );
      return res.status(200).json({ ok: true });
    }

    // Login flow
    const pending = await getPending(tid);

    if (pending?.awaiting === 'email') {
      await setPending(tid, { awaiting: 'password', email: text });
      await send(token, chatId, `🔑 Email mil gaya. Ab *password* enter karein:`);
      return res.status(200).json({ ok: true });
    }

    if (pending?.awaiting === 'password') {
      await send(token, chatId, '⏳ Credentials verify ho rahe hain...');
      try {
        const user = await verifyUser(pending.email, text);
        await saveSession(tid, dept.id, user.uid, user.email);
        await clearPending(tid);
        await send(token, chatId,
          `✅ *Login successful!*\n\nWelcome *${user.displayName || user.email}*!\n\n*${dept.name}* bot se connected hain. Chat history BioPharma web app mein sync hogi.\n\nKoi bhi sawal karo! 🚀`
        );
      } catch {
        await setPending(tid, { awaiting: 'email' });
        await send(token, chatId,
          '❌ *Email ya password galat hai.*\n\n📧 Dobara *email* enter karein:'
        );
      }
      return res.status(200).json({ ok: true });
    }

    // Must be logged in for chat
    const session = await getSession(tid, dept.id);
    if (!session) {
      await setPending(tid, { awaiting: 'email' });
      await send(token, chatId, '🔐 Pehle login karein.\n\n📧 *Email* enter karein:');
      return res.status(200).json({ ok: true });
    }

    // GPT response
    await send(token, chatId, '⏳ Analyze kar raha hun...');

    const dataCtx = await loadData(dept);
    const history = await getHistory(session.firebaseUid, dept.id);

    const systemContent = dept.systemPrompt
      ? (dataCtx ? `${dept.systemPrompt}\n\n--- DATA ---\n${dataCtx}` : dept.systemPrompt)
      : `You are the AI assistant for ${dept.name} department. Be professional and concise.`;

    const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemContent },
          ...history.map(m => ({ role: m.role, content: m.content })),
          { role: 'user', content: text },
        ],
        temperature: 0.7,
        max_tokens: 1000,
      }),
    });

    const gptData = await gptRes.json();
    const reply = gptData.choices?.[0]?.message?.content || 'Sorry, koi jawab nahi mila.';

    // Save history
    const newHistory = [
      ...history,
      { role: 'user', content: text, timestamp: Date.now(), source: 'telegram' },
      { role: 'assistant', content: reply, timestamp: Date.now(), source: 'telegram' },
    ];
    await saveHistory(session.firebaseUid, dept.id, newHistory);

    // Send reply (split if >4000 chars)
    const chunks = reply.length <= 4000 ? [reply] : reply.match(/.{1,4000}/gs) || [reply];
    for (const chunk of chunks) await send(token, chatId, chunk);

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ ok: true });
  }
}
