/**
 * The Admin's view of any lead or deal — ported from the Admin mockup's record sheet.
 * Stage map across both desks, the Admin's private tags / notes / watch, BD money,
 * lost details, owner log and activity. Admin can reassign ownership from here.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useConfig } from '../../lib/session';
import { money, phone, when } from '../../lib/format';
import { fileUrl } from '../../lib/upload';
import type { DealDetail, Employee, LeadDetail, Stage } from '../../lib/types';
import { Modal, useAction } from '../../components/ui';
import { Activity, Owners } from '../cre/LeadSheet';
import { KIND_LABEL } from '../bd/bdShared';
import { StickyNotes } from './StickyNotes';
import { adminInvalidate, Pill, platformName, tonePill, type AdminRecord } from './adminShared';

export function RecordSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.modal-overlay.open') && onClose();
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <>
      <div className={`scrim ${id ? 'on' : ''}`} onClick={onClose} />
      <aside className={`sheet ${id ? 'on' : ''}`}>{id && <SheetBody id={id} onClose={onClose} />}</aside>
    </>
  );
}

function SheetBody({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: config } = useConfig();
  const [notesOpen, setNotesOpen] = useState(false);
  const [reassign, setReassign] = useState(false);
  const rec = useQuery({ queryKey: ['admin', 'record', id], queryFn: () => api.get<{ record: AdminRecord }>(`/admin/records/${id}`) });
  const r = rec.data?.record;
  const detail = useQuery({
    queryKey: ['lead', id, 'admin', r?.desk],
    queryFn: () => (r!.desk === 'bd' ? api.get<DealDetail>(`/bd/deals/${id}`) : api.get<LeadDetail>(`/leads/${id}`)),
    enabled: !!r,
  });
  const watch = useAction((on: boolean) => api.put(`/admin/records/${id}/watch`, { on }), {
    ok: (o: unknown) => ((o as { watch: boolean }).watch ? 'Notifying you on every move' : 'Stopped notifications'),
    invalidate: adminInvalidate,
  });
  const addTag = useAction((tagId: number) => api.post(`/admin/records/${id}/tags`, { tagId }), { invalidate: adminInvalidate });
  const dropTag = useAction((tagId: number) => api.del(`/admin/records/${id}/tags/${tagId}`), { invalidate: adminInvalidate });

  if (rec.isLoading) return <div className="empty">Loading…</div>;
  if (!r)
    return (
      <div className="sheet__scroll">
        <div className="sheet-x" onClick={onClose}>
          ✕
        </div>
        <div className="empty">{(rec.error as Error)?.message ?? 'Record not found'}</div>
      </div>
    );

  const d = detail.data;
  const bd = r.desk === 'bd';
  const quoted = bd && r.latestQuote != null;
  const val = quoted ? (r.contractValue ?? r.latestQuote) : r.estimate;
  const adminLib = (config?.tags ?? []).filter((t) => t.scope === 'admin');
  const stagesOf = (desk: 'cre' | 'bd') => (config?.stages ?? []).filter((s) => s.desk === desk && s.kind !== 'lost').sort((a, b) => a.position - b.position);
  const bdBlock = bd ? (d as DealDetail | undefined)?.bd : undefined;

  return (
    <div className="sheet__scroll">
      <div className="sheet__band">
        <div className="sheet-x" onClick={onClose}>
          ✕
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14 }}>
          <div style={{ minWidth: 0 }}>
            <h2>{r.customerName}</h2>
            <div className="w">
              {[r.contactName, phone(r.phone), r.place].filter(Boolean).join(' · ')} · #{r.number}
            </div>
            <div className="row">
              <Pill tone={bd ? 'blue' : ''}>{bd ? 'BD desk' : 'CRE desk'}</Pill>
              <Pill>{platformName(r.platform)}</Pill>
              {r.watch && <Pill tone="amber">Watching</Pill>}
              {r.discountPending && <Pill tone="violet">Discount waiting</Pill>}
              {r.wonAt && !r.lost && <Pill tone="green">Won</Pill>}
              {r.lost && <Pill tone="red">Lost</Pill>}
            </div>
          </div>
          <div style={{ textAlign: 'right', fontSize: 20, fontWeight: 600, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums', color: 'var(--text-strong)', whiteSpace: 'nowrap' }}>
            {val ? money(val) : '—'}
            <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)' }}>{r.contractValue ? 'contract value' : quoted ? 'latest quotation' : 'CRE estimate'}</div>
          </div>
        </div>
        {!r.lost && (
          <div className="row">
            <button className="btn btn-outline btn-sm" onClick={() => setReassign(true)}>
              {bd ? 'Reassign BDE' : r.owner ? 'Reassign CRE' : 'Assign to a CRE'}
            </button>
            <button className={`btn btn-sm ${r.watch ? 'btn-signal' : 'btn-outline'}`} onClick={() => watch.mutate(!r.watch)}>
              {r.watch ? '● Notifying me' : 'Notify me'}
            </button>
          </div>
        )}
      </div>

      <div className="sec">
        <div className="sec__h">
          <h4>Ownership</h4>
          <span className="aux">{r.owner ? `since ${when(r.ownerSince)}` : 'unclaimed'}</span>
        </div>
        <dl className="kv">
          <div>
            <dt>CRE</dt>
            <dd>{r.cre?.name ?? (r.owner ? '—' : 'Unclaimed pool')}</dd>
          </div>
          <div>
            <dt>BDE</dt>
            <dd>{r.bde?.name ?? '—'}</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>
              {platformName(r.platform)}
              {r.sourceLabel ? ` · ${r.sourceLabel}` : ''}
            </dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>{when(r.createdAt, { time: true, year: true })}</dd>
          </div>
          {d?.lead.requirement && (
            <div style={{ gridColumn: '1 / -1' }}>
              <dt>Requirement</dt>
              <dd>{d.lead.requirement}</dd>
            </div>
          )}
          {r.nextFollowupAt && (
            <div>
              <dt>Next follop</dt>
              <dd>{when(r.nextFollowupAt)}</dd>
            </div>
          )}
          {r.lastContactAt && (
            <div>
              <dt>Last contact</dt>
              <dd>{when(r.lastContactAt)}</dd>
            </div>
          )}
        </dl>
      </div>

      <div className="sec">
        <div className="sec__h">
          <h4>Stage map</h4>
          <span className="aux">where this {bd ? 'deal' : 'lead'} sits</span>
        </div>
        <div className="desk-hdr">CRE desk</div>
        <StageMap stages={stagesOf('cre')} current={r.creStage?.id} lost={r.lost?.desk === 'cre' ? r.lost.reason : null} tag={!bd ? r.stageTag?.name : undefined} complete={bd} />
        {bd && (
          <>
            <div className="desk-hdr" style={{ marginTop: 15 }}>
              BD desk
            </div>
            <StageMap stages={stagesOf('bd')} current={r.bdStage?.id} lost={r.lost?.desk === 'bd' ? r.lost.reason : null} />
          </>
        )}
      </div>

      <div className="sec">
        <div className="sec__h">
          <h4>Admin — private</h4>
          <span className="aux">no CRE, BDE or other Admin sees this</span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {r.adminTags.length ? (
            r.adminTags.map((t) => (
              <Pill key={t.id} tone={tonePill(t.tone)} adm onClick={() => dropTag.mutate(t.id)} title="Remove">
                {t.name} ✕
              </Pill>
            ))
          ) : (
            <span className="muted" style={{ fontSize: 12.5 }}>
              No admin tag
            </span>
          )}
        </div>
        <div className="tagpick" style={{ marginBottom: 10 }}>
          {adminLib
            .filter((t) => !r.adminTags.some((x) => x.id === t.id))
            .map((t) => (
              <button key={t.id} onClick={() => addTag.mutate(t.id)}>
                + {t.name}
              </button>
            ))}
        </div>
        {notesOpen ? (
          <StickyNotes r={r} onClose={() => setNotesOpen(false)} />
        ) : (
          <>
            {r.notes.map((n) => (
              <div key={n.id} className="pc-note" style={{ borderLeft: `3px solid ${n.color}`, cursor: 'pointer' }} onClick={() => setNotesOpen(true)}>
                <b>{n.pinned ? 'Pinned note' : 'Admin note'} · {when(n.updatedAt, { time: false })}</b>
                {n.text}
              </div>
            ))}
            <button className="btn btn-outline btn-sm" style={{ marginTop: 8 }} onClick={() => setNotesOpen(true)}>
              {r.notes.length ? 'Edit notes' : 'Add a sticky note'}
            </button>
          </>
        )}
      </div>

      {bd && bdBlock && (
        <div className="sec">
          <div className="sec__h">
            <h4>On the BD desk</h4>
            <span className="aux">read-only · the BDE runs this</span>
          </div>
          <dl className="kv" style={{ marginBottom: 10 }}>
            <div>
              <dt>Site visits</dt>
              <dd>
                {bdBlock.visits.filter((v) => v.status === 'done').length} done
                {bdBlock.visits.some((v) => v.status === 'booked') ? ` · next ${when(bdBlock.visits.find((v) => v.status === 'booked')!.scheduledAt)}` : ''}
              </dd>
            </div>
            <div>
              <dt>Drawings</dt>
              <dd>{bdBlock.cad.length ? `rev ${bdBlock.cad[0]!.rev}` : 'none yet'}</dd>
            </div>
            {r.productionDate && (
              <div>
                <dt>Production run</dt>
                <dd>{when(r.productionDate + 'T12:00:00+05:30', { time: false, year: true })}</dd>
              </div>
            )}
          </dl>
          {bdBlock.quotations.map((q, i) => (
            <div key={q.id} className="mrow got" style={{ gridTemplateColumns: '40px 1fr auto auto' }}>
              <span className="k">v{q.version}</span>
              <span className="m">
                {q.note || (i === 0 ? 'latest' : '')} · {when(q.at, { time: false })}
              </span>
              <span className="amt">{money(q.amount)}</span>
              {q.attachmentId ? (
                <a className="btn btn-outline btn-sm" href={fileUrl(q.attachmentId)} target="_blank" rel="noopener">
                  Open
                </a>
              ) : (
                <span />
              )}
            </div>
          ))}
          {r.wonAt && (
            <div style={{ marginTop: 10 }}>
              {r.payments.map((p) => (
                <div key={p.id} className="mrow got">
                  <span className="dotm"></span>
                  <span className="k">{KIND_LABEL[p.kind]}</span>
                  <span className="m">
                    {when(p.receivedOn + 'T12:00:00+05:30', { time: false })} · {p.mode}
                  </span>
                  <span className="amt">{money(p.amount)}</span>
                  <span></span>
                </div>
              ))}
              <div className="mrow">
                <span className="dotm"></span>
                <span className="k">Balance</span>
                <span className="m"></span>
                <span className="amt">{money(Math.max(0, (r.contractValue ?? 0) - r.paid))}</span>
                <span></span>
              </div>
            </div>
          )}
        </div>
      )}

      {r.lost && (
        <div className="sec">
          <div className="sec__h">
            <h4>Lost</h4>
          </div>
          <dl className="kv">
            <div>
              <dt>Reason</dt>
              <dd>
                <Pill tone="red">{r.lost.reason}</Pill>
              </dd>
            </div>
            <div>
              <dt>Lost on</dt>
              <dd>{when(r.lost.at, { time: false, year: true })}</dd>
            </div>
            <div>
              <dt>Desk</dt>
              <dd>{r.lost.desk === 'bd' ? 'BD desk' : 'CRE desk'}</dd>
            </div>
            <div>
              <dt>By</dt>
              <dd>{r.lost.by ?? '—'}</dd>
            </div>
            {r.lost.note && (
              <div style={{ gridColumn: '1 / -1' }}>
                <dt>What happened</dt>
                <dd>{r.lost.note}</dd>
              </div>
            )}
          </dl>
        </div>
      )}

      {d && (
        <div className="sheet-desk-secs">
          <Owners d={d} />
          <Activity d={d} />
        </div>
      )}

      {reassign && <ReassignModal r={r} onClose={() => setReassign(false)} />}
    </div>
  );
}

/** `complete`: the CRE side of a lead that's already with BD — every step done. */
function StageMap({ stages, current, lost, tag, complete }: { stages: Stage[]; current?: number; lost: string | null; tag?: string; complete?: boolean }) {
  const idx = stages.findIndex((s) => s.id === current);
  return (
    <div className="smap">
      {stages.map((s, i) => {
        const cls = complete ? 'done' : lost ? (i <= idx ? 'done' : 'soon') : i < idx || (i === idx && s.kind === 'won') ? 'done' : i === idx ? 'now' : 'soon';
        return (
          <div key={s.id} className={`sm-row ${cls}`}>
            <div className="sm-dot">{cls === 'done' ? '✓' : i + 1}</div>
            <div>
              <div className="sm-lab">
                {s.name}
                {cls === 'now' && <span className="sm-badge">current{tag ? ` · ${tag}` : ''}</span>}
              </div>
              <div className="sm-def">{s.definition}</div>
            </div>
            <div className="sm-at">{cls === 'done' ? 'done' : cls === 'now' ? 'here' : ''}</div>
          </div>
        );
      })}
      {lost && (
        <div className="sm-row lost">
          <div className="sm-dot">✕</div>
          <div>
            <div className="sm-lab">
              Lost
              <span className="sm-badge" style={{ color: 'var(--signal-red)', borderColor: 'var(--signal-red-dim)' }}>
                closed
              </span>
            </div>
            <div className="sm-def">{lost}</div>
          </div>
          <div className="sm-at"></div>
        </div>
      )}
    </div>
  );
}

