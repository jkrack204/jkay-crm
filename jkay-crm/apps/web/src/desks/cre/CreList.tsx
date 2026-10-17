import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useConfig } from '../../lib/session';
import { friendly, isDueToday, phone, platformLabel, toneClass, when } from '../../lib/format';
import type { LeadRow } from '../../lib/types';
import { useAction } from '../../components/ui';
import { LeadSheet } from './LeadSheet';

export type CreScope = 'pool' | 'mine' | 'bd' | 'lost';

const RULE: Record<CreScope, string> = {
  pool: 'BDEs cannot see this list · no follops until claimed',
  mine: 'Only you can see your leads',
  bd: 'Read-only — nothing here is yours to change',
  lost: 'Reason is mandatory',
};
const LABEL: Record<CreScope, string> = { pool: 'Unclaimed Pool', mine: 'My Leads', bd: 'Handed to BD', lost: 'Lost' };

/** The mockup colours platforms by its own labels. */
export const PLAT_KEY: Record<string, string> = {
  meta: 'Meta Ads', google: 'Google Leads', justdial: 'Justdial', indiamart: 'IndiaMART', sulekha: 'Sulekha', website: 'Website', walkin: 'Walk-in',
};
export const chipKind = (kind?: string) => (kind === 'handoff' ? 'qualified' : kind === 'lost' ? 'lost' : kind === 'pool' ? 'transfer' : 'follop');

