import { Inject, Injectable } from "@nestjs/common";
import { Client } from "discord.js";

export const DISCORD_GUILD_GATEWAY = Symbol("DISCORD_GUILD_GATEWAY");
export const DISCORD_GUILD_ID = Symbol("DISCORD_GUILD_ID");

/** Porta das escritas na guild (TASK-014). Testes usam fake; erros do Discord sobem para o chamador tratar. */
export interface DiscordGuildGateway {
  setNickname(discordId: string, nick: string, reason: string): Promise<void>;
  addRole(discordId: string, roleId: string, reason: string): Promise<void>;
}

/** Discord não deixa bot alterar apelido do dono da guild. */
export const GUILD_OWNER_NICKNAME = "GUILD_OWNER_NICKNAME";

type MemberLike = { setNickname(nick: string, reason?: string): Promise<unknown>; roles: { add(roleId: string, reason?: string): Promise<unknown> } };
type GuildLike = { ownerId: string; members: { fetch(id: string): Promise<MemberLike> } };
export type GuildClientLike = { guilds: { fetch(id: string): Promise<GuildLike> } };

@Injectable()
export class DiscordJsGuildGateway implements DiscordGuildGateway {
  constructor(
    @Inject(Client) private readonly client: GuildClientLike,
    @Inject(DISCORD_GUILD_ID) private readonly guildId: string,
  ) {}

  async setNickname(discordId: string, nick: string, reason: string): Promise<void> {
    const guild = await this.client.guilds.fetch(this.guildId);
    if (guild.ownerId === discordId) {
      throw Object.assign(new Error("Dono da guild: Discord não permite bot alterar o apelido"), { code: GUILD_OWNER_NICKNAME });
    }
    const member = await guild.members.fetch(discordId);
    await member.setNickname(nick, reason);
  }

  async addRole(discordId: string, roleId: string, reason: string): Promise<void> {
    const guild = await this.client.guilds.fetch(this.guildId);
    const member = await guild.members.fetch(discordId);
    await member.roles.add(roleId, reason);
  }
}
