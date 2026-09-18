import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { declareReferral, findUserByDiscordId, findUserByGameNick, getMemberReferrals, getReferrerOf, reverseReferral, settleReferral, type DbHandle, type MemberReferrals, type ReverseReferralResult, type SettleReferralResult } from "@albion-hub/db";
import { REFERRAL_BONUS, validateNick, type ReferralDeclarationOutcome, type ReferralReward, type ReferrerSkipReason } from "@albion-hub/shared";
import { DB_HANDLE } from "../db/db.module.js";
import { TIMELINE_PUBLISHER, type TimelinePublisher } from "../domain/timeline.js";
import { loadTimelinePeople, publishAfterCommit, TIMELINE_LOGGER } from "../timeline/timeline-people.js";
import { NickDecisionService } from "./nick-decision.service.js";

/**
 * Serviço interno único da indicação (TASK-074). Bot (`/registrar` e `/indicacao`) e painel só chamam
 * daqui — é regra do projeto, e aqui ela paga: declarar e pagar têm duas corridas de dinheiro (duas
 * declarações simultâneas, declaração no exato instante da aprovação do nick) e uma cópia dessa lógica
 * em outro lugar seria uma cópia do erro.
 *
 * **Quem paga é o último a chegar.** As duas condições são declaração feita e nick do indicado aprovado.
 * Por isso este serviço chama `settle` nos dois pontos: depois de gravar a declaração (paga na hora quando
 * o nick já estava aprovado — o caso retroativo) e no hook de aprovação de nick. `settle` é idempotente
 * por construção no banco, então disparar duas vezes paga uma vez só.
 */
