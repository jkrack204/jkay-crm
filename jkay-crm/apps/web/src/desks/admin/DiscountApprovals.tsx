/** Admin › Discount approvals — BDE requests past the discount limit. Any Admin can decide; first decision wins. */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { money, when } from '../../lib/format';
import { Modal, useAction } from '../../components/ui';

type Req = {
  id: number;
  leadId: string;
  customerName: string;
  place: string | null;
  percent: number;
  highestQuote: number;
  proposedAmount: number | null;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected';
  by: string;
  at: string;
  decidedBy: string | null;
  decisionNote: string | null;
};

export function DiscountApprovals() {
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [deciding, setDeciding] = useState<{ r: Req; approve: boolean } | null>(null);
  const q = useQuery({ queryKey: ['discounts', status], queryFn: () => api.get<{ threshold: number; requests: Req[] }>(`/bd/discounts?status=${status}`), refetchInterval: 60_000 });
  const rows = q.data?.requests ?? [];
  return (
    <div className="view active">
      <div className="set-wrap">
        <div className="flex-col gap-12" style={{ maxWidth: 860 }}>
          <div className="flex gap-8" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="seg">
              {(['pending', 'approved', 'rejected'] as const).map((s) => (
                <button key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>
                  {s[0]!.toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
            <span className="small muted">BDEs can give up to {q.data?.threshold ?? '…'}% on their own. Change the limit in Settings (coming in the next build).</span>
          </div>
          {q.isLoading && <div className="dash-empty">Loading…</div>}
          {!q.isLoading && !rows.length && <div className="dash-empty">{status === 'pending' ? 'Nothing waiting on you.' : `No ${status} requests.`}</div>}
          {rows.map((r) => (
            <div key={r.id} className="panel">
              <div className="panel__head">
                <h3>
                  {r.customerName} · {r.percent}% off
                </h3>
                <span className="count">
                  {r.by} · {when(r.at)}
                </span>
              </div>
              <div className="panel__body">
                <div className="grid-2">
                  <div className="field">
                    <label>Highest quotation</label>
                    <input readOnly value={money(r.highestQuote)} />
                  </div>
                  <div className="field">
                    <label>Would come to</label>
                    <input readOnly value={money(r.proposedAmount)} />
                  </div>
                </div>
                <div className="small" style={{ margin: '10px 0' }}>
                  <b>Why:</b> {r.reason}
                </div>
                {r.status === 'pending' ? (
                  <div className="flex gap-8">
                    <button className="btn btn-signal" onClick={() => setDeciding({ r, approve: true })}>
                      Approve
                    </button>
                    <button className="btn btn-outline" onClick={() => setDeciding({ r, approve: false })}>
                      Reject
                    </button>
                  </div>
                ) : (
                  <div className="small muted">
                    {r.status === 'approved' ? 'Approved' : 'Rejected'} by {r.decidedBy ?? '—'}
                    {r.decisionNote ? ` — “${r.decisionNote}”` : ''}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      {deciding && <Decide r={deciding.r} approve={deciding.approve} onClose={() => setDeciding(null)} />}
    </div>
  );
}

function Decide({ r, approve, onClose }: { r: Req; approve: boolean; onClose: () => void }) {
  const [note, setNote] = useState('');
  const go = useAction(() => api.post(`/bd/discounts/${r.id}/decide`, { approve, note: note || undefined }), {
    ok: approve ? 'Approved — the BDE has been told' : 'Rejected — the BDE has been told',
    invalidate: [['discounts'], ['notifications']],
  });
  return (
    <Modal
      title={`${approve ? 'Approve' : 'Reject'} ${r.percent}% off ${r.customerName}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-signal" disabled={go.isPending} onClick={() => go.mutate(undefined, { onSuccess: onClose })}>
            {approve ? 'Approve' : 'Reject'}
          </button>
        </>
      }
    >
      <div className="field">
        <label>Note to {r.by}</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={approve ? 'Optional — e.g. OK this once, hold the lift charge' : 'Optional — why not'} />
      </div>
    </Modal>
  );
}
