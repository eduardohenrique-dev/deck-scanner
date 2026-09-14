import { useEffect, useMemo, useState } from "react";
import { cardName } from "../../lib/format";
import type { Capture, Detection } from "../../lib/types";
import { Chip, Modal } from "../ui";

const STYLE: Record<string, { stroke: string; label: string; dash?: string }> = {
  identified: { stroke: "#3fcf8e", label: "identificada" },
  unidentified: { stroke: "#f2646f", label: "não identificada" },
  back: { stroke: "#6fa8ff", label: "verso" },
  token: { stroke: "#6fa8ff", label: "token" },
  edge: { stroke: "#99a2ad", label: "cortada pela borda", dash: "12 10" },
  noise: { stroke: "#6b7480", label: "ruído", dash: "4 8" },
  pending: { stroke: "#f2b544", label: "lendo" },
};

export default function PhotoOverlay({ capture, detections, focusId, onClose }: { capture: Capture | null; detections: Detection[]; focusId?: string; onClose: () => void }) {
  const [selected, setSelected] = useState<string | undefined>(focusId);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    setSelected(focusId);
    setSize(null);
  }, [capture?.id, focusId]);
  const mine = useMemo(() => detections.filter((d) => capture && d.capture_id === capture.id && d.bbox), [capture, detections]);
  const byId = new Map(detections.map((d) => [d.id, d]));
  const sel = mine.find((d) => d.id === selected);

  return (
    <Modal open={!!capture} onClose={onClose} title={capture ? `Foto ${capture.idx}` : ""} wide>
      {capture?.image_url && (
        <div className="space-y-3">
          <div className="relative">
            <img src={capture.image_url} className="w-full rounded-lg" alt="" onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
            {size && (
              <svg viewBox={`0 0 ${size.w} ${size.h}`} className="absolute inset-0 h-full w-full">
                {mine.map((d) => {
                  const merged = d.dup_of && byId.has(d.dup_of);
                  const st = STYLE[d.status] ?? STYLE.noise;
                  const pts = d.bbox!.quad.map(([x, y]) => `${x * size.w},${y * size.h}`).join(" ");
                  const isSel = d.id === selected;
                  return (
                    <polygon
                      key={d.id}
                      points={pts}
                      fill={isSel ? `${st.stroke}33` : "transparent"}
                      stroke={st.stroke}
                      strokeWidth={isSel ? 10 : merged ? 3 : 6}
                      strokeDasharray={st.dash}
                      opacity={merged ? 0.6 : 1}
                      className="cursor-pointer"
                      onClick={() => setSelected(d.id)}
                    />
                  );
                })}
              </svg>
            )}
          </div>
          <div className="flex flex-wrap gap-2 text-[12px]">
            {Object.entries(STYLE).map(([k, v]) => (
              <span key={k} className="inline-flex items-center gap-1 text-muted">
                <span className="inline-block size-2.5 rounded-sm" style={{ background: v.stroke }} /> {v.label}
              </span>
            ))}
          </div>
          {sel && (
            <div className="flex gap-3 rounded-lg bg-panel-2 p-3">
              <img src={sel.crop_url} className="h-28 w-20 rounded object-cover" alt="" />
              <div className="space-y-1 text-sm">
                <p className="font-medium">{sel.status === "identified" ? cardName(sel.card) : STYLE[sel.status]?.label}</p>
                {sel.dup_of && byId.has(sel.dup_of) && <Chip tone="info">mesma carta de outra foto — contada uma vez</Chip>}
                {sel.notes.map((n) => (
                  <p key={n} className="text-[13px] text-muted">
                    {n}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
