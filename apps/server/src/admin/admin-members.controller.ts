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
}

export interface AdminMembersResponse {
  members: AdminMemberDto[];
  total: number;
  page: number;
  pageSize: number;
  counts: AdminMembersPage["counts"];
}

/**
 * Lista de membros do painel para o admin (TASK-043).
 *
 * Permissão: `read`/`UserRole` na listagem — mesma regra de `/admin/users` (TASK-011, Q13). `UserRole` é o único
 * subject que nenhum papel abaixo de admin toca: staff tem `manage` em evento, saque e pedido de nick, mas nada em
 * `UserRole`, então só quem tem `manage all` (admin) passa (AC#5). A tela `/admin/membros` usa a mesma dupla no
 * gate de UI, como o resto do painel. O import é uma ação de admin de verdade e checa `manage`/`all`, exatamente a
 * regra que o `/importar-membros` do bot já aplica: um comportamento, dois canais.
 */
@Controller("admin/members")
export class AdminMembersController {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Optional() @Inject(MEMBER_IMPORTER) private readonly importer: MemberImporter | null = null,
  ) {}

  @Get()
  @Authorize("read", "UserRole")
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
