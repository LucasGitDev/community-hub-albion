import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  approveWithdrawal,
  createDb,
  getLedgerBalance,
  getWithdrawal,
  getWithdrawalBalance,
  insertLedgerEntry,
  listLedgerEntriesByReference,
  listWithdrawals,
  rejectWithdrawal,
  requestWithdrawal,
  runMigrations,
  schema,
  settleWithdrawal,
  upsertUserByDiscordId,
  type DbHandle,
} from "./index.js";

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: testes de saque não podem ser pulados");

describe.skipIf(!baseUrl)("fluxo de saque (TASK-030, Postgres real)", () => {
  let handle: DbHandle;
  let url: string;
  let seq = 0;
  let staffId: string;

  const nextUser = async () => {
    const discordId = `9300000000000000${String(++seq).padStart(2, "0")}`;
    const user = await upsertUserByDiscordId(handle.db, { discordId, discordUsername: `saque${seq}` });
    return user.id;
  };

  /** Membro com saldo de prata já creditado no ledger. */
  const memberWith = async (silver: bigint) => {
    const userId = await nextUser();
    if (silver !== 0n) await insertLedgerEntry(handle.db, { currency: "silver", userId, amount: silver, kind: "split_payout", memo: "saldo inicial" });
    return userId;
  };

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_withdrawals`;
    target.pathname = `/${name}`;
    const admin = createDb(baseUrl!, { max: 1 });
    await admin.db.execute(sql.raw(`drop database if exists "${name}" with (force)`));
    await admin.db.execute(sql.raw(`create database "${name}"`));
    await admin.close();
    url = target.toString();
    await runMigrations(url);
    // Pool folgado: o teste de concorrência precisa de conexões simultâneas de verdade.
    handle = createDb(url, { max: 10 });
    staffId = await nextUser();
  }, 60_000);

  afterAll(async () => {
    await handle?.close();
  });

  describe("pedido: sem mínimo, recusa só valor inválido ou acima do disponível (AC#1, Q12)", () => {
    it("aceita 1 de prata: não existe valor mínimo de saque", async () => {
      const userId = await memberWith(1_000n);
      const result = await requestWithdrawal(handle.db, { userId, amount: 1n });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.withdrawal.amount).toBe("1");
        expect(result.withdrawal.status).toBe("pending");
      }
    });

    it("aceita o saldo inteiro, sem taxa nenhuma descontada", async () => {
      const userId = await memberWith(1_000_000n);
      const result = await requestWithdrawal(handle.db, { userId, amount: 1_000_000n });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.balance.available).toBe(0n);
    });

    it("recusa valor zero e negativo", async () => {
      const userId = await memberWith(1_000_000n);
      expect(await requestWithdrawal(handle.db, { userId, amount: 0n })).toMatchObject({ ok: false, reason: "not_positive" });
      expect(await requestWithdrawal(handle.db, { userId, amount: -5n })).toMatchObject({ ok: false, reason: "not_positive" });
    });

    it("recusa um a mais que o disponível e informa o teto", async () => {
      const userId = await memberWith(500_000n);
      const result = await requestWithdrawal(handle.db, { userId, amount: 500_001n });
      expect(result).toMatchObject({ ok: false, reason: "insufficient", available: 500_000n });
    });

    it("recusa usuário inexistente", async () => {
      const result = await requestWithdrawal(handle.db, { userId: "00000000-0000-0000-0000-000000000000", amount: 10n });
      expect(result).toMatchObject({ ok: false, reason: "unknown_user" });
    });

    it("saldo negativo bloqueia pedido novo, mesmo pequeno (Q24)", async () => {
      const userId = await memberWith(1_000n);
      await insertLedgerEntry(handle.db, { currency: "silver", userId, amount: -5_000n, kind: "adjustment", memo: "acerto" });
      expect(await getLedgerBalance(handle.db, userId, "silver")).toBe(-4_000n);
      const result = await requestWithdrawal(handle.db, { userId, amount: 1n });
      expect(result).toMatchObject({ ok: false, reason: "negative_balance", balance: -4_000n });
    });
  });

  describe("pending reserva saldo sem lançar no ledger (AC#2, Q25)", () => {
    it("derruba o disponível mas não o saldo, e não cria lançamento", async () => {
      const userId = await memberWith(1_000_000n);
      const before = await getWithdrawalBalance(handle.db, userId);
      expect(before).toMatchObject({ balance: 1_000_000n, reserved: 0n, available: 1_000_000n });

      const result = await requestWithdrawal(handle.db, { userId, amount: 400_000n });
      expect(result.ok).toBe(true);
      const after = await getWithdrawalBalance(handle.db, userId);
      // Saldo do ledger intacto: o extrato do membro não mudou.
      expect(after.balance).toBe(1_000_000n);
      expect(after.reserved).toBe(400_000n);
      expect(after.available).toBe(600_000n);
      expect(await getLedgerBalance(handle.db, userId, "silver")).toBe(1_000_000n);
      if (result.ok) expect(await listLedgerEntriesByReference(handle.db, "withdrawal", result.withdrawal.id)).toEqual([]);
    });

    it("reservas somam: dois pendings prendem os dois valores", async () => {
      const userId = await memberWith(1_000_000n);
      await requestWithdrawal(handle.db, { userId, amount: 300_000n });
      await requestWithdrawal(handle.db, { userId, amount: 200_000n });
      expect(await getWithdrawalBalance(handle.db, userId)).toMatchObject({ reserved: 500_000n, available: 500_000n });
      // O terceiro pedido só cabe dentro do que sobrou.
      expect(await requestWithdrawal(handle.db, { userId, amount: 500_001n })).toMatchObject({ ok: false, reason: "insufficient" });
      expect((await requestWithdrawal(handle.db, { userId, amount: 500_000n })).ok).toBe(true);
    });
  });

  describe("approved lança o débito; rejected libera a reserva (AC#3, Q25)", () => {
    it("aprovar cria exatamente um lançamento de débito ligado ao saque", async () => {
      const userId = await memberWith(1_000_000n);
      const req = await requestWithdrawal(handle.db, { userId, amount: 250_000n });
      if (!req.ok) throw new Error("pedido devia passar");

      const approved = await approveWithdrawal(handle.db, req.withdrawal.id, { actorUserId: staffId, note: "conferido" });
      expect(approved.ok).toBe(true);
      if (!approved.ok) return;
      expect(approved.withdrawal.status).toBe("approved");
      expect(approved.withdrawal.decidedByUserId).toBe(staffId);
      expect(approved.withdrawal.ledgerEntryId).not.toBeNull();

      const entries = await listLedgerEntriesByReference(handle.db, "withdrawal", req.withdrawal.id);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ amount: -250_000n, kind: "withdrawal", userId, createdBy: staffId });
      expect(entries[0]!.id).toBe(approved.withdrawal.ledgerEntryId);

      // Saldo caiu de verdade; a reserva sumiu porque agora quem desconta é o ledger (nada é contado duas vezes).
      const balance = await getWithdrawalBalance(handle.db, userId);
      expect(balance).toMatchObject({ balance: 750_000n, reserved: 0n, available: 750_000n });
    });

    it("recusar libera a reserva e não lança nada", async () => {
      const userId = await memberWith(1_000_000n);
      const req = await requestWithdrawal(handle.db, { userId, amount: 900_000n });
      if (!req.ok) throw new Error("pedido devia passar");
      expect((await getWithdrawalBalance(handle.db, userId)).available).toBe(100_000n);

      const rejected = await rejectWithdrawal(handle.db, req.withdrawal.id, { actorUserId: staffId, note: "valor errado" });
      expect(rejected.ok).toBe(true);
      if (rejected.ok) {
        expect(rejected.withdrawal.status).toBe("rejected");
        expect(rejected.withdrawal.decisionNote).toBe("valor errado");
        expect(rejected.withdrawal.ledgerEntryId).toBeNull();
      }
      expect(await getWithdrawalBalance(handle.db, userId)).toMatchObject({ balance: 1_000_000n, reserved: 0n, available: 1_000_000n });
      expect(await listLedgerEntriesByReference(handle.db, "withdrawal", req.withdrawal.id)).toEqual([]);
    });

    it("recusa exige motivo", async () => {
      const userId = await memberWith(10_000n);
      const req = await requestWithdrawal(handle.db, { userId, amount: 10_000n });
      if (!req.ok) throw new Error("pedido devia passar");
      expect(await rejectWithdrawal(handle.db, req.withdrawal.id, { actorUserId: staffId, note: "  " })).toMatchObject({ ok: false, reason: "note_required" });
      expect(await rejectWithdrawal(handle.db, req.withdrawal.id, { actorUserId: staffId })).toMatchObject({ ok: false, reason: "note_required" });
      expect((await getWithdrawal(handle.db, req.withdrawal.id))!.status).toBe("pending");
    });

    it("aprovar duas vezes não debita duas vezes", async () => {
      const userId = await memberWith(1_000_000n);
      const req = await requestWithdrawal(handle.db, { userId, amount: 100_000n });
      if (!req.ok) throw new Error("pedido devia passar");
      await approveWithdrawal(handle.db, req.withdrawal.id, { actorUserId: staffId });
      const again = await approveWithdrawal(handle.db, req.withdrawal.id, { actorUserId: staffId });
      expect(again).toMatchObject({ ok: false, reason: "invalid", from: "approved" });
      expect(await listLedgerEntriesByReference(handle.db, "withdrawal", req.withdrawal.id)).toHaveLength(1);
      expect(await getLedgerBalance(handle.db, userId, "silver")).toBe(900_000n);
    });

    it("saque já recusado não pode ser aprovado depois", async () => {
      const userId = await memberWith(50_000n);
      const req = await requestWithdrawal(handle.db, { userId, amount: 50_000n });
      if (!req.ok) throw new Error("pedido devia passar");
      await rejectWithdrawal(handle.db, req.withdrawal.id, { actorUserId: staffId, note: "não" });
      expect(await approveWithdrawal(handle.db, req.withdrawal.id, { actorUserId: staffId })).toMatchObject({ ok: false, reason: "invalid", from: "rejected" });
      expect(await getLedgerBalance(handle.db, userId, "silver")).toBe(50_000n);
    });
  });

  describe("settled é manual e exige settled_by + nota (AC#4, Q11)", () => {
    const approvedWithdrawal = async () => {
      const userId = await memberWith(300_000n);
      const req = await requestWithdrawal(handle.db, { userId, amount: 300_000n });
      if (!req.ok) throw new Error("pedido devia passar");
      const approved = await approveWithdrawal(handle.db, req.withdrawal.id, { actorUserId: staffId });
      if (!approved.ok) throw new Error("aprovação devia passar");
      return { userId, id: req.withdrawal.id };
    };

    it("liquida com quem pagou e a nota, sem tocar no ledger", async () => {
      const { userId, id } = await approvedWithdrawal();
      const entriesBefore = await listLedgerEntriesByReference(handle.db, "withdrawal", id);
      const settled = await settleWithdrawal(handle.db, id, { actorUserId: staffId, note: "transferido in-game às 21h" });
      expect(settled.ok).toBe(true);
      if (settled.ok) {
        expect(settled.withdrawal.status).toBe("settled");
        expect(settled.withdrawal.settledByUserId).toBe(staffId);
        expect(settled.withdrawal.settlementNote).toBe("transferido in-game às 21h");
        expect(settled.withdrawal.settledAt).not.toBeNull();
      }
      expect(await listLedgerEntriesByReference(handle.db, "withdrawal", id)).toEqual(entriesBefore);
      expect(await getLedgerBalance(handle.db, userId, "silver")).toBe(0n);
    });

    it("sem nota não liquida", async () => {
      const { id } = await approvedWithdrawal();
      expect(await settleWithdrawal(handle.db, id, { actorUserId: staffId })).toMatchObject({ ok: false, reason: "note_required" });
      expect(await settleWithdrawal(handle.db, id, { actorUserId: staffId, note: "\n\t " })).toMatchObject({ ok: false, reason: "note_required" });
      expect((await getWithdrawal(handle.db, id))!.status).toBe("approved");
    });

    it("pending não pula direto para settled", async () => {
      const userId = await memberWith(10_000n);
      const req = await requestWithdrawal(handle.db, { userId, amount: 10_000n });
      if (!req.ok) throw new Error("pedido devia passar");
      expect(await settleWithdrawal(handle.db, req.withdrawal.id, { actorUserId: staffId, note: "pago" })).toMatchObject({ ok: false, reason: "invalid", from: "pending" });
    });

    it("o banco recusa um settled sem settled_by/nota, mesmo por SQL direto (AC#4)", async () => {
      const { id } = await approvedWithdrawal();
      await expect(handle.db.update(schema.withdrawals).set({ status: "settled" }).where(eq(schema.withdrawals.id, id))).rejects.toThrow();
    });
  });

  describe("concorrência: pedidos simultâneos não furam o saldo (AC#5)", () => {
    it("dois pedidos de 600k com 1M de saldo: um passa, um é recusado", async () => {
      const userId = await memberWith(1_000_000n);
      const [a, b] = await Promise.all([requestWithdrawal(handle.db, { userId, amount: 600_000n }), requestWithdrawal(handle.db, { userId, amount: 600_000n })]);
      const oks = [a, b].filter((r) => r.ok);
      expect(oks).toHaveLength(1);
      expect([a, b].filter((r) => !r.ok)[0]).toMatchObject({ reason: "insufficient" });
      expect(await getWithdrawalBalance(handle.db, userId)).toMatchObject({ reserved: 600_000n, available: 400_000n });
    });

    it("oito pedidos simultâneos de 200k com 1M de saldo: exatamente cinco passam", async () => {
      const userId = await memberWith(1_000_000n);
      const results = await Promise.all(Array.from({ length: 8 }, () => requestWithdrawal(handle.db, { userId, amount: 200_000n })));
      expect(results.filter((r) => r.ok)).toHaveLength(5);
      const balance = await getWithdrawalBalance(handle.db, userId);
      expect(balance.reserved).toBe(1_000_000n);
      // O invariante que importa: a reserva nunca passa do saldo, então o disponível nunca fica negativo por pedido.
      expect(balance.available).toBe(0n);
    });

    it("pedido concorrente com a aprovação de outro saque não fura o saldo", async () => {
      const userId = await memberWith(1_000_000n);
      const first = await requestWithdrawal(handle.db, { userId, amount: 600_000n });
      if (!first.ok) throw new Error("pedido devia passar");
      const [approve, second] = await Promise.all([
        approveWithdrawal(handle.db, first.withdrawal.id, { actorUserId: staffId }),
        requestWithdrawal(handle.db, { userId, amount: 600_000n }),
      ]);
      expect(approve.ok).toBe(true);
      expect(second.ok).toBe(false);
      const balance = await getWithdrawalBalance(handle.db, userId);
      expect(balance.balance).toBe(400_000n);
      expect(balance.available).toBe(400_000n);
    });
  });

  describe("listagem", () => {
    it("filtra por usuário e por estado, do mais novo para o mais antigo", async () => {
      const userId = await memberWith(1_000_000n);
      const outro = await memberWith(1_000_000n);
      const a = await requestWithdrawal(handle.db, { userId, amount: 10_000n });
      const b = await requestWithdrawal(handle.db, { userId, amount: 20_000n });
      await requestWithdrawal(handle.db, { userId: outro, amount: 30_000n });
      if (!a.ok || !b.ok) throw new Error("pedidos deviam passar");
      await rejectWithdrawal(handle.db, a.withdrawal.id, { actorUserId: staffId, note: "não" });

      const mine = await listWithdrawals(handle.db, { userId });
      expect(mine.map((w) => w.id)).toEqual([b.withdrawal.id, a.withdrawal.id]);
      expect(mine.every((w) => w.userId === userId)).toBe(true);
      expect(mine[0]!.userNick).not.toBeNull();

      const pending = await listWithdrawals(handle.db, { userId, status: ["pending"] });
      expect(pending.map((w) => w.id)).toEqual([b.withdrawal.id]);
    });
  });
});
