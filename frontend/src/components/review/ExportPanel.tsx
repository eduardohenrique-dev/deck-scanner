import { Copy, Download, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { toast, toastError } from "../../lib/toast";
import type { Exporter } from "../../lib/types";
import { Scroll } from "../icons";
import { Button, Segmented, SectionTitle, Select, Skeleton } from "../ui";

const HELP: Record<string, { hint: string; url?: string }> = {
  ligamagic: { hint: "Cole em LigaMagic → Compra por Lista ou na importação de deck.", url: "https://www.ligamagic.com.br/?view=cards/lista" },
  moxfield: { hint: "Moxfield → Create Deck → Import.", url: "https://moxfield.com/decks/personal" },
  archidekt: { hint: "Archidekt → Import → Text.", url: "https://archidekt.com/" },
  arena: { hint: "MTG Arena → Decks → Importar (copie antes)." },
  csv: { hint: "Planilha da coleção (Excel, Google Sheets)." },
};

export default function ExportPanel({ kind, id, exporters, name }: { kind: "sessions" | "decks"; id: string; exporters: Exporter[]; name: string }) {
  const [format, setFormat] = useState(exporters[0]?.id ?? "ligamagic");
  const [group, setGroup] = useState<"list" | "type">("list");
  const [lang, setLang] = useState("pt");
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const exporter = exporters.find((e) => e.id === format);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .exportText(kind, id, { format, group: group === "type", lang })
      .then((t) => !cancelled && setText(t))
      .catch((e) => !cancelled && toastError(e))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [kind, id, format, group, lang]);

  async function copy() {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast("Lista copiada");
    } catch {
      toast("Não consegui copiar — selecione o texto e copie manualmente", { tone: "bad" });
    }
  }

  function download() {
    if (!text || !exporter) return;
    const blob = new Blob([text], { type: exporter.extension === "csv" ? "text/csv" : "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${name.replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase() || "deck"}-${format}.${exporter.extension}`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <section className="space-y-3">
      <SectionTitle>
        <span className="inline-flex items-center gap-2">
          <Scroll size={17} /> levar a lista
        </span>
      </SectionTitle>
      <div className="board space-y-3 p-4">
        <Select value={format} onChange={(e) => setFormat(e.target.value)} aria-label="Formato de exportação">
          {exporters.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </Select>
        <div className="flex flex-wrap gap-2">
          {exporter?.supports_grouping && (
            <Segmented size="sm" value={group} onChange={setGroup} options={[{ value: "list", label: "lista corrida" }, { value: "type", label: "por tipo" }]} />
          )}
          {exporter?.options?.lang && (
            <Segmented size="sm" value={lang} onChange={setLang} options={[{ value: "pt", label: "português" }, { value: "en", label: "inglês" }]} />
          )}
        </div>
        {HELP[format] && (
          <p className="text-[14px] text-cream-faint">
            {HELP[format].hint}{" "}
            {HELP[format].url && (
              <a href={HELP[format].url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brass-300 hover:underline">
                abrir <ExternalLink className="size-3.5" />
              </a>
            )}
          </p>
        )}
        {loading && !text ? (
          <Skeleton className="h-40" />
        ) : (
          <textarea
            readOnly
            value={text ?? ""}
            className="scrollbar-thin h-44 w-full resize-y rounded-[5px] border border-oak-700 bg-oak-950 p-2.5 font-mono text-[13px] leading-relaxed text-cream-dim outline-none"
            aria-label="Prévia da exportação"
          />
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="brass" size="sm" icon={<Copy className="size-4" />} onClick={copy} disabled={!text}>
            copiar
          </Button>
          <Button size="sm" icon={<Download className="size-4" />} onClick={download} disabled={!text}>
            baixar .{exporter?.extension ?? "txt"}
          </Button>
        </div>
      </div>
    </section>
  );
}
