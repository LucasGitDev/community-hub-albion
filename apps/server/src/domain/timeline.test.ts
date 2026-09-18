import { describe, expect, it } from "vitest";
import { DISCORD_EMBED_LIMITS, describeActor, embedSize, escapeMarkdown, renderTimelineEmbed, shortId, type TimelineEntry } from "./timeline.js";

const AT = new Date("2026-09-18T12:34:56.000Z");
const ORDER = "3f2a9c1e-7b44-4d2a-9e1f-0a1b2c3d4e5f";

const base: TimelineEntry = {
  action: "economy.withdrawal_approved",
  summary: "Saque aprovado",
  actor: { kind: "user", userId: "u-staff", name: "Tesoureiro", discordId: "123456789012345678" },
  target: { name: "Jogador_1", id: "9d8c7b6a-0000-4000-8000-000000000000", discordId: "223456789012345678" },
  amounts: [
    { value: 1_482_300n, currency: "silver" },
    { value: 340n, currency: "buffunfa", label: "Taxa" },
  ],
  recordId: ORDER,
  at: AT,
};

describe("renderTimelineEmbed (TASK-076, T2/T10)", () => {
  it("leva ator, alvo, valores na moeda certa, ID curto e hora", () => {
    const embed = renderTimelineEmbed(base);
    const field = (name: string) => embed.fields.find((f) => f.name === name)?.value;
    expect(embed.title).toBe("Saque aprovado");
    expect(field("Ator")).toBe("Tesoureiro (<@123456789012345678>)");
    expect(field("Alvo")).toBe("Jogador\\_1 (<@223456789012345678>)\n`9d8c7b6a`");
    expect(field("ID")).toBe("`3f2a9c1e`");
    // Prata por inteiro (T2, canal só de admins); Buffunfa com sufixo e nunca abreviada.
    expect(field("Prata")).toBe("1.482.300");
    expect(field("Taxa")).toBe("340 BUF");
    expect(embed.footer).toBe(`economy.withdrawal_approved · ${ORDER}`);
    expect(embed.timestamp).toBe("2026-09-18T12:34:56.000Z");
    expect(embed.color).toBe(0xf1c40f);
  });

  it("sem hora explícita usa o momento da publicação; sem alvo, ID nem valor, só o ator", () => {
    const now = new Date("2026-09-18T00:00:00.000Z");
    const embed = renderTimelineEmbed({ action: "account.cleanup_ran", summary: "Limpeza diária", actor: { kind: "system", name: "limpeza diária" } }, now);
    expect(embed.fields).toEqual([{ name: "Ator", value: "Sistema: limpeza diária", inline: true }]);
    expect(embed.footer).toBe("account.cleanup_ran");
    expect(embed.timestamp).toBe(now.toISOString());
    expect(embed.description).toBeUndefined();
  });

  it("ator manutenção aparece como tal (T9), com o motivo nos detalhes e Buffunfa sem rótulo", () => {
    const embed = renderTimelineEmbed({
      action: "maintenance.buffunfa_adjusted",
      summary: "Ajuste de Buffunfa",
      actor: { kind: "maintenance" },
      amounts: [{ value: -340n, currency: "buffunfa" }],
      details: [{ name: "Motivo", value: "taxa cobrada em dobro" }, { name: "Vazio", value: "" }],
    });
    expect(embed.fields[0].value).toBe("Manutenção (/api/maintenance)");
    expect(embed.fields).toContainEqual({ name: "Buffunfa", value: "-340 BUF", inline: true });
    expect(embed.fields).toContainEqual({ name: "Motivo", value: "taxa cobrada em dobro", inline: false });
    expect(embed.fields).toContainEqual({ name: "Vazio", value: "—", inline: false });
    expect(embed.color).toBe(0xed4245);
  });

  it("lista de inscritos (T8) vai na descrição, e lista vazia diz que está vazia", () => {
    const embed = renderTimelineEmbed({ ...base, action: "event.signups_closed", list: { title: "Inscritos", items: ["Tank · 1", "Healer · 2"] } });
    expect(embed.description).toBe("**Inscritos** (2)\n• Tank · 1\n• Healer · 2");
    expect(renderTimelineEmbed({ ...base, list: { title: "Inscritos", items: [] } }).description).toBe("**Inscritos** (0)\n(vazia)");
  });

  it("lista enorme é cortada com '… e mais N' e o embed cabe no limite do Discord", () => {
    const items = Array.from({ length: 500 }, (_, i) => `Jogador${i} · DPS · posição ${i + 1}`);
    const embed = renderTimelineEmbed({ ...base, list: { title: "Inscritos", items } });
    expect(embed.description).toMatch(/… e mais \d+$/);
    expect(embedSize(embed)).toBeLessThanOrEqual(DISCORD_EMBED_LIMITS.total);
  });

  it("nada de usuário estoura o embed: textos longos são cortados e campos sobrando caem", () => {
    const long = "x".repeat(5000);
    const embed = renderTimelineEmbed({
      ...base,
      summary: long,
      details: Array.from({ length: 30 }, (_, i) => ({ name: `${i}${long}`, value: long })),
      list: { title: long, items: [long, long] },
    });
    expect(embed.title.length).toBeLessThanOrEqual(DISCORD_EMBED_LIMITS.title);
    expect(embed.fields.length).toBeLessThanOrEqual(DISCORD_EMBED_LIMITS.fields);
    for (const f of embed.fields) {
      expect(f.name.length).toBeLessThanOrEqual(DISCORD_EMBED_LIMITS.fieldName);
      expect(f.value.length).toBeLessThanOrEqual(DISCORD_EMBED_LIMITS.fieldValue);
    }
    expect(embedSize(embed)).toBeLessThanOrEqual(DISCORD_EMBED_LIMITS.total);
    expect(embed.fields[0].name).toBe("Ator");
  });

  it("nome de usuário não vira formatação, nem menção falsa, nem quebra o bloco do ID", () => {
    expect(escapeMarkdown("**ban** `x` @everyone")).toBe("\\*\\*ban\\*\\* \\`x\\` @everyone");
    expect(describeActor({ kind: "user", userId: "u", name: "Fulano", discordId: "not-a-snowflake" })).toBe("Fulano");
    expect(renderTimelineEmbed({ ...base, recordId: "ab`c" }).fields.find((f) => f.name === "ID")?.value).toBe("`abc`");
  });

  it("ID curto: 8 caracteres de um UUID, ID curto fica como está", () => {
    expect(shortId(ORDER)).toBe("3f2a9c1e");
    expect(shortId("42")).toBe("42");
  });
});
