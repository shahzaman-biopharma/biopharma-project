'use strict';

const { Telegraf, session } = require('telegraf');
const express = require('express');

// ─── Config ───────────────────────────────────────────────────────────────────
const WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY;
const PROJECT_ID  = process.env.FIREBASE_PROJECT_ID || 'biopharma-a07e0';
const OPENAI_KEY  = process.env.OPENAI_API_KEY;
const PORT        = process.env.PORT || 3000;

if (!WEB_API_KEY) { console.error('❌ FIREBASE_WEB_API_KEY missing'); process.exit(1); }
if (!OPENAI_KEY)  { console.error('❌ OPENAI_API_KEY missing'); process.exit(1); }

const FS  = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const KEY = `?key=${WEB_API_KEY}`;

// Active bots: deptId → { bot, token }
const activeBots = new Map();

// ═══════════════════════════════════════════════════════════
//  Firestore REST helpers
// ═══════════════════════════════════════════════════════════

function toVal(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean')  return { booleanValue: v };
  if (typeof v === 'number')   return { doubleValue: v };
  if (typeof v === 'string')   return { stringValue: v };
  if (Array.isArray(v))        return { arrayValue: { values: v.map(toVal) } };
  if (typeof v === 'object')   return { mapValue: { fields: toFields(v) } };
  return { stringValue: String(v) };
}
function toFields(obj) {
  const f = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) f[k] = toVal(v);
  return f;
}
function fromVal(v) {
  if (!v) return null;
  if ('stringValue'  in v) return v.stringValue;
  if ('integerValue' in v) return parseInt(v.integerValue);
  if ('doubleValue'  in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue'    in v) return null;
  if ('arrayValue'   in v) return (v.arrayValue.values || []).map(fromVal);
  if ('mapValue'     in v) return fromFields(v.mapValue.fields || {});
  return null;
}
function fromFields(fields) {
  const obj = {};
  for (const [k, v] of Object.entries(fields || {})) obj[k] = fromVal(v);
  return obj;
}

async function fsGet(path) {
  try {
    const r = await fetch(`${FS}/${path}${KEY}`);
    if (!r.ok) return null;
    const doc = await r.json();
    return doc.fields ? fromFields(doc.fields) : null;
  } catch { return null; }
}
async function fsPatch(path, data) {
  await fetch(`${FS}/${path}${KEY}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFields(data) }),
  });
}
async function fsDelete(path) {
  await fetch(`${FS}/${path}${KEY}`, { method: 'DELETE' });
}
async function fsCollection(col) {
  try {
    const r = await fetch(`${FS}/${col}${KEY}`);
    if (!r.ok) return [];
    const d = await r.json();
    return (d.documents || []).map(doc => ({
      id: doc.name.split('/').pop(),
      ...fromFields(doc.fields),
    }));
  } catch { return []; }
}

// ═══════════════════════════════════════════════════════════
//  Firebase Auth
// ═══════════════════════════════════════════════════════════

async function signIn(email, password) {
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

// ═══════════════════════════════════════════════════════════
//  Data helpers
// ═══════════════════════════════════════════════════════════

const getDepartments  = ()          => fsCollection('departments');
const getUserProfile  = (uid)       => fsGet(`users/${uid}`);
const getTgSession    = (tid, deptId) => fsGet(`telegramSessions/${tid}_${deptId}`);
const saveTgSession   = (tid, deptId, data) => fsPatch(`telegramSessions/${tid}_${deptId}`, data);
const deleteTgSession = (tid, deptId) => fsDelete(`telegramSessions/${tid}_${deptId}`);

async function getChatHistory(uid, deptId) {
  const doc = await fsGet(`chats/${uid}_${deptId}`);
  return (doc?.messages || []).slice(-20).filter(m => m.role !== 'system');
}
async function saveChatHistory(uid, deptId, messages) {
  await fsPatch(`chats/${uid}_${deptId}`, {
    userId: uid, departmentId: deptId,
    messages, updatedAt: new Date().toISOString(),
  });
}

// ═══════════════════════════════════════════════════════════
//  OpenAI — Telegram-optimized formatting
// ═══════════════════════════════════════════════════════════

const TELEGRAM_FORMAT = `

TELEGRAM FORMATTING RULES (always follow these):

1. NEVER use markdown tables (| col | col | format is BANNED)
2. Present data as bullet cards:

<b>📋 Record / Site Name</b>
• Field 1: Value
• Field 2: Value
• Status: ✅ Verified
─────────────────

3. Section headings: <b>🔹 Heading</b>
4. Bold: <b>important numbers and terms</b>
5. Status emojis: ✅ complete/verified  ❌ failed/missing  ⚠️ pending/review
6. If many records, show top 5-7 then give a summary
7. Format for mobile screen — short and clear
8. Always respond in English
`;

async function gptReply(dept, history, userText) {
  let ctx = `Department: ${dept.name}\nDescription: ${dept.description || ''}\n`;

  for (const src of dept.dataSources || []) {
    try {
      if (src.type === 'googlesheet' && src.url) {
        const m = src.url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
        if (m) {
          const r = await fetch(
            `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv`
          );
          if (r.ok) ctx += `\n--- ${src.name} ---\n${(await r.text()).substring(0, 4000)}\n`;
        }
      } else if (src.type === 'text' && src.content) {
        ctx += `\n--- ${src.name} ---\n${src.content}\n`;
      }
    } catch { /* skip */ }
  }

  const systemPrompt = dept.systemPrompt
    ? `${dept.systemPrompt}\n\n--- DATA ---\n${ctx}${TELEGRAM_FORMAT}`
    : `You are the AI assistant for the ${dept.name} department. Give professional and concise answers in English.\n\n--- DATA ---\n${ctx}${TELEGRAM_FORMAT}`;

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        ...history.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: userText },
      ],
      temperature: 0.7,
      max_tokens: 1200,
    }),
  });
  const d = await r.json();
  return d.choices?.[0]?.message?.content || 'Maafi chahta hun, jawab nahi mila.';
}

// ═══════════════════════════════════════════════════════════
//  Send helper — HTML mode with plain-text fallback
// ═══════════════════════════════════════════════════════════

async function safeSend(ctx, text) {
  const chunks = text.length <= 4000
    ? [text]
    : (text.match(/[\s\S]{1,4000}/g) || [text]);
  for (const chunk of chunks) {
    try {
      await ctx.reply(chunk, { parse_mode: 'HTML' });
    } catch {
      await ctx.reply(chunk.replace(/<[^>]*>/g, ''));
    }
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ═══════════════════════════════════════════════════════════
//  Bot handlers — one setup per department instance
// ═══════════════════════════════════════════════════════════

function setupHandlers(bot, dept) {

  // /start
  bot.command('start', async (ctx) => {
    const tid = String(ctx.from.id);
    ctx.session = {};

    const sess = await getTgSession(tid, dept.id);
    if (sess?.uid) {
      return ctx.reply(
        `✅ <b>Welcome back, ${sess.displayName || sess.email}!</b>\n\n` +
        `🏢 Connected to <b>${dept.name}</b> bot.\n\nAsk me anything!`,
        { parse_mode: 'HTML' }
      );
    }

    ctx.session.step = 'email';
    await ctx.reply(
      `🤖 <b>${dept.name} Bot</b>\n\nWelcome to BioPharma CRA Platform!\n\n` +
      `📧 Please enter your <b>email</b>:`,
      { parse_mode: 'HTML' }
    );
  });

  // /logout
  bot.command('logout', async (ctx) => {
    const tid = String(ctx.from.id);
    ctx.session = {};
    await deleteTgSession(tid, dept.id);
    await ctx.reply('👋 <b>Logged out.</b>\n\nUse /start to login again.', {
      parse_mode: 'HTML',
    });
  });

  // /help
  bot.command('help', async (ctx) => {
    await ctx.reply(
      `<b>${dept.name} Bot</b>\n\n` +
      `/start  — Login\n/logout — Logout\n/help   — Help\n\n` +
      `After login, ask me anything!`,
      { parse_mode: 'HTML' }
    );
  });

  // Text messages
  bot.on('text', async (ctx) => {
    const tid  = String(ctx.from.id);
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return;

    // ─ Email step
    if (ctx.session?.step === 'email') {
      if (!text.includes('@')) {
        return ctx.reply('❌ Please enter a valid email address.\n\n📧 <b>Email:</b>', { parse_mode: 'HTML' });
      }
      ctx.session.email = text.toLowerCase().trim();
      ctx.session.step  = 'password';
      return ctx.reply('🔑 Enter your <b>password</b>:', { parse_mode: 'HTML' });
    }

    // ─ Password step
    if (ctx.session?.step === 'password') {
      await ctx.reply('⏳ Verifying...');
      try {
        const authUser = await signIn(ctx.session.email, text);
        const profile  = await getUserProfile(authUser.uid);
        const role     = profile?.role || 'user';
        const name     = authUser.displayName || profile?.displayName || authUser.email.split('@')[0];

        // Access check — admins and superadmins always have access
        const hasAccess =
          role === 'admin' || role === 'superadmin' ||
          (profile?.assignedDepartments || []).includes(dept.id);

        if (!hasAccess) {
          ctx.session = {};
          return ctx.reply(
            `❌ <b>Access Denied.</b>\n\nYou are not authorized for the <b>${dept.name}</b> department.\nPlease contact your admin.`,
            { parse_mode: 'HTML' }
          );
        }

        await saveTgSession(tid, dept.id, {
          uid: authUser.uid, email: authUser.email,
          displayName: name, role,
          linkedAt: new Date().toISOString(),
        });
        ctx.session = {};

        const adminBadge = (role === 'admin' || role === 'superadmin')
          ? `\n🛡 Role: <b>${role}</b>` : '';

        return ctx.reply(
          `✅ <b>Login Successful!</b>\n\nWelcome <b>${name}!</b> 🎉${adminBadge}\n\n` +
          `🏢 Connected to <b>${dept.name}</b> bot!\n\nAsk me anything! 🚀`,
          { parse_mode: 'HTML' }
        );

      } catch (err) {
        ctx.session.step  = 'email';
        ctx.session.email = undefined;
        const errMsg =
          err.message?.includes('INVALID') || err.message?.includes('EMAIL_NOT_FOUND')
            ? '❌ <b>Invalid email or password.</b>'
            : '❌ Login failed. Please try again.';
        return ctx.reply(`${errMsg}\n\n📧 Enter your <b>email</b>:`, { parse_mode: 'HTML' });
      }
    }

    // ─ Chat
    const sess = await getTgSession(tid, dept.id);
    if (!sess?.uid) {
      ctx.session = { step: 'email' };
      return ctx.reply('🔐 Please login first.\n\n📧 Enter your <b>email</b>:', { parse_mode: 'HTML' });
    }

    await ctx.replyWithChatAction('typing');

    try {
      const history = await getChatHistory(sess.uid, dept.id);
      const reply   = await gptReply(dept, history, text);

      await saveChatHistory(sess.uid, dept.id, [
        ...history,
        { role: 'user',      content: text,  timestamp: Date.now(), source: 'telegram' },
        { role: 'assistant', content: reply, timestamp: Date.now(), source: 'telegram' },
      ]);

      await safeSend(ctx, reply);

    } catch (err) {
      console.error(`[${dept.name}] chat error:`, err.message);
      await ctx.reply('❌ Could not get a response. Please try again later.');
    }
  });
}

// ═══════════════════════════════════════════════════════════
//  Launch one department bot (with retry on 409)
// ═══════════════════════════════════════════════════════════

async function launchDeptBot(dept) {
  const token = dept.telegramBotToken;
  if (!token) return;

  // Skip if already running with same token
  const existing = activeBots.get(dept.id);
  if (existing?.token === token) return;

  // Stop old bot if token changed
  if (existing) {
    try { existing.bot.stop('token-changed'); } catch {}
    activeBots.delete(dept.id);
    await sleep(2000);
  }

  const bot = new Telegraf(token);
  bot.use(session());
  setupHandlers(bot, dept);

  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      await bot.telegram.deleteWebhook({ drop_pending_updates: true });
      await bot.launch({
        allowedUpdates: ['message', 'callback_query'],
        dropPendingUpdates: true,
      });
      console.log(`✅ [${dept.name}] bot live`);
      activeBots.set(dept.id, { bot, token });
      return;
    } catch (err) {
      console.error(`⚠️ [${dept.name}] attempt ${attempt}/4: ${err.message}`);
      if (err.message.includes('409') && attempt < 4) {
        console.log(`⏳ [${dept.name}] waiting 35s for old connection to expire...`);
        await sleep(35000);
      } else if (attempt === 4) {
        console.error(`❌ [${dept.name}] failed to launch`);
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════
//  Refresh — detect new / changed tokens every 5 minutes
// ═══════════════════════════════════════════════════════════

async function refreshBots() {
  const depts = await getDepartments();
  const withToken = depts.filter(d => d.telegramBotToken);
  console.log(`🔄 Refresh: ${withToken.length} department(s) with token`);
  for (const dept of withToken) {
    await launchDeptBot(dept);
  }
}

// ═══════════════════════════════════════════════════════════
//  Express health check
// ═══════════════════════════════════════════════════════════

const app = express();
app.get('/', (_, res) =>
  res.send(`🤖 BioPharma Multi-Dept Bot — ${activeBots.size} bot(s) running`)
);
app.get('/health', (_, res) =>
  res.json({
    ok: true,
    bots: activeBots.size,
    departments: [...activeBots.keys()],
    uptime: process.uptime(),
  })
);
app.listen(PORT, () => console.log(`✅ Health server on port ${PORT}`));

// ═══════════════════════════════════════════════════════════
//  Main
// ═══════════════════════════════════════════════════════════

async function main() {
  console.log('🤖 BioPharma Multi-Department Bot Manager starting...');
  // Wait for old Render instance to fully stop before connecting (avoids 409)
  console.log('⏳ Waiting 25s for old instance to stop...');
  await sleep(25000);
  await refreshBots();

  // Auto-detect new department tokens every 5 minutes
  setInterval(refreshBots, 5 * 60 * 1000);

  process.once('SIGINT',  () => { for (const { bot } of activeBots.values()) bot.stop('SIGINT');  });
  process.once('SIGTERM', () => { for (const { bot } of activeBots.values()) bot.stop('SIGTERM'); });
}

main().catch(err => { console.error('❌ Startup failed:', err.message); process.exit(1); });
