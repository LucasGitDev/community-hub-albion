import { describe, expect, it } from "vitest";
import { BAN_EFFECTS, BAN_NON_EFFECTS, BAN_REASON_MAX_LENGTH, BAN_REASON_MIN_LENGTH, bannedSignupReply, validateBanReason } from "./ban.js";
import { defineAbilityFor } from "./permissions.js";

describe("motivo do banimento (TASK-050)", () => {
  it("recusa vazio, só espaço, não-string e curto demais", () => {
    for (const value of ["", "   ", null, undefined, 42, {}]) expect(validateBanReason(value).ok).toBe(false);
    expect(validateBanReason("x".repeat(BAN_REASON_MIN_LENGTH - 1)).ok).toBe(false);
  });

  it("aceita a partir do mínimo e até o máximo, aparando as pontas", () => {
    expect(validateBanReason("x".repeat(BAN_REASON_MIN_LENGTH))).toEqual({ ok: true, reason: "x".repeat(BAN_REASON_MIN_LENGTH) });
    expect(validateBanReason("  roubou o loot  ")).toEqual({ ok: true, reason: "roubou o loot" });
    expect(validateBanReason("x".repeat(BAN_REASON_MAX_LENGTH)).ok).toBe(true);
    expect(validateBanReason("x".repeat(BAN_REASON_MAX_LENGTH + 1)).ok).toBe(false);
  });

  it("a resposta do bot diz o motivo e para onde a pessoa deve ir", () => {
    const reply = bannedSignupReply("roubou o loot do split");
    expect(reply).toContain("roubou o loot do split");
    expect(reply).toContain("staff");
  });

  it("as duas listas explicam o banimento sem se contradizer", () => {
    expect(BAN_EFFECTS.length).toBeGreaterThan(0);
    expect(BAN_NON_EFFECTS.some((t) => t.includes("Discord"))).toBe(true);
    expect(BAN_NON_EFFECTS.some((t) => t.includes("saldo"))).toBe(true);
  });
});

describe("permissão de banir (TASK-050, Q13)", () => {
  const can = (roles: string[]) => defineAbilityFor({ id: "u1", roles: roles as never }).can("ban", "Ban");

  it("staff e admin banem; member e caller não", () => {
    expect(can(["member"])).toBe(false);
    expect(can(["caller"])).toBe(false);
    expect(can(["member", "caller"])).toBe(false);
    expect(can(["staff"])).toBe(true);
    expect(can(["admin"])).toBe(true);
  });
});
