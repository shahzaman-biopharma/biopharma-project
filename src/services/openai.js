import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: import.meta.env.VITE_OPENAI_API_KEY,
  dangerouslyAllowBrowser: true,
});

// ─── Data accuracy — highest priority, placed first in system prompt ──────────
const DATA_ACCURACY_RULES = `
╔══════════════════════════════════════════════════════════════════════╗
║  DATA ACCURACY — ABSOLUTE RULES — OVERRIDE EVERYTHING ELSE          ║
╚══════════════════════════════════════════════════════════════════════╝

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
   - If something is not in the DATA CONTEXT, respond:
     "This entry/value is not present in the current connected data."
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

export async function chatWithBot({ systemPrompt, userMessage, dataContext = '', voiceMode = false }) {
  const systemContent = [
    dataContext ? DATA_ACCURACY_RULES : '',
    systemPrompt,
    voiceMode ? VOICE_INSTRUCTIONS : FORMAT_INSTRUCTIONS,
    dataContext
      ? `--- DATA CONTEXT (LIVE — fetched right now from connected source) ---\n${dataContext}`
      : '',
  ].filter(Boolean).join('\n\n');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemContent },
      { role: 'user', content: userMessage },
    ],
    temperature: 0.2,
    max_tokens: 2500,
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

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.5,
    max_tokens: 3000,
  });

  return response.choices[0].message.content;
}

export async function generateDepartmentPrompt({ name, description, businessContext }) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
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
    max_tokens: 1500,
  });

  return response.choices[0].message.content;
}

export async function generateFileData({ userRequest, dataContext, departmentName }) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
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
    max_tokens: 4000,
  });

  const raw = response.choices[0].message.content.trim();
  const jsonStr = raw.replace(/^```json\n?/, '').replace(/^```\n?/, '').replace(/\n?```$/, '');
  return JSON.parse(jsonStr);
}

export default openai;
