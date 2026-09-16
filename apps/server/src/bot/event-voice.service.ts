import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { closeOpenVoiceSessionsInChannel, listEventSignupMembers, setEventVoiceChannelId, type DbHandle } from "@albion-hub/db";
import type { EventDto } from "@albion-hub/shared";
import { DB_HANDLE } from "../db/db.module.js";
import { describeDiscordError } from "../domain/discord-errors.js";
import { eventVoiceChannelName, membersToMove } from "../domain/event-voice.js";
import { EventsService } from "../events/events.service.js";
import { EVENT_VOICE_GATEWAY, type EventVoiceGateway } from "./event-voice.gateway.js";

/** Quantas pessoas foram movidas e quantas falharam numa operação. */
export interface VoiceMoveResult {
  moved: number;
  failed: number;
}

/**
 * Canal de voz por evento (TASK-024, Q28/Q29). Assina o hook pós-commit de transição:
 * - `→ running`: cria o canal na categoria configurada, guarda `events.voice_channel_id` e arrasta só
 *   quem está **confirmado** e **agora** no canal "Aguardando Evento" (Q29). Ninguém é puxado de outro
 *   canal, e a lista de espera não entra.
 * - `→ finished`: devolve **todo mundo** que estiver no canal do evento para "Aguardando Evento"
 *   (inclusive quem entrou sem inscrição, Q7) e apaga o canal.
 * - `→ cancelled` **com o evento rodando** (TASK-025, Q26): mesma coisa do finish, reusando
 *   `closeChannel`, e ainda fecha as sessões de voz que sobraram abertas naquele canal.
 *
 * Nada aqui pode desfazer a transição: ela já está gravada quando o hook roda, então toda falha do
 * Discord vira log com `describeDiscordError`. Falha de uma pessoa não aborta as outras — o evento
 * começa mesmo que o Discord recuse mover alguém que saiu da voz no meio do start.
 *
 * `openChannel`/`closeChannel` são públicos de propósito: o cancelamento (TASK-025) precisa devolver a
 * galera e apagar o canal exatamente como o finish, e tem que reusar isto em vez de repetir a lógica.
 */
