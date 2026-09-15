import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDb,
  createSession,
  findValidSession,
  grantRole,
  hashSessionToken,
  listRoles,
  ping,
  revokeRole,
  revokeSession,
  runMigrations,
  schema,
  upsertUserByDiscordId,
  type DbHandle,
} from "./index.js";

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
    await reset.db.execute(sql`drop schema if exists public cascade`);
    await reset.db.execute(sql`create schema public`);
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

  describe("auth: usuários, papéis e sessões (TASK-007)", () => {
    let seq = 0;
    const newUser = (name = "user") => {
      seq += 1;
      return upsertUserByDiscordId(handle.db, { discordId: `${Date.now()}${seq}`, discordUsername: `${name}${seq}` });
    };
    const pgCode = async (p: Promise<unknown>) => {
      try {
        await p;
        return null;
      } catch (e) {
        const err = e as { code?: string; cause?: { code?: string } };
        return err.cause?.code ?? err.code ?? "unknown";
      }
    };

    it("discord_id é único: insert duplicado falha com unique_violation (AC#3)", async () => {
      await handle.db.insert(schema.users).values({ discordId: "111111111111111111", discordUsername: "a" });
      const code = await pgCode(handle.db.insert(schema.users).values({ discordId: "111111111111111111", discordUsername: "b" }));
      expect(code).toBe("23505");
    });

    it("upsert por discord_id atualiza o mesmo usuário em vez de duplicar (AC#3)", async () => {
      const first = await upsertUserByDiscordId(handle.db, { discordId: "222222222222222222", discordUsername: "old", avatar: "a1" });
      const second = await upsertUserByDiscordId(handle.db, { discordId: "222222222222222222", discordUsername: "new", displayName: "Novo" });
      expect(second.id).toBe(first.id);
      expect(second).toMatchObject({ discordUsername: "new", displayName: "Novo", avatar: null });
      const rows = await handle.db.select().from(schema.users).where(eq(schema.users.discordId, "222222222222222222"));
      expect(rows).toHaveLength(1);
    });

    it("usuário pode ter mais de um papel (AC#2)", async () => {
      const admin = await newUser("admin");
      const user = await newUser();
      await grantRole(handle.db, user.id, "staff", admin.id);
      await grantRole(handle.db, user.id, "member");
      await grantRole(handle.db, user.id, "caller");
      expect(await listRoles(handle.db, user.id)).toEqual(["member", "caller", "staff"]);
      const [row] = await handle.db.select().from(schema.userRoles).where(eq(schema.userRoles.role, "staff"));
      expect(row?.grantedBy).toBe(admin.id);
    });

    it("mesmo papel duas vezes é rejeitado pela PK e grantRole é idempotente", async () => {
      const user = await newUser();
      await grantRole(handle.db, user.id, "admin");
      await grantRole(handle.db, user.id, "admin");
      expect(await listRoles(handle.db, user.id)).toEqual(["admin"]);
      expect(await pgCode(handle.db.insert(schema.userRoles).values({ userId: user.id, role: "admin" }))).toBe("23505");
    });

    it("papel fora do enum é rejeitado pelo banco", async () => {
      const user = await newUser();
      expect(await pgCode(handle.db.execute(sql`insert into user_roles (user_id, role) values (${user.id}, 'owner')`))).toBe("22P02");
    });

    it("revokeRole remove só o papel indicado", async () => {
      const user = await newUser();
      await grantRole(handle.db, user.id, "member");
      await grantRole(handle.db, user.id, "caller");
      expect(await revokeRole(handle.db, user.id, "caller")).toBe(true);
      expect(await revokeRole(handle.db, user.id, "caller")).toBe(false);
      expect(await listRoles(handle.db, user.id)).toEqual(["member"]);
    });

    it("sessão guarda só o hash do token e é encontrada pelo token em claro", async () => {
      const user = await newUser();
      const now = new Date();
      const { token, session } = await createSession(handle.db, user.id, new Date(now.getTime() + 60_000));
      expect(session.tokenHash).toBe(hashSessionToken(token));
      expect(session.tokenHash).not.toContain(token);
      const found = await findValidSession(handle.db, token, now);
      expect(found?.user.id).toBe(user.id);
      expect(found?.session.lastSeenAt.getTime()).toBe(now.getTime());
      expect(await findValidSession(handle.db, "token-inexistente", now)).toBeNull();
      expect(await findValidSession(handle.db, "", now)).toBeNull();
    });

    it("sessão expirada não é válida", async () => {
      const user = await newUser();
      const expiresAt = new Date(Date.now() + 1000);
      const { token } = await createSession(handle.db, user.id, expiresAt);
      expect(await findValidSession(handle.db, token, expiresAt)).toBeNull();
    });

    it("revokeSession invalida a sessão (logout)", async () => {
      const user = await newUser();
      const { token } = await createSession(handle.db, user.id, new Date(Date.now() + 60_000));
      expect(await revokeSession(handle.db, token)).toBe(true);
      expect(await revokeSession(handle.db, token)).toBe(false);
      expect(await revokeSession(handle.db, "")).toBe(false);
      expect(await findValidSession(handle.db, token)).toBeNull();
    });

    it("token_hash é único", async () => {
      const user = await newUser();
      const values = { userId: user.id, tokenHash: hashSessionToken("dup"), expiresAt: new Date(Date.now() + 60_000) };
      await handle.db.insert(schema.sessions).values(values);
      expect(await pgCode(handle.db.insert(schema.sessions).values(values))).toBe("23505");
    });

    it("apagar usuário remove papéis e sessões em cascata; granted_by vira null", async () => {
      const admin = await newUser("admin");
      const user = await newUser();
      await grantRole(handle.db, user.id, "member", admin.id);
      await createSession(handle.db, user.id, new Date(Date.now() + 60_000));
      await createSession(handle.db, admin.id, new Date(Date.now() + 60_000));

      await handle.db.delete(schema.users).where(eq(schema.users.id, admin.id));
      const [grant] = await handle.db.select().from(schema.userRoles).where(eq(schema.userRoles.userId, user.id));
      expect(grant?.grantedBy).toBeNull();
      expect(await handle.db.select().from(schema.sessions).where(eq(schema.sessions.userId, admin.id))).toHaveLength(0);

      await handle.db.delete(schema.users).where(eq(schema.users.id, user.id));
      expect(await listRoles(handle.db, user.id)).toEqual([]);
      expect(await handle.db.select().from(schema.sessions).where(eq(schema.sessions.userId, user.id))).toHaveLength(0);
    });
  });
});

describe("createDb", () => {
  it("rejeita URL vazia", () => {
    expect(() => createDb("")).toThrow("DATABASE_URL");
  });
});
