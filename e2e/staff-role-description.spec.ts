import { expect, test, type Page } from "@playwright/test";
import { ORIGIN } from "./session";

/**
 * Descrição da role (TASK-039). O valor da descrição está em dois lugares: a staff escreve em
 * /staff/roles e o jogador lê na hora de escolher a role em /events. A spec percorre os dois na
 * mesma rodada, mais a trava de permissão (só quem edita o catálogo escreve).
 *
 * Roles são globais, então cada execução cria a sua (desktop e mobile rodam em paralelo no mesmo banco).
 */

const tag = () => (test.info().project.name === "mobile" ? "M" : "D");

async function login(page: Page, base: string, username: string, roles: string[] = []) {
  const suffix = tag() === "M" ? "9" : "8";
  const res = await page.request.post("/api/auth/dev-login", {
    data: { discordId: `${base}${suffix}`, username: `${username}${suffix}`, roles },
    headers: { Origin: ORIGIN },
  });
  expect(res.status()).toBe(204);
}

/** Screenshot no relatório e em arquivo: o agent revisa 1280 e 400 antes de fechar a task (DoD#4). */
async function snap(page: Page, name: string) {
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  await test.info().attach(name, { path, contentType: "image/png" });
}

const DESCRIPTION = "Segura a frente, abre o engage e chama o recuo.";

test("staff descreve a role e quem vai se inscrever lê a descrição (AC#1, AC#2, AC#3)", async ({ page }) => {
  test.setTimeout(120_000);
  const run = `${tag()}${Date.now().toString(36)}`;
  const roleName = `Linha de frente ${run}`;
  const templateName = `Muralha ${run}`;
  const eventName = `Muralha das 21h ${run}`;

  await login(page, "75000000000000001", "staffRD", ["staff", "caller"]);

  // AC#1: a staff escreve a descrição na própria linha da role.
  await page.goto("/staff/roles");
  await expect(page.getByRole("heading", { name: "Roles", exact: true })).toBeVisible();
  await page.getByLabel("Nova role").fill(roleName);
  await page.getByRole("button", { name: "Adicionar" }).click();
  await expect(page.getByText("Role criada")).toBeVisible();

  const catalog = page.getByRole("region", { name: "Catálogo de roles" });
  const row = catalog.getByRole("row").filter({ hasText: roleName });
  // AC#3: role nasce sem descrição e não quebra nada — a coluna convida a escrever em vez de ficar vazia.
  await expect(row.getByRole("button", { name: `Editar ${roleName}` })).toBeVisible();
  await snap(page, `roles-sem-descricao-${tag()}`);

  await row.getByRole("button", { name: `Editar ${roleName}` }).click();
  await page.getByLabel(`Descrição da role ${roleName}`).fill(DESCRIPTION);
  await snap(page, `roles-editando-descricao-${tag()}`);
  await page.getByRole("button", { name: "Salvar role" }).click();
  await expect(page.getByText("Role salva")).toBeVisible();
  // A descrição existe duas vezes na linha (coluna no desktop, segunda linha do nome no mobile);
  // `visible: true` pega a que o breakpoint atual mostra.
  await expect(catalog.getByRole("row").filter({ hasText: roleName }).getByText(DESCRIPTION).filter({ visible: true })).toBeVisible();
  await snap(page, `roles-com-descricao-${tag()}`);

  // AC#2 (templates): a role descrita entra num template e o card do template continua legível.
  const roleId = await createTemplate(page, templateName, roleName);
  await page.goto("/staff/templates");
  const templateCard = page.getByRole("region", { name: "Templates", exact: true }).getByRole("listitem").filter({ hasText: templateName });
  await expect(templateCard.getByText(roleName)).toBeVisible();
  await snap(page, `templates-role-descrita-${tag()}`);

  // AC#2 (inscrição): é aqui que a descrição vale — a pessoa escolhe a role sabendo o que se espera.
  const eventId = await createOpenEvent(page, templateName, eventName);
  await login(page, "75000000000000002", "membroRD", ["member"]);
  await page.goto("/eventos");
  const card = page.getByRole("listitem").filter({ hasText: eventName });
  await expect(card.getByRole("button", { name: new RegExp(roleName) })).toBeVisible();
  await card.getByText("O que cada role faz").click();
  await expect(card.getByText(DESCRIPTION)).toBeVisible();
  await snap(page, `inscricao-descricao-${tag()}`);

  // Segurança: membro lê a descrição, mas escrever continua sendo da mesma permissão do catálogo.
  const forbidden = await page.request.patch(`/api/event-roles/${roleId}`, { headers: { Origin: ORIGIN }, data: { description: "vandalizado" } });
  expect(forbidden.status()).toBe(403);
  await page.reload();
  await page.getByRole("listitem").filter({ hasText: eventName }).getByText("O que cada role faz").click();
  await expect(page.getByRole("listitem").filter({ hasText: eventName }).getByText(DESCRIPTION)).toBeVisible();
  expect(eventId).toBeTruthy();
});

/** Template com a role descrita mais um Healer, via API: o foco da spec é a descrição, não o formulário. */
async function createTemplate(page: Page, name: string, roleName: string): Promise<string> {
  const catalog = (await (await page.request.get("/api/event-roles")).json()) as { roles: { id: string; name: string }[] };
  const role = catalog.roles.find((r) => r.name === roleName)!;
  const healer = catalog.roles.find((r) => r.name === "Healer")!;
  const res = await page.request.post("/api/event-templates", {
    headers: { Origin: ORIGIN },
    data: { name, description: null, minPartySize: 2, maxPartySize: 4, active: true, roles: [{ roleId: role.id, slots: 2 }, { roleId: healer.id, slots: 1 }] },
  });
  expect(res.status()).toBe(201);
  return role.id;
}

/** Evento criado e com inscrição aberta: é o estado em que o botão de role aparece pro membro. */
async function createOpenEvent(page: Page, templateName: string, eventName: string): Promise<string> {
  const list = (await (await page.request.get("/api/event-templates")).json()) as { templates: { id: string; name: string }[] };
  const template = list.templates.find((t) => t.name === templateName)!;
  const created = await page.request.post("/api/events", { headers: { Origin: ORIGIN }, data: { templateId: template.id, name: eventName } });
  expect(created.status()).toBe(201);
  const event = (await created.json()) as { id: string };
  const opened = await page.request.post(`/api/events/${event.id}/transitions/open`, { headers: { Origin: ORIGIN }, data: {} });
  expect(opened.status()).toBe(200);
  return event.id;
}
