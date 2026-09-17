import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Regras puras do namespace de manutenção (TASK-048, G5). Ficam aqui, longe do Nest, porque são as
 * partes que precisam de teste direto: a comparação do segredo e o freio de mão do rate limit.
 */

/**
 * Compara o token recebido com o configurado em **tempo constante**.
 *
 * `===` vaza o tamanho do prefixo comum pelo tempo de resposta, então nunca é usado aqui. Comparar os
 * bytes crus também não serve: `timingSafeEqual` exige buffers do mesmo tamanho e lançaria (ou exigiria
 * um `length` antes) — e aí o tamanho do segredo vazaria. A saída: comparar o SHA-256 dos dois, que tem
 * sempre 32 bytes. Token vazio, curto, longo ou ausente percorrem exatamente o mesmo caminho.
 */
export function maintenanceTokenMatches(received: string | undefined, expected: string | undefined): boolean {
  if (expected === undefined || expected === "") return false;
  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
  // `received` ausente vira string vazia: não existe atalho que responda antes da comparação.
  return timingSafeEqual(digest(received ?? ""), digest(expected));
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Segundos até a janela abrir de novo; só faz sentido quando `allowed` é false. */
  retryAfterSeconds: number;
}

/**
 * Janela fixa em memória. Um token vazado ainda faz estrago, mas não faz milhares de ajustes em
 * segundos: o limite é do namespace inteiro (não por IP), porque o token **é** a identidade e trocar
 * de IP não pode comprar mais cota. Memória basta: o processo é um só (doc-002) e reiniciar o servidor
 * para zerar a janela já exige acesso que dispensa esta rota.
 */
export class FixedWindowRateLimiter {
  private hits = 0;
  /** `null` até a primeira chamada: a janela nasce com o primeiro uso, não na época do relógio. */
  private windowStart: number | null = null;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  take(now: number): RateLimitDecision {
    if (this.windowStart === null || now - this.windowStart >= this.windowMs) {
      this.windowStart = now;
      this.hits = 0;
    }
    if (this.hits >= this.limit) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((this.windowStart + this.windowMs - now) / 1000)) };
    }
    this.hits += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

/** Prata inteira em string (Q20): nada de `number` atravessando a API. Zero é recusado pelo banco e aqui. */
export type ParsedAdjustment = { ok: true; amount: bigint; reason: string } | { ok: false; error: string };

const AMOUNT = /^-?\d{1,18}$/;

export function parseSilverAdjustment(body: unknown): ParsedAdjustment {
  const input = (body ?? {}) as { amount?: unknown; reason?: unknown };
  const raw = typeof input.amount === "string" ? input.amount.trim() : "";
  if (!AMOUNT.test(raw)) return { ok: false, error: "amount deve ser prata inteira em string (ex: \"-1500000\")." };
  const amount = BigInt(raw);
  if (amount === 0n) return { ok: false, error: "amount não pode ser zero." };
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!reason) return { ok: false, error: "reason é obrigatório: todo ajuste de manutenção precisa de motivo." };
  if (reason.length > 200) return { ok: false, error: "reason deve ter no máximo 200 caracteres." };
  return { ok: true, amount, reason };
}
