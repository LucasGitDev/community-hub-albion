import { describe, expect, it } from "vitest";
import { defineAbilityFor, type EventDto, type LootSplitDto, type SplitPresenceDto } from "@albion-hub/shared";
import {
  canSettle,
  confirmBlockedReason,
  draftSplit,
  feePreviewText,
  rowsFromPresence,
  rowsFromSplit,
  settlementTotals,
  shareSum,
  shareSumText,
  toSettle,
  withAmounts,
  type SettlementRow,
} from "./settlement";

/** Regras da tela de acerto (TASK-029). O que importa é a conta fechar e a frase dizer a verdade. */

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const event = (over: Partial<EventDto> = {}): EventDto =>
  ({ id: "e1", ownerUserId: OWNER, status: "finished", fee: { type: "percent", value: "1000" }, ...over }) as EventDto;

const presence = (over: Partial<SplitPresenceDto> = {}): SplitPresenceDto => ({
  discordUserId: "9001",
  userId: "u1",
  nick: "Thalya",
  signedUp: true,
  roleName: "Tank",
  presenceMs: 60_000,
  ...over,
});

const row = (over: Partial<SettlementRow> = {}): SettlementRow => ({
  key: "9001",
  lineId: "l1",
  nick: "Thalya",
  hasAccount: true,
  signedUp: true,
  roleName: "Tank",
  presenceMs: 60_000,
  shareBp: 10_000,
  amount: 0n,
  ...over,
});

describe("tabela do acerto", () => {
  it("abre com a presença medida, sem rascunho e sem tela vazia", () => {
    const rows = rowsFromPresence([presence(), presence({ discordUserId: "9002", nick: null, userId: null, signedUp: false, presenceMs: 1_000 })]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ nick: "Thalya", shareBp: 0, amount: 0n, lineId: null, hasAccount: true });
    // Presente sem conta no painel aparece assim mesmo: o caller precisa ver que a pessoa esteve lá (Q7).
    expect(rows[1]).toMatchObject({ nick: "Discord 9002", hasAccount: false, signedUp: false, presenceMs: 1_000 });
  });

  it("com rascunho, usa o percentual e a prata que o servidor gravou", () => {
    const split = {
      lines: [{ id: "l1", discordUserId: "9001", userId: "u1", nick: "Thalya", signedUp: true, roleName: "Tank", presenceMs: 60_000, shareBp: 6000, amount: "600" }],
    } as LootSplitDto;
    expect(rowsFromSplit(split)[0]).toMatchObject({ lineId: "l1", shareBp: 6000, amount: 600n });
  });
});

describe("soma dos percentuais (Q22, AC#5)", () => {
  it("diz quanto falta, quanto passou, ou só 100%", () => {
    expect(shareSumText(shareSum([row({ shareBp: 10_000 })]))).toBe("100%");
    expect(shareSumText(shareSum([row({ shareBp: 9700 })]))).toBe("faltam 3%");
    expect(shareSumText(shareSum([row({ shareBp: 10_050 })]))).toBe("passou 0,5%");
    expect(shareSum([row({ shareBp: 5000 }), row({ key: "2", shareBp: 5000 })])).toEqual({ sumBp: 10_000, missingBp: 0, ok: true });
  });
});

describe("o dinheiro fecha de cima a baixo", () => {
  it("bruto = taxa + dividido, e dividido = pago + sobra (Q23)", () => {
    const rows = [row({ shareBp: 3333 }), row({ key: "2", shareBp: 3333 }), row({ key: "3", shareBp: 3334 })];
    const totals = settlementTotals(10_000_000n, { type: "percent", value: 1000n }, rows);
    expect(totals.feeSilver).toBe(1_000_000n);
    expect(totals.distributable).toBe(9_000_000n);
    expect(totals.feeSilver + totals.distributable).toBe(totals.total);
    expect(totals.paid + totals.residual).toBe(totals.distributable);
    expect(totals.ownerSilver).toBe(totals.feeSilver + totals.residual);
  });

  it("taxa fixa maior que o total zera o distribuível em vez de virar prata negativa", () => {
    const totals = settlementTotals(1_000_000n, { type: "fixed", value: 2_000_000n }, [row()]);
    expect(totals.exceedsTotal).toBe(true);
    expect(totals.distributable).toBe(0n);
    expect(totals.paid).toBe(0n);
  });

  it("a prata de cada linha sai do percentual, igual ao que o servidor vai creditar", () => {
    const rows = withAmounts([row({ shareBp: 2500 }), row({ key: "2", shareBp: 7500 })], 9_000_000n);
    expect(rows.map((r) => r.amount)).toEqual([2_250_000n, 6_750_000n]);
  });
});

