import { expect, test, type Page } from "@playwright/test";
import { ORIGIN } from "./session";

/**
 * Chamar quem não entrou na call, pelo **menu do evento no painel** (TASK-087, PE15, AC#4).
 *
 * O e2e sobe sem bot (`DISCORD_BOT_ENABLED=false`), então quem manda privado não existe nesta
 * instância: o que esta spec prova é o caminho do painel inteiro — a ação aparece para quem conduz o
 * evento **em andamento**, some para quem não conduz e em evento que não está rodando, e o clique
 * chega à API de verdade e traz a resposta dela para a tela em PT-BR. Quem recebe privado, quem fica
 * de fora e o intervalo de 5 minutos são provados nos testes de integração, com Discord falso.
 */

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

async function selectEvent(page: Page, eventName: string) {
  await page.getByRole("region", { name: "Eventos", exact: true }).getByRole("button", { name: new RegExp(eventName) }).click();
}

const summonButton = (page: Page) => page.getByRole("button", { name: "Chamar quem falta" });

test("caller chama quem falta pelo painel do evento em andamento (AC#4)", async ({ page }) => {
  test.setTimeout(120_000);
  const run = `${tag()}${Date.now().toString(36)}`;
  const templateName = `Template chamado ${run}`;
  const eventName = `Chamado ${run}`;

  await login(page, "78000000000000001", "staffS", ["staff"]);
  const roles = (await (await page.request.get("/api/event-roles")).json()) as { roles: { id: string; name: string }[] };
  const tank = roles.roles.find((r) => r.name === "Tank")!;
  const template = await page.request.post("/api/event-templates", {
    headers: { Origin: ORIGIN },
    data: { name: templateName, description: null, minPartySize: 1, maxPartySize: null, active: true, roles: [{ roleId: tank.id, slots: 2, buffunfaMin: 0, buffunfaMax: 0 }] },
  });
  expect(template.status()).toBe(201);
  const templateId = (await template.json()).id as string;

  const caller = await login(page, "78000000000000002", "callerS", ["caller"]);
  const created = await page.request.post("/api/events", { headers: { Origin: ORIGIN }, data: { templateId, name: eventName } });
  expect(created.status()).toBe(201);
  const eventId = (await created.json()).id as string;

  await page.goto("/staff/eventos");
  await expect(page.getByRole("heading", { name: "Central de eventos" })).toBeVisible();
  await selectEvent(page, eventName);

  // Evento em rascunho: não existe call para onde chamar, e a ação não aparece.
  await expect(summonButton(page)).toHaveCount(0);

  // O evento começa (sem bot, o start só muda o estado): agora a ação está à mão do caller.
  for (const transition of ["open", "start"]) {
    const res = await page.request.post(`/api/events/${eventId}/transitions/${transition}`, { headers: { Origin: ORIGIN }, data: {} });
    expect(res.status(), transition).toBe(200);
  }
  await page.reload();
  await selectEvent(page, eventName);
  await expect(summonButton(page)).toBeEnabled();
  await snap(page, `chamar-quem-falta-${tag()}`);

  // O clique chega à API: sem bot nesta instância, a resposta é a recusa em PT-BR do próprio servidor.
  await summonButton(page).click();
  await expect(page.getByText("O bot do Discord está desligado nesta instância", { exact: false })).toBeVisible();
  // E o botão volta a ficar clicável depois da resposta, em vez de travar de vez.
  await expect(summonButton(page)).toBeEnabled();

  // Outro caller, que não conduz este evento, não enxerga a ação (a condição de dono do CASL).
  await login(page, "78000000000000003", "outroCallerS", ["caller"]);
  await page.goto("/staff/eventos");
  await selectEvent(page, eventName);
  await expect(summonButton(page)).toHaveCount(0);
  await snap(page, `chamar-quem-falta-sem-permissao-${tag()}`);
  expect(caller).toContain("callerS");

  // Evento finalizado: a call acabou, a ação some de novo.
  await login(page, "78000000000000002", "callerS", ["caller"]);
  expect((await page.request.post(`/api/events/${eventId}/transitions/finish`, { headers: { Origin: ORIGIN }, data: {} })).status()).toBe(200);
  await page.goto("/staff/eventos");
  await selectEvent(page, eventName);
  await expect(summonButton(page)).toHaveCount(0);
});
