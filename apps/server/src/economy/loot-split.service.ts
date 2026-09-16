import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import {
  createLootSplit,
  getEvent,
  getLootSplit,
  hasDraftLootSplit,
  listEventLootSplits,
  listEventPresence,
  setEventFee,
  type CreateLootSplitResult,
  type DbHandle,
} from "@albion-hub/db";
import { eventStatusLabel, feeFromDto, type EventDto, type EventFee, type LootSplitCreateInput, type LootSplitDto } from "@albion-hub/shared";
import { DB_HANDLE } from "../db/db.module.js";
import { assertEventEditable } from "../events/archived.guard.js";
import { EventsService } from "../events/events.service.js";

/**
 * Porta única do loot split (doc-002, TASK-027). Comando do bot, painel e botão do embed chamam este
 * serviço — nunca o repo, nunca SQL. A TASK-028 (confirmar e lançar no ledger) e a TASK-029 (tela)
 * entram por aqui também.
 *
 * O que ele garante hoje:
 * - rascunho só nasce de evento em `finished` (a janela de presença precisa ter fechado, Q6) e nunca
 *   de evento cancelado (AC#4, Q26);
 * - evento arquivado não aceita nada, com a frase única do `assertEventEditable` (TASK-044);
 * - a taxa gravada no split é a do evento no instante do rascunho, ou a que veio no pedido;
 * - **nada** é lançado no ledger: distribuir prata é da TASK-028.
 */

export type CreateDraftResult = CreateLootSplitResult;

/** Frase do 409 quando o evento ainda não pode (ou não pode mais) ter split. */
export function splitStatusError(status: EventDto["status"]): string {
  if (status === "cancelled") return "O evento foi cancelado: não dá para criar loot split nele.";
  return `O evento está ${eventStatusLabel(status)}. O loot split só é criado depois que o evento é finalizado.`;
}

/** Arquivar com rascunho aberto trancaria prata que ninguém mais poderia distribuir (TASK-044, AC#4). */
const ARCHIVE_BLOCKED_BY_DRAFT = "Este evento tem loot split em rascunho. Confirme ou apague o rascunho antes de arquivar.";

@Injectable()
export class LootSplitService implements OnModuleInit {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(EventsService) private readonly events: EventsService,
  ) {}

  /**
   * Pluga a precondição que a TASK-044 deixou preparada: agora que o rascunho existe, arquivar passa a
   * conferir de verdade se sobrou algum. Roda dentro da transação da transição, com o evento travado.
   */
  onModuleInit(): void {
    this.events.setArchivePrecondition(async (tx, { eventId }) => ((await hasDraftLootSplit(tx, eventId)) ? ARCHIVE_BLOCKED_BY_DRAFT : null));
  }

  /**
   * Rascunho do split (AC#1, AC#2, AC#3). `fee` omitida usa a taxa do evento; a que for usada fica
   * congelada no split, então mexer na taxa do evento depois não muda um rascunho já conferido.
   */
  async createDraft(eventId: string, input: LootSplitCreateInput, actorUserId: string | null): Promise<CreateDraftResult> {
    const event = await getEvent(this.handle.db, eventId);
    if (!event) return { ok: false, reason: "not_found" };
    // Primeira coisa: arquivado leva a frase do arquivamento, não "o evento está arquivado e o split só
    // nasce depois do finish", que é verdade mas não é o motivo.
    assertEventEditable(event);
    const fee: EventFee = input.fee ?? feeFromDto(event.fee);
    return createLootSplit(this.handle.db, { eventId, totalSilver: input.totalSilver, fee, createdBy: actorUserId });
  }

  get(splitId: string): Promise<LootSplitDto | null> {
    return getLootSplit(this.handle.db, splitId);
  }

  /** Splits do evento na ordem em que as levas de loot chegaram (N por evento, AC#3/Q23). */
  list(eventId: string): Promise<LootSplitDto[]> {
    return listEventLootSplits(this.handle.db, eventId);
  }

  /**
   * Prévia da presença sem gravar nada: é o que a tela da TASK-029 mostra antes de o caller digitar o
   * total. Mesma fonte do rascunho, então o que ele vê é o que vai ser gravado.
   */
  presence(eventId: string) {
    return listEventPresence(this.handle.db, eventId);
  }

  /** Troca a taxa do evento (Q26: vale até o arquivamento). Não mexe em split já rascunhado. */
  async setFee(event: EventDto, fee: EventFee): Promise<EventDto | null> {
    assertEventEditable(event);
    return setEventFee(this.handle.db, event.id, fee);
  }
}
