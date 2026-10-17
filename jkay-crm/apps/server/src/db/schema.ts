/**
 * JKAY Racks CRM — database schema.
 *
 * One `leads` row is the whole life of an enquiry: it starts on the CRE desk,
 * may be handed to BD (where the mockups call it a "deal"), and ends won or lost.
 * Everything else hangs off that row.
 *
 * Money is stored in whole rupees (bigint).
 * Every timestamp is timestamptz; the UI shows IST.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  ATTACHMENT_KINDS,
  DESKS,
  DISCOUNT_STATUS,
  NOTE_SCOPES,
  OWNERSHIP_REASONS,
  PAYMENT_KINDS,
  PAYMENT_MODES,
  PLATFORMS,
  ROLES,
  STAGE_KINDS,
  TAG_SCOPES,
  TONES,
  VISIT_STATUS,
} from '@jkay/shared';

/* ================================= enums ================================= */
export const roleEnum = pgEnum('role', ROLES);
export const deskEnum = pgEnum('desk', DESKS);
export const stageKindEnum = pgEnum('stage_kind', STAGE_KINDS);
export const tagScopeEnum = pgEnum('tag_scope', TAG_SCOPES);
export const toneEnum = pgEnum('tone', TONES);
export const platformEnum = pgEnum('platform', PLATFORMS);
export const ownershipReasonEnum = pgEnum('ownership_reason', OWNERSHIP_REASONS);
export const noteScopeEnum = pgEnum('note_scope', NOTE_SCOPES);
export const paymentKindEnum = pgEnum('payment_kind', PAYMENT_KINDS);
export const paymentModeEnum = pgEnum('payment_mode', PAYMENT_MODES);
export const visitStatusEnum = pgEnum('visit_status', VISIT_STATUS);
export const discountStatusEnum = pgEnum('discount_status', DISCOUNT_STATUS);
export const attachmentKindEnum = pgEnum('attachment_kind', ATTACHMENT_KINDS);
export const followupStatusEnum = pgEnum('followup_status', ['open', 'done', 'cancelled']);
export const inboundStatusEnum = pgEnum('inbound_status', ['pending', 'created', 'duplicate', 'failed']);
export const templateAudienceEnum = pgEnum('template_audience', ['client', 'cre']);

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts('created_at').notNull().defaultNow();
const rupees = (name: string) => bigint(name, { mode: 'number' });

/* =============================== people ================================= */
/**
 * One row per login. People log in with `username` + password (our own auth —
 * no third-party auth service). `email` is the person's real address, used only
 * to send them alerts.
 */
export const employees = pgTable(
  'employees',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    username: text('username').notNull(),
    /** scrypt hash, format `scrypt$N$r$p$salt$hash` (see auth/password.ts). Never sent to the browser. */
    passwordHash: text('password_hash').notNull(),
    passwordChangedAt: ts('password_changed_at').notNull().defaultNow(),
    fullName: text('full_name').notNull(),
    role: roleEnum('role').notNull(),
    email: text('email').notNull(),
    phone: text('phone'),
    territory: text('territory'),
    avatarPath: text('avatar_path'),
    active: boolean('active').notNull().default(true),
    /** Personal working preferences: calling window, quiet hours, max open leads, default follop gap… */
    prefs: jsonb('prefs').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    createdBy: uuid('created_by'),
  },
  (t) => [uniqueIndex('employees_username_uq').on(t.username), index('employees_role_idx').on(t.role)],
);

/**
 * Login sessions. The browser holds a random token in an httpOnly cookie;
 * only its SHA-256 hash is stored, so a database leak can't be replayed.
 * Deleting rows = signing people out (password change, Admin disables a user).
 */
export const sessions = pgTable(
  'sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    employeeId: uuid('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    userAgent: text('user_agent'),
    ip: text('ip'),
  },
  (t) => [index('sessions_employee_idx').on(t.employeeId), index('sessions_expires_idx').on(t.expiresAt)],
);

/* ============================ configuration ============================= */
/**
 * Stages are Admin's to create, rename, describe and reorder.
 * `kind` pins the few stages the workflow depends on (see STAGE_KINDS).
 */
