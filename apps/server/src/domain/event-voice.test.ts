import { describe, expect, it } from "vitest";
import { EVENT_COMMAND_REPLIES, eventVoiceChannelName, membersToMove, resolveEventForCommand, VOICE_CHANNEL_NAME_MAX } from "./event-voice.js";

describe("eventVoiceChannelName", () => {
  it("mantém o nome do evento quando ele já serve", () => {
    expect(eventVoiceChannelName("ZvZ das 21h")).toBe("ZvZ das 21h");
    expect(eventVoiceChannelName("Roads — grupo 2 ⚔️")).toBe("Roads — grupo 2 ⚔️");
  });

  it("normaliza espaço, quebra de linha e caracteres de controle", () => {
    expect(eventVoiceChannelName("  ZvZ \n  das   21h \t")).toBe("ZvZ das 21h");
  });

  it("corta no limite do Discord sem deixar o canal sem nome", () => {
    const long = eventVoiceChannelName("A".repeat(150));
    expect(long).toHaveLength(VOICE_CHANNEL_NAME_MAX);
    expect(long.endsWith("…")).toBe(true);
    expect(eventVoiceChannelName("   ")).toBe("Evento");
    expect(eventVoiceChannelName("\n\t")).toBe("Evento");
  });
});

describe("membersToMove (Q29)", () => {
  const signups = [
    { discordId: "1", status: "confirmed" as const },
    { discordId: "2", status: "confirmed" as const },
    { discordId: "3", status: "waitlist" as const },
  ];

  it("move só confirmado que está no Aguardando Evento", () => {
    expect(membersToMove(signups, ["1", "2"])).toEqual(["1", "2"]);
  });

  it("ignora lista de espera mesmo estando presente", () => {
    expect(membersToMove(signups, ["1", "3"])).toEqual(["1"]);
  });

  it("ignora confirmado ausente: ninguém é puxado de outro canal", () => {
    expect(membersToMove(signups, [])).toEqual([]);
    expect(membersToMove(signups, ["9"])).toEqual([]);
  });

  it("ignora quem está presente sem estar inscrito e não repete ninguém", () => {
    expect(membersToMove(signups, ["1", "1", "99"])).toEqual(["1"]);
  });
});

describe("resolveEventForCommand", () => {
  const a = { id: "11111111-1111-4111-8111-111111111111", name: "ZvZ das 21h" };
  const b = { id: "22222222-2222-4222-8222-222222222222", name: "ZvZ das 23h" };

  it("sem busca resolve quando há um candidato só", () => {
    expect(resolveEventForCommand([a], undefined)).toEqual({ kind: "found", event: a });
    expect(resolveEventForCommand([], "")).toEqual({ kind: "none" });
    expect(resolveEventForCommand([a, b], null)).toEqual({ kind: "ambiguous", candidates: [a, b] });
  });

  it("id exato ganha de nome e id desconhecido não vira busca por texto", () => {
    expect(resolveEventForCommand([a, b], b.id.toUpperCase())).toEqual({ kind: "found", event: b });
    expect(resolveEventForCommand([a, b], "33333333-3333-4333-8333-333333333333")).toEqual({ kind: "none" });
  });

  it("nome exato ganha do parcial; parcial ambíguo lista os candidatos", () => {
    expect(resolveEventForCommand([a, b], "zvz das 21h")).toEqual({ kind: "found", event: a });
    expect(resolveEventForCommand([a, b], "ZvZ")).toEqual({ kind: "ambiguous", candidates: [a, b] });
    expect(resolveEventForCommand([a, b], "roads")).toEqual({ kind: "none" });
  });

  it("a resposta de ambiguidade mostra o id para desempatar", () => {
    const message = EVENT_COMMAND_REPLIES.ambiguous([a, b]);
    expect(message).toContain(a.id);
    expect(message).toContain(b.name);
  });
});
