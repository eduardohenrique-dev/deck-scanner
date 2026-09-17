import type { FrameReport } from "../../vision/protocol";
import type { Tone } from "../ui";

const STROKE: Record<string, string> = {
  moving: "#e3a53e",
  steady: "#e8c273",
  captured: "#93b86b",
  edge: "#d0604f",
};

export type Guidance = { text: string; tone: Tone };

/** O que dizer para a pessoa agora, a partir do último frame analisado. */
export function guidance(r: FrameReport | null, running: boolean): Guidance {
  if (!running) return { text: "Enquadre a mesa com boa luz e um fundo liso", tone: "neutral" };
  if (!r) return { text: "Preparando…", tone: "neutral" };
  if (!r.quad) return { text: "Mostre uma carta por vez, no centro", tone: "neutral" };
  if (r.kind === "edge") return { text: "A carta está saindo do quadro", tone: "warn" };
  if (r.quality?.card !== undefined && r.quality.card < 0.5)
    return r.quality.size > 0.12
      ? { text: "Parece o verso da carta — vire para a frente", tone: "warn" }
      : { text: "Isso não parece uma carta — enquadre a carta inteira", tone: "warn" };
  if (r.quality && r.quality.size < 0.045) return { text: "Aproxime a carta da câmera", tone: "warn" };
  if (!r.stable) {
    if (r.transition === "fast") return { text: "Carta em movimento…", tone: "neutral" };
    if (r.quality && r.quality.sharpness < 22) return { text: "Imagem tremida — segure firme", tone: "warn" };
    return { text: "Segure firme…", tone: "neutral" };
  }
  if (r.emitted) return { text: "Lida. Tire a carta do quadro e mostre a próxima", tone: "ok" };
  if (r.quality && r.quality.glare > 0.03) return { text: "Reflexo na carta — incline um pouco", tone: "warn" };
  return { text: "Lendo a carta…", tone: "brass" };
}

/**
 * Contorno da carta detectada sobre o vídeo. O SVG usa "slice", o equivalente exato do
 * object-fit: cover do <video>, então as coordenadas do frame caem no lugar certo.
 */
export default function ScanOverlay({ report, width, height, showGuide }: { report: FrameReport | null; width: number; height: number; showGuide: boolean }) {
  const quad = report?.quad;
  // ao vivo (com guia) a carta está "anotada" quando já virou leitura; no vídeo, depois de 3 frames estáveis
  const captured = report?.emitted || (!showGuide && report?.stable && report.groupFrames >= 3);
  const state = !quad ? null : report!.kind === "edge" ? "edge" : captured ? "captured" : !report!.stable ? "moving" : "steady";
  const stroke = Math.max(3, width / 240);
  const gh = Math.min(height * 0.74, (width * 0.78 * 88) / 63);
  const gw = (gh * 63) / 88;
  const r = gw * 0.045;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid slice" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
      {showGuide && !quad && (
        <rect x={(width - gw) / 2} y={(height - gh) / 2} width={gw} height={gh} rx={r} fill="none" stroke="#efe3c8" strokeOpacity={0.45} strokeWidth={stroke * 0.7} strokeDasharray={`${stroke * 5} ${stroke * 4}`} />
      )}
      {quad && state && (
        <polygon
          points={quad.map(([x, y]) => `${x * width},${y * height}`).join(" ")}
          fill={state === "captured" ? "rgb(147 184 107 / 0.14)" : "none"}
          stroke={STROKE[state]}
          strokeWidth={state === "captured" ? stroke * 1.4 : stroke}
          strokeLinejoin="round"
          style={{ transition: "stroke 160ms, stroke-width 160ms" }}
        />
      )}
    </svg>
  );
}
