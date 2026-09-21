import { describe, expect, it } from "vitest";
import {
  callAllowedDiscordIds,
  EVENT_CALL_FINISH_BUTTON,
  EVENT_CALL_LOCK_BUTTON,
  EVENT_CALL_REPLIES,
  EVENT_CALL_UNLOCK_BUTTON,
  eventCallFinishButtonId,
  eventCallLockButtonId,
  eventCallMenuView,
  eventCallUnlockButtonId,
} from "./event-call-menu.js";

const EVENT = { id: "11111111-2222-3333-4444-555555555555", name: "ZvZ das 21h" };

describe("menu de gestão da call (TASK-085, PE9 a PE11)", () => {
  it("tem os três botões do menu, e nenhum de iniciar ou fechar inscrição (PE9)", () => {
    const view = eventCallMenuView(EVENT);
    expect(view.buttons.map((b) => b.customId)).toEqual([eventCallLockButtonId(EVENT.id), eventCallUnlockButtonId(EVENT.id), eventCallFinishButtonId(EVENT.id)]);
    expect(view.buttons.map((b) => b.label)).toEqual(["Fechar a call", "Abrir a call", "Finalizar o evento"]);
    expect(view.title).toContain(EVENT.name);
  });

  it("o id do botão carrega só o evento, e os templates batem com o que o bot registra", () => {
    expect(EVENT_CALL_FINISH_BUTTON).toBe("evento/call/finalizar/:eventId");
    expect(EVENT_CALL_LOCK_BUTTON).toBe("evento/call/fechar/:eventId");
    expect(EVENT_CALL_UNLOCK_BUTTON).toBe("evento/call/abrir/:eventId");
    expect(eventCallFinishButtonId(EVENT.id)).toBe(`evento/call/finalizar/${EVENT.id}`);
  });

  it("libera confirmado e quem está na espera, sem repetir e sem quem não tem Discord (PE10)", () => {
    const allowed = callAllowedDiscordIds([
      { discordId: "1", status: "confirmed" },
      { discordId: "2", status: "waitlist" },
      { discordId: "1", status: "waitlist" },
      { discordId: null, status: "confirmed" },
      { discordId: "", status: "confirmed" },
    ]);
    expect(allowed).toEqual(["1", "2"]);
  });

  it("a recusa por estado diz o motivo de finalizado e de cancelado", () => {
    expect(EVENT_CALL_REPLIES.notRunning("finished")).toContain("finalizado");
    expect(EVENT_CALL_REPLIES.notRunning("cancelled")).toContain("cancelado");
    expect(EVENT_CALL_REPLIES.notRunning("open")).toContain("open");
  });
});
