import { PLATFORM_LABEL, formatPhone, type Platform } from '@jkay/shared';

const IST = 'Asia/Kolkata';

export const money = (n: number | null | undefined) => '₹' + Number(n ?? 0).toLocaleString('en-IN');

export function when(iso: string | null | undefined, opts: { time?: boolean; year?: boolean } = { time: true }) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-IN', {
    timeZone: IST,
    day: '2-digit',
    month: 'short',
    ...(opts.year ? { year: 'numeric' } : {}),
    ...(opts.time ? { hour: 'numeric', minute: '2-digit' } : {}),
  });
}

/** "Today, 4:00 pm" / "Tomorrow, 10:00 am" / "27 Aug, 11:00 am" */
export function friendly(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  const day = (x: Date) => x.toLocaleDateString('en-CA', { timeZone: IST });
  const today = day(new Date());
  const tomorrow = day(new Date(Date.now() + 86400000));
  const t = d.toLocaleTimeString('en-IN', { timeZone: IST, hour: 'numeric', minute: '2-digit' });
  if (day(d) === today) return `Today, ${t}`;
  if (day(d) === tomorrow) return `Tomorrow, ${t}`;
  return when(iso);
}

export const isDueToday = (iso: string | null | undefined) => {
  if (!iso) return false;
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return new Date(iso) <= end;
};

export const phone = (p: string | null | undefined) => (p ? formatPhone(p) : '—');
export const platformLabel = (p: Platform) => PLATFORM_LABEL[p] ?? p;
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

/** <input type="date"> + <input type="time"> in IST → ISO with offset. */
export function istToIso(date: string, time: string) {
  return new Date(`${date}T${time || '10:00'}:00+05:30`).toISOString();
}
export function isoToIstParts(iso: string | null | undefined) {
  if (!iso) return { date: '', time: '10:00' };
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-CA', { timeZone: IST });
  const time = d.toLocaleTimeString('en-GB', { timeZone: IST, hour: '2-digit', minute: '2-digit' });
  return { date, time };
}
export const tomorrowIst = () => new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: IST });

/** Tone → the tag classes the mockup CSS already styles. */
export const toneClass = (tone: string) =>
  ({ green: 'tag-highvalue', amber: 'tag-followup', red: 'tag-cna3', blue: 'tag-sitevisit', violet: 'tag-longfollowup', neutral: 'tag-transferred' })[tone] ??
  'tag-transferred';
