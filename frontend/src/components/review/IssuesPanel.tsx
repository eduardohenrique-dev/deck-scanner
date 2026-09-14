import { CopyCheck, CopyX, Eye, HelpCircle, Layers, ScanSearch } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "../../lib/api";
import { cardName, positionLabel } from "../../lib/format";
import type { Capture, Detection, SessionState } from "../../lib/types";
import { Button, Chip } from "../ui";
import CardSearch from "./CardSearch";

const NOTE_COPY = "mesma carta do grupo anterior — contada como outra cópia";
const NOTE_LONG = "exibição longa: podem ser 2 cópias seguidas — confira a quantidade";
const NOTE_SPLIT = "segunda cópia inferida: a pose da carta mudou no meio de uma exibição longa — confira";

type Props = {
  state: SessionState;
  apply: (s: SessionState) => void;
  onShowCapture: (capture: Capture, detectionId?: string) => void;
};

function useDismissed(sessionId: string) {
  const key = `deckscanner:dismissed:${sessionId}`;
  const [set, setSet] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(key) ?? "[]"));
    } catch {
      return new Set();
    }
  });
  const dismiss = (id: string) =>
    setSet((prev) => {
      const next = new Set(prev).add(id);
      try {
        localStorage.setItem(key, JSON.stringify([...next]));
      } catch {
        /* armazenamento indisponível */
      }
      return next;
    });
  return [set, dismiss] as const;
}

