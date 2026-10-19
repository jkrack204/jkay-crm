/**
 * The deal record — ported from the BD mockup's deal sheet.
 * Everything the CRE wrote is read-only here; the BDE adds visits, drawings,
 * quotations, payments, tags and private notes.
 */
import { useEffect, useRef, useState } from 'react';
import { telLink } from '@jkay/shared';
import { api } from '../../lib/api';
import { useConfig, useMe } from '../../lib/session';
import { friendly, money, phone, platformLabel, toneClass, when } from '../../lib/format';
import { fileUrl } from '../../lib/upload';
import type { DealDetail } from '../../lib/types';
import { useAction } from '../../components/ui';
import { Photos } from '../../components/Photos';
import { Activity, Notes, Owners } from '../cre/LeadSheet';
import { PLAT_KEY } from '../cre/CreList';
import { bdInvalidate, bdStagesOf, chipKeyFor, KIND_LABEL, useDeal } from './bdShared';
import { CadModal, CallModal, DiscountModal, LostModal, PaymentModal, QuoteModal, VisitModal, WhatsAppModal } from './BdModals';

type ModalKind = 'call' | 'call-cre' | 'wa' | 'wa-cre' | 'visit' | 'cad' | 'quote' | 'pay' | 'discount' | 'lost' | null;

const ICON = {
  phone: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M3 2.6h2.2l1 2.5-1.4 1a7.4 7.4 0 0 0 3.7 3.7l1-1.4 2.5 1V11a2 2 0 0 1-2.2 2A9.6 9.6 0 0 1 2 4.8 2 2 0 0 1 3 2.6Z" />
    </svg>
  ),
  wa: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 13.5l.9-2.8A5.6 5.6 0 1 1 5.6 12.8l-3.1.7Z" />
      <path d="M6 6.2c.3 1.6 2 3.3 3.6 3.6l.7-.9 1.2.5-.2 1a3.9 3.9 0 0 1-4-1.4A4 4 0 0 1 5.6 5l1-.2.5 1.2-.9.2Z" />
    </svg>
  ),
};

