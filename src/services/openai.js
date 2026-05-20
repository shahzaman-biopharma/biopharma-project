// All OpenAI calls route through /api/chat (Vercel serverless).
// The API key lives on the server — never in the browser bundle.

// ─── Data accuracy — highest priority, placed first in system prompt ──────────
const DATA_ACCURACY_RULES = `
╔══════════════════════════════════════════════════════════════════════╗
║  DATA ACCURACY — ABSOLUTE RULES — OVERRIDE EVERYTHING ELSE          ║
╚══════════════════════════════════════════════════════════════════════╝

⚠️ SCOPE: These rules apply ONLY when the user asks about specific data values,
records, names, numbers, dates, or anything that should be in the spreadsheet.

For conversational messages — greetings (hello, hi, salam, salaam, assalamualaikum,
hey, good morning, how are you), thank you messages, help questions, or ANY message
NOT asking about spreadsheet data — respond naturally and warmly as a helpful
assistant. NEVER apply data lookup rules to casual conversation.

1. DATA CONTEXT IS THE ONLY SOURCE OF TRUTH
   - Every value you display (name, number, date, ID, status, anything)
     MUST exist VERBATIM in the DATA CONTEXT section below.
   - You have ZERO prior knowledge of this company's records.
     Do not use any knowledge from your training about people, trial data,
     protocols, or outcomes. Everything comes from DATA CONTEXT only.

2. NEVER INVENT DATA
   - Do not generate, guess, interpolate, or assume ANY value.
   - Do not fill empty/blank cells — show them as blank.
   - Do not add rows that are not in the data.
   - Do not add columns that are not in the data headers.

3. CONVERSATION HISTORY IS UNRELIABLE FOR FACTS
   - Previous bot messages may contain DELETED or OUTDATED data.
   - A person, entry, or value mentioned in history may no longer exist
     in the current file. NEVER copy data from history as if it were true.
   - For all factual answers: use only DATA CONTEXT, not history.

4. EXACT COLUMN ALIGNMENT
   - The data uses " | " as column separator. Row 1 is always the header.
   - Map each value to its correct column header. Do not shift columns.
   - "Total rows: N" tells you the EXACT count — do not show more or fewer.

5. IF NOT FOUND → SAY SO
   - If the user is asking about specific data and it is not in the DATA CONTEXT,
     respond: "This entry/value is not present in the current connected data."
   - Do not make up a plausible-sounding answer.
`;

const FORMAT_INSTRUCTIONS = `
FORMATTING RULES:
- Use **bold** for important terms, numbers, and key findings
- Use ## for main sections, ### for subsections
- Use bullet points (- item) for lists
- Use numbered lists (1. 2. 3.) for steps or ranked items
- Use markdown tables (| Col | Col |) for any tabular or comparative data
- Keep paragraphs short and clear
- Respond in the same language the user writes in (Urdu or English)

MULTI-SHEET DATA INTELLIGENCE:
- All data is in the DATA CONTEXT section; each tab is labeled === Sheet: [Name] ===
- SHEET INDEX in context lists all available sheet names
- "konsi sheets hain" / "list sheets" → list ALL sheet names with brief description
- "blend" / "merge" / "A∪B" / "union" → ONE combined table with ALL rows (remove exact duplicates)
- "intersect" / "A∩B" / "common rows" → rows present in ALL specified sheets
- "compare" / "difference" / "A-B" → what exists in one sheet but not another
- When a specific sheet is named → use ONLY that sheet's data
- Always label which sheet data came from in multi-sheet results
- You CAN filter, sort, sum, count, average, group-by, pivot on any column
`;


