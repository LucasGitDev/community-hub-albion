ALTER TYPE "public"."ledger_entry_kind" ADD VALUE 'event_attendance';--> statement-breakpoint
ALTER TABLE "event_role_slots" ADD COLUMN "buffunfa_min" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "event_role_slots" ADD COLUMN "buffunfa_max" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "event_role_slots" ADD COLUMN "buffunfa_value" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "event_template_roles" ADD COLUMN "buffunfa_min" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "event_template_roles" ADD COLUMN "buffunfa_max" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "buffunfa_paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_role_slots" ADD CONSTRAINT "event_role_slots_buffunfa_range" CHECK ("event_role_slots"."buffunfa_min" >= 0 and "event_role_slots"."buffunfa_max" >= "event_role_slots"."buffunfa_min" and "event_role_slots"."buffunfa_value" between "event_role_slots"."buffunfa_min" and "event_role_slots"."buffunfa_max");--> statement-breakpoint
ALTER TABLE "event_template_roles" ADD CONSTRAINT "event_template_roles_buffunfa_range" CHECK ("event_template_roles"."buffunfa_min" >= 0 and "event_template_roles"."buffunfa_max" >= "event_template_roles"."buffunfa_min");