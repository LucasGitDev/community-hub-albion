import { Inject, Injectable } from "@nestjs/common";
import { ChannelType, Client } from "discord.js";
import type { EmbedView } from "../domain/embed-view.js";
import { toMessagePayload } from "./embed-message.js";
import { DISCORD_GUILD_ID } from "./discord-guild.gateway.js";

export const EVENT_VOICE_GATEWAY = Symbol("EVENT_VOICE_GATEWAY");
export const DISCORD_WAITING_VOICE_CHANNEL_ID = Symbol("DISCORD_WAITING_VOICE_CHANNEL_ID");
export const DISCORD_EVENT_CATEGORY_ID = Symbol("DISCORD_EVENT_CATEGORY_ID");

/**
 * Códigos dos erros de config, iguais aos que `describeDiscordError` traduz. Ficam como literal (e não
 * exportados) pelo mesmo motivo de `EVENTS_CHANNEL_NOT_TEXT`: quem lê o erro é o tradutor, por string.
 */
const EVENT_CATEGORY_INVALID = "EVENT_CATEGORY_INVALID";
const WAITING_VOICE_CHANNEL_INVALID = "WAITING_VOICE_CHANNEL_INVALID";
const EVENT_VOICE_CHANNEL_INVALID = "EVENT_VOICE_CHANNEL_INVALID";

/**
 * Porta da voz do evento (TASK-024, Q28/Q29). Quatro operações, nenhuma regra: criar o canal do evento
 * na categoria configurada, listar quem está num canal, mover alguém e apagar o canal. A decisão de
 * **quem** mover é do EventVoiceService (e das funções puras em domain/event-voice.ts); testes trocam
 * isto por um fake. Erro do Discord sobe para o chamador logar com `describeDiscordError`.
 */
export interface EventVoiceGateway {
  /** Cria o canal de voz do evento na categoria configurada e devolve o id. */
  createChannel(name: string, reason: string): Promise<string>;
  deleteChannel(channelId: string, reason: string): Promise<void>;
  /**
   * Discord ids de quem está agora no canal. Canal de evento já apagado devolve lista vazia (o finish
   * não pode travar por isso), mas o "Aguardando Evento" mal configurado lança: sem ele o start não
   * saberia que arrastou ninguém por engano de config.
   */
  listMembersInChannel(channelId: string): Promise<string[]>;
  moveMember(discordId: string, toChannelId: string, reason: string): Promise<void>;
  /**
   * Publica o menu de gestão no **chat de texto do próprio canal de voz** (TASK-085, PE9) e devolve o
   * id da mensagem. Canal de voz no Discord é text-based: não há canal de texto extra para criar.
   */
  postToChannel(channelId: string, view: EmbedView): Promise<string>;
  /**
   * Fecha ou abre a call (PE10). Fechar = negar "Conectar" para `@everyone` e liberar um a um os
   * inscritos; abrir = apagar essas sobrescritas. **Nunca** mexe em quem já está no canal: mudar
   * permissão de entrada não expulsa ninguém.
   */
  setChannelConnectLock(channelId: string, locked: boolean, allowDiscordIds: readonly string[], reason: string): Promise<void>;
  /** Id do canal fixo "Aguardando Evento": destino do finish e única origem do start (Q29). */
  readonly waitingChannelId: string;
}

type PermissionOverwritesLike = {
  edit(id: string, options: { Connect: boolean }, extra?: { reason?: string }): Promise<unknown>;
  delete(id: string, reason?: string): Promise<unknown>;
};
type VoiceChannelLike = {
  type: number;
  members?: Map<string, unknown> | { keys(): Iterable<string> };
  delete(reason?: string): Promise<unknown>;
  send?(payload: unknown): Promise<{ id: string }>;
  permissionOverwrites?: PermissionOverwritesLike;
};
type MemberLike = { voice: { setChannel(channelId: string, reason?: string): Promise<unknown> } };
type GuildLike = {
  channels: {
    fetch(id: string): Promise<VoiceChannelLike | null>;
    create(options: { name: string; type: number; parent: string; reason?: string }): Promise<{ id: string }>;
  };
  members: { fetch(id: string): Promise<MemberLike> };
};
export type VoiceClientLike = { guilds: { fetch(id: string): Promise<GuildLike> } };

