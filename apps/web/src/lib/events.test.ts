import { defineAbilityFor, type EventDto, type EventOccupancyDto, type EventSignupDto, type EventStatus } from "@albion-hub/shared";
import { describe, expect, it } from "vitest";
import {
  availableTransitions,
  canJoinEvent,
  canManageRoster,
  canTransferOwner,
  eventFill,
  groupEvents,
  mySignupFor,
  mySignupLabel,
  nextPollDelay,
  nickOf,
  roleViews,
} from "./events";

const CALLER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const event = (id: string, status: EventStatus, ownerUserId = CALLER): EventDto => ({
  id,
  templateId: "t1",
  templateName: "DG de grupo",
  name: `Evento ${id}`,
  description: null,
  entryFee: "0",
  status,
  ownerUserId,
  ownerNick: "Caller",
  createdByUserId: ownerUserId,
  voiceChannelId: null,
  presenceChannelId: null,
  fee: { type: "percent", value: "0" },
  discordMessageId: null,
  startsAt: null,
  signupsCloseAt: null,
  openedAt: null,
  closedAt: null,
  startedAt: null,
  finishedAt: null,
  cancelledAt: null,
  archivedAt: null,
  cancelReason: null,
  roles: [
    { id: "tank", roleId: null, name: "Tank", description: "Segura a frente e chama o engage.", slots: 1 },
    { id: "healer", roleId: null, name: "Healer", description: null, slots: 2 },
  ],
  totalSlots: 3,
  createdAt: "2026-09-15T12:00:00.000Z",
  updatedAt: "2026-09-15T12:00:00.000Z",
});

const signup = (over: Partial<EventSignupDto> = {}): EventSignupDto => ({
  id: "s1",
  eventId: "e1",
  userId: OTHER,
  slotId: "tank",
  roleName: "Tank",
  status: "confirmed",
  position: 0,
  decidedByUserId: null,
  createdAt: "2026-09-15T12:00:00.000Z",
  updatedAt: "2026-09-15T12:00:00.000Z",
  ...over,
});

const ability = (roles: ("member" | "caller" | "staff")[], id = CALLER) => defineAbilityFor({ id, roles });

describe("groupEvents", () => {
  it("separa o que está rolando, o que aceita inscrição, o que vem depois e o histórico (AC#1)", () => {
    const groups = groupEvents([
      event("a", "running"),
      event("b", "open"),
      event("c", "draft"),
      event("d", "closed"),
      event("e", "finished"),
      event("f", "cancelled"),
      event("g", "archived"),
    ]);
    expect(groups.running.map((e) => e.id)).toEqual(["a"]);
    expect(groups.open.map((e) => e.id)).toEqual(["b"]);
    expect(groups.upcoming.map((e) => e.id)).toEqual(["c", "d"]);
    expect(groups.done.map((e) => e.id)).toEqual(["e", "f", "g"]);
  });

  it("mantém a ordem que a API mandou dentro de cada faixa", () => {
    expect(groupEvents([event("x", "open"), event("y", "open")]).open.map((e) => e.id)).toEqual(["x", "y"]);
  });

  it("lista vazia dá todas as faixas vazias, não undefined", () => {
    expect(groupEvents([])).toEqual({ running: [], open: [], upcoming: [], done: [] });
  });
});

