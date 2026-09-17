import type { MemberFilter, Role } from "@albion-hub/shared";
import { api } from "./http";

/** Lista de membros do admin (TASK-043) e disparo do import do Discord (TASK-042). */

export interface AdminMember {
  id: string;
  discordId: string;
  discordUsername: string;
  displayName: string | null;
  gameNick: string | null;
  guildTag: string | null;
  roles: Role[];
  createdAt: string;
  albion: { status: string | null; playerId: string | null; guildName: string | null; checkedAt: string | null };
  /** Banimento vigente (TASK-050); `null` = conta ativa. */
  ban: { bannedAt: string; reason: string; byName: string | null } | null;
  /** Data em que a limpeza diária viu a conta fora do servidor do Discord (TASK-049); `null` = está lá. */
  leftGuildAt: string | null;
}

export interface AdminMembersPage {
  members: AdminMember[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<MemberFilter, number>;
}

export interface MemberImportSummary {
  created: number;
  updated: number;
  skipped: number;
  conflicts: string[];
  albion: { found: number; notFound: number; unavailable: number; disabled: number };
}

export function fetchAdminMembers(query: { search: string; filter: MemberFilter; page: number }): Promise<AdminMembersPage> {
  const params = new URLSearchParams({ filter: query.filter, page: String(query.page) });
  if (query.search.trim()) params.set("search", query.search.trim());
  return api<AdminMembersPage>(`/api/admin/members?${params.toString()}`);
}

export const importDiscordMembers = (): Promise<MemberImportSummary> => api<MemberImportSummary>("/api/admin/members/import", { method: "POST" });

/** Gestão de um membro (TASK-045): conferir o nick no Albion, editar e escrever notas. */

export type AlbionCheck = AdminMember["albion"];

export interface UserNote {
  id: string;
  kind: "staff" | "system";
  body: string;
  createdAt: string;
  author: { id: string; name: string } | null;
}

/** Confere o nick na API do Albion agora e devolve o bloco atualizado da linha. */
export const checkMemberAlbion = (userId: string): Promise<{ albion: AlbionCheck }> =>
  api<{ albion: AlbionCheck }>(`/api/admin/members/${userId}/albion-check`, { method: "POST" });

export const updateMember = (userId: string, body: { nick: string; guildTag: string }): Promise<{ nick: string; guildTag: string | null; note: UserNote | null }> =>
  api(`/api/admin/members/${userId}`, { method: "PATCH", body: JSON.stringify(body) });

export const fetchMemberNotes = (userId: string): Promise<{ notes: UserNote[] }> => api(`/api/admin/members/${userId}/notes`);

export const addMemberNote = (userId: string, body: string): Promise<{ note: UserNote }> =>
  api(`/api/admin/members/${userId}/notes`, { method: "POST", body: JSON.stringify({ body }) });

/** Banimento de jogador (TASK-050). Banir exige motivo; desbanir é o único caminho de volta. */
export const banMember = (userId: string, reason: string): Promise<{ ban: { bannedAt: string; banReason: string; bannedByName: string | null } }> =>
  api(`/api/admin/members/${userId}/ban`, { method: "POST", body: JSON.stringify({ reason }) });

export const unbanMember = (userId: string): Promise<void> => api(`/api/admin/members/${userId}/ban`, { method: "DELETE" }) as Promise<void>;
