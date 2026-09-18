import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "../domain/timeline.js";
import { DiscordTimelinePublisher, type TimelineClientLike } from "./discord-timeline.publisher.js";

const CHANNEL = "823456789012345678";
const entry = (n: number): TimelineEntry => ({
  action: "economy.silver_adjusted",
  summary: `Ajuste ${n}`,
  actor: { kind: "maintenance" },
  target: { name: "Jogador", id: "9d8c7b6a-0000-4000-8000-000000000000" },
  amounts: [{ value: -1_500_000n, currency: "silver" }],
  recordId: `rec-${n}`,
  at: new Date("2026-09-18T12:00:00.000Z"),
});

function setup(send: (payload: unknown) => Promise<unknown>, fetch?: TimelineClientLike["channels"]["fetch"]) {
  const payloads: unknown[] = [];
  const warnings: string[] = [];
  const fetched: string[] = [];
  const client: TimelineClientLike = {
    channels: {
      fetch:
        fetch ??
        (async (id) => {
          fetched.push(id);
          return { send: async (payload) => (payloads.push(payload), send(payload)) };
        }),
    },
  };
  let clock = 0;
  const publisher = new DiscordTimelinePublisher(client, CHANNEL, { warn: (m: string) => void warnings.push(m) }, { now: () => clock, sleep: async (ms) => void (clock += ms) });
  return { publisher, payloads, warnings, fetched };
}

describe("DiscordTimelinePublisher (TASK-076)", () => {
  it("rajada sai agrupada no canal configurado, em embeds, sem notificar ninguém e na ordem", async () => {
    const { publisher, payloads, fetched } = setup(async () => ({}));
    for (let i = 1; i <= 12; i++) publisher.publish(entry(i));
    await publisher.idle();
    expect(fetched).toEqual([CHANNEL, CHANNEL]);
    expect(payloads).toHaveLength(2);
    const [first, second] = payloads as { embeds: { title: string; footer: { text: string }; timestamp: string; fields: { name: string; value: string }[] }[]; allowedMentions: unknown }[];
    expect(first.embeds).toHaveLength(10);
    expect(second.embeds.map((e) => e.title)).toEqual(["Ajuste 11", "Ajuste 12"]);
    expect(first.allowedMentions).toEqual({ parse: [] });
    expect(first.embeds[0]).toMatchObject({
      title: "Ajuste 1",
      footer: { text: "economy.silver_adjusted · rec-1" },
      timestamp: "2026-09-18T12:00:00.000Z",
    });
    expect(first.embeds[0].fields).toContainEqual({ name: "Prata", value: "-1.500.000", inline: true });
    expect(first.embeds[0]).not.toHaveProperty("description");
  });

  it("lista vira descrição do embed", async () => {
    const { publisher, payloads } = setup(async () => ({}));
    publisher.publish({ ...entry(1), action: "event.signups_closed", list: { title: "Inscritos", items: ["A"] } });
    await publisher.idle();
    expect((payloads[0] as { embeds: { description: string }[] }).embeds[0].description).toBe("**Inscritos** (1)\n• A");
  });

  it("Discord lento não atrasa quem publicou: publish volta antes de qualquer envio", async () => {
    let calls = 0;
    const { publisher } = setup(() => new Promise(() => {}), async () => (calls++, { send: () => new Promise(() => {}) }));
    const started = performance.now();
    for (let i = 0; i < 200; i++) publisher.publish(entry(i));
    expect(performance.now() - started).toBeLessThan(200);
    expect(calls).toBe(0);
  });

  it("falha do Discord vira aviso e nunca chega em quem publicou", async () => {
    const { publisher, warnings } = setup(async () => Promise.reject(Object.assign(new Error("Missing Permissions"), { code: 50013 })));
    expect(() => publisher.publish(entry(1))).not.toThrow();
    await publisher.idle();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("falha ao publicar 1 registro(s)");
  });

  it("canal inexistente ou que não é de texto vira aviso que cita a env", async () => {
    const missing = setup(async () => ({}), async () => Promise.reject(Object.assign(new Error("Unknown Channel"), { code: 10003 })));
    missing.publisher.publish(entry(1));
    await missing.publisher.idle();
    expect(missing.warnings[0]).toContain("DISCORD_TIMELINE_CHANNEL_ID");
    const voice = setup(async () => ({}), async () => ({}));
    voice.publisher.publish(entry(1));
    await voice.publisher.idle();
    expect(voice.warnings[0]).toContain("Canal da timeline não aceita mensagens");
  });

  it("registro malformado não lança: vira aviso", () => {
    const { publisher, warnings } = setup(async () => ({}));
    expect(() => publisher.publish({ ...entry(1), at: new Date("invalida") })).not.toThrow();
    expect(warnings[0]).toContain("economy.silver_adjusted não pôde ser montado");
  });

  it("logger quebrado também não derruba nada", async () => {
    const client: TimelineClientLike = { channels: { fetch: async () => Promise.reject(new Error("down")) } };
    const publisher = new DiscordTimelinePublisher(client, CHANNEL, { warn: () => { throw new Error("log off"); } });
    expect(() => publisher.publish({ ...entry(1), at: new Date("invalida") })).not.toThrow();
    publisher.publish(entry(2));
    await expect(publisher.idle()).resolves.toBeUndefined();
  });
});
