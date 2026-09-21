import { z } from "zod";
import { amountSchema, formatAmount } from "./currency.js";

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
 * A leitura em si é `amountSchema` (currency.ts): ela vale para as duas moedas, e o nome daqui
 * continua existindo porque neste módulo o assunto é sempre prata.
 */
export const silverAmountSchema = (label: string) => amountSchema(label, " de prata");

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
 * Estados do split. Esta task só grava `draft`; `confirmed` é a TASK-028. Os dois já nascem no enum
 * do banco de propósito: `alter type ... add value` não pode
 * ser usado na mesma transação que compara com o valor novo, dor que a migration do `archived` já
 * documentou em `events`.
 */
export const LOOT_SPLIT_STATUSES = ["draft", "confirmed"] as const;
export type LootSplitStatus = (typeof LOOT_SPLIT_STATUSES)[number];

/** Basis points da participação: 10000 = 100%. Inteiro pelo mesmo motivo da taxa. */
export const SHARE_SCALE = 10_000;

/**
 * Escala da **presença** (TASK-084, PE1): 10000 = 100%. É a mesma escala da participação, mas os dois
 * números são coisas diferentes e não devem ser confundidos: a presença de cada um é independente e a
 * soma delas **não** fecha 100%; a participação é derivada delas e essa, sim, fecha (PE2).
 */
export const PRESENCE_SCALE = 10_000;

/** Prende um valor de presença dentro da escala. Presença negativa não existe; acima de 100% é 100%. */
export const clampPresenceBp = (bp: number): number => Math.max(0, Math.min(PRESENCE_SCALE, Math.trunc(bp)));

/**
 * Presença **medida**: quanto do tempo de vida da call a pessoa ficou nela, em basis points (PE3).
 *
 * É o número que nasce sozinho, antes de o caller tocar em nada, e o mesmo que o corte de 90% da
 * Buffunfa já usava (F6-10/F6-58). Sem janela medida não há presença: janela zero devolve zero, e
 * ninguém bate um corte de zero.
 */
export function measuredPresenceBp(presenceMs: number, windowMs: number): number {
  if (windowMs <= 0) return 0;
  return Math.min(PRESENCE_SCALE, Math.floor((presenceMs * PRESENCE_SCALE) / windowMs));
}

/**
 * A presença que **vale**: o que o caller editou, ou a medição quando ele não editou (PE3).
 *
 * Quem apareceu na call e nunca se inscreveu nasce em **zero**, por mais tempo que tenha ficado
 * (PE6): ele aparece na lista para o caller ver que esteve lá, e incluí-lo na divisão é gesto
 * explícito — digitar a presença dele. Editado é editado: um zero digitado para um inscrito é zero de
 * verdade, e não volta para a medição.
 */
export function effectivePresenceBp(person: { presenceMs: number; signedUp: boolean }, windowMs: number, override: number | null | undefined): number {
  if (override !== null && override !== undefined) return clampPresenceBp(override);
  if (!person.signedUp) return 0;
  return measuredPresenceBp(person.presenceMs, windowMs);
}

/**
 * Participação de cada um a partir da presença (PE2): `presença ÷ soma das presenças`.
 *
 * Três pessoas com 100%, 100% e 50% recebem 40%, 40% e 20%. A presença não precisa somar 100% — é
 * justamente o que a TASK-084 tirou do caminho do caller, que antes fazia essa conta na mão.
 *
 * Arredondamento por **maior resto** sobre 10000 bp, então a lista fecha 100% exato mesmo quando a
 * divisão não é redonda. Empate de resto é desempatado por `key`, para o mesmo evento gerar sempre a
 * mesma divisão. Soma de presenças zero devolve tudo zero — quem recusa esse caso é a confirmação
 * (`zero_presence`), com uma frase, em vez de uma divisão por zero.
 */
