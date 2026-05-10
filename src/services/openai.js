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
- Use markdown tables for any comparative or tabular data (| Col | Col |)
- Use > blockquote for important notes or warnings
- Keep paragraphs short and justify content clearly
- Never output raw ### or ** without formatting intent
- Respond in the same language the user writes in (Urdu or English)
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

export async function chatWithBot({ systemPrompt, messages, dataContext = '' }) {
  const systemContent = [
    systemPrompt,
    FORMAT_INSTRUCTIONS,
    MEMORY_INSTRUCTIONS,
    dataContext ? `--- DATA CONTEXT ---\n${dataContext}` : '',
  ].filter(Boolean).join('\n\n');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemContent },
      ...messages,
    ],
    temperature: 0.7,
    max_tokens: 1500,
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
        content: `Create a professional AI assistant system prompt for a ${name} department in a Clinical Research Associate (CRA) biopharma company.

Department Name: ${name}
Description: ${description}
Business Context: ${businessContext}

The prompt should:
- Define the bot's role and expertise clearly
- Specify what questions it can answer
- Set professional tone for pharma/clinical research
- Guide it to analyze data from Excel/Google Sheets
- Instruct it to give precise, data-driven answers
- Always format responses using markdown: ## headings, **bold** for key data, bullet lists, and tables for comparisons
- Respond in the user's language (Urdu or English)

Write only the system prompt text, nothing else.`,
      },
    ],
    temperature: 0.6,
    max_tokens: 800,
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
Use the provided data context to populate the tables accurately. Create multiple sheets if the data has multiple categories.`,
      },
      {
        role: 'user',
        content: `Data Context:\n${dataContext}\n\nUser Request: ${userRequest}\n\nReturn ONLY valid JSON.`,
      },
    ],
    temperature: 0.2,
    max_tokens: 3000,
  });

  const raw = response.choices[0].message.content.trim();
  const jsonStr = raw.replace(/^```json\n?/, '').replace(/^```\n?/, '').replace(/\n?```$/, '');
  return JSON.parse(jsonStr);
}

export default openai;