describe("frase da taxa em tempo real (AC#3)", () => {
  it("diz quanto retém, para quem, e quanto sobra", () => {
    expect(feePreviewText(10_000_000n, { type: "percent", value: 1000n }, "Thalya")).toBe(
      "De 10.000.000, retém 1.000.000 (10%) para Thalya; sobram 9.000.000 para dividir.",
    );
  });

  it("sem taxa e sem total, explica o que falta em vez de mostrar zero", () => {
    expect(feePreviewText(10_000_000n, { type: "percent", value: 0n }, "Thalya")).toContain("Sem taxa");
    expect(feePreviewText(0n, { type: "fixed", value: 500_000n }, "Thalya")).toContain("Informe o total da leva");
  });

  it("taxa maior que o total usa exatamente a frase que a API devolveria (AC#8)", () => {
    expect(feePreviewText(1_000_000n, { type: "fixed", value: 2_000_000n }, "Thalya")).toBe(
      "A taxa do evento é maior que o total deste split: não sobra prata para dividir. Baixe a taxa ou aumente o total.",
    );
  });
});

describe("confirmar só quando pode (AC#5, AC#8)", () => {
  const fee = { type: "percent" as const, value: 1000n };

  it("libera com 100% e taxa que cabe", () => {
    expect(confirmBlockedReason(10_000_000n, fee, [row({ shareBp: 10_000 })])).toBeNull();
  });

  it("barra soma diferente de 100% dizendo o quanto falta", () => {
    expect(confirmBlockedReason(10_000_000n, fee, [row({ shareBp: 9700 })])).toBe("A soma das participações precisa fechar 100%: faltam 3%.");
  });

  it("barra taxa maior que o total antes de chamar a API, com a frase da API", () => {
    expect(confirmBlockedReason(1_000_000n, { type: "fixed", value: 2_000_000n }, [row({ shareBp: 10_000 })])).toContain("Baixe a taxa ou aumente o total");
  });

  it("barra participação de quem não estava inscrito e de quem não tem conta no painel", () => {
    expect(confirmBlockedReason(10n, fee, [row({ shareBp: 10_000, signedUp: false })])).toContain("Só quem estava inscrito pode receber");
    expect(confirmBlockedReason(10n, fee, [row({ shareBp: 10_000, hasAccount: false })])).toContain("ainda não tem conta no painel");
  });
});

describe("quem vê o acerto (AC#12)", () => {
  it("dono do evento e staff acertam; membro e caller de outro evento não", () => {
    const owner = defineAbilityFor({ id: OWNER, roles: ["caller"] });
    const stranger = defineAbilityFor({ id: OTHER, roles: ["caller"] });
    const member = defineAbilityFor({ id: OTHER, roles: ["member"] });
    const staff = defineAbilityFor({ id: OTHER, roles: ["staff"] });
    expect(canSettle(event(), owner)).toBe(true);
    expect(canSettle(event(), staff)).toBe(true);
    expect(canSettle(event(), stranger)).toBe(false);
    expect(canSettle(event(), member)).toBe(false);
  });

  it("a fila 'a acertar' traz só o finalizado que quem olha conduz", () => {
    const owner = defineAbilityFor({ id: OWNER, roles: ["caller"] });
    const list = [event(), event({ id: "e2", status: "archived" }), event({ id: "e3", status: "running" }), event({ id: "e4", ownerUserId: OTHER })];
    expect(toSettle(list, owner).map((e) => e.id)).toEqual(["e1"]);
  });
});

describe("rascunho pendente (AC#10)", () => {
  it("acha o rascunho aberto e ignora os confirmados", () => {
    const splits = [{ id: "s1", status: "confirmed" }, { id: "s2", status: "draft" }] as LootSplitDto[];
    expect(draftSplit(splits)?.id).toBe("s2");
    expect(draftSplit([{ id: "s1", status: "confirmed" }] as LootSplitDto[])).toBeNull();
  });
});
