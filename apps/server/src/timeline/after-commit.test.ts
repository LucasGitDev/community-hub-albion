import { describe, expect, it, vi } from "vitest";
import type { TimelineEntry } from "../domain/timeline.js";
import { publishAfterCommit } from "./after-commit.js";
import { FakeTimelinePublisher } from "./fake-timeline.publisher.js";

const entry = (action: TimelineEntry["action"]): TimelineEntry => ({ action, summary: action, actor: { kind: "maintenance" } });

describe("publishAfterCommit (TASK-078)", () => {
  it("publica o registro montado, ou cada um de uma lista, na ordem", async () => {
    const timeline = new FakeTimelinePublisher();
    await publishAfterCommit(timeline, async () => entry("economy.a"));
    await publishAfterCommit(timeline, async () => [entry("economy.b"), entry("economy.c")]);
    expect(timeline.actions()).toEqual(["economy.a", "economy.b", "economy.c"]);
  });

  it("null não publica nada", async () => {
    const timeline = new FakeTimelinePublisher();
    await publishAfterCommit(timeline, async () => null);
    expect(timeline.entries).toEqual([]);
  });

  it("falha ao montar (ex.: banco fora ao buscar nomes) vira aviso e nunca derruba a operação (DoD #7)", async () => {
    const timeline = new FakeTimelinePublisher();
    const logger = { warn: vi.fn() };
    await expect(publishAfterCommit(timeline, () => Promise.reject(new Error("conexão caiu")), logger)).resolves.toBeUndefined();
    expect(timeline.entries).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("conexão caiu"));
  });

  it("nem um logger quebrado derruba", async () => {
    const logger = { warn: () => { throw new Error("log fora"); } };
    await expect(publishAfterCommit(new FakeTimelinePublisher(), () => Promise.reject(new Error("x")), logger)).resolves.toBeUndefined();
  });
});
