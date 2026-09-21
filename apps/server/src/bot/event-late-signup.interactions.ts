import { Inject, Injectable, Logger } from "@nestjs/common";
import { addLateEventSignup, findUserIdByDiscordId, listEventFreeRoleSlots, listRoles, type DbHandle } from "@albion-hub/db";
import { asSubject, defineAbilityFor } from "@albion-hub/shared";
import { MessageFlags } from "discord.js";
import { Button, ComponentParam, Context } from "necord";
import { DB_HANDLE } from "../db/db.module.js";
import type { EmbedView } from "../domain/embed-view.js";
import {
  EVENT_LATE_ADD_BUTTON,
  EVENT_LATE_IGNORE_BUTTON,
  EVENT_LATE_REPLIES,
  EVENT_LATE_ROLE_BUTTON,
  lateSignupRoleView,
  type LatePerson,
} from "../domain/event-late-signup.js";
import { TIMELINE_PUBLISHER, type TimelinePublisher } from "../domain/timeline.js";
import { EventsService } from "../events/events.service.js";
import { loadTimelinePeople, publishAfterCommit } from "../timeline/timeline-people.js";
import { toMessagePayload } from "./embed-message.js";
import { EventLateSignupService, type LateSignupTicket } from "./event-late-signup.service.js";

/** Subconjunto de ButtonInteraction usado aqui (os testes simulam). */
export interface LateSignupInteraction {
  user: { id: string };
  reply(options: { content: string; flags: MessageFlags.Ephemeral }): Promise<unknown>;
  deferReply(options: { flags: MessageFlags.Ephemeral }): Promise<unknown>;
  editReply(options: { content: string } | ReturnType<typeof toMessagePayload>): Promise<unknown>;
}

/** O que sai de um clique: texto puro, ou um embed com botões (a escolha da role). */
type Answer = string | { view: EmbedView };

/**
 * Botões da pergunta sobre quem entrou no meio da call (TASK-086, PE7/PE8).
 *
 * **Segurança (PE11, igual à TASK-085):** a pergunta fica no chat da call e todo mundo a enxerga, então
 * a checagem é no clique. Quem clicou vem de `interaction.user.id` → usuário do painel → papéis → CASL
 * `update` sobre o **evento recarregado agora**. **Quem** é inscrito vem do ticket guardado em memória,
 * nunca do custom id sozinho: um id forjado não aponta para ticket nenhum e não inscreve ninguém.
 *
 * **O aceite é por pessoa, com role.** Clicar em *Inscrever* não inscreve: abre a lista de roles com
 * vaga, efêmera para quem clicou. Sem vaga em nenhuma, a resposta diz isso — melhor que inventar uma
 * role ou mandar para a lista de espera alguém que já está dentro da call.
 *
 * **PE8 mora no banco:** `addLateEventSignup` grava `presence_from` no instante do aceite e a medição
 * de presença corta a sessão de voz da pessoa ali. Aqui não existe segunda conta de presença.
 */
@Injectable()
export class EventLateSignupInteractions {
  private readonly logger = new Logger("EventLateSignup");

  constructor(
    private readonly events: EventsService,
    private readonly questions: EventLateSignupService,
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(TIMELINE_PUBLISHER) private readonly timeline: TimelinePublisher,
  ) {}

  @Button(EVENT_LATE_ADD_BUTTON)
  async onAdd(
    @Context() [interaction]: [LateSignupInteraction],
    @ComponentParam("ticket") ticketId: string,
    @ComponentParam("alvo") targetDiscordId: string,
  ): Promise<void> {
    await this.guarded(interaction, ticketId, (ticket, actorUserId) => this.offerRoles(ticket, actorUserId, targetDiscordId));
  }

  @Button(EVENT_LATE_ROLE_BUTTON)
  async onRole(
    @Context() [interaction]: [LateSignupInteraction],
    @ComponentParam("ticket") ticketId: string,
    @ComponentParam("alvo") targetDiscordId: string,
    @ComponentParam("slotId") slotId: string,
  ): Promise<void> {
    await this.guarded(interaction, ticketId, (ticket, actorUserId) => this.add(ticket, actorUserId, targetDiscordId, slotId));
  }

