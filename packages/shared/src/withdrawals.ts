import { z } from "zod";

/**
 * Saque de prata (doc-002, TASK-030). Tabela própria, só prata, fora do ledger — o ledger só recebe
 * o débito quando a staff aprova (Q25).
 *
 * Máquina de estados:
 *
 *   pending ──approve──> approved ──settle──> settled
 *      └────reject────> rejected
 *
 * Regras que valem para API, bot e painel:
 * - **Sem valor mínimo e sem taxa** (Q12, revisado em 2026-09-16; a versão anterior exigia 1M).
 *   O pedido só é recusado por valor não positivo ou acima do saldo disponível (AC#1).
 * - `pending` **reserva** o saldo sem lançar nada no ledger (AC#2, Q25): o saldo disponível cai na hora,
 *   mas o extrato do membro só muda quando a staff decide.
 * - `approved` lança o débito no ledger; `rejected` libera a reserva sem lançamento nenhum (AC#3, Q25).
 * - `settled` é manual e exige quem liquidou (`settled_by`) + nota (AC#4, Q11): a staff transferiu a prata
 *   in-game (Q10) e escreve como/quando.
 * - Saldo negativo é permitido (estorno depois de um saque) mas **bloqueia pedido novo** (Q24).
 */
export const WITHDRAWAL_STATUSES = ["pending", "approved", "rejected", "settled"] as const;
export type WithdrawalStatus = (typeof WITHDRAWAL_STATUSES)[number];

/** Estados terminais: não saem mais de lugar nenhum. */
export const TERMINAL_WITHDRAWAL_STATUSES: readonly WithdrawalStatus[] = ["rejected", "settled"];

/**
 * Estados que **reservam** saldo, isto é, prendem prata que o membro ainda não pode pedir de novo.
 *
 * Só `pending` entra aqui, e é proposital: a partir de `approved` o débito já está lançado no ledger,
 * então o próprio saldo do ledger já desconta o saque. Contar `approved` de novo tiraria a mesma prata
 * duas vezes do saldo disponível. A regra em uma frase: **reserva = saque que ainda não virou lançamento**.
 */
export const RESERVING_WITHDRAWAL_STATUSES: readonly WithdrawalStatus[] = ["pending"];

export const WITHDRAWAL_STATUS_LABELS: Record<WithdrawalStatus, string> = {
  pending: "aguardando aprovação",
  approved: "aprovado",
  rejected: "recusado",
  settled: "pago",
};

/** Transições permitidas por estado. Fonte única da máquina (mesma ideia da TASK-021). */
export const ALLOWED_WITHDRAWAL_TRANSITIONS: Record<WithdrawalStatus, readonly WithdrawalStatus[]> = {
  pending: ["approved", "rejected"],
  approved: ["settled"],
  rejected: [],
  settled: [],
};

export const canTransitionWithdrawal = (from: WithdrawalStatus, to: WithdrawalStatus): boolean => ALLOWED_WITHDRAWAL_TRANSITIONS[from].includes(to);

/** Frase PT-BR que explica a recusa da transição (Q18: diz o que dá pra fazer). */
export function withdrawalTransitionError(from: WithdrawalStatus, to: WithdrawalStatus): string {
  const next = ALLOWED_WITHDRAWAL_TRANSITIONS[from];
  const base = `O saque está ${WITHDRAWAL_STATUS_LABELS[from]} e não pode ir para ${WITHDRAWAL_STATUS_LABELS[to]}.`;
  if (next.length === 0) return `${base} Esse é um estado final.`;
  return `${base} Daqui só dá para ir para: ${next.map((s) => WITHDRAWAL_STATUS_LABELS[s]).join(", ")}.`;
}

/**
 * Saldo disponível para saque: o que o ledger diz menos o que já está reservado por saques `pending`.
 *
 * Esta é a **conta única** do sistema (AC#2). API, painel e bot chamam daqui; o repo faz a mesma conta em
 * SQL dentro da transação para decidir de verdade (AC#5), e os dois precisam concordar.
 */
export const availableBalance = (ledgerBalance: bigint, reserved: bigint): bigint => ledgerBalance - reserved;

export type WithdrawalRefusal =
  /** Valor zero ou negativo: não existe saque de nada nem saque que credita. */
  | { reason: "not_positive" }
  /** Saldo do ledger negativo (Q24): precisa acertar a conta antes de pedir de novo. */
  | { reason: "negative_balance"; balance: bigint }
  /** Pediu mais do que sobrou depois das reservas (AC#1). */
  | { reason: "insufficient"; available: bigint };

