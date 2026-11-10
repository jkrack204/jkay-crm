/** Admin dashboard — sources, funnel, employee-by-employee, cash flow and why we lose. */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PLATFORMS, type Platform } from '@jkay/shared';
import { api } from '../../lib/api';
import { money } from '../../lib/format';
import type { Employee } from '../../lib/types';
import { dealValue, isLive, isPool, monthKey, monthLabel, monthsBetween, pct, platformName, shortMoney, todayYm, useRecords, Who, type AdminRecord } from './adminShared';

const SRC_COLOR: Record<Platform, string> = {
  justdial: 'var(--signal-amber)',
  indiamart: 'var(--signal-green)',
  meta: 'var(--signal-blue)',
  google: 'var(--signal-red)',
  sulekha: 'var(--signal-violet)',
  website: 'var(--steel-600)',
  walkin: 'var(--steel-500)',
};
const PERIODS = [
  ['month', 'This month'],
  ['3m', 'Last 3 months'],
  ['year', 'This year'],
  ['all', 'All time'],
] as const;
type Period = (typeof PERIODS)[number][0];
function periodStart(p: Period): string | undefined {
  const now = new Date();
  const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}-01`;
  if (p === 'month') return ym(now.getFullYear(), now.getMonth() + 1);
  if (p === '3m') {
    const d = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    return ym(d.getFullYear(), d.getMonth() + 1);
  }
  if (p === 'year') return `${now.getFullYear()}-01-01`;
  return undefined;
}

export function AdminDashboard() {
  const nav = useNavigate();
  const [period, setPeriod] = useState<Period>('3m');
  const [src, setSrc] = useState<Platform | 'all'>('all');
  const [role, setRole] = useState<'all' | 'cre' | 'bde'>('all');
  const [sort, setSort] = useState<{ k: string; dir: 1 | -1 }>({ k: 'touched', dir: -1 });
  const from = periodStart(period);
  const all = useRecords('all', { from });
  const wonAll = useRecords('won');
  const emp = useQuery({ queryKey: ['employees'], queryFn: () => api.get<{ employees: Employee[] }>('/employees') });

  const records = all.data?.records ?? [];
  const base = useMemo(() => (src === 'all' ? records : records.filter((r) => r.platform === src)), [records, src]);

  if (all.isLoading) return <div className="empty">Loading…</div>;

  const won = base.filter((r) => r.wonAt && !r.lost);
  const lost = base.filter((r) => r.lost);
  const live = base.filter(isLive);
  const contract = won.reduce((a, r) => a + (r.contractValue ?? 0), 0);
  const collected = won.reduce((a, r) => a + r.paid, 0);
  const periodLabel = PERIODS.find((p) => p[0] === period)![1].toLowerCase();

  return (
    <>
      <div className="toolbar">
        <div className="chips">
          {PERIODS.map(([k, l]) => (
            <button key={k} className={`chip ${period === k ? 'on' : ''}`} onClick={() => setPeriod(k)}>
              {l}
            </button>
          ))}
        </div>
        <span className="lbl" style={{ marginLeft: 'auto' }}>
          Leads created {periodLabel}
        </span>
      </div>
      {src !== 'all' && (
        <div className="pipe-hint">
          <span>◆</span>Everything below is filtered to <b>&nbsp;{platformName(src)}&nbsp;</b> leads.{' '}
          <a onClick={() => setSrc('all')} style={{ cursor: 'pointer', color: 'var(--accent-hover)', marginLeft: 6 }}>
            Clear
          </a>
        </div>
      )}
      <div className="stat-strip">
        <Stat l="Leads" v={base.length} d={src === 'all' ? 'all sources' : platformName(src)} />
        <Stat l="Live now" v={live.length} d={`${live.filter((r) => r.desk === 'cre').length} CRE · ${live.filter((r) => r.desk === 'bd').length} BD`} />
        <Stat l="Won" v={won.length} d={`${pct(won.length, base.length)}% of leads`} />
        <Stat l="Lost" v={lost.length} d={`${lost.filter((r) => r.lost!.desk === 'cre').length} CRE · ${lost.filter((r) => r.lost!.desk === 'bd').length} BD`} />
        <Stat l="Won value" v={shortMoney(contract)} d={`${shortMoney(collected)} collected`} />
        <Stat l="Open pipeline" v={shortMoney(live.reduce((a, r) => a + dealValue(r), 0))} d="quoted or estimated" />
      </div>

      <div className="dash-grid g-32">
        <div className="panel">
          <div className="panel__head">
            <h3>Where leads come from</h3>
            <span className="count">click a slice to filter</span>
          </div>
          <div className="panel__body">
            <Donut records={records} src={src} setSrc={setSrc} />
          </div>
        </div>
        <Funnel base={base} />
      </div>

      <div className="dash-grid mt-12">
        <EmployeeTable base={base} employees={emp.data?.employees ?? []} role={role} setRole={setRole} sort={sort} setSort={setSort} onDrill={(p) => nav(`/admin/${p.role === 'cre' ? 'cre' : 'bd'}?person=${p.id}`)} />
      </div>

      <div className="dash-grid g-2 mt-12">
        <CashFlow created={base} won={(wonAll.data?.records ?? []).filter((r) => src === 'all' || r.platform === src)} from={from} />
        <WhyWeLose lost={lost} />
      </div>
    </>
  );
}

const Stat = ({ l, v, d }: { l: string; v: string | number; d: string }) => (
  <div className="st">
    <div className="l">{l}</div>
    <div className="v">{v}</div>
    <div className="d">{d}</div>
  </div>
);

function Donut({ records, src, setSrc }: { records: AdminRecord[]; src: Platform | 'all'; setSrc: (s: Platform | 'all') => void }) {
  const data = PLATFORMS.map((p) => ({ p, n: records.filter((r) => r.platform === p).length }))
    .filter((d) => d.n)
    .sort((a, b) => b.n - a.n);
  const total = data.reduce((a, d) => a + d.n, 0);
  const C = 2 * Math.PI * 52;
  let off = 0;
  const shown = src === 'all' ? total : (data.find((d) => d.p === src)?.n ?? 0);
  if (!total) return <div className="empty">No leads in this period yet.</div>;
  return (
    <div className="don-wrap">
      <div className="don">
        <svg viewBox="0 0 140 140" width="148" height="148">
          <circle cx="70" cy="70" r="52" fill="none" stroke="var(--steel-850)" strokeWidth="17" />
          {data.map((d) => {
            const len = (d.n / total) * C;
            const el = (
              <circle
                key={d.p}
                cx="70"
                cy="70"
                r="52"
                fill="none"
                stroke={SRC_COLOR[d.p]}
                strokeWidth={src === d.p ? 22 : 17}
                strokeDasharray={`${Math.max(len - 1.5, 0.5)} ${C - len + 1.5}`}
                strokeDashoffset={-off}
                opacity={src === 'all' || src === d.p ? 1 : 0.28}
                onClick={() => setSrc(src === d.p ? 'all' : d.p)}
              >
                <title>
                  {platformName(d.p)} · {d.n} leads
                </title>
              </circle>
            );
            off += len;
            return el;
          })}
        </svg>
        <div className="mid">
          <div className="v">{shown}</div>
          <div className="l">{src === 'all' ? 'all leads' : platformName(src)}</div>
        </div>
      </div>
      <div className="lg">
        {data.map((d) => (
          <button key={d.p} className={src === d.p ? 'on' : ''} onClick={() => setSrc(src === d.p ? 'all' : d.p)}>
            <span className="sw" style={{ background: SRC_COLOR[d.p] }}></span>
            <span>{platformName(d.p)}</span>
            <span className="c">{d.n}</span>
            <span className="p">{pct(d.n, total)}%</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Funnel({ base }: { base: AdminRecord[] }) {
  const steps = [
    { n: 'Leads in', c: base.length, d: 'every enquiry that reached the CRE desk', cls: '' },
    { n: 'Claimed by a CRE', c: base.filter((r) => !isPool(r)).length, d: 'picked out of the shared pool', cls: '' },
    { n: 'Qualified to BD', c: base.filter((r) => r.desk === 'bd').length, d: 'handed to a BDE', cls: '' },
    { n: 'Quotation sent', c: base.filter((r) => r.quoteCount > 0).length, d: 'priced and shared', cls: '' },
    { n: 'Won', c: base.filter((r) => r.wonAt && !r.lost).length, d: 'advance received', cls: 'win' },
  ];
  const top = steps[0]!.c || 1;
  const lost = base.filter((r) => r.lost);
  return (
    <div className="panel">
      <div className="panel__head">
        <h3>Deal funnel</h3>
        <span className="count">{pct(steps[4]!.c, top)}% of leads convert</span>
      </div>
      <div className="panel__body">
        <div className="fun">
          {steps.map((s, i) => {
            const prev = i ? steps[i - 1]!.c : s.c;
            return (
              <div key={s.n} className={`fu ${s.cls}`}>
                <div className="fill" style={{ width: `${Math.max(pct(s.c, top), 4)}%` }}></div>
                <div>
                  <div className="nm">{s.n}</div>
                  <div className="df">{s.d}</div>
                </div>
                <div className="rt">
                  <div className="n">{s.c}</div>
                  <div className="d">{i ? `−${prev - s.c} · ${prev ? 100 - pct(s.c, prev) : 0}% drop` : `${pct(s.c, top)}%`}</div>
                </div>
              </div>
            );
          })}
          <div className="fu loss">
            <div className="fill" style={{ width: `${pct(lost.length, top)}%` }}></div>
            <div>
              <div className="nm">Lost</div>
              <div className="df">
                {lost.filter((r) => r.lost!.desk === 'cre').length} on the CRE desk · {lost.filter((r) => r.lost!.desk === 'bd').length} after hand-off
              </div>
            </div>
            <div className="rt">
              <div className="n">{lost.length}</div>
              <div className="d">{pct(lost.length, top)}% of leads</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const topReason = (rows: AdminRecord[]) => {
  const c = new Map<string, number>();
  rows.forEach((r) => r.lost && c.set(r.lost.reason, (c.get(r.lost.reason) ?? 0) + 1));
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';
};

function EmployeeTable({
  base,
  employees,
  role,
  setRole,
  sort,
  setSort,
  onDrill,
}: {
  base: AdminRecord[];
  employees: Employee[];
  role: 'all' | 'cre' | 'bde';
  setRole: (r: 'all' | 'cre' | 'bde') => void;
  sort: { k: string; dir: 1 | -1 };
  setSort: (s: { k: string; dir: 1 | -1 }) => void;
  onDrill: (p: { id: string; role: string }) => void;
}) {
  type Row = { id: string; name: string; role: 'cre' | 'bde'; active: boolean; touched: number; handed: number; won: number; lost: number; rate: number; rateLabel: string; val: number; topLoss: string };
  const rows: Row[] = employees
    .filter((e) => e.role !== 'admin' && (role === 'all' || e.role === role))
    .map((e) => {
      if (e.role === 'cre') {
        const mine = base.filter((r) => r.cre?.id === e.id);
        const handed = mine.filter((r) => r.desk === 'bd');
        const won = mine.filter((r) => r.wonAt && !r.lost);
        const lost = mine.filter((r) => r.lost?.desk === 'cre');
        return { id: e.id, name: e.fullName, role: 'cre' as const, active: e.active, touched: mine.length, handed: handed.length, won: won.length, lost: lost.length, rate: pct(handed.length, mine.length), rateLabel: 'qualified', val: won.reduce((a, r) => a + (r.contractValue ?? 0), 0), topLoss: topReason(lost) };
      }
      const deals = base.filter((r) => r.bde?.id === e.id);
      const won = deals.filter((r) => r.wonAt && !r.lost);
      const lost = deals.filter((r) => r.lost?.desk === 'bd');
      return { id: e.id, name: e.fullName, role: 'bde' as const, active: e.active, touched: deals.length, handed: deals.length, won: won.length, lost: lost.length, rate: pct(won.length, won.length + lost.length), rateLabel: 'win rate', val: won.reduce((a, r) => a + (r.contractValue ?? 0), 0), topLoss: topReason(lost) };
    })
    .filter((r) => r.active || r.touched > 0);
  rows.sort((a, b) => (sort.k === 'name' ? a.name.localeCompare(b.name) * -sort.dir : ((a[sort.k as keyof Row] as number) - (b[sort.k as keyof Row] as number)) * sort.dir));
  const maxVal = Math.max(1, ...rows.map((r) => r.val));
  const th = (k: string, l: string, right?: boolean) => (
    <th className={`s ${sort.k === k ? 'act' : ''} ${right ? 'r' : ''}`} onClick={() => setSort(sort.k === k ? { k, dir: (sort.dir * -1) as 1 | -1 } : { k, dir: -1 })}>
      {l}
      <span className="ar">{sort.k === k ? (sort.dir === -1 ? '▼' : '▲') : '◆'}</span>
    </th>
  );
  return (
    <div className="panel">
      <div className="panel__head">
        <h3>Employee by employee</h3>
        <div className="chips">
          {(
            [
              ['all', 'Everyone'],
              ['cre', 'CRE'],
              ['bde', 'BDE'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} className={`chip ${role === k ? 'on' : ''}`} onClick={() => setRole(k)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="panel__body" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="t">
          <thead>
            <tr>
              {th('name', 'Person')}
              <th>Role</th>
              {th('touched', 'Handled', true)}
              {th('handed', 'Handed on', true)}
              {th('won', 'Won', true)}
              {th('lost', 'Lost', true)}
              {th('rate', 'Rate', true)}
              {th('val', 'Value won', true)}
              <th>Top loss reason</th>
            </tr>
          </thead>
          <tbody>
            {!rows.length && (
              <tr>
                <td colSpan={9} className="empty">
                  No CREs or BDEs yet — add them under Employees.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} onClick={() => onDrill(r)} style={{ cursor: 'pointer', opacity: r.active ? 1 : 0.6 }}>
                <td>
                  <Who name={r.name} sub={r.active ? undefined : 'disabled'} />
                </td>
                <td>
                  <span className={`pill ${r.role === 'cre' ? 'blue' : 'amber'}`}>
                    <i></i>
                    {r.role === 'cre' ? 'CRE' : 'BDE'}
                  </span>
                </td>
                <td className="r">{r.touched}</td>
                <td className="r">{r.handed}</td>
                <td className="r" style={{ color: 'var(--signal-green)' }}>
                  {r.won}
                </td>
                <td className="r" style={{ color: 'var(--signal-red)' }}>
                  {r.lost}
                </td>
                <td className="r">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, justifyContent: 'flex-end' }}>
                    <span>{r.rate}%</span>
                    <div className="mini">
                      <i style={{ width: `${r.rate}%` }}></i>
                    </div>
                  </div>
                  <div className="sub" style={{ textAlign: 'right' }}>
                    {r.rateLabel}
                  </div>
                </td>
                <td className="r">
                  {money(r.val)}
                  <div className="mini" style={{ marginTop: 4 }}>
                    <i style={{ width: `${pct(r.val, maxVal)}%`, background: 'var(--signal-green)' }}></i>
                  </div>
                </td>
                <td>
                  {r.topLoss === '—' ? (
                    <span className="muted">—</span>
                  ) : (
                    <span className="pill red">
                      <i></i>
                      {r.topLoss}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CashFlow({ created, won, from }: { created: AdminRecord[]; won: AdminRecord[]; from?: string }) {
  const firstYm = from
    ? from.slice(0, 7)
    : [...created.map((r) => monthKey(r.createdAt)), todayYm()].sort()[0]!;
  let months = monthsBetween(firstYm, todayYm());
  if (months.length < 2) months = monthsBetween(monthKey(new Date(Date.now() - 31 * 864e5).toISOString()), todayYm());
  if (months.length > 18) months = months.slice(-18);
  const series = [
    { k: 'Pipeline created', c: 'var(--signal-blue)', v: months.map((m) => created.filter((r) => monthKey(r.createdAt) === m).reduce((a, r) => a + dealValue(r), 0)) },
    { k: 'Won', c: 'var(--signal-green)', v: months.map((m) => won.filter((r) => monthKey(r.wonAt!) === m).reduce((a, r) => a + (r.contractValue ?? 0), 0)) },
    {
      k: 'Collected',
      c: 'var(--signal-amber)',
      v: months.map((m) => won.flatMap((r) => r.payments).filter((p) => p.receivedOn.slice(0, 7) === m).reduce((a, p) => a + p.amount, 0)),
    },
  ];
  const max = Math.max(1, ...series.flatMap((s) => s.v));
  const W = 480,
    H = 150,
    L = 46,
    B = 24,
    T = 8;
  const x = (i: number) => L + i * ((W - L - 8) / Math.max(1, months.length - 1));
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const inPeriodWon = won.filter((r) => months.includes(monthKey(r.wonAt!)));
  const contract = inPeriodWon.reduce((a, r) => a + (r.contractValue ?? 0), 0);
  const got = series[2]!.v.reduce((a, b) => a + b, 0);
  const step = Math.ceil(months.length / 8);
  return (
    <div className="panel">
      <div className="panel__head">
        <h3>Cash flow</h3>
        <span className="count">
          {shortMoney(got)} collected · {shortMoney(contract)} won in these months
        </span>
      </div>
      <div className="panel__body">
        <svg className="lchart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={L} x2={W - 8} y1={y(max * f)} y2={y(max * f)} stroke="var(--row-line)" />
              <text x={L - 7} y={y(max * f) + 3} textAnchor="end" fontSize="9" fill="var(--text-muted)">
                {shortMoney(Math.round(max * f))}
              </text>
            </g>
          ))}
          {months.map((m, i) =>
            i % step === 0 || i === months.length - 1 ? (
              <text key={m} x={x(i)} y={H - 7} textAnchor="middle" fontSize="9.5" fill="var(--text-muted)">
                {monthLabel(m)}
              </text>
            ) : null,
          )}
          {series.map((s) => (
            <g key={s.k}>
              <polyline fill="none" stroke={s.c} strokeWidth="2" strokeLinejoin="round" points={s.v.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
              {s.v.map((v, i) => (
                <circle key={i} cx={x(i)} cy={y(v)} r="3" fill="var(--paper)" stroke={s.c} strokeWidth="2">
                  <title>
                    {s.k} · {monthLabel(months[i]!)} · {money(v)}
                  </title>
                </circle>
              ))}
            </g>
          ))}
        </svg>
        <div className="ck">
          {series.map((s) => (
            <span key={s.k}>
              <i style={{ background: s.c }}></i>
              {s.k}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function WhyWeLose({ lost }: { lost: AdminRecord[] }) {
  const m = new Map<string, { cre: number; bd: number }>();
  lost.forEach((r) => {
    const e = m.get(r.lost!.reason) ?? { cre: 0, bd: 0 };
    if (r.lost!.desk === 'bd') e.bd++;
    else e.cre++;
    m.set(r.lost!.reason, e);
  });
  const rows = [...m.entries()].map(([rn, v]) => ({ rn, ...v, t: v.cre + v.bd })).sort((a, b) => b.t - a.t);
  const max = Math.max(1, ...rows.map((d) => d.t));
  return (
    <div className="panel">
      <div className="panel__head">
        <h3>Why we lose</h3>
        <span className="count">top: {rows[0]?.rn ?? '—'}</span>
      </div>
      <div className="panel__body">
        {rows.map((d) => (
          <div key={d.rn} className="dbar">
            <span>{d.rn}</span>
            <div className="stack" style={{ width: `${Math.max(pct(d.t, max), 6)}%` }}>
              <i style={{ flex: d.cre, background: 'var(--signal-red)' }} title="Lost by the CRE"></i>
              <i style={{ flex: d.bd, background: 'var(--signal-amber)' }} title="Lost by the BDE"></i>
            </div>
            <span className="num">{d.t}</span>
          </div>
        ))}
        {!rows.length && <div className="empty">No losses in this slice.</div>}
        <div className="ck">
          <span>
            <i style={{ background: 'var(--signal-red)', height: 8, width: 8, borderRadius: 2 }}></i>Lost by the CRE
          </span>
          <span>
            <i style={{ background: 'var(--signal-amber)', height: 8, width: 8, borderRadius: 2 }}></i>Lost by the BDE
          </span>
        </div>
      </div>
    </div>
  );
}