const VOICE_INSTRUCTIONS = `
VOICE MODE — STRICT RULES (override all formatting rules):
- LANGUAGE: Always respond in English only, no matter what language the user speaks
- LENGTH: Maximum 2-3 sentences — be concise and conversational
- FORMAT: Plain prose only — absolutely no markdown, no **, no ##, no bullet points, no tables
- TONE: Natural, warm, spoken-word style as if talking face to face
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── tryCreate: calls /api/chat proxy with 429 exponential backoff ─────────
// /api/chat handles model selection (gpt-4o → gpt-4o-mini) server-side.
// Client retries on 429: waits 5 s → 15 s → 40 s before giving up.
const BACKOFF_MS = [5_000, 15_000, 40_000];

async function tryCreate(params) {
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    let response;
    try {
      response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
    } catch {
      // Network / offline error
      if (attempt < BACKOFF_MS.length) { await sleep(BACKOFF_MS[attempt]); continue; }
      throw new Error('Network error. Check your connection and try again.');
    }

    if (response.ok) return response.json();

    if (response.status === 429) {
      if (attempt < BACKOFF_MS.length) {
        console.warn(`[AI] Rate limited — retrying in ${BACKOFF_MS[attempt] / 1000}s…`);
        await sleep(BACKOFF_MS[attempt]);
        continue;
      }
      throw new Error('Service is temporarily busy. Please wait a moment and try again.');
    }

    if (response.status === 401) {
      throw new Error('OpenAI API key is invalid or expired. Go to Vercel → Settings → Environment Variables and update OPENAI_API_KEY, then redeploy.');
    }

    // Any other error
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `API error ${response.status}`);
  }
}

// ─── Chunked reading — splits large dataContext into safe-size pieces ─────────
// gpt-4o supports 128k tokens (~512k chars). We use 100k chars per chunk to
// leave headroom for system prompt + response tokens.
const CHUNK_CHARS = 100_000;

// Max extraction chunks to keep total API calls bounded (prevents rate-limit cascade)
const MAX_CHUNKS = 6;

function splitContextIntoChunks(text, maxChars = CHUNK_CHARS) {
  if (text.length <= maxChars) return [text];

  // Prefer splitting at sheet boundaries so each chunk is a whole sheet
  const sections = text.split(/(?=^=== Sheet:)/m);
  const chunks = [];
  let current = '';

  for (const section of sections) {
    if (current && (current + section).length > maxChars) {
      chunks.push(current.trim());
      current = section;
    } else {
      current += section;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  // Force-split any chunk that is still too large (e.g. single massive sheet)
  const result = [];
  for (const chunk of chunks) {
    if (chunk.length <= maxChars) {
      result.push(chunk);
    } else {
      for (let i = 0; i < chunk.length; i += maxChars) {
        result.push(chunk.slice(i, i + maxChars));
      }
    }
  }

  // If still too many chunks, merge pairs until within MAX_CHUNKS
  while (result.length > MAX_CHUNKS) {
    const merged = [];
    for (let i = 0; i < result.length; i += 2) {
      merged.push(i + 1 < result.length ? result[i] + '\n\n' + result[i + 1] : result[i]);
    }
    result.length = 0;
    result.push(...merged);
  }

  return result;
}

// Phase 1: extract relevant fragments from each chunk sequentially (with delay)
// Phase 2: synthesise final answer from combined extracts
async function chatWithBotChunked({ systemPrompt, userMessage, dataContext, voiceMode }) {
  const chunks = splitContextIntoChunks(dataContext);
  const extracts = [];

  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) await sleep(2000); // 2 s gap between chunk calls to avoid rate limits
    const res = await tryCreate({
      messages: [
        {
          role: 'system',
          content: `You are a data extraction assistant. From this data chunk, extract ALL rows, numbers, and values that are relevant to the user's question. Copy them verbatim. Do not answer the question yet — only extract. Chunk ${i + 1} of ${chunks.length}.`,
        },
        {
          role: 'user',
          content: `USER QUESTION: ${userMessage}\n\nDATA CHUNK ${i + 1}/${chunks.length}:\n${chunks[i]}\n\nExtract all relevant data.`,
        },
      ],
      temperature: 0.1,
      max_completion_tokens: 2000,
    });
    const extract = res.choices[0].message.content.trim();
    if (extract) extracts.push(`[Section ${i + 1}/${chunks.length}]\n${extract}`);
  }

  // Phase 2 — synthesise from combined extracts
  const combined = extracts.length
    ? `EXTRACTED DATA FROM ${chunks.length} SECTIONS:\n\n${extracts.join('\n\n---\n\n')}`
    : dataContext.slice(0, CHUNK_CHARS);

  return chatWithBot({ systemPrompt, userMessage, dataContext: combined, voiceMode });
}

