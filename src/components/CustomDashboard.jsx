import { useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  RadialBarChart, RadialBar, PolarAngleAxis, LineChart, Line, Legend,
  Cell,
} from 'recharts';
import {
  ShieldCheck, AlertTriangle, AlertOctagon, Database, FileWarning,
  GitMerge, Activity, ChevronRight, CircleDot, TrendingUp, Layers,
  BarChart2, Shield, Zap, Target, Users, Star,
} from 'lucide-react';

/* ── Icon lookup ─────────────────────────────────────────────────────────── */
const ICON_MAP = {
  'shield-check': ShieldCheck, 'database': Database, 'file-warning': FileWarning,
  'git-compare': GitMerge, 'activity': Activity, 'trending-up': TrendingUp,
  'layers': Layers, 'bar-chart': BarChart2, 'alert-triangle': AlertTriangle,
  'alert-octagon': AlertOctagon, 'circle-dot': CircleDot, 'shield': Shield,
  'zap': Zap, 'target': Target, 'users': Users, 'star': Star,
};
function DynIcon({ name, ...p }) { const C = ICON_MAP[name] || Activity; return <C {...p} />; }

/* ── Severity palette ────────────────────────────────────────────────────── */
const SEV = {
  Critical: { c: '#ff5470', bg: 'rgba(255,84,112,.12)', Icon: AlertOctagon },
  Warning:  { c: '#ffb648', bg: 'rgba(255,182,72,.12)',  Icon: AlertTriangle },
  Minor:    { c: '#46c2cb', bg: 'rgba(70,194,203,.12)',  Icon: CircleDot },
  Pass:     { c: '#3ddc97', bg: 'rgba(61,220,151,.12)',  Icon: ShieldCheck },
};
const PALETTE = ['#5a7dff','#3ddc97','#ffb648','#ff5470','#8b5cf6','#46c2cb','#a855c7','#f97316'];

/* ── Shared atoms ────────────────────────────────────────────────────────── */
function Pill({ status }) {
  const s = SEV[status] || SEV.Minor;
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color: s.c, background: s.bg, padding: '3px 10px', borderRadius: 999, letterSpacing: '.05em', textTransform: 'uppercase', border: `1px solid ${s.c}33`, whiteSpace: 'nowrap' }}>
      {status}
    </span>
  );
}

function DarkTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#141826', border: '1px solid rgba(255,255,255,.1)', borderRadius: 10, padding: '10px 14px', fontSize: 12 }}>
      {label && <p style={{ color: 'rgba(255,255,255,.5)', margin: '0 0 6px' }}>{label}</p>}
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color, margin: '2px 0', fontFamily: "'Space Mono',monospace", fontWeight: 600 }}>
          {p.name}: {typeof p.value === 'number' ? p.value.toLocaleString() : p.value}
        </p>
      ))}
    </div>
  );
}

function Panel({ title, desc, children }) {
  return (
    <div style={{ background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 16, padding: 22 }}>
      {title && <h3 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700, color: '#e8ecf5' }}>{title}</h3>}
      {desc && <p style={{ margin: '0 0 14px', fontSize: 12, color: 'rgba(255,255,255,.45)', lineHeight: 1.5 }}>{desc}</p>}
      {!desc && title && <div style={{ height: 14 }} />}
      {children}
    </div>
  );
}

