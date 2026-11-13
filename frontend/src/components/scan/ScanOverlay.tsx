import { LIVE_OPTIONS } from "../../vision/grouper";
import type { FrameReport } from "../../vision/protocol";
import type { Tone } from "../ui";
import type { Flash } from "./useScanner";

/** A moldura acende junto com o clarão da borda do visor (mesmas cores do .edge-flash). */
const FLASH: Record<Flash["tone"], { stroke: string; fill: string }> = {
  ok: { stroke: "#4cc38a", fill: "rgb(76 195 138 / 0.14)" },
  gold: { stroke: "#e8c15a", fill: "rgb(232 193 90 / 0.14)" },
};

const NOT_A_CARD = LIVE_OPTIONS.minCardness ?? 0;

export type Guidance = { text: string; tone: Tone };

/** O que dizer para a pessoa agora, a partir do último frame analisado. */
export function guidance(r: FrameReport | null, running: boolean, phone = false): Guidance {
  if (!running) return { text: phone ? "Deixe a carta do tamanho da moldura, com boa luz" : "Enquadre a mesa com boa luz e um fundo liso", tone: "neutral" };
  if (!r) return { text: "Preparando…", tone: "neutral" };
  if (!r.quad) return { text: "Mostre uma carta por vez, no centro", tone: "neutral" };
  if (r.kind === "edge") return { text: "A carta está saindo do quadro", tone: "warn" };
  if (r.quality?.card !== undefined && r.quality.card < NOT_A_CARD)
    return r.quality.size > 0.12
      ? { text: "Parece o verso da carta — vire para a frente", tone: "warn" }
      : { text: "Isso não parece uma carta — enquadre a carta inteira", tone: "warn" };
  if (r.quality && r.quality.size < 0.045) return { text: "Aproxime a carta da câmera", tone: "warn" };
  if (!r.stable) {
    if (r.transition === "fast") return { text: "Carta em movimento…", tone: "neutral" };
    if (phone && r.quality && r.quality.sharpness < 22 && r.quality.size > 0.3) return { text: "Perto demais para focar — afaste um pouco", tone: "warn" };
    if (r.quality && r.quality.sharpness < 22) return { text: "Imagem tremida — segure firme", tone: "warn" };
    return { text: "Segure firme…", tone: "neutral" };
  }
  if (r.rejected) return { text: "Não reconheci — aproxime a carta ou adicione pelo nome", tone: "warn" };
  if (r.emitted) return { text: "Lida. Tire a carta do quadro e mostre a próxima", tone: "ok" };
  if (r.quality && r.quality.glare > 0.03) return { text: "Reflexo na carta — incline um pouco", tone: "warn" };
  return { text: "Lendo a carta…", tone: "arcane" };
}

/** Carta de 63 × 88 com folga em volta: em cima fica o contador, embaixo o aviso do visor. */
const CARD_W = 63;
const CARD_H = 88;
const MARGIN_X = 7;
const MARGIN_TOP = 12;
const MARGIN_BOTTOM = 23; // o aviso do visor é mais alto que o contador
const PHONE_BOX = `-26 -6 ${CARD_W + 52} ${CARD_H + 12}`;

/**
 * Moldura fixa com formato de carta no centro do visor: mostra onde colocar a carta e pisca verde
 * (ou dourada, carta valiosa) quando ela é lida. O contorno detectado não aparece: ele tremia e mudava
 * de forma a cada frame. Com "meet" a moldura cabe inteira no espaço visível, qualquer que seja o
 * formato do visor (tela cheia do celular, 4:3 no computador, visor encolhido pela fita de leituras).
 */
export default function ScanOverlay({ flash, variant = "desk" }: { flash: Flash["tone"] | null; variant?: "desk" | "phone" }) {
  const lit = flash ? FLASH[flash] : null;
  // no celular a moldura é pequena de propósito (55% da largura): a pessoa segura a carta a um palmo,
  // onde a lente foca; colada na câmera a imagem sai borrada
  const box = variant === "phone" ? PHONE_BOX : `${-MARGIN_X} ${-MARGIN_TOP} ${CARD_W + 2 * MARGIN_X} ${CARD_H + MARGIN_TOP + MARGIN_BOTTOM}`;
  return (
    <svg
      viewBox={box}
      preserveAspectRatio="xMidYMid meet"
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      <rect
        width={CARD_W}
        height={CARD_H}
        rx={CARD_W * 0.045}
        fill={lit ? lit.fill : "none"}
        stroke={lit ? lit.stroke : "#e9e6dc"}
        strokeOpacity={lit ? 1 : 0.7}
        strokeWidth={lit ? 5 : 2.5}
        strokeDasharray={lit ? undefined : "14 11"}
        vectorEffect="non-scaling-stroke"
        style={{ transition: "stroke 160ms, stroke-width 160ms, fill 160ms" }}
      />
    </svg>
  );
}
