CREATE TABLE IF NOT EXISTS "reminder_log" (
	"key" text PRIMARY KEY NOT NULL,
	"lead_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reminder_log" ADD CONSTRAINT "reminder_log_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reminder_log_lead_idx" ON "reminder_log" USING btree ("lead_id");