export const stages = pgTable(
  'stages',
  {
    id: serial('id').primaryKey(),
    desk: deskEnum('desk').notNull(),
    kind: stageKindEnum('kind').notNull().default('working'),
    name: text('name').notNull(),
    definition: text('definition').notNull().default(''),
    position: integer('position').notNull(),
    /** Entering this stage needs a next follop date. */
    requiresFollowup: boolean('requires_followup').notNull().default(false),
    /** Entering this stage needs one of the tags tied to it (tags.stage_id). */
    requiresStageTag: boolean('requires_stage_tag').notNull().default(false),
    /** BD: order value is shown from this stage on (mockup: "Quotation sent" onwards). */
    showsValue: boolean('shows_value').notNull().default(false),
    /** BD: a quotation must exist before a deal can enter this stage. */
    requiresQuotation: boolean('requires_quotation').notNull().default(false),
    archivedAt: ts('archived_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('stages_desk_pos_idx').on(t.desk, t.position),
    // pool / handoff / won / lost exist at most once per desk
    uniqueIndex('stages_system_kind_uq').on(t.desk, t.kind).where(sql`${t.kind} <> 'working' and ${t.archivedAt} is null`),
    check(
      'stages_kind_matches_desk',
      sql`(${t.desk} = 'cre' and ${t.kind} in ('pool','working','handoff','lost'))
       or (${t.desk} = 'bd' and ${t.kind} in ('working','won','lost'))`,
    ),
  ],
);

/**
 * The tag library. Only Admin creates tags; desks pick from it.
 * Lost reasons are tags too (scope cre_lost / bd_lost).
 * A tag with `stage_id` is a stage tag, e.g. the Follop categories on a follow-up stage.
 */
export const tags = pgTable(
  'tags',
  {
    id: serial('id').primaryKey(),
    scope: tagScopeEnum('scope').notNull(),
    name: text('name').notNull(),
    tone: toneEnum('tone').notNull().default('neutral'),
    stageId: integer('stage_id').references(() => stages.id),
    position: integer('position').notNull().default(0),
    archivedAt: ts('archived_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('tags_scope_name_uq').on(t.scope, sql`lower(${t.name})`).where(sql`${t.archivedAt} is null`),
  ],
);

/** Product categories (Standard, Fancy, Sports…), Admin-managed. */
export const categories = pgTable('categories', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  position: integer('position').notNull().default(0),
  archivedAt: ts('archived_at'),
});

/** Free-form system settings: discount threshold, escalation timings, etc. */
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  updatedBy: uuid('updated_by').references(() => employees.id),
});

/** WhatsApp text templates. owner_id null = shared (Admin-managed). Opened via wa.me, never sent by us. */
export const messageTemplates = pgTable('message_templates', {
  id: serial('id').primaryKey(),
  audience: templateAudienceEnum('audience').notNull(),
  desk: deskEnum('desk').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  ownerId: uuid('owner_id').references(() => employees.id),
  position: integer('position').notNull().default(0),
  createdAt: createdAt(),
});

