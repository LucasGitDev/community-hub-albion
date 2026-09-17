import { describe, expect, it } from "vitest";
import { ENTRY_FEE_MAX, ENTRY_FEE_REFUND_REASONS, entryFeeLabel, entryFeeSchema, eventEntryFeeSchema, insufficientEntryFeeMessage, NO_ENTRY_FEE } from "./entry-fee.js";
import { entryFeeEditable, entryFeeFrozenError } from "./events.js";

describe("taxa de entrada em Buffunfa (TASK-058)", () => {
  it("aceita inteiro em string e recusa o resto", () => {
    const schema = entryFeeSchema();
    expect(schema.parse("0")).toBe(NO_ENTRY_FEE);
    expect(schema.parse(" 250 ")).toBe(250n);
    // Sem teto de política (F6-12), mas a borda do int8 vira 400 legível em vez de 500 do banco.
    expect(schema.parse(String(ENTRY_FEE_MAX))).toBe(ENTRY_FEE_MAX);
    expect(schema.safeParse("99999999999999999999").success).toBe(false);
    for (const bad of ["-1", "1,5", "1.5", "2k", "", "abc", "+3"]) expect(schema.safeParse(bad).success).toBe(false);
    // Número não passa: no fio o valor é string, como todo bigint do projeto (Q20).
    expect(schema.safeParse(20).success).toBe(false);
  });

  it("o corpo da rota exige o campo", () => {
    expect(eventEntryFeeSchema.parse({ entryFee: "30" })).toEqual({ entryFee: 30n });
    expect(eventEntryFeeSchema.safeParse({}).success).toBe(false);
  });

  it("Buffunfa nunca abrevia nos textos (F6-5) e o zero diz que é gratuito", () => {
    expect(entryFeeLabel(NO_ENTRY_FEE)).toBe("Entrada gratuita");
    expect(entryFeeLabel(20n)).toBe("Entrada: 20 BUF");
    // 2000 não vira "2k": a regra da moeda vale no texto da taxa também.
    expect(entryFeeLabel(2_000n)).toBe("Entrada: 2.000 BUF");
  });

  it("a recusa por saldo diz quanto falta, não só que faltou (AC#2)", () => {
    expect(insufficientEntryFeeMessage(30n, 12n)).toBe("A entrada deste evento custa 30 BUF e você tem 12 BUF. Faltam 18 BUF.");
  });

  it("a taxa muda enquanto a inscrição está aberta e congela depois (AC#1)", () => {
    expect(entryFeeEditable("draft")).toBe(true);
    expect(entryFeeEditable("open")).toBe(true);
    for (const status of ["closed", "running", "finished", "cancelled", "archived"] as const) expect(entryFeeEditable(status)).toBe(false);
    expect(entryFeeFrozenError("closed")).toContain("inscrições fechadas");
  });

  it("todo motivo de devolução explica o estorno para quem lê o extrato", () => {
    for (const reason of Object.values(ENTRY_FEE_REFUND_REASONS)) expect(reason).toMatch(/devolvida\.$/);
  });
});
