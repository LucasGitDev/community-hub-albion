import { eventJoinButtonId, eventLeaveButtonId, type EventStatus } from "@albion-hub/shared";
import { describe, expect, it } from "vitest";
import { buttonRows } from "./embed-view.js";
import { buildEventEmbed, EVENT_BUTTON_REPLIES, EVENT_EMBED_COLORS, type EventEmbedInput } from "./event-embed.js";

const EVENT = "0f8fad5b-d9cb-469f-a165-70867728950e";
const TANK = "11111111-1111-4111-8111-111111111111";
const HEALER = "22222222-2222-4222-8222-222222222222";

const person = (n: number, nick: string | null = null) => ({ discordId: `40000000000000000${n}`, gameNick: nick });

const input = (over: Partial<EventEmbedInput> = {}): EventEmbedInput => ({
  eventId: EVENT,
  name: "Roads das 21h",
  description: "Leve capa de bandido",
  templateName: "Roads",
  status: "open",
  startsAt: new Date("2026-10-01T23:00:00.000Z"),
  roles: [
    { slotId: TANK, name: "Tank", description: null, slots: 1, confirmed: [], waitlist: [] },
    { slotId: HEALER, name: "Healer", description: null, slots: 2, confirmed: [], waitlist: [] },
  ],
  ...over,
});

const field = (view: ReturnType<typeof buildEventEmbed>, name: string) => view.fields.find((f) => f.name === name)?.value;

describe("embed de inscrição do evento (TASK-022, AC#1)", () => {
  it("evento aberto: um botão por role com as vagas livres, mais o Sair, tudo clicável", () => {
    const view = buildEventEmbed(input());
    expect(view.title).toBe("Roads das 21h");
    expect(view.description).toBe("Leve capa de bandido");
    expect(view.color).toBe(EVENT_EMBED_COLORS.open);
    expect(field(view, "Evento")).toContain("Template: Roads");
    expect(field(view, "Evento")).toContain("<t:");
    expect(view.buttons).toEqual([
      { customId: eventJoinButtonId(TANK), label: "Tank (1/1)", style: "primary", disabled: false },
      { customId: eventJoinButtonId(HEALER), label: "Healer (2/2)", style: "primary", disabled: false },
      { customId: eventLeaveButtonId(EVENT), label: "Sair", style: "danger", disabled: false },
    ]);
  });

  it("mostra confirmados, vagas restantes e a lista de espera por role (AC#2)", () => {
    const view = buildEventEmbed(
      input({
        roles: [
          { slotId: TANK, name: "Tank", description: null, slots: 1, confirmed: [person(1, "TankMain")], waitlist: [person(2), person(3)] },
          { slotId: HEALER, name: "Healer", description: null, slots: 2, confirmed: [person(4)], waitlist: [] },
        ],
      }),
    );
    expect(field(view, "Tank (1/1)")).toBe("<@400000000000000001> (TankMain)");
    expect(field(view, "Healer (1/2)")).toBe("<@400000000000000004>");
    expect(field(view, "Lista de espera")).toBe("1. <@400000000000000002> — Tank\n2. <@400000000000000003> — Tank");
    // Role lotada continua clicável (quem clicar entra na espera), mas em cinza.
    expect(view.buttons[0]).toMatchObject({ label: "Tank (0/1)", style: "secondary", disabled: false });
    expect(view.buttons[1]).toMatchObject({ label: "Healer (1/2)", style: "primary" });
  });

  it("role vazia mostra 'Vaga livre' e evento sem roles avisa", () => {
    expect(field(buildEventEmbed(input()), "Tank (0/1)")).toBe("Vaga livre");
    const empty = buildEventEmbed(input({ roles: [] }));
    expect(field(empty, "Roles")).toContain("nenhuma role configurada");
    expect(empty.buttons).toHaveLength(1);
  });

  it("fora de open os botões ficam desabilitados e o embed diz o estado (AC#5)", () => {
    // Cancelado fica de fora: ele não tem botão nenhum, nem lista (TASK-025, AC#4).
    for (const status of ["draft", "closed", "running", "finished"] as EventStatus[]) {
      const view = buildEventEmbed(input({ status }));
      expect(view.color).toBe(EVENT_EMBED_COLORS[status]);
      expect(view.buttons.every((b) => b.disabled)).toBe(true);
      expect(field(view, "Situação")).toContain("inscrições não estão abertas");
    }
    expect(field(buildEventEmbed(input({ status: "cancelled" })), "Situação")).toContain("cancelado");
  });

  it("sem horário e sem descrição o embed continua completo", () => {
    const view = buildEventEmbed(input({ startsAt: null, description: null, templateName: null }));
    expect(view.description).toBeUndefined();
    expect(field(view, "Evento")).toBe("Sem horário marcado");
  });

  it("lista gigante é cortada com contagem, sem partir menção no meio", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ discordId: `4000000000000000${String(i).padStart(2, "0")}`, gameNick: "NickBemLongoDeVerdade" }));
    const view = buildEventEmbed(input({ roles: [{ slotId: TANK, name: "Tank", description: null, slots: 60, confirmed: many, waitlist: [] }] }));
    const value = field(view, "Tank (60/60)")!;
    expect(value.length).toBeLessThanOrEqual(1024);
    expect(value).toContain("… e mais ");
    expect(value.split("\n").every((line) => !line.startsWith("<@4000000000000000") || line.endsWith(")"))).toBe(true);
  });

  it("descrição da role vira um guia único antes da lista, sem mexer nos botões (TASK-039, AC#2)", () => {
    const view = buildEventEmbed(
      input({
        roles: [
          { slotId: TANK, name: "Tank", description: "Segura a frente e chama o engage.", slots: 1, confirmed: [], waitlist: [] },
          { slotId: HEALER, name: "Healer", description: null, slots: 2, confirmed: [], waitlist: [] },
        ],
      }),
    );
    expect(field(view, "O que cada role faz")).toBe("**Tank** — Segura a frente e chama o engage.");
    // O guia vem antes da lista: quem decide lê o que a role faz e só então bate o olho em quem já entrou.
    expect(view.fields.findIndex((f) => f.name === "O que cada role faz")).toBeLessThan(view.fields.findIndex((f) => f.name.startsWith("Tank (")));
    // Role sem descrição não gera linha vazia, e o botão continua só nome + vagas (label do Discord tem 80).
    expect(field(view, "O que cada role faz")).not.toContain("Healer");
    expect(view.buttons.map((b) => b.label)).toEqual(["Tank (1/1)", "Healer (2/2)", "Sair"]);
  });

  it("descrição longa é cortada no guia e AC#3: sem descrição nenhuma o campo não aparece", () => {
    const long = "x".repeat(200);
    const view = buildEventEmbed(input({ roles: [{ slotId: TANK, name: "Tank", description: long, slots: 1, confirmed: [], waitlist: [] }] }));
    const guide = field(view, "O que cada role faz")!;
    expect(guide.endsWith("…")).toBe(true);
    expect(guide.length).toBeLessThanOrEqual("**Tank** — ".length + 120);
    expect(field(buildEventEmbed(input()), "O que cada role faz")).toBeUndefined();
  });

  it("muitas roles cabem nas 5 linhas de botões do Discord", () => {
    const roles = Array.from({ length: 30 }, (_, i) => ({ slotId: `3333333${String(i).padStart(4, "0")}-3333-4333-8333-333333333333`, name: `R${i}`, description: null, slots: 1, confirmed: [], waitlist: [] }));
    const view = buildEventEmbed(input({ roles }));
    const rows = buttonRows(view.buttons);
    expect(rows).toHaveLength(5);
    expect(rows.flat()).toHaveLength(25);
  });
});

