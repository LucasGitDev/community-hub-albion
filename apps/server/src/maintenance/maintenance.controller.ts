import { BadRequestException, Body, Controller, HttpCode, Inject, NotFoundException, Optional, Post, ServiceUnavailableException, UseGuards } from "@nestjs/common";
import { addUserNote, getAdminMemberProfile, type DbHandle } from "@albion-hub/db";
import { DB_HANDLE } from "../db/db.module.js";
import { parseSilverAdjustment } from "../domain/maintenance.js";
import { LedgerService } from "../economy/ledger.service.js";
import { AlbionCheckService, type AlbionCheckDto } from "../members/albion-check.service.js";
import { MaintenanceTokenGuard } from "./maintenance-token.guard.js";
import { MAINTENANCE_CLEANUP, type MaintenanceCleanup, type MaintenanceCleanupResult } from "./maintenance.tokens.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Origem fixa dos lançamentos de manutenção: `byReference("manual", "maintenance")` lista todos eles. */
const MAINTENANCE_REFERENCE = { type: "manual", id: "maintenance" } as const;

export interface MaintenanceAdjustmentResponse {
  entryId: string;
  userId: string;
  amount: string;
  balance: string;
}

/**
 * Namespace de manutenção (TASK-048, G5): dev **e** produção, sem sessão, chamado por curl.
 *
 * É a rota mais perigosa do sistema — ela cria prata em produção. O que limita o estrago:
 *
 * - `MaintenanceTokenGuard` no controller inteiro: sem `MAINTENANCE_TOKEN` o módulo nem é registrado
 *   (ver `MaintenanceModule`), e com ele qualquer recusa é o 404 de rota inexistente;
 * - rate limit do namespace, no mesmo guard;
 * - prata só nasce pelo `LedgerService` (append-only, Q20): não há SQL direto nem UPDATE aqui;
 * - motivo obrigatório em todo ajuste, gravado no `memo` do lançamento **e** numa nota `system` do
 *   membro, então o ajuste aparece no extrato e na linha do tempo (AC#2);
 * - `createdBy` fica `null` — a coluna guarda *pessoa logada*, e aqui não há sessão nenhuma. A autoria
 *   de manutenção é explícita no texto e na origem `manual/maintenance`.
 *
 * O que este namespace **não** faz, por decisão (AC#4, G5): não lê cookie, não cria sessão, não lê
 * sessão de ninguém e não age como outro usuário. O alvo é sempre um `userId` explícito no corpo, e ele
 * é paciente da operação, nunca ator. Login sem Discord continua só no dev-login, que o env proíbe em
 * produção e que esta task não tocou.
 */
@Controller("maintenance")
@UseGuards(MaintenanceTokenGuard)
export class MaintenanceController {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(AlbionCheckService) private readonly albionCheck: AlbionCheckService,
    @Optional() @Inject(MAINTENANCE_CLEANUP) private readonly cleanup: MaintenanceCleanup | null = null,
  ) {}

  /** Ajuste de prata: lançamento `adjustment` com motivo obrigatório, visível no extrato do jogador (AC#2). */
  @Post("silver")
  async adjustSilver(@Body() body: unknown): Promise<MaintenanceAdjustmentResponse> {
    const userId = parseUserId(body);
    const parsed = parseSilverAdjustment(body);
    if (!parsed.ok) throw new BadRequestException(parsed.error);
    await this.requireMember(userId);

    const memo = `Manutenção: ${parsed.reason}`;
    const entry = await this.ledger.record({ userId, amount: parsed.amount, kind: "adjustment", reference: MAINTENANCE_REFERENCE, createdBy: null, memo });
    await addUserNote(this.handle.db, { userId, authorId: null, kind: "system", body: `Ajuste de prata por manutenção: ${parsed.amount.toString()}. Motivo: ${parsed.reason}` });
    return { entryId: entry.id, userId, amount: entry.amount.toString(), balance: (await this.ledger.balance(userId)).toString() };
  }

  /** Revalida o nick do jogador na API do Albion e grava o resultado (AC#3). Mesma regra do painel. */
  @Post("albion-check")
  async recheckNick(@Body() body: unknown): Promise<{ albion: AlbionCheckDto }> {
    return { albion: await this.albionCheck.recheck(parseUserId(body)) };
  }

  /**
   * Dispara a limpeza diária sob demanda (AC#3, TASK-049).
   *
   * A limpeza em si é da TASK-049: aqui existe só a porta. Sem provider para `MAINTENANCE_CLEANUP` a
   * rota responde 503 e diz que não rodou — nunca 200 vazio fingindo trabalho feito.
   */
  @Post("cleanup")
  @HttpCode(200)
  async runCleanup(): Promise<{ result: MaintenanceCleanupResult }> {
    if (!this.cleanup) throw new ServiceUnavailableException("Limpeza ainda não implementada neste servidor (TASK-049).");
    return { result: await this.cleanup.run() };
  }

  private async requireMember(userId: string) {
    const member = await getAdminMemberProfile(this.handle.db, userId);
    if (!member) throw new NotFoundException("Usuário não encontrado.");
    return member;
  }
}

function parseUserId(body: unknown): string {
  const userId = (body as { userId?: unknown } | null)?.userId;
  if (typeof userId !== "string" || !UUID.test(userId)) throw new BadRequestException("userId inválido: esperado uuid do usuário no corpo.");
  return userId;
}
