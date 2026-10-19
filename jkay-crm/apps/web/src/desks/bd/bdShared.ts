import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { friendly, money, when } from '../../lib/format';
import type { DealDetail, DealRow, Stage } from '../../lib/types';

/** The BD stylesheet colours stage chips by these keys; map Admin's stages onto them by order. */
const CHIP_KEYS = ['site', 'layout', 'quote', 'negotiation', 'awaiting'];
export function chipKeyFor(stages: Stage[], stageId: number | undefined | null) {
  const s = stages.find((x) => x.id === stageId);
  if (!s) return 'site';
  if (s.kind === 'won' || s.kind === 'lost') return s.kind;
  const i = stages.filter((x) => x.kind === 'working').findIndex((x) => x.id === s.id);
  return CHIP_KEYS[Math.min(Math.max(i, 0), CHIP_KEYS.length - 1)]!;
}

export const bdStagesOf = (all: Stage[] | undefined) =>
  (all ?? []).filter((s) => s.desk === 'bd').sort((a, b) => a.position - b.position);

export function useDeals() {
  return useQuery({ queryKey: ['bd', 'deals'], queryFn: () => api.get<{ deals: DealRow[] }>('/bd/deals'), refetchInterval: 60_000 });
}
export function useDeal(id: string | null) {
  return useQuery({
    queryKey: ['lead', id, 'bd'],
    queryFn: () => api.get<DealDetail>(`/bd/deals/${id}`),
    enabled: !!id,
  });
}
/** Everything a BD change can affect. */
export const bdInvalidate = (id: string) => [['lead', id], ['bd'], ['notifications']];

export const isLost = (d: { lostAt: string | null }) => !!d.lostAt;
export const isWon = (d: { wonAt: string | null; lostAt: string | null }) => !!d.wonAt && !d.lostAt;
export const isOpen = (d: { wonAt: string | null; lostAt: string | null }) => !d.wonAt && !d.lostAt;

/** Value is hidden until the deal reaches a stage that shows it (mockup: "Quotation sent" onwards). */
export function valueText(d: DealRow) {
  if (d.lostAt) return d.latestQuote ? `${money(d.latestQuote.amount)} quoted` : 'Never quoted';
  if (d.wonAt) return money(d.contractValue);
  if (!d.stage?.showsValue || !d.latestQuote) return 'Not quoted yet';
  return money(d.value);
}
export const valueShown = (d: DealRow) => !d.lostAt && (!!d.wonAt || (!!d.stage?.showsValue && !!d.latestQuote));

export function subLine(d: DealRow, firstStageId?: number) {
  if (d.lostAt) return `Reason: ${d.lostReason ?? '—'}`;
  if (d.wonAt) return d.balance ? `Balance ${money(d.balance)} of ${money(d.contractValue)}` : 'Fully paid';
  if (d.discountPending) return 'Discount waiting on Admin';
  if (d.visit?.status === 'booked') return `Visit ${friendly(d.visit.scheduledAt)}`;
  if (d.latestQuote) return `Quote v${d.latestQuote.version} sent ${when(d.latestQuote.at, { time: false })}`;
  if (d.cad) return `CAD rev ${d.cad.rev} · ${when(d.cad.at, { time: false })}`;
  if (d.stage?.id === firstStageId) return 'Measurement not booked';
  return d.visit?.status === 'done' ? 'Measured · no drawing yet' : '—';
}

export const short = (n: number) =>
  n >= 100000 ? '₹' + (n / 100000).toFixed(n >= 1000000 ? 0 : 1).replace(/\.0$/, '') + 'L' : money(n);

export const KIND_LABEL: Record<string, string> = { advance: 'Advance', installment: 'Installment', final: 'Final balance' };

export function matches(d: DealRow, q: string) {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const digits = s.replace(/\D/g, '');
  return (
    [d.customerName, d.contactName, d.place, d.requirement, d.handedBy, d.sourceLabel].join(' ').toLowerCase().includes(s) ||
    (digits.length >= 3 && !!d.phone?.includes(digits))
  );
}

/** "2026-10-18" for today in IST. */
export const todayIst = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
