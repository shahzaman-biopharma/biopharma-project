import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: import.meta.env.VITE_OPENAI_API_KEY,
  dangerouslyAllowBrowser: true,
});

export async function chatWithBot({ systemPrompt, messages, dataContext = '' }) {
  const systemContent = dataContext
    ? `${systemPrompt}\n\n--- DATA CONTEXT ---\n${dataContext}`
    : systemPrompt;

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
  const prompt = `You are a professional report generator for ${departmentName} department in a Clinical Research Associate (CRA) company.

Generate a detailed ${reportType} report based on the following data:

${dataContext}

Department System Context:
${systemPrompt}

Create a comprehensive, professional report with:
1. Executive Summary
2. Key Metrics & Performance Indicators
3. Data Analysis
4. Issues & Findings
5. Recommendations
6. Next Steps

Format with clear sections and bullet points. Be specific with numbers and data.`;

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
- Keep responses professional and concise

Write only the system prompt, nothing else.`,
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
