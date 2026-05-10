'use strict';

const { Telegraf } = require('telegraf');
const express = require('express');

// ─── Config ──────────────────────────────────────────────────────────────────
const WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY;
const PROJECT_ID  = process.env.FIREBASE_PROJECT_ID || 'biopharma-a07e0';
const OPENAI_KEY  = process.env.OPENAI_API_KEY;
const BOT_TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const PORT        = process.env.PORT || 3000;

if (!WEB_API_KEY) { console.error('❌ FIREBASE_WEB_API_KEY missing'); process.exit(1); }
if (!OPENAI_KEY)  { console.error('❌ OPENAI_API_KEY missing');       process.exit(1); }
if (!BOT_TOKEN)   { console.error('❌ TELEGRAM_BOT_TOKEN missing');   process.exit(1); }

const FS  = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const KEY = `?key=${WEB_API_KEY}`;

// ─── Firestore REST helpers ───────────────────────────────────────────────────
function toVal(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number')  return { doubleValue: v };
  if (typeof v === 'string')  return { stringValue: v };
  if (Array.isArray(v))       return { arrayValue: { values: v.map(toVal) } };
  if (typeof v === 'object')  return { mapValue: { fields: toFields(v) } };
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
async function fsPut(path, data) {
  await fetch(`${FS}/${path}${KEY}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFields(data) }),
  });
}
async function fsMerge(path, data) {
  // Partial field update — leaves other fields untouched
  const masks = Object.keys(data).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
  await fetch(`${FS}/${path}${KEY}&${masks}`, {
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

// ─── Firebase Auth ────────────────────────────────────────────────────────────
async function signIn(email, password) {
  const r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${WEB_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }) }
  );
  const d = await r.json();
  if (d.error) throw new Error(d.error.message);
  return { uid: d.localId, email: d.email, displayName: d.displayName };
}

// ─── Data helpers ─────────────────────────────────────────────────────────────
const getDepartments = () => fsCollection('departments');
const getUserProfile = (uid) => fsGet(`users/${uid}`);

// Session per Telegram user (not per dept)
// telegramSessions/${tid} → { uid, email, displayName, role, currentDeptId, step, pendingDeptId, pendingEmail }
const getSession   = (tid) => fsGet(`telegramSessions/${tid}`);
const mergeSession = (tid, data) => fsMerge(`telegramSessions/${tid}`, data);
const putSession   = (tid, data) => fsPut(`telegramSessions/${tid}`, data);
const clearSession = (tid) => fsDelete(`telegramSessions/${tid}`);

async function getChatHistory(uid, deptId) {
  const doc = await fsGet(`chats/${uid}_${deptId}`);
  return (doc?.messages || []).slice(-20).filter(m => m.role !== 'system');
}
async function saveChatHistory(uid, deptId, messages) {
  await fsPut(`chats/${uid}_${deptId}`, {
    userId: uid, departmentId: deptId,
    messages, updatedAt: new Date().toISOString(),
  });
}

// ─── OpenAI ───────────────────────────────────────────────────────────────────
const TELEGRAM_FORMAT = `

TELEGRAM FORMATTING RULES (always follow):
1. NEVER use markdown tables (| col | col | format is BANNED)
2. Present data as bullet cards:

<b>📋 Record / Title</b>
• Field: Value
• Status: ✅ Verified / ❌ Failed / ⚠️ Pending
─────────────────

3. Section headings: <b>🔹 Heading</b>
4. Bold important numbers: <b>42 sites</b>, <b>$1.2M</b>
5. If many records, show top 5–7 then give a summary
6. Keep responses short and mobile-friendly
7. Always respond in English
`;

async function gptReply(dept, history, userText) {
  let ctx = `Department: ${dept.name}\n${dept.description || ''}\n`;
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
    } catch {}
  }
  const systemPrompt = dept.systemPrompt
    ? `${dept.systemPrompt}\n\n--- DATA ---\n${ctx}${TELEGRAM_FORMAT}`
    : `You are the AI assistant for ${dept.name}. Give professional, concise answers in English.\n\n--- DATA ---\n${ctx}${TELEGRAM_FORMAT}`;

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
  return d.choices?.[0]?.message?.content || 'Sorry, no response received. Please try again.';
}

// ─── Safe send (HTML with plain-text fallback) ────────────────────────────────
async function safeSend(ctx, text) {
  const chunks = text.length <= 4000 ? [text] : (text.match(/[\s\S]{1,4000}/g) || [text]);
  for (const chunk of chunks) {
    try {
      await ctx.reply(chunk, { parse_mode: 'HTML' });
    } catch {
      await ctx.reply(chunk.replace(/<[^>]*>/g, ''));
    }
  }
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function deptKeyboard(depts) {
  return {
    inline_keyboard: depts.map(d => [{
      text: `${d.tag ? `[${d.tag}] ` : ''}${d.name}`,
      callback_data: `dept:${d.id}`,
    }]),
  };
}

function getAccessible(depts, profile) {
  const role = profile?.role;
  if (role === 'admin' || role === 'superadmin') return depts;
  return depts.filter(d => (profile?.assignedDepartments || []).includes(d.id));
}

function hasAccess(profile, deptId) {
  const role = profile?.role;
  return role === 'admin' || role === 'superadmin' ||
         (profile?.assignedDepartments || []).includes(deptId);
}

async function enterDept(ctx, dept, sess) {
  const history  = await getChatHistory(sess.uid, dept.id);
  const msgCount = history.filter(m => m.role === 'user').length;
  const lastUser = history.filter(m => m.role === 'user').pop();

  const histLine = msgCount > 0
    ? `💬 ${msgCount} previous messages — Last: <i>"${lastUser.content.substring(0, 50)}…"</i>`
    : `💬 No previous conversation here.`;

  await ctx.reply(
    `✅ <b>${dept.name}</b>${dept.tag ? ` [${dept.tag}]` : ''}\n` +
    `${dept.description ? `<i>${dept.description}</i>\n` : ''}` +
    `${histLine}\n\n` +
    `<b>Type your question ⬇️</b>\n` +
    `/switch — change dept  ·  /logout — logout`,
    { parse_mode: 'HTML' }
  );
}

// ─── Bot ──────────────────────────────────────────────────────────────────────
const bot = new Telegraf(BOT_TOKEN);

// /start
bot.command('start', async (ctx) => {
  const tid      = String(ctx.from.id);
  let   sess     = await getSession(tid);
  const allDepts = await getDepartments();

  if (allDepts.length === 0)
    return ctx.reply('No departments available. Please contact your admin.');

  // Validate existing session — if uid present but profile missing, wipe it
  if (sess?.uid) {
    const profile = await getUserProfile(sess.uid);
    if (!profile) { await clearSession(tid); sess = null; }
  }

  // ── Already logged in AND already in a department → stay there
  if (sess?.uid && sess?.currentDeptId) {
    const dept = allDepts.find(d => d.id === sess.currentDeptId);
    return ctx.reply(
      `✅ <b>${sess.displayName}</b> — <b>${dept?.name || sess.currentDeptId}</b>\n\n` +
      `Type your question below ⬇️\n\n` +
      `/switch — change department\n/logout — logout`,
      { parse_mode: 'HTML' }
    );
  }

  // ── Logged in but no department picked yet
  if (sess?.uid) {
    const profile = await getUserProfile(sess.uid);
    const depts   = getAccessible(allDepts, profile);
    return ctx.reply(
      `👋 <b>Welcome back, ${sess.displayName}!</b>\n\nSelect a department:`,
      { parse_mode: 'HTML', reply_markup: deptKeyboard(depts) }
    );
  }

  // ── Not logged in → show all departments
  await mergeSession(tid, { step: null, pendingDeptId: null, pendingEmail: null });
  return ctx.reply(
    `🤖 <b>BioPharma CRA Bot</b>\n\nWelcome! Select your department:`,
    { parse_mode: 'HTML', reply_markup: deptKeyboard(allDepts) }
  );
});

// Dept button tapped
bot.action(/^dept:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const tid    = String(ctx.from.id);
  const deptId = ctx.match[1];
  const sess   = await getSession(tid);
  const depts  = await getDepartments();
  const dept   = depts.find(d => d.id === deptId);

  if (!dept) return ctx.reply('Department not found. Use /start.');

  if (sess?.uid) {
    // Already logged in — just check access and switch
    const profile = await getUserProfile(sess.uid);
    if (!hasAccess(profile, deptId)) {
      return ctx.reply(
        `❌ You don't have access to <b>${dept.name}</b>.\nContact your admin.`,
        { parse_mode: 'HTML' }
      );
    }
    await mergeSession(tid, { currentDeptId: deptId, step: null });
    return enterDept(ctx, dept, { ...sess, currentDeptId: deptId });
  }

  // Not logged in — start login flow for this dept
  await mergeSession(tid, { step: 'enter_email', pendingDeptId: deptId, pendingEmail: null });
  return ctx.reply(
    `🏢 <b>${dept.name}</b>\n\n📧 Please enter your <b>email address</b>:`,
    { parse_mode: 'HTML' }
  );
});

