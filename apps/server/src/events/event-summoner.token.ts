import type { SummonOutcome } from "../domain/event-summon.js";

/**
 * Porta do chamado de quem não entrou na call (TASK-087, PE15).
 *
 * O serviço real (`EventSummonService`) mora no BotModule, que só sobe com o bot ligado — chamar no
 * privado é, por definição, Discord. O endpoint do painel injeta este token como **opcional**, igual ao
 * `MEMBER_IMPORTER`: sem bot (e2e, testes HTTP) ele não existe e a API responde 503 com texto claro em
 * vez de quebrar na subida.
 *
 * A regra de permissão (caller do evento ou staff) e a de estado (evento rodando, call existindo) ficam
 * **dentro** do serviço, não em cada porta: o painel e o menu da call precisam recusar pelo mesmo
 * motivo e com a mesma frase.
 */
export type SummonEventResult = { ok: true; outcome: SummonOutcome } | { ok: false; reason: "not_found" | "denied" | "not_running" | "no_channel" };

export interface EventSummoner {
  summon(eventId: string, actorUserId: string): Promise<SummonEventResult>;
}

export const EVENT_SUMMONER = Symbol("EVENT_SUMMONER");
