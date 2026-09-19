import { expect, test, type Page } from "@playwright/test";
import { ORIGIN } from "./session";

/**
 * Acerto do evento finalizado (TASK-029): dados, taxa e loot split até o crédito no ledger.
 *
 * Como os outros specs de evento: desktop e mobile rodam em paralelo contra o mesmo banco, então cada
 * execução cria o seu próprio template, o seu evento e os seus usuários.
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

async function createTemplate(page: Page, name: string): Promise<void> {
  const roles = (await (await page.request.get("/api/event-roles")).json()) as { roles: { id: string; name: string }[] };
  const tank = roles.roles.find((r) => r.name === "Tank")!;
  const res = await page.request.post("/api/event-templates", {
    headers: { Origin: ORIGIN },
    data: { name, description: null, minPartySize: 1, maxPartySize: 1, active: true, roles: [{ roleId: tank.id, slots: 1, buffunfaMin: 0, buffunfaMax: 0 }] },
  });
  expect(res.status()).toBe(201);
}

const selectEvent = (page: Page, eventName: string) =>
  page.getByRole("region", { name: "Eventos", exact: true }).getByRole("button", { name: new RegExp(eventName) }).click();

/**
 * Fluxo inteiro num teste só, de propósito: o acerto **é** uma sequência, e cada passo depende do
 * anterior (sem inscrito não há presença, sem presença não há divisão, sem 100% não há crédito).
 */