function ReassignModal({ r, onClose }: { r: AdminRecord; onClose: () => void }) {
  const emp = useQuery({ queryKey: ['employees'], queryFn: () => api.get<{ employees: Employee[] }>('/employees') });
  const role = r.desk === 'bd' ? 'bde' : 'cre';
  const people = (emp.data?.employees ?? []).filter((e) => e.active && e.role === role && e.id !== r.owner?.id);
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const target = to || (people[0]?.id ?? '');
  const go = useAction(() => api.post(`/admin/records/${r.id}/reassign`, { to: target, note }), { ok: 'Ownership moved', invalidate: adminInvalidate });
  return (
    <Modal
      title={r.desk === 'bd' ? `Reassign ${r.customerName} to another BDE` : `Assign ${r.customerName}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-signal" disabled={!target || !note.trim() || go.isPending} onClick={() => go.mutate(undefined, { onSuccess: onClose })}>
            Move it
          </button>
        </>
      }
    >
      <div className="field">
        <label>{r.desk === 'bd' ? 'New BDE' : 'New owner'}</label>
        <select value={target} onChange={(e) => setTo(e.target.value)}>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.fullName}
            </option>
          ))}
          {r.desk === 'cre' && r.owner && <option value="pool">Back to the unclaimed pool</option>}
        </select>
      </div>
      <div className="field">
        <label>
          Why <span className="req">*</span>
        </label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="On leave, territory, workload…" />
      </div>
      <div className="hint">
        Ownership moves at once and is written to the owner log. {r.owner ? `${r.owner.name} and the new owner are both told.` : 'The new owner is told.'}
        {r.desk === 'bd' ? " The BDE's private notes stay with them." : ' Any open follop moves with the lead.'}
      </div>
    </Modal>
  );
}
