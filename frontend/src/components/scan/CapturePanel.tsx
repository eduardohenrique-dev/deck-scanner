import { useCallback, useState } from "react";
import { usePersistentState } from "../../lib/hooks";
import type { SessionState } from "../../lib/types";
import { Board, Segmented, SectionTitle } from "../ui";
import AddCardSheet from "./AddCardSheet";
import LiveScanner from "./LiveScanner";
import PhotoUploader from "./PhotoUploader";
import ScanOptions from "./ScanOptions";
import VideoScanner from "./VideoScanner";

type Mode = "live" | "photo" | "video";

const touch = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

/** Mesa de captura: câmera ao vivo, fotos da mesa ou vídeo gravado — a mesma sessão aceita os três. */
export default function CapturePanel({ state, onState, onBusyChange }: { state: SessionState; onState: (s: SessionState) => void; onBusyChange?: (busy: boolean) => void }) {
  const [mode, setMode] = usePersistentState<Mode>("deckscanner:capture-mode", touch ? "live" : "photo");
  const [busy, setBusy] = useState(false);
  const onBusy = useCallback(
    (b: boolean) => {
      setBusy(b);
      onBusyChange?.(b);
    },
    [onBusyChange],
  );
  const sessionId = state.session.id;
  const [adding, setAdding] = useState(false);

  return (
    <section className="space-y-3">
      <SectionTitle
        aside={
          <Segmented<Mode>
            size="sm"
            value={mode}
            onChange={(m) => !busy && setMode(m)}
            options={[
              { value: "live", label: "Câmera", hint: "passe as cartas diante da câmera" },
              { value: "photo", label: "Fotos", hint: "várias cartas por foto" },
              { value: "video", label: "Vídeo", hint: "vídeo gravado folheando o deck" },
            ]}
            className={busy ? "pointer-events-none opacity-50" : undefined}
          />
        }
      >
        Mesa de captura
      </SectionTitle>
      <Board className="space-y-4 p-3 sm:p-5">
        {!busy && <ScanOptions state={state} onState={onState} />}
        {mode === "live" && <LiveScanner sessionId={sessionId} onState={onState} onBusy={onBusy} fx={state.value?.fx?.rate ?? null} onAddCard={() => setAdding(true)} />}
        {mode === "photo" && <PhotoUploader sessionId={sessionId} onState={onState} onBusy={onBusy} />}
        {mode === "video" && <VideoScanner sessionId={sessionId} onState={onState} onBusy={onBusy} />}
      </Board>
      {adding && <AddCardSheet state={state} onState={onState} onClose={() => setAdding(false)} />}
    </section>
  );
}
