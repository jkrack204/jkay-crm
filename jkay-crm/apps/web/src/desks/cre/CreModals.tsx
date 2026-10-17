import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TRANSFER_REASONS, waLink } from '@jkay/shared';
import { api } from '../../lib/api';
import { useConfig, useMe } from '../../lib/session';
import { isoToIstParts, istToIso, phone, tomorrowIst } from '../../lib/format';
import type { Employee, LeadDetail } from '../../lib/types';
import { Modal, useAction } from '../../components/ui';

type L = LeadDetail['lead'];
const inv = (id: string) => [['lead', id], ['cre'], ['notifications']];

function useEmployees() {
  return useQuery({ queryKey: ['employees'], queryFn: () => api.get<{ employees: Employee[] }>('/employees'), staleTime: 60_000 });
}

function DateTime({ date, time, setDate, setTime }: { date: string; time: string; setDate: (s: string) => void; setTime: (s: string) => void }) {
  return (
    <div className="grid-2">
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
    </div>
  );
}

/* --------------------------------- claim --------------------------------- */
export function ClaimModal({ lead, onClose, onDone }: { lead: L; onClose: () => void; onDone: () => void }) {
  const go = useAction(() => api.post(`/cre/leads/${lead.id}/claim`), { ok: `${lead.customerName} claimed — now in My Leads`, invalidate: inv(lead.id) });
  return (
    <Modal
      title="Claim lead"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-signal"
            disabled={go.isPending}
            onClick={() =>
              go.mutate(undefined, {
                onSuccess: () => {
                  onClose();
                  onDone();
                },
              })
            }
          >
            Claim lead
          </button>
        </>
      }
    >
      <p>
        Claim <strong style={{ color: 'var(--text-strong)' }}>{lead.customerName}</strong> out of the unclaimed pool? It moves into{' '}
        <strong style={{ color: 'var(--text-strong)' }}>My Leads</strong> and is hidden from every other CRE.
      </p>
    </Modal>
  );
}

/* ---------------------------------- call --------------------------------- */
export function CallModal({ lead, onClose }: { lead: L; onClose: () => void }) {
  const [summary, setSummary] = useState('');
  const [date, setDate] = useState(tomorrowIst());
  const [time, setTime] = useState('10:00');
  const [noNext, setNoNext] = useState(false);
  const go = useAction(
    () => api.post(`/cre/leads/${lead.id}/call`, { summary, ...(noNext ? {} : { nextFollowupAt: istToIso(date, time) }) }),
    { ok: noNext ? 'Call saved' : 'Call saved · follop scheduled', invalidate: inv(lead.id) },
  );
  return (
    <Modal
      title="Log the call"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-signal" disabled={!summary.trim() || (!noNext && !date) || go.isPending} onClick={() => go.mutate(undefined, { onSuccess: onClose })}>
            Save &amp; close call
          </button>
        </>
      }
    >
      <div style={{ fontSize: 12.5, color: 'var(--text-muted)', background: 'var(--steel-850)', border: '1px solid var(--line-soft)', borderRadius: 8, padding: '9px 11px' }}>
        Called <strong style={{ color: 'var(--text-secondary)' }}>{phone(lead.phone)}</strong> from your phone. Write what came out of it.
      </div>
      <div className="field">
        <label>
          Call summary <span className="req">· required</span>
        </label>
        <textarea value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="e.g. Wants 12-bay warehouse rack, sending site photos this week…" autoFocus />
      </div>
      {!noNext && (
        <div className="field">
          <label>
            Next follop date &amp; time <span className="req">· required</span>
          </label>
          <DateTime date={date} time={time} setDate={setDate} setTime={setTime} />
        </div>
      )}
      <label style={{ fontSize: 12.5, color: 'var(--text-muted)', display: 'flex', gap: 6, alignItems: 'center' }}>
        <input type="checkbox" checked={noNext} onChange={(e) => setNoNext(e.target.checked)} /> No further follop needed
      </label>
    </Modal>
  );
}

