import { describe, expect, it } from "vitest";
import { assessGuildCleanup, guildCleanupAbsentLimit, guildCleanupNote, nextGuildCleanupRun } from "./guild-cleanup.js";

describe("disjuntor da limpeza diária (TASK-049, AC#5)", () => {
  it("recusa a passada quando o Discord devolve zero membros", () => {
    const verdict = assessGuildCleanup({ presentCount: 0, knownCount: 30, absentCount: 30 });
    expect(verdict).toEqual({ ok: false, reason: expect.stringContaining("zero membros") });
  });

  it("recusa quando ausentes demais sumiriam de uma vez (resposta parcial)", () => {
    // 30 contas conhecidas, o Discord devolveu 2: 28 ausentes contra um limite de 15.
    const verdict = assessGuildCleanup({ presentCount: 2, knownCount: 30, absentCount: 28 });
    expect(verdict.ok).toBe(false);
  });

  it("deixa passar uma limpeza de tamanho normal", () => {
    expect(assessGuildCleanup({ presentCount: 28, knownCount: 30, absentCount: 2 })).toEqual({ ok: true });
  });

  it("não trava comunidade pequena: o piso vale mais que a proporção", () => {
    expect(guildCleanupAbsentLimit(4)).toBe(5);
    expect(assessGuildCleanup({ presentCount: 1, knownCount: 4, absentCount: 3 })).toEqual({ ok: true });
  });

  it("banco sem nenhuma conta não é anomalia", () => {
    expect(assessGuildCleanup({ presentCount: 0, knownCount: 0, absentCount: 0 })).toEqual({ ok: true });
  });
});

describe("agenda da limpeza (AC#1)", () => {
  it("de madrugada do mesmo dia quando ainda não passou das 4h", () => {
    const next = nextGuildCleanupRun(new Date(2026, 8, 17, 1, 30));
    expect(next).toEqual(new Date(2026, 8, 17, 4, 0, 0, 0));
  });

  it("empurra para o dia seguinte quando o horário já passou", () => {
    const next = nextGuildCleanupRun(new Date(2026, 8, 17, 4, 0, 0, 0));
    expect(next).toEqual(new Date(2026, 8, 18, 4, 0, 0, 0));
  });

  it("atravessa a virada do mês", () => {
    expect(nextGuildCleanupRun(new Date(2026, 8, 30, 23, 59))).toEqual(new Date(2026, 9, 1, 4, 0, 0, 0));
  });
});

describe("nota de autoria (segurança: o job age sem usuário logado)", () => {
  it("diz que foi a limpeza automática e que o dinheiro não foi tocado", () => {
    const note = guildCleanupNote(2, ["staff"]);
    expect(note).toContain("Limpeza automática");
    expect(note).toContain("Sessões derrubadas: 2");
    expect(note).toContain("Papéis removidos: staff");
    expect(note).toContain("Saldo, extrato e saques não foram tocados");
  });

  it("sem papéis, diz nenhum", () => {
    expect(guildCleanupNote(0, [])).toContain("Papéis removidos: nenhum");
  });
});
