import { expect, test, type Page } from "@playwright/test";
import { ORIGIN } from "./session";

/**
 * Split pago no jogo (TASK-081, SP1 a SP6): na confirmação, o modal traz todo mundo marcado como pago no
 * jogo. Confirmado assim, o extrato do jogador mostra o crédito e o saque, com saldo líquido zero, e a
 * fila de saques da staff não recebe nada.
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

test("confirmar com todos pagos no jogo: crédito e saque no extrato, saldo zero, fila vazia (AC#1 a #6)", async ({ page }) => {
  test.setTimeout(180_000);
  const run = `${tag()}g${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const templateName = `Pago jogo ${run}`;
  const eventName = `Evento pago jogo ${run}`;

  await login(page, "76000000000000001", "staffPj", ["staff"]);
  const roles = (await (await page.request.get("/api/event-roles")).json()) as { roles: { id: string; name: string }[] };
  const tank = roles.roles.find((r) => r.name === "Tank")!;
  expect(
    (
      await page.request.post("/api/event-templates", {
        headers: { Origin: ORIGIN },
        data: { name: templateName, description: null, minPartySize: 1, maxPartySize: 1, active: true, roles: [{ roleId: tank.id, slots: 1, buffunfaMin: 0, buffunfaMax: 0 }] },
      })
    ).status(),
  ).toBe(201);

  await login(page, "76000000000000002", "callerPj", ["caller"]);
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

  await login(page, "76000000000000003", "jogadorPj");
  await page.goto("/eventos");
  await page.getByRole("listitem").filter({ hasText: eventName }).first().getByRole("button", { name: /^Tank, 0 de 1/ }).click();
  await expect(page.getByText("Vaga garantida em Tank")).toBeVisible();

  await login(page, "76000000000000002", "callerPj", ["caller"]);
  await page.goto("/staff/eventos");
  await selectEvent(page, eventName);
  const detail = page.getByRole("region", { name: eventName });
  for (const action of ["Iniciar evento", "Finalizar evento"]) {
    await detail.getByRole("button", { name: action }).click();
    await expect(detail.getByRole("button", { name: action })).toHaveCount(0);
  }
  await expect(detail.getByText("Finalizado", { exact: true })).toBeVisible();

  // Recarrega: o finalizado sobe para "A acertar" e abre direto na aba Acerto.
  await page.reload();
  await selectEvent(page, eventName);
  const painel = page.getByRole("region", { name: eventName });
  await expect(painel.getByRole("tab", { name: "Acerto" })).toHaveAttribute("data-state", "active");
  const acerto = painel.getByRole("region", { name: "Loot split" });
  await acerto.getByLabel("Total arrecadado na leva").fill("5.000.000");
  // Sem bot no e2e não há call medida: a presença nasce em 0 e o caller dá a dele (TASK-084).
  await acerto.getByLabel(/^Presença de .* em porcentagem$/).first().fill("100");
  await acerto.getByRole("button", { name: "Calcular divisão" }).click();
  await expect(page.getByText("Divisão calculada").first()).toBeVisible();
  await expect(acerto.getByText("de presença somada, entre 1 pessoa")).toBeVisible();
  await acerto.getByRole("button", { name: "Confirmar e creditar" }).click();

  // AC#1: modal com todos marcados; dá para desmarcar e marcar de novo.
  const modal = page.getByRole("dialog");
  await expect(modal.getByText("Quem já recebeu no jogo?")).toBeVisible();
  const box = modal.getByRole("checkbox", { name: /jogadorPj.* já recebeu no jogo/ });
  await expect(box).toBeChecked();
  await box.uncheck();
  await expect(modal.getByText("vai para a carteira")).toBeVisible();
  await box.check();
  await expect(modal.getByText("pago no jogo", { exact: true })).toBeVisible();
  await snap(page, `pago-no-jogo-modal-${tag()}`);
  await modal.getByRole("button", { name: "Confirmar e creditar" }).click();
  await expect(page.getByText("Split confirmado").first()).toBeVisible();
  await expect(page.getByText("registrada como paga no jogo", { exact: false }).first()).toBeVisible();

  // AC#2/AC#3: o extrato do jogador tem o crédito e o saque, e o saldo da leva é zero.
  await login(page, "76000000000000003", "jogadorPj");
  const ledger = (await (await page.request.get("/api/me/ledger")).json()) as { entries: { amount: string; kind: string }[] };
  // Rodadas anteriores do e2e reusam o mesmo jogador: cada uma soma um par +X/−X, então o saldo é sempre zero.
  expect(ledger.entries.map((e) => [e.kind, e.amount])).toEqual(expect.arrayContaining([["split_payout", "5000000"], ["withdrawal", "-5000000"]]));
  expect(ledger.entries.reduce((sum, e) => sum + BigInt(e.amount), 0n)).toBe(0n);
  const saques = (await (await page.request.get("/api/me/withdrawals")).json()) as { withdrawals: { amount: string; status: string }[] };
  expect(saques.withdrawals.length).toBeGreaterThan(0);
  expect(saques.withdrawals.every((w) => w.amount === "5000000" && w.status === "settled")).toBe(true);
  await page.goto("/carteira");
  await expect(page.getByText("Sacado: pago no jogo na divisão do loot split").first()).toBeVisible();
  await expect(page.getByText("Loot split do evento").first()).toBeVisible();
  await snap(page, `pago-no-jogo-extrato-${tag()}`);

  // AC#6: a fila da staff não recebe o saque pago no jogo.
  await login(page, "76000000000000001", "staffPj", ["staff"]);
  const fila = (await (await page.request.get("/api/withdrawals?status=pending")).json()) as { withdrawals: { userNick: string | null }[] };
  expect(fila.withdrawals.filter((w) => w.userNick?.startsWith("jogadorPj"))).toEqual([]);
});
