import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { createDb, createEvent, grantRole, listEventRoles, listRoles, runMigrations, saveEventTemplate, setGameNick, upsertUserByDiscordId, type DbHandle } from "@albion-hub/db";
import { eventJoinButtonId, eventLeaveButtonId, EVENT_JOIN_BUTTON, EVENT_LEAVE_BUTTON, type EventDto, type Role } from "@albion-hub/shared";
import { ComponentType, MessageFlags } from "discord.js";
import { sql } from "drizzle-orm";
import { MessageComponentDiscovery } from "necord";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_ENV } from "../auth/auth.controller.js";
import { DB_HANDLE } from "../db/db.module.js";
import { AccountService } from "../members/account.service.js";
import type { EmbedView } from "../domain/embed-view.js";
import { EVENT_BUTTON_REPLIES } from "../domain/event-embed.js";
import { EventSignupsService } from "../events/event-signups.service.js";
import { EventsService } from "../events/events.service.js";
import { EventEmbedService } from "./event-embed.service.js";
import { EventSignupInteractions, type EventButtonInteraction } from "./event-signup.interactions.js";
import { EVENTS_CHANNEL_GATEWAY, type EventsChannelGateway } from "./events-channel.gateway.js";
import { TIMELINE_PUBLISHER } from "../domain/timeline.js";
import { FakeTimelinePublisher } from "../timeline/fake-timeline.publisher.js";

const timeline = new FakeTimelinePublisher();

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: testes do embed de evento não podem ser pulados");

const MISSING = "00000000-0000-4000-8000-000000000000";

function fakeInteraction(discordId: string) {
  return {
    user: { id: discordId, username: `user-${discordId.slice(-4)}`, globalName: null, avatar: null },
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  } satisfies EventButtonInteraction;
}

/** Texto que a interação devolveu, tenha ela sido adiada ou não. */
const answer = (i: ReturnType<typeof fakeInteraction>) =>
  (i.editReply.mock.calls.at(-1)?.[0] as { content: string } | undefined)?.content ?? (i.reply.mock.calls.at(-1)?.[0] as { content: string } | undefined)?.content;

const lastView = (calls: { mock: { calls: unknown[][] } }): EmbedView | undefined => calls.mock.calls.at(-1)?.at(-1) as EmbedView | undefined;
const label = (view: EmbedView | undefined, prefix: string) => view?.buttons.find((b) => b.label.startsWith(prefix))?.label;
const fieldValue = (view: EmbedView | undefined, prefix: string) => view?.fields.find((f) => f.name.startsWith(prefix))?.value;

