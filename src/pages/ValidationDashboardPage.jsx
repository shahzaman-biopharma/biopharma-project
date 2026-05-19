import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getValidationSettings } from '../services/firestore';
import { fetchGoogleSheetRaw } from '../services/excel';
import { generateValidationDashboard } from '../services/openai';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  ShieldCheck, RotateCcw, Settings, Loader2, AlertTriangle,
  CheckCircle2, Info, ChevronRight, Database,
} from 'lucide-react';
import toast from 'react-hot-toast';

/* ── Palette (matches HTML mockup) ─────────────────────────────────────────── */
const P = {
  bg: '#0c0e13', card: '#13161d', line: 'rgba(255,255,255,0.07)',
  ink: '#f0f2f7', sub: '#8b90a0', faint: '#555b6e', deep: '#2a2f3c',
  green: '#4ade80', blue: '#60a5fa', amber: '#fbbf24', red: '#f87171',
  violet: '#a78bfa', teal: '#2dd4bf', orange: '#fb923c',
};
const COLORS = [P.green, P.blue, P.violet, P.amber, P.teal, P.red, P.orange];

/* ── Tiny shared components ─────────────────────────────────────────────────── */
function MCard({ label, value, sub, color = P.blue, accent }) {
  return (
    <div style={{ background: P.card, border: `0.5px solid ${P.line}`, borderRadius: 12, padding: '16px 18px', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, right: 0, width: 50, height: 50, borderRadius: '0 12px 0 50px', background: accent || color, opacity: 0.08 }} />
      <div style={{ fontSize: 12, color: P.sub, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.5px', color }}>{value ?? '—'}</div>
      {sub && <div style={{ fontSize: 11, color: P.faint, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function Card({ children, style }) {
  return (
    <div style={{ background: P.card, border: `0.5px solid ${P.line}`, borderRadius: 14, padding: '20px 22px', marginBottom: 16, ...style }}>
      {children}
    </div>
  );
}

function CardTitle({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 500, color: P.faint, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 16 }}>{children}</div>;
}

function Badge({ status }) {
  const cfg = {
    match:    { bg: 'rgba(74,222,128,0.12)',  color: P.green,  border: 'rgba(74,222,128,0.2)',  label: 'match' },
    warn:     { bg: 'rgba(251,191,36,0.12)',  color: P.amber,  border: 'rgba(251,191,36,0.2)',  label: 'warn' },
    mismatch: { bg: 'rgba(248,113,113,0.12)', color: P.red,    border: 'rgba(248,113,113,0.2)', label: 'mismatch' },
    note:     { bg: 'rgba(96,165,250,0.12)',  color: P.blue,   border: 'rgba(96,165,250,0.2)',  label: 'note' },
    neutral:  { bg: 'rgba(139,144,160,0.1)',  color: P.sub,    border: 'rgba(139,144,160,0.15)',label: '—' },
    met:      { bg: 'rgba(74,222,128,0.12)',  color: P.green,  border: 'rgba(74,222,128,0.2)',  label: 'met' },
    under:    { bg: 'rgba(248,113,113,0.12)', color: P.red,    border: 'rgba(248,113,113,0.2)', label: 'under' },
    over:     { bg: 'rgba(251,191,36,0.12)',  color: P.amber,  border: 'rgba(251,191,36,0.2)',  label: 'over' },
  };
  const c = cfg[status] || cfg.neutral;
  return (
    <span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 20, fontWeight: 500, whiteSpace: 'nowrap', display: 'inline-block', background: c.bg, color: c.color, border: `1px solid ${c.border}` }}>
      {c.label}
    </span>
  );
}

function AlertBanner({ type, title, message }) {
  const cfg = {
    success: { bg: 'rgba(74,222,128,0.06)',  border: 'rgba(74,222,128,0.15)',  color: P.green, icon: <CheckCircle2 size={15} /> },
    warn:    { bg: 'rgba(251,191,36,0.06)',  border: 'rgba(251,191,36,0.15)',  color: P.amber, icon: <AlertTriangle size={15} /> },
    info:    { bg: 'rgba(96,165,250,0.06)',  border: 'rgba(96,165,250,0.15)',  color: P.blue,  icon: <Info size={15} /> },
    danger:  { bg: 'rgba(248,113,113,0.06)', border: 'rgba(248,113,113,0.15)', color: P.red,   icon: <AlertTriangle size={15} /> },
  };
  const c = cfg[type] || cfg.info;
  return (
    <div style={{ display: 'flex', gap: 12, borderRadius: 10, padding: '12px 16px', marginBottom: 12, fontSize: 13, background: c.bg, border: `1px solid ${c.border}`, color: c.color, alignItems: 'flex-start' }}>
      <span style={{ flexShrink: 0, marginTop: 1 }}>{c.icon}</span>
      <div><strong>{title}:</strong> <span style={{ color: P.sub, marginLeft: 4 }}>{message}</span></div>
    </div>
  );
}

function ProgressRing({ pct, color = P.green }) {
  const r = 32, circ = 2 * Math.PI * r;
  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width={80} height={80} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={40} cy={40} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={6} />
        <circle cx={40} cy={40} r={r} fill="none" stroke={color} strokeWidth={6}
          strokeDasharray={circ} strokeDashoffset={circ * (1 - (pct || 0) / 100)} strokeLinecap="round" />
      </svg>
      <div style={{ position: 'absolute', fontSize: 14, fontWeight: 600, color: P.ink }}>{pct ?? 0}%</div>
    </div>
  );
}

/* ── STEP 1 & 2: Sheet selection ─────────────────────────────────────────────── */
function SelectSheetStep({ sheets, onSelect, stepLabel, stepNum, otherLabel }) {
  const grouped = sheets.reduce((acc, s) => {
    if (!acc[s.sourceName]) acc[s.sourceName] = [];
    acc[s.sourceName].push(s);
    return acc;
  }, {});

  return (
    <div style={{ background: P.bg, minHeight: '100%', padding: '32px 24px' }}>
      <div style={{ maxWidth: 580, margin: '0 auto' }}>
        {/* Progress dots */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 28 }}>
          {[1, 2].map((n, i) => (
            <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 600,
                background: n <= stepNum ? P.green : 'rgba(255,255,255,0.06)',
                color: n <= stepNum ? '#0c0e13' : P.faint,
                border: n === stepNum ? `2px solid ${P.green}` : '2px solid transparent',
              }}>{n}</div>
              {i === 0 && <div style={{ width: 40, height: 1.5, background: stepNum > 1 ? P.green : 'rgba(255,255,255,0.08)', borderRadius: 1 }} />}
            </div>
          ))}
          <span style={{ fontSize: 12, color: P.faint, marginLeft: 4 }}>Step {stepNum} of 2</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <ShieldCheck size={20} style={{ color: P.green }} />
          <h2 style={{ fontSize: 20, fontWeight: 600, color: P.ink, letterSpacing: '-0.4px' }}>
            Select <span style={{ color: P.green }}>{stepLabel}</span> Sheet
          </h2>
        </div>
        <p style={{ fontSize: 13, color: P.faint, marginBottom: 24 }}>
          {stepLabel === 'DVL' ? 'Select the Data Verification Log sheet containing visit records' : `Select the Projection sheet (${otherLabel ? `DVL: ${otherLabel} selected` : 'contains goals & targets'})`}
        </p>

        {sheets.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 0', color: P.faint, fontSize: 13 }}>
            No sheets loaded. Check your data source configuration in Settings → Validation.
          </div>
        ) : (
          Object.entries(grouped).map(([sourceName, sheetList]) => (
            <div key={sourceName} style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: P.sub, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>
                <Database size={11} />{sourceName}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {sheetList.map(sheet => (
                  <button key={sheet.sheetName} onClick={() => onSelect(sheet)} style={{
                    background: P.card, border: `0.5px solid ${P.line}`, borderRadius: 10,
                    padding: '12px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center',
                    justifyContent: 'space-between', transition: 'border-color 0.15s',
                    textAlign: 'left', width: '100%',
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = P.green}
                  onMouseLeave={e => e.currentTarget.style.borderColor = P.line}
                  >
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 500, color: P.ink }}>{sheet.sheetName}</div>
                      <div style={{ fontSize: 11, color: P.faint, marginTop: 2 }}>{(sheet.rows.length - 1)} rows · {(sheet.rows[0] || []).length} columns</div>
                    </div>
                    <ChevronRight size={16} style={{ color: P.faint }} />
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function AnalyzingScreen({ dvlName, projName }) {
  return (
    <div style={{ background: P.bg, minHeight: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: 32 }}>
      <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(74,222,128,0.1)', border: `1px solid rgba(74,222,128,0.25)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={28} style={{ color: P.green, animation: 'spin 1s linear infinite' }} />
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: P.ink, marginBottom: 6 }}>Analyzing & Validating Data…</div>
        <div style={{ fontSize: 13, color: P.faint, maxWidth: 360 }}>
          GPT is comparing <strong style={{ color: P.sub }}>{dvlName}</strong> against <strong style={{ color: P.sub }}>{projName}</strong> — checking goals logic, counting visits, identifying discrepancies.
        </div>
        <div style={{ fontSize: 11, color: P.deep, marginTop: 12 }}>This may take 15–30 seconds for large sheets.</div>
      </div>
      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

/* ── Overview Tab ────────────────────────────────────────────────────────────── */
function OverviewTab({ spec }) {
  const k = spec.kpis || {};
  const pi = spec.piBreakdown || [];
  const maxPiVisits = Math.max(1, ...pi.map(p => p.visits || 0));
  const piColors = [P.green, P.blue, P.violet, P.amber, P.teal, P.red, P.orange];

  return (
    <div>
      {(spec.alerts || []).filter(a => a.type === 'success').map((a, i) => (
        <AlertBanner key={i} type={a.type} title={a.title} message={a.message} />
      ))}

      {/* KPI row 1 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 12 }}>
        <MCard label="Total Visit Goal"      value={k.totalVisitGoal}      color={P.blue}   sub="Projection target" />
        <MCard label="Visits Achieved"       value={k.totalVisitsAchieved} color={P.green}  sub={`${k.achievementPct ?? 0}% complete`} />
        <MCard label="Visits Remaining"      value={k.totalVisitsRemaining} color={P.amber}  sub="To hit goal" />
        <MCard label="DVL Total Tally"       value={k.dvlTotalTally}        color={P.violet} sub="All DVL visit types" />
      </div>

      {/* KPI row 2 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 12 }}>
        <MCard label="Screening Goal"        value={k.screeningGoalTotal}  color={P.blue}   sub="Total Q goal" />
        <MCard label="Screenings Achieved"   value={k.screeningAchieved}   color={P.green}  sub="DVL actual" />
        <MCard label="Rand Goal"             value={k.randGoalTotal}        color={P.violet} sub="Total Q goal" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
        <MCard label="Randomizations Done"   value={k.randAchieved}         color={P.green}  sub="DVL actual" />
        <MCard label="Rand Remaining"        value={(k.randGoalTotal || 0) - (k.randAchieved || 0)} color={P.amber} sub="To hit goal" />
        <MCard label="Achievement"           value={`${k.achievementPct ?? 0}%`} color={k.achievementPct >= 80 ? P.green : k.achievementPct >= 50 ? P.amber : P.red} sub="Visit goal progress" />
      </div>

      {/* Progress */}
      <Card>
        <CardTitle>Visit Goal Progress</CardTitle>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <ProgressRing pct={k.achievementPct} color={k.achievementPct >= 80 ? P.green : k.achievementPct >= 50 ? P.amber : P.red} />
          <div style={{ flex: 1 }}>
            <div style={{ height: 8, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
              <div style={{ height: '100%', borderRadius: 4, width: `${Math.min(k.achievementPct || 0, 100)}%`, background: 'linear-gradient(90deg, #4ade80, #22c55e)', transition: 'width 0.8s ease' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: P.faint }}>
              <span style={{ color: P.green }}>Achieved: {k.totalVisitsAchieved}</span>
              <span>Goal: {k.totalVisitGoal}</span>
              <span style={{ color: P.amber }}>Remaining: {k.totalVisitsRemaining}</span>
            </div>
          </div>
        </div>
      </Card>

      {/* PI bars */}
      {pi.length > 0 && (
        <Card>
          <CardTitle>PI Visit Volume — DVL (all types)</CardTitle>
          {pi.map((p, i) => (
            <div key={p.pi} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderBottom: i < pi.length - 1 ? `0.5px solid rgba(255,255,255,0.04)` : 'none' }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: P.ink, width: 80, flexShrink: 0 }}>{p.pi}</div>
              <div style={{ flex: 1, height: 5, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: 3, width: `${((p.visits || 0) / maxPiVisits) * 100}%`, background: piColors[i % piColors.length], transition: 'width 0.6s ease' }} />
              </div>
              <div style={{ fontSize: 12, color: P.sub, textAlign: 'right', flexShrink: 0 }}>
                <span style={{ color: P.ink, fontWeight: 500 }}>{p.visits}</span>
                {p.screens > 0 && <span> · {p.screens} screens</span>}
                {p.rands > 0  && <span> · {p.rands} rands</span>}
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

/* ── Protocols Tab ───────────────────────────────────────────────────────────── */
function ProtocolsTab({ spec, piFilter, onPIFilter }) {
  const protos = spec.protocols || [];
  const pis = ['all', ...new Set(protos.map(p => p.pi).filter(Boolean))];
  const filtered = piFilter === 'all' ? protos : protos.filter(p => p.pi === piFilter);

  return (
    <div>
      {/* PI filter */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: P.faint, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Filter PI:</span>
        {pis.map(pi => (
          <button key={pi} onClick={() => onPIFilter(pi)} style={{
            padding: '6px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
            background: piFilter === pi ? '#1a1e28' : 'transparent',
            color: piFilter === pi ? P.ink : P.faint,
            border: piFilter === pi ? `1px solid rgba(255,255,255,0.12)` : `1px solid ${P.line}`,
            fontWeight: piFilter === pi ? 500 : 400,
            transition: 'all 0.15s',
          }}>
            {pi === 'all' ? 'All' : pi}
          </button>
        ))}
      </div>

      <Card style={{ overflowX: 'auto', marginBottom: 16 }}>
        {/* Header */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.2fr 0.8fr 0.7fr 0.7fr 0.7fr 1fr', gap: 8, paddingBottom: 8, borderBottom: `0.5px solid rgba(255,255,255,0.1)`, marginBottom: 4 }}>
          {['Protocol', 'Indication', 'Status', 'Q Goal', 'Screen', 'Rand', 'Badge'].map(h => (
            <span key={h} style={{ fontSize: 11, color: P.faint, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</span>
          ))}
        </div>
        {filtered.map((p, i) => {
          let badge = 'neutral', bLabel = 'pending';
          if (!p.isActive) { badge = 'neutral'; bLabel = 'follow-up'; }
          else if (p.screenActual > 0 || p.randActual > 0) { badge = 'match'; bLabel = 'active'; }
          else { badge = 'neutral'; bLabel = 'not started'; }
          return (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1.2fr 0.8fr 0.7fr 0.7fr 0.7fr 1fr', gap: 8, padding: '10px 0', borderBottom: i < filtered.length - 1 ? `0.5px solid rgba(255,255,255,0.04)` : 'none', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 500, color: P.ink, fontFamily: 'monospace' }}>{p.protocol}</div>
                <div style={{ fontSize: 11, color: P.sub, marginTop: 1 }}>{p.pi}</div>
              </div>
              <div style={{ fontSize: 11, color: P.sub }}>{p.indication || '—'}</div>
              <div style={{ fontSize: 11, color: p.isActive ? P.green : P.faint }}>
                {p.isActive ? '● Active' : '○ Follow-up'}
              </div>
              <div style={{ fontSize: 14, fontWeight: 500, color: (p.q2Goal || 0) > 0 ? P.ink : P.faint }}>{p.q2Goal || '—'}</div>
              <div style={{ fontSize: 14, fontWeight: 500, color: (p.screenActual || 0) > 0 ? P.blue : P.faint }}>{p.screenActual || '—'}</div>
              <div style={{ fontSize: 14, fontWeight: 500, color: (p.randActual || 0) > 0 ? P.green : P.faint }}>{p.randActual || '—'}</div>
              <Badge status={badge} />
            </div>
          );
        })}
        {filtered.length === 0 && <div style={{ fontSize: 13, color: P.faint, padding: '16px 0' }}>No protocols found.</div>}
      </Card>

      {/* Totals summary */}
      <Card>
        <CardTitle>Totals Summary</CardTitle>
        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
          {[
            { label: 'Total Visit Goal',     val: spec.kpis?.totalVisitGoal,      color: P.blue },
            { label: 'Screening Goal',        val: spec.kpis?.screeningGoalTotal,  color: P.blue },
            { label: 'Rand Goal',             val: spec.kpis?.randGoalTotal,       color: P.green },
            { label: 'Screens Achieved',      val: spec.kpis?.screeningAchieved,   color: P.amber },
            { label: 'Rands Achieved',        val: spec.kpis?.randAchieved,        color: P.green },
            { label: 'Visits Achieved',       val: spec.kpis?.totalVisitsAchieved, color: P.violet },
          ].map(t => (
            <div key={t.label} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.5px', color: t.color }}>{t.val ?? '—'}</div>
              <div style={{ fontSize: 11, color: P.faint, marginTop: 2 }}>{t.label}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ── Weekly Tab ──────────────────────────────────────────────────────────────── */
function WeeklyTab({ spec, monthFilter, onMonthFilter }) {
  const allWeeks = spec.weekly || [];
  const months = ['all', ...new Set(allWeeks.map(w => w.month).filter(Boolean))];
  const filtered = monthFilter === 'all' ? allWeeks : allWeeks.filter(w => w.month === monthFilter);
  const maxTotal = Math.max(1, ...filtered.map(w => w.total || 0));
  const sum = (key) => filtered.reduce((s, w) => s + (w[key] || 0), 0);

  const MONTH_LABELS = { jan:'January', feb:'February', mar:'March', apr:'April', may:'May', jun:'June', jul:'July', aug:'August', sep:'September', oct:'October', nov:'November', dec:'December' };

  return (
    <div>
      {/* Month filter */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
        {months.map(m => (
          <button key={m} onClick={() => onMonthFilter(m)} style={{
            padding: '6px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
            background: monthFilter === m ? '#1a1e28' : 'transparent',
            color: monthFilter === m ? P.ink : P.faint,
            border: monthFilter === m ? `1px solid rgba(255,255,255,0.12)` : `1px solid ${P.line}`,
            fontWeight: monthFilter === m ? 500 : 400, transition: 'all 0.15s',
          }}>
            {m === 'all' ? 'All Weeks' : (MONTH_LABELS[m] || m)}
          </button>
        ))}
      </div>

      {/* Summary KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        <MCard label="Total Visits"     value={sum('total')}   color={P.blue} />
        <MCard label="Screenings"       value={sum('screens')} color={P.green} />
        <MCard label="Randomizations"   value={sum('rands')}   color={P.violet} />
        <MCard label="Follow-ups"       value={sum('fu')}      color={P.amber} />
      </div>

      {/* Week cards */}
      {filtered.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))', gap: 10, marginBottom: 16 }}>
          {filtered.map((w, i) => {
            const isPeak = w.total === maxTotal;
            return (
              <div key={i} style={{ background: P.card, border: `0.5px solid ${isPeak ? 'rgba(74,222,128,0.3)' : P.line}`, borderRadius: 12, padding: '14px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 11, color: P.faint, fontFamily: 'monospace' }}>{w.week}</div>
                    <div style={{ fontSize: 10, color: P.deep, marginTop: 1 }}>{w.dates}</div>
                  </div>
                  {isPeak && <span style={{ fontSize: 10, color: P.green, background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.2)', borderRadius: 10, padding: '1px 7px' }}>peak</span>}
                </div>
                <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-1px', color: P.ink, marginBottom: 8 }}>{w.total}</div>
                {[
                  { color: P.blue,   label: 'Screen', val: w.screens },
                  { color: P.green,  label: 'Rand',   val: w.rands },
                  { color: '#6b7280',label: 'F/U',    val: w.fu },
                  { color: P.amber,  label: 'Pre',    val: w.pre },
                ].map(row => (
                  <div key={row.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, marginBottom: 2 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: row.color, flexShrink: 0 }} />
                    <span style={{ color: P.faint, width: 40 }}>{row.label}</span>
                    <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 2, width: `${w.total > 0 ? (row.val / w.total) * 100 : 0}%`, background: row.color }} />
                    </div>
                    <span style={{ color: P.sub, width: 16, textAlign: 'right' }}>{row.val || 0}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* Chart */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <CardTitle>Visit Volume Trend</CardTitle>
          <div style={{ display: 'flex', gap: 12, fontSize: 11, color: P.sub }}>
            {[['#3b82f6','Screen'],['#4ade80','Rand'],['#6b7280','F/U'],['#f59e0b','Pre']].map(([c,l]) => (
              <span key={l}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: c, marginRight: 4 }} />{l}</span>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={filtered} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="week" tick={{ fill: P.faint, fontSize: 10 }} />
            <YAxis tick={{ fill: P.faint, fontSize: 10 }} />
            <Tooltip contentStyle={{ background: '#1a1e28', border: `1px solid rgba(255,255,255,0.1)`, borderRadius: 8, color: P.ink }} />
            <Bar dataKey="screens" stackId="s" fill="#3b82f6" name="Screening" />
            <Bar dataKey="rands"   stackId="s" fill="#4ade80" name="Randomization" />
            <Bar dataKey="fu"      stackId="s" fill="#6b7280" name="Follow-up" />
            <Bar dataKey="pre"     stackId="s" fill="#f59e0b" name="Pre-screen" />
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}

/* ── Validation Tab ──────────────────────────────────────────────────────────── */
function ValidationTab({ spec }) {
  const comparisons = spec.protocolScreenComparison || [];

  return (
    <div>
      {(spec.alerts || []).map((a, i) => (
        <AlertBanner key={i} type={a.type} title={a.title} message={a.message} />
      ))}

      {/* Field comparison table */}
      <Card>
        <CardTitle>Field-by-field Comparison</CardTitle>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1.2fr 0.8fr 2fr', gap: 8, paddingBottom: 8, borderBottom: `0.5px solid rgba(255,255,255,0.1)`, marginBottom: 4 }}>
          {['Field', 'Projection', 'DVL / Actual', 'Match', 'Note'].map(h => (
            <span key={h} style={{ fontSize: 11, color: P.faint, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</span>
          ))}
        </div>
        {(spec.fieldComparison || []).map((row, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1.2fr 0.8fr 2fr', gap: 8, padding: '10px 0', borderBottom: i < (spec.fieldComparison.length - 1) ? `0.5px solid rgba(255,255,255,0.04)` : 'none', alignItems: 'center', fontSize: 13 }}>
            <span style={{ color: P.ink, fontWeight: 500 }}>{row.field}</span>
            <span style={{ color: P.sub, fontFamily: 'monospace', fontSize: 12 }}>{row.projVal}</span>
            <span style={{ color: P.sub, fontFamily: 'monospace', fontSize: 12 }}>{row.dvlVal}</span>
            <Badge status={row.status} />
            <span style={{ fontSize: 11, color: P.faint }}>{row.note}</span>
          </div>
        ))}
      </Card>

      {/* Protocol screen comparison */}
      {comparisons.length > 0 && (
        <Card>
          <CardTitle>Protocol: Screening Goal vs Actual</CardTitle>
          {comparisons.map((row, i) => {
            const pct = row.screenGoal > 0 ? Math.min((row.screenActual / row.screenGoal) * 100, 100) : 0;
            const barColor = row.status === 'met' ? P.green : row.status === 'over' ? P.amber : P.red;
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderBottom: i < comparisons.length - 1 ? `0.5px solid rgba(255,255,255,0.04)` : 'none' }}>
                <div style={{ fontSize: 12, color: P.ink, width: 220, flexShrink: 0 }}>{row.protocol} <span style={{ color: P.faint, fontSize: 11 }}>({row.pi})</span></div>
                <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', borderRadius: 2, width: `${pct}%`, background: barColor }} />
                </div>
                <div style={{ fontSize: 12, color: P.sub, textAlign: 'right', flexShrink: 0, minWidth: 130 }}>
                  Goal: <strong style={{ color: P.ink }}>{row.screenGoal}</strong> · Actual: <strong style={{ color: barColor }}>{row.screenActual}</strong>
                </div>
                <Badge status={row.status} />
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}

/* ── Main Page ───────────────────────────────────────────────────────────────── */
export default function ValidationDashboardPage() {
  const [pageState, setPageState] = useState('loading');
  const [sheets, setSheets] = useState([]);
  const [dvlSheet, setDvlSheet] = useState(null);
  const [projSheet, setProjSheet] = useState(null);
  const [spec, setSpec] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [piFilter, setPiFilter] = useState('all');
  const [monthFilter, setMonthFilter] = useState('all');
  const [errMsg, setErrMsg] = useState('');

  const { isAdmin } = useAuth();
  const navigate = useNavigate();

  const loadConfig = useCallback(async () => {
    try {
      const config = await getValidationSettings();
      if (!config?.dataSources?.length) { setPageState('no-config'); return; }
      setPageState('fetching');
      const loaded = [];
      for (const src of config.dataSources) {
        if (!src.url) continue;
        try {
          const { sheets: rawSheets } = await fetchGoogleSheetRaw(src.url);
          Object.entries(rawSheets).forEach(([sheetName, rows]) => {
            loaded.push({ sourceName: src.name || 'Data', sheetName, rows });
          });
        } catch (err) {
          console.warn(`Validation: cannot fetch "${src.name}":`, err.message);
        }
      }
      if (!loaded.length) { setErrMsg('Could not load any sheets from configured data sources.'); setPageState('error'); return; }
      setSheets(loaded);
      setPageState('select-dvl');
    } catch (err) {
      setErrMsg(err.message);
      setPageState('error');
    }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const handleDvlSelect = (sheet) => {
    setDvlSheet(sheet);
    setPageState('select-proj');
  };

  const handleProjSelect = async (sheet) => {
    setProjSheet(sheet);
    setPageState('analyzing');
    try {
      const result = await generateValidationDashboard({ dvlSheet, projSheet: sheet });
      setSpec(result);
      setActiveTab('overview');
      setPageState('ready');
    } catch (err) {
      toast.error('Analysis failed: ' + err.message);
      setPageState('select-dvl');
    }
  };

  const handleReset = () => {
    setDvlSheet(null);
    setProjSheet(null);
    setSpec(null);
    setPageState('select-dvl');
  };

  const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'protocols', label: 'Protocols' },
    { id: 'weekly', label: 'Weekly Activity' },
    { id: 'validation', label: 'Validation' },
  ];

  /* ── Render states ── */
  if (pageState === 'loading' || pageState === 'fetching') {
    return (
      <div style={{ background: P.bg, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
        <Loader2 size={28} style={{ color: P.green, animation: 'spin 1s linear infinite' }} />
        <div style={{ fontSize: 13, color: P.faint }}>{pageState === 'fetching' ? 'Loading data sources…' : 'Initializing…'}</div>
        <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  if (pageState === 'no-config') {
    return (
      <div style={{ background: P.bg, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <div style={{ textAlign: 'center', maxWidth: 400 }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <ShieldCheck size={24} style={{ color: P.blue }} />
          </div>
          <h2 style={{ color: P.ink, fontSize: 18, fontWeight: 600, marginBottom: 8 }}>No Data Sources Configured</h2>
          <p style={{ color: P.faint, fontSize: 13, marginBottom: 20 }}>
            Go to Settings → Validation tab and add the data sources containing your DVL and Projection sheets.
          </p>
          {isAdmin && (
            <button onClick={() => navigate('/settings')} style={{ padding: '10px 20px', borderRadius: 10, background: 'rgba(96,165,250,0.15)', border: '1px solid rgba(96,165,250,0.3)', color: P.blue, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, margin: '0 auto' }}>
              <Settings size={14} /> Open Settings
            </button>
          )}
        </div>
      </div>
    );
  }

  if (pageState === 'error') {
    return (
      <div style={{ background: P.bg, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <div style={{ textAlign: 'center' }}>
          <AlertTriangle size={32} style={{ color: P.red, marginBottom: 12 }} />
          <p style={{ color: P.ink, fontSize: 15, marginBottom: 6 }}>Error loading data</p>
          <p style={{ color: P.faint, fontSize: 13, marginBottom: 16 }}>{errMsg}</p>
          <button onClick={loadConfig} style={{ padding: '8px 18px', borderRadius: 8, background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.2)', color: P.red, fontSize: 13, cursor: 'pointer' }}>Retry</button>
        </div>
      </div>
    );
  }

  if (pageState === 'select-dvl') {
    return (
      <div style={{ background: P.bg, flex: 1, overflowY: 'auto' }}>
        <SelectSheetStep sheets={sheets} onSelect={handleDvlSelect} stepLabel="DVL" stepNum={1} />
      </div>
    );
  }

  if (pageState === 'select-proj') {
    return (
      <div style={{ background: P.bg, flex: 1, overflowY: 'auto' }}>
        <SelectSheetStep
          sheets={sheets.filter(s => !(s.sourceName === dvlSheet.sourceName && s.sheetName === dvlSheet.sheetName))}
          onSelect={handleProjSelect}
          stepLabel="Projection"
          stepNum={2}
          otherLabel={dvlSheet.sheetName}
        />
      </div>
    );
  }

  if (pageState === 'analyzing') {
    return (
      <div style={{ background: P.bg, flex: 1 }}>
        <AnalyzingScreen dvlName={dvlSheet?.sheetName} projName={projSheet?.sheetName} />
      </div>
    );
  }

  /* ── Ready: full dashboard ── */
  const h = spec?.header || {};
  return (
    <div style={{ background: P.bg, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Page header */}
      <div style={{ padding: '16px 20px', borderBottom: `0.5px solid ${P.line}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexShrink: 0 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            <ShieldCheck size={16} style={{ color: P.green }} />
            <h1 style={{ fontSize: 16, fontWeight: 600, color: P.ink, letterSpacing: '-0.3px' }}>
              {h.site || 'Validation'} — Data Validation Dashboard
            </h1>
            <span style={{ fontSize: 11, color: P.green, background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.2)', borderRadius: 20, padding: '2px 8px' }}>
              {h.period || ''}
            </span>
          </div>
          <p style={{ fontSize: 12, color: P.faint }}>
            DVL: <strong style={{ color: P.sub }}>{dvlSheet?.sheetName}</strong>
            <span style={{ margin: '0 8px', color: P.deep }}>vs</span>
            Projection: <strong style={{ color: P.sub }}>{projSheet?.sheetName}</strong>
            <span style={{ marginLeft: 10, color: h.goalsLogic === 'original' ? P.green : P.amber }}>
              {h.goalsNote}
            </span>
          </p>
        </div>
        <button onClick={handleReset} title="Reset — re-select sheets" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: `0.5px solid ${P.line}`, color: P.sub, fontSize: 12, cursor: 'pointer', flexShrink: 0 }}>
          <RotateCcw size={13} /> Reset
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, padding: '10px 20px', borderBottom: `0.5px solid ${P.line}`, flexShrink: 0, flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
            padding: '6px 16px', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
            background: activeTab === t.id ? '#1a1e28' : 'transparent',
            color: activeTab === t.id ? P.ink : P.faint,
            border: activeTab === t.id ? `1px solid rgba(255,255,255,0.12)` : `1px solid ${P.line}`,
            fontWeight: activeTab === t.id ? 500 : 400, transition: 'all 0.15s',
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px', background: P.bg }}>
        {activeTab === 'overview'    && <OverviewTab   spec={spec} />}
        {activeTab === 'protocols'   && <ProtocolsTab  spec={spec} piFilter={piFilter} onPIFilter={setPiFilter} />}
        {activeTab === 'weekly'      && <WeeklyTab     spec={spec} monthFilter={monthFilter} onMonthFilter={setMonthFilter} />}
        {activeTab === 'validation'  && <ValidationTab spec={spec} />}
      </div>
    </div>
  );
}