@Injectable()
export class EventVoiceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("EventVoice");
  private readonly unsubscribe: (() => void)[] = [];

  constructor(
    private readonly events: EventsService,
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(EVENT_VOICE_GATEWAY) private readonly gateway: EventVoiceGateway,
  ) {}

  onModuleInit(): void {
    this.unsubscribe.push(
      this.events.onEventTransition(async ({ event, to }) => {
        if (to === "running") await this.openChannel(event);
        else if (to === "finished") await this.closeChannel(event);
        // Só evento que chegou a rodar tem canal; `closeChannel` sai na hora quando não tem.
        else if (to === "cancelled") await this.cancelChannel(event);
      }),
    );
  }

  onModuleDestroy(): void {
    for (const off of this.unsubscribe.splice(0)) off();
  }

  /**
   * Cria o canal do evento e puxa os confirmados que estão em "Aguardando Evento" (AC#1).
   * Idempotente no que importa: evento que já tem canal não ganha um segundo.
   */
  async openChannel(event: EventDto): Promise<VoiceMoveResult> {
    const empty: VoiceMoveResult = { moved: 0, failed: 0 };
    if (event.voiceChannelId) {
      this.logger.warn(`Evento ${event.id} já tinha canal de voz ${event.voiceChannelId}: não criei outro.`);
      return empty;
    }

    let channelId: string;
    try {
      channelId = await this.gateway.createChannel(eventVoiceChannelName(event.name), `Início do evento ${event.name}`);
    } catch (error) {
      this.logger.error(`Evento ${event.id}: falha ao criar o canal de voz. ${describeDiscordError(error)}`);
      return empty;
    }

    try {
      await setEventVoiceChannelId(this.handle.db, event.id, channelId);
    } catch (error) {
      // Canal criado mas não registrado: apaga para não deixar canal órfão que o finish nunca acharia.
      this.logger.error(`Evento ${event.id}: canal ${channelId} criado mas não gravado no banco: ${String(error)}`);
      await this.tryDelete(channelId, `Rollback do canal do evento ${event.name}`);
      return empty;
    }

    let present: string[];
    let signups: { discordId: string; status: "confirmed" | "waitlist" }[];
    try {
      present = await this.gateway.listMembersInChannel(this.gateway.waitingChannelId);
      signups = await listEventSignupMembers(this.handle.db, event.id);
    } catch (error) {
      this.logger.error(`Evento ${event.id}: canal criado, mas não consegui listar quem arrastar. ${describeDiscordError(error)}`);
      return empty;
    }

    const result = await this.moveAll(membersToMove(signups, present), channelId, `Início do evento ${event.name}`);
    this.logger.log(`Evento ${event.id}: canal ${channelId} criado; ${result.moved} confirmado(s) movido(s) de Aguardando Evento${result.failed > 0 ? `, ${result.failed} falha(s)` : ""}.`);
    return result;
  }

  /**
   * Devolve quem está no canal do evento para "Aguardando Evento" e apaga o canal (AC#2). O canal só é
   * apagado depois das devoluções: apagar antes jogaria todo mundo para fora da voz.
   */
  async closeChannel(event: EventDto): Promise<VoiceMoveResult> {
    const result: VoiceMoveResult = { moved: 0, failed: 0 };
    const { voiceChannelId } = event;
    if (!voiceChannelId) return result;

    let present: string[] = [];
    try {
      present = await this.gateway.listMembersInChannel(voiceChannelId);
    } catch (error) {
      this.logger.error(`Evento ${event.id}: falha ao listar quem está no canal ${voiceChannelId}. ${describeDiscordError(error)}`);
    }

    const moved = await this.moveAll(present, this.gateway.waitingChannelId, `Fim do evento ${event.name}`);
    result.moved = moved.moved;
    result.failed = moved.failed;

    if (await this.tryDelete(voiceChannelId, `Fim do evento ${event.name}`)) {
      try {
        await setEventVoiceChannelId(this.handle.db, event.id, null);
      } catch (error) {
        this.logger.error(`Evento ${event.id}: canal ${voiceChannelId} apagado mas o banco ainda aponta para ele: ${String(error)}`);
      }
    }
    this.logger.log(`Evento ${event.id}: ${result.moved} pessoa(s) devolvida(s) para Aguardando Evento${result.failed > 0 ? `, ${result.failed} falha(s)` : ""}.`);
    return result;
  }

  /**
   * Cancelamento com o evento em andamento (TASK-025, AC#2): devolve a galera e apaga o canal com o
   * mesmo `closeChannel` do finish — não há regra diferente, e duplicá-la só criaria dois jeitos de
   * esvaziar um canal. Depois fecha as sessões de voz ainda abertas naquele canal: quem o Discord não
   * conseguiu mover não gera sessão nova em "Aguardando Evento" e ficaria aberto num canal apagado.
   */
  async cancelChannel(event: EventDto): Promise<VoiceMoveResult> {
    const { voiceChannelId } = event;
    const result = await this.closeChannel(event);
    if (!voiceChannelId) return result;
    try {
      const closed = await closeOpenVoiceSessionsInChannel(this.handle.db, voiceChannelId, new Date());
      if (closed.length > 0) this.logger.log(`Evento ${event.id} cancelado: ${closed.length} sessão(ões) de voz aberta(s) fechada(s) no canal ${voiceChannelId}.`);
    } catch (error) {
      this.logger.error(`Evento ${event.id}: falha ao fechar as sessões de voz do canal ${voiceChannelId}: ${String(error)}`);
    }
    return result;
  }

  /** Move um por um: quem falhar (saiu da voz, sem permissão) não impede os outros de irem. */
  private async moveAll(discordIds: readonly string[], toChannelId: string, reason: string): Promise<VoiceMoveResult> {
    const result: VoiceMoveResult = { moved: 0, failed: 0 };
    for (const discordId of discordIds) {
      try {
        await this.gateway.moveMember(discordId, toChannelId, reason);
        result.moved++;
      } catch (error) {
        result.failed++;
        this.logger.error(`Falha ao mover ${discordId} para ${toChannelId}. ${describeDiscordError(error)}`);
      }
    }
    return result;
  }

  private async tryDelete(channelId: string, reason: string): Promise<boolean> {
    try {
      await this.gateway.deleteChannel(channelId, reason);
      return true;
    } catch (error) {
      this.logger.error(`Falha ao apagar o canal de voz ${channelId}. ${describeDiscordError(error)}`);
      return false;
    }
  }
}
