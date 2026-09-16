import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { EventDto } from "@albion-hub/shared";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { EVENTS_CLOCK, EventSignupsCloseService, SIGNUPS_CLOSE_INTERVAL_MS } from "./events-signups-close.service.js";
import { EventsService } from "./events.service.js";

const event = (name: string) => ({ id: name, name }) as EventDto;

describe("EventSignupsCloseService (TASK-021 AC#5)", () => {
  let service: EventSignupsCloseService;
  let closeDue: Mock<(now: Date) => Promise<EventDto[]>>;
  let now = new Date("2026-10-01T22:00:00.000Z");

  beforeEach(async () => {
    closeDue = vi.fn<(now: Date) => Promise<EventDto[]>>().mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        EventSignupsCloseService,
        { provide: EventsService, useValue: { closeDue } },
        { provide: EVENTS_CLOCK, useValue: () => now },
        { provide: SIGNUPS_CLOSE_INTERVAL_MS, useValue: 30_000 },
      ],
    }).compile();
    service = moduleRef.get(EventSignupsCloseService);
  });

  afterEach(() => {
    service.stop();
    vi.useRealTimers();
  });

  it("passa o relógio injetado e devolve quantos fechou", async () => {
    closeDue.mockResolvedValue([event("Roads"), event("DG")]);
    expect(await service.sweep()).toBe(2);
    expect(closeDue).toHaveBeenCalledWith(now);
  });

  it("não empilha passadas: chamada concorrente com a anterior aberta não toca o banco de novo", async () => {
    let release: () => void = () => {};
    closeDue.mockImplementation(
      () =>
        new Promise<EventDto[]>((resolve) => {
          release = () => resolve([]);
        }),
    );
    const first = service.sweep();
    expect(await service.sweep()).toBe(0);
    expect(closeDue).toHaveBeenCalledTimes(1);
    release();
    await first;
    // Passada terminou: a próxima volta a varrer.
    closeDue.mockResolvedValue([event("Roads")]);
    expect(await service.sweep()).toBe(1);
    expect(closeDue).toHaveBeenCalledTimes(2);
  });

  it("erro de banco vira log e não derruba o timer", async () => {
    closeDue.mockRejectedValue(new Error("conexão caiu"));
    await expect(service.sweep()).resolves.toBe(0);
    closeDue.mockResolvedValue([event("Roads")]);
    expect(await service.sweep()).toBe(1);
  });

  it("start é idempotente e o timer roda no intervalo; stop e shutdown desligam", async () => {
    vi.useFakeTimers();
    service.start();
    service.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(closeDue).toHaveBeenCalledTimes(2);
    service.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(closeDue).toHaveBeenCalledTimes(2);
  });

  it("usa o relógio a cada passada (horário avança entre varreduras)", async () => {
    await service.sweep();
    now = new Date("2026-10-01T23:00:00.000Z");
    await service.sweep();
    expect(closeDue).toHaveBeenLastCalledWith(now);
  });
});
