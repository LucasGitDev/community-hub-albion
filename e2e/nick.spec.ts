import { expect, test, type Page } from "@playwright/test";

/** Registro e troca de nick (TASK-012, Q14/Q31). Discord IDs por projeto: desktop e mobile rodam em paralelo no mesmo banco. */

const ORIGIN = "http://localhost:4173";

async function login(page: Page, base: string, username: string, gameNick?: string) {
  const suffix = test.info().project.name === "mobile" ? "9" : "8";
  const res = await page.request.post("/api/auth/dev-login", {
    data: { discordId: `${base}${suffix}`, username, roles: [], ...(gameNick ? { gameNick } : {}) },
    headers: { Origin: ORIGIN },
  });
  expect(res.status()).toBe(204);
}

async function snap(page: Page, name: string) {
  await test.info().attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
}

test("membro novo registra nick pela carteira e corrige a pendente (AC#1, AC#2)", async ({ page }) => {
  await login(page, "70000000000000001", "novato");
  await page.goto("/carteira");
  await page.getByRole("link", { name: "Registrar nick" }).click();
  await expect(page).toHaveURL(/\/nick$/);
  await expect(page.getByRole("heading", { name: "Seu nick do Albion" })).toBeVisible();
  await snap(page, "nick-sem-nick");

  const input = page.getByLabel("Nick do personagem");
  await input.fill("Novato Um");
  await page.getByRole("button", { name: "Enviar para aprovação" }).click();
  await expect(page.getByText("Use só letras e números")).toBeVisible();
  await snap(page, "nick-erro");

  await input.fill("NovatoUm");
  await page.getByRole("button", { name: "Enviar para aprovação" }).click();
  await expect(page.getByText("Aguardando aprovação da staff")).toBeVisible();
  await expect(page.getByText("NovatoUm", { exact: true })).toBeVisible();
  await snap(page, "nick-pendente");

  await page.getByRole("button", { name: "Corrigir nick enviado" }).click();
  await page.getByLabel("Nick do personagem").fill("NovatoDois");
  await page.getByRole("button", { name: "Atualizar solicitação" }).click();
  await expect(page.getByText("NovatoDois", { exact: true })).toBeVisible();
  await expect(page.getByText("Aguardando aprovação da staff")).toHaveCount(1);

  await page.reload();
  await expect(page.getByText("NovatoDois", { exact: true })).toBeVisible();
  await page.goto("/carteira");
  await expect(page.getByText("Nick aguardando a staff")).toBeVisible();
});

test("membro aprovado pede troca e mantém nick e acesso (AC#3)", async ({ page }) => {
  await login(page, "70000000000000002", "veterano", "Veterano");
  await page.goto("/nick");
  await expect(page.getByText("Nick aprovado")).toBeVisible();
  await expect(page.getByText("Veterano", { exact: true })).toBeVisible();
  await snap(page, "nick-aprovado");

  await page.getByRole("button", { name: "Pedir troca de nick" }).click();
  await expect(page.getByText("Seu nick atual e seu acesso continuam valendo até a staff aprovar o novo.")).toBeVisible();
  await page.getByLabel("Nick do personagem").fill("VeteranoII");
  await page.getByRole("button", { name: "Pedir troca" }).click();
  await expect(page.getByText("Aguardando aprovação da staff")).toBeVisible();
  await expect(page.getByText("Veterano", { exact: true })).toBeVisible();
  await expect(page.getByText("Até lá, você continua como Veterano, com o mesmo acesso.")).toBeVisible();
  await snap(page, "nick-troca-pendente");

  await page.goto("/carteira");
  await expect(page.getByText("Disponível pra saque")).toBeVisible();
});
