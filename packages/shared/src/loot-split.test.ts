import { describe, expect, it } from "vitest";
import {
  calculateSplitDraft,
  eventFeeSchema,
  eventFeeUpdateSchema,
  feeFromDto,
  feeToDto,
  formatEventFee,
  formatPresence,
  formatShare,
  hasFee,
  lootSplitCreateSchema,
  NO_FEE,
  SHARE_SCALE,
  silverAmountSchema,
  type SplitPresence,
} from "./loot-split.js";

const MIN = 60_000;

const present = (discordUserId: string, minutes: number, signedUp = true): SplitPresence => ({ discordUserId, presenceMs: minutes * MIN, signedUp });

const sumBp = (lines: readonly { shareBp: number }[]) => lines.reduce((s, l) => s + l.shareBp, 0);
const sumAmount = (lines: readonly { amount: bigint }[]) => lines.reduce((s, l) => s + l.amount, 0n);

describe("rateio do rascunho de loot split (TASK-027)", () => {
  describe("percentual por tempo no canal (AC#1, Q5/Q6)", () => {
    it("divide proporcionalmente aos milissegundos de presença", () => {
      const { lines, residual } = calculateSplitDraft([present("a", 60), present("b", 30), present("c", 30)], 1_200_000n);
      expect(lines.map((l) => l.shareBp)).toEqual([5000, 2500, 2500]);
      expect(lines.map((l) => l.amount)).toEqual([600_000n, 300_000n, 300_000n]);
      expect(residual).toBe(0n);
    });

    it("presença igual dá participação igual", () => {
      const { lines } = calculateSplitDraft([present("a", 40), present("b", 40)], 1_000n);
      expect(lines.map((l) => l.shareBp)).toEqual([5000, 5000]);
      expect(lines.map((l) => l.amount)).toEqual([500n, 500n]);
    });

    it("guarda os milissegundos que originaram o percentual (tela da TASK-029)", () => {
      const { lines } = calculateSplitDraft([present("a", 90)], 10n);
      expect(lines[0]!.presenceMs).toBe(90 * MIN);
    });

    it("quem ficou mais tempo recebe mais", () => {
      const { lines } = calculateSplitDraft([present("a", 120), present("b", 10)], 1_300_000n);
      expect(lines[0]!.amount).toBeGreaterThan(lines[1]!.amount);
      expect(lines[0]!.shareBp).toBeGreaterThan(lines[1]!.shareBp);
    });

    it("não há presença mínima: 1 minuto já participa (Q5)", () => {
      const { lines } = calculateSplitDraft([present("a", 119), present("b", 1)], 1_200_000n);
      expect(lines[1]!.shareBp).toBe(83);
      expect(lines[1]!.amount).toBe(10_000n);
    });
  });

  describe("presente não inscrito entra com 0% (AC#2, Q7)", () => {
    it("aparece na lista, com o tempo dele, mas sem participação", () => {
      const { lines } = calculateSplitDraft([present("a", 60), present("intruso", 60, false)], 1_000_000n);
      const intruso = lines.find((l) => l.discordUserId === "intruso")!;
      expect(intruso.signedUp).toBe(false);
      expect(intruso.presenceMs).toBe(60 * MIN);
      expect(intruso.shareBp).toBe(0);
      expect(intruso.amount).toBe(0n);
    });

    it("não dilui quem estava inscrito: o inscrito sozinho fica com 100%", () => {
      const { lines, residual } = calculateSplitDraft([present("a", 60), present("intruso", 180, false)], 1_000_000n);
      expect(lines.find((l) => l.discordUserId === "a")!.shareBp).toBe(SHARE_SCALE);
      expect(lines.find((l) => l.discordUserId === "a")!.amount).toBe(1_000_000n);
      expect(residual).toBe(0n);
    });

    it("inscrito que nunca entrou na voz também fica com 0%", () => {
      const { lines } = calculateSplitDraft([present("a", 60), present("ausente", 0)], 1_000n);
      expect(lines.find((l) => l.discordUserId === "ausente")!.shareBp).toBe(0);
      expect(lines.find((l) => l.discordUserId === "a")!.shareBp).toBe(SHARE_SCALE);
    });
  });

  describe("cada split fecha 100% (AC#3, Q22/Q23)", () => {
    it("percentuais somam exatamente 10000 bp mesmo com divisão infinita", () => {
      const { lines } = calculateSplitDraft([present("a", 10), present("b", 10), present("c", 10)], 100n);
      expect(sumBp(lines)).toBe(SHARE_SCALE);
      // 1/3 não fecha em bp: o maior resto distribui o que faltou, sem inventar percentual.
      expect(lines.map((l) => l.shareBp).sort()).toEqual([3333, 3333, 3334]);
    });

    it("fecha 100% com 7 pessoas de tempos quebrados", () => {
      const minutes = [37, 12, 95, 4, 61, 61, 8];
      const { lines } = calculateSplitDraft(
        minutes.map((m, i) => present(`u${i}`, m)),
        999_999_937n,
      );
      expect(sumBp(lines)).toBe(SHARE_SCALE);
    });

    it("o mesmo rascunho sai igual duas vezes (desempate estável)", () => {
      const input = [present("zzz", 10), present("aaa", 10), present("mmm", 10)];
      const first = calculateSplitDraft(input, 100n).lines.map((l) => [l.discordUserId, l.shareBp]);
      const second = calculateSplitDraft(input, 100n).lines.map((l) => [l.discordUserId, l.shareBp]);
      expect(first).toEqual(second);
    });
  });

  describe("arredondamento e sobra do dono (Q20, Q23)", () => {
    it("nunca distribui mais do que o total, e a sobra é o que faltou", () => {
      const { lines, residual } = calculateSplitDraft([present("a", 10), present("b", 10), present("c", 10)], 100n);
      expect(lines.map((l) => l.amount)).toEqual([33n, 33n, 33n]);
      expect(residual).toBe(1n);
      expect(sumAmount(lines) + residual).toBe(100n);
    });

    it("a sobra é sempre menor que o número de linhas (são tostões)", () => {
      for (const total of [1n, 7n, 999n, 1_000_001n, 123_456_789n]) {
        const { lines, residual } = calculateSplitDraft([present("a", 7), present("b", 11), present("c", 13)], total);
        expect(sumAmount(lines) + residual).toBe(total);
        expect(residual).toBeLessThan(3n);
        expect(residual).toBeGreaterThanOrEqual(0n);
      }
    });

    it("prata é exata acima de 2^53 (bigint, Q20)", () => {
      const total = 9_007_199_254_740_993n * 3n;
      const { lines, residual } = calculateSplitDraft([present("a", 1), present("b", 1), present("c", 1)], total);
      expect(sumAmount(lines) + residual).toBe(total);
      expect(lines[0]!.amount).toBe(9_007_199_254_740_993n);
    });

    it("ninguém presente e inscrito: tudo vira sobra do dono", () => {
      const { lines, residual } = calculateSplitDraft([present("intruso", 60, false)], 500_000n);
      expect(sumAmount(lines)).toBe(0n);
      expect(residual).toBe(500_000n);
    });

    it("lista vazia devolve o total inteiro como sobra", () => {
      expect(calculateSplitDraft([], 42n)).toEqual({ lines: [], residual: 42n });
    });

    it("total zero não gera sobra nem participação em prata", () => {
      const { lines, residual } = calculateSplitDraft([present("a", 10), present("b", 10)], 0n);
      expect(residual).toBe(0n);
      expect(sumAmount(lines)).toBe(0n);
    });
  });
});

