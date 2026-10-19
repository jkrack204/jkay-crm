/**
 * BD desk dialogs — ported from the BD mockup's modals.
 * Files are uploaded first (they get an id), then the record is created with that id.
 */
import { useRef, useState, type DragEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PAYMENT_MODES, waLink, type AttachmentKind } from '@jkay/shared';
import { api } from '../../lib/api';
import { useConfig, useMe } from '../../lib/session';
import { isoToIstParts, istToIso, money, phone, tomorrowIst } from '../../lib/format';
import { acceptFor, uploadFile } from '../../lib/upload';
import type { DealDetail } from '../../lib/types';
import { Modal, useAction, useToast } from '../../components/ui';
import { bdInvalidate, KIND_LABEL, todayIst } from './bdShared';

type P = { d: DealDetail; onClose: () => void };
const rupees = (s: string) => Number(String(s).replace(/[^\d]/g, '')) || 0;
const Foot = ({ onClose, ok, label, busy }: { onClose: () => void; ok: () => void; label: string; busy?: boolean }) => (
  <>
    <button className="btn btn-outline" onClick={onClose}>
      Cancel
    </button>
    <button className="btn btn-signal" disabled={busy} onClick={ok}>
      {label}
    </button>
  </>
);

/** Phone number of the client or of the CRE who handed the deal over. */
const partyOf = (d: DealDetail, to: 'client' | 'cre') =>
  to === 'cre'
    ? { name: d.bd.handedBy?.name ?? 'the CRE', phone: d.bd.handedBy?.phone ?? null }
    : { name: d.lead.contactName || d.lead.customerName, phone: d.lead.phone };

/* ---------------------------------- call --------------------------------- */
export function CallModal({ d, to, onClose }: P & { to: 'client' | 'cre' }) {
  const p = partyOf(d, to);
  const [summary, setSummary] = useState('');
  const go = useAction(() => api.post(`/bd/deals/${d.lead.id}/call`, { to, summary }), { ok: 'Call logged', invalidate: bdInvalidate(d.lead.id) });
  return (
    <Modal title={to === 'cre' ? 'Call the CRE' : 'Call the client'} onClose={onClose} footer={<Foot onClose={onClose} label="Log call" busy={!summary.trim() || go.isPending} ok={() => go.mutate(undefined, { onSuccess: onClose })} />}>
      <div className="hint">
        {p.phone ? (
          <>
            Dialled <b>{p.name}</b> · {phone(p.phone)} from your phone. Write what came out of it.
          </>
        ) : (
          <>No phone number on file for {p.name}.</>
        )}
      </div>
      <div className="field">
        <label>
          What came out of the call <span className="req">*</span>
        </label>
        <textarea value={summary} onChange={(e) => setSummary(e.target.value)} autoFocus placeholder="Decision maker, objections, next step…" />
      </div>
      <div className="hint">The summary lands in this deal's activity log against your name.</div>
    </Modal>
  );
}