describe("embed do evento cancelado (TASK-025, AC#4)", () => {
  it("mostra o motivo, avisa que as inscrições caíram e não deixa nenhum botão na mensagem", () => {
    const view = buildEventEmbed(
      input({
        status: "cancelled",
        cancelReason: "não fechou grupo",
        roles: [{ slotId: TANK, name: "Tank", description: null, slots: 1, confirmed: [person(1, "Mago")], waitlist: [person(2)] }],
      }),
    );
    expect(view.color).toBe(EVENT_EMBED_COLORS.cancelled);
    expect(field(view, "Situação")).toBe("Evento cancelado: não fechou grupo. Todas as inscrições foram canceladas.");
    // Sem botão nenhum: nem "Sair" desabilitado, que faria a mensagem parecer um evento ainda de pé.
    expect(view.buttons).toEqual([]);
    // A lista sai da mensagem junto: ninguém está mais inscrito.
    expect(field(view, "Tank (1/1)")).toBeUndefined();
    expect(field(view, "Lista de espera")).toBeUndefined();
  });

  it("sem motivo escrito, o aviso ainda diz que foi cancelado", () => {
    const view = buildEventEmbed(input({ status: "cancelled", cancelReason: null }));
    expect(field(view, "Situação")).toContain("Evento cancelado pelo caller.");
    expect(view.buttons).toEqual([]);
  });
});

describe("embed do evento arquivado (TASK-044, AC#3)", () => {
  it("diz que acabou e já foi fechado, mantém a lista e não deixa nenhum botão", () => {
    const view = buildEventEmbed(
      input({ status: "archived", roles: [{ slotId: TANK, name: "Tank", description: null, slots: 1, confirmed: [person(1, "Mago")], waitlist: [person(2)] }] }),
    );
    expect(view.color).toBe(EVENT_EMBED_COLORS.archived);
    expect(field(view, "Situação")).toBe("Evento arquivado. Acabou e já foi fechado: os dados, a taxa e os splits não mudam mais.");
    expect(view.buttons).toEqual([]);
    // Ao contrário do cancelado, a lista fica: o evento aconteceu e quem jogou continua no registro.
    expect(field(view, "Tank (1/1)")).toContain("Mago");
    expect(field(view, "Lista de espera")).toContain("Tank");
  });

  it("finalizado e arquivado não se confundem: cor, situação e botões diferentes", () => {
    const finished = buildEventEmbed(input({ status: "finished" }));
    const archived = buildEventEmbed(input({ status: "archived" }));
    expect(finished.color).not.toBe(archived.color);
    expect(field(finished, "Situação")).toBe("Evento finalizado. As inscrições não estão abertas.");
    expect(field(archived, "Situação")).not.toBe(field(finished, "Situação"));
    // Finalizado ainda mostra a lista com os botões desabilitados; arquivado não tem botão nenhum.
    expect(finished.buttons.length).toBeGreaterThan(0);
    expect(archived.buttons).toEqual([]);
  });
});

describe("respostas efêmeras dos botões", () => {
  it("dizem o que fazer em cada recusa (PT-BR)", () => {
    expect(EVENT_BUTTON_REPLIES.accountCreated).toContain("/registrar");
    expect(EVENT_BUTTON_REPLIES.notMember).toContain("/registrar");
    expect(EVENT_BUTTON_REPLIES.notOpen("closed")).toContain("com inscrições fechadas");
    expect(EVENT_BUTTON_REPLIES.waitlisted("Tank", 2)).toContain("posição 2");
    expect(EVENT_BUTTON_REPLIES.confirmed("Tank")).toContain("Tank");
    expect(EVENT_BUTTON_REPLIES.alreadyInRole("Tank")).toContain("Tank");
  });
});
