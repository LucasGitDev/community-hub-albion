import { expect, test, type Page } from "@playwright/test";
import { ORIGIN } from "./session";

/**
 * Volta da espera para a vaga (TASK-063). O caller manda alguém da role para a lista de espera e
 * precisa conseguir devolver essa pessoa para a mesma role enquanto a vaga estiver livre — o painel
 * só oferecia as **outras** roles, então quem descia para a espera ficava preso lá e nem o start o
 * arrastava (Q29 só leva confirmados).
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

/** Uma vaga de Tank e uma de Healer: dá para lotar a role e ver o destino desabilitado. */
async function createTemplate(page: Page, name: string): Promise<void> {
  const roles = (await (await page.request.get("/api/event-roles")).json()) as { roles: { id: string; name: string }[] };
  const tank = roles.roles.find((r) => r.name === "Tank")!;
  const healer = roles.roles.find((r) => r.name === "Healer")!;
  const res = await page.request.post("/api/event-templates", {
    headers: { Origin: ORIGIN },
    data: { name, description: null, minPartySize: 2, maxPartySize: 2, active: true, roles: [{ roleId: tank.id, slots: 1, buffunfaMin: 0, buffunfaMax: 0 }, { roleId: healer.id, slots: 1, buffunfaMin: 0, buffunfaMax: 0 }] },
  });
  expect(res.status()).toBe(201);
}

test("caller manda o confirmado para a espera e devolve para a mesma vaga antes de iniciar (TASK-063, AC#1/AC#2/AC#3/AC#5)", async ({ page }) => {
  test.setTimeout(150_000);
  const run = `${tag()}w${Date.now().toString(36)}`;
  const templateName = `Caçada ${run}`;
  const eventName = `Evento ${run}`;

  await login(page, "73000000000000011", "staffW", ["staff"]);
  await createTemplate(page, templateName);

  await login(page, "73000000000000012", "callerW", ["caller"]);
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

  // Um inscrito confirmado em Tank: é dele que o caller vai abrir mão e depois se arrepender.
  const membro = await login(page, "73000000000000013", "membroW");
  await page.goto("/eventos");
  const card = page.getByRole("listitem").filter({ hasText: eventName }).first();
  await card.getByRole("button", { name: /^Tank, 0 de 1/ }).click();
  await expect(card.getByText("Tank, confirmado")).toBeVisible();

  await login(page, "73000000000000012", "callerW", ["caller"]);
  await page.goto("/staff/eventos");
  await selectEvent(page, eventName);
  const detail = page.getByRole("region", { name: eventName });
  const tankSection = detail.getByRole("region", { name: "Role Tank" });
  await expect(tankSection.getByText("1/1")).toBeVisible();

  // Desce para a espera: a vaga fica livre e ninguém é promovido no lugar dele (AC#4).
  await tankSection.getByRole("button", { name: "↓ espera" }).click();
  await expect(page.getByText(/foi para a lista de espera/)).toBeVisible();
  await expect(tankSection.getByText("0/1")).toBeVisible();
  await expect(tankSection.getByText("Vaga livre.")).toBeVisible();
  await expect(tankSection.getByText("1º")).toBeVisible();
  await snap(page, `espera-com-vaga-livre-${tag()}`);

  // AC#1/AC#2: com a vaga livre, a própria role vira destino e a pessoa volta confirmada.
  const backToTank = tankSection.getByRole("button", { name: "→ Tank" });
  await expect(backToTank).toBeEnabled();
  await backToTank.click();
  await expect(page.getByText(/foi para Tank/)).toBeVisible();
  await expect(tankSection.getByText("1/1")).toBeVisible();
  await expect(tankSection.getByText(membro)).toBeVisible();
  await expect(tankSection.getByText("Lista de espera desta role")).toHaveCount(0);
  await snap(page, `espera-devolvida-para-a-vaga-${tag()}`);

  // AC#3: com a role lotada, quem cai na espera dela vê o destino desabilitado e com o motivo.
  await login(page, "73000000000000014", "esperaW");
  await page.goto("/eventos");
  const card2 = page.getByRole("listitem").filter({ hasText: eventName }).first();
  await card2.getByRole("button", { name: /^Tank, 1 de 1 vagas, lotada/ }).click();
  await expect(card2.getByText("Tank, 1º na espera")).toBeVisible();

  await login(page, "73000000000000012", "callerW", ["caller"]);
  await page.goto("/staff/eventos");
  await selectEvent(page, eventName);
  const detail2 = page.getByRole("region", { name: eventName });
  const tankSection2 = detail2.getByRole("region", { name: "Role Tank" });
  const blocked = tankSection2.getByRole("button", { name: "→ Tank" });
  await expect(blocked).toBeDisabled();
  await expect(blocked).toHaveAttribute("title", "Tank está lotada");
  await snap(page, `espera-com-role-lotada-${tag()}`);

  /**
   * AC#4: aqui a vaga liberada tem fila, então o primeiro da espera sobe sozinho — quem desceu é o
   * único excluído da promoção, senão ele voltaria para a vaga que acabou de largar.
   */
  await tankSection2.getByRole("button", { name: "↓ espera" }).click();
  await expect(page.getByText(/foi para a lista de espera/)).toBeVisible();
  await expect(tankSection2.getByText("1/1")).toBeVisible();
  await expect(tankSection2.getByText("esperaW", { exact: false })).toBeVisible();
  const waiting = tankSection2.getByRole("listitem").filter({ hasText: membro });
  await expect(waiting.getByText("1º")).toBeVisible();
  await expect(waiting.getByRole("button", { name: "→ Tank" })).toBeDisabled();

  // Com Tank lotada, o caminho de volta é a outra role: o destino livre continua clicável.
  await waiting.getByRole("button", { name: "→ Healer" }).click();
  await expect(page.getByText(/foi para Healer/)).toBeVisible();
  const healerSection = detail2.getByRole("region", { name: "Role Healer" });
  await expect(healerSection.getByText("1/1")).toBeVisible();
  await expect(tankSection2.getByText("Lista de espera desta role")).toHaveCount(0);

  // AC#5: o start leva quem passou pela espera — os dois estão confirmados quando o evento começa (Q29).
  await detail2.getByRole("button", { name: "Fechar inscrições" }).click();
  await expect(detail2.getByText("Inscrições fechadas")).toBeVisible();
  await detail2.getByRole("button", { name: "Iniciar evento" }).click();
  await expect(detail2.getByText("Acontecendo agora")).toBeVisible();
  await expect(tankSection2.getByText("1/1")).toBeVisible();
  await expect(healerSection.getByText(membro)).toBeVisible();
  await snap(page, `espera-evento-iniciado-${tag()}`);
});
