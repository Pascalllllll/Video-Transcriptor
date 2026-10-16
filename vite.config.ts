import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" so the same build loads from file:// in the desktop app and from any web host.
export default defineConfig({
  base: "./",
  plugins: [react()],
  worker: { format: "es" },
  build: { target: "es2022", chunkSizeWarningLimit: 2000 },
  optimizeDeps: { exclude: ["@huggingface/transformers"] },
});
