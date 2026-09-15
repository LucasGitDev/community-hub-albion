import { describe, expect, it } from "vitest";
import { isApiPath, shouldServeIndex } from "./spa.js";

describe("isApiPath", () => {
  it.each([
    ["/api", true],
    ["/api/", true],
    ["/api/health", true],
    ["/apix", false],
    ["/", false],
    ["/carteira", false],
    ["/staff/api", false],
  ])("%s → %s", (path, expected) => {
    expect(isApiPath(path)).toBe(expected);
  });
});

describe("shouldServeIndex", () => {
  it.each([
    ["/", true],
    ["/carteira", true],
    ["/staff/saques", true],
    ["/api/health", false],
    ["/assets/nao-existe.js", false],
    ["/favicon.ico", false],
  ])("%s → %s", (path, expected) => {
    expect(shouldServeIndex(path)).toBe(expected);
  });
});