/* ── Widgets ─────────────────────────────────────────────────────────────── */
function BarWidget({ w }) {
  return (
    <Panel title={w.title} desc={w.desc}>
      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={w.data} barGap={6}>
          <CartesianGrid stroke="rgba(255,255,255,.06)" vertical={false} />
          <XAxis dataKey={w.xKey} tick={{ fill: 'rgba(255,255,255,.5)', fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: 'rgba(255,255,255,.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip content={<DarkTip />} />
          {(w.series || []).length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {(w.series || []).map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.label || s.key} fill={s.color || PALETTE[i]} radius={[5, 5, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
      {w.footer?.type === 'delta' && (
        <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          {(w.footer.items || []).map((item, i) => (
            <div key={i} style={{ flex: '1 1 120px', padding: '10px 14px', background: 'rgba(255,255,255,.03)', borderRadius: 10, border: '1px solid rgba(255,255,255,.06)' }}>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,.5)' }}>{item.label}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 16, fontWeight: 700 }}>
                  {item.delta > 0 ? '+' : ''}{item.delta}
                </span>
                <Pill status={item.status} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function HBarWidget({ w }) {
  const height = Math.max(200, (w.data || []).length * 36);
  return (
    <Panel title={w.title}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={w.data} layout="vertical" margin={{ left: 16, right: 16 }}>
          <CartesianGrid stroke="rgba(255,255,255,.05)" horizontal={false} />
          <XAxis type="number" tick={{ fill: 'rgba(255,255,255,.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis dataKey="name" type="category" width={100} tick={{ fill: 'rgba(255,255,255,.55)', fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip content={<DarkTip />} cursor={{ fill: 'rgba(255,255,255,.04)' }} />
          <Bar dataKey={w.valueKey || 'v'} radius={[0, 5, 5, 0]}>
            {(w.data || []).map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Panel>
  );
}

function LineWidget({ w }) {
  return (
    <Panel title={w.title}>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={w.data}>
          <CartesianGrid stroke="rgba(255,255,255,.06)" vertical={false} />
          <XAxis dataKey={w.xKey} tick={{ fill: 'rgba(255,255,255,.5)', fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: 'rgba(255,255,255,.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip content={<DarkTip />} />
          {(w.series || []).map((s, i) => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.label || s.key} stroke={s.color || PALETTE[i]} strokeWidth={2.5} dot={{ r: 4, fill: s.color || PALETTE[i] }} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </Panel>
  );
}

function GaugeWidget({ w }) {
  const pct = Math.min(100, Math.max(0, w.value || 0));
  return (
    <Panel title={w.title}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
        <ResponsiveContainer width="45%" height={160}>
          <RadialBarChart innerRadius="68%" outerRadius="100%"
            data={[{ v: pct, fill: w.color || '#3ddc97' }]} startAngle={90} endAngle={-270}>
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
            <RadialBar background={{ fill: 'rgba(255,255,255,.06)' }} dataKey="v" cornerRadius={20} />
          </RadialBarChart>
        </ResponsiveContainer>
        <div>
          <div style={{ fontSize: 40, fontWeight: 700, fontFamily: "'Space Mono',monospace", color: w.color || '#3ddc97', lineHeight: 1 }}>
            {pct}{w.suffix || ''}
          </div>
          {w.desc && <p style={{ fontSize: 12.5, color: 'rgba(255,255,255,.5)', margin: '8px 0 0', maxWidth: 200, lineHeight: 1.5 }}>{w.desc}</p>}
        </div>
      </div>
    </Panel>
  );
}

function TableWidget({ w }) {
  return (
    <Panel title={w.title} desc={w.desc}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'rgba(255,255,255,.45)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em' }}>
              {(w.columns || []).map((col, i) => (
                <th key={i} style={{ padding: '11px 14px', borderBottom: '1px solid rgba(255,255,255,.08)', whiteSpace: 'nowrap' }}>{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(w.rows || []).map((row, ri) => (
              <tr key={ri} style={{ borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                {(w.columns || []).map((col, ci) => {
                  const val = row[col.key];
                  if (col.cellType === 'pill') return (
                    <td key={ci} style={{ padding: '12px 14px' }}>
                      {val ? <Pill status={val} /> : <span style={{ color: 'rgba(255,255,255,.3)' }}>—</span>}
                    </td>
                  );
                  if (col.cellType === 'progress') return (
                    <td key={ci} style={{ padding: '12px 14px', minWidth: 140 }}>
                      {val == null ? <span style={{ color: 'rgba(255,255,255,.3)' }}>n/a</span> : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                          <div style={{ flex: 1, height: 7, background: 'rgba(255,255,255,.07)', borderRadius: 99, overflow: 'hidden' }}>
                            <div style={{ width: `${Math.min(100, val)}%`, height: '100%', background: val >= 90 ? '#3ddc97' : val >= 60 ? '#ffb648' : '#ff5470' }} />
                          </div>
                          <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 12, width: 42 }}>{val}%</span>
                        </div>
                      )}
                    </td>
                  );
                  const isNull = val == null;
                  const isNum = !isNull && typeof val === 'number';
                  const colored = col.colored && isNum;
                  return (
                    <td key={ci} style={{
                      padding: '12px 14px', whiteSpace: 'nowrap',
                      fontFamily: col.mono ? "'Space Mono',monospace" : 'inherit',
                      color: isNull ? 'rgba(255,255,255,.3)' : colored ? (val >= 0 ? '#3ddc97' : '#ff5470') : '#dfe4f0',
                    }}>
                      {isNull ? '—' : colored && val > 0 ? `+${val}` : String(val)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {w.note && <p style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', marginTop: 14, lineHeight: 1.6 }}><b style={{ color: '#ffb648' }}>Note —</b> {w.note}</p>}
    </Panel>
  );
}

function AlertsWidget({ w }) {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {(w.items || []).map((a, i) => {
        const sv = SEV[a.severity] || SEV.Minor;
        return (
          <div key={i} style={{ display: 'flex', gap: 16, padding: '18px 20px', borderRadius: 14, background: sv.bg, border: `1px solid ${sv.c}33` }}>
            <div style={{ width: 40, height: 40, borderRadius: 11, flexShrink: 0, display: 'grid', placeItems: 'center', background: `${sv.c}1f` }}>
              <sv.Icon size={20} style={{ color: sv.c }} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, fontSize: 14.5, color: '#fff' }}>{a.title}</span>
                <Pill status={a.severity} />
                {a.where && <span style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', display: 'flex', alignItems: 'center', gap: 4 }}><ChevronRight size={13} />{a.where}</span>}
              </div>
              <p style={{ margin: '8px 0 0', fontSize: 13.5, color: 'rgba(255,255,255,.7)', lineHeight: 1.6 }}>{a.msg}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CardsWidget({ w }) {
  return (
    <Panel title={w.title}>
      <div style={{ display: 'grid', gap: 12 }}>
        {(w.items || []).map((item, i) => {
          const sv = SEV[item.status] || SEV.Minor;
          return (
            <div key={i} style={{ display: 'flex', gap: 16, alignItems: 'flex-start', padding: '16px 18px', background: 'rgba(255,255,255,.025)', border: `1px solid ${sv.c}25`, borderRadius: 12, borderLeft: `3px solid ${sv.c}` }}>
              <sv.Icon size={20} style={{ color: sv.c, marginTop: 2, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{item.title}</span>
                  <Pill status={item.status} />
                </div>
                {item.scope && <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', margin: '5px 0 8px' }}>Scope · {item.scope}</div>}
                <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,.65)', lineHeight: 1.55 }}>{item.detail}</p>
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function NoteWidget({ w }) {
  return (
    <div style={{ padding: '20px 22px', borderRadius: 14, background: 'linear-gradient(135deg,rgba(90,125,255,.1),rgba(139,92,246,.06))', border: '1px solid rgba(122,162,255,.2)' }}>
      <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
        <ShieldCheck size={17} style={{ color: '#7aa2ff' }} /> {w.title || 'Recommendations'}
      </h4>
      <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13.5, color: 'rgba(255,255,255,.72)', lineHeight: 1.85 }}>
        {(w.items || []).map((item, i) => <li key={i}>{item}</li>)}
      </ol>
    </div>
  );
}

function Widget({ w }) {
  switch (w?.type) {
    case 'bar':    return <BarWidget w={w} />;
    case 'hbar':   return <HBarWidget w={w} />;
    case 'line':   return <LineWidget w={w} />;
    case 'gauge':  return <GaugeWidget w={w} />;
    case 'table':  return <TableWidget w={w} />;
    case 'alerts': return <AlertsWidget w={w} />;
    case 'cards':  return <CardsWidget w={w} />;
    case 'note':   return <NoteWidget w={w} />;
    default:       return null;
  }
}

/* ── Stat Card ───────────────────────────────────────────────────────────── */
function StatCard({ item }) {
  return (
    <div style={{ background: 'linear-gradient(160deg,rgba(255,255,255,.04),rgba(255,255,255,.01))', border: '1px solid rgba(255,255,255,.08)', borderRadius: 14, padding: '18px 20px', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, background: item.color || '#7aa2ff', opacity: .05 }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <span style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,.45)', fontWeight: 600 }}>{item.label}</span>
        <DynIcon name={item.icon || 'activity'} size={17} style={{ color: item.color || '#7aa2ff' }} />
      </div>
      <div style={{ fontSize: 32, fontWeight: 700, marginTop: 10, fontFamily: "'Space Mono',monospace", color: '#fff', lineHeight: 1 }}>{item.value}</div>
      <div style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', marginTop: 7 }}>{item.sub}</div>
    </div>
  );
}

/* ── Main export ─────────────────────────────────────────────────────────── */
export default function CustomDashboard({ spec, departmentName }) {
  const [tab, setTab] = useState(spec?.tabs?.[0]?.id || 'overview');
  if (!spec) return null;

  const theme = spec.theme || {};
  const header = spec.header || {};
  const accent = theme.accent || '#5a7dff';
  const accent2 = theme.accent2 || '#8b5cf6';
  const currentTab = (spec.tabs || []).find(t => t.id === tab) || spec.tabs?.[0];

  return (
    <div style={{ background: `radial-gradient(1200px 700px at 80% -10%,rgba(98,130,255,.12),transparent 60%),#0a0c14`, color: '#dfe4f0', fontFamily: "'Inter',system-ui,sans-serif", padding: '26px clamp(14px,3vw,36px) 80px', minHeight: '100%' }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Inter:wght@400;500;600;700&display=swap'); .cd-tab-btn{border:none;cursor:pointer;font-family:inherit;transition:all .2s;} ::-webkit-scrollbar{height:7px;width:7px} ::-webkit-scrollbar-thumb{background:rgba(255,255,255,.12);border-radius:4px}`}</style>

      {/* Header */}
      <header style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 38, height: 38, borderRadius: 11, display: 'grid', placeItems: 'center', background: `linear-gradient(135deg,${accent},${accent2})`, boxShadow: `0 8px 24px ${accent}55`, flexShrink: 0 }}>
            <DynIcon name={header.icon || 'bar-chart'} size={20} color="#fff" />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: '-.01em', color: '#fff' }}>{header.title || departmentName}</h2>
            {header.subtitle && <p style={{ margin: '3px 0 0', fontSize: 12, color: 'rgba(255,255,255,.45)' }}>{header.subtitle}</p>}
          </div>
        </div>
        {header.badge && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 600, color: header.badgeColor || '#3ddc97', background: `${header.badgeColor || '#3ddc97'}1a`, padding: '7px 13px', borderRadius: 999, border: `1px solid ${header.badgeColor || '#3ddc97'}44` }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: header.badgeColor || '#3ddc97', boxShadow: `0 0 8px ${header.badgeColor || '#3ddc97'}` }} />
            {header.badge}
          </span>
        )}
      </header>

      {/* Stats */}
      {(spec.stats || []).length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(175px,1fr))', gap: 13, marginBottom: 22 }}>
          {spec.stats.map((s, i) => <StatCard key={i} item={s} />)}
        </div>
      )}

      {/* Tabs */}
      {(spec.tabs || []).length > 1 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
          {spec.tabs.map(t => (
            <button key={t.id} className="cd-tab-btn" onClick={() => setTab(t.id)} style={{
              fontSize: 13, fontWeight: 600, padding: '9px 18px', borderRadius: 10,
              background: tab === t.id ? `linear-gradient(135deg,${accent},${accent2})` : 'rgba(255,255,255,.04)',
              color: tab === t.id ? '#fff' : 'rgba(255,255,255,.55)',
              boxShadow: tab === t.id ? `0 6px 18px ${accent}44` : 'none',
            }}>{t.label}</button>
          ))}
        </div>
      )}

      {/* Tab content */}
      {currentTab && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {(currentTab.rows || []).map((row, ri) => (
            <div key={ri} style={{ display: 'grid', gridTemplateColumns: row.cols === 2 ? '1fr 1fr' : '1fr', gap: 16 }}>
              {(row.widgets || []).map((w, wi) => <Widget key={wi} w={w} />)}
            </div>
          ))}
        </div>
      )}

      <footer style={{ marginTop: 32, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,.06)', fontSize: 11.5, color: 'rgba(255,255,255,.3)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <span>{departmentName} · AI-generated dashboard from live data</span>
        <span>Strict-data mode · Values computed from actual source files</span>
      </footer>
    </div>
  );
}
