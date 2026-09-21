import "reflect-metadata";
import { Test } from "@nestjs/testing";
import {
  createDb,
  createEvent,
  grantRole,
  listEventRoles,
  runMigrations,
  saveEventTemplate,
  upsertUserByDiscordId,
  type DbHandle,
} from "@albion-hub/db";
import type { EventDto, Role } from "@albion-hub/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DB_HANDLE } from "../db/db.module.js";
import { EVENT_CALL_REPLIES } from "../domain/event-call-menu.js";
import { TIMELINE_PUBLISHER } from "../domain/timeline.js";
import { EventSignupsService } from "../events/event-signups.service.js";
import { EventsService } from "../events/events.service.js";
import { FakeTimelinePublisher } from "../timeline/fake-timeline.publisher.js";
import { EventCallInteractions, type CallMenuInteraction } from "./event-call.interactions.js";
import { EventSummonService, SUMMON_CLOCK } from "./event-summon.service.js";
import { EVENT_SUMMONER } from "../events/event-summoner.token.js";
import { DISCORD_GUILD_ID } from "./discord-guild.gateway.js";
import { EVENT_VOICE_GATEWAY, type EventVoiceGateway } from "./event-voice.gateway.js";
import { EventVoiceService } from "./event-voice.service.js";

const timeline = new FakeTimelinePublisher();

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: testes do menu da call não podem ser pulados");

const GUILD = "123456789012345678";
const WAITING = "623456789012345678";

/** Relógio do intervalo de 5 minutos do chamado (TASK-087). */
let clock = new Date("2026-09-21T20:00:00Z");

/**
 * Discord falso do menu: guarda quem está conectado em cada canal (para provar que fechar a call não
 * tira ninguém), o que foi publicado no chat da call e a sobrescrita de `Connect` do canal.
 */
function fakeCallVoice() {
  const connected = new Map<string, Set<string>>([[WAITING, new Set()]]);
  const posted: { channelId: string; title: string }[] = [];
  /** `null` = sem sobrescrita (call aberta). */
  let lock: { allowed: string[] } | null = null;
  const fail = { lock: false, refuse: new Set<string>(), dm: new Set<string>() };
  /** Privados enviados e menções publicadas pelo chamado da TASK-087. */
  const dms: { discordId: string; title: string }[] = [];
  const mentions: { channelId: string; discordIds: string[]; content: string }[] = [];
  let seq = 0;

  const gateway: EventVoiceGateway = {
    waitingChannelId: WAITING,
    async createChannel() {
      const id = `8880000000000000${String(++seq).padStart(2, "0")}`;
      connected.set(id, new Set());
      return id;
    },
    async deleteChannel(channelId) {
      connected.delete(channelId);
    },
    async listMembersInChannel(channelId) {
      return [...(connected.get(channelId) ?? [])];
    },
    async moveMember(discordId, toChannelId) {
      for (const members of connected.values()) members.delete(discordId);
      connected.get(toChannelId)?.add(discordId);
    },
    async postToChannel(channelId, view) {
      posted.push({ channelId, title: view.title });
      return `msg-${posted.length}`;
    },
    async sendDirectMessage(discordId, view) {
      // `fail.dm` simula o Discord recusando DM de quem não é amigo (PE14).
      if (fail.dm.has(discordId)) throw Object.assign(new Error("privado fechado"), { code: 50007 });
      dms.push({ discordId, title: view.title });
    },
    async mentionInChannel(channelId, discordIds, content) {
      mentions.push({ channelId, discordIds: [...discordIds], content });
    },
    async setChannelConnectLock(_channelId, locked, allowDiscordIds) {
      if (fail.lock) throw Object.assign(new Error("sem permissão"), { code: 50013 });
      // `refuse` simula o Discord recusando um inscrito (saiu do servidor): ele não entra na liberação.
      const allowed = [...allowDiscordIds].filter((id) => !fail.refuse.has(id));
      lock = locked ? { allowed } : null;
      return { failed: allowDiscordIds.length - allowed.length };
    },
  };

  return {
    gateway,
    posted,
    dms,
    mentions,
    fail,
    lockState: () => lock,
    refuseFor: (discordId: string) => fail.refuse.add(discordId),
    connect: (channelId: string, ...discordIds: string[]) => {
      for (const id of discordIds) connected.get(channelId)!.add(id);
    },
    membersOf: (channelId: string) => [...(connected.get(channelId) ?? [])].sort(),
    /** Quem consegue entrar agora: com a call fechada, só quem está na lista de liberados (PE10). */
    canConnect: (discordId: string) => lock === null || lock.allowed.includes(discordId),
    reset: () => {
      for (const members of connected.values()) members.clear();
      posted.length = 0;
      dms.length = 0;
      mentions.length = 0;
      fail.dm.clear();
      lock = null;
      fail.lock = false;
      fail.refuse.clear();
      timeline.clear();
    },
  };
}

function fakeClick(discordId: string) {
  return {
    user: { id: discordId },
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  } satisfies CallMenuInteraction;
}

