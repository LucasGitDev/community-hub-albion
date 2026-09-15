import { describe, expect, it } from "vitest";
import { planMemberSync } from "./member-sync.js";

const ROLE = "323456789012345678";

describe("planMemberSync (TASK-014/TASK-034, Q31)", () => {
  it("primeira aprovação: apelido + cargo Membro (TASK-034 AC#1)", () => {
    expect(planMemberSync({ decision: "approved", nick: "Lucas"}, ROLE)).toEqual([
      { kind: "setNickname", nick: "Lucas" },
      { kind: "addRole", roleId: ROLE },
    ]);
  });

  it("troca de nick aprovada: apelido + cargo Membro (TASK-034 AC#2)", () => {
    expect(planMemberSync({ decision: "approved", nick: "Novo" }, ROLE)).toEqual([
      { kind: "setNickname", nick: "Novo" },
      { kind: "addRole", roleId: ROLE },
    ]);
  });

  it("recusa não gera ação (AC#4)", () => {
    expect(planMemberSync({ decision: "rejected", nick: "X" }, ROLE)).toEqual([]);
  });
});
