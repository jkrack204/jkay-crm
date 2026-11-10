/** Admin › Deal closed, Payments and Lost — read-only views of what's been decided. */
import { useMemo, useState } from 'react';
import { PLATFORMS } from '@jkay/shared';
import { useConfig } from '../../lib/session';
import { money, when } from '../../lib/format';
import { KIND_LABEL } from '../bd/bdShared';
import { monthKey, monthLabel, pct, Pill, platformName, shortMoney, useOpenRecord, useRecords, Who, type AdminRecord } from './adminShared';

const St = ({ l, v, d, small }: { l: string; v: string | number; d: string; small?: boolean }) => (
  <div className="st">
    <div className="l">{l}</div>
    <div className="v" style={small ? { fontSize: 15.5, lineHeight: 1.4 } : undefined}>
      {v}
    </div>
    <div className="d">{d}</div>
  </div>
);
const dateOf = (iso: string | null | undefined) => (iso ? when(iso, { time: false, year: true }) : '—');
const balance = (r: AdminRecord) => Math.max(0, (r.contractValue ?? 0) - r.paid);

/* -------------------------------- timeline ------------------------------- */
function Timeline({ rows, kind }: { rows: AdminRecord[]; kind: 'won' | 'lost' }) {
  const open = useOpenRecord();
  const at = (r: AdminRecord) => (kind === 'won' ? r.wonAt! : r.lost!.at);
  const months = useMemo(() => [...new Set(rows.map((r) => monthKey(at(r))))].sort(), [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [newest, setNewest] = useState(true);
  const lo = from ?? months[0] ?? '';
  const hi = to ?? months[months.length - 1] ?? '';
  const items = rows
    .filter((r) => monthKey(at(r)) >= lo && monthKey(at(r)) <= hi)
    .sort((a, b) => (+new Date(at(b)) - +new Date(at(a))) * (newest ? 1 : -1));
  const val = items.reduce((a, r) => a + (r.contractValue ?? r.latestQuote ?? r.estimate ?? 0), 0);
  let last = '';
  return (
    <div className="panel mt-12">
      <div className="panel__head">
        <h3>Timeline</h3>
        <span className="count">
          {items.length} {kind} · {money(val)}
        </span>
      </div>
      <div className="panel__body">
        {months.length > 0 && (
          <div className="toolbar" style={{ marginBottom: 11 }}>
            <span className="lbl">From</span>
            <select className="sel" value={lo} onChange={(e) => (setFrom(e.target.value), e.target.value > hi && setTo(e.target.value))}>
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
            <span className="lbl">to</span>
            <select className="sel" value={hi} onChange={(e) => (setTo(e.target.value), e.target.value < lo && setFrom(e.target.value))}>
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
            <div className="tb-sep"></div>
            <button className="chip on" onClick={() => setNewest((n) => !n)}>
              {newest ? 'Newest first' : 'Oldest first'} ⇅
            </button>
            {(from || to) && (
              <button className="chip" onClick={() => (setFrom(null), setTo(null))}>
                Everything
              </button>
            )}
          </div>
        )}
        <div className="tl">
          {items.map((r) => {
            const m = monthKey(at(r));
            const head = m !== last ? <div className="tl-m">{monthLabel(m)}</div> : null;
            last = m;
            const who = kind === 'won' ? r.bde?.name : r.lost!.desk === 'bd' ? r.bde?.name : r.cre?.name;
            return (
              <div key={r.id}>
                {head}
                <div className={`tl-i ${kind === 'won' ? '' : 'l'}`} onClick={() => open(r.id)}>
                  <div>
                    <div className="c">{r.customerName}</div>
                    <div className="s">
                      {who ?? '—'} · {kind === 'won' ? 'advance received' : r.lost!.reason} · {platformName(r.platform)}
                    </div>
                  </div>
                  <div>
                    <div className="v">{money(r.contractValue ?? r.latestQuote ?? r.estimate ?? 0)}</div>
                    <div className="d">{dateOf(at(r))}</div>
                  </div>
                </div>
              </div>
            );
          })}
          {!items.length && <div className="empty">Nothing closed in that range.</div>}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- deal closed ----------------------------- */
export function AdminClosed() {
  const list = useRecords('won');
  const open = useOpenRecord();
  const rows = [...(list.data?.records ?? [])].sort((a, b) => +new Date(b.wonAt!) - +new Date(a.wonAt!));
  const total = rows.reduce((a, r) => a + (r.contractValue ?? 0), 0);
  const got = rows.reduce((a, r) => a + r.paid, 0);
  return (
    <>
      <div className="stat-strip">
        <St l="Deals won" v={rows.length} d="all time" />
        <St l="Contract value" v={shortMoney(total)} d="signed" />
        <St l="Collected" v={shortMoney(got)} d="advance + installments" />
        <St l="Outstanding" v={shortMoney(total - got)} d="still to come in" />
      </div>
      <div className="tbl-wrap">
        <table className="t">
          <thead>
            <tr>
              <th>Customer</th>
              <th>BDE</th>
              <th>CRE</th>
              <th>Source</th>
              <th>Closed on</th>
              <th className="r">Contract</th>
              <th className="r">Collected</th>
              <th>Payment</th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading && (
              <tr>
                <td colSpan={8} className="empty">
                  Loading…
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} onClick={() => open(r.id)} style={{ cursor: 'pointer' }}>
                <td>
                  <div className="cust">{r.customerName}</div>
                  <div className="sub">{r.place ?? '—'}</div>
                </td>
                <td>
                  <Who name={r.bde?.name} />
                </td>
                <td>
                  <Who name={r.cre?.name} />
                </td>
                <td>{platformName(r.platform)}</td>
                <td className="r">{dateOf(r.wonAt)}</td>
                <td className="r">{money(r.contractValue)}</td>
                <td className="r">{money(r.paid)}</td>
                <td>{balance(r) ? <Pill tone="amber">{money(balance(r))} due</Pill> : <Pill tone="green">fully paid</Pill>}</td>
              </tr>
            ))}
            {!list.isLoading && !rows.length && (
              <tr>
                <td colSpan={8} className="empty">
                  No deals won yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Timeline rows={rows} kind="won" />
    </>
  );
}

/* --------------------------------- payments ------------------------------ */
export function AdminPayments() {
  const list = useRecords('won');
  const open = useOpenRecord();
  const [filter, setFilter] = useState<'all' | 'open' | 'clear'>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const all = list.data?.records ?? [];
  const rows = all.filter((r) => (filter === 'open' ? balance(r) > 0 : filter === 'clear' ? balance(r) === 0 : true)).sort((a, b) => balance(b) - balance(a));
  const contract = all.reduce((a, r) => a + (r.contractValue ?? 0), 0);
  const got = all.reduce((a, r) => a + r.paid, 0);
  const chip = (k: typeof filter, l: string, n: number) => (
    <button className={`chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>
      {l}
      <span className="n">{n}</span>
    </button>
  );
  return (
    <>
      <div className="stat-strip">
        <St l="Contracted" v={shortMoney(contract)} d={`${all.length} won deals`} />
        <St l="Received" v={shortMoney(got)} d={`${pct(got, contract)}% of contract`} />
        <St l="Balance left" v={shortMoney(contract - got)} d={`across ${all.filter((r) => balance(r) > 0).length} deals`} />
        <St l="Fully paid" v={all.filter((r) => balance(r) === 0).length} d="nothing left to collect" />
      </div>
      <div className="toolbar">
        {chip('all', 'All', all.length)}
        {chip('open', 'Balance due', all.filter((r) => balance(r) > 0).length)}
        {chip('clear', 'Fully paid', all.filter((r) => balance(r) === 0).length)}
        <span className="lbl" style={{ marginLeft: 'auto' }}>
          Read-only · BDEs record payments on their desk
        </span>
      </div>
      <div className="tbl-wrap">
        <table className="t">
          <thead>
            <tr>
              <th>Customer</th>
              <th>BDE</th>
              <th>Closed on</th>
              <th className="r">Contract</th>
              <th className="r">Received</th>
              <th className="r">Balance</th>
              <th>Production</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isOpen = expanded === r.id;
              return [
                <tr key={r.id} onClick={() => setExpanded(isOpen ? null : r.id)} style={{ cursor: 'pointer' }}>
                  <td>
                    <div className="cust">{r.customerName}</div>
                    <div className="sub">{r.place ?? '—'}</div>
                  </td>
                  <td>
                    <Who name={r.bde?.name} />
                  </td>
                  <td>{dateOf(r.wonAt)}</td>
                  <td className="r">{money(r.contractValue)}</td>
                  <td className="r">
                    {money(r.paid)}
                    <div className="sub">
                      {r.payments.length} receipt{r.payments.length === 1 ? '' : 's'}
                    </div>
                  </td>
                  <td className="r">{balance(r) ? money(balance(r)) : '—'}</td>
                  <td>{r.productionDate ? dateOf(r.productionDate + 'T12:00:00+05:30') : <span className="muted">not set</span>}</td>
                  <td>{balance(r) ? <Pill tone="amber">{pct(r.paid, r.contractValue ?? 0)}% in</Pill> : <Pill tone="green">fully paid</Pill>}</td>
                </tr>,
                isOpen && (
                  <tr key={r.id + '-x'} className="payopen">
                    <td colSpan={8}>
                      <div className="paybody">
                        <div className="mile">
                          {r.payments.map((p) => (
                            <div key={p.id} className="mrow got">
                              <span className="dotm"></span>
                              <span className="k">{KIND_LABEL[p.kind]}</span>
                              <span className="m">
                                {dateOf(p.receivedOn + 'T12:00:00+05:30')} · {p.mode}
                              </span>
                              <span className="amt">{money(p.amount)}</span>
                              <span>
                                <Pill tone="green">received</Pill>
                              </span>
                            </div>
                          ))}
                          {balance(r) > 0 && (
                            <div className="mrow">
                              <span className="dotm"></span>
                              <span className="k">Balance</span>
                              <span className="m"></span>
                              <span className="amt">{money(balance(r))}</span>
                              <span></span>
                            </div>
                          )}
                        </div>
                        <button className="btn btn-outline btn-sm" style={{ marginTop: 10 }} onClick={() => open(r.id)}>
                          Open deal
                        </button>
                      </div>
                    </td>
                  </tr>
                ),
              ];
            })}
            {!list.isLoading && !rows.length && (
              <tr>
                <td colSpan={8}>
                  <div className="empty">Nothing in this slice.</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ----------------------------------- lost -------------------------------- */
export function AdminLost() {
  const { data: config } = useConfig();
  const list = useRecords('lost');
  const open = useOpenRecord();
  const [side, setSide] = useState<'cre' | 'bd'>('cre');
  const all = list.data?.records ?? [];
  const cre = all.filter((r) => r.lost!.desk !== 'bd');
  const bd = all.filter((r) => r.lost!.desk === 'bd');
  const rows = (side === 'cre' ? cre : bd).sort((a, b) => +new Date(b.lost!.at) - +new Date(a.lost!.at));
  const reasons = [...new Set([...(config?.tags ?? []).filter((t) => t.scope === (side === 'cre' ? 'cre_lost' : 'bd_lost')).map((t) => t.name), ...rows.map((r) => r.lost!.reason)])];
  const tone = ['var(--signal-red)', 'var(--signal-amber)', 'var(--signal-blue)', 'var(--signal-violet)', 'var(--steel-600)'];
  const val = rows.reduce((a, r) => a + (r.latestQuote ?? r.estimate ?? 0), 0);
  const count = (key: (r: AdminRecord) => string | undefined) => {
    const m = new Map<string, number>();
    rows.forEach((r) => {
      const k = key(r);
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const top = count((r) => r.lost!.reason)[0]?.[0] ?? '—';
  const bar = (label: string, n: number, color: string, i: number) => (
    <div key={label + i} className="bar" style={{ gridTemplateColumns: '120px 1fr 40px' }}>
      <span>{label}</span>
      <div className="tr">
        <div className="fi" style={{ width: `${pct(n, rows.length)}%`, background: color }}></div>
      </div>
      <span className="pc">{n}</span>
    </div>
  );
  return (
    <>
      <div className="toolbar">
        <div className="chips">
          <button className={`chip ${side === 'cre' ? 'on' : ''}`} onClick={() => setSide('cre')}>
            Lost on the CRE desk<span className="n">{cre.length}</span>
          </button>
          <button className={`chip ${side === 'bd' ? 'on' : ''}`} onClick={() => setSide('bd')}>
            Lost on the BD desk<span className="n">{bd.length}</span>
          </button>
        </div>
      </div>
      <div className="stat-strip">
        <St l="Lost records" v={rows.length} d={side === 'cre' ? 'never reached BD' : 'lost after hand-off'} />
        <St l="Value walked away" v={shortMoney(val)} d={side === 'cre' ? 'at CRE estimate' : 'at quoted value'} />
        <St l="Top reason" v={top} d="most frequent" small />
      </div>
      <div className="col-2">
        <div className="panel" style={{ overflow: 'hidden', minWidth: 0 }}>
          <div className="panel__head">
            <h3>{side === 'cre' ? 'CRE lost' : 'BD lost'}</h3>
            <span className="count">{rows.length} records</span>
          </div>
          <div className="panel__body" style={{ padding: 0, overflowX: 'auto' }}>
            <table className="t">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>{side === 'cre' ? 'CRE' : 'BDE'}</th>
                  <th>Reason</th>
                  <th>Lost on</th>
                  <th className="r">Value</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} onClick={() => open(r.id)} style={{ cursor: 'pointer' }}>
                    <td>
                      <div className="cust" style={{ whiteSpace: 'nowrap' }}>
                        {r.customerName}
                      </div>
                      <div className="sub" style={{ whiteSpace: 'nowrap' }}>
                        {r.place ?? '—'} · {platformName(r.platform)}
                      </div>
                    </td>
                    <td>
                      <Who name={side === 'cre' ? (r.cre?.name ?? r.lost!.by) : r.bde?.name} />
                      {side === 'bd' && <div className="sub">via {r.cre?.name ?? '—'}</div>}
                    </td>
                    <td>
                      <Pill tone="red">{r.lost!.reason}</Pill>
                      {r.lost!.note && <div className="sub">{r.lost!.note}</div>}
                    </td>
                    <td className="r">{dateOf(r.lost!.at)}</td>
                    <td className="r">{money(r.latestQuote ?? r.estimate ?? 0)}</td>
                  </tr>
                ))}
                {!list.isLoading && !rows.length && (
                  <tr>
                    <td colSpan={5} className="empty">
                      Nothing lost on this desk.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="flex-col gap-12">
          <div className="panel">
            <div className="panel__head">
              <h3>Reason breakdown</h3>
              <span className="count">{side === 'cre' ? 'CRE reasons' : 'BD reasons'}</span>
            </div>
            <div className="panel__body">
              {reasons.map((rn, i) => {
                const n = rows.filter((r) => r.lost!.reason === rn).length;
                return (
                  <div key={rn} className="bar">
                    <span>{rn}</span>
                    <div className="tr">
                      <div className="fi" style={{ width: `${pct(n, rows.length)}%`, background: tone[i % tone.length] }}></div>
                    </div>
                    <span className="pc">{pct(n, rows.length)}%</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="panel">
            <div className="panel__head">
              <h3>By {side === 'cre' ? 'executive' : 'BDE'}</h3>
            </div>
            <div className="panel__body">
              {count((r) => (side === 'cre' ? (r.cre?.name ?? r.lost!.by ?? undefined) : r.bde?.name)).map(([k, n], i) => bar(k, n, 'var(--signal-amber)', i))}
              {!rows.length && <div className="empty">—</div>}
            </div>
          </div>
          <div className="panel">
            <div className="panel__head">
              <h3>By source</h3>
            </div>
            <div className="panel__body">
              {PLATFORMS.map((p, i) => {
                const n = rows.filter((r) => r.platform === p).length;
                return n ? bar(platformName(p), n, 'var(--steel-600)', i) : null;
              })}
              {!rows.length && <div className="empty">—</div>}
            </div>
          </div>
        </div>
      </div>
      <Timeline key={side} rows={rows} kind="lost" />
    </>
  );
}
