import { ConflictException } from "@nestjs/common";
import { eventEditBlocked, type EventStatus } from "@albion-hub/shared";

/**
 * Guard único de edição de evento arquivado (TASK-044, AC#2).
 *
 * Q26 (revisada em 2026-09-16) separa dois fins: `finished` encerra o jogo e **continua** aceitando
 * acerto — dados do evento, taxa e loot splits —, e `archived` é o fim de fato. Quem escreve num
 * evento arquivado leva 409 com uma frase só, em vez de cada endpoint inventar a sua.
 *
 * Chamar isto é a primeira coisa que uma mutação faz, antes de qualquer regra própria: assim o
 * usuário lê "o evento está arquivado" em vez de "as inscrições não estão abertas", que é verdade mas
 * não é o motivo. O serviço de loot split da F5 (TASK-027/028) chama esta mesma função ao criar,
 * editar ou confirmar um split, e ao mexer na taxa do evento.
 */
export function assertEventEditable(event: { status: EventStatus }): void {
  const blocked = eventEditBlocked(event.status);
  if (blocked) throw new ConflictException(blocked);
}
