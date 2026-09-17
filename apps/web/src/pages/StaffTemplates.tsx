import {
  EVENT_TEMPLATE_DESCRIPTION_MAX,
  EVENT_TEMPLATE_NAME_MAX,
  checkPartySize,
  eventTemplateInputSchema,
  firstIssue,
  formatPartySize,
  parseEventTemplateYaml,
  totalSlots,
  type EventRoleDto,
  type EventTemplateDto,
  type EventTemplateYaml,
} from "@albion-hub/shared";
import { Check, Download, Info, LayoutTemplate, Pencil, Plus, Shield, Sparkles, Ticket, Trash2, Upload, Users, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { NavLink } from "react-router";
import { toast } from "sonner";
import { Amount, EmptyState, PageHeader, Panel, Pill, StatCard } from "@/components/display";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import * as api from "@/templates/api";

const errorText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

interface DraftRole {
  roleId: string;
  slots: string;
}

interface TemplateDraft {
  name: string;
  description: string;
  minPartySize: string;
  maxPartySize: string;
  /** Taxa de entrada default em Buffunfa, como o texto digitado. `"0"` é o normal (F6-12). */
  defaultEntryFee: string;
  active: boolean;
  roles: DraftRole[];
}

const emptyDraft = (): TemplateDraft => ({ name: "", description: "", minPartySize: "5", maxPartySize: "", defaultEntryFee: "0", active: true, roles: [] });

const draftFrom = (t: EventTemplateDto): TemplateDraft => ({
  name: t.name,
  description: t.description ?? "",
  minPartySize: String(t.minPartySize),
  maxPartySize: t.maxPartySize === null ? "" : String(t.maxPartySize),
  defaultEntryFee: t.defaultEntryFee,
  active: t.active,
  roles: t.roles.map((r) => ({ roleId: r.roleId, slots: String(r.slots) })),
});

const toInput = (draft: TemplateDraft) => ({
  name: draft.name,
  description: draft.description,
  minPartySize: Number(draft.minPartySize),
  maxPartySize: draft.maxPartySize.trim() === "" ? null : Number(draft.maxPartySize),
  // Vazio é zero: quem deixa o campo em branco quer evento gratuito, não um erro de validação.
  defaultEntryFee: draft.defaultEntryFee.trim() === "" ? "0" : draft.defaultEntryFee.trim(),
  active: draft.active,
  roles: draft.roles.map((r) => ({ roleId: r.roleId, slots: Number(r.slots) })),
});

/**
 * Catálogo global de roles e templates de evento (TASK-020, Q8). A API é a autoridade:
 * a tela espelha o estado e mostra a mensagem PT-BR que ela devolve.
 */
export function StaffTemplates() {
  const [roles, setRoles] = useState<EventRoleDto[] | null>(null);
  const [templates, setTemplates] = useState<EventTemplateDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ template: EventTemplateDto | null } | null>(null);
  const [removing, setRemoving] = useState<EventTemplateDto | null>(null);
  const [importing, setImporting] = useState(false);

  const load = useCallback(() => {
    Promise.all([api.fetchEventRoles(), api.fetchEventTemplates()])
      .then(([r, t]) => {
        setRoles(r);
        setTemplates(t);
        setError(null);
      })
      .catch((e: unknown) => setError(errorText(e, "Erro ao carregar templates")));
  }, []);

  useEffect(load, [load]);

  const active = templates?.filter((t) => t.active).length ?? 0;
  const loading = !roles || !templates;

  async function removeTemplate(t: EventTemplateDto) {
    try {
      await api.deleteEventTemplate(t.id);
      setTemplates((list) => list?.filter((x) => x.id !== t.id) ?? null);
      setRemoving(null);
      toast.success("Template apagado", { description: `${t.name} saiu da lista.` });
    } catch (e) {
      toast.error(errorText(e, "Não foi possível apagar o template."));
    }
  }

  return (
    <TooltipProvider>
      <PageHeader
        title="Templates de evento"
        description="Cada template define as roles do catálogo e quantas vagas cada uma tem. O caller escolhe um template ao criar o evento."
        action={
          <>
            <Button variant="outline" onClick={() => setImporting(true)}>
              <Upload />
              Importar YAML
            </Button>
            <Button onClick={() => setEditing({ template: null })} disabled={loading || roles.length === 0}>
              <Plus />
              Criar template
            </Button>
          </>
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

      {loading && !error && (
        <div className="space-y-3" aria-label="Carregando catálogo…">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}

      {!loading && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
            <StatCard
              label="Templates ativos"
              icon={<LayoutTemplate />}
              emphasis
              value={<span className="num">{active}</span>}
              hint={templates.length === active ? "todos disponíveis pro caller" : `${templates.length - active} inativo(s)`}
            />
            <StatCard label="Roles no catálogo" icon={<Shield />} value={<span className="num">{roles.length}</span>} hint="usadas por todos os templates" />
            <StatCard
              className="col-span-2 lg:col-span-1"
              label="Maior party"
              icon={<Users />}
              value={templates.length > 0 ? <span className="num">{Math.max(...templates.map((t) => t.totalSlots))}</span> : "—"}
              hint="vagas no maior template"
            />
          </div>

          {/* Catálogo vazio: sem role não existe template. O próximo passo é a página de roles (TASK-040). */}
          {roles.length === 0 && (
            <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed p-4 text-sm">
              <p className="flex items-center gap-2 text-muted-foreground">
                <Shield className="size-4 shrink-0" aria-hidden />
                O catálogo de roles está vazio. Um template precisa de pelo menos uma role.
              </p>
              <Button variant="outline" size="sm" asChild>
                <NavLink to="/staff/roles">
                  <Shield />
                  Criar a primeira role
                </NavLink>
              </Button>
            </div>
          )}

          <Panel title="Templates" titleId="templates-title">
            {templates.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={<LayoutTemplate />}
                  title="Nenhum template ainda."
                  description="Monte o primeiro (ex: DG de grupo, 4 a 9 pessoas) pra o caller poder abrir eventos."
                  action={
                    <Button onClick={() => setEditing({ template: null })} disabled={roles.length === 0}>
                      <Plus />
                      Criar primeiro template
                    </Button>
                  }
                />
              </div>
            ) : (
              <ul className="divide-y">
                {templates.map((t) => (
                  <TemplateRow key={t.id} template={t} onEdit={() => setEditing({ template: t })} onRemove={() => setRemoving(t)} />
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}

      {editing && (
        <TemplateDialog
          roles={roles ?? []}
          template={editing.template}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setTemplates((list) => {
              const rest = (list ?? []).filter((t) => t.id !== saved.id);
              return [...rest, saved].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
            });
            setEditing(null);
            load();
          }}
        />
      )}

      {importing && (
        <ImportDialog
          roles={roles ?? []}
          onClose={() => setImporting(false)}
          onImported={() => {
            setImporting(false);
            load();
          }}
        />
      )}

      <Dialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apagar {removing?.name}?</DialogTitle>
            <DialogDescription>O template some da lista do caller. As roles do catálogo continuam.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Voltar
            </Button>
            <Button variant="destructive" onClick={() => void (removing && removeTemplate(removing))}>
              <Trash2 />
              Apagar template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}

function TemplateRow({ template, onEdit, onRemove }: { template: EventTemplateDto; onEdit: () => void; onRemove: () => void }) {
  const [busy, setBusy] = useState(false);

  async function exportTemplate() {
    setBusy(true);
    try {
      const { yaml, filename } = await api.exportEventTemplateYaml(template.id);
      downloadYaml(yaml, filename);
      toast.success("Template exportado", { description: `${filename} baixado. Importe esse arquivo em outro servidor.` });
    } catch (err) {
      toast.error(errorText(err, "Não foi possível exportar o template."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-wrap items-start gap-x-6 gap-y-3 px-4 py-(--row-py)">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">{template.name}</p>
          {!template.active && <Pill tone="neutral" icon={<X aria-hidden />}>Inativo</Pill>}
        </div>
        {template.description && <p className="mt-0.5 text-sm text-muted-foreground">{template.description}</p>}
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Users className="size-3.5" aria-hidden />
            <span className="num">{formatPartySize(template.minPartySize, template.maxPartySize)}</span> pessoas
          </span>
          <span>
            <span className="num font-medium text-foreground">{template.totalSlots}</span> vagas
          </span>
          {/* Só aparece quando cobra: "entrada gratuita" em todo card seria ruído no caso normal. */}
          {template.defaultEntryFee !== "0" && (
            <span className="inline-flex items-center gap-1.5">
              <Ticket className="size-3.5" aria-hidden />
              entrada <Amount value={BigInt(template.defaultEntryFee)} currency="buffunfa" className="font-medium" />
            </span>
          )}
        </p>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {/* A descrição da role (TASK-039) fica no hover/foco da pill: o card do template é um resumo,
              e despejar o texto de cada role aqui enterraria o que o card existe pra mostrar. */}
          {template.roles.map((r) => (
            <li key={r.roleId}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    tabIndex={r.description ? 0 : -1}
                    className={cn("flex h-6 items-center gap-1.5 rounded-full border px-2 text-xs", r.description && "border-dashed border-foreground/40")}
                  >
                    <span className="num font-semibold">{r.slots}</span>
                    {r.name}
                  </span>
                </TooltipTrigger>
                <TooltipContent hidden={!r.description} className="max-w-64">
                  {r.description}
                </TooltipContent>
              </Tooltip>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onEdit}>
          <Pencil />
          Editar
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Exportar template ${template.name}`} disabled={busy} onClick={() => void exportTemplate()}>
              <Download />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Baixar o .yaml para importar em outro servidor</TooltipContent>
        </Tooltip>
        <Button variant="ghost" size="icon-sm" aria-label={`Apagar template ${template.name}`} onClick={onRemove}>
          <Trash2 />
        </Button>
      </div>
    </li>
  );
}

/** Baixa o YAML que a API gerou. O nome do arquivo vem do Content-Disposition, já saneado no servidor. */
function downloadYaml(yaml: string, filename: string) {
  const url = URL.createObjectURL(new Blob([yaml], { type: "text/yaml;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Catálogo global: criar, renomear e apagar role. Role em uso não apaga (AC#3). */

function TemplateDialog({
  roles,
  template,
  onClose,
  onSaved,
}: {
  roles: EventRoleDto[];
  template: EventTemplateDto | null;
  onClose: () => void;
  onSaved: (t: EventTemplateDto) => void;
}) {
  const ids = { name: useId(), description: useId(), min: useId(), max: useId(), entryFee: useId() };
  const [draft, setDraft] = useState<TemplateDraft>(() => (template ? draftFrom(template) : emptyDraft()));
  const [busy, setBusy] = useState(false);
  const patch = (values: Partial<TemplateDraft>) => setDraft((d) => ({ ...d, ...values }));

  const available = roles.filter((r) => !draft.roles.some((d) => d.roleId === r.id));
  const slotsTotal = useMemo(() => totalSlots(draft.roles.map((r) => ({ slots: Number(r.slots) || 0 }))), [draft.roles]);
  const party = checkPartySize({
    minPartySize: Number(draft.minPartySize) || 0,
    maxPartySize: draft.maxPartySize.trim() === "" ? null : Number(draft.maxPartySize),
    roles: draft.roles.map((r) => ({ slots: Number(r.slots) || 0 })),
  });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const parsed = eventTemplateInputSchema.safeParse(toInput(draft));
    if (!parsed.success) return toast.error(firstIssue(parsed.error));
    setBusy(true);
    try {
      const saved = template ? await api.updateEventTemplate(template.id, parsed.data) : await api.createEventTemplate(parsed.data);
      toast.success(template ? "Template salvo" : "Template criado", { description: `${saved.name}: ${saved.totalSlots} vagas.` });
      onSaved(saved);
    } catch (err) {
      toast.error(errorText(err, "Não foi possível salvar o template."));
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{template ? `Editar ${template.name}` : "Novo template"}</DialogTitle>
          <DialogDescription>Defina o tamanho da party e as vagas por role. O caller usa isso pra abrir inscrições.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void save(e)} className="space-y-4">
          <div>
            <Label htmlFor={ids.name}>Nome</Label>
            <Input id={ids.name} autoFocus value={draft.name} maxLength={EVENT_TEMPLATE_NAME_MAX} onChange={(e) => patch({ name: e.target.value })} placeholder="Ex: DG de grupo" className="mt-1.5" />
          </div>
          <div>
            <Label htmlFor={ids.description}>Descrição (opcional)</Label>
            <Textarea
              id={ids.description}
              value={draft.description}
              maxLength={EVENT_TEMPLATE_DESCRIPTION_MAX}
              rows={2}
              onChange={(e) => patch({ description: e.target.value })}
              placeholder="Ex: dungeon em grupo, saída pelo portal"
              className="mt-1.5 min-h-16"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor={ids.min}>Mínimo de pessoas</Label>
              <Input id={ids.min} inputMode="numeric" value={draft.minPartySize} onChange={(e) => patch({ minPartySize: e.target.value })} className="num mt-1.5" />
            </div>
            <div>
              <Label htmlFor={ids.max}>Máximo (vazio = sem teto)</Label>
              <Input id={ids.max} inputMode="numeric" value={draft.maxPartySize} onChange={(e) => patch({ maxPartySize: e.target.value })} placeholder="∞" className="num mt-1.5" />
            </div>
          </div>

          <div>
            <Label htmlFor={ids.entryFee}>Taxa de entrada em Buffunfa</Label>
            <Input
              id={ids.entryFee}
              inputMode="numeric"
              value={draft.defaultEntryFee}
              onChange={(e) => patch({ defaultEntryFee: e.target.value })}
              placeholder="0"
              aria-describedby={`${ids.entryFee}-hint`}
              className="num mt-1.5"
            />
            {/* O default é zero e o texto diz isso: a taxa é decisão do caller, evento a evento (F6-12). */}
            <p id={`${ids.entryFee}-hint`} className="mt-1.5 text-sm text-muted-foreground">
              <span className="num font-medium text-foreground">0</span> = entrada gratuita. O caller ainda pode mudar o valor em cada evento, até as inscrições
              fecharem. A Buffunfa cobrada some: não vai para ninguém.
            </p>
          </div>

          <fieldset>
            <legend className="text-sm font-medium">Roles e vagas</legend>
            <ul className="mt-2 space-y-2">
              {draft.roles.map((row, i) => {
                const role = roles.find((r) => r.id === row.roleId);
                return (
                  <li key={row.roleId} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm">{role?.name ?? "Role removida"}</span>
                    <Input
                      aria-label={`Vagas de ${role?.name ?? "role"}`}
                      inputMode="numeric"
                      value={row.slots}
                      onChange={(e) => patch({ roles: draft.roles.map((r, j) => (j === i ? { ...r, slots: e.target.value } : r)) })}
                      className="num w-20"
                    />
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Tirar ${role?.name ?? "role"} do template`} onClick={() => patch({ roles: draft.roles.filter((_, j) => j !== i) })}>
                      <X />
                    </Button>
                  </li>
                );
              })}
            </ul>
            {available.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {available.map((role) => (
                  <Button key={role.id} type="button" variant="outline" size="xs" onClick={() => patch({ roles: [...draft.roles, { roleId: role.id, slots: "1" }] })}>
                    <Plus />
                    {role.name}
                  </Button>
                ))}
              </div>
            )}
            <p className={`mt-3 text-sm ${party.ok ? "text-muted-foreground" : "text-destructive"}`} role={party.ok ? undefined : "alert"}>
              {party.ok ? (
                <>
                  <span className="num font-semibold text-foreground">{slotsTotal}</span> vagas para{" "}
                  <span className="num">{formatPartySize(Number(draft.minPartySize) || 0, draft.maxPartySize.trim() === "" ? null : Number(draft.maxPartySize))}</span> pessoas.
                </>
              ) : (
                party.error
              )}
            </p>
          </fieldset>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.active} onChange={(e) => patch({ active: e.target.checked })} className="size-4 accent-foreground" />
            Disponível pro caller criar evento
          </label>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy}>
              <Check />
              {template ? "Salvar template" : "Criar template"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Importar template de YAML (TASK-038, AC#2/#3/#4).
 *
 * A pré-visualização usa o mesmo parser da API (`parseEventTemplateYaml` em @albion-hub/shared), então
 * a staff vê o erro e o que vai ser criado antes de gravar — inclusive as roles que ainda não existem
 * no catálogo, que a importação cria automaticamente. A API valida de novo: a tela não é a autoridade.
 */
function ImportDialog({ roles, onClose, onImported }: { roles: EventRoleDto[]; onClose: () => void; onImported: () => void }) {
  const ids = { file: useId(), yaml: useId() };
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const parsed = useMemo(() => (source.trim() === "" ? null : parseEventTemplateYaml(source)), [source]);
  const preview = parsed?.ok ? parsed.template : null;
  const problem = fileError ?? (parsed && !parsed.ok ? parsed.error : null);

  const known = useMemo(() => new Map(roles.map((r) => [r.name.toLowerCase(), r.description?.trim() ?? ""])), [roles]);
  const newRoles = preview ? preview.roles.filter((r) => !known.has(r.name.toLowerCase())).map((r) => r.name) : [];
  /**
   * Descrições que o import vai ignorar (TASK-065): a role já existe no catálogo com outra descrição,
   * e a descrição mora uma vez por role, não por template — aplicar a do arquivo apagaria o texto que
   * os outros templates mostram. A tela avisa antes de gravar; a API decide de novo.
   */
  const keptDescriptions = preview
    ? preview.roles
        .filter((r) => {
          const current = known.get(r.name.toLowerCase());
          return Boolean(current) && Boolean(r.description?.trim()) && current !== r.description?.trim();
        })
        .map((r) => r.name)
    : [];

  async function pickFile(file: File | undefined) {
    if (!file) return;
    setFileError(null);
    try {
      setSource(await file.text());
    } catch {
      setFileError("Não foi possível ler o arquivo. Cole o conteúdo no campo abaixo.");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!preview) return;
    setBusy(true);
    try {
      const result = await api.importEventTemplateYaml(source);
      const parts = [`${result.template.name}: ${result.template.totalSlots} vagas.`];
      if (result.createdRoles.length > 0) parts.push(`Roles criadas no catálogo: ${result.createdRoles.join(", ")}.`);
      if (result.ignoredDescriptions.length > 0) parts.push(`Descrição do arquivo ignorada (a role já tem descrição no catálogo): ${result.ignoredDescriptions.join(", ")}.`);
      toast.success("Template importado", { description: parts.join(" "), duration: result.ignoredDescriptions.length > 0 ? 10000 : undefined });
      onImported();
    } catch (err) {
      toast.error(errorText(err, "Não foi possível importar o template."));
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Importar template de YAML</DialogTitle>
          <DialogDescription>
            Escolha o .yaml exportado de outro servidor (ou cole o conteúdo). As roles que não existirem aqui são criadas no catálogo junto com o template.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void submit(e)} className="space-y-4">
          <div>
            <Label htmlFor={ids.file}>Arquivo .yaml</Label>
            <input
              id={ids.file}
              type="file"
              accept=".yaml,.yml,text/yaml,text/plain"
              onChange={(e) => void pickFile(e.target.files?.[0])}
              className="mt-1.5 block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-secondary-foreground hover:file:bg-secondary/80"
            />
          </div>
          <div>
            <Label htmlFor={ids.yaml}>Conteúdo do YAML</Label>
            <Textarea
              id={ids.yaml}
              value={source}
              rows={8}
              spellCheck={false}
              onChange={(e) => {
                setFileError(null);
                setSource(e.target.value);
              }}
              placeholder={"version: 1\nname: DG de grupo\nminParty: 4\nmaxParty: 9\nroles:\n  - name: Tank\n    slots: 1"}
              className="mt-1.5 min-h-40 font-mono text-xs"
            />
          </div>

          {problem && (
            <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <X className="mt-0.5 size-4 shrink-0" aria-hidden />
              {problem}
            </p>
          )}

          {preview && <ImportPreview template={preview} newRoles={newRoles} keptDescriptions={keptDescriptions} />}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy || !preview}>
              <Upload />
              Importar template
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** O que vai ser criado, antes de gravar: nada de importar às cegas. */
function ImportPreview({ template, newRoles, keptDescriptions }: { template: EventTemplateYaml; newRoles: string[]; keptDescriptions: string[] }) {
  const slots = totalSlots(template.roles);
  return (
    <section aria-label="Pré-visualização do template" className="rounded-xl border bg-muted/40 p-3">
      <p className="font-medium">{template.name}</p>
      {template.description && <p className="mt-0.5 text-sm text-muted-foreground">{template.description}</p>}
      <p className="mt-1 text-sm text-muted-foreground">
        <span className="num font-semibold text-foreground">{slots}</span> vagas para <span className="num">{formatPartySize(template.minParty, template.maxParty)}</span> pessoas
        {!template.active && " · entra como inativo"}
      </p>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {template.roles.map((r) => {
          const isNew = newRoles.includes(r.name);
          return (
            <li key={r.name} className={`flex h-6 items-center gap-1.5 rounded-full border px-2 text-xs ${isNew ? "border-info/50 text-info" : ""}`}>
              <span className="num font-semibold">{r.slots}</span>
              {r.name}
              {isNew && <Sparkles className="size-3" aria-hidden />}
            </li>
          );
        })}
      </ul>
      {newRoles.length > 0 && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
          <Sparkles className="mt-0.5 size-3 shrink-0 text-info" aria-hidden />
          <span>
            {newRoles.length === 1 ? "Esta role será criada" : `Estas ${newRoles.length} roles serão criadas`} no catálogo junto com o template: {newRoles.join(", ")}.
          </span>
        </p>
      )}
      {keptDescriptions.length > 0 && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3 shrink-0 text-warning" aria-hidden />
          <span>
            A descrição do arquivo será ignorada {keptDescriptions.length === 1 ? "nesta role, que já tem descrição no catálogo" : `nestas ${keptDescriptions.length} roles, que já têm descrição no catálogo`}:{" "}
            {keptDescriptions.join(", ")}. A descrição vale para todos os templates, então o import não escreve por cima dela.
          </span>
        </p>
      )}
    </section>
  );
}
