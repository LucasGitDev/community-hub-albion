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
    const payout = await ledger.record({ userId, amount: 4_000_000n, kind: "split_payout", reference: { type: "loot_split", id: splitId }, createdBy: userId, memo: "split" });
    await ledger.record({ userId, amount: -400_000n, kind: "split_fee", reference: { type: "loot_split", id: splitId } });
    expect(await ledger.balance(userId)).toBe(3_600_000n);

    const reversed = await ledger.reverse(payout.id, { reason: "split refeito", actorUserId: userId });
    expect(reversed.ok).toBe(true);
    // Saldo negativo é válido (Q24): a taxa continua debitada depois do estorno do pagamento.
    expect(await ledger.balance(userId)).toBe(-400_000n);
    expect(await ledger.reverse(payout.id, { reason: "de novo" })).toEqual({ ok: false, reason: "already_reversed" });

    const statement = await ledger.statement(userId, { limit: 10 });
    expect(statement.entries.map((e) => e.kind)).toEqual(["reversal", "split_fee", "split_payout"]);
    expect(statement.nextCursor).toBeNull();
    expect((await ledger.byReference("loot_split", splitId)).map((e) => e.kind)).toEqual(["split_payout", "split_fee", "reversal"]);
  });
});
