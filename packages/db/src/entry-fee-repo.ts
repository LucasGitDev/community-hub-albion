import { NO_ENTRY_FEE, type EventSignupStatus } from "@albion-hub/shared";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { EventTx } from "./events-repo.js";
import { reverseLedgerEntry } from "./ledger-repo.js";
import { eventSignups } from "./schema.js";

/**
 * Devolução da taxa de entrada (TASK-058, F6-13/F6-14).
 *
 * Devolver **é estornar**: um lançamento novo `reversal` apontando para a cobrança original. Nada aqui
 * toca no lançamento que foi cobrado — as triggers append-only recusariam de qualquer jeito, e é assim
 * que o extrato do membro continua mostrando que ele pagou **e** que foi devolvido, em duas linhas.
 *
 * Tudo roda na transação de quem chama: a devolução e a mudança de estado que a causou (sair do evento,
 * cancelar o evento) são a mesma coisa acontecendo, e meia delas não pode sobreviver a um erro.
 */

/**
 * Estorna a cobrança de uma inscrição. `null` quando não havia taxa. Um lançamento já estornado devolve
 * `null` também, sem erro: o índice único parcial de `reversal_of` é quem garante um estorno só, e a
 * segunda passada (job repetido, duplo clique) tem que ser inofensiva.
 */
export async function refundEntryFee(tx: EventTx, feeEntryId: string | null, reason: string): Promise<bigint | null> {
  if (!feeEntryId) return null;
  const result = await reverseLedgerEntry(tx, feeEntryId, { reason });
  // O estorno é o crédito: `entry.amount` já é positivo (o inverso do débito que foi cobrado).
  return result.ok ? result.entry.amount : null;
}

/**
 * Estorna a taxa de todo mundo nos estados pedidos de um evento — o cancelamento devolve a todos (F6-14),
 * e o start devolve a quem ficou na espera (ver `applyEventTransition`). Devolve o total devolvido e a
 * quantas pessoas, para quem chamou conseguir contar o que aconteceu sem uma segunda leitura.
 */
export async function refundEventEntryFees(
  tx: EventTx,
  eventId: string,
  statuses: readonly EventSignupStatus[],
  reason: string,
): Promise<{ total: bigint; people: number }> {
  const rows = await tx
    .select({ feeEntryId: eventSignups.feeEntryId })
    .from(eventSignups)
    .where(and(eq(eventSignups.eventId, eventId), inArray(eventSignups.status, [...statuses]), isNotNull(eventSignups.feeEntryId)));
  let total = NO_ENTRY_FEE;
  let people = 0;
  for (const row of rows) {
    const refunded = await refundEntryFee(tx, row.feeEntryId, reason);
    if (refunded === null) continue;
    total += refunded;
    people += 1;
  }
  return { total, people };
}
