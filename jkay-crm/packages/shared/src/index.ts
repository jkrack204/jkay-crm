/**
 * Shared vocabulary between the server and the web app.
 * Anything both sides must agree on (enums, input shapes, phone format) lives here.
 */
import { z } from 'zod';

/* ----------------------------- roles & desks ----------------------------- */
export const ROLES = ['admin', 'cre', 'bde'] as const;
export type Role = (typeof ROLES)[number];

export const DESKS = ['cre', 'bd'] as const;
export type Desk = (typeof DESKS)[number];

/**
 * Stages are created by Admin. A few stages carry fixed system meaning so the
 * workflow rules still work whatever Admin names them:
 *  - CRE desk: exactly one `pool`, one `handoff` (qualified to BD), one `lost`;
 *    any number of `working` stages in between.
 *  - BD desk: exactly one `won`, one `lost`; any number of `working` stages.
 */
export const STAGE_KINDS = ['pool', 'working', 'handoff', 'won', 'lost'] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

/* ------------------------------- tags ----------------------------------- */
/** cre / bd = desk tags; admin = admin-only; *_lost = forced lost reasons. */
export const TAG_SCOPES = ['cre', 'bd', 'admin', 'cre_lost', 'bd_lost'] as const;
export type TagScope = (typeof TAG_SCOPES)[number];

export const TONES = ['neutral', 'green', 'amber', 'red', 'blue', 'violet'] as const;
export type Tone = (typeof TONES)[number];

/* ---------------------------- lead sources ------------------------------ */
export const PLATFORMS = ['meta', 'google', 'justdial', 'indiamart', 'sulekha', 'website', 'walkin'] as const;
export type Platform = (typeof PLATFORMS)[number];
export const PLATFORM_LABEL: Record<Platform, string> = {
  meta: 'Meta Ads',
  google: 'Google Ads',
  justdial: 'Justdial',
  indiamart: 'IndiaMART',
  sulekha: 'Sulekha',
  website: 'Website',
  walkin: 'Walk-in',
};

/* --------------------------- ownership log ------------------------------ */
export const OWNERSHIP_REASONS = [
  'intake', // landed in the pool from a source
  'claim', // CRE claimed from the pool
  'admin_assign', // Admin created/assigned it to someone
  'transfer', // CRE -> CRE
  'handoff', // CRE -> BDE (qualified to BD)
  'reassign', // Admin BDE -> BDE
  'release', // back to the unclaimed pool
] as const;
export type OwnershipReason = (typeof OWNERSHIP_REASONS)[number];

/* ------------------------------- notes ---------------------------------- */
/** cre = travels with the lead; bd = private to the BDE; admin = private to that Admin. */
export const NOTE_SCOPES = ['cre', 'bd', 'admin'] as const;
export type NoteScope = (typeof NOTE_SCOPES)[number];
export const NOTE_COLORS = ['#fdf3e2', '#eef4f0', '#eff3f8', '#f3effa', '#faf3f2'] as const;