export async function chatWithBot({ systemPrompt, userMessage, dataContext = '', voiceMode = false }) {
  // Auto-route to chunked reading when data exceeds safe token limit
  if (dataContext.length > CHUNK_CHARS) {
    return chatWithBotChunked({ systemPrompt, userMessage, dataContext, voiceMode });
  }

  const systemContent = [
    dataContext ? DATA_ACCURACY_RULES : '',
    systemPrompt,
    voiceMode ? VOICE_INSTRUCTIONS : FORMAT_INSTRUCTIONS,
    dataContext
      ? `--- DATA CONTEXT (LIVE — fetched right now from connected source) ---\n${dataContext}`
      : '',
  ].filter(Boolean).join('\n\n');

  const response = await tryCreate({
    messages: [
      { role: 'system', content: systemContent },
      { role: 'user', content: userMessage },
    ],
    temperature: 0.2,
    max_completion_tokens: 2500,
  });

  return response.choices[0].message.content;
}

export async function generateReport({ systemPrompt, dataContext, reportType, departmentName }) {
  const prompt = `You are a professional report generator for the **${departmentName}** department in a Clinical Research Associate (CRA) biopharma company.

Generate a detailed **${reportType} report** based on the data below.

${dataContext ? `--- DATA ---\n${dataContext}` : ''}
${systemPrompt ? `--- DEPARTMENT CONTEXT ---\n${systemPrompt}` : ''}

Structure the report with these exact sections using markdown:

## Executive Summary
(2–3 sentence overview with key numbers)

## Key Metrics & KPIs
(Use a markdown table with | Metric | Value | Status | columns)

## Data Analysis
(Bullet points with specific findings from the data)

## Issues & Findings
(Numbered list of issues found, severity noted)

## Recommendations
(Actionable bullet points)

## Next Steps
(Numbered list with responsible party if known)

---
RULES: Use **bold** for numbers and critical items. Use tables wherever data can be compared. Keep language professional and precise.`;

  const response = await tryCreate({
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.5,
    max_completion_tokens: 3000,
  });

  return response.choices[0].message.content;
}

export async function generateDepartmentPrompt({ name, description, businessContext }) {
  const response = await tryCreate({
    messages: [
      {
        role: 'user',
        content: `Create a comprehensive, expert-level AI assistant system prompt for a ${name} department in a Clinical Research Associate (CRA) biopharma company.

Department Name: ${name}
Description: ${description}
Business Context: ${businessContext}

The generated system prompt MUST cover ALL of the following — write it as a detailed, expert instruction set (400–600 words):

1. ROLE & EXPERTISE: Define the bot as a senior data analyst AND domain expert for ${name}. It deeply understands pharma/CRA workflows, regulations, and KPIs relevant to this department.

2. DATA ANALYSIS CAPABILITIES: It can analyze any data in the connected sheets — find trends, anomalies, averages, totals, top/bottom performers, date-range summaries, period-over-period comparisons.

3. MULTI-SHEET MASTERY: It knows all available sheets/tabs and can:
   - List available sheets when asked
   - Blend/union sheets (A∪B) — merge all rows from multiple sheets
   - Intersect sheets (A∩B) — find common records
   - Compare sheets — find differences
   - Always label which sheet data came from

4. PROACTIVE INSIGHTS: After answering a question, suggest 2-3 relevant follow-up analyses the user might want. Example: "Want me to also compare this with last month's data?" or "Shall I generate a PDF report of these findings?"

5. REPORT GENERATION: When user asks for Excel, PDF, or table — confirm you can generate it and guide them.

6. PROFESSIONAL TONE: Precise, data-driven, concise. Use proper pharma terminology for this department.

7. LANGUAGE: Respond in the same language the user writes in (Urdu or English).

8. FORMATTING: Always use ## headings, **bold** for key numbers, markdown tables for comparisons, bullet points for lists.

9. MEMORY: Reference prior messages in the conversation. Never ask the user to repeat data already shared.

10. STRICT DATA ACCURACY: Only use the data provided in the context. Never fabricate numbers. If data is not available, say so clearly.

Write only the system prompt text, nothing else. Make it long, comprehensive, and production-ready.`,
      },
    ],
    temperature: 0.5,
    max_completion_tokens: 1500,
  });

  return response.choices[0].message.content;
}

