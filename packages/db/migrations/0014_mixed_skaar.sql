CREATE TYPE "public"."event_fee_type" AS ENUM('percent', 'fixed');--> statement-breakpoint
CREATE TYPE "public"."loot_split_status" AS ENUM('draft', 'confirmed');--> statement-breakpoint
CREATE TABLE "loot_split_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"split_id" uuid NOT NULL,
	"discord_user_id" text NOT NULL,
	"user_id" uuid,
	"signed_up" boolean NOT NULL,
	"role_name" text,
	"presence_ms" bigint NOT NULL,
	"share_bp" integer NOT NULL,
	"amount_silver" bigint NOT NULL,
	CONSTRAINT "loot_split_lines_presence_not_negative" CHECK ("loot_split_lines"."presence_ms" >= 0),
	CONSTRAINT "loot_split_lines_share_range" CHECK ("loot_split_lines"."share_bp" between 0 and 10000),
	CONSTRAINT "loot_split_lines_amount_not_negative" CHECK ("loot_split_lines"."amount_silver" >= 0),
	CONSTRAINT "loot_split_lines_not_signed_up_has_no_share" CHECK ("loot_split_lines"."signed_up" or ("loot_split_lines"."share_bp" = 0 and "loot_split_lines"."amount_silver" = 0))
);
--> statement-breakpoint
CREATE TABLE "loot_splits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"status" "loot_split_status" DEFAULT 'draft' NOT NULL,
	"total_silver" bigint NOT NULL,
	"fee_type" "event_fee_type" NOT NULL,
	"fee_value" bigint NOT NULL,
	"residual_silver" bigint DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loot_splits_total_not_negative" CHECK ("loot_splits"."total_silver" >= 0),
	CONSTRAINT "loot_splits_fee_not_negative" CHECK ("loot_splits"."fee_value" >= 0),
	CONSTRAINT "loot_splits_residual_not_negative" CHECK ("loot_splits"."residual_silver" >= 0)
);
--> statement-breakpoint
ALTER TABLE "event_templates" ADD COLUMN "default_fee_type" "event_fee_type" DEFAULT 'percent' NOT NULL;--> statement-breakpoint
ALTER TABLE "event_templates" ADD COLUMN "default_fee_value" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "presence_channel_id" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "fee_type" "event_fee_type" DEFAULT 'percent' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "fee_value" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "loot_split_lines" ADD CONSTRAINT "loot_split_lines_split_id_loot_splits_id_fk" FOREIGN KEY ("split_id") REFERENCES "public"."loot_splits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loot_split_lines" ADD CONSTRAINT "loot_split_lines_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loot_splits" ADD CONSTRAINT "loot_splits_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loot_splits" ADD CONSTRAINT "loot_splits_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "loot_split_lines_split_user_idx" ON "loot_split_lines" USING btree ("split_id","discord_user_id");--> statement-breakpoint
CREATE INDEX "loot_split_lines_user_idx" ON "loot_split_lines" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "loot_splits_event_idx" ON "loot_splits" USING btree ("event_id","created_at");--> statement-breakpoint
ALTER TABLE "event_templates" ADD CONSTRAINT "event_templates_default_fee_not_negative" CHECK ("event_templates"."default_fee_value" >= 0);--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_fee_not_negative" CHECK ("events"."fee_value" >= 0);--> statement-breakpoint
-- Evento que ainda tem canal vivo passa a ter também o carimbo de presença (TASK-027): sem isto, um
-- evento iniciado antes desta migration perderia a janela de presença quando o finish apagasse o canal.
UPDATE "events" SET "presence_channel_id" = "voice_channel_id" WHERE "voice_channel_id" IS NOT NULL;
