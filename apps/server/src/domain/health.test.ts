import { describe, expect, it } from "vitest";
import { buildHealth } from "./health.js";

describe("buildHealth", () => {
  it("ok com banco up, independente do bot", () => {
    expect(buildHealth({ dbUp: true, botReady: true })).toEqual({ status: "ok", db: "up", bot: "online" });
    expect(buildHealth({ dbUp: true, botReady: false })).toEqual({ status: "ok", db: "up", bot: "offline" });
  });

  it("degraded quando banco cai", () => {
    expect(buildHealth({ dbUp: false, botReady: true })).toEqual({ status: "degraded", db: "down", bot: "online" });
  });
});
