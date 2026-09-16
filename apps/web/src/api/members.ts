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