/* -------------------------------- whatsapp ------------------------------- */
export function WhatsAppModal({ lead, onClose }: { lead: L; onClose: () => void }) {
  const { data: config } = useConfig();
  const { data: me } = useMe();
  const templates = (config?.templates ?? []).filter((t) => t.desk === 'cre' && t.audience === 'client');
  const fill = (s: string) => s.replace(/\{me\}/g, me?.fullName.split(' ')[0] ?? '').replace(/\{contact\}/g, lead.contactName ?? '').replace(/\{client\}/g, lead.customerName);
  const [picked, setPicked] = useState<number | null>(templates[0]?.id ?? null);
  const [body, setBody] = useState(templates[0] ? fill(templates[0].body) : '');
  const log = useAction(() => api.post(`/cre/leads/${lead.id}/whatsapp`, picked ? { templateId: picked } : {}), { invalidate: [['lead', lead.id]] });
  const open = () => {
    if (!lead.phone) return;
    window.open(waLink(lead.phone, body.trim() || undefined), '_blank', 'noopener');
    log.mutate(undefined);
    onClose();
  };
  return (
    <Modal
      title="WhatsApp"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-signal" onClick={open}>
            Open WhatsApp
          </button>
        </>
      }
    >
      <div className="field">
        <label>Pick a message</label>
        {templates.map((t) => (
          <div
            key={t.id}
            className={`wa-template ${picked === t.id ? 'picked' : ''}`}
            onClick={() => {
              setPicked(t.id);
              setBody(fill(t.body));
            }}
          >
            “{fill(t.body)}”
          </div>
        ))}
      </div>
      <div className="field">
        <label>Message (edit before sending)</label>
        <textarea value={body} rows={4} onChange={(e) => setBody(e.target.value)} />
      </div>
      <div className="hint">Opens WhatsApp on this device with {phone(lead.phone)} and the message filled in — you press send.</div>
    </Modal>
  );
}

