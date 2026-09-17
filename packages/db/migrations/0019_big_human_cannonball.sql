CREATE TYPE "public"."shop_order_status" AS ENUM('reserved', 'delivered', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."ledger_entry_kind" ADD VALUE 'purchase';--> statement-breakpoint
ALTER TYPE "public"."ledger_reference_type" ADD VALUE 'shop_order';--> statement-breakpoint
CREATE TABLE "shop_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price" bigint NOT NULL,
	"stock" integer,
	"published" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_items_name_not_blank" CHECK (length(btrim("shop_items"."name")) > 0),
	CONSTRAINT "shop_items_price_positive" CHECK ("shop_items"."price" > 0),
	CONSTRAINT "shop_items_stock_not_negative" CHECK ("shop_items"."stock" is null or "shop_items"."stock" >= 0)
);
--> statement-breakpoint
CREATE TABLE "shop_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"item_name" text NOT NULL,
	"price" bigint NOT NULL,
	"status" "shop_order_status" DEFAULT 'reserved' NOT NULL,
	"ledger_entry_id" uuid,
	"handled_by" uuid,
	"handled_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_orders_price_positive" CHECK ("shop_orders"."price" > 0),
	CONSTRAINT "shop_orders_ledger_entry_consistent" CHECK (("shop_orders"."ledger_entry_id" is not null) = ("shop_orders"."status" = 'delivered')),
	CONSTRAINT "shop_orders_handled_consistent" CHECK (("shop_orders"."handled_by" is null) = ("shop_orders"."handled_at" is null)),
	CONSTRAINT "shop_orders_handled_when_not_reserved" CHECK (("shop_orders"."status" = 'reserved') = ("shop_orders"."handled_at" is null)),
	CONSTRAINT "shop_orders_cancel_note_required" CHECK ("shop_orders"."status" <> 'cancelled' or ("shop_orders"."note" is not null and length(btrim("shop_orders"."note")) > 0))
);
--> statement-breakpoint
ALTER TABLE "shop_items" ADD CONSTRAINT "shop_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_item_id_shop_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."shop_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_ledger_entry_id_ledger_entries_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shop_items_published_idx" ON "shop_items" USING btree ("published","created_at");--> statement-breakpoint
CREATE INDEX "shop_orders_status_idx" ON "shop_orders" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "shop_orders_user_idx" ON "shop_orders" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_orders_ledger_entry_unique" ON "shop_orders" USING btree ("ledger_entry_id") WHERE "shop_orders"."ledger_entry_id" is not null;