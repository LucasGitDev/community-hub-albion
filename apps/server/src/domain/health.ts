export interface HealthReport {
  status: "ok" | "degraded";
  db: "up" | "down";
  bot: "online" | "offline";
}

/**
 * Saúde da API depende do banco (sem banco nada funciona); bot é só informativo,
 * pra API e SPA seguirem no ar se o Discord cair.
 */
export function buildHealth(input: { dbUp: boolean; botReady: boolean }): HealthReport {
  return {
    status: input.dbUp ? "ok" : "degraded",
    db: input.dbUp ? "up" : "down",
    bot: input.botReady ? "online" : "offline",
  };
}
