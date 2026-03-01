import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    port: 3000,
    allowedHosts: ["demo-kb.fongstudio.ru"],
    proxy: {
      "/api": {
        target: process.env.API_URL || "http://127.0.0.1:8080",
        changeOrigin: true,
      },
    },
  },
});
