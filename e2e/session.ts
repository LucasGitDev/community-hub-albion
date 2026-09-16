import { expect, test, type Page } from "@playwright/test";

/**
 * Login de e2e sem Discord, compartilhado pelas specs que precisam de prata de verdade (carteira do
 * membro na TASK-031, fila da staff na TASK-032).
 *
 * **Discord ID novo a cada rodada, sempre.** A prata é semeada no ledger, que é append-only: reusar um
 * id fixo somaria os lançamentos da execução anterior e o saldo esperado mudaria da segunda rodada em
 * diante. O id carrega o timestamp do processo; o `index` separa os testes e o sufixo separa desktop de
 * mobile, que rodam em paralelo contra o mesmo banco.
 */
export const ORIGIN = "http://localhost:4173";

export interface Silver {
  /** Prata inteira em string (Q20): positivo credita, negativo debita. */
  amount: string;
  kind?: "split_payout" | "split_fee" | "withdrawal" | "adjustment";
  memo?: string;
}

const RUN = String(Date.now());

/** Id único por rodada, teste e projeto. Discord ID tem 17 a 20 dígitos. */
export const discordId = (index: string): string => `7${RUN}${index}${test.info().project.name === "mobile" ? "9" : "8"}`;

export interface LoginOptions {
  /** Mesmos papéis de `ROLES` no shared; repetidos aqui porque o e2e compila fora dos workspaces. */
  roles?: ("member" | "caller" | "staff" | "admin")[];
  silver?: Silver[];
}

/** Entra como um usuário novo e devolve o Discord ID usado, para quem precisar voltar a ele. */
export async function login(page: Page, index: string, username: string, options: LoginOptions = {}): Promise<string> {
  const id = discordId(index);
  const { roles = [], silver = [] } = options;
  const res = await page.request.post("/api/auth/dev-login", {
    data: { discordId: id, username, roles, ...(silver.length ? { silver } : {}) },
    headers: { Origin: ORIGIN },
  });
  expect(res.status()).toBe(204);
  return id;
}

/** Screenshot de página inteira anexada ao relatório (revisada pelo agent, DoD#4). */
export async function snap(page: Page, name: string): Promise<void> {
  await test.info().attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
}
