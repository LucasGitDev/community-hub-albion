/** TASK-036: direções visuais em avaliação. A = P&B puro, B = P&B + ouro, C = mais jogo. */
export const VARIANTS = ["a", "b", "c"] as const;
export type Variant = (typeof VARIANTS)[number];

/** Aceita `a|b|c` (ou `1|2|3`, como no picker da skill prototype); qualquer outra coisa vira A. */
export function parseVariant(raw: string | null | undefined): Variant {
  const v = raw?.trim().toLowerCase();
  if (v === "1") return "a";
  if (v === "2") return "b";
  if (v === "3") return "c";
  return (VARIANTS as readonly string[]).includes(v ?? "") ? (v as Variant) : "a";
}
