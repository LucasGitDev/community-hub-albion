import { z } from "zod";

/**
 * As duas moedas do ledger (F6-1). Prata é a moeda com saque; Buffunfa é a moeda temática da
 * comunidade (doc-009), criada e queimada dentro do hub e sem saque nenhum (F6-6).
 *
 * Formatação e leitura moram aqui, num lugar só, porque "prata prateada, Buffunfa com sufixo" é
 * identidade (F6-4): espalhar isso pelas telas faria a mesma moeda aparecer de dois jeitos.
 */
export const CURRENCIES = ["silver", "buffunfa"] as const;

export type Currency = (typeof CURRENCIES)[number];

/** Nome PT-BR da moeda (Q18). A saída sempre escreve **Buffunfa**, nunca o alias. */
export const CURRENCY_LABELS: Record<Currency, string> = {
  silver: "Prata",
  buffunfa: "Buffunfa",
};

/** Sufixo que acompanha o número. Prata não tem: o contexto do painel inteiro já é prata. */
export const CURRENCY_SUFFIXES: Record<Currency, string> = {
  silver: "",
  buffunfa: " BUF",
};

/**
 * Entrada aceita "bufunfa" (um `f`) porque é como as pessoas escrevem (doc-009). Só entrada: nada
 * aqui devolve o alias, para o nome oficial não se diluir.
 */
export function parseCurrency(input: string): Currency | null {
  const raw = input.trim().toLowerCase();
  if (raw === "silver" || raw === "prata") return "silver";
  if (raw === "buffunfa" || raw === "bufunfa" || raw === "buf") return "buffunfa";
  return null;
}

const full = new Intl.NumberFormat("pt-BR");

/** Valor inteiro (bigint, Q20) formatado na moeda: `1.482.300` / `340 BUF`. */
export function formatAmount(value: bigint, currency: Currency): string {
  return `${full.format(value)}${CURRENCY_SUFFIXES[currency]}`;
}

/**
 * Forma curta para contexto secundário: `1,48M` / `350k`.
 *
 * **Buffunfa nunca abrevia** (F6-5): ganhos são de unidade/dezena e gastos chegam a milhares, então
 * `0,3K` perderia o número inteiro que cabe na tela. Aqui ela cai no valor cheio de propósito.
 */
export function formatAmountShort(value: bigint, currency: Currency): string {
  if (currency === "buffunfa") return formatAmount(value, currency);
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

/**
 * Aceita "1.500.000", "1500000", "1,5M", "350k" em prata. Em Buffunfa o sufixo é **recusado**: quem
 * digita "2k" de Buffunfa quase certamente errou a moeda, e ela não abrevia em lugar nenhum (F6-5).
 */
export function parseAmount(input: string, currency: Currency): bigint | null {
  const raw = input.trim().toLowerCase().replace(/\s/g, "").replace(/buf$/, "");
  if (!raw) return null;
  const m = raw.match(/^(\d+(?:[.,]\d+)?)([km])$/);
  if (m) {
    if (currency === "buffunfa") return null;
    const n = Number(m[1].replace(",", "."));
    const mult = m[2] === "m" ? 1_000_000 : 1_000;
    return Number.isFinite(n) ? BigInt(Math.round(n * mult)) : null;
  }
  const digits = raw.replace(/\./g, "");
  return /^\d+$/.test(digits) ? BigInt(digits) : null;
}

/**
 * Valor inteiro vindo do JSON: aceita número, string ("1500000") ou bigint, e devolve `bigint` (Q20).
 * String é o caminho recomendado da API — acima de 2^53 o `number` do JSON já perdeu dinheiro.
 *
 * Mora aqui, e não no loot split, porque a mesma leitura serve para as duas moedas: a faixa de
 * Buffunfa do template (F6-8) entra pelo mesmo caminho que a taxa em prata.
 */
export const amountSchema = (label: string, unit = "") =>
  z
    .union([z.string(), z.number(), z.bigint()], { error: `${label} precisa ser um número inteiro${unit}.` })
    .transform((v, ctx) => {
      const raw = typeof v === "string" ? v.trim().replace(/[.\s]/g, "") : String(v);
      if (!/^\d+$/.test(raw)) {
        ctx.addIssue({ code: "custom", message: `${label} precisa ser um número inteiro${unit}, sem sinal nem centavos.` });
        return z.NEVER;
      }
      return BigInt(raw);
    });
