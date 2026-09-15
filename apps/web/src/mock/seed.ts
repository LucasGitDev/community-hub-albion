import type { LedgerEntry, User, Withdrawal } from "./types";

export const users: User[] = [
  { id: "u1", discordName: "ravenmoor", nick: "Ravenmoor", role: "member", initials: "RA" },
  { id: "u2", discordName: "thalya.heals", nick: "Thalya", role: "caller", initials: "TH" },
  { id: "u3", discordName: "grimwald", nick: "Grimwald", role: "staff", initials: "GR" },
  { id: "u4", discordName: "kestrel_", nick: "Kestrel", role: "member", initials: "KE" },
];

const d = (daysAgo: number, hour = 21, minute = 0) => {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
};

export const ledger: LedgerEntry[] = [
  { id: "l1", userId: "u1", kind: "split_credit", amount: 842_500n, description: "Loot split 1 de 2", eventName: "Raid do Dragão — Martlock", createdAt: d(18, 23, 40) },
  { id: "l2", userId: "u1", kind: "split_credit", amount: 611_200n, description: "Loot split 2 de 2", eventName: "Raid do Dragão — Martlock", createdAt: d(17, 20, 5) },
  { id: "l3", userId: "u1", kind: "split_credit", amount: 1_250_000n, description: "Loot split", eventName: "DG Avalon T8", createdAt: d(12, 22, 15) },
  { id: "l4", userId: "u1", kind: "withdrawal_debit", amount: -1_500_000n, description: "Saque aprovado", createdAt: d(10, 14, 30) },
  { id: "l5", userId: "u1", kind: "split_credit", amount: 94_000n, description: "Loot split", eventName: "Caçada — Pântano", createdAt: d(6, 19, 50) },
  { id: "l6", userId: "u1", kind: "split_credit", amount: 94_000n, description: "Loot split", eventName: "Caçada — Pântano", createdAt: d(6, 19, 51) },
  { id: "l7", userId: "u1", kind: "reversal", amount: -94_000n, description: "Estorno: lançamento duplicado", eventName: "Caçada — Pântano", createdAt: d(5, 10, 12), reversesId: "l6" },
  { id: "l8", userId: "u1", kind: "split_credit", amount: 1_318_750n, description: "Loot split", eventName: "DG de grupo — Roads", createdAt: d(2, 23, 5) },
  { id: "l9", userId: "u1", kind: "split_credit", amount: 402_300n, description: "Loot split", eventName: "PvP Roaming — Fort Sterling", createdAt: d(1, 1, 20) },

  { id: "l20", userId: "u2", kind: "split_credit", amount: 2_104_000n, description: "Loot split", eventName: "DG Avalon T8", createdAt: d(12, 22, 15) },
  { id: "l21", userId: "u2", kind: "split_remainder", amount: 7n, description: "Sobra da divisão", eventName: "DG Avalon T8", createdAt: d(12, 22, 15) },
  { id: "l22", userId: "u2", kind: "split_credit", amount: 988_400n, description: "Loot split", eventName: "DG de grupo — Roads", createdAt: d(2, 23, 5) },
  { id: "l23", userId: "u2", kind: "withdrawal_debit", amount: -1_000_000n, description: "Saque aprovado", createdAt: d(2, 12, 0) },

  { id: "l30", userId: "u4", kind: "split_credit", amount: 3_420_000n, description: "Loot split", eventName: "Raid do Dragão — Martlock", createdAt: d(18, 23, 40) },
  { id: "l31", userId: "u4", kind: "split_credit", amount: 760_000n, description: "Loot split", eventName: "DG de grupo — Roads", createdAt: d(2, 23, 5) },

  { id: "l40", userId: "u3", kind: "split_credit", amount: 1_130_000n, description: "Loot split", eventName: "Raid do Dragão — Martlock", createdAt: d(18, 23, 40) },
];

export const withdrawals: Withdrawal[] = [
  { id: "w1", userId: "u1", amount: 1_500_000n, status: "settled", requestedAt: d(11, 9, 0), decidedAt: d(10, 14, 30), decidedBy: "Grimwald", settledAt: d(10, 18, 2), settledBy: "Grimwald", note: "Entregue no banco de Martlock" },
  { id: "w2", userId: "u1", amount: 2_000_000n, status: "rejected", requestedAt: d(4, 11, 20), decidedAt: d(4, 16, 0), decidedBy: "Grimwald", note: "Tesouraria sem prata líquida essa semana. Tente de novo na segunda." },
  { id: "w3", userId: "u1", amount: 1_200_000n, status: "pending", requestedAt: d(1, 9, 45) },
  { id: "w4", userId: "u4", amount: 3_000_000n, status: "pending", requestedAt: d(1, 20, 10) },
  { id: "w5", userId: "u2", amount: 1_000_000n, status: "approved", requestedAt: d(3, 8, 0), decidedAt: d(2, 12, 0), decidedBy: "Grimwald" },
];
