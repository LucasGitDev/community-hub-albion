import { describe, expect, it } from "vitest";
import { decodeLedgerCursor, encodeLedgerCursor, LEDGER_ENTRY_KIND_LABELS, LEDGER_ENTRY_KINDS, LEDGER_PAGE_MAX, parseLedgerPageQuery } from "./ledger.js";

describe("rótulos do extrato (TASK-031)", () => {
  it("nomeia toda origem de lançamento em PT-BR", () => {
    for (const kind of LEDGER_ENTRY_KINDS) expect(LEDGER_ENTRY_KIND_LABELS[kind]).toBeTruthy();
  });
});

describe("cursor do extrato", () => {
  it("vai e volta", () => {
    const at = new Date("2026-09-16T12:00:00.000Z");
    const cursor = decodeLedgerCursor(encodeLedgerCursor({ createdAt: at.toISOString(), id: "abc" }));
    expect(cursor).toEqual({ createdAt: at, id: "abc" });
  });

  it("recusa formato inválido em vez de chutar", () => {
    expect(decodeLedgerCursor("")).toBeNull();
    expect(decodeLedgerCursor("|abc")).toBeNull();
    expect(decodeLedgerCursor("nao-data|abc")).toBeNull();
    expect(decodeLedgerCursor("2026-09-16T12:00:00.000Z|")).toBeNull();
  });
});

describe("parseLedgerPageQuery", () => {
  it("aceita vazio", () => {
    expect(parseLedgerPageQuery({})).toEqual({ ok: true });
  });

  it("aceita limite e cursor válidos", () => {
    const parsed = parseLedgerPageQuery({ limit: "10", cursor: "2026-09-16T12:00:00.000Z|abc" });
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.limit).toBe(10);
    expect(parsed.ok && parsed.cursor?.id).toBe("abc");
  });

  it("recusa limite fora da faixa, quebrado ou cursor inválido", () => {
    expect(parseLedgerPageQuery({ limit: "0" }).ok).toBe(false);
    expect(parseLedgerPageQuery({ limit: String(LEDGER_PAGE_MAX + 1) }).ok).toBe(false);
    expect(parseLedgerPageQuery({ limit: "1,5" }).ok).toBe(false);
    expect(parseLedgerPageQuery({ cursor: 5 }).ok).toBe(false);
    expect(parseLedgerPageQuery({ cursor: "lixo" }).ok).toBe(false);
  });
});
