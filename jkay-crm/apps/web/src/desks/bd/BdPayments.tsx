import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { waLink } from '@jkay/shared';
import { api } from '../../lib/api';
import { money, when } from '../../lib/format';
import { KIND_LABEL } from './bdShared';

type Ledger = {
  deals: {
    id: string;
    customerName: string;
    contactName: string | null;
    phone: string | null;
    place: string | null;
    contractValue: number;
    productionDate: string | null;
    wonAt: string;
    paid: number;
    balance: number;
    payments: { id: number; kind: string; amount: number; receivedOn: string; mode: string; reference: string | null }[];
  }[];
};

export function BdPayments({ filter }: { filter: 'all' | 'awaiting' }) {
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['bd', 'payments'], queryFn: () => api.get<Ledger>('/bd/payments'), refetchInterval: 60_000 });
  if (q.isLoading) return <div className="center-note">Loading…</div>;
  const deals = (q.data?.deals ?? []).filter((d) => filter === 'all' || d.balance > 0);
  const owing = deals.filter((d) => d.balance > 0);
  const outstanding = owing.reduce((a, d) => a + d.balance, 0);
  const open = (id: string) => nav(`/bd/deals?deal=${id}`);

  return (
    <div className="view active">
      <div className="pay-wrap">
        {outstanding > 0 && (
          <div className="sla-banner">
            <span className="pulse"></span>
            <span>
              <strong>{money(outstanding)} outstanding</strong> across {owing.length} won deal{owing.length === 1 ? '' : 's'}. Set a production date on each deal so the final-balance alert fires in time.
            </span>
          </div>
        )}
        {!deals.length && <div className="dash-empty">{filter === 'all' ? 'No won deals to track yet.' : 'Nothing outstanding.'}</div>}
        {deals.map((d) => {
          const pct = d.contractValue ? Math.round((d.paid / d.contractValue) * 100) : 0;
          const reminder = `Hello ${d.contactName || d.customerName}, a gentle reminder that ${money(d.balance)} is pending on the ${d.customerName} order. Kindly arrange the payment so we can keep production on schedule.`;
          return (
            <div key={d.id} className="panel">
              <div className="panel__head">
                <h3>{d.customerName}</h3>
                <span className="count">
                  {d.place ?? '—'} · contract {money(d.contractValue)}
                </span>
              </div>
              <div className="panel__body">
                <div className="pay-row">
                  <span>Contract value</span>
                  <strong>{money(d.contractValue)}</strong>
                </div>
                {d.payments.map((p) => (
                  <div key={p.id} className="pay-row">
                    <span>
                      {KIND_LABEL[p.kind]} · {when(p.receivedOn + 'T12:00:00+05:30', { time: false, year: true })} · {p.mode}
                    </span>
                    <strong style={{ color: 'var(--signal-green)' }}>{money(p.amount)}</strong>
                  </div>
                ))}
                <div className="pay-row">
                  <span>Remaining balance</span>
                  <strong style={{ color: d.balance ? 'var(--accent-hover)' : 'var(--signal-green)' }}>{money(d.balance)}</strong>
                </div>
                <div className="bal-bar">
                  <div style={{ width: `${pct}%` }} />
                </div>
                <div className="small muted" style={{ marginTop: 11 }}>
                  {d.balance
                    ? `${pct}% received${d.productionDate ? ` · production ${when(d.productionDate + 'T12:00:00+05:30', { time: false })}` : ' · no production date set'}`
                    : 'Fully paid — installation can be closed out.'}
                </div>
                <div className="flex gap-8 mt-16" style={{ flexWrap: 'wrap' }}>
                  {d.balance > 0 && (
                    <button className="btn btn-signal btn-sm" onClick={() => open(d.id)}>
                      Record payment
                    </button>
                  )}
                  {d.balance > 0 && d.phone && (
                    <a className="btn btn-outline btn-sm" href={waLink(d.phone, reminder)} target="_blank" rel="noopener">
                      Send reminder
                    </a>
                  )}
                  <button className="btn btn-outline btn-sm" onClick={() => open(d.id)}>
                    Open deal
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
