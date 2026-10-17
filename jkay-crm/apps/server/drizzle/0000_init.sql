CREATE TYPE "public"."attachment_kind" AS ENUM('photo', 'cad', 'quotation', 'other');--> statement-breakpoint
CREATE TYPE "public"."desk" AS ENUM('cre', 'bd');--> statement-breakpoint
CREATE TYPE "public"."discount_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."followup_status" AS ENUM('open', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."inbound_status" AS ENUM('pending', 'created', 'duplicate', 'failed');--> statement-breakpoint
CREATE TYPE "public"."note_scope" AS ENUM('cre', 'bd', 'admin');--> statement-breakpoint
CREATE TYPE "public"."ownership_reason" AS ENUM('intake', 'claim', 'admin_assign', 'transfer', 'handoff', 'reassign', 'release');--> statement-breakpoint
CREATE TYPE "public"."payment_kind" AS ENUM('advance', 'installment', 'final');--> statement-breakpoint
CREATE TYPE "public"."payment_mode" AS ENUM('NEFT', 'RTGS', 'UPI', 'Cheque', 'Cash');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('meta', 'google', 'justdial', 'indiamart', 'sulekha', 'website', 'walkin');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('admin', 'cre', 'bde');--> statement-breakpoint
CREATE TYPE "public"."stage_kind" AS ENUM('pool', 'working', 'handoff', 'won', 'lost');--> statement-breakpoint
CREATE TYPE "public"."tag_scope" AS ENUM('cre', 'bd', 'admin', 'cre_lost', 'bd_lost');--> statement-breakpoint
CREATE TYPE "public"."template_audience" AS ENUM('client', 'cre');--> statement-breakpoint
CREATE TYPE "public"."tone" AS ENUM('neutral', 'green', 'amber', 'red', 'blue', 'violet');--> statement-breakpoint
CREATE TYPE "public"."visit_status" AS ENUM('booked', 'done', 'cancelled');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "activities" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" uuid NOT NULL,
	"actor_id" uuid,
	"desk" "desk",
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"meta" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "admin_lead_tags" (
	"admin_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"tag_id" integer NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_lead_tags_admin_id_lead_id_tag_id_pk" PRIMARY KEY("admin_id","lead_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "admin_rankings" (
	"admin_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"rank" text NOT NULL,
	CONSTRAINT "admin_rankings_admin_id_lead_id_pk" PRIMARY KEY("admin_id","lead_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "admin_watches" (
	"admin_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_watches_admin_id_lead_id_pk" PRIMARY KEY("admin_id","lead_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" uuid NOT NULL,
	"kind" "attachment_kind" NOT NULL,
	"bucket" text NOT NULL,
	"path" text NOT NULL,
	"file_name" text NOT NULL,
	"mime" text,
	"size_bytes" integer,
	"uploaded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cad_revisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" uuid NOT NULL,
	"rev" integer NOT NULL,
	"attachment_id" integer NOT NULL,
	"note" text,
	"by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "discount_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" uuid NOT NULL,
	"quotation_id" integer,
	"percent" numeric(5, 2) NOT NULL,
	"proposed_amount" bigint,
	"reason" text,
	"status" "discount_status" DEFAULT 'pending' NOT NULL,
	"requested_by_id" uuid NOT NULL,
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"password_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"full_name" text NOT NULL,
	"role" "role" NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"territory" text,
	"avatar_path" text,
	"active" boolean DEFAULT true NOT NULL,
	"prefs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "followups" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"note" text,
	"status" "followup_status" DEFAULT 'open' NOT NULL,
	"reminded_at" timestamp with time zone,
	"repeated_at" timestamp with time zone,
	"escalated_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inbound_leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"platform" "platform" NOT NULL,
	"external_id" text,
	"payload" jsonb NOT NULL,
	"status" "inbound_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"lead_id" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lead_owners" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" uuid NOT NULL,
	"owner_id" uuid,
	"desk" "desk" NOT NULL,
	"reason" "ownership_reason" NOT NULL,
	"note" text,
	"by_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lead_sources" (
	"platform" "platform" PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"secrets_enc" text,
	"secret_hint" text,
	"inbound_token" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"connected_at" timestamp with time zone,
	"last_received_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lead_tags" (
	"lead_id" uuid NOT NULL,
	"tag_id" integer NOT NULL,
	"added_by_id" uuid,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_tags_lead_id_tag_id_pk" PRIMARY KEY("lead_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" serial NOT NULL,
	"customer_name" text NOT NULL,
	"contact_name" text,
	"phone" text,
	"alt_phone" text,
	"email" text,
	"place" text,
	"requirement" text,
	"category_id" integer,
	"platform" "platform" NOT NULL,
	"source_label" text,
	"external_ref" text,
	"desk" "desk" DEFAULT 'cre' NOT NULL,
	"cre_stage_id" integer NOT NULL,
	"bd_stage_id" integer,
	"stage_tag_id" integer,
	"owner_id" uuid,
	"owner_since" timestamp with time zone,
	"qualified_by_id" uuid,
	"qualified_at" timestamp with time zone,
	"estimate" bigint,
	"contract_value" bigint,
	"production_date" date,
	"won_at" timestamp with time zone,
	"lost_at" timestamp with time zone,
	"lost_desk" "desk",
	"lost_reason_id" integer,
	"lost_note" text,
	"lost_by_id" uuid,
	"next_followup_at" timestamp with time zone,
	"last_contact_at" timestamp with time zone,
	"duplicate_of_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leads_number_unique" UNIQUE("number"),
	CONSTRAINT "leads_bd_has_stage" CHECK ("leads"."desk" = 'cre' or "leads"."bd_stage_id" is not null)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "message_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"audience" "template_audience" NOT NULL,
	"desk" "desk" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"owner_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"scope" "note_scope" NOT NULL,
	"text" text NOT NULL,
	"color" text DEFAULT '#fdf3e2' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipient_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"lead_id" uuid,
	"title" text NOT NULL,
	"body" text,
	"via_watch" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"emailed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" uuid NOT NULL,
	"kind" "payment_kind" NOT NULL,
	"amount" bigint NOT NULL,
	"received_on" date NOT NULL,
	"mode" "payment_mode" NOT NULL,
	"reference" text,
	"recorded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_amount_pos" CHECK ("payments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quotations" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"amount" bigint NOT NULL,
	"attachment_id" integer,
	"note" text,
	"by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotation_amount_pos" CHECK ("quotations"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"employee_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"user_agent" text,
	"ip" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "site_visits" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"engineer_id" uuid,
	"engineer_name" text,
	"note" text,
	"status" "visit_status" DEFAULT 'booked' NOT NULL,
	"done_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stage_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" uuid NOT NULL,
	"desk" "desk" NOT NULL,
	"from_stage_id" integer,
	"to_stage_id" integer NOT NULL,
	"by_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stages" (
	"id" serial PRIMARY KEY NOT NULL,
	"desk" "desk" NOT NULL,
	"kind" "stage_kind" DEFAULT 'working' NOT NULL,
	"name" text NOT NULL,
	"definition" text DEFAULT '' NOT NULL,
	"position" integer NOT NULL,
	"requires_followup" boolean DEFAULT false NOT NULL,
	"requires_stage_tag" boolean DEFAULT false NOT NULL,
	"shows_value" boolean DEFAULT false NOT NULL,
	"requires_quotation" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stages_kind_matches_desk" CHECK (("stages"."desk" = 'cre' and "stages"."kind" in ('pool','working','handoff','lost'))
       or ("stages"."desk" = 'bd' and "stages"."kind" in ('working','won','lost')))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"scope" "tag_scope" NOT NULL,
	"name" text NOT NULL,
	"tone" "tone" DEFAULT 'neutral' NOT NULL,
	"stage_id" integer,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activities" ADD CONSTRAINT "activities_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activities" ADD CONSTRAINT "activities_actor_id_employees_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "admin_lead_tags" ADD CONSTRAINT "admin_lead_tags_admin_id_employees_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "admin_lead_tags" ADD CONSTRAINT "admin_lead_tags_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "admin_lead_tags" ADD CONSTRAINT "admin_lead_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "admin_rankings" ADD CONSTRAINT "admin_rankings_admin_id_employees_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "admin_rankings" ADD CONSTRAINT "admin_rankings_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "admin_watches" ADD CONSTRAINT "admin_watches_admin_id_employees_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "admin_watches" ADD CONSTRAINT "admin_watches_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_employees_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "attachments" ADD CONSTRAINT "attachments_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_id_employees_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cad_revisions" ADD CONSTRAINT "cad_revisions_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cad_revisions" ADD CONSTRAINT "cad_revisions_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cad_revisions" ADD CONSTRAINT "cad_revisions_by_id_employees_id_fk" FOREIGN KEY ("by_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "discount_requests" ADD CONSTRAINT "discount_requests_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "discount_requests" ADD CONSTRAINT "discount_requests_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "discount_requests" ADD CONSTRAINT "discount_requests_requested_by_id_employees_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "discount_requests" ADD CONSTRAINT "discount_requests_decided_by_id_employees_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "followups" ADD CONSTRAINT "followups_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "followups" ADD CONSTRAINT "followups_owner_id_employees_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "followups" ADD CONSTRAINT "followups_created_by_id_employees_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inbound_leads" ADD CONSTRAINT "inbound_leads_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead_owners" ADD CONSTRAINT "lead_owners_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead_owners" ADD CONSTRAINT "lead_owners_owner_id_employees_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead_owners" ADD CONSTRAINT "lead_owners_by_id_employees_id_fk" FOREIGN KEY ("by_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead_tags" ADD CONSTRAINT "lead_tags_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead_tags" ADD CONSTRAINT "lead_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead_tags" ADD CONSTRAINT "lead_tags_added_by_id_employees_id_fk" FOREIGN KEY ("added_by_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "leads" ADD CONSTRAINT "leads_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "leads" ADD CONSTRAINT "leads_cre_stage_id_stages_id_fk" FOREIGN KEY ("cre_stage_id") REFERENCES "public"."stages"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "leads" ADD CONSTRAINT "leads_bd_stage_id_stages_id_fk" FOREIGN KEY ("bd_stage_id") REFERENCES "public"."stages"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "leads" ADD CONSTRAINT "leads_stage_tag_id_tags_id_fk" FOREIGN KEY ("stage_tag_id") REFERENCES "public"."tags"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_id_employees_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "leads" ADD CONSTRAINT "leads_qualified_by_id_employees_id_fk" FOREIGN KEY ("qualified_by_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "leads" ADD CONSTRAINT "leads_lost_reason_id_tags_id_fk" FOREIGN KEY ("lost_reason_id") REFERENCES "public"."tags"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "leads" ADD CONSTRAINT "leads_lost_by_id_employees_id_fk" FOREIGN KEY ("lost_by_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "leads" ADD CONSTRAINT "leads_created_by_id_employees_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_owner_id_employees_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notes" ADD CONSTRAINT "notes_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notes" ADD CONSTRAINT "notes_author_id_employees_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_employees_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payments" ADD CONSTRAINT "payments_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_id_employees_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quotations" ADD CONSTRAINT "quotations_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quotations" ADD CONSTRAINT "quotations_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quotations" ADD CONSTRAINT "quotations_by_id_employees_id_fk" FOREIGN KEY ("by_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_engineer_id_employees_id_fk" FOREIGN KEY ("engineer_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_created_by_id_employees_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stage_history" ADD CONSTRAINT "stage_history_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stage_history" ADD CONSTRAINT "stage_history_from_stage_id_stages_id_fk" FOREIGN KEY ("from_stage_id") REFERENCES "public"."stages"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stage_history" ADD CONSTRAINT "stage_history_to_stage_id_stages_id_fk" FOREIGN KEY ("to_stage_id") REFERENCES "public"."stages"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stage_history" ADD CONSTRAINT "stage_history_by_id_employees_id_fk" FOREIGN KEY ("by_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tags" ADD CONSTRAINT "tags_stage_id_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."stages"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activities_lead_idx" ON "activities" USING btree ("lead_id","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_rank_order_idx" ON "admin_rankings" USING btree ("admin_id","rank");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attachments_lead_idx" ON "attachments" USING btree ("lead_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cad_rev_uq" ON "cad_revisions" USING btree ("lead_id","rev");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "discount_status_idx" ON "discount_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "employees_username_uq" ON "employees" USING btree ("username");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employees_role_idx" ON "employees" USING btree ("role");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "followups_due_idx" ON "followups" USING btree ("status","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "followups_one_open_uq" ON "followups" USING btree ("lead_id") WHERE "followups"."status" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inbound_platform_ext_uq" ON "inbound_leads" USING btree ("platform","external_id") WHERE "inbound_leads"."external_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbound_status_idx" ON "inbound_leads" USING btree ("status","received_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_owners_lead_idx" ON "lead_owners" USING btree ("lead_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lead_owners_one_open_uq" ON "lead_owners" USING btree ("lead_id") WHERE "lead_owners"."ended_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_owner_idx" ON "leads" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_desk_cre_stage_idx" ON "leads" USING btree ("desk","cre_stage_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_desk_bd_stage_idx" ON "leads" USING btree ("desk","bd_stage_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_phone_idx" ON "leads" USING btree ("phone");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_created_idx" ON "leads" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_followup_idx" ON "leads" USING btree ("next_followup_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notes_lead_idx" ON "notes" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notes_author_idx" ON "notes" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_recipient_idx" ON "notifications" USING btree ("recipient_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_lead_idx" ON "payments" USING btree ("lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "quotation_version_uq" ON "quotations" USING btree ("lead_id","version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_employee_idx" ON "sessions" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_visits_when_idx" ON "site_visits" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_visits_lead_idx" ON "site_visits" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stage_history_lead_idx" ON "stage_history" USING btree ("lead_id","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stage_history_to_idx" ON "stage_history" USING btree ("to_stage_id","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stages_desk_pos_idx" ON "stages" USING btree ("desk","position");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stages_system_kind_uq" ON "stages" USING btree ("desk","kind") WHERE "stages"."kind" <> 'working' and "stages"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tags_scope_name_uq" ON "tags" USING btree ("scope",lower("name")) WHERE "tags"."archived_at" is null;