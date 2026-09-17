import { z } from "zod";
import { formatAmount } from "./currency.js";

/**
 * Loot split (TASK-027, Q5/Q6/Q7/Q22/Q23) e a taxa do evento.
 *
 * O rateio em si (quanto cada pessoa presente no canal do evento ganhou de participação) é da
 * TASK-027; a TASK-028 acrescentou a aplicação da taxa antes da divisão, a conferência da
 * confirmação (Q22) e a edição do rascunho. Quem escreve no ledger é o servidor, não este módulo:
 * aqui tudo é cálculo puro e schema.
 */

/* ------------------------------------------------------------------ taxa */

/**
 * Taxa do evento (decisão do usuário, doc-005): percentual **ou** valor fixo, **sem teto**, com o
 * default vindo do template (`event_templates.default_fee_*`) e copiado para o evento na criação.
 * Fica editável enquanto o evento não for arquivado (Q26: `finished` ainda acerta taxa e splits).
 */
export const EVENT_FEE_TYPES = ["percent", "fixed"] as const;
export type EventFeeType = (typeof EVENT_FEE_TYPES)[number];

/** 100% = 10000 basis points. Percentual em inteiro: dinheiro nunca passa por float (Q20). */
export const FEE_PERCENT_SCALE = 10_000n;

export interface EventFee {
  type: EventFeeType;
  /**
   * `percent`: basis points (1250 = 12,5%). `fixed`: prata inteira.
   * Nunca negativo. Sem teto por decisão do usuário — quem confere se a taxa cabe no total do
   * split é `checkSplitConfirm`, na hora de confirmar.
   */
  value: bigint;
}

/** Ausência de taxa. É o default de template e evento enquanto ninguém configurar nada. */
export const NO_FEE: EventFee = { type: "percent", value: 0n };

export const hasFee = (fee: EventFee): boolean => fee.value > 0n;