/* ----------------------------- BD records ------------------------------- */
export const PAYMENT_KINDS = ['advance', 'installment', 'final'] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];
export const PAYMENT_MODES = ['NEFT', 'RTGS', 'UPI', 'Cheque', 'Cash'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export const VISIT_STATUS = ['booked', 'done', 'cancelled'] as const;
export const DISCOUNT_STATUS = ['pending', 'approved', 'rejected'] as const;
export const ATTACHMENT_KINDS = ['photo', 'cad', 'quotation', 'other'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

/* ------------------------------- phones --------------------------------- */
/**
 * Store every phone as country code + digits, no '+' or spaces (e.g. 919876543210).
 * That one format drives duplicate detection, wa.me links and tel: links.
 * Bare 10-digit Indian numbers get 91 prepended.
 */
export function normalizePhone(raw: string, defaultCountry = '91'): string | null {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1); // 0 98765 43210
  if (d.length === 10) d = defaultCountry + d;
  if (d.length < 11 || d.length > 15) return null;
  return d;
}
export const waLink = (phone: string, text?: string) =>
  `https://wa.me/${phone}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
export const telLink = (phone: string) => `tel:+${phone}`;
export function formatPhone(p: string): string {
  if (p.startsWith('91') && p.length === 12) return `+91 ${p.slice(2, 7)} ${p.slice(7)}`;
  return `+${p}`;
}

/* ------------------------------- inputs --------------------------------- */
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,32}$/, 'Use 3–32 letters, numbers, dot, dash or underscore');

export const passwordSchema = z.string().min(8, 'At least 8 characters');

export const loginInput = z.object({ username: usernameSchema, password: z.string().min(1) });
export type LoginInput = z.infer<typeof loginInput>;

export const createEmployeeInput = z.object({
  username: usernameSchema,
  password: passwordSchema,
  fullName: z.string().trim().min(2),
  role: z.enum(ROLES),
  email: z.string().trim().email(),
  phone: z.string().trim().optional(),
  territory: z.string().trim().optional(),
});
export type CreateEmployeeInput = z.infer<typeof createEmployeeInput>;

export const updateEmployeeInput = z.object({
  fullName: z.string().trim().min(2).optional(),
  role: z.enum(ROLES).optional(),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().nullable().optional(),
  territory: z.string().trim().nullable().optional(),
  active: z.boolean().optional(),
});
export const resetPasswordInput = z.object({ password: passwordSchema });
export const changePasswordInput = z.object({ current: z.string().min(1), next: passwordSchema });

/* -------------------------------- leads --------------------------------- */
const optText = z.string().trim().max(2000).optional();
const isoDateTime = z.string().datetime({ offset: true });

/** Admin "Add a lead by hand": to the pool, to a CRE, or straight to a BDE. */
export const createLeadInput = z.object({
  customerName: z.string().trim().min(1).max(200),
  contactName: optText,
  phone: z.string().trim().optional(),
  place: optText,
  requirement: optText,
  platform: z.enum(PLATFORMS).default('walkin'),
  sourceLabel: optText,
  estimate: z.number().int().nonnegative().optional(),
  categoryId: z.number().int().optional(),
  route: z.enum(['pool', 'cre', 'bd']).default('pool'),
  ownerId: z.string().uuid().optional(),
  stageId: z.number().int().optional(),
  note: optText,
});
export type CreateLeadInput = z.infer<typeof createLeadInput>;

export const editLeadInput = z.object({
  customerName: z.string().trim().min(1).max(200).optional(),
  contactName: z.string().trim().max(200).nullable().optional(),
  phone: z.string().trim().optional(),
  altPhone: z.string().trim().nullable().optional(),
  email: z.string().trim().email().nullable().optional().or(z.literal('')),
  place: z.string().trim().nullable().optional(),
  requirement: z.string().trim().nullable().optional(),
  sourceLabel: z.string().trim().nullable().optional(),
  categoryId: z.number().int().nullable().optional(),
  estimate: z.number().int().nonnegative().nullable().optional(),
});
export type EditLeadInput = z.infer<typeof editLeadInput>;

export const setStageInput = z.object({
  stageId: z.number().int(),
  stageTagId: z.number().int().optional(),
  followupAt: isoDateTime.optional(),
  categoryId: z.number().int().optional(),
});
export const followupInput = z.object({ dueAt: isoDateTime, note: optText });
export const callLogInput = z.object({ summary: z.string().trim().min(1).max(4000), nextFollowupAt: isoDateTime.optional() });
export const whatsappLogInput = z.object({ templateId: z.number().int().optional(), to: z.enum(['client', 'cre']).default('client') });
export const tagInput = z.object({ tagId: z.number().int() });
export const noteInput = z.object({ text: z.string().trim().min(1).max(4000), color: z.string().max(20).optional() });
export const noteUpdateInput = z.object({ text: z.string().trim().min(1).max(4000).optional(), color: z.string().max(20).optional(), pinned: z.boolean().optional() });
export const handoffInput = z.object({ toBdeId: z.string().uuid(), note: z.string().trim().min(1).max(4000), verified: z.string().trim().max(200).optional() });
export const transferInput = z.object({
  to: z.union([z.literal('pool'), z.string().uuid()]),
  reason: z.string().trim().min(1).max(200),
  note: z.string().trim().min(1).max(4000),
});
export const lostInput = z.object({ reasonId: z.number().int(), note: optText });
export const claimManyInput = z.object({ leadIds: z.array(z.string().uuid()).min(1).max(100) });

/* -------------------------------- BD desk -------------------------------- */
export const BD_SCOPES = ['open', 'won', 'lost', 'all'] as const;
export type BdScope = (typeof BD_SCOPES)[number];
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const rupeesIn = z.number().int().positive().max(1_000_000_000);

export const bdStageInput = z.object({ stageId: z.number().int() });
export const bdCallInput = z.object({ to: z.enum(['client', 'cre']).default('client'), summary: z.string().trim().min(1).max(4000) });
export const visitInput = z.object({
  scheduledAt: isoDateTime,
  /** A BDE login, or a free-text name for a measurement engineer without a login. */
  engineerId: z.string().uuid().optional(),
  engineerName: z.string().trim().max(200).optional(),
  note: optText,
});
/** Files are uploaded first (POST /api/files) and referenced here by attachment id. */
export const cadInput = z.object({ attachmentId: z.number().int(), note: optText });
export const quotationInput = z.object({ amount: rupeesIn, attachmentId: z.number().int().optional(), note: optText });
export const paymentInput = z.object({
  kind: z.enum(PAYMENT_KINDS),
  amount: rupeesIn,
  receivedOn: isoDate,
  mode: z.enum(PAYMENT_MODES),
  reference: z.string().trim().max(200).optional(),
});
export const discountInput = z.object({ percent: z.number().positive().max(100), reason: z.string().trim().min(1).max(2000) });
export const discountDecisionInput = z.object({ approve: z.boolean(), note: optText });
export const productionDateInput = z.object({ productionDate: isoDate.nullable() });

/** Upload limits, checked in the browser and again on the server. */
export const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
export const UPLOAD_ACCEPT: Record<AttachmentKind, string[]> = {
  photo: ['.jpg', '.jpeg', '.png', '.webp', '.heic'],
  cad: ['.dwg', '.dxf', '.pdf', '.jpg', '.jpeg', '.png'],
  quotation: ['.pdf', '.xlsx', '.xls', '.docx', '.doc', '.jpg', '.jpeg', '.png'],
  other: ['.pdf', '.jpg', '.jpeg', '.png', '.xlsx', '.docx'],
};

export const CRE_SCOPES = ['pool', 'mine', 'bd', 'lost'] as const;
export type CreScope = (typeof CRE_SCOPES)[number];

export const TRANSFER_REASONS = [
  'Language barrier',
  'Territory mismatch',
  'Existing relationship with another rep',
  'Workload rebalance',
  'On leave',
] as const;
