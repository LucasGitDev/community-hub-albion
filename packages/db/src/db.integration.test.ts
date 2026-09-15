import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, ping, runMigrations, schema, type DbHandle } from "./index.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

if (!url) {
  // No CI a ausência do banco é erro: não pode virar skip silencioso.
  if (process.env.CI) throw new Error("CI sem TEST_DATABASE_URL/DATABASE_URL: testes de integração do db não podem ser pulados");
  console.warn("[db] TEST_DATABASE_URL/DATABASE_URL ausente: testes de integração pulados (suba docker-compose.dev.yml)");
}

describe.skipIf(!url)("@albion-hub/db (Postgres real)", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    const reset = createDb(url!, { max: 1 });
    // Banco vazio: prova que as migrations aplicam do zero.
    await reset.db.execute(sql`drop schema if exists drizzle cascade`);
    await reset.db.execute(sql`drop table if exists app_meta`);
    await reset.close();
    handle = createDb(url!);
  });

  afterAll(async () => {
    await handle?.close();
  });

  it("aplica migrations do zero e reexecução é idempotente", async () => {
    await runMigrations(url!);
    const count = async () => (await handle.db.execute<{ n: bigint }>(sql`select count(*) as n from drizzle.__drizzle_migrations`))[0]!.n;
    const first = await count();
    expect(first).toBeGreaterThan(0n);

    await runMigrations(url!);
    expect(await count()).toBe(first);
  });

  it("conecta e executa consultas", async () => {
    expect(await ping(handle.db)).toBe(true);
    await handle.db.insert(schema.appMeta).values({ key: "k", value: "v" }).onConflictDoUpdate({ target: schema.appMeta.key, set: { value: "v" } });
    const rows = await handle.db.select().from(schema.appMeta).where(eq(schema.appMeta.key, "k"));
    expect(rows[0]?.value).toBe("v");
  });

  it("int8 volta como bigint (dinheiro inteiro, Q20)", async () => {
    const [row] = await handle.db.execute<{ big: bigint }>(sql`select 9007199254740993::int8 as big`);
    expect(row?.big).toBe(9007199254740993n);
  });

  it("ping retorna false quando a conexão falha", async () => {
    const broken = createDb("postgres://invalid:invalid@127.0.0.1:1/none", { max: 1 });
    try {
      expect(await ping(broken.db)).toBe(false);
    } finally {
      await broken.close();
    }
  });
});

describe("createDb", () => {
  it("rejeita URL vazia", () => {
    expect(() => createDb("")).toThrow("DATABASE_URL");
  });
});
