ALTER TABLE "loot_splits" ADD COLUMN "fee_silver" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "loot_splits" ADD COLUMN "confirmed_by" uuid;--> statement-breakpoint
ALTER TABLE "loot_splits" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "loot_splits" ADD CONSTRAINT "loot_splits_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loot_splits" ADD CONSTRAINT "loot_splits_fee_silver_not_negative" CHECK ("loot_splits"."fee_silver" >= 0);--> statement-breakpoint
ALTER TABLE "loot_splits" ADD CONSTRAINT "loot_splits_confirmed_consistent" CHECK (("loot_splits"."status" = 'confirmed') = ("loot_splits"."confirmed_at" is not null));--> statement-breakpoint
CREATE FUNCTION "loot_splits_confirmed_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'loot split confirmado e imutavel: % proibido, corrija por estorno no ledger', TG_OP USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "loot_splits_no_update_confirmed" BEFORE UPDATE ON "loot_splits" FOR EACH ROW WHEN (OLD."status" = 'confirmed') EXECUTE FUNCTION "loot_splits_confirmed_immutable"();--> statement-breakpoint
CREATE TRIGGER "loot_splits_no_delete_confirmed" BEFORE DELETE ON "loot_splits" FOR EACH ROW WHEN (OLD."status" = 'confirmed') EXECUTE FUNCTION "loot_splits_confirmed_immutable"();--> statement-breakpoint
CREATE FUNCTION "loot_split_lines_confirmed_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	parent_status "loot_split_status";
BEGIN
	SELECT "status" INTO parent_status FROM "loot_splits" WHERE "id" = OLD."split_id";
	IF parent_status = 'confirmed' THEN
		RAISE EXCEPTION 'linha de loot split confirmado e imutavel: % proibido, corrija por estorno no ledger', TG_OP USING ERRCODE = '23514';
	END IF;
	IF TG_OP = 'DELETE' THEN
		RETURN OLD;
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "loot_split_lines_no_update_confirmed" BEFORE UPDATE ON "loot_split_lines" FOR EACH ROW EXECUTE FUNCTION "loot_split_lines_confirmed_immutable"();--> statement-breakpoint
CREATE TRIGGER "loot_split_lines_no_delete_confirmed" BEFORE DELETE ON "loot_split_lines" FOR EACH ROW EXECUTE FUNCTION "loot_split_lines_confirmed_immutable"();
