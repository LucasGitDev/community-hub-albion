import { existsSync } from "node:fs";
import { join } from "node:path";
import { Logger, type INestApplication } from "@nestjs/common";
import express, { type Express } from "express";

/** Caminhos da API nunca caem na SPA: /api e /api/... ficam com o Nest (404 JSON se não existir). */
export const isApiPath = (path: string) => path === "/api" || path.startsWith("/api/");

/** Rota client-side recebe index.html; arquivo inexistente (tem extensão) segue pra 404. */
export const shouldServeIndex = (path: string) => !isApiPath(path) && !/\.[a-z0-9]+$/i.test(path);

/**
 * Serve a SPA (apps/web/dist) na raiz do mesmo processo (doc-002): arquivos estáticos
 * e fallback de rota client-side pro index.html. Usa `root` no sendFile pra funcionar
 * mesmo com diretórios com ponto no caminho (ex: .claude/worktrees).
 */
export function serveSpa(app: INestApplication, webDistDir: string): boolean {
  if (!existsSync(join(webDistDir, "index.html"))) {
    new Logger("Spa").warn(`SPA não encontrada em ${webDistDir}; servindo só a API`);
    return false;
  }
  const http = app.getHttpAdapter().getInstance() as Express;
  http.use((req, res, next) => {
    if (isApiPath(req.path) || (req.method !== "GET" && req.method !== "HEAD")) return next();
    express.static(webDistDir, { index: false, fallthrough: true })(req, res, () => {
      if (!shouldServeIndex(req.path)) return next();
      res.sendFile("index.html", { root: webDistDir });
    });
  });
  return true;
}
