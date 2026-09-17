import { expect, test, type Page } from "@playwright/test";
import { login, ORIGIN, snap } from "./session";

/**
 * Posição na lista de espera (TASK-066). O número era um contador que nunca reaproveitava valor, então
 * bastava alguém sair para a fila ficar com buraco: sobrava o "3º" sem 1º nem 2º. O painel da staff
 * mascarava isso contando a lista na tela, mas o card do membro e a API continuavam com o número cru —
 * as duas telas **discordavam sobre a mesma pessoa**.
 *
 * O que só aqui aparece: as duas telas e a API lidas na mesma fila, depois de uma saída e uma promoção.
 */

const tag = () => (test.info().project.name === "mobile" ? "M" : "D");

/** Tank com uma vaga só: a segunda pessoa em diante cai na espera e dá para formar fila de verdade. */
async function createTemplate(page: Page, name: string): Promise<string> {
  const { roles } = (await (await page.request.get("/api/event-roles")).json()) as { roles: { id: string; name: string }[] };
  const res = await page.request.post("/api/event-templates", {
    headers: { Origin: ORIGIN },
    data: {
      name,
      description: null,
      minPartySize: 1,
      maxPartySize: null,
      active: true,
      roles: [{ roleId: roles.find((r) => r.name === "Tank")!.id, slots: 1, buffunfaMin: "0", buffunfaMax: "0" }],
    },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** Entra na Tank pela tela do membro e devolve a frase da minha situação naquele card. */
async function joinTank(page: Page, eventName: string) {
  await page.goto("/eventos");
  const card = page.getByRole("listitem").filter({ hasText: eventName }).first();
  await card.getByRole("button", { name: /^Tank, / }).click();
  return card;
}

test("a fila da espera renumera quando alguém sai, e membro, painel e API mostram o mesmo número", async ({ page }) => {
  test.setTimeout(150_000);
  const run = `${tag()}${Date.now().toString(36)}`;
  const templateName = `Fila ${run}`;
  const eventName = `Espera ${run}`;

  await login(page, "0661", "staffP", { roles: ["staff"] });
  const templateId = await createTemplate(page, templateName);

  await login(page, "0662", "callerP", { roles: ["caller"] });
  const created = await page.request.post("/api/events", { headers: { Origin: ORIGIN }, data: { templateId, name: eventName } });
  expect(created.status()).toBe(201);
  const eventId = ((await created.json()) as { id: string }).id;
  const opened = await page.request.post(`/api/events/${eventId}/transitions/open`, { headers: { Origin: ORIGIN } });
  expect(opened.ok()).toBe(true);

  // Um confirmado e três na espera: 1º, 2º e 3º, na ordem de chegada.
  await login(page, "0663", "donoP");
  await joinTank(page, eventName);

  await login(page, "0664", "primeiroP");
  const primeiroCard = await joinTank(page, eventName);
  await expect(primeiroCard.getByText("Tank, 1º na espera")).toBeVisible();

  await login(page, "0665", "segundoP");
  const segundoCard = await joinTank(page, eventName);
  await expect(segundoCard.getByText("Tank, 2º na espera")).toBeVisible();

  await login(page, "0666", "terceiroP");
  const terceiroCard = await joinTank(page, eventName);
  await expect(terceiroCard.getByText("Tank, 3º na espera")).toBeVisible();
  await snap(page, `espera-fila-cheia-${tag()}`);

  // O confirmado sai: o 1º da espera é promovido e os que ficaram viram 1º e 2º, sem buraco e sem
  // trocar de lugar entre si — quem era o 2º passa na frente de quem era o 3º.
  await login(page, "0663", "donoP");
  await page.goto("/eventos");
  await page.getByRole("listitem").filter({ hasText: eventName }).first().getByRole("button", { name: "Sair do evento" }).click();
  await expect(page.getByText("Você saiu do evento")).toBeVisible();

  await login(page, "0664", "primeiroP");
  await page.goto("/eventos");
  await expect(page.getByRole("listitem").filter({ hasText: eventName }).first().getByText("Tank, confirmado")).toBeVisible();

  await login(page, "0665", "segundoP");
  await page.goto("/eventos");
  const segundoDepois = page.getByRole("listitem").filter({ hasText: eventName }).first();
  await expect(segundoDepois.getByText("Tank, 1º na espera")).toBeVisible();
  await snap(page, `espera-membro-renumerado-${tag()}`);

  await login(page, "0666", "terceiroP");
  await page.goto("/eventos");
  await expect(page.getByRole("listitem").filter({ hasText: eventName }).first().getByText("Tank, 2º na espera")).toBeVisible();

  // O painel da staff lê a mesma fila: o número ao lado do nome bate com o do card de cada um.
  await login(page, "0662", "callerP", { roles: ["caller"] });
  await page.goto("/staff/eventos");
  await page.getByRole("region", { name: "Eventos", exact: true }).getByRole("button", { name: new RegExp(eventName) }).click();
  const tankSection = page.getByRole("region", { name: eventName }).getByRole("region", { name: "Role Tank" });
  await expect(tankSection.getByRole("listitem").filter({ hasText: "segundoP" }).getByText("1º")).toBeVisible();
  await expect(tankSection.getByRole("listitem").filter({ hasText: "terceiroP" }).getByText("2º")).toBeVisible();
  await snap(page, `espera-painel-staff-${tag()}`);

  // E a API devolve exatamente esses números, que é de onde as duas telas leem (AC#1).
  const roster = (await (await page.request.get(`/api/events/${eventId}/signups`)).json()) as {
    signups: { userId: string; status: string; position: number }[];
    members: { userId: string; nick: string }[];
  };
  const nick = (userId: string) => roster.members.find((m) => m.userId === userId)!.nick;
  expect(roster.signups.filter((s) => s.status === "waitlist").map((s) => [nick(s.userId), s.position])).toEqual([
    ["segundoP", 1],
    ["terceiroP", 2],
  ]);
});
