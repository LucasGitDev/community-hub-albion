import "reflect-metadata";
import { Module, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createDb, getLedgerBalance, listLedgerEntries, listUserNotes, runMigrations, setGameNick, upsertUserByDiscordId, type DbHandle } from "@albion-hub/db";
import { sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule, configureApp } from "../app.module.js";
import { parseEnv, type Env } from "../config/env.js";
import { ALBION_PLAYER_LOOKUP } from "../members/albion-lookup.token.js";
import { MAINTENANCE_RATE_LIMIT, MAINTENANCE_TOKEN_HEADER } from "./maintenance-token.guard.js";
import { MAINTENANCE_CLEANUP, type MaintenanceCleanup } from "./maintenance.tokens.js";

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: testes HTTP de manutenção não podem ser pulados");

const TOKEN = "manutencao-super-secreta-com-mais-de-32";
const PUBLIC_URL = "http://localhost:3000";

const envFor = (databaseUrl: string, overrides: Record<string, string | undefined> = {}): Env => {
  const parsed = parseEnv({
    DISCORD_TOKEN: "a.b.c",
    GUILD_ID: "123456789012345678",
    DATABASE_URL: databaseUrl,
    NODE_ENV: "test",
    DISCORD_CLIENT_ID: "223456789012345678",
    DISCORD_CLIENT_SECRET: "secret",
    DISCORD_MEMBER_ROLE_ID: "323456789012345678",
    DISCORD_STAFF_CHANNEL_ID: "423456789012345678",
    DISCORD_EVENTS_CHANNEL_ID: "523456789012345678",
    DISCORD_WAITING_VOICE_CHANNEL_ID: "623456789012345678",
    DISCORD_EVENT_CATEGORY_ID: "723456789012345678",
    PUBLIC_URL,
    ...overrides,
  });
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.env;
};

/**
 * Namespace de manutenção (TASK-048, G5). O que estes testes provam, além das três operações: a recusa
 * não conta nada a quem sonda, o namespace some sem o segredo, o token não vaza e ninguém vira outro usuário.
 */
