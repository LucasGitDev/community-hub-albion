/**
 * Códigos de erro do login Discord (TASK-008). O server redireciona para `/entrar?erro=<código>`
 * e a SPA (TASK-010) mostra o texto PT-BR (Q18). Códigos são estáveis: não renomear.
 */
export const LOGIN_ERROR_CODES = ["nao-membro", "oauth", "cancelado"] as const;

export type LoginErrorCode = (typeof LOGIN_ERROR_CODES)[number];

export const LOGIN_ERROR_MESSAGES: Record<LoginErrorCode, string> = {
  "nao-membro": "Sua conta Discord não é membro do servidor da comunidade. Entre no servidor e tente de novo.",
  oauth: "Não foi possível concluir o login com o Discord. Tente de novo.",
  cancelado: "Login cancelado no Discord. Clique em entrar para tentar de novo.",
};

export const isLoginErrorCode = (value: unknown): value is LoginErrorCode =>
  typeof value === "string" && (LOGIN_ERROR_CODES as readonly string[]).includes(value);

/** Texto PT-BR para o código recebido na URL; código desconhecido cai no erro genérico. */
export const loginErrorMessage = (code: unknown): string => LOGIN_ERROR_MESSAGES[isLoginErrorCode(code) ? code : "oauth"];
