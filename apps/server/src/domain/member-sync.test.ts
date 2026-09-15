import { describe, expect, it } from "vitest";
import { planMemberSync } from "./member-sync.js";

const ROLE = "323456789012345678";

describe("planMemberSync (TASK-014, Q31)", () => {
  it("primeira aprovação: apelido + cargo Membro (AC#1, AC#2)", () => {
    expect(planMemberSync({ decision: "approved", nick: "Lucas", previousGameNick: null }, ROLE)).toEqual([
      { kind: "setNickname", nick: "Lucas" },
      { kind: "addRole", roleId: ROLE },
    ]);
  });

  it("troca de nick aprovada: só apelido", () => {
    expect(planMemberSync({ decision: "approved", nick: "Novo", previousGameNick: "Antigo" }, ROLE)).toEqual([{ kind: "setNickname", nick: "Novo" }]);
  });

  it("recusa não gera ação (AC#4)", () => {
    expect(planMemberSync({ decision: "rejected", nick: "X", previousGameNick: null }, ROLE)).toEqual([]);
    expect(planMemberSync({ decision: "rejected", nick: "X", previousGameNick: "Y" }, ROLE)).toEqual([]);
  });
});
