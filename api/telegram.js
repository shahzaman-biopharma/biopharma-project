// Telegram Webhook — no query params, token from env

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'biopharma-a07e0';
const WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const BOT_TOKEN = process.env.DVL_BOT_TOKEN; // hardcoded DVL bot token

const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// ─── Firestore helpers ────────────────────────────────────────────────────────

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
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) f[k] = toVal(v);
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

async function fsGet(path) {
  const r = await fetch(`${FS_BASE}/${path}?key=${WEB_API_KEY}`);
  if (!r.ok) return null;
  const doc = await r.json();
  return doc.fields ? fromFields(doc.fields) : null;
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
  const r = await fetch(`${FS_BASE}:runQuery?key=${WEB_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: collection }],
        where: { fieldFilter: { field: { fieldPath }, op: 'EQUAL', value: { stringValue: value } } },
        limit: 1,
      },
    }),
  });
  const results = await r.json();
  if (!Array.isArray(results) || !results[0]?.document) return null;
  const doc = results[0].document;
  return { id: doc.name.split('/').pop(), ...fromFields(doc.fields) };
}

// ─── App helpers ──────────────────────────────────────────────────────────────

async function getDept(token) { return fsQuery('departments', 'telegram.botToken', token); }
async function getSession(tid, deptId) { return fsGet(`telegramSessions/${tid}_${deptId}`); }
async function saveSession(tid, deptId, uid, email) {
  await fsSet(`telegramSessions/${tid}_${deptId}`, {
    telegramUserId: tid, departmentId: deptId,
    firebaseUid: uid, email, linkedAt: new Date().toISOString(), state: 'active',
  });
}
async function getPending(tid) { return fsGet(`telegramPending/${tid}`); }
async function setPending(tid, data) { await fsSet(`telegramPending/${tid}`, data); }
async function clearPending(tid) { await fsDelete(`telegramPending/${tid}`); }
async function getHistory(uid, deptId) {
  const doc = await fsGet(`chats/${uid}_${deptId}`);
  return (doc?.messages || []).slice(-20).filter(m => m.role !== 'system');
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

async function send(chatId, text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  });
}

// ─── GPT response ─────────────────────────────────────────────────────────────

async function gptReply(dept, history, userText) {
  let ctx = `Department: ${dept.name}\nDescription: ${dept.description || ''}\n`;
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

  const system = dept.systemPrompt
    ? `${dept.systemPrompt}\n\n--- DATA ---\n${ctx}`
    : `You are the AI assistant for ${dept.name}. Be professional and concise.\n\n${ctx}`;

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system },
        ...history.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: userText },
      ],
      temperature: 0.7,
      max_tokens: 1000,
    }),
  });
  const d = await r.json();
  return d.choices?.[0]?.message?.content || 'Sorry, jawab nahi mila.';
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // GET: health check
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true, status: 'BioPharma Telegram Bot is running' });
  }

  try {
    const update = req.body;
    console.log('Update received:', JSON.stringify(update).substring(0, 200));

    if (!update?.message) return res.status(200).json({ ok: true });

    const msg = update.message;
    const tid = String(msg.from.id);
    const chatId = msg.chat.id;
    const text = (msg.text || '').trim();

    console.log(`Message from ${tid}: "${text}"`);

    // Find department using BOT_TOKEN env var
    const dept = await getDept(BOT_TOKEN);
    console.log('Dept found:', dept ? dept.name : 'NOT FOUND');

    if (!dept) {
      await send(chatId, '❌ Department not configured. Contact admin.');
      return res.status(200).json({ ok: true });
    }

    // /start
    if (text === '/start') {
      const session = await getSession(tid, dept.id);
      if (session) {
        await send(chatId, `✅ *Already logged in!*\n\nWelcome back! Connected to *${dept.name}* bot.\nAsk me anything! Type /logout to disconnect.`);
      } else {
        await setPending(tid, { awaiting: 'email' });
        await send(chatId, `🤖 *Welcome to ${dept.name} Bot!*\n\nBioPharma CRA Platform ka AI assistant hun.\n\n📧 Apna *email address* enter karein:`);
      }
      return res.status(200).json({ ok: true });
    }

    // /logout
    if (text === '/logout') {
      await fsDelete(`telegramSessions/${tid}_${dept.id}`);
      await clearPending(tid);
      await send(chatId, '👋 Logout ho gaye. /start se dobara login karein.');
      return res.status(200).json({ ok: true });
    }

    // /help
    if (text === '/help') {
      await send(chatId, `*${dept.name} Bot*\n\n/start — Login\n/logout — Logout\n/help — Help\n\nLogin ke baad sawal karo!`);
      return res.status(200).json({ ok: true });
    }

    // Login flow
    const pending = await getPending(tid);

    if (pending?.awaiting === 'email') {
      await setPending(tid, { awaiting: 'password', email: text });
      await send(chatId, `🔑 Email mil gaya. Ab *password* enter karein:`);
      return res.status(200).json({ ok: true });
    }

    if (pending?.awaiting === 'password') {
      await send(chatId, '⏳ Verify ho raha hai...');
      try {
        const user = await verifyUser(pending.email, text);
        await saveSession(tid, dept.id, user.uid, user.email);
        await clearPending(tid);
        await send(chatId, `✅ *Login successful!*\n\nWelcome *${user.displayName || user.email}*!\n\n*${dept.name}* bot se connected hain. Chat web app mein bhi sync hogi.\n\nAb koi bhi sawal karo! 🚀`);
      } catch (e) {
        await setPending(tid, { awaiting: 'email' });
        await send(chatId, '❌ *Email ya password galat hai.*\n\n📧 Dobara *email* enter karein:');
      }
      return res.status(200).json({ ok: true });
    }

    // Regular message
    const session = await getSession(tid, dept.id);
    if (!session) {
      await setPending(tid, { awaiting: 'email' });
      await send(chatId, '🔐 Pehle login karein.\n\n📧 *Email* enter karein:');
      return res.status(200).json({ ok: true });
    }

    await send(chatId, '⏳ Analyze kar raha hun...');
    const history = await getHistory(session.firebaseUid, dept.id);
    const reply = await gptReply(dept, history, text);
    await saveHistory(session.firebaseUid, dept.id, [
      ...history,
      { role: 'user', content: text, timestamp: Date.now(), source: 'telegram' },
      { role: 'assistant', content: reply, timestamp: Date.now(), source: 'telegram' },
    ]);

    const chunks = reply.length <= 4000 ? [reply] : reply.match(/.{1,4000}/gs) || [reply];
    for (const c of chunks) await send(chatId, c);

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('Error:', err.message, err.stack);
    return res.status(200).json({ ok: true });
  }
}
