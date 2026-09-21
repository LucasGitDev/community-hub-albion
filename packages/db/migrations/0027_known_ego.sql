CREATE TABLE "event_presence_overrides" (
	"event_id" uuid NOT NULL,
	"discord_user_id" text NOT NULL,
	"presence_bp" integer NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_presence_overrides_event_id_discord_user_id_pk" PRIMARY KEY("event_id","discord_user_id"),
	CONSTRAINT "event_presence_overrides_range" CHECK ("event_presence_overrides"."presence_bp" between 0 and 10000)
);
--> statement-breakpoint
ALTER TABLE "loot_split_lines" DROP CONSTRAINT "loot_split_lines_not_signed_up_has_no_share";--> statement-breakpoint
ALTER TABLE "loot_split_lines" ADD COLUMN "presence_bp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
--
-- Backfill (TASK-084): antes da TASK-084 o caller digitava a participação direto, então a presença de
-- uma leva antiga É a participação dela. Sem isto, o CHECK "share_needs_presence" abaixo recusaria
-- toda linha já existente com participação, e a migration não subiria.
--
-- O UPDATE mexe em linha de split confirmado, que a trigger append-only recusa; ela é desligada só
-- aqui dentro, na mesma transação da migration, e religada em seguida. Nenhum lançamento do ledger é
-- tocado: o que muda é uma coluna nova, que ainda não existia quando a prata foi creditada.
--
ALTER TABLE "loot_split_lines" DISABLE TRIGGER "loot_split_lines_no_update_confirmed";--> statement-breakpoint
UPDATE "loot_split_lines" SET "presence_bp" = "share_bp" WHERE "share_bp" > 0;--> statement-breakpoint
ALTER TABLE "loot_split_lines" ENABLE TRIGGER "loot_split_lines_no_update_confirmed";--> statement-breakpoint
ALTER TABLE "event_presence_overrides" ADD CONSTRAINT "event_presence_overrides_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_presence_overrides" ADD CONSTRAINT "event_presence_overrides_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loot_split_lines" ADD CONSTRAINT "loot_split_lines_presence_bp_range" CHECK ("loot_split_lines"."presence_bp" between 0 and 10000);--> statement-breakpoint
ALTER TABLE "loot_split_lines" ADD CONSTRAINT "loot_split_lines_share_needs_presence" CHECK ("loot_split_lines"."presence_bp" > 0 or ("loot_split_lines"."share_bp" = 0 and "loot_split_lines"."amount_silver" = 0));