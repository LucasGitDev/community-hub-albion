import { describe, expect, it } from "vitest";
import {
  ACTIVE_EVENT_SIGNUP_STATUSES,
  EVENT_JOIN_BUTTON,
  EVENT_LEAVE_BUTTON,
  EVENT_SIGNUP_STATUSES,
  eventJoinButtonId,
  eventJoinSchema,
  eventLeaveButtonId,
  eventSignupMoveSchema,
  freeSlots,
  isActiveEventSignup,
  isRoleFull,
  isUuid,
  occupancyByRole,
  roleButtonLabel,
  type EventSignupDto,
} from "./event-signups.js";

const SLOT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const signup = (slotId: string, status: EventSignupDto["status"]) => ({ slotId, status });

describe("estados da inscrição (TASK-022, Q27)", () => {
  it("confirmado e espera ocupam lugar; cancelado não", () => {
    expect(EVENT_SIGNUP_STATUSES).toEqual(["confirmed", "waitlist", "cancelled"]);
    expect(ACTIVE_EVENT_SIGNUP_STATUSES).toEqual(["confirmed", "waitlist"]);
    expect(isActiveEventSignup("confirmed")).toBe(true);
    expect(isActiveEventSignup("waitlist")).toBe(true);
    expect(isActiveEventSignup("cancelled")).toBe(false);
  });
});

describe("contagem de vagas e rótulo do botão (AC#1)", () => {
  it("vagas livres = total - confirmados, nunca negativo", () => {
    expect(freeSlots({ slots: 3, confirmed: 0 })).toBe(3);
    expect(freeSlots({ slots: 3, confirmed: 2 })).toBe(1);
    expect(freeSlots({ slots: 3, confirmed: 3 })).toBe(0);
    // Staff cortou vagas depois de gente confirmada: não mostra "-1".
    expect(freeSlots({ slots: 1, confirmed: 4 })).toBe(0);
  });

  it("role lotada é a que não tem vaga livre", () => {
    expect(isRoleFull({ slots: 2, confirmed: 1 })).toBe(false);
    expect(isRoleFull({ slots: 2, confirmed: 2 })).toBe(true);
    expect(isRoleFull({ slots: 2, confirmed: 5 })).toBe(true);
  });

  it("rótulo mostra livres/total e cabe no limite do Discord", () => {
    expect(roleButtonLabel({ name: "Tank", slots: 3, confirmed: 2 })).toBe("Tank (1/3)");
    expect(roleButtonLabel({ name: "Healer", slots: 2, confirmed: 2 })).toBe("Healer (0/2)");
    expect(roleButtonLabel({ name: "N".repeat(120), slots: 1, confirmed: 0 })).toHaveLength(80);
  });
});

describe("ocupação por role", () => {
  const roles = [
    { id: SLOT, name: "Tank", slots: 2 },
    { id: OTHER, name: "Healer", slots: 1 },
  ];

  it("conta confirmados e espera de cada role e ignora cancelados", () => {
    const occupancy = occupancyByRole(roles, [
      signup(SLOT, "confirmed"),
      signup(SLOT, "confirmed"),
      signup(SLOT, "waitlist"),
      signup(SLOT, "cancelled"),
      signup(OTHER, "waitlist"),
    ]);
    expect(occupancy).toEqual([
      { slotId: SLOT, name: "Tank", slots: 2, confirmed: 2, waitlist: 1 },
      { slotId: OTHER, name: "Healer", slots: 1, confirmed: 0, waitlist: 1 },
    ]);
    expect(occupancy.map(roleButtonLabel)).toEqual(["Tank (0/2)", "Healer (1/1)"]);
  });

  it("inscrição em vaga que não existe mais não aparece em nenhuma role", () => {
    const occupancy = occupancyByRole(roles, [signup("33333333-3333-4333-8333-333333333333", "confirmed")]);
    expect(occupancy.every((r) => r.confirmed === 0 && r.waitlist === 0)).toBe(true);
  });

  it("evento sem roles devolve lista vazia", () => {
    expect(occupancyByRole([], [signup(SLOT, "confirmed")])).toEqual([]);
  });
});

describe("custom ids dos botões", () => {
  it("carregam só o alvo, e o alvo volta pelo padrão do Necord", () => {
    expect(eventJoinButtonId(SLOT)).toBe(`evento/inscrever/${SLOT}`);
    expect(eventLeaveButtonId(OTHER)).toBe(`evento/sair/${OTHER}`);
    expect(EVENT_JOIN_BUTTON).toBe("evento/inscrever/:slotId");
    expect(EVENT_LEAVE_BUTTON).toBe("evento/sair/:eventId");
    // Limite de 100 caracteres do custom_id do Discord.
    expect(eventJoinButtonId(SLOT).length).toBeLessThanOrEqual(100);
  });

  it("id do custom id só passa se for uuid", () => {
    expect(isUuid(SLOT)).toBe(true);
    expect(isUuid("../../admin")).toBe(false);
    expect(isUuid("")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid(42)).toBe(false);
  });
});

describe("schemas da API", () => {
  it("entrar exige uuid de role", () => {
    expect(eventJoinSchema.safeParse({ slotId: SLOT }).success).toBe(true);
    const bad = eventJoinSchema.safeParse({ slotId: "tank" });
    expect(bad.success).toBe(false);
    expect(!bad.success && bad.error.issues[0]!.message).toBe("Role inválida.");
  });

  it("mover aceita espera ou role, e nada mais", () => {
    expect(eventSignupMoveSchema.safeParse({ target: "waitlist" }).success).toBe(true);
    expect(eventSignupMoveSchema.safeParse({ target: "role", slotId: SLOT }).success).toBe(true);
    expect(eventSignupMoveSchema.safeParse({ target: "role" }).success).toBe(false);
    expect(eventSignupMoveSchema.safeParse({ target: "confirmed" }).success).toBe(false);
    expect(eventSignupMoveSchema.safeParse({}).success).toBe(false);
  });
});
