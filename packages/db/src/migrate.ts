import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./client.js";

/** Pasta de migrations do pacote; mesma posição relativa a partir de src/ e dist/. */
export const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

/** Aplica migrations pendentes. Idempotente: reexecução não altera nada. */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const { db, close } = createDb(databaseUrl, { max: 1 });
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await close();
  }
}
