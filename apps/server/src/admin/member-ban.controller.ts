import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, HttpCode, Inject, NotFoundException, Param, Post, UseGuards } from "@nestjs/common";
import { getBanStatus, type DbHandle } from "@albion-hub/db";
import { validateBanReason, type BanView } from "@albion-hub/shared";
import { Authorize, CurrentAuth } from "../auth/authorize.js";
import { SameOriginGuard } from "../auth/same-origin.guard.js";
import type { AuthContext } from "../auth/session.service.js";
import { DB_HANDLE } from "../db/db.module.js";
import { MemberBanService } from "../members/member-ban.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Banir e desbanir jogador (TASK-050).
 *
 * Permissão: `ban`/`Ban`, um subject só desta ação — staff e admin. Não é `UserRole` de propósito:
 * banir não é mexer em papel, e a staff não ganha com isso nenhum poder sobre papéis. A permissão da
 * staff é provisória até a revisão de papéis (TASK-052).
 *
 * As recusas que importam (banir a si mesmo, banir o último admin, banir quem já está banido) moram no
 * repositório, dentro da transação — aqui só viram código HTTP. Se outro caminho chamar o serviço amanhã,
 * herda as mesmas travas em vez de repetir o `if`.
 */
@Controller("admin/members/:userId/ban")
export class MemberBanController {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    private readonly bans: MemberBanService,
  ) {}

  /** Bane com motivo obrigatório. 200 com o estado do banimento para a tela trocar a linha sem recarregar. */
  @Post()
  @HttpCode(200)
  @UseGuards(SameOriginGuard)
  @Authorize("ban", "Ban")
  async ban(@Param("userId") rawUserId: string, @Body() body: { reason?: unknown }, @CurrentAuth() auth: AuthContext): Promise<{ ban: BanView }> {
    const userId = parseUserId(rawUserId);
    const reason = validateBanReason(body?.reason);
    if (!reason.ok) throw new BadRequestException(reason.error);

    const result = await this.bans.ban(userId, auth.user.id, reason.reason);
    if (!result.ok) {
      if (result.reason === "not_found") throw new NotFoundException("Usuário não encontrado.");
      if (result.reason === "self") throw new BadRequestException("Você não pode banir a si mesmo.");
      if (result.reason === "last_admin") throw new ConflictException("Não é possível banir o último admin.");
      if (result.reason === "protected_target") throw new ForbiddenException("Só um admin pode banir alguém da staff ou outro admin.");
      throw new ConflictException("Esse membro já está banido.");
    }

    const status = await getBanStatus(this.handle.db, userId);
    const authorName = auth.user.displayName ?? auth.user.discordUsername;
    return { ban: { bannedAt: (status?.bannedAt ?? new Date()).toISOString(), banReason: reason.reason, bannedByName: authorName } };
  }

  /** Desbanir devolve o acesso: o desbanido entra de novo pelo login normal. */
  @Delete()
  @HttpCode(204)
  @UseGuards(SameOriginGuard)
  @Authorize("ban", "Ban")
  async unban(@Param("userId") rawUserId: string, @CurrentAuth() auth: AuthContext): Promise<void> {
    const userId = parseUserId(rawUserId);
    const result = await this.bans.unban(userId, auth.user.id);
    if (!result.ok) {
      if (result.reason === "not_found") throw new NotFoundException("Usuário não encontrado.");
      throw new ConflictException("Esse membro não está banido.");
    }
  }
}

function parseUserId(userId: string): string {
  if (!UUID.test(userId)) throw new BadRequestException("Usuário inválido.");
  return userId;
}
