/** Ação no Discord derivada de uma decisão de nick (TASK-014, Q31). */
export type MemberSyncAction = { kind: "setNickname"; nick: string } | { kind: "addRole"; roleId: string };

export interface MemberSyncInput {
  decision: "approved" | "rejected";
  nick: string;
}

/**
 * Regra pura: recusa não mexe em nada; toda aprovação (primeira ou troca) aplica o apelido e garante o cargo Membro
 * (Q31 revisada, TASK-034). Adicionar cargo que o membro já tem é no-op no Discord, então é idempotente.
 */
export function planMemberSync(input: MemberSyncInput, memberRoleId: string): MemberSyncAction[] {
  if (input.decision !== "approved") return [];
  return [
    { kind: "setNickname", nick: input.nick },
    { kind: "addRole", roleId: memberRoleId },
  ];
}
