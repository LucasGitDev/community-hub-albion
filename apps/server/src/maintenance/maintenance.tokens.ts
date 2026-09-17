/** Env do namespace de manutenção. Token próprio (e não `AUTH_ENV`) porque este módulo não fala com auth. */
export const MAINTENANCE_ENV = Symbol("MAINTENANCE_ENV");

/** Resumo do que a limpeza fez, para a resposta do disparo manual. */
export interface MaintenanceCleanupResult {
  /** Contadores livres da implementação (ex: `{ sessionsRevoked: 3, rolesRemoved: 1 }`). */
  [counter: string]: number;
}

/**
 * Ponto de extensão da limpeza diária (TASK-049).
 *
 * A TASK-048 expõe `POST /api/maintenance/cleanup` e para por aqui: quem implementar a limpeza registra
 * um provider com este token no módulo dela e a rota passa a funcionar sem mudar nada aqui. Enquanto não
 * houver provider, a rota responde 503 dizendo exatamente isso — ela não finge ter rodado.
 *
 * Contrato para a TASK-049: `run()` é idempotente, não lança para erro esperado e **nunca** toca em
 * saldo ou ledger (G6) — a limpeza derruba sessão, papel e atividade da conta, e só.
 */
export interface MaintenanceCleanup {
  run(): Promise<MaintenanceCleanupResult>;
}

export const MAINTENANCE_CLEANUP = Symbol("MAINTENANCE_CLEANUP");
