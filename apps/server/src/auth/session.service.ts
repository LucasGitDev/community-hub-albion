import { Inject, Injectable } from "@nestjs/common";
import { findValidSession, listRoles, type DbHandle, type User } from "@albion-hub/db";
import type { Role } from "@albion-hub/shared";
import type { Request } from "express";
import { DB_HANDLE } from "../db/db.module.js";
import { parseCookies, SESSION_COOKIE } from "../domain/auth.js";

export interface AuthContext {
  user: User;
  roles: Role[];
}

/** Resolve a sessão do cookie (hash no banco, expiração verificada na query). */
@Injectable()
export class SessionService {
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  async fromRequest(req: Request): Promise<AuthContext | null> {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token) return null;
    const found = await findValidSession(this.handle.db, token);
    if (!found) return null;
    return { user: found.user, roles: await listRoles(this.handle.db, found.user.id) };
  }
}
