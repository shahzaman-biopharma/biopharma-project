import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: import.meta.env.VITE_OPENAI_API_KEY,
  dangerouslyAllowBrowser: true,
});

const FORMAT_INSTRUCTIONS = `
FORMATTING RULES (always follow):
- Use **bold** for important terms, numbers, and key findings
- Use ## for main sections, ### for subsections
- Use bullet points (- item) for lists — never run them together in a sentence
- Use numbered lists (1. 2. 3.) for steps or ranked items
- Use markdown tables (| Col | Col |) for any tabular or comparative data
- Use > blockquote for important notes or warnings
- Keep paragraphs short and clear
- Respond in the same language the user writes in (Urdu or English)

MULTI-SHEET DATA INTELLIGENCE (critical — always follow):
- All data is in the DATA CONTEXT section; each tab is labeled === Sheet: [Name] ===
- SHEET INDEX in context lists all available sheet names
- "konsi sheets hain" / "list sheets" / "what data available" → list ALL sheet names with a brief description of what each contains
- "blend" / "merge" / "combine" / "A∪B" / "union" → produce ONE combined table with ALL rows from all specified sheets (remove only exact duplicate rows)
- "intersect" / "A∩B" / "common rows" → show rows present in ALL specified sheets matched on the key column
- "compare" / "difference" / "A-B" → show what exists in one sheet but not the other
- When a specific sheet is named → use ONLY that sheet's data
- When no sheet is specified → use ALL sheets intelligently
- Always label which sheet data came from when showing multi-sheet results
- You CAN filter, sort, sum, count, average, group-by, pivot on any column in any sheet
- You CAN find trends, anomalies, top/bottom N, date ranges across any sheet
`;

const MEMORY_INSTRUCTIONS = `
CONVERSATION MEMORY (critical — always follow):
- You have the recent conversation history available to you
- When user says "jo tumne diya", "woh data", "pehle wali list", "us mein se", "same data mein", "that data", "the list you gave" — they mean something from YOUR previous message in this conversation
- Find that previous response in history and use it as the base for your answer
- If user asks to remove/add/modify something from previously given data → apply the change and return the complete updated result with clear indication of what changed
- If user asks a follow-up without providing new data → use conversation history, never ask the user to repeat information already shared in this session
- Never say "please provide the data again" if it was already given in this conversation
`;

const VOICE_INSTRUCTIONS = `
VOICE MODE — STRICT RULES (override all formatting rules):
- LANGUAGE: Always respond in English only, no matter what language the user speaks
- LENGTH: Maximum 2-3 sentences — be concise and conversational
- FORMAT: Plain prose only — absolutely no markdown, no **, no ##, no bullet points, no tables
- TONE: Natural, warm, spoken-word style as if talking face to face
`;

export async function chatWithBot({ systemPrompt, messages, dataContext = '', voiceMode = false }) {
  const systemContent = [
    systemPrompt,
    voiceMode ? VOICE_INSTRUCTIONS : FORMAT_INSTRUCTIONS,
    MEMORY_INSTRUCTIONS,
    dataContext ? `--- DATA CONTEXT ---\n${dataContext}` : '',
  ].filter(Boolean).join('\n\n');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemContent },
      ...messages,
    ],
    temperature: 0.4,
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
