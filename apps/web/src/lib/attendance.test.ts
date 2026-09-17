import type { EventAttendanceDto, EventAttendanceLineDto } from "@albion-hub/shared";
import { describe, expect, it } from "vitest";
import { attendanceBlockedReason, attendancePayoutText, attendanceSkipText, attendanceSummary, checkRoleValue, roleRangeText } from "./attendance";

const line = (over: Partial<EventAttendanceLineDto> = {}): EventAttendanceLineDto => ({
  key: "1",
  userId: "u-1",
  nick: "Tanque",
  roleName: "Tank",
  presenceMs: 3_600_000,
  presenceBp: 10_000,
  roleValue: "30",
  amount: "30",
  skip: null,
  ...over,
});

const dto = (over: Partial<EventAttendanceDto> = {}): EventAttendanceDto => ({
  windowMs: 3_600_000,
  measured: true,
  paidAt: null,
  lines: [line()],
  total: "30",
  ...over,
});

const tank = { buffunfaMin: "10", buffunfaMax: "40" };

describe("resumo do fechamento", () => {
  it("conta quem recebe e quem fica de fora", () => {
    const d = dto({ lines: [line(), line({ key: "2", skip: "below_presence", amount: "0" })] });
    expect(attendanceSummary(d)).toEqual({ paying: 1, skipped: 1, total: 30n, paid: false });
  });

  it("diz quantos recebem e quanta Buffunfa nasce", () => {
    expect(attendancePayoutText(dto())).toBe("1 pessoa recebe — 30 de Buffunfa criada no fechamento.");
    expect(attendancePayoutText(dto({ lines: [line(), line({ key: "2" })], total: "60" }))).toBe("2 pessoas recebem — 60 de Buffunfa criada no fechamento.");
    expect(attendancePayoutText(dto({ lines: [line({ skip: "below_presence", amount: "0" })], total: "0" }))).toContain("Ninguém bateu os 90%");
    expect(attendancePayoutText(dto({ measured: false, total: "0" }))).toContain("não foi medida");
  });
});

describe("o que impede o fechamento", () => {
  it("evento sem canal medido não paga, e a tela diz antes do clique (AC#5)", () => {
    expect(attendanceBlockedReason(dto())).toBeNull();
    expect(attendanceBlockedReason(dto({ measured: false }))).toContain("sem presença medida");
  });

  it("evento já pago não paga de novo", () => {
    expect(attendanceBlockedReason(dto({ paidAt: "2026-03-01T22:00:00.000Z" }))).toContain("já foi paga");
  });
});

describe("valor por role", () => {
  it("escreve a faixa do template", () => {
    expect(roleRangeText(tank)).toBe("10 a 40 BUF");
    expect(roleRangeText({ buffunfaMin: "0", buffunfaMax: "0" })).toBe("sem Buffunfa");
  });

  it("aceita inteiro dentro da faixa e recusa fora dela antes de gastar request", () => {
    expect(checkRoleValue("25", tank)).toEqual({ ok: true, value: 25n });
    expect(checkRoleValue(" 40 ", tank)).toEqual({ ok: true, value: 40n });
    expect(checkRoleValue("41", tank)).toMatchObject({ ok: false });
    expect(checkRoleValue("9", tank)).toMatchObject({ ok: false });
    expect(checkRoleValue("", tank)).toMatchObject({ ok: false });
    // Buffunfa nunca abrevia (F6-5): "2k" é erro de moeda, não atalho.
    expect(checkRoleValue("2k", tank)).toMatchObject({ ok: false });
  });

  it("a mensagem da faixa diz os dois extremos, que é o que o caller precisa corrigir", () => {
    const result = checkRoleValue("99", tank);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("de 10 a 40");
  });
});

describe("motivo de cada linha", () => {
  it("traduz o motivo e some para quem recebe", () => {
    expect(attendanceSkipText(line())).toBeNull();
    expect(attendanceSkipText(line({ skip: "below_presence" }))).toBe("presença abaixo de 90%");
    expect(attendanceSkipText(line({ skip: "no_channel" }))).toBe("evento sem canal medido");
    expect(attendanceSkipText(line({ skip: "not_signed_up" }))).toBe("não estava inscrito");
  });
});
