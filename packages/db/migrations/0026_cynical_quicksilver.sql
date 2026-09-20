ALTER TABLE "withdrawals" ADD COLUMN "opened_by" uuid;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD COLUMN "request_note" text;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_opened_by_note_required" CHECK ("withdrawals"."opened_by" is null or ("withdrawals"."request_note" is not null and length(btrim("withdrawals"."request_note")) > 0));