  @Button(EVENT_LATE_IGNORE_BUTTON)
  async onIgnore(@Context() [interaction]: [LateSignupInteraction], @ComponentParam("ticket") ticketId: string): Promise<void> {
    await this.guarded(interaction, ticketId, (ticket, actorUserId) => this.ignore(ticket, actorUserId));
  }

  /**
   * Ticket, permissão e estado do evento antes de qualquer escrita; resposta sempre efêmera. Recusa não
   * escreve nada: nem banco, nem Discord, nem timeline.
   */
  private async guarded(interaction: LateSignupInteraction, ticketId: string, act: (ticket: LateSignupTicket, actorUserId: string) => Promise<Answer>): Promise<void> {
    let deferred = false;
    try {
      const ticket = this.questions.ticket(ticketId);
      // Ticket que não existe mais (bot reiniciado) ou já encerrado: nada foi feito, e o clique diz isso.
      if (!ticket || ticket.resolved) return void (await interaction.reply(ephemeral(EVENT_LATE_REPLIES.expired)));
      // Banco e cobrança da taxa passam fácil dos 3 s da interação.
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      deferred = true;

      const actorUserId = await findUserIdByDiscordId(this.handle.db, interaction.user.id);
      if (!actorUserId) return void (await interaction.editReply({ content: EVENT_LATE_REPLIES.notRegistered }));
      const event = await this.events.get(ticket.eventId);
      if (!event) return void (await interaction.editReply({ content: EVENT_LATE_REPLIES.notFound }));

      // PE11: caller do evento (owner) ou staff, pela mesma regra CASL da API.
      const ability = defineAbilityFor({ id: actorUserId, roles: await listRoles(this.handle.db, actorUserId) });
      if (!ability.can("update", asSubject("Event", { ownerId: event.ownerUserId }))) {
        return void (await interaction.editReply({ content: EVENT_LATE_REPLIES.denied }));
      }
      // Evento finalizado ou cancelado no meio da decisão: a pergunta morre junto.
      if (event.status !== "running") {
        this.questions.resolveTicket(ticket.id);
        return void (await interaction.editReply({ content: EVENT_LATE_REPLIES.notRunning(event.status) }));
      }

      const answer = await act(ticket, actorUserId);
      await interaction.editReply(typeof answer === "string" ? { content: answer } : toMessagePayload(answer.view));
    } catch (error) {
      this.logger.error(`Pergunta ${ticketId} de inscrição no meio da call falhou: ${String(error)}`);
      await this.safeRespond(interaction, EVENT_LATE_REPLIES.failed, deferred);
    }
  }

  /** *Inscrever*: lista as roles com vaga, efêmero para quem clicou (AC#2). Não escreve nada ainda. */
  private async offerRoles(ticket: LateSignupTicket, _actorUserId: string, targetDiscordId: string): Promise<Answer> {
    const person = personOf(ticket, targetDiscordId);
    if (!person) return EVENT_LATE_REPLIES.expired;
    const free = await listEventFreeRoleSlots(this.handle.db, ticket.eventId);
    if (free.length === 0) return EVENT_LATE_REPLIES.noRoles(person.displayName);
    return { view: lateSignupRoleView(ticket.id, person, free) };
  }

