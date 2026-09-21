import { describe, expect, it } from "vitest";
import {
  EVENT_LATE_REPLIES,
  QUESTION_MAX_PEOPLE,
  eventLateAddButtonId,
  eventLateIgnoreButtonId,
  eventLateRoleButtonId,
  lateSignupQuestionView,
  lateSignupRoleView,
  type LatePerson,
} from "./event-late-signup.js";
import { buttonRows } from "./embed-view.js";

const person = (id: string, name: string): LatePerson => ({ discordUserId: id, displayName: name });
const TICKET = "t1";

describe("ids dos botões da pergunta", () => {
  it("carregam ticket e alvo, e o ignorar carrega só o ticket", () => {
    expect(eventLateAddButtonId(TICKET, "123")).toBe("evento/entrou/inscrever/t1/123");
    expect(eventLateRoleButtonId(TICKET, "123", "slot-a")).toBe("evento/entrou/role/t1/123/slot-a");
    expect(eventLateIgnoreButtonId(TICKET)).toBe("evento/entrou/ignorar/t1");
  });
});

describe("embed da pergunta (PE7)", () => {
  it("diz que o silêncio não inscreve ninguém e que só caller e staff respondem", () => {
    const view = lateSignupQuestionView({ name: "ZvZ" }, TICKET, [person("1", "Ana")]);
    expect(view.title).toContain("ZvZ");
    expect(view.description).toContain("Sem resposta, nada acontece");
    expect(view.description).toContain("caller do evento e a staff");
    // PE8 é promessa da própria pergunta: quem aceita precisa saber o que está aceitando.
    expect(view.description).toContain("a partir de agora");
  });

  it("um botão Inscrever por pessoa mais um Ignorar, tudo numa linha só", () => {
    const people = Array.from({ length: QUESTION_MAX_PEOPLE }, (_, i) => person(String(i), `P${i}`));
    const view = lateSignupQuestionView({ name: "ZvZ" }, TICKET, people);
    expect(view.buttons).toHaveLength(QUESTION_MAX_PEOPLE + 1);
    // O lote existe para caber numa linha: cinco botões é o limite do Discord.
    expect(buttonRows(view.buttons)).toHaveLength(1);
    expect(view.buttons.at(-1)?.customId).toBe(eventLateIgnoreButtonId(TICKET));
    expect(view.buttons.at(-1)?.label).toBe("Ignorar todos");
  });

  it("com uma pessoa só o botão é Ignorar, no singular", () => {
    const view = lateSignupQuestionView({ name: "ZvZ" }, TICKET, [person("1", "Ana")]);
    expect(view.buttons.at(-1)?.label).toBe("Ignorar");
    expect(view.fields).toEqual([{ name: "Ana", value: "<@1>", inline: true }]);
  });

  it("corta rótulo gigante no limite do Discord", () => {
    const view = lateSignupQuestionView({ name: "ZvZ" }, TICKET, [person("1", "N".repeat(120))]);
    expect(view.buttons[0]!.label.length).toBeLessThanOrEqual(80);
    expect(view.buttons[0]!.label.endsWith("...")).toBe(true);
  });
});

describe("embed da escolha de role", () => {
  it("só mostra role com vaga e diz quantas sobraram", () => {
    const view = lateSignupRoleView(TICKET, person("1", "Ana"), [
      { id: "a", name: "Tank", free: 1 },
      { id: "b", name: "Healer", free: 3 },
    ]);
    expect(view.title).toContain("Ana");
    expect(view.buttons.map((b) => b.label)).toEqual(["Tank (1 vaga)", "Healer (3 vagas)"]);
    expect(view.buttons[0]!.customId).toBe(eventLateRoleButtonId(TICKET, "1", "a"));
  });
});

describe("copy das recusas", () => {
  it("não confunde finalizado com não-iniciado", () => {
    expect(EVENT_LATE_REPLIES.notRunning("finished")).toContain("finalizado");
    expect(EVENT_LATE_REPLIES.notRunning("draft")).not.toContain("finalizado");
  });

  it("ignorar deixa claro que ninguém entrou", () => {
    expect(EVENT_LATE_REPLIES.ignored(1)).toContain("ninguém foi inscrito");
    expect(EVENT_LATE_REPLIES.ignored(3)).toContain("3 pessoas");
  });

  it("a recusa por saldo diz a taxa e não o saldo do outro", () => {
    // Quem clica é o caller, e qualquer caller cria evento: dizer o saldo daria um jeito de espiá-lo.
    const reply = EVENT_LATE_REPLIES.insufficientFunds("Ana", 50n);
    expect(reply).toContain("50");
    expect(reply).not.toMatch(/tem \d/);
  });

  it("o aceite avisa que a presença começa agora", () => {
    expect(EVENT_LATE_REPLIES.added("Ana", "Tank")).toContain("começa agora");
  });
});
