import { describe, expect, it } from "vitest";
import { overlapMs } from "./voice-repo.js";

const t = (m: number) => new Date(Date.UTC(2026, 0, 1, 0, m));
const MIN = 60_000;

describe("overlapMs", () => {
  it("sessão dentro da janela conta inteira", () => {
    expect(overlapMs({ startedAt: t(10), endedAt: t(20) }, t(0), t(60))).toBe(10 * MIN);
  });
  it("recorta nas bordas da janela", () => {
    expect(overlapMs({ startedAt: t(0), endedAt: t(90) }, t(30), t(60))).toBe(30 * MIN);
  });
  it("sessão aberta conta até o fim da janela", () => {
    expect(overlapMs({ startedAt: t(50), endedAt: null }, t(0), t(60))).toBe(10 * MIN);
  });
  it("sem sobreposição retorna 0", () => {
    expect(overlapMs({ startedAt: t(70), endedAt: t(80) }, t(0), t(60))).toBe(0);
    expect(overlapMs({ startedAt: t(0), endedAt: t(5) }, t(10), t(60))).toBe(0);
  });
});
