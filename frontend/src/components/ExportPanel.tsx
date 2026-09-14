import { Check, Copy, Download } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { SessionState } from "../lib/types";
import { Button } from "./ui";

export default function ExportPanel({ state }: { state: SessionState }) {
  const exporters = state.game.exporters;
  const [format, setFormat] = useState(exporters[0]?.id ?? "moxfield");
  const [group, setGroup] = useState(false);
  const [lang, setLang] = useState("en");
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  const exporter = exporters.find((e) => e.id === format);
  const stamp = state.session.updated_at;

  useEffect(() => {
    let alive = true;
    fetch(api.exportUrl(state.session.id, format, { group, lang }))
      .then((r) => r.text())
      .then((t) => alive && setText(t));
    return () => {
      alive = false;
    };
  }, [state.session.id, format, group, lang, stamp, state.entries]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <section className="space-y-3 rounded-2xl border border-line bg-panel p-4">
      <h2 className="font-semibold">Exportar</h2>
      <div className="flex flex-wrap gap-1.5">
        {exporters.map((e) => (
          <button
            key={e.id}
            onClick={() => setFormat(e.id)}
            className={`rounded-lg border px-2.5 py-1.5 text-[13px] ${e.id === format ? "border-accent bg-accent/10 text-text" : "border-line bg-panel-2 text-muted hover:text-text"}`}
          >
            {e.name}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-4 text-[13px] text-muted">
        {exporter?.supports_grouping && (
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={group} onChange={(e) => setGroup(e.target.checked)} className="accent-[var(--color-accent)]" />
            agrupar por tipo
          </label>
        )}
        {exporter?.options?.lang && (
          <label className="flex items-center gap-1.5">
            nomes em
            <select value={lang} onChange={(e) => setLang(e.target.value)} className="rounded-md bg-panel-2 px-1 py-0.5 text-text outline-none">
              <option value="en">inglês</option>
              <option value="pt">português</option>
            </select>
          </label>
        )}
      </div>
      <textarea readOnly value={text} className="scrollbar-thin h-56 w-full resize-y rounded-lg border border-line bg-bg p-2.5 font-mono text-[12px] leading-relaxed text-muted outline-none" />
      <div className="grid grid-cols-2 gap-2">
        <Button variant="primary" onClick={copy} icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />}>
          {copied ? "Copiado" : "Copiar"}
        </Button>
        <a href={api.exportUrl(state.session.id, format, { group, lang, download: true })} download>
          <Button className="w-full" icon={<Download className="size-4" />}>
            Baixar .{exporter?.extension ?? "txt"}
          </Button>
        </a>
      </div>
    </section>
  );
}
