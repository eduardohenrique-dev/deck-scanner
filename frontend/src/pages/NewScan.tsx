import { ArrowRight, Check } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Chest, Lens, Scales } from "../components/icons";
import { IdentityPips } from "../components/mtg";
import { Board, Button, cx, Field, Input, PageTitle, Select, Skeleton } from "../components/ui";
import { api } from "../lib/api";
import { LANGUAGE_NAME } from "../lib/format";
import { useResource } from "../lib/hooks";
import { Link, navigate, useLocation } from "../lib/router";
import { toastError } from "../lib/toast";
import type { FormatRule } from "../lib/types";

type Purpose = "build" | "check" | "collection";

const PURPOSES: { id: Purpose; title: string; text: string; icon: ReactNode }[] = [
  { id: "build", title: "Montar lista", text: "Escanear um deck e sair com a lista pronta, validada no formato.", icon: <Lens size={26} /> },
  { id: "check", title: "Conferir deck", text: "Escanear um deck já salvo e ver o que falta, sobra ou foi trocado.", icon: <Scales size={26} /> },
  { id: "collection", title: "Guardar na coleção", text: "Registrar cartas soltas, de pasta ou de caixa, sem formato.", icon: <Chest size={26} /> },
];

const LANGS = ["pt", "en", "es", "ja", "de", "fr", "it"];

