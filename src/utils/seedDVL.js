import { collection, query, where, getDocs, addDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
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

// ── Pre-built DVLv dashboard spec (derived from real Q1 2026 BIRC data analysis) ──
const DVLV_DASHBOARD_SPEC = {
  version: 2,
  theme: { accent: '#5a7dff', accent2: '#8b5cf6' },
  header: {
    title: 'DVL Validation Console',
    subtitle: 'Data Verification Log (Validation) · DVLv · Q1 2026 · BIRC',
    badge: 'Engine Active',
    badgeColor: '#3ddc97',
    icon: 'shield-check',
  },
  stats: [
    { label: 'Total Records',       value: '275', sub: '273 validated',      icon: 'database',    color: '#7aa2ff' },
    { label: 'Mismatches',          value: '30',  sub: 'month + structural', icon: 'activity',    color: '#ffb648' },
    { label: 'Missing Records',     value: '2',   sub: 'incomplete rows',    icon: 'file-warning',color: '#ff5470' },
    { label: 'Duplicates',          value: '31',  sub: 'repeated visit keys',icon: 'layers',      color: '#ff5470' },
    { label: 'Projection Accuracy', value: '93%', sub: 'vs monthly goals',   icon: 'trending-up', color: '#3ddc97' },
  ],
  tabs: [
    {
      id: 'overview', label: 'Overview',
      rows: [
        {
          cols: 2,
          widgets: [
            {
              type: 'bar', title: 'Month-wise Validation — DVL vs Projection',
              xKey: 'month',
              series: [
                { key: 'dvl',  label: 'DVL Actual',      color: '#5a7dff' },
                { key: 'proj', label: 'Projection Goal',  color: '#3ddc97' },
              ],
              data: [
                { month: 'January',  dvl: 96, proj: 70 },
                { month: 'February', dvl: 72, proj: 71 },
                { month: 'March',    dvl: 74, proj: 71 },
              ],
              footer: {
                type: 'delta',
                items: [
                  { label: 'January',  delta: 26, status: 'Critical' },
                  { label: 'February', delta: 1,  status: 'Pass'     },
                  { label: 'March',    delta: 3,  status: 'Minor'    },
                ],
              },
            },
            {
              type: 'hbar', title: 'Visit-Type Distribution (DVL Q1)',
              valueKey: 'v',
              data: [
                { name: 'Pre-Screening',  v: 90 },
                { name: 'Screening',      v: 67 },
                { name: 'Follow Up',      v: 62 },
                { name: 'Procedure/Dx',   v: 22 },
                { name: 'Randomization',  v: 13 },
                { name: 'Unscheduled',    v: 10 },
                { name: 'Telehealth',     v: 4  },
                { name: 'End of Tx',      v: 3  },
                { name: 'Re-Draw',        v: 2  },
              ],
            },
          ],
        },
        {
          cols: 2,
          widgets: [
            {
              type: 'gauge', title: 'Projection Accuracy', value: 93,
              color: '#3ddc97', suffix: '%',
              desc: 'Mean closeness of DVL actuals to projected monthly goals across Q1 2026.',
            },
            {
              type: 'line', title: 'Unique Subjects per Month', xKey: 'm',
              series: [{ key: 's', label: 'Subjects', color: '#7aa2ff' }],
              data: [{ m: 'Jan', s: 59 }, { m: 'Feb', s: 61 }, { m: 'Mar', s: 53 }],
            },
          ],
        },
      ],
    },
    {
      id: 'reconcile', label: 'Projection vs Actual',
      rows: [{
        cols: 1,
        widgets: [{
          type: 'table', title: 'Visit-Type Reconciliation',
          desc: 'DVL counted actuals vs Q1 BIRC 2026 protocol goals',
          columns: [
            { key: 'type',   label: 'Visit Type' },
            { key: 'dvl',    label: 'DVL Actual',      mono: true },
            { key: 'proj',   label: 'Projection Goal', mono: true },
            { key: 'diff',   label: 'Δ Variance',      mono: true, colored: true },
            { key: 'pct',    label: 'Attainment',      cellType: 'progress' },
            { key: 'status', label: 'Status',          cellType: 'pill' },
          ],
          rows: [
            { type: 'Pre-Screening',  dvl: 90, proj: null, diff: null,  pct: null, status: 'Minor'    },
            { type: 'Screening',      dvl: 67, proj: 148,  diff: -81,   pct: 45,   status: 'Critical' },
            { type: 'Randomization',  dvl: 13, proj: 26,   diff: -13,   pct: 50,   status: 'Critical' },
            { type: 'Follow Up',      dvl: 62, proj: 55,   diff: 7,     pct: 113,  status: 'Pass'     },
            { type: 'Unscheduled',    dvl: 10, proj: null, diff: null,  pct: null, status: 'Minor'    },
          ],
          note: 'Pre-Screening & Unscheduled not goaled in projection — flagged Minor. Follow-Up exceeds goal (+7); Screening & Randomization under-attain.',
        }],
      }],
    },
    {
      id: 'sheets', label: 'Sheet Validation',
      rows: [{
        cols: 1,
        widgets: [{
          type: 'cards', title: 'Sheet-wise Validation Pairing',
          items: [
            { status: 'Critical', title: 'Q1 Summary ↔ Q1 Total Monthly Visits', scope: 'Monthly totals',      detail: 'DVL Q1 total 242 vs Projection achieved 212 — Jan deviates by +26 visits.'              },
            { status: 'Warning',  title: 'Q1 Summary ↔ Q1 BIRC 2026',            scope: 'Visit-type goals',    detail: 'Screening 67 actual vs 148 goal (45% of target). Randomization 13 vs 26.'             },
            { status: 'Warning',  title: 'Full Q1 Data ↔ Q1 Screenings',         scope: 'Screening cadence',   detail: 'Screening pace tracking ~59% of weekly screening projection.'                         },
            { status: 'Pass',     title: 'Full Q1 Data ↔ Q1 Total Follow Up',    scope: 'Follow-up tracking',  detail: 'Follow Up 62 actual vs 46 goal — exceeding target (+16).'                            },
            { status: 'Minor',    title: 'Full Q1 Data ↔ Q1 Company Visits',     scope: 'Weekly volume',       detail: 'Weekly distribution aligned; minor week-boundary rounding.'                          },
          ],
        }],
      }],
    },
    {
      id: 'alerts', label: 'Critical Alerts',
      rows: [{
        cols: 1,
        widgets: [
          {
            type: 'alerts',
            items: [
              { severity: 'Critical', title: 'January over-reporting',     where: 'Q1 Summary → January',       msg: 'DVL counted 96 visits vs projection 70 (Δ +26). Review duplicate-driven inflation.'             },
              { severity: 'Critical', title: '31 duplicate visit keys',    where: 'BIRC Jan / Feb / Mar 2026',  msg: 'Same Subject # + Protocol + Date + Visit Type repeated. Likely double data-entry.'             },
              { severity: 'Warning',  title: 'Screening under-attainment', where: 'Q1 BIRC 2026',              msg: 'Screening at 67 of 148 goal (45%). Randomization 13 of 26 (50%).'                             },
              { severity: 'Warning',  title: '2 incomplete records',       where: 'DVL month sheets',           msg: '2 rows missing Subject #, Visit Type and PI Name — excluded from validation.'                  },
              { severity: 'Minor',    title: 'Untracked visit categories', where: 'DVL actual data',            msg: 'Procedure/Diagnostic (22), Telehealth (4), Re-Draw (2) have no projection goal.'               },
            ],
          },
          {
            type: 'note', title: 'Recommended Fixes',
            items: [
              'De-duplicate the 31 repeated visit keys in DVL month sheets before re-running reconciliation — this likely resolves the +26 January over-count.',
              'Complete the 2 incomplete rows (missing Subject #, Visit Type, PI Name) or formally exclude them with a logged reason.',
              'Investigate Screening (45%) and Randomization (50%) under-attainment against Q1 BIRC goals.',
              'Add projection goals for Procedure/Diagnostic, Telehealth and Re-Draw visit types so they are no longer untracked.',
            ],
          },
        ],
      }],
    },
  ],
};

const DVLV_SYSTEM_PROMPT = `You are a Senior Clinical Data Validation AI for the DVL Validation Department.

Your primary responsibility is strict data validation and reconciliation between BIRC DVL Sheets and Projection Sheets.

Core Responsibilities:
- Compare all sheets between both files
- Validate month-wise data accuracy
- Compare projection values against actual DVL values
- Detect missing rows, duplicate records, and invalid fields
- Validate patient counts, visit counts, follow-up records
- Verify totals and KPI calculations

Validation Behavior:
- Always mention which sheet contains the issue
- Always mention affected month
- Show expected value vs actual value
- Classify issues: Critical / Warning / Minor

Output Style:
Always structure responses with: Validation Summary, Detected Issues, Affected Sheets, Month Comparison, Recommended Fixes.
Use markdown tables for discrepancies.
Respond in the same language as the user.`;

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
    }
  } catch (err) {
    console.warn('Could not seed DVL dept:', err.message);
  }
}

