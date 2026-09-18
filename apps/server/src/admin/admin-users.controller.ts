import { BadRequestException, ConflictException, Controller, Delete, Get, HttpCode, Inject, Logger, NotFoundException, Param, Put, UseGuards } from "@nestjs/common";
import { grantRole, listUsersWithRoles, revokeRoleGuarded, userExists, type DbHandle, type UserWithRoles } from "@albion-hub/db";
import { isRole, type Role } from "@albion-hub/shared";
import { Authorize, CurrentAuth } from "../auth/authorize.js";
import { SameOriginGuard } from "../auth/same-origin.guard.js";
import type { AuthContext } from "../auth/session.service.js";
import { DB_HANDLE } from "../db/db.module.js";
import { TIMELINE_PUBLISHER, type TimelinePublisher } from "../domain/timeline.js";
import { loadTimelinePeople, publishAfterCommit } from "../timeline/timeline-people.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `member` é a base de todo usuário logado e não é gerenciável aqui. */
const MANAGEABLE_ROLES = ["caller", "staff", "admin"] as const satisfies readonly Role[];

function parseTarget(userId: string, role: string): { userId: string; role: Role } {
  if (!UUID.test(userId)) throw new BadRequestException("Usuário inválido.");
  if (!isRole(role) || !(MANAGEABLE_ROLES as readonly string[]).includes(role)) throw new BadRequestException("Papel inválido.");
  return { userId, role };
}

/** Gestão de papéis por admin (TASK-011, Q13). */
@Controller("admin/users")
export class AdminUsersController {
  private readonly logger = new Logger("AdminUsers");

  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(TIMELINE_PUBLISHER) private readonly timeline: TimelinePublisher,
  ) {}

  @Get()
  @Authorize("read", "UserRole")
  async list(): Promise<{ users: UserWithRoles[] }> {
    return { users: await listUsersWithRoles(this.handle.db) };
  }

  @Put(":userId/roles/:role")
  @HttpCode(204)
  @UseGuards(SameOriginGuard)
  @Authorize("update", "UserRole")
  async grant(@Param("userId") rawUserId: string, @Param("role") rawRole: string, @CurrentAuth() auth: AuthContext): Promise<void> {
    const { userId, role } = parseTarget(rawUserId, rawRole);
    if (!(await userExists(this.handle.db, userId))) throw new NotFoundException("Usuário não encontrado.");
    // Conceder de novo o que já existe não muda nada, então também não aparece na timeline (TASK-077).
    if (await grantRole(this.handle.db, userId, role, auth.user.id)) await this.publish("account.role_granted", "Papel concedido", userId, role, auth.user.id);
  }

  @Delete(":userId/roles/:role")
  @HttpCode(204)
  @UseGuards(SameOriginGuard)
  @Authorize("update", "UserRole")
  async revoke(@Param("userId") rawUserId: string, @Param("role") rawRole: string, @CurrentAuth() auth: AuthContext): Promise<void> {
    const { userId, role } = parseTarget(rawUserId, rawRole);
    if (!(await userExists(this.handle.db, userId))) throw new NotFoundException("Usuário não encontrado.");
    const result = await revokeRoleGuarded(this.handle.db, userId, role);
    if (result === "last_admin") throw new ConflictException("Não é possível remover o último admin.");
    if (result === "revoked") await this.publish("account.role_revoked", "Papel removido", userId, role, auth.user.id);
  }

  private publish(action: "account.role_granted" | "account.role_revoked", verb: string, userId: string, role: Role, actorId: string): Promise<void> {
    return publishAfterCommit(this.timeline, this.logger, async () => {
      const people = await loadTimelinePeople(this.handle.db, [actorId, userId]);
      const target = people.target(userId);
      return { action, summary: `${verb}: ${role} para ${target.name}`, actor: people.actor(actorId), target, details: [{ name: "Papel", value: role }] };
    });
  }
}