export function DealSheet({ dealId, onClose }: { dealId: string; onClose: () => void }) {
  const { data: me } = useMe();
  const { data: config } = useConfig();
  const [modal, setModal] = useState<ModalKind>(null);
  const [preset, setPreset] = useState<string | undefined>();
  const q = useDeal(dealId);
  const d = q.data;

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !modal && onClose();
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [modal, onClose]);

  if (q.isLoading) return <div className="center-note">Loading…</div>;
  if (q.isError || !d)
    return (
      <div className="d-scroll">
        <span className="sheet-close" onClick={onClose}>
          ✕
        </span>
        <div className="center-note">{(q.error as Error)?.message ?? 'Deal not found'}</div>
      </div>
    );

  const l = d.lead;
  const bd = d.bd;
  const stages = bdStagesOf(config?.stages);
  const lost = !!l.lost;
  const won = !!l.wonAt && !lost;
  const canEdit = !!me && (me.role === 'admin' || l.owner?.id === me.id);
  const quoted = bd.quotations.length > 0;
  const stage = stages.find((s) => s.id === l.bdStage?.id);
  const showMoney = won || (!lost && !!stage?.showsValue && quoted);
  const pendingDiscount = bd.discounts.find((x) => x.status === 'pending');
  const close = () => setModal(null);

  return (
    <>
      <div className="d-scroll">
        <div className="d-band">
          <span className="sheet-close" onClick={onClose} title="Close (esc)">
            ✕
          </span>
          <div className="d-band__top">
            <div style={{ minWidth: 0 }}>
              <h2>{l.customerName}</h2>
              <div className="who">
                {l.contactName || '—'} · {phone(l.phone)} · {l.place || '—'} · #{l.number}
              </div>
              {l.phone && (
                <div className="d-contact">
                  <span className="cbtn__who">Client</span>
                  <a className="cbtn" href={telLink(l.phone)} onClick={() => canEdit && setTimeout(() => setModal('call'), 300)}>
                    {ICON.phone}Call
                  </a>
                  <button className="cbtn wa" onClick={() => setModal('wa')}>
                    {ICON.wa}WhatsApp
                  </button>
                </div>
              )}
            </div>
            <div className="val">
              {showMoney ? money(bd.value) : '—'}
              <small>{showMoney ? (won ? 'contract value' : `quotation v${bd.quotations[0]?.version}`) : quoted && !lost ? 'hidden until quoted stage' : 'no quotation issued'}</small>
            </div>
          </div>
          <div className="d-band__foot">
            <span className="stage-chip" data-s={chipKeyFor(stages, l.bdStage?.id)}>
              {l.bdStage?.name}
            </span>
            <span className="plat" data-p={PLAT_KEY[l.platform]}>
              <i></i>
              {platformLabel(l.platform)}
            </span>
            {lost && <span className="tag">{l.lost!.reason}</span>}
            {pendingDiscount && <span className="tag tag-cna2">{pendingDiscount.percent}% discount pending</span>}
            <span style={{ flex: 1 }}></span>
            {canEdit && lost && l.lost?.desk === 'bd' && <Reopen id={l.id} />}
            {canEdit && !lost && (
              <>
                <StagePicker d={d} />
                {!won && (
                  <button className="btn" onClick={() => setModal('visit')}>
                    {bd.visits.some((v) => v.status === 'booked') ? 'Reschedule visit' : 'Schedule visit'}
                  </button>
                )}
                <button className="btn" onClick={() => setModal('cad')}>
                  CAD revision
                </button>
                {!won && (
                  <button className="btn btn-signal" onClick={() => setModal('quote')}>
                    New quotation
                  </button>
                )}
                {(won || quoted) && (
                  <button className={`btn ${won ? 'btn-signal' : ''}`} onClick={() => setModal('pay')}>
                    {won ? 'Record payment' : 'Record advance'}
                  </button>
                )}
                {!won && (
                  <button className="btn" onClick={() => setModal('lost')}>
                    Mark lost
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        <div className="d-body">
          {/* ------------------------- from the CRE desk ------------------------ */}
          <div className="d-sec">
            <div className="d-sec__head">
              <h4>Handed over by the CRE desk</h4>
              <span className="aux">{when(l.qualifiedAt)}</span>
            </div>
            <div className="edit-note">
              <span>◆</span>Everything in this block was written by {bd.handedBy?.name ?? 'the CRE'} before hand-off. Platform and source carry over untouched.
            </div>
            <div className="kv">
              <div style={{ gridColumn: '1 / -1' }}>
                <dt>Requirement</dt>
                <dd>{l.requirement || '—'}</dd>
              </div>
              <div>
                <dt>Category</dt>
                <dd>{l.category?.name ?? '—'}</dd>
              </div>
              <div>
                <dt>Handed over by</dt>
                <dd className="locked">
                  <span className="cre-line">
                    {bd.handedBy?.name ?? '—'}
                    {bd.handedBy?.phone && (
                      <>
                        <a className="mini" href={telLink(bd.handedBy.phone)} onClick={() => canEdit && setTimeout(() => setModal('call-cre'), 300)}>
                          {ICON.phone}Call
                        </a>
                        <button className="mini" onClick={() => setModal('wa-cre')}>
                          {ICON.wa}WhatsApp
                        </button>
                      </>
                    )}
                  </span>
                </dd>
              </div>
              <div>
                <dt>Platform</dt>
                <dd className="locked">{platformLabel(l.platform)}</dd>
              </div>
              <div>
                <dt>Lead source</dt>
                <dd className="locked">{l.sourceLabel || '—'}</dd>
              </div>
              <div>
                <dt>Estimate at hand-off</dt>
                <dd className="locked">{l.estimate ? money(l.estimate) : '—'}</dd>
              </div>
              <div>
                <dt>Alt. phone / email</dt>
                <dd className="locked">{[l.altPhone ? phone(l.altPhone) : null, l.email].filter(Boolean).join(' · ') || '—'}</dd>
              </div>
            </div>
          </div>

          <Photos d={d} canAdd={canEdit && !lost} title="Site photos" />

          {/* --------------------------- measurement --------------------------- */}
          <div className="d-sec">
            <div className="d-sec__head">
              <h4>Site measurement</h4>
              <span className="aux">{bd.visits.some((v) => v.status === 'booked') ? 'booked' : bd.visits.some((v) => v.status === 'done') ? 'measured' : 'not booked'}</span>
            </div>
            {bd.visits.filter((v) => v.status !== 'cancelled').length === 0 && (
              <div className="dash-empty">No measurement booked. The layout can't be drawn until the site is measured.</div>
            )}
            {bd.visits
              .filter((v) => v.status !== 'cancelled')
              .map((v) => (
                <div key={v.id} className="frow">
                  <span className={`rev ${v.status === 'booked' ? 'live' : ''}`}>⌖</span>
                  <div>
                    <div className="t">{when(v.scheduledAt, { time: true, year: true })}</div>
                    <div className="m">
                      {v.engineer}
                      {v.note ? ` — ${v.note}` : ''}
                      {v.status === 'done' && v.doneAt ? ` · measured ${when(v.doneAt, { time: false })}` : ''}
                    </div>
                  </div>
                  <div className="a">{v.status === 'done' ? <span className="readonly-badge">measured</span> : canEdit && !lost && <VisitActions dealId={l.id} visitId={v.id} onMove={() => setModal('visit')} />}</div>
                </div>
              ))}
            {canEdit && !lost && !won && !bd.visits.some((v) => v.status === 'booked') && (
              <button className="btn btn-outline btn-sm" style={{ marginTop: 8 }} onClick={() => setModal('visit')}>
                {bd.visits.some((v) => v.status === 'done') ? 'Book another visit' : 'Schedule site measurement'}
              </button>
            )}
          </div>

          {/* ------------------------------- CAD ------------------------------- */}
          <div className="d-sec">
            <div className="d-sec__head">
              <h4>CAD &amp; drawings</h4>
              <span className="aux">
                {bd.cad.length} revision{bd.cad.length === 1 ? '' : 's'}
              </span>
            </div>
            {bd.cad.length === 0 && <div className="dash-empty">No drawing uploaded yet.</div>}
            {bd.cad.map((c, i) => (
              <div key={c.id} className="frow">
                <span className={`rev ${i === 0 ? 'live' : ''}`}>R{c.rev}</span>
                <div>
                  <div className="t">{c.fileName}</div>
                  <div className="m">
                    {c.note ? `${c.note} · ` : ''}
                    {when(c.at, { time: false })} · {c.by}
                  </div>
                </div>
                <div className="a">
                  {i === 0 && <span className="readonly-badge">current</span>}
                  <a className="btn btn-outline btn-sm" href={fileUrl(c.attachmentId)} target="_blank" rel="noopener">
                    Open
                  </a>
                </div>
              </div>
            ))}
            {canEdit && !lost && (
              <button className="btn btn-outline btn-sm" style={{ marginTop: 10 }} onClick={() => setModal('cad')}>
                Upload revision
              </button>
            )}
          </div>

          {/* ---------------------------- quotations ---------------------------- */}
          <div className="d-sec">
            <div className="d-sec__head">
              <h4>Quotations</h4>
              <span className="aux">{quoted ? `latest v${bd.quotations[0]!.version}` : 'none sent'}</span>
            </div>
            {!quoted && <div className="dash-empty">Nothing quoted yet — value stays hidden until the first quotation goes out.</div>}
            {bd.quotations.map((qq, i) => (
              <div key={qq.id} className="frow">
                <span className={`rev ${i === 0 ? 'live' : ''}`}>v{qq.version}</span>
                <div>
                  <div className="t">{qq.fileName ?? 'No file attached'}</div>
                  <div className="m">
                    {qq.note ? `${qq.note} · ` : ''}sent {when(qq.at, { time: false })} · {qq.by}
                  </div>
                </div>
                <div className="a">
                  <span className="amt">{money(qq.amount)}</span>
                  {qq.attachmentId && (
                    <a className="btn btn-outline btn-sm" href={fileUrl(qq.attachmentId)} target="_blank" rel="noopener">
                      Open
                    </a>
                  )}
                </div>
              </div>
            ))}
            {bd.discounts.map((x) => (
              <div key={x.id} className="frow">
                <span className={`rev ${x.status === 'pending' ? 'live' : ''}`}>%</span>
                <div>
                  <div className="t">
                    {x.percent}% discount · {x.status === 'pending' ? 'waiting on Admin' : `${x.status} by ${x.decidedBy ?? 'Admin'}`}
                  </div>
                  <div className="m">
                    {x.proposedAmount ? `${money(x.proposedAmount)} · ` : ''}
                    {x.reason}
                    {x.decisionNote ? ` — “${x.decisionNote}”` : ''} · {when(x.at, { time: false })}
                  </div>
                </div>
              </div>
            ))}
            {canEdit && !lost && !won && (
              <div className="flex gap-8" style={{ marginTop: 10, flexWrap: 'wrap' }}>
                <button className="btn btn-outline btn-sm" onClick={() => setModal('quote')}>
                  New quotation
                </button>
                {quoted && !pendingDiscount && (
                  <button className="btn btn-outline btn-sm" onClick={() => setModal('discount')}>
                    Ask Admin for a discount
                  </button>
                )}
              </div>
            )}
          </div>

          {/* ----------------------------- payments ----------------------------- */}
          {won && <Payments d={d} canEdit={canEdit} onPay={() => setModal('pay')} onRemind={(text) => (setPreset(text), setModal('wa'))} />}

          <Tags d={d} canEdit={canEdit} />
          <Notes d={d} canAdd={canEdit} />
          <Owners d={d} />
          <Activity d={d} />
        </div>
      </div>

      {modal === 'call' && <CallModal d={d} to="client" onClose={close} />}
      {modal === 'call-cre' && <CallModal d={d} to="cre" onClose={close} />}
      {modal === 'wa' && (
        <WhatsAppModal
          d={d}
          to="client"
          preset={preset}
          onClose={() => {
            setPreset(undefined);
            close();
          }}
        />
      )}
      {modal === 'wa-cre' && <WhatsAppModal d={d} to="cre" onClose={close} />}
      {modal === 'visit' && <VisitModal d={d} onClose={close} />}
      {modal === 'cad' && <CadModal d={d} onClose={close} />}
      {modal === 'quote' && <QuoteModal d={d} onClose={close} />}
      {modal === 'discount' && <DiscountModal d={d} onClose={close} />}
      {modal === 'pay' && <PaymentModal d={d} onClose={close} />}
      {modal === 'lost' && <LostModal d={d} onClose={close} />}
    </>
  );
}

/* ------------------------------ stage picker ----------------------------- */
function StagePicker({ d }: { d: DealDetail }) {
  const { data: config } = useConfig();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const stages = bdStagesOf(config?.stages).filter((s) => s.kind !== 'lost');
  const go = useAction((stageId: number) => api.post(`/bd/deals/${d.lead.id}/stage`, { stageId }), {
    ok: () => 'Stage updated',
    invalidate: bdInvalidate(d.lead.id),
  });
  useEffect(() => {
    const c = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('click', c);
    return () => document.removeEventListener('click', c);
  }, []);
  return (
    <div className={`stagedd ${open ? 'open' : ''}`} ref={ref}>
      <button className="stagedd__btn" onClick={() => setOpen((o) => !o)}>
        {d.lead.bdStage?.name}
        <i>▾</i>
      </button>
      <div className="stagedd__menu">
        {stages.map((s, i) => (
          <div
            key={s.id}
            className={`stagedd__item ${s.id === d.lead.bdStage?.id ? 'on' : ''}`}
            title={s.definition}
            onClick={() => {
              setOpen(false);
              if (s.id !== d.lead.bdStage?.id) go.mutate(s.id);
            }}
          >
            <span className="n">{i + 1}</span>
            {s.name}
          </div>
        ))}
      </div>
    </div>
  );
}

function Reopen({ id }: { id: string }) {
  const go = useAction(() => api.post(`/bd/deals/${id}/reopen`), { ok: 'Deal reopened', invalidate: bdInvalidate(id) });
  return (
    <button className="btn btn-signal" disabled={go.isPending} onClick={() => go.mutate(undefined)}>
      Reopen
    </button>
  );
}

function VisitActions({ dealId, visitId, onMove }: { dealId: string; visitId: number; onMove: () => void }) {
  const set = useAction((status: 'done' | 'cancelled') => api.post(`/bd/deals/${dealId}/visits/${visitId}`, { status }), {
    ok: () => 'Visit updated',
    invalidate: bdInvalidate(dealId),
  });
  return (
    <>
      <button className="btn btn-outline btn-sm" disabled={set.isPending} onClick={() => set.mutate('done')}>
        Mark measured
      </button>
      <button className="btn btn-outline btn-sm" onClick={onMove}>
        Reschedule
      </button>
      <button className="btn btn-outline btn-sm" disabled={set.isPending} onClick={() => set.mutate('cancelled')} title="Cancel this visit">
        ✕
      </button>
    </>
  );
}

/* -------------------------------- payments ------------------------------- */
function Payments({ d, canEdit, onPay, onRemind }: { d: DealDetail; canEdit: boolean; onPay: () => void; onRemind: (text: string) => void }) {
  const bd = d.bd;
  const [pd, setPd] = useState(bd.productionDate ?? '');
  useEffect(() => setPd(bd.productionDate ?? ''), [bd.productionDate]);
  const savePd = useAction((v: string | null) => api.put(`/bd/deals/${d.lead.id}/production-date`, { productionDate: v }), {
    ok: 'Production date saved',
    invalidate: bdInvalidate(d.lead.id),
  });
  const contract = bd.contractValue ?? 0;
  const pct = contract ? Math.round((bd.paid / contract) * 100) : 0;
  const reminder = `Hello ${d.lead.contactName || d.lead.customerName}, a gentle reminder that ${money(bd.balance)} is pending on the ${d.lead.customerName} order. Kindly arrange the payment so we can keep production on schedule.`;
  return (
    <div className="d-sec">
      <div className="d-sec__head">
        <h4>Payments</h4>
        <span className="aux">{bd.balance ? `${money(bd.balance)} outstanding` : 'fully paid'}</span>
      </div>
      <div className="pay-row">
        <span>Contract value</span>
        <strong>{money(contract)}</strong>
      </div>
      {bd.payments.map((p) => (
        <div key={p.id} className="pay-row">
          <span>
            {KIND_LABEL[p.kind]} · {when(p.receivedOn + 'T12:00:00+05:30', { time: false, year: true })} · {p.mode}
            {p.reference ? ` · ${p.reference}` : ''}
          </span>
          <strong style={{ color: 'var(--signal-green)' }}>{money(p.amount)}</strong>
        </div>
      ))}
      <div className="pay-row">
        <span>Remaining balance</span>
        <strong style={{ color: bd.balance ? 'var(--accent-hover)' : 'var(--signal-green)' }}>{money(bd.balance)}</strong>
      </div>
      <div className="bal-bar">
        <div style={{ width: `${pct}%` }} />
      </div>
      <div className="field" style={{ marginTop: 14, maxWidth: 320 }}>
        <label>Production run date</label>
        <div className="flex gap-8">
          <input type="date" value={pd} disabled={!canEdit} onChange={(e) => setPd(e.target.value)} />
          {canEdit && pd !== (bd.productionDate ?? '') && (
            <button className="btn btn-outline btn-sm" onClick={() => savePd.mutate(pd || null)}>
              Save
            </button>
          )}
        </div>
      </div>
      <div className="hint">{bd.productionDate ? `Production ${friendly(bd.productionDate + 'T10:00:00+05:30')}. The final-balance alert will fire a few days before.` : 'Optional — set it once production is scheduled.'}</div>
      {canEdit && (
        <div className="flex gap-8 mt-16" style={{ flexWrap: 'wrap' }}>
          {bd.balance ? (
            <button className="btn btn-signal btn-sm" onClick={onPay}>
              Record payment
            </button>
          ) : null}
          {bd.balance && d.lead.phone ? (
            <button className="btn btn-outline btn-sm" onClick={() => onRemind(reminder)}>
              Send balance reminder
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------- tags --------------------------------- */
function Tags({ d, canEdit }: { d: DealDetail; canEdit: boolean }) {
  const { data: config } = useConfig();
  const id = d.lead.id;
  const lib = (config?.tags ?? []).filter((t) => t.scope === 'bd');
  const mine = d.tags.filter((t) => t.scope === 'bd');
  const has = new Set(mine.map((t) => t.id));
  const add = useAction((tagId: number) => api.post(`/bd/deals/${id}/tags`, { tagId }), { invalidate: bdInvalidate(id) });
  const del = useAction((tagId: number) => api.del(`/bd/deals/${id}/tags/${tagId}`), { invalidate: bdInvalidate(id) });
  return (
    <div className="d-sec">
      <div className="d-sec__head">
        <h4>Deal tags</h4>
        <span className="aux">issued by Admin · they change no stage</span>
      </div>
      <div className="tagbox">
        {mine.length ? (
          mine.map((t) => (
            <span key={t.id} className={`tag ${toneClass(t.tone)}`}>
              {t.name}
              {canEdit && (
                <span className="rm" onClick={() => del.mutate(t.id)}>
                  ✕
                </span>
              )}
            </span>
          ))
        ) : (
          <span className="dash-empty">No tags on this deal.</span>
        )}
      </div>
      {canEdit && (
        <>
          <div className="tag-lock">Admin decides which tags exist. Pick one below — you can't create your own.</div>
          <div className="tag-pick">
            {lib
              .filter((t) => !has.has(t.id))
              .map((t) => (
                <button key={t.id} onClick={() => add.mutate(t.id)}>
                  + {t.name}
                </button>
              ))}
          </div>
        </>
      )}
    </div>
  );
}