export default function IssuesPanel({ state, apply, onShowCapture }: Props) {
  const { detections, captures, session } = state;
  const [dismissed, dismiss] = useDismissed(session.id);
  const byId = useMemo(() => new Map(detections.map((d) => [d.id, d])), [detections]);
  const capById = useMemo(() => new Map(captures.map((c) => [c.id, c])), [captures]);
  const active = detections.filter((d) => !(d.dup_of && byId.has(d.dup_of)));

  const unidentified = active.filter((d) => d.status === "unidentified" && !dismissed.has(d.id));
  const pairs = useMemo(() => {
    const seen = new Set<string>();
    const out: [Detection, Detection, string[]][] = [];
    for (const d of active) {
      for (const p of d.dup_candidates?.possible ?? []) {
        const other = byId.get(p.id);
        const key = [d.id, p.id].sort().join(":");
        if (!other || seen.has(key)) continue;
        seen.add(key);
        out.push([d, other, p.reasons]);
      }
    }
    return out;
  }, [active, byId]);
  const repeats = active.filter(
    (d) => d.status === "identified" && !dismissed.has(d.id) && d.notes.some((n) => n === NOTE_COPY || n === NOTE_LONG || n === NOTE_SPLIT),
  );

  if (!unidentified.length && !pairs.length && !repeats.length) return null;

  async function run(fn: () => Promise<SessionState>) {
    apply(await fn());
  }

  function previousSame(d: Detection): Detection | undefined {
    return active
      .filter((x) => x.seq < d.seq && x.status === "identified" && x.oracle_id === d.oracle_id && x.capture_id === d.capture_id)
      .sort((a, b) => b.seq - a.seq)[0];
  }

  return (
    <section className="space-y-3 rounded-2xl border border-warn/40 bg-warn/[0.04] p-4">
      <h2 className="flex items-center gap-2 font-semibold">
        <ScanSearch className="size-5 text-warn" />
        Confira primeiro
        <Chip tone="warn">{unidentified.length + pairs.length + repeats.length}</Chip>
      </h2>

      {unidentified.map((d) => {
        const cap = capById.get(d.capture_id);
        return (
          <div key={d.id} className="animate-pop flex flex-col gap-3 rounded-xl border border-line bg-panel p-3 sm:flex-row">
            <img src={d.crop_url} className="h-40 w-[114px] shrink-0 rounded-md bg-panel-2 object-cover" alt="carta não identificada" />
            <div className="min-w-0 flex-1 space-y-2">
              <div>
                <p className="flex items-center gap-1.5 font-medium">
                  <HelpCircle className="size-4 text-bad" />
                  Não identificada
                </p>
                <p className="text-[13px] text-muted">
                  {positionLabel(d, cap?.idx, cap?.type === "video")}
                  {cap?.image_url && (
                    <button onClick={() => onShowCapture(cap, d.id)} className="ml-2 inline-flex items-center gap-1 text-accent hover:underline">
                      <Eye className="size-3.5" /> ver na foto
                    </button>
                  )}
                </p>
                {d.notes.filter((n) => !n.includes("multimodal")).map((n) => (
                  <p key={n} className="text-[12px] text-faint">
                    {n}
                  </p>
                ))}
              </div>
              {d.candidates.length > 0 && (
                <div>
                  <p className="mb-1 text-[12px] text-muted">Parece com:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {d.candidates.slice(0, 4).map((c) => (
                      <button
                        key={c.card_ref_id}
                        onClick={() => run(() => api.identify(d.id, c.card_ref_id))}
                        className="flex items-center gap-1.5 rounded-md border border-line bg-panel-2 py-1 pl-1 pr-2 text-[12px] hover:border-accent"
                      >
                        {c.card.image_small && <img src={c.card.image_small} className="h-8 w-6 rounded-sm object-cover" alt="" />}
                        {cardName(c.card)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <CardSearch onPick={(c) => run(() => api.identify(d.id, c.id))} placeholder="Identificar: buscar a carta certa…" />
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => run(() => api.setStatus(d.id, "noise"))}>
                  Não é carta
                </Button>
                <Button size="sm" variant="ghost" onClick={() => run(() => api.setStatus(d.id, "back"))}>
                  É o verso
                </Button>
                <Button size="sm" variant="ghost" onClick={() => run(() => api.setStatus(d.id, "token"))}>
                  É token
                </Button>
              </div>
            </div>
          </div>
        );
      })}

      {pairs.map(([a, b, reasons]) => (
        <div key={a.id + b.id} className="animate-pop rounded-xl border border-line bg-panel p-3">
          <p className="mb-2 flex items-center gap-1.5 font-medium">
            <Layers className="size-4 text-warn" />
            Possível duplicata: a mesma carta física em duas fotos?
          </p>
          <div className="flex flex-wrap items-start gap-3">
            {[a, b].map((d) => {
              const cap = capById.get(d.capture_id);
              return (
                <figure key={d.id} className="w-[124px]">
                  <img src={d.crop_url} className="h-[172px] w-[124px] rounded-md bg-panel-2 object-cover" alt="" />
                  <figcaption className="mt-1 text-[12px] leading-tight text-muted">
                    {cardName(d.card)}
                    <br />
                    {cap?.image_url ? (
                      <button onClick={() => onShowCapture(cap, d.id)} className="text-accent hover:underline">
                        foto {cap.idx}
                      </button>
                    ) : null}
                  </figcaption>
                </figure>
              );
            })}
            <div className="min-w-[180px] flex-1 space-y-2">
              <ul className="list-inside list-disc text-[13px] text-muted">
                {reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <p className="text-[12px] text-faint">Na dúvida o sistema conta as duas — nunca apaga uma carta sozinho.</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="primary" icon={<CopyCheck className="size-4" />} onClick={() => run(() => api.duplicate(a.id, b.id, true))}>
                  Mesma carta
                </Button>
                <Button size="sm" icon={<CopyX className="size-4" />} onClick={() => run(() => api.duplicate(a.id, b.id, false))}>
                  Cartas diferentes
                </Button>
              </div>
            </div>
          </div>
        </div>
      ))}

      {repeats.map((d) => {
        const prev = previousSame(d);
        const isLong = d.notes.includes(NOTE_LONG);
        const isSplit = d.notes.includes(NOTE_SPLIT);
        const entry = state.entries.find((e) => e.detection_ids.includes(d.id) || e.card_ref_id === d.card_ref_id);
        return (
          <div key={d.id} className="animate-pop flex flex-wrap items-start gap-3 rounded-xl border border-line bg-panel p-3">
            {prev && !isLong && <img src={prev.crop_url} className="h-28 w-20 rounded-md object-cover" alt="exibição anterior" />}
            <img src={d.crop_url} className="h-28 w-20 rounded-md object-cover" alt="exibição" />
            <div className="min-w-[200px] flex-1 space-y-2">
              <p className="font-medium">{cardName(d.card)}</p>
              <p className="text-[13px] text-muted">
                {isSplit ? NOTE_SPLIT : isLong ? NOTE_LONG : "A mesma carta apareceu em duas exibições seguidas e foi contada duas vezes."}
              </p>
              <div className="flex flex-wrap gap-2">
                {isLong && entry ? (
                  <>
                    <Button size="sm" variant="primary" onClick={() => run(() => api.patchEntry(entry.id, { quantity_override: entry.quantity + 1 })).then(() => dismiss(d.id))}>
                      Eram 2 cópias (+1)
                    </Button>
                    <Button size="sm" onClick={() => dismiss(d.id)}>
                      Era uma só
                    </Button>
                  </>
                ) : isSplit ? (
                  <>
                    <Button size="sm" variant="primary" onClick={() => dismiss(d.id)}>
                      Eram 2 mesmo
                    </Button>
                    <Button size="sm" onClick={() => run(() => api.setStatus(d.id, "noise"))}>
                      Era uma só
                    </Button>
                  </>
                ) : prev ? (
                  <>
                    <Button size="sm" variant="primary" onClick={() => run(() => api.duplicate(d.id, prev.id, true))}>
                      É a mesma carta
                    </Button>
                    <Button size="sm" onClick={() => run(() => api.duplicate(d.id, prev.id, false)).then(() => dismiss(d.id))}>
                      São cópias diferentes
                    </Button>
                  </>
                ) : (
                  <Button size="sm" onClick={() => dismiss(d.id)}>
                    Ok
                  </Button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </section>
  );
}