/** "12,5%" ou "1.000.000 de prata". Mesma frase no bot e no painel. */
export function formatEventFee(fee: EventFee): string {
  if (fee.type === "fixed") return `${formatAmount(fee.value, "silver")} de prata`;
  const percent = Number(fee.value) / Number(FEE_PERCENT_SCALE / 100n);
  return `${percent.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

/**
 * Prata vinda do JSON: aceita número inteiro ou string ("1500000"), devolve `bigint` (Q20).
 * String é o caminho recomendado da API — acima de 2^53 o JSON de `number` já perdeu prata.
 */
export const silverAmountSchema = (label: string) =>
  z
    .union([z.string(), z.number(), z.bigint()], { error: `${label} precisa ser um número inteiro de prata.` })
    .transform((v, ctx) => {
      const raw = typeof v === "string" ? v.trim().replace(/[.\s]/g, "") : String(v);
      if (!/^\d+$/.test(raw)) {
        ctx.addIssue({ code: "custom", message: `${label} precisa ser um número inteiro de prata, sem sinal nem centavos.` });
        return z.NEVER;
      }
      return BigInt(raw);
    });

export const eventFeeSchema = z.object({
  type: z.enum(EVENT_FEE_TYPES, { error: "A taxa é percentual (percent) ou valor fixo (fixed)." }),
  /** Em `percent` são basis points (1250 = 12,5%); em `fixed`, prata inteira. Sem teto (decisão do usuário). */
  value: silverAmountSchema("O valor da taxa"),
});
export type EventFeeInput = z.output<typeof eventFeeSchema>;

/** Taxa serializada (bigint não existe em JSON). */
export interface EventFeeDto {
  type: EventFeeType;
  value: string;
}

export const feeToDto = (fee: EventFee): EventFeeDto => ({ type: fee.type, value: fee.value.toString() });
export const feeFromDto = (dto: EventFeeDto): EventFee => ({ type: dto.type, value: BigInt(dto.value) });

/* --------------------------------------------------------------- rascunho */

/**
 * Estados do split. Esta task só grava `draft`; `confirmed` é a TASK-028 (Q22 bloqueia confirmar com
 * soma ≠ 100%). Os dois já nascem no enum do banco de propósito: `alter type ... add value` não pode
 * ser usado na mesma transação que compara com o valor novo, dor que a migration do `archived` já
 * documentou em `events`.
 */
export const LOOT_SPLIT_STATUSES = ["draft", "confirmed"] as const;
export type LootSplitStatus = (typeof LOOT_SPLIT_STATUSES)[number];

/** Basis points da participação: 10000 = 100%. Inteiro pelo mesmo motivo da taxa. */
export const SHARE_SCALE = 10_000;

/** Uma pessoa que esteve no canal do evento na janela start→finish (Q6). */
export interface SplitPresence {
  /** Chave da presença: `voice_sessions.discord_user_id`. Nem todo presente tem conta no painel. */
  discordUserId: string;
  /** Milissegundos no canal do evento dentro da janela. Guardado para a tela explicar o número (TASK-029). */
  presenceMs: number;
  /** Tinha inscrição ativa no evento. Não inscrito entra com 0% (Q7). */
  signedUp: boolean;
}

/** O que o rateio acrescenta a cada linha. */
export interface SplitShareResult {
  /** Participação em basis points. A soma fecha exatamente 10000 quando há presença inscrita. */
  shareBp: number;
  /** Prata desta linha sobre o distribuível (total menos taxa). */
  amount: bigint;
}

export type SplitShare<T extends SplitPresence = SplitPresence> = T & SplitShareResult;

export interface SplitDraftCalc<T extends SplitPresence = SplitPresence> {
  lines: SplitShare<T>[];
  /** Prata do distribuível que sobrou do arredondamento. Vai para o caller/dono do evento (Q23). */
  residual: bigint;
}

/**
 * Rateio do rascunho (AC#1/AC#2).
 *
 * Peso de cada pessoa = seus milissegundos no canal do evento entre `started_at` e `finished_at`
 * (Q6). Não há presença mínima: o split já é proporcional (Q5). Quem estava presente mas **não**
 * estava inscrito aparece na lista com 0% e fica **fora do denominador** (Q7) — senão a presença de
 * quem não se inscreveu diluiria a prata de quem se inscreveu.
 *
 * Arredondamento, regra escolhida e documentada aqui porque prata é `bigint` inteiro (Q20):
 * - **percentual**: maior resto (largest remainder) sobre 10000 bp, então a lista fecha 100% exato
 *   (Q22). Empate de resto é desempatado por `discordUserId`, para o mesmo evento gerar sempre o
 *   mesmo rascunho.
 * - **prata**: derivada do percentual por `distributeByShare` — a mesma função que a confirmação usa
 *   (TASK-028). É o percentual que manda, e não os milissegundos, porque depois de uma edição à mão
 *   os milissegundos deixam de ser a verdade; e assim o número conferido na tela é exatamente o
 *   número creditado no ledger.
 *
 * `distributable` é o total **já sem a taxa** (doc-005, "Taxa do split"): a taxa é retirada antes da
 * divisão, então ela não chega aqui. Sem ninguém inscrito e presente, todo mundo fica com 0% e o
 * distribuível inteiro vira resíduo do dono (Q23).
 */
export function calculateSplitDraft<T extends SplitPresence>(present: readonly T[], distributable: bigint): SplitDraftCalc<T> {
  const lines: SplitShare<T>[] = present.map((p) => ({ ...p, shareBp: 0, amount: 0n }));
  const eligible = lines.map((line, index) => ({ line, index })).filter(({ line }) => line.signedUp && line.presenceMs > 0);
  const totalMs = eligible.reduce((sum, { line }) => sum + line.presenceMs, 0);
  if (totalMs === 0) return { lines, residual: distributable > 0n ? distributable : 0n };

  let usedBp = 0;
  // Resto inteiro do rateio de basis points, para o desempate não depender de float.
  const remainders: { index: number; remainder: number; discordUserId: string }[] = [];

  for (const { line, index } of eligible) {
    const scaled = line.presenceMs * SHARE_SCALE;
    line.shareBp = Math.floor(scaled / totalMs);
    usedBp += line.shareBp;
    remainders.push({ index, remainder: scaled % totalMs, discordUserId: line.discordUserId });
  }

  remainders.sort((a, b) => b.remainder - a.remainder || (a.discordUserId < b.discordUserId ? -1 : 1));
  // Cada floor perde menos de 1 bp, então o que falta nunca passa do número de linhas elegíveis.
  for (let i = 0; i < SHARE_SCALE - usedBp; i++) lines[remainders[i % remainders.length]!.index]!.shareBp++;

  const { amounts, residual } = distributeByShare(
    lines.map((line) => line.shareBp),
    distributable,
  );
  for (const [index, line] of lines.entries()) line.amount = amounts[index]!;
  return { lines, residual };
}

/* ------------------------------------------------------------------- dtos */

/** Corpo de criação do rascunho. `fee` omitida = usa a taxa que está no evento. */
export const lootSplitCreateSchema = z.object({
  totalSilver: silverAmountSchema("O total da prata"),
  fee: eventFeeSchema.optional(),
});
export type LootSplitCreateInput = z.output<typeof lootSplitCreateSchema>;

/** Troca da taxa do evento (Q26: vale enquanto o evento não for arquivado). */
export const eventFeeUpdateSchema = z.object({ fee: eventFeeSchema });
export type EventFeeUpdateInput = z.output<typeof eventFeeUpdateSchema>;

export interface LootSplitLineDto {
  id: string;
  discordUserId: string;
  /** Conta do painel, quando a pessoa tem uma. Presente sem conta fica null e não pode receber (TASK-028). */
  userId: string | null;
  nick: string | null;
  /** Tinha inscrição ativa no evento; false = presente não inscrito, com 0% (Q7). */
  signedUp: boolean;
  roleName: string | null;
  /** Milissegundos no canal do evento na janela do evento: é o que explica o percentual (TASK-029). */
  presenceMs: number;
  shareBp: number;
  /** Prata desta linha sobre o distribuível (total menos taxa), como string. */
  amount: string;
}

export interface LootSplitDto {
  id: string;
  eventId: string;
  status: LootSplitStatus;
  /** Prata bruta da leva, antes da taxa. */
  totalSilver: string;
  fee: EventFeeDto;
  /** Prata retida pela taxa, congelada junto com a taxa (doc-005, "Taxa do split"). */
  feeSilver: string;
  /** `totalSilver - feeSilver`: o que as linhas dividem. Zero quando a taxa não cabe no total. */
  distributableSilver: string;
  /** Sobra do arredondamento reservada ao caller/dono (Q23), creditada junto com a taxa. */
  residualSilver: string;
  createdByUserId: string | null;
  /** Quem confirmou, e quando. Null enquanto o split é rascunho. */
  confirmedByUserId: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lines: LootSplitLineDto[];
}

/** Percentual legível a partir dos basis points: "12,5%". */
export const formatShare = (shareBp: number): string => `${(shareBp / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

/** Tempo de presença legível: "1h 12min", "4min", "—". */
export function formatPresence(presenceMs: number): string {
  if (presenceMs <= 0) return "—";
  const minutes = Math.floor(presenceMs / 60_000);
  if (minutes < 1) return "menos de 1min";
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}min` : `${minutes}min`;
}

/**
 * Presença medida do evento, antes de existir qualquer rascunho (TASK-029).
 *
 * É o mesmo dado que vira as linhas do rascunho, servido sozinho para a tela de acerto não abrir
 * vazia: quem esteve na call e por quanto tempo existe desde o finish, e esconder isso até o caller
 * digitar o total transformaria a tela num formulário em branco.
 */
export interface SplitPresenceDto {
  discordUserId: string;
  userId: string | null;
  nick: string | null;
  signedUp: boolean;
  roleName: string | null;
  presenceMs: number;
}

/**
 * Percentual digitado ("12,5", "12.5", "7") em basis points. `null` quando não é número, é negativo
 * ou passa de 100% — a granularidade é o basis point (0,01%), que é exatamente a que o caller edita.
 *
 * O arredondamento é explícito: "12,345" vira 1234 bp (truncado), nunca um float que a soma depois
 * não fecha. Prata nenhuma passa por aqui: isto converte percentual, não dinheiro.
 */
export function parsePercentBp(input: string): number | null {
  const raw = input.trim().replace("%", "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;
  const [whole, decimals = ""] = raw.split(".");
  const bp = Number(whole) * 100 + Number((decimals + "00").slice(0, 2));
  return bp > SHARE_SCALE ? null : bp;
}

/* ------------------------------------------------- taxa aplicada (TASK-028) */

/**
 * A taxa **retirada antes da divisão** (doc-005, bloco "Taxa do split"), já em prata.
 *
 * `percent` é `total × bp / 10000` truncado; `fixed` é o valor cru. A taxa **não tem teto** (decisão
 * do usuário), e é justamente por isso que o excesso precisa de nome próprio: uma taxa fixa (ou um
 * percentual acima de 100%) maior que o total do split deixaria o distribuível negativo, e prata
 * negativa numa linha de participante é dívida inventada. Quando isso acontece o rascunho continua
 * existindo — para o caller ver e corrigir —, mas com distribuível zero, e a **confirmação recusa**.
 */
export interface FeeBreakdown {
  /** Prata retida da taxa. Vai para o caller/dono junto com o resíduo (Q23). */
  feeSilver: bigint;
  /** O que sobra para as linhas depois da taxa. Nunca negativo. */
  distributable: bigint;
  /** A taxa não cabe no total: `feeSilver > total`. A confirmação recusa (ver `checkSplitConfirm`). */
  exceedsTotal: boolean;
}

export function feeBreakdown(total: bigint, fee: EventFee): FeeBreakdown {
  const base = total > 0n ? total : 0n;
  const feeSilver = fee.type === "percent" ? (base * fee.value) / FEE_PERCENT_SCALE : fee.value;
  if (feeSilver > base) return { feeSilver, distributable: 0n, exceedsTotal: true };
  return { feeSilver, distributable: base - feeSilver, exceedsTotal: false };
}

/**
 * Prata de cada linha a partir da participação já decidida (`shareBp`) sobre o **distribuível**.
 *
 * Usado nos dois momentos, de propósito: ao montar/editar o rascunho e ao confirmar. Se o rascunho
 * dividisse por milissegundos e a confirmação por percentual, o número conferido na tela não seria o
 * número creditado — e depois de editar os percentuais à mão os milissegundos nem seriam mais a
 * verdade. Truncar por linha garante que a soma nunca passa do distribuível; o que sobra é
 * `residual`, sempre menor que o número de linhas, e vai para o caller/dono (Q23).
 */
export function distributeByShare(shares: readonly number[], distributable: bigint): { amounts: bigint[]; residual: bigint } {
  const scale = BigInt(SHARE_SCALE);
  const base = distributable > 0n ? distributable : 0n;
  const amounts = shares.map((shareBp) => (shareBp > 0 ? (base * BigInt(shareBp)) / scale : 0n));
  return { amounts, residual: base - amounts.reduce((sum, amount) => sum + amount, 0n) };
}

/* ------------------------------------------------- confirmação (TASK-028) */

/** Por que a confirmação foi recusada. Cada uma vira uma frase em PT-BR no 409. */
export const SPLIT_CONFIRM_REFUSALS = ["shares_not_100", "fee_exceeds_total", "share_without_account", "share_without_signup"] as const;
export type SplitConfirmRefusal = (typeof SPLIT_CONFIRM_REFUSALS)[number];

/** O mínimo que a conferência precisa saber de cada linha. */
export interface ConfirmableLine {
  shareBp: number;
  /** Conta no painel. Sem ela não há para quem creditar: o ledger é por `user_id`. */
  userId: string | null;
  signedUp: boolean;
}

export interface SplitConfirmPlan {
  fee: FeeBreakdown;
  /** Prata por linha, na mesma ordem das linhas recebidas. */
  amounts: bigint[];
  /** Sobra do arredondamento; soma com `fee.feeSilver` no crédito do dono (Q23). */
  residual: bigint;
  /** O que o caller/dono recebe: taxa + resíduo. */
  ownerSilver: bigint;
}

export type CheckSplitConfirmResult = { ok: true; plan: SplitConfirmPlan } | { ok: false; reason: SplitConfirmRefusal };

export const splitShareSum = (lines: readonly { shareBp: number }[]): number => lines.reduce((sum, line) => sum + line.shareBp, 0);

/**
 * Tudo que precisa ser verdade para o split virar prata de verdade (AC#1, AC#2, Q22, Q23).
 *
 * A ordem das recusas é a ordem em que elas ajudam: a soma é o que o caller acabou de digitar, a taxa
 * é a configuração do evento, e as duas últimas são pessoas na lista que não podem receber. Todas
 * acontecem **antes** de qualquer escrita — a confirmação é uma transação só, e ela não começa
 * sabendo que vai dar errado no meio.
 *
 * `shares_not_100` também cobre o split de total zero: 100% de nada continua sendo 100%, e a lista
 * precisa fechar do mesmo jeito.
 */
export function checkSplitConfirm(lines: readonly ConfirmableLine[], total: bigint, fee: EventFee): CheckSplitConfirmResult {
  if (splitShareSum(lines) !== SHARE_SCALE) return { ok: false, reason: "shares_not_100" };
  const breakdown = feeBreakdown(total, fee);
  if (breakdown.exceedsTotal) return { ok: false, reason: "fee_exceeds_total" };
  if (lines.some((line) => line.shareBp > 0 && !line.signedUp)) return { ok: false, reason: "share_without_signup" };
  if (lines.some((line) => line.shareBp > 0 && line.userId === null)) return { ok: false, reason: "share_without_account" };
  const { amounts, residual } = distributeByShare(
    lines.map((line) => line.shareBp),
    breakdown.distributable,
  );
  return { ok: true, plan: { fee: breakdown, amounts, residual, ownerSilver: breakdown.feeSilver + residual } };
}

/** Frase do 409 de cada recusa. Explica o que fazer, não só o que está errado. */
export function splitConfirmRefusalMessage(reason: SplitConfirmRefusal): string {
  switch (reason) {
    case "shares_not_100":
      return "A soma das participações precisa ser exatamente 100% para confirmar o split.";
    case "fee_exceeds_total":
      return "A taxa do evento é maior que o total deste split: não sobra prata para dividir. Baixe a taxa ou aumente o total.";
    case "share_without_signup":
      return "Alguém que não estava inscrito no evento ficou com participação. Só quem estava inscrito pode receber.";
    case "share_without_account":
      return "Alguém com participação ainda não tem conta no painel. Peça para essa pessoa entrar no painel ou zere a participação dela.";
  }
}

/* ---------------------------------------------- edição do rascunho (TASK-028) */

/**
 * Edição do rascunho (AC#1): o caller ajusta o total da leva e/ou os percentuais.
 *
 * Os dois campos são opcionais e independentes — mexer só no total é o caso comum (o loot foi
 * vendido por mais do que o estimado) e não deve obrigar a reenviar a lista inteira. Quando `lines`
 * vem, ela precisa trazer **todas** as linhas do split: participação é um bolo fechado, e aceitar uma
 * lista parcial deixaria o resto num valor que ninguém escolheu. A soma só é exigida na confirmação
 * (Q22) — durante a edição ela passa por estados intermediários o tempo todo.
 */
export const lootSplitUpdateSchema = z
  .object({
    totalSilver: silverAmountSchema("O total da prata").optional(),
    lines: z
      .array(
        z.object({
          id: z.uuid({ error: "Id de linha inválido." }),
          shareBp: z
            .int({ error: "A participação precisa ser um número inteiro de basis points (10000 = 100%)." })
            .min(0, "A participação não pode ser negativa.")
            .max(SHARE_SCALE, "A participação de uma linha não passa de 100%."),
        }),
      )
      .optional(),
  })
  .refine((body) => body.totalSilver !== undefined || body.lines !== undefined, { error: "Nada para alterar: mande o total, as participações, ou os dois." });
export type LootSplitUpdateInput = z.output<typeof lootSplitUpdateSchema>;

/** Motivo do estorno: a única correção possível de um split já confirmado. */
export const lootSplitReversalSchema = z.object({
  reason: z.string().trim().min(3, "Explique o motivo do estorno: é a única explicação que fica no extrato.").max(500, "Motivo longo demais."),
});
export type LootSplitReversalInput = z.output<typeof lootSplitReversalSchema>;
