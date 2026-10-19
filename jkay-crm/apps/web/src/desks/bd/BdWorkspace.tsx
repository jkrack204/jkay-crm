/** Settings › Workspace for a BDE: the rules Admin set, the tag library, and all your private notes. */
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useConfig } from '../../lib/session';
import { toneClass, when } from '../../lib/format';
import { bdStagesOf, useDeals } from './bdShared';

type MyNote = { id: number; text: string; color: string; pinned: boolean; createdAt: string; leadId: string; customerName: string };

export function BdWorkspace({ pane }: { pane: 'rules' | 'notes' }) {
  const { data: config } = useConfig();
  const deals = useDeals();
  const nav = useNavigate();
  const notes = useQuery({ queryKey: ['bd', 'notes'], queryFn: () => api.get<{ notes: MyNote[] }>('/bd/notes'), enabled: pane === 'notes' });
  const stages = bdStagesOf(config?.stages);
  const lib = (config?.tags ?? []).filter((t) => t.scope === 'bd');
  const lost = (config?.tags ?? []).filter((t) => t.scope === 'bd_lost');
  const threshold = Number(config?.settings?.discount_threshold_pct ?? 8);

  if (pane === 'notes')
    return (
      <div className="view active">
        <div className="set-wrap">
          <div className="panel" style={{ maxWidth: 760 }}>
            <div className="panel__head">
              <h3>All my notes</h3>
              <span className="count">Private to you</span>
            </div>
            <div className="panel__body">
              {notes.isLoading && <div className="dash-empty">Loading…</div>}
              {!notes.isLoading && !notes.data?.notes.length && <div className="dash-empty">You haven't written any notes yet.</div>}
              <div className="notes-stack">
                {notes.data?.notes.map((n) => (
                  <div key={n.id} className={`note ${n.pinned ? 'pin' : ''}`} style={{ background: n.color }}>
                    <p>{n.text}</p>
                    <div className="note__foot">
                      <span>
                        {n.customerName} · {when(n.createdAt, { time: false })}
                      </span>
                      <span className="note__act">
                        <span onClick={() => nav(`/bd/deals?deal=${n.leadId}`)}>Open deal</span>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );

  return (
    <div className="view active">
      <div className="set-wrap">
        <div className="flex-col gap-12" style={{ maxWidth: 760 }}>
          <div className="panel">
            <div className="panel__head">
              <h3>Deal &amp; quotation rules</h3>
              <span className="count">Set by Admin · read-only</span>
            </div>
            <div className="panel__body flex-col gap-12">
              <div className="pay-row">
                <span>Discount you can give without approval</span>
                <strong>{threshold}%</strong>
              </div>
              <div className="pay-row">
                <span>Value is shown from</span>
                <strong>{stages.find((s) => s.showsValue)?.name ?? '—'}</strong>
              </div>
              <div className="pay-row">
                <span>Advance received</span>
                <strong>marks the deal Won</strong>
              </div>
              <div>
                <div className="small muted" style={{ marginBottom: 6 }}>
                  Stages
                </div>
                {stages.map((s, i) => (
                  <div key={s.id} className="pay-row">
                    <span>
                      {i + 1}. <b style={{ color: 'var(--text-strong)', fontWeight: 600 }}>{s.name}</b> — {s.definition}
                    </span>
                    <strong style={{ fontWeight: 400, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{s.requiresQuotation ? 'needs a quotation' : ''}</strong>
                  </div>
                ))}
              </div>
              <div>
                <div className="small muted" style={{ marginBottom: 6 }}>
                  Lost reasons — one is mandatory on every lost deal
                </div>
                <div className="tagbox">
                  {lost.map((t) => (
                    <span key={t.id} className={`tag ${toneClass(t.tone)}`}>
                      {t.name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel__head">
              <h3>Deal tags</h3>
              <span className="count">Issued by Admin · read-only</span>
            </div>
            <div className="panel__body">
              <div className="small muted" style={{ marginBottom: 10 }}>
                These are the only tags you can put on a deal. Admin creates and removes them — ask them if you need a new one.
              </div>
              {lib.map((t) => {
                const n = (deals.data?.deals ?? []).filter((d) => d.tags.some((x) => x.id === t.id)).length;
                return (
                  <div key={t.id} className="tagrow">
                    <span className={`tag ${toneClass(t.tone)}`}>{t.name}</span>
                    <span className="u">
                      on {n} deal{n === 1 ? '' : 's'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
