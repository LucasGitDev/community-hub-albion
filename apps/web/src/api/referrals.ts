import type { MemberReferralsDto } from "@albion-hub/shared";
import { api } from "./http";

/**
 * Indicações de um membro lidas pela staff (TASK-074, AC#8). A rota é
 * `/api/admin/members/:userId/referrals` e exige `read Referral` — subject próprio, porque isto é
 * dinheiro e não pode entrar de carona no pacote de "gerenciar ficha do membro".
 *
 * Não há aqui nenhuma chamada que edite a indicação: o campo é write-once no banco, e a única
 * correção é o estorno, que devolve a listagem já atualizada.
 */
export const fetchMemberReferrals = (userId: string): Promise<MemberReferralsDto> => api<MemberReferralsDto>(`/api/admin/members/${userId}/referrals`);

/** Estorna os dois lançamentos da indicação declarada por este membro. Motivo obrigatório. */
export const reverseMemberReferral = (userId: string, reason: string): Promise<MemberReferralsDto> =>
  api<MemberReferralsDto>(`/api/admin/members/${userId}/referrals/reverse`, { method: "POST", body: JSON.stringify({ reason }) });
