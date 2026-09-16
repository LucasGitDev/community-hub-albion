import { expect, test, type Page } from "@playwright/test";

/**
 * Lista de membros do admin (TASK-043). Discord IDs por projeto: desktop e mobile rodam em paralelo no mesmo banco.
 * O bot está desligado no e2e (DISCORD_BOT_ENABLED=false), então o import responde 503 com texto claro — é isso que
 * a tela precisa mostrar. Nenhuma chamada real ao Discord ou ao Albion acontece aqui.
 */

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

test("admin vê a lista, busca e filtra por sem nick (AC#1, AC#2, AC#4)", async ({ page }) => {
  const semNick = await login(page, "77000000000000001", "adm-semnick");
  const admin = await login(page, "77000000000000101", "adm-chefe", ["admin"]);

  await page.goto("/admin/membros");
  await expect(page.getByRole("heading", { name: "Membros", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Importar membros do Discord" })).toBeVisible();

  // A própria conta do admin e a do membro aparecem na lista, com o status do Albion de quem nunca foi conferido.
  const row = page.getByRole("row").filter({ hasText: `@${semNick}` });
  await expect(row).toBeVisible();
  await expect(row.getByText("Não conferido")).toBeVisible();
  await snap(page, "admin-membros-lista");

  // Busca pelo usuário do Discord reduz a lista a uma linha.
  await page.getByLabel("Buscar por nick ou usuário do Discord").fill(semNick);
  await expect(page.getByRole("row").filter({ hasText: `@${admin}` })).toHaveCount(0);
  await expect(row).toBeVisible();

  // Filtro "sem nick" mantém quem não registrou nick; "não encontrados" esvazia (ninguém foi conferido no e2e).
  await page.getByRole("button", { name: /^Sem nick/ }).click();
  await expect(row).toBeVisible();
  await page.getByRole("button", { name: /^Não encontrados no Albion/ }).click();
  await expect(page.getByText("Nenhum membro com esse filtro.")).toBeVisible();
  await snap(page, "admin-membros-filtro-vazio");
  await page.getByRole("button", { name: "Limpar filtros" }).click();
  await expect(page.getByRole("row").filter({ hasText: `@${admin}` })).toBeVisible();
});

test("import sem bot explica o motivo em PT-BR sem quebrar a tela", async ({ page }) => {
  await login(page, "77000000000000102", "adm-import", ["admin"]);
  await page.goto("/admin/membros");
  await page.getByRole("button", { name: "Importar membros do Discord" }).click();
  await expect(page.getByText("O bot do Discord está desligado neste servidor", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Importar membros do Discord" })).toBeEnabled();
  await snap(page, "admin-membros-import-sem-bot");
});

test("membro sem permissão não abre a tela nem a API (AC#5)", async ({ page }) => {
  await login(page, "77000000000000003", "adm-curioso");
  await page.goto("/admin/membros");
  await expect(page.getByRole("heading", { name: "Acesso negado" })).toBeVisible();
  expect((await page.request.get("/api/admin/members")).status()).toBe(403);
  const imported = await page.request.post("/api/admin/members/import", { headers: { Origin: ORIGIN } });
  expect(imported.status()).toBe(403);
});
