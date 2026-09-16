CREATE TYPE "public"."event_signup_status" AS ENUM('confirmed', 'waitlist', 'cancelled');--> statement-breakpoint
CREATE TABLE "event_signups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"slot_id" uuid NOT NULL,
	"role_name" text NOT NULL,
	"status" "event_signup_status" NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"decided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_signups_position_positive" CHECK ("event_signups"."position" >= 0),
	CONSTRAINT "event_signups_waitlist_position" CHECK (("event_signups"."status" = 'waitlist') = ("event_signups"."position" > 0))
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "discord_message_id" text;--> statement-breakpoint
ALTER TABLE "event_signups" ADD CONSTRAINT "event_signups_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_signups" ADD CONSTRAINT "event_signups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_signups" ADD CONSTRAINT "event_signups_slot_id_event_role_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."event_role_slots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_signups" ADD CONSTRAINT "event_signups_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_signups_active_idx" ON "event_signups" USING btree ("event_id","user_id") WHERE "event_signups"."status" in ('confirmed', 'waitlist');--> statement-breakpoint
CREATE INDEX "event_signups_event_idx" ON "event_signups" USING btree ("event_id","status");--> statement-breakpoint
CREATE INDEX "event_signups_slot_idx" ON "event_signups" USING btree ("slot_id","status","position");--> statement-breakpoint
CREATE INDEX "event_signups_user_idx" ON "event_signups" USING btree ("user_id");