import { BadRequestException, Controller, Get, Inject, Query, Res } from "@nestjs/common";
import { encodeLedgerCursor, parseLedgerPageQuery, type LedgerCurrencyFilter, type LedgerEntryDto } from "@albion-hub/shared";
import type { LedgerEntry } from "@albion-hub/db";
import type { Response } from "express";
import { Authorize, CurrentAuth, type AuthorizedRequest } from "../auth/authorize.js";
import { LedgerService } from "./ledger.service.js";

type Auth = AuthorizedRequest["auth"];

/** Valor sai como string (Q20) e o `userId` não volta: a rota só existe para o dono da sessão. */
const toDto = (entry: LedgerEntry): LedgerEntryDto => ({
  id: entry.id,
  amount: entry.amount.toString(),
  currency: entry.currency,
  kind: entry.kind,
  referenceType: entry.referenceType,
  referenceId: entry.referenceId,
  reversalOf: entry.reversalOf,
  memo: entry.memo,
  createdAt: entry.createdAt.toISOString(),
});

export interface MyLedgerResponse {
  /** Moeda que este extrato está mostrando; `"all"` é o default (F6-27). */
  currency: LedgerCurrencyFilter;
  entries: LedgerEntryDto[];
  /** Cursor da próxima página; null quando o extrato acabou. */
  nextCursor: string | null;
}

/**
 * Extrato do próprio membro (TASK-031, AC#1). Irmã de `MyWithdrawalsController` e pelo mesmo motivo:
 * aqui o dono do extrato **nunca** vem do cliente.
 *
 * Segurança (security-review da TASK-026): `LedgerService.statement` recebe `userId` e confia em quem
 * chama, então este handler usa `auth.user.id` e mais nada. Não existe parâmetro de usuário na rota nem
 * na query — mandar `?userId=` de outro membro não muda nada, e é isso que o teste http prova (AC#2).
 */
@Controller("me/ledger")
export class MyLedgerController {
  constructor(@Inject(LedgerService) private readonly ledger: LedgerService) {}

  @Get()
  @Authorize("read", "Withdrawal")
  async mine(@Query() query: Record<string, unknown>, @CurrentAuth() auth: Auth, @Res({ passthrough: true }) res: Response): Promise<MyLedgerResponse> {
    const parsed = parseLedgerPageQuery(query);
    if (!parsed.ok) throw new BadRequestException(parsed.error);
    const page = await this.ledger.statement(auth.user.id, parsed.currency, { limit: parsed.limit, cursor: parsed.cursor ?? null });
    res.setHeader("Cache-Control", "no-store");
    return {
      currency: parsed.currency,
      entries: page.entries.map(toDto),
      nextCursor: page.nextCursor ? encodeLedgerCursor({ createdAt: page.nextCursor.createdAt.toISOString(), id: page.nextCursor.id }) : null,
    };
  }
}