/**
 * Decide se um pedido pode nascer. Sem mínimo e sem taxa (Q12 revisado): as únicas recusas são valor
 * não positivo, saldo negativo (Q24) e valor acima do disponível (AC#1).
 *
 * Pura de propósito: o repo chama isto **dentro** da transação, com os números já lidos sob trava,
 * e o painel chama com os números da tela para avisar antes de o membro enviar.
 */
export function checkWithdrawalRequest(amount: bigint, ledgerBalance: bigint, reserved: bigint): WithdrawalRefusal | null {
  if (amount <= 0n) return { reason: "not_positive" };
  if (ledgerBalance < 0n) return { reason: "negative_balance", balance: ledgerBalance };
  const available = availableBalance(ledgerBalance, reserved);
  if (amount > available) return { reason: "insufficient", available };
  return null;
}

/** Mensagem PT-BR da recusa, uma só para API, painel e bot. */
export function withdrawalRefusalMessage(refusal: WithdrawalRefusal): string {
  switch (refusal.reason) {
    case "not_positive":
      return "Informe um valor de saque maior que zero.";
    case "negative_balance":
      return "Seu saldo está negativo. Fale com a staff para acertar a conta antes de pedir um saque.";
    case "insufficient":
      return `Você tem ${formatAvailable(refusal.available)} de prata disponível para saque. Saques aguardando aprovação já estão descontados daqui.`;
  }
}

const ptBR = new Intl.NumberFormat("pt-BR");
const formatAvailable = (v: bigint) => ptBR.format(v);

export const WITHDRAWAL_NOTE_MAX = 300;

/** Prata vinda do JSON: aceita number inteiro ou string de dígitos e vira bigint (Q20, nunca float). */
const silverAmount = z
  .union([z.number(), z.string(), z.bigint()])
  .transform((v, ctx) => {
    if (typeof v === "bigint") return v;
    if (typeof v === "number") {
      if (!Number.isSafeInteger(v)) {
        ctx.addIssue({ code: "custom", message: "Informe o valor em prata inteira, sem centavos." });
        return z.NEVER;
      }
      return BigInt(v);
    }
    const raw = v.trim();
    if (!/^-?\d+$/.test(raw)) {
      ctx.addIssue({ code: "custom", message: "Informe o valor em prata inteira, só números." });
      return z.NEVER;
    }
    return BigInt(raw);
  })
  .refine((v) => v > 0n, "Informe um valor de saque maior que zero.");

const requiredNote = (label: string) =>
  z
    .string({ error: `Escreva ${label}.` })
    .trim()
    .min(1, `Escreva ${label}.`)
    .max(WITHDRAWAL_NOTE_MAX, `O texto tem no máximo ${WITHDRAWAL_NOTE_MAX} caracteres.`);

/**
 * Corpo do pedido. **Não tem `userId`**: o dono do saque sai sempre da sessão, nunca do corpo —
 * é o que impede pedir saque no nome de outro (recomendação do security-review da TASK-026).
 */
export const withdrawalRequestSchema = z.object({ amount: silverAmount });
export type WithdrawalRequestInput = z.output<typeof withdrawalRequestSchema>;

/**
 * Saque aberto **pela staff para um membro** (TASK-083, SS1–SS4). Aqui o `userId` existe e é o **alvo**:
 * quem age sai sempre da sessão, nunca do corpo — o controller não lê ator nenhum daqui.
 *
 * - `reason` é obrigatório (SS4): um saque que o próprio dono não pediu precisa dizer por que existe;
 * - `paidInGame` é o atalho de SS2: o saque nasce liquidado em vez de entrar na fila.
 */
export const withdrawalStaffOpenSchema = z.object({
  userId: z.uuid("Escolha o membro do saque."),
  amount: silverAmount,
  reason: requiredNote("o motivo do saque: por que a staff está abrindo por esse membro"),
  paidInGame: z.boolean().optional().default(false),
});
export type WithdrawalStaffOpenInput = z.output<typeof withdrawalStaffOpenSchema>;

/**
 * Nota de liquidação de um saque que já nasceu pago no jogo (SS2). **Não repete o motivo**: ele já está
 * em `requestNote`, e a fila mostraria a mesma frase três vezes na mesma linha.
 */