describe("roleViews", () => {
  const occupancy: EventOccupancyDto[] = [
    { eventId: "e1", slotId: "tank", confirmed: 1, waitlist: 2 },
    { eventId: "e1", slotId: "healer", confirmed: 1, waitlist: 0 },
  ];

  it("leva a descrição da role pra decisão de inscrição, e null quando não tem (TASK-039, AC#2/AC#3)", () => {
    const [tank, healer] = roleViews(event("e1", "open"), [], null);
    expect(tank!.description).toBe("Segura a frente e chama o engage.");
    expect(healer!.description).toBeNull();
  });

  it("cruza vagas do evento com a contagem do banco e marca a role lotada (Q27)", () => {
    const [tank, healer] = roleViews(event("e1", "open"), occupancy, null);
    expect(tank).toMatchObject({ name: "Tank", confirmed: 1, waitlist: 2, free: 0, full: true, mine: null, myPosition: 0 });
    expect(healer).toMatchObject({ name: "Healer", confirmed: 1, free: 1, full: false });
  });

  it("role sem ninguém inscrito conta zero em vez de sumir", () => {
    const [tank] = roleViews(event("e1", "open"), [], null);
    expect(tank).toMatchObject({ confirmed: 0, waitlist: 0, free: 1, full: false });
  });

  it("marca a minha role e a minha posição na espera (AC#1)", () => {
    const mine = signup({ slotId: "tank", status: "waitlist", position: 2 });
    const [tank, healer] = roleViews(event("e1", "open"), occupancy, mine);
    expect(tank.mine).toBe("waitlist");
    expect(tank.myPosition).toBe(2);
    expect(healer.mine).toBeNull();
  });

  it("confirmado não tem posição na espera", () => {
    const [tank] = roleViews(event("e1", "open"), occupancy, signup({ slotId: "tank" }));
    expect(tank).toMatchObject({ mine: "confirmed", myPosition: 0 });
  });

  it("ocupação de outro evento não vaza para este", () => {
    const [tank] = roleViews(event("e1", "open"), [{ eventId: "e2", slotId: "tank", confirmed: 5, waitlist: 5 }], null);
    expect(tank.confirmed).toBe(0);
  });
});

describe("eventFill", () => {
  it("soma vagas ocupadas e a espera, em porcentagem", () => {
    const roles = roleViews(
      event("e1", "open"),
      [
        { eventId: "e1", slotId: "tank", confirmed: 1, waitlist: 1 },
        { eventId: "e1", slotId: "healer", confirmed: 2, waitlist: 0 },
      ],
      null,
    );
    expect(eventFill(roles)).toEqual({ confirmed: 3, total: 3, waitlist: 1, percent: 100 });
  });

  it("não passa de 100% quando uma role tem mais confirmados que vagas", () => {
    const roles = roleViews(event("e1", "open"), [{ eventId: "e1", slotId: "tank", confirmed: 4, waitlist: 0 }], null);
    expect(eventFill(roles).percent).toBe(33);
  });

  it("evento sem role não divide por zero", () => {
    expect(eventFill([])).toEqual({ confirmed: 0, total: 0, waitlist: 0, percent: 0 });
  });
});

describe("mySignupFor e mySignupLabel", () => {
  it("acha a inscrição ativa do evento e ignora a de outro", () => {
    const mine = [signup({ eventId: "e1" }), signup({ id: "s2", eventId: "e2", roleName: "Healer" })];
    expect(mySignupFor("e2", mine)?.roleName).toBe("Healer");
    expect(mySignupFor("e3", mine)).toBeNull();
  });

  it("inscrição cancelada não conta como minha inscrição (histórico)", () => {
    expect(mySignupFor("e1", [signup({ status: "cancelled" })])).toBeNull();
  });

  it("diz a role e a situação, com a posição quando é espera (Q27)", () => {
    expect(mySignupLabel(signup())).toBe("Tank, confirmado");
    expect(mySignupLabel(signup({ status: "waitlist", position: 2 }))).toBe("Tank, 2º na espera");
    expect(mySignupLabel(null)).toBeNull();
    expect(mySignupLabel(signup({ status: "cancelled" }))).toBeNull();
  });
});

