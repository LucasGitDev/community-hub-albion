-- Taxa de entrada em Buffunfa (TASK-058, F6-12 a F6-16): o primeiro sink da moeda.
-- `entry_fee` é o lançamento da cobrança; a devolução é o estorno dele, nunca um UPDATE.
ALTER TYPE "public"."ledger_entry_kind" ADD VALUE 'entry_fee';--> statement-breakpoint
-- Aponta para o lançamento que esta inscrição pagou. É por ele que a devolução sabe o que estornar:
-- quem entra, sai e volta gera mais de uma cobrança no mesmo evento (F6-13/F6-14).
ALTER TABLE "event_signups" ADD COLUMN "fee_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "event_templates" ADD COLUMN "default_entry_fee" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "entry_fee" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "event_signups" ADD CONSTRAINT "event_signups_fee_entry_id_ledger_entries_id_fk" FOREIGN KEY ("fee_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_templates" ADD CONSTRAINT "event_templates_default_entry_fee_not_negative" CHECK ("event_templates"."default_entry_fee" >= 0);--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_entry_fee_not_negative" CHECK ("events"."entry_fee" >= 0);