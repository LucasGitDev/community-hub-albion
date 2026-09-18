import "reflect-metadata";
import { Test } from "@nestjs/testing";
import {
  createDb,
  createEvent,
  grantRole,
  listEventRoles,
  listEventSignupMembers,
  listOpenVoiceSessions,
  openVoiceSession,
  runMigrations,
  saveEventTemplate,
  setGameNick,
  upsertUserByDiscordId,
  type DbHandle,
} from "@albion-hub/db";
import type { EventDto, Role } from "@albion-hub/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DB_HANDLE } from "../db/db.module.js";
import { EVENT_COMMAND_REPLIES } from "../domain/event-voice.js";
import { EventSignupsService } from "../events/event-signups.service.js";
import { EventsService } from "../events/events.service.js";
import { DISCORD_GUILD_ID } from "./discord-guild.gateway.js";
import { EVENT_VOICE_GATEWAY, type EventVoiceGateway } from "./event-voice.gateway.js";
import { EventVoiceService } from "./event-voice.service.js";
import { EventCommand, type EventCommandInteraction } from "./event.command.js";
import { TIMELINE_PUBLISHER } from "../domain/timeline.js";
import { FakeTimelinePublisher } from "../timeline/fake-timeline.publisher.js";

const timeline = new FakeTimelinePublisher();

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: testes do canal de voz do evento não podem ser pulados");

const GUILD = "123456789012345678";
const WAITING = "623456789012345678";
const OTHER_CHANNEL = "633456789012345678";

/**
 * Discord falso: guarda quem está em cada canal de voz e deixa o teste programar falhas por operação.
 * Mover é o que importa — quem vai para onde é a regra de Q29 que o serviço decide.
 */
function fakeVoice() {
  const channels = new Map<string, Set<string>>([
    [WAITING, new Set()],
    [OTHER_CHANNEL, new Set()],
  ]);
  const created: { id: string; name: string }[] = [];
  const deleted: string[] = [];
  let seq = 0;
  const fail = { create: false, move: new Set<string>(), delete: false, list: false };

  const gateway: EventVoiceGateway = {
    waitingChannelId: WAITING,
    async createChannel(name) {
      if (fail.create) throw Object.assign(new Error("sem permissão"), { code: 50013 });
      const id = `9990000000000000${String(++seq).padStart(2, "0")}`;
      channels.set(id, new Set());
      created.push({ id, name });
      return id;
    },
    async deleteChannel(channelId) {
      if (fail.delete) throw Object.assign(new Error("sem permissão"), { code: 50013 });
      channels.delete(channelId);
      deleted.push(channelId);
    },
    async listMembersInChannel(channelId) {
      if (fail.list) throw Object.assign(new Error("canal sumiu"), { code: "WAITING_VOICE_CHANNEL_INVALID" });
      return [...(channels.get(channelId) ?? [])];
    },
    async moveMember(discordId, toChannelId) {
      if (fail.move.has(discordId)) throw Object.assign(new Error("saiu da voz"), { code: 40032 });
      for (const members of channels.values()) members.delete(discordId);
      channels.get(toChannelId)?.add(discordId);
    },
  };
  return {
    gateway,
    created,
    deleted,
    fail,
    channels,
    connect: (channelId: string, ...discordIds: string[]) => {
      for (const id of discordIds) {
        for (const members of channels.values()) members.delete(id);
        channels.get(channelId)!.add(id);
      }
    },
    membersOf: (channelId: string) => [...(channels.get(channelId) ?? [])].sort(),
    reset: () => {
      for (const [id, members] of channels) {
        if (id === WAITING || id === OTHER_CHANNEL) members.clear();
        else channels.delete(id);
      }
      created.length = 0;
      deleted.length = 0;
      fail.create = false;
      fail.delete = false;
      fail.list = false;
      fail.move.clear();
    },
  };
}

function fakeInteraction(discordId: string, guildId: string | null = GUILD) {
  return {
    guildId,
    user: { id: discordId },
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  } satisfies EventCommandInteraction;
}

const answer = (i: ReturnType<typeof fakeInteraction>) =>
  (i.editReply.mock.calls.at(-1)?.[0] as { content: string } | undefined)?.content ?? (i.reply.mock.calls.at(-1)?.[0] as { content: string } | undefined)?.content;

