import { describe, expect, it } from "vitest";
import { eventCallLink, eventSummonDmView, eventSummonMentionText, summonTargets, type SummonCandidate } from "./event-summon.js";

const confirmed = (userId: string, discordId: string | null): SummonCandidate => ({ userId, discordId, status: "confirmed" });
const waitlist = (userId: string, discordId: string): SummonCandidate => ({ userId, discordId, status: "waitlist" });

describe("quem o chamado atinge (TASK-087, PE13)", () => {
  it("chama o confirmado que está fora da call", () => {
    expect(summonTargets([confirmed("u1", "d1"), confirmed("u2", "d2")], ["d2"])).toEqual([{ userId: "u1", discordId: "d1" }]);
  });

  it("a lista de espera nunca é chamada, esteja onde estiver (AC#2)", () => {
    expect(summonTargets([waitlist("u1", "d1"), waitlist("u2", "d2")], [])).toEqual([]);
    expect(summonTargets([confirmed("u1", "d1"), waitlist("u2", "d2")], [])).toEqual([{ userId: "u1", discordId: "d1" }]);
  });

  it("quem já está na call não recebe nada", () => {
    expect(summonTargets([confirmed("u1", "d1")], ["d1"])).toEqual([]);
  });

  it("inscrito sem conta Discord não tem para onde receber e sai da lista", () => {
    expect(summonTargets([confirmed("u1", null), confirmed("u2", "")], [])).toEqual([]);
  });

  it("não repete quem aparece duas vezes, e preserva a ordem da lista", () => {
    const signups = [confirmed("u1", "d1"), confirmed("u2", "d2"), confirmed("u1", "d1")];
    expect(summonTargets(signups, [])).toEqual([
      { userId: "u1", discordId: "d1" },
      { userId: "u2", discordId: "d2" },
    ]);
  });
});

describe("o que o chamado escreve (PE13/PE14)", () => {
  it("o privado diz qual evento e como entrar, com link de um clique", () => {
    const link = eventCallLink("111", "222");
    expect(link).toBe("https://discord.com/channels/111/222");
    const view = eventSummonDmView({ name: "Roads das 21h" }, link);
    expect(view.title).toContain("Roads das 21h");
    expect(view.description).toContain(link);
    // Sem botão: o privado é um toque curto, não um menu de bot.
    expect(view.buttons).toEqual([]);
  });

  it("sem canal conhecido, o privado ainda diz para onde ir", () => {
    const view = eventSummonDmView({ name: "Roads das 21h" }, null);
    expect(view.description).toContain("canal de voz do evento");
    expect(view.description).not.toContain("https://");
  });

  it("a menção da queda cita todo mundo numa frase só, com o nome do evento (PE14)", () => {
    const text = eventSummonMentionText({ name: "ZvZ" }, ["d1", "d2"]);
    expect(text.startsWith("<@d1> <@d2>")).toBe(true);
    expect(text).toContain("ZvZ");
    expect(text).toContain("privado");
  });
});
