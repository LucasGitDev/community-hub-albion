import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "../domain/timeline.js";
import { FakeTimelinePublisher } from "./fake-timeline.publisher.js";

const entry = (action: TimelineEntry["action"]): TimelineEntry => ({ action, summary: action, actor: { kind: "system", name: "teste" } });

describe("FakeTimelinePublisher (TASK-076, AC#6)", () => {
  it("guarda na ordem e permite afirmar ação, contagem e conteúdo", () => {
    const timeline = new FakeTimelinePublisher();
    expect(timeline.last()).toBeUndefined();
    timeline.publish(entry("event.created"));
    timeline.publish(entry("event.opened"));
    timeline.publish(entry("event.opened"));
    expect(timeline.actions()).toEqual(["event.created", "event.opened", "event.opened"]);
    expect(timeline.only("event.created").summary).toBe("event.created");
    expect(timeline.ofAction("event.opened")).toHaveLength(2);
    expect(timeline.last()?.action).toBe("event.opened");
    expect(() => timeline.only("event.opened")).toThrow("esperava 1 registro event.opened, veio 2");
    timeline.clear();
    expect(() => timeline.only("event.created")).toThrow("publicados: nenhum");
  });
});
