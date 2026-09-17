import { createDb, runMigrations, upsertUserByDiscordId, type DbHandle } from "@albion-hub/db";
import { Test } from "@nestjs/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DB_HANDLE } from "../db/db.module.js";
import { LedgerService } from "./ledger.service.js";

const baseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!baseUrl && process.env.CI) throw new Error("CI sem TEST_DATABASE_URL: testes do ledger não podem ser pulados");

describe.skipIf(!baseUrl)("LedgerService (TASK-026)", () => {
  let handle: DbHandle;
  let ledger: LedgerService;
  let userId: string;

  beforeAll(async () => {
    const target = new URL(baseUrl!);
    const name = `${target.pathname.slice(1)}_ledger_service`;
    target.pathname = `/${name}`;
    const admin = createDb(baseUrl!, { max: 1 });
    await admin.db.execute(sql.raw(`drop database if exists "${name}" with (force)`));
    await admin.db.execute(sql.raw(`create database "${name}"`));
    await admin.close();
    await runMigrations(target.toString());
    handle = createDb(target.toString());

    const moduleRef = await Test.createTestingModule({ providers: [LedgerService, { provide: DB_HANDLE, useValue: handle }] }).compile();
    ledger = moduleRef.get(LedgerService);
    userId = (await upsertUserByDiscordId(handle.db, { discordId: "930000000000000001", discordUsername: "ledger-svc" })).id;
  }, 60_000);

  afterAll(async () => {
    await handle?.close();
  });

  it("registra, estorna e devolve saldo em bigint", async () => {
    const splitId = "55555555-5555-4555-8555-555555555555";
    const payout = await ledger.record({ userId, currency: "silver", amount: 4_000_000n, kind: "split_payout", reference: { type: "loot_split", id: splitId }, createdBy: userId, memo: "split" });
    await ledger.record({ userId, currency: "silver", amount: -400_000n, kind: "split_fee", reference: { type: "loot_split", id: splitId } });
    expect(await ledger.balance(userId, "silver")).toBe(3_600_000n);

    const reversed = await ledger.reverse(payout.id, { reason: "split refeito", actorUserId: userId });
    expect(reversed.ok).toBe(true);
    // Saldo negativo é válido (Q24): a taxa continua debitada depois do estorno do pagamento.
    expect(await ledger.balance(userId, "silver")).toBe(-400_000n);
    expect(await ledger.reverse(payout.id, { reason: "de novo" })).toEqual({ ok: false, reason: "already_reversed" });

    const statement = await ledger.statement(userId, "all", { limit: 10 });
    expect(statement.entries.map((e) => e.kind)).toEqual(["reversal", "split_fee", "split_payout"]);
    expect(statement.nextCursor).toBeNull();
    expect((await ledger.byReference("loot_split", splitId)).map((e) => e.kind)).toEqual(["split_payout", "split_fee", "reversal"]);
  });

  /** F6-1/F6-7: as duas moedas moram na mesma tabela, mas nenhuma leitura soma uma com a outra. */
  it("mantém os saldos das duas moedas separados e recusa gasto que deixaria a Buffunfa negativa", async () => {
    const outro = (await upsertUserByDiscordId(handle.db, { discordId: "930000000000000002", discordUsername: "ledger-buf" })).id;
    await ledger.record({ userId: outro, currency: "silver", amount: 1_000_000n, kind: "split_payout", memo: "prata" });
    await ledger.record({ userId: outro, currency: "buffunfa", amount: 50n, kind: "adjustment", memo: "Buffunfa" });

    expect(await ledger.balance(outro, "silver")).toBe(1_000_000n);
    expect(await ledger.balance(outro, "buffunfa")).toBe(50n);
    expect(await ledger.balances(outro)).toEqual({ silver: 1_000_000n, buffunfa: 50n });

    // O extrato "todas" traz as duas, cada linha com a sua moeda; o filtrado traz só uma.
    const todas = await ledger.statement(outro, "all", { limit: 10 });
    expect(todas.entries.map((e) => e.currency).sort()).toEqual(["buffunfa", "silver"]);
    expect((await ledger.statement(outro, "buffunfa", { limit: 10 })).entries.map((e) => e.amount)).toEqual([50n]);

    const demais = await ledger.spend({ userId: outro, currency: "buffunfa", amount: 80n, kind: "adjustment", memo: "compra cara" });
    expect(demais).toEqual({ ok: false, reason: "insufficient_funds", balance: 50n });
    expect(await ledger.balance(outro, "buffunfa")).toBe(50n);

    const cabe = await ledger.spend({ userId: outro, currency: "buffunfa", amount: 30n, kind: "adjustment", memo: "compra" });
    expect(cabe.ok).toBe(true);
    expect(await ledger.balance(outro, "buffunfa")).toBe(20n);
    // A prata não foi tocada: gasto de uma moeda não encosta na outra.
    expect(await ledger.balance(outro, "silver")).toBe(1_000_000n);

    // Exceção registrada (F6-6/F6-7): o ajuste da staff passa por `record` e pode cravar negativo.
    await ledger.record({ userId: outro, currency: "buffunfa", amount: -100n, kind: "adjustment", memo: "estorno da staff" });
    expect(await ledger.balance(outro, "buffunfa")).toBe(-80n);
  });
});
