import { Controller, Get } from "@nestjs/common";
import { ROLE_LABELS, ROLES, type Role } from "@albion-hub/shared";
import { Authorize } from "./authorize.js";

/** Catálogo de papéis; base da gestão de papéis (TASK-011). Só quem gerencia papéis lê. */
@Controller("roles")
export class RolesController {
  @Get()
  @Authorize("read", "UserRole")
  list(): { roles: { id: Role; label: string }[] } {
    return { roles: ROLES.map((id) => ({ id, label: ROLE_LABELS[id] })) };
  }
}