// /switch ── change active department
bot.command('switch', async (ctx) => {
  const tid  = String(ctx.from.id);
  const sess = await getSession(tid);

  if (!sess?.uid)
    return ctx.reply('Please use /start to login first.');

  const allDepts = await getDepartments();
  const profile  = await getUserProfile(sess.uid);
  const depts    = getAccessible(allDepts, profile);

  if (depts.length === 0)
    return ctx.reply('No departments available. Contact admin.');

  return ctx.reply(
    `🔄 <b>Switch Department</b>\n\nSelect:`,
    { parse_mode: 'HTML', reply_markup: deptKeyboard(depts) }
  );
});

// /logout
bot.command('logout', async (ctx) => {
  await clearSession(String(ctx.from.id));
  return ctx.reply(
    '👋 <b>Logged out successfully.</b>\n\nUse /start to login again.',
    { parse_mode: 'HTML' }
  );
});

// /help
bot.command('help', async (ctx) => {
  const sess = await getSession(String(ctx.from.id));
  const depts = await getDepartments();
  const currName = depts.find(d => d.id === sess?.currentDeptId)?.name;

  return ctx.reply(
    `<b>BioPharma CRA Bot — Commands</b>\n\n` +
    `/start  — Select department\n` +
    `/switch — Change active department\n` +
    `/logout — Logout\n` +
    `/help   — This message\n\n` +
    `<b>Status:</b> ${sess?.uid
      ? `Logged in as <b>${sess.displayName}</b>\nDepartment: <b>${currName || 'None selected'}</b>`
      : 'Not logged in'}\n\n` +
    `After selecting a department, type your question to chat with AI!`,
    { parse_mode: 'HTML' }
  );
});

