'use strict';

const { Telegraf, session, Markup } = require('telegraf');
const express = require('express');

// ─── Config ───────────────────────────────────────────────────────────────────
const BOT_TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY;
const PROJECT_ID  = process.env.FIREBASE_PROJECT_ID || 'biopharma-a07e0';
const OPENAI_KEY  = process.env.OPENAI_API_KEY;
const PORT        = process.env.PORT || 3000;

if (!BOT_TOKEN)   { console.error('❌ TELEGRAM_BOT_TOKEN missing'); process.exit(1); }
if (!WEB_API_KEY) { console.error('❌ FIREBASE_WEB_API_KEY missing'); process.exit(1); }
if (!OPENAI_KEY)  { console.error('❌ OPENAI_API_KEY missing'); process.exit(1); }

const FS  = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const KEY = `?key=${WEB_API_KEY}`;

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
async function fsCollection(collectionId) {
  try {
    const r = await fetch(`${FS}/${collectionId}${KEY}`);
    if (!r.ok) return [];
    const data = await r.json();
    return (data.documents || []).map(doc => ({
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
//  App data helpers
// ═══════════════════════════════════════════════════════════

const getTgSession   = (tid)        => fsGet(`telegramSessions/${tid}`);
const saveTgSession  = (tid, data)  => fsPatch(`telegramSessions/${tid}`, data);
const deleteTgSession= (tid)        => fsDelete(`telegramSessions/${tid}`);
const getUserProfile = (uid)        => fsGet(`users/${uid}`);
const getDepartments = ()           => fsCollection('departments');
const getDepartment  = (id)         => fsGet(`departments/${id}`);

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
//  OpenAI
// ═══════════════════════════════════════════════════════════

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
    } catch { /* skip failed source */ }
  }

  const FORMAT = `

TELEGRAM FORMATTING RULES (hamesha follow karein):
- Bold ke liye: <b>text</b> (important terms, numbers, key findings)
- Italic ke liye: <i>text</i>
- Code/value ke liye: <code>text</code>
- Bullet points ke liye • use karein (dash nahi)
- Section headings ke liye: <b>━━ HEADING ━━</b>
- Tables/comparisons ke liye <pre> block:

<pre>Metric          Value      Status
────────────────────────────────
Item 1          100        ✅
Item 2          50         ⚠️
Item 3          0          ❌</pre>

- ✅ = complete/verified/good
- ❌ = missing/failed/critical
- ⚠️ = pending/review/partial
- Jawab mukhtasar aur clear rakho — yeh chat hai, report nahi
- User ki language mein jawab do (Urdu ya English)
`;

  const systemPrompt = dept.systemPrompt
    ? `${dept.systemPrompt}\n\n--- DATA ---\n${ctx}${FORMAT}`
    : `Aap ${dept.name} department ke AI assistant hain. Professional aur mukhtasar jawab dein.\n\n--- DATA ---\n${ctx}${FORMAT}`;

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
      max_tokens: 1000,
    }),
  });
  const d = await r.json();
  return d.choices?.[0]?.message?.content || 'Maafi chahta hun, jawab nahi mila.';
}

// ═══════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════

async function safeSend(ctx, text) {
  const chunks = text.length <= 4000
    ? [text]
    : (text.match(/[\s\S]{1,4000}/g) || [text]);
  for (const chunk of chunks) {
    try {
      await ctx.reply(chunk, { parse_mode: 'HTML' });
    } catch {
      // Fallback: strip HTML tags and send plain text
      await ctx.reply(chunk.replace(/<[^>]*>/g, ''));
    }
  }
}

function buildDeptKeyboard(depts) {
  const btns = depts.map(d => Markup.button.callback(`🏢 ${d.name}`, `dept_${d.id}`));
  const rows = [];
  for (let i = 0; i < btns.length; i += 2) rows.push(btns.slice(i, i + 2));
  return Markup.inlineKeyboard(rows);
}

function isAdmin(role) {
  return role === 'admin' || role === 'superadmin';
}

async function getAccessibleDepts(sess) {
  const all = await getDepartments();
  if (isAdmin(sess.role)) return all;
  // Regular user: only their assigned department
  if (sess.departmentId) return all.filter(d => d.id === sess.departmentId);
  return all; // fallback: show all if no department assigned
}

// ═══════════════════════════════════════════════════════════
//  Telegraf Bot
// ═══════════════════════════════════════════════════════════

const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

