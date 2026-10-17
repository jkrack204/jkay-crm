import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PLATFORM_LABEL, type Platform } from '@jkay/shared';
import { api } from '../../lib/api';
import { friendly, isDueToday } from '../../lib/format';
import type { LeadRow } from '../../lib/types';

type Dash = {
  totals: { pool: number; mine: number; handed: number; lost: number; dueToday: number; handoffRate: number; worked: number };
  week: { days: string[]; claims: number[]; calls: number[]; handoffs: number[]; lost: number[] };
  byStage: { id: number; name: string; n: number }[];
  upcoming: LeadRow[];
  byPlatform: Record<string, number>;
  lostReasons: Record<string, number>;
  stageTags: Record<string, number>;
  bdStages: Record<string, number>;
};

const ink = () =>
  document.documentElement.getAttribute('data-theme') === 'dark'
    ? { grey: '#8b857c', clay: '#c4855a', clayLt: '#d9a577', green: '#74b189', blue: '#86a5d2', red: '#d9827a' }
    : { grey: '#8d887f', clay: '#9c6644', clayLt: '#c08a5a', green: '#3f7d52', blue: '#40628f', red: '#b0453c' };

function Spark({ points, color }: { points: number[]; color: string }) {
  const w = 62, h = 20;
  const max = Math.max(...points), min = Math.min(...points), span = max - min || 1;
  const pts = points.map((p, i) => `${((i / (points.length - 1)) * w).toFixed(1)},${(h - ((p - min) / span) * (h - 4) - 2).toFixed(1)}`).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
function Bars({ points, color }: { points: number[]; color: string }) {
  const w = 62, h = 20, n = points.length, bw = (w - (n - 1) * 2) / n, max = Math.max(...points) || 1;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      {points.map((p, i) => {
        const bh = Math.max(1.5, (p / max) * (h - 2));
        return <rect key={i} x={(i * (bw + 2)).toFixed(1)} y={(h - bh).toFixed(1)} width={bw.toFixed(1)} height={bh.toFixed(1)} rx="1" fill={color} opacity={i === n - 1 ? 1 : 0.4} />;
      })}
    </svg>
  );
}
function Breakdown({ data, color, label }: { data: Record<string, number>; color: string; label?: (k: string) => string }) {
  const pairs = Object.entries(data).filter(([, n]) => n).sort((a, b) => b[1] - a[1]);
  const total = pairs.reduce((a, [, n]) => a + n, 0) || 1;
  if (!pairs.length) return <div className="dash-empty">Nothing recorded yet.</div>;
  return (
    <div className="brk">
      {pairs.map(([k, n]) => (
        <div key={k} className="brk-row">
          <span>{label ? label(k) : k}</span>
          <span className="n">{n}</span>
          <span className="bar">
            <div style={{ width: `${((n / total) * 100).toFixed(1)}%`, background: color }} />
          </span>
        </div>
      ))}
    </div>
  );
}

