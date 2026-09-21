import { expect, test, type Page } from "@playwright/test";
import { ORIGIN } from "./session";

/**
 * Presença como peso da divisão (TASK-084, PE1 a PE6).
 *
 * O que este spec prova, e que nenhum teste de unidade consegue provar: que o caller **edita presença**
 * e **lê prata**, que a prata muda na tela no instante em que ele digita, e que uma leva já confirmada
 * não se mexe quando a presença muda depois (PE4).
 *
 * Dois jogadores de propósito: com um só, qualquer presença acima de zero dá 100% da divisão, e o
 * exemplo da PE2 (100% e 50% viram 2/3 e 1/3) não apareceria.
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

test("a presença é o peso: o caller edita presença e lê a prata que sai dela (AC#1 a #7)", async ({ page }) => {
  test.setTimeout(180_000);
  const run = `${tag()}p${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const templateName = `Presenca ${run}`;
  const eventName = `Evento presenca ${run}`;

  await login(page, "78000000000000001", "staffPe", ["staff"]);
  const roles = (await (await page.request.get("/api/event-roles")).json()) as { roles: { id: string; name: string }[] };
  const tank = roles.roles.find((r) => r.name === "Tank")!;
  expect(
    (
      await page.request.post("/api/event-templates", {
        headers: { Origin: ORIGIN },
        data: { name: templateName, description: null, minPartySize: 1, maxPartySize: 2, active: true, roles: [{ roleId: tank.id, slots: 2, buffunfaMin: 0, buffunfaMax: 0 }] },
      })
    ).status(),
  ).toBe(201);

  await login(page, "78000000000000002", "callerPe", ["caller"]);
  await page.goto("/staff/eventos");
  await page.getByRole("button", { name: "Criar evento", exact: true }).first().click();
  const novo = page.getByRole("dialog");
  await novo.getByRole("button", { name: new RegExp(templateName) }).click();
  await novo.getByLabel("Nome do evento").fill(eventName);
  await novo.getByRole("button", { name: "Criar evento" }).click();
  await expect(page.getByText("Evento criado").first()).toBeVisible();

  await selectEvent(page, eventName);
  await page.getByRole("region", { name: eventName }).getByRole("button", { name: "Abrir inscrições" }).click();
  await expect(page.getByText("Inscrições abertas").first()).toBeVisible();

  // Dois inscritos: é entre eles que a presença vai decidir a divisão.
  for (const [base, nick, vagas] of [
    ["78000000000000003", "jogadorUmPe", "0 de 2"],
    ["78000000000000004", "jogadorDoisPe", "1 de 2"],
  ] as const) {
    await login(page, base, nick);
    await page.goto("/eventos");
    await page.getByRole("listitem").filter({ hasText: eventName }).first().getByRole("button", { name: new RegExp(`^Tank, ${vagas}`) }).click();
    await expect(page.getByText("Vaga garantida em Tank")).toBeVisible();
  }

  await login(page, "78000000000000002", "callerPe", ["caller"]);
  await page.goto("/staff/eventos");
  await selectEvent(page, eventName);
  const painel = page.getByRole("region", { name: eventName });
  await painel.getByRole("button", { name: "Iniciar evento" }).click();
  await expect(painel.getByText("Acontecendo agora")).toBeVisible();
  await painel.getByRole("button", { name: "Finalizar evento" }).click();
  await expect(painel.getByText("Finalizado", { exact: true })).toBeVisible();

  await page.reload();
  await selectEvent(page, eventName);
  const acerto = page.getByRole("region", { name: eventName }).getByRole("region", { name: "Loot split" });
  await acerto.getByLabel("Total arrecadado na leva").fill("30.000.000");

  // AC#7: sem presença nenhuma, a tela recusa antes de gastar requisição — e diz por quê.
  await expect(acerto.getByText("ninguém com presença", { exact: false })).toBeVisible();
  await expect(acerto.getByRole("button", { name: "Calcular divisão" })).toBeDisabled();

  /*
   * AC#1 e AC#2, o coração da task: presença **independente**, que não soma 100%, e a prata derivada
   * dela na mesma tecla. 100% e 50% dividem 30M em 20M e 10M — sem nenhuma conta na mão.
   */
  const presencas = acerto.getByLabel(/^Presença de .* em porcentagem$/);
  await presencas.nth(0).fill("100");
  await presencas.nth(1).fill("50");
  await expect(acerto.getByText("de presença somada, entre 2 pessoas")).toBeVisible();
  await expect(acerto.getByText("66,67%", { exact: false }).first()).toBeVisible();
  await expect(acerto.getByText("33,33%", { exact: false }).first()).toBeVisible();
  await expect(acerto.getByText("20.001.000").first()).toBeVisible();
  await expect(acerto.getByText("9.999.000").first()).toBeVisible();
  await snap(page, `presenca-peso-${tag()}`);

  // AC#3: a medição da call (zero, sem bot no e2e) continua visível ao lado do número editado.
  await expect(acerto.getByText("medido 0%").first()).toBeVisible();

  await acerto.getByRole("button", { name: "Calcular divisão" }).click();
  await expect(page.getByText("Divisão calculada").first()).toBeVisible();

  // A prata gravada é exatamente a que estava na tela, e nada se perdeu no arredondamento.
  const eventId = await page.evaluate(async (name) => {
    const res = await fetch("/api/events");
    return ((await res.json()) as { events: { id: string; name: string }[] }).events.find((e) => e.name === name)!.id;
  }, eventName);
  const lerSplits = () =>
    page.evaluate(async (id) => {
      const res = await fetch(`/api/events/${id}/splits`);
      return (await res.json()) as { splits: { status: string; residualSilver: string; feeSilver: string; lines: { presenceBp: number; shareBp: number; amount: string }[] }[] };
    }, eventId);
  const rascunho = await lerSplits();
  expect(rascunho.splits[0]!.lines.map((l) => [l.presenceBp, l.shareBp, l.amount])).toEqual([
    [10_000, 6667, "20001000"],
    [5000, 3333, "9999000"],
  ]);

  await acerto.getByRole("button", { name: "Confirmar e creditar" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirmar e creditar" }).click();
  await expect(page.getByText("Split confirmado").first()).toBeVisible();
  await expect(acerto.getByText("Leva 1 confirmada")).toBeVisible();
  await snap(page, `presenca-confirmada-${tag()}`);

  /*
   * AC#4: a presença é do evento, não da leva. Mexer nela agora muda a **próxima** leva e não encosta
   * na que já virou lançamento no ledger.
   */
  const congelado = (await lerSplits()).splits[0]!.lines;
  await acerto.getByLabel(/^Presença de .* em porcentagem$/).nth(1).fill("100");
  await acerto.getByRole("button", { name: "Salvar só a presença" }).click();
  await expect(page.getByText("Presença salva").first()).toBeVisible();
  expect((await lerSplits()).splits[0]!.lines).toEqual(congelado);

  await acerto.getByLabel("Total desta nova leva").fill("30.000.000");
  await acerto.getByRole("button", { name: "Calcular divisão" }).click();
  // Poll em vez de toast: o "Divisão calculada" da primeira leva ainda pode estar na tela.
  await expect.poll(async () => (await lerSplits()).splits.length).toBe(2);
  const segunda = (await lerSplits()).splits[1]!;
  expect(segunda.lines.map((l) => [l.presenceBp, l.shareBp])).toEqual([
    [10_000, 5000],
    [10_000, 5000],
  ]);
});
