import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Metadados da aplicação (chave/valor). Tabela mínima para provar o pipeline de migrations.
 * Tabelas de domínio (usuários, ledger) entram nas tasks próprias.
 * Regra: valores monetários usam `bigint("...", { mode: "bigint" })` (Q20), nunca number/float.
 */
export const appMeta = pgTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
