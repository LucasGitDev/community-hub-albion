import { expect, test, type Page } from "@playwright/test";

/** Aprovação de nick pela staff (TASK-013, Q14/Q31). Discord IDs por projeto: desktop e mobile rodam em paralelo no mesmo banco. */

const ORIGIN = "http://localhost:4173";

async function login(page: Page, base: string, username: string, roles: string[] = []) {
  const suffix = test.info().project.name === "mobile" ? "9" : "8";
  const res = await page.request.post("/api/auth/dev-login", {
    data: { discordId: `${base}${suffix}`, username: `${username}${suffix}`, roles },
    headers: { Origin: ORIGIN },
  });
  expect(res.status()).toBe(204);
  return `${username}${suffix}`;
}

async function snap(page: Page, name: string) {
  await test.info().attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
}

async function requestNick(page: Page, nick: string) {
  await page.goto("/nick");
  await page.getByLabel("Nick do personagem").fill(nick);
  await page.getByRole("button", { name: "Enviar para aprovação" }).click();
  await expect(page.getByText("Aguardando aprovação da staff")).toBeVisible();
}

test("staff aprova nick e membro vê o nick aprovado (AC#1, AC#2)", async ({ page }) => {
  const member = await login(page, "71000000000000001", "aprovar");
  // nick único por execução: reexecutar no mesmo banco não colide com o nick já aprovado.
  const nick = `Ok${Date.now().toString(36)}${member.slice(-1)}`;
  await requestNick(page, nick);

  await login(page, "71000000000000101", "staffa", ["staff"]);
  await page.goto("/staff/membros");
  await expect(page.getByRole("heading", { name: "Aprovação de nick" })).toBeVisible();
  const row = page.getByRole("listitem").filter({ hasText: `@${member}` });
  await expect(row.getByText(nick, { exact: true })).toBeVisible();
  await snap(page, "staff-membros-fila");
  await row.getByRole("button", { name: "Aprovar nick" }).click();
  await expect(page.getByText("Nick aprovado")).toBeVisible();
  await expect(row).toHaveCount(0);

  await login(page, "71000000000000001", "aprovar");
  await page.goto("/nick");
  await expect(page.getByText("Nick aprovado")).toBeVisible();
  await expect(page.getByText(nick, { exact: true })).toBeVisible();
  await expect(page.getByText("Aguardando aprovação da staff")).toHaveCount(0);
});

test("staff recusa com motivo e membro vê o motivo (AC#1, AC#2)", async ({ page }) => {
  const member = await login(page, "71000000000000002", "recusar");
  const nick = `No${Date.now().toString(36)}${member.slice(-1)}`;
  await requestNick(page, nick);

  await login(page, "71000000000000102", "staffr", ["staff"]);
  await page.goto("/staff/membros");
  const row = page.getByRole("listitem").filter({ hasText: `@${member}` });
  await row.getByRole("button", { name: "Recusar" }).click();
  await expect(row.getByRole("button", { name: "Confirmar recusa" })).toBeDisabled();
  await row.getByLabel("Motivo da recusa (o membro vê essa mensagem)").fill("Não achei esse personagem no jogo.");
  await snap(page, "staff-membros-recusa");
  await row.getByRole("button", { name: "Confirmar recusa" }).click();
  await expect(page.getByText("Nick recusado")).toBeVisible();
  await expect(row).toHaveCount(0);

  await login(page, "71000000000000002", "recusar");
  await page.goto("/nick");
  await expect(page.getByText(`A staff recusou o nick ${nick}`)).toBeVisible();
  await expect(page.getByText("Não achei esse personagem no jogo.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Enviar para aprovação" })).toBeVisible();
  await snap(page, "nick-recusado");
});

test("membro sem permissão não abre a fila nem a API (AC#3)", async ({ page }) => {
  await login(page, "71000000000000003", "curioso");
  await page.goto("/staff/membros");
  await expect(page.getByRole("heading", { name: "Acesso negado" })).toBeVisible();
  expect((await page.request.get("/api/staff/nick-requests")).status()).toBe(403);
});
