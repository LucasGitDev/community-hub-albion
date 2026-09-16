CREATE TYPE "public"."withdrawal_status" AS ENUM('pending', 'approved', 'rejected', 'settled');--> statement-breakpoint
CREATE TABLE "withdrawals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"status" "withdrawal_status" DEFAULT 'pending' NOT NULL,
	"ledger_entry_id" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"settled_by" uuid,
	"settled_at" timestamp with time zone,
	"settlement_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "withdrawals_amount_positive" CHECK ("withdrawals"."amount" > 0),
	CONSTRAINT "withdrawals_ledger_entry_consistent" CHECK (("withdrawals"."ledger_entry_id" is not null) = ("withdrawals"."status" in ('approved', 'settled'))),
	CONSTRAINT "withdrawals_decision_consistent" CHECK (("withdrawals"."decided_by" is null) = ("withdrawals"."decided_at" is null)),
	CONSTRAINT "withdrawals_decided_when_not_pending" CHECK (("withdrawals"."status" = 'pending') = ("withdrawals"."decided_at" is null)),
	CONSTRAINT "withdrawals_rejection_note_required" CHECK ("withdrawals"."status" <> 'rejected' or ("withdrawals"."decision_note" is not null and length(btrim("withdrawals"."decision_note")) > 0)),
	CONSTRAINT "withdrawals_settlement_consistent" CHECK (("withdrawals"."status" = 'settled') = ("withdrawals"."settled_by" is not null and "withdrawals"."settled_at" is not null and "withdrawals"."settlement_note" is not null and length(btrim("withdrawals"."settlement_note")) > 0))
);
--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_ledger_entry_id_ledger_entries_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_settled_by_users_id_fk" FOREIGN KEY ("settled_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "withdrawals_status_idx" ON "withdrawals" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "withdrawals_user_idx" ON "withdrawals" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "withdrawals_ledger_entry_unique" ON "withdrawals" USING btree ("ledger_entry_id") WHERE "withdrawals"."ledger_entry_id" is not null;