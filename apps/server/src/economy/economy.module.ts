import { type DynamicModule, Module } from "@nestjs/common";
import type { Env } from "../config/env.js";
import { AUTH_ENV } from "../auth/auth.controller.js";
import { AuthorizeGuard } from "../auth/authorize.js";
import { SameOriginGuard } from "../auth/same-origin.guard.js";
import { SessionService } from "../auth/session.service.js";
import { LedgerService } from "./ledger.service.js";
import { LootSplitController } from "./loot-split.controller.js";
import { LootSplitService } from "./loot-split.service.js";
import { WithdrawalService } from "./withdrawal.service.js";
import { MemberLedgerController } from "./member-ledger.controller.js";
import { MyLedgerController } from "./my-ledger.controller.js";
import { MyWithdrawalsController, WithdrawalsController } from "./withdrawals.controller.js";

/**
 * Economia (doc-002): ledger de prata (TASK-026), saque (TASK-030) e loot split (TASK-027). Global e
 * exportando os serviços porque a carteira do painel, os comandos do Discord e a confirmação do split
 * (TASK-028) vão depender deles sem que este módulo precise mudar — e porque cada operação de dinheiro
 * só pode existir por **um** caminho (`LedgerService`, `WithdrawalService`, `LootSplitService`).
 *
 * Os providers de auth se repetem aqui pelo mesmo motivo do `EventsModule`: `AuthorizeGuard` é usado
 * por `UseGuards` nos controllers deste módulo e precisa ser resolvível no contexto dele.
 */
@Module({})
export class EconomyModule {
  static register(env: Env): DynamicModule {
    return {
      module: EconomyModule,
      global: true,
      controllers: [MyLedgerController, MemberLedgerController, MyWithdrawalsController, WithdrawalsController, LootSplitController],
      providers: [{ provide: AUTH_ENV, useValue: env }, SessionService, AuthorizeGuard, SameOriginGuard, LedgerService, WithdrawalService, LootSplitService],
      exports: [LedgerService, WithdrawalService, LootSplitService],
    };
  }
}
