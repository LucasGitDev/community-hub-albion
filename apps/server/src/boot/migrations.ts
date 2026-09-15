import { runMigrations } from "@albion-hub/db";

/** Mensagem de falha sem vazar credenciais da DATABASE_URL. */
export function describeMigrationFailure(error: unknown): string {
  // Drizzle embrulha o erro do driver ("Failed query: ..."); a causa real (ex: senha errada) vem em `cause`.
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : undefined;
  const base = error instanceof Error ? error.message.split("\n")[0] : String(error);
  const reason = cause ? `${cause} (${base})` : base;
  return `Falha ao aplicar migrations do banco: ${reason.replace(/postgres(ql)?:\/\/[^@\s]+@/g, "postgres://***@")}`;
}

/** Aplica migrations pendentes; em falha encerra com mensagem clara (TASK-005). */
export async function applyMigrationsOrExit(databaseUrl: string, run = runMigrations): Promise<void> {
  try {
    await run(databaseUrl);
  } catch (error) {
    console.error(describeMigrationFailure(error));
    process.exit(1);
  }
}
