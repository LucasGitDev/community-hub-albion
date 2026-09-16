import { Inject, Injectable } from "@nestjs/common";
import { Client, Routes } from "discord.js";
import type { GuildMemberSnapshot } from "../domain/member-import.js";
import { DISCORD_GUILD_ID } from "./discord-guild.gateway.js";

export const DISCORD_GUILD_MEMBERS_GATEWAY = Symbol("DISCORD_GUILD_MEMBERS_GATEWAY");

/** Porta da leitura da lista de membros da guild (TASK-042). Testes usam fake; erro do Discord sobe pro chamador. */
export interface DiscordGuildMembersGateway {
  listMembers(): Promise<GuildMemberSnapshot[]>;
}

/** Página máxima do endpoint `GET /guilds/{id}/members`. O servidor tem ~32 membros: uma página basta, mas paginamos. */
const PAGE_SIZE = 1000;
/** Trava de segurança: 20 páginas = 20k membros, muito além do servidor real. */
const MAX_PAGES = 20;

type RestLike = { get(route: string, options?: { query?: URLSearchParams }): Promise<unknown> };
export type MembersClientLike = { rest: RestLike };

interface RawMember {
  user?: { id?: unknown; username?: unknown; global_name?: unknown; avatar?: unknown; bot?: unknown };
  nick?: unknown;
  roles?: unknown;
}

/** Converte o JSON cru da API; membro sem `user.id`/`username` (não deveria acontecer) é descartado. */
export function toGuildMemberSnapshot(raw: unknown): GuildMemberSnapshot | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { user, nick, roles } = raw as RawMember;
  const id = user?.id;
  const username = user?.username;
  if (typeof id !== "string" || typeof username !== "string") return null;
  return {
    discordId: id,
    username,
    globalName: typeof user?.global_name === "string" ? user.global_name : null,
    nickname: typeof nick === "string" ? nick : null,
    avatar: typeof user?.avatar === "string" ? user.avatar : null,
    roleIds: Array.isArray(roles) ? roles.filter((r): r is string => typeof r === "string") : [],
    bot: user?.bot === true,
  };
}

/**
 * Lista os membros por REST (`GET /guilds/{id}/members?limit=1000&after=<id>`), sem depender do cache do gateway.
 *
 * Operacional: esse endpoint exige o **Server Members Intent** (privileged) ligado no Discord Developer Portal →
 * Bot → Privileged Gateway Intents. Sem ele o Discord responde **403** e o comando explica isso para o admin.
 * O bot não liga o intent no gateway (ele só precisa da leitura pontual do REST no import).
 */
@Injectable()
export class DiscordJsGuildMembersGateway implements DiscordGuildMembersGateway {
  constructor(
    @Inject(Client) private readonly client: MembersClientLike,
    @Inject(DISCORD_GUILD_ID) private readonly guildId: string,
  ) {}

  async listMembers(): Promise<GuildMemberSnapshot[]> {
    const members: GuildMemberSnapshot[] = [];
    let after: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (after) query.set("after", after);
      const body = await this.client.rest.get(Routes.guildMembers(this.guildId), { query });
      if (!Array.isArray(body) || body.length === 0) break;
      for (const raw of body) {
        const member = toGuildMemberSnapshot(raw);
        if (member) members.push(member);
      }
      if (body.length < PAGE_SIZE) break;
      after = members.at(-1)?.discordId;
      if (!after) break;
    }
    return members;
  }
}
