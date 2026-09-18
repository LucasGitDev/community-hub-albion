import { describe, expect, it } from "vitest";
import { TimelineQueue, type TimelineQueueOptions } from "./timeline-queue.js";
import type { TimelineEmbed } from "./timeline.js";

const embed = (n: number, extra = ""): TimelineEmbed => ({ title: `#${n}${extra}`, color: 0, fields: [], footer: "event.x", timestamp: "2026-09-18T00:00:00.000Z" });

/** Relógio falso: `sleep` avança o tempo na hora, então a fila roda sem esperar de verdade. */
function harness(overrides: Partial<TimelineQueueOptions> = {}) {
  let clock = 0;
  const sent: { at: number; titles: string[] }[] = [];
  const warnings: string[] = [];
  const queue = new TimelineQueue({
    send: async (embeds) => {
      sent.push({ at: clock, titles: embeds.map((e) => e.title) });
    },
    warn: (message) => warnings.push(message),
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    ...overrides,
  });
  return { queue, sent, warnings, advance: (ms: number) => (clock += ms) };
}

describe("TimelineQueue (TASK-076, T10/T11)", () => {
  it("rajada vira lotes de até 10 embeds, na ordem de chegada", async () => {
    const { queue, sent } = harness();
    for (let i = 1; i <= 23; i++) queue.push(embed(i));
    expect(sent).toHaveLength(0); // push não entrega na hora: quem publicou já voltou
    await queue.idle();
    expect(sent.map((m) => m.titles.length)).toEqual([10, 10, 3]);
    expect(sent.flatMap((m) => m.titles)).toEqual(Array.from({ length: 23 }, (_, i) => `#${i + 1}`));
  });

  it("respeita 5 mensagens a cada 5 s: a sexta espera a janela", async () => {
    const { queue, sent } = harness({ maxEmbedsPerMessage: 1 });
    for (let i = 1; i <= 12; i++) queue.push(embed(i));
    await queue.idle();
    expect(sent.map((m) => m.at)).toEqual([0, 0, 0, 0, 0, 5000, 5000, 5000, 5000, 5000, 10000, 10000]);
    expect(sent.flatMap((m) => m.titles)).toEqual(Array.from({ length: 12 }, (_, i) => `#${i + 1}`));
    for (let i = 0; i + 5 < sent.length; i++) expect(sent[i + 5].at - sent[i].at).toBeGreaterThanOrEqual(5000);
  });

  it("lote nunca passa de 6000 caracteres somados", async () => {
    const { queue, sent } = harness();
    for (let i = 1; i <= 4; i++) queue.push(embed(i, "x".repeat(2500)));
    await queue.idle();
    expect(sent.map((m) => m.titles.length)).toEqual([2, 2]);
  });

  it("falha do Discord vira aviso e a fila segue com o próximo lote, sem mudar a ordem", async () => {
    let calls = 0;
    const delivered: string[] = [];
    const { queue, warnings } = harness({
      maxEmbedsPerMessage: 2,
      send: async (embeds) => {
        if (++calls === 1) throw new Error("Missing Access");
        delivered.push(...embeds.map((e) => e.title));
      },
    });
    for (let i = 1; i <= 5; i++) queue.push(embed(i));
    await queue.idle();
    expect(delivered).toEqual(["#3", "#4", "#5"]);
    expect(warnings).toEqual(["Timeline: falha ao publicar 2 registro(s) no Discord; seguem perdidos (Missing Access)"]);
  });

  it("erro que não é Error também vira aviso legível", async () => {
    const { queue, warnings } = harness({ send: () => Promise.reject("boom") });
    queue.push(embed(1));
    await queue.idle();
    expect(warnings[0]).toContain("(boom)");
  });

  it("fila cheia descarta o excedente, avisa uma vez e mantém a ordem do que ficou", async () => {
    const { queue, sent, warnings } = harness({ maxQueued: 3 });
    for (let i = 1; i <= 5; i++) queue.push(embed(i));
    expect(queue.size).toBe(3);
    await queue.idle();
    expect(sent.flatMap((m) => m.titles)).toEqual(["#1", "#2", "#3"]);
    expect(warnings).toEqual(["Timeline: fila cheia, 2 registro(s) descartado(s)"]);
  });

  it("registro que chega depois de a fila esvaziar também sai", async () => {
    const { queue, sent } = harness();
    queue.push(embed(1));
    await queue.idle();
    queue.push(embed(2));
    await queue.idle();
    expect(sent.map((m) => m.titles)).toEqual([["#1"], ["#2"]]);
  });

  it("registro que chega enquanto um envio está em curso entra no lote seguinte", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const batches: string[][] = [];
    const { queue } = harness({
      send: async (embeds) => {
        batches.push(embeds.map((e) => e.title));
        if (batches.length === 1) await gate;
      },
    });
    queue.push(embed(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    queue.push(embed(2));
    release();
    await queue.idle();
    expect(batches).toEqual([["#1"], ["#2"]]);
  });

  it("usa relógio e espera reais por padrão", async () => {
    const titles: string[] = [];
    const queue = new TimelineQueue({ send: async (embeds) => void titles.push(...embeds.map((e) => e.title)), warn: () => {} });
    queue.push(embed(1));
    await queue.idle();
    expect(titles).toEqual(["#1"]);
  });
});