@Injectable()
export class ReferralService implements OnModuleInit {
  private readonly logger = new Logger(ReferralService.name);

  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(NickDecisionService) private readonly decisions: NickDecisionService,
    @Inject(TIMELINE_PUBLISHER) private readonly timeline: TimelinePublisher,
  ) {}

  onModuleInit(): void {
    // Aprovação de nick é o portão que libera o pagamento (F11). Listener roda depois do commit da decisão.
    this.decisions.onDecided(async (event) => {
      if (event.decision !== "approved") return;
      const result = await this.settle(event.request.userId);
      if (result.kind === "paid" || result.kind === "paid_referred_only") {
        this.logger.log(`Indicação de ${event.request.userId} liquidada na aprovação do nick: ${result.kind}`);
      }
    });
  }

  /**
   * Declara quem indicou. Recusas dizem o que fazer: autoindicação, quem já declarou (com o nome gravado)
   * e nick sem conta no painel. A recusa de autoindicação também existe no banco (check), mas a mensagem
   * boa é esta — o check é a rede, não a porta.
   */
  async declare(referredUserId: string, input: unknown): Promise<ReferralDeclarationOutcome> {
    const parsed = validateNick(input);
    if (!parsed.ok) return { kind: "invalid", error: parsed.error };
    const existing = await getReferrerOf(this.handle.db, referredUserId);
    if (existing) return { kind: "already_declared", referrerNick: existing.gameNick ?? existing.name };
    const referrer = await findUserByGameNick(this.handle.db, parsed.nick);
    if (!referrer) return { kind: "referrer_not_found", nick: parsed.nick };
    return this.declareTo(referredUserId, referrer);
  }

  /**
   * Mesma declaração, com o indicador escolhido pelo seletor de membros do Discord (TASK-075). O ID não
   * tem grafia, então a recusa possível deixa de ser "nick errado" e passa a ser "essa pessoa nunca
   * entrou no painel" — `label` é o nome que o Discord mostrou, para a mensagem dizer de quem se trata.
   */
  async declareByDiscordId(referredUserId: string, referrerDiscordId: string, label: string): Promise<ReferralDeclarationOutcome> {
    const existing = await getReferrerOf(this.handle.db, referredUserId);
    if (existing) return { kind: "already_declared", referrerNick: existing.gameNick ?? existing.name };
    const referrer = await findUserByDiscordId(this.handle.db, referrerDiscordId);
    if (!referrer) return { kind: "referrer_not_registered", name: label };
    return this.declareTo(referredUserId, referrer);
  }

  /** O que as duas portas têm em comum, depois que o indicador já foi achado. */
  private async declareTo(referredUserId: string, referrer: { id: string; gameNick: string | null; name: string }): Promise<ReferralDeclarationOutcome> {
    if (referrer.id === referredUserId) return { kind: "self" };
    const db = this.handle.db;
    const declared = await declareReferral(db, referredUserId, referrer.id);
    // Perdeu a corrida para outra declaração da mesma pessoa: a que venceu é a que vale, e não se troca.
    if (!declared.ok) return { kind: "already_declared", referrerNick: declared.referrer?.gameNick ?? declared.referrer?.name ?? null };
    await this.publishDeclared(referredUserId, referrer.id);

    const settled = await this.settle(referredUserId);
    return { kind: "declared", referrerNick: referrer.gameNick ?? referrer.name, reward: toReward(settled) };
  }

  /** Liquida a indicação de quem está com nick aprovado. Seguro chamar sempre: paga no máximo uma vez. */
  async settle(referredUserId: string): Promise<SettleReferralResult> {
    const result = await settleReferral(this.handle.db, referredUserId);
    if (result.kind === "paid" || result.kind === "paid_referred_only") await this.publishPaid(referredUserId, result);
    return result;
  }

  /** Indicações de um membro, como a staff lê (AC#8). */
  list(userId: string): Promise<MemberReferrals> {
    return getMemberReferrals(this.handle.db, userId);
  }

  /** Estorno de indicação paga por engano: estorno de ledger, nunca edição, e a indicação segue registrada. */
  async reverse(referredUserId: string, options: { reason: string; actorUserId: string }): Promise<ReverseReferralResult> {
    const result = await reverseReferral(this.handle.db, referredUserId, options);
    if (result.ok) await this.publishReversed(referredUserId, result.referral.referrer.id, result.referral.referrerPaid, options);
    return result;
  }

  // Timeline (TASK-078). Todos os três só rodam com o repo já de volta, ou seja, depois do commit (T5).
  // O `recordId` é o id do indicado: é a chave da indicação no ledger (`referralReference`).

  private publishDeclared(referredUserId: string, referrerUserId: string): Promise<void> {
    return publishAfterCommit(this.timeline, TIMELINE_LOGGER, async () => {
      const people = await loadTimelinePeople(this.handle.db, [referredUserId, referrerUserId]);
      return {
        action: "referral.declared" as const,
        summary: `Indicação declarada: ${people.name(referredUserId)} indicado por ${people.name(referrerUserId)}`,
        actor: people.actor(referredUserId),
        target: people.target(referrerUserId),
        recordId: referredUserId,
      };
    });
  }

  private publishPaid(referredUserId: string, result: Extract<SettleReferralResult, { kind: "paid" | "paid_referred_only" }>): Promise<void> {
    return publishAfterCommit(this.timeline, TIMELINE_LOGGER, async () => {
      const people = await loadTimelinePeople(this.handle.db, [referredUserId, result.referrer.id]);
      const referrerPaid = result.kind === "paid";
      return {
        action: "referral.paid" as const,
        summary: `Indicação paga: ${people.name(referredUserId)}`,
        actor: { kind: "system" as const, name: "pagamento da indicação" },
        target: people.target(referredUserId),
        amounts: [
          { value: REFERRAL_BONUS.referred, currency: "buffunfa" as const, label: "Indicado" },
          ...(referrerPaid ? [{ value: REFERRAL_BONUS.referrer, currency: "buffunfa" as const, label: "Indicador" }] : []),
        ],
        recordId: referredUserId,
        details: [
          { name: "Indicador", value: people.name(result.referrer.id) },
          ...(result.kind === "paid_referred_only" ? [{ name: "Indicador não recebeu", value: SKIP_LABELS[result.reason] }] : []),
        ],
      };
    });
  }

  private publishReversed(referredUserId: string, referrerUserId: string, referrerPaid: boolean, options: { reason: string; actorUserId: string }): Promise<void> {
    return publishAfterCommit(this.timeline, TIMELINE_LOGGER, async () => {
      const people = await loadTimelinePeople(this.handle.db, [options.actorUserId, referredUserId, referrerUserId]);
      return {
        action: "referral.reversed" as const,
        summary: `Indicação estornada: ${people.name(referredUserId)}`,
        actor: people.actor(options.actorUserId),
        target: people.target(referredUserId),
        amounts: [
          { value: -REFERRAL_BONUS.referred, currency: "buffunfa" as const, label: "Indicado" },
          ...(referrerPaid ? [{ value: -REFERRAL_BONUS.referrer, currency: "buffunfa" as const, label: "Indicador" }] : []),
        ],
        recordId: referredUserId,
        details: [
          { name: "Motivo", value: options.reason },
          { name: "Indicador", value: people.name(referrerUserId) },
        ],
      };
    });
  }
}

const SKIP_LABELS: Record<ReferrerSkipReason, string> = {
  unavailable: "banido ou fora da guilda",
  monthly_cap: "teto mensal de indicações pagas atingido",
};

/** Traduz o resultado do banco para o que o membro lê. `not_declared` não alcança quem acabou de declarar. */
function toReward(result: SettleReferralResult): ReferralReward {
  switch (result.kind) {
    case "paid":
      return { kind: "paid" };
    case "paid_referred_only":
      return { kind: "paid_referred_only", reason: result.reason };
    case "already_settled":
      return { kind: "already_settled" };
    default:
      return { kind: "pending" };
  }
}
