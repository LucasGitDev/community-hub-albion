ALTER TYPE "public"."shop_order_status" ADD VALUE 'claimed' BEFORE 'delivered';--> statement-breakpoint
ALTER TYPE "public"."shop_order_status" ADD VALUE 'rejected';--> statement-breakpoint
ALTER TABLE "shop_orders" DROP CONSTRAINT "shop_orders_cancel_note_required";--> statement-breakpoint
ALTER TABLE "shop_orders" ADD COLUMN "reversal_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_reversal_entry_id_ledger_entries_id_fk" FOREIGN KEY ("reversal_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shop_orders_reversal_entry_unique" ON "shop_orders" USING btree ("reversal_entry_id") WHERE "shop_orders"."reversal_entry_id" is not null;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_end_note_required" CHECK ("shop_orders"."status"::text not in ('delivered', 'cancelled', 'rejected') or ("shop_orders"."note" is not null and length(btrim("shop_orders"."note")) > 0));--> statement-breakpoint
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_reversal_needs_ledger_entry" CHECK ("shop_orders"."reversal_entry_id" is null or "shop_orders"."ledger_entry_id" is not null);