ALTER TYPE "public"."event_status" ADD VALUE 'archived';--> statement-breakpoint
ALTER TABLE "events" DROP CONSTRAINT "events_started_consistent";--> statement-breakpoint
ALTER TABLE "events" DROP CONSTRAINT "events_finished_consistent";--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_archived_consistent" CHECK ((("events"."status")::text = 'archived') = ("events"."archived_at" is not null));--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_started_consistent" CHECK ((("events"."status")::text in ('running', 'finished', 'archived')) <= ("events"."started_at" is not null));--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_finished_consistent" CHECK (("events"."finished_at" is not null) = (("events"."status")::text in ('finished', 'archived')));