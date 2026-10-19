import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useConfig } from '../../lib/session';
import { platformLabel, toneClass } from '../../lib/format';
import type { DealRow } from '../../lib/types';
import { useAction, useToast } from '../../components/ui';
import { PLAT_KEY } from '../cre/CreList';
import { DealSheet } from './DealSheet';
import { bdStagesOf, chipKeyFor, matches, short, subLine, useDeals, valueShown, valueText } from './bdShared';

export type PipeScope = 'all' | 'lost';

function useMode() {
  const [mode, setMode] = useState<'list' | 'board'>(() => {
    try {
      return localStorage.getItem('jkay-bd-mode') === 'board' ? 'board' : 'list';
    } catch {
      return 'list';
    }
  });
  const set = (m: 'list' | 'board') => {
    setMode(m);
    try {
      localStorage.setItem('jkay-bd-mode', m);
    } catch {
      /* private mode */
    }
  };
  return [mode, set] as const;
}

export function BdPipeline({ scope, stageId, search }: { scope: PipeScope; stageId: string | null; search: string }) {
  const { data: config } = useConfig();
  const deals = useDeals();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [mode, setMode] = useMode();
  const [tagId, setTagId] = useState<number | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<number | null>(null);
  const dealId = params.get('deal');

  useEffect(() => setTagId(null), [scope, stageId]);

  const stages = bdStagesOf(config?.stages);
  const first = stages.find((s) => s.kind === 'working');
  const stage = stageId ? stages.find((s) => String(s.id) === stageId) : undefined;
  const libTags = (config?.tags ?? []).filter((t) => t.scope === 'bd');

  const rows = useMemo(() => {
    const all = deals.data?.deals ?? [];
    return all
      .filter((d) => (scope === 'lost' ? !!d.lostAt : !d.lostAt))
      .filter((d) => !stage || d.stage?.id === stage.id)
      .filter((d) => !tagId || d.tags.some((t) => t.id === tagId))
      .filter((d) => matches(d, search));
  }, [deals.data, scope, stage, tagId, search]);

  const open = (id: string) => setParams((p) => (p.set('deal', id), p));
  const close = () => setParams((p) => (p.delete('deal'), p));

  const move = useAction((a: { id: string; stageId: number }) => api.post(`/bd/deals/${a.id}/stage`, { stageId: a.stageId }), {
    ok: () => 'Stage updated',
    invalidate: [['bd'], ['lead']],
  });
  const drop = (e: DragEvent, stageTo: number) => {
    e.preventDefault();
    setOverCol(null);
    const d = rows.find((r) => r.id === dragId);
    setDragId(null);
    if (!d || d.stage?.id === stageTo) return;
    const s = stages.find((x) => x.id === stageTo);
    if (s?.kind === 'lost') {
      toast('Open the deal and use Mark lost — a reason is required');
      return open(d.id);
    }
    move.mutate({ id: d.id, stageId: stageTo });
  };

  const showBoard = mode === 'board' && scope === 'all' && !stage;

  return (
    <div className="view active">
      <div className="stagebar">
        <span className="sn">{stage ? `Stage ${stages.filter((s) => s.kind !== 'lost').findIndex((s) => s.id === stage.id) + 1} of ${stages.filter((s) => s.kind !== 'lost').length}` : scope === 'lost' ? 'Lost' : 'All stages'}</span>
        <span className="sd">
          <b>{stage?.name ?? (scope === 'lost' ? 'Lost deals' : 'My deals')}</b> ·{' '}
          {stage?.definition ?? (scope === 'lost' ? 'Closed lost · every record carries a reason' : 'Site measurement → won. Lost deals sit in their own list.')}
        </span>
        <span className="rule">
          <span className="lk"></span>
          {stage?.requiresQuotation ? 'Needs a quotation' : scope === 'lost' ? 'Reason is mandatory' : 'Value shows from Quotation sent onwards'}
        </span>
      </div>

      <div className="list-head">
        {scope === 'all' && !stage && (
          <div className="seg">
            <button className={mode === 'list' ? 'on' : ''} onClick={() => setMode('list')}>
              List
            </button>
            <button className={mode === 'board' ? 'on' : ''} onClick={() => setMode('board')}>
              Board
            </button>
          </div>
        )}
        <div className="tagfilter">
          {libTags.map((t) => (
            <button key={t.id} className={tagId === t.id ? 'on' : ''} onClick={() => setTagId(tagId === t.id ? null : t.id)}>
              {t.name}
            </button>
          ))}
        </div>
        <span className="n">{deals.isLoading ? 'Loading…' : `${rows.length} ${rows.length === 1 ? 'deal' : 'deals'}`}</span>
      </div>

      {deals.isError && <div className="empty">{(deals.error as Error).message}</div>}

      {!showBoard && (
        <div className="rows">
          {!deals.isLoading && rows.length === 0 && (
            <div className="empty">{search || tagId ? 'No deals match that filter.' : scope === 'lost' ? 'Nothing lost — good.' : 'No deals in this list. Hand-offs from the CRE desk land here.'}</div>
          )}
          {rows.map((d) => (
            <Row key={d.id} d={d} sel={d.id === dealId} onOpen={() => open(d.id)} chip={chipKeyFor(stages, d.stage?.id)} firstId={first?.id} />
          ))}
        </div>
      )}

      {showBoard && (
        <div className="board">
          {stages.map((st) => {
            const list = rows.filter((d) => d.stage?.id === st.id);
            const sum = list.filter(valueShown).reduce((a, d) => a + (d.value ?? 0), 0);
            return (
              <div
                key={st.id}
                className={`bcol ${overCol === st.id ? 'drop' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverCol(st.id);
                }}
                onDragLeave={() => setOverCol(null)}
                onDrop={(e) => drop(e, st.id)}
              >
                <div className="bcol__head">
                  <h4>{st.name}</h4>
                  <span className="c">{list.length}</span>
                </div>
                <div className="bcol__sum">{sum ? `${short(sum)} ${st.kind === 'won' ? 'won' : 'quoted'}` : '—'}</div>
                <div className="bcol__body">
                  {list.map((d) => (
                    <div
                      key={d.id}
                      className={`bcard ${dragId === d.id ? 'dragging' : ''}`}
                      draggable
                      onDragStart={(e) => {
                        setDragId(d.id);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragEnd={() => setDragId(null)}
                      onClick={() => open(d.id)}
                    >
                      <div className="bcard__c">{d.customerName}</div>
                      <div className={`bcard__v ${valueShown(d) ? '' : 'q'}`}>{valueText(d)}</div>
                      <div className="bcard__m">{subLine(d, first?.id)}</div>
                      <div className="bcard__f">
                        <span className="plat" data-p={PLAT_KEY[d.platform]}>
                          <i></i>
                          {platformLabel(d.platform)}
                        </span>
                        {d.tags.slice(0, 1).map((t) => (
                          <span key={t.id} className={`tag ${toneClass(t.tone)}`}>
                            {t.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                  {!list.length && <div className="bempty">Nothing here</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className={`sheet-scrim ${dealId ? 'on' : ''}`} onClick={close} />
      <div className={`pane-detail ${dealId ? 'on' : ''}`}>{dealId && <DealSheet dealId={dealId} onClose={close} />}</div>
    </div>
  );
}

function Row({ d, sel, onOpen, chip, firstId }: { d: DealRow; sel: boolean; onOpen: () => void; chip: string; firstId?: number }) {
  const req = d.requirement ?? '';
  return (
    <div className={`row ${sel ? 'sel' : ''}`} onClick={onOpen}>
      <div className="row__main">
        <div className="row__l1">
          <span className="row__name">{d.customerName}</span>
          <span className="stage-chip" data-s={chip}>
            {d.stage?.name}
          </span>
          {d.discountPending && <span className="tag tag-cna2">Discount pending</span>}
          {d.tags.slice(0, 2).map((t) => (
            <span key={t.id} className={`tag ${toneClass(t.tone)}`}>
              {t.name}
            </span>
          ))}
        </div>
        <div className="row__l2">
          <span className="plat" data-p={PLAT_KEY[d.platform]}>
            <i></i>
            {platformLabel(d.platform)}
          </span>
          {d.place && <span>{d.place}</span>}
          <span className="dot"></span>
          <span>from {d.handedBy}</span>
          {req && (
            <>
              <span className="dot"></span>
              <span>{req.length > 52 ? req.slice(0, 52) + '…' : req}</span>
            </>
          )}
        </div>
      </div>
      <div className="row__right">
        <div className={`row__val ${valueShown(d) ? '' : 'q'}`}>{valueText(d)}</div>
        <div className={`row__due ${d.wonAt && !d.lostAt && (d.balance ?? 0) > 0 ? 'hot' : ''}`}>{subLine(d, firstId)}</div>
      </div>
    </div>
  );
}

