import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NOTE_COLORS, telLink } from '@jkay/shared';
import { api } from '../../lib/api';
import { useConfig, useMe } from '../../lib/session';
import { friendly, phone, platformLabel, toneClass, when } from '../../lib/format';
import type { LeadDetail } from '../../lib/types';
import { useAction } from '../../components/ui';
import { Photos } from '../../components/Photos';
import { PLAT_KEY } from './CreList';
import { CallModal, ClaimModal, FollopModal, HandoffModal, LostModal, StageModal, TransferModal, WhatsAppModal } from './CreModals';

type ModalKind = 'claim' | 'call' | 'wa' | 'followup' | 'stage' | 'handoff' | 'transfer' | 'lost' | null;

export function LeadSheet({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const { data: me } = useMe();
  const { data: config } = useConfig();
  const [modal, setModal] = useState<ModalKind>(null);
  const [editing, setEditing] = useState(false);

  const q = useQuery({ queryKey: ['lead', leadId], queryFn: () => api.get<LeadDetail>(`/leads/${leadId}`) });
  const d = q.data;
  const l = d?.lead;

  const isPool = l?.creStage?.kind === 'pool' && !l.owner;
  const mine = !!l && l.desk === 'cre' && !l.lost && l.owner?.id === me?.id;

  // keyboard: a c f m b l n w, esc
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = (e.target as HTMLElement).tagName;
      if (e.key === 'Escape' && !modal) return onClose();
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t) || modal) return;
      const map: Record<string, ModalKind> = mine ? { c: 'call', f: 'followup', m: 'stage', b: 'handoff', l: 'lost', w: 'wa' } : isPool ? { a: 'claim' } : {};
      if (map[e.key]) {
        e.preventDefault();
        setModal(map[e.key]!);
      } else if (e.key === 'n' && mine) {
        e.preventDefault();
        document.getElementById('note-input')?.focus();
      }
    };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [mine, isPool, modal, onClose]);

  if (q.isLoading) return <div className="center-note">Loading…</div>;
  if (q.isError || !d || !l)
    return (
      <div className="d-scroll">
        <div className="sheet-close" onClick={onClose}>
          ✕
        </div>
        <div className="center-note">{(q.error as Error)?.message ?? 'Lead not found'}</div>
      </div>
    );

  const kb = (k: string) => (
    <span className="kbd-hint" style={{ borderColor: 'rgba(255,255,255,.2)', background: 'rgba(255,255,255,.08)', color: '#cfc4b3' }}>
      {k}
    </span>
  );
  const stageLine = isPool ? 'Unclaimed' : l.desk === 'bd' ? l.bdStage?.name : l.lost ? 'Lost' : l.creStage?.name;
  const placeLine = isPool ? 'Pool' : l.desk === 'bd' ? 'Handed to BD' : l.lost ? 'Closed' : 'My Leads';

  return (
    <>
      <div className="sheet-close" onClick={onClose} title="Close (esc)">
        ✕
      </div>
      <div className="d-band">
        <div className="d-band__top">
          <div style={{ minWidth: 0 }}>
            <h2>{l.customerName}</h2>
            <div className="who">
              {phone(l.phone)} · {l.place ?? '—'} · came in from {platformLabel(l.platform)}
              {l.sourceLabel ? ` · source ${l.sourceLabel}` : ''} · #{l.number}
            </div>
          </div>
          <div className="val" style={{ fontSize: 14.5, fontWeight: 600 }}>
            {stageLine}
            <small>{placeLine}</small>
          </div>
        </div>
        <div className="d-band__foot">
          {l.stageTag && <span className={`tag ${toneClass(l.stageTag.tone)}`}>{l.stageTag.name}</span>}
          {l.lost && <span className="tag">{l.lost.reason}</span>}
          {l.category && <span className="tag">{l.category.name}</span>}
          {isPool && (
            <button className="btn btn-signal" onClick={() => setModal('claim')}>
              Claim lead {kb('a')}
            </button>
          )}
          {mine && (
            <>
              {l.phone && (
                <a className="btn" href={telLink(l.phone)} onClick={() => setTimeout(() => setModal('call'), 300)}>
                  Call {kb('c')}
                </a>
              )}
              {l.phone && (
                <button className="btn" onClick={() => setModal('wa')}>
                  WhatsApp
                </button>
              )}
              <button className="btn" onClick={() => setModal('followup')}>
                {d.followup ? 'Change follop' : 'Add follop'} {kb('f')}
              </button>
              <button className="btn" onClick={() => setModal('stage')}>
                Set stage {kb('m')}
              </button>
              <button className="btn btn-signal" onClick={() => setModal('handoff')}>
                Hand off to BD {kb('b')}
              </button>
              <button className="btn" onClick={() => setModal('transfer')}>
                Transfer
              </button>
              <button className="btn" onClick={() => setModal('lost')}>
                Mark lost {kb('l')}
              </button>
            </>
          )}
          {l.desk === 'bd' && (
            <span className="readonly-badge" style={{ color: '#b3a998', borderColor: 'rgba(255,255,255,.16)' }}>
              read-only — {l.owner?.name ?? 'BD'} owns this now
            </span>
          )}
          {l.lost && (
            <span className="readonly-badge" style={{ color: '#b3a998', borderColor: 'rgba(255,255,255,.16)' }}>
              read-only — closed
            </span>
          )}
        </div>
      </div>

      <div className="d-scroll">
        <div className="d-body">
          <Details d={d} canEdit={mine} editing={editing} setEditing={setEditing} />

          <div className="d-sec">
            <div className="d-sec__head">
              <h4>Requirement</h4>
              <span className="aux">{isPool ? 'Claim it before scheduling anything' : d.followup ? `Next follop ${friendly(d.followup.dueAt)}` : mine ? 'No follop yet — add one' : ''}</span>
            </div>
            <div className="kv">
              <div>
                <dt>What they asked for</dt>
                <dd>{l.requirement || '—'}</dd>
              </div>
              {!isPool && (
                <div>
                  <dt>Next follop</dt>
                  <dd>
                    {d.followup ? friendly(d.followup.dueAt) : 'None'}
                    {d.followup?.note ? ` · ${d.followup.note}` : ''}
                  </dd>
                </div>
              )}
            </div>
          </div>

          {(mine || d.photos.length > 0) && <Photos d={d} canAdd={mine} aux={mine ? 'BD sees these after hand-off' : undefined} />}

          {l.desk === 'bd' && (
            <div className="d-sec">
              <div className="d-sec__head">
                <h4>With BD</h4>
                <span className="aux">You cannot change any of this</span>
              </div>
              <div className="kv">
                <div>
                  <dt>Handed to</dt>
                  <dd>{l.owner?.name ?? '—'}</dd>
                </div>
                <div>
                  <dt>Handed off on</dt>
                  <dd>{when(l.qualifiedAt)}</dd>
                </div>
                <div>
                  <dt>BD stage</dt>
                  <dd className="big">{l.bdStage?.name}</dd>
                </div>
                <div>
                  <dt>Outcome</dt>
                  <dd>{l.lost ? `Lost · ${l.lost.reason}` : l.wonAt ? `Won ${when(l.wonAt, { time: false })}` : 'Still open with BD'}</dd>
                </div>
              </div>
            </div>
          )}

          {mine && <Tags d={d} freeTags={(config?.tags ?? []).filter((t) => t.scope === 'cre' && !t.stageId)} />}
          {(mine || d.notes.length > 0) && <Notes d={d} canAdd={mine} />}
          <Owners d={d} />
          <Activity d={d} />
        </div>
      </div>

      {modal === 'claim' && <ClaimModal lead={l} onClose={() => setModal(null)} onDone={onClose} />}
      {modal === 'call' && <CallModal lead={l} onClose={() => setModal(null)} />}
      {modal === 'wa' && <WhatsAppModal lead={l} onClose={() => setModal(null)} />}
      {modal === 'followup' && <FollopModal d={d} onClose={() => setModal(null)} />}
      {modal === 'stage' && <StageModal d={d} onClose={() => setModal(null)} />}
      {modal === 'handoff' && <HandoffModal lead={l} onClose={() => setModal(null)} onDone={onClose} />}
      {modal === 'transfer' && <TransferModal lead={l} onClose={() => setModal(null)} onDone={onClose} />}
      {modal === 'lost' && <LostModal lead={l} onClose={() => setModal(null)} onDone={onClose} />}
    </>
  );
}