describe.skipIf(!baseUrl)("canal de voz do evento (TASK-024, Postgres real + Discord falso)", () => {
  let handle: DbHandle;
  let events: EventsService;
  let signups: EventSignupsService;
  let voice: EventVoiceService;
  let command: EventCommand;
  let close: () => Promise<void>;
  let templateId: string;
  let owner: string;
  let ownerDiscordId: string;
  let seq = 0;
  const discord = fakeVoice();

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_server_event_voice`;
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
        EventCommand,
        { provide: DB_HANDLE, useValue: handle },
        { provide: TIMELINE_PUBLISHER, useValue: timeline },
        { provide: EVENT_VOICE_GATEWAY, useValue: discord.gateway },
        { provide: DISCORD_GUILD_ID, useValue: GUILD },
      ],
    }).compile();
    moduleRef.useLogger(false);
    const app = await moduleRef.init();
    events = moduleRef.get(EventsService);
    signups = moduleRef.get(EventSignupsService);
    voice = moduleRef.get(EventVoiceService);
    command = moduleRef.get(EventCommand);
    close = () => app.close();

    ownerDiscordId = "760000000000000001";
    owner = await member(ownerDiscordId, ["member", "caller"]);
    const roles = await listEventRoles(handle.db);
    const saved = await saveEventTemplate(handle.db, {
      name: "Template da voz",
      description: null,
      minPartySize: 1,
      maxPartySize: null,
      active: true,
      roles: [
        { roleId: roles.find((r) => r.name === "Tank")!.id, slots: 1, buffunfaMin: 0n, buffunfaMax: 0n },
        { roleId: roles.find((r) => r.name === "Healer")!.id, slots: 1, buffunfaMin: 0n, buffunfaMax: 0n },
      ],
    });
    if (!saved.ok) throw new Error(saved.reason);
    templateId = saved.template.id;
  }, 60_000);

  afterAll(async () => {
    await close?.();
    await handle?.close();
  });

  beforeEach(() => discord.reset());

  async function member(discordId: string, roles: Role[], nick?: string) {
    const user = await upsertUserByDiscordId(handle.db, { discordId, discordUsername: `u${discordId.slice(-4)}` });
    for (const role of roles) await grantRole(handle.db, user.id, role);
    if (nick) await setGameNick(handle.db, user.id, nick);
    return user.id;
  }

  const newMember = () => {
    const discordId = `76000000000000${String(++seq + 10).padStart(4, "0")}`;
    return member(discordId, ["member"]).then((id) => ({ id, discordId }));
  };

  /** Evento aberto com um Tank e um Healer confirmados e um Healer na espera. */
  async function openEvent(name: string) {
    const created = await createEvent(handle.db, { templateId, name, description: null, startsAt: null, signupsCloseAt: null, ownerUserId: owner, createdBy: owner });
    if (!created.ok) throw new Error(created.reason);
    const opened = await events.transition(created.event.id, "open", owner);
    if (!opened.ok) throw new Error("não abriu");
    const event = (await events.get(created.event.id))!;
    const tankSlot = event.roles.find((r) => r.name === "Tank")!.id;
    const healerSlot = event.roles.find((r) => r.name === "Healer")!.id;
    const tank = await newMember();
    const healer = await newMember();
    const waiting = await newMember();
    for (const [person, slot] of [
      [tank, tankSlot],
      [healer, healerSlot],
      [waiting, healerSlot],
    ] as const) {
      const result = await signups.join(event.id, person.id, slot);
      if (!result.ok) throw new Error(result.reason);
    }
    return { event, tank, healer, waiting };
  }

  const reload = (event: EventDto) => events.get(event.id).then((e) => e!);

  it("start cria o canal na categoria, arrasta só confirmado presente e carimba o horário (AC#1/AC#3)", async () => {
    const { event, tank, healer, waiting } = await openEvent("ZvZ das 21h");
    // Tank e o da espera estão em Aguardando Evento; o Healer confirmado está em outro canal.
    discord.connect(WAITING, tank.discordId, waiting.discordId);
    discord.connect(OTHER_CHANNEL, healer.discordId);

    const started = await events.transition(event.id, "start", owner);
    expect(started.ok).toBe(true);

    expect(discord.created).toHaveLength(1);
    expect(discord.created[0]!.name).toBe("ZvZ das 21h");
    const channelId = discord.created[0]!.id;
    const after = await reload(event);
    expect(after.voiceChannelId).toBe(channelId);
    expect(after.status).toBe("running");
    // AC#3: start carimba started_at e, por Q26, fecha a inscrição no mesmo instante.
    expect(after.startedAt).toBeTruthy();
    expect(after.closedAt).toBeTruthy();

    // Q29: só o Tank confirmado e presente foi movido.
    expect(discord.membersOf(channelId)).toEqual([tank.discordId]);
    expect(discord.membersOf(WAITING)).toEqual([waiting.discordId]);
    expect(discord.membersOf(OTHER_CHANNEL)).toEqual([healer.discordId]);
  });

  it("finish devolve todo mundo do canal (inclusive quem entrou sem inscrição) e apaga o canal (AC#2/AC#3)", async () => {
    const { event, tank } = await openEvent("Roads da tarde");
    discord.connect(WAITING, tank.discordId);
    await events.transition(event.id, "start", owner);
    const channelId = discord.created[0]!.id;
    // Q7: alguém entrou no canal sem estar inscrito; o finish devolve ele também.
    const penetra = await newMember();
    discord.connect(channelId, penetra.discordId);

    const finished = await events.transition(event.id, "finish", owner);
    expect(finished.ok).toBe(true);

    expect(discord.deleted).toEqual([channelId]);
    expect(discord.channels.has(channelId)).toBe(false);
    expect(discord.membersOf(WAITING)).toEqual([penetra.discordId, tank.discordId].sort());
    const after = await reload(event);
    expect(after.status).toBe("finished");
    expect(after.finishedAt).toBeTruthy();
    expect(after.voiceChannelId).toBeNull();
  });

  it("falha do Discord ao criar o canal não desfaz o start", async () => {
    const { event, tank } = await openEvent("Sem permissão");
    discord.connect(WAITING, tank.discordId);
    discord.fail.create = true;

    const started = await events.transition(event.id, "start", owner);
    expect(started.ok).toBe(true);
    const after = await reload(event);
    expect(after.status).toBe("running");
    expect(after.startedAt).toBeTruthy();
    expect(after.voiceChannelId).toBeNull();
    // Ninguém saiu do lugar: a pessoa continua onde estava.
    expect(discord.membersOf(WAITING)).toEqual([tank.discordId]);
  });

  it("falha ao mover uma pessoa não impede as outras, no start e no finish", async () => {
    const { event, tank, healer } = await openEvent("Um cai, o resto vai");
    discord.connect(WAITING, tank.discordId, healer.discordId);
    // O Healer confirmado está presente, mas o Discord recusa movê-lo (saiu da voz no meio).
    discord.fail.move.add(healer.discordId);

    await events.transition(event.id, "start", owner);
    const channelId = discord.created[0]!.id;
    expect(discord.membersOf(channelId)).toEqual([tank.discordId]);
    expect(discord.membersOf(WAITING)).toEqual([healer.discordId]);

    discord.fail.move.clear();
    discord.fail.move.add(tank.discordId);
    await events.transition(event.id, "finish", owner);
    // O canal é apagado mesmo com uma devolução falhando; o resto voltou.
    expect(discord.deleted).toEqual([channelId]);
    expect(await reload(event).then((e) => e.voiceChannelId)).toBeNull();
  });

  it("falha ao apagar o canal mantém o id no banco para o operador resolver", async () => {
    const { event, tank } = await openEvent("Canal teimoso");
    discord.connect(WAITING, tank.discordId);
    await events.transition(event.id, "start", owner);
    const channelId = discord.created[0]!.id;
    discord.fail.delete = true;

    await events.transition(event.id, "finish", owner);
    expect(await reload(event).then((e) => e.voiceChannelId)).toBe(channelId);
    expect(discord.membersOf(WAITING)).toEqual([tank.discordId]);
  });

  it("closeChannel é reusável (TASK-025) e não faz nada em evento sem canal", async () => {
    const { event } = await openEvent("Sem canal ainda");
    await expect(voice.closeChannel(await reload(event))).resolves.toEqual({ moved: 0, failed: 0 });
    expect(discord.deleted).toEqual([]);
  });

  describe("cancelamento (TASK-025, Q26)", () => {
    /** Sessão de voz aberta num canal, como o listener de voz gravaria. */
    const connectWithSession = async (channelId: string, discordId: string, at: Date) => {
      discord.connect(channelId, discordId);
      await openVoiceSession(handle.db, { discordUserId: discordId, guildId: GUILD, channelId, at });
    };

    it("cancelar em running devolve a galera, apaga o canal e fecha as sessões daquele canal (AC#2)", async () => {
      const { event, tank } = await openEvent("Cancelado no meio");
      discord.connect(WAITING, tank.discordId);
      await events.transition(event.id, "start", owner);
      const channelId = discord.created.at(-1)!.id;
      const penetra = await newMember();
      const at = new Date("2026-10-01T22:00:00.000Z");
      await connectWithSession(channelId, tank.discordId, at);
      await connectWithSession(channelId, penetra.discordId, at);
      expect(await listOpenVoiceSessions(handle.db)).toHaveLength(2);

      const cancelled = await events.transition(event.id, "cancel", owner, "não fechou grupo");
      expect(cancelled.ok).toBe(true);

      // Devolveu todo mundo (inclusive o penetra, Q7) e apagou o canal, igual ao finish.
      expect(discord.deleted).toContain(channelId);
      expect(discord.membersOf(WAITING)).toEqual([penetra.discordId, tank.discordId].sort());
      const after = await reload(event);
      expect(after).toMatchObject({ status: "cancelled", voiceChannelId: null, cancelReason: "não fechou grupo" });
      // Nenhuma sessão órfã aberta no canal apagado (AC#2).
      expect(await listOpenVoiceSessions(handle.db, tank.discordId)).toEqual([]);
      expect((await listOpenVoiceSessions(handle.db)).some((s) => s.channelId === channelId)).toBe(false);
      // E as inscrições caíram junto (AC#1).
      expect(await listEventSignupMembers(handle.db, event.id)).toEqual([]);
    });

    it("cancelar antes do start não mexe em canal nenhum, mas cancela as inscrições (AC#1)", async () => {
      const { event } = await openEvent("Cancelado antes de começar");
      const cancelled = await events.transition(event.id, "cancel", owner);
      expect(cancelled.ok).toBe(true);
      expect(discord.created).toEqual([]);
      expect(discord.deleted).toEqual([]);
      expect(await reload(event).then((e) => e.status)).toBe("cancelled");
      expect(await listEventSignupMembers(handle.db, event.id)).toEqual([]);
    });

    it("falha do Discord ao apagar o canal não desfaz o cancelamento nem as inscrições", async () => {
      const { event, tank } = await openEvent("Canal teimoso no cancelamento");
      discord.connect(WAITING, tank.discordId);
      await events.transition(event.id, "start", owner);
      const channelId = discord.created.at(-1)!.id;
      await connectWithSession(channelId, tank.discordId, new Date("2026-10-01T22:00:00.000Z"));
      discord.fail.delete = true;

      const cancelled = await events.transition(event.id, "cancel", owner, "deu ruim");
      expect(cancelled.ok).toBe(true);
      const after = await reload(event);
      expect(after.status).toBe("cancelled");
      // O id fica no banco para o operador apagar na mão, mas a galera já voltou e a sessão fechou.
      expect(after.voiceChannelId).toBe(channelId);
      expect(discord.membersOf(WAITING)).toEqual([tank.discordId]);
      expect((await listOpenVoiceSessions(handle.db)).some((s) => s.channelId === channelId)).toBe(false);
      expect(await listEventSignupMembers(handle.db, event.id)).toEqual([]);
    });

    it("/evento cancelar faz o mesmo que o painel e publica o motivo", async () => {
      const { event, tank } = await openEvent("Cancela pelo comando");
      discord.connect(WAITING, tank.discordId);
      await events.transition(event.id, "start", owner);
      const channelId = discord.created.at(-1)!.id;

      const interaction = fakeInteraction(ownerDiscordId);
      await command.onCancel([interaction], { evento: event.id, motivo: "  chuva de flechas  " });

      expect(answer(interaction)).toBe(EVENT_COMMAND_REPLIES.cancelled("Cancela pelo comando", "chuva de flechas"));
      expect(discord.deleted).toContain(channelId);
      expect(await reload(event)).toMatchObject({ status: "cancelled", cancelReason: "chuva de flechas" });
      expect(await listEventSignupMembers(handle.db, event.id)).toEqual([]);
    });

    it("/evento cancelar recusa motivo longo demais e não cancela nada", async () => {
      const { event } = await openEvent("Motivo comprido");
      const interaction = fakeInteraction(ownerDiscordId);
      await command.onCancel([interaction], { evento: event.id, motivo: "x".repeat(301) });
      expect(answer(interaction)).toBe(EVENT_COMMAND_REPLIES.reasonTooLong);
      expect(await reload(event).then((e) => e.status)).toBe("open");
    });

    it("/evento cancelar não acha evento finalizado e recusa quem não conduz o evento", async () => {
      const { event, tank } = await openEvent("Já acabou");
      discord.connect(WAITING, tank.discordId);
      await events.transition(event.id, "start", owner);
      await events.transition(event.id, "finish", owner);

      const interaction = fakeInteraction(ownerDiscordId);
      await command.onCancel([interaction], { evento: event.id });
      expect(answer(interaction)).toBe(EVENT_COMMAND_REPLIES.noneToCancel);
      expect(await reload(event).then((e) => e.status)).toBe("finished");

      const outro = await openEvent("De outro caller");
      const estranho = await newMember();
      const dele = fakeInteraction(estranho.discordId);
      await command.onCancel([dele], { evento: outro.event.id });
      expect(answer(dele)).toBe(EVENT_COMMAND_REPLIES.noneToCancel);
      expect(await reload(outro.event).then((e) => e.status)).toBe("open");
    });
  });

  describe("comando do bot (AC#4)", () => {
    it("/evento iniciar produz o mesmo resultado da API: mesmo canal, mesma seleção", async () => {
      const viaApi = await openEvent("Pelo painel");
      const viaComando = await openEvent("Pelo comando");
      discord.connect(WAITING, viaApi.tank.discordId, viaComando.tank.discordId);

      await events.transition(viaApi.event.id, "start", owner);
      const apiChannel = discord.created.at(-1)!;

      const interaction = fakeInteraction(ownerDiscordId);
      await command.onStart([interaction], { evento: "Pelo comando" });
      const commandChannel = discord.created.at(-1)!;

      expect(answer(interaction)).toBe(EVENT_COMMAND_REPLIES.started("Pelo comando"));
      expect(commandChannel.name).toBe("Pelo comando");
      expect(apiChannel.name).toBe("Pelo painel");
      // Os dois caminhos deixam o banco e a voz no mesmo formato.
      for (const [target, channel, person] of [
        [viaApi, apiChannel, viaApi.tank],
        [viaComando, commandChannel, viaComando.tank],
      ] as const) {
        const after = await reload(target.event);
        expect(after.status).toBe("running");
        expect(after.voiceChannelId).toBe(channel.id);
        expect(after.startedAt).toBeTruthy();
        expect(discord.membersOf(channel.id)).toEqual([person.discordId]);
      }
    });

    it("/evento encerrar devolve a galera e apaga o canal, igual à API", async () => {
      const { event, tank } = await openEvent("Encerra pelo comando");
      discord.connect(WAITING, tank.discordId);
      await events.transition(event.id, "start", owner);
      const channelId = discord.created.at(-1)!.id;

      const interaction = fakeInteraction(ownerDiscordId);
      await command.onFinish([interaction], { evento: event.id });

      expect(answer(interaction)).toBe(EVENT_COMMAND_REPLIES.finished("Encerra pelo comando"));
      expect(discord.deleted).toContain(channelId);
      expect(discord.membersOf(WAITING)).toEqual([tank.discordId]);
      expect(await reload(event).then((e) => e.status)).toBe("finished");
    });

    it("recusa quem não é owner nem staff, sem revelar o evento", async () => {
      const { event } = await openEvent("Só do owner");
      const estranho = await newMember();

      const interaction = fakeInteraction(estranho.discordId);
      await command.onStart([interaction], { evento: "Só do owner" });

      expect(answer(interaction)).toBe(EVENT_COMMAND_REPLIES.noneToStart);
      expect(await reload(event).then((e) => e.status)).toBe("open");
      expect(discord.created).toEqual([]);
    });

    it("recusa fora da guilda configurada e quem não está no painel", async () => {
      const fora = fakeInteraction(ownerDiscordId, "999999999999999999");
      await command.onStart([fora], {});
      expect(answer(fora)).toBe(EVENT_COMMAND_REPLIES.wrongGuild);

      const semConta = fakeInteraction("769999999999999999");
      await command.onFinish([semConta], {});
      expect(answer(semConta)).toBe(EVENT_COMMAND_REPLIES.notRegistered);
      expect(discord.created).toEqual([]);
    });

    it("pede desempate quando mais de um evento serve", async () => {
      await openEvent("Ambíguo A");
      await openEvent("Ambíguo B");
      const interaction = fakeInteraction(ownerDiscordId);
      await command.onStart([interaction], { evento: "Ambíguo" });

      const reply = answer(interaction)!;
      expect(reply).toContain("mais de um evento");
      expect(reply).toContain("Ambíguo A");
      expect(reply).toContain("Ambíguo B");
      expect(discord.created).toEqual([]);
    });
  });
});
