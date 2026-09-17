import { CopyCheck, CopyX, Eye, HelpCircle, Layers, SearchCheck, Sparkles } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { api } from "../../lib/api";
import { brl, cardName, positionLabel } from "../../lib/format";
import { toast, toastError } from "../../lib/toast";
import type { Capture, Detection, SessionState } from "../../lib/types";
import CardSearch from "../cards/CardSearch";
import { ALERT_KEY } from "../scan/ScanOptions";
import { ArtThumb, CardImage } from "../mtg";
import { Button, SectionTitle, Tag } from "../ui";

/** Preço em reais da impressão detectada, com o dólar do dia da sessão. */
function cardBrl(d: Detection, fx: number): number | null {
  const p = d.card?.prices;
  if (!p) return null;
  const foil = d.finish && d.finish !== "nonfoil";
  const usd = Number((foil ? p.usd_foil || p.usd_etched : p.usd) || p.usd || 0);
  return usd > 0 ? usd * fx : null;
}

const NOTE_COPY = "mesma carta do grupo anterior — contada como outra cópia";
const NOTE_LONG = "exibição longa: podem ser 2 cópias seguidas — confira a quantidade";
const NOTE_SPLIT = "segunda cópia inferida: a pose da carta mudou no meio de uma exibição longa — confira";

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
        /* armazenamento indisponível: vale só nesta visita */
      }
      return next;
    });
  return [set, dismiss] as const;
}