/* ------------------------------ lead details ----------------------------- */
function Details({ d, canEdit, editing, setEditing }: { d: LeadDetail; canEdit: boolean; editing: boolean; setEditing: (b: boolean) => void }) {
  const { data: config } = useConfig();
  const l = d.lead;
  const [f, setF] = useState({ customerName: '', contactName: '', phone: '', place: '', sourceLabel: '', requirement: '', categoryId: '' });
  useEffect(() => {
    if (editing)
      setF({
        customerName: l.customerName,
        contactName: l.contactName ?? '',
        phone: l.phone ? `+${l.phone}` : '',
        place: l.place ?? '',
        sourceLabel: l.sourceLabel ?? '',
        requirement: l.requirement ?? '',
        categoryId: l.category ? String(l.category.id) : '',
      });
  }, [editing, l]);
  const save = useAction(
    () =>
      api.patch(`/cre/leads/${l.id}`, {
        customerName: f.customerName,
        contactName: f.contactName || null,
        ...(f.phone ? { phone: f.phone } : {}),
        place: f.place || null,
        sourceLabel: f.sourceLabel || null,
        requirement: f.requirement || null,
        categoryId: f.categoryId ? Number(f.categoryId) : null,
      }),
    { ok: 'Lead details updated', invalidate: [['lead', l.id], ['cre']] },
  );
  const inp = (k: keyof typeof f) => <input className="edit" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />;
  const transferred = d.owners.some((o) => o.reason === 'transfer');
  const lastOwner = d.owners.at(-1);

  return (
    <div className="d-sec">
      <div className="d-sec__head">
        <h4>Lead details</h4>
        <span className="aux">
          {canEdit ? (
            editing ? (
              <>
                <button className="btn btn-signal" disabled={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: () => setEditing(false) })}>
                  Save
                </button>{' '}
                <button className="btn btn-outline" onClick={() => setEditing(false)}>
                  Discard
                </button>
              </>
            ) : (
              <button className="btn btn-outline" onClick={() => setEditing(true)}>
                Edit details
              </button>
            )
          ) : (
            'Read-only'
          )}
        </span>
      </div>
      {editing && (
        <div className="edit-note">
          <span>Dates, stage and ownership are written by the system — those stay locked. Every edit is recorded in the activity log.</span>
        </div>
      )}
      <div className="kv">
        <div>
          <dt>Customer name</dt>
          <dd>{editing ? inp('customerName') : l.customerName}</dd>
        </div>
        <div>
          <dt>Contact person</dt>
          <dd>{editing ? inp('contactName') : l.contactName || '—'}</dd>
        </div>
        <div>
          <dt>Phone number</dt>
          <dd>{editing ? inp('phone') : phone(l.phone)}</dd>
        </div>
        <div>
          <dt>Place</dt>
          <dd>{editing ? inp('place') : l.place || '—'}</dd>
        </div>
        <div>
          <dt>Came in from</dt>
          <dd>
            <span className="plat" data-p={PLAT_KEY[l.platform]}>
              <i></i>
              {platformLabel(l.platform)}
            </span>
          </dd>
        </div>
        <div>
          <dt>Lead source</dt>
          <dd>{editing ? inp('sourceLabel') : l.sourceLabel || '—'}</dd>
        </div>
        <div>
          <dt>Product category</dt>
          <dd>
            {editing ? (
              <select className="edit" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>
                <option value="">—</option>
                {config?.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            ) : (
              l.category?.name ?? '—'
            )}
          </dd>
        </div>
        <div>
          <dt>Lead created</dt>
          <dd className="locked">{when(l.createdAt, { time: true, year: true })}</dd>
        </div>
        <div>
          <dt>{transferred ? 'Transferred by' : 'Assigned by'}</dt>
          <dd className="locked">
            {!lastOwner || !l.owner ? '—' : lastOwner.reason === 'claim' ? 'Self-assigned' : lastOwner.by}
          </dd>
        </div>
        <div>
          <dt>{transferred ? 'Transferred on' : 'Assigned on'}</dt>
          <dd className="locked">{l.owner ? when(l.ownerSince) : '—'}</dd>
        </div>
        <div>
          <dt>Qualified to</dt>
          <dd className="locked">{l.desk === 'bd' ? `${l.owner?.name ?? '—'} · ${when(l.qualifiedAt)}` : '—'}</dd>
        </div>
        <div>
          <dt>Won / lost</dt>
          <dd className="locked">{l.lost ? `${when(l.lost.at, { time: false })} · ${l.lost.reason}` : l.wonAt ? when(l.wonAt, { time: false }) : '—'}</dd>
        </div>
        {editing && (
          <div style={{ gridColumn: '1 / -1' }}>
            <dt>Requirement</dt>
            <dd>
              <textarea className="edit" rows={2} value={f.requirement} onChange={(e) => setF({ ...f, requirement: e.target.value })} />
            </dd>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------- tags --------------------------------- */
function Tags({ d, freeTags }: { d: LeadDetail; freeTags: { id: number; name: string; tone: string }[] }) {
  const id = d.lead.id;
  const add = useAction((tagId: number) => api.post(`/cre/leads/${id}/tags`, { tagId }), { invalidate: [['lead', id], ['cre']] });
  const del = useAction((tagId: number) => api.del(`/cre/leads/${id}/tags/${tagId}`), { invalidate: [['lead', id], ['cre']] });
  const has = new Set(d.tags.map((t) => t.id));
  return (
    <div className="d-sec">
      <div className="d-sec__head">
        <h4>Tags</h4>
        <span className="aux">issued by Admin</span>
      </div>
      <div className="tagbox">
        {d.lead.stageTag && <span className={`tag ${toneClass(d.lead.stageTag.tone)}`}>{d.lead.stageTag.name}</span>}
        {d.tags.map((t) => (
          <span key={t.id} className={`tag ${toneClass(t.tone)}`}>
            {t.name}
            <span className="rm" onClick={() => del.mutate(t.id)} title="Remove">
              ✕
            </span>
          </span>
        ))}
        {!d.lead.stageTag && !d.tags.length && <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No tags yet.</span>}
      </div>
      <div className="tag-lock">Admin decides which tags exist. Pick one below — you can't create your own.</div>
      <div className="tag-pick">
        {freeTags
          .filter((t) => !has.has(t.id))
          .map((t) => (
            <button key={t.id} onClick={() => add.mutate(t.id)}>
              + {t.name}
            </button>
          ))}
      </div>
    </div>
  );
}

/* ---------------------------------- notes -------------------------------- */
export function Notes({ d, canAdd }: { d: LeadDetail; canAdd: boolean }) {
  const id = d.lead.id;
  const [text, setText] = useState('');
  const [color, setColor] = useState<string>(NOTE_COLORS[0]);
  const add = useAction(() => api.post(`/leads/${id}/notes`, { text, color }), { ok: 'Note added', invalidate: [['lead', id]] });
  const pin = useAction((n: { id: number; pinned: boolean }) => api.patch(`/leads/${id}/notes/${n.id}`, { pinned: !n.pinned }), { invalidate: [['lead', id]] });
  const del = useAction((nid: number) => api.del(`/leads/${id}/notes/${nid}`), { ok: 'Note deleted', invalidate: [['lead', id]] });
  return (
    <div className="d-sec">
      <div className="d-sec__head">
        <h4>Notes</h4>
        <span className="aux">
          {d.notes.length} {d.notes.length === 1 ? 'note' : 'notes'}
          {canAdd && (
            <>
              {' '}
              · <span className="kbd-hint">n</span>
            </>
          )}
        </span>
      </div>
      {canAdd && (
        <div className="note-new">
          <textarea id="note-input" placeholder="Customer quirks, gate codes, who to ask for…" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="r">
            <div className="swatches">
              {NOTE_COLORS.map((c) => (
                <div key={c} className={`swatch ${c === color ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />
              ))}
            </div>
            <button className="btn btn-signal" style={{ marginLeft: 'auto' }} disabled={!text.trim() || add.isPending} onClick={() => add.mutate(undefined, { onSuccess: () => setText('') })}>
              Add note
            </button>
          </div>
        </div>
      )}
      <div className="notes-stack">
        {d.notes.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No notes yet.</div>}
        {d.notes.map((n) => (
          <div key={n.id} className={`note ${n.pinned ? 'pin' : ''}`} style={{ background: n.color }}>
            <p>{n.text}</p>
            <div className="note__foot">
              <span>
                {n.author} · {when(n.createdAt, { time: false })}
              </span>
              {n.mine && (
                <span className="note__act">
                  <span onClick={() => pin.mutate(n)}>{n.pinned ? 'Unpin' : 'Pin'}</span>
                  <span onClick={() => del.mutate(n.id)}>Delete</span>
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------- owner log ------------------------------ */
const REASON: Record<string, string> = {
  intake: 'Landed in the pool',
  claim: 'Claimed from the pool',
  admin_assign: 'Assigned by Admin',
  transfer: 'Transferred',
  handoff: 'Handed off to BD',
  reassign: 'Reassigned by Admin',
  release: 'Released to the pool',
};
export function Owners({ d }: { d: LeadDetail }) {
  const rows = [...d.owners].reverse();
  return (
    <div className="d-sec">
      <div className="d-sec__head">
        <h4>Owner log</h4>
        <span className="aux">
          {d.owners.length} {d.owners.length === 1 ? 'owner' : 'owners'}
        </span>
      </div>
      <div className="owners">
        {rows.map((o, i) => (
          <div key={i} className={`owner-row ${!o.to ? 'now' : ''}`}>
            <span className="dot" />
            <div>
              <div className="who">
                {o.owner}
                {!o.to ? ' · current' : ''}
              </div>
              <div className="why">
                {REASON[o.reason] ?? o.reason}
                {o.reason !== 'claim' && o.by !== o.owner ? ` by ${o.by}` : ''}
                {o.note ? ` — ${o.note}` : ''}
              </div>
            </div>
            <div className="span">
              {when(o.from)}
              {o.to ? (
                <>
                  <br />→ {when(o.to)}
                </>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------- activity ------------------------------- */
export function Activity({ d }: { d: LeadDetail }) {
  return (
    <div className="d-sec">
      <div className="d-sec__head">
        <h4>Activity</h4>
        <span className="aux">
          {d.activity.length} {d.activity.length === 1 ? 'entry' : 'entries'}
        </span>
      </div>
      {d.activity.length ? (
        <div className="tl">
          {d.activity.map((a) => (
            <div key={a.id} className="tl-item">
              <div className="tl-av" title={a.by} style={{ background: a.by === 'System' ? '#f1eee8' : '#f4e9dd', color: a.by === 'System' ? '#7c776e' : '#8a5a36' }}>
                {a.by === 'System' ? '◈' : a.by.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
              </div>
              <div className="tl-body">
                <div className="t">{a.title}</div>
                <div className="m">
                  {a.by} · {when(a.at)}
                  {a.body ? (
                    <>
                      {' · '}
                      <em>{a.body}</em>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Nothing yet.</div>
      )}
    </div>
  );
}