/* --------------------------------- follop -------------------------------- */
export function FollopModal({ d, onClose }: { d: LeadDetail; onClose: () => void }) {
  const init = isoToIstParts(d.followup?.dueAt);
  const [date, setDate] = useState(init.date || tomorrowIst());
  const [time, setTime] = useState(init.time);
  const [note, setNote] = useState(d.followup?.note ?? '');
  const id = d.lead.id;
  const save = useAction(() => api.put(`/cre/leads/${id}/followup`, { dueAt: istToIso(date, time), note: note || undefined }), { ok: 'Follop set', invalidate: inv(id) });
  const clear = useAction(() => api.del(`/cre/leads/${id}/followup`), { ok: 'Follop removed', invalidate: inv(id) });
  return (
    <Modal
      title="Follop date & time"
      onClose={onClose}
      footer={
        <>
          {d.followup && (
            <button className="btn btn-outline" disabled={clear.isPending} onClick={() => clear.mutate(undefined, { onSuccess: onClose })}>
              Remove follop
            </button>
          )}
          <button className="btn btn-signal" disabled={!date || save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
            Save follop
          </button>
        </>
      }
    >
      <div className="field">
        <label>
          When <span className="req">· required</span>
        </label>
        <DateTime date={date} time={time} setDate={setDate} setTime={setTime} />
      </div>
      <div className="field">
        <label>What to cover</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What this follop is for…" />
      </div>
      <div className="hint">You'll be reminded at this time. If you don't act it repeats at 10:00 AM the next day, then alerts Admin.</div>
    </Modal>
  );
}

/* ---------------------------------- stage -------------------------------- */
export function StageModal({ d, onClose }: { d: LeadDetail; onClose: () => void }) {
  const { data: config } = useConfig();
  const stages = (config?.stages ?? []).filter((s) => s.desk === 'cre' && s.kind === 'working');
  const [stageId, setStageId] = useState<number>(d.lead.creStage?.kind === 'working' ? d.lead.creStage.id : (stages[0]?.id ?? 0));
  const stage = stages.find((s) => s.id === stageId);
  const stageTags = (config?.tags ?? []).filter((t) => t.stageId === stageId);
  const [tagId, setTagId] = useState<number | ''>(d.lead.stageTag?.id ?? '');
  const [categoryId, setCategoryId] = useState<number | ''>(d.lead.category?.id ?? '');
  const init = isoToIstParts(d.followup?.dueAt);
  const [date, setDate] = useState(init.date || tomorrowIst());
  const [time, setTime] = useState(init.time);
  const validTag = stageTags.some((t) => t.id === tagId);
  const go = useAction(
    () =>
      api.post(`/cre/leads/${d.lead.id}/stage`, {
        stageId,
        ...(stage?.requiresStageTag && tagId ? { stageTagId: tagId } : {}),
        ...(stage?.requiresFollowup ? { followupAt: istToIso(date, time) } : {}),
        ...(categoryId ? { categoryId } : {}),
      }),
    { ok: `Stage set to ${stage?.name ?? ''}`, invalidate: inv(d.lead.id) },
  );
  const ready = !!stage && (!stage.requiresStageTag || validTag) && (!stage.requiresFollowup || !!date);
  return (
    <Modal
      title="Set stage"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-signal" disabled={!ready || go.isPending} onClick={() => go.mutate(undefined, { onSuccess: onClose })}>
            Set stage
          </button>
        </>
      }
    >
      <div className="field">
        <label>Stage inside My Leads</label>
        <select
          value={stageId}
          onChange={(e) => {
            setStageId(Number(e.target.value));
            setTagId('');
          }}
        >
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {stage?.definition && <div className="hint">{stage.definition}</div>}
      </div>
      <div className="field">
        <label>Product category</label>
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : '')}>
          <option value="">—</option>
          {config?.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      {stage?.requiresStageTag && (
        <div className="field">
          <label>
            {stage.name} tag <span className="req">· required</span>
          </label>
          <select value={validTag ? tagId : ''} onChange={(e) => setTagId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">Pick one…</option>
            {stageTags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {stage?.requiresFollowup && (
        <div className="field">
          <label>
            Next follop date &amp; time <span className="req">· required</span>
          </label>
          <DateTime date={date} time={time} setDate={setDate} setTime={setTime} />
        </div>
      )}
      <div className="hint">Handing off to BD and marking a lead lost are separate buttons on the lead — they take it out of your hands.</div>
    </Modal>
  );
}

/* --------------------------------- hand-off ------------------------------ */
const VERIFIED = ['Verified — budget and timeline confirmed', 'Verified — site photos and dimensions received', 'Not verified — BD to qualify further'];
export function HandoffModal({ lead, onClose, onDone }: { lead: L; onClose: () => void; onDone: () => void }) {
  const emp = useEmployees();
  const bdes = (emp.data?.employees ?? []).filter((e) => e.role === 'bde' && e.active);
  const [to, setTo] = useState('');
  const [verified, setVerified] = useState(VERIFIED[0]!);
  const [note, setNote] = useState('');
  const target = to || bdes[0]?.id || '';
  const go = useAction(() => api.post(`/cre/leads/${lead.id}/handoff`, { toBdeId: target, note, verified }), {
    ok: `${lead.customerName} handed to BD — now read-only for you`,
    invalidate: inv(lead.id),
  });
  return (
    <Modal
      title="Hand off to BD"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-signal"
            disabled={!target || !note.trim() || go.isPending}
            onClick={() =>
              go.mutate(undefined, {
                onSuccess: () => {
                  onClose();
                  onDone();
                },
              })
            }
          >
            Hand off to BD
          </button>
        </>
      }
    >
      <p>
        Hand <strong style={{ color: 'var(--text-strong)' }}>{lead.customerName}</strong> to the BD team? It leaves My Leads for good — after this you can only watch the stage BD puts it in.
      </p>
      <div className="field">
        <label>
          Hand off to <span className="req">· required</span>
        </label>
        <select value={target} onChange={(e) => setTo(e.target.value)}>
          {bdes.length === 0 && <option value="">No active BDEs — ask Admin to add one</option>}
          {bdes.map((b) => (
            <option key={b.id} value={b.id}>
              {b.fullName}
              {b.territory ? ` · ${b.territory}` : ''}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Genuineness</label>
        <select value={verified} onChange={(e) => setVerified(e.target.value)}>
          {VERIFIED.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>
          Hand-off note <span className="req">· required</span>
        </label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Requirement, dimensions, budget position and what BD should do first…" />
      </div>
    </Modal>
  );
}

/* --------------------------------- transfer ------------------------------ */
export function TransferModal({ lead, onClose, onDone }: { lead: L; onClose: () => void; onDone: () => void }) {
  const emp = useEmployees();
  const { data: me } = useMe();
  const cres = useMemo(() => (emp.data?.employees ?? []).filter((e) => e.role === 'cre' && e.active && e.id !== lead.owner?.id && e.id !== me?.id), [emp.data, lead.owner, me]);
  const [to, setTo] = useState('');
  const [reason, setReason] = useState<string>(TRANSFER_REASONS[0]);
  const [note, setNote] = useState('');
  const target = to || cres[0]?.id || 'pool';
  const go = useAction(() => api.post(`/cre/leads/${lead.id}/transfer`, { to: target, reason, note }), {
    ok: target === 'pool' ? `${lead.customerName} released to the pool` : `${lead.customerName} transferred`,
    invalidate: inv(lead.id),
  });
  return (
    <Modal
      title="Transfer lead"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-signal"
            disabled={!note.trim() || go.isPending}
            onClick={() =>
              go.mutate(undefined, {
                onSuccess: () => {
                  onClose();
                  onDone();
                },
              })
            }
          >
            Transfer
          </button>
        </>
      }
    >
      <div className="grid-2">
        <div className="field">
          <label>Transfer to</label>
          <select value={target} onChange={(e) => setTo(e.target.value)}>
            {cres.map((c) => (
              <option key={c.id} value={c.id}>
                {c.fullName} · CRE
              </option>
            ))}
            <option value="pool">Back to the unclaimed pool</option>
          </select>
        </div>
        <div className="field">
          <label>Reason</label>
          <select value={reason} onChange={(e) => setReason(e.target.value)}>
            {TRANSFER_REASONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label>
          Hand-over note <span className="req">· required</span>
        </label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What the next owner needs to know before the first call…" />
      </div>
      <div className="hint">Ownership moves now and the follop goes with it. The owner log keeps every change. To send it to a BDE, use Hand off to BD.</div>
    </Modal>
  );
}

/* ----------------------------------- lost -------------------------------- */
export function LostModal({ lead, onClose, onDone }: { lead: L; onClose: () => void; onDone: () => void }) {
  const { data: config } = useConfig();
  const reasons = (config?.tags ?? []).filter((t) => t.scope === 'cre_lost');
  const [reasonId, setReasonId] = useState<number | ''>('');
  const [note, setNote] = useState('');
  const go = useAction(() => api.post(`/cre/leads/${lead.id}/lost`, { reasonId, note: note || undefined }), {
    ok: `${lead.customerName} marked lost`,
    invalidate: inv(lead.id),
  });
  return (
    <Modal
      title="Mark lead lost"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-signal"
            disabled={!reasonId || go.isPending}
            onClick={() =>
              go.mutate(undefined, {
                onSuccess: () => {
                  onClose();
                  onDone();
                },
              })
            }
          >
            Mark lost
          </button>
        </>
      }
    >
      <p>
        Close <strong style={{ color: 'var(--text-strong)' }}>{lead.customerName}</strong> as lost? A reason is mandatory and the lead leaves your working lists.
      </p>
      <div className="field">
        <label>
          Reason <span className="req">· mandatory</span>
        </label>
        <select value={reasonId} onChange={(e) => setReasonId(e.target.value ? Number(e.target.value) : '')}>
          <option value="">Pick a reason…</option>
          {reasons.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Anything worth recording</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional — what closed it out…" />
      </div>
    </Modal>
  );
}
