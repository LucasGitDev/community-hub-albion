import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  closeStaleSessionsAtHeartbeat,
  closeVoiceSession,
  createDb,
  createSession,
  decideNickRequest,
  findUserIdByDiscordId,
  getNickRequestEmbedData,
  setNickRequestDiscordMessageId,
  getNickStatus,
  listPendingNickRequests,
  requestNick,
  setGameNick,
  findValidSession,
  grantRole,
  hashSessionToken,
  listOpenVoiceSessions,
  listRoles,
  openVoiceSession,
  ping,
  revokeRole,
  revokeSession,
  runMigrations,
  schema,
  touchHeartbeat,
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
  describe("voice sessions (TASK-017)", () => {
    const t = (m: number) => new Date(Date.UTC(2026, 0, 1, 0, m));
    let seq = 0;
    const uid = () => `9${Date.now()}${++seq}`;
    const pgCode = async (p: Promise<unknown>) => {
      try {
        await p;
        return null;
      } catch (e) {
        const err = e as { code?: string; cause?: { code?: string } };
        return err.cause?.code ?? err.code ?? "unknown";
      }
    };

    it("migration cria voice_sessions com usuário, canal, início, fim opcional e heartbeat (AC#1)", async () => {
      const cols = await handle.db.execute<{ column_name: string; is_nullable: string }>(
        sql`select column_name, is_nullable from information_schema.columns where table_name = 'voice_sessions'`,
      );
      const nullable = Object.fromEntries(cols.map((c) => [c.column_name, c.is_nullable]));
      expect(nullable).toMatchObject({
        discord_user_id: "NO",
        channel_id: "NO",
        started_at: "NO",
        ended_at: "YES",
        last_heartbeat_at: "NO",
        guild_id: "YES",
      });
    });

    it("open → listOpenVoiceSessions por usuário (AC#2)", async () => {
      const a = uid();
      const b = uid();
      const s = await openVoiceSession(handle.db, { discordUserId: a, guildId: "g", channelId: "c1", at: t(0) });
      await openVoiceSession(handle.db, { discordUserId: b, channelId: "c1", at: t(1) });
      expect(s).toMatchObject({ discordUserId: a, channelId: "c1", endedAt: null, guildId: "g" });
      expect(s.lastHeartbeatAt.getTime()).toBe(t(0).getTime());
      const mine = await listOpenVoiceSessions(handle.db, a);
      expect(mine.map((r) => r.id)).toEqual([s.id]);
      const all = await listOpenVoiceSessions(handle.db);
      expect(all.map((r) => r.discordUserId)).toEqual(expect.arrayContaining([a, b]));
    });

    it("segundo open do mesmo usuário fecha o anterior no mesmo instante (AC#3)", async () => {
      const a = uid();
      const first = await openVoiceSession(handle.db, { discordUserId: a, channelId: "c1", at: t(0) });
      const second = await openVoiceSession(handle.db, { discordUserId: a, channelId: "c2", at: t(5) });
      const open = await listOpenVoiceSessions(handle.db, a);
      expect(open.map((r) => r.id)).toEqual([second.id]);
      const [old] = await handle.db.select().from(schema.voiceSessions).where(eq(schema.voiceSessions.id, first.id));
      expect(old?.endedAt?.getTime()).toBe(t(5).getTime());
    });

    it("índice único parcial rejeita segunda sessão aberta inserida direto (AC#3)", async () => {
      const a = uid();
      await handle.db.insert(schema.voiceSessions).values({ discordUserId: a, channelId: "c1", startedAt: t(0), lastHeartbeatAt: t(0) });
      const code = await pgCode(
        handle.db.insert(schema.voiceSessions).values({ discordUserId: a, channelId: "c2", startedAt: t(1), lastHeartbeatAt: t(1) }),
      );
      expect(code).toBe("23505");
      // Sessões fechadas não contam.
      await handle.db
        .insert(schema.voiceSessions)
        .values({ discordUserId: a, channelId: "c2", startedAt: t(1), lastHeartbeatAt: t(1), endedAt: t(2) });
    });

    it("closeVoiceSession define ended_at; sem sessão aberta retorna null", async () => {
      const a = uid();
      await openVoiceSession(handle.db, { discordUserId: a, channelId: "c1", at: t(0) });
      const closed = await closeVoiceSession(handle.db, a, t(30));
      expect(closed?.endedAt?.getTime()).toBe(t(30).getTime());
      expect(await listOpenVoiceSessions(handle.db, a)).toEqual([]);
      expect(await closeVoiceSession(handle.db, a, t(40))).toBeNull();
    });

    it("check constraint rejeita ended_at < started_at", async () => {
      const code = await pgCode(
        handle.db.insert(schema.voiceSessions).values({ discordUserId: uid(), channelId: "c", startedAt: t(10), lastHeartbeatAt: t(10), endedAt: t(5) }),
      );
      expect(code).toBe("23514");
    });

    it("touchHeartbeat atualiza abertas e closeStaleSessionsAtHeartbeat fecha no último heartbeat", async () => {
      await closeStaleSessionsAtHeartbeat(handle.db); // isola dos testes anteriores
      const a = uid();
      const b = uid();
      await openVoiceSession(handle.db, { discordUserId: a, channelId: "c1", at: t(0) });
      await openVoiceSession(handle.db, { discordUserId: b, channelId: "c1", at: t(0) });
      await closeVoiceSession(handle.db, b, t(1));
      expect(await touchHeartbeat(handle.db, t(15))).toBe(1);
      expect(await touchHeartbeat(handle.db, t(10))).toBe(1); // não retrocede
      const [open] = await listOpenVoiceSessions(handle.db, a);
      expect(open?.lastHeartbeatAt.getTime()).toBe(t(15).getTime());

      expect(await closeStaleSessionsAtHeartbeat(handle.db)).toBe(1);
      expect(await listOpenVoiceSessions(handle.db)).toEqual([]);
      const [row] = await handle.db.select().from(schema.voiceSessions).where(eq(schema.voiceSessions.discordUserId, a));
      expect(row?.endedAt?.getTime()).toBe(t(15).getTime());
    });
  });

  describe("nick: solicitações (TASK-012, Q14/Q31)", () => {
    it("cria pendente, troca o nick da pendente sem duplicar e lista na fila (AC#1, AC#2)", async () => {
      const u = await upsertUserByDiscordId(handle.db, { discordId: "500000000000000001", discordUsername: "novato" });
      expect(await getNickStatus(handle.db, u.id)).toEqual({ gameNick: null, pending: null, lastRejected: null });

      const first = await requestNick(handle.db, u.id, "Novato");
      expect(first.created).toBe(true);
      expect(first.request.status).toBe("pending");

      const second = await requestNick(handle.db, u.id, "NovatoDois");
      expect(second.created).toBe(false);
      expect(second.request.id).toBe(first.request.id);

      const status = await getNickStatus(handle.db, u.id);
      expect(status.pending?.nick).toBe("NovatoDois");
      const queue = await listPendingNickRequests(handle.db);
      expect(queue.filter((q) => q.user.id === u.id)).toHaveLength(1);
    });

    it("banco recusa segunda pendente do mesmo usuário (índice único parcial, AC#2)", async () => {
      const u = await upsertUserByDiscordId(handle.db, { discordId: "500000000000000002", discordUsername: "duplo" });
      await handle.db.insert(schema.nickRequests).values({ userId: u.id, nick: "Duplo" });
      await expect(handle.db.insert(schema.nickRequests).values({ userId: u.id, nick: "Duplo2" })).rejects.toThrow();
      // decididas não contam: nova pendente convive com histórico
      await handle.db.update(schema.nickRequests).set({ status: "rejected", decidedAt: new Date() }).where(eq(schema.nickRequests.userId, u.id));
      expect((await requestNick(handle.db, u.id, "Duplo3")).created).toBe(true);
    });

    it("requisições simultâneas geram uma só pendente", async () => {
      const u = await upsertUserByDiscordId(handle.db, { discordId: "500000000000000004", discordUsername: "pressa" });
      await Promise.all(["PressaA", "PressaB", "PressaC"].map((n) => requestNick(handle.db, u.id, n)));
      const rows = await handle.db.select().from(schema.nickRequests).where(eq(schema.nickRequests.userId, u.id));
      expect(rows).toHaveLength(1);
    });

    it("membro aprovado que pede troca mantém nick vigente e papel (AC#3)", async () => {
      const u = await upsertUserByDiscordId(handle.db, { discordId: "500000000000000003", discordUsername: "veterano" });
      await grantRole(handle.db, u.id, "member");
      await setGameNick(handle.db, u.id, "Veterano");
      await requestNick(handle.db, u.id, "VeteranoNovo");
      const status = await getNickStatus(handle.db, u.id);
      expect(status.gameNick).toBe("Veterano");
      expect(status.pending?.nick).toBe("VeteranoNovo");
      expect(await listRoles(handle.db, u.id)).toEqual(["member"]);
      // login seguinte não apaga o nick vigente
      await upsertUserByDiscordId(handle.db, { discordId: "500000000000000003", discordUsername: "veterano2" });
      expect((await getNickStatus(handle.db, u.id)).gameNick).toBe("Veterano");
    });
  });

  describe("nick: decisão da staff (TASK-013)", () => {
    async function setup(discordId: string, gameNick: string | null, nick: string) {
      const u = await upsertUserByDiscordId(handle.db, { discordId, discordUsername: `d${discordId.slice(-3)}` });
      if (gameNick) await setGameNick(handle.db, u.id, gameNick);
      const staff = await upsertUserByDiscordId(handle.db, { discordId: `9${discordId.slice(1)}`, discordUsername: `staff${discordId.slice(-3)}` });
      const { request } = await requestNick(handle.db, u.id, nick);
      return { u, staff, request };
    }

    it("aprovação torna o nick vigente e registra quem e quando (AC#2, AC#4)", async () => {
      const { u, staff, request } = await setup("510000000000000001", "Antigo", "Novo");
      const before = Date.now();
      const res = await decideNickRequest(handle.db, { requestId: request.id, decision: "approved", deciderUserId: staff.id, note: null });
      expect(res.ok && res.previousGameNick).toBe("Antigo");
      const [row] = await handle.db.select().from(schema.nickRequests).where(eq(schema.nickRequests.id, request.id));
      expect(row).toMatchObject({ status: "approved", decidedBy: staff.id, decisionNote: null });
      expect(row!.decidedAt!.getTime()).toBeGreaterThanOrEqual(before - 5_000);
      expect(await getNickStatus(handle.db, u.id)).toMatchObject({ gameNick: "Novo", pending: null, lastRejected: null });
      expect(await listPendingNickRequests(handle.db).then((q) => q.filter((x) => x.request.id === request.id))).toEqual([]);
    });

    it("recusa mantém o nick anterior, grava motivo e expõe a última recusa (AC#2, AC#4)", async () => {
      const { u, staff, request } = await setup("510000000000000002", "Antigo", "Errado");
      const res = await decideNickRequest(handle.db, { requestId: request.id, decision: "rejected", deciderUserId: staff.id, note: "Nick não existe no jogo." });
      expect(res.ok).toBe(true);
      const status = await getNickStatus(handle.db, u.id);
      expect(status.gameNick).toBe("Antigo");
      expect(status.lastRejected).toMatchObject({ id: request.id, decidedBy: staff.id, decisionNote: "Nick não existe no jogo." });
      // aprovação posterior some com a recusa
      const { request: next } = await requestNick(handle.db, u.id, "Certo");
      await decideNickRequest(handle.db, { requestId: next.id, decision: "approved", deciderUserId: staff.id, note: null });
      expect((await getNickStatus(handle.db, u.id)).lastRejected).toBeNull();
    });

    it("decidir de novo, ou id inexistente, não altera nada", async () => {
      const { u, staff, request } = await setup("510000000000000003", null, "Primeiro");
      await decideNickRequest(handle.db, { requestId: request.id, decision: "approved", deciderUserId: staff.id, note: null });
      const again = await decideNickRequest(handle.db, { requestId: request.id, decision: "rejected", deciderUserId: staff.id, note: "x" });
      expect(again).toEqual({ ok: false, reason: "not_pending" });
      expect((await getNickStatus(handle.db, u.id)).gameNick).toBe("Primeiro");
      const missing = await decideNickRequest(handle.db, { requestId: "00000000-0000-4000-8000-000000000000", decision: "approved", deciderUserId: staff.id, note: null });
      expect(missing).toEqual({ ok: false, reason: "not_found" });
    });

    it("aprovar e recusar simultâneos: só uma decisão vence", async () => {
      const { u, staff, request } = await setup("510000000000000004", "Antigo", "Corrida");
      const results = await Promise.all([
        decideNickRequest(handle.db, { requestId: request.id, decision: "approved", deciderUserId: staff.id, note: null }),
        decideNickRequest(handle.db, { requestId: request.id, decision: "rejected", deciderUserId: staff.id, note: "não" }),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      const [row] = await handle.db.select().from(schema.nickRequests).where(eq(schema.nickRequests.id, request.id));
      expect((await getNickStatus(handle.db, u.id)).gameNick).toBe(row!.status === "approved" ? "Corrida" : "Antigo");
    });
  });

  describe("nick: embed da staff (TASK-015)", () => {
    it("guarda message id e devolve dados do embed com quem pediu e quem decidiu", async () => {
      const u = await upsertUserByDiscordId(handle.db, { discordId: "520000000000000001", discordUsername: "embed" });
      const staff = await upsertUserByDiscordId(handle.db, { discordId: "520000000000000101", discordUsername: "staffEmbed" });
      await setGameNick(handle.db, u.id, "Velho");
      const { request } = await requestNick(handle.db, u.id, "Novo");
      expect(await findUserIdByDiscordId(handle.db, "520000000000000101")).toBe(staff.id);
      expect(await findUserIdByDiscordId(handle.db, "520000000000000999")).toBeNull();

      await setNickRequestDiscordMessageId(handle.db, request.id, "777000000000000001");
      const pending = await getNickRequestEmbedData(handle.db, request.id);
      expect(pending).toMatchObject({ request: { discordMessageId: "777000000000000001", status: "pending" }, requester: { discordId: "520000000000000001", gameNick: "Velho" }, decider: null });

      // Correção do nick pendente preserva o message id (embed é editado, não duplicado).
      await requestNick(handle.db, u.id, "Corrigido");
      await decideNickRequest(handle.db, { requestId: request.id, decision: "rejected", deciderUserId: staff.id, note: "não" });
      const decided = await getNickRequestEmbedData(handle.db, request.id);
      expect(decided).toMatchObject({ request: { nick: "Corrigido", status: "rejected", discordMessageId: "777000000000000001" }, decider: { discordId: "520000000000000101" } });
      expect(await getNickRequestEmbedData(handle.db, "00000000-0000-4000-8000-000000000000")).toBeNull();
    });
  });
});

describe("createDb", () => {
  it("rejeita URL vazia", () => {
    expect(() => createDb("")).toThrow("DATABASE_URL");
  });
});