export async function generateFileData({ userRequest, dataContext, departmentName }) {
  const response = await tryCreate({
    messages: [
      {
        role: 'system',
        content: `You are a data extraction assistant for ${departmentName}.
When asked to create a table/report, you MUST respond with ONLY valid JSON (no markdown, no explanation) in this exact format:
{
  "title": "Report Title",
  "subtitle": "Department Name | Date",
  "summary": "2-3 sentence executive summary",
  "sheets": [
    {
      "name": "Sheet Name",
      "headers": ["Column1", "Column2", "Column3"],
      "rows": [
        ["value1", "value2", "value3"],
        ["value1", "value2", "value3"]
      ]
    }
  ]
}
Use the provided data context to populate the tables accurately. Create multiple sheets if the data has multiple categories or source sheets.`,
      },
      {
        role: 'user',
        content: `Data Context:\n${dataContext}\n\nUser Request: ${userRequest}\n\nReturn ONLY valid JSON.`,
      },
    ],
    temperature: 0.2,
    max_completion_tokens: 4000,
  });

  const raw = response.choices[0].message.content.trim();
  const jsonStr = raw.replace(/^```json\n?/, '').replace(/^```\n?/, '').replace(/\n?```$/, '');
  return JSON.parse(jsonStr);
}

export async function generateDashboardConfig({ name, description, businessContext, systemPrompt, dataSources = [] }) {
  const srcNames = dataSources.map(s => s.name).filter(Boolean).join(', ') || 'N/A';
  const srcCount = dataSources.length;

  const response = await tryCreate({
    messages: [{
      role: 'user',
      content: `You are a dashboard UI designer for a biopharma CRA analytics platform.

Design a custom dashboard config JSON for the "${name}" department.

Description: ${(description || '').slice(0, 400)}
Data Sources (${srcCount}): ${srcNames}
Business Context: ${(businessContext || '').slice(0, 300)}
System Prompt Focus: ${(systemPrompt || '').slice(0, 200)}

Return ONLY valid JSON, no markdown, no explanation:
{
  "layout": "validation|analytics|clinical|finance|standard",
  "accentColor": "#hexcolor",
  "defaultChartType": "bar|line|area|pie",
  "showComparison": true_or_false,
  "source1Label": "label for first source",
  "source2Label": "label for second source",
  "validationMode": true_or_false,
  "summaryText": "one sentence dashboard description"
}

Rules:
- validationMode=true when department does data validation, reconciliation, or audit
- showComparison=true when 2+ data sources are compared
- accentColor: red=#e15f5f for validation/errors, blue=#5b8def for analytics, green=#5fb878 for clinical, amber=#e8a838 for finance/projection
- layout "validation" for reconciliation/audit depts`,
    }],
    temperature: 0.2,
    max_completion_tokens: 350,
  });

  const raw = response.choices[0].message.content.trim();
  const jsonStr = raw.replace(/^```json\n?/, '').replace(/^```\n?/, '').replace(/\n?```$/, '');
  try {
    return JSON.parse(jsonStr);
  } catch {
    return {
      layout: srcCount >= 2 ? 'comparison' : 'standard',
      accentColor: '#5b8def',
      defaultChartType: 'bar',
      showComparison: srcCount >= 2,
      validationMode: false,
      summaryText: `${name} Analytics Dashboard`,
    };
  }
}

