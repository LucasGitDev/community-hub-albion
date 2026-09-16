import { Global, Module } from "@nestjs/common";
import { LedgerService } from "./ledger.service.js";

/**
 * Economia (doc-002): por enquanto só o ledger de prata. Global porque loot split, saque e a
 * carteira do painel vão depender dele sem que este módulo precise mudar.
 */
@Global()
@Module({
  providers: [LedgerService],
  exports: [LedgerService],
})
export class EconomyModule {}
