import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  addUserNote,
  getAdminMemberProfile,
  listUserNotes,
  updateMemberProfile,
  type DbHandle,
  type UserNote,
} from "@albion-hub/db";
import { describeMemberProfileChange, validateGuildTag, validateNick, validateUserNote } from "@albion-hub/shared";
import { Authorize, CurrentAuth } from "../auth/authorize.js";
import { SameOriginGuard } from "../auth/same-origin.guard.js";
import type { AuthContext } from "../auth/session.service.js";
import { DB_HANDLE } from "../db/db.module.js";
import { AlbionCheckService, type AlbionCheckDto } from "../members/albion-check.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface UserNoteDto {
  id: string;
  kind: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string } | null;
}

const toNoteDto = (note: UserNote): UserNoteDto => ({ ...note, createdAt: note.createdAt.toISOString() });

/**
 * Ações sobre um membro específico do painel (TASK-045): conferir o nick na API do Albion sob demanda,
 * editar nick/tag e escrever notas internas.
 *
 * Permissão: o mesmo subject `UserRole` que guarda a lista `/admin/members` (TASK-043, Q13) — `read` para ler
 * notas, `update` para escrever qualquer coisa. `UserRole` é o único subject que nenhum papel abaixo de admin
 * alcança (staff tem `manage` em evento, saque e pedido de nick, e nada em `UserRole`), então member e caller
 * levam 403 aqui e não veem a tela (AC#4). Toda escrita passa também pelo `SameOriginGuard`, como o resto do painel.
 *
 * Auditoria (AC#2): a edição grava uma nota `kind = 'system'` com quem editou e o que mudou. Não existe coluna
 * "editado por" porque a pergunta real é a linha do tempo do membro, e ela já mora nas notas — append-only (AC#3).
 */
@Controller("admin/members/:userId")
export class AdminMemberProfileController {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(AlbionCheckService) private readonly albionCheck: AlbionCheckService,
  ) {}

  /**
   * Confere o nick vigente na API do Albion agora e guarda o resultado (AC#1).
   *
   * A regra mora no `AlbionCheckService`, compartilhado com o namespace de manutenção (TASK-048):
   * a mesma revalidação pelo painel e pelo curl.
   */
  @Post("albion-check")
  @UseGuards(SameOriginGuard)
  @Authorize("update", "UserRole")
  async check(@Param("userId") rawUserId: string): Promise<{ albion: AlbionCheckDto }> {
    return { albion: await this.albionCheck.recheck(parseUserId(rawUserId)) };
  }

  /**
   * Edita nick e tag de guilda (AC#2). Nick duplicado é 409: dois membros com o mesmo nick tornam
   * a lista inútil e a conferência no Albion ambígua.
   */
  @Patch()
  @UseGuards(SameOriginGuard)
  @Authorize("update", "UserRole")
  async edit(
    @Param("userId") rawUserId: string,
    @Body() body: { nick?: unknown; guildTag?: unknown },
    @CurrentAuth() auth: AuthContext,
  ): Promise<{ nick: string; guildTag: string | null; note: UserNoteDto | null }> {
    const userId = parseUserId(rawUserId);
    const nick = validateNick(body?.nick);
    if (!nick.ok) throw new BadRequestException(nick.error);
    const guildTag = validateGuildTag(body?.guildTag);
    if (!guildTag.ok) throw new BadRequestException(guildTag.error);

    const result = await updateMemberProfile(this.handle.db, userId, { nick: nick.nick, guildTag: guildTag.guildTag });
    if (!result.ok) {
      if (result.reason === "not_found") throw new NotFoundException("Usuário não encontrado.");
      throw new ConflictException("Outro membro já usa esse nick.");
    }

    const description = describeMemberProfileChange({
      nick: { from: result.before.gameNick, to: nick.nick },
      guildTag: { from: result.before.guildTag, to: guildTag.guildTag },
    });
    // Salvar sem mudar nada não vira linha no histórico: o registro é da mudança, não do clique.
    const note = description ? await addUserNote(this.handle.db, { userId, authorId: auth.user.id, body: description, kind: "system" }) : null;
    return { nick: nick.nick, guildTag: guildTag.guildTag, note: note ? toNoteDto(note) : null };
  }

  /** Histórico do membro, mais antigo primeiro (AC#3). */
  @Get("notes")
  @Authorize("read", "UserRole")
  async notes(@Param("userId") rawUserId: string): Promise<{ notes: UserNoteDto[] }> {
    const userId = parseUserId(rawUserId);
    await this.requireMember(userId);
    return { notes: (await listUserNotes(this.handle.db, userId)).map(toNoteDto) };
  }

  /** Acrescenta uma nota. Não existe rota de editar nem de apagar: o histórico só cresce (AC#3). */
  @Post("notes")
  @UseGuards(SameOriginGuard)
  @Authorize("update", "UserRole")
  async addNote(@Param("userId") rawUserId: string, @Body() body: { body?: unknown }, @CurrentAuth() auth: AuthContext): Promise<{ note: UserNoteDto }> {
    const userId = parseUserId(rawUserId);
    await this.requireMember(userId);
    const note = validateUserNote(body?.body);
    if (!note.ok) throw new BadRequestException(note.error);
    return { note: toNoteDto(await addUserNote(this.handle.db, { userId, authorId: auth.user.id, body: note.body, kind: "staff" })) };
  }

  private async requireMember(userId: string) {
    const member = await getAdminMemberProfile(this.handle.db, userId);
    if (!member) throw new NotFoundException("Usuário não encontrado.");
    return member;
  }
}

function parseUserId(userId: string): string {
  if (!UUID.test(userId)) throw new BadRequestException("Usuário inválido.");
  return userId;
}