export default function NewScan() {
  const { query } = useLocation();
  const initial: Purpose = query.get("finalidade") === "conferir" ? "check" : query.get("finalidade") === "colecao" ? "collection" : "build";
  const [purpose, setPurpose] = useState<Purpose>(initial);
  const games = useResource(() => api.games(), []);
  const decks = useResource(() => api.decks(), []);
  const [formatId, setFormatId] = useState("commander");
  const [deckId, setDeckId] = useState(query.get("deck") ?? "");
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("pt");
  const [busy, setBusy] = useState(false);

  const mtg = games.data?.find((g) => g.id === "mtg");
  const formats = useMemo(() => (mtg?.formats ?? []).filter((f) => f.id !== "collection"), [mtg]);
  const groups = useMemo(() => {
    const out = new Map<string, FormatRule[]>();
    for (const f of formats) out.set(f.group ?? "Outros", [...(out.get(f.group ?? "Outros") ?? []), f]);
    return [...out.entries()];
  }, [formats]);
  const targetDeck = decks.data?.find((d) => d.id === deckId);
  const format = formats.find((f) => f.id === formatId);

  useEffect(() => {
    setPurpose(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.get("finalidade")]);

  useEffect(() => {
    if (purpose === "check" && !deckId && decks.data?.length) setDeckId(decks.data[0].id);
  }, [purpose, deckId, decks.data]);

  async function start() {
    setBusy(true);
    try {
      const settings: Record<string, unknown> = { default_language: language };
      let session;
      if (purpose === "check") {
        session = await api.createSession({ game_id: "mtg", format_id: targetDeck!.format_id, mode: "video", purpose: "check", target_deck_id: targetDeck!.id, name: name || `Conferência · ${targetDeck!.name}`, settings });
      } else if (purpose === "collection") {
        session = await api.createSession({ game_id: "mtg", format_id: "collection", mode: "photo", purpose: "build", name: name || undefined, settings: { ...settings, intent: "collection" } });
      } else {
        session = await api.createSession({ game_id: "mtg", format_id: formatId, mode: "video", purpose: "build", name: name || undefined, settings });
      }
      navigate(`/s/${session.id}`);
    } catch (e) {
      toastError(e);
      setBusy(false);
    }
  }

  const canStart = purpose !== "check" || !!targetDeck;

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <PageTitle title="O que vamos escanear?">
        Escolha o objetivo. A captura (câmera ao vivo, fotos ou vídeo) você decide na próxima tela e pode misturar à vontade.
      </PageTitle>

      <div role="radiogroup" aria-label="Finalidade" className="grid gap-3 sm:grid-cols-3">
        {PURPOSES.map((p) => {
          const active = purpose === p.id;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setPurpose(p.id)}
              className={cx(
                "glass relative grid grid-cols-[auto_1fr] items-start gap-x-4 gap-y-1 px-4 py-4 text-left transition-[transform,box-shadow] duration-500 ease-spring active:scale-[0.98] active:duration-100 sm:grid-cols-1 sm:gap-y-2 sm:px-5 sm:py-5",
                active ? "shadow-[inset_0_0_0_1.5px_var(--color-brass-400),0_12px_32px_-14px_rgb(216_166_76/0.45)]" : "hover:-translate-y-0.5",
              )}
            >
              <span className={cx("row-span-2 grid size-11 place-items-center rounded-md sm:row-span-1", active ? "bg-brass-300/15 text-brass-200" : "bg-cream/6 text-cream-dim")}>{p.icon}</span>
              <span className={cx("text-headline font-semibold", active ? "text-brass-100" : "text-cream")}>{p.title}</span>
              <span className="text-subhead text-cream-dim">{p.text}</span>
              {active && (
                <span className="absolute top-4 right-4 grid size-6 place-items-center rounded-full bg-brass-400 text-ink-900 animate-pop" aria-hidden="true">
                  <Check className="size-4 [--icon-stroke:2.4]" />
                </span>
              )}
            </button>
          );
        })}
      </div>

      <Board className="space-y-6 p-5 sm:p-6">
        {purpose === "check" && (
          <div>
            {decks.loading ? (
              <Skeleton className="h-11" />
            ) : decks.data?.length ? (
              <Field label="Deck a conferir" hint="o formato vem do deck">
                {(id) => (
                  <Select id={id} value={deckId} onChange={(e) => setDeckId(e.target.value)}>
                    {decks.data!.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} · {d.card_count} cartas
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : (
              <p className="text-subhead text-cream-dim">
                Você ainda não tem decks salvos. <Link to="/escanear" className="text-brass-300 underline" onClick={() => setPurpose("build")}>Monte a lista primeiro</Link> ou{" "}
                <Link to="/decks?novo=1" className="text-brass-300 underline">importe um deck</Link>.
              </p>
            )}
            {targetDeck && (
              <p className="mt-2 flex items-center gap-2 text-footnote text-cream-faint">
                <IdentityPips colors={targetDeck.identity} size={15} />
                {targetDeck.format_name ?? targetDeck.format_id}
                {targetDeck.commanders?.length ? ` · ${targetDeck.commanders.join(" & ")}` : ""}
              </p>
            )}
          </div>
        )}

        {purpose === "build" && (
          <Field label="Formato">
            {(id) =>
              games.loading ? (
                <Skeleton className="h-11" />
              ) : (
                <>
                  <Select id={id} value={formatId} onChange={(e) => setFormatId(e.target.value)} aria-describedby={`${id}-desc`}>
                    {groups.map(([group, list]) => (
                      <optgroup key={group} label={group}>
                        {list.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </Select>
                  {format?.description && (
                    <p id={`${id}-desc`} className="mt-1.5 text-footnote text-cream-faint">
                      {format.description}
                    </p>
                  )}
                </>
              )
            }
          </Field>
        )}

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Nome" hint="opcional">
            {(id) => (
              <Input
                id={id}
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
                placeholder={purpose === "collection" ? "Ex.: pasta das raras" : purpose === "check" ? "Conferência de sexta" : "Ex.: Atraxa superfriends"}
              />
            )}
          </Field>
          <Field label="Idioma das cartas" hint="quando a foto não decidir">
            {(id) => (
              <Select id={id} value={language} onChange={(e) => setLanguage(e.target.value)}>
                {LANGS.map((l) => (
                  <option key={l} value={l}>
                    {LANGUAGE_NAME[l]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <div className="hairline" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-md text-footnote text-cream-faint">
            {purpose === "check"
              ? "Passe o deck inteiro. No fim aparece o que falta, o que sobra e o que foi trocado de edição."
              : purpose === "collection"
                ? "Depois de revisar, você escolhe onde guardar: solto, numa pasta ou numa caixa."
                : "Depois de revisar, salve como deck e cada carta física fica registrada nele."}
          </p>
          <Button variant="primary" size="lg" busy={busy} disabled={!canStart} onClick={start} iconRight={<ArrowRight className="size-4" />} className="max-sm:w-full">
            Abrir a mesa
          </Button>
        </div>
      </Board>
    </div>
  );
}
