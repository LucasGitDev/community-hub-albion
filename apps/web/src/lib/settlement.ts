import {
  asSubject,
  checkSplitConfirm,
  distributeByShare,
  feeBreakdown,
  feeFromDto,
  formatEventFee,
  formatAmount,
  hasFee,
  splitConfirmRefusalMessage,
  presenceBpSum,
  sharesFromPresence,
  type AppAbility,
  type EventDto,
  type EventFee,
  type LootSplitDto,
  type SplitPresenceDto,
} from "@albion-hub/shared";

/**
 * Regras da tela de acerto do evento finalizado (TASK-029). Tudo aqui é função pura: a tela desenha o
 * resultado e o teste cobre a regra sem navegador.
 *
 * As contas de prata **não** são reescritas aqui. `feeBreakdown`, `distributeByShare` e
 * `checkSplitConfirm` são as mesmas funções que o servidor usa para gravar no ledger — é isso que faz
 * o número conferido na tela ser o número creditado, inclusive nos arredondamentos. A tela só traduz.
 */

/** Uma linha da tabela do acerto, venha ela de um rascunho ou só da presença medida. */
export interface SettlementRow {
  /** `discordUserId`: existe com ou sem conta no painel, com ou sem rascunho. */
  key: string;
  /** Id da linha do split; null quando ainda não há rascunho e a tabela é só prévia. */
  lineId: string | null;
  nick: string;
  /** Sem conta no painel: aparece, mas não pode receber (a confirmação recusa). */
  hasAccount: boolean;
  signedUp: boolean;
  roleName: string | null;
  presenceMs: number;
  /** Presença que vale: o que o caller editou, ou a medição (PE3). É o que ele edita nesta tela. */
  presenceBp: number;
  /** A medição crua da call. `null` quando a leva já foi confirmada e só guarda o que usou. */
  measuredPresenceBp: number | null;
  /** Participação derivada da presença (PE2). Ninguém digita isto: a tela **lê**. */
  shareBp: number;
  amount: bigint;
}

const nickOf = (nick: string | null, discordUserId: string): string => nick ?? `Discord ${discordUserId.slice(-4)}`;

/**
 * Tabela antes de existir rascunho: quem esteve na call, com o tempo de cada um e 0%.
 *
 * Não é uma tela vazia esperando o total — a presença existe desde o finish, e é justamente o que o
 * caller precisa conferir antes de digitar quanto o loot rendeu.
 */
export const rowsFromPresence = (present: readonly SplitPresenceDto[]): SettlementRow[] =>
  present.map((p) => ({
    key: p.discordUserId,
    lineId: null,
    nick: nickOf(p.nick, p.discordUserId),
    hasAccount: p.userId !== null,
    signedUp: p.signedUp,
    roleName: p.roleName,
    presenceMs: p.presenceMs,
    presenceBp: p.presenceBp,
    measuredPresenceBp: p.measuredPresenceBp,
    shareBp: 0,
    amount: 0n,
  }));

export const rowsFromSplit = (split: LootSplitDto, measured?: ReadonlyMap<string, number>): SettlementRow[] =>
  split.lines.map((line) => ({
    key: line.discordUserId,
    lineId: line.id,
    nick: nickOf(line.nick, line.discordUserId),
    hasAccount: line.userId !== null,
    signedUp: line.signedUp,
    roleName: line.roleName,
    presenceMs: line.presenceMs,
    presenceBp: line.presenceBp,
    measuredPresenceBp: measured?.get(line.discordUserId) ?? null,
    shareBp: line.shareBp,
    amount: BigInt(line.amount),
  }));

/**
 * O denominador da divisão (PE2): a soma das presenças e quanta gente entra nela.
 *
 * Ela **não** precisa fechar 100% — é a regra que a TASK-084 tirou do caminho do caller. O que a tela
 * mostra é o divisor, porque é ele que explica por que 100% de presença virou 40% da prata. Soma zero
 * é o único estado que trava a confirmação (AC#7).
 */
export interface PresenceSum {
  sumBp: number;
  /** Quantas pessoas têm presença acima de zero: é entre elas que a prata é dividida. */
  people: number;
  /** Alguém com presença? Zero não divide (AC#7). */
  ok: boolean;
}

export function presenceSum(rows: readonly SettlementRow[]): PresenceSum {
  const sumBp = presenceBpSum(rows);
  return { sumBp, people: rows.filter((r) => r.presenceBp > 0).length, ok: sumBp > 0 };
}

/** "300% entre 3 pessoas" — o divisor da conta, em uma frase. */
export function presenceSumText(sum: PresenceSum): string {
  if (!sum.ok) return "ninguém com presença: a prata não tem como ser dividida";
  return `de presença somada, entre ${sum.people === 1 ? "1 pessoa" : `${sum.people} pessoas`}`;
}

/** Participação derivada da presença (PE2), sem esperar a resposta do servidor. */
export function withShares(rows: readonly SettlementRow[]): SettlementRow[] {
  const shares = sharesFromPresence(rows.map((r) => ({ key: r.key, presenceBp: r.presenceBp })));
  return rows.map((row, i) => ({ ...row, shareBp: shares[i]! }));
}

