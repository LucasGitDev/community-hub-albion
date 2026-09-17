import { describe, expect, it, vi } from "vitest";
import { GuildCleanupService } from "./guild-cleanup.service.js";
import { GuildCleanupScheduler } from "./guild-cleanup.scheduler.js";

/** Relógio mentiroso: o agendador só olha para ele, então dá para percorrer uma madrugada em 3 linhas. */
const schedulerAt = (start: Date) => {
  let now = start;
  const run = vi.fn(async () => ({ deactivated: 0 }));
  const service = { run } as unknown as GuildCleanupService;
  const scheduler = new GuildCleanupScheduler(service, () => now, 60_000);
  return { scheduler, run, travel: (to: Date) => (now = to) };
};

describe("agendamento da limpeza diária (TASK-049, AC#1)", () => {
  it("não roda ao subir: só o horário dispara", async () => {
    const { scheduler, run } = schedulerAt(new Date(2026, 8, 17, 22, 0));
    scheduler.start();
    await scheduler.tick();
    expect(run).not.toHaveBeenCalled();
    expect(scheduler.scheduledFor).toEqual(new Date(2026, 8, 18, 4, 0, 0, 0));
    scheduler.stop();
  });

  it("roda uma vez ao passar da madrugada e reagenda para o dia seguinte", async () => {
    const { scheduler, run, travel } = schedulerAt(new Date(2026, 8, 17, 22, 0));
    scheduler.start();

    travel(new Date(2026, 8, 18, 4, 0, 30));
    await scheduler.tick();
    expect(run).toHaveBeenCalledTimes(1);
    expect(scheduler.scheduledFor).toEqual(new Date(2026, 8, 19, 4, 0, 0, 0));

    // Os tiques seguintes do mesmo dia não repetem a passada.
    travel(new Date(2026, 8, 18, 4, 30));
    await scheduler.tick();
    travel(new Date(2026, 8, 18, 23, 0));
    await scheduler.tick();
    expect(run).toHaveBeenCalledTimes(1);

    travel(new Date(2026, 8, 19, 4, 1));
    await scheduler.tick();
    expect(run).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it("start é idempotente e stop desliga o timer", () => {
    const { scheduler } = schedulerAt(new Date(2026, 8, 17, 22, 0));
    scheduler.start();
    const agendado = scheduler.scheduledFor;
    scheduler.start();
    expect(scheduler.scheduledFor).toEqual(agendado);
    scheduler.stop();
    expect(() => scheduler.stop()).not.toThrow();
  });
});
