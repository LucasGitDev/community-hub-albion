import "reflect-metadata";
import type { DbHandle } from "@albion-hub/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceHeartbeatService } from "./voice-heartbeat.service.js";

const { touchHeartbeat } = vi.hoisted(() => ({ touchHeartbeat: vi.fn() }));
vi.mock("@albion-hub/db", async (orig) => ({ ...(await orig<object>()), touchHeartbeat }));

describe("VoiceHeartbeatService timer (TASK-019 AC#1, fake timers)", () => {
  const handle = { db: {} } as unknown as DbHandle;
  const clock = () => new Date(Date.now());

  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-09-15T20:00:00Z") });
    touchHeartbeat.mockReset().mockResolvedValue(1);
  });
  afterEach(() => vi.useRealTimers());

  it("toca a cada 60s e para no shutdown", async () => {
    const svc = new VoiceHeartbeatService(handle, clock, 60_000);
    svc.start();
    svc.start(); // idempotente
    await vi.advanceTimersByTimeAsync(59_999);
    expect(touchHeartbeat).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(touchHeartbeat).toHaveBeenCalledTimes(1);
    expect(touchHeartbeat).toHaveBeenLastCalledWith(handle.db, new Date("2026-09-15T20:01:00Z"));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(touchHeartbeat).toHaveBeenCalledTimes(3);
    svc.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(touchHeartbeat).toHaveBeenCalledTimes(3);
  });

  it("erro é logado, não lança, e o timer segue", async () => {
    touchHeartbeat.mockRejectedValueOnce(new Error("db down"));
    const svc = new VoiceHeartbeatService(handle, clock, 60_000);
    const log = vi.spyOn((svc as unknown as { logger: { error: (m: string) => void } }).logger, "error").mockImplementation(() => {});
    svc.start();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("db down"));
    expect(touchHeartbeat).toHaveBeenCalledTimes(2);
    svc.stop();
  });

  it("não empilha batimento enquanto o anterior está em andamento", async () => {
    let release!: () => void;
    touchHeartbeat.mockImplementationOnce(() => new Promise<number>((r) => (release = () => r(0))));
    const svc = new VoiceHeartbeatService(handle, clock, 60_000);
    const first = svc.beat();
    await svc.beat();
    expect(touchHeartbeat).toHaveBeenCalledTimes(1);
    release();
    await first;
    await svc.beat();
    expect(touchHeartbeat).toHaveBeenCalledTimes(2);
  });
});
