/** Admin › CRE desk and BD desk — every record on that side, filtered by person and stage. */
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useConfig } from '../../lib/session';
import { money, phone, when } from '../../lib/format';
import type { Employee } from '../../lib/types';
import { isPool, Pill, platformName, shortMoney, tonePill, useOpenRecord, useRecords, Who } from './adminShared';

function usePeople(role: 'cre' | 'bde') {
  const q = useQuery({ queryKey: ['employees'], queryFn: () => api.get<{ employees: Employee[] }>('/employees') });
  return (q.data?.employees ?? []).filter((e) => e.role === role);
}
function useFilter() {
  const [p, setP] = useSearchParams();
  const set = (k: string, v: string) =>
    setP((x) => {
      if (v === 'all') x.delete(k);
      else x.set(k, v);
      return x;
    });
  return { person: p.get('person') ?? 'all', stage: p.get('stage') ?? 'all', set };
}
const Stat = ({ l, v, d }: { l: string; v: string | number; d: string }) => (
  <div className="st">
    <div className="l">{l}</div>
    <div className="v">{v}</div>
    <div className="d">{d}</div>
  </div>
);

export function AdminCreDesk() {
  const { data: config } = useConfig();
  const list = useRecords('cre');
  const people = usePeople('cre');
  const open = useOpenRecord();
  const f = useFilter();
  const stages = (config?.stages ?? []).filter((s) => s.desk === 'cre' && s.kind !== 'lost' && s.kind !== 'handoff').sort((a, b) => a.position - b.position);
  const scoped = useMemo(() => (list.data?.records ?? []).filter((r) => f.person === 'all' || r.owner?.id === f.person), [list.data, f.person]);
  const rows = f.stage === 'all' ? scoped : scoped.filter((r) => String(r.creStage?.id) === f.stage);
  const n = (id: number) => scoped.filter((r) => r.creStage?.id === id).length;
  const pool = scoped.filter(isPool).length;
  const due = scoped.filter((r) => r.nextFollowupAt && new Date(r.nextFollowupAt) < new Date(Date.now() + 864e5)).length;

  return (
    <>
      <div className="stat-strip">
        <Stat l="Leads on the desk" v={scoped.length} d={f.person === 'all' ? `${people.filter((p) => p.active).length} executives` : (people.find((p) => p.id === f.person)?.fullName ?? '')} />
        <Stat l="Unclaimed" v={pool} d="nobody owns these yet" />
        <Stat l="Follops due" v={due} d="today or overdue" />
        <Stat l="Estimate on the desk" v={shortMoney(scoped.reduce((a, r) => a + (r.estimate ?? 0), 0))} d="rough requirement values" />
      </div>
      <div className="toolbar">
        <span className="lbl">Executive</span>
        <select className="sel" value={f.person} onChange={(e) => f.set('person', e.target.value)}>
          <option value="all">All CREs</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.fullName}
              {p.active ? '' : ' (disabled)'}
            </option>
          ))}
        </select>
        <div className="tb-sep"></div>
        <div className="chips">
          <button className={`chip ${f.stage === 'all' ? 'on' : ''}`} onClick={() => f.set('stage', 'all')}>
            All<span className="n">{scoped.length}</span>
          </button>
          {stages.map((s) => (
            <button key={s.id} className={`chip ${f.stage === String(s.id) ? 'on' : ''}`} onClick={() => f.set('stage', String(s.id))}>
              {s.name}
              <span className="n">{n(s.id)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="tbl-wrap">
        <table className="t">
          <thead>
            <tr>
              <th>Customer</th>
              <th>CRE</th>
              <th>Stage</th>
              <th>Tag</th>
              <th>Source</th>
              <th>Next follop</th>
              <th className="r">Estimate</th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading && (
              <tr>
                <td colSpan={7} className="empty">
                  Loading…
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} onClick={() => open(r.id)} style={{ cursor: 'pointer' }}>
                <td>
                  <div className="cust">{r.customerName}</div>
                  <div className="sub">
                    {phone(r.phone)} · {r.place ?? '—'}
                  </div>
                </td>
                <td>{isPool(r) ? <span className="muted">unclaimed</span> : <Who name={r.owner?.name} />}</td>
                <td>
                  <Pill tone={isPool(r) ? 'amber' : ''}>{r.creStage?.name ?? '—'}</Pill>
                </td>
                <td>{r.stageTag ? <Pill tone={tonePill(r.stageTag.tone)}>{r.stageTag.name}</Pill> : <span className="muted">—</span>}</td>
                <td>{platformName(r.platform)}</td>
                <td className="r">{r.nextFollowupAt ? when(r.nextFollowupAt) : <span className="muted">—</span>}</td>
                <td className="r">{r.estimate ? money(r.estimate) : '—'}</td>
              </tr>
            ))}
            {!list.isLoading && !rows.length && (
              <tr>
                <td colSpan={7} className="empty">
                  No leads in this slice.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function AdminBdDesk() {
  const { data: config } = useConfig();
  const list = useRecords('bd');
  const people = usePeople('bde');
  const open = useOpenRecord();
  const f = useFilter();
  const stages = (config?.stages ?? []).filter((s) => s.desk === 'bd' && s.kind !== 'lost').sort((a, b) => a.position - b.position);
  const scoped = useMemo(() => (list.data?.records ?? []).filter((r) => f.person === 'all' || r.owner?.id === f.person), [list.data, f.person]);
  const rows = f.stage === 'all' ? scoped : scoped.filter((r) => String(r.bdStage?.id) === f.stage);
  const n = (id: number) => scoped.filter((r) => r.bdStage?.id === id).length;
  const openRows = scoped.filter((r) => !r.wonAt);
  const quoted = openRows.filter((r) => r.latestQuote != null);

  return (
    <>
      <div className="stat-strip">
        <Stat l="Deals owned" v={scoped.length} d={f.person === 'all' ? `${people.filter((p) => p.active).length} BDEs` : (people.find((p) => p.id === f.person)?.fullName ?? '')} />
        <Stat l="Open value" v={shortMoney(quoted.reduce((a, r) => a + (r.latestQuote ?? 0), 0))} d={`${quoted.length} quoted, not won`} />
        <Stat l="Discounts waiting" v={scoped.filter((r) => r.discountPending).length} d="need an Admin" />
        <Stat l="Won" v={scoped.filter((r) => r.wonAt).length} d="this list" />
      </div>
      <div className="toolbar">
        <span className="lbl">BDE</span>
        <select className="sel" value={f.person} onChange={(e) => f.set('person', e.target.value)}>
          <option value="all">All BDEs</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.fullName}
              {p.active ? '' : ' (disabled)'}
            </option>
          ))}
        </select>
        <div className="tb-sep"></div>
        <div className="chips">
          <button className={`chip ${f.stage === 'all' ? 'on' : ''}`} onClick={() => f.set('stage', 'all')}>
            All<span className="n">{scoped.length}</span>
          </button>
          {stages.map((s) => (
            <button key={s.id} className={`chip ${f.stage === String(s.id) ? 'on' : ''}`} onClick={() => f.set('stage', String(s.id))}>
              {s.name}
              <span className="n">{n(s.id)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="tbl-wrap">
        <table className="t">
          <thead>
            <tr>
              <th>Customer</th>
              <th>BDE</th>
              <th>Stage</th>
              <th>Handed over by</th>
              <th>Source</th>
              <th className="r">Order value</th>
              <th>Your tags</th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading && (
              <tr>
                <td colSpan={7} className="empty">
                  Loading…
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} onClick={() => open(r.id)} style={{ cursor: 'pointer' }}>
                <td>
                  <div className="cust">{r.customerName}</div>
                  <div className="sub">
                    {phone(r.phone)} · {r.place ?? '—'}
                  </div>
                </td>
                <td>
                  <Who name={r.owner?.name} />
                </td>
                <td>
                  <Pill tone={r.wonAt ? 'green' : r.discountPending ? 'violet' : ''}>{r.bdStage?.name ?? '—'}</Pill>
                  {r.discountPending && <div className="sub">discount waiting</div>}
                </td>
                <td>
                  <Who name={r.cre?.name} />
                </td>
                <td>{platformName(r.platform)}</td>
                <td className="r">{r.latestQuote != null ? money(r.contractValue ?? r.latestQuote) : <span className="muted">not quoted</span>}</td>
                <td>
                  {r.adminTags.length ? (
                    r.adminTags.map((t) => (
                      <Pill key={t.id} tone={tonePill(t.tone)} adm>
                        {t.name}
                      </Pill>
                    ))
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            ))}
            {!list.isLoading && !rows.length && (
              <tr>
                <td colSpan={7} className="empty">
                  No deals in this slice.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
