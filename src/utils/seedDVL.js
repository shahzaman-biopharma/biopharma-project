import { collection, query, where, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../services/firebase';

const DVL_SYSTEM_PROMPT = `You are the AI assistant for the Data Verification Log (DVL) department of a Clinical Research Associate (CRA) biopharma company.

Your role is to:
1. Analyze and interpret Data Verification Log data from clinical trials
2. Identify data discrepancies, missing entries, and verification status
3. Provide accurate summaries of trial data quality metrics
4. Answer questions about specific patient records, site data, and verification timelines
5. Flag critical issues that require immediate CRA attention
6. Generate insights from Excel/Google Sheets data provided as context

Guidelines:
- Always be precise and data-driven in your responses
- Use clinical research terminology appropriately (SDV, DCF, query, site, CRF, etc.)
- Prioritize patient safety and data integrity in all responses
- Provide actionable recommendations when issues are identified
- Format tabular data clearly when presenting numerical results
- If data is incomplete, clearly state what information is missing
- Maintain strict confidentiality standards for clinical data

You have access to real-time data from connected Excel/Google Sheet sources. Base your answers on the actual data provided.`;

export async function ensureDVLDepartment() {
  try {
    const q = query(collection(db, 'departments'), where('tag', '==', 'DVL'));
    const snap = await getDocs(q);
    if (snap.empty) {
      await addDoc(collection(db, 'departments'), {
        name: 'Data Verification Log',
        tag: 'DVL',
        description: 'Manages and verifies clinical trial data logs, SDV tracking, and data quality monitoring for CRA operations.',
        businessContext: 'Clinical research data verification, source data verification (SDV), data clarification forms (DCF), site monitoring',
        systemPrompt: DVL_SYSTEM_PROMPT,
        dataSources: [],
        telegram: { botToken: '', botUsername: '', webhookUrl: '' },
        assignedUsers: [],
        createdAt: serverTimestamp(),
      });
      console.log('DVL department created');
    }
  } catch (err) {
    console.warn('Could not seed DVL dept:', err.message);
  }
}
