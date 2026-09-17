import { Info, Search, Sparkles, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { api } from "../../lib/api";
import { useDebounced, usePersistentState } from "../../lib/hooks";
import type { SessionState, SetSummary } from "../../lib/types";
import { toastError } from "../../lib/toast";
import { Button, cx, Input, Spinner } from "../ui";

/** Valor (R$) a partir do qual a carta lida acende o aviso; 0 desliga. */
export const ALERT_KEY = "deckscanner:alert-brl";

const TIPS = [
  "Fundo liso e sem estampa, de qualquer cor.",
  "Carta paralela à câmera, inteira no quadro.",
  "Luz boa e sem reflexo em cima da carta.",
  "Uma carta por vez: tire a lida antes da próxima.",
];

/**
 * Ajustes da mesa antes de escanear: de qual coleção são as cartas (resolve reimpressão de arte igual)
 * e a partir de quanto avisar que a carta é cara.
 */
export default function ScanOptions({ state, onState }: { state: SessionState; onState: (s: SessionState) => void }) {
  const codes = (state.session.settings?.set_codes as string[] | undefined) ?? [];
  const [alert, setAlert] = usePersistentState(ALERT_KEY, 0);
  const [tips, setTips] = useState(false);
  const [busy, setBusy] = useState(false);

  async function pickSet(code: string | null) {
    setBusy(true);
    try {
      onState(await api.patchSession(state.session.id, { settings: { set_codes: code ? [code] : [] } }));
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2.5 rounded-[6px] border border-oak-700 bg-oak-950/40 p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
        <SetField code={codes[0] ?? null} busy={busy} onPick={pickSet} />
        <label className="flex items-center gap-2 text-[14px] text-cream-dim">
          <Sparkles className="size-4 text-brass-400" aria-hidden="true" />
          avisar acima de
          <span className="text-cream-faint">R$</span>
          <Input
            type="number"
            min={0}
            step={5}
            inputMode="numeric"
            value={alert || ""}
            placeholder="0"
            onChange={(e) => setAlert(Math.max(0, Number(e.target.value) || 0))}
            className="h-9 w-20 text-[14px]"
            aria-label="Avisar quando a carta passar deste valor em reais"
          />
        </label>
        <button onClick={() => setTips((t) => !t)} className="ml-auto flex items-center gap-1.5 text-[14px] text-brass-300 hover:text-brass-200">
          <Info className="size-4" /> {tips ? "esconder dicas" : "dicas de captura"}
        </button>
      </div>
      {tips && (
        <ul className="grid gap-1 text-[14px] text-cream-faint sm:grid-cols-2">
          {TIPS.map((t) => (
            <li key={t} className="flex gap-2">
              <span className="text-brass-500">•</span>
              {t}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Busca de coleção: com uma escolhida, a reimpressão de arte igual deixa de ser adivinhação. */
function SetField({ code, busy, onPick }: { code: string | null; busy: boolean; onPick: (code: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sets, setSets] = useState<SetSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [chosen, setChosen] = useState<SetSummary | null>(null);
  const query = useDebounced(text.trim(), 220);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!code) return setChosen(null);
    if (chosen?.code === code) return;
    api
      .sets(code, 8)
      .then((r) => setChosen(r.find((s) => s.code === code) ?? null))
      .catch(() => undefined);
  }, [code, chosen?.code]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    api
      .sets(query || undefined, 40)
      .then((r) => !cancelled && setSets(r))
      .catch(() => !cancelled && setSets([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [query, open]);

  return (
    <div className="relative flex items-center gap-2 text-[14px] text-cream-dim">
      <span>coleção destas cartas:</span>
      {code ? (
        <span className="flex items-center gap-1.5 rounded-[5px] border border-brass-700/70 bg-oak-800 px-2 py-1 text-cream">
          {chosen?.icon_svg_uri && <img src={chosen.icon_svg_uri} alt="" className="size-4 opacity-80 invert-[.85]" />}
          <strong className="font-semibold">{code.toUpperCase()}</strong>
          {chosen && <span className="hidden max-w-40 truncate text-cream-faint sm:inline">{chosen.name}</span>}
          <button onClick={() => onPick(null)} disabled={busy} aria-label="Aceitar qualquer coleção" className="text-cream-faint hover:text-cream">
            <X className="size-3.5" />
          </button>
        </span>
      ) : (
        <Button size="sm" variant="ghost" busy={busy} onClick={() => setOpen((o) => !o)}>
          qualquer coleção
        </Button>
      )}
      {open && !code && (
        <div className="board absolute top-full left-0 z-30 mt-1 w-[min(22rem,80vw)] p-2 shadow-[0_12px_24px_rgb(0_0_0/0.5)]">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-cream-faint" />
            <Input ref={input} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Nome ou sigla da coleção" className="h-9 pl-8 text-[14px]" />
            {loading && <Spinner className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2" />}
          </div>
          <ul id={listId} className="scrollbar-thin mt-1 max-h-64 overflow-y-auto">
            {sets.map((s) => (
              <li key={s.code}>
                <button
                  onClick={() => {
                    setChosen(s);
                    setOpen(false);
                    setText("");
                    onPick(s.code);
                  }}
                  className={cx("flex w-full items-center gap-2 rounded-[4px] px-2 py-1.5 text-left hover:bg-oak-700")}
                >
                  {s.icon_svg_uri && <img src={s.icon_svg_uri} alt="" className="size-4 shrink-0 opacity-80 invert-[.85]" />}
                  <span className="min-w-0 flex-1 truncate text-cream">{s.name}</span>
                  <span className="tabular shrink-0 text-[12px] text-cream-faint">
                    {s.code.toUpperCase()} · {s.released_at?.slice(0, 4)}
                  </span>
                </button>
              </li>
            ))}
            {!loading && !sets.length && <li className="px-2 py-1.5 text-cream-faint">Nenhuma coleção com esse nome.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
