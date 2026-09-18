ALTER TYPE "public"."ledger_entry_kind" ADD VALUE 'referral';--> statement-breakpoint
ALTER TYPE "public"."ledger_reference_type" ADD VALUE 'referral';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "referred_by" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "referred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "referral_rewarded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "referral_referrer_paid" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_referred_by_users_id_fk" FOREIGN KEY ("referred_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_referred_by_idx" ON "users" USING btree ("referred_by","referral_rewarded_at");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_referred_by_not_self" CHECK ("users"."referred_by" is distinct from "users"."id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_referral_declaration_consistent" CHECK (("users"."referred_by" is null) = ("users"."referred_at" is null));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_referral_reward_requires_referrer" CHECK ("users"."referral_rewarded_at" is null or "users"."referred_by" is not null);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_referral_referrer_paid_requires_reward" CHECK (not "users"."referral_referrer_paid" or "users"."referral_rewarded_at" is not null);--> statement-breakpoint
-- Write-once garantido pelo banco, não pelo serviço (pedido do usuário: "uma vez preenchido não
-- pode trocar"). Escrito à mão porque o drizzle-kit não gera trigger a partir do schema — se esta
-- migration for regerada, este bloco precisa voltar junto.
--
-- É BEFORE UPDATE OF por linha, e não um check: check não enxerga o valor anterior, então não
-- distingue "preencheu agora" de "trocou o que já estava lá". Declarar continua permitido; trocar,
-- não. Limpar (voltar para null) também é troca.
CREATE FUNCTION "users_referred_by_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF OLD."referred_by" IS NOT NULL AND NEW."referred_by" IS DISTINCT FROM OLD."referred_by" THEN
		RAISE EXCEPTION 'users.referred_by e write-once: indicacao ja declarada nao muda' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "users_referred_by_write_once" BEFORE UPDATE OF "referred_by" ON "users" FOR EACH ROW EXECUTE FUNCTION "users_referred_by_immutable"();
