import { EVENT_ROLE_NAME_MAX, eventRoleInputSchema, firstIssue, type EventRoleDto } from "@albion-hub/shared";
import { Check, LayoutTemplate, Pencil, Plus, Shield, ShieldOff, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { NavLink } from "react-router";
import { toast } from "sonner";
import { errorText } from "@/api/http";
import { EmptyState, PageHeader, Panel, StatCard } from "@/components/display";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import * as api from "@/templates/api";

/**
 * Catálogo global de roles (TASK-020 Q8), tirado de dentro de /staff/templates na TASK-040.
 *
 * A rota é /staff/roles porque "role" é a palavra que o produto inteiro usa (copy, YAML, API); "papéis"
 * já é a rota do RBAC (/admin/papeis) e é outro conceito. A permissão é a mesma de antes
 * (update EventTemplate): quem monta template é quem mexe no catálogo.
 *
 * Espaço reservado pra TASK-039 (descrição e build por role): a coluna "Descrição" entra entre "Role" e
 * "Uso", e o nome vira link pra /staff/roles/:id (página de build). Nada disso é renderizado agora —
 * coluna vazia é pior que coluna ausente.
 *
 * A API é a autoridade: a tela espelha o estado e mostra a mensagem PT-BR que ela devolve (inclusive o
 * 409 de role em uso, que o botão desabilitado só antecipa).
 */
export function StaffRoles() {
  const [roles, setRoles] = useState<EventRoleDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const nameId = useId();
  const nameRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api
      .fetchEventRoles()
      .then((r) => {
        setRoles(r);
        setError(null);
      })
      .catch((e: unknown) => setError(errorText(e, "Erro ao carregar o catálogo de roles")));
  }, []);

  useEffect(load, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const parsed = eventRoleInputSchema.safeParse({ name, description: null });
    if (!parsed.success) return toast.error(firstIssue(parsed.error));
    setBusy(true);
    try {
      const role = await api.createEventRole(parsed.data);
      setRoles((list) => [...(list ?? []), role]);
      setName("");
      toast.success("Role criada", { description: `${role.name} já pode entrar nos templates.` });
    } catch (err) {
      toast.error(errorText(err, "Não foi possível criar a role."));
    } finally {
      setBusy(false);
      nameRef.current?.focus();
    }
  }

  async function rename(role: EventRoleDto, value: string) {
    const parsed = eventRoleInputSchema.safeParse({ name: value, description: role.description });
    if (!parsed.success) return toast.error(firstIssue(parsed.error));
    if (parsed.data.name === role.name) return setEditingId(null);
    try {
      const updated = await api.updateEventRole(role.id, { name: parsed.data.name });
      setRoles((list) => list?.map((r) => (r.id === role.id ? updated : r)) ?? null);
      setEditingId(null);
      toast.success("Role atualizada", { description: `Agora é ${updated.name}.` });
    } catch (err) {
      toast.error(errorText(err, "Não foi possível salvar a role."));
    }
  }

  async function remove(role: EventRoleDto) {
    try {
      await api.deleteEventRole(role.id);
      setRoles((list) => list?.filter((r) => r.id !== role.id) ?? null);
      toast.success("Role apagada", { description: `${role.name} saiu do catálogo.` });
    } catch (err) {
      toast.error(errorText(err, "Não foi possível apagar a role."));
    }
  }

  const inUse = roles?.filter((r) => r.templateCount > 0).length ?? 0;
  const idle = (roles?.length ?? 0) - inUse;

  return (
    <TooltipProvider>
      <PageHeader
        title="Roles"
        description="O catálogo global que os templates de evento usam. Criar uma role aqui deixa ela disponível pra todo template."
        action={
          <Button variant="outline" asChild>
            <NavLink to="/staff/templates">
              <LayoutTemplate />
              Ver templates
            </NavLink>
          </Button>
        }
      />

      {error && (
        <div role="alert" className="mb-4 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
          {error}
          <Button variant="outline" className="mt-3 block" onClick={load}>
            Tentar de novo
          </Button>
        </div>
      )}

      {roles === null && !error && (
        <div className="space-y-3" aria-label="Carregando catálogo…">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {roles && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
            <StatCard
              emphasis
              label="Roles no catálogo"
              icon={<Shield />}
              value={<span className="num">{roles.length}</span>}
              hint="disponíveis pra qualquer template"
              className="col-span-2 lg:col-span-1"
            />
            <StatCard label="Em uso" icon={<LayoutTemplate />} value={<span className="num">{inUse}</span>} hint="estão em pelo menos um template" />
            <StatCard label="Sem template" icon={<ShieldOff />} value={<span className="num">{idle}</span>} hint="ninguém usa ainda: dá pra apagar" />
          </div>

          <Panel title="Catálogo de roles" titleId="roles-title" className="overflow-hidden">
            <form onSubmit={(e) => void create(e)} className="flex flex-wrap items-end gap-2 border-b px-4 py-3">
              <div className="min-w-0 flex-1 basis-56">
                <Label htmlFor={nameId} className="text-xs text-muted-foreground">
                  Nova role
                </Label>
                <Input
                  ref={nameRef}
                  id={nameId}
                  value={name}
                  maxLength={EVENT_ROLE_NAME_MAX}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Battlemount"
                  className="mt-1.5"
                />
              </div>
              <Button type="submit" disabled={busy || !name.trim()}>
                <Plus />
                Adicionar role
              </Button>
            </form>

            {roles.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={<Shield />}
                  title="Catálogo vazio."
                  description="Sem role no catálogo não dá pra montar template nem abrir inscrição. Comece pelas que a guilda sempre chama: Tank, Healer, DPS."
                  action={
                    <Button onClick={() => nameRef.current?.focus()}>
                      <Plus />
                      Criar a primeira role
                    </Button>
                  }
                />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    {/* TASK-039 acrescenta aqui a coluna "Descrição"; o nome vira link pra /staff/roles/:id (build). */}
                    <TableHead>Role</TableHead>
                    <TableHead>Uso</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {roles.map((role) => (
                    <RoleRow
                      key={role.id}
                      role={role}
                      editing={editingId === role.id}
                      onEdit={() => setEditingId(role.id)}
                      onCancel={() => setEditingId(null)}
                      onRename={(value) => void rename(role, value)}
                      onRemove={() => void remove(role)}
                    />
                  ))}
                </TableBody>
              </Table>
            )}
          </Panel>
        </>
      )}
    </TooltipProvider>
  );
}