export function CreDashboard() {
  const nav = useNavigate();
  const { data, isLoading, error } = useQuery({ queryKey: ['cre', 'dashboard'], queryFn: () => api.get<Dash>('/cre/dashboard'), refetchInterval: 60_000 });
  if (isLoading) return <div className="center-note">Loading…</div>;
  if (error || !data) return <div className="center-note">{(error as Error)?.message}</div>;
  const c = ink();
  const t = data.totals;
  const kpis = [
    { lab: 'Unclaimed pool', val: t.pool, delta: 'first come, first served', g: <Bars points={data.week.claims} color={c.grey} /> },
    { lab: 'My leads', val: t.mine, delta: `${data.byStage[0]?.n ?? 0} in ${data.byStage[0]?.name ?? 'first stage'}`, g: <Bars points={data.week.claims} color={c.clay} /> },
    { lab: 'Follops due today', val: t.dueToday, delta: t.dueToday ? 'act before end of day' : 'nothing pressing', cls: t.dueToday ? 'warn' : '', g: <Spark points={data.week.calls} color={c.blue} /> },
    { lab: 'Handed to BD', val: t.handed, delta: 'read-only after hand-off', cls: 'up', g: <Bars points={data.week.handoffs} color={c.green} /> },
    { lab: 'Lost', val: t.lost, delta: 'reason on every record', g: <Spark points={data.week.lost} color={c.red} /> },
    { lab: 'Hand-off rate', val: `${t.handoffRate}%`, delta: `${t.handed} of ${t.worked} worked`, cls: 'up', g: <Spark points={data.week.handoffs} color={c.green} /> },
  ];
  const steps: [string, number, string][] = [
    ['Unclaimed pool', t.pool, c.grey],
    ['Claimed by me', t.worked, c.clay],
    ...data.byStage.map((s) => [s.name, s.n, c.clayLt] as [string, number, string]),
    ['Handed to BD', t.handed, c.green],
  ];
  const fmax = Math.max(...steps.map((s) => s[1]), 1);

  return (
    <div className="view active">
      <div className="dash">
        <section>
          <h2>This week</h2>
          <div className="kpis">
            {kpis.map((k) => (
              <div key={k.lab} className="kpi">
                <div className="lab">{k.lab}</div>
                <div className="row">
                  <span className="val">{k.val}</span>
                  {k.g}
                </div>
                <div className={`delta ${k.cls ?? ''}`}>{k.delta}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="dgrid">
          <div className="card">
            <div className="card__head">
              <h3>Where my leads sit</h3>
              <span className="aux">{t.worked} claimed in total</span>
            </div>
            <div className="card__body">
              <div className="funnel">
                {steps.map(([name, n, col]) => (
                  <div key={name} className="fstep">
                    <span className="t">{name}</span>
                    <span className="track">
                      <span className="fill" style={{ width: `${((n / fmax) * 100).toFixed(1)}%`, background: col }} />
                    </span>
                    <span className="n">{n}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card__head">
              <h3>Follops coming up</h3>
              <span className="aux">{data.upcoming.length} scheduled</span>
            </div>
            <div className="card__body">
              {data.upcoming.length ? (
                <div className="duelist">
                  {data.upcoming.map((l) => (
                    <div key={l.id} className="due-item" onClick={() => nav(`/cre/mine?lead=${l.id}`)}>
                      <div>
                        <div className="dn">{l.customerName}</div>
                        <div className="dm">
                          {l.stageTag?.name ?? l.creStage?.name} · {l.place ?? '—'}
                        </div>
                      </div>
                      <div className={`dt ${isDueToday(l.nextFollowupAt) ? 'hot' : ''}`}>{friendly(l.nextFollowupAt)}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="dash-empty">No follops scheduled — add one from a lead.</div>
              )}
            </div>
          </div>
        </section>

        <section className="dgrid">
          <div className="card">
            <div className="card__head">
              <h3>Where my leads came from</h3>
              <span className="aux">by platform</span>
            </div>
            <div className="card__body">
              <Breakdown data={data.byPlatform} color={c.clay} label={(k) => PLATFORM_LABEL[k as Platform] ?? k} />
            </div>
          </div>
          <div className="card">
            <div className="card__head">
              <h3>Why leads were lost</h3>
              <span className="aux">{t.lost} closed</span>
            </div>
            <div className="card__body">
              <Breakdown data={data.lostReasons} color={c.red} />
            </div>
          </div>
        </section>

        <section className="dgrid">
          <div className="card">
            <div className="card__head">
              <h3>Stage tags</h3>
              <span className="aux">my open leads</span>
            </div>
            <div className="card__body">
              <Breakdown data={data.stageTags} color={c.clayLt} />
            </div>
          </div>
          <div className="card">
            <div className="card__head">
              <h3>With BD</h3>
              <span className="aux">read-only</span>
            </div>
            <div className="card__body">
              <Breakdown data={data.bdStages} color={c.green} />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
