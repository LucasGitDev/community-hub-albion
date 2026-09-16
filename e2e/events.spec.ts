import { expect, test, type Page } from "@playwright/test";

/**
 * Painel de eventos (TASK-023, Q9/Q21/Q26/Q27). Discord IDs e nomes por projeto: desktop e mobile
 * rodam em paralelo no mesmo banco, então cada execução cria o seu próprio template e evento.
 */

const ORIGIN = "http://localhost:4173";
const tag = () => (test.info().project.name === "mobile" ? "M" : "D");

async function login(page: Page, base: string, username: string, roles: string[] = []) {
  const suffix = tag() === "M" ? "9" : "8";
  const res = await page.request.post("/api/auth/dev-login", {
    data: { discordId: `${base}${suffix}`, username: `${username}${suffix}`, roles },
    headers: { Origin: ORIGIN },
  });
  expect(res.status()).toBe(204);
  return `${username}${suffix}`;
}

async function snap(page: Page, name: string) {
  await test.info().attach(name, { body: await page.screenshot({ fullPage: true, animations: "disabled" }), contentType: "image/png" });
}

/** A central seleciona o evento mais novo por padrão; com testes em paralelo, escolher na mão é o certo. */
async function selectEvent(page: Page, eventName: string) {
  await page.getByRole("region", { name: "Eventos", exact: true }).getByRole("button", { name: new RegExp(eventName) }).click();
}

/** Template com uma vaga de Tank e uma de Healer: a segunda pessoa na mesma role cai na espera. */
async function createTemplate(page: Page, name: string): Promise<void> {
  const roles = (await (await page.request.get("/api/event-roles")).json()) as { roles: { id: string; name: string }[] };
  const tank = roles.roles.find((r) => r.name === "Tank")!;
  const healer = roles.roles.find((r) => r.name === "Healer")!;
  const res = await page.request.post("/api/event-templates", {
    headers: { Origin: ORIGIN },
    data: { name, description: null, minPartySize: 2, maxPartySize: 2, active: true, roles: [{ roleId: tank.id, slots: 1 }, { roleId: healer.id, slots: 1 }] },
  });
  expect(res.status()).toBe(201);
}

