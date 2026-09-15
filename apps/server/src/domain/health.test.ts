import { describe, expect, it } from "vitest";
import { buildHealth } from "./health.js";

describe("buildHealth", () => {
  it("API ok independente do bot", () => {
    expect(buildHealth(true)).toEqual({ status: "ok", bot: "online" });
    expect(buildHealth(false)).toEqual({ status: "ok", bot: "offline" });
  });
});
