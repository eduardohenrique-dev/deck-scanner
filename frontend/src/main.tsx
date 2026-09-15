import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

// acorda servidor e banco enquanto a interface carrega (depois de um tempo parados, eles dormem)
void fetch("/api/wake").catch(() => undefined);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