// ── /start ────────────────────────────────────────────────
bot.command('start', async (ctx) => {
  const tid = String(ctx.from.id);
  ctx.session = {};

  const sess = await getTgSession(tid);

  if (sess?.uid) {
    // Already logged in
    const depts = await getAccessibleDepts(sess);

    if (depts.length === 0) {
      return ctx.reply(
        '❌ Koi department access nahi hai.\nAdmin se rabta karein.'
      );
    }

    if (depts.length === 1) {
      await saveTgSession(tid, { ...sess, selectedDeptId: depts[0].id });
      return ctx.reply(
        `✅ *Welcome back, ${sess.displayName || sess.email}!*\n\n` +
        `🏢 *${depts[0].name}* se connected hain.\n\nKoi bhi sawal karein!`,
        { parse_mode: 'Markdown' }
      );
    }

    return ctx.reply(
      `✅ *Welcome back, ${sess.displayName || sess.email}!*\n\nKaun sa department?`,
      { parse_mode: 'Markdown', ...buildDeptKeyboard(depts) }
    );
  }

  // Not logged in → start auth
  ctx.session.step = 'email';
  await ctx.reply(
    '🤖 *BioPharma CRA Platform*\n\n' +
    'AI Assistant mein khush amdeed!\n\n' +
    '📧 Apna *email address* enter karein:',
    { parse_mode: 'Markdown' }
  );
});

// ── /logout ───────────────────────────────────────────────
bot.command('logout', async (ctx) => {
  const tid = String(ctx.from.id);
  ctx.session = {};
  await deleteTgSession(tid);
  await ctx.reply('👋 *Logout ho gaye.*\n\n/start se dobara login karein.', {
    parse_mode: 'Markdown',
  });
});

// ── /switch ───────────────────────────────────────────────
bot.command('switch', async (ctx) => {
  const tid = String(ctx.from.id);
  const sess = await getTgSession(tid);

  if (!sess?.uid) {
    return ctx.reply('🔐 Pehle /start se login karein.');
  }

  const depts = await getAccessibleDepts(sess);

  if (depts.length <= 1) {
    return ctx.reply('ℹ️ Sirf ek department available hai.');
  }

  return ctx.reply('🔄 *Kaun sa department?*', {
    parse_mode: 'Markdown',
    ...buildDeptKeyboard(depts),
  });
});

// ── /help ─────────────────────────────────────────────────
bot.command('help', async (ctx) => {
  await ctx.reply(
    '*BioPharma CRA Bot*\n\n' +
    '/start  — Login ya Welcome\n' +
    '/switch — Department change karein\n' +
    '/logout — Logout\n' +
    '/help   — Yeh message\n\n' +
    'Login ke baad koi bhi sawal karein — data analysis, reports, aur zyada!',
    { parse_mode: 'Markdown' }
  );
});

// ── Department selection callback ─────────────────────────
bot.action(/^dept_(.+)$/, async (ctx) => {
  const tid    = String(ctx.from.id);
  const deptId = ctx.match[1];

  const sess = await getTgSession(tid);
  if (!sess?.uid) {
    await ctx.answerCbQuery('Session khatam. /start karein.');
    return ctx.reply('🔐 /start se login karein.');
  }

  const dept = await getDepartment(deptId);
  if (!dept) {
    await ctx.answerCbQuery('Department nahi mila!');
    return;
  }

  await saveTgSession(tid, { ...sess, selectedDeptId: deptId });
  await ctx.answerCbQuery(`${dept.name} ✅`);
  await ctx.editMessageText(
    `✅ *${dept.name}* bot se connected!\n\nAb koi bhi sawal karein. 🚀`,
    { parse_mode: 'Markdown' }
  );
});

