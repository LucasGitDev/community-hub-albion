/**
 * Porta e origem do e2e, em um lugar só (TASK-046).
 *
 * Duas branches rodando e2e ao mesmo tempo disputavam a 4173 e, com `reuseExistingServer`, o
 * Playwright reusava silenciosamente o servidor da outra branch — a spec falhava com 404 em rota que
 * existia no próprio código. Com `E2E_PORT` cada worktree escolhe a sua porta; o default preserva o
 * comportamento atual para quem não configura nada.
 */
const parsePort = (raw: string | undefined): number => {
  if (raw === undefined || raw.trim() === "") return 4173;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`E2E_PORT inválida: ${JSON.stringify(raw)} (esperado inteiro entre 1 e 65535).`);
  }
  return port;
};

export const E2E_PORT = parsePort(process.env.E2E_PORT);

/** Origem que o servidor do e2e recebe como PUBLIC_URL e que o SameOriginGuard exige. */
export const ORIGIN = `http://localhost:${E2E_PORT}`;
