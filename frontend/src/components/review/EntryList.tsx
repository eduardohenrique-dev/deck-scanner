import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { cardName, entryNeedsReview, TYPE_LABEL, TYPE_ORDER, typeGroup } from "../../lib/format";
import { usePersistentState } from "../../lib/hooks";
import type { DeckState, Detection, Entry, FormatRule, GameMeta, SessionState } from "../../lib/types";
import { CardStack } from "../icons";
import { EmptyState, Input, Segmented } from "../ui";
import { EntryRow } from "./EntryRow";

type Props = {
  entries: Entry[];
  detections?: Detection[];
  format: FormatRule;
  game: GameMeta;
  onState: (s: SessionState | DeckState) => void;
  ownedElsewhere?: Record<string, string[]>;
  fxRate?: number;
  focusId?: string | null;
  empty?: { title: string; text: string };
};

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

/** A lista agrupada por tipo (ou zona), com busca e o filtro do que precisa de revisão. */
export default function EntryList({ entries, detections = [], format, game, onState, ownedElsewhere, fxRate, focusId, empty }: Props) {
  const [query, setQuery] = useState("");
  const [grouping, setGrouping] = usePersistentState<"type" | "zone">("deckscanner:grouping", "type");
  const [onlyReview, setOnlyReview] = useState(false);
  const detById = useMemo(() => new Map(detections.map((d) => [d.id, d])), [detections]);
  const reviewCount = entries.filter((e) => e.quantity > 0 && entryNeedsReview(e)).length;
  const zoneName = (z: string) => format.zone_labels?.[z] ?? game.zones.find((x) => x.id === z)?.name ?? z;
  const zoneOrder = format.zones ?? ["deck"];
  const mainZone = zoneOrder.find((z) => z !== "commander") ?? "deck";

  const sections = useMemo(() => {
    const q = norm(query.trim());
    const list = entries.filter((e) => {
      if (e.quantity <= 0) return false; // carta tirada: não fica na lista apagada
      if (onlyReview && !entryNeedsReview(e)) return false;
      if (!q) return true;
      const c = e.card;
      return !!c && [c.name_pt, c.name_en, c.printed_name, c.type_line, c.set_code].some((v) => v && norm(v).includes(q));
    });
    const byKey = new Map<string, Entry[]>();
    for (const e of list) {
      const key = grouping === "zone" || e.zone !== mainZone || e.is_commander ? `zone:${e.is_commander ? "commander" : e.zone}` : `type:${typeGroup(e.card?.front_type_line)}`;
      byKey.set(key, [...(byKey.get(key) ?? []), e]);
    }
    const rank = (key: string) => {
      const [kind, id] = key.split(":");
      if (kind === "zone") {
        if (id === "commander") return -1;
        const i = zoneOrder.indexOf(id);
        return grouping === "zone" ? i : 100 + (i < 0 ? 50 : i);
      }
      return TYPE_ORDER.indexOf(id);
    };
    return [...byKey.entries()]
      .sort((a, b) => rank(a[0]) - rank(b[0]))
      .map(([key, items]) => {
        const [kind, id] = key.split(":");
        return {
          key,
          label: kind === "zone" ? (id === "commander" ? "Comandante" : zoneName(id)) : TYPE_LABEL[id],
          count: items.reduce((n, e) => n + e.quantity, 0),
          items: [...items].sort((a, b) => cardName(a.card).localeCompare(cardName(b.card), "pt-BR")),
        };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, query, grouping, onlyReview, format]);

  if (!entries.length)
    return (
      <div className="glass">
        <EmptyState art={<CardStack size={46} />} title={empty?.title ?? "Nenhuma carta ainda"}>
          {empty?.text ?? "As cartas aparecem aqui assim que forem lidas."}
        </EmptyState>
      </div>
    );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-cream-faint" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filtrar por nome, tipo ou coleção" className="pl-9" aria-label="Filtrar cartas" />
        </div>
        <Segmented
          size="sm"
          value={grouping}
          onChange={setGrouping}
          options={[
            { value: "type", label: "Por tipo" },
            { value: "zone", label: "Por zona" },
          ]}
        />
        {reviewCount > 0 && (
          <button type="button" onClick={() => setOnlyReview((v) => !v)} aria-pressed={onlyReview} className="chip chip-pill">
            <span className="size-2 rounded-full bg-ember-400" aria-hidden="true" />
            Revisar <span className="tabular">{reviewCount}</span>
          </button>
        )}
      </div>

      {sections.length === 0 ? (
        <p className="glass px-4 py-8 text-center text-subhead text-cream-faint">Nada com esse filtro.</p>
      ) : (
        sections.map((s) => (
          <section key={s.key} className="glass overflow-hidden">
            <h3 className="panel-head justify-between text-brass-300">
              <span>{s.label}</span>
              <span className="tabular tracking-normal text-cream-faint">{s.count}</span>
            </h3>
            <ul>
              {s.items.map((e) => (
                <EntryRow
                  key={e.id}
                  entry={e}
                  format={format}
                  game={game}
                  detections={e.detection_ids.map((id) => detById.get(id)).filter((d): d is Detection => !!d)}
                  ownedElsewhere={ownedElsewhere?.[e.oracle_id]}
                  onState={onState}
                  fxRate={fxRate}
                  defaultOpen={focusId === e.id}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
