import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Database = PostgresJsDatabase<typeof schema>;

export interface DbHandle {
  db: Database;
  close: () => Promise<void>;
}

export interface CreateDbOptions {
  /** Tamanho máximo do pool (default 10). */
  max?: number;
}

export function createDb(databaseUrl: string, options: CreateDbOptions = {}): DbHandle {
  if (!databaseUrl) throw new Error("DATABASE_URL não definido");
  const client = postgres(databaseUrl, {
    max: options.max ?? 10,
    onnotice: () => {},
    // int8 volta como bigint nativo: dinheiro é inteiro (Q20), sem perda de precisão.
    types: { bigint: postgres.BigInt },
  });
  return { db: drizzle(client, { schema }), close: () => client.end({ timeout: 5 }) };
}

/** Health check: true se o banco responde a `select 1`. */
export async function ping(db: Database): Promise<boolean> {
  try {
    const rows = await db.execute<{ ok: number }>(sql`select 1 as ok`);
    return rows[0]?.ok === 1;
  } catch {
    return false;
  }
}
