import { describe, expect, it } from "vitest";
import {
  checkPartySize,
  eventRoleInputSchema,
  eventRolePatchSchema,
  eventTemplateInputSchema,
  eventTemplatePatchSchema,
  firstIssue,
  formatPartySize,
  totalSlots,
} from "./event-templates.js";

const TANK = "11111111-1111-4111-8111-111111111111";
const HEAL = "22222222-2222-4222-8222-222222222222";

const template = (over: Record<string, unknown> = {}) => ({
  name: "DG de grupo",
  minPartySize: 4,
  maxPartySize: 9,
  roles: [
    { roleId: TANK, slots: 1, buffunfaMin: 0n, buffunfaMax: 0n },
    { roleId: HEAL, slots: 3 },
  ],
  ...over,
});

const errorOf = (res: { success: boolean; error?: Parameters<typeof firstIssue>[0] }) => (res.success ? null : firstIssue(res.error!));

describe("eventRoleInputSchema (TASK-020 AC#1, Q8)", () => {
  it("normaliza nome e descrição vazia vira null", () => {
    expect(eventRoleInputSchema.parse({ name: "  Tank  ", description: "  " })).toEqual({ name: "Tank", description: null });
    expect(eventRoleInputSchema.parse({ name: "Scout", description: " olheiro " })).toEqual({ name: "Scout", description: "olheiro" });
  });

  it.each([
    [{}, "Digite o nome da role."],
    [{ name: "   " }, "Digite o nome da role."],
    [{ name: "x".repeat(41) }, "no máximo 40"],
    [{ name: "Tank", description: "x".repeat(201) }, "no máximo 200"],
  ])("recusa %j", (input, message) => {
    expect(errorOf(eventRoleInputSchema.safeParse(input))).toContain(message);
  });

  it("patch aceita parcial", () => {
    expect(eventRolePatchSchema.parse({ description: "novo" })).toEqual({ description: "novo" });
  });
});

describe("eventTemplateInputSchema (TASK-020 AC#2, Q8)", () => {
  it("aceita template válido com active default true e sem teto", () => {
    expect(eventTemplateInputSchema.parse(template())).toMatchObject({ active: true, description: null, maxPartySize: 9 });
    expect(eventTemplateInputSchema.parse(template({ maxPartySize: null, minPartySize: 2 })).maxPartySize).toBeNull();
  });

  it.each([
    [{ roles: [] }, "pelo menos uma role"],
    [{ roles: [{ roleId: TANK, slots: 0, buffunfaMin: 0n, buffunfaMax: 0n }] }, "Vagas precisa ser pelo menos 1"],
    [{ roles: [{ roleId: TANK, slots: 1.5, buffunfaMin: 0n, buffunfaMax: 0n }] }, "inteiro"],
    [{ roles: [{ roleId: "x", slots: 4, buffunfaMin: 0n, buffunfaMax: 0n }] }, "Role inválida"],
    [{ roles: [{ roleId: TANK, slots: 2, buffunfaMin: 0n, buffunfaMax: 0n }, { roleId: TANK, slots: 2, buffunfaMin: 0n, buffunfaMax: 0n }] }, "Cada role aparece uma vez"],
    [{ minPartySize: 0 }, "pelo menos 1"],
    [{ maxPartySize: 301 }, "vai até 300"],
    [{ minPartySize: 10, maxPartySize: 9 }, "mínimo de pessoas não pode passar do máximo"],
    [{ roles: [{ roleId: TANK, slots: 10, buffunfaMin: 0n, buffunfaMax: 0n }] }, "acima do máximo de 9"],
    [{ roles: [{ roleId: TANK, slots: 3, buffunfaMin: 0n, buffunfaMax: 0n }] }, "abaixo do mínimo de 4"],
    [{ name: "" }, "Digite o nome do template."],
    [{ minPartySize: "4" }, "número inteiro"],
  ])("recusa %j", (over, message) => {
    expect(errorOf(eventTemplateInputSchema.safeParse(template(over)))).toContain(message);
  });

  it("patch parcial não aplica defaults", () => {
    expect(eventTemplatePatchSchema.parse({ active: false })).toEqual({ active: false });
  });
});

describe("regras de party", () => {
  it("soma vagas e formata faixa", () => {
    expect(totalSlots([{ slots: 2 }, { slots: 5 }])).toBe(7);
    expect(formatPartySize(4, 9)).toBe("4–9");
    expect(formatPartySize(2, null)).toBe("2+");
    expect(formatPartySize(5, 5)).toBe("5");
  });

  it("sem teto só exige alcançar o mínimo", () => {
    expect(checkPartySize({ minPartySize: 2, maxPartySize: null, roles: [{ slots: 40 }] })).toEqual({ ok: true });
    expect(checkPartySize({ minPartySize: 2, maxPartySize: null, roles: [{ slots: 1 }] }).ok).toBe(false);
  });

  it("firstIssue tem fallback", () => {
    expect(firstIssue({ issues: [] } as unknown as Parameters<typeof firstIssue>[0])).toBe("Dados inválidos.");
  });
});
