import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import {
  confirmLootSplit,
  createLootSplit,
  getEvent,
  getLootSplit,
  hasDraftLootSplit,
  listEventLootSplits,
  listEventPresence,
  reverseLootSplit,
  setEventFee,
  updateLootSplitDraft,
  type ConfirmLootSplitResult,
  type CreateLootSplitResult,
  type DbHandle,
  type ReverseLootSplitResult,
  type UpdateLootSplitResult,
} from "@albion-hub/db";
import {
  eventStatusLabel,
  feeFromDto,
  splitConfirmRefusalMessage,
  type EventDto,
  type EventFee,
  type LootSplitCreateInput,
  type LootSplitDto,
  type LootSplitUpdateInput,
} from "@albion-hub/shared";
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
 * - a taxa gravada no split é a do evento no instante do rascunho, ou a que veio no pedido, e ela é
 *   retirada **antes** da divisão, com o valor retido indo para o caller/dono (doc-005, Q23);
 * - confirmar é o único caminho que escreve no ledger, e ele é idempotente (TASK-028, AC#4);
 * - split confirmado é imutável: a correção é estorno (`reverse`), nunca reescrita.
 *
 * **Segurança**: todo método recebe o evento já carregado e o `actorUserId` já resolvido pelo
 * controller a partir da sessão — nada aqui aceita um `userId` vindo do cliente, e o `userId` de cada
 * linha do split vem de `voice_sessions`/`event_signups`, nunca do pedido.
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

  /**
   * Edita o rascunho: total da leva e/ou percentuais (AC#1). A soma 100% só é exigida na confirmação
   * (Q22) — durante a edição a lista passa por estados intermediários o tempo todo.
   */
  async update(event: EventDto, splitId: string, input: LootSplitUpdateInput): Promise<UpdateLootSplitResult> {
    assertEventEditable(event);
    return updateLootSplitDraft(this.handle.db, splitId, input);
  }

  /**
   * Confirma o split e lança no ledger (AC#2, AC#4). Idempotente: a segunda confirmação devolve o
   * mesmo split com `alreadyConfirmed`, sem creditar nada de novo — quem garante isso é a trava da
   * linha do split no Postgres, não o JavaScript.
   */
  async confirm(event: EventDto, splitId: string, actorUserId: string | null): Promise<ConfirmLootSplitResult> {
    assertEventEditable(event);
    return confirmLootSplit(this.handle.db, splitId, { actorUserId });
  }

  /** Única correção de um split confirmado (Q24): estorna todos os lançamentos dele, nunca edita. */
  async reverse(event: EventDto, splitId: string, reason: string, actorUserId: string | null): Promise<ReverseLootSplitResult> {
    assertEventEditable(event);
    return reverseLootSplit(this.handle.db, splitId, { reason, actorUserId });
  }

  /** Troca a taxa do evento (Q26: vale até o arquivamento). Não mexe em split já rascunhado. */
  async setFee(event: EventDto, fee: EventFee): Promise<EventDto | null> {
    assertEventEditable(event);
    return setEventFee(this.handle.db, event.id, fee);
  }
}

/** Toda recusa possível de editar, confirmar ou estornar um split. */
export type SplitWriteRefusal = Exclude<UpdateLootSplitResult | ConfirmLootSplitResult | ReverseLootSplitResult, { ok: true }>;

/**
 * Frase do 409 de cada recusa. Uma por motivo, todas dizendo o que fazer em seguida — quem lê isso
 * está com a prata da noite na mão e precisa saber qual é o próximo passo, não só que deu errado.
 */
export function splitWriteError(result: SplitWriteRefusal): string {
  switch (result.reason) {
    case "not_draft":
      return "Este loot split já foi confirmado: ele não muda mais. Para corrigir, estorne os lançamentos.";
    case "event_not_editable":
      return `O evento está ${eventStatusLabel(result.status)}: o loot split só é editado e confirmado enquanto o evento está finalizado.`;
    case "unknown_lines":
      return "A lista de participações precisa trazer exatamente as linhas deste split.";
    case "share_without_signup":
      return "Alguém que não estava inscrito no evento ficou com participação. Só quem estava inscrito pode receber.";
    case "not_confirmed":
      return "Este loot split ainda é rascunho: não há lançamento para estornar.";
    case "already_reversed":
      return "Os lançamentos deste loot split já foram estornados.";
    case "refused":
      return splitConfirmRefusalMessage(result.refusal);
    case "not_found":
      // O controller devolve 404 antes de chegar aqui; existe para o switch ser exaustivo.
      return "Loot split não encontrado.";
  }
}
