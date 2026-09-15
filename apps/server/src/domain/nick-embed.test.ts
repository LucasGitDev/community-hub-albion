import { describe, expect, it } from "vitest";
import {
  approveButtonId,
  buildNickEmbed,
  buildRejectModal,
  isNickRequestId,
  NICK_BUTTON_REPLIES,
  NICK_EMBED_COLORS,
  rejectButtonId,
  rejectModalId,
  type NickEmbedInput,
} from "./nick-embed.js";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const base: NickEmbedInput = {
  requestId: ID,
  requesterDiscordId: "400000000000000001",
  currentNick: "Velho",
  nick: "Novo",
  status: "pending",
  createdAt: new Date("2026-09-15T12:00:00Z"),
  decidedAt: null,
  deciderDiscordId: null,
  decisionNote: null,
};
const field = (view: ReturnType<typeof buildNickEmbed>, name: string) => view.fields.find((f) => f.name === name)?.value;

describe("nick embed (TASK-015)", () => {
  it("customIds carregam o uuid do pedido e só uuid é aceito", () => {
    expect(approveButtonId(ID)).toBe(`nick/approve/${ID}`);
    expect(rejectButtonId(ID)).toBe(`nick/reject/${ID}`);
    expect(rejectModalId(ID)).toBe(`nick/reject-modal/${ID}`);
    expect(isNickRequestId(ID)).toBe(true);
    for (const bad of ["x", `${ID}'`, undefined, 1]) expect(isNickRequestId(bad)).toBe(false);
  });

  it("pendente: título, membro, nick atual → pedido, data, status e botões (AC#1)", () => {
    const view = buildNickEmbed(base);
    expect(view.title).toBe("Novo pedido de nick");
    expect(view.color).toBe(NICK_EMBED_COLORS.pending);
    expect(field(view, "Membro")).toBe("<@400000000000000001>");
    expect(field(view, "Nick")).toBe("Velho → Novo");
    expect(field(view, "Pedido em")).toBe(`<t:${Date.parse("2026-09-15T12:00:00Z") / 1000}:f>`);
    expect(field(view, "Status")).toBe("Aguardando staff");
    expect(view.buttons).toEqual([
      { customId: `nick/approve/${ID}`, label: "Aprovar nick", style: "success" },
      { customId: `nick/reject/${ID}`, label: "Recusar", style: "danger" },
    ]);
    expect(field(buildNickEmbed({ ...base, currentNick: null }), "Nick")).toBe("Primeiro nick: Novo");
  });

  it("aprovado: cor, quem aprovou e quando, sem botões (AC#4)", () => {
    const view = buildNickEmbed({ ...base, status: "approved", decidedAt: new Date(1_000_000), deciderDiscordId: "500000000000000001" });
    expect(view.title).toBe("Pedido de nick aprovado");
    expect(view.color).toBe(NICK_EMBED_COLORS.approved);
    expect(field(view, "Nick pedido")).toBe("Novo");
    expect(field(view, "Status")).toBe("Aprovado por <@500000000000000001> em <t:1000:f>");
    expect(view.buttons).toEqual([]);
  });

  it("recusado: quem recusou e motivo, sem botões (AC#4)", () => {
    const view = buildNickEmbed({ ...base, status: "rejected", decidedAt: null, deciderDiscordId: null, decisionNote: " Não existe " });
    expect(view.color).toBe(NICK_EMBED_COLORS.rejected);
    expect(field(view, "Status")).toBe("Recusado por staff");
    expect(field(view, "Motivo")).toBe("Não existe");
    expect(view.buttons).toEqual([]);
    expect(field(buildNickEmbed({ ...base, status: "rejected", decisionNote: null }), "Motivo")).toBe("Sem motivo registrado.");
  });

  it("extensão TASK-016: resultado da busca no Albion aparece quando informado", () => {
    expect(field(buildNickEmbed({ ...base, lookup: { summary: "Encontrado" } }), "API do Albion")).toBe("Encontrado");
    expect(field(buildNickEmbed(base), "API do Albion")).toBeUndefined();
  });

  it("modal de recusa exige motivo de 1 a 300 e título cabe no limite do Discord", () => {
    const modal = buildRejectModal(ID, "Novo");
    expect(modal).toMatchObject({ customId: `nick/reject-modal/${ID}`, title: "Recusar nick Novo", field: { customId: "note", minLength: 1, maxLength: 300 } });
    expect(buildRejectModal(ID, null).title).toBe("Recusar nick");
    expect(buildRejectModal(ID, "x".repeat(60)).title.length).toBeLessThanOrEqual(45);
  });

  it("respostas PT-BR", () => {
    expect(NICK_BUTTON_REPLIES.approved("Novo")).toBe("Nick Novo aprovado.");
    expect(NICK_BUTTON_REPLIES.rejected("Novo")).toContain("recusado");
  });
});
