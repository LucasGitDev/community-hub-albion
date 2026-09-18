import { BadRequestException, Body, Controller, HttpCode, Inject, NotFoundException, Optional, Post, ServiceUnavailableException, UseGuards } from "@nestjs/common";
import { addUserNote, getAdminMemberProfile, type DbHandle } from "@albion-hub/db";
import { DB_HANDLE } from "../db/db.module.js";
import { CURRENCY_LABELS, formatAmount, MAINTENANCE_LEDGER_REFERENCE, type Currency } from "@albion-hub/shared";
import { parseAdjustment } from "../domain/maintenance.js";
import { TIMELINE_PUBLISHER, type TimelineDetail, type TimelineEntry, type TimelinePublisher } from "../domain/timeline.js";
import { loadTimelinePeople, publishAfterCommit } from "../timeline/after-commit.js";
import { LedgerService } from "../economy/ledger.service.js";
import { AlbionCheckService, type AlbionCheckDto } from "../members/albion-check.service.js";
import { MaintenanceTokenGuard } from "./maintenance-token.guard.js";
import { MAINTENANCE_CLEANUP, type MaintenanceCleanup, type MaintenanceCleanupResult } from "./maintenance.tokens.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Origem fixa dos lançamentos de manutenção: `byReference("manual", "maintenance")` lista todos eles.
 *  Mora em shared porque o extrato da staff (TASK-051) precisa reconhecer essa mesma origem pra rotular a linha. */
const MAINTENANCE_REFERENCE = MAINTENANCE_LEDGER_REFERENCE;

export interface MaintenanceAdjustmentResponse {
  entryId: string;
  userId: string;
  /** Moeda ajustada: a resposta diz de que moeda são os números, para não haver dúvida no curl (F6-1). */
  currency: Currency;
  amount: string;
  /** Saldo **daquela moeda** depois do ajuste; nunca um total das duas (F6-27). */
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
    @Inject(TIMELINE_PUBLISHER) private readonly timeline: TimelinePublisher,
    @Optional() @Inject(MAINTENANCE_CLEANUP) private readonly cleanup: MaintenanceCleanup | null = null,
  ) {}

  /** Ajuste de prata: lançamento `adjustment` com motivo obrigatório, visível no extrato do jogador (AC#2). */
  @Post("silver")
  adjustSilver(@Body() body: unknown): Promise<MaintenanceAdjustmentResponse> {
    return this.adjust(body, "silver");
  }

  /**
   * Ajuste de Buffunfa (F6-6): **irmã** da rota de prata, atrás do mesmo guard de header, do mesmo rate
   * limit e do mesmo motivo obrigatório. Existe porque a Buffunfa não tem saque nem qualquer outra porta
   * manual: sem ela, um erro de taxa ou de pagamento ficaria sem conserto, já que o ledger é append-only.
   *
   * É a **única** exceção registrada à trava de saldo não-negativo (F6-7): quem ganhou por engano e já
   * gastou precisa poder ficar devendo, então o ajuste entra por `record` e não pelo `spend`.
   */
  @Post("buffunfa")
  adjustBuffunfa(@Body() body: unknown): Promise<MaintenanceAdjustmentResponse> {
    return this.adjust(body, "buffunfa");
  }

  private async adjust(body: unknown, currency: Currency): Promise<MaintenanceAdjustmentResponse> {
    const userId = parseUserId(body);
    const parsed = parseAdjustment(body, currency);
    if (!parsed.ok) throw new BadRequestException(parsed.error);
    await this.requireMember(userId);

    const memo = `Manutenção: ${parsed.reason}`;
    const entry = await this.ledger.record({ userId, currency, amount: parsed.amount, kind: "adjustment", reference: MAINTENANCE_REFERENCE, createdBy: null, memo });
    const note = `Ajuste de ${CURRENCY_LABELS[currency]} por manutenção: ${formatAmount(parsed.amount, currency)}. Motivo: ${parsed.reason}`;
    await addUserNote(this.handle.db, { userId, authorId: null, kind: "system", body: note });
    const balance = await this.ledger.balance(userId, currency);
    // T9: ajuste de manutenção aparece **sempre**, com o ator "manutenção" e o motivo informado.
    await this.publish(userId, (target) => ({
      action: currency === "silver" ? "maintenance.silver_adjusted" : "maintenance.buffunfa_adjusted",
      summary: `Ajuste de ${CURRENCY_LABELS[currency]} por manutenção: ${target.name}`,
      amounts: [
        { value: entry.amount, currency, label: "Ajuste" },
        { value: balance, currency, label: "Saldo depois" },
      ],
      recordId: entry.id,
      details: [{ name: "Motivo", value: parsed.reason }],
    }));
    return { entryId: entry.id, userId, currency, amount: entry.amount.toString(), balance: balance.toString() };
  }

  /** Revalida o nick do jogador na API do Albion e grava o resultado (AC#3). Mesma regra do painel. */
  @Post("albion-check")
  async recheckNick(@Body() body: unknown): Promise<{ albion: AlbionCheckDto }> {
    const userId = parseUserId(body);
    const albion = await this.albionCheck.recheck(userId);
    await this.publish(userId, (target) => ({
      action: "maintenance.albion_rechecked",
      summary: `Nick revalidado no Albion por manutenção: ${target.name}`,
      recordId: userId,
      details: [
        { name: "Resultado", value: albion.status ?? "—" },
        ...(albion.guildName ? [{ name: "Guilda", value: albion.guildName }] : []),
      ],
    }));
    return { albion };
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
    const result = await this.cleanup.run();
    const details: TimelineDetail[] = Object.entries(result).map(([name, value]) => ({ name, value: String(value) }));
    this.timeline.publish({ action: "maintenance.cleanup_run", summary: "Limpeza disparada por manutenção", actor: { kind: "maintenance" }, ...(details.length ? { details } : {}) });
    return { result };
  }

  /**
   * Timeline (TASK-078, T9): ator sempre `maintenance`, alvo é o membro do corpo. Nada do pedido além do
   * que a operação gravou vai para o registro — nem header, nem token.
   */
  private publish(userId: string, build: (target: { name: string; id: string; discordId?: string | null }) => Omit<TimelineEntry, "actor" | "target">): Promise<void> {
    return publishAfterCommit(this.timeline, async () => {
      const target = (await loadTimelinePeople(this.handle.db, [userId])).target(userId);
      return { ...build({ ...target, id: userId }), actor: { kind: "maintenance" as const }, target };
    });
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
