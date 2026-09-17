import { BadGatewayException, Controller, Get, Inject, Optional, Post, Query, ServiceUnavailableException, UseGuards } from "@nestjs/common";
import { listAdminMembers, type AdminMembersPage, type DbHandle } from "@albion-hub/db";
import { normalizeMemberSearch, parseMemberFilter, parseMemberPagination } from "@albion-hub/shared";
import { Authorize } from "../auth/authorize.js";
import { SameOriginGuard } from "../auth/same-origin.guard.js";
import { DB_HANDLE } from "../db/db.module.js";
import { IMPORT_MEMBERS_HTTP_ERRORS, isMissingMembersIntent, type MemberImportSummary } from "../domain/member-import.js";
import { MEMBER_IMPORTER, type MemberImporter } from "../members/member-importer.token.js";

/** Um membro como a API entrega: datas em ISO, nunca objeto Date cru. */
interface AdminMemberDto {
  id: string;
  discordId: string;
  discordUsername: string;
  displayName: string | null;
  gameNick: string | null;
  guildTag: string | null;
  roles: string[];
  createdAt: string;
  albion: { status: string | null; playerId: string | null; guildName: string | null; checkedAt: string | null };
  /** Banimento vigente (TASK-050); `null` = conta ativa. */
  ban: { bannedAt: string; reason: string; byName: string | null } | null;
  /** Data em que a limpeza diária viu que a conta saiu do servidor (TASK-049); `null` = está no servidor. */
  leftGuildAt: string | null;
}

export interface AdminMembersResponse {
  members: AdminMemberDto[];
  total: number;
  page: number;
  pageSize: number;
  counts: AdminMembersPage["counts"];
}

/**
 * Lista de membros do painel (TASK-043).
 *
 * Permissão da listagem: `read`/`MemberProfile` (TASK-047, G3). Admin passa por `manage all`, staff pela
 * regra própria. Antes eram duas checagens soltas (`read`/`UserRole` ou `ban`/`Ban`) porque a staff só
 * chegava aqui de carona no banimento; agora a lista e as ações da ficha do membro têm um subject só, e a
 * permissão de ler a lista deixa de depender de poder banir. Member e caller não têm a regra e seguem em 403.
 *
 * As escritas não se movem: o import continua exigindo `manage`/`all` (admin de verdade), exatamente a
 * regra que o `/importar-membros` do bot já aplica — um comportamento, dois canais. Banir tem controller
 * próprio (`MemberBanController`), com o subject `Ban`.
 */
@Controller("admin/members")
export class AdminMembersController {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Optional() @Inject(MEMBER_IMPORTER) private readonly importer: MemberImporter | null = null,
  ) {}

  @Get()
  @Authorize("read", "MemberProfile")
  async list(
    @Query("search") search?: string,
    @Query("filter") filter?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ): Promise<AdminMembersResponse> {
    const pagination = parseMemberPagination(page, pageSize);
    const result = await listAdminMembers(this.handle.db, {
      search: normalizeMemberSearch(search),
      filter: parseMemberFilter(filter),
      pageSize: pagination.pageSize,
      offset: pagination.offset,
    });
    return {
      members: result.members.map((m) => ({
        ...m,
        createdAt: m.createdAt.toISOString(),
        albion: { ...m.albion, checkedAt: m.albion.checkedAt?.toISOString() ?? null },
        ban: m.ban ? { bannedAt: m.ban.bannedAt.toISOString(), reason: m.ban.reason, byName: m.ban.byName } : null,
        leftGuildAt: m.leftGuildAt?.toISOString() ?? null,
      })),
      total: result.total,
      page: pagination.page,
      pageSize: pagination.pageSize,
      counts: result.counts,
    };
  }

  /**
   * Dispara a importação dos membros já regularizados no Discord e devolve o resumo (AC#1 da TASK-042).
   * Nenhuma regra mora aqui: é o mesmo serviço do comando do bot.
   */
  @Post("import")
  @UseGuards(SameOriginGuard)
  @Authorize("manage", "all")
  async import(): Promise<MemberImportSummary> {
    if (!this.importer) throw new ServiceUnavailableException(IMPORT_MEMBERS_HTTP_ERRORS.botOffline);
    try {
      return await this.importer.import();
    } catch (error) {
      // 403 do Discord tem uma causa só e uma solução só: ligar o intent. Qualquer outra falha é transitória.
      throw new BadGatewayException(isMissingMembersIntent(error) ? IMPORT_MEMBERS_HTTP_ERRORS.forbidden : IMPORT_MEMBERS_HTTP_ERRORS.failed);
    }
  }
}
