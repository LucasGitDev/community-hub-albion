import { parseDiscordNickname } from "@albion-hub/shared";

/**
 * Regras puras do import de membros já regularizados no Discord (TASK-042). Sem I/O: o serviço faz banco e Albion.
 */
export const IMPORT_MEMBERS_COMMAND = {
  name: "importar-membros",
  description: "Importa os membros que já têm cargo Membro e apelido no servidor (só admin)",
} as const;

export const IMPORT_MEMBERS_REPLIES = {
  wrongGuild: "Esse comando só funciona no servidor da guilda.",
  notAdmin: "Só admin do painel pode importar membros.",
  failed: "Não consegui importar os membros agora. Tente de novo em instantes.",
  forbidden:
    "O Discord recusou a lista de membros (403). Ligue o **Server Members Intent** em Discord Developer Portal → Bot → Privileged Gateway Intents e tente de novo.",
} as const;

/** Membro da guild como o gateway entrega (só o que o import usa). */
export interface GuildMemberSnapshot {
  discordId: string;
  username: string;
  globalName: string | null;
  /** Apelido no servidor (`nick` da API). null = nunca definiu. */
  nickname: string | null;
  avatar: string | null;
  roleIds: readonly string[];
  bot: boolean;
}

export type MemberImportPlan =
  | { kind: "import"; member: GuildMemberSnapshot; guildTag: string | null; nick: string }
  | { kind: "skip"; member: GuildMemberSnapshot; reason: string }
  | { kind: "conflict"; member: GuildMemberSnapshot; reason: string };

/**
 * Decide o que fazer com cada membro (AC#3, AC#5):
 * - bot, sem o cargo Membro ou sem apelido → ignorado (não é erro: é gente fora do fluxo);
 * - apelido que não vira nick válido → conflito, listado no resumo, sem parar o import;
 * - resto → importa com tag e nick separados.
 */
export function planMemberImport(member: GuildMemberSnapshot, memberRoleId: string): MemberImportPlan {
  if (member.bot) return { kind: "skip", member, reason: "é bot" };
  if (!member.roleIds.includes(memberRoleId)) return { kind: "skip", member, reason: "sem o cargo Membro" };
  if (!member.nickname?.trim()) return { kind: "skip", member, reason: "sem apelido no servidor" };
  const parsed = parseDiscordNickname(member.nickname);
  if (!parsed.ok) return { kind: "conflict", member, reason: parsed.error };
  return { kind: "import", member, guildTag: parsed.guildTag, nick: parsed.nick };
}

export interface MemberImportSummary {
  created: number;
  updated: number;
  skipped: number;
  /** Apelido que não virou nick: `@apelido — motivo`. */
  conflicts: string[];
  /** Conferências do Albion por resultado (AC#7). */
  albion: { found: number; notFound: number; unavailable: number; disabled: number };
}

export const emptyImportSummary = (): MemberImportSummary => ({
  created: 0,
  updated: 0,
  skipped: 0,
  conflicts: [],
  albion: { found: 0, notFound: 0, unavailable: 0, disabled: 0 },
});

/**
 * Discord responde 403 em `GET /guilds/{id}/members` quando o Server Members Intent está desligado.
 * Mesma detecção no comando do bot e no endpoint de admin (TASK-043): um erro, uma explicação.
 */
export const isMissingMembersIntent = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "status" in error && (error as { status: unknown }).status === 403;

/** Mesmas mensagens sem markdown, para o corpo JSON da API de admin (TASK-043). */
export const IMPORT_MEMBERS_HTTP_ERRORS = {
  botOffline: "O bot do Discord está desligado neste servidor, então não dá para ler a lista de membros. Ligue o bot e tente de novo.",
  forbidden:
    "O Discord recusou a lista de membros (403). Ligue o Server Members Intent em Discord Developer Portal → Bot → Privileged Gateway Intents e tente de novo.",
  failed: "Não consegui importar os membros agora. Tente de novo em instantes.",
} as const;

/** Limite de conflitos listados na resposta efêmera (2000 caracteres no Discord). */
export const MAX_LISTED_CONFLICTS = 10;

/** Resumo em PT-BR da importação (AC#1). Conflitos aparecem com o motivo, truncados se forem muitos. */
export function buildImportSummaryReply(summary: MemberImportSummary): string {
  const lines = [
    `Importação concluída: **${summary.created}** criados, **${summary.updated}** atualizados, **${summary.skipped}** ignorados, **${summary.conflicts.length}** conflitos.`,
  ];
  const { found, notFound, unavailable, disabled } = summary.albion;
  if (disabled > 0) lines.push("Conferência no Albion desligada (ALBION_REGION vazia): nenhum nick foi verificado.");
  else if (found + notFound + unavailable > 0)
    lines.push(`Albion: ${found} encontrados, ${notFound} não encontrados, ${unavailable} sem resposta da API.`);
  if (summary.conflicts.length > 0) {
    lines.push("", "Conflitos (apelido não virou nick, ninguém foi alterado):");
    for (const conflict of summary.conflicts.slice(0, MAX_LISTED_CONFLICTS)) lines.push(`- ${conflict}`);
    if (summary.conflicts.length > MAX_LISTED_CONFLICTS) lines.push(`- ... e mais ${summary.conflicts.length - MAX_LISTED_CONFLICTS}.`);
  }
  return lines.join("\n");
}