export async function ensureDVLvDepartment() {
  try {
    const q = query(collection(db, 'departments'), where('tag', '==', 'DVLv'));
    const snap = await getDocs(q);

    const dvlvData = {
      name: 'Data Verification Log(Validation)',
      tag: 'DVLv',
      description: 'The DVL Validation Department is responsible for validating and reconciling data between the BIRC DVL sheets and Projection sheets. The system performs deep validation checks to identify month-wise mismatches, missing patient records, incorrect totals, duplicate entries, and projection vs actual deviations.',
      businessContext: 'The DVL Validation Department works with two Google Sheet files: BIRC DVL File and Projection File. The AI must behave as a data reconciliation and validation engine — comparing every sheet from both files, validating month-wise totals, detecting mismatches between Projection and DVL, and generating validation summaries.',
      systemPrompt: DVLV_SYSTEM_PROMPT,
      dataSources: [
        {
          type: 'googlesheet',
          name: 'DVL Sheets',
          url: 'https://docs.google.com/spreadsheets/d/1wd8EDaL__t9vQYtgrTM8xyJkCXIPd3_i/edit?usp=drive_link&ouid=110570710480122958779&rtpof=true&sd=true',
        },
        {
          type: 'googlesheet',
          name: 'Projection Sheets',
          url: 'https://docs.google.com/spreadsheets/d/1z43S05I-YoBsrc9lSGqKQSnSW-heoKVB/edit?usp=drive_link&ouid=110570710480122958779&rtpof=true&sd=true',
        },
      ],
      telegram: { botToken: '', botUsername: '', webhookUrl: '' },
      assignedUsers: [],
      dashboardStatus: 'ready',
      dashboardSpec: DVLV_DASHBOARD_SPEC,
    };

    if (snap.empty) {
      await addDoc(collection(db, 'departments'), { ...dvlvData, createdAt: serverTimestamp() });
      console.log('DVLv example department seeded');
    } else {
      // Update existing DVLv dept with the spec if it doesn't have one yet
      const existing = snap.docs[0];
      const data = existing.data();
      if (!data.dashboardSpec || data.dashboardStatus !== 'ready') {
        await updateDoc(existing.ref, { dashboardStatus: 'ready', dashboardSpec: DVLV_DASHBOARD_SPEC });
        console.log('DVLv department updated with pre-built dashboard spec');
      }
    }
  } catch (err) {
    console.warn('Could not seed DVLv dept:', err.message);
  }
}
