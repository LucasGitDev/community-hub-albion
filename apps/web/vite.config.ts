import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Dev: API do Nest em :3000 (pnpm --filter @albion-hub/server dev).
  server: { proxy: { "/api": "http://localhost:3000" } },
  resolve: {
    alias: { "@": new URL("./src", import.meta.url).pathname },
  },
});
