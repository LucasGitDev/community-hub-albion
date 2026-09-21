import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { addLateEventSignup, createDb, createEvent, grantRole, listEventRoles, runMigrations, saveEventTemplate, setEventEntryFee, upsertUserByDiscordId, type DbHandle } from "@albion-hub/db";
import type { Role } from "@albion-hub/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DB_HANDLE } from "../db/db.module.js";
import type { EmbedView } from "../domain/embed-view.js";
import { EVENT_LATE_REPLIES, eventLateRoleButtonId } from "../domain/event-late-signup.js";
import { TIMELINE_PUBLISHER } from "../domain/timeline.js";
import { EventSignupsService } from "../events/event-signups.service.js";
import { EventsService } from "../events/events.service.js";
import { FakeTimelinePublisher } from "../timeline/fake-timeline.publisher.js";
import { EventLateSignupInteractions, type LateSignupInteraction } from "./event-late-signup.interactions.js";
import { EventLateSignupService, LATE_SIGNUP_BATCH_MS } from "./event-late-signup.service.js";
import { EVENT_VOICE_GATEWAY, type EventVoiceGateway } from "./event-voice.gateway.js";
import { EventVoiceService } from "./event-voice.service.js";

const timeline = new FakeTimelinePublisher();

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: testes da inscrição no meio da call não podem ser pulados");

const WAITING = "623456789012345679";

