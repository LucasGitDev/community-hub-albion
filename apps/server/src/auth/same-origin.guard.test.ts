import "reflect-metadata";
import type { ExecutionContext } from "@nestjs/common";
import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { Env } from "../config/env.js";
import { SameOriginGuard } from "./same-origin.guard.js";

/**
 * TASK-046 AC#3: a origem esperada vem da configuração (PUBLIC_URL), não de um literal. Configurar a
 * origem é diferente de aceitar qualquer uma — o guard tem que seguir recusando origem estranha em
 * qualquer porta que o e2e escolha.
 */
const contextWith = (headers: Record<string, string>): ExecutionContext =>
  ({ switchToHttp: () => ({ getRequest: () => ({ headers }) }) }) as unknown as ExecutionContext;

const guardFor = (publicUrl: string) => new SameOriginGuard({ PUBLIC_URL: publicUrl } as Env);

describe("SameOriginGuard: origem configurável (TASK-046)", () => {
  it.each(["http://localhost:4173", "http://localhost:4199", "https://painel.exemplo.com"])("aceita a origem configurada %s", (publicUrl) => {
    expect(guardFor(publicUrl).canActivate(contextWith({ origin: publicUrl }))).toBe(true);
  });

  it("aceita sec-fetch-site same-origin em qualquer porta configurada", () => {
    expect(guardFor("http://localhost:4199").canActivate(contextWith({ "sec-fetch-site": "same-origin" }))).toBe(true);
  });

  it.each([
    ["outra porta", "http://localhost:4173"],
    ["outro host", "https://evil.exemplo"],
    ["outro esquema", "https://localhost:4199"],
  ])("recusa origem estranha: %s", (_caso, origin) => {
    const guard = guardFor("http://localhost:4199");
    expect(() => guard.canActivate(contextWith({ origin }))).toThrow(ForbiddenException);
  });

  it("recusa requisição sem Origin nem sec-fetch-site", () => {
    expect(() => guardFor("http://localhost:4199").canActivate(contextWith({}))).toThrow(ForbiddenException);
  });

  it("recusa sec-fetch-site cross-site mesmo com Origin igual à configurada", () => {
    const guard = guardFor("http://localhost:4199");
    expect(() => guard.canActivate(contextWith({ origin: "http://localhost:4199", "sec-fetch-site": "cross-site" }))).toThrow(ForbiddenException);
  });
});
