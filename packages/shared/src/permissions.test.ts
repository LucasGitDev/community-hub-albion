import { describe, expect, it } from "vitest";
import { asSubject, defineAbilityFor, type Action, type SubjectType } from "./permissions.js";
import type { Role } from "./roles.js";

const ME = "u-me";
const OTHER = "u-other";

type Case = [Action, SubjectType, "own" | "other" | "type", Record<Role, boolean>];

const yes = { member: true, caller: true, staff: true, admin: true };
const matrix: Case[] = [
  // carteira e saques
  ["read", "Wallet", "own", yes],
  ["read", "Wallet", "other", { member: false, caller: false, staff: true, admin: true }],
  ["create", "Withdrawal", "type", yes],
  ["read", "Withdrawal", "own", yes],
  ["read", "Withdrawal", "other", { member: false, caller: false, staff: true, admin: true }],
  ["approve", "Withdrawal", "other", { member: false, caller: false, staff: true, admin: true }],
  ["reject", "Withdrawal", "other", { member: false, caller: false, staff: true, admin: true }],
  ["settle", "Withdrawal", "other", { member: false, caller: false, staff: true, admin: true }],
  // eventos
  ["read", "Event", "type", yes],
  ["join", "Event", "other", yes],
  ["create", "Event", "type", { member: false, caller: true, staff: true, admin: true }],
  ["start", "Event", "own", { member: false, caller: true, staff: true, admin: true }],
  ["start", "Event", "other", { member: false, caller: false, staff: true, admin: true }],
  ["cancel", "Event", "own", { member: false, caller: true, staff: true, admin: true }],
  ["distribute", "Event", "own", { member: false, caller: true, staff: true, admin: true }],
  ["distribute", "Event", "other", { member: false, caller: false, staff: true, admin: true }],
  ["update", "EventTemplate", "type", { member: false, caller: false, staff: true, admin: true }],
  ["read", "EventTemplate", "type", { member: false, caller: true, staff: true, admin: true }],
  ["update", "LootSplit", "type", { member: false, caller: false, staff: true, admin: true }],
  // entrada e papéis
  ["create", "MemberRequest", "type", yes],
  ["read", "MemberRequest", "own", yes],
  ["read", "MemberRequest", "other", { member: false, caller: false, staff: true, admin: true }],
  ["approve", "MemberRequest", "type", { member: false, caller: false, staff: true, admin: true }],
  ["update", "UserRole", "type", { member: false, caller: false, staff: false, admin: true }],
  ["read", "UserRole", "type", { member: false, caller: false, staff: false, admin: true }],
];

function target(subjectType: SubjectType, who: "own" | "other" | "type") {
  if (who === "type" || subjectType === "all") return subjectType;
  const id = who === "own" ? ME : OTHER;
  if (subjectType === "Event") return asSubject("Event", { ownerId: id });
  if (subjectType === "Wallet" || subjectType === "Withdrawal" || subjectType === "MemberRequest") return asSubject(subjectType, { userId: id });
  return subjectType;
}

describe("matriz papel x permissão (Q13)", () => {
  const roles: Role[] = ["member", "caller", "staff", "admin"];
  for (const [action, subjectType, who, expected] of matrix) {
    for (const role of roles) {
      // member é base de todo usuário logado; papel extra soma.
      const userRoles: Role[] = role === "member" ? ["member"] : ["member", role];
      it(`${role} ${expected[role] ? "pode" : "não pode"} ${action} ${subjectType} (${who})`, () => {
        const ability = defineAbilityFor({ id: ME, roles: userRoles });
        expect(ability.can(action, target(subjectType, who))).toBe(expected[role]);
      });
    }
  }

  it("usuário sem papel não pode nada", () => {
    const ability = defineAbilityFor({ id: ME, roles: [] });
    expect(ability.can("read", "Event")).toBe(false);
    expect(ability.can("read", asSubject("Wallet", { userId: ME }))).toBe(false);
  });

  it("papéis se somam: caller + staff tem regras dos dois", () => {
    const ability = defineAbilityFor({ id: ME, roles: ["member", "caller", "staff"] });
    expect(ability.can("start", asSubject("Event", { ownerId: OTHER }))).toBe(true);
    expect(ability.can("update", "UserRole")).toBe(false);
  });
});