describe.skipIf(!baseUrl)("/api/maintenance (TASK-048)", () => {
  let handle: DbHandle;
  let dbUrl: string;
  let seq = 0;
  const cleanup: MaintenanceCleanup = { run: vi.fn(async () => ({ sessionsRevoked: 2 })) };
  const lookup = { lookup: vi.fn() };

  /**
   * Dublê do módulo que a TASK-049 vai escrever: global e exportando `MAINTENANCE_CLEANUP`. Se este
   * teste passa, plugar a limpeza de verdade não exige tocar em nada do namespace.
   */
  @Module({ providers: [{ provide: MAINTENANCE_CLEANUP, useValue: cleanup }], exports: [MAINTENANCE_CLEANUP] })
  class CleanupStubModule {}

  const buildApp = async (env: Env, options: { withCleanup?: boolean } = {}) => {
    const builder = Test.createTestingModule({
      imports: [...(options.withCleanup ? [{ module: CleanupStubModule, global: true }] : []), AppModule.register(env, { bot: false })],
    });
    builder.overrideProvider(ALBION_PLAYER_LOOKUP).useValue(lookup);
    const app = configureApp((await builder.compile()).createNestApplication({ logger: false }));
    await app.listen(0, "127.0.0.1");
    return app;
  };

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_server_maintenance`;
    target.pathname = `/${name}`;
    const admin = createDb(baseUrl!, { max: 1 });
    await admin.db.execute(sql.raw(`drop database if exists "${name}" with (force)`));
    await admin.db.execute(sql.raw(`create database "${name}"`));
    await admin.close();
    dbUrl = target.toString();
    await runMigrations(dbUrl);
    handle = createDb(dbUrl);
  }, 60_000);

  afterAll(async () => {
    await handle?.close();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  async function member(nick?: string) {
    const discordId = `9600000000000000${String(++seq).padStart(2, "0")}`;
    const user = await upsertUserByDiscordId(handle.db, { discordId, discordUsername: `m${seq}` });
    if (nick) await setGameNick(handle.db, user.id, nick);
    return user;
  }

  /** App com o namespace ligado, recriado a cada bloco para a janela do rate limit nascer zerada. */
  async function withApp<T>(run: (app: INestApplication) => Promise<T>, options: { withCleanup?: boolean } = {}): Promise<T> {
    const app = await buildApp(envFor(dbUrl, { MAINTENANCE_TOKEN: TOKEN }), options);
    try {
      return await run(app);
    } finally {
      await app.close();
    }
  }

  const post = (app: INestApplication, path: string, token: string | null, body: unknown = {}) => {
    const req = request(app.getHttpServer()).post(path).send(body as object);
    if (token !== null) req.set(MAINTENANCE_TOKEN_HEADER, token);
    return req;
  };

  describe("guard do namespace (AC#1, AC#5, AC#6)", () => {
    it("token ausente, vazio e errado devolvem exatamente a mesma resposta", async () => {
      await withApp(async (app) => {
        const bodies: unknown[] = [];
        for (const token of [null, "", " ", "chute", TOKEN.slice(0, -1), `${TOKEN}x`]) {
          const res = await post(app, "/api/maintenance/silver", token, { userId: "x" });
          expect(res.status).toBe(404);
          bodies.push(res.body);
        }
        expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
      });
    });

    it("a recusa é idêntica à de uma rota que não existe: o sonda não descobre o namespace", async () => {
      await withApp(async (app) => {
        const refused = await post(app, "/api/maintenance/silver", "chute", { userId: "x" });
        const inexistente = await request(app.getHttpServer()).post("/api/maintenance/silver").send({});
        const outraRota = await request(app.getHttpServer()).post("/api/rota-que-nunca-existiu").send({});
        expect(refused.body).toEqual(inexistente.body);
        expect(Object.keys(refused.body).sort()).toEqual(Object.keys(outraRota.body).sort());
        expect(outraRota.status).toBe(404);
      });
    });

    it("sem MAINTENANCE_TOKEN no env o namespace inteiro não existe (AC#5)", async () => {
      const app = await buildApp(envFor(dbUrl));
      try {
        for (const path of ["/api/maintenance/silver", "/api/maintenance/albion-check", "/api/maintenance/cleanup"]) {
          // Nem com o token certo: não há rota registrada.
          const res = await post(app, path, TOKEN, { userId: "x" });
          expect(res.status).toBe(404);
        }
        // E a resposta é a mesma do namespace ligado com token errado: os dois estados são indistinguíveis.
        const off = (await post(app, "/api/maintenance/silver", TOKEN, {})).body;
        const on = await withApp(async (ligado) => (await post(ligado, "/api/maintenance/silver", "chute", {})).body);
        expect(off).toEqual(on);
      } finally {
        await app.close();
      }
    });

    it("o token não aparece na resposta nem em log (AC#6)", async () => {
      await withApp(async (app) => {
        const errors: string[] = [];
        const spies = (["log", "warn", "error", "debug", "info"] as const).map((level) =>
          vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void errors.push(args.map(String).join(" "))),
        );
        try {
          const refused = await post(app, "/api/maintenance/silver", `${TOKEN}-errado`, { userId: "x" });
          const user = await member();
          const ok = await post(app, "/api/maintenance/silver", TOKEN, { userId: user.id, amount: "10", reason: "teste de vazamento" });
          for (const res of [refused, ok]) {
            const dump = JSON.stringify({ body: res.body, headers: res.headers });
            expect(dump).not.toContain(TOKEN);
            expect(dump.toLowerCase()).not.toContain(MAINTENANCE_TOKEN_HEADER);
          }
          expect(errors.join("\n")).not.toContain(TOKEN);
        } finally {
          for (const spy of spies) spy.mockRestore();
        }
      });
    });

    it("rate limit corta o abuso de um token vazado", async () => {
      await withApp(async (app) => {
        let blocked: request.Response | null = null;
        for (let i = 0; i < MAINTENANCE_RATE_LIMIT.limit + 1; i++) {
          const res = await post(app, "/api/maintenance/silver", TOKEN, {});
          if (res.status === 429) blocked = res;
        }
        expect(blocked).not.toBeNull();
        expect(blocked!.headers["retry-after"]).toBeDefined();
        // Quem não tem o token continua levando 404: ninguém de fora gasta a cota nem descobre o 429.
        expect((await post(app, "/api/maintenance/silver", "chute", {})).status).toBe(404);
      });
    });
  });

  describe("ajuste de prata (AC#2)", () => {
    it("credita e debita pelo ledger, com motivo no memo, e aparece no extrato", async () => {
      await withApp(async (app) => {
        const user = await member();
        const credit = await post(app, "/api/maintenance/silver", TOKEN, { userId: user.id, amount: "1500000", reason: "acerto do split 12" }).expect(201);
        expect(credit.body).toMatchObject({ userId: user.id, amount: "1500000", balance: "1500000" });

        const debit = await post(app, "/api/maintenance/silver", TOKEN, { userId: user.id, amount: "-500000", reason: "estorno de duplicidade" }).expect(201);
        expect(debit.body.balance).toBe("1000000");

        expect(await getLedgerBalance(handle.db, user.id, "silver")).toBe(1_000_000n);
        const page = await listLedgerEntries(handle.db, user.id, "silver", {});
        expect(page.entries).toHaveLength(2);
        for (const entry of page.entries) {
          expect(entry.kind).toBe("adjustment");
          expect(entry.referenceType).toBe("manual");
          expect(entry.referenceId).toBe("maintenance");
          // Autoria de manutenção: não existe pessoa logada por trás, e o motivo fica no lançamento.
          expect(entry.createdBy).toBeNull();
          expect(entry.memo).toMatch(/^Manutenção: /);
        }
        const notes = await listUserNotes(handle.db, user.id);
        expect(notes.map((n) => n.body).join("\n")).toContain("acerto do split 12");
        expect(notes.every((n) => n.kind === "system" && n.author === null)).toBe(true);
      });
    });

    it("recusa sem motivo, com valor zero e com usuário inexistente", async () => {
      await withApp(async (app) => {
        const user = await member();
        await post(app, "/api/maintenance/silver", TOKEN, { userId: user.id, amount: "100" }).expect(400);
        await post(app, "/api/maintenance/silver", TOKEN, { userId: user.id, amount: "100", reason: "   " }).expect(400);
        await post(app, "/api/maintenance/silver", TOKEN, { userId: user.id, amount: "0", reason: "nada" }).expect(400);
        await post(app, "/api/maintenance/silver", TOKEN, { userId: "não-uuid", amount: "100", reason: "x" }).expect(400);
        await post(app, "/api/maintenance/silver", TOKEN, { userId: "11111111-1111-1111-1111-111111111111", amount: "100", reason: "x" }).expect(404);
        // Nenhuma recusa deixou lançamento para trás: o ledger não ganhou linha.
        expect(await getLedgerBalance(handle.db, user.id, "silver")).toBe(0n);
      });
    });
  });

  describe("revalidação de nick (AC#3)", () => {
    it("consulta o Albion e grava o resultado no membro", async () => {
      await withApp(async (app) => {
        const user = await member("Erijj");
        lookup.lookup.mockResolvedValue({ status: "found", playerId: "p-1", guildName: "Genei", checkedAt: "2026-09-16T10:00:00.000Z" });
        const res = await post(app, "/api/maintenance/albion-check", TOKEN, { userId: user.id }).expect(201);
        expect(res.body.albion).toMatchObject({ status: "found", playerId: "p-1", guildName: "Genei" });
        expect(lookup.lookup).toHaveBeenCalledWith("Erijj");
        const row = await handle.db.query.users.findFirst({ where: (u, { eq }) => eq(u.id, user.id) });
        expect(row!.albionStatus).toBe("found");
        expect(row!.albionPlayerId).toBe("p-1");
      });
    });

    it("membro sem nick é 400 e membro inexistente é 404", async () => {
      await withApp(async (app) => {
        const semNick = await member();
        await post(app, "/api/maintenance/albion-check", TOKEN, { userId: semNick.id }).expect(400);
        await post(app, "/api/maintenance/albion-check", TOKEN, { userId: "11111111-1111-1111-1111-111111111111" }).expect(404);
      });
    });
  });

  describe("disparo da limpeza (AC#3, TASK-049)", () => {
    it("sem o ponto de extensão registrado responde 503 e não finge ter rodado", async () => {
      await withApp(async (app) => {
        const res = await post(app, "/api/maintenance/cleanup", TOKEN).expect(503);
        expect(res.body.message).toContain("TASK-049");
      });
    });

    it("com o ponto de extensão registrado chama a limpeza e devolve o resumo", async () => {
      await withApp(
        async (app) => {
          const res = await post(app, "/api/maintenance/cleanup", TOKEN).expect(200);
          expect(res.body).toEqual({ result: { sessionsRevoked: 2 } });
          expect(cleanup.run).toHaveBeenCalledTimes(1);
        },
        { withCleanup: true },
      );
    });
  });

  describe("o namespace não vira ninguém (AC#4)", () => {
    it("não devolve cookie de sessão, não cria sessão e ignora cookie enviado", async () => {
      await withApp(async (app) => {
        const alvo = await member();
        const antes = await handle.db.execute(sql`select count(*)::int as n from sessions`);
        const res = await post(app, "/api/maintenance/silver", TOKEN, { userId: alvo.id, amount: "1", reason: "sem sessão" })
          .set("Cookie", "ah_session=qualquer-coisa")
          .expect(201);
        expect(res.headers["set-cookie"]).toBeUndefined();
        const depois = await handle.db.execute(sql`select count(*)::int as n from sessions`);
        expect(depois).toEqual(antes);
        // O alvo é paciente da operação, nunca ator: o lançamento é dele e não há "logado como".
        expect(res.body.userId).toBe(alvo.id);
      });
    });

    it("não existe rota de login, de sessão nem de agir como outro usuário no namespace", async () => {
      await withApp(async (app) => {
        for (const path of ["/api/maintenance/login", "/api/maintenance/session", "/api/maintenance/impersonate", "/api/maintenance/dev-login"]) {
          expect((await post(app, path, TOKEN, {})).status).toBe(404);
        }
      });
    });
  });
});
