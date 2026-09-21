import { describe, expect, it } from "vitest";
import { eventSummonSummary, EVENT_SUMMON_COOLDOWN_MS } from "./event-summon.js";

describe("frase do chamado de quem não entrou na call (TASK-087)", () => {
  it("o intervalo é de 5 minutos (PE15)", () => {
    expect(EVENT_SUMMON_COOLDOWN_MS).toBe(300_000);
  });

  it("sem ninguém fora da call, diz isso em vez de 'chamei 0 pessoas'", () => {
    expect(eventSummonSummary({ notified: 0, mentioned: 0, skipped: 0, targets: 0 })).toBe("Todo mundo que está confirmado já está na call. Ninguém foi chamado.");
  });

  it("todo mundo dentro do intervalo: explica por que ninguém recebeu nada", () => {
    expect(eventSummonSummary({ notified: 0, mentioned: 0, skipped: 2, targets: 2 })).toBe("Ninguém foi chamado agora: 2 pessoas foram avisadas há menos de 5 minutos.");
    expect(eventSummonSummary({ notified: 0, mentioned: 0, skipped: 1, targets: 1 })).toBe("Ninguém foi chamado agora: 1 pessoa foi avisada há menos de 5 minutos.");
  });

  it("conta privados, menções e pulados, no singular e no plural", () => {
    expect(eventSummonSummary({ notified: 1, mentioned: 0, skipped: 0, targets: 1 })).toBe("Chamei 1 pessoa no privado.");
    expect(eventSummonSummary({ notified: 3, mentioned: 0, skipped: 0, targets: 3 })).toBe("Chamei 3 pessoas no privado.");
    expect(eventSummonSummary({ notified: 2, mentioned: 1, skipped: 0, targets: 3 })).toBe(
      "Chamei 2 pessoas no privado. 1 está com o privado fechado e foi mencionada no chat da call.",
    );
    expect(eventSummonSummary({ notified: 2, mentioned: 2, skipped: 4, targets: 8 })).toBe(
      "Chamei 2 pessoas no privado. 2 estão com o privado fechado e foram mencionadas no chat da call. 4 pessoas já tinham sido chamadas há menos de 5 minutos.",
    );
  });
});