// ─── Compact DVL spec (reference example shown to GPT) ───────────────────────
const DVL_REFERENCE_SPEC = `{"theme":{"accent":"#5a7dff","accent2":"#8b5cf6"},"header":{"title":"DVL Validation Console","subtitle":"BIRC · Q1 2026","badge":"Engine Active","badgeColor":"#3ddc97","icon":"shield-check"},"stats":[{"label":"Total Records","value":"275","sub":"273 validated","icon":"database","color":"#7aa2ff"},{"label":"Mismatches","value":"30","sub":"month+structural","icon":"activity","color":"#ffb648"},{"label":"Projection Accuracy","value":"93%","sub":"vs monthly goals","icon":"trending-up","color":"#3ddc97"}],"tabs":[{"id":"overview","label":"Overview","rows":[{"cols":2,"widgets":[{"type":"bar","title":"Month DVL vs Projection","xKey":"month","series":[{"key":"dvl","label":"DVL Actual","color":"#5a7dff"},{"key":"proj","label":"Proj Goal","color":"#3ddc97"}],"data":[{"month":"Jan","dvl":96,"proj":70},{"month":"Feb","dvl":72,"proj":71}],"footer":{"type":"delta","items":[{"label":"Jan","delta":26,"status":"Critical"},{"label":"Feb","delta":1,"status":"Pass"}]}},{"type":"hbar","title":"Visit Distribution","valueKey":"v","data":[{"name":"Screening","v":67},{"name":"Follow Up","v":62}]}]},{"cols":2,"widgets":[{"type":"gauge","title":"Projection Accuracy","value":93,"color":"#3ddc97","suffix":"%","desc":"Q1 2026 goal closeness"},{"type":"line","title":"Subjects/Month","xKey":"m","series":[{"key":"s","label":"Subjects","color":"#7aa2ff"}],"data":[{"m":"Jan","s":59},{"m":"Feb","s":61}]}]}]},{"id":"alerts","label":"Critical Alerts","rows":[{"cols":1,"widgets":[{"type":"alerts","items":[{"severity":"Critical","title":"31 duplicate visit keys","where":"BIRC Jan-Mar","msg":"Same Subject+Protocol+Date+Visit repeated"},{"severity":"Warning","title":"Screening under-target","where":"Q1 BIRC","msg":"67 of 148 goal (45%)"}]},{"type":"note","title":"Recommended Fixes","items":["De-duplicate the 31 repeated visit keys","Complete the 2 incomplete records"]}]}]}]}`;

