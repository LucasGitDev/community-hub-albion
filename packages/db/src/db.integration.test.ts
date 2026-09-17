import { DEFAULT_EVENT_ROLES, type EventTemplateYaml } from "@albion-hub/shared";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  closeStaleSessionsAtHeartbeat,
  closeVoiceSession,
  createDb,
  createEventRole,
  createSession,
  decideNickRequest,
  deleteEventRole,
  deleteEventTemplate,
  getEventTemplate,
  importEventTemplate,
  listEventRoles,
  listEventTemplates,
  saveEventTemplate,
  updateEventRole,
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
  closeOpenVoiceSessionsInChannel,
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
  applyEventTransition,
  closeDueEvents,
  createEvent,
  getEvent,
  listEventOwnerHistory,
  listEvents,
  setEventVoiceChannelId,
  transferEventOwner,
  joinEventRole,
  leaveEvent,
  listEventSignupMembers,
  listEventSignups,
  listEventsOccupancy,
  listUserEventSignups,
  moveEventSignup,
  type CreateEventInput,
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

  describe("catálogo de roles e templates (TASK-020, Q8)", () => {
    const MISSING = "00000000-0000-4000-8000-000000000000";
    // A faixa de Buffunfa (TASK-057) é obrigatória no schema; o default 0 aqui mantém os casos antigos
    // falando só de vagas, e quem testa Buffunfa passa a faixa explícita.
    const tpl = (name: string, roles: { roleId: string; slots: number; buffunfaMin?: bigint; buffunfaMax?: bigint }[]) => ({
      name,
      description: null,
      minPartySize: 1,
      maxPartySize: null,
      active: true,
      roles: roles.map((r) => ({ buffunfaMin: 0n, buffunfaMax: 0n, ...r })),
    });

    it("migration semeia as 6 roles iniciais uma vez só, na ordem", async () => {
      const names = (await listEventRoles(handle.db)).map((r) => r.name);
      expect(names.slice(0, DEFAULT_EVENT_ROLES.length)).toEqual([...DEFAULT_EVENT_ROLES]);
      await runMigrations(url!);
      expect((await listEventRoles(handle.db)).filter((r) => r.name === "Tank")).toHaveLength(1);
    });

    it("cria e edita role; nome único sem diferenciar maiúsculas (AC#1)", async () => {
      const created = await createEventRole(handle.db, { name: "Batedor", description: null });
      if (!created.ok) throw new Error("falhou");
      expect(created.role).toMatchObject({ name: "Batedor", templateCount: 0 });
      expect(await createEventRole(handle.db, { name: "batedor", description: null })).toEqual({ ok: false, reason: "duplicate" });
      expect(await updateEventRole(handle.db, created.role.id, { name: "TANK" })).toEqual({ ok: false, reason: "duplicate" });
      expect(await updateEventRole(handle.db, MISSING, { name: "X" })).toEqual({ ok: false, reason: "not_found" });
      const edited = await updateEventRole(handle.db, created.role.id, { description: "abre caminho" });
      expect(edited).toMatchObject({ ok: true, role: { name: "Batedor", description: "abre caminho" } });
      expect(await deleteEventRole(handle.db, created.role.id)).toBe("deleted");
      expect(await deleteEventRole(handle.db, created.role.id)).toBe("not_found");
    });

    it("template com roles e vagas; role em uso não apaga, nem pela FK (AC#2, AC#3)", async () => {
      const roles = await listEventRoles(handle.db);
      const created = await createEventRole(handle.db, { name: "Arqueiro", description: null });
      if (!created.ok) throw new Error("falhou");
      const tank = created.role;
      const healer = roles.find((r) => r.name === "Healer")!;
      const saved = await saveEventTemplate(handle.db, tpl("Raid do Dragão", [{ roleId: healer.id, slots: 4, buffunfaMin: 0n, buffunfaMax: 0n }, { roleId: tank.id, slots: 2, buffunfaMin: 0n, buffunfaMax: 0n }]));
      if (!saved.ok) throw new Error(saved.reason);
      expect(saved.template).toMatchObject({ totalSlots: 6, roles: [{ name: "Healer", slots: 4 }, { name: "Arqueiro", slots: 2 }] });
      expect(await saveEventTemplate(handle.db, tpl("raid do dragão", [{ roleId: tank.id, slots: 1, buffunfaMin: 0n, buffunfaMax: 0n }]))).toEqual({ ok: false, reason: "duplicate" });
      expect(await saveEventTemplate(handle.db, tpl("Outro", [{ roleId: MISSING, slots: 1, buffunfaMin: 0n, buffunfaMax: 0n }]))).toEqual({ ok: false, reason: "unknown_role" });

      expect((await listEventRoles(handle.db)).find((r) => r.id === tank.id)!.templateCount).toBe(1);
      expect(await deleteEventRole(handle.db, tank.id)).toBe("in_use");
      await expect(handle.db.delete(schema.eventRoles).where(eq(schema.eventRoles.id, tank.id))).rejects.toThrow();
      await expect(handle.db.insert(schema.eventTemplateRoles).values({ templateId: saved.template.id, roleId: roles[2]!.id, slots: 0 })).rejects.toThrow();

      const replaced = await saveEventTemplate(handle.db, { ...tpl("Raid do Dragão", [{ roleId: healer.id, slots: 5, buffunfaMin: 0n, buffunfaMax: 0n }]), maxPartySize: 20 }, saved.template.id);
      expect(replaced).toMatchObject({ ok: true, template: { maxPartySize: 20, totalSlots: 5, roles: [{ name: "Healer" }] } });
      expect(await deleteEventRole(handle.db, tank.id)).toBe("deleted");
      expect(await saveEventTemplate(handle.db, tpl("Nada", [{ roleId: healer.id, slots: 1, buffunfaMin: 0n, buffunfaMax: 0n }]), MISSING)).toEqual({ ok: false, reason: "not_found" });
      expect((await listEventTemplates(handle.db)).map((t) => t.name)).toContain("Raid do Dragão");
      expect(await deleteEventTemplate(handle.db, saved.template.id)).toBe(true);
      expect(await deleteEventTemplate(handle.db, saved.template.id)).toBe(false);
      expect(await getEventTemplate(handle.db, saved.template.id)).toBeNull();
    });
  });

  describe("import de template em YAML (TASK-038)", () => {
    const yaml = (over: Partial<EventTemplateYaml> = {}): EventTemplateYaml => ({
      version: 1,
      name: "Importado",
      description: null,
      minParty: 3,
      maxParty: 7,
      active: true,
      roles: [{ name: "Tank", slots: 1, description: null, buffunfaMin: 0n, buffunfaMax: 0n }],
      ...over,
    });

    it("casa role pelo nome sem diferenciar maiúsculas e não duplica o catálogo (AC#2, AC#4)", async () => {
      const before = await listEventRoles(handle.db);
      const result = await importEventTemplate(handle.db, yaml({ name: "Import casa role", roles: [{ name: "tAnK", slots: 2, description: null, buffunfaMin: 0n, buffunfaMax: 0n }, { name: "healer", slots: 2, description: null, buffunfaMin: 0n, buffunfaMax: 0n }] }));
      if (!result.ok) throw new Error(result.reason);
      expect(result.createdRoles).toEqual([]);
      expect(result.template).toMatchObject({ name: "Import casa role", minPartySize: 3, maxPartySize: 7, totalSlots: 4, roles: [{ name: "Tank", slots: 2 }, { name: "Healer", slots: 2 }] });
      expect((await listEventRoles(handle.db)).length).toBe(before.length);
    });

    it("cria as roles que faltam no catálogo e devolve os nomes criados (AC#4)", async () => {
      const result = await importEventTemplate(
        handle.db,
        yaml({ name: "Import cria role", minParty: 2, maxParty: 6, roles: [{ name: "Battlemount", slots: 2, description: "monta de guerra", buffunfaMin: 0n, buffunfaMax: 0n }, { name: "Tank", slots: 1, description: null, buffunfaMin: 0n, buffunfaMax: 0n }, { name: "Bardo", slots: 1, description: null, buffunfaMin: 0n, buffunfaMax: 0n }] }),
      );
      if (!result.ok) throw new Error(result.reason);
      expect(result.createdRoles).toEqual(["Battlemount", "Bardo"]);
      expect(result.template.roles.map((r) => r.name)).toEqual(["Battlemount", "Tank", "Bardo"]);
      const catalog = await listEventRoles(handle.db);
      const battlemount = catalog.find((r) => r.name === "Battlemount")!;
      expect(battlemount.description).toBe("monta de guerra");
      expect(battlemount.templateCount).toBe(1);
      // Roles novas entram no fim do catálogo, sem colidir no sort_order entre si.
      expect(catalog.findIndex((r) => r.name === "Bardo")).toBeGreaterThan(catalog.findIndex((r) => r.name === "Battlemount"));
    });

    it("import não sobrescreve descrição já preenchida no catálogo e reporta o que ignorou (TASK-065 AC#1/#2/#4)", async () => {
      // Dois templates com a MESMA role e descrições diferentes: o segundo import não pode reescrever o primeiro.
      const zvz = await importEventTemplate(handle.db, yaml({ name: "T065 ZvZ", roles: [{ name: "Couraçado", slots: 1, description: "segura a linha de frente na ZvZ", buffunfaMin: 0n, buffunfaMax: 0n }] }));
      if (!zvz.ok) throw new Error(zvz.reason);
      expect(zvz.createdRoles).toEqual(["Couraçado"]);
      expect(zvz.ignoredDescriptions).toEqual([]);

      const dg = await importEventTemplate(handle.db, yaml({ name: "T065 DG", roles: [{ name: "couraçado", slots: 1, description: "puxa os mobs da dungeon", buffunfaMin: 0n, buffunfaMax: 0n }] }));
      if (!dg.ok) throw new Error(dg.reason);
      expect(dg.createdRoles).toEqual([]);
      expect(dg.ignoredDescriptions).toEqual(["couraçado"]);

      // A descrição do catálogo continua a do primeiro template; nada foi perdido em silêncio.
      const role = (await listEventRoles(handle.db)).find((r) => r.name === "Couraçado")!;
      expect(role.description).toBe("segura a linha de frente na ZvZ");
      expect(role.templateCount).toBe(2);

      // Descrição idêntica não é "ignorada": não havia nada a aplicar.
      const igual = await importEventTemplate(handle.db, yaml({ name: "T065 Igual", roles: [{ name: "Couraçado", slots: 1, description: "segura a linha de frente na ZvZ", buffunfaMin: 0n, buffunfaMax: 0n }] }));
      if (!igual.ok) throw new Error(igual.reason);
      expect(igual.ignoredDescriptions).toEqual([]);
    });

    it("role sem descrição no catálogo recebe a do arquivo (TASK-065 AC#3)", async () => {
      const created = await createEventRole(handle.db, { name: "T065 Vazia", description: null });
      if (!created.ok) throw new Error("falhou");
      const result = await importEventTemplate(handle.db, yaml({ name: "T065 Preenche", roles: [{ name: "t065 vazia", slots: 1, description: "guia o grupo", buffunfaMin: 0n, buffunfaMax: 0n }] }));
      if (!result.ok) throw new Error(result.reason);
      expect(result.ignoredDescriptions).toEqual([]);
      expect((await listEventRoles(handle.db)).find((r) => r.id === created.role.id)!.description).toBe("guia o grupo");
    });

    it("nome de template repetido não grava nada, nem as roles novas (AC#3, tudo ou nada)", async () => {
      const first = await importEventTemplate(handle.db, yaml({ name: "Import colide", roles: [{ name: "Tank", slots: 3, description: null, buffunfaMin: 0n, buffunfaMax: 0n }] }));
      expect(first.ok).toBe(true);
      const before = (await listEventRoles(handle.db)).length;
      const again = await importEventTemplate(handle.db, yaml({ name: "IMPORT COLIDE", roles: [{ name: "Necromante", slots: 3, description: null, buffunfaMin: 0n, buffunfaMax: 0n }] }));
      expect(again).toEqual({ ok: false, reason: "duplicate" });
      expect((await listEventRoles(handle.db)).map((r) => r.name)).not.toContain("Necromante");
      expect((await listEventRoles(handle.db)).length).toBe(before);
      expect((await listEventTemplates(handle.db)).filter((t) => t.name.toLowerCase() === "import colide")).toHaveLength(1);
    });

    it("importa template sem teto de party e inativo", async () => {
      const result = await importEventTemplate(handle.db, yaml({ name: "Import roaming", minParty: 2, maxParty: null, active: false, roles: [{ name: "DPS Range", slots: 5, description: null, buffunfaMin: 0n, buffunfaMax: 0n }] }));
      expect(result).toMatchObject({ ok: true, template: { maxPartySize: null, active: false, totalSlots: 5 } });
    });
  });

  describe("eventos e máquina de estados (TASK-021, Q26, Q21)", () => {
    const MISSING = "00000000-0000-4000-8000-000000000000";
    let owner: string;
    let other: string;
    let templateId: string;

    beforeAll(async () => {
      owner = (await upsertUserByDiscordId(handle.db, { discordId: "710000000000000001", discordUsername: "caller" })).id;
      other = (await upsertUserByDiscordId(handle.db, { discordId: "710000000000000002", discordUsername: "outro" })).id;
      const roles = await listEventRoles(handle.db);
      const saved = await saveEventTemplate(handle.db, {
        name: "Template de eventos",
        description: null,
        minPartySize: 1,
        maxPartySize: null,
        active: true,
        roles: [
          { roleId: roles.find((r) => r.name === "Tank")!.id, slots: 1, buffunfaMin: 0n, buffunfaMax: 0n },
          { roleId: roles.find((r) => r.name === "Healer")!.id, slots: 2, buffunfaMin: 0n, buffunfaMax: 0n },
        ],
      });
      if (!saved.ok) throw new Error(saved.reason);
      templateId = saved.template.id;
    });

    const make = (name: string, extra: Partial<CreateEventInput> = {}) =>
      createEvent(handle.db, { templateId, name, description: null, startsAt: null, signupsCloseAt: null, ownerUserId: owner, createdBy: owner, ...extra });

    const created = async (name: string, extra?: Partial<CreateEventInput>) => {
      const result = await make(name, extra);
      if (!result.ok) throw new Error(result.reason);
      return result.event;
    };

    it("cria em draft com snapshot das roles do template e primeira linha de histórico (AC#1)", async () => {
      const event = await created("Roads das 21h");
      expect(event).toMatchObject({ status: "draft", ownerUserId: owner, createdByUserId: owner, templateName: "Template de eventos", totalSlots: 3, voiceChannelId: null });
      expect(event.roles).toEqual([
        { id: expect.any(String), roleId: expect.any(String), name: "Tank", description: null, slots: 1, buffunfaMin: "0", buffunfaMax: "0", buffunfaValue: "0" },
        { id: expect.any(String), roleId: expect.any(String), name: "Healer", description: null, slots: 2, buffunfaMin: "0", buffunfaMax: "0", buffunfaValue: "0" },
      ]);
      expect(await listEventOwnerHistory(handle.db, event.id)).toEqual([{ fromUserId: null, toUserId: owner, changedByUserId: owner, changedAt: expect.any(String) }]);
      expect(await getEvent(handle.db, MISSING)).toBeNull();
    });

    it("snapshot não muda quando o template é editado ou a role some do catálogo", async () => {
      const extra = await createEventRole(handle.db, { name: "Batedor do evento", description: null });
      if (!extra.ok) throw new Error("falhou");
      const saved = await saveEventTemplate(handle.db, {
        name: "Template descartável",
        description: null,
        minPartySize: 1,
        maxPartySize: null,
        active: true,
        roles: [{ roleId: extra.role.id, slots: 3, buffunfaMin: 0n, buffunfaMax: 0n }],
      });
      if (!saved.ok) throw new Error(saved.reason);
      const result = await createEvent(handle.db, { templateId: saved.template.id, name: "Congelado", description: null, startsAt: null, signupsCloseAt: null, ownerUserId: owner, createdBy: owner });
      if (!result.ok) throw new Error(result.reason);

      // Template muda depois: o evento publicado mantém as vagas com que foi criado.
      const roles = await listEventRoles(handle.db);
      await saveEventTemplate(handle.db, { name: "Template descartável", description: null, minPartySize: 1, maxPartySize: null, active: true, roles: [{ roleId: roles.find((r) => r.name === "Tank")!.id, slots: 9, buffunfaMin: 0n, buffunfaMax: 0n }] }, saved.template.id);
      expect(await deleteEventRole(handle.db, extra.role.id)).toBe("deleted");
      // TASK-039: a descrição vem do catálogo, então some junto com a role; o nome congelado na vaga fica.
      expect((await getEvent(handle.db, result.event.id))!.roles).toEqual([
        { id: expect.any(String), roleId: null, name: "Batedor do evento", description: null, slots: 3, buffunfaMin: "0", buffunfaMax: "0", buffunfaValue: "0" },
      ]);
      expect((await getEvent(handle.db, result.event.id))!.totalSlots).toBe(3);
    });

    it("descrição da role é lida ao vivo do catálogo pela vaga do evento (TASK-039, AC#2)", async () => {
      const created = await createEventRole(handle.db, { name: "Batedor de flanco", description: "Abre caminho e avisa o que vem." });
      if (!created.ok) throw new Error("falhou");
      const saved = await saveEventTemplate(handle.db, { name: "Flanco", description: null, minPartySize: 1, maxPartySize: null, active: true, roles: [{ roleId: created.role.id, slots: 2, buffunfaMin: 0n, buffunfaMax: 0n }] });
      if (!saved.ok) throw new Error(saved.reason);
      expect(saved.template.roles).toEqual([{ roleId: created.role.id, name: "Batedor de flanco", description: "Abre caminho e avisa o que vem.", slots: 2, buffunfaMin: "0", buffunfaMax: "0" }]);

      const result = await createEvent(handle.db, { templateId: saved.template.id, name: "Flanco das 21h", description: null, startsAt: null, signupsCloseAt: null, ownerUserId: owner, createdBy: owner });
      if (!result.ok) throw new Error(result.reason);
      expect(result.event.roles[0]!.description).toBe("Abre caminho e avisa o que vem.");

      // Corrigir o texto depois alcança o evento que já existe — é o motivo de não congelar na vaga.
      const patched = await updateEventRole(handle.db, created.role.id, { description: "Vai na frente, marca o inimigo e volta." });
      expect(patched.ok).toBe(true);
      expect((await getEvent(handle.db, result.event.id))!.roles[0]!.description).toBe("Vai na frente, marca o inimigo e volta.");
    });

    it("recusa template inexistente ou inativo", async () => {
      expect(await make("Sem template", { templateId: MISSING })).toEqual({ ok: false, reason: "unknown_template" });
      const roles = await listEventRoles(handle.db);
      const saved = await saveEventTemplate(handle.db, { name: "Aposentado", description: null, minPartySize: 1, maxPartySize: null, active: false, roles: [{ roleId: roles[0]!.id, slots: 1, buffunfaMin: 0n, buffunfaMax: 0n }] });
      if (!saved.ok) throw new Error(saved.reason);
      expect(await make("Aposentado", { templateId: saved.template.id })).toEqual({ ok: false, reason: "inactive_template" });
    });

    it("carimba um timestamp por transição no caminho feliz draft→open→closed→running→finished (Q26)", async () => {
      const event = await created("Caminho feliz");
      for (const to of ["open", "closed", "running", "finished"] as const) {
        const result = await applyEventTransition(handle.db, event.id, to);
        expect(result, to).toMatchObject({ ok: true, event: { status: to } });
      }
      const final = (await getEvent(handle.db, event.id))!;
      expect(final.openedAt).not.toBeNull();
      expect(final.closedAt).not.toBeNull();
      expect(final.startedAt).not.toBeNull();
      expect(final.finishedAt).not.toBeNull();
      expect(final.cancelledAt).toBeNull();
      expect(final.archivedAt).toBeNull();
      expect(Date.parse(final.startedAt!)).toBeGreaterThanOrEqual(Date.parse(final.closedAt!));
    });

    it("arquiva depois de finalizado, carimba archived_at e trava qualquer saída (TASK-044 AC#1)", async () => {
      const event = await created("Arquivado");
      for (const to of ["open", "running", "finished"] as const) await applyEventTransition(handle.db, event.id, to);
      const archived = await applyEventTransition(handle.db, event.id, "archived");
      expect(archived).toMatchObject({ ok: true, from: "finished", event: { status: "archived" } });
      const final = (await getEvent(handle.db, event.id))!;
      expect(final.archivedAt).not.toBeNull();
      // O carimbo de quando o jogo acabou continua lá: arquivar não apaga a história do evento.
      expect(final.finishedAt).not.toBeNull();
      for (const to of ["finished", "cancelled", "running", "open"] as const)
        expect(await applyEventTransition(handle.db, event.id, to), to).toEqual({ ok: false, reason: "invalid", from: "archived" });
    });

    it("precondição recusa o arquivamento dentro da transação e não muda nada (TASK-044 AC#4)", async () => {
      const event = await created("Com split pendente");
      for (const to of ["open", "running", "finished"] as const) await applyEventTransition(handle.db, event.id, to);
      const seen: { eventId: string; from: string; to: string }[] = [];
      const blocked = await applyEventTransition(handle.db, event.id, "archived", {
        precondition: (_tx, ctx) => {
          seen.push(ctx);
          return Promise.resolve("Esse evento ainda tem um loot split em rascunho.");
        },
      });
      expect(blocked).toEqual({ ok: false, reason: "blocked", from: "finished", message: "Esse evento ainda tem um loot split em rascunho." });
      expect(seen).toEqual([{ eventId: event.id, from: "finished", to: "archived" }]);
      const still = (await getEvent(handle.db, event.id))!;
      expect(still.status).toBe("finished");
      expect(still.archivedAt).toBeNull();
      // Precondição que libera deixa passar.
      expect(await applyEventTransition(handle.db, event.id, "archived", { precondition: () => Promise.resolve(null) })).toMatchObject({ ok: true });
    });

    it("precondição não roda quando a máquina já recusou a transição (TASK-044)", async () => {
      const event = await created("Precondição não chamada");
      let calls = 0;
      const result = await applyEventTransition(handle.db, event.id, "archived", {
        precondition: () => {
          calls += 1;
          return Promise.resolve("não deveria ser consultada");
        },
      });
      expect(result).toEqual({ ok: false, reason: "invalid", from: "draft" });
      expect(calls).toBe(0);
    });

    it("start com inscrição aberta fecha a inscrição junto (Q26: start fecha)", async () => {
      const event = await created("Start direto");
      await applyEventTransition(handle.db, event.id, "open");
      const started = await applyEventTransition(handle.db, event.id, "running");
      expect(started).toMatchObject({ ok: true, from: "open", event: { status: "running" } });
      if (!started.ok) throw new Error("falhou");
      expect(started.event.closedAt).toBe(started.event.startedAt);
    });

    it("transição inválida não muda nada e devolve o estado atual (AC#3)", async () => {
      const event = await created("Inválida");
      expect(await applyEventTransition(handle.db, event.id, "finished")).toEqual({ ok: false, reason: "invalid", from: "draft" });
      expect((await getEvent(handle.db, event.id))!.status).toBe("draft");
      expect(await applyEventTransition(handle.db, MISSING, "open")).toEqual({ ok: false, reason: "not_found" });

      await applyEventTransition(handle.db, event.id, "cancelled");
      expect((await getEvent(handle.db, event.id))!.cancelledAt).not.toBeNull();
      // Estado final: nem cancelar de novo nem reabrir.
      expect(await applyEventTransition(handle.db, event.id, "cancelled")).toEqual({ ok: false, reason: "invalid", from: "cancelled" });
      expect(await applyEventTransition(handle.db, event.id, "open")).toEqual({ ok: false, reason: "invalid", from: "cancelled" });
    });

    it("fecha só os eventos open com prazo vencido, e é idempotente (AC#5)", async () => {
      const now = new Date("2026-10-01T22:00:00.000Z");
      const past = new Date("2026-10-01T21:59:00.000Z");
      const future = new Date("2026-10-01T22:10:00.000Z");
      const vencido = await created("Vencido", { signupsCloseAt: past });
      const futuro = await created("Futuro", { signupsCloseAt: future });
      const semPrazo = await created("Sem prazo");
      const rascunho = await created("Rascunho vencido", { signupsCloseAt: past });
      for (const e of [vencido, futuro, semPrazo]) await applyEventTransition(handle.db, e.id, "open");

      const closed = await closeDueEvents(handle.db, now);
      expect(closed.map((e) => e.name)).toEqual(["Vencido"]);
      expect(closed[0]!.closedAt).toBe(now.toISOString());
      expect(await closeDueEvents(handle.db, now)).toEqual([]);
      expect((await getEvent(handle.db, futuro.id))!.status).toBe("open");
      expect((await getEvent(handle.db, semPrazo.id))!.status).toBe("open");
      expect((await getEvent(handle.db, rascunho.id))!.status).toBe("draft");
    });

    it("staff transfere owner e o histórico guarda cada troca (AC#4, Q21)", async () => {
      const event = await created("Transferido");
      const moved = await transferEventOwner(handle.db, event.id, other, other);
      expect(moved).toMatchObject({ ok: true, from: owner, event: { ownerUserId: other } });
      const back = await transferEventOwner(handle.db, event.id, owner, other);
      expect(back).toMatchObject({ ok: true, from: other });
      expect(await listEventOwnerHistory(handle.db, event.id)).toMatchObject([
        { fromUserId: null, toUserId: owner },
        { fromUserId: owner, toUserId: other },
        { fromUserId: other, toUserId: owner },
      ]);
      expect(await transferEventOwner(handle.db, event.id, owner, other)).toEqual({ ok: false, reason: "same_owner" });
      expect(await transferEventOwner(handle.db, event.id, MISSING, other)).toEqual({ ok: false, reason: "unknown_user" });
      expect(await transferEventOwner(handle.db, MISSING, other, other)).toEqual({ ok: false, reason: "not_found" });

      await applyEventTransition(handle.db, event.id, "cancelled");
      expect(await transferEventOwner(handle.db, event.id, other, other)).toEqual({ ok: false, reason: "terminal" });
    });

    it("evento finalizado ainda troca de owner; arquivado não (TASK-044 AC#2)", async () => {
      const event = await created("Acerto depois do jogo");
      for (const to of ["open", "running", "finished"] as const) await applyEventTransition(handle.db, event.id, to);
      // `finished` é o momento do acerto da prata (Q26 revisada): a taxa vai para o owner, então
      // corrigir o dono errado precisa continuar possível aqui.
      expect(await transferEventOwner(handle.db, event.id, other, other)).toMatchObject({ ok: true, event: { ownerUserId: other } });
      await applyEventTransition(handle.db, event.id, "archived");
      expect(await transferEventOwner(handle.db, event.id, owner, other)).toEqual({ ok: false, reason: "terminal" });
    });

    it("lista com filtros de estado, owner e template", async () => {
      const mine = await created("Filtrado");
      await applyEventTransition(handle.db, mine.id, "open");
      const abertos = await listEvents(handle.db, { status: ["open"] });
      expect(abertos.map((e) => e.id)).toContain(mine.id);
      expect(abertos.every((e) => e.status === "open")).toBe(true);
      expect((await listEvents(handle.db, { ownerUserId: MISSING })).length).toBe(0);
      expect((await listEvents(handle.db, { templateId, status: ["draft"] })).every((e) => e.templateId === templateId && e.status === "draft")).toBe(true);
      // Mais recentes primeiro.
      const all = await listEvents(handle.db);
      expect(all.length).toBeGreaterThan(1);
      expect(Date.parse(all[0]!.createdAt)).toBeGreaterThanOrEqual(Date.parse(all[all.length - 1]!.createdAt));
    });

    it("template que já virou evento não pode ser apagado (FK restrict)", async () => {
      await created("Trava o template");
      await expect(deleteEventTemplate(handle.db, templateId)).rejects.toThrow();
    });
  });

  describe("inscrição por role e lista de espera (TASK-022, Q27)", () => {
    const MISSING = "00000000-0000-4000-8000-000000000000";
    let owner: string;
    let templateId: string;
    let seq = 0;

    const user = async () => (await upsertUserByDiscordId(handle.db, { discordId: `73000000000000${String(++seq).padStart(4, "0")}`, discordUsername: `s${seq}` })).id;

    beforeAll(async () => {
      owner = await user();
      const roles = await listEventRoles(handle.db);
      const saved = await saveEventTemplate(handle.db, {
        name: "Template de inscrição",
        description: null,
        minPartySize: 1,
        maxPartySize: null,
        active: true,
        roles: [
          { roleId: roles.find((r) => r.name === "Tank")!.id, slots: 1, buffunfaMin: 0n, buffunfaMax: 0n },
          { roleId: roles.find((r) => r.name === "Healer")!.id, slots: 2, buffunfaMin: 0n, buffunfaMax: 0n },
        ],
      });
      if (!saved.ok) throw new Error(saved.reason);
      templateId = saved.template.id;
    });

    /** Evento já aberto, com as duas roles do template (Tank 1 vaga, Healer 2). */
    const openEvent = async (name: string) => {
      const result = await createEvent(handle.db, { templateId, name, description: null, startsAt: null, signupsCloseAt: null, ownerUserId: owner, createdBy: owner });
      if (!result.ok) throw new Error(result.reason);
      const opened = await applyEventTransition(handle.db, result.event.id, "open");
      if (!opened.ok) throw new Error("não abriu");
      const tank = opened.event.roles.find((r) => r.name === "Tank")!;
      const healer = opened.event.roles.find((r) => r.name === "Healer")!;
      return { event: opened.event, tank, healer };
    };

    it("entra na role, e uma segunda inscrição ativa no mesmo evento é impossível (índice único parcial)", async () => {
      const { event, tank } = await openEvent("Inscrição simples");
      const membro = await user();
      const joined = await joinEventRole(handle.db, { eventId: event.id, userId: membro, slotId: tank.id });
      expect(joined).toMatchObject({ ok: true, promoted: null, signup: { status: "confirmed", position: 0, roleName: "Tank", slotId: tank.id, decidedByUserId: null } });

      // Repetir a mesma role é recusado antes de tocar o banco...
      expect(await joinEventRole(handle.db, { eventId: event.id, userId: membro, slotId: tank.id })).toEqual({ ok: false, reason: "already_in_role" });
      // ...e o índice único parcial impede duas linhas ativas por evento/pessoa mesmo por fora do repo.
      await expect(
        handle.db.insert(schema.eventSignups).values({ eventId: event.id, userId: membro, slotId: tank.id, roleName: "Tank", status: "confirmed", position: 0 }),
      ).rejects.toThrow();

      expect(await joinEventRole(handle.db, { eventId: event.id, userId: membro, slotId: MISSING })).toEqual({ ok: false, reason: "unknown_role" });
      expect(await joinEventRole(handle.db, { eventId: MISSING, userId: membro, slotId: tank.id })).toEqual({ ok: false, reason: "not_found" });
    });

    it("role lotada manda para a espera, na ordem de chegada (AC#2)", async () => {
      const { event, tank } = await openEvent("Lotou o tank");
      const [a, b, c] = [await user(), await user(), await user()];
      const first = await joinEventRole(handle.db, { eventId: event.id, userId: a, slotId: tank.id });
      const second = await joinEventRole(handle.db, { eventId: event.id, userId: b, slotId: tank.id });
      const third = await joinEventRole(handle.db, { eventId: event.id, userId: c, slotId: tank.id });
      expect(first.ok && first.signup.status).toBe("confirmed");
      expect(second.ok && second.signup).toMatchObject({ status: "waitlist", position: 1 });
      expect(third.ok && third.signup).toMatchObject({ status: "waitlist", position: 2 });

      const list = await listEventSignups(handle.db, event.id);
      expect(list.map((s) => [s.userId, s.status, s.position])).toEqual([
        [a, "confirmed", 0],
        [b, "waitlist", 1],
        [c, "waitlist", 2],
      ]);
    });

    it("sair promove o primeiro da espera daquela role; quem espera em outra role não pula (AC#3)", async () => {
      const { event, tank, healer } = await openEvent("Promoção ao sair");
      const [dono, espera, outraRole] = [await user(), await user(), await user()];
      await joinEventRole(handle.db, { eventId: event.id, userId: dono, slotId: tank.id });
      await joinEventRole(handle.db, { eventId: event.id, userId: espera, slotId: tank.id });
      await joinEventRole(handle.db, { eventId: event.id, userId: outraRole, slotId: healer.id });

      const left = await leaveEvent(handle.db, { eventId: event.id, userId: dono });
      expect(left).toMatchObject({ ok: true, signup: { status: "cancelled" }, promoted: { userId: espera, status: "confirmed", position: 0, roleName: "Tank" } });
      expect(await leaveEvent(handle.db, { eventId: event.id, userId: dono })).toEqual({ ok: false, reason: "not_signed_up" });
      expect(await leaveEvent(handle.db, { eventId: MISSING, userId: dono })).toEqual({ ok: false, reason: "not_found" });

      // Quem estava no Healer continua no Healer: a espera é por role (Q27).
      const healerSignup = (await listEventSignups(handle.db, event.id)).find((s) => s.userId === outraRole)!;
      expect(healerSignup).toMatchObject({ status: "confirmed", roleName: "Healer" });
    });

    it("trocar de role libera a vaga antiga e promove quem esperava lá (AC#3)", async () => {
      const { event, tank, healer } = await openEvent("Troca de role");
      const [trocador, espera] = [await user(), await user()];
      await joinEventRole(handle.db, { eventId: event.id, userId: trocador, slotId: tank.id });
      await joinEventRole(handle.db, { eventId: event.id, userId: espera, slotId: tank.id });

      const moved = await joinEventRole(handle.db, { eventId: event.id, userId: trocador, slotId: healer.id });
      expect(moved).toMatchObject({ ok: true, signup: { status: "confirmed", roleName: "Healer" }, promoted: { userId: espera, status: "confirmed" } });
      const active = (await listEventSignups(handle.db, event.id)).filter((s) => s.status !== "cancelled");
      expect(active.map((s) => [s.userId, s.roleName])).toEqual(expect.arrayContaining([[trocador, "Healer"], [espera, "Tank"]]));
      // A inscrição antiga não some: vira histórico cancelado.
      expect((await listEventSignups(handle.db, event.id)).filter((s) => s.status === "cancelled")).toHaveLength(1);
    });

    it("a espera renumera sem buraco quando alguém sai, e a ordem de quem já esperava não muda (TASK-066)", async () => {
      const { event, tank } = await openEvent("Espera sem buraco");
      const [dono, b, c, d] = [await user(), await user(), await user(), await user()];
      await joinEventRole(handle.db, { eventId: event.id, userId: dono, slotId: tank.id });
      await joinEventRole(handle.db, { eventId: event.id, userId: b, slotId: tank.id });
      await joinEventRole(handle.db, { eventId: event.id, userId: c, slotId: tank.id });
      await joinEventRole(handle.db, { eventId: event.id, userId: d, slotId: tank.id });

      const waiting = async () =>
        (await listEventSignups(handle.db, event.id)).filter((s) => s.status === "waitlist").map((s) => [s.userId, s.position]);
      expect(await waiting()).toEqual([
        [b, 1],
        [c, 2],
        [d, 3],
      ]);

      // O confirmado sai: o primeiro da espera sobe e os que ficaram viram 1º e 2º, na mesma ordem.
      const left = await leaveEvent(handle.db, { eventId: event.id, userId: dono });
      expect(left).toMatchObject({ ok: true, promoted: { userId: b, status: "confirmed", position: 0 } });
      expect(await waiting()).toEqual([
        [c, 1],
        [d, 2],
      ]);

      // Agora quem sai é o primeiro da própria espera: ninguém é promovido e quem sobra vira o 1º.
      const outOfQueue = await leaveEvent(handle.db, { eventId: event.id, userId: c });
      expect(outOfQueue).toMatchObject({ ok: true, promoted: null });
      expect(await waiting()).toEqual([[d, 1]]);

      // Quem entra depois entra no fim da fila de verdade, sem herdar o contador antigo.
      const e = await user();
      const late = await joinEventRole(handle.db, { eventId: event.id, userId: e, slotId: tank.id });
      expect(late).toMatchObject({ ok: true, signup: { status: "waitlist", position: 2 } });
      expect(await waiting()).toEqual([
        [d, 1],
        [e, 2],
      ]);

      // O que o embed do Discord e o card do membro leem é o mesmo número da listagem do painel.
      const members = await listEventSignupMembers(handle.db, event.id);
      expect(members.filter((m) => m.status === "waitlist").map((m) => [m.userId, m.position])).toEqual([
        [d, 1],
        [e, 2],
      ]);
      expect((await listUserEventSignups(handle.db, d, [event.id])).map((s) => s.position)).toEqual([1]);
    });

    it("caller mandar um confirmado para a espera renumera a fila, e ele entra no fim dela (TASK-066)", async () => {
      const { event, tank } = await openEvent("Caller manda para a espera");
      const [confirmado, b, c] = [await user(), await user(), await user()];
      await joinEventRole(handle.db, { eventId: event.id, userId: confirmado, slotId: tank.id });
      await joinEventRole(handle.db, { eventId: event.id, userId: b, slotId: tank.id });
      await joinEventRole(handle.db, { eventId: event.id, userId: c, slotId: tank.id });

      const benched = await moveEventSignup(handle.db, { eventId: event.id, userId: confirmado, target: { kind: "waitlist" }, actorUserId: owner });
      // A vaga que ele liberou promove o primeiro da espera (b) — mas nunca ele mesmo, que acabou de descer.
      // Quem desce entra no fim da fila renumerada, e não num número inventado pelo contador antigo.
      expect(benched).toMatchObject({ ok: true, promoted: { userId: b, status: "confirmed" }, signup: { status: "waitlist", position: 2 } });
      expect((await listEventSignups(handle.db, event.id)).filter((s) => s.status === "waitlist").map((s) => [s.userId, s.position])).toEqual([
        [c, 1],
        [confirmado, 2],
      ]);
    });

    it("evento fora de open recusa entrar e sair (AC#5)", async () => {
      const { event, tank } = await openEvent("Fechado para inscrição");
      const dentro = await user();
      await joinEventRole(handle.db, { eventId: event.id, userId: dentro, slotId: tank.id });
      await applyEventTransition(handle.db, event.id, "closed");
      const fora = await user();
      expect(await joinEventRole(handle.db, { eventId: event.id, userId: fora, slotId: tank.id })).toEqual({ ok: false, reason: "not_open", status: "closed" });
      expect(await leaveEvent(handle.db, { eventId: event.id, userId: dentro })).toEqual({ ok: false, reason: "not_open", status: "closed" });
    });

    it("caller move inscrito entre role e espera; role lotada recusa (AC#4)", async () => {
      const { event, tank, healer } = await openEvent("Caller organiza");
      const [confirmado, esperando, healerCheio1, healerCheio2] = [await user(), await user(), await user(), await user()];
      await joinEventRole(handle.db, { eventId: event.id, userId: confirmado, slotId: tank.id });
      await joinEventRole(handle.db, { eventId: event.id, userId: esperando, slotId: tank.id });

      // Espera → role: sobe na frente, com o caller registrado.
      const promoted = await moveEventSignup(handle.db, { eventId: event.id, userId: esperando, target: { kind: "role", slotId: healer.id }, actorUserId: owner });
      expect(promoted).toMatchObject({ ok: true, signup: { status: "confirmed", roleName: "Healer", decidedByUserId: owner } });

      // Confirmado → espera: libera a vaga e quem estava esperando naquela role sobe (aqui não há ninguém).
      const benched = await moveEventSignup(handle.db, { eventId: event.id, userId: confirmado, target: { kind: "waitlist" }, actorUserId: owner });
      expect(benched).toMatchObject({ ok: true, signup: { status: "waitlist", position: expect.any(Number), decidedByUserId: owner }, promoted: null });
      expect(benched.ok && benched.signup.userId).toBe(confirmado);
      expect(await moveEventSignup(handle.db, { eventId: event.id, userId: confirmado, target: { kind: "waitlist" }, actorUserId: owner })).toEqual({ ok: false, reason: "already_there" });

      // Role lotada recusa em vez de estourar a vaga.
      await joinEventRole(handle.db, { eventId: event.id, userId: healerCheio1, slotId: healer.id });
      await joinEventRole(handle.db, { eventId: event.id, userId: healerCheio2, slotId: healer.id });
      expect(await moveEventSignup(handle.db, { eventId: event.id, userId: confirmado, target: { kind: "role", slotId: healer.id }, actorUserId: owner })).toEqual({
        ok: false,
        reason: "role_full",
      });
      expect(await moveEventSignup(handle.db, { eventId: event.id, userId: owner, target: { kind: "waitlist" }, actorUserId: owner })).toEqual({ ok: false, reason: "not_signed_up" });
      expect(await moveEventSignup(handle.db, { eventId: MISSING, userId: confirmado, target: { kind: "waitlist" }, actorUserId: owner })).toEqual({ ok: false, reason: "not_found" });
      expect(await moveEventSignup(handle.db, { eventId: event.id, userId: confirmado, target: { kind: "role", slotId: MISSING }, actorUserId: owner })).toEqual({
        ok: false,
        reason: "unknown_role",
      });
    });

    it("caller ainda organiza com a inscrição fechada, mas não depois do start (AC#4)", async () => {
      const { event, tank, healer } = await openEvent("Ajuste pós-fechamento");
      const membro = await user();
      await joinEventRole(handle.db, { eventId: event.id, userId: membro, slotId: tank.id });
      await applyEventTransition(handle.db, event.id, "closed");
      expect(await moveEventSignup(handle.db, { eventId: event.id, userId: membro, target: { kind: "role", slotId: healer.id }, actorUserId: owner })).toMatchObject({ ok: true });
      await applyEventTransition(handle.db, event.id, "running");
      expect(await moveEventSignup(handle.db, { eventId: event.id, userId: membro, target: { kind: "waitlist" }, actorUserId: owner })).toEqual({
        ok: false,
        reason: "closed_event",
        status: "running",
      });
    });

    it("dois cliques simultâneos na última vaga: um confirma, o outro espera (corrida)", async () => {
      const { event, tank } = await openEvent("Corrida pela última vaga");
      const [a, b] = [await user(), await user()];
      const [first, second] = await Promise.all([
        joinEventRole(handle.db, { eventId: event.id, userId: a, slotId: tank.id }),
        joinEventRole(handle.db, { eventId: event.id, userId: b, slotId: tank.id }),
      ]);
      const status = [first, second].map((r) => (r.ok ? r.signup.status : r.reason)).sort();
      expect(status).toEqual(["confirmed", "waitlist"]);
      const list = await listEventSignups(handle.db, event.id);
      expect(list.filter((s) => s.status === "confirmed")).toHaveLength(1);
      expect(list.filter((s) => s.status === "waitlist")).toHaveLength(1);
    });

    it("cancelar o evento cancela toda inscrição ativa na mesma transação, com o motivo guardado (TASK-025, AC#1)", async () => {
      const { event, tank, healer } = await openEvent("Cancelado com gente dentro");
      const [a, b, c] = [await user(), await user(), await user()];
      await joinEventRole(handle.db, { eventId: event.id, userId: a, slotId: tank.id });
      await joinEventRole(handle.db, { eventId: event.id, userId: b, slotId: tank.id }); // Tank lotada: vai pra espera
      await joinEventRole(handle.db, { eventId: event.id, userId: c, slotId: healer.id });
      expect((await listEventSignups(handle.db, event.id)).filter((s) => s.status !== "cancelled")).toHaveLength(3);

      const cancelled = await applyEventTransition(handle.db, event.id, "cancelled", { reason: "  não fechou grupo  " });
      expect(cancelled).toMatchObject({ ok: true, from: "open", event: { status: "cancelled", cancelReason: "não fechou grupo" } });

      // Confirmado e espera caem juntos: ninguém fica "confirmado" num evento que não existe mais.
      const after = await listEventSignups(handle.db, event.id);
      expect(after).toHaveLength(3);
      expect(after.every((s) => s.status === "cancelled" && s.position === 0)).toBe(true);
      // E a lista que o embed e o painel leem fica vazia.
      expect(await listEventSignupMembers(handle.db, event.id)).toEqual([]);
      expect(await listUserEventSignups(handle.db, a, [event.id])).toEqual([]);
      // Cancelar não promove ninguém da espera: o painel passa a contar zero em toda role.
      expect(await listEventsOccupancy(handle.db, [event.id])).toEqual([
        expect.objectContaining({ confirmed: 0, waitlist: 0 }),
        expect.objectContaining({ confirmed: 0, waitlist: 0 }),
      ]);
    });

    it("cancelar sem motivo deixa o campo nulo, e motivo em qualquer outra transição é ignorado (TASK-025)", async () => {
      const { event } = await openEvent("Cancelado sem motivo");
      const cancelled = await applyEventTransition(handle.db, event.id, "cancelled");
      expect(cancelled).toMatchObject({ ok: true, event: { cancelReason: null } });

      const outro = await openEvent("Fechado com motivo à toa");
      const closed = await applyEventTransition(handle.db, outro.event.id, "closed", { reason: "isso aqui não vale" });
      expect(closed).toMatchObject({ ok: true, event: { status: "closed", cancelReason: null } });
    });

    it("cancelar em running fecha as sessões de voz abertas no canal do evento, sem tocar nas dos outros (TASK-025, AC#2)", async () => {
      const { event, tank } = await openEvent("Cancelado rodando");
      const membro = await user();
      await joinEventRole(handle.db, { eventId: event.id, userId: membro, slotId: tank.id });
      await applyEventTransition(handle.db, event.id, "running");
      await setEventVoiceChannelId(handle.db, event.id, "voz-do-evento");

      const at = new Date("2026-10-01T22:00:00.000Z");
      await openVoiceSession(handle.db, { discordUserId: "760000000000000001", channelId: "voz-do-evento", at: new Date(at.getTime() - 60_000) });
      await openVoiceSession(handle.db, { discordUserId: "760000000000000002", channelId: "voz-do-evento", at: new Date(at.getTime() - 30_000) });
      await openVoiceSession(handle.db, { discordUserId: "760000000000000003", channelId: "outro-canal", at: new Date(at.getTime() - 30_000) });

      const closed = await closeOpenVoiceSessionsInChannel(handle.db, "voz-do-evento", at);
      expect(closed).toHaveLength(2);
      expect(closed.every((s) => s.endedAt?.getTime() === at.getTime())).toBe(true);
      // Nenhuma sessão órfã sobra no canal que vai ser apagado...
      expect(await listOpenVoiceSessions(handle.db)).toEqual([expect.objectContaining({ channelId: "outro-canal" })]);
      // ...e repetir não reabre nem muda nada (o cancelamento pode ser reprocessado).
      expect(await closeOpenVoiceSessionsInChannel(handle.db, "voz-do-evento", at)).toEqual([]);

      expect((await applyEventTransition(handle.db, event.id, "cancelled")).ok).toBe(true);
      expect((await listEventSignups(handle.db, event.id)).every((s) => s.status === "cancelled")).toBe(true);
    });

    it("apagar o evento leva as inscrições junto (cascade)", async () => {
      const { event, tank } = await openEvent("Some tudo");
      const membro = await user();
      await joinEventRole(handle.db, { eventId: event.id, userId: membro, slotId: tank.id });
      await handle.db.delete(schema.events).where(eq(schema.events.id, event.id));
      expect(await listEventSignups(handle.db, event.id)).toEqual([]);
    });
  });
});

describe("createDb", () => {
  it("rejeita URL vazia", () => {
    expect(() => createDb("")).toThrow("DATABASE_URL");
  });
});
