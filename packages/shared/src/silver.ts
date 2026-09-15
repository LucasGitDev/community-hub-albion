/** Prata é sempre inteira em bigint (Q20). Formatação PT-BR compartilhada entre bot e painel. */
const full = new Intl.NumberFormat("pt-BR");

/** Prata inteira (bigint) formatada: 1.482.300 */
export function formatSilver(value: bigint): string {
  return full.format(value);
}

/** Forma curta pra contexto secundário: 1,48M / 350k */
export function formatSilverShort(value: bigint): string {
  const abs = value < 0n ? -value : value;
  const sign = value < 0n ? "−" : "";
  if (abs >= 1_000_000n) {
    const n = Number(abs) / 1_000_000;
    return `${sign}${n.toLocaleString("pt-BR", { maximumFractionDigits: 2, roundingMode: "trunc" })}M`;
  }
  if (abs >= 1_000n) {
    return `${sign}${Math.floor(Number(abs) / 1_000).toLocaleString("pt-BR")}k`;
  }
  return `${sign}${full.format(abs)}`;
}

/** Aceita "1.500.000", "1500000", "1,5M", "350k" */
export function parseSilver(input: string): bigint | null {
  const raw = input.trim().toLowerCase().replace(/\s/g, "");
  if (!raw) return null;
  const m = raw.match(/^(\d+(?:[.,]\d+)?)([km])$/);
  if (m) {
    const n = Number(m[1].replace(",", "."));
    const mult = m[2] === "m" ? 1_000_000 : 1_000;
    return Number.isFinite(n) ? BigInt(Math.round(n * mult)) : null;
  }
  const digits = raw.replace(/\./g, "");
  return /^\d+$/.test(digits) ? BigInt(digits) : null;
}
