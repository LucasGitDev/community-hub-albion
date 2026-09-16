import { EVENT_ROLE_DESCRIPTION_MAX, EVENT_ROLE_NAME_MAX, eventRoleInputSchema, firstIssue, type EventRoleDto } from "@albion-hub/shared";
import { Check, LayoutTemplate, Pencil, Plus, ScrollText, Shield, ShieldOff, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { NavLink } from "react-router";
import { toast } from "sonner";
import { errorText } from "@/api/http";
import { cn } from "@/lib/utils";
import { EmptyState, PageHeader, Panel, StatCard } from "@/components/display";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
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
 * A descrição da role (TASK-039) é escrita aqui e lida em todo lugar onde a role aparece: template,
 * roster do evento, embed do Discord e — o que importa — o botão de inscrição, onde a pessoa decide
 * que role pegar. Por isso o texto é instrução ("o que se espera de quem pega"), não enfeite.
 * A página de build por role (/staff/roles/:id) continua fora de escopo; quando existir, o nome da
 * role na tabela é o link natural pra ela.
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

  /** Salva nome e descrição juntos: são os dois campos da mesma linha, um PATCH só. */
  async function save(role: EventRoleDto, draft: { name: string; description: string }) {
    const parsed = eventRoleInputSchema.safeParse(draft);
    if (!parsed.success) return toast.error(firstIssue(parsed.error));
    const renamed = parsed.data.name !== role.name;
    const redescribed = parsed.data.description !== role.description;
    if (!renamed && !redescribed) return setEditingId(null);
    try {
      const updated = await api.updateEventRole(role.id, parsed.data);
      setRoles((list) => list?.map((r) => (r.id === role.id ? updated : r)) ?? null);
      setEditingId(null);
      toast.success("Role salva", {
        description: renamed
          ? `Agora é ${updated.name}.`
          : updated.description
            ? `Quem for se inscrever em ${updated.name} vai ler a descrição.`
            : `${updated.name} ficou sem descrição.`,
      });
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
  const undescribed = roles?.filter((r) => !r.description).length ?? 0;

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
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
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
            <StatCard
              label="Sem descrição"
              icon={<ScrollText />}
              value={<span className="num">{undescribed}</span>}
              hint="quem se inscrever escolhe no escuro"
              className="col-span-2 lg:col-span-1"
            />
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
                    <TableHead>Role</TableHead>
                    {/* Em tela estreita a descrição vira a segunda linha do nome, não uma coluna espremida. */}
                    <TableHead className="hidden sm:table-cell">Descrição</TableHead>
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
                      onSave={(draft) => void save(role, draft)}
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
  onSave,
  onRemove,
}: {
  role: EventRoleDto;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (draft: { name: string; description: string }) => void;
  onRemove: () => void;
}) {
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? "");
  const inUse = role.templateCount > 0;
  const nameId = useId();
  const descriptionId = useId();

  if (editing) {
    const left = EVENT_ROLE_DESCRIPTION_MAX - description.length;
    return (
      <TableRow className="bg-muted/30">
        <TableCell colSpan={4} className="py-3">
          {/* Nome e descrição são a mesma linha da tabela: editar os dois juntos é um PATCH só. */}
          <div className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] sm:items-start">
            <div>
              <Label htmlFor={nameId} className="text-xs text-muted-foreground">
                Nome
              </Label>
              <Input
                autoFocus
                id={nameId}
                aria-label={`Nome da role ${role.name}`}
                value={name}
                maxLength={EVENT_ROLE_NAME_MAX}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSave({ name, description });
                  if (e.key === "Escape") onCancel();
                }}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor={descriptionId} className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                <span>Descrição (opcional)</span>
                <span className={cn("num tabular-nums", left <= 20 && "text-foreground")}>{left}</span>
              </Label>
              <Textarea
                id={descriptionId}
                aria-label={`Descrição da role ${role.name}`}
                value={description}
                maxLength={EVENT_ROLE_DESCRIPTION_MAX}
                rows={2}
                onChange={(e) => setDescription(e.target.value)}
                onKeyDown={(e) => {
                  // Enter quebra linha na descrição; salvar é Ctrl/Cmd+Enter, como em qualquer campo de texto.
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSave({ name, description });
                  if (e.key === "Escape") onCancel();
                }}
                placeholder="O que se espera de quem pega essa role. Ex: segura a frente, abre o engage e chama recuo."
                className="mt-1.5 min-h-16"
              />
            </div>
            <div className="flex gap-1 sm:mt-6">
              <Button size="icon-sm" aria-label="Salvar role" onClick={() => onSave({ name, description })}>
                <Check />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Cancelar" onClick={onCancel}>
                <X />
              </Button>
            </div>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow>
      <TableCell className="max-w-[12rem] min-w-0 align-top font-medium">
        <span className="block truncate">{role.name}</span>
        {/* Mobile: a descrição não cabe como coluna, então acompanha o nome. `whitespace-normal` porque
            a célula da tabela é `nowrap` e uma descrição de 200 caracteres empurraria a tabela pra fora da tela. */}
        {role.description && (
          <span className="mt-0.5 line-clamp-2 block text-xs leading-snug whitespace-normal text-muted-foreground sm:hidden">{role.description}</span>
        )}
      </TableCell>
      <TableCell className="hidden max-w-[28rem] min-w-0 align-top text-muted-foreground sm:table-cell">
        {role.description ? (
          <p className="line-clamp-2 text-sm leading-snug whitespace-normal">{role.description}</p>
        ) : (
          <Button variant="ghost" size="sm" className="-ml-2 h-7 border border-dashed text-xs text-muted-foreground" onClick={onEdit}>
            <ScrollText />
            Descrever
          </Button>
        )}
      </TableCell>
      <TableCell className="align-top text-xs text-muted-foreground">
        {inUse ? (
          <>
            em <span className="num">{role.templateCount}</span> template{role.templateCount > 1 ? "s" : ""}
          </>
        ) : (
          "sem template"
        )}
      </TableCell>
      <TableCell className="align-top text-right">
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon-sm" aria-label={`Editar ${role.name}`} onClick={onEdit}>
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
