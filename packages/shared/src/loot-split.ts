import { z } from "zod";
import { formatSilver } from "./silver.js";

/**
 * Loot split (TASK-027, Q5/Q6/Q7/Q22/Q23) e a taxa do evento.
 *
 * Esta task modela e calcula **só o rascunho**: quanto cada pessoa presente no canal do evento
 * ganhou de participação. Aplicar a taxa, creditar o caller/dono e lançar no ledger é da TASK-028 —
 * aqui a taxa só é guardada, e a prévia em prata é calculada sobre o total **bruto**.
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
   * split é a TASK-028, que é quem de fato retém o valor.
   */
  value: bigint;
}

/** Ausência de taxa. É o default de template e evento enquanto ninguém configurar nada. */
export const NO_FEE: EventFee = { type: "percent", value: 0n };

export const hasFee = (fee: EventFee): boolean => fee.value > 0n;

/** "12,5%" ou "1.000.000 de prata". Mesma frase no bot e no painel. */
export function formatEventFee(fee: EventFee): string {
  if (fee.type === "fixed") return `${formatSilver(fee.value)} de prata`;
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
  /** Prévia da prata desta linha sobre o total **bruto** (a taxa é da TASK-028). */
  amount: bigint;
}

export type SplitShare<T extends SplitPresence = SplitPresence> = T & SplitShareResult;

export interface SplitDraftCalc<T extends SplitPresence = SplitPresence> {
  lines: SplitShare<T>[];
  /** Prata que sobrou do arredondamento. Vai para o caller/dono do evento (Q23). */
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
 * - **prata**: `floor(total × ms / msTotal)` por linha. Truncar (nunca arredondar para cima)
 *   garante que a soma jamais passa do total; a diferença vira `residual`, que é sempre
 *   `0 ≤ residual < nº de linhas` — alguns tostões — e fica com o caller/dono (Q23). A TASK-028
 *   é quem lança esse resíduo; aqui ele só fica explícito no rascunho.
 * - **percentual**: maior resto (largest remainder) sobre 10000 bp, então a lista mostrada fecha
 *   100% exato (AC#3, Q22) mesmo com o resíduo em prata existindo. Empate de resto é desempatado
 *   por `discordUserId`, para o mesmo evento gerar sempre o mesmo rascunho.
 *
 * Sem ninguém inscrito e presente, todo mundo fica com 0% e o total inteiro vira resíduo do dono.
 */
export function calculateSplitDraft<T extends SplitPresence>(present: readonly T[], total: bigint): SplitDraftCalc<T> {
  const lines: SplitShare<T>[] = present.map((p) => ({ ...p, shareBp: 0, amount: 0n }));
  const eligible = lines.map((line, index) => ({ line, index })).filter(({ line }) => line.signedUp && line.presenceMs > 0);
  const totalMs = eligible.reduce((sum, { line }) => sum + line.presenceMs, 0);
  if (totalMs === 0 || total <= 0n) return { lines, residual: total > 0n ? total : 0n };

  const totalMsBig = BigInt(totalMs);
  let distributed = 0n;
  let usedBp = 0;
  // Resto inteiro do rateio de basis points, para o desempate não depender de float.
  const remainders: { index: number; remainder: number; discordUserId: string }[] = [];

  for (const { line, index } of eligible) {
    line.amount = (total * BigInt(line.presenceMs)) / totalMsBig;
    distributed += line.amount;
    const scaled = line.presenceMs * SHARE_SCALE;
    line.shareBp = Math.floor(scaled / totalMs);
    usedBp += line.shareBp;
    remainders.push({ index, remainder: scaled % totalMs, discordUserId: line.discordUserId });
  }

  remainders.sort((a, b) => b.remainder - a.remainder || (a.discordUserId < b.discordUserId ? -1 : 1));
  // Cada floor perde menos de 1 bp, então o que falta nunca passa do número de linhas elegíveis.
  for (let i = 0; i < SHARE_SCALE - usedBp; i++) lines[remainders[i % remainders.length]!.index]!.shareBp++;

  return { lines, residual: total - distributed };
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
  /** Prévia em prata sobre o total bruto, como string. */
  amount: string;
}

export interface LootSplitDto {
  id: string;
  eventId: string;
  status: LootSplitStatus;
  totalSilver: string;
  fee: EventFeeDto;
  /** Sobra do arredondamento reservada ao caller/dono (Q23); a TASK-028 é quem lança. */
  residualSilver: string;
  createdByUserId: string | null;
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
