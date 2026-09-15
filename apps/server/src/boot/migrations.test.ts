import { afterEach, describe, expect, it, vi } from "vitest";
import { applyMigrationsOrExit, describeMigrationFailure } from "./migrations.js";

describe("describeMigrationFailure", () => {
  it("mascara usuário e senha da URL", () => {
    const msg = describeMigrationFailure(new Error("connect failed postgres://albion:segredo@db:5432/albion_hub"));
    expect(msg).toBe("Falha ao aplicar migrations do banco: connect failed postgres://***@db:5432/albion_hub");
    expect(msg).not.toContain("segredo");
  });

  it("mostra a causa do driver embrulhada pelo drizzle", () => {
    const wrapped = new Error('Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"\nparams: ', {
      cause: new Error('password authentication failed for user "albion"'),
    });
    expect(describeMigrationFailure(wrapped)).toBe(
      'Falha ao aplicar migrations do banco: password authentication failed for user "albion" (Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle")',
    );
  });

  it("aceita erro não-Error", () => {
    expect(describeMigrationFailure("boom")).toBe("Falha ao aplicar migrations do banco: boom");
  });
});

describe("applyMigrationsOrExit", () => {
  afterEach(() => vi.restoreAllMocks());

  it("roda migrations com a URL", async () => {
    const run = vi.fn(async () => {});
    await applyMigrationsOrExit("postgres://x@y/z", run);
    expect(run).toHaveBeenCalledWith("postgres://x@y/z");
  });

  it("encerra com código 1 e mensagem clara em falha", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await applyMigrationsOrExit("postgres://x@y/z", async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(error).toHaveBeenCalledWith("Falha ao aplicar migrations do banco: ECONNREFUSED");
    expect(exit).toHaveBeenCalledWith(1);
  });
});
