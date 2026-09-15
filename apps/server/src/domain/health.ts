export interface HealthReport {
  status: "ok";
  bot: "online" | "offline";
}

/** API saudável independe do Discord; status do bot é só informativo. */
export function buildHealth(botReady: boolean): HealthReport {
  return { status: "ok", bot: botReady ? "online" : "offline" };
}
