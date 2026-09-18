import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createDb, createSession, getLedgerBalance, grantRole, runMigrations, setGameNick, upsertUserByDiscordId, type DbHandle } from "@albion-hub/db";
import { REFERRAL_BONUS, REFERRAL_MONTHLY_REWARD_CAP } from "@albion-hub/shared";
import { sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule, configureApp } from "../app.module.js";
import { parseEnv } from "../config/env.js";
import { ALBION_PLAYER_LOOKUP } from "./albion-lookup.token.js";
import { NickDecisionService } from "./nick-decision.service.js";
import { NickRegistrationService } from "./nick-registration.service.js";
import { ReferralService } from "./referral.service.js";

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: testes da indicação não podem ser pulados");

const GUILD = "123456789012345678";
const PUBLIC_URL = "http://localhost:3000";
const hangingAlbion = { lookup: () => new Promise<never>(() => undefined) };

/**
 * Serviço interno da indicação (TASK-074): é ele que bot e painel chamam, e é aqui que as recusas
 * úteis e o momento do pagamento são provados. O pagamento no instante da **aprovação do nick** passa
 * pelo caminho de verdade — `NickDecisionService.approve` —, não por uma chamada direta ao settle.
 */
describe.skipIf(!baseUrl)("Indicação: serviço e rota da staff (TASK-074, Postgres real)", () => {
  let app: INestApplication;
  let handle: DbHandle;
  let referrals: ReferralService;
  let registration: NickRegistrationService;
  let decisions: NickDecisionService;
  let seq = 0;

  const newUser = async (nick: string | null) => {
    const n = ++seq;
    const discordId = `7420000000000000${String(n).padStart(2, "0")}`;
    const user = await upsertUserByDiscordId(handle.db, { discordId, discordUsername: `svc${n}` });
    await grantRole(handle.db, user.id, "member");
    if (nick) await setGameNick(handle.db, user.id, nick);
    return { id: user.id, discordId, nick };
  };

  const buffunfa = (id: string) => getLedgerBalance(handle.db, id, "buffunfa");

  /** Registro + aprovação pelo caminho real: é a aprovação que libera o dinheiro (F11). */
  const approveNickFor = async (userId: string, nick: string, staffId: string) => {
    const result = await registration.register(userId, nick);
    if (result.kind !== "requested") throw new Error(`registro inesperado: ${result.kind}`);
    const decided = await decisions.approve(result.request.id, staffId);
    if (!decided.ok) throw new Error(decided.reason);
  };

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_server_referral`;
    target.pathname = `/${name}`;
    const admin = createDb(baseUrl!, { max: 1 });
    await admin.db.execute(sql.raw(`drop database if exists "${name}" with (force)`));
    await admin.db.execute(sql.raw(`create database "${name}"`));
    await admin.close();
    await runMigrations(target.toString());
    handle = createDb(target.toString());
    const parsed = parseEnv({
      DISCORD_TOKEN: "a.b.c",
      GUILD_ID: GUILD,
      DATABASE_URL: target.toString(),
      NODE_ENV: "test",
      DISCORD_CLIENT_ID: "223456789012345678",
      DISCORD_CLIENT_SECRET: "secret",
      DISCORD_MEMBER_ROLE_ID: "323456789012345678",
      DISCORD_STAFF_CHANNEL_ID: "423456789012345678",
      DISCORD_EVENTS_CHANNEL_ID: "523456789012345678",
      DISCORD_WAITING_VOICE_CHANNEL_ID: "623456789012345678",
      DISCORD_EVENT_CATEGORY_ID: "723456789012345678",
      PUBLIC_URL,
    });
    if (!parsed.ok) throw new Error(parsed.message);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.register(parsed.env, { bot: false })] })
      .overrideProvider(ALBION_PLAYER_LOOKUP)
      .useValue(hangingAlbion)
      .compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.listen(0, "127.0.0.1");
    referrals = app.get(ReferralService);
    registration = app.get(NickRegistrationService);
    decisions = app.get(NickDecisionService);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await handle?.close();
  });

  it("recusa autoindicação, com mensagem que diz o que fazer (AC#4)", async () => {
    const solo = await newUser("Solo074");
    expect(await referrals.declare(solo.id, "solo074")).toEqual({ kind: "self" });
    expect(await buffunfa(solo.id)).toBe(0n);
  });

  it("recusa indicar quem não tem conta no painel, dizendo como resolver (AC#5)", async () => {
    const quem = await newUser("QuemDeclara");
    expect(await referrals.declare(quem.id, "NickSemConta")).toEqual({ kind: "referrer_not_found", nick: "NickSemConta" });
  });

  describe("pelo @ do membro (TASK-075)", () => {
    it("declara pelo ID do Discord que o seletor de membros entrega", async () => {
      const referrer = await newUser("IndPeloArroba");
      const referred = await newUser("IndicadoPorArroba");
      expect(await referrals.declareByDiscordId(referred.id, referrer.discordId, "Ind no Discord")).toMatchObject({
        kind: "declared",
        referrerNick: "IndPeloArroba",
      });
    });

    it("quem existe no Discord mas nunca entrou no painel é recusado pelo nome que o Discord mostrou", async () => {
      const referred = await newUser("IndicadoDeFantasma");
      expect(await referrals.declareByDiscordId(referred.id, "999999999999999999", "Fulano")).toEqual({ kind: "referrer_not_registered", name: "Fulano" });
    });

    it("autoindicação pelo @ continua recusada", async () => {
      const quem = await newUser("ArrobaEuMesmo");
      expect(await referrals.declareByDiscordId(quem.id, quem.discordId, "eu")).toEqual({ kind: "self" });
    });

    it("quem já declarou não troca de indicador pelo @", async () => {
      const primeiro = await newUser("PrimeiroArroba");
      const segundo = await newUser("SegundoArroba");
      const referred = await newUser("IndicadoArrobaDuasVezes");
      await referrals.declareByDiscordId(referred.id, primeiro.discordId, "primeiro");
      expect(await referrals.declareByDiscordId(referred.id, segundo.discordId, "segundo")).toEqual({ kind: "already_declared", referrerNick: "PrimeiroArroba" });
    });
  });

  it("recusa nick inválido antes de tocar no banco", async () => {
    const quem = await newUser("NickInvalido");
    expect(await referrals.declare(quem.id, "ab")).toMatchObject({ kind: "invalid" });
  });

  it("declara uma vez só: a segunda tentativa devolve o que já está gravado (AC#3)", async () => {
    await newUser("PrimeiroInd");
    const outro = await newUser("OutroInd");
    const indicado = await newUser("IndicadoUmaVez");

    expect(await referrals.declare(indicado.id, "primeiroind")).toMatchObject({ kind: "declared", referrerNick: "PrimeiroInd" });
    expect(await referrals.declare(indicado.id, "OutroInd")).toEqual({ kind: "already_declared", referrerNick: "PrimeiroInd" });
    // A segunda tentativa não move dinheiro nenhum: quem ficou de fora continua zerado.
    expect(await buffunfa(outro.id)).toBe(0n);
  });

  it("declaração retroativa de quem já tem nick aprovado paga na hora (AC#6)", async () => {
    const referrer = await newUser("IndRetroativo");
    const referred = await newUser("IndicadoRetro");

    const outcome = await referrals.declare(referred.id, "indretroativo");

    expect(outcome).toMatchObject({ kind: "declared", reward: { kind: "paid" } });
    expect(await buffunfa(referrer.id)).toBe(REFERRAL_BONUS.referrer);
    expect(await buffunfa(referred.id)).toBe(REFERRAL_BONUS.referred);
  });

  it("declarar antes do nick não paga; a aprovação da staff é que paga (AC#6)", async () => {
    const staff = await newUser("StaffQueAprova");
    const referrer = await newUser("IndAntesDoNick");
    const referred = await newUser(null);

    expect(await referrals.declare(referred.id, "indantesdonick")).toMatchObject({ kind: "declared", reward: { kind: "pending" } });
    expect(await buffunfa(referrer.id)).toBe(0n);

    await approveNickFor(referred.id, "AprovadoDepois", staff.id);

    // O hook da decisão roda antes de `approve` voltar: quando a staff clica, o dinheiro já saiu.
    expect(await buffunfa(referrer.id)).toBe(REFERRAL_BONUS.referrer);
    expect(await buffunfa(referred.id)).toBe(REFERRAL_BONUS.referred);
  });

  it("aprovar o nick duas vezes não paga duas vezes", async () => {
    const staff = await newUser("StaffDobrada");
    const referrer = await newUser("IndDobrada");
    const referred = await newUser(null);
    await referrals.declare(referred.id, "inddobrada");

    await approveNickFor(referred.id, "PrimeiraAprov", staff.id);
    // Troca de nick aprovada depois: é o mesmo hook de novo, e a indicação já foi liquidada.
    await approveNickFor(referred.id, "SegundaAprov", staff.id);

    expect(await buffunfa(referrer.id)).toBe(REFERRAL_BONUS.referrer);
    expect(await buffunfa(referred.id)).toBe(REFERRAL_BONUS.referred);
  });

  it("estourado o teto do mês, o indicador não recebe e o indicado recebe (AC#7)", async () => {
    const referrer = await newUser("IndNoTeto");
    for (let i = 0; i < REFERRAL_MONTHLY_REWARD_CAP; i += 1) {
      const referred = await newUser(`TetoCheio${i}`);
      expect(await referrals.declare(referred.id, "indnoteto")).toMatchObject({ reward: { kind: "paid" } });
    }
    const excedente = await newUser("TetoExcedente");

    const outcome = await referrals.declare(excedente.id, "indnoteto");

    expect(outcome).toMatchObject({ kind: "declared", reward: { kind: "paid_referred_only", reason: "monthly_cap" } });
    expect(await buffunfa(referrer.id)).toBe(REFERRAL_BONUS.referrer * BigInt(REFERRAL_MONTHLY_REWARD_CAP));
    expect(await buffunfa(excedente.id)).toBe(REFERRAL_BONUS.referred);
    // Registrada mesmo sem pagar: o vínculo é o que a staff precisa enxergar depois.
    expect((await referrals.list(excedente.id)).declared).toMatchObject({ referrerPaid: false });
  });

  describe("rota da staff (AC#8)", () => {
    const session = async (userId: string) => (await createSession(handle.db, userId, new Date(Date.now() + 3_600_000))).token;
    const http = () => request(app.getHttpServer());

    it("staff lê as indicações do membro e estorna uma paga por engano", async () => {
      const staff = await newUser("StaffIndicacao");
      await grantRole(handle.db, staff.id, "staff");
      const token = await session(staff.id);
      const referrer = await newUser("IndParaEstorno");
      const referred = await newUser("IndicadoParaEstorno");
      await referrals.declare(referred.id, "indparaestorno");

      const listed = await http().get(`/api/admin/members/${referred.id}/referrals`).set("Cookie", `ah_session=${token}`).expect(200);
      expect(listed.body.declared).toMatchObject({ referrerPaid: true, reversed: false, referrer: { gameNick: "IndParaEstorno" } });

      const reason = "o indicado declarou o nick errado e o bônus foi para outra pessoa";
      const reversed = await http()
        .post(`/api/admin/members/${referred.id}/referrals/reverse`)
        .set("Origin", PUBLIC_URL)
        .set("Cookie", `ah_session=${token}`)
        .send({ reason })
        .expect(200);

      expect(reversed.body.declared).toMatchObject({ reversed: true });
      // Estorno é lançamento novo dos dois lados: nenhum lançamento foi editado nem apagado.
      expect(await buffunfa(referrer.id)).toBe(0n);
      expect(await buffunfa(referred.id)).toBe(0n);
      // Estornar de novo é recusado, e não cria um terceiro par de lançamentos.
      const again = await http().post(`/api/admin/members/${referred.id}/referrals/reverse`).set("Origin", PUBLIC_URL).set("Cookie", `ah_session=${token}`).send({ reason });
      console.log("AGAIN", again.status, JSON.stringify(again.body));
      expect(again.status).toBe(409);
      expect(await buffunfa(referrer.id)).toBe(0n);
    });

    it("estorno sem motivo é recusado", async () => {
      const staff = await newUser("StaffSemMotivo");
      await grantRole(handle.db, staff.id, "staff");
      const token = await session(staff.id);
      const referrer = await newUser("IndSemMotivo");
      const referred = await newUser("IndicadoSemMotivo");
      await referrals.declare(referred.id, "indsemmotivo");

      await http().post(`/api/admin/members/${referred.id}/referrals/reverse`).set("Origin", PUBLIC_URL).set("Cookie", `ah_session=${token}`).send({ reason: "   " }).expect(400);
      expect(await buffunfa(referrer.id)).toBe(REFERRAL_BONUS.referrer);
    });

    it("membro comum não lê nem estorna indicação alheia", async () => {
      const membro = await newUser("MembroComum074");
      const token = await session(membro.id);
      const referred = await newUser("AlvoDoMembro");

      await http().get(`/api/admin/members/${referred.id}/referrals`).set("Cookie", `ah_session=${token}`).expect(403);
      await http().post(`/api/admin/members/${referred.id}/referrals/reverse`).set("Origin", PUBLIC_URL).set("Cookie", `ah_session=${token}`).send({ reason: "quero" }).expect(403);
    });

    it("sem sessão não há leitura de indicação", async () => {
      const referred = await newUser("AlvoSemSessao");
      await http().get(`/api/admin/members/${referred.id}/referrals`).expect(401);
    });
  });
});