export async function generateDashboardSpec({ name, tag, description, businessContext, systemPrompt, dataSourceNames, sheetSummaries }) {
  const formatSummaries = (summaries) => {
    if (!summaries || !summaries.length) return 'No data sources connected.';
    return summaries.map(s => {
      const numCols = s.colStats?.filter(c => c.type === 'numeric').map(c =>
        `    ${c.header}: sum=${c.sum}, min=${c.min}, max=${c.max}, avg=${c.avg}, count=${c.count}`
      ).join('\n') || '';
      const catCols = s.colStats?.filter(c => c.type === 'categorical').map(c =>
        `    ${c.header}: ${c.totalUnique} unique values, top=[${(c.topValues || []).slice(0, 5).join(', ')}]`
      ).join('\n') || '';
      return `  [${s.sourceName || 'Data'} › ${s.sheetName}] — ${s.totalRows} rows\n${numCols ? '  Numeric columns:\n' + numCols : ''}${catCols ? '\n  Categorical columns:\n' + catCols : ''}`;
    }).join('\n\n');
  };

  // Summaries are already stats (not raw data) — simply truncate if oversized.
  // Max 30k chars leaves plenty of room in the prompt for the spec schema + rules.
  const MAX_SUMMARY_CHARS = 30_000;
  let formattedSummaries = formatSummaries(sheetSummaries);
  if (formattedSummaries.length > MAX_SUMMARY_CHARS) {
    const cut = formattedSummaries.lastIndexOf('\n\n', MAX_SUMMARY_CHARS);
    formattedSummaries = formattedSummaries.slice(0, cut > 0 ? cut : MAX_SUMMARY_CHARS)
      + '\n\n[Further sheets omitted — use the numbers above for chart values]';
  }

  const prompt = `You are a data analyst dashboard designer for a biopharma CRA analytics platform.

REFERENCE EXAMPLE (DVL Validation Department — match this quality and format for your output):
${DVL_REFERENCE_SPEC}

YOUR TASK: Generate a dashboardSpec JSON for the new department below. Use REAL numbers computed from the DATA SUMMARIES. Never fabricate data.

DEPARTMENT INFO:
Name: ${name}
Tag: ${tag || ''}
Description: ${description}
Business Context: ${businessContext}
System Prompt Focus: ${systemPrompt}
Data Sources: ${(dataSourceNames || []).join(', ') || 'None connected'}

DATA SUMMARIES (real computed stats from each sheet — use these exact numbers in charts/stats):
${formattedSummaries}

SPEC SCHEMA (follow exactly):
{
  "theme": {"accent":"#hex","accent2":"#hex"},
  "header": {"title":"string","subtitle":"string","badge":"string","badgeColor":"#hex","icon":"shield-check|database|activity|bar-chart|trending-up|layers|target|users|zap"},
  "stats": [{"label":"string","value":"string","sub":"string","icon":"string","color":"#hex"}],
  "tabs": [{"id":"string","label":"string","rows":[{"cols":1|2,"widgets":[WIDGET]}]}]
}

WIDGET types (use as needed):
{"type":"bar","title":"","xKey":"fieldName","series":[{"key":"","label":"","color":"#hex"}],"data":[{xKey:val,...}],"footer":{"type":"delta","items":[{"label":"","delta":0,"status":"Critical|Warning|Minor|Pass"}]}}
{"type":"hbar","title":"","valueKey":"v","data":[{"name":"","v":0}]}
{"type":"line","title":"","xKey":"","series":[{"key":"","label":"","color":"#hex"}],"data":[{...}]}
{"type":"gauge","title":"","value":0,"color":"#hex","desc":"","suffix":"%"}
{"type":"table","title":"","desc":"","columns":[{"key":"","label":"","mono":false,"colored":false,"cellType":"progress|pill"}],"rows":[{...}],"note":""}
{"type":"alerts","items":[{"severity":"Critical|Warning|Minor|Pass","title":"","where":"","msg":""}]}
{"type":"cards","title":"","items":[{"status":"","title":"","scope":"","detail":""}]}
{"type":"note","title":"","items":["string"]}

RULES:
1. Use ONLY numbers from DATA SUMMARIES — if no data, use reasonable placeholder values but mark them as estimates
2. Choose accent colors: red=#e15f5f for validation/errors, blue=#5b8def for analytics, green=#5fb878 for clinical, amber=#e8a838 for finance/projections
3. For validation/reconciliation: include Overview, Reconciliation/Comparison, and Alerts tabs
4. For analytics/reporting: include Overview, KPIs/Trends, and Data Detail tabs
5. Include 3-5 stat cards with meaningful values from the data
6. Use cols:2 for chart pairs, cols:1 for tables/alerts
7. Make charts use real column names and values from summaries
8. Icon options for stats: database, activity, trending-up, layers, file-warning, target, users, shield-check

Return ONLY valid JSON — no markdown, no explanation, no \`\`\`.`;

  const response = await tryCreate({
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_completion_tokens: 4000,
  });

  const raw = response.choices[0].message.content.trim()
    .replace(/^```json\n?/, '').replace(/^```\n?/, '').replace(/\n?```$/, '');
  try {
    return JSON.parse(raw);
  } catch {
    // If JSON is malformed, try to extract the JSON object
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch {}
    }
    // Return a minimal fallback spec
    return {
      theme: { accent: '#5b8def', accent2: '#8b5cf6' },
      header: { title: name, subtitle: 'Analytics Dashboard', badge: 'Active', badgeColor: '#3ddc97', icon: 'bar-chart' },
      stats: [{ label: 'Department', value: name, sub: 'Analytics ready', icon: 'database', color: '#5b8def' }],
      tabs: [{ id: 'overview', label: 'Overview', rows: [{ cols: 1, widgets: [{ type: 'note', title: 'Dashboard Ready', items: ['Connect data sources and re-analyze to see full analytics.'] }] }] }],
    };
  }
}

// ─── Validation Dashboard Analysis ───────────────────────────────────────────

function sheetToText(name, rows, maxRows = 800) {
  if (!rows || rows.length < 1) return `=== ${name} ===\n(empty sheet)`;
  const headers = rows[0] || [];
  const data = rows.slice(1, maxRows + 1);
  const truncated = rows.length - 1 > maxRows;

  // Drop completely empty columns — reduces prompt size significantly
  const activeCols = headers
    .map((h, i) => ({ i, h: String(h ?? '') }))
    .filter(({ i }) => data.some(r => String(r[i] ?? '').trim() !== ''));

  const filteredHeaders = activeCols.map(c => c.h);
  return `=== ${name} (${rows.length - 1} data rows${truncated ? `, first ${maxRows} shown` : ''}) ===\n` +
    filteredHeaders.join(' | ') + '\n' +
    data.map(r => activeCols.map(({ i }) => String(r[i] ?? '')).join(' | ')).join('\n');
}

export async function generateValidationDashboard({ dvlSheet, projSheet }) {
  // Adaptive row reduction: keep halving DVL rows until total fits in ~80k chars
  const MAX_COMBINED_CHARS = 80_000;
  let dvlMaxRows = 500;
  let projMaxRows = 200;
  let dvlText  = sheetToText(dvlSheet.sheetName,  dvlSheet.rows,  dvlMaxRows);
  let projText = sheetToText(projSheet.sheetName, projSheet.rows, projMaxRows);

  while ((dvlText.length + projText.length) > MAX_COMBINED_CHARS && dvlMaxRows > 80) {
    dvlMaxRows = Math.floor(dvlMaxRows * 0.65);
    dvlText = sheetToText(dvlSheet.sheetName, dvlSheet.rows, dvlMaxRows);
    console.warn(`[Validation] Data too large — reducing DVL to ${dvlMaxRows} rows`);
  }

  console.log(`[Validation] DVL sheet: "${dvlSheet.sheetName}" — total ${dvlSheet.rows.length - 1} rows, sending ${Math.min(dvlMaxRows, dvlSheet.rows.length - 1)} rows, ${dvlText.length.toLocaleString()} chars`);
  console.log(`[Validation] Proj sheet: "${projSheet.sheetName}" — total ${projSheet.rows.length - 1} rows, sending ${Math.min(projMaxRows, projSheet.rows.length - 1)} rows, ${projText.length.toLocaleString()} chars`);
  console.log(`[Validation] Combined prompt size: ~${(dvlText.length + projText.length + 2000).toLocaleString()} chars (~${Math.round((dvlText.length + projText.length + 2000) / 4).toLocaleString()} tokens)`);

  const prompt = `You are a CRA (Clinical Research Associate) data validation analyst for a biopharma clinical trials site.

TASK: Analyze the two sheets below and return a structured JSON dashboard. Use ONLY numbers from the actual data — never fabricate.

=== PROJECTION SHEET ===
${projText}

=== DVL SHEET (Data Verification Log) ===
${dvlText}

=== GOALS LOGIC (CRITICAL) ===
The projection sheet has "Original Goals" and "Updated Goals" column groups (or separate sections/rows labeled as such).
RULE 1: Check every "Updated Goals" cell. If ALL Updated Goals values = 0 → set goalsLogic="original" and use Original Goals for all calculations.
RULE 2: If ANY Updated Goals row has a non-zero value → set goalsLogic="updated". For each row: use Updated Goal if non-zero, else use Original Goal.
RULE 3: If any row's Updated Goal is LESS than its Original Goal (a reduction), use Updated Goals for the entire sheet.

=== WHAT TO EXTRACT ===
From PROJECTION: effective goals per protocol (screening goal, rand goal, total visit goal), sum them for KPIs.
From DVL: count ALL visits (total tally), then break down by visit type (Screening, Randomization, Follow-up, Pre-screening, Unscheduled, Procedure), by PI, by protocol.
For WEEKLY: group DVL visit dates into consecutive weekly ranges based on date column. Label W1, W2, W3... assign month as "jan"/"feb"/"mar"/"apr"/"may"/"jun"/"jul"/"aug"/"sep"/"oct"/"nov"/"dec".
For KPIs: totalVisitsAchieved = sum from projection "achieved/actual" column if present, else count DVL screening+rand+fu types only (not pre-screen/unscheduled/procedures to match projection definition).
achievementPct = Math.round((totalVisitsAchieved / totalVisitGoal) * 100).

Return ONLY valid JSON — no markdown, no explanation, no \`\`\`:
{
  "header": { "site": "string", "period": "string e.g. Q2 2026", "goalsLogic": "original|updated|mixed", "goalsNote": "string" },
  "kpis": {
    "totalVisitGoal": 0,
    "totalVisitsAchieved": 0,
    "totalVisitsRemaining": 0,
    "dvlTotalTally": 0,
    "achievementPct": 0,
    "screeningGoalTotal": 0,
    "screeningAchieved": 0,
    "randGoalTotal": 0,
    "randAchieved": 0
  },
  "piBreakdown": [{ "pi": "", "visits": 0, "screens": 0, "rands": 0, "fu": 0 }],
  "protocols": [{ "pi": "", "protocol": "", "indication": "", "isActive": true, "q2Goal": 0, "screenGoal": 0, "randGoal": 0, "screenActual": 0, "randActual": 0 }],
  "weekly": [{ "week": "W1", "dates": "Jan 1-7", "total": 0, "screens": 0, "rands": 0, "fu": 0, "pre": 0, "month": "jan" }],
  "alerts": [{ "type": "success|warn|info|danger", "title": "", "message": "" }],
  "fieldComparison": [{ "field": "", "projVal": "", "dvlVal": "", "status": "match|warn|mismatch|note|neutral", "note": "" }],
  "protocolScreenComparison": [{ "protocol": "", "pi": "", "screenGoal": 0, "screenActual": 0, "status": "met|under|over" }]
}`;

  const response = await tryCreate({
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
    max_completion_tokens: 4000,
  });

  const raw = response.choices[0].message.content.trim()
    .replace(/^```json\n?/, '').replace(/^```\n?/, '').replace(/\n?```$/, '');
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) { try { return JSON.parse(match[0]); } catch {} }
    throw new Error('GPT returned invalid JSON for validation dashboard. Try again.');
  }
}

export async function briefChat({ context, question }) {
  const response = await tryCreate({
    messages: [
      {
        role: 'system',
        content: 'You are a biopharma data analyst explaining dashboard widgets. Give a clear, plain English explanation in 4-5 sentences. No markdown, no bullet points, no headers. Be specific about what the numbers mean, which data source they come from, and why they matter for clinical research.',
      },
      { role: 'user', content: `${context}\n\nExplain: ${question}` },
    ],
    temperature: 0.4,
    max_completion_tokens: 160,
  });
  return response.choices[0].message.content.trim();
}