/* -------------------------------- whatsapp ------------------------------- */
export function WhatsAppModal({ d, to, onClose, preset }: P & { to: 'client' | 'cre'; preset?: string }) {
  const { data: config } = useConfig();
  const { data: me } = useMe();
  const p = partyOf(d, to);
  const templates = (config?.templates ?? []).filter((t) => t.desk === 'bd' && t.audience === to);
  const fill = (s: string) =>
    s
      .replace(/\{contact\}/g, d.lead.contactName || d.lead.customerName)
      .replace(/\{client\}/g, d.lead.customerName)
      .replace(/\{cre\}/g, (d.bd.handedBy?.name ?? '').split(' ')[0] ?? '')
      .replace(/\{me\}/g, me?.fullName.split(' ')[0] ?? '');
  const [picked, setPicked] = useState<number | null>(preset ? null : (templates[0]?.id ?? null));
  const [body, setBody] = useState(preset ?? (templates[0] ? fill(templates[0].body) : ''));
  const log = useAction(() => api.post(`/bd/deals/${d.lead.id}/whatsapp`, { to, ...(picked ? { templateId: picked } : {}) }), { invalidate: [['lead', d.lead.id]] });
  const open = () => {
    if (!p.phone) return;
    window.open(waLink(p.phone, body.trim() || undefined), '_blank', 'noopener');
    log.mutate(undefined);
    onClose();
  };
  return (
    <Modal title={`WhatsApp · ${to === 'cre' ? 'the CRE' : 'the client'}`} onClose={onClose} footer={<Foot onClose={onClose} label="Open WhatsApp" busy={!p.phone} ok={open} />}>
      <div className="hint">
        {p.name} · {phone(p.phone)}
      </div>
      {templates.length > 0 && (
        <div className="field">
          <label>Template</label>
          <div className="tag-pick">
            {templates.map((t) => (
              <button
                key={t.id}
                style={picked === t.id ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
                onClick={() => {
                  setPicked(t.id);
                  setBody(fill(t.body));
                }}
              >
                {t.title}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="field">
        <label>Message</label>
        <textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
      </div>
      <div className="hint">{p.phone ? 'Opens WhatsApp on this device with the message filled in — you press send.' : 'No phone number on file.'}</div>
    </Modal>
  );
}

/* ------------------------------- site visit ------------------------------ */
export function VisitModal({ d, onClose }: P) {
  const { data: me } = useMe();
  const booked = d.bd.visits.find((v) => v.status === 'booked');
  const init = isoToIstParts(booked?.scheduledAt);
  const [date, setDate] = useState(init.date || tomorrowIst());
  const [time, setTime] = useState(booked ? init.time : '11:00');
  const engineers = useQuery({ queryKey: ['bd', 'engineers'], queryFn: () => api.get<{ engineers: { id: string; name: string }[] }>('/bd/engineers'), staleTime: 300_000 });
  const [who, setWho] = useState<string>(booked?.engineerId ?? (booked ? 'other' : (me?.id ?? '')));
  const [other, setOther] = useState(booked && !booked.engineerId ? booked.engineer : '');
  const [note, setNote] = useState(booked?.note ?? '');
  const go = useAction(
    () =>
      api.post(`/bd/deals/${d.lead.id}/visits`, {
        scheduledAt: istToIso(date, time),
        ...(who === 'other' ? { engineerName: other } : who ? { engineerId: who } : {}),
        note: note || undefined,
      }),
    { ok: booked ? 'Visit moved' : 'Visit booked', invalidate: bdInvalidate(d.lead.id) },
  );
  return (
    <Modal
      title={booked ? 'Reschedule site measurement' : 'Schedule site measurement'}
      onClose={onClose}
      footer={<Foot onClose={onClose} label={booked ? 'Move visit' : 'Book visit'} busy={!date || (who === 'other' && !other.trim()) || go.isPending} ok={() => go.mutate(undefined, { onSuccess: onClose })} />}
    >
      <div className="grid-2">
        <div className="field">
          <label>Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label>Time</label>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>Engineer on site</label>
        <select value={who} onChange={(e) => setWho(e.target.value)}>
          {(engineers.data?.engineers ?? []).map((e) => (
            <option key={e.id} value={e.id}>
              {e.name} · BDE{e.id === me?.id ? ' (you)' : ''}
            </option>
          ))}
          <option value="other">Someone else (type a name)…</option>
        </select>
      </div>
      {who === 'other' && (
        <div className="field">
          <label>Name</label>
          <input value={other} onChange={(e) => setOther(e.target.value)} placeholder="e.g. Ravi Bhosale · Measurement" />
        </div>
      )}
      <div className="field">
        <label>Note for the engineer</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Access, floor height, existing racking to be removed…" />
      </div>
      <div className="hint">The CRE who handed this over is notified.</div>
    </Modal>
  );
}

/* ------------------------------- file picker ----------------------------- */
function DropZone({ kind, file, setFile, title, sub }: { kind: AttachmentKind; file: File | null; setFile: (f: File | null) => void; title: string; sub: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) setFile(f);
  };
  return (
    <>
      <div
        className={`drop-zone ${over ? 'on' : ''}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
      >
        <b style={{ display: 'block', fontSize: 14.5, color: 'var(--text-secondary)', fontWeight: 600 }}>{file ? file.name : title}</b>
        <span>{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB · click to pick a different file` : sub}</span>
      </div>
      <input ref={input} type="file" accept={acceptFor(kind)} style={{ display: 'none' }} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
    </>
  );
}

/** Upload the file, then create the record; one button, one toast. */
function useUploadThen(d: DealDetail, kind: AttachmentKind, after: (attachmentId: number | undefined) => Promise<unknown>, ok: string) {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (file: File | null, onDone: () => void) => {
    setBusy(true);
    try {
      const a = file ? await uploadFile(d.lead.id, kind, file) : undefined;
      await after(a?.id);
      bdInvalidate(d.lead.id).forEach((k) => qc.invalidateQueries({ queryKey: k }));
      toast(ok);
      onDone();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { run, busy };
}

/* ---------------------------------- CAD ---------------------------------- */
export function CadModal({ d, onClose }: P) {
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const next = (d.bd.cad[0]?.rev ?? 0) + 1;
  const go = useUploadThen(d, 'cad', (attachmentId) => api.post(`/bd/deals/${d.lead.id}/cad`, { attachmentId, note: note || undefined }), `CAD revision ${next} added`);
  return (
    <Modal title={`Upload CAD revision ${next}`} onClose={onClose} footer={<Foot onClose={onClose} label="Add revision" busy={!file || go.busy} ok={() => go.run(file, onClose)} />}>
      <DropZone kind="cad" file={file} setFile={setFile} title="Drop the drawing here" sub="DWG, DXF or PDF — the revision number is assigned automatically" />
      <div className="field">
        <label>What changed</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. bay pitch reduced to 2400mm on the client's request" />
      </div>
    </Modal>
  );
}

/* ------------------------------- quotation ------------------------------- */
export function QuoteModal({ d, onClose }: P) {
  const [file, setFile] = useState<File | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const v = (d.bd.quotations[0]?.version ?? 0) + 1;
  const highest = Math.max(0, ...d.bd.quotations.map((q) => q.amount));
  const floor = highest ? Math.ceil(highest * (1 - d.bd.discountThreshold / 100)) : 0;
  const approved = d.bd.discounts.find((x) => x.status === 'approved');
  const value = rupees(amount);
  const tooDeep = !!highest && value > 0 && value < floor && !(approved && value >= (approved.proposedAmount ?? 0));
  const go = useUploadThen(
    d,
    'quotation',
    (attachmentId) => api.post(`/bd/deals/${d.lead.id}/quotations`, { amount: value, attachmentId, note: note || undefined }),
    `Quotation v${v} sent · ${money(value)}`,
  );
  return (
    <Modal title={`Quotation v${v} — ${d.lead.customerName}`} onClose={onClose} footer={<Foot onClose={onClose} label="Save quotation" busy={!value || go.busy} ok={() => go.run(file, onClose)} />}>
      <DropZone kind="quotation" file={file} setFile={setFile} title="Drop the quotation PDF here" sub="or click to pick a file — it attaches to this deal and to the audit trail" />
      <div className="field">
        <label>
          Quotation value (₹) <span className="req">*</span>
        </label>
        <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 320000" />
      </div>
      {value > 0 && <div className="hint">{money(value)}</div>}
      <div className="field">
        <label>Note on the revision</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed from the last version…" />
      </div>
      {highest > 0 && (
        <div className="hint" style={tooDeep ? { color: 'var(--signal-red)' } : undefined}>
          Highest so far {money(highest)}. You can go down to {money(floor)} ({d.bd.discountThreshold}%) on your own
          {approved ? `; Admin approved ${approved.percent}% (${money(approved.proposedAmount)})` : ''}.
          {tooDeep ? ' This is deeper — ask Admin for a discount first.' : ''}
        </div>
      )}
      <div className="hint">The quotation builder comes later — for now attach the file you made and enter its value.</div>
    </Modal>
  );
}

/* -------------------------------- discount ------------------------------- */
export function DiscountModal({ d, onClose }: P) {
  const [pct, setPct] = useState('');
  const [reason, setReason] = useState('');
  const highest = Math.max(0, ...d.bd.quotations.map((q) => q.amount));
  const n = Number(pct) || 0;
  const go = useAction(() => api.post(`/bd/deals/${d.lead.id}/discounts`, { percent: n, reason }), { ok: 'Sent to Admin for approval', invalidate: bdInvalidate(d.lead.id) });
  return (
    <Modal title="Ask Admin for a discount" onClose={onClose} footer={<Foot onClose={onClose} label="Send request" busy={!n || !reason.trim() || go.isPending} ok={() => go.mutate(undefined, { onSuccess: onClose })} />}>
      <div className="hint">
        You can give up to {d.bd.discountThreshold}% on your own. Anything past that needs an Admin's sign-off before you send the revised quotation.
      </div>
      <div className="grid-2">
        <div className="field">
          <label>Discount (%)</label>
          <input inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} placeholder="e.g. 10" />
        </div>
        <div className="field">
          <label>Comes to</label>
          <input readOnly value={n && highest ? money(Math.round(highest * (1 - n / 100))) : '—'} />
        </div>
      </div>
      <div className="field">
        <label>
          Why <span className="req">*</span>
        </label>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Competitor price, repeat client, scope cut…" />
      </div>
    </Modal>
  );
}

/* -------------------------------- payment -------------------------------- */
export function PaymentModal({ d, onClose }: P) {
  const won = !!d.lead.wonAt;
  const [kind, setKind] = useState<'advance' | 'installment' | 'final'>(won ? 'installment' : 'advance');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayIst());
  const [mode, setMode] = useState<string>('NEFT');
  const [ref, setRef] = useState('');
  const value = rupees(amount);
  const contract = d.bd.contractValue ?? d.bd.quotations[0]?.amount ?? 0;
  const left = (d.bd.balance ?? contract) - value;
  const go = useAction(
    () => api.post(`/bd/deals/${d.lead.id}/payments`, { kind, amount: value, receivedOn: date, mode, reference: ref || undefined }),
    { ok: won ? `${KIND_LABEL[kind]} recorded` : `Advance received · ${d.lead.customerName} → Won`, invalidate: bdInvalidate(d.lead.id) },
  );
  return (
    <Modal title={won ? 'Record a payment' : 'Record the advance'} onClose={onClose} footer={<Foot onClose={onClose} label="Record payment" busy={!value || !date || go.isPending} ok={() => go.mutate(undefined, { onSuccess: onClose })} />}>
      {!won && <div className="hint">Recording the advance marks this deal Won at {money(contract)} (the latest quotation).</div>}
      <div className="grid-2">
        <div className="field">
          <label>Kind</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} disabled={!won}>
            {(['advance', 'installment', 'final'] as const).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Amount (₹)</label>
          <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="150000" autoFocus />
        </div>
      </div>
      <div className="grid-2">
        <div className="field">
          <label>Received on</label>
          <input type="date" value={date} max={todayIst()} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label>Mode</label>
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            {PAYMENT_MODES.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label>Reference (UTR / cheque no.)</label>
        <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Optional" />
      </div>
      <div className="hint" style={left < 0 ? { color: 'var(--signal-red)' } : undefined}>
        {value ? (left < 0 ? `That's ${money(-left)} more than the balance.` : `Balance after this: ${money(left)}`) : 'The balance bar and the ledger recompute from this entry.'}
      </div>
    </Modal>
  );
}

/* ---------------------------------- lost --------------------------------- */
export function LostModal({ d, onClose }: P) {
  const { data: config } = useConfig();
  const reasons = (config?.tags ?? []).filter((t) => t.scope === 'bd_lost');
  const [reasonId, setReasonId] = useState<number | ''>('');
  const [note, setNote] = useState('');
  const go = useAction(() => api.post(`/bd/deals/${d.lead.id}/lost`, { reasonId, note: note || undefined }), { ok: `${d.lead.customerName} marked lost`, invalidate: bdInvalidate(d.lead.id) });
  return (
    <Modal title="Mark this deal lost" onClose={onClose} footer={<Foot onClose={onClose} label="Mark lost" busy={!reasonId || go.isPending} ok={() => go.mutate(undefined, { onSuccess: onClose })} />}>
      <div className="field">
        <label>
          Reason <span className="req">*</span>
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
        <label>What happened</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Competitor name, price gap, timeline mismatch…" />
      </div>
      <div className="hint">A reason is mandatory. The deal leaves the working pipeline and the CRE who handed it over is notified.</div>
    </Modal>
  );
}
