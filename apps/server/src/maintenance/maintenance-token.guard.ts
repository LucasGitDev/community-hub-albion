import { type CanActivate, type ExecutionContext, HttpException, HttpStatus, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Request } from "express";
import type { Env } from "../config/env.js";
import { FixedWindowRateLimiter, maintenanceTokenMatches } from "../domain/maintenance.js";
import { MAINTENANCE_ENV } from "./maintenance.tokens.js";

/** Header do segredo. Header custom obriga preflight CORS, então navegador de terceiro não alcança o namespace. */
export const MAINTENANCE_TOKEN_HEADER = "x-maintenance-token";

/** Cota do namespace inteiro: manutenção é ação de humano com curl, não de script. */
export const MAINTENANCE_RATE_LIMIT = { limit: 20, windowMs: 60_000 } as const;

/**
 * Guard do namespace de manutenção (TASK-048, AC#1/#5/#6).
 *
 * Três coisas que ele faz de propósito:
 *
 * 1. **Recusa indistinguível.** Token ausente, vazio ou errado devolvem o mesmo 404 que o Nest devolve
 *    para uma rota que não existe (`Cannot POST /api/...`). Quem sonda não descobre se o namespace está
 *    ligado, se o header é o certo, nem se chegou perto do segredo. Por isso não é 401 nem 403: esses
 *    contariam que há algo ali.
 * 2. **Tempo constante.** A comparação é `timingSafeEqual` sobre SHA-256 (ver `domain/maintenance.ts`).
 * 3. **Silêncio.** O guard não loga nada e não põe o header em exceção, mensagem ou resposta. O valor
 *    recebido morre nesta função.
 *
 * O rate limit vive aqui, depois da autenticação: só quem acertou o token consegue gastar cota, então
 * ninguém de fora derruba a manutenção estourando o limite de propósito.
 */
@Injectable()
export class MaintenanceTokenGuard implements CanActivate {
  private readonly limiter = new FixedWindowRateLimiter(MAINTENANCE_RATE_LIMIT.limit, MAINTENANCE_RATE_LIMIT.windowMs);

  constructor(@Inject(MAINTENANCE_ENV) private readonly env: Env) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers[MAINTENANCE_TOKEN_HEADER];
    // Header repetido (array) é recusado como qualquer token errado: não se escolhe um dos valores.
    const received = typeof header === "string" ? header : undefined;
    if (!maintenanceTokenMatches(received, this.env.MAINTENANCE_TOKEN)) throw notFoundLike(req);

    const decision = this.limiter.take(Date.now());
    if (!decision.allowed) {
      const res = context.switchToHttp().getResponse<{ setHeader(name: string, value: string): void }>();
      res.setHeader("Retry-After", String(decision.retryAfterSeconds));
      throw new TooManyMaintenanceRequests(decision.retryAfterSeconds);
    }
    return true;
  }
}

/** Cópia exata do 404 do Nest para rota inexistente — é o ponto todo: a recusa não conta nada. */
function notFoundLike(req: Request): NotFoundException {
  return new NotFoundException(`Cannot ${req.method} ${req.originalUrl}`);
}

export class TooManyMaintenanceRequests extends HttpException {
  constructor(retryAfterSeconds: number) {
    super({ statusCode: HttpStatus.TOO_MANY_REQUESTS, error: "Too Many Requests", message: `Limite de manutenção atingido. Tente de novo em ${retryAfterSeconds}s.` }, HttpStatus.TOO_MANY_REQUESTS);
  }
}