export function sharesFromPresence(entries: readonly { key: string; presenceBp: number }[]): number[] {
  const shares = entries.map(() => 0);
  const eligible = entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.presenceBp > 0);
  const totalBp = eligible.reduce((sum, { entry }) => sum + entry.presenceBp, 0);
  if (totalBp === 0) return shares;

  let usedBp = 0;
  // Resto inteiro do rateio, para o desempate não depender de float.
  const remainders: { index: number; remainder: number; key: string }[] = [];
  for (const { entry, index } of eligible) {
    const scaled = entry.presenceBp * SHARE_SCALE;
    shares[index] = Math.floor(scaled / totalBp);
    usedBp += shares[index]!;
    remainders.push({ index, remainder: scaled % totalBp, key: entry.key });
  }
  remainders.sort((a, b) => b.remainder - a.remainder || (a.key < b.key ? -1 : 1));
  // Cada floor perde menos de 1 bp, então o que falta nunca passa do número de linhas elegíveis.
  for (let i = 0; i < SHARE_SCALE - usedBp; i++) shares[remainders[i % remainders.length]!.index]++;
  return shares;
}

/** Soma das presenças da lista. Zero é o caso que a confirmação recusa (AC#7). */
export const presenceBpSum = (entries: readonly { presenceBp: number }[]): number => entries.reduce((sum, e) => sum + e.presenceBp, 0);

