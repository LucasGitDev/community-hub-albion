import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, NotFoundException, Param, Post, UseGuards } from "@nestjs/common";
import type { MemberReferrals, ReferralRow } from "@albion-hub/db";
import { validateReferralReversalReason, type MemberReferralsDto, type ReferralDto } from "@albion-hub/shared";
import { Authorize, CurrentAuth } from "../auth/authorize.js";
import { SameOriginGuard } from "../auth/same-origin.guard.js";
import type { AuthContext } from "../auth/session.service.js";
import { ReferralService } from "../members/referral.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toDto = (row: ReferralRow): ReferralDto => ({
  referred: row.referred,
  referrer: row.referrer,
  declaredAt: row.declaredAt.toISOString(),
  rewardedAt: row.rewardedAt?.toISOString() ?? null,
  referrerPaid: row.referrerPaid,
  reversed: row.reversed,
});

const toResponse = (referrals: MemberReferrals): MemberReferralsDto => ({
  declared: referrals.declared ? toDto(referrals.declared) : null,
  made: referrals.made.map(toDto),
  rewardedThisMonth: referrals.rewardedThisMonth,
});

/**
 * Indicações de um membro para a staff (TASK-074, AC#8): quem o indicou, quem ele indicou, e o estorno
 * de uma paga por engano.
 *
 * O estorno é **de ledger**: nasce um `reversal` para cada um dos dois lançamentos, na mesma transação.
 * O campo `referred_by` continua gravado de propósito — a indicação aconteceu, e o que se desfaz é o
 * pagamento. Desfazer a indicação também seria impossível: a coluna é write-once no banco.
 *
 * Permissão em subject próprio (`Referral`), não em `MemberProfile`: mexer em dinheiro alheio não pode
 * entrar de carona no pacote de "gerenciar ficha do membro".
 */
@Controller("admin/members/:userId/referrals")
export class ReferralsController {
  constructor(private readonly referrals: ReferralService) {}

  @Get()
  @Authorize("read", "Referral")
  async list(@Param("userId") rawUserId: string): Promise<MemberReferralsDto> {
    return toResponse(await this.referrals.list(parseUserId(rawUserId)));
  }

  /**
   * Estorna a indicação **declarada por este membro** — é na linha dele que ela mora, então o alvo da
   * rota é o indicado, mesmo quando quem recebeu o valor maior foi o indicador.
   */
  @Post("reverse")
  @HttpCode(200)
  @UseGuards(SameOriginGuard)
  @Authorize("reverse", "Referral")
  async reverse(@Param("userId") rawUserId: string, @Body() body: { reason?: unknown }, @CurrentAuth() auth: AuthContext): Promise<MemberReferralsDto> {
    const userId = parseUserId(rawUserId);
    const reason = validateReferralReversalReason(body?.reason);
    if (!reason.ok) throw new BadRequestException(reason.error);

    const result = await this.referrals.reverse(userId, { reason: reason.reason, actorUserId: auth.user.id });
    if (!result.ok) {
      if (result.reason === "not_found") throw new NotFoundException("Esse membro não declarou quem o indicou.");
      if (result.reason === "not_paid") throw new ConflictException("Essa indicação ainda não pagou nada: não há o que estornar.");
      throw new ConflictException("Essa indicação já foi estornada.");
    }
    return toResponse(await this.referrals.list(userId));
  }
}

function parseUserId(userId: string): string {
  if (!UUID.test(userId)) throw new BadRequestException("Usuário inválido.");
  return userId;
}
