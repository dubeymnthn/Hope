import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev-mode proxy: the Vite dev server serves the UI with HMR and forwards /api to the
// real Express server (npm run studio:server), so nothing here duplicates backend logic.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:4317", changeOrigin: true }
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
