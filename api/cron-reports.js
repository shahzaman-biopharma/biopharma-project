// Vercel Cron Job — auto weekly/monthly reports
// Schedule: daily at 03:00 UTC (08:00 PKT)

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'biopharma-a07e0';
const WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// ─── Firestore helpers ─────────────────────────────────────────────────────────

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

async function fsAdd(collection, data) {
  await fetch(`${FS_BASE}/${collection}?key=${WEB_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFields(data) }),
  });
}

async function fsQuery(collection) {
  const r = await fetch(`${FS_BASE}:runQuery?key=${WEB_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: collection }],
      },
    }),
  });
  const results = await r.json();
  if (!Array.isArray(results)) return [];
  return results
    .filter(r => r.document)
    .map(r => ({ id: r.document.name.split('/').pop(), ...fromFields(r.document.fields) }));
}

// ─── Get data from Google Sheet ─────────────────────────────────────────────

async function fetchSheetData(url) {
  try {
    const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!m) return '';
    const r = await fetch(`https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv`);
    if (!r.ok) return '';
    return (await r.text()).substring(0, 5000);
  } catch {
    return '';
  }
}

// ─── GPT report generation ──────────────────────────────────────────────────

async function generateReport(dept, reportType) {
  let dataCtx = `Department: ${dept.name}\nDescription: ${dept.description || ''}\n`;

  for (const src of dept.dataSources || []) {
    try {
      if (src.type === 'googlesheet' && src.url) {
        const csv = await fetchSheetData(src.url);
        if (csv) dataCtx += `\n--- ${src.name} ---\n${csv}\n`;
      } else if (src.type === 'text' && src.content) {
        dataCtx += `\n--- ${src.name} ---\n${src.content}\n`;
      }
    } catch { /* skip */ }
  }

  const prompt = `You are a professional report generator for ${dept.name} department in a Clinical Research Associate (CRA) company.

Generate a detailed ${reportType} report based on the following data:

${dataCtx}

${dept.systemPrompt ? `Department Context:\n${dept.systemPrompt}` : ''}

Create a comprehensive, professional report with:
1. Executive Summary
2. Key Metrics & Performance Indicators
3. Data Analysis & Findings
4. Issues & Risks
5. Recommendations
6. Next Steps

Format with clear sections and bullet points. Include specific data points.`;

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      max_tokens: 2500,
    }),
  });
  const d = await r.json();
  return d.choices?.[0]?.message?.content || '';
}

// ─── Check if should generate ───────────────────────────────────────────────

function getCurrentDayHour(timezone) {
  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: 'numeric',
      day: 'numeric',
      hour12: false,
    }).formatToParts(now);

    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const weekday = parts.find(p => p.type === 'weekday')?.value;
    const day = parseInt(parts.find(p => p.type === 'day')?.value || '1');
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
    const dayOfWeek = weekdays.indexOf(weekday);

    return { dayOfWeek, day, hour };
  } catch {
    const now = new Date();
    return { dayOfWeek: now.getDay(), day: now.getDate(), hour: now.getHours() };
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // Allow GET for manual trigger + Vercel cron (which sends GET)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ ok: false });
  }

  try {
    const settings = await fsGet('settings/reports');

    if (!settings || !settings.enabled) {
      console.log('Auto-reports disabled or no settings found');
      return res.status(200).json({ ok: true, message: 'Auto-reports disabled' });
    }

    const timezone = settings.timezone || 'Asia/Karachi';
    const { dayOfWeek, day, hour } = getCurrentDayHour(timezone);
    const now = new Date().toISOString();

    const generated = [];

    // ─── Weekly check ─────────────────────────────────────────────────────────
    const weeklyDay = settings.weeklyDay ?? 1;    // Monday = 1
    const weeklyHour = settings.weeklyHour ?? 8;

    const lastWeekly = settings.lastWeeklyGen ? new Date(settings.lastWeeklyGen) : null;
    const hoursSinceLastWeekly = lastWeekly
      ? (Date.now() - lastWeekly.getTime()) / 3600000
      : 999;

    if (dayOfWeek === weeklyDay && Math.abs(hour - weeklyHour) <= 1 && hoursSinceLastWeekly > 20) {
      console.log('Generating weekly reports...');
      const departments = await fsQuery('departments');

      for (const dept of departments) {
        try {
          const content = await generateReport(dept, 'weekly');
          if (content) {
            await fsAdd('reports', {
              departmentId: dept.id,
              departmentName: dept.name,
              type: 'weekly',
              content,
              generatedBy: 'auto-cron',
              generatedAt: now,
            });
            generated.push(`weekly:${dept.name}`);
          }
        } catch (e) {
          console.error(`Failed weekly report for ${dept.name}:`, e.message);
        }
      }

      await fsSet('settings/reports', { ...settings, lastWeeklyGen: now });
    }

    // ─── Monthly check ─────────────────────────────────────────────────────────
    const monthlyDay = settings.monthlyDay ?? 1;
    const monthlyHour = settings.monthlyHour ?? 8;

    const lastMonthly = settings.lastMonthlyGen ? new Date(settings.lastMonthlyGen) : null;
    const hoursSinceLastMonthly = lastMonthly
      ? (Date.now() - lastMonthly.getTime()) / 3600000
      : 999;

    if (day === monthlyDay && Math.abs(hour - monthlyHour) <= 1 && hoursSinceLastMonthly > 20) {
      console.log('Generating monthly reports...');
      const departments = await fsQuery('departments');

      for (const dept of departments) {
        try {
          const content = await generateReport(dept, 'monthly');
          if (content) {
            await fsAdd('reports', {
              departmentId: dept.id,
              departmentName: dept.name,
              type: 'monthly',
              content,
              generatedBy: 'auto-cron',
              generatedAt: now,
            });
            generated.push(`monthly:${dept.name}`);
          }
        } catch (e) {
          console.error(`Failed monthly report for ${dept.name}:`, e.message);
        }
      }

      await fsSet('settings/reports', { ...settings, lastMonthlyGen: now });
    }

    console.log('Cron done. Generated:', generated);
    return res.status(200).json({ ok: true, generated, dayOfWeek, day, hour, timezone });

  } catch (err) {
    console.error('Cron error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
