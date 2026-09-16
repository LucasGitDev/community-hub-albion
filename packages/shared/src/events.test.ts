import { describe, expect, it } from "vitest";
import {
  ALLOWED_EVENT_TRANSITIONS,
  EVENT_STATUSES,
  EVENT_TRANSITIONS,
  EVENT_TRANSITION_NAMES,
  TERMINAL_EVENT_STATUSES,
  canCancel,
  canTransition,
  eventCreateSchema,
  eventStatusLabel,
  eventTransferOwnerSchema,
  isEventTransition,
  parseEventListQuery,
  transitionError,
  type EventStatus,
} from "./events.js";

/** Tabela-verdade escrita à mão: o teste não pode derivar do mapa que está testando. */
const VALID = new Set<`${EventStatus}->${EventStatus}`>([
  "draft->open",
  "draft->cancelled",
  "open->closed",
  "open->running",
  "open->cancelled",
  "closed->running",
  "closed->cancelled",
  "running->finished",
  "running->cancelled",
]);

describe("máquina de estados do evento (TASK-021, Q26)", () => {
  it("cobre todos os 36 pares de estados: só as 9 arestas da tabela são permitidas", () => {
    const allowed: string[] = [];
    for (const from of EVENT_STATUSES)
      for (const to of EVENT_STATUSES) {
        const pair = `${from}->${to}` as const;
        expect(canTransition(from, to), pair).toBe(VALID.has(pair));
        if (canTransition(from, to)) allowed.push(pair);
      }
    expect(allowed).toHaveLength(9);
    expect(EVENT_STATUSES.length ** 2).toBe(36);
  });

  it("nenhum estado transita para si mesmo", () => {
    for (const status of EVENT_STATUSES) expect(canTransition(status, status), status).toBe(false);
  });

  it("finished e cancelled são finais: nada sai deles (Q26)", () => {
    expect(TERMINAL_EVENT_STATUSES).toEqual(["finished", "cancelled"]);
    for (const status of TERMINAL_EVENT_STATUSES) {
      expect(ALLOWED_EVENT_TRANSITIONS[status]).toEqual([]);
      for (const to of EVENT_STATUSES) expect(canTransition(status, to)).toBe(false);
    }
  });

  it("cancelled é alcançável de todo estado antes de finished, e só deles (Q26)", () => {
    for (const status of EVENT_STATUSES) expect(canCancel(status), status).toBe(!TERMINAL_EVENT_STATUSES.includes(status));
  });

  it("start com inscrição aberta é válido: open→running sem passar por closed (Q26, start fecha)", () => {
    expect(canTransition("open", "running")).toBe(true);
    expect(canTransition("closed", "running")).toBe(true);
  });

  it("não há volta: nenhuma aresta anda para trás na ordem draft→open→closed→running→finished", () => {
    const order = ["draft", "open", "closed", "running", "finished"] as const;
    for (const [i, from] of order.entries())
      for (const to of ALLOWED_EVENT_TRANSITIONS[from]) {
        if (to === "cancelled") continue;
        expect(order.indexOf(to as (typeof order)[number]), `${from}->${to}`).toBeGreaterThan(i);
      }
  });

  it("ações da API mapeiam para estados e são reconhecidas", () => {
    expect(EVENT_TRANSITIONS).toEqual({ open: "open", close: "closed", start: "running", finish: "finished", cancel: "cancelled" });
    expect(EVENT_TRANSITION_NAMES).toEqual(["open", "close", "start", "finish", "cancel"]);
    for (const name of EVENT_TRANSITION_NAMES) expect(isEventTransition(name)).toBe(true);
    expect(isEventTransition("destroy")).toBe(false);
    expect(isEventTransition("toString")).toBe(false);
  });

  it("erro PT-BR diz o estado atual e as saídas possíveis", () => {
    expect(transitionError("draft", "running")).toBe("O evento está rascunho e não pode ir para em andamento. Daqui só dá para ir para: com inscrições abertas, cancelado.");
    expect(transitionError("finished", "cancelled")).toBe("O evento está finalizado e não pode ir para cancelado. Esse é um estado final.");
    for (const status of EVENT_STATUSES) expect(eventStatusLabel(status)).toBeTruthy();
  });
});

describe("schemas de evento (TASK-021)", () => {
  const base = { templateId: "11111111-1111-4111-8111-111111111111", name: "  Roads 10h  " };

  it("aceita criação mínima e limpa espaços; horários ausentes viram null", () => {
    const parsed = eventCreateSchema.parse(base);
    expect(parsed).toMatchObject({ name: "Roads 10h", description: null, startsAt: null, signupsCloseAt: null });
  });

  it("converte horários ISO em Date", () => {
    const parsed = eventCreateSchema.parse({ ...base, startsAt: "2026-10-01T22:00:00.000Z", signupsCloseAt: "2026-10-01T21:30:00.000Z", description: "Roads de ouro" });
    expect(parsed.startsAt).toEqual(new Date("2026-10-01T22:00:00.000Z"));
    expect(parsed.signupsCloseAt).toEqual(new Date("2026-10-01T21:30:00.000Z"));
    expect(parsed.description).toBe("Roads de ouro");
  });

  it("recusa inscrição fechando depois do início", () => {
    const result = eventCreateSchema.safeParse({ ...base, startsAt: "2026-10-01T22:00:00.000Z", signupsCloseAt: "2026-10-01T23:00:00.000Z" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("As inscrições precisam fechar até o início do evento.");
  });

  it("recusa template inválido, nome vazio e data sem sentido", () => {
    expect(eventCreateSchema.safeParse({ ...base, templateId: "x" }).error?.issues[0]?.message).toBe("Template inválido.");
    expect(eventCreateSchema.safeParse({ ...base, name: "   " }).error?.issues[0]?.message).toBe("Digite o nome do evento.");
    expect(eventCreateSchema.safeParse({ ...base, startsAt: "amanhã" }).error?.issues[0]?.message).toBe("O horário de início precisa ser uma data e hora válidas.");
  });

  it("transferência exige uuid do novo owner", () => {
    expect(eventTransferOwnerSchema.safeParse({ ownerUserId: "22222222-2222-4222-8222-222222222222" }).success).toBe(true);
    expect(eventTransferOwnerSchema.safeParse({ ownerUserId: "eu" }).error?.issues[0]?.message).toBe("Novo owner inválido.");
  });

  it("filtros da listagem aceitam status repetido e recusam valor desconhecido", () => {
    expect(parseEventListQuery({ status: "open" })).toEqual({ ok: true, filters: { status: ["open"] } });
    expect(parseEventListQuery({ status: ["open", "closed"] })).toEqual({ ok: true, filters: { status: ["open", "closed"] } });
    expect(parseEventListQuery({})).toEqual({ ok: true, filters: {} });
    expect(parseEventListQuery({ status: "aberto" }).ok).toBe(false);
    expect(parseEventListQuery({ ownerUserId: "eu" })).toEqual({ ok: false, error: "Owner inválido." });
  });
});
