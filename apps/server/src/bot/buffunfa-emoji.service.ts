import { readFile } from "node:fs/promises";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { Client } from "discord.js";
import { Once } from "necord";
import { BUFFUNFA_EMOJI_NAME } from "../domain/buffunfa-emoji.js";
import { describeDiscordError } from "../domain/discord-errors.js";
import { DISCORD_GUILD_ID } from "./discord-guild.gateway.js";

export const BUFFUNFA_EMOJI_ID = Symbol("BUFFUNFA_EMOJI_ID");
export const BUFFUNFA_EMOJI_FILE = Symbol("BUFFUNFA_EMOJI_FILE");
export const BUFFUNFA_EMOJI_GATEWAY = Symbol("BUFFUNFA_EMOJI_GATEWAY");

/** Porta dos emojis da guild. Testes usam fake; erros do Discord sobem para o serviço logar e seguir. */
export interface GuildEmojiGateway {
  list(): Promise<{ id: string; name: string | null }[]>;
  create(name: string, image: Buffer): Promise<{ id: string }>;
}

type EmojiLike = { id: string; name: string | null };
type GuildEmojiLike = { emojis: { fetch(): Promise<Map<string, EmojiLike> | EmojiLike[]>; create(options: { name: string; attachment: Buffer }): Promise<EmojiLike> } };
export type EmojiClientLike = { guilds: { fetch(id: string): Promise<GuildEmojiLike> } };

@Injectable()
export class DiscordJsGuildEmojiGateway implements GuildEmojiGateway {
  constructor(
    @Inject(Client) private readonly client: EmojiClientLike,
    @Inject(DISCORD_GUILD_ID) private readonly guildId: string,
  ) {}

  async list(): Promise<EmojiLike[]> {
    const guild = await this.client.guilds.fetch(this.guildId);
    const emojis = await guild.emojis.fetch();
    return [...(emojis instanceof Map ? emojis.values() : emojis)];
  }

  async create(name: string, image: Buffer): Promise<{ id: string }> {
    const guild = await this.client.guilds.fetch(this.guildId);
    return guild.emojis.create({ name, attachment: image });
  }
}

/**
 * Resolve o emoji da Buffunfa no boot (F6-28).
 *
 * Precedência: **env > descoberto na guild > texto puro**. O env ganha porque é o que o dono da
 * instalação controla à mão; a busca por nome existe para o caso comum de o emoji já estar lá; e a
 * criação a partir do PNG versionado é a conveniência, não a regra.
 *
 * **Nada aqui derruba o bot.** Falta de permissão, slot cheio, arquivo ausente — tudo vira um aviso no
 * log e o id fica `null`, o que faz a saída ser `340 BUF`. Bot que não sobe por causa de emoji é
 * inaceitável: o emoji é enfeite, o resto do sistema não é.
 */
@Injectable()
export class BuffunfaEmojiService {
  private readonly logger = new Logger("Buffunfa");
  private id: string | null = null;

  constructor(
    @Inject(BUFFUNFA_EMOJI_GATEWAY) private readonly emojis: GuildEmojiGateway,
    @Optional() @Inject(BUFFUNFA_EMOJI_ID) private readonly envId: string | null = null,
    @Optional() @Inject(BUFFUNFA_EMOJI_FILE) private readonly file: string | null = null,
  ) {}

  /** Id vigente, ou null quando a saída é o texto puro. Quem exibe valor pergunta aqui, nunca ao env. */
  get emojiId(): string | null {
    return this.id;
  }

  @Once("clientReady")
  async onReady(): Promise<void> {
    this.id = await this.resolve();
  }

  private async resolve(): Promise<string | null> {
    if (this.envId) {
      this.logger.log(`Emoji da Buffunfa vindo do env: ${this.envId}`);
      return this.envId;
    }
    try {
      const found = (await this.emojis.list()).find((e) => e.name === BUFFUNFA_EMOJI_NAME);
      if (found) {
        this.logger.log(`Emoji :${BUFFUNFA_EMOJI_NAME}: já existe na guild: ${found.id}`);
        return found.id;
      }
      if (!this.file) {
        this.logger.warn(`Sem PNG configurado para criar :${BUFFUNFA_EMOJI_NAME}:; a Buffunfa sai como texto (340 BUF).`);
        return null;
      }
      const created = await this.emojis.create(BUFFUNFA_EMOJI_NAME, await readFile(this.file));
      this.logger.log(`Emoji :${BUFFUNFA_EMOJI_NAME}: criado na guild: ${created.id}`);
      return created.id;
    } catch (error) {
      // Permissão negada, slot cheio, arquivo ilegível: o bot segue, só sem emoji (F6-28).
      this.logger.warn(
        `Não foi possível preparar o emoji :${BUFFUNFA_EMOJI_NAME}: (${describeDiscordError(error)}). A Buffunfa sai como texto (340 BUF); crie o emoji à mão e configure DISCORD_BUFFUNFA_EMOJI_ID.`,
      );
      return null;
    }
  }
}