describe("ações permitidas (AC#3)", () => {
  it("owner caller vê só as arestas da máquina a partir do estado atual (Q26)", () => {
    const a = ability(["member", "caller"]);
    expect(availableTransitions(event("e1", "draft"), a)).toEqual(["open", "cancel"]);
    expect(availableTransitions(event("e1", "open"), a)).toEqual(["close", "start", "cancel"]);
    expect(availableTransitions(event("e1", "closed"), a)).toEqual(["start", "cancel"]);
    expect(availableTransitions(event("e1", "running"), a)).toEqual(["finish", "cancel"]);
  });

  it("finalizado oferece só arquivar; cancelado e arquivado não oferecem nada (TASK-044 AC#3)", () => {
    const a = ability(["member", "caller", "staff"]);
    expect(availableTransitions(event("e1", "finished"), a)).toEqual(["archive"]);
    expect(availableTransitions(event("e1", "cancelled"), a)).toEqual([]);
    expect(availableTransitions(event("e1", "archived"), a)).toEqual([]);
    // Arquivar é de quem conduz: o owner caller e a staff veem; o membro não.
    expect(availableTransitions(event("e1", "finished"), ability(["member", "caller"]))).toEqual(["archive"]);
    expect(availableTransitions(event("e1", "finished", OTHER), ability(["member", "staff"]))).toEqual(["archive"]);
    expect(availableTransitions(event("e1", "finished"), ability(["member"], OTHER))).toEqual([]);
  });

  it("caller não vê ação no evento de outro caller; staff vê em qualquer um (Q9/Q21)", () => {
    const outro = event("e1", "open", OTHER);
    expect(availableTransitions(outro, ability(["member", "caller"]))).toEqual([]);
    expect(availableTransitions(outro, ability(["member", "staff"]))).toEqual(["close", "start", "cancel"]);
  });

  it("membro comum não vê nenhuma ação de estado", () => {
    expect(availableTransitions(event("e1", "open"), ability(["member"], OTHER))).toEqual([]);
  });

  it("mexer na lista é do owner/staff e só antes do evento rodar (AC#4 da TASK-022)", () => {
    const caller = ability(["member", "caller"]);
    expect(canManageRoster(event("e1", "open"), caller)).toBe(true);
    expect(canManageRoster(event("e1", "closed"), caller)).toBe(true);
    expect(canManageRoster(event("e1", "running"), caller)).toBe(false);
    expect(canManageRoster(event("e1", "finished"), caller)).toBe(false);
    expect(canManageRoster(event("e1", "archived"), caller)).toBe(false);
    expect(canManageRoster(event("e1", "open"), ability(["member"], OTHER))).toBe(false);
    expect(canManageRoster(event("e1", "open", OTHER), ability(["member", "staff"]))).toBe(true);
  });

  it("trocar o dono é só da staff e só enquanto o evento não foi arquivado nem cancelado (Q21)", () => {
    expect(canTransferOwner(event("e1", "open"), ability(["member", "caller"]))).toBe(false);
    expect(canTransferOwner(event("e1", "open"), ability(["member", "staff"]))).toBe(true);
    // `finished` ainda troca: a taxa vai para o owner e o acerto acontece depois do jogo (TASK-044 AC#2).
    expect(canTransferOwner(event("e1", "finished"), ability(["member", "staff"]))).toBe(true);
    expect(canTransferOwner(event("e1", "cancelled"), ability(["member", "staff"]))).toBe(false);
    expect(canTransferOwner(event("e1", "archived"), ability(["member", "staff"]))).toBe(false);
  });

  it("entrar e sair só com a inscrição aberta (Q26)", () => {
    expect(canJoinEvent(event("e1", "open"))).toBe(true);
    for (const status of ["draft", "closed", "running", "finished", "cancelled"] as const) expect(canJoinEvent(event("e1", status))).toBe(false);
  });
});

describe("nickOf", () => {
  it("troca o id pelo nick e cai num rótulo neutro quando não conhece a pessoa", () => {
    expect(nickOf(OTHER, [{ userId: OTHER, nick: "Zezinho" }])).toBe("Zezinho");
    expect(nickOf(OTHER, [])).toBe("Membro");
  });
});

describe("polling (AC#4)", () => {
  it("aba escondida não agenda atualização", () => {
    expect(nextPollDelay({ visible: false })).toBeNull();
  });

  it("aba visível atualiza a cada 10s e vai espaçando quando a API falha, até 1 min", () => {
    expect(nextPollDelay({ visible: true })).toBe(10_000);
    expect(nextPollDelay({ visible: true, failures: 1 })).toBe(20_000);
    expect(nextPollDelay({ visible: true, failures: 2 })).toBe(40_000);
    expect(nextPollDelay({ visible: true, failures: 9 })).toBe(60_000);
  });

});