function RoleRow({
  role,
  editing,
  onEdit,
  onCancel,
  onRename,
  onRemove,
}: {
  role: EventRoleDto;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onRename: (value: string) => void;
  onRemove: () => void;
}) {
  const [value, setValue] = useState(role.name);
  const inUse = role.templateCount > 0;

  if (editing) {
    return (
      <TableRow>
        <TableCell colSpan={3}>
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              aria-label={`Nome da role ${role.name}`}
              value={value}
              maxLength={EVENT_ROLE_NAME_MAX}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onRename(value);
                if (e.key === "Escape") onCancel();
              }}
              className="max-w-xs"
            />
            <Button size="icon-sm" aria-label="Salvar nome" onClick={() => onRename(value)}>
              <Check />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Cancelar" onClick={onCancel}>
              <X />
            </Button>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow>
      <TableCell className="max-w-[12rem] min-w-0 font-medium">
        <span className="block truncate">{role.name}</span>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {inUse ? (
          <>
            em <span className="num">{role.templateCount}</span> template{role.templateCount > 1 ? "s" : ""}
          </>
        ) : (
          "sem template"
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon-sm" aria-label={`Renomear ${role.name}`} onClick={onEdit}>
            <Pencil />
          </Button>
          <Tooltip>
            {/* Botão desabilitado não dispara hover: o span envolve pra explicar por que não dá pra apagar. */}
            <TooltipTrigger asChild>
              <span className="inline-flex" tabIndex={inUse ? 0 : -1}>
                <Button variant="ghost" size="icon-sm" aria-label={`Apagar ${role.name}`} disabled={inUse} onClick={onRemove}>
                  <Trash2 />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent hidden={!inUse}>Role em uso por {role.templateCount} template(s). Tire ela dos templates antes de apagar.</TooltipContent>
          </Tooltip>
        </div>
      </TableCell>
    </TableRow>
  );
}
