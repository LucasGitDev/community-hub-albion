CREATE TYPE "public"."event_status" AS ENUM('draft', 'open', 'closed', 'running', 'finished', 'cancelled');--> statement-breakpoint
CREATE TABLE "event_owner_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"from_user_id" uuid,
	"to_user_id" uuid NOT NULL,
	"changed_by" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_role_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"role_id" uuid,
	"name" text NOT NULL,
	"slots" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "event_role_slots_slots_positive" CHECK ("event_role_slots"."slots" > 0)
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" "event_status" DEFAULT 'draft' NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"created_by" uuid,
	"starts_at" timestamp with time zone,
	"signups_close_at" timestamp with time zone,
	"voice_channel_id" text,
	"opened_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_name_not_blank" CHECK (length(trim("events"."name")) > 0),
	CONSTRAINT "events_started_consistent" CHECK (("events"."status" in ('running', 'finished')) <= ("events"."started_at" is not null)),
	CONSTRAINT "events_finished_consistent" CHECK (("events"."status" = 'finished') = ("events"."finished_at" is not null)),
	CONSTRAINT "events_cancelled_consistent" CHECK (("events"."status" = 'cancelled') = ("events"."cancelled_at" is not null)),
	CONSTRAINT "events_signups_close_before_start" CHECK ("events"."signups_close_at" is null or "events"."starts_at" is null or "events"."signups_close_at" <= "events"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "event_owner_history" ADD CONSTRAINT "event_owner_history_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_owner_history" ADD CONSTRAINT "event_owner_history_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_owner_history" ADD CONSTRAINT "event_owner_history_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_owner_history" ADD CONSTRAINT "event_owner_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_role_slots" ADD CONSTRAINT "event_role_slots_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_role_slots" ADD CONSTRAINT "event_role_slots_role_id_event_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."event_roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_template_id_event_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."event_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_owner_history_event_idx" ON "event_owner_history" USING btree ("event_id","changed_at");--> statement-breakpoint
CREATE INDEX "event_role_slots_event_idx" ON "event_role_slots" USING btree ("event_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "event_role_slots_event_name_idx" ON "event_role_slots" USING btree ("event_id","name");--> statement-breakpoint
CREATE INDEX "events_status_starts_idx" ON "events" USING btree ("status","starts_at");--> statement-breakpoint
CREATE INDEX "events_owner_idx" ON "events" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "events_template_idx" ON "events" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "events_signups_close_idx" ON "events" USING btree ("signups_close_at") WHERE "events"."status" = 'open';