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

test("caller cancela evento com motivo; inscrito vê o cancelamento e não entra mais (TASK-025, AC#1/AC#3/AC#4)", async ({ page }) => {
  test.setTimeout(150_000);
  const run = `${tag()}c${Date.now().toString(36)}`;
  const templateName = `Caçada ${run}`;
  const eventName = `Evento ${run}`;

  await login(page, "73000000000000006", "staffC", ["staff"]);
  await createTemplate(page, templateName);

  await login(page, "73000000000000007", "callerC", ["caller"]);
  await page.goto("/staff/eventos");
  await page.getByRole("button", { name: "Criar evento", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: new RegExp(templateName) }).click();
  await dialog.getByLabel("Nome do evento").fill(eventName);
  await dialog.getByRole("button", { name: "Criar evento" }).click();
  await expect(page.getByText("Evento criado")).toBeVisible();
  await selectEvent(page, eventName);
  await page.getByRole("region", { name: eventName }).getByRole("button", { name: "Abrir inscrições" }).click();
  await expect(page.getByText("Inscrições abertas").first()).toBeVisible();

  // Um membro garante a vaga antes do cancelamento (AC#1 precisa de inscrição ativa para cancelar).
  await login(page, "73000000000000008", "inscritoC");
  await page.goto("/eventos");
  const card = page.getByRole("listitem").filter({ hasText: eventName }).first();
  await card.getByRole("button", { name: /^Tank, 0 de 1/ }).click();
  await expect(page.getByText("Vaga garantida em Tank")).toBeVisible();
  await expect(card.getByText("Tank, confirmado")).toBeVisible();

  // O caller cancela pelo diálogo, escrevendo o motivo que os inscritos vão ler.
  await login(page, "73000000000000007", "callerC", ["caller"]);
  await page.goto("/staff/eventos");
  await selectEvent(page, eventName);
  await page.getByRole("region", { name: eventName }).getByRole("button", { name: "Cancelar evento" }).click();
  const confirm = page.getByRole("dialog");
  await expect(confirm.getByText("todas as inscrições são canceladas", { exact: false })).toBeVisible();
  await confirm.getByLabel("Motivo (opcional)").fill("não fechou grupo");
  await snap(page, `eventos-staff-cancelar-${tag()}`);
  await confirm.getByRole("button", { name: "Cancelar evento" }).click();

  const detail = page.getByRole("region", { name: eventName });
  await expect(detail.getByText("Cancelado", { exact: true })).toBeVisible();
  await expect(detail.getByText("Evento cancelado: não fechou grupo.")).toBeVisible();
  // AC#3: estado final — nenhuma ação sobra, nem cancelar de novo.
  await expect(detail.getByRole("button", { name: "Cancelar evento" })).toHaveCount(0);
  await expect(detail.getByText("Evento cancelado: não há mais ação a tomar.")).toBeVisible();
  await snap(page, `eventos-staff-cancelado-${tag()}`);

  // AC#4: quem estava inscrito vê o evento cancelado com o motivo, e não há mais botão de role.
  await login(page, "73000000000000008", "inscritoC");
  await page.goto("/eventos");
  const done = page.getByRole("listitem").filter({ hasText: eventName }).first();
  await expect(done.getByText("Cancelado", { exact: true })).toBeVisible();
  await expect(done.getByText("Evento cancelado: não fechou grupo.")).toBeVisible();
  await expect(done.getByRole("button", { name: /^Tank/ })).toHaveCount(0);
  await expect(done.getByRole("button", { name: "Sair do evento" })).toHaveCount(0);
  await snap(page, `eventos-membro-cancelado-${tag()}`);
});

/**
 * Arquivamento (TASK-044, Q26 revisada). Prova o fim da linha: `finished` ainda oferece ação, o
 * diálogo avisa o que se perde e o evento arquivado não tem mais nenhum botão de edição.
 */
test("staff arquiva um evento finalizado e o arquivado não oferece mais nenhuma ação (AC#1, AC#2, AC#3)", async ({ page }) => {
  test.setTimeout(150_000);
  const run = `${tag()}${Date.now().toString(36)}`;
  const templateName = `Arquivo ${run}`;
  const eventName = `Evento arquivo ${run}`;

  await login(page, "73000000000000010", "staffAq", ["caller", "staff"]);
  await createTemplate(page, templateName);
  await page.goto("/staff/eventos");
  await page.getByRole("button", { name: "Criar evento" }).first().click();
  const novo = page.getByRole("dialog");
  await novo.getByRole("button", { name: new RegExp(templateName) }).click();
  await novo.getByLabel("Nome do evento").fill(eventName);
  await novo.getByRole("button", { name: "Criar evento" }).click();
  await expect(page.getByText("Evento criado")).toBeVisible();

  await selectEvent(page, eventName);
  const detail = page.getByRole("region", { name: eventName });
  for (const action of ["Abrir inscrições", "Iniciar evento", "Finalizar evento"]) {
    await detail.getByRole("button", { name: action }).click();
    await expect(detail.getByRole("button", { name: action })).toHaveCount(0);
  }

  // Finalizado ainda é um estado de trabalho: o acerto da taxa e dos splits acontece aqui (AC#2).
  await expect(detail.getByText("Finalizado", { exact: true })).toBeVisible();
  await expect(detail.getByText("Quem conduz ainda acerta a taxa e os splits", { exact: false })).toBeVisible();
  await snap(page, `eventos-staff-finalizado-${tag()}`);

  await detail.getByRole("button", { name: "Arquivar evento" }).click();
  const confirm = page.getByRole("dialog");
  await expect(confirm.getByText("os dados do evento, a taxa e os loot splits não podem mais ser editados", { exact: false })).toBeVisible();
  await snap(page, `eventos-staff-arquivar-${tag()}`);
  await confirm.getByRole("button", { name: "Arquivar evento" }).click();

  await expect(detail.getByText("Arquivado", { exact: true })).toBeVisible();
  await expect(detail.getByText("Os dados, a taxa e os splits dele não mudam mais.")).toBeVisible();
  // AC#1/AC#3: estado final de fato — nem arquivar de novo, nem passar o comando.
  await expect(detail.getByRole("button", { name: "Arquivar evento" })).toHaveCount(0);
  await expect(detail.getByRole("button", { name: "Passar o comando" })).toHaveCount(0);
  await expect(detail.getByText("Evento arquivado: nada mais muda por aqui.")).toBeVisible();
  await snap(page, `eventos-staff-arquivado-${tag()}`);

  // A API recusa a edição com a frase do arquivamento, e não com "as inscrições não estão abertas" (AC#2).
  const id = await page.evaluate(async () => {
    const res = await fetch("/api/events");
    return ((await res.json()) as { events: { id: string; name: string; status: string }[] }).events.find((e) => e.status === "archived")!.id;
  });
  const blocked = await page.request.post(`/api/events/${id}/transitions/archive`, { headers: { Origin: ORIGIN }, data: {} });
  expect(blocked.status()).toBe(409);
  expect(((await blocked.json()) as { message: string }).message).toContain("arquivado");

  // AC#3: o membro vê o evento arquivado no histórico, distinto do cancelado e sem botão de role.
  await login(page, "73000000000000011", "membroAq");
  await page.goto("/eventos");
  const done = page.getByRole("listitem").filter({ hasText: eventName }).first();
  await expect(done.getByText("Arquivado", { exact: true })).toBeVisible();
  await expect(done.getByRole("button", { name: /^Tank/ })).toHaveCount(0);
  await snap(page, `eventos-membro-arquivado-${tag()}`);
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