/** Discord falso: quem está em cada canal e o que o bot publicou no chat da call, com view inteira. */
function fakeVoice() {
  const connected = new Map<string, Set<string>>([[WAITING, new Set()]]);
  const posted: { channelId: string; view: EmbedView }[] = [];
  const directMessages: { discordId: string; view: EmbedView }[] = [];
  const mentions: { channelId: string; discordIds: string[]; content: string }[] = [];
  let seq = 0;

  const gateway: EventVoiceGateway = {
    waitingChannelId: WAITING,
    async createChannel() {
      const id = `9990000000000000${String(++seq).padStart(2, "0")}`;
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
      posted.push({ channelId, view });
      return `msg-${posted.length}`;
    },
    async setChannelConnectLock() {
      return { failed: 0 };
    },
    // TASK-087: o chamado no privado não é exercido por estes testes, mas o gateway é um contrato só —
    // guardar o que foi chamado evita que um envio acidental daqui passe despercebido.
    async sendDirectMessage(discordId, view) {
      directMessages.push({ discordId, view });
    },
    async mentionInChannel(channelId, discordIds, content) {
      mentions.push({ channelId, discordIds: [...discordIds], content });
    },
  };

  return {
    gateway,
    posted,
    directMessages,
    mentions,
    /** Perguntas publicadas (o menu da TASK-085 também cai aqui, e é filtrado pelo título). */
    questions: () => posted.filter((p) => p.view.title.startsWith("Entrou na call sem inscrição")),
    connect: (channelId: string, ...discordIds: string[]) => {
      // Canal já apagado (evento finalizado) ainda aceita "entrar": é o cenário em que o bot tem que
      // ficar quieto, e o teste precisa conseguir montá-lo.
      const members = connected.get(channelId) ?? new Set<string>();
      for (const id of discordIds) members.add(id);
      connected.set(channelId, members);
    },
    disconnect: (channelId: string, discordId: string) => connected.get(channelId)?.delete(discordId),
    reset: () => {
      for (const members of connected.values()) members.clear();
      posted.length = 0;
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
  } satisfies LateSignupInteraction;
}

type Click = ReturnType<typeof fakeClick>;
const lastReply = (i: Click) => (i.editReply.mock.calls.at(-1)?.[0] ?? i.reply.mock.calls.at(-1)?.[0]) as Record<string, unknown> | undefined;
const answer = (i: Click) => lastReply(i)?.content as string | undefined;
/** Custom ids dos botões do embed efêmero (a escolha de role). */
const buttonIds = (i: Click): string[] => {
  const components = (lastReply(i)?.components ?? []) as { components: { custom_id: string }[] }[];
  return components.flatMap((row) => row.components.map((b) => b.custom_id));
};

describe.skipIf(!baseUrl)("pergunta de inscrição no meio da call (TASK-086, Postgres real + Discord falso)", () => {
  let handle: DbHandle;
  let events: EventsService;
  let signups: EventSignupsService;
  let questions: EventLateSignupService;
  let buttons: EventLateSignupInteractions;
  let close: () => Promise<void>;
  let templateId: string;
  let owner: string;
  let ownerDiscordId: string;
  let staffDiscordId: string;
  let strangerDiscordId: string;
  let seq = 0;
  const discord = fakeVoice();

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_server_late_signup`;
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
        EventLateSignupService,
        EventLateSignupInteractions,
        // Janela zero: o teste fecha o lote na mão com `flush()`, em vez de esperar relógio.
        { provide: LATE_SIGNUP_BATCH_MS, useValue: 0 },
        { provide: DB_HANDLE, useValue: handle },
        { provide: TIMELINE_PUBLISHER, useValue: timeline },
        { provide: EVENT_VOICE_GATEWAY, useValue: discord.gateway },
      ],
    }).compile();
    moduleRef.useLogger(false);
    const app = await moduleRef.init();
    events = moduleRef.get(EventsService);
    signups = moduleRef.get(EventSignupsService);
    questions = moduleRef.get(EventLateSignupService);
    buttons = moduleRef.get(EventLateSignupInteractions);
    close = () => app.close();

    ownerDiscordId = "880000000000000001";
    owner = await member(ownerDiscordId, ["member", "caller"]);
    staffDiscordId = "880000000000000002";
    await member(staffDiscordId, ["member", "staff"]);
    strangerDiscordId = "880000000000000003";
    await member(strangerDiscordId, ["member"]);

    const roles = await listEventRoles(handle.db);
    const saved = await saveEventTemplate(handle.db, {
      name: "Template da pergunta no meio da call",
      description: null,
      minPartySize: 1,
      maxPartySize: null,
      active: true,
      roles: [
        { roleId: roles.find((r) => r.name === "Tank")!.id, slots: 1, buffunfaMin: 0n, buffunfaMax: 0n },
        { roleId: roles.find((r) => r.name === "Healer")!.id, slots: 3, buffunfaMin: 0n, buffunfaMax: 0n },
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

  async function member(discordId: string, roles: Role[]) {
    const user = await upsertUserByDiscordId(handle.db, { discordId, discordUsername: `u${discordId.slice(-4)}` });
    for (const role of roles) await grantRole(handle.db, user.id, role);
    return user.id;
  }

  const newMember = () => {
    const discordId = `88000000000000${String(++seq + 30).padStart(4, "0")}`;
    return member(discordId, ["member"]).then((id) => ({ id, discordId, name: `Membro ${seq}` }));
  };

  /** Evento rodando com a call criada pelo hook do start, um inscrito e um não inscrito. */
  async function runningEvent(name: string, opts: { entryFee?: bigint } = {}) {
    const created = await createEvent(handle.db, { templateId, name, description: null, startsAt: null, signupsCloseAt: null, ownerUserId: owner, createdBy: owner });
    if (!created.ok) throw new Error(created.reason);
    const opened = await events.transition(created.event.id, "open", owner);
    if (!opened.ok) throw new Error("não abriu");
    const open = (await events.get(created.event.id))!;
    const inside = await newMember();
    const joined = await signups.join(open.id, inside.id, open.roles.find((r) => r.name === "Healer")!.id);
    if (!joined.ok) throw new Error(joined.reason);
    // A taxa entra depois do inscrito de sempre: quem interessa aqui é quem vai ser aceito no meio.
    if (opts.entryFee !== undefined) await setEventEntryFee(handle.db, open.id, opts.entryFee);
    const started = await events.transition(open.id, "start", owner);
    if (!started.ok) throw new Error("não iniciou");
    const event = (await events.get(open.id))!;
    timeline.clear();
    return { event, channelId: event.voiceChannelId!, inside };
  }

  /** Alguém entra na call e o lote é fechado na hora: devolve a última pergunta publicada. */
  async function arrive(channelId: string, ...people: { discordId: string; name: string }[]) {
    for (const p of people) {
      discord.connect(channelId, p.discordId);
      questions.noteArrival({ discordUserId: p.discordId, channelId, displayName: p.name });
    }
    await questions.flush();
    return discord.questions().at(-1);
  }

  /** Ticket da última pergunta, lido do custom id do botão de ignorar. */
  const ticketOf = (view: EmbedView) => view.buttons.at(-1)!.customId.split("/").at(-1)!;

  it("AC#1: entrada de não inscrito na call do evento gera a pergunta no chat do canal de voz", async () => {
    const { event, channelId } = await runningEvent("Pergunta no chat da call");
    const late = await newMember();

    const question = await arrive(channelId, late);

    expect(question).toBeDefined();
    // PE7: a pergunta vive no chat de texto do próprio canal de voz, não num canal à parte.
    expect(question!.channelId).toBe(channelId);
    expect(question!.view.title).toContain(event.name);
    expect(question!.view.fields.map((f) => f.name)).toEqual([late.name]);
    expect(question!.view.buttons.map((b) => b.label)).toEqual([`Inscrever ${late.name}`, "Ignorar"]);
  });

  it("AC#1: quem já está inscrito entrando na call não gera pergunta nenhuma", async () => {
    const { channelId, inside } = await runningEvent("Inscrito entrando");
    await arrive(channelId, { discordId: inside.discordId, name: "Já inscrito" });
    expect(discord.questions()).toEqual([]);
  });

  it("AC#1: canal que não é call de evento em andamento fica em silêncio", async () => {
    const { event, channelId } = await runningEvent("Evento que acabou");
    // Evento finalizado: o canal deixa de ser call de evento, e ninguém é perguntado.
    const finished = await events.transition(event.id, "finish", owner);
    if (!finished.ok) throw new Error("não finalizou");
    discord.reset();
    const late = await newMember();
    await arrive(channelId, late);
    expect(discord.questions()).toEqual([]);
  });

  it("AC#2: Inscrever oferece só as roles com vaga e então coloca a pessoa no evento", async () => {
    const { event, channelId } = await runningEvent("Inscrever no meio");
    const late = await newMember();
    const question = (await arrive(channelId, late))!;
    const ticket = ticketOf(question.view);

    // Primeiro clique não inscreve: abre a escolha de role (efêmera para quem clicou).
    const choosing = fakeClick(ownerDiscordId);
    await buttons.onAdd([choosing], ticket, late.discordId);
    expect(buttonIds(choosing)).toHaveLength(2);
    const tank = (await events.get(event.id))!.roles.find((r) => r.name === "Tank")!;
    expect(buttonIds(choosing)).toContain(eventLateRoleButtonId(ticket, late.discordId, tank.id));
    // Abrir a escolha não inscreve: até aqui a lista do evento não mudou.
    expect((await signups.list(event.id)).some((m) => m.userId === late.id)).toBe(false);

    const choosen = fakeClick(ownerDiscordId);
    await buttons.onRole([choosen], ticket, late.discordId, tank.id);
    expect(answer(choosen)).toContain("entrou no evento");
    expect(answer(choosen)).toContain("Tank");
    const members = await signups.list(event.id);
    expect(members.find((m) => m.userId === late.id)).toMatchObject({ roleName: "Tank", status: "confirmed" });
  });

  it("AC#2: sem vaga em nenhuma role a resposta diz isso, e ninguém é inscrito", async () => {
    const { event, channelId } = await runningEvent("Sem vaga nenhuma");
    // Lota as 1 de Tank e as 3 de Healer (uma já foi no `runningEvent`).
    const open = (await events.get(event.id))!;
    const tank = open.roles.find((r) => r.name === "Tank")!.id;
    const healer = open.roles.find((r) => r.name === "Healer")!.id;
    for (const slot of [tank, healer, healer]) {
      const filler = await newMember();
      const added = await addLateEventSignup(handle.db, { eventId: event.id, userId: filler.id, slotId: slot, actorUserId: owner });
      if (!added.ok) throw new Error(added.reason);
    }

    const late = await newMember();
    const question = (await arrive(channelId, late))!;
    const click = fakeClick(ownerDiscordId);
    await buttons.onAdd([click], ticketOf(question.view), late.discordId);

    expect(answer(click)).toBe(EVENT_LATE_REPLIES.noRoles(late.name));
    expect((await signups.list(event.id)).some((m) => m.userId === late.id)).toBe(false);
  });

  it("AC#3: Ignorar encerra a pergunta sem inscrever, e os botões dela param de valer", async () => {
    const { event, channelId } = await runningEvent("Ignorar a pergunta");
    const late = await newMember();
    const question = (await arrive(channelId, late))!;
    const ticket = ticketOf(question.view);

    const ignoring = fakeClick(ownerDiscordId);
    await buttons.onIgnore([ignoring], ticket);
    expect(answer(ignoring)).toBe(EVENT_LATE_REPLIES.ignored(1));
    expect((await signups.list(event.id)).some((m) => m.userId === late.id)).toBe(false);

    // Clicar em Inscrever depois do ignorar não ressuscita a pergunta.
    const late2 = fakeClick(ownerDiscordId);
    await buttons.onAdd([late2], ticket, late.discordId);
    expect(answer(late2)).toBe(EVENT_LATE_REPLIES.expired);
    expect((await signups.list(event.id)).some((m) => m.userId === late.id)).toBe(false);
  });

  it("AC#3: quem foi ignorado não gera pergunta nova ao reentrar na call", async () => {
    const { channelId } = await runningEvent("Reentrada de quem foi ignorado");
    const late = await newMember();
    const question = (await arrive(channelId, late))!;
    await buttons.onIgnore([fakeClick(ownerDiscordId)], ticketOf(question.view));
    const before = discord.questions().length;

    discord.disconnect(channelId, late.discordId);
    await arrive(channelId, late);
    await arrive(channelId, late);

    expect(discord.questions()).toHaveLength(before);
  });

  it("AC#4: sem resposta ninguém entra no evento e nada é publicado na timeline", async () => {
    const { event, channelId } = await runningEvent("Silêncio não inscreve");
    const late = await newMember();
    const question = await arrive(channelId, late);

    expect(question).toBeDefined();
    // A pergunta existe e ninguém clicou: o evento continua exatamente como estava.
    expect((await signups.list(event.id)).some((m) => m.userId === late.id)).toBe(false);
    expect(timeline.entries).toEqual([]);
  });

  it("AC#6: estranho recebe recusa e nada acontece; staff que não é o caller consegue", async () => {
    const { event, channelId } = await runningEvent("Só caller e staff");
    const late = await newMember();
    const question = (await arrive(channelId, late))!;
    const ticket = ticketOf(question.view);

    const denied = fakeClick(strangerDiscordId);
    await buttons.onAdd([denied], ticket, late.discordId);
    expect(answer(denied)).toBe(EVENT_LATE_REPLIES.denied);
    // Recusa não escreve nada: nem inscrição, nem timeline.
    expect((await signups.list(event.id)).some((m) => m.userId === late.id)).toBe(false);
    expect(timeline.entries).toEqual([]);

    const tank = (await events.get(event.id))!.roles.find((r) => r.name === "Tank")!.id;
    const forged = fakeClick(strangerDiscordId);
    // Custom id forjado direto na role também não passa: a checagem é no clique, não no botão.
    await buttons.onRole([forged], ticket, late.discordId, tank);
    expect(answer(forged)).toBe(EVENT_LATE_REPLIES.denied);
    expect((await signups.list(event.id)).some((m) => m.userId === late.id)).toBe(false);

    const staff = fakeClick(staffDiscordId);
    await buttons.onRole([staff], ticket, late.discordId, tank);
    expect(answer(staff)).toContain("entrou no evento");
    expect((await signups.list(event.id)).some((m) => m.userId === late.id)).toBe(true);
  });

  it("AC#6: ticket que o bot não conhece (reinício, id forjado) não inscreve ninguém", async () => {
    const { channelId } = await runningEvent("Ticket desconhecido");
    const late = await newMember();
    await arrive(channelId, late);
    const click = fakeClick(ownerDiscordId);
    await buttons.onAdd([click], "ticket-que-nao-existe", late.discordId);
    expect(answer(click)).toBe(EVENT_LATE_REPLIES.expired);
    // Nem chegou a consultar o banco: a recusa é antes do defer.
    expect(click.deferReply).not.toHaveBeenCalled();
  });

  it("DoD#7: o aceite publica na timeline quem inscreveu quem, com a role e o início da presença", async () => {
    const { event, channelId } = await runningEvent("Timeline do aceite");
    const late = await newMember();
    const question = (await arrive(channelId, late))!;
    const tank = (await events.get(event.id))!.roles.find((r) => r.name === "Tank")!.id;
    await buttons.onRole([fakeClick(ownerDiscordId)], ticketOf(question.view), late.discordId, tank);

    const entry = timeline.only("event.late_signup_added");
    expect(entry.actor).toMatchObject({ kind: "user", discordId: ownerDiscordId });
    expect(entry.target).toMatchObject({ id: late.id, discordId: late.discordId });
    expect(entry.details?.map((d) => d.name)).toEqual(["Evento", "Role", "Presença conta a partir de"]);
    expect(entry.details?.find((d) => d.name === "Role")?.value).toBe("Tank");
  });

  it("DoD#7: ignorar também publica, com quem ignorou e quem ficou de fora", async () => {
    const { channelId } = await runningEvent("Timeline do ignorar");
    const [a, b] = [await newMember(), await newMember()];
    const question = (await arrive(channelId, a, b))!;
    await buttons.onIgnore([fakeClick(staffDiscordId)], ticketOf(question.view));

    const entry = timeline.only("event.late_signup_ignored");
    expect(entry.actor).toMatchObject({ kind: "user", discordId: staffDiscordId });
    expect(entry.details?.find((d) => d.name === "Pessoas")?.value).toBe(`${a.name}, ${b.name}`);
  });

  it("taxa de entrada: sem Buffunfa a pessoa não entra, e a recusa diz o que falta", async () => {
    const { event, channelId } = await runningEvent("Taxa no aceite", { entryFee: 50n });
    const late = await newMember();
    const question = (await arrive(channelId, late))!;
    const tank = (await events.get(event.id))!.roles.find((r) => r.name === "Tank")!.id;

    const click = fakeClick(ownerDiscordId);
    await buttons.onRole([click], ticketOf(question.view), late.discordId, tank);
    expect(answer(click)).toContain("não tem Buffunfa");
    expect((await signups.list(event.id)).some((m) => m.userId === late.id)).toBe(false);
    expect(timeline.entries).toEqual([]);
  });

  describe("sem enxurrada de perguntas", () => {
    it("cinco entrando de uma vez viram duas mensagens, não cinco", async () => {
      const { channelId } = await runningEvent("Cinco de uma vez");
      const crowd = [await newMember(), await newMember(), await newMember(), await newMember(), await newMember()];
      await arrive(channelId, ...crowd);

      // Quatro por mensagem (o que cabe na linha de botões do Discord) e o resto na seguinte.
      expect(discord.questions()).toHaveLength(2);
      expect(discord.questions()[0]!.view.fields).toHaveLength(4);
      expect(discord.questions()[1]!.view.fields).toHaveLength(1);
    });

    it("quem já foi perguntado não vira pergunta nova a cada re-entrada", async () => {
      const { channelId } = await runningEvent("Entra e sai");
      const late = await newMember();
      await arrive(channelId, late);
      discord.disconnect(channelId, late.discordId);
      await arrive(channelId, late);
      await arrive(channelId, late);
      expect(discord.questions()).toHaveLength(1);
    });

    it("quem entrou e saiu antes de a janela fechar não vira pergunta", async () => {
      const { channelId } = await runningEvent("Passou reto");
      const passerby = await newMember();
      discord.connect(channelId, passerby.discordId);
      questions.noteArrival({ discordUserId: passerby.discordId, channelId, displayName: passerby.name });
      // Saiu antes do lote fechar: perguntar sobre quem não está mais lá é ruído puro.
      discord.disconnect(channelId, passerby.discordId);
      await questions.flush();
      expect(discord.questions()).toEqual([]);
    });
  });
});
