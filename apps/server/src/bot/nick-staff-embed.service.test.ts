import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { createDb, grantRole, runMigrations, schema, setGameNick, upsertUserByDiscordId, type DbHandle } from "@albion-hub/db";
import type { Role } from "@albion-hub/shared";
import { MessageFlags } from "discord.js";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DB_HANDLE } from "../db/db.module.js";
import { NICK_BUTTON_REPLIES, NICK_EMBED_COLORS, type NickEmbedView } from "../domain/nick-embed.js";
import { NickDecisionService, type NickDecidedEvent } from "../members/nick-decision.service.js";
import { NickRequestService } from "../members/nick-request.service.js";
import { ALBION_PLAYER_LOOKUP } from "../members/albion-lookup.token.js";
import type { AlbionLookupResult } from "@albion-hub/shared";
import { NickEmbedInteractions, type ButtonInteractionLike, type ModalInteractionLike } from "./nick-embed.interactions.js";
import { NickStaffEmbedService } from "./nick-staff-embed.service.js";
import { STAFF_CHANNEL_GATEWAY, type StaffChannelGateway } from "./staff-channel.gateway.js";

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: testes do embed da staff não podem ser pulados");

const discordError = (code: number, message: string) => Object.assign(new Error(message), { code });
const status = (view: NickEmbedView | undefined) => view?.fields.find((f) => f.name === "Status")?.value;

function fakeInteraction(discordId: string, note?: string) {
  return {
    user: { id: discordId },
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    showModal: vi.fn().mockResolvedValue(undefined),
    fields: { getTextInputValue: vi.fn().mockReturnValue(note ?? "") },
  } satisfies ButtonInteractionLike & ModalInteractionLike;
}

