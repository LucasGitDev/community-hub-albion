CREATE TYPE "public"."ledger_currency" AS ENUM('silver', 'buffunfa');--> statement-breakpoint
DROP INDEX "ledger_entries_user_idx";--> statement-breakpoint
-- Buffunfa entra na mesma tabela (F6-1). A coluna **nasce com default** porque as triggers
-- append-only de 0011_nosy_leopardon.sql:25-33 recusam UPDATE: backfill é impossível, e um
-- `ADD COLUMN ... NOT NULL DEFAULT` é DDL, preenchido pelo Postgres sem uma linha de DML (F6-2).
ALTER TABLE "ledger_entries" ADD COLUMN "currency" "ledger_currency" DEFAULT 'silver' NOT NULL;--> statement-breakpoint
-- E o default cai aqui, na **mesma** migration: sem isso, um insert que esquecesse a moeda viraria
-- prata em silêncio. A partir daqui todo lançamento diz de que moeda é (F6-2).
ALTER TABLE "ledger_entries" ALTER COLUMN "currency" DROP DEFAULT;--> statement-breakpoint
CREATE INDEX "ledger_entries_user_currency_idx" ON "ledger_entries" USING btree ("user_id","currency","created_at","id");
