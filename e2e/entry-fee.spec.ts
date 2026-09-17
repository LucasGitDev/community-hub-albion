import { expect, test, type Page } from "@playwright/test";
import { login, ORIGIN, snap } from "./session";

/**
 * Taxa de entrada em Buffunfa (TASK-058, F6-12 a F6-16) pelo painel, ponta a ponta.
 *
 * O que só aqui aparece: que o preço está na tela **antes** do clique, que quem não tem Buffunfa lê
 * quanto falta em vez de tomar um erro depois de tentar, e que sair do evento devolve — com o chip do
 * header, que é o saldo, voltando ao número de antes.
 */

const tag = () => (test.info().project.name === "mobile" ? "M" : "D");

/** Template com Tank (1 vaga) e Healer (1): cada rodada cria o seu, desktop e mobile em paralelo. */
async function createTemplate(page: Page, name: string): Promise<void> {
  const { roles } = (await (await page.request.get("/api/event-roles")).json()) as { roles: { id: string; name: string }[] };
  const res = await page.request.post("/api/event-templates", {
    headers: { Origin: ORIGIN },
    data: {
      name,
      description: null,
      minPartySize: 2,
      maxPartySize: 2,
      active: true,
      // A faixa de Buffunfa é obrigatória desde a TASK-057; 0 a 0 é role que não paga presença, que é
      // o que este teste quer — ele mede a taxa de entrada, não o ganho.
      roles: [
        { roleId: roles.find((r) => r.name === "Tank")!.id, slots: 1, buffunfaMin: "0", buffunfaMax: "0" },
        { roleId: roles.find((r) => r.name === "Healer")!.id, slots: 1, buffunfaMin: "0", buffunfaMax: "0" },
      ],
    },
  });
  expect(res.status()).toBe(201);
}

test("caller cobra entrada, membro sem Buffunfa lê quanto falta, membro com saldo paga e recebe de volta ao sair", async ({ page }) => {
  test.setTimeout(150_000);
  const run = `${tag()}${Date.now().toString(36)}`;
  const templateName = `Disputado ${run}`;
  const eventName = `Entrada ${run}`;

  await login(page, "058", "staffF", { roles: ["staff"] });
  await createTemplate(page, templateName);

  // O caller cria o evento e define a taxa antes de abrir as inscrições (AC#1).
  await login(page, "059", "callerF", { roles: ["caller"] });
  await page.goto("/staff/eventos");
  await page.getByRole("button", { name: "Criar evento", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: new RegExp(templateName) }).click();
  await dialog.getByLabel("Nome do evento").fill(eventName);
  await dialog.getByRole("button", { name: "Criar evento" }).click();
  await expect(page.getByText("Evento criado")).toBeVisible();

  await page.getByRole("region", { name: "Eventos", exact: true }).getByRole("button", { name: new RegExp(eventName) }).click();
  const detail = page.getByRole("region", { name: eventName });
  // Template nasce zerado, então o campo do evento também (AC#1).
  const fee = detail.getByLabel("Taxa de entrada em Buffunfa");
  await expect(fee).toHaveValue("0");
  await fee.fill("30");
  await detail.getByRole("button", { name: "Salvar taxa" }).click();
  await expect(page.getByText("Taxa de entrada salva")).toBeVisible();
  await expect(detail.getByText("entrada 30 BUF")).toBeVisible();
  await snap(page, `taxa-entrada-caller-${tag()}`);

  await detail.getByRole("button", { name: "Abrir inscrições" }).click();
  await expect(page.getByText("Inscrições abertas").first()).toBeVisible();

  // Membro sem Buffunfa: o preço aparece antes do clique e o aviso diz **quanto** falta (AC#2).
  await login(page, "060", "poucoF", { ledger: [{ amount: "10", currency: "buffunfa", kind: "split_payout", memo: "presença" }] });
  await page.goto("/eventos");
  const pobre = page.getByRole("listitem").filter({ hasText: eventName }).first();
  await expect(pobre.getByText("entrada 30 BUF")).toBeVisible();
  await expect(pobre.getByText("Faltam 20 BUF para a entrada deste evento.")).toBeVisible();
  // O custo está no nome acessível da vaga, não só no selo ao lado (um CTA que diz o que acontece).
  const vagas = pobre.getByRole("button", { name: /Custa 30 BUF para entrar/ });
  await expect(vagas).toHaveCount(2);
  for (const vaga of await vagas.all()) await expect(vaga).toBeDisabled();
  await snap(page, `taxa-entrada-sem-saldo-${tag()}`);

  // Membro com saldo: paga na inscrição e o chip do header cai na hora (F6-13).
  await login(page, "061", "ricoF", { ledger: [{ amount: "100", currency: "buffunfa", kind: "split_payout", memo: "presença" }] });
  await page.goto("/eventos");
  const chip = page.getByRole("link", { name: "Meus saldos" });
  await expect(chip).toContainText("100 BUF");
  const card = page.getByRole("listitem").filter({ hasText: eventName }).first();
  await card.getByRole("button", { name: /^Tank, 0 de 1 vagas\. Custa 30 BUF para entrar/ }).click();
  await expect(page.getByText("Vaga garantida em Tank")).toBeVisible();
  await expect(chip).toContainText("70 BUF");
  await snap(page, `taxa-entrada-pago-${tag()}`);

  // Desistir antes do início devolve (AC#3): o estorno aparece no extrato, junto da cobrança.
  await card.getByRole("button", { name: "Sair do evento" }).click();
  await expect(page.getByText("Você saiu do evento")).toBeVisible();
  await expect(chip).toContainText("100 BUF");

  await page.goto("/carteira");
  await expect(page.getByText("Taxa de entrada").first()).toBeVisible();
  await expect(page.getByText("Estorno").first()).toBeVisible();
  await snap(page, `taxa-entrada-extrato-${tag()}`);
});