// Text messages ── login flow + chat
bot.on('text', async (ctx) => {
  const tid  = String(ctx.from.id);
  const text = ctx.message.text.trim();
  if (text.startsWith('/')) return;

  const sess = await getSession(tid);

  // ── Email step
  if (sess?.step === 'enter_email') {
    if (!text.includes('@'))
      return ctx.reply('❌ Please enter a valid email address.\n\n📧 <b>Email:</b>', { parse_mode: 'HTML' });
    await mergeSession(tid, { pendingEmail: text.toLowerCase().trim(), step: 'enter_password' });
    return ctx.reply('🔑 Enter your <b>password</b>:', { parse_mode: 'HTML' });
  }

  // ── Password step
  if (sess?.step === 'enter_password') {
    await ctx.reply('⏳ Verifying...');
    try {
      const auth    = await signIn(sess.pendingEmail, text);
      const profile = await getUserProfile(auth.uid);
      const role    = profile?.role || 'user';
      const name    = auth.displayName || profile?.displayName || auth.email.split('@')[0];
      const depts   = await getDepartments();
      const dept    = depts.find(d => d.id === sess.pendingDeptId);

      if (!hasAccess(profile, sess.pendingDeptId)) {
        await mergeSession(tid, { step: null, pendingDeptId: null, pendingEmail: null });
        return ctx.reply(
          `❌ <b>Access Denied.</b>\n\nYou are not authorized for <b>${dept?.name || 'this department'}</b>.\nContact your admin.`,
          { parse_mode: 'HTML' }
        );
      }

      const newSess = {
        uid: auth.uid, email: auth.email, displayName: name, role,
        currentDeptId: sess.pendingDeptId,
        step: null, pendingDeptId: null, pendingEmail: null,
        linkedAt: new Date().toISOString(),
      };
      await putSession(tid, newSess);

      const badge = (role === 'admin' || role === 'superadmin') ? `\n🛡️ Role: <b>${role}</b>` : '';
      await ctx.reply(
        `✅ <b>Login Successful!</b>\nWelcome, <b>${name}!</b>${badge}`,
        { parse_mode: 'HTML' }
      );
      if (dept) await enterDept(ctx, dept, newSess);

    } catch (err) {
      await mergeSession(tid, { step: 'enter_email', pendingEmail: null });
      const msg = err.message?.includes('INVALID') || err.message?.includes('EMAIL_NOT_FOUND')
        ? '❌ <b>Invalid email or password.</b>'
        : '❌ Login failed. Please try again.';
      return ctx.reply(`${msg}\n\n📧 Enter your <b>email</b>:`, { parse_mode: 'HTML' });
    }
    return;
  }

  // ── Not logged in
  if (!sess?.uid) {
    return ctx.reply(
      'Please use /start to select a department and login.',
      { parse_mode: 'HTML' }
    );
  }

  // ── No department selected yet
  if (!sess?.currentDeptId) {
    const allDepts = await getDepartments();
    const profile  = await getUserProfile(sess.uid);
    return ctx.reply(
      'Select a department first:',
      { reply_markup: deptKeyboard(getAccessible(allDepts, profile)) }
    );
  }

  // ── Chat
  const depts = await getDepartments();
  const dept  = depts.find(d => d.id === sess.currentDeptId);
  if (!dept) return ctx.reply('Department not found. Use /start.');

  await ctx.replyWithChatAction('typing');
  try {
    const history = await getChatHistory(sess.uid, sess.currentDeptId);
    const reply   = await gptReply(dept, history, text);

    await saveChatHistory(sess.uid, sess.currentDeptId, [
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

// ─── Express health check (starts immediately — before bot connect) ────────────
const app = express();
app.get('/',       (_, res) => res.send('🤖 BioPharma CRA Bot — Running'));
app.get('/health', (_, res) => res.json({ ok: true, uptime: process.uptime() }));
app.listen(PORT, () => console.log(`✅ Health server on port ${PORT}`));

// ─── Launch ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('🤖 BioPharma CRA Bot starting...');
  console.log('⏳ Waiting 25s for old instance to stop...');
  await sleep(25000);

  await bot.telegram.deleteWebhook({ drop_pending_updates: true });
  await bot.launch({ allowedUpdates: ['message', 'callback_query'], dropPendingUpdates: true });
  console.log('✅ Bot is live! Polling Telegram...');

  process.once('SIGINT',  () => { try { bot.stop('SIGINT');  } catch {} process.exit(0); });
  process.once('SIGTERM', () => { try { bot.stop('SIGTERM'); } catch {} process.exit(0); });
}

main().catch(err => { console.error('❌ Startup failed:', err.message); process.exit(1); });
