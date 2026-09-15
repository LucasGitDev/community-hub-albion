import { expect, test, type Page } from "@playwright/test";

/** Catálogo de roles e templates (TASK-020, Q8). Discord IDs e nomes por projeto: desktop e mobile rodam em paralelo no mesmo banco. */

const ORIGIN = "http://localhost:4173";
const tag = () => (test.info().project.name === "mobile" ? "M" : "D");

async function login(page: Page, base: string, username: string, roles: string[] = []) {
  const suffix = tag() === "M" ? "9" : "8";
  const res = await page.request.post("/api/auth/dev-login", {
    data: { discordId: `${base}${suffix}`, username: `${username}${suffix}`, roles },
    headers: { Origin: ORIGIN },
  });
  expect(res.status()).toBe(204);
}

async function snap(page: Page, name: string) {
  await test.info().attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
}

test("staff cria role, monta template com vagas e não consegue apagar role em uso (AC#1, AC#2, AC#3)", async ({ page }) => {
  await login(page, "72000000000000001", "staffT", ["staff"]);
  const run = `${tag()}${Date.now().toString(36)}`;
  const roleName = `Batedor ${run}`;
  const templateName = `Caçada ${run}`;

  await page.goto("/staff/templates");
  await expect(page.getByRole("heading", { name: "Templates de evento" })).toBeVisible();

  // AC#1: cria role no catálogo global.
  await page.getByLabel("Nova role").fill(roleName);
  await page.getByRole("button", { name: "Adicionar" }).click();
  await expect(page.getByText("Role criada")).toBeVisible();
  const catalog = page.getByRole("region", { name: "Catálogo de roles" });
  const roleRow = catalog.getByRole("listitem").filter({ hasText: roleName });
  await expect(roleRow.getByText("sem template")).toBeVisible();

  // AC#2: template define roles do catálogo com quantidade de vagas.
  await page.getByRole("button", { name: "Criar template", exact: true }).first().click();
  await page.getByLabel("Nome", { exact: true }).fill(templateName);
  await page.getByLabel("Mínimo de pessoas").fill("3");
  await page.getByLabel("Máximo (vazio = sem teto)").fill("7");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: roleName, exact: true }).click();
  await page.getByLabel(`Vagas de ${roleName}`).fill("4");
  await expect(page.getByText("4 vagas para 3–7 pessoas")).toBeVisible();
  await snap(page, `template-form-${tag()}`);
  await page.getByRole("dialog").getByRole("button", { name: "Criar template" }).click();
  await expect(page.getByText("Template criado")).toBeVisible();

  const templateRow = page.getByRole("region", { name: "Templates", exact: true }).getByRole("listitem").filter({ hasText: templateName });
  await expect(templateRow.getByText("3–7")).toBeVisible();
  await expect(templateRow.getByText(`4${roleName}`)).toBeVisible();
  await snap(page, `templates-lista-${tag()}`);

  // AC#3: role em uso não pode ser apagada.
  await expect(roleRow.getByText("em 1 template")).toBeVisible();
  await expect(roleRow.getByRole("button", { name: `Apagar ${roleName}` })).toBeDisabled();
  const blocked = await page.request.delete(`/api/event-roles/${await roleIdByName(page, roleName)}`, { headers: { Origin: ORIGIN } });
  expect(blocked.status()).toBe(409);
  expect(await blocked.text()).toContain("em uso por um template");

  // Trocando a role por outra do catálogo, a role sai de uso e pode ser apagada.
  await templateRow.getByRole("button", { name: "Editar" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Tank", exact: true }).click();
  await page.getByLabel("Vagas de Tank").fill("3");
  await page.getByRole("button", { name: `Tirar ${roleName} do template` }).click();
  await page.getByRole("button", { name: "Salvar template" }).click();
  await expect(page.getByText("Template salvo")).toBeVisible();
  await expect(roleRow.getByText("sem template")).toBeVisible();
  await roleRow.getByRole("button", { name: `Apagar ${roleName}` }).click();
  await expect(page.getByText("Role apagada")).toBeVisible();
  await expect(roleRow).toHaveCount(0);
});

async function roleIdByName(page: Page, name: string): Promise<string> {
  const res = await page.request.get("/api/event-roles");
  const body = (await res.json()) as { roles: { id: string; name: string }[] };
  return body.roles.find((r) => r.name === name)!.id;
}

test("membro sem permissão não abre templates nem a API (AC#4)", async ({ page }) => {
  await login(page, "72000000000000003", "curiosoT");
  await page.goto("/staff/templates");
  await expect(page.getByRole("heading", { name: "Acesso negado" })).toBeVisible();
  expect((await page.request.get("/api/event-templates")).status()).toBe(403);
  expect((await page.request.post("/api/event-roles", { data: { name: "Hacker" }, headers: { Origin: ORIGIN } })).status()).toBe(403);
  await snap(page, `templates-negado-${tag()}`);
});
