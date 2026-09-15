import { expect, test, type Page } from "@playwright/test";

/**
 * Smoke do painel (TASK-033, login real desde TASK-010). Cada teste anexa screenshot: evidência visual
 * pro agent/revisor em desktop e mobile (artifact no CI).
 */

const ORIGIN = "http://localhost:4173";

/** Membros de demonstração (mesmos Discord IDs do seed do painel). */
const PEOPLE = {
  ravenmoor: { discordId: "300000000000000101", roles: [] },
  thalya: { discordId: "300000000000000102", roles: ["caller"] },
  grimwald: { discordId: "300000000000000103", roles: ["staff"] },
  kestrel: { discordId: "300000000000000104", roles: [] },
} as const;

/** Sessão real via dev-login (AUTH_DEV_LOGIN só em dev/e2e); cookie fica no contexto da página. */
async function loginAs(page: Page, name: keyof typeof PEOPLE) {
  const person = PEOPLE[name];
  const res = await page.request.post("/api/auth/dev-login", {
    data: { discordId: person.discordId, username: name, roles: person.roles },
    headers: { Origin: ORIGIN },
  });
  expect(res.status()).toBe(204);
  await page.goto("/carteira");
  await expect(page.getByText("Disponível pra saque")).toBeVisible();
}

async function snap(page: Page, name: string) {
  await test.info().attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("e2e-init")) {
      localStorage.clear();
      sessionStorage.setItem("e2e-init", "1");
    }
  });
});

test("membro vê saldo disponível, reservado e extrato", async ({ page }) => {
  await loginAs(page, "ravenmoor");
  await expect(page.getByText("Disponível pra saque")).toBeVisible();
  await expect(page.getByText("1.818.750").first()).toBeVisible();
  await expect(page.getByText("Reservado em saques")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Extrato" })).toBeVisible();
  await expect(page.getByText("Em análise").first()).toBeVisible();
  await snap(page, "carteira-membro");
});

test("pedido de saque valida saldo e reserva valor", async ({ page }) => {
  await loginAs(page, "ravenmoor");
  await page.getByRole("button", { name: "Pedir saque" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Pedir saque" });
  await dialog.getByLabel("Valor").fill("5M");
  await dialog.getByRole("button", { name: "Pedir saque" }).click();
  await expect(dialog.getByText("Valor maior que o saldo disponível.")).toBeVisible();
  await snap(page, "saque-erro");

  await dialog.getByLabel("Valor").fill("1,2M");
  await dialog.getByRole("button", { name: "Pedir saque" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Saque pedido")).toBeVisible();
  await expect(page.getByText("618.750").first()).toBeVisible();
});

test("deslogado vê login com Discord em PT-BR e mensagem de erro do OAuth (TASK-010 AC#1)", async ({ page }) => {
  await page.goto("/carteira");
  await expect(page).toHaveURL(/\/entrar$/);
  const cta = page.getByRole("link", { name: "Entrar com Discord" });
  await expect(cta).toHaveAttribute("href", "/api/auth/discord");
  await page.goto("/entrar?erro=nao-membro");
  await expect(page.getByRole("alert")).toHaveText(/não é membro do servidor/);
  await snap(page, "login-erro-nao-membro");
});

test("navegação segue o papel: membro, caller e staff (TASK-010 AC#2)", async ({ page }) => {
  const nav = page.getByRole("navigation", { name: "Principal" }).first();
  await loginAs(page, "ravenmoor");
  await expect(page.getByRole("link", { name: "Fila de saques" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Eventos" })).toHaveCount(0);

  await loginAs(page, "thalya");
  await expect(nav).toBeVisible();
  await expect(page.getByRole("link", { name: "Eventos" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Fila de saques" })).toHaveCount(0);

  await loginAs(page, "grimwald");
  await expect(page.getByRole("link", { name: "Fila de saques" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Papéis" })).toHaveCount(0);
});

test("rota sem permissão acessada direto mostra acesso negado (TASK-010 AC#3)", async ({ page }) => {
  await loginAs(page, "ravenmoor");
  await page.goto("/staff/saques");
  await expect(page).toHaveURL(/\/staff\/saques$/);
  await expect(page.getByRole("heading", { name: "Acesso negado" })).toBeVisible();
  await expect(page.getByText("Kestrel")).toHaveCount(0);
  await snap(page, "acesso-negado");
});

test("sair encerra a sessão", async ({ page }) => {
  await loginAs(page, "kestrel");
  await page.getByRole("button", { name: "Sair" }).locator("visible=true").first().click();
  await expect(page).toHaveURL(/\/entrar$/);
  await page.goto("/carteira");
  await expect(page).toHaveURL(/\/entrar$/);
});

test("staff aprova, recusa com motivo e marca entrega", async ({ page }) => {
  await loginAs(page, "grimwald");
  await page.goto("/staff/saques");

  const kestrel = page.getByRole("listitem").filter({ hasText: "Kestrel" });
  await kestrel.getByRole("button", { name: "Recusar" }).click();
  await expect(kestrel.getByRole("button", { name: "Confirmar recusa" })).toBeDisabled();
  await kestrel.getByRole("textbox").fill("Sem prata no banco hoje.");
  await kestrel.getByRole("button", { name: "Confirmar recusa" }).click();

  const raven = page.getByRole("listitem").filter({ hasText: "Ravenmoor" });
  await raven.getByRole("button", { name: "Aprovar saque" }).click();
  await expect(page.getByText("Nada aqui agora.")).toBeVisible();

  await page.getByRole("tab", { name: /A entregar/ }).click();
  const approved = page.getByRole("listitem").filter({ hasText: "Ravenmoor" });
  await expect(approved.getByText("Aprovado, aguardando entrega")).toBeVisible();
  await snap(page, "staff-a-entregar");
  await approved.getByRole("button", { name: "Marcar como entregue" }).click();

  await page.getByRole("tab", { name: /Recusados/ }).click();
  await expect(page.getByText("Sem prata no banco hoje.")).toBeVisible();
});

test("refresh em rota client-side e /api servidos pelo Nest (TASK-004)", async ({ page, request }) => {
  await loginAs(page, "ravenmoor");
  await page.goto("/saques");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Meus saques" })).toBeVisible();
  await snap(page, "refresh-saques");

  const health = await request.get("/api/health");
  expect(health.headers()["content-type"]).toContain("application/json");
  const missing = await request.get("/api/nao-existe");
  expect(missing.status()).toBe(404);
  expect(missing.headers()["content-type"]).toContain("application/json");
});

