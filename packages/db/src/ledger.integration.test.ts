import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDb,
  getLedgerBalance,
  insertLedgerEntry,
  listLedgerEntries,
  listLedgerEntriesByReference,
  reverseLedgerEntry,
  runMigrations,
  schema,
  upsertUserByDiscordId,
  type DbHandle,
  type LedgerEntry,
} from "./index.js";

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: testes do ledger não podem ser pulados");

/** Código SQLSTATE do erro, ou undefined se a promessa passou. */
async function pgCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    for (let e: unknown = error; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
      const code = (e as { code?: unknown }).code;
      if (typeof code === "string") return code;
    }
    return "sem-code";
  }
}

describe.skipIf(!baseUrl)("ledger append-only de prata (TASK-026, Postgres real)", () => {
  let handle: DbHandle;
  let url: string;
  let seq = 0;

  const nextUser = async () => {
    const discordId = `9200000000000000${String(++seq).padStart(2, "0")}`;
    const user = await upsertUserByDiscordId(handle.db, { discordId, discordUsername: `ledger${seq}` });
    return user.id;
  };

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_ledger`;
    target.pathname = `/${name}`;
    const admin = createDb(baseUrl!, { max: 1 });
    await admin.db.execute(sql.raw(`drop database if exists "${name}" with (force)`));
    await admin.db.execute(sql.raw(`create database "${name}"`));
    await admin.close();
    url = target.toString();
    await runMigrations(url);
    handle = createDb(url);
  }, 60_000);

  afterAll(async () => {
    await handle?.close();
  });

  describe("imutabilidade garantida no banco (AC#1)", () => {
    let entry: LedgerEntry;

    beforeAll(async () => {
      entry = await insertLedgerEntry(handle.db, { userId: await nextUser(), amount: 1_000n, kind: "split_payout", memo: "original" });
    });

    it("UPDATE é rejeitado pelo banco", async () => {
      const code = await pgCode(handle.db.update(schema.ledgerEntries).set({ amount: 1n }).where(eq(schema.ledgerEntries.id, entry.id)));
      expect(code).toBe("23514");
      const [row] = await handle.db.select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.id, entry.id));
      expect(row?.amount).toBe(1_000n);
      expect(row?.memo).toBe("original");
    });

    it("DELETE é rejeitado pelo banco", async () => {
      const code = await pgCode(handle.db.delete(schema.ledgerEntries).where(eq(schema.ledgerEntries.id, entry.id)));
      expect(code).toBe("23514");
      const rows = await handle.db.select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.id, entry.id));
      expect(rows).toHaveLength(1);
    });

    it("TRUNCATE é rejeitado pelo banco", async () => {
      expect(await pgCode(handle.db.execute(sql`truncate table ${schema.ledgerEntries} cascade`))).toBe("23514");
    });

    it("UPDATE que não casaria com nenhuma linha também é rejeitado", async () => {
      const code = await pgCode(handle.db.update(schema.ledgerEntries).set({ memo: "x" }).where(sql`false`));
      expect(code).toBe("23514");
    });

    it("lançamento de valor zero é recusado", async () => {
      expect(await pgCode(insertLedgerEntry(handle.db, { userId: entry.userId, amount: 0n, kind: "adjustment" }))).toBe("23514");
    });
  });

  describe("estorno (AC#2)", () => {
    it("cria lançamento inverso vinculado ao original, sem tocar nele", async () => {
      const userId = await nextUser();
      const original = await insertLedgerEntry(handle.db, {
        userId,
        amount: 2_500_000n,
        kind: "split_payout",
        reference: { type: "loot_split", id: "11111111-1111-4111-8111-111111111111" },
        memo: "pagamento do split",
      });

      const result = await reverseLedgerEntry(handle.db, original.id, { reason: "split refeito", actorUserId: userId });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.entry).toMatchObject({
        userId,
        amount: -2_500_000n,
        kind: "reversal",
        reversalOf: original.id,
        referenceType: "loot_split",
        memo: "split refeito",
        createdBy: userId,
      });

      const [untouched] = await handle.db.select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.id, original.id));
      expect(untouched).toMatchObject({ amount: 2_500_000n, kind: "split_payout", memo: "pagamento do split" });
      expect(await getLedgerBalance(handle.db, userId)).toBe(0n);
    });

    it("dois estornos concorrentes: só um passa (índice único parcial)", async () => {
      const userId = await nextUser();
      const original = await insertLedgerEntry(handle.db, { userId, amount: 700_000n, kind: "split_payout" });

      const results = await Promise.all([
        reverseLedgerEntry(handle.db, original.id, { reason: "corrida A" }),
        reverseLedgerEntry(handle.db, original.id, { reason: "corrida B" }),
        reverseLedgerEntry(handle.db, original.id, { reason: "corrida C" }),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok && r.reason === "already_reversed")).toHaveLength(2);

      const rows = await handle.db.select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.reversalOf, original.id));
      expect(rows).toHaveLength(1);
      expect(await getLedgerBalance(handle.db, userId)).toBe(0n);
    });

    it("estorno sequencial repetido devolve already_reversed", async () => {
      const userId = await nextUser();
      const original = await insertLedgerEntry(handle.db, { userId, amount: 10n, kind: "adjustment" });
      expect((await reverseLedgerEntry(handle.db, original.id, { reason: "primeiro" })).ok).toBe(true);
      expect(await reverseLedgerEntry(handle.db, original.id, { reason: "segundo" })).toEqual({ ok: false, reason: "already_reversed" });
    });

    it("estorno de estorno é recusado e lançamento inexistente devolve not_found", async () => {
      const userId = await nextUser();
      const original = await insertLedgerEntry(handle.db, { userId, amount: 10n, kind: "adjustment" });
      const first = await reverseLedgerEntry(handle.db, original.id, { reason: "erro de lançamento" });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(await reverseLedgerEntry(handle.db, first.entry.id, { reason: "desfazer o desfazer" })).toEqual({ ok: false, reason: "is_reversal" });
      expect(await reverseLedgerEntry(handle.db, "22222222-2222-4222-8222-222222222222", { reason: "nada" })).toEqual({ ok: false, reason: "not_found" });
    });

    it("reversal_of sem kind reversal é recusado pelo banco", async () => {
      const userId = await nextUser();
      const original = await insertLedgerEntry(handle.db, { userId, amount: 10n, kind: "adjustment" });
      const insert = handle.db.insert(schema.ledgerEntries).values({ userId, amount: -10n, kind: "adjustment", reversalOf: original.id });
      expect(await pgCode(insert)).toBe("23514");
    });
  });

  describe("saldo (AC#3, AC#4)", () => {
    it("é exato acima de 2^53", async () => {
      const userId = await nextUser();
      // 2^53 = 9007199254740992: valores que o double do JS não representa.
      await insertLedgerEntry(handle.db, { userId, amount: 9_007_199_254_740_993n, kind: "split_payout" });
      await insertLedgerEntry(handle.db, { userId, amount: 9_007_199_254_740_994n, kind: "split_payout" });
      const balance = await getLedgerBalance(handle.db, userId);
      expect(balance).toBe(18_014_398_509_481_987n);
      expect(typeof balance).toBe("bigint");
      // A prova do problema: o mesmo cálculo em number perderia prata.
      expect(BigInt(Number(balance))).not.toBe(balance);
    });

    it("saldo sem lançamento é zero", async () => {
      expect(await getLedgerBalance(handle.db, await nextUser())).toBe(0n);
    });

    it("permite saldo negativo (Q24)", async () => {
      const userId = await nextUser();
      const payout = await insertLedgerEntry(handle.db, { userId, amount: 1_000_000n, kind: "split_payout" });
      await insertLedgerEntry(handle.db, { userId, amount: -1_000_000n, kind: "withdrawal", reference: { type: "withdrawal", id: "33333333-3333-4333-8333-333333333333" } });
      expect(await getLedgerBalance(handle.db, userId)).toBe(0n);

      // Estorno do pagamento depois do saque já liquidado: o saldo vira negativo e nada é apagado.
      expect((await reverseLedgerEntry(handle.db, payout.id, { reason: "split cancelado depois do saque" })).ok).toBe(true);
      expect(await getLedgerBalance(handle.db, userId)).toBe(-1_000_000n);
    });
  });

  describe("extrato", () => {
    it("lista do mais novo ao mais antigo e pagina por cursor", async () => {
      const userId = await nextUser();
      for (let i = 1; i <= 5; i++) await insertLedgerEntry(handle.db, { userId, amount: BigInt(i) * 100n, kind: "adjustment", memo: `m${i}` });

      const first = await listLedgerEntries(handle.db, userId, { limit: 2 });
      expect(first.entries.map((e) => e.memo)).toEqual(["m5", "m4"]);
      expect(first.nextCursor).not.toBeNull();

      const second = await listLedgerEntries(handle.db, userId, { limit: 2, cursor: first.nextCursor });
      expect(second.entries.map((e) => e.memo)).toEqual(["m3", "m2"]);

      const last = await listLedgerEntries(handle.db, userId, { limit: 2, cursor: second.nextCursor });
      expect(last.entries.map((e) => e.memo)).toEqual(["m1"]);
      expect(last.nextCursor).toBeNull();

      // limit fora da faixa é normalizado (1..200), não estoura.
      expect((await listLedgerEntries(handle.db, userId, { limit: 0 })).entries).toHaveLength(1);
      expect((await listLedgerEntries(handle.db, userId, { limit: 9_999 })).entries).toHaveLength(5);
      expect((await listLedgerEntries(handle.db, userId)).entries).toHaveLength(5);
    });

    it("lista lançamentos de uma origem, do mais antigo ao mais novo", async () => {
      const userId = await nextUser();
      const splitId = "44444444-4444-4444-8444-444444444444";
      const payout = await insertLedgerEntry(handle.db, { userId, amount: 900n, kind: "split_payout", reference: { type: "loot_split", id: splitId } });
      await insertLedgerEntry(handle.db, { userId, amount: -100n, kind: "split_fee", reference: { type: "loot_split", id: splitId } });
      await reverseLedgerEntry(handle.db, payout.id, { reason: "recalculado" });

      const rows = await listLedgerEntriesByReference(handle.db, "loot_split", splitId);
      expect(rows.map((r) => r.kind)).toEqual(["split_payout", "split_fee", "reversal"]);
      expect(await listLedgerEntriesByReference(handle.db, "event", splitId)).toEqual([]);
    });
  });
});