const answer = (i: ReturnType<typeof fakeClick>) =>
  (i.editReply.mock.calls.at(-1)?.[0] as { content: string } | undefined)?.content ?? (i.reply.mock.calls.at(-1)?.[0] as { content: string } | undefined)?.content;

describe.skipIf(!baseUrl)("menu de gestão da call (TASK-085, Postgres real + Discord falso)", () => {
  let handle: DbHandle;
  let events: EventsService;
  let signups: EventSignupsService;
  let menu: EventCallInteractions;
  let close: () => Promise<void>;
  let templateId: string;
  let owner: string;
  let ownerDiscordId: string;
  let staffDiscordId: string;
  let strangerDiscordId: string;
  let seq = 0;
  const discord = fakeCallVoice();

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_server_event_call_menu`;
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
        EventVoiceService,
        EventSummonService,
        { provide: EVENT_SUMMONER, useExisting: EventSummonService },
        EventCallInteractions,
        { provide: DB_HANDLE, useValue: handle },
        { provide: TIMELINE_PUBLISHER, useValue: timeline },
        { provide: EVENT_VOICE_GATEWAY, useValue: discord.gateway },
        { provide: DISCORD_GUILD_ID, useValue: GUILD },
        { provide: SUMMON_CLOCK, useValue: () => clock },
      ],
    }).compile();
    moduleRef.useLogger(false);
    const app = await moduleRef.init();
    events = moduleRef.get(EventsService);
    signups = moduleRef.get(EventSignupsService);
    menu = moduleRef.get(EventCallInteractions);
    close = () => app.close();

    ownerDiscordId = "770000000000000001";
    owner = await member(ownerDiscordId, ["member", "caller"]);
    staffDiscordId = "770000000000000002";
    await member(staffDiscordId, ["member", "staff"]);
    strangerDiscordId = "770000000000000003";
    await member(strangerDiscordId, ["member"]);

    const roles = await listEventRoles(handle.db);
    const saved = await saveEventTemplate(handle.db, {
      name: "Template do menu da call",
      description: null,
      minPartySize: 1,
      maxPartySize: null,
      active: true,
      roles: [{ roleId: roles.find((r) => r.name === "Tank")!.id, slots: 2, buffunfaMin: 0n, buffunfaMax: 0n }],
    });
    if (!saved.ok) throw new Error(saved.reason);
    templateId = saved.template.id;
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await handle?.close();
  });

  beforeEach(() => discord.reset());

  async function member(discordId: string, roles: Role[]) {
    const user = await upsertUserByDiscordId(handle.db, { discordId, discordUsername: `u${discordId.slice(-4)}` });
    for (const role of roles) await grantRole(handle.db, user.id, role);
    return user.id;
  }

  const newMember = () => {
    const discordId = `77000000000000${String(++seq + 20).padStart(4, "0")}`;
    return member(discordId, ["member"]).then((id) => ({ id, discordId }));
  };

  /** Evento rodando, com a call criada pelo hook do start, um inscrito e um não inscrito. */
  async function runningEvent(name: string) {
    const created = await createEvent(handle.db, { templateId, name, description: null, startsAt: null, signupsCloseAt: null, ownerUserId: owner, createdBy: owner });
    if (!created.ok) throw new Error(created.reason);
    const opened = await events.transition(created.event.id, "open", owner);
    if (!opened.ok) throw new Error("não abriu");
    const open = (await events.get(created.event.id))!;
    const slot = open.roles.find((r) => r.name === "Tank")!.id;
    const inside = await newMember();
    const outsider = await newMember();
    const joined = await signups.join(open.id, inside.id, slot);
    if (!joined.ok) throw new Error(joined.reason);
    const started = await events.transition(open.id, "start", owner);
    if (!started.ok) throw new Error("não iniciou");
    const event = (await events.get(open.id))!;
    timeline.clear();
    return { event, channelId: event.voiceChannelId!, inside, outsider };
  }

  const reload = (event: EventDto) => events.get(event.id).then((e) => e!);

  it("AC#1: criar a call publica o menu no chat de texto do próprio canal de voz", async () => {
    const { channelId } = await runningEvent("Menu no nascimento da call");
    expect(discord.posted).toHaveLength(1);
    expect(discord.posted[0]).toMatchObject({ channelId });
    expect(discord.posted[0]!.title).toContain("Menu no nascimento da call");
  });

  it("AC#2: finalizar pelo menu passa pelo mesmo serviço do painel (canal apagado, evento finished)", async () => {
    const { event, channelId, inside } = await runningEvent("Finalizar pelo menu");
    discord.connect(channelId, inside.discordId);

    const click = fakeClick(ownerDiscordId);
    await menu.onFinish([click], event.id);

    expect(answer(click)).toContain("finalizado");
    const after = await reload(event);
    expect(after.status).toBe("finished");
    // O hook do serviço rodou igual ao painel: a galera voltou para Aguardando Evento e o canal sumiu.
    expect(discord.membersOf(WAITING)).toEqual([inside.discordId]);
    expect(after.voiceChannelId).toBeNull();
    // AC#6: a linha é a do próprio serviço, com quem clicou como ator.
    expect(timeline.only("event.finished")).toMatchObject({ recordId: event.id, actor: { kind: "user", discordId: ownerDiscordId } });
  });

  it("AC#3: fechar a call bloqueia quem não está inscrito e não remove quem já está dentro", async () => {
    const { event, channelId, inside, outsider } = await runningEvent("Fechar a call");
    // O não inscrito já está dentro: fechar é sobre a porta, não sobre expulsar (PE10).
    discord.connect(channelId, inside.discordId, outsider.discordId);

    const click = fakeClick(ownerDiscordId);
    await menu.onLock([click], event.id);

    expect(answer(click)).toBe(EVENT_CALL_REPLIES.locked);
    expect(discord.canConnect(inside.discordId)).toBe(true);
    expect(discord.canConnect(outsider.discordId)).toBe(false);
    // Ninguém foi removido nem movido.
    expect(discord.membersOf(channelId)).toEqual([inside.discordId, outsider.discordId].sort());
    expect(discord.membersOf(WAITING)).toEqual([]);
    expect(timeline.only("event.call_locked")).toMatchObject({ recordId: event.id, actor: { kind: "user", discordId: ownerDiscordId } });
  });

  it("AC#4: abrir a call desfaz o fechamento, e a staff também pode", async () => {
    const { event, channelId, outsider } = await runningEvent("Abrir a call");
    await menu.onLock([fakeClick(ownerDiscordId)], event.id);
    expect(discord.canConnect(outsider.discordId)).toBe(false);

    const click = fakeClick(staffDiscordId);
    await menu.onUnlock([click], event.id);

    expect(answer(click)).toBe(EVENT_CALL_REPLIES.unlocked);
    expect(discord.lockState()).toBeNull();
    expect(discord.canConnect(outsider.discordId)).toBe(true);
    expect(discord.membersOf(channelId)).toEqual([]);
    expect(timeline.only("event.call_unlocked")).toMatchObject({ actor: { kind: "user", discordId: staffDiscordId } });
  });

  it("AC#5: quem não é caller do evento nem staff recebe recusa e nada acontece", async () => {
    const { event, channelId, inside } = await runningEvent("Recusa de quem não manda");
    discord.connect(channelId, inside.discordId);

    for (const [name, click] of [
      ["fechar", fakeClick(strangerDiscordId)],
      ["abrir", fakeClick(strangerDiscordId)],
      ["finalizar", fakeClick(strangerDiscordId)],
    ] as const) {
      if (name === "fechar") await menu.onLock([click], event.id);
      if (name === "abrir") await menu.onUnlock([click], event.id);
      if (name === "finalizar") await menu.onFinish([click], event.id);
      expect(answer(click)).toBe(EVENT_CALL_REPLIES.denied);
    }

    // Nada executado: sem sobrescrita, evento ainda rodando, canal intacto e timeline em branco.
    expect(discord.lockState()).toBeNull();
    expect((await reload(event)).status).toBe("running");
    expect(discord.membersOf(channelId)).toEqual([inside.discordId]);
    expect(timeline.entries).toEqual([]);
  });

  it("inscrito recusado pelo Discord não aborta os outros: a call fecha e o aviso vai para quem clicou", async () => {
    const { event, inside } = await runningEvent("Fechar com inscrito recusado");
    discord.refuseFor(inside.discordId);

    const click = fakeClick(ownerDiscordId);
    await menu.onLock([click], event.id);

    expect(answer(click)).toContain("o Discord recusou 1 inscrito");
    // A porta fechou mesmo assim; a timeline conta quantos ficaram liberados e quantos foram recusados.
    expect(discord.lockState()).not.toBeNull();
    expect(timeline.only("event.call_locked").details).toEqual([
      { name: "Inscritos liberados", value: "0" },
      { name: "Recusados pelo Discord", value: "1" },
    ]);
  });

  it("evento já finalizado: o menu recusa com o motivo e não publica nada", async () => {
    const { event } = await runningEvent("Menu de evento finalizado");
    const finished = await events.transition(event.id, "finish", owner);
    expect(finished.ok).toBe(true);
    timeline.clear();

    const click = fakeClick(ownerDiscordId);
    await menu.onLock([click], event.id);

    expect(answer(click)).toBe(EVENT_CALL_REPLIES.notRunning("finished"));
    expect(discord.lockState()).toBeNull();
    expect(timeline.entries).toEqual([]);
  });

  it("falha do Discord ao mudar a permissão vira mensagem clara e não derruba o evento", async () => {
    const { event } = await runningEvent("Falha de permissão do canal");
    discord.fail.lock = true;

    const click = fakeClick(ownerDiscordId);
    await menu.onLock([click], event.id);

    expect(answer(click)).toBe(EVENT_CALL_REPLIES.lockFailed);
    expect((await reload(event)).status).toBe("running");
    expect(timeline.entries).toEqual([]);
  });

  it("id forjado no botão não executa nada e nem chega ao banco", async () => {
    const click = fakeClick(ownerDiscordId);
    await menu.onLock([click], "não-é-uuid");
    expect(answer(click)).toBe(EVENT_CALL_REPLIES.invalid);
    expect(click.deferReply).not.toHaveBeenCalled();
    expect(timeline.entries).toEqual([]);
  });
});
