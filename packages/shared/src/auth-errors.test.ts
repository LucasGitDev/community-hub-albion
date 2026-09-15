import { describe, expect, it } from "vitest";
import { isLoginErrorCode, LOGIN_ERROR_CODES, LOGIN_ERROR_MESSAGES, loginErrorMessage } from "./auth-errors.js";

describe("erros de login (TASK-008, Q4/Q18)", () => {
  it("todo código tem mensagem PT-BR", () => {
    expect(Object.keys(LOGIN_ERROR_MESSAGES)).toEqual([...LOGIN_ERROR_CODES]);
  });

  it("não membro da guild recebe mensagem PT-BR explicando o que fazer (Q4)", () => {
    expect(loginErrorMessage("nao-membro")).toBe("Sua conta Discord não é membro do servidor da comunidade. Entre no servidor e tente de novo.");
  });

  it.each([["oauth", true], ["x", false], [undefined, false]])("isLoginErrorCode(%j) = %s", (value, expected) => {
    expect(isLoginErrorCode(value)).toBe(expected);
  });

  it("código desconhecido cai no erro genérico", () => {
    expect(loginErrorMessage("<script>")).toBe(LOGIN_ERROR_MESSAGES.oauth);
  });
});
