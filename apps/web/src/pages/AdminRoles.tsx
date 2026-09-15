import { ROLE_LABELS, type Role } from "@albion-hub/shared";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useCurrentUser } from "@/auth/AuthProvider";
import { PageHeader } from "@/components/display";
import { cn } from "@/lib/utils";

const MANAGEABLE: Role[] = ["caller", "staff", "admin"];

interface AdminUser {
  id: string;
  discordId: string;
  discordUsername: string;
  displayName: string | null;
  roles: Role[];
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", ...init });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Falha na requisição (HTTP ${res.status})`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** Gestão de papéis (TASK-011). A API valida permissão e o último admin; a tela só espelha. */
export function AdminRoles() {
  const { user: me } = useCurrentUser();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ users: AdminUser[] }>("/api/admin/users")
      .then((data) => {
        setUsers(data.users);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Erro ao carregar usuários"));
  }, []);

  useEffect(load, [load]);

  const adminCount = users?.filter((u) => u.roles.includes("admin")).length ?? 0;

  async function toggle(target: AdminUser, role: Role) {
    const has = target.roles.includes(role);
    const key = `${target.id}:${role}`;
    setBusy(key);
    try {
      await api(`/api/admin/users/${target.id}/roles/${role}`, { method: has ? "DELETE" : "PUT" });
      const name = target.displayName || target.discordUsername;
      toast.success(has ? `${ROLE_LABELS[role]} removido de ${name}` : `${ROLE_LABELS[role]} concedido a ${name}`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível alterar o papel");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader title="Papéis" description="Conceda ou remova caller, staff e admin. Todo usuário logado já é membro." />
      {error && (
        <p role="alert" className="mb-4 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
          {error}
        </p>
      )}
      {!users && !error && <p className="text-muted-foreground">Carregando usuários…</p>}
      {users && users.length === 0 && <p className="text-muted-foreground">Nenhum usuário entrou no painel ainda.</p>}
      {users && users.length > 0 && (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card">
          {users.map((u) => {
            const name = u.displayName || u.discordUsername;
            return (
              <li key={u.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {name}
                    {u.id === me.id && <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">você</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">@{u.discordUsername}</p>
                </div>
                <div className="flex flex-wrap gap-2" role="group" aria-label={`Papéis de ${name}`}>
                  {MANAGEABLE.map((role) => {
                    const on = u.roles.includes(role);
                    const lastAdmin = role === "admin" && on && adminCount <= 1;
                    return (
                      <button
                        key={role}
                        type="button"
                        aria-pressed={on}
                        disabled={busy !== null || lastAdmin}
                        title={lastAdmin ? "Não é possível remover o último admin" : undefined}
                        onClick={() => void toggle(u, role)}
                        className={cn(
                          "press h-8 rounded-full border px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50",
                          on ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                        )}
                      >
                        {ROLE_LABELS[role]}
                      </button>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