/** "Confira primeiro": o que a leitura não resolveu sozinha, com a ação certa ao lado de cada caso. */
export default function AttentionList({ state, apply, onShowCapture }: { state: SessionState; apply: (s: SessionState) => void; onShowCapture: (capture: Capture, detectionId?: string) => void }) {
  const { detections, captures, session } = state;
  const [dismissed, dismiss] = useDismissed(session.id);
  const byId = useMemo(() => new Map(detections.map((d) => [d.id, d])), [detections]);
  const capById = useMemo(() => new Map(captures.map((c) => [c.id, c])), [captures]);
  const active = useMemo(() => detections.filter((d) => !(d.dup_of && byId.has(d.dup_of))), [detections, byId]);

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
  const repeats = active.filter((d) => d.status === "identified" && !dismissed.has(d.id) && d.notes.some((n) => n === NOTE_COPY || n === NOTE_LONG || n === NOTE_SPLIT));
  const impossible = active.filter((d) => d.print_check && !dismissed.has(`print:${d.id}`));
  // cartas caras: aceitas na hora, mas pedem um olhar antes de virar deck ou coleção
  const alertBrl = Number(localStorage.getItem(ALERT_KEY) ?? 0) || 0;
  const fx = state.value?.fx?.rate ?? 0;
  const valuable = alertBrl && fx
    ? active.filter((d) => d.status === "identified" && !dismissed.has(`valor:${d.id}`) && (cardBrl(d, fx) ?? 0) >= alertBrl)
    : [];

  const total = unidentified.length + pairs.length + repeats.length + impossible.length + valuable.length;
  if (!total) return null;

  async function run(fn: () => Promise<SessionState>, done?: string) {
    try {
      apply(await fn());
      if (done) toast(done);
    } catch (e) {
      toastError(e);
    }
  }

  const previousSame = (d: Detection) =>
    active.filter((x) => x.seq < d.seq && x.status === "identified" && x.oracle_id === d.oracle_id && x.capture_id === d.capture_id).sort((a, b) => b.seq - a.seq)[0];

  return (
    <section className="space-y-3">
      <SectionTitle aside={<Tag tone="warn">{total}</Tag>}>
        <span className="inline-flex items-center gap-2">
          <SearchCheck className="size-4" /> confira primeiro
        </span>
      </SectionTitle>
      <ul className="space-y-3">
        {valuable.map((d) => {
          const cap = capById.get(d.capture_id);
          return (
            <Case key={`valor:${d.id}`} image={d.crop_url} title={<><Sparkles className="size-4 text-brass-300" /> Carta valiosa: confira a edição</>}>
              <p className="text-[15px] text-cream">
                {cardName(d.card)} <span className="text-cream-faint">· {d.card?.set_code?.toUpperCase()}</span>
              </p>
              <p className="text-[14px] text-brass-200">{brl(cardBrl(d, fx) ?? 0)}</p>
              <div className="flex flex-wrap gap-1.5">
                <Button size="xs" variant="ghost" onClick={() => dismiss(`valor:${d.id}`)}>
                  está certa
                </Button>
                {cap?.image_url && (
                  <Button size="xs" variant="ghost" onClick={() => onShowCapture(cap, d.id)}>
                    ver na foto
                  </Button>
                )}
              </div>
              <CardSearch onPick={(c) => run(() => api.identify(d.id, c.id), `Trocada para ${cardName(c)}`)} placeholder="Trocar por outra carta ou edição…" />
            </Case>
          );
        })}
        {unidentified.map((d) => {
          const cap = capById.get(d.capture_id);
          return (
            <Case key={d.id} image={d.crop_url} title={<><HelpCircle className="size-4 text-wine-300" /> Carta não identificada</>}>
              <p className="text-[14px] text-cream-faint">
                {positionLabel(d, cap?.idx, cap?.type !== "image")}
                {cap?.image_url && (
                  <button onClick={() => onShowCapture(cap, d.id)} className="ml-2 inline-flex items-center gap-1 text-brass-300 hover:underline">
                    <Eye className="size-3.5" /> ver na foto
                  </button>
                )}
              </p>
              {d.notes.filter((n) => !n.includes("multimodal")).slice(0, 2).map((n) => (
                <p key={n} className="text-[13px] text-cream-faint">
                  {n}
                </p>
              ))}
              {d.candidates.length > 0 && (
                <div>
                  <p className="mb-1 text-[13px] text-cream-faint">parece com</p>
                  <div className="flex flex-wrap gap-1.5">
                    {d.candidates.slice(0, 4).map((c) => (
                      <button
                        key={c.card_ref_id}
                        onClick={() => run(() => api.identify(d.id, c.card_ref_id), `Identificada como ${cardName(c.card)}`)}
                        className="flex items-center gap-2 rounded-[4px] border border-oak-600 bg-oak-900 py-1 pr-2 pl-1 text-[14px] text-cream-dim hover:border-brass-500 hover:text-cream"
                      >
                        <ArtThumb card={c.card} size={32} />
                        {cardName(c.card)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <CardSearch onPick={(c) => run(() => api.identify(d.id, c.id), `Identificada como ${cardName(c)}`)} placeholder="Qual carta é? Busque pelo nome…" />
              <div className="flex flex-wrap gap-1.5">
                <Button size="xs" variant="ghost" onClick={() => run(() => api.setStatus(d.id, "noise"), "Descartada")}>
                  não é carta
                </Button>
                <Button size="xs" variant="ghost" onClick={() => run(() => api.setStatus(d.id, "back"))}>
                  é o verso
                </Button>
                <Button size="xs" variant="ghost" onClick={() => run(() => api.setStatus(d.id, "token"))}>
                  é token
                </Button>
              </div>
            </Case>
          );
        })}

        {pairs.map(([a, b, reasons]) => (
          <li key={a.id + b.id} className="board p-3">
            <p className="mb-2 flex items-center gap-2 font-serif text-[17px] font-semibold text-cream">
              <Layers className="size-4 text-amber-300" /> A mesma carta em duas fotos?
            </p>
            <div className="flex flex-wrap items-start gap-3">
              {[a, b].map((d) => {
                const cap = capById.get(d.capture_id);
                return (
                  <figure key={d.id} className="w-[112px]">
                    {d.crop_url && <CardImage src={d.crop_url} alt="recorte" />}
                    <figcaption className="mt-1 text-[13px] leading-tight text-cream-faint">
                      {cardName(d.card)}
                      {cap?.image_url && (
                        <button onClick={() => onShowCapture(cap, d.id)} className="block text-brass-300 hover:underline">
                          foto {cap.idx}
                        </button>
                      )}
                    </figcaption>
                  </figure>
                );
              })}
              <div className="min-w-[180px] flex-1 space-y-2">
                <ul className="list-disc space-y-0.5 pl-4 text-[14px] text-cream-dim">
                  {reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                <p className="text-[13px] text-cream-faint">Na dúvida as duas são contadas — o sistema nunca apaga uma carta sozinho.</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="brass" icon={<CopyCheck className="size-4" />} onClick={() => run(() => api.duplicate(a.id, b.id, true), "Contada uma vez")}>
                    mesma carta
                  </Button>
                  <Button size="sm" icon={<CopyX className="size-4" />} onClick={() => run(() => api.duplicate(a.id, b.id, false), "Contadas as duas")}>
                    cartas diferentes
                  </Button>
                </div>
              </div>
            </div>
          </li>
        ))}

        {repeats.map((d) => {
          const prev = previousSame(d);
          const isLong = d.notes.includes(NOTE_LONG);
          const isSplit = d.notes.includes(NOTE_SPLIT);
          const entry = state.entries.find((e) => e.detection_ids.includes(d.id) || e.card_ref_id === d.card_ref_id);
          return (
            <Case key={d.id} image={d.crop_url} secondImage={prev && !isLong ? prev.crop_url : undefined} title={cardName(d.card)}>
              <p className="text-[14px] text-cream-dim">
                {isSplit ? "Parece que duas cópias iguais passaram seguidas (a posição da carta mudou no meio)." : isLong ? "Esta carta ficou na câmera o dobro do normal — podem ser duas cópias." : "A mesma carta apareceu duas vezes seguidas e foi contada duas vezes."}
              </p>
              <div className="flex flex-wrap gap-2">
                {isLong && entry ? (
                  <>
                    <Button size="sm" variant="brass" onClick={() => run(() => api.patchEntry<SessionState>(entry.id, { quantity_override: entry.quantity + 1 })).then(() => dismiss(d.id))}>
                      eram 2 (+1)
                    </Button>
                    <Button size="sm" onClick={() => dismiss(d.id)}>era uma só</Button>
                  </>
                ) : isSplit ? (
                  <>
                    <Button size="sm" variant="brass" onClick={() => dismiss(d.id)}>eram 2 mesmo</Button>
                    <Button size="sm" onClick={() => run(() => api.setStatus(d.id, "noise"))}>era uma só</Button>
                  </>
                ) : prev ? (
                  <>
                    <Button size="sm" variant="brass" onClick={() => run(() => api.duplicate(d.id, prev.id, true), "Contada uma vez")}>
                      é a mesma carta
                    </Button>
                    <Button size="sm" onClick={() => run(() => api.duplicate(d.id, prev.id, false)).then(() => dismiss(d.id))}>
                      são duas cópias
                    </Button>
                  </>
                ) : (
                  <Button size="sm" onClick={() => dismiss(d.id)}>ok</Button>
                )}
              </div>
            </Case>
          );
        })}

        {impossible.map((d) => (
          <Case key={`print-${d.id}`} image={d.crop_url} title={<>Impressão que não existe no registro · {cardName(d.card)}</>}>
            <p className="text-[14px] text-cream-dim">{d.print_check!.message}</p>
            <p className="text-[13px] text-cream-faint">
              Pode ser leitura errada da linha de coleção ou uma carta falsificada. Vale olhar a carta de perto.
              {d.raw.set && ` Lido: ${d.raw.set.toUpperCase()} ${d.raw.number ?? ""} ${d.raw.language ?? ""}.`}
            </p>
            <Button size="sm" variant="ghost" onClick={() => dismiss(`print:${d.id}`)}>
              conferi, está certo
            </Button>
          </Case>
        ))}
      </ul>
    </section>
  );
}

function Case({ image, secondImage, title, children }: { image: string | null; secondImage?: string | null; title: ReactNode; children: ReactNode }) {
  return (
    <li className="board flex flex-col gap-3 p-3 sm:flex-row">
      <div className="flex shrink-0 gap-2">
        {secondImage && <CardImage src={secondImage} className="w-[88px]" alt="exibição anterior" />}
        {image ? <CardImage src={image} className="w-[108px]" alt="recorte" /> : null}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="flex items-center gap-2 font-serif text-[17px] font-semibold text-cream">{title}</p>
        {children}
      </div>
    </li>
  );
}
