import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { listEventSignupMembers, setEventDiscordMessageId, type DbHandle, type EventSignupMember } from "@albion-hub/db";
import type { EventDto } from "@albion-hub/shared";
import { DB_HANDLE } from "../db/db.module.js";
import { describeDiscordError } from "../domain/discord-errors.js";
import { buildEventEmbed, type EventEmbedMember, type EventEmbedRole } from "../domain/event-embed.js";
import { EventSignupsService } from "../events/event-signups.service.js";
import { EventsService } from "../events/events.service.js";
import { EVENTS_CHANNEL_GATEWAY, type EventsChannelGateway } from "./events-channel.gateway.js";

const UNKNOWN_MESSAGE = 10008;

/**
 * Mensagem de inscrição do evento no canal de eventos (TASK-022, AC#1). Assina os hooks pós-commit:
 * transição de estado (abriu, fechou, começou, cancelou) e mudança na lista (entrou, saiu, caller moveu).
 * O evento vira mensagem quando abre; depois disso toda mudança edita a mesma mensagem, então os botões
 * e as vagas nunca ficam mentindo. Falha do Discord é logada e nunca lança: a inscrição já está gravada.
 */
@Injectable()
export class EventEmbedService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("EventEmbed");
  private readonly unsubscribe: (() => void)[] = [];

  constructor(
    private readonly events: EventsService,
    private readonly signups: EventSignupsService,
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(EVENTS_CHANNEL_GATEWAY) private readonly gateway: EventsChannelGateway,
  ) {}

  onModuleInit(): void {
    this.unsubscribe.push(
      this.events.onEventTransition((e) => this.sync(e.event.id)),
      this.signups.onSignupChanged((e) => this.sync(e.eventId)),
    );
  }

  onModuleDestroy(): void {
    for (const off of this.unsubscribe.splice(0)) off();
  }

  /** Publica ou atualiza a mensagem do evento com o estado atual. Rascunho nunca é publicado (AC#1). */
  async sync(eventId: string): Promise<void> {
    let event: EventDto | null;
    let members: EventSignupMember[];
    try {
      event = await this.events.get(eventId);
      members = event ? await listEventSignupMembers(this.handle.db, eventId) : [];
    } catch (error) {
      this.logger.error(`Embed do evento ${eventId}: falha ao ler o banco: ${String(error)}`);
      return;
    }
    if (!event) {
      this.logger.error(`Embed do evento ${eventId}: evento não encontrado`);
      return;
    }
    const view = buildEventEmbed({
      eventId: event.id,
      name: event.name,
      description: event.description,
      templateName: event.templateName,
      status: event.status,
      startsAt: event.startsAt ? new Date(event.startsAt) : null,
      roles: rolesWithMembers(event, members),
      cancelReason: event.cancelReason,
    });

    if (event.discordMessageId) {
      try {
        await this.gateway.editEvent(event.discordMessageId, view);
        return;
      } catch (error) {
        this.logger.error(`Embed do evento ${eventId}: falha ao editar a mensagem ${event.discordMessageId}. ${describeDiscordError(error)}`);
        // Mensagem apagada no canal: republica enquanto a inscrição ainda está aberta (a galera precisa dos botões).
        if (!isUnknownMessage(error) || event.status !== "open") return;
      }
    } else if (event.status !== "open") {
      return; // rascunho ou evento que nunca foi publicado: não vale publicar agora.
    }

    try {
      await setEventDiscordMessageId(this.handle.db, eventId, await this.gateway.postEvent(view));
    } catch (error) {
      this.logger.error(`Embed do evento ${eventId}: falha ao publicar no canal de eventos. ${describeDiscordError(error)}`);
    }
  }
}

/** Cruza as vagas do evento com os inscritos ativos, mantendo a ordem das roles e da espera. */
function rolesWithMembers(event: EventDto, members: readonly EventSignupMember[]): EventEmbedRole[] {
  const person = (m: EventSignupMember): EventEmbedMember => ({ discordId: m.discordId, gameNick: m.gameNick });
  return event.roles.map((role) => ({
    slotId: role.id,
    name: role.name,
    slots: role.slots,
    confirmed: members.filter((m) => m.slotId === role.id && m.status === "confirmed").map(person),
    waitlist: members.filter((m) => m.slotId === role.id && m.status === "waitlist").sort((a, b) => a.position - b.position).map(person),
  }));
}

const isUnknownMessage = (error: unknown) => typeof error === "object" && error !== null && (error as { code?: unknown }).code === UNKNOWN_MESSAGE;
