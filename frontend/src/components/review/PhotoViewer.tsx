import { useEffect, useMemo, useState } from "react";
import { cardName } from "../../lib/format";
import type { Capture, Detection } from "../../lib/types";
import { CardImage } from "../mtg";
import { Modal, Tag } from "../ui";

const STYLE: Record<string, { stroke: string; label: string; dash?: string }> = {
  identified: { stroke: "#93b86b", label: "identificada" },
  unidentified: { stroke: "#d0604f", label: "não identificada" },
  back: { stroke: "#86a6c2", label: "verso" },
  token: { stroke: "#86a6c2", label: "token" },
  edge: { stroke: "#92806a", label: "cortada pela borda", dash: "12 10" },
  noise: { stroke: "#634d3a", label: "descartada", dash: "4 8" },
  pending: { stroke: "#e8c273", label: "lendo" },
};

/** A foto com o contorno de cada carta detectada (clique num contorno para ver o que foi lido ali). */
export default function PhotoViewer({ capture, detections, focusId, onClose }: { capture: Capture | null; detections: Detection[]; focusId?: string; onClose: () => void }) {
  const [selected, setSelected] = useState<string | undefined>(focusId);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    setSelected(focusId);
    setSize(null);
  }, [capture?.id, focusId]);
  const mine = useMemo(() => detections.filter((d) => capture && d.capture_id === capture.id && d.bbox), [capture, detections]);
  const byId = useMemo(() => new Map(detections.map((d) => [d.id, d])), [detections]);
  const sel = mine.find((d) => d.id === selected);

  return (
    <Modal open={!!capture} onClose={onClose} title={capture ? `Foto ${capture.idx}` : ""} width="xl">
      {capture?.image_url && (
        <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
          <div className="relative overflow-hidden rounded-[4px] bg-oak-950">
            <img src={capture.image_url} className="w-full" alt={`foto ${capture.idx}`} onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
            {size && (
              <svg viewBox={`0 0 ${size.w} ${size.h}`} className="absolute inset-0 h-full w-full">
                {mine.map((d) => {
                  const merged = d.dup_of && byId.has(d.dup_of);
                  const st = STYLE[d.status] ?? STYLE.noise;
                  const isSel = d.id === selected;
                  return (
                    <polygon
                      key={d.id}
                      points={d.bbox!.quad.map(([x, y]) => `${x * size.w},${y * size.h}`).join(" ")}
                      fill={isSel ? `${st.stroke}40` : "transparent"}
                      stroke={st.stroke}
                      strokeWidth={Math.max(3, size.w / (isSel ? 180 : 320))}
                      strokeDasharray={st.dash}
                      opacity={merged ? 0.55 : 1}
                      className="cursor-pointer"
                      onClick={() => setSelected(d.id)}
                    >
                      <title>{d.status === "identified" ? cardName(d.card) : st.label}</title>
                    </polygon>
                  );
                })}
              </svg>
            )}
          </div>
          <div className="space-y-3">
            <ul className="space-y-1 text-[13px] text-cream-faint">
              {Object.entries(STYLE).map(([k, v]) => (
                <li key={k} className="flex items-center gap-2">
                  <span className="inline-block h-2.5 w-5 rounded-[2px]" style={{ background: v.stroke }} /> {v.label}
                </li>
              ))}
            </ul>
            {sel ? (
              <div className="board-sunken space-y-2 p-3">
                {sel.crop_url && <CardImage src={sel.crop_url} className="w-32" alt="recorte" />}
                <p className="font-serif text-[17px] font-semibold text-cream">{sel.status === "identified" ? cardName(sel.card) : STYLE[sel.status]?.label}</p>
                {sel.dup_of && byId.has(sel.dup_of) && <Tag tone="info">mesma carta de outra foto — contada uma vez</Tag>}
                {sel.notes.map((n) => (
                  <p key={n} className="text-[13px] text-cream-faint">
                    {n}
                  </p>
                ))}
              </div>
            ) : (
              <p className="text-[14px] text-cream-faint">Toque num contorno para ver o que foi lido.</p>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