export function CreList({ scope, search, stageId }: { scope: CreScope; search: string; stageId?: string | null }) {
  const { data: config } = useConfig();
  const [params, setParams] = useSearchParams();
  const [tagId, setTagId] = useState<number | null>(null);
  const [checks, setChecks] = useState<Set<string>>(new Set());
  const [bulkTags, setBulkTags] = useState(false);
  const [cursor, setCursor] = useState(0);
  const leadId = params.get('lead');

  useEffect(() => {
    setTagId(null);
    setChecks(new Set());
    setCursor(0);
  }, [scope, stageId]);

  const q = new URLSearchParams({ scope });
  if (stageId) q.set('stageId', stageId);
  if (tagId) q.set('tagId', String(tagId));
  if (search.trim()) q.set('q', search.trim());
  const list = useQuery({
    queryKey: ['cre', 'leads', scope, stageId ?? '', tagId ?? '', search.trim()],
    queryFn: () => api.get<{ leads: LeadRow[] }>(`/cre/leads?${q}`),
    placeholderData: keepPreviousData,
    refetchInterval: scope === 'pool' ? 20_000 : 60_000,
  });
  const rows = list.data?.leads ?? [];

  const stage = stageId ? config?.stages.find((s) => String(s.id) === stageId) : undefined;
  const filterTags = useMemo(() => {
    const t = config?.tags ?? [];
    if (scope === 'mine' && stage) return t.filter((x) => x.stageId === stage.id);
    if (scope === 'mine') return t.filter((x) => x.scope === 'cre' && !x.stageId);
    if (scope === 'lost') return t.filter((x) => x.scope === 'cre_lost');
    return [];
  }, [config, scope, stage]);
  const freeTags = (config?.tags ?? []).filter((x) => x.scope === 'cre' && !x.stageId);

  const open = (id: string) => setParams((p) => (p.set('lead', id), p));
  const close = () => setParams((p) => (p.delete('lead'), p));

  const claimMany = useAction((ids: string[]) => api.post<{ claimed: string[]; failed: { error: string }[] }>('/cre/claim', { leadIds: ids }), {
    ok: (r) => (r.claimed.length ? `${r.claimed.length} lead${r.claimed.length > 1 ? 's' : ''} claimed` : r.failed[0]?.error ?? 'Nothing claimed') + (r.failed.length && r.claimed.length ? ` · ${r.failed.length} already taken` : ''),
    invalidate: [['cre']],
  });
  const tagMany = useAction((a: { ids: string[]; tagId: number }) => api.post<{ tagged: number }>('/cre/tags/bulk', { leadIds: a.ids, tagId: a.tagId }), {
    ok: (r) => `${r.tagged} lead${r.tagged === 1 ? '' : 's'} tagged`,
    invalidate: [['cre']],
  });

  // j / k / enter / x keyboard handling over the list
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = (e.target as HTMLElement).tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t) || document.querySelector('.modal-overlay.open')) return;
      if (!rows.length) return;
      if (e.key === 'j') setCursor((c) => Math.min(c + 1, rows.length - 1));
      else if (e.key === 'k') setCursor((c) => Math.max(c - 1, 0));
      else if (e.key === 'Enter' && !leadId) open(rows[cursor]!.id);
      else if (e.key === 'x') toggle(rows[cursor]!.id);
      else return;
      e.preventDefault();
    };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  });
  useEffect(() => {
    if (leadId) {
      const i = rows.findIndex((r) => r.id === leadId);
      if (i >= 0) setCursor(i);
    }
  }, [leadId, rows]);

  const toggle = (id: string) =>
    setChecks((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const dueLabel = (l: LeadRow) =>
    scope === 'lost' ? `Lost ${when(l.lostAt, { time: false })}` : scope === 'bd' ? `With BD since ${when(l.qualifiedAt, { time: false })}` : scope === 'pool' ? `Came in ${friendly(l.createdAt)}` : l.nextFollowupAt ? `Follop ${friendly(l.nextFollowupAt)}` : 'No follop set';

  return (
    <div className="view active">
      <div className="stagebar">
        <span className="sn">{stage?.name ?? LABEL[scope]}</span>
        <span className="sd">{stage?.definition ?? (scope === 'mine' ? 'Everything you own' : '')}</span>
        <span className="rule">
          <span className="lk"></span>
          {RULE[scope]}
        </span>
      </div>

      <div className="split">
        <div className="pane-list">
          <div className="list-head">
            <div className="tagfilter">
              {filterTags.length ? (
                <>
                  <button className={!tagId ? 'on' : ''} onClick={() => setTagId(null)}>
                    All
                  </button>
                  {filterTags.map((t) => (
                    <button key={t.id} className={tagId === t.id ? 'on' : ''} onClick={() => setTagId(tagId === t.id ? null : t.id)}>
                      {t.name}
                    </button>
                  ))}
                </>
              ) : (
                <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{scope === 'pool' ? 'Unclaimed · first come, first served' : ''}</span>
              )}
            </div>
            <span className="n">
              {list.isFetching && !list.data ? 'Loading…' : `${rows.length} ${rows.length === 1 ? 'lead' : 'leads'}`}
            </span>
          </div>

          <div className={`bulkbar ${checks.size ? 'on' : ''}`}>
            <span className="n">{checks.size} selected</span>
            {scope === 'pool' && (
              <button className="btn btn-signal" disabled={claimMany.isPending} onClick={() => claimMany.mutate([...checks], { onSuccess: () => setChecks(new Set()) })}>
                Claim
              </button>
            )}
            {scope === 'mine' && (
              <div className="bulk-tagwrap">
                <button className="btn btn-outline" onClick={() => setBulkTags((b) => !b)}>
                  Tag ▾
                </button>
                <div className={`bulk-tags ${bulkTags ? 'on' : ''}`}>
                  {freeTags.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => {
                        setBulkTags(false);
                        tagMany.mutate({ ids: [...checks], tagId: t.id }, { onSuccess: () => setChecks(new Set()) });
                      }}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <span className="x" onClick={() => setChecks(new Set())}>
              Clear
            </span>
          </div>

          <div className="rows">
            {list.isError && <div style={{ padding: '28px 16px', color: 'var(--signal-red)' }}>{(list.error as Error).message}</div>}
            {!list.isError && rows.length === 0 && !list.isFetching && (
              <div style={{ padding: '28px 16px', fontSize: 14, color: 'var(--text-muted)' }}>
                {search || tagId ? 'No leads match that filter.' : scope === 'pool' ? 'The pool is empty — new leads land here.' : 'Nothing here yet.'}
              </div>
            )}
            {rows.map((l, i) => (
              <div
                key={l.id}
                className={`row ${leadId === l.id ? 'sel' : ''} ${cursor === i ? 'cursor' : ''} ${checks.has(l.id) ? 'checked' : ''}`}
                onClick={() => {
                  setCursor(i);
                  open(l.id);
                }}
              >
                {(scope === 'pool' || scope === 'mine') ? (
                  <div
                    className="cb"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(l.id);
                    }}
                  >
                    ✓
                  </div>
                ) : (
                  <div />
                )}
                <div className="row__main">
                  <div className="row__l1">
                    <span className="row__name">{l.customerName}</span>
                    {l.stageTag && <span className={`tag ${toneClass(l.stageTag.tone)}`}>{l.stageTag.name}</span>}
                    {l.tags.slice(0, 2).map((t) => (
                      <span key={t.id} className={`tag ${toneClass(t.tone)}`}>
                        {t.name}
                      </span>
                    ))}
                    {scope === 'mine' && !stageId && l.creStage && (
                      <span className="stage-chip" data-s={chipKind(l.creStage.kind)}>
                        {l.creStage.name}
                      </span>
                    )}
                    {scope === 'lost' && l.lostReason && <span className="tag tag-cna3">{l.lostReason}</span>}
                    {scope === 'bd' && l.bdStage && (
                      <span className="stage-chip" data-s="qualified">
                        {l.bdStage}
                      </span>
                    )}
                  </div>
                  <div className="row__l2">
                    <span className="plat" data-p={PLAT_KEY[l.platform]}>
                      <i></i>
                      {platformLabel(l.platform)}
                    </span>
                    <span>{phone(l.phone)}</span>
                    {l.place && (
                      <>
                        <span className="dot"></span>
                        <span>{l.place}</span>
                      </>
                    )}
                    {l.sourceLabel && (
                      <>
                        <span className="dot"></span>
                        <span>{l.sourceLabel}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="row__right">
                  <span className="row__val">{l.category ?? `#${l.number}`}</span>
                  <span className={`row__due ${scope === 'mine' && isDueToday(l.nextFollowupAt) ? 'hot' : ''}`}>{dueLabel(l)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className={`sheet-scrim ${leadId ? 'on' : ''}`} onClick={close} />
        <div className={`pane-detail ${leadId ? 'on' : ''}`}>{leadId && <LeadSheet leadId={leadId} onClose={close} />}</div>
      </div>
    </div>
  );
}