test("caller acerta o evento finalizado: dados, taxa, split e confirmação (AC#1 a #11)", async ({ page }) => {
  test.setTimeout(180_000);
  const run = `${tag()}s${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const templateName = `Acerto ${run}`;
  const eventName = `Evento acerto ${run}`;

  await login(page, "75000000000000001", "staffAc", ["staff"]);
  await createTemplate(page, templateName);

  await login(page, "75000000000000002", "callerAc", ["caller"]);
  await page.goto("/staff/eventos");
  await page.getByRole("button", { name: "Criar evento", exact: true }).first().click();
  const novo = page.getByRole("dialog");
  await novo.getByRole("button", { name: new RegExp(templateName) }).click();
  await novo.getByLabel("Nome do evento").fill(eventName);
  await novo.getByRole("button", { name: "Criar evento" }).click();
  await expect(page.getByText("Evento criado").first()).toBeVisible();

  await selectEvent(page, eventName);
  const detail = page.getByRole("region", { name: eventName });
  await detail.getByRole("button", { name: "Abrir inscrições" }).click();
  await expect(page.getByText("Inscrições abertas").first()).toBeVisible();

  // Um inscrito de verdade: sem ele o split não tem para quem creditar.
  await login(page, "75000000000000003", "jogadorAc");
  await page.goto("/eventos");
  await page.getByRole("listitem").filter({ hasText: eventName }).first().getByRole("button", { name: /^Tank, 0 de 1/ }).click();
  await expect(page.getByText("Vaga garantida em Tank")).toBeVisible();

  await login(page, "75000000000000002", "callerAc", ["caller"]);
  await page.goto("/staff/eventos");
  await selectEvent(page, eventName);
  await page.getByRole("region", { name: eventName }).getByRole("button", { name: "Iniciar evento" }).click();
  await expect(page.getByRole("region", { name: eventName }).getByText("Acontecendo agora")).toBeVisible();
  await page.getByRole("region", { name: eventName }).getByRole("button", { name: "Finalizar evento" }).click();
  await expect(page.getByRole("region", { name: eventName }).getByText("Finalizado", { exact: true })).toBeVisible();

  // AC#1: o finalizado não some — ele sobe para a fila "A acertar" e é o que a tela abre.
  await page.reload();
  const fila = page.getByRole("region", { name: "Eventos", exact: true });
  await expect(fila.getByRole("heading", { name: /A acertar/ })).toBeVisible();
  // O evento está na seção A acertar, e não no meio do histórico (o banco do e2e tem eventos de outras rodadas).
  await expect(fila.getByRole("button", { name: new RegExp(eventName) })).toBeVisible();
  await selectEvent(page, eventName);
  const painel = page.getByRole("region", { name: eventName });
  await expect(painel.getByRole("tab", { name: "Acerto" })).toHaveAttribute("data-state", "active");
  await snap(page, `acerto-fila-${tag()}`);

  // AC#4/AC#6: sem rascunho a tela já mostra quem esteve na call — não há tela vazia esperando o total.
  const acerto = painel.getByRole("region", { name: "Loot split" });
  // Em 1280 o tempo é uma coluna; em 400 ele desce para baixo do nome, mas está nos dois.
  await expect(acerto.getByText(/na call/).first()).toBeVisible();
  await expect(acerto.getByText("jogadorAc")).toBeVisible();

  // AC#2: corrigir os dados do evento finalizado, que até aqui não tinha formulário nenhum.
  const dados = painel.getByRole("region", { name: "Dados do evento" });
  await dados.getByRole("button", { name: "Corrigir" }).click();
  await dados.getByLabel("Observações").fill("acerto conferido no painel");
  await dados.getByRole("button", { name: "Salvar dados" }).click();
  await expect(page.getByText("Dados do evento salvos").first()).toBeVisible();
  await expect(dados.getByText("acerto conferido no painel")).toBeVisible();

  // AC#3: taxa em porcentagem, com a frase do resultado e o destino do retido.
  const taxa = painel.getByRole("region", { name: "Taxa do evento" });
  await expect(taxa.getByText("o valor retido vai para", { exact: false })).toBeVisible();
  await taxa.getByLabel("Percentual retido").fill("10");
  await taxa.getByRole("button", { name: "Salvar taxa" }).click();
  // `.first()`: a mesma taxa é salva duas vezes no teste, e o primeiro toast ainda pode estar na tela.
  await expect(page.getByText("Taxa do evento: 10%").first()).toBeVisible();

  // AC#8: taxa fixa maior que o total é barrada aqui, sem chamar a API.
  await taxa.getByRole("button", { name: "Valor fixo" }).click();
  await taxa.getByLabel("Prata retida").fill("20.000.000");
  await taxa.getByRole("button", { name: "Salvar taxa" }).click();
  await expect(page.getByText("Taxa do evento: 20.000.000 de prata").first()).toBeVisible();
  await acerto.getByLabel("Total arrecadado na leva").fill("10.000.000");
  // A frase inteira, a mesma do 409 da API, fica no bloco da taxa; o split só diz por que o botão não vai.
  await expect(taxa.getByText("A taxa do evento é maior que o total deste split", { exact: false })).toBeVisible();
  await expect(taxa.getByText("Baixe a taxa ou aumente o total", { exact: false })).toBeVisible();
  await expect(acerto.getByRole("alert")).toContainText("A taxa do evento não cabe neste total");
  await expect(acerto.getByRole("button", { name: "Calcular divisão" })).toBeDisabled();
  await snap(page, `acerto-taxa-maior-que-total-${tag()}`);

  // Volta para a taxa que cabe e calcula a divisão (AC#4).
  await taxa.getByRole("button", { name: "Porcentagem" }).click();
  await taxa.getByLabel("Percentual retido").fill("10");
  await taxa.getByRole("button", { name: "Salvar taxa" }).click();
  // `.first()`: a mesma taxa é salva duas vezes no teste, e o primeiro toast ainda pode estar na tela.
  await expect(page.getByText("Taxa do evento: 10%").first()).toBeVisible();
  await acerto.getByLabel("Total arrecadado na leva").fill("10.000.000");
  // AC#3: a frase da taxa responde ao total digitado, com os três números e o destino do retido.
  await expect(taxa.getByText("De 10.000.000, retém 1.000.000 (10%) para", { exact: false })).toBeVisible();
  await expect(taxa.getByText("sobram 9.000.000 para dividir", { exact: false })).toBeVisible();
  await snap(page, `acerto-taxa-${tag()}`);
  await acerto.getByRole("button", { name: "Calcular divisão" }).click();
  await expect(page.getByText("Divisão calculada").first()).toBeVisible();

  /*
   * Ninguém ficou na call neste ambiente (o bot está desligado no e2e), então o rateio por tempo
   * nasce em 0% — é exatamente o caso que o rodapé existe para mostrar, e o que o caller ajusta à mão.
   */
  await expect(acerto.getByText("faltam 100%", { exact: true })).toBeVisible();
  await expect(acerto.getByRole("button", { name: "Confirmar e creditar" })).toBeDisabled();
  await snap(page, `acerto-rascunho-${tag()}`);

  // AC#5: a soma acompanha a edição e diz o quanto falta, em tempo real.
  await acerto.getByLabel(/^Participação de .* em porcentagem$/).first().fill("97");
  await expect(acerto.getByText("faltam 3%", { exact: true })).toBeVisible();
  await expect(acerto.getByRole("button", { name: "Confirmar e creditar" })).toBeDisabled();
  await snap(page, `acerto-soma-incompleta-${tag()}`);

  // AC#10: com rascunho aberto, arquivar fica bloqueado e explicado.
  await expect(painel.getByText("Há um loot split em rascunho", { exact: false })).toBeVisible();
  await expect(painel.getByRole("button", { name: "Arquivar evento" })).toBeDisabled();

  // AC#5/AC#11: com 100% o rodapé fecha e a prata aparece formatada em PT-BR.
  await acerto.getByLabel(/^Participação de .* em porcentagem$/).first().fill("100");
  await expect(acerto.getByText("a divisão fecha")).toBeVisible();
  await expect(acerto.getByText("9.000.000").first()).toBeVisible();
  await acerto.getByRole("button", { name: "Confirmar e creditar" }).click();

  // AC#7: o diálogo mostra o antes-e-depois e avisa que vira lançamento imutável.
  const confirmar = page.getByRole("dialog");
  await expect(confirmar.getByText("Lançamento não se apaga nem se edita", { exact: false })).toBeVisible();
  await expect(confirmar.getByText("Total bruto da leva")).toBeVisible();
  await expect(confirmar.getByText("Dividido entre 1 pessoa")).toBeVisible();
  // TASK-081: vem marcado como pago no jogo; aqui o jogador não recebeu no jogo, então desmarca.
  const pagoNoJogo = confirmar.getByRole("checkbox", { name: /jogadorAc.* já recebeu no jogo/ });
  await expect(pagoNoJogo).toBeChecked();
  await pagoNoJogo.uncheck();
  await expect(confirmar.getByText("vai para a carteira")).toBeVisible();
  await snap(page, `acerto-confirmacao-${tag()}`);
  await confirmar.getByRole("button", { name: "Confirmar e creditar" }).click();
  await expect(page.getByText("Split confirmado").first()).toBeVisible();

  // AC#9: confirmado vira somente leitura, com o caminho do estorno escrito.
  await expect(acerto.getByText("Leva 1 confirmada")).toBeVisible();
  await expect(acerto.getByText("a staff estorna os lançamentos", { exact: false })).toBeVisible();
  await expect(acerto.getByLabel(/^Participação de .* em porcentagem$/)).toHaveCount(0);
  await snap(page, `acerto-confirmado-${tag()}`);

  /* A prata foi creditada de verdade, e não só desenhada: o split voltou confirmado pela API... */
  const eventId = await page.evaluate(async (name) => {
    const res = await fetch("/api/events");
    return ((await res.json()) as { events: { id: string; name: string }[] }).events.find((e) => e.name === name)!.id;
  }, eventName);
  const gravado = await page.evaluate(async (id) => {
    const res = await fetch(`/api/events/${id}/splits`);
    return (await res.json()) as { splits: { status: string; totalSilver: string; feeSilver: string; lines: { amount: string }[] }[] };
  }, eventId);
  expect(gravado.splits).toHaveLength(1);
  expect(gravado.splits[0]!.status).toBe("confirmed");
  expect(gravado.splits[0]!.feeSilver).toBe("1000000");
  expect(gravado.splits[0]!.lines.map((l) => l.amount)).toEqual(["9000000"]);

  // ...e quem jogou vê os 9.000.000 na carteira dele, formatados em PT-BR (AC#11).
  await login(page, "75000000000000003", "jogadorAc");
  await page.goto("/carteira");
  await expect(page.getByText("9.000.000").first()).toBeVisible();
  await snap(page, `acerto-carteira-${tag()}`);

  await login(page, "75000000000000002", "callerAc", ["caller"]);
  await page.goto("/staff/eventos");

  // AC#10: sem rascunho pendente, arquivar volta a ser possível e fecha o evento de vez (AC#2).
  await selectEvent(page, eventName);
  const depois = page.getByRole("region", { name: eventName });
  await depois.getByRole("button", { name: "Arquivar evento" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Arquivar evento" }).click();
  await expect(depois.getByText("Arquivado", { exact: true })).toBeVisible();
  await depois.getByRole("tab", { name: "Acerto" }).click();
  await expect(depois.getByText("Arquivado: os dados não mudam mais.")).toBeVisible();
  await expect(depois.getByRole("button", { name: "Corrigir" })).toHaveCount(0);
  await expect(depois.getByRole("button", { name: "Salvar taxa" })).toHaveCount(0);
  await snap(page, `acerto-arquivado-${tag()}`);
});

/** AC#12: quem não conduz o evento não vê a aba nem passa pela API — nem o caller do evento do vizinho. */
test("membro e caller de outro evento não alcançam o acerto (AC#12)", async ({ page }) => {
  test.setTimeout(120_000);
  const run = `${tag()}p${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const templateName = `Privado ${run}`;
  const eventName = `Evento privado ${run}`;

  await login(page, "75000000000000004", "staffPv", ["staff"]);
  await createTemplate(page, templateName);

  await login(page, "75000000000000005", "callerPv", ["caller"]);
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
    // Espera a ação sumir antes da próxima: no mobile um toast ainda aberto intercepta o clique seguinte.
    await detail.getByRole("button", { name: action }).click();
    await expect(detail.getByRole("button", { name: action })).toHaveCount(0);
  }
  await expect(detail.getByText("Finalizado", { exact: true })).toBeVisible();
  const eventId = await page.evaluate(async (name) => {
    const res = await fetch("/api/events");
    return ((await res.json()) as { events: { id: string; name: string }[] }).events.find((e) => e.name === name)!.id;
  }, eventName);

  // Caller de outro evento: entra na central, mas o evento alheio não oferece aba de acerto nem API.
  await login(page, "75000000000000006", "callerXx", ["caller"]);
  await page.goto("/staff/eventos");
  await selectEvent(page, eventName);
  await expect(page.getByRole("region", { name: eventName }).getByRole("tab", { name: "Acerto" })).toHaveCount(0);
  expect((await page.request.get(`/api/events/${eventId}/presence`)).status()).toBe(403);
  expect((await page.request.get(`/api/events/${eventId}/splits`)).status()).toBe(403);
  await snap(page, `acerto-sem-permissao-caller-${tag()}`);

  // Membro comum: `read` em Event é dele, o ganho de cada um não.
  await login(page, "75000000000000007", "membroPv");
  expect((await page.request.get(`/api/events/${eventId}`)).status()).toBe(200);
  expect((await page.request.get(`/api/events/${eventId}/presence`)).status()).toBe(403);
  expect((await page.request.get(`/api/events/${eventId}/splits`)).status()).toBe(403);
  const patch = await page.request.patch(`/api/events/${eventId}`, { headers: { Origin: ORIGIN }, data: { name: "Sequestrado" } });
  expect(patch.status()).toBe(403);
  await page.goto("/staff/eventos");
  await expect(page.getByRole("heading", { name: "Acesso negado" })).toBeVisible();
  await snap(page, `acerto-sem-permissao-membro-${tag()}`);
});