/* ================================ leads ================================= */
export const leads = pgTable(
  'leads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Human-friendly number shown in the UI (JK-1042). */
    number: serial('number').notNull().unique(),

    customerName: text('customer_name').notNull(),
    contactName: text('contact_name'),
    /** Country code + digits, no '+' (see normalizePhone). */
    phone: text('phone'),
    altPhone: text('alt_phone'),
    email: text('email'),
    place: text('place'),
    requirement: text('requirement'),
    categoryId: integer('category_id').references(() => categories.id),

    /** Where it came in from (never rewritten). */
    platform: platformEnum('platform').notNull(),
    /** Free-text source label, editable by the owner (campaign, referral name…). */
    sourceLabel: text('source_label'),
    externalRef: text('external_ref'),

    /** Which desk holds it now. */
    desk: deskEnum('desk').notNull().default('cre'),
    creStageId: integer('cre_stage_id').notNull().references(() => stages.id),
    bdStageId: integer('bd_stage_id').references(() => stages.id),
    /** Required stage tag for the current CRE stage (e.g. "Call Not Attend - 2"). */
    stageTagId: integer('stage_tag_id').references(() => tags.id),

    /** Current owner. Null = sitting in the unclaimed pool. Full history in lead_owners. */
    ownerId: uuid('owner_id').references(() => employees.id),
    ownerSince: ts('owner_since'),
    /** The CRE who qualified it to BD (kept after hand-off for "handed over by"). */
    qualifiedById: uuid('qualified_by_id').references(() => employees.id),
    qualifiedAt: ts('qualified_at'),

    estimate: rupees('estimate'),
    /** Locked at Won from the latest quotation. */
    contractValue: rupees('contract_value'),
    productionDate: date('production_date'),
    wonAt: ts('won_at'),

    lostAt: ts('lost_at'),
    lostDesk: deskEnum('lost_desk'),
    lostReasonId: integer('lost_reason_id').references(() => tags.id),
    lostNote: text('lost_note'),
    lostById: uuid('lost_by_id').references(() => employees.id),

    /** Mirrors the open follow-up so lists can sort on it. */
    nextFollowupAt: ts('next_followup_at'),
    lastContactAt: ts('last_contact_at'),

    duplicateOfId: uuid('duplicate_of_id'),
    createdAt: createdAt(),
    createdById: uuid('created_by_id').references(() => employees.id),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('leads_owner_idx').on(t.ownerId),
    index('leads_desk_cre_stage_idx').on(t.desk, t.creStageId),
    index('leads_desk_bd_stage_idx').on(t.desk, t.bdStageId),
    index('leads_phone_idx').on(t.phone),
    index('leads_created_idx').on(t.createdAt),
    index('leads_followup_idx').on(t.nextFollowupAt),
    check('leads_bd_has_stage', sql`${t.desk} = 'cre' or ${t.bdStageId} is not null`),
  ],
);

/**
 * Owner log — one row per stint of ownership.
 * The open row (ended_at is null) is the current owner; owner_id null = the pool.
 */
export const leadOwners = pgTable(
  'lead_owners',
  {
    id: serial('id').primaryKey(),
    leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id').references(() => employees.id),
    desk: deskEnum('desk').notNull(),
    reason: ownershipReasonEnum('reason').notNull(),
    note: text('note'),
    byId: uuid('by_id').references(() => employees.id),
    startedAt: ts('started_at').notNull().defaultNow(),
    endedAt: ts('ended_at'),
  },
  (t) => [
    index('lead_owners_lead_idx').on(t.leadId, t.startedAt),
    uniqueIndex('lead_owners_one_open_uq').on(t.leadId).where(sql`${t.endedAt} is null`),
  ],
);