describe("taxa do evento (doc-005: percentual ou fixo, sem teto)", () => {
  it("formata percentual a partir de basis points", () => {
    expect(formatEventFee({ type: "percent", value: 1250n })).toBe("12,5%");
    expect(formatEventFee({ type: "percent", value: 10_000n })).toBe("100%");
  });

  it("formata valor fixo em prata", () => {
    expect(formatEventFee({ type: "fixed", value: 1_000_000n })).toBe("1.000.000 de prata");
  });

  it("sem taxa é o default e não conta como taxa", () => {
    expect(hasFee(NO_FEE)).toBe(false);
    expect(hasFee({ type: "fixed", value: 1n })).toBe(true);
  });

  it("vai e volta do DTO sem perder precisão", () => {
    const fee = { type: "fixed", value: 9_007_199_254_740_993n } as const;
    expect(feeFromDto(feeToDto(fee))).toEqual(fee);
  });

  it("aceita percentual acima de 100%: não há teto (decisão do usuário)", () => {
    const parsed = eventFeeSchema.parse({ type: "percent", value: "25000" });
    expect(parsed.value).toBe(25_000n);
  });

  it("recusa taxa negativa e tipo desconhecido", () => {
    expect(eventFeeSchema.safeParse({ type: "percent", value: "-1" }).success).toBe(false);
    expect(eventFeeSchema.safeParse({ type: "metade", value: "1" }).success).toBe(false);
  });

  it("o corpo de troca de taxa exige o campo fee", () => {
    expect(eventFeeUpdateSchema.safeParse({}).success).toBe(false);
    expect(eventFeeUpdateSchema.parse({ fee: { type: "fixed", value: 500 } }).fee.value).toBe(500n);
  });
});

describe("prata vinda do JSON", () => {
  const schema = silverAmountSchema("O total");

  it("aceita string, número e bigint", () => {
    expect(schema.parse("1500000")).toBe(1_500_000n);
    expect(schema.parse(1_500_000)).toBe(1_500_000n);
    expect(schema.parse(1_500_000n)).toBe(1_500_000n);
  });

  it("aceita string com separador de milhar do painel", () => {
    expect(schema.parse("1.500.000")).toBe(1_500_000n);
  });

  it("recusa negativo, decimal e texto", () => {
    for (const bad of ["-5", "1.5e3", "1,5", "abc", "", 1.5, -2]) expect(schema.safeParse(bad).success, String(bad)).toBe(false);
  });

  it("não perde prata acima de 2^53 quando vem como string", () => {
    expect(schema.parse("9007199254740993")).toBe(9_007_199_254_740_993n);
  });

  it("o corpo de criação exige o total e deixa a taxa opcional", () => {
    expect(lootSplitCreateSchema.safeParse({}).success).toBe(false);
    const parsed = lootSplitCreateSchema.parse({ totalSilver: "1000" });
    expect(parsed).toEqual({ totalSilver: 1000n });
    expect(lootSplitCreateSchema.parse({ totalSilver: "1000", fee: { type: "percent", value: 500 } }).fee).toEqual({ type: "percent", value: 500n });
  });
});

describe("formatação da tela (TASK-029)", () => {
  it("percentual legível a partir dos basis points", () => {
    expect(formatShare(10_000)).toBe("100%");
    expect(formatShare(833)).toBe("8,33%");
    expect(formatShare(0)).toBe("0%");
  });

  it("presença legível", () => {
    expect(formatPresence(0)).toBe("—");
    expect(formatPresence(30_000)).toBe("menos de 1min");
    expect(formatPresence(4 * MIN)).toBe("4min");
    expect(formatPresence(72 * MIN)).toBe("1h 12min");
  });
});
