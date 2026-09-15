#!/usr/bin/env node
// Aplica migrations usando o build do pacote (mesmo caminho que o server usa).
import { runMigrations } from "../dist/index.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL não definido (copie .env.example para .env na raiz)");
  process.exit(1);
}
await runMigrations(url);
console.log("migrations aplicadas");