/** Como o dinheiro fecha de cima a baixo: bruto → taxa → dividido → sobra → dono. */
export interface SettlementTotals {
  total: bigint;
  feeSilver: bigint;
  distributable: bigint;
  /** Soma do que as linhas recebem com os percentuais de agora. */
  paid: bigint;
  /** Sobra do arredondamento: vai para o dono junto com a taxa (Q23). */
  residual: bigint;
  ownerSilver: bigint;
  /** Taxa maior que o total: não sobra nada para dividir (AC#8). */
  exceedsTotal: boolean;
}

export function settlementTotals(total: bigint, fee: EventFee, rows: readonly SettlementRow[]): SettlementTotals {
  const breakdown = feeBreakdown(total, fee);
  const { amounts, residual } = distributeByShare(
    rows.map((r) => r.shareBp),
    breakdown.distributable,
  );
  const paid = amounts.reduce((sum, a) => sum + a, 0n);
  return {
    total,
    feeSilver: breakdown.feeSilver,
    distributable: breakdown.distributable,
    paid,
    residual,
    ownerSilver: breakdown.feeSilver + residual,
    exceedsTotal: breakdown.exceedsTotal,
  };
}

/** Prata de cada linha com os percentuais de agora, sem esperar a resposta do servidor. */
export function withAmounts(rows: readonly SettlementRow[], distributable: bigint): SettlementRow[] {
  const { amounts } = distributeByShare(
    rows.map((r) => r.shareBp),
    distributable,
  );
  return rows.map((row, i) => ({ ...row, amount: amounts[i]! }));
}

/**
 * A frase da taxa que não cabe no total, uma só (AC#8). É a mesma que a API devolve ao confirmar,
 * usada aqui antes de gastar uma requisição — quem lê na tela e quem leria no 409 ouve uma história só.
 */
const FEE_EXCEEDS_TOTAL = splitConfirmRefusalMessage("fee_exceeds_total");

/**
 * A frase do bloco da taxa, em tempo real (AC#3). Diz os três números que decidem a taxa — quanto
 * retém, para quem vai e quanto sobra — numa frase só, porque é assim que o caller pensa a conta.
 */
export function feePreviewText(total: bigint, fee: EventFee, ownerNick: string): string {
  if (!hasFee(fee)) return "Sem taxa: o total inteiro vai para a divisão.";
  if (total <= 0n) return `Taxa de ${formatEventFee(fee)} para ${ownerNick}, retirada antes da divisão. Informe o total da leva para ver quanto é.`;
  const breakdown = feeBreakdown(total, fee);
  if (breakdown.exceedsTotal) return FEE_EXCEEDS_TOTAL;
  return `De ${formatAmount(total, "silver")}, retém ${formatAmount(breakdown.feeSilver, "silver")} (${formatEventFee(fee)}) para ${ownerNick}; sobram ${formatAmount(breakdown.distributable, "silver")} para dividir.`;
}

/**
 * Por que o botão de confirmar está desligado, ou `null` quando ele pode ir.
 *
 * Roda a **mesma** `checkSplitConfirm` do servidor e devolve a **mesma** frase: a tela recusa antes
 * de gastar uma requisição (AC#8), e quem passar por ela mesmo assim lê exatamente o que a API diria.
 */
export function confirmBlockedReason(total: bigint, fee: EventFee, rows: readonly SettlementRow[]): string | null {
  const result = checkSplitConfirm(
    rows.map((r) => ({ key: r.key, presenceBp: r.presenceBp, userId: r.hasAccount ? r.key : null })),
    total,
    fee,
  );
  return result.ok ? null : splitConfirmRefusalMessage(result.reason);
}

/**
 * Quem acerta o evento: `distribute` em `Event`, com a condição de dono (owner do evento ou staff).
 *
 * **Nunca** `read` em `Event`: `read` é de todo membro logado, e o acerto mostra quanto cada pessoa
 * ganhou — foi assim que a TASK-027 fechou o vazamento de ganhos entre eventos. A API refaz a mesma
 * checagem; aqui é só para não desenhar uma aba que levaria 403.
 */
export const canSettle = (event: EventDto, ability: AppAbility): boolean => ability.can("distribute", asSubject("Event", { ownerId: event.ownerUserId }));

/** O acerto acontece no `finished` (Q26); `archived` é o mesmo painel, só leitura. */
export const isSettlementOpen = (event: EventDto): boolean => event.status === "finished";
export const showsSettlement = (event: EventDto): boolean => event.status === "finished" || event.status === "archived";

/** Eventos que ainda esperam alguém fechar a conta: é a fila do topo da lista (AC#1). */
export const toSettle = (events: readonly EventDto[], ability: AppAbility): EventDto[] => events.filter((e) => isSettlementOpen(e) && canSettle(e, ability));

/** Rascunho aberto: enquanto existir, arquivar é recusado pela API (AC#10). */
export const draftSplit = (splits: readonly LootSplitDto[]): LootSplitDto | null => splits.find((s) => s.status === "draft") ?? null;

/** Taxa do evento como `EventFee`, pronta para as contas. */
export const eventFee = (event: EventDto): EventFee => feeFromDto(event.fee);
