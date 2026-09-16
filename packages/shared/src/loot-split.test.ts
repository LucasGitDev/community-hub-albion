import { describe, expect, it } from "vitest";
import {
  calculateSplitDraft,
  checkSplitConfirm,
  distributeByShare,
  feeBreakdown,
  lootSplitReversalSchema,
  lootSplitUpdateSchema,
  splitConfirmRefusalMessage,
  splitShareSum,
  type ConfirmableLine,
  type EventFee,
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
      // A prata sai do percentual, não dos milissegundos (TASK-028): 0,83% de 1.200.000.
      expect(lines[1]!.amount).toBe(9_960n);
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
      // Nada perdido nem inventado, mesmo muito acima do que um `number` aguentaria.
      expect(sumAmount(lines) + residual).toBe(total);
      // A linha é o percentual exibido aplicado ao total: 33,33% e 33,34%, não "um terço" idealizado.
      // A granularidade é a do basis point (0,01%), e ela é a mesma que o caller vê e edita na tela.
      expect(lines.map((l) => l.shareBp)).toEqual([3334, 3333, 3333]);
      expect(lines[0]!.amount).toBe((total * 3334n) / 10_000n);
      // Sobra minúscula, como sempre: são tostões do truncamento por linha, e vão para o dono (Q23).
      expect(residual).toBe(2n);
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

describe("taxa aplicada antes da divisão (TASK-028, doc-005 \"Taxa do split\")", () => {
  const percent = (bp: number): EventFee => ({ type: "percent", value: BigInt(bp) });
  const fixed = (silver: bigint): EventFee => ({ type: "fixed", value: silver });

  it("percentual é retirado do total e o resto é o distribuível", () => {
    expect(feeBreakdown(1_000_000n, percent(1250))).toEqual({ feeSilver: 125_000n, distributable: 875_000n, exceedsTotal: false });
  });

  it("valor fixo é retirado cru", () => {
    expect(feeBreakdown(1_000_000n, fixed(300_000n))).toEqual({ feeSilver: 300_000n, distributable: 700_000n, exceedsTotal: false });
  });

  it("taxa zero não muda nada", () => {
    expect(feeBreakdown(999n, percent(0))).toEqual({ feeSilver: 0n, distributable: 999n, exceedsTotal: false });
  });

  it("percentual trunca para baixo: a taxa nunca fica maior do que deveria", () => {
    expect(feeBreakdown(999n, percent(1)).feeSilver).toBe(0n);
    expect(feeBreakdown(19_999n, percent(1)).feeSilver).toBe(1n);
  });

  it("prata acima de 2^53 não perde nada (Q20)", () => {
    const total = 9_007_199_254_740_993_000n;
    const { feeSilver, distributable } = feeBreakdown(total, percent(1000));
    expect(feeSilver + distributable).toBe(total);
    expect(feeSilver).toBe(900_719_925_474_099_300n);
  });

  it("taxa fixa maior que o total marca excesso e zera o distribuível, em vez de virar prata negativa", () => {
    expect(feeBreakdown(100n, fixed(101n))).toEqual({ feeSilver: 101n, distributable: 0n, exceedsTotal: true });
    // Split sem loot nenhum: qualquer taxa fixa já não cabe.
    expect(feeBreakdown(0n, fixed(1n)).exceedsTotal).toBe(true);
  });

  it("percentual acima de 100% cai na mesma regra: a taxa não tem teto, mas não cabe", () => {
    expect(feeBreakdown(10_000n, percent(10_001)).exceedsTotal).toBe(true);
    // Exatamente 100% cabe: leva tudo e não sobra nada para dividir, o que é uma decisão, não um erro.
    expect(feeBreakdown(10_000n, percent(10_000))).toEqual({ feeSilver: 10_000n, distributable: 0n, exceedsTotal: false });
  });
});

describe("prata a partir do percentual (TASK-028)", () => {
  it("cada linha recebe o seu percentual do distribuível e a sobra é o que faltou", () => {
    expect(distributeByShare([5000, 2500, 2500], 1_000_000n)).toEqual({ amounts: [500_000n, 250_000n, 250_000n], residual: 0n });
    expect(distributeByShare([3334, 3333, 3333], 100n)).toEqual({ amounts: [33n, 33n, 33n], residual: 1n });
  });

  it("linha com 0% não recebe nada", () => {
    const { amounts } = distributeByShare([10_000, 0], 777n);
    expect(amounts).toEqual([777n, 0n]);
  });

  it("distribuível zero não credita ninguém", () => {
    expect(distributeByShare([5000, 5000], 0n)).toEqual({ amounts: [0n, 0n], residual: 0n });
  });
});

describe("conferência da confirmação (TASK-028, AC#1, AC#2, Q22, Q23)", () => {
  const line = (shareBp: number, over: Partial<ConfirmableLine> = {}): ConfirmableLine => ({ shareBp, userId: "u", signedUp: true, ...over });
  const noFee: EventFee = { type: "percent", value: 0n };

  it("soma diferente de 100% é recusada (AC#1, Q22)", () => {
    expect(checkSplitConfirm([line(5000), line(4999)], 1000n, noFee)).toEqual({ ok: false, reason: "shares_not_100" });
    expect(checkSplitConfirm([line(5000), line(5001)], 1000n, noFee)).toEqual({ ok: false, reason: "shares_not_100" });
    expect(checkSplitConfirm([], 1000n, noFee)).toEqual({ ok: false, reason: "shares_not_100" });
  });

  it("taxa fixa maior que o total é recusada: sem isso o distribuível ficaria negativo", () => {
    expect(checkSplitConfirm([line(10_000)], 1000n, { type: "fixed", value: 1001n })).toEqual({ ok: false, reason: "fee_exceeds_total" });
  });

  it("participação para quem não estava inscrito é recusada (Q7)", () => {
    expect(checkSplitConfirm([line(5000), line(5000, { signedUp: false })], 1000n, noFee)).toEqual({ ok: false, reason: "share_without_signup" });
  });

  it("participação para quem não tem conta no painel é recusada: não há para quem creditar", () => {
    expect(checkSplitConfirm([line(5000), line(5000, { userId: null })], 1000n, noFee)).toEqual({ ok: false, reason: "share_without_account" });
  });

  it("presente sem conta e sem participação não atrapalha ninguém (Q7)", () => {
    const result = checkSplitConfirm([line(10_000), line(0, { userId: null, signedUp: false })], 1000n, noFee);
    expect(result.ok).toBe(true);
  });

  it("o plano fecha exatamente o total: linhas + taxa + sobra (AC#2)", () => {
    const result = checkSplitConfirm([line(3334), line(3333), line(3333)], 1_000_000n, { type: "percent", value: 1000n });
    if (!result.ok) throw new Error(result.reason);
    const { fee, amounts, residual, ownerSilver } = result.plan;
    expect(fee.feeSilver).toBe(100_000n);
    expect(fee.distributable).toBe(900_000n);
    expect(amounts).toEqual([300_060n, 299_970n, 299_970n]);
    expect(residual).toBe(0n);
    expect(ownerSilver).toBe(100_000n);
    expect(amounts.reduce((a, b) => a + b, 0n) + ownerSilver).toBe(1_000_000n);
  });

  it("a sobra do arredondamento entra no crédito do dono junto com a taxa (Q23)", () => {
    const result = checkSplitConfirm([line(3334), line(3333), line(3333)], 100n, { type: "fixed", value: 1n });
    if (!result.ok) throw new Error(result.reason);
    const { amounts, residual, ownerSilver } = result.plan;
    expect(amounts).toEqual([33n, 32n, 32n]);
    expect(residual).toBe(2n);
    expect(ownerSilver).toBe(3n);
    expect(amounts.reduce((a, b) => a + b, 0n) + ownerSilver).toBe(100n);
  });

  it("split sem loot nenhum confirma sem creditar ninguém", () => {
    const result = checkSplitConfirm([line(10_000)], 0n, noFee);
    if (!result.ok) throw new Error(result.reason);
    expect(result.plan).toMatchObject({ amounts: [0n], residual: 0n, ownerSilver: 0n });
  });

  it("splitShareSum soma os basis points sem passar por float", () => {
    expect(splitShareSum([{ shareBp: 3334 }, { shareBp: 3333 }, { shareBp: 3333 }])).toBe(10_000);
  });

  it("toda recusa tem uma frase em PT-BR que diz o que fazer", () => {
    for (const reason of ["shares_not_100", "fee_exceeds_total", "share_without_account", "share_without_signup"] as const) {
      expect(splitConfirmRefusalMessage(reason)).toMatch(/\S/);
    }
    expect(splitConfirmRefusalMessage("fee_exceeds_total")).toContain("taxa");
    expect(splitConfirmRefusalMessage("shares_not_100")).toContain("100%");
  });
});

describe("corpo da edição e do estorno (TASK-028)", () => {
  it("aceita só o total, só as linhas, ou os dois", () => {
    expect(lootSplitUpdateSchema.safeParse({ totalSilver: "1000" }).success).toBe(true);
    expect(lootSplitUpdateSchema.safeParse({ lines: [{ id: "11111111-1111-4111-8111-111111111111", shareBp: 10_000 }] }).success).toBe(true);
    expect(lootSplitUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("recusa participação negativa, acima de 100% ou fracionada", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    for (const shareBp of [-1, 10_001, 1.5]) expect(lootSplitUpdateSchema.safeParse({ lines: [{ id, shareBp }] }).success).toBe(false);
  });

  it("recusa id de linha que não é uuid", () => {
    expect(lootSplitUpdateSchema.safeParse({ lines: [{ id: "nao-e-uuid", shareBp: 0 }] }).success).toBe(false);
  });

  it("total continua vindo como string e virando bigint (Q20)", () => {
    const parsed = lootSplitUpdateSchema.parse({ totalSilver: "9007199254740993" });
    expect(parsed.totalSilver).toBe(9_007_199_254_740_993n);
  });

  it("estorno exige motivo com conteúdo", () => {
    expect(lootSplitReversalSchema.safeParse({ reason: "  " }).success).toBe(false);
    expect(lootSplitReversalSchema.safeParse({ reason: "loot contado errado" }).success).toBe(true);
  });
});
