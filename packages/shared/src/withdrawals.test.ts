import { describe, expect, it } from "vitest";
import {
  ALLOWED_WITHDRAWAL_TRANSITIONS,
  availableBalance,
  canTransitionWithdrawal,
  checkWithdrawalRequest,
  parseWithdrawalListQuery,
  RESERVING_WITHDRAWAL_STATUSES,
  WITHDRAWAL_STATUSES,
  withdrawalApproveSchema,
  withdrawalRefusalMessage,
  withdrawalRejectSchema,
  withdrawalRequestSchema,
  withdrawalSettleSchema,
  withdrawalTransitionError,
  type WithdrawalStatus,
} from "./withdrawals.js";

describe("regras do saque (TASK-030)", () => {
  describe("saldo disponível (AC#2, Q25)", () => {
    it("desconta a reserva do saldo do ledger", () => {
      expect(availableBalance(1_000_000n, 400_000n)).toBe(600_000n);
    });

    it("aguenta valores acima de 2^53 sem perder prata (Q20)", () => {
      expect(availableBalance(9_007_199_254_740_993n, 1n)).toBe(9_007_199_254_740_992n);
    });

    it("só pending reserva: approved já está descontado pelo ledger", () => {
      expect([...RESERVING_WITHDRAWAL_STATUSES]).toEqual(["pending"]);
    });
  });

  describe("pedido: sem mínimo e sem taxa (AC#1, Q12 revisado em 2026-09-16)", () => {
    it("aceita 1 de prata", () => {
      expect(checkWithdrawalRequest(1n, 1n, 0n)).toBeNull();
    });

    it("aceita o disponível inteiro", () => {
      expect(checkWithdrawalRequest(600_000n, 1_000_000n, 400_000n)).toBeNull();
    });

    it("recusa zero e negativo", () => {
      expect(checkWithdrawalRequest(0n, 1_000n, 0n)).toEqual({ reason: "not_positive" });
      expect(checkWithdrawalRequest(-1n, 1_000n, 0n)).toEqual({ reason: "not_positive" });
    });

    it("recusa um a mais que o disponível e informa o teto", () => {
      expect(checkWithdrawalRequest(600_001n, 1_000_000n, 400_000n)).toEqual({ reason: "insufficient", available: 600_000n });
    });

    it("saldo negativo bloqueia antes de qualquer outra conta (Q24)", () => {
      expect(checkWithdrawalRequest(1n, -1n, 0n)).toEqual({ reason: "negative_balance", balance: -1n });
    });
  });

  describe("mensagens PT-BR da recusa", () => {
    it("explica o que fazer em cada caso", () => {
      expect(withdrawalRefusalMessage({ reason: "not_positive" })).toContain("maior que zero");
      expect(withdrawalRefusalMessage({ reason: "negative_balance", balance: -5n })).toContain("negativo");
      const insufficient = withdrawalRefusalMessage({ reason: "insufficient", available: 1_234_567n });
      expect(insufficient).toContain("1.234.567");
      expect(insufficient).toContain("aguardando aprovação");
    });
  });

  describe("máquina de estados", () => {
    it("pending vai para approved ou rejected; approved só para settled", () => {
      expect(canTransitionWithdrawal("pending", "approved")).toBe(true);
      expect(canTransitionWithdrawal("pending", "rejected")).toBe(true);
      expect(canTransitionWithdrawal("pending", "settled")).toBe(false);
      expect(canTransitionWithdrawal("approved", "settled")).toBe(true);
      expect(canTransitionWithdrawal("approved", "rejected")).toBe(false);
    });

    it("rejected e settled são finais", () => {
      for (const to of WITHDRAWAL_STATUSES) {
        expect(canTransitionWithdrawal("rejected", to)).toBe(false);
        expect(canTransitionWithdrawal("settled", to)).toBe(false);
      }
    });

    it("nenhum estado volta para pending: saque não reabre", () => {
      for (const from of WITHDRAWAL_STATUSES) expect(ALLOWED_WITHDRAWAL_TRANSITIONS[from as WithdrawalStatus]).not.toContain("pending");
    });

    it("a frase da recusa diz para onde ainda dá pra ir, ou que acabou", () => {
      expect(withdrawalTransitionError("pending", "settled")).toContain("aprovado, recusado");
      expect(withdrawalTransitionError("settled", "approved")).toContain("estado final");
    });
  });

  describe("schemas do corpo", () => {
    it("amount aceita número inteiro, string de dígitos e bigint", () => {
      expect(withdrawalRequestSchema.parse({ amount: 1_000 }).amount).toBe(1_000n);
      expect(withdrawalRequestSchema.parse({ amount: "9007199254740993" }).amount).toBe(9_007_199_254_740_993n);
      expect(withdrawalRequestSchema.parse({ amount: 5n }).amount).toBe(5n);
    });

    it("amount recusa float, texto, zero e negativo", () => {
      for (const amount of [1.5, "abc", "1.000", 0, -1, "-1", null, undefined]) expect(withdrawalRequestSchema.safeParse({ amount }).success).toBe(false);
    });

    it("o corpo do pedido não tem campo de usuário: userId extra é ignorado", () => {
      expect(withdrawalRequestSchema.parse({ amount: 10, userId: "outro" })).toEqual({ amount: 10n });
    });

    it("recusa e liquidação exigem nota não vazia; aprovação aceita nota vazia", () => {
      expect(withdrawalRejectSchema.safeParse({ note: "   " }).success).toBe(false);
      expect(withdrawalRejectSchema.safeParse({}).success).toBe(false);
      expect(withdrawalRejectSchema.parse({ note: " motivo " }).note).toBe("motivo");
      expect(withdrawalSettleSchema.safeParse({ note: "" }).success).toBe(false);
      expect(withdrawalSettleSchema.parse({ note: "pago" }).note).toBe("pago");
      expect(withdrawalApproveSchema.parse({}).note).toBeNull();
      expect(withdrawalApproveSchema.parse({ note: "  " }).note).toBeNull();
      expect(withdrawalApproveSchema.parse({ note: "ok" }).note).toBe("ok");
    });

    it("nota tem limite de tamanho", () => {
      expect(withdrawalRejectSchema.safeParse({ note: "x".repeat(301) }).success).toBe(false);
      expect(withdrawalSettleSchema.safeParse({ note: "x".repeat(300) }).success).toBe(true);
    });
  });

  describe("filtros da listagem", () => {
    it("aceita um status, vários, e o filtro por usuário", () => {
      expect(parseWithdrawalListQuery({})).toEqual({ ok: true, filters: {} });
      expect(parseWithdrawalListQuery({ status: "pending" })).toEqual({ ok: true, filters: { status: ["pending"] } });
      expect(parseWithdrawalListQuery({ status: ["pending", "approved"] })).toEqual({ ok: true, filters: { status: ["pending", "approved"] } });
      const id = "11111111-2222-4333-8444-555555555555";
      expect(parseWithdrawalListQuery({ userId: id })).toEqual({ ok: true, filters: { userId: id } });
    });

    it("status desconhecido e userId inválido viram erro PT-BR", () => {
      expect(parseWithdrawalListQuery({ status: "nope" }).ok).toBe(false);
      expect(parseWithdrawalListQuery({ userId: "nao-e-uuid" })).toMatchObject({ ok: false, error: "Usuário inválido." });
    });
  });
});
