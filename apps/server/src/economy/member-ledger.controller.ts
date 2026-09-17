import { BadRequestException, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Query, Res } from "@nestjs/common";
import { getAdminMemberProfile, getWithdrawalBalance, listLedgerEntriesWithAuthor, type DbHandle, type LedgerEntryWithAuthor } from "@albion-hub/db";
import { asSubject, encodeLedgerCursor, parseLedgerPageQuery, type MemberLedgerEntryDto, type WithdrawalBalanceDto } from "@albion-hub/shared";
import type { Response } from "express";
import { Authorize, CurrentAuth, type AuthorizedRequest } from "../auth/authorize.js";
import { DB_HANDLE } from "../db/db.module.js";

type Auth = AuthorizedRequest["auth"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Prata sai como string (Q20): JSON não tem inteiro grande o bastante e `number` perderia prata. */
const toDto = (entry: LedgerEntryWithAuthor): MemberLedgerEntryDto => ({
  id: entry.id,
  amount: entry.amount.toString(),
  kind: entry.kind,
  referenceType: entry.referenceType,
  referenceId: entry.referenceId,
  reversalOf: entry.reversalOf,
  memo: entry.memo,
  createdAt: entry.createdAt.toISOString(),
  author: entry.author,
});

export interface MemberLedgerResponse {
  member: { id: string; name: string };
  balance: WithdrawalBalanceDto;
  entries: MemberLedgerEntryDto[];
  /** Cursor da próxima página; null quando o extrato acabou. */
  nextCursor: string | null;
}

/**
 * Extrato de um jogador para staff e admin (TASK-051, G10). Leitura e nada mais: ajustar prata continua
 * existindo só no namespace de manutenção (TASK-048, G5), então aqui não há um único caminho de escrita.
 *
 * **Permissão (o ponto sensível).** Extrato alheio é dado sensível, e o erro da TASK-027 foi gatear por uma
 * ação que todo membro logado tem. `read`/`Wallet` sozinha teria o mesmo defeito: o decorator só checa por
 * **tipo**, e member e caller têm sim a regra `read Wallet` — só que **condicionada ao próprio id**. Por isso
 * o handler repete a pergunta com a condição, via `asSubject("Wallet", { userId: alvo })`:
 * - member/caller pedindo o extrato de outro → a condição `{ userId: self }` não casa → 403;
 * - staff/admin → `can("read", "Wallet")` sem condição (e `manage all` no admin) → passa para qualquer alvo.
 *
 * O alvo vem da rota e o ator **sempre** da sessão: nenhum parâmetro do cliente escolhe quem está lendo.
 * Membro pedindo o próprio extrato por aqui também passa — é o mesmo dado que `/api/me/ledger` já devolve
 * a ele, então recusar seria teatro; o que importa é que ele não alcança o de mais ninguém.
 */
@Controller("admin/members/:userId/ledger")
export class MemberLedgerController {
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  @Get()
  @Authorize("read", "Wallet")
  async statement(
    @Param("userId") rawUserId: string,
    @Query() query: Record<string, unknown>,
    @CurrentAuth() auth: Auth,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MemberLedgerResponse> {
    if (!UUID.test(rawUserId)) throw new BadRequestException("Usuário inválido.");
    const userId = rawUserId;
    // A checagem que realmente separa staff de membro: a regra do membro é condicionada ao próprio id.
    if (!auth.ability.can("read", asSubject("Wallet", { userId }))) throw new ForbiddenException("Você não tem permissão para esta ação.");

    const parsed = parseLedgerPageQuery(query);
    if (!parsed.ok) throw new BadRequestException(parsed.error);

    const member = await getAdminMemberProfile(this.handle.db, userId);
    if (!member) throw new NotFoundException("Usuário não encontrado.");

    // Reserva é só o que está `pending` (Q25): `approved` já lançou o débito no ledger, contar de novo
    // subtrairia a mesma prata duas vezes. A conta é a mesma do saque — não existe segunda versão dela.
    const balance = await getWithdrawalBalance(this.handle.db, userId);
    const page = await listLedgerEntriesWithAuthor(this.handle.db, userId, { limit: parsed.limit, cursor: parsed.cursor ?? null });

    res.setHeader("Cache-Control", "no-store");
    return {
      member: { id: member.id, name: member.name },
      balance: { balance: balance.balance.toString(), reserved: balance.reserved.toString(), available: balance.available.toString() },
      entries: page.entries.map(toDto),
      nextCursor: page.nextCursor ? encodeLedgerCursor({ createdAt: page.nextCursor.createdAt.toISOString(), id: page.nextCursor.id }) : null,
    };
  }
}
