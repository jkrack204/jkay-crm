import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PLATFORM_LABEL, type AdminScope, type Platform, type StageKind, type Tone } from '@jkay/shared';
import { api } from '../../lib/api';
import { initials, money } from '../../lib/format';

export type Person = { id: string; name: string; role: 'admin' | 'cre' | 'bde' };
export type StageRef = { id: number; name: string; kind: StageKind; position: number } | null;
export type AdminRecord = {
  id: string;
  number: number;
  customerName: string;
  contactName: string | null;
  phone: string | null;
  place: string | null;
  platform: Platform;
  sourceLabel: string | null;
  desk: 'cre' | 'bd';
  creStage: StageRef;
  bdStage: StageRef;
  stageTag: { name: string; tone: Tone } | null;
  owner: Person | null;
  cre: Person | null;
  bde: Person | null;
  createdAt: string;
  qualifiedAt: string | null;
  ownerSince: string | null;
  nextFollowupAt: string | null;
  lastContactAt: string | null;
  estimate: number | null;
  quoteCount: number;
  latestQuote: number | null;
  value: number | null;
  contractValue: number | null;
  paid: number;
  payments: { id: number; kind: 'advance' | 'installment' | 'final'; amount: number; receivedOn: string; mode: string }[];
  wonAt: string | null;
  productionDate: string | null;
  lost: { desk: 'cre' | 'bd' | null; reason: string; note: string | null; at: string; by: string | null } | null;
  discountPending: boolean;
  adminTags: { id: number; name: string; tone: Tone }[];
  watch: boolean;
  notes: { id: number; text: string; color: string; pinned: boolean; updatedAt: string }[];
  rank: number | null;
};

export function useRecords(scope: AdminScope, opts: { from?: string; q?: string; enabled?: boolean } = {}) {
  const p = new URLSearchParams({ scope });
  if (opts.from) p.set('from', opts.from);
  if (opts.q) p.set('q', opts.q);
  return useQuery({
    queryKey: ['admin', 'records', scope, opts.from ?? '', opts.q ?? ''],
    queryFn: () => api.get<{ records: AdminRecord[] }>(`/admin/records?${p}`),
    enabled: opts.enabled ?? true,
    refetchInterval: scope === 'search' ? false : 60_000,
  });
}
/** Every Admin change can touch the lists, the open record and the bell. */
export const adminInvalidate = [['admin'], ['lead'], ['notifications'], ['discounts']];

export const isLive = (r: AdminRecord) => !r.lost && !r.wonAt;
export const isPool = (r: AdminRecord) => r.desk === 'cre' && !r.owner && r.creStage?.kind === 'pool';
export const stageName = (r: AdminRecord) => (r.lost ? 'Lost' : r.desk === 'bd' ? (r.bdStage?.name ?? '—') : (r.creStage?.name ?? '—'));
/** Quoted value once BD has priced it, else the CRE's estimate. */
export const dealValue = (r: AdminRecord) => r.contractValue ?? r.latestQuote ?? r.estimate ?? 0;
export const platformName = (p: Platform) => PLATFORM_LABEL[p] ?? p;
export const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
export const shortMoney = (n: number) =>
  n >= 10000000 ? `₹${(n / 10000000).toFixed(1).replace(/\.0$/, '')}Cr` : n >= 100000 ? `₹${(n / 100000).toFixed(1).replace(/\.0$/, '')}L` : money(n);

const AV_COLORS: [string, string][] = [
  ['#eff3f8', '#40628f'],
  ['#f3effa', '#5b4a8a'],
  ['#eef4f0', '#3f7355'],
  ['#f4e9dd', '#8a5a36'],
  ['#f8efe6', '#96603a'],
  ['#eef2f6', '#4a6480'],
];
const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
export function Who({ name, sub }: { name: string | null | undefined; sub?: string }) {
  if (!name) return <span className="muted">—</span>;
  const [bg, fg] = AV_COLORS[hash(name) % AV_COLORS.length]!;
  return (
    <span className="who">
      <span className="av" style={{ background: bg, color: fg }}>
        {initials(name)}
      </span>
      {name}
      {sub && <span className="muted" style={{ fontSize: 11.5 }}>{sub}</span>}
    </span>
  );
}

export const tonePill = (t: Tone | string) => (t === 'neutral' ? '' : t);
export function Pill({ tone = '', children, adm, onClick, title }: { tone?: string; children: React.ReactNode; adm?: boolean; onClick?: () => void; title?: string }) {
  return (
    <span className={`pill ${tone} ${adm ? 'adm' : ''}`} onClick={onClick} title={title} style={onClick ? { cursor: 'pointer' } : undefined}>
      <i></i>
      {children}
    </span>
  );
}

/** Months (YYYY-MM) covered by a list of ISO dates, oldest first. */
export const monthKey = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7);
export const monthLabel = (ym: string) => new Date(ym + '-15T12:00:00+05:30').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
export function monthsBetween(fromYm: string, toYm: string) {
  const out: string[] = [];
  let [y, m] = fromYm.split('-').map(Number) as [number, number];
  const [ty, tm] = toYm.split('-').map(Number) as [number, number];
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
    if (out.length > 120) break;
  }
  return out;
}
export const todayYm = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7);

/** Records open as a sheet over whatever list you're on (?rec=<id>). */
export function useOpenRecord() {
  const [, setParams] = useSearchParams();
  return (id: string) => setParams((p) => (p.set('rec', id), p));
}
