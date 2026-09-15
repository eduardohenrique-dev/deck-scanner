import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

// `npm run dev:mobile` expõe na rede local com HTTPS autoassinado:
// o navegador do celular só libera a câmera (getUserMedia) em contexto seguro.
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), ...(mode === "mobile" ? [basicSsl()] : [])],
  // o worker de visão importa o OpenCV.js (UMD grande); em ES module ele pode dividir chunks
  worker: { format: "es" },
  server: {
    port: 5190,
    host: mode === "mobile" ? true : "localhost",
    proxy: {
      "/api": { target: "http://127.0.0.1:8420", ws: true },
    },
  },
}));
