import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_MIN_PRESENCE_BP,
  attendanceMemo,
  attendancePresenceBp,
  attendanceRows,
  attendanceTotal,
  eventRoleBuffunfaSchema,
  meetsAttendance,
  type AttendanceInput,
} from "./event-attendance.js";
import { buffunfaSuggestionText, formatBuffunfaRange, inBuffunfaRange, isBuffunfaValue } from "./event-templates.js";
import type { SplitPresenceDto } from "./loot-split.js";

const HOUR = 3_600_000;

const person = (over: Partial<SplitPresenceDto> = {}): SplitPresenceDto => ({
  discordUserId: "111",
  userId: "u-1",
  nick: "Tanque",
  signedUp: true,
  roleName: "Tank",
  presenceMs: HOUR,
  ...over,
});

const input = (over: Partial<AttendanceInput> = {}): AttendanceInput => ({
  windowMs: HOUR,
  measured: true,
  valueByRole: new Map([
    ["Tank", 40n],
    ["DPS", 10n],
  ]),
  ...over,
});

describe("faixa de Buffunfa da role (F6-8)", () => {
  it("o valor precisa caber entre mínimo e máximo", () => {
    expect(inBuffunfaRange(20n, { min: 10n, max: 40n })).toBe(true);
    expect(inBuffunfaRange(10n, { min: 10n, max: 40n })).toBe(true);
    expect(inBuffunfaRange(40n, { min: 10n, max: 40n })).toBe(true);
    expect(inBuffunfaRange(9n, { min: 10n, max: 40n })).toBe(false);
    expect(inBuffunfaRange(41n, { min: 10n, max: 40n })).toBe(false);
  });

  it("escreve a faixa para gente", () => {
    expect(formatBuffunfaRange({ min: 10n, max: 40n })).toBe("10 a 40 BUF");
    expect(formatBuffunfaRange({ min: 25n, max: 25n })).toBe("25 BUF");
    expect(formatBuffunfaRange({ min: 0n, max: 0n })).toBe("0 BUF");
    expect(buffunfaSuggestionText({ min: 10n, max: 40n })).toBe("template sugere 10 a 40 BUF");
  });

  // TASK-072: no evento quem manda é o teto do sistema, não a faixa que o template escreveu.
  it("o valor do evento vai de zero ao teto do sistema, independente da faixa do template", () => {
    expect(isBuffunfaValue(0n)).toBe(true);
    expect(isBuffunfaValue(500n)).toBe(true);
    expect(isBuffunfaValue(10_000n)).toBe(true);
    expect(isBuffunfaValue(10_001n)).toBe(false);
    expect(isBuffunfaValue(-1n)).toBe(false);
  });

  it("o valor enviado pela API é inteiro e sem sinal", () => {
    expect(eventRoleBuffunfaSchema.parse({ value: "25" }).value).toBe(25n);
    expect(eventRoleBuffunfaSchema.parse({ value: 0 }).value).toBe(0n);
    expect(eventRoleBuffunfaSchema.safeParse({ value: "-5" }).success).toBe(false);
    expect(eventRoleBuffunfaSchema.safeParse({ value: "2,5" }).success).toBe(false);
    expect(eventRoleBuffunfaSchema.safeParse({ value: "10001" }).success).toBe(false);
  });
});

describe("corte de presença (F6-10)", () => {
  it("90% em ponto é dentro; um milissegundo abaixo é fora", () => {
    expect(ATTENDANCE_MIN_PRESENCE_BP).toBe(9000);
    expect(meetsAttendance(HOUR * 0.9, HOUR)).toBe(true);
    expect(meetsAttendance(HOUR * 0.9 - 1, HOUR)).toBe(false);
    expect(meetsAttendance(HOUR, HOUR)).toBe(true);
    // Sem janela medida não existe "bateu": não há relógio para comparar.
    expect(meetsAttendance(HOUR, 0)).toBe(false);
  });

  it("o percentual mostrado nunca passa de 100%", () => {
    expect(attendancePresenceBp(HOUR / 2, HOUR)).toBe(5000);
    expect(attendancePresenceBp(HOUR * 2, HOUR)).toBe(10_000);
    expect(attendancePresenceBp(HOUR, 0)).toBe(0);
  });
});

describe("linhas do pagamento (F6-9, F6-10, F6-11)", () => {
  it("quem bateu os 90% recebe o valor cheio da role, sem proporcional", () => {
    const rows = attendanceRows([person({ presenceMs: HOUR * 0.95 })], input());
    expect(rows[0]!.skip).toBeNull();
    expect(rows[0]!.amount).toBe(40n);
    expect(attendanceTotal(rows)).toBe(40n);
  });

  it("todo mundo da mesma role recebe o mesmo valor, seja qual for a presença acima do corte", () => {
    const rows = attendanceRows(
      [person({ discordUserId: "1", userId: "u-1", presenceMs: HOUR }), person({ discordUserId: "2", userId: "u-2", nick: "Outro", presenceMs: HOUR * 0.91 })],
      input(),
    );
    expect(rows.map((r) => r.amount)).toEqual([40n, 40n]);
  });

  it("abaixo do corte não recebe nada e a linha diz por quê", () => {
    const rows = attendanceRows([person({ presenceMs: HOUR * 0.89 })], input());
    expect(rows[0]!.skip).toBe("below_presence");
    expect(rows[0]!.amount).toBe(0n);
    expect(attendanceTotal(rows)).toBe(0n);
  });

  it("evento sem canal medido não paga a ninguém", () => {
    const rows = attendanceRows([person()], input({ measured: false, windowMs: 0 }));
    expect(rows[0]!.skip).toBe("no_channel");
    expect(attendanceTotal(rows)).toBe(0n);
  });

  it("presente sem inscrição, sem conta e role sem valor ficam de fora, cada um com seu motivo", () => {
    const rows = attendanceRows(
      [
        person({ discordUserId: "1", signedUp: false, roleName: null }),
        person({ discordUserId: "2", userId: null }),
        person({ discordUserId: "3", roleName: "Scout" }),
      ],
      input(),
    );
    expect(rows.map((r) => r.skip)).toEqual(["not_signed_up", "no_account", "zero_value"]);
    expect(rows.every((r) => r.amount === 0n)).toBe(true);
  });

  it("quem recebe aparece antes de quem não recebe", () => {
    const rows = attendanceRows([person({ discordUserId: "1", presenceMs: 0 }), person({ discordUserId: "2", userId: "u-2", nick: "Cheio" })], input());
    expect(rows.map((r) => r.nick)).toEqual(["Cheio", "Tanque"]);
  });

  it("o memo diz o evento e a role", () => {
    expect(attendanceMemo("DG de grupo", "Tank")).toBe("Presença em DG de grupo (Tank)");
  });
});
