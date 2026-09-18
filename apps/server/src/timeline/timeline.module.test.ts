import "reflect-metadata";
import { Global, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Client } from "discord.js";
import { describe, expect, it } from "vitest";
import { TIMELINE_PUBLISHER, type TimelineEntry, type TimelinePublisher } from "../domain/timeline.js";
import { FakeTimelinePublisher } from "./fake-timeline.publisher.js";
import { NoopTimelinePublisher } from "./noop-timeline.publisher.js";
import { TimelineModule, guardTimeline } from "./timeline.module.js";

const CHANNEL = "823456789012345678";
const entry: TimelineEntry = { action: "account.nick_approved", summary: "Nick aprovado", actor: { kind: "maintenance" } };

async function resolve(env: { DISCORD_TIMELINE_CHANNEL_ID?: string }, options: Parameters<typeof TimelineModule.register>[1], client?: unknown) {
  @Global()
  @Module({ providers: [{ provide: Client, useValue: client }], exports: [Client] })
  class FakeDiscordModule {}
  const moduleRef = await Test.createTestingModule({ imports: [FakeDiscordModule, TimelineModule.register(env, options)] }).compile();
  return moduleRef.get<TimelinePublisher>(TIMELINE_PUBLISHER);
}

describe("TimelineModule (TASK-076, T6)", () => {
  it("sem DISCORD_TIMELINE_CHANNEL_ID fica desligada (no-op), mesmo com bot", async () => {
    const publisher = await resolve({}, { bot: true });
    expect(publisher).toBeInstanceOf(NoopTimelinePublisher);
    expect(() => publisher.publish(entry)).not.toThrow();
  });

  it("sem bot fica desligada mesmo com o canal configurado", async () => {
    expect(await resolve({ DISCORD_TIMELINE_CHANNEL_ID: CHANNEL }, { bot: false })).toBeInstanceOf(NoopTimelinePublisher);
  });

  it("com bot e canal publica no canal configurado pelo cliente do Discord", async () => {
    const sent: string[] = [];
    let settled!: () => void;
    const done = new Promise<void>((r) => (settled = r));
    const client = {
      channels: {
        fetch: async (id: string) => ({
          send: async () => {
            sent.push(id);
            settled();
          },
        }),
      },
    };
    const publisher = await resolve({ DISCORD_TIMELINE_CHANNEL_ID: CHANNEL }, { bot: true }, client);
    publisher.publish(entry);
    await done;
    expect(sent).toEqual([CHANNEL]);
  });

  it("dublê de teste substitui qualquer implementação", async () => {
    const fake = new FakeTimelinePublisher();
    const publisher = await resolve({ DISCORD_TIMELINE_CHANNEL_ID: CHANNEL }, { bot: true, publisher: fake });
    publisher.publish(entry);
    expect(fake.actions()).toEqual(["account.nick_approved"]);
  });

  it("guardTimeline: implementação que lança vira aviso, nunca erro para quem publicou", () => {
    const warnings: string[] = [];
    const broken: TimelinePublisher = { publish: () => { throw new Error("banco fora"); } };
    expect(() => guardTimeline(broken, { warn: (m: string) => void warnings.push(m) }).publish(entry)).not.toThrow();
    expect(warnings).toEqual(["Timeline: publicação falhou e foi ignorada (banco fora)"]);
    expect(() => guardTimeline(broken, { warn: () => { throw new Error("log off"); } }).publish(entry)).not.toThrow();
    expect(() => guardTimeline({ publish: () => { throw "x"; } }, { warn: () => {} }).publish(entry)).not.toThrow();
  });
});
