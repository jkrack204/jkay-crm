import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useConfig } from '../../lib/session';
import { when } from '../../lib/format';
import { bdStagesOf, todayIst, useDeals } from './bdShared';

type Visit = { id: number; leadId: string; customerName: string; place: string | null; scheduledAt: string; status: string; engineer: string; note: string | null };
const IST = 'Asia/Kolkata';
const dayKey = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: IST });
/** Monday of the week containing `ymd`, as YYYY-MM-DD. */
function mondayOf(ymd: string) {
  const d = new Date(ymd + 'T12:00:00+05:30');
  const dow = (d.getUTCDay() + 6) % 7;
  return dayKey(new Date(d.getTime() - dow * 864e5));
}
const addDays = (ymd: string, n: number) => dayKey(new Date(new Date(ymd + 'T12:00:00+05:30').getTime() + n * 864e5));

export function BdVisits() {
  const nav = useNavigate();
  const { data: config } = useConfig();
  const deals = useDeals();
  const [week, setWeek] = useState(() => mondayOf(todayIst()));
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const visits = useQuery({
    queryKey: ['bd', 'visits', week],
    queryFn: () => api.get<{ visits: Visit[] }>(`/bd/visits?from=${days[0]}&to=${days[6]}`),
  });
  const today = todayIst();
  const list = visits.data?.visits ?? [];
  const working = bdStagesOf(config?.stages).filter((s) => s.kind === 'working');
  const all = (deals.data?.deals ?? []).filter((d) => !d.lostAt && !d.wonAt);
  const unbooked = all.filter((d) => d.stage?.id === working[0]?.id && d.visit?.status !== 'booked');
  const drawing = all.filter((d) => d.stage?.id === working[1]?.id);
  const open = (id: string) => nav(`/bd/deals?deal=${id}`);

  return (
    <div className="view active">
      <div className="cal-wrap">
        <div className="card">
          <div className="card__head">
            <h3>Week of {when(days[0] + 'T12:00:00+05:30', { time: false })}</h3>
            <span className="aux" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {list.filter((v) => v.status === 'booked').length} booked
              <button className="btn btn-outline btn-sm" onClick={() => setWeek(addDays(week, -7))} aria-label="Previous week">
                ‹
              </button>
              <button className="btn btn-outline btn-sm" onClick={() => setWeek(mondayOf(todayIst()))}>
                This week
              </button>
              <button className="btn btn-outline btn-sm" onClick={() => setWeek(addDays(week, 7))} aria-label="Next week">
                ›
              </button>
            </span>
          </div>
          <div className="card__body" style={{ padding: 0 }}>
            <div className="cal">
              {days.map((day) => {
                const items = list.filter((v) => dayKey(new Date(v.scheduledAt)) === day);
                const dt = new Date(day + 'T12:00:00+05:30');
                return (
                  <div key={day} className={`cal-day ${day === today ? 'today' : ''}`}>
                    <div className="dh">
                      <span>{dt.toLocaleDateString('en-IN', { timeZone: IST, weekday: 'short' })}</span>
                      <b>{dt.toLocaleDateString('en-IN', { timeZone: IST, day: 'numeric' })}</b>
                    </div>
                    {items.map((v) => (
                      <div key={v.id} className={`vchip ${v.status === 'done' ? 'done' : ''}`} onClick={() => open(v.leadId)} title={v.note ?? undefined}>
                        <b>{v.customerName}</b>
                        <span className="tm">
                          {new Date(v.scheduledAt).toLocaleTimeString('en-IN', { timeZone: IST, hour: 'numeric', minute: '2-digit' })} · {v.engineer.split(' ')[0]}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card__head">
            <h3>Awaiting measurement</h3>
            <span className="aux">{unbooked.length} unbooked</span>
          </div>
          <div className="card__body">
            {!unbooked.length && <div className="dash-empty">Every handed-over deal has a measurement booked.</div>}
            {unbooked.map((d) => (
              <div key={d.id} className="due-item" onClick={() => open(d.id)}>
                <div>
                  <div className="dn">{d.customerName}</div>
                  <div className="dm">
                    {d.place ?? '—'} · handed over {when(d.handedAt, { time: false })}
                  </div>
                </div>
                <div className="dt hot">book it</div>
              </div>
            ))}
            {working[1] && (
              <>
                <div className="d-sec__head" style={{ margin: '16px 0 9px' }}>
                  <h4>{working[1].name}</h4>
                </div>
                {!drawing.length && <div className="dash-empty">Nothing waiting on a drawing.</div>}
                {drawing.map((d) => (
                  <div key={d.id} className="due-item" onClick={() => open(d.id)}>
                    <div>
                      <div className="dn">{d.customerName}</div>
                      <div className="dm">{d.cad ? `CAD rev ${d.cad.rev}` : 'no drawing yet'}</div>
                    </div>
                    <div className="dt">{d.visit ? when(d.visit.scheduledAt, { time: false }) : '—'}</div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
