import { describe, expect, it } from "vitest";
import {
  buildImportSummaryReply,
  emptyImportSummary,
  MAX_LISTED_CONFLICTS,
  planMemberImport,
  type GuildMemberSnapshot,
} from "./member-import.js";

const MEMBER_ROLE = "323456789012345678";
const base: GuildMemberSnapshot = {
  discordId: "920000000000000001",
  username: "erijj",
  globalName: "Erijj",
  nickname: "[GENEI] Erijj",
  avatar: null,
  roleIds: [MEMBER_ROLE],
  bot: false,
};

describe("planMemberImport", () => {
  it("importa membro com cargo e apelido, separando tag e nick", () => {
    expect(planMemberImport(base, MEMBER_ROLE)).toMatchObject({ kind: "import", guildTag: "GENEI", nick: "Erijj" });
  });

  it("importa apelido sem tag", () => {
    expect(planMemberImport({ ...base, nickname: "Erijj" }, MEMBER_ROLE)).toMatchObject({ kind: "import", guildTag: null, nick: "Erijj" });
  });

  it.each([
    [{ bot: true }, "é bot"],
    [{ roleIds: ["999999999999999999"] }, "sem o cargo Membro"],
    [{ nickname: null }, "sem apelido no servidor"],
    [{ nickname: "   " }, "sem apelido no servidor"],
  ])("ignora %j", (overrides, reason) => {
    expect(planMemberImport({ ...base, ...overrides }, MEMBER_ROLE)).toMatchObject({ kind: "skip", reason });
  });

  it("apelido que não vira nick é conflito com motivo", () => {
    const plan = planMemberImport({ ...base, nickname: "[GENEI] Nick Errado" }, MEMBER_ROLE);
    expect(plan.kind).toBe("conflict");
    if (plan.kind === "conflict") expect(plan.reason).toMatch(/\S/);
  });
});

describe("buildImportSummaryReply", () => {
  it("mostra os quatro números do resumo (AC#1)", () => {
    const reply = buildImportSummaryReply({ ...emptyImportSummary(), created: 20, updated: 3, skipped: 8, conflicts: ["`x` — nick inválido"] });
    expect(reply).toContain("**20** criados");
    expect(reply).toContain("**3** atualizados");
    expect(reply).toContain("**8** ignorados");
    expect(reply).toContain("**1** conflitos");
    expect(reply).toContain("`x` — nick inválido");
  });

  it("resume a conferência do Albion quando houve consulta", () => {
    const summary = { ...emptyImportSummary(), created: 3, albion: { found: 2, notFound: 1, unavailable: 0, disabled: 0 } };
    expect(buildImportSummaryReply(summary)).toContain("Albion: 2 encontrados, 1 não encontrados, 0 sem resposta");
  });

  it("avisa quando a consulta está desligada", () => {
    const summary = { ...emptyImportSummary(), created: 1, albion: { found: 0, notFound: 0, unavailable: 0, disabled: 1 } };
    expect(buildImportSummaryReply(summary)).toContain("desligada");
  });

  it("trunca a lista de conflitos longa", () => {
    const conflicts = Array.from({ length: MAX_LISTED_CONFLICTS + 4 }, (_, i) => `\`n${i}\` — inválido`);
    const reply = buildImportSummaryReply({ ...emptyImportSummary(), conflicts });
    expect(reply).toContain("e mais 4.");
    expect(reply).not.toContain(`n${MAX_LISTED_CONFLICTS + 1}`);
  });

  it("sem conflito nem consulta, só a linha de números", () => {
    expect(buildImportSummaryReply(emptyImportSummary()).split("\n")).toHaveLength(1);
  });
});
