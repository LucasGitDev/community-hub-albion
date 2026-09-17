import { z } from "zod";
import { formatAmount } from "./currency.js";

/**
 * Taxa de entrada em conteúdo disputado (TASK-058, F6-12 a F6-16).
 *
 * É **Buffunfa**, nunca prata: em prata viraria barreira de dinheiro contra o membro novo, que é
 * justamente quem tem pouca prata (F6-12). É cobrada na **inscrição**, não no start, porque é o único
 * desenho que filtra de verdade — inscrever-se de graça mantém a lista inflada (F6-13). E é **sink
 * puro**: a Buffunfa cobrada some, não vai para ninguém (F6-16), ao contrário da taxa do split em prata.
 *
 * Valor inteiro (Q20) e **sem teto** (decisão do usuário, a mesma da taxa do split): quem calibra o
 * filtro é o caller, não um limite escrito aqui. Zero é o default e significa "evento sem taxa".
 */
export const NO_ENTRY_FEE = 0n;

/**
 * Teto físico, não teto de política: `bigint` do Postgres vai até 2^63-1, e um valor acima disso
 * chegaria no banco como erro de range — 500 em vez do 400 que o caller precisa ler. A decisão "sem
 * teto" é sobre a taxa que faz sentido cobrar; isto é só a borda do tipo.
 */
export const ENTRY_FEE_MAX = 9_223_372_036_854_775_807n;

/**
 * Trafega como string, como todo bigint do projeto (Q20): JSON não tem inteiro grande o bastante, e
 * converter para `number` no caminho é como se perde valor.
 */
export const entryFeeSchema = (label = "A taxa de entrada") =>
  z
    .string({ error: `Digite ${label.toLowerCase()} em Buffunfa.` })
    .trim()
    .regex(/^\d+$/, `${label} é um número inteiro de Buffunfa, sem sinal e sem casas decimais.`)
    // O `refine` roda mesmo com o regex acima já reprovado, então ele confere o formato antes de converter.
    .refine((v) => !/^\d+$/.test(v) || BigInt(v) <= ENTRY_FEE_MAX, `${label} passou do maior número que o banco guarda.`)
    .transform((v) => BigInt(v));

export const eventEntryFeeSchema = z.object({ entryFee: entryFeeSchema() });
export type EventEntryFeeInput = z.output<typeof eventEntryFeeSchema>;

/** "Entrada: 20 BUF" / "Entrada gratuita". Uma frase só para o painel, o embed do bot e os toasts. */
export function entryFeeLabel(fee: bigint): string {
  return fee === NO_ENTRY_FEE ? "Entrada gratuita" : `Entrada: ${formatAmount(fee, "buffunfa")}`;
}

/**
 * Recusa por saldo (AC#2). A mensagem diz o que falta, não só que faltou: quem lê precisa saber
 * quanto juntar. Um texto só, para o botão do Discord e o painel recusarem com a mesma frase.
 */
export function insufficientEntryFeeMessage(fee: bigint, balance: bigint): string {
  return `A entrada deste evento custa ${formatAmount(fee, "buffunfa")} e você tem ${formatAmount(balance, "buffunfa")}. Faltam ${formatAmount(fee - balance, "buffunfa")}.`;
}

/** Motivo gravado no estorno da taxa; é o que o membro lê no extrato. */
export const ENTRY_FEE_REFUND_REASONS = {
  left: "Saiu do evento antes do início: taxa de entrada devolvida.",
  cancelled: "Evento cancelado: taxa de entrada devolvida.",
  waitlisted: "Evento começou com você ainda na lista de espera: taxa de entrada devolvida.",
} as const;