describe.skipIf(!baseUrl)("embed de inscrição no Discord (TASK-022, Postgres real + Discord falso)", () => {
  let handle: DbHandle;
  let events: EventsService;
  let signups: EventSignupsService;
  let embeds: EventEmbedService;
  let interactions: EventSignupInteractions;
  let close: () => Promise<void>;
  let templateId: string;
  let owner: string;
  let seq = 0;
  let posted = 0;
  const gateway = { postEvent: vi.fn<EventsChannelGateway["postEvent"]>(), editEvent: vi.fn<EventsChannelGateway["editEvent"]>() };

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_server_event_embed`;
    target.pathname = `/${name}`;
    const admin = createDb(baseUrl!, { max: 1 });
    await admin.db.execute(sql.raw(`drop database if exists "${name}" with (force)`));
    await admin.db.execute(sql.raw(`create database "${name}"`));
    await admin.close();
    await runMigrations(target.toString());
    handle = createDb(target.toString());
    const moduleRef = await Test.createTestingModule({
      providers: [
        EventsService,
        EventSignupsService,
        EventEmbedService,
        EventSignupInteractions,
        AccountService,
        { provide: DB_HANDLE, useValue: handle },
        { provide: TIMELINE_PUBLISHER, useValue: timeline },
        { provide: AUTH_ENV, useValue: { BOOTSTRAP_ADMIN_DISCORD_IDS: [] } },
        { provide: EVENTS_CHANNEL_GATEWAY, useValue: gateway },
      ],
    }).compile();
    moduleRef.useLogger(false);
    const app = await moduleRef.init();
    events = moduleRef.get(EventsService);
    signups = moduleRef.get(EventSignupsService);
    embeds = moduleRef.get(EventEmbedService);
    interactions = moduleRef.get(EventSignupInteractions);
    close = () => app.close();

    owner = await member("750000000000000001", ["member", "caller"]);
    const roles = await listEventRoles(handle.db);
    const saved = await saveEventTemplate(handle.db, {
      name: "Template do embed",
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
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await handle?.close();
  });

  beforeEach(() => {
    gateway.postEvent.mockReset().mockImplementation(async () => `88800000000000${String(++posted).padStart(4, "0")}`);
    gateway.editEvent.mockReset().mockResolvedValue(undefined);
  });

  async function member(discordId: string, roles: Role[], nick?: string) {
    const user = await upsertUserByDiscordId(handle.db, { discordId, discordUsername: `u${discordId.slice(-4)}` });
    for (const role of roles) await grantRole(handle.db, user.id, role);
    if (nick) await setGameNick(handle.db, user.id, nick);
    return user.id;
  }

  const newMember = (nick?: string) => {
    const discordId = `75000000000000${String(++seq + 10).padStart(4, "0")}`;
    return member(discordId, ["member"], nick).then((id) => ({ id, discordId }));
  };

  /** Cria e abre um evento; a abertura já publica o embed pelo hook de transição. */
  async function openEvent(name: string): Promise<{ event: EventDto; tank: string; healer: string }> {
    const created = await createEvent(handle.db, { templateId, name, description: null, startsAt: null, signupsCloseAt: null, ownerUserId: owner, createdBy: owner });
    if (!created.ok) throw new Error(created.reason);
    const result = await events.transition(created.event.id, "open", owner);
    if (!result.ok) throw new Error("não abriu");
    const event = (await events.get(created.event.id))!;
    return { event, tank: event.roles.find((r) => r.name === "Tank")!.id, healer: event.roles.find((r) => r.name === "Healer")!.id };
  }

  it("abrir o evento publica o embed e guarda o id da mensagem; rascunho não publica (AC#1)", async () => {
    const created = await createEvent(handle.db, { templateId, name: "Ainda rascunho", description: null, startsAt: null, signupsCloseAt: null, ownerUserId: owner, createdBy: owner });
    if (!created.ok) throw new Error(created.reason);
    await embeds.sync(created.event.id);
    expect(gateway.postEvent).not.toHaveBeenCalled();

    const { event } = await openEvent("Publicado ao abrir");
    expect(gateway.postEvent).toHaveBeenCalledTimes(1);
    expect((await events.get(event.id))!.discordMessageId).toBeTruthy();
    const view = lastView(gateway.postEvent);
    expect(view?.title).toBe("Publicado ao abrir");
    expect(label(view, "Tank")).toBe("Tank (1/1)");
    expect(view?.buttons.some((b) => b.label === "Sair")).toBe(true);
  });

  it("botão de role inscreve quem clicou e edita a mensagem com as vagas novas (AC#1/AC#3)", async () => {
    const { event, tank } = await openEvent("Clique do membro");
    const membro = await newMember("TankMain");
    const interaction = fakeInteraction(membro.discordId);
    await interactions.onJoin([interaction], tank);

    expect(answer(interaction)).toBe(EVENT_BUTTON_REPLIES.confirmed("Tank"));
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(gateway.editEvent).toHaveBeenCalled();
    const view = lastView(gateway.editEvent);
    expect(label(view, "Tank")).toBe("Tank (0/1)");
    expect(fieldValue(view, "Tank")).toContain("(TankMain)");
    expect((await signups.list(event.id)).filter((s) => s.status === "confirmed")).toHaveLength(1);

    // Clicar de novo na mesma role não duplica nada.
    const again = fakeInteraction(membro.discordId);
    await interactions.onJoin([again], tank);
    expect(answer(again)).toBe(EVENT_BUTTON_REPLIES.alreadyInRole("Tank"));
  });

  it("role lotada manda para a espera e o embed mostra a fila (AC#2)", async () => {
    const { event, tank } = await openEvent("Fila do tank");
    const primeiro = await newMember();
    const segundo = await newMember();
    await interactions.onJoin([fakeInteraction(primeiro.discordId)], tank);
    const waiting = fakeInteraction(segundo.discordId);
    await interactions.onJoin([waiting], tank);

    expect(answer(waiting)).toBe(EVENT_BUTTON_REPLIES.waitlisted("Tank", 1));
    expect(fieldValue(lastView(gateway.editEvent), "Lista de espera")).toContain(`<@${segundo.discordId}>`);

    // Quem estava confirmado sai: o embed já mostra o promovido no lugar.
    const leaving = fakeInteraction(primeiro.discordId);
    await interactions.onLeave([leaving], event.id);
    expect(answer(leaving)).toBe(EVENT_BUTTON_REPLIES.left);
    const view = lastView(gateway.editEvent);
    expect(fieldValue(view, "Tank")).toContain(`<@${segundo.discordId}>`);
    expect(fieldValue(view, "Lista de espera")).toBeUndefined();
  });

  it("evento fora de open: botão recusa e a mensagem é atualizada com os botões desligados (AC#5)", async () => {
    const { event, tank } = await openEvent("Fechou a inscrição");
    const membro = await newMember();
    await events.transition(event.id, "close", owner);
    gateway.editEvent.mockClear();

    const interaction = fakeInteraction(membro.discordId);
    await interactions.onJoin([interaction], tank);
    expect(answer(interaction)).toBe(EVENT_BUTTON_REPLIES.notOpen("closed"));
    const view = lastView(gateway.editEvent);
    expect(view?.buttons.every((b) => b.disabled)).toBe(true);
    expect(await signups.list(event.id)).toHaveLength(0);
  });

  it("cancelar edita a mesma mensagem: vira aviso com motivo e sem botão nenhum (TASK-025, AC#4)", async () => {
    const { event, tank } = await openEvent("Cancelado no canal");
    const membro = await newMember("TankMain");
    await interactions.onJoin([fakeInteraction(membro.discordId)], tank);
    const messageId = (await events.get(event.id))!.discordMessageId;
    gateway.editEvent.mockClear();
    gateway.postEvent.mockClear();

    await events.transition(event.id, "cancel", owner, "não fechou grupo");

    // Mesma mensagem, editada (não é publicada uma segunda).
    expect(gateway.postEvent).not.toHaveBeenCalled();
    expect(gateway.editEvent.mock.calls.at(-1)?.[0]).toBe(messageId);
    const view = lastView(gateway.editEvent);
    expect(fieldValue(view, "Situação")).toBe("Evento cancelado: não fechou grupo. Todas as inscrições foram canceladas.");
    expect(view?.buttons).toEqual([]);
    // A inscrição dele caiu junto, então o clique no botão antigo também não entra mais.
    expect((await signups.list(event.id)).every((s) => s.status === "cancelled")).toBe(true);
    const tardio = fakeInteraction(membro.discordId);
    await interactions.onJoin([tardio], tank);
    expect(answer(tardio)).toBe(EVENT_BUTTON_REPLIES.notOpen("cancelled"));
  });

  it("quem não tem conta ganha conta na hora e a inscrição vai até o fim (TASK-037)", async () => {
    const { event, tank } = await openEvent("Sem cadastro");
    const novato = fakeInteraction("759999999999999999");
    await interactions.onJoin([novato], tank);
    const resposta = answer(novato) ?? "";
    expect(resposta).toContain(EVENT_BUTTON_REPLIES.accountCreated);
    expect(resposta).toContain("Inscrição confirmada");
    const inscritos = await signups.list(event.id);
    expect(inscritos).toHaveLength(1);
    expect(inscritos[0]!.status).toBe("confirmed");
    // Conta criada com os mesmos papéis do login (member) e sem nick aprovado.
    const criado = await handle.db.query.users.findFirst({ where: (u, { eq }) => eq(u.discordId, "759999999999999999") });
    expect(criado?.gameNick ?? null).toBeNull();
    expect(await listRoles(handle.db, criado!.id)).toEqual(["member"]);

    // Segundo clique não repete o aviso de conta criada.
    const devolta = fakeInteraction("759999999999999999");
    await interactions.onLeave([devolta], event.id);
    expect(answer(devolta)).toBe(EVENT_BUTTON_REPLIES.left);
  });

  it("quem tem conta sem acesso de membro é recusado sem escrever nada", async () => {
    const { event, tank } = await openEvent("Sem papel");
    const semPapel = await member("750000000000009999", []);
    expect(semPapel).toBeTruthy();
    const semAcesso = fakeInteraction("750000000000009999");
    await interactions.onJoin([semAcesso], tank);
    expect(semAcesso.reply).toHaveBeenCalledWith({ content: EVENT_BUTTON_REPLIES.notMember, flags: MessageFlags.Ephemeral });
    expect(await signups.list(event.id)).toHaveLength(0);
  });

  it("custom id forjado não vira inscrição", async () => {
    const membro = await newMember();
    const forjado = fakeInteraction(membro.discordId);
    await interactions.onJoin([forjado], "../../admin");
    expect(forjado.reply).toHaveBeenCalledWith({ content: EVENT_BUTTON_REPLIES.invalid, flags: MessageFlags.Ephemeral });

    const sumiu = fakeInteraction(membro.discordId);
    await interactions.onJoin([sumiu], MISSING);
    expect(answer(sumiu)).toBe(EVENT_BUTTON_REPLIES.unknownRole);

    const semEvento = fakeInteraction(membro.discordId);
    await interactions.onLeave([semEvento], MISSING);
    expect(answer(semEvento)).toBe(EVENT_BUTTON_REPLIES.notFound);
  });

  it("caller mover alguém pela API também atualiza a mensagem (AC#4)", async () => {
    const { event, tank, healer } = await openEvent("Caller mexe");
    const membro = await newMember();
    await interactions.onJoin([fakeInteraction(membro.discordId)], tank);
    gateway.editEvent.mockClear();
    const moved = await signups.move(event.id, membro.id, { kind: "role", slotId: healer }, owner);
    expect(moved.ok).toBe(true);
    expect(fieldValue(lastView(gateway.editEvent), "Healer")).toContain(`<@${membro.discordId}>`);
  });

  it("mensagem apagada no canal é republicada enquanto a inscrição está aberta", async () => {
    const { event } = await openEvent("Mensagem sumiu");
    gateway.postEvent.mockClear();
    gateway.editEvent.mockRejectedValueOnce(Object.assign(new Error("Unknown Message"), { code: 10008 }));
    await embeds.sync(event.id);
    expect(gateway.postEvent).toHaveBeenCalledTimes(1);
    expect((await events.get(event.id))!.discordMessageId).toBeTruthy();
  });

  it("Discord fora não desfaz a inscrição", async () => {
    const { event, tank } = await openEvent("Discord fora");
    const membro = await newMember();
    gateway.editEvent.mockRejectedValue(Object.assign(new Error("sem permissão"), { code: 50013 }));
    const interaction = fakeInteraction(membro.discordId);
    await interactions.onJoin([interaction], tank);
    expect(answer(interaction)).toBe(EVENT_BUTTON_REPLIES.confirmed("Tank"));
    expect((await signups.list(event.id)).filter((s) => s.status === "confirmed")).toHaveLength(1);
  });

  it("roteamento Necord: cada custom id cai só no seu handler e entrega o id", () => {
    const button = (customId: string) => new MessageComponentDiscovery({ type: ComponentType.Button, customId } as never);
    const name = (customId: string) => `${ComponentType.Button}_${customId}`;
    const join = button(EVENT_JOIN_BUTTON);
    const leave = button(EVENT_LEAVE_BUTTON);
    expect(join.matcher(name(eventJoinButtonId(MISSING)))).toMatchObject({ params: { slotId: MISSING } });
    expect(join.matcher(name(eventLeaveButtonId(MISSING)))).toBe(false);
    expect(leave.matcher(name(eventLeaveButtonId(MISSING)))).toMatchObject({ params: { eventId: MISSING } });
    expect(leave.matcher(name(eventJoinButtonId(MISSING)))).toBe(false);
  });
});
