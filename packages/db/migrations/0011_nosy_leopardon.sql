CREATE TYPE "public"."ledger_entry_kind" AS ENUM('split_payout', 'split_fee', 'withdrawal', 'reversal', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."ledger_reference_type" AS ENUM('event', 'loot_split', 'withdrawal', 'manual');--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"kind" "ledger_entry_kind" NOT NULL,
	"reference_type" "ledger_reference_type",
	"reference_id" text,
	"reversal_of" uuid,
	"created_by" uuid,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_amount_not_zero" CHECK ("ledger_entries"."amount" <> 0),
	CONSTRAINT "ledger_entries_reversal_consistent" CHECK (("ledger_entries"."reversal_of" is not null) = ("ledger_entries"."kind" = 'reversal')),
	CONSTRAINT "ledger_entries_reference_consistent" CHECK (("ledger_entries"."reference_type" is null) = ("ledger_entries"."reference_id" is null))
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_reversal_of_ledger_entries_id_fk" FOREIGN KEY ("reversal_of") REFERENCES "public"."ledger_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_reversal_of_unique" ON "ledger_entries" USING btree ("reversal_of") WHERE "ledger_entries"."reversal_of" is not null;--> statement-breakpoint
CREATE INDEX "ledger_entries_user_idx" ON "ledger_entries" USING btree ("user_id","created_at","id");--> statement-breakpoint
CREATE INDEX "ledger_entries_reference_idx" ON "ledger_entries" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE FUNCTION "ledger_entries_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'ledger_entries e append-only: % proibido, use estorno', TG_OP USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "ledger_entries_no_update" BEFORE UPDATE ON "ledger_entries" FOR EACH STATEMENT EXECUTE FUNCTION "ledger_entries_append_only"();--> statement-breakpoint
CREATE TRIGGER "ledger_entries_no_delete" BEFORE DELETE ON "ledger_entries" FOR EACH STATEMENT EXECUTE FUNCTION "ledger_entries_append_only"();--> statement-breakpoint
CREATE TRIGGER "ledger_entries_no_truncate" BEFORE TRUNCATE ON "ledger_entries" FOR EACH STATEMENT EXECUTE FUNCTION "ledger_entries_append_only"();