// ── Main message handler ──────────────────────────────────
bot.on('text', async (ctx) => {
  const tid  = String(ctx.from.id);
  const text = ctx.message.text.trim();

  if (text.startsWith('/')) return; // commands handled above

  // ─ Login flow: email step
  if (ctx.session?.step === 'email') {
    if (!text.includes('@')) {
      return ctx.reply('❌ Valid email address enter karein.\n\n📧 *Email:*', {
        parse_mode: 'Markdown',
      });
    }
    ctx.session.email = text.toLowerCase().trim();
    ctx.session.step  = 'password';
    return ctx.reply('🔑 *Password* enter karein:', { parse_mode: 'Markdown' });
  }

  // ─ Login flow: password step
  if (ctx.session?.step === 'password') {
    const loadingMsg = await ctx.reply('⏳ Verify ho raha hai...');

    try {
      const authUser = await signIn(ctx.session.email, text);
      const profile  = await getUserProfile(authUser.uid);

      const role         = profile?.role        || 'user';
      const displayName  = authUser.displayName || profile?.displayName || authUser.email.split('@')[0];
      const departmentId = profile?.departmentId || null;

      const sessionData = {
        uid: authUser.uid, email: authUser.email,
        displayName, role, departmentId,
        selectedDeptId: departmentId || null,
        linkedAt: new Date().toISOString(),
      };
      await saveTgSession(tid, sessionData);
      ctx.session = {};

      const depts     = await getDepartments();
      const userDepts = isAdmin(role)
        ? depts
        : depts.filter(d => !departmentId || d.id === departmentId);

      const adminTag = isAdmin(role)
        ? `\n🛡 Role: *${role}*`
        : '';

      if (userDepts.length === 0) {
        return ctx.reply(
          `✅ *Login kamyaab!*\n\nWelcome *${displayName}!* 🎉${adminTag}\n\n` +
          `❌ Koi department access nahi.\nAdmin se rabta karein.`,
          { parse_mode: 'Markdown' }
        );
      }

      if (userDepts.length === 1) {
        await saveTgSession(tid, { ...sessionData, selectedDeptId: userDepts[0].id });
        return ctx.reply(
          `✅ *Login kamyaab!*\n\nWelcome *${displayName}!* 🎉${adminTag}\n\n` +
          `🏢 *${userDepts[0].name}* bot se connected!\n\nAb koi bhi sawal karein! 🚀`,
          { parse_mode: 'Markdown' }
        );
      }

      // Multiple departments → show picker
      return ctx.reply(
        `✅ *Login kamyaab!*\n\nWelcome *${displayName}!* 🎉${adminTag}\n\n` +
        `Kaun sa department?`,
        { parse_mode: 'Markdown', ...buildDeptKeyboard(userDepts) }
      );

    } catch (err) {
      ctx.session.step  = 'email';
      ctx.session.email = undefined;

      const errMsg =
        err.message?.includes('INVALID_PASSWORD') ||
        err.message?.includes('EMAIL_NOT_FOUND')  ||
        err.message?.includes('INVALID_LOGIN_CREDENTIALS')
          ? '❌ *Email ya password galat hai.*'
          : `❌ *Login fail:* ${err.message}`;

      return ctx.reply(
        `${errMsg}\n\nDobara try karein:\n\n📧 *Email* enter karein:`,
        { parse_mode: 'Markdown' }
      );
    }
  }

  // ─ Chat flow
  const sess = await getTgSession(tid);

  if (!sess?.uid) {
    ctx.session = { step: 'email' };
    return ctx.reply(
      '🔐 Pehle login karein.\n\n📧 *Email* enter karein:',
      { parse_mode: 'Markdown' }
    );
  }

  if (!sess.selectedDeptId) {
    const depts = await getAccessibleDepts(sess);
    return ctx.reply(
      '🏢 Pehle department choose karein:',
      buildDeptKeyboard(depts)
    );
  }

  // Typing indicator
  await ctx.replyWithChatAction('typing');

  try {
    const dept = await getDepartment(sess.selectedDeptId);
    if (!dept) {
      return ctx.reply('❌ Department nahi mila. /switch se change karein.');
    }

    const history = await getChatHistory(sess.uid, sess.selectedDeptId);
    const reply   = await gptReply(dept, history, text);

    await saveChatHistory(sess.uid, sess.selectedDeptId, [
      ...history,
      { role: 'user',      content: text,  timestamp: Date.now(), source: 'telegram' },
      { role: 'assistant', content: reply, timestamp: Date.now(), source: 'telegram' },
    ]);

    await safeSend(ctx, reply);

  } catch (err) {
    console.error('Chat error:', err.message);
    await ctx.reply('❌ Jawab nahi mila. Thodi der baad dobara try karein.');
  }
});

// ═══════════════════════════════════════════════════════════
//  Express health-check server (required by Render Web Service)
// ═══════════════════════════════════════════════════════════

const app = express();
app.get('/',       (_, res) => res.send('🤖 BioPharma Telegram Bot is running!'));
app.get('/health', (_, res) => res.json({ ok: true, uptime: process.uptime() }));
app.listen(PORT, () => console.log(`✅ Health server on port ${PORT}`));

// ═══════════════════════════════════════════════════════════
//  Launch
// ═══════════════════════════════════════════════════════════

async function start() {
  // Express health server is already listening — Render health checks will pass during startup wait

  console.log('🤖 BioPharma Telegram Bot starting (polling mode)...');

  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    console.log('✅ Webhook cleared');
  } catch (e) {
    console.log('ℹ️ deleteWebhook:', e.message);
  }

  // Retry loop — handles 409 from Render rolling deploy overlap
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`⏳ Waiting 35s for previous connection to expire... (attempt ${attempt}/6)`);
        await new Promise(r => setTimeout(r, 35000));
      }
      await bot.launch({
        allowedUpdates: ['message', 'callback_query'],
        dropPendingUpdates: true,
      });
      console.log('✅ Bot is live! Polling Telegram...');
      return;
    } catch (err) {
      console.error(`⚠️ Attempt ${attempt}/6: ${err.message}`);
      if (attempt === 6) throw err;
    }
  }
}

start().catch(err => { console.error('❌ Bot launch failed:', err.message); process.exit(1); });

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
