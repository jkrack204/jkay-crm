/**
 * Admin › Sales pipeline — every live lead and deal, both desks, in this Admin's own
 * drag-to-rank order, with private tags, sticky notes and "Notify me".
 */
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useConfig } from '../../lib/session';
import { money, when } from '../../lib/format';
import { useAction, useToast } from '../../components/ui';
import { StickyNotes } from './StickyNotes';
import { adminInvalidate, dealValue, isPool, Pill, platformName, shortMoney, stageName, tonePill, useOpenRecord, useRecords, Who, type AdminRecord } from './adminShared';

type Sort = 'manual' | 'owner' | 'value' | 'source' | 'tags';

/** Ranked first (by the Admin's order); unranked after — BD before CRE, newest first. */
function manualOrder(rows: AdminRecord[]) {
  return [...rows].sort((a, b) => {
    if (a.rank != null && b.rank != null) return a.rank - b.rank;
    if (a.rank != null) return -1;
    if (b.rank != null) return 1;
    if (a.desk !== b.desk) return a.desk === 'bd' ? -1 : 1;
    return +new Date(b.createdAt) - +new Date(a.createdAt);
  });
}

export function AdminPipeline() {
  const { data: config } = useConfig();
  const list = useRecords('live');
  const qc = useQueryClient();
  const toast = useToast();
  const open = useOpenRecord();
  const [desk, setDesk] = useState<'all' | 'cre' | 'bd'>('all');
  const [sort, setSort] = useState<Sort>('manual');
  const [owner, setOwner] = useState('all');
  const [tag, setTag] = useState<number | 'all'>('all');
  const [notesFor, setNotesFor] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const adminTags = (config?.tags ?? []).filter((t) => t.scope === 'admin');

  const all = useMemo(() => manualOrder(list.data?.records ?? []), [list.data]);
  const owners = useMemo(() => {
    const m = new Map<string, string>();
    all.filter((r) => desk === 'all' || r.desk === desk).forEach((r) => r.owner && m.set(r.owner.id, r.owner.name));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [all, desk]);

  let rows = all.filter((r) => (desk === 'all' || r.desk === desk) && (owner === 'all' || r.owner?.id === owner) && (tag === 'all' || r.adminTags.some((t) => t.id === tag)));
  if (sort === 'owner') rows = [...rows].sort((a, b) => (a.owner?.name ?? '~').localeCompare(b.owner?.name ?? '~') || dealValue(b) - dealValue(a));
  if (sort === 'value') rows = [...rows].sort((a, b) => dealValue(a) - dealValue(b));
  if (sort === 'source') rows = [...rows].sort((a, b) => platformName(a.platform).localeCompare(platformName(b.platform)) || a.customerName.localeCompare(b.customerName));
  if (sort === 'tags') {
    const pos = (r: AdminRecord) => (r.adminTags.length ? Math.min(...r.adminTags.map((t) => adminTags.findIndex((x) => x.id === t.id))) : 99);
    rows = [...rows].sort((a, b) => pos(a) - pos(b));
  }
  const drag = sort === 'manual';
  const nCre = all.filter((r) => r.desk === 'cre').length;
  const nBd = all.filter((r) => r.desk === 'bd').length;

  const addTag = useAction((a: { id: string; tagId: number }) => api.post(`/admin/records/${a.id}/tags`, { tagId: a.tagId }), { invalidate: adminInvalidate });
  const dropTag = useAction((a: { id: string; tagId: number }) => api.del(`/admin/records/${a.id}/tags/${a.tagId}`), { invalidate: adminInvalidate });
  const watch = useAction((a: { id: string; on: boolean; name: string }) => api.put(`/admin/records/${a.id}/watch`, { on: a.on }).then(() => a), {
    ok: (a) => (a.on ? `Notifying you on every move on ${a.name}` : `Stopped notifications for ${a.name}`),
    invalidate: adminInvalidate,
  });

  const drop = async (targetId: string) => {
    const moving = dragId;
    setDragId(null);
    setOverId(null);
    if (!moving || moving === targetId) return;
    const order = all.map((r) => r.id).filter((x) => x !== moving);
    order.splice(order.indexOf(targetId), 0, moving);
    // Show the new order straight away, then save it.
    qc.setQueryData(['admin', 'records', 'live', '', ''], (old: { records: AdminRecord[] } | undefined) =>
      old ? { records: old.records.map((r) => ({ ...r, rank: order.indexOf(r.id) + 1 })) } : old,
    );
    try {
      await api.put('/admin/rank', { order });
      const r = all.find((x) => x.id === moving);
      toast(`${r?.customerName} moved to #${order.indexOf(moving) + 1}`);
    } catch (e) {
      toast((e as Error).message);
      qc.invalidateQueries({ queryKey: ['admin', 'records', 'live'] });
    }
  };

  return (
    <>
      <div className="stat-strip">
        <St l="Live records" v={rows.length} d={drag ? 'ranked by you' : 'in this view'} />
        <St l="On the CRE side" v={nCre} d="not yet handed over" />
        <St l="On the BD side" v={nBd} d="quoting and closing" />
        <St l="Pipeline value" v={shortMoney(rows.reduce((a, r) => a + dealValue(r), 0))} d="quoted or estimated" />
        <St l="Watching" v={all.filter((r) => r.watch).length} d="notify me is on" />
      </div>
      <div className="toolbar">
        <div className="chips">
          {(
            [
              ['all', 'Both desks', nCre + nBd],
              ['cre', 'CRE side', nCre],
              ['bd', 'BD side', nBd],
            ] as const
          ).map(([k, l, n]) => (
            <button
              key={k}
              className={`chip ${desk === k ? 'on' : ''}`}
              onClick={() => {
                setDesk(k);
                setOwner('all');
              }}
            >
              {l}
              <span className="n">{n}</span>
            </button>
          ))}
        </div>
        <div className="tb-sep"></div>
        <span className="lbl">Sort by</span>
        <select className="sel" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="manual">My order — drag to rank</option>
          <option value="owner">Owner</option>
          <option value="value">Value — lowest first</option>
          <option value="source">Lead source</option>
          <option value="tags">Tags</option>
        </select>
        <div className="tb-sep"></div>
        <span className="lbl">Owner</span>
        <select className="sel" value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="all">Everyone</option>
          {owners.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <div className="tb-sep"></div>
        <div className="chips">
          <button className={`chip ${tag === 'all' ? 'on' : ''}`} onClick={() => setTag('all')}>
            All tags
          </button>
          {adminTags.map((t) => (
            <button key={t.id} className={`chip ${tag === t.id ? 'on' : ''}`} onClick={() => setTag(t.id)}>
              {t.name}
              <span className="n">{all.filter((r) => r.adminTags.some((x) => x.id === t.id)).length}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="pipe-hint">
        <span>◆</span>
        {drag ? 'Drag a card by its handle to move it up or down. This ranking is yours alone.' : 'Switch back to My order to drag.'} Both desks sit in one list. Tags, notes and “Notify me” are private to you — no other Admin sees them.
      </div>
      {list.isLoading && <div className="empty">Loading…</div>}
      <div className="plist">
        {rows.map((r) => {
          const i = all.indexOf(r);
          return (
            <div
              key={r.id}
              className={`pcard ${drag ? '' : 'nodrag'} ${r.watch ? 'watch' : ''} ${dragId === r.id ? 'drag' : ''} ${overId === r.id && dragId !== r.id ? 'over' : ''}`}
              draggable={drag}
              onDragStart={(e) => {
                setDragId(r.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={() => {
                setDragId(null);
                setOverId(null);
              }}
              onDragOver={(e) => {
                if (!drag) return;
                e.preventDefault();
                setOverId(r.id);
              }}
              onDragLeave={() => setOverId((o) => (o === r.id ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                drop(r.id);
              }}
            >
              <div className="grip">
                <span className="rk">{i + 1}</span>
                <span className="dots">⠿</span>
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="pc-top">
                  <span className="c" onClick={() => open(r.id)} style={{ cursor: 'pointer' }}>
                    {r.customerName}
                  </span>
                  <Pill tone={r.desk === 'bd' ? 'blue' : ''}>{r.desk === 'bd' ? 'BD' : 'CRE'}</Pill>
                  <Pill>{stageName(r)}</Pill>
                  {isPool(r) ? <Pill tone="amber">unclaimed</Pill> : <Who name={r.owner?.name} />}
                  {r.discountPending && <Pill tone="violet">discount waiting</Pill>}
                </div>
                <div className="pc-meta">
                  {[r.place, platformName(r.platform), r.desk === 'bd' ? `handed over by ${r.cre?.name ?? '—'}` : 'on the CRE desk', when(r.createdAt, { time: false })].filter(Boolean).join(' · ')}
                </div>
                <div className="pc-tags">
                  {r.adminTags.map((t) => (
                    <Pill key={t.id} tone={tonePill(t.tone)} adm onClick={() => dropTag.mutate({ id: r.id, tagId: t.id })} title="Remove">
                      {t.name} ✕
                    </Pill>
                  ))}
                  {!r.adminTags.length && (
                    <span className="muted" style={{ fontSize: 12 }}>
                      No admin tag
                    </span>
                  )}
                </div>
                <div className="tagpick">
                  {adminTags
                    .filter((t) => !r.adminTags.some((x) => x.id === t.id))
                    .map((t) => (
                      <button key={t.id} onClick={() => addTag.mutate({ id: r.id, tagId: t.id })}>
                        + {t.name}
                      </button>
                    ))}
                </div>
                {notesFor === r.id ? (
                  <StickyNotes r={r} onClose={() => setNotesFor(null)} />
                ) : (
                  r.notes.map((n) => (
                    <div key={n.id} className="pc-note" style={{ borderLeft: `3px solid ${n.color}`, cursor: 'pointer' }} onClick={() => setNotesFor(r.id)}>
                      <b>
                        {n.pinned ? 'Pinned note' : 'Admin note'} · {when(n.updatedAt, { time: false })}
                      </b>
                      {n.text}
                    </div>
                  ))
                )}
              </div>
              <div className="pc-right">
                <div className="pc-val">
                  {dealValue(r) ? money(dealValue(r)) : '—'}
                  <div style={{ fontSize: 10.5, fontWeight: 400, color: 'var(--text-muted)', textAlign: 'right', letterSpacing: '.04em', textTransform: 'uppercase' }}>
                    {r.latestQuote != null ? 'quoted' : 'estimate'}
                  </div>
                </div>
                <button className={`watchbtn ${r.watch ? 'on' : ''}`} onClick={() => watch.mutate({ id: r.id, on: !r.watch, name: r.customerName })}>
                  {r.watch ? '● Notifying me' : 'Notify me'}
                </button>
                <div className="pc-acts">
                  <button className="btn btn-outline btn-sm" onClick={() => setNotesFor(notesFor === r.id ? null : r.id)}>
                    {notesFor === r.id ? 'Hide notes' : 'Notes'}
                    {r.notes.length > 0 && <span className="notebadge">{r.notes.length}</span>}
                  </button>
                  <button className="btn btn-outline btn-sm" onClick={() => open(r.id)}>
                    Open
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        {!list.isLoading && !rows.length && (
          <div className="tbl-wrap">
            <div className="empty">Nothing in this slice.</div>
          </div>
        )}
      </div>
    </>
  );
}

const St = ({ l, v, d }: { l: string; v: string | number; d: string }) => (
  <div className="st">
    <div className="l">{l}</div>
    <div className="v">{v}</div>
    <div className="d">{d}</div>
  </div>
);