  /** Escolha da role: aqui a pessoa entra no evento de verdade, e a presença passa a contar (PE8). */
  private async add(ticket: LateSignupTicket, actorUserId: string, targetDiscordId: string, slotId: string): Promise<Answer> {
    const person = personOf(ticket, targetDiscordId);
    if (!person) return EVENT_LATE_REPLIES.expired;
    const targetUserId = await findUserIdByDiscordId(this.handle.db, targetDiscordId);
    // O alvo é que precisa de conta no painel: sem ela não há a quem inscrever nem de quem cobrar a taxa.
    if (!targetUserId) return `${person.displayName} ainda não tem conta no painel. Peça para usar /registrar antes de entrar no evento.`;

    const result = await addLateEventSignup(this.handle.db, { eventId: ticket.eventId, userId: targetUserId, slotId, actorUserId });
    if (!result.ok) {
      if (result.reason === "already_signed_up") return EVENT_LATE_REPLIES.alreadySignedUp(person.displayName);
      if (result.reason === "unknown_role") return EVENT_LATE_REPLIES.unknownRole;
      if (result.reason === "not_running") return EVENT_LATE_REPLIES.notRunning(result.status);
      if (result.reason === "insufficient_funds") return EVENT_LATE_REPLIES.insufficientFunds(person.displayName, result.fee, result.balance);
      if (result.reason === "role_full") {
        const free = await listEventFreeRoleSlots(this.handle.db, ticket.eventId);
        // Encheu enquanto ele decidia: oferece de novo o que sobrou, em vez de mandar clicar tudo outra vez.
        return free.length === 0 ? EVENT_LATE_REPLIES.noRoles(person.displayName) : { view: lateSignupRoleView(ticket.id, person, free) };
      }
      return EVENT_LATE_REPLIES.notFound;
    }

    const { signup } = result;
    this.questions.markHandled(ticket.eventId, targetDiscordId);
    ticket.accepted.add(targetDiscordId);
    // Último do lote respondido: a pergunta inteira acabou e os botões dela param de valer.
    if (ticket.people.every((p) => ticket.accepted.has(p.discordUserId))) this.questions.resolveTicket(ticket.id);

    await publishAfterCommit(this.timeline, this.logger, async () => {
      const people = await loadTimelinePeople(this.handle.db, [actorUserId, targetUserId]);
      return {
        action: "event.late_signup_added" as const,
        summary: `Inscrito no meio da call: ${ticket.eventName}`,
        actor: people.actor(actorUserId),
        target: people.target(targetUserId),
        recordId: signup.id,
        details: [
          { name: "Evento", value: ticket.eventName },
          { name: "Role", value: signup.roleName },
          { name: "Presença conta a partir de", value: result.presenceFrom.toISOString() },
          ...(result.charged ? [{ name: "Taxa de entrada", value: `${result.charged} Buffunfa` }] : []),
        ],
      };
    });

    const done = EVENT_LATE_REPLIES.added(person.displayName, signup.roleName);
    return result.charged ? `${done}\n${EVENT_LATE_REPLIES.charged(person.displayName, result.charged)}` : done;
  }

  /** *Ignorar*: encerra a pergunta sem inscrever ninguém, e ninguém do lote é perguntado de novo (AC#3). */
  private async ignore(ticket: LateSignupTicket, actorUserId: string): Promise<Answer> {
    const pending = ticket.people.filter((p) => !ticket.accepted.has(p.discordUserId));
    this.questions.resolveTicket(ticket.id);
    for (const person of pending) this.questions.markHandled(ticket.eventId, person.discordUserId);

    await publishAfterCommit(this.timeline, this.logger, async () => {
      const people = await loadTimelinePeople(this.handle.db, [actorUserId]);
      return {
        action: "event.late_signup_ignored" as const,
        summary: `Pergunta de inscrição ignorada: ${ticket.eventName}`,
        actor: people.actor(actorUserId),
        recordId: ticket.eventId,
        details: [
          { name: "Evento", value: ticket.eventName },
          { name: "Pessoas", value: pending.map((p) => p.displayName).join(", ") || "nenhuma" },
        ],
      };
    });
    return EVENT_LATE_REPLIES.ignored(pending.length);
  }

  private async safeRespond(interaction: LateSignupInteraction, content: string, deferred: boolean): Promise<void> {
    try {
      if (deferred) await interaction.editReply({ content });
      else await interaction.reply(ephemeral(content));
    } catch (error) {
      this.logger.error(`Não consegui responder a interação da pergunta de inscrição: ${String(error)}`);
    }
  }
}

const personOf = (ticket: LateSignupTicket, discordUserId: string): LatePerson | undefined => ticket.people.find((p) => p.discordUserId === discordUserId);

const ephemeral = (content: string) => ({ content, flags: MessageFlags.Ephemeral as const });
