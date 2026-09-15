/** Ação no Discord derivada de uma decisão de nick (TASK-014, Q31). */
export type MemberSyncAction = { kind: "setNickname"; nick: string } | { kind: "addRole"; roleId: string };

export interface MemberSyncInput {
  decision: "approved" | "rejected";
  nick: string;
  /** Nick vigente antes da decisão; null = primeira aprovação. */
  previousGameNick: string | null;
}

/**
 * Regra pura: recusa não mexe em nada; aprovação aplica o apelido; só a primeira aprovação concede o cargo Membro
 * (troca de nick posterior só altera o apelido, Q31).
 */
export function planMemberSync(input: MemberSyncInput, memberRoleId: string): MemberSyncAction[] {
  if (input.decision !== "approved") return [];
  const actions: MemberSyncAction[] = [{ kind: "setNickname", nick: input.nick }];
  if (input.previousGameNick === null) actions.push({ kind: "addRole", roleId: memberRoleId });
  return actions;
}