// Fluxo com quatro pessoas, seis navegações e cinco screenshots: não cabe no timeout padrão de 30s.
test("caller cria evento, abre inscrições, membro entra, role lotada vira espera e caller move (AC#1, AC#2, AC#4)", async ({ page }) => {
  test.setTimeout(150_000);
  const run = `${tag()}${Date.now().toString(36)}`;
  const templateName = `Caçada ${run}`;
  const eventName = `Evento ${run}`;

  // staff monta o template (TASK-020) e o caller usa ele para criar o evento (Q9).
  await login(page, "73000000000000001", "staffE", ["staff"]);
  await createTemplate(page, templateName);

  const caller = await login(page, "73000000000000002", "callerE", ["caller"]);
  await page.goto("/staff/eventos");
  await expect(page.getByRole("heading", { name: "Central de eventos" })).toBeVisible();

  await page.getByRole("button", { name: "Criar evento", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: new RegExp(templateName) }).click();
  await dialog.getByLabel("Nome do evento").fill(eventName);
  await dialog.getByRole("button", { name: "Criar evento" }).click();
  await expect(page.getByText("Evento criado")).toBeVisible();

  await selectEvent(page, eventName);
  const detail = page.getByRole("region", { name: eventName });
  await expect(detail.getByText("Rascunho")).toBeVisible();
  await snap(page, `eventos-staff-rascunho-${tag()}`);

  // AC#2/AC#3: em rascunho só existe abrir e cancelar (Q26).
  await expect(detail.getByRole("button", { name: "Fechar inscrições" })).toHaveCount(0);
  await expect(detail.getByRole("button", { name: "Finalizar" })).toHaveCount(0);
  await detail.getByRole("button", { name: "Abrir inscrições" }).click();
  await expect(page.getByText("Inscrições abertas").first()).toBeVisible();

  // AC#1: membro vê o evento aberto e entra numa role.
  await login(page, "73000000000000003", "membroE");
  await page.goto("/eventos");
  const card = page.getByRole("listitem").filter({ hasText: eventName }).first();
  await expect(card.getByText("0/2 vagas preenchidas")).toBeVisible();
  await snap(page, `eventos-membro-aberto-${tag()}`);
  const tank = card.getByRole("button", { name: /^Tank, 0 de 1/ });
  await expect(tank).toBeEnabled();
  await tank.click();
  await expect(page.getByText("Vaga garantida em Tank")).toBeVisible();
  await expect(card.getByText("Tank, confirmado")).toBeVisible();
  await expect(card.getByText("1/2 vagas preenchidas")).toBeVisible();
  await snap(page, `eventos-membro-inscrito-${tag()}`);

  // AC#2 da TASK-022: role lotada manda para a espera daquela role (Q27).
  await login(page, "73000000000000004", "esperaE");
  await page.goto("/eventos");
  const card2 = page.getByRole("listitem").filter({ hasText: eventName }).first();
  await card2.getByRole("button", { name: /^Tank, 1 de 1 vagas, lotada/ }).click();
  await expect(page.getByText("Você entrou na espera de Tank")).toBeVisible();
  await expect(card2.getByText("Tank, 1º na espera")).toBeVisible();

  // AC#3: membro comum não vê ação de caller e nem abre a central de eventos.
  await expect(card2.getByRole("button", { name: "Abrir inscrições" })).toHaveCount(0);
  await expect(card2.getByRole("button", { name: "Iniciar evento" })).toHaveCount(0);
  await page.goto("/staff/eventos");
  await expect(page.getByRole("heading", { name: "Acesso negado" })).toBeVisible();
  await snap(page, `eventos-membro-negado-${tag()}`);

  // AC#2: caller move quem está na espera para a outra role e depois fecha as inscrições.
  await login(page, "73000000000000002", "callerE", ["caller"]);
  await page.goto("/staff/eventos");
  await selectEvent(page, eventName);
  const detail2 = page.getByRole("region", { name: eventName });
  const tankSection = detail2.getByRole("region", { name: "Role Tank" });
  await expect(tankSection.getByText("1º")).toBeVisible();
  await tankSection.getByRole("button", { name: "→ Healer" }).first().click();
  await expect(page.getByText(/foi para Healer/)).toBeVisible();
  const healerSection = detail2.getByRole("region", { name: "Role Healer" });
  await expect(healerSection.getByText("1/1")).toBeVisible();
  await snap(page, `eventos-staff-roster-${tag()}`);

  await detail2.getByRole("button", { name: "Fechar inscrições" }).click();
  await expect(detail2.getByText("Inscrições fechadas")).toBeVisible();
  await expect(detail2.getByRole("button", { name: "Abrir inscrições" })).toHaveCount(0);

  // AC#4: a tela do membro se atualiza sozinha (polling), sem recarregar a página.
  await login(page, "73000000000000003", "membroE");
  await page.goto("/eventos");
  await expect(page.getByText("atualiza sozinho", { exact: false }).first()).toBeVisible();
  const closed = page.getByRole("listitem").filter({ hasText: eventName }).first();
  await expect(closed.getByText("Inscrições fechadas")).toBeVisible();
  await expect(closed.getByRole("button", { name: "Sair do evento" })).toHaveCount(0);

  // caller inicia e finaliza: o membro vê a mudança sem clicar em nada (polling de 10s).
  await login(page, "73000000000000002", "callerE", ["caller"]);
  await page.goto("/staff/eventos");
  await selectEvent(page, eventName);
  await page.getByRole("region", { name: eventName }).getByRole("button", { name: "Iniciar evento" }).click();
  await expect(page.getByRole("region", { name: eventName }).getByText("Acontecendo agora")).toBeVisible();
  expect(caller).toContain("callerE");
});

test("membro sem permissão não usa a API de caller (AC#3)", async ({ page }) => {
  await login(page, "73000000000000005", "curiosoE");
  expect((await page.request.get("/api/event-templates")).status()).toBe(403);
  const create = await page.request.post("/api/events", {
    headers: { Origin: ORIGIN },
    data: { templateId: "00000000-0000-4000-8000-000000000000", name: "Evento pirata" },
  });
  expect(create.status()).toBe(403);
});