describe.skipIf(!baseUrl)("embed de pedido de nick com botões (TASK-015, Postgres real + Discord falso)", () => {
  let handle: DbHandle;
  let requests: NickRequestService;
  let decisions: NickDecisionService;
  let embeds: NickStaffEmbedService;
  let interactions: NickEmbedInteractions;
  let close: () => Promise<void>;
  let seq = 0;
  const gateway = { postNickRequest: vi.fn<StaffChannelGateway["postNickRequest"]>(), editNickRequest: vi.fn<StaffChannelGateway["editNickRequest"]>() };
  const decided: NickDecidedEvent[] = [];
  const albion = { lookup: vi.fn<(nick: string) => Promise<AlbionLookupResult>>() };

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_server_staff_embed`;
    target.pathname = `/${name}`;
    const admin = createDb(baseUrl!, { max: 1 });
    await admin.db.execute(sql.raw(`drop database if exists "${name}" with (force)`));
    await admin.db.execute(sql.raw(`create database "${name}"`));
    await admin.close();
    await runMigrations(target.toString());
    handle = createDb(target.toString());
    const moduleRef = await Test.createTestingModule({
      providers: [
        NickRequestService,
        NickDecisionService,
        NickStaffEmbedService,
        NickEmbedInteractions,
        { provide: DB_HANDLE, useValue: handle },
        { provide: STAFF_CHANNEL_GATEWAY, useValue: gateway },
        { provide: ALBION_PLAYER_LOOKUP, useValue: albion },
      ],
    }).compile();
    moduleRef.useLogger(false);
    const app = await moduleRef.init();
    requests = moduleRef.get(NickRequestService);
    decisions = moduleRef.get(NickDecisionService);
    embeds = moduleRef.get(NickStaffEmbedService);
    interactions = moduleRef.get(NickEmbedInteractions);
    // Simula o DiscordMemberSync (TASK-014): o hook de decisão precisa disparar igual ao painel.
    decisions.onDecided((e) => void decided.push(e));
    close = () => app.close();
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await handle?.close();
  });

  let posted = 0;
  beforeEach(() => {
    decided.length = 0;
    gateway.postNickRequest.mockReset().mockImplementation(async () => `77700000000000${String(++posted).padStart(4, "0")}`);
    gateway.editNickRequest.mockReset().mockResolvedValue(undefined);
    albion.lookup.mockReset().mockResolvedValue({ status: "disabled" });
  });

  async function user(roles: Role[], gameNick: string | null = null) {
    seq++;
    const discordId = `53000000000000${String(seq).padStart(4, "0")}`;
    const u = await upsertUserByDiscordId(handle.db, { discordId, discordUsername: `e${seq}` });
    for (const role of roles) await grantRole(handle.db, u.id, role);
    if (gameNick) await setGameNick(handle.db, u.id, gameNick);
    return { ...u, discordId };
  }
  const rowOf = async (id: string) => (await handle.db.select().from(schema.nickRequests).where(eq(schema.nickRequests.id, id)))[0]!;
  const logger = (service: object) => vi.spyOn((service as { logger: { error: (m: string) => void } }).logger, "error").mockImplementation(() => {});
  const lastEdit = () => gateway.editNickRequest.mock.calls.at(-1);

  it("pedido novo publica embed no canal e guarda o message id; correção edita a mesma mensagem (AC#1)", async () => {
    const member = await user(["member"], "Velho");
    const { request } = await requests.request(member.id, "Novo");
    expect(gateway.postNickRequest).toHaveBeenCalledTimes(1);
    const view = gateway.postNickRequest.mock.calls[0]![0];
    expect(view.title).toBe("Novo pedido de nick");
    expect(view.fields).toContainEqual({ name: "Membro", value: `<@${member.discordId}>`, inline: true });
    expect(view.fields).toContainEqual({ name: "Nick", value: "Velho → Novo", inline: true });
    expect(view.buttons.map((b) => b.customId)).toEqual([`nick/approve/${request.id}`, `nick/reject/${request.id}`]);
    const messageId = (await rowOf(request.id)).discordMessageId;
    expect(messageId).toMatch(/^777/);

    await requests.request(member.id, "Corrigido");
    expect(gateway.postNickRequest).toHaveBeenCalledTimes(1);
    expect(lastEdit()![0]).toBe(messageId);
    expect(lastEdit()![1].fields).toContainEqual({ name: "Nick", value: "Velho → Corrigido", inline: true });
  });

  it("aprovar pelo botão = painel: nick vigente, auditoria, hook de decisão e embed sem botões (AC#2, AC#4)", async () => {
    const member = await user(["member"]);
    const staff = await user(["staff"]);
    const { request } = await requests.request(member.id, "PeloBotao");
    const click = fakeInteraction(staff.discordId);
    await interactions.onApprove([click], request.id);

    expect(click.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(click.editReply).toHaveBeenCalledWith({ content: "Nick PeloBotao aprovado." });
    const row = await rowOf(request.id);
    expect(row).toMatchObject({ status: "approved", decidedBy: staff.id, decisionNote: null });
    expect(row.decidedAt).toBeInstanceOf(Date);
    const [u] = await handle.db.select().from(schema.users).where(eq(schema.users.id, member.id));
    expect(u!.gameNick).toBe("PeloBotao");
    expect(decided).toEqual([expect.objectContaining({ decision: "approved", previousGameNick: null, deciderUserId: staff.id })]);
    const [messageId, view] = lastEdit()!;
    expect(messageId).toBe(row.discordMessageId);
    expect(view).toMatchObject({ title: "Pedido de nick aprovado", color: NICK_EMBED_COLORS.approved, buttons: [] });
    expect(status(view)).toMatch(new RegExp(`^Aprovado por <@${staff.discordId}> em <t:\\d+:f>$`));
  });

  it("clique de quem não é staff ou não tem conta é recusado efêmero, sem mudar nada (AC#3)", async () => {
    const member = await user(["member"]);
    const caller = await user(["member", "caller"]);
    const { request } = await requests.request(member.id, "Intruso");
    for (const discordId of [member.discordId, caller.discordId]) {
      const click = fakeInteraction(discordId, "motivo");
      await interactions.onApprove([click], request.id);
      await interactions.onReject([click], request.id);
      await interactions.onRejectSubmit([click], request.id);
      expect(click.reply).toHaveBeenCalledTimes(3);
      expect(click.reply).toHaveBeenCalledWith({ content: NICK_BUTTON_REPLIES.notStaff, flags: MessageFlags.Ephemeral });
      expect(click.showModal).not.toHaveBeenCalled();
      expect(click.deferReply).not.toHaveBeenCalled();
    }
    const stranger = fakeInteraction("539999999999999999");
    await interactions.onApprove([stranger], request.id);
    expect(stranger.reply).toHaveBeenCalledWith({ content: NICK_BUTTON_REPLIES.notRegistered, flags: MessageFlags.Ephemeral });
    expect(await rowOf(request.id)).toMatchObject({ status: "pending", decidedBy: null });
    expect(decided).toEqual([]);
    expect(gateway.editNickRequest).not.toHaveBeenCalled();
  });

  it("recusar abre modal; envio com motivo recusa igual ao painel e embed mostra quem e o motivo (AC#2, AC#4)", async () => {
    const member = await user(["member"], "Mantido");
    const admin = await user(["admin"]);
    const { request } = await requests.request(member.id, "Errado");
    const click = fakeInteraction(admin.discordId);
    await interactions.onReject([click], request.id);
    expect(click.showModal).toHaveBeenCalledWith(
      expect.objectContaining({ custom_id: `nick/reject-modal/${request.id}`, title: "Recusar nick Errado" }),
    );
    const modalField = click.showModal.mock.calls[0]![0].components[0]!.components[0]!;
    expect(modalField).toMatchObject({ custom_id: "note", required: true, min_length: 1, max_length: 300 });

    const empty = fakeInteraction(admin.discordId, "   ");
    await interactions.onRejectSubmit([empty], request.id);
    expect(empty.reply).toHaveBeenCalledWith({ content: expect.stringContaining("motivo"), flags: MessageFlags.Ephemeral });
    expect((await rowOf(request.id)).status).toBe("pending");

    const submit = fakeInteraction(admin.discordId, "  Nick não existe no jogo. ");
    await interactions.onRejectSubmit([submit], request.id);
    expect(submit.editReply).toHaveBeenCalledWith({ content: NICK_BUTTON_REPLIES.rejected("Errado") });
    expect(await rowOf(request.id)).toMatchObject({ status: "rejected", decidedBy: admin.id, decisionNote: "Nick não existe no jogo." });
    const [u] = await handle.db.select().from(schema.users).where(eq(schema.users.id, member.id));
    expect(u!.gameNick).toBe("Mantido");
    const view = lastEdit()![1];
    expect(view).toMatchObject({ color: NICK_EMBED_COLORS.rejected, buttons: [] });
    expect(status(view)).toContain(`Recusado por <@${admin.discordId}>`);
    expect(view.fields).toContainEqual({ name: "Motivo", value: "Nick não existe no jogo." });
  });

  it("decisão pelo painel (serviço) edita o embed; clique depois responde já decidido e atualiza a mensagem (AC#4)", async () => {
    const member = await user(["member"]);
    const staff = await user(["staff"]);
    const { request } = await requests.request(member.id, "Painel");
    await decisions.approve(request.id, staff.id);
    expect(lastEdit()![1].title).toBe("Pedido de nick aprovado");

    gateway.editNickRequest.mockClear();
    const late = fakeInteraction(staff.discordId, "tarde");
    await interactions.onApprove([late], request.id);
    expect(late.editReply).toHaveBeenCalledWith({ content: NICK_BUTTON_REPLIES.alreadyDecided });
    await interactions.onReject([late], request.id);
    expect(late.reply).toHaveBeenCalledWith({ content: NICK_BUTTON_REPLIES.alreadyDecided, flags: MessageFlags.Ephemeral });
    await interactions.onRejectSubmit([late], request.id);
    expect(gateway.editNickRequest).toHaveBeenCalledTimes(3);
    expect(await rowOf(request.id)).toMatchObject({ status: "approved" });
  });

  it("id inválido ou inexistente responde efêmero sem tocar o banco", async () => {
    const staff = await user(["staff"]);
    const bad = fakeInteraction(staff.discordId);
    await interactions.onApprove([bad], "nao-uuid");
    await interactions.onReject([bad], "nao-uuid");
    expect(bad.reply).toHaveBeenNthCalledWith(1, { content: NICK_BUTTON_REPLIES.invalid, flags: MessageFlags.Ephemeral });
    expect(bad.reply).toHaveBeenNthCalledWith(2, { content: NICK_BUTTON_REPLIES.invalid, flags: MessageFlags.Ephemeral });
    const missing = fakeInteraction(staff.discordId);
    await interactions.onApprove([missing], "00000000-0000-4000-8000-000000000000");
    expect(missing.editReply).toHaveBeenCalledWith({ content: NICK_BUTTON_REPLIES.notFound });
    await interactions.onReject([missing], "00000000-0000-4000-8000-000000000000");
    expect(missing.reply).toHaveBeenCalledWith({ content: NICK_BUTTON_REPLIES.notFound, flags: MessageFlags.Ephemeral });
  });

  it("falha do Discord não quebra pedido nem decisão; mensagem apagada é republicada (gateway falho)", async () => {
    const log = logger(embeds);
    const member = await user(["member"]);
    const staff = await user(["staff"]);
    gateway.postNickRequest.mockRejectedValueOnce(discordError(50013, "Missing Permissions"));
    const { request } = await requests.request(member.id, "SemCanal");
    expect((await rowOf(request.id)).discordMessageId).toBeNull();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Bot sem permissão"));

    // Nick corrigido sem mensagem: tenta publicar de novo.
    await requests.request(member.id, "SemCanal2");
    const firstId = (await rowOf(request.id)).discordMessageId;
    expect(firstId).toMatch(/^777/);

    // Mensagem apagada no canal enquanto pendente: republica e troca o id.
    gateway.editNickRequest.mockRejectedValueOnce(discordError(10008, "Unknown Message"));
    await requests.request(member.id, "SemCanal3");
    const secondId = (await rowOf(request.id)).discordMessageId;
    expect(secondId).not.toBe(firstId);

    gateway.editNickRequest.mockRejectedValue(discordError(10008, "Unknown Message"));
    const click = fakeInteraction(staff.discordId);
    await interactions.onApprove([click], request.id);
    expect(click.editReply).toHaveBeenCalledWith({ content: "Nick SemCanal3 aprovado." });
    expect((await rowOf(request.id)).status).toBe("approved");
    expect((await rowOf(request.id)).discordMessageId).toBe(secondId); // decidido não republica
    log.mockRestore();
  });

  it("decidido sem mensagem não publica; erro de banco é logado; onModuleDestroy remove os hooks", async () => {
    const log = logger(embeds);
    const member = await user(["member"]);
    const staff = await user(["staff"]);
    gateway.postNickRequest.mockRejectedValueOnce(new Error("offline"));
    const { request } = await requests.request(member.id, "Offline");
    gateway.postNickRequest.mockClear();
    await decisions.reject(request.id, staff.id, "não");
    expect(gateway.postNickRequest).not.toHaveBeenCalled();
    await embeds.sync("00000000-0000-4000-8000-000000000000");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("não encontrado"));
    const broken = new NickStaffEmbedService(requests, decisions, { db: { select: () => { throw new Error("db down"); } } } as never, gateway, albion);
    const brokenLog = logger(broken);
    await expect(broken.sync(request.id)).resolves.toBeUndefined();
    expect(brokenLog).toHaveBeenCalledWith(expect.stringContaining("db down"));

    embeds.onModuleDestroy();
    await requests.request(member.id, "SemHook");
    expect(gateway.postNickRequest).not.toHaveBeenCalled();
    embeds.onModuleInit();
    log.mockRestore();
  });

  it("erro inesperado na interação responde efêmero genérico", async () => {
    const staff = await user(["staff"]);
    const member = await user(["member"]);
    const { request } = await requests.request(member.id, "Explode");
    const log = logger(interactions);
    const spy = vi.spyOn(decisions, "approve").mockRejectedValueOnce(new Error("boom"));
    const click = fakeInteraction(staff.discordId);
    await interactions.onApprove([click], request.id);
    expect(click.editReply).toHaveBeenCalledWith({ content: NICK_BUTTON_REPLIES.failed });
    const modal = fakeInteraction(staff.discordId);
    modal.showModal.mockRejectedValueOnce(new Error("expired"));
    modal.reply.mockRejectedValueOnce(new Error("expired"));
    await interactions.onReject([modal], request.id);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Não consegui responder"));
    spy.mockRestore();
    log.mockRestore();
  });

  it("embed mostra a consulta Albion; desligada omite; indisponível ou erro não impede publicar (TASK-016 AC#3)", async () => {
    const albionField = (view: NickEmbedView) => view.fields.find((f) => f.name === "Albion")?.value;
    const member = await user(["member"]);
    albion.lookup.mockResolvedValue({ status: "found", region: "americas", playerId: "p1", name: "Achado", guildName: "Guilda X", checkedAt: new Date().toISOString() });
    await requests.request(member.id, "Achado");
    expect(albion.lookup).toHaveBeenCalledWith("Achado");
    expect(albionField(gateway.postNickRequest.mock.calls[0]![0])).toMatch(/^Encontrado no Albion .*guilda Guilda X$/);

    albion.lookup.mockResolvedValue({ status: "unavailable", region: "americas", checkedAt: new Date().toISOString() });
    await requests.request(member.id, "Fora");
    expect(albionField(lastEdit()![1])).toBeTruthy();

    const log = vi.spyOn((embeds as unknown as { logger: { warn: (m: string) => void } }).logger, "warn").mockImplementation(() => {});
    albion.lookup.mockRejectedValue(new Error("boom"));
    await requests.request(member.id, "Explode");
    expect(albionField(lastEdit()![1])).toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("boom"));
    log.mockRestore();

    const other = await user(["member"]);
    albion.lookup.mockResolvedValue({ status: "disabled" });
    await requests.request(other.id, "Desligado");
    expect(albionField(gateway.postNickRequest.mock.calls.at(-1)![0])).toBeUndefined();
  });
});
