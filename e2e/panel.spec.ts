import { expect, test, type Page } from "@playwright/test";

/**
 * Smoke do painel (TASK-033). Cada teste anexa screenshot: evidência visual
 * pro agent/revisor em desktop e mobile (artifact no CI).
 */

async function loginAs(page: Page, discordName: string) {
  await page.goto("/entrar");
  await page.getByRole("button", { name: "Entrar com Discord" }).click();
  await page.getByRole("button", { name: new RegExp(`@${discordName}`) }).click();
  await expect(page).toHaveURL(/\/carteira$/);
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

test("membro não acessa área de staff", async ({ page }) => {
  await loginAs(page, "ravenmoor");
  await expect(page.getByRole("link", { name: "Fila de saques" })).toHaveCount(0);
  await page.goto("/staff/saques");
  await expect(page).toHaveURL(/\/carteira$/);
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

