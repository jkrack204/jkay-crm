/** IST helpers for the background jobs. India has no daylight saving, so +05:30 is fixed. */
const IST_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The IST calendar date of an instant, as YYYY-MM-DD. */
export const istDate = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);

/** The instant of HH:MM IST on an IST date. */
export const istAt = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`);

/** Add whole days to an IST date string. */
export const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

export const hoursAgo = (now: Date, h: number) => new Date(now.getTime() - h * 60 * 60 * 1000);
export const daysAgo = (now: Date, d: number) => new Date(now.getTime() - d * DAY_MS);

/** "19 Oct" */
export const dayLabel = (date: string) =>
  new Date(`${date}T00:00:00+05:30`).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' });

/** "19 Oct, 4:00 pm" */
export const whenLabel = (d: Date) =>
  d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' });

/** "4:00 pm" */
export const timeLabel = (d: Date) => d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' });
