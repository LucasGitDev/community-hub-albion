import { readFile } from "node:fs/promises";
import { expect, test, type Download, type Page } from "@playwright/test";

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

test("staff exporta um template em YAML e importa de volta criando roles novas (TASK-038 AC#1, AC#2, AC#3, AC#4)", async ({ page }) => {
  await login(page, "72000000000000004", "staffY", ["staff"]);
  const run = `${tag()}${Date.now().toString(36)}`;
  const origem = `Export ${run}`;
  const destino = `Import ${run}`;
  const roleNova = `Battlemount ${run}`;

  await page.goto("/staff/templates");
  await expect(page.getByRole("heading", { name: "Templates de evento" })).toBeVisible();

  // Monta o template que será exportado.
  await page.getByRole("button", { name: "Criar template", exact: true }).first().click();
  await page.getByLabel("Nome", { exact: true }).fill(origem);
  await page.getByLabel("Mínimo de pessoas").fill("3");
  await page.getByLabel("Máximo (vazio = sem teto)").fill("7");
  await page.getByRole("dialog").getByRole("button", { name: "Tank", exact: true }).click();
  await page.getByLabel("Vagas de Tank").fill("3");
  await page.getByRole("dialog").getByRole("button", { name: "Criar template" }).click();
  await expect(page.getByText("Template criado")).toBeVisible();

  // AC#1: exportar baixa o .yaml com o conteúdo do template.
  const templateRow = page.getByRole("region", { name: "Templates", exact: true }).getByRole("listitem").filter({ hasText: origem });
  const [download] = await Promise.all([page.waitForEvent("download"), templateRow.getByRole("button", { name: `Exportar template ${origem}` }).click()]);
  expect(download.suggestedFilename()).toMatch(/^export-[a-z0-9-]+\.yaml$/);
  await expect(page.getByText("Template exportado")).toBeVisible();
  const yaml = await readDownload(download);
  expect(yaml).toContain("version: 1");
  expect(yaml).toContain(`name: ${origem}`);
  expect(yaml).toContain("minParty: 3");
  expect(yaml).toContain("name: Tank");

  await page.getByRole("button", { name: "Importar YAML" }).click();
  const dialog = page.getByRole("dialog");

  // AC#3: YAML inválido mostra erro legível e o botão de importar fica bloqueado.
  await page.getByLabel("Conteúdo do YAML").fill("version: 1\nnome: errado\nroles: [");
  await expect(dialog.getByRole("alert")).toContainText("não é um YAML válido");
  await expect(dialog.getByRole("button", { name: "Importar template" })).toBeDisabled();
  await page.getByLabel("Conteúdo do YAML").fill(`version: 1\nname: ${destino}\nminParty: 9\nmaxParty: 20\nroles:\n  - name: Tank\n    slots: 2`);
  await expect(dialog.getByRole("alert")).toContainText("abaixo do mínimo de 9");
  await snap(page, `import-erro-${tag()}`);

  // AC#2 e AC#4: o arquivo exportado, com outro nome e uma role fora do catálogo, importa e avisa o que será criado.
  const paraImportar = yaml.replace(origem, destino).replace("  - name: Tank\n", `  - name: ${roleNova}\n    slots: 1\n  - name: Tank\n`);
  await page.getByLabel("Conteúdo do YAML").fill(paraImportar);
  const preview = dialog.getByRole("region", { name: "Pré-visualização do template" });
  await expect(preview).toContainText(destino);
  await expect(preview).toContainText("4 vagas para 3–7 pessoas");
  await expect(preview).toContainText(`Esta role será criada no catálogo junto com o template: ${roleNova}.`);
  await snap(page, `import-preview-${tag()}`);
  await dialog.getByRole("button", { name: "Importar template" }).click();
  await expect(page.getByText("Template importado")).toBeVisible();
  await expect(page.getByText(`Roles criadas no catálogo: ${roleNova}.`)).toBeVisible();

  const importada = page.getByRole("region", { name: "Templates", exact: true }).getByRole("listitem").filter({ hasText: destino });
  await expect(importada.getByText("3–7")).toBeVisible();
  await expect(importada.getByText(`1${roleNova}`)).toBeVisible();
  await expect(page.getByRole("region", { name: "Catálogo de roles" }).getByRole("listitem").filter({ hasText: roleNova }).getByText("em 1 template")).toBeVisible();
  await snap(page, `import-lista-${tag()}`);

  // AC#3: importar o mesmo arquivo de novo colide no nome e não cria um segundo template.
  await page.getByRole("button", { name: "Importar YAML" }).click();
  await page.getByLabel("Conteúdo do YAML").fill(paraImportar);
  await page.getByRole("dialog").getByRole("button", { name: "Importar template" }).click();
  await expect(page.getByText(`Já existe um template chamado "${destino}"`)).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Cancelar" }).click();
  await expect(importada).toHaveCount(1);
});

/** O download vem de um blob: montado no navegador; o conteúdo só é legível pelo arquivo que o Playwright salvou. */
async function readDownload(download: Download): Promise<string> {
  const path = await download.path();
  return readFile(path, "utf8");
}

test("membro sem permissão não abre templates nem a API (AC#4)", async ({ page }) => {
  await login(page, "72000000000000003", "curiosoT");
  await page.goto("/staff/templates");
  await expect(page.getByRole("heading", { name: "Acesso negado" })).toBeVisible();
  expect((await page.request.get("/api/event-templates")).status()).toBe(403);
  expect((await page.request.post("/api/event-roles", { data: { name: "Hacker" }, headers: { Origin: ORIGIN } })).status()).toBe(403);
  await snap(page, `templates-negado-${tag()}`);
});