@Injectable()
export class DiscordJsEventVoiceGateway implements EventVoiceGateway {
  constructor(
    @Inject(Client) private readonly client: VoiceClientLike,
    @Inject(DISCORD_GUILD_ID) private readonly guildId: string,
    @Inject(DISCORD_EVENT_CATEGORY_ID) private readonly categoryId: string,
    @Inject(DISCORD_WAITING_VOICE_CHANNEL_ID) readonly waitingChannelId: string,
  ) {}

  async createChannel(name: string, reason: string): Promise<string> {
    const guild = await this.client.guilds.fetch(this.guildId);
    const category = await guild.channels.fetch(this.categoryId);
    if (!category || category.type !== ChannelType.GuildCategory) {
      throw Object.assign(new Error("Categoria de evento não encontrada ou não é uma categoria"), { code: EVENT_CATEGORY_INVALID });
    }
    const created = await guild.channels.create({ name, type: ChannelType.GuildVoice, parent: this.categoryId, reason });
    return created.id;
  }

  async deleteChannel(channelId: string, reason: string): Promise<void> {
    const guild = await this.client.guilds.fetch(this.guildId);
    const channel = await guild.channels.fetch(channelId);
    // Canal já apagado na mão: nada a fazer, e o finish não pode falhar por isso.
    if (!channel) return;
    await channel.delete(reason);
  }

  async listMembersInChannel(channelId: string): Promise<string[]> {
    const guild = await this.client.guilds.fetch(this.guildId);
    const channel = await guild.channels.fetch(channelId);
    if (channel?.type === ChannelType.GuildVoice && channel.members) return [...channel.members.keys()];
    if (channelId === this.waitingChannelId) {
      throw Object.assign(new Error("Canal Aguardando Evento não encontrado ou não é de voz"), { code: WAITING_VOICE_CHANNEL_INVALID });
    }
    return [];
  }

  async moveMember(discordId: string, toChannelId: string, reason: string): Promise<void> {
    const guild = await this.client.guilds.fetch(this.guildId);
    const member = await guild.members.fetch(discordId);
    await member.voice.setChannel(toChannelId, reason);
  }

  async postToChannel(channelId: string, view: EmbedView): Promise<string> {
    const channel = await this.voiceChannel(channelId);
    if (!channel.send) throw Object.assign(new Error("Canal do evento não aceita mensagem"), { code: EVENT_VOICE_CHANNEL_INVALID });
    const message = await channel.send(toMessagePayload(view));
    return message.id;
  }

  /**
   * Fechar nega `Connect` para `@everyone` (cujo id de cargo é o id da guild) e libera cada inscrito;
   * abrir apaga as duas coisas. Mudar sobrescrita não mexe em quem já está conectado (PE10).
   */
  async setChannelConnectLock(channelId: string, locked: boolean, allowDiscordIds: readonly string[], reason: string): Promise<void> {
    const channel = await this.voiceChannel(channelId);
    const overwrites = channel.permissionOverwrites;
    if (!overwrites) throw Object.assign(new Error("Canal do evento sem sobrescritas de permissão"), { code: EVENT_VOICE_CHANNEL_INVALID });
    if (locked) {
      await overwrites.edit(this.guildId, { Connect: false }, { reason });
      for (const discordId of allowDiscordIds) await overwrites.edit(discordId, { Connect: true }, { reason });
      return;
    }
    await overwrites.delete(this.guildId, reason);
    for (const discordId of allowDiscordIds) await overwrites.delete(discordId, reason);
  }

  private async voiceChannel(channelId: string): Promise<VoiceChannelLike> {
    const guild = await this.client.guilds.fetch(this.guildId);
    const channel = await guild.channels.fetch(channelId);
    // Canal apagado na mão: quem chamou traduz isso em recusa para quem clicou, sem derrubar o evento.
    if (!channel || channel.type !== ChannelType.GuildVoice) {
      throw Object.assign(new Error("Canal de voz do evento não encontrado"), { code: EVENT_VOICE_CHANNEL_INVALID });
    }
    return channel;
  }
}
