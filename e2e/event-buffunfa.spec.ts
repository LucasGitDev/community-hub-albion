import { expect, test, type Page } from "@playwright/test";
import { ORIGIN } from "./session";

/**
 * Buffunfa por participação em evento (TASK-057, F6-8 a F6-11).
 *
 * O e2e roda com o bot desligado, então nenhum evento aqui tem canal de voz carimbado — que é
 * justamente o caso da F6-11. Isso torna este spec a prova do AC#5: a tela avisa, e o botão de
 * fechar não vai. O pagamento de quem bate os 90% é provado nos testes de banco e HTTP, onde a
 * presença pode ser plantada no relógio certo.
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

async function snap(page: Page, name: string) {
  await test.info().attach(name, { body: await page.screenshot({ fullPage: true, animations: "disabled" }), contentType: "image/png" });
}

const selectEvent = (page: Page, eventName: string) =>
  page.getByRole("region", { name: "Eventos", exact: true }).getByRole("button", { name: new RegExp(eventName) }).click();

test("caller escolhe a Buffunfa por role dentro da faixa e a tela avisa o evento sem canal medido (AC#1, AC#2, AC#5)", async ({ page }) => {
  test.setTimeout(180_000);
  const run = `${tag()}b${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const templateName = `Buffunfa ${run}`;
  const eventName = `Evento buffunfa ${run}`;

  await login(page, "76000000000000001", "staffBuf", ["staff"]);

  // Template pela tela: é onde a faixa obrigatória nasce (AC#1).
  await page.goto("/staff/templates");
  await page.getByRole("button", { name: "Criar template", exact: true }).first().click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Nome", { exact: true }).fill(templateName);
  await form.getByLabel("Mínimo de pessoas").fill("1");
  await form.getByLabel("Máximo (vazio = sem teto)").fill("1");
  await form.getByRole("button", { name: "Tank", exact: true }).click();
  await form.getByLabel("Buffunfa mínima de Tank").fill("10");
  await form.getByLabel("Buffunfa máxima de Tank").fill("40");
  await snap(page, `buffunfa-template-faixa-${tag()}`);
  await form.getByRole("button", { name: "Criar template" }).click();
  await expect(page.getByText("Template criado").first()).toBeVisible();
  // A faixa aparece no card do template: quem escolhe o template já sabe quanto ele paga.
  await expect(page.getByText("10 a 40 BUF").first()).toBeVisible();

  await login(page, "76000000000000002", "callerBuf", ["caller"]);
  await page.goto("/staff/eventos");
  await page.getByRole("button", { name: "Criar evento", exact: true }).first().click();
  const novo = page.getByRole("dialog");
  await novo.getByRole("button", { name: new RegExp(templateName) }).click();
  await novo.getByLabel("Nome do evento").fill(eventName);
  await novo.getByRole("button", { name: "Criar evento" }).click();
  await expect(page.getByText("Evento criado").first()).toBeVisible();

  await selectEvent(page, eventName);
  const detail = page.getByRole("region", { name: eventName });
  for (const action of ["Abrir inscrições", "Iniciar evento", "Finalizar evento"]) {
    await detail.getByRole("button", { name: action }).click();
    await expect(detail.getByRole("button", { name: action })).toHaveCount(0);
  }
  await expect(detail.getByText("Finalizado", { exact: true })).toBeVisible();

  await page.reload();
  await selectEvent(page, eventName);
  const painel = page.getByRole("region", { name: eventName });
  const buffunfa = painel.getByRole("region", { name: "Buffunfa por presença" });

  // A regra dos 90% e o "vale o valor do fechamento" estão escritos na tela, não só no doc.
  await expect(buffunfa.getByText("90% ou mais do tempo da call", { exact: false })).toBeVisible();
  await expect(buffunfa.getByText("para todos daquela role", { exact: false })).toBeVisible();

  // AC#1/AC#2: a faixa do template veio para o evento, e o valor nasce no mínimo dela.
  await expect(buffunfa.getByText("10 a 40 BUF")).toBeVisible();
  const campo = buffunfa.getByLabel("Buffunfa por presença na role Tank");
  await expect(campo).toHaveValue("10");

  // AC#5: sem canal carimbado, o aviso vem antes do clique e o botão não vai.
  await expect(buffunfa.getByRole("alert").first()).toContainText("não teve canal de voz carimbado");
  await expect(buffunfa.getByText("ninguém recebe Buffunfa aqui")).toBeVisible();
  await expect(buffunfa.getByRole("button", { name: "Pagar Buffunfa" })).toBeDisabled();
  await snap(page, `buffunfa-sem-canal-${tag()}`);

  // AC#2: fora da faixa é recusado na hora, com a faixa na mensagem, sem gastar request.
  await campo.fill("41");
  await expect(buffunfa.getByText("permite de 10 a 40 de Buffunfa", { exact: false })).toBeVisible();
  await expect(buffunfa.getByRole("button", { name: "Aplicar" })).toBeDisabled();
  await snap(page, `buffunfa-fora-da-faixa-${tag()}`);

  // Dentro da faixa: aplica e vale para todos da role no fechamento.
  await campo.fill("35");
  await buffunfa.getByRole("button", { name: "Aplicar" }).click();
  await expect(page.getByText("Tank: 35 de Buffunfa").first()).toBeVisible();
  await expect(page.getByText("Vale para todos dessa role no fechamento.").first()).toBeVisible();
  await expect(buffunfa.getByRole("button", { name: "Aplicar" })).toBeDisabled();
  await snap(page, `buffunfa-valor-aplicado-${tag()}`);

  // O valor ficou gravado no evento, e não só desenhado.
  const gravado = await page.evaluate(async (name) => {
    const list = (await (await fetch("/api/events")).json()) as { events: { id: string; name: string }[] };
    const id = list.events.find((e) => e.name === name)!.id;
    const event = (await (await fetch(`/api/events/${id}`)).json()) as { roles: { name: string; buffunfaMin: string; buffunfaMax: string; buffunfaValue: string }[] };
    return event.roles.find((r) => r.name === "Tank")!;
  }, eventName);
  expect(gravado).toMatchObject({ buffunfaMin: "10", buffunfaMax: "40", buffunfaValue: "35" });
});

/** A rota que cria moeda é fechada: membro comum e caller de outro evento não chegam nela. */
test("membro e caller de outro evento não alcançam a Buffunfa do evento", async ({ page }) => {
  test.setTimeout(120_000);
  const run = `${tag()}q${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const templateName = `BufPriv ${run}`;
  const eventName = `Evento bufpriv ${run}`;

  await login(page, "76000000000000003", "staffBufPv", ["staff"]);
  const roles = (await (await page.request.get("/api/event-roles")).json()) as { roles: { id: string; name: string }[] };
  const tank = roles.roles.find((r) => r.name === "Tank")!;
  const created = await page.request.post("/api/event-templates", {
    headers: { Origin: ORIGIN },
    data: { name: templateName, description: null, minPartySize: 1, maxPartySize: 1, active: true, roles: [{ roleId: tank.id, slots: 1, buffunfaMin: 5, buffunfaMax: 20 }] },
  });
  expect(created.status()).toBe(201);

  await login(page, "76000000000000004", "callerBufPv", ["caller"]);
  await page.goto("/staff/eventos");
  await page.getByRole("button", { name: "Criar evento", exact: true }).first().click();
  const novo = page.getByRole("dialog");
  await novo.getByRole("button", { name: new RegExp(templateName) }).click();
  await novo.getByLabel("Nome do evento").fill(eventName);
  await novo.getByRole("button", { name: "Criar evento" }).click();
  await expect(page.getByText("Evento criado").first()).toBeVisible();
  const eventId = await page.evaluate(async (name) => {
    const res = await fetch("/api/events");
    return ((await res.json()) as { events: { id: string; name: string }[] }).events.find((e) => e.name === name)!.id;
  }, eventName);

  await login(page, "76000000000000005", "callerBufXx", ["caller"]);
  expect((await page.request.get(`/api/events/${eventId}/attendance`)).status()).toBe(403);
  expect((await page.request.post(`/api/events/${eventId}/attendance/payout`, { headers: { Origin: ORIGIN }, data: {} })).status()).toBe(403);

  await login(page, "76000000000000006", "membroBufPv");
  expect((await page.request.get(`/api/events/${eventId}/attendance`)).status()).toBe(403);
  expect((await page.request.post(`/api/events/${eventId}/attendance/payout`, { headers: { Origin: ORIGIN }, data: {} })).status()).toBe(403);
});
