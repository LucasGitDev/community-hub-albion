import { useEffect, useId, useState } from "react";
import { Bot, Loader2, MessageSquareText, NotebookPen, UserRoundPen } from "lucide-react";
import { toast } from "sonner";
import { USER_NOTE_MAX_LENGTH, validateGuildTag, validateNick, validateUserNote } from "@albion-hub/shared";
import { addMemberNote, fetchMemberNotes, updateMember, type AdminMember, type UserNote } from "@/api/members";
import { errorText } from "@/api/http";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Gestão de um membro (TASK-045, AC#2 e AC#3): editar e escrever notas.
 *
 * Uma janela só, com duas abas, porque as duas coisas respondem à mesma pergunta ("o que eu faço com essa
 * pessoa?") e porque o histórico é justamente o que dá contexto para editar — abrir duas telas separadas
 * obrigaria o admin a decidir antes de ler. O cabeçalho repete quem é o membro: a lista fica atrás do overlay.
 */
export function MemberManageDialog({
  member,
  onClose,
  onSaved,
}: {
  member: AdminMember | null;
  onClose: () => void;
  /** Sobe o novo nick/tag para a linha da tabela se atualizar sem recarregar a página (AC#2). */
  onSaved: (patch: { nick: string; guildTag: string | null }) => void;
}) {
  return (
    <Dialog open={member !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {member && <MemberManage key={member.id} member={member} onClose={onClose} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  );
}

function MemberManage({ member, onClose, onSaved }: { member: AdminMember; onClose: () => void; onSaved: (p: { nick: string; guildTag: string | null }) => void }) {
  const [notes, setNotes] = useState<UserNote[] | null>(null);
  const [notesError, setNotesError] = useState<string | null>(null);

  // Carrega o histórico junto com a janela: a aba de notas não pode piscar um vazio que não é vazio.
  // Não zera o estado aqui: quem troca de membro remonta o componente inteiro (`key` no MemberManage).
  useEffect(() => {
    let alive = true;
    fetchMemberNotes(member.id)
      .then((r) => alive && setNotes(r.notes))
      .catch((e: unknown) => alive && setNotesError(errorText(e, "Não foi possível carregar as notas")));
    return () => {
      alive = false;
    };
  }, [member.id]);

  const name = member.gameNick || member.displayName || member.discordUsername;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="truncate">{name}</DialogTitle>
        <DialogDescription>
          @{member.discordUsername}
          {member.guildTag ? ` · [${member.guildTag}]` : " · sem guilda"}
        </DialogDescription>
      </DialogHeader>

      <Tabs defaultValue="editar">
        <TabsList className="w-full">
          <TabsTrigger value="editar" className="flex-1">
            <UserRoundPen />
            Editar
          </TabsTrigger>
          <TabsTrigger value="notas" className="flex-1">
            <MessageSquareText />
            Notas
            {notes && notes.length > 0 && <span className="num text-xs opacity-70">{notes.length}</span>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="editar">
          <EditForm member={member} onSaved={onSaved} onNote={(note) => setNotes((prev) => (prev ? [...prev, note] : prev))} onClose={onClose} />
        </TabsContent>

        <TabsContent value="notas">
          <NotesPanel memberId={member.id} notes={notes} error={notesError} onAdded={(note) => setNotes((prev) => [...(prev ?? []), note])} />
        </TabsContent>
      </Tabs>
    </>
  );
}

/** Edição de nick e tag (AC#2). Valida com as mesmas funções da API: o erro aparece antes de gastar a ida. */
function EditForm({
  member,
  onSaved,
  onNote,
  onClose,
}: {
  member: AdminMember;
  onSaved: (p: { nick: string; guildTag: string | null }) => void;
  onNote: (note: UserNote) => void;
  onClose: () => void;
}) {
  const nickId = useId();
  const tagId = useId();
  const [nick, setNick] = useState(member.gameNick ?? "");
  const [guildTag, setGuildTag] = useState(member.guildTag ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const validNick = validateNick(nick);
    if (!validNick.ok) return setError(validNick.error);
    const validTag = validateGuildTag(guildTag);
    if (!validTag.ok) return setError(validTag.error);

    setError(null);
    setSaving(true);
    try {
      const saved = await updateMember(member.id, { nick: validNick.nick, guildTag });
      onSaved({ nick: saved.nick, guildTag: saved.guildTag });
      if (saved.note) onNote(saved.note);
      toast.success(saved.note ? "Membro atualizado" : "Nada mudou nesse membro", {
        description: saved.note?.body ?? "Nick e tag continuam iguais aos que já estavam salvos.",
      });
      onClose();
    } catch (e) {
      // Erro fica no formulário, não só no toast: o campo a corrigir está aqui.
      setError(errorText(e, "Não foi possível salvar"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
        <div className="space-y-1.5">
          <Label htmlFor={nickId}>Nick no Albion</Label>
          <Input id={nickId} value={nick} onChange={(e) => setNick(e.target.value)} autoComplete="off" spellCheck={false} maxLength={16} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={tagId}>Tag da guilda</Label>
          <Input id={tagId} value={guildTag} onChange={(e) => setGuildTag(e.target.value)} autoComplete="off" spellCheck={false} maxLength={12} placeholder="GENEI" />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        De 3 a 16 letras ou números, sem espaços. Tag vazia significa sem guilda. Trocar o nick apaga a conferência antiga no Albion — confira de novo pela lista.
      </p>

      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
          {error}
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : <UserRoundPen />}
          {saving ? "Salvando…" : "Salvar"}
        </Button>
      </div>
    </form>
  );
}

/**
 * Histórico do membro (AC#3). A lista é append-only: não existe botão de editar nem de apagar porque não
 * existe rota para isso — o que ficou errado se corrige escrevendo a próxima nota.
 */
function NotesPanel({ memberId, notes, error, onAdded }: { memberId: string; notes: UserNote[] | null; error: string | null; onAdded: (n: UserNote) => void }) {
  const fieldId = useId();
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const valid = validateUserNote(draft);
    if (!valid.ok) return toast.error(valid.error);
    setSaving(true);
    try {
      const { note } = await addMemberNote(memberId, valid.body);
      onAdded(note);
      setDraft("");
      toast.success("Nota registrada");
    } catch (e) {
      toast.error(errorText(e, "Não foi possível salvar a nota"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
          {error}
        </p>
      )}

      {!notes && !error && <p className="py-6 text-center text-sm text-muted-foreground">Carregando notas…</p>}

      {notes && notes.length === 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-dashed px-4 py-5 text-sm text-muted-foreground">
          <NotebookPen className="size-5 shrink-0" aria-hidden />
          <p>Nenhuma nota ainda. O que você escrever aqui fica no histórico para sempre, com seu nome e a data.</p>
        </div>
      )}

      {notes && notes.length > 0 && (
        <ol className="max-h-64 space-y-2 overflow-y-auto pr-1">
          {notes.map((note) => (
            <li
              key={note.id}
              className={cn(
                "note-in rounded-md border-l-2 bg-muted/40 py-2 pr-2 pl-3",
                // Nota do sistema é registro automático de edição: marca à esquerda diferente, além do rótulo.
                note.kind === "system" ? "border-l-info/60" : "border-l-foreground/40",
              )}
            >
              <p className="text-sm break-words">{note.body}</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                {note.kind === "system" && <Bot className="size-3.5" aria-label="Registro automático" />}
                <span className="font-medium text-foreground/80">{note.author?.name ?? "conta removida"}</span>
                <span aria-hidden>·</span>
                <time dateTime={note.createdAt} className="num">
                  {formatDateTime(note.createdAt)}
                </time>
              </p>
            </li>
          ))}
        </ol>
      )}

      <form onSubmit={(e) => void submit(e)} className="space-y-2">
        <Label htmlFor={fieldId} className="text-xs text-muted-foreground">
          Nova nota (não dá para editar nem apagar depois)
        </Label>
        <Textarea
          id={fieldId}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={USER_NOTE_MAX_LENGTH}
          rows={3}
          placeholder="Ex.: avisei no privado que o nick está errado."
        />
        <div className="flex items-center justify-between gap-2">
          <span className="num text-xs text-muted-foreground">
            {draft.length}/{USER_NOTE_MAX_LENGTH}
          </span>
          <Button type="submit" disabled={saving || draft.trim().length === 0}>
            {saving ? <Loader2 className="animate-spin" /> : <NotebookPen />}
            {saving ? "Salvando…" : "Adicionar nota"}
          </Button>
        </div>
      </form>
    </div>
  );
}