/** Every stage move on either desk — feeds the funnel, trends and timelines. */
export const stageHistory = pgTable(
  'stage_history',
  {
    id: serial('id').primaryKey(),
    leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
    desk: deskEnum('desk').notNull(),
    fromStageId: integer('from_stage_id').references(() => stages.id),
    toStageId: integer('to_stage_id').notNull().references(() => stages.id),
    byId: uuid('by_id').references(() => employees.id),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [index('stage_history_lead_idx').on(t.leadId, t.at), index('stage_history_to_idx').on(t.toStageId, t.at)],
);

/** Activity log shown on the record. `desk` lets a CRE see only CRE-side entries after hand-off. */
export const activities = pgTable(
  'activities',
  {
    id: serial('id').primaryKey(),
    leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => employees.id), // null = System
    desk: deskEnum('desk'),
    kind: text('kind').notNull(), // call, whatsapp_opened, stage, tag, edit, photo, visit, cad, quotation, payment, transfer…
    title: text('title').notNull(),
    body: text('body'),
    meta: jsonb('meta').$type<Record<string, unknown>>(),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [index('activities_lead_idx').on(t.leadId, t.at)],
);

/** Desk tags put on a lead (CRE or BD scope, from the library). */
export const leadTags = pgTable(
  'lead_tags',
  {
    leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
    tagId: integer('tag_id').notNull().references(() => tags.id),
    addedById: uuid('added_by_id').references(() => employees.id),
    addedAt: ts('added_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.leadId, t.tagId] })],
);

/** Sticky notes. scope decides who can read them (see NOTE_SCOPES). */
export const notes = pgTable(
  'notes',
  {
    id: serial('id').primaryKey(),
    leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').notNull().references(() => employees.id),
    scope: noteScopeEnum('scope').notNull(),
    text: text('text').notNull(),
    color: text('color').notNull().default('#fdf3e2'),
    pinned: boolean('pinned').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('notes_lead_idx').on(t.leadId), index('notes_author_idx').on(t.authorId)],
);

/** Follop schedule with its reminder → repeat → escalate state. */
export const followups = pgTable(
  'followups',
  {
    id: serial('id').primaryKey(),
    leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id').notNull().references(() => employees.id),
    dueAt: ts('due_at').notNull(),
    note: text('note'),
    status: followupStatusEnum('status').notNull().default('open'),
    remindedAt: ts('reminded_at'),
    repeatedAt: ts('repeated_at'),
    escalatedAt: ts('escalated_at'),
    closedAt: ts('closed_at'),
    createdById: uuid('created_by_id').references(() => employees.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('followups_due_idx').on(t.status, t.dueAt),
    uniqueIndex('followups_one_open_uq').on(t.leadId).where(sql`${t.status} = 'open'`),
  ],
);

/* ============================== files =================================== */
/** Files live in the Railway Storage Bucket (private, served via short-lived signed URLs); this is the index. */
export const attachments = pgTable(
  'attachments',
  {
    id: serial('id').primaryKey(),
    leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
    kind: attachmentKindEnum('kind').notNull(),
    bucket: text('bucket').notNull(),
    path: text('path').notNull(),
    fileName: text('file_name').notNull(),
    mime: text('mime'),
    sizeBytes: integer('size_bytes'),
    uploadedById: uuid('uploaded_by_id').references(() => employees.id),
    createdAt: createdAt(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [index('attachments_lead_idx').on(t.leadId, t.kind)],
);

/* ============================== BD desk ================================= */
export const siteVisits = pgTable(
  'site_visits',
  {
    id: serial('id').primaryKey(),
    leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
    scheduledAt: ts('scheduled_at').notNull(),
    /** Who measures — a BDE, or a free-text name (no measurement logins). */
    engineerId: uuid('engineer_id').references(() => employees.id),
    engineerName: text('engineer_name'),
    note: text('note'),
    status: visitStatusEnum('status').notNull().default('booked'),
    doneAt: ts('done_at'),
    createdById: uuid('created_by_id').references(() => employees.id),
    createdAt: createdAt(),
  },
  (t) => [index('site_visits_when_idx').on(t.status, t.scheduledAt), index('site_visits_lead_idx').on(t.leadId)],
);

export const cadRevisions = pgTable(
  'cad_revisions',
  {
    id: serial('id').primaryKey(),
    leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
    rev: integer('rev').notNull(),
    attachmentId: integer('attachment_id').notNull().references(() => attachments.id),
    note: text('note'),
    byId: uuid('by_id').references(() => employees.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('cad_rev_uq').on(t.leadId, t.rev)],
);

/** v1: the quotation is made outside the CRM, uploaded here with its value. */
export const quotations = pgTable(
  'quotations',
  {
    id: serial('id').primaryKey(),
    leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    amount: rupees('amount').notNull(),
    attachmentId: integer('attachment_id').references(() => attachments.id),
    note: text('note'),
    byId: uuid('by_id').references(() => employees.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('quotation_version_uq').on(t.leadId, t.version), check('quotation_amount_pos', sql`${t.amount} > 0`)],
);

export const payments = pgTable(
  'payments',
  {
    id: serial('id').primaryKey(),
    leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
    kind: paymentKindEnum('kind').notNull(),
    amount: rupees('amount').notNull(),
    receivedOn: date('received_on').notNull(),
    mode: paymentModeEnum('mode').notNull(),
    reference: text('reference'),
    recordedById: uuid('recorded_by_id').references(() => employees.id),
    createdAt: createdAt(),
  },
  (t) => [index('payments_lead_idx').on(t.leadId), check('payment_amount_pos', sql`${t.amount} > 0`)],
);

/** Discounts past the Admin-set threshold wait here for any Admin to approve or reject. */
export const discountRequests = pgTable(
  'discount_requests',
  {
    id: serial('id').primaryKey(),
    leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
    quotationId: integer('quotation_id').references(() => quotations.id),
    percent: numeric('percent', { precision: 5, scale: 2 }).notNull(),
    proposedAmount: rupees('proposed_amount'),
    reason: text('reason'),
    status: discountStatusEnum('status').notNull().default('pending'),
    requestedById: uuid('requested_by_id').notNull().references(() => employees.id),
    decidedById: uuid('decided_by_id').references(() => employees.id),
    decidedAt: ts('decided_at'),
    decisionNote: text('decision_note'),
    createdAt: createdAt(),
  },
  (t) => [index('discount_status_idx').on(t.status, t.createdAt)],
);

/* ===================== per-Admin private workspace ====================== */
/** Each Admin's own drag-to-rank order. `rank` is a sortable string (fractional index). */
export const adminRankings = pgTable(
  'admin_rankings',
  {
    adminId: uuid('admin_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
    rank: text('rank').notNull(),
  },
  (t) => [primaryKey({ columns: [t.adminId, t.leadId] }), index('admin_rank_order_idx').on(t.adminId, t.rank)],
);

/** Each Admin's own admin tags on records. */
export const adminLeadTags = pgTable(
  'admin_lead_tags',
  {
    adminId: uuid('admin_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
    tagId: integer('tag_id').notNull().references(() => tags.id),
    addedAt: ts('added_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.adminId, t.leadId, t.tagId] })],
);

/** "Notify me" — each Admin watches their own set of records. */
export const adminWatches = pgTable(
  'admin_watches',
  {
    adminId: uuid('admin_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.adminId, t.leadId] })],
);

/* ============================ notifications ============================= */
export const notifications = pgTable(
  'notifications',
  {
    id: serial('id').primaryKey(),
    recipientId: uuid('recipient_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // followup, repeat, escalation, handoff, transfer, pool, visit, balance, discount, lost, won, move, idle, system
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body'),
    /** Set when the event came from an Admin's "Notify me" watch. */
    viaWatch: boolean('via_watch').notNull().default(false),
    readAt: ts('read_at'),
    emailedAt: ts('emailed_at'),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_recipient_idx').on(t.recipientId, t.createdAt)],
);

/* ============================ lead sources ============================== */
/** One row per platform. Secrets are encrypted with SECRETS_KEY before they land here. */
export const leadSources = pgTable('lead_sources', {
  platform: platformEnum('platform').primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
  /** AES-GCM encrypted JSON of API keys / tokens. Never returned to the browser in full. */
  secretsEnc: text('secrets_enc'),
  /** Last 4 chars of the main key, for the masked display. */
  secretHint: text('secret_hint'),
  /** Random token that forms our inbound webhook URL for this platform. */
  inboundToken: text('inbound_token'),
  config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  connectedAt: ts('connected_at'),
  lastReceivedAt: ts('last_received_at'),
  lastSyncAt: ts('last_sync_at'),
  lastError: text('last_error'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/** Every lead exactly as a platform sent it, before we turn it into a `leads` row. */
export const inboundLeads = pgTable(
  'inbound_leads',
  {
    id: serial('id').primaryKey(),
    platform: platformEnum('platform').notNull(),
    externalId: text('external_id'),
    payload: jsonb('payload').notNull(),
    status: inboundStatusEnum('status').notNull().default('pending'),
    error: text('error'),
    leadId: uuid('lead_id').references(() => leads.id),
    receivedAt: ts('received_at').notNull().defaultNow(),
    processedAt: ts('processed_at'),
  },
  (t) => [
    uniqueIndex('inbound_platform_ext_uq').on(t.platform, t.externalId).where(sql`${t.externalId} is not null`),
    index('inbound_status_idx').on(t.status, t.receivedAt),
  ],
);
