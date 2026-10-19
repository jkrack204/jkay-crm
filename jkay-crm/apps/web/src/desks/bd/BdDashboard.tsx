import { useNavigate } from 'react-router-dom';
import { PLATFORM_LABEL } from '@jkay/shared';
import { useConfig } from '../../lib/session';
import { friendly, money } from '../../lib/format';
import { bdStagesOf, short, useDeals, valueShown } from './bdShared';

const monthStart = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
};

function Breakdown({ pairs, color }: { pairs: [string, number][]; color: string }) {
  const shown = pairs.filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const total = shown.reduce((a, [, n]) => a + n, 0) || 1;
  if (!shown.length) return <div className="dash-empty">Nothing recorded yet.</div>;
  return (
    <div className="brk">
      {shown.map(([lab, n]) => (
        <div key={lab} className="brk-row">
          <span>{lab}</span>
          <span className="n">{n}</span>
          <span className="bar">
            <div style={{ width: `${((n / total) * 100).toFixed(1)}%`, background: color }} />
          </span>
        </div>
      ))}
    </div>
  );
}

export function BdDashboard() {
  const { data: config } = useConfig();
  const { data, isLoading } = useDeals();
  const nav = useNavigate();
  if (isLoading) return <div className="center-note">Loading…</div>;

  const deals = data?.deals ?? [];
  const stages = bdStagesOf(config?.stages);
  const open = deals.filter((d) => !d.wonAt && !d.lostAt);
  const won = deals.filter((d) => d.wonAt && !d.lostAt);
  const lost = deals.filter((d) => d.lostAt);
  const m0 = monthStart();
  const wonMonth = won.filter((d) => new Date(d.wonAt!) >= m0);
  const lostMonth = lost.filter((d) => new Date(d.lostAt!) >= m0);
  const quoted = open.filter(valueShown).reduce((a, d) => a + (d.value ?? 0), 0);
  const outstanding = won.reduce((a, d) => a + (d.balance ?? 0), 0);
  const decided = won.length + lost.length;
  const winRate = decided ? Math.round((won.length / decided) * 100) : 0;
  const booked = open.filter((d) => d.visit?.status === 'booked').sort((a, b) => +new Date(a.visit!.scheduledAt) - +new Date(b.visit!.scheduledAt));
  const maxN = Math.max(1, ...stages.map((s) => deals.filter((d) => d.stage?.id === s.id).length));
  const openDeal = (id: string) => nav(`/bd/deals?deal=${id}`);
  const count = <T,>(xs: T[], key: (x: T) => string | null | undefined) => {
    const m = new Map<string, number>();
    xs.forEach((x) => {
      const k = key(x);
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    });
    return [...m.entries()];
  };
  const kpi = (lab: string, val: string | number, delta: string, cls = '') => (
    <div className="kpi">
      <div className="lab">{lab}</div>
      <div className="row2">
        <span className="val">{val}</span>
      </div>
      <div className={`delta ${cls}`}>{delta}</div>
    </div>
  );

  return (
    <div className="view active">
      <div className="dash">
        <section>
          <h2>This month</h2>
          <div className="kpis">
            {kpi('Open deals', open.length, `across ${stages.filter((s) => s.kind === 'working').length} working stages`)}
            {kpi('Quoted value', short(quoted), 'open deals with a quotation out')}
            {kpi('Won this month', wonMonth.length, `${short(wonMonth.reduce((a, d) => a + (d.contractValue ?? 0), 0))} contracted`, 'up')}
            {kpi('Win rate', `${winRate}%`, `${won.length} won · ${lost.length} lost all-time`, winRate >= 50 ? 'up' : 'warn')}
            {kpi('Balance outstanding', short(outstanding), outstanding ? `across ${won.filter((d) => d.balance).length} won deal(s)` : 'all cleared', outstanding ? 'warn' : 'up')}
            {kpi('Visits booked', booked.length, `${lostMonth.length} lost this month`)}
          </div>
        </section>

        <section className="dgrid">
          <div className="card">
            <div className="card__head">
              <h3>Pipeline</h3>
              <span className="aux">{deals.length} deals total</span>
            </div>
            <div className="card__body">
              <div className="funnel">
                {stages.map((s) => {
                  const list = deals.filter((d) => d.stage?.id === s.id);
                  const v = list.filter((d) => valueShown(d) || s.kind === 'won').reduce((a, d) => a + (d.value ?? 0), 0);
                  const col = s.kind === 'won' ? 'var(--signal-green)' : s.kind === 'lost' ? 'var(--signal-red)' : 'var(--accent)';
                  return (
                    <div key={s.id} className="fstep" onClick={() => nav(s.kind === 'lost' ? '/bd/lost' : `/bd/deals?stage=${s.id}`)}>
                      <span className="t">{s.name}</span>
                      <span className="track">
                        <span className="fill" style={{ width: `${((list.length / maxN) * 100).toFixed(1)}%`, background: col }} />
                      </span>
                      <span className="n">
                        {list.length}
                        <small>{v ? short(v) : '—'}</small>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card__head">
              <h3>Next site visits</h3>
              <span className="aux">booked</span>
            </div>
            <div className="card__body">
              {!booked.length && <div className="dash-empty">No measurements booked.</div>}
              {booked.slice(0, 8).map((d) => (
                <div key={d.id} className="due-item" onClick={() => openDeal(d.id)}>
                  <div>
                    <div className="dn">{d.customerName}</div>
                    <div className="dm">
                      {d.visit!.engineer} · {d.place ?? '—'}
                    </div>
                  </div>
                  <div className="dt">{friendly(d.visit!.scheduledAt)}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="dgrid">
          <div className="card">
            <div className="card__head">
              <h3>Balance ledger</h3>
              <span className="aux">{short(outstanding)} outstanding</span>
            </div>
            <div className="card__body">
              {!won.length && <div className="dash-empty">No won deals yet.</div>}
              {won.slice(0, 10).map((d) => (
                <div key={d.id} className="due-item" onClick={() => nav('/bd/payments')}>
                  <div>
                    <div className="dn">{d.customerName}</div>
                    <div className="dm">
                      {money(d.paid)} received of {money(d.contractValue)}
                    </div>
                  </div>
                  <div className={`dt ${d.balance ? 'hot' : ''}`}>{d.balance ? money(d.balance) : 'paid'}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="card__head">
              <h3>Why deals were lost</h3>
              <span className="aux">{lost.length} lost</span>
            </div>
            <div className="card__body">
              <Breakdown pairs={count(lost, (d) => d.lostReason)} color="var(--signal-red)" />
            </div>
          </div>
        </section>

        <section className="dgrid">
          <div className="card">
            <div className="card__head">
              <h3>Where the leads came from</h3>
              <span className="aux">platform, carried from the CRE desk</span>
            </div>
            <div className="card__body">
              <Breakdown pairs={count(deals, (d) => PLATFORM_LABEL[d.platform])} color="var(--signal-blue, #40628f)" />
            </div>
          </div>
          <div className="card">
            <div className="card__head">
              <h3>Handed over by</h3>
              <span className="aux">CRE desk</span>
            </div>
            <div className="card__body">
              <Breakdown pairs={count(deals, (d) => d.handedBy)} color="#6f5b93" />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