export const STAFF_PAID_IN_GAME_NOTE = "Pago no jogo pela staff, no ato da abertura do saque.";

/** Memo do débito no extrato do membro: aqui o motivo entra, porque o extrato não mostra o pedido. */
export const staffPaidInGameMemo = (reason: string) => `Sacado: pago no jogo pela staff. ${reason}`;

/** Recusa exige motivo: o membro lê essa frase e é o único retorno que ele tem (AC#3). */
export const withdrawalRejectSchema = z.object({ note: requiredNote("o motivo da recusa: o membro vê essa mensagem") });
export type WithdrawalRejectInput = z.output<typeof withdrawalRejectSchema>;

/** Liquidação exige nota (Q11, AC#4): como/quando a prata foi transferida in-game. */
export const withdrawalSettleSchema = z.object({ note: requiredNote("como o pagamento foi feito (quem transferiu, quando)") });
export type WithdrawalSettleInput = z.output<typeof withdrawalSettleSchema>;

/** Aprovação aceita nota opcional: nem sempre há o que dizer. */
export const withdrawalApproveSchema = z.object({
  note: z.string().trim().max(WITHDRAWAL_NOTE_MAX, `O texto tem no máximo ${WITHDRAWAL_NOTE_MAX} caracteres.`).nullish().transform((v) => (v ? v : null)),
});
export type WithdrawalApproveInput = z.output<typeof withdrawalApproveSchema>;

/** Saque como a API devolve. Prata vai como string: JSON não tem inteiro grande o bastante (Q20). */
export interface WithdrawalDto {
  id: string;
  userId: string;
  /** Nick do dono quando a lista é da staff; null na visão do próprio membro. */
  userNick: string | null;
  amount: string;
  status: WithdrawalStatus;
  /** Lançamento de débito criado na aprovação; null enquanto pending ou se foi recusado. */
  ledgerEntryId: string | null;
  /**
   * Staff que abriu o saque no nome do membro (TASK-083). `null` = o próprio dono pediu pelo painel —
   * é o que a fila usa para mostrar "aberto pela staff" e por quem.
   */
  openedByUserId: string | null;
  /** Nick de quem abriu pelo membro, quando a lista é da staff (AC#2). */
  openedByNick: string | null;
  /** Motivo escrito por quem abriu o saque pelo membro (SS4). `null` nos saques pedidos pelo próprio dono. */
  requestNote: string | null;
  decidedByUserId: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  settledByUserId: string | null;
  settledAt: string | null;
  settlementNote: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Saldo do membro para a tela de saque: o que ele tem e o que dá pra pedir agora. */
export interface WithdrawalBalanceDto {
  /** Saldo do ledger, podendo ser negativo (Q24). */
  balance: string;
  /** Soma dos saques `pending` (AC#2). */
  reserved: string;
  /** `balance - reserved`: o teto de um pedido novo. */
  available: string;
}

/**
 * Fila da staff (TASK-032). Junto dos pedidos vem o saldo de **cada dono que já está na lista**: quem
 * aprova precisa do contexto (quanto o membro tem, quanto já está reservado) para decidir, e sem isso a
 * decisão é no escuro. Não entra ninguém novo aqui — só quem já aparece em `withdrawals`.
 */
export interface WithdrawalQueueResponse {
  withdrawals: WithdrawalDto[];
  /** Saldo por `userId`. Ausente = membro sem lançamento e sem reserva. */
  balances: Record<string, WithdrawalBalanceDto>;
}

export const withdrawalListQuerySchema = z.object({
  status: z.array(z.enum(WITHDRAWAL_STATUSES)).nonempty().optional(),
  userId: z.uuid("Usuário inválido.").optional(),
});
export type WithdrawalListQuery = z.output<typeof withdrawalListQuerySchema>;

/** Query string (`?status=pending&status=approved`) → filtros; valor desconhecido vira 400. */
export function parseWithdrawalListQuery(query: Record<string, unknown>): { ok: true; filters: WithdrawalListQuery } | { ok: false; error: string } {
  const raw = query.status;
  const status = raw === undefined ? undefined : Array.isArray(raw) ? raw : [raw];
  const parsed = withdrawalListQuerySchema.safeParse({ ...(status ? { status } : {}), ...(query.userId ? { userId: query.userId } : {}) });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Filtro inválido." };
  return { ok: true, filters: parsed.data };
}
