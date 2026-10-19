import type { Desk, Platform, Role, StageKind, TagScope, Tone } from '@jkay/shared';

export type Me = {
  id: string;
  username: string;
  fullName: string;
  role: Role;
  email: string;
  phone: string | null;
  territory: string | null;
};

export type Stage = {
  id: number;
  desk: Desk;
  kind: StageKind;
  name: string;
  definition: string;
  position: number;
  requiresFollowup: boolean;
  requiresStageTag: boolean;
  showsValue: boolean;
  requiresQuotation: boolean;
};
export type Tag = { id: number; scope: TagScope; name: string; tone: Tone; stageId: number | null; position: number };
export type Category = { id: number; name: string };
export type Template = { id: number; audience: 'client' | 'cre'; desk: Desk; title: string; body: string; ownerId: string | null };
export type Config = { stages: Stage[]; tags: Tag[]; categories: Category[]; templates: Template[]; settings: Record<string, unknown> };

export type Employee = {
  id: string;
  username: string;
  fullName: string;
  role: Role;
  active: boolean;
  territory: string | null;
  email?: string;
  phone?: string | null;
  createdAt?: string;
};

export type MiniTag = { id: number; name: string; tone: Tone };

export type LeadRow = {
  id: string;
  number: number;
  customerName: string;
  phone: string | null;
  place: string | null;
  platform: Platform;
  sourceLabel: string | null;
  category: string | null;
  creStage: { id: number; name: string; kind: StageKind } | null;
  bdStage: string | null;
  stageTag: MiniTag | null;
  tags: MiniTag[];
  nextFollowupAt: string | null;
  qualifiedAt: string | null;
  lostAt: string | null;
  lostReason: string | null;
  createdAt: string;
  ownerSince: string | null;
};

type StageRef = { id: number; name: string; kind: StageKind; definition: string } | null;
export type LeadDetail = {
  lead: {
    id: string;
    number: number;
    customerName: string;
    contactName: string | null;
    phone: string | null;
    altPhone: string | null;
    email: string | null;
    place: string | null;
    requirement: string | null;
    category: { id: number; name: string } | null;
    platform: Platform;
    sourceLabel: string | null;
    desk: Desk;
    creStage: StageRef;
    bdStage: StageRef;
    stageTag: MiniTag | null;
    owner: { id: string; name: string } | null;
    ownerSince: string | null;
    qualifiedBy: { id: string; name: string } | null;
    qualifiedAt: string | null;
    estimate: number | null;
    contractValue: number | null;
    wonAt: string | null;
    lost: { at: string; desk: Desk | null; reason: string; note: string | null; by: string | null | undefined } | null;
    nextFollowupAt: string | null;
    createdAt: string;
  };
  followup: { id: number; dueAt: string; note: string | null } | null;
  tags: (MiniTag & { scope: TagScope })[];
  notes: { id: number; text: string; color: string; pinned: boolean; scope: string; author: string; mine: boolean; createdAt: string }[];
  activity: { id: number; kind: string; title: string; body: string | null; by: string; at: string }[];
  owners: { owner: string; desk: Desk; reason: string; by: string; note: string | null; from: string; to: string | null }[];
  photos: { id: number; fileName: string; by: string; mine: boolean; at: string }[];
};

/* --------------------------------- BD desk -------------------------------- */
export type BdStageRef = { id: number; name: string; kind: StageKind; position: number; showsValue: boolean };
export type DealRow = {
  id: string;
  number: number;
  customerName: string;
  contactName: string | null;
  phone: string | null;
  place: string | null;
  requirement: string | null;
  category: string | null;
  platform: Platform;
  sourceLabel: string | null;
  stage: BdStageRef | null;
  owner: { id: string; name: string } | null;
  handedBy: string;
  handedAt: string | null;
  estimate: number | null;
  tags: MiniTag[];
  quoteCount: number;
  latestQuote: { version: number; amount: number; at: string } | null;
  value: number | null;
  contractValue: number | null;
  paid: number;
  balance: number | null;
  cad: { rev: number; at: string } | null;
  visit: { id: number; scheduledAt: string; status: string; engineer: string } | null;
  discountPending: boolean;
  wonAt: string | null;
  productionDate: string | null;
  lostAt: string | null;
  lostReason: string | null;
  updatedAt: string;
};
export type BdBlock = {
  handedBy: { id: string; name: string; phone: string | null } | null;
  value: number | null;
  contractValue: number | null;
  paid: number;
  balance: number | null;
  productionDate: string | null;
  discountThreshold: number;
  visits: { id: number; scheduledAt: string; engineer: string; engineerId: string | null; note: string | null; status: 'booked' | 'done' | 'cancelled'; doneAt: string | null }[];
  cad: { id: number; rev: number; attachmentId: number; fileName: string; note: string | null; by: string; at: string }[];
  quotations: { id: number; version: number; amount: number; attachmentId: number | null; fileName: string | null; note: string | null; by: string; at: string }[];
  payments: { id: number; kind: 'advance' | 'installment' | 'final'; amount: number; receivedOn: string; mode: string; reference: string | null; by: string }[];
  discounts: {
    id: number;
    percent: number;
    proposedAmount: number | null;
    reason: string | null;
    status: 'pending' | 'approved' | 'rejected';
    by: string;
    decidedBy: string | null;
    decidedAt: string | null;
    decisionNote: string | null;
    at: string;
  }[];
};
export type DealDetail = LeadDetail & { bd: BdBlock };

export type Notification = {
  id: number;
  kind: string;
  leadId: string | null;
  customer: string | null;
  title: string;
  body: string | null;
  viaWatch: boolean;
  read: boolean;
  createdAt: string;
};