/** Uma pessoa que esteve no canal do evento na janela start→finish (Q6). */
export interface SplitPresence {
  /** Chave da presença: `voice_sessions.discord_user_id`. Nem todo presente tem conta no painel. */
  discordUserId: string;
  /** Milissegundos no canal do evento dentro da janela. É de onde a presença nasce (PE3). */
  presenceMs: number;
  /** Tinha inscrição ativa no evento. Não inscrito nasce com presença 0 (PE6). */
  signedUp: boolean;
  /**
   * Presença que vale (0 a 10000), já resolvida: o que o caller editou, ou a medição (PE3). É **ela**
   * que pesa na divisão — os milissegundos ficam do lado para explicar de onde o número veio.
   */
  presenceBp: number;
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
 * Rateio do rascunho a partir da presença (PE1, PE2).
 *
 * O peso de cada pessoa é a **presença** dela (`presenceBp`), não os milissegundos crus: a presença
 * nasce da medição da call (PE3) e o caller edita por cima, e é o número editado que precisa mandar na
 * divisão — senão a tela mostraria um valor e o ledger creditaria outro. Não há presença mínima: o
 * split já é proporcional (Q5).
 *
 * Quem tem presença zero fica fora do denominador e recebe zero. É o caso de quem apareceu sem
 * inscrição enquanto o caller não decidir incluí-lo (PE6) e de quem nem entrou na call.
 *
 * Arredondamento, regra escolhida e documentada aqui porque prata é `bigint` inteiro (Q20):
 * - **percentual**: maior resto sobre 10000 bp em `sharesFromPresence`, então a lista fecha 100% exato;
 * - **prata**: derivada do percentual por `distributeByShare` — a mesma função que a confirmação usa.
 *   É o percentual que manda, e assim o número conferido na tela é exatamente o número creditado.
 *
 * `distributable` é o total **já sem a taxa** (doc-005, "Taxa do split"): a taxa é retirada antes da
 * divisão, então ela não chega aqui. Sem ninguém com presença, todo mundo fica com 0% e o distribuível
 * inteiro vira resíduo do dono (Q23) — e a confirmação recusa antes disso (`zero_presence`, AC#7).
 */
export function calculateSplitDraft<T extends SplitPresence>(present: readonly T[], distributable: bigint): SplitDraftCalc<T> {
  const shares = sharesFromPresence(present.map((p) => ({ key: p.discordUserId, presenceBp: p.presenceBp })));
  const { amounts, residual } = distributeByShare(shares, distributable);
  const lines: SplitShare<T>[] = present.map((p, index) => ({ ...p, shareBp: shares[index]!, amount: amounts[index]! }));
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
  /** Milissegundos no canal do evento na janela do evento: é de onde a presença nasceu (PE3). */
  presenceMs: number;
  /**
   * Presença que esta leva usou, em basis points (PE4). **Congelada na linha**: a presença é dado do
   * evento e muda quando o caller edita, mas uma leva já confirmada continua mostrando a presença com
   * que ela foi dividida — senão o extrato e a tela contariam histórias diferentes.
   */
  presenceBp: number;
  /** Participação derivada da presença (PE2). A soma das linhas fecha 10000. */
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
  /** Presença que vale agora: o que o caller editou, ou a medição (PE3). É o peso da divisão (PE2). */
  presenceBp: number;
  /** A medição crua, sem edição. Fica ao lado para a tela dizer "medido 72%, você pôs 100%". */
  measuredPresenceBp: number;
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
export const SPLIT_CONFIRM_REFUSALS = ["zero_presence", "fee_exceeds_total", "share_without_account"] as const;
export type SplitConfirmRefusal = (typeof SPLIT_CONFIRM_REFUSALS)[number];

/** O mínimo que a conferência precisa saber de cada linha. */
export interface ConfirmableLine {
  /** Chave estável da pessoa (`discordUserId`): é o desempate do arredondamento (PE2). */
  key: string;
  /** Presença desta linha, de 0 a 10000. É dela que a participação sai. */
  presenceBp: number;
  /** Conta no painel. Sem ela não há para quem creditar: o ledger é por `user_id`. */
  userId: string | null;
}

export interface SplitConfirmPlan {
  fee: FeeBreakdown;
  /** Participação por linha, derivada da presença (PE2), na mesma ordem das linhas recebidas. */
  shares: number[];
  /** Prata por linha, na mesma ordem das linhas recebidas. */
  amounts: bigint[];
  /** Sobra do arredondamento; soma com `fee.feeSilver` no crédito do dono (Q23). */
  residual: bigint;
  /** O que o caller/dono recebe: taxa + resíduo. */
  ownerSilver: bigint;
}

export type CheckSplitConfirmResult = { ok: true; plan: SplitConfirmPlan } | { ok: false; reason: SplitConfirmRefusal };

/**
 * Tudo que precisa ser verdade para o split virar prata de verdade (AC#7, PE2, Q23).
 *
 * A participação **não** é lida das linhas: ela é derivada aqui, da presença, pela mesma
 * `sharesFromPresence` que montou o rascunho. Com isso não existe estado em que a tela mostre uma
 * divisão e o ledger credite outra — a presença é a única coisa que alguém edita.
 *
 * As recusas, na ordem em que ajudam: a soma de presenças zero é o que o caller acabou de digitar
 * (**dividir por zero não é opção**, AC#7), a taxa é a configuração do evento, e a última é gente na
 * lista que não pode receber. Todas acontecem **antes** de qualquer escrita — a confirmação é uma
 * transação só, e ela não começa sabendo que vai dar errado no meio.
 *
 * Presença zero em todo mundo cobre também o split sem ninguém na lista: não há como dividir prata
 * entre ninguém, e um "confirmado" que só credita o dono esconderia isso do caller.
 */
export function checkSplitConfirm(lines: readonly ConfirmableLine[], total: bigint, fee: EventFee): CheckSplitConfirmResult {
  if (presenceBpSum(lines) <= 0) return { ok: false, reason: "zero_presence" };
  const breakdown = feeBreakdown(total, fee);
  if (breakdown.exceedsTotal) return { ok: false, reason: "fee_exceeds_total" };
  const shares = sharesFromPresence(lines);
  if (lines.some((line, index) => shares[index]! > 0 && line.userId === null)) return { ok: false, reason: "share_without_account" };
  const { amounts, residual } = distributeByShare(shares, breakdown.distributable);
  return { ok: true, plan: { fee: breakdown, shares, amounts, residual, ownerSilver: breakdown.feeSilver + residual } };
}

/** Frase do 409 de cada recusa. Explica o que fazer, não só o que está errado. */
export function splitConfirmRefusalMessage(reason: SplitConfirmRefusal): string {
  switch (reason) {
    case "zero_presence":
      return "Ninguém está com presença acima de zero: não há como dividir a prata. Dê presença a pelo menos uma pessoa antes de confirmar.";
    case "fee_exceeds_total":
      return "A taxa do evento é maior que o total deste split: não sobra prata para dividir. Baixe a taxa ou aumente o total.";
    case "share_without_account":
      return "Alguém com presença ainda não tem conta no painel. Peça para essa pessoa entrar no painel ou zere a presença dela.";
  }
}

/* ---------------------------------------------- edição do rascunho (TASK-028) */

/**
 * Edição do rascunho: só o **total da leva** (PE1, PE2).
 *
 * Os percentuais saíram daqui de propósito. Participação deixou de ser algo que alguém digita: ela é
 * derivada da presença (PE2), e a presença é dado do **evento**, não da leva (PE4) — quem a edita é
 * `eventPresenceUpdateSchema`, na rota do evento. Aceitar percentual por aqui criaria uma segunda
 * verdade sobre a mesma divisão, e a tela e o ledger passariam a poder discordar.
 */
export const lootSplitUpdateSchema = z.object({
  totalSilver: silverAmountSchema("O total da prata"),
});
export type LootSplitUpdateInput = z.output<typeof lootSplitUpdateSchema>;

/** Presença de 0 a 100% em basis points, do jeito que o caller edita (PE1). */
export const presenceBpSchema = z
  .int({ error: "A presença precisa ser um número inteiro de basis points (10000 = 100%)." })
  .min(0, "A presença não pode ser negativa.")
  .max(PRESENCE_SCALE, "A presença vai de 0 a 100%.");

/**
 * Edição da presença do evento (PE1, PE4): **de 0 a 100% por pessoa, independente**, sem precisar
 * somar 100%.
 *
 * A lista é **parcial** de propósito, e é a diferença que a TASK-084 faz: cada presença é um número
 * sobre uma pessoa, não uma fatia de um bolo fechado, então mexer na de um não obriga a reenviar a dos
 * outros. A chave é o snowflake do Discord, a mesma que a presença medida usa — quem esteve na call
 * sem conta no painel também tem presença, e um dia pode ter conta.
 */
export const eventPresenceUpdateSchema = z.object({
  entries: z
    .array(
      z.object({
        discordUserId: z.string().trim().regex(/^\d{5,32}$/, "Id do Discord inválido."),
        presenceBp: presenceBpSchema,
      }),
    )
    .min(1, "Mande pelo menos uma presença para alterar.")
    .max(1000, "Gente demais para um evento.")
    .refine((entries) => new Set(entries.map((e) => e.discordUserId)).size === entries.length, { error: "A mesma pessoa apareceu duas vezes na lista." }),
});
export type EventPresenceUpdateInput = z.output<typeof eventPresenceUpdateSchema>;

/** Motivo do estorno: a única correção possível de um split já confirmado. */
export const lootSplitReversalSchema = z.object({
  reason: z.string().trim().min(3, "Explique o motivo do estorno: é a única explicação que fica no extrato.").max(500, "Motivo longo demais."),
});
export type LootSplitReversalInput = z.output<typeof lootSplitReversalSchema>;

/**
 * Corpo da confirmação (TASK-081, SP1/SP2): as linhas que o caller ou a staff marcou como **pagas no
 * jogo**. Cada uma ganha, junto do crédito, um saque já liquidado do mesmo valor. Ausente ou vazia =
 * ninguém foi pago no jogo; a taxa e a sobra do dono entram pagas de qualquer jeito (SP3). É o único
 * lugar do sistema que marca prata como paga sem a fila da staff, e só vale enquanto o split é rascunho (SP4).
 */
export const lootSplitConfirmSchema = z.object({
  paidInGameLineIds: z
    .array(z.uuid({ error: "Id de linha inválido." }))
    .max(1000, "Linhas demais para um split.")
    .refine((ids) => new Set(ids).size === ids.length, { error: "Uma linha foi marcada como paga duas vezes." })
    .default([]),
});
export type LootSplitConfirmInput = z.output<typeof lootSplitConfirmSchema>;
