/** Papéis RBAC da v1 (Q13). Permissões granulares ficam no CASL (TASK-009). */
export const ROLES = ["member", "caller", "staff", "admin"] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  member: "Membro",
  caller: "Caller",
  staff: "Staff",
  admin: "Admin",
};

export const isRole = (value: unknown): value is Role => typeof value === "string" && (ROLES as readonly string[]).includes(value);
