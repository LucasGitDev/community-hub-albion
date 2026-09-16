import { type DynamicModule, Module } from "@nestjs/common";
import type { Env } from "../config/env.js";
import { AUTH_ENV } from "../auth/auth.controller.js";
import { AuthorizeGuard } from "../auth/authorize.js";
import { SameOriginGuard } from "../auth/same-origin.guard.js";
import { SessionService } from "../auth/session.service.js";
import { LedgerService } from "./ledger.service.js";
import { WithdrawalService } from "./withdrawal.service.js";
import { MyWithdrawalsController, WithdrawalsController } from "./withdrawals.controller.js";

/**
 * Economia (doc-002): ledger de prata (TASK-026) e saque (TASK-030). Global e exportando os dois
 * serviços porque loot split, carteira do painel e os comandos do Discord vão depender deles sem que
 * este módulo precise mudar — e porque saque só pode existir por **um** caminho (`WithdrawalService`).
 */
@Module({})
export class EconomyModule {
  static register(env: Env): DynamicModule {
    return {
      module: EconomyModule,
      global: true,
      controllers: [MyWithdrawalsController, WithdrawalsController],
      providers: [{ provide: AUTH_ENV, useValue: env }, SessionService, AuthorizeGuard, SameOriginGuard, LedgerService, WithdrawalService],
      exports: [LedgerService, WithdrawalService],
    };
  }
}
