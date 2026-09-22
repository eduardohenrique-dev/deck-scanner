import { Copy, Download, Image as ImageIcon, Share2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "../../lib/toast";
import { bracketView, roundName } from "../../tournament/bracket.ts";
import { champion, currentRound } from "../../tournament/engine.ts";
import { finalText, matchesCsv, pairingsText, standingsCsv, standingsText } from "../../tournament/export.ts";
import type { Tournament } from "../../tournament/types.ts";
import { Button, Modal } from "../ui";

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "torneio";

function download(name: string, content: Blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(content);
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function copy(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    toast("Não consegui copiar: selecione o texto e copie à mão.", { tone: "bad" });
  }
}

async function share(title: string, text: string, file?: File) {
  try {
    if (file && navigator.canShare?.({ files: [file] })) await navigator.share({ title, files: [file] });
    else await navigator.share({ title, text });
  } catch (e) {
    if ((e as DOMException)?.name !== "AbortError") toast("Não deu para compartilhar daqui; use copiar.", { tone: "bad" });
  }
}

/** Imagem da chave desenhada no canvas com as fontes do app (vai bem no WhatsApp e no Instagram). */
export async function bracketImage(t: Tournament): Promise<Blob | null> {
  if (!t.playoff) return null;
  const view = bracketView(t.playoff);
  const names = new Map(t.players.map((p) => [p.id, p.name]));
  await Promise.all([document.fonts.load('600 40px "Grenze Variable"'), document.fonts.load('600 20px "Instrument Sans Variable"'), document.fonts.load('400 16px "Instrument Sans Variable"')]).catch(() => undefined);
  const colW = 300;
  const gap = 56;
  const slotH = 84;
  const pad = 56;
  const head = 196;
  const firstCount = view.rounds[0]?.length ?? 1;
  const width = pad * 2 + view.rounds.length * (colW + gap) + 260;
  const height = head + firstCount * (slotH + 24) + pad;
  const dpr = 2;
  const canvas = document.createElement("canvas");
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const g = canvas.getContext("2d");
  if (!g) return null;
  g.scale(dpr, dpr);
  // madeira escura com a luz de vela no alto
  g.fillStyle = "#16100c";
  g.fillRect(0, 0, width, height);
  const glow = g.createRadialGradient(width * 0.15, -40, 0, width * 0.15, -40, width * 0.7);
  glow.addColorStop(0, "rgba(236,184,96,0.22)");
  glow.addColorStop(1, "rgba(236,184,96,0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, width, height);
  g.fillStyle = "#f2e8d5";
  g.font = '600 44px "Grenze Variable", Georgia, serif';
  g.fillText(t.name, pad, pad + 40);
  g.fillStyle = "#9c8a74";
  g.font = '500 18px "Instrument Sans Variable", system-ui, sans-serif';
  g.fillText([t.gameFormat, `${t.players.length} jogadores`, `Top ${t.playoff.cut}`].filter(Boolean).join(" · "), pad, pad + 74);

  const areaTop = head;
  const areaH = height - head - pad;
  const pos: { x: number; y: number }[][] = [];
  view.rounds.forEach((round, r) => {
    const x = pad + r * (colW + gap);
    g.fillStyle = "#9c8a74";
    g.font = '600 14px "Instrument Sans Variable", system-ui, sans-serif';
    g.fillText(roundName(round.length, r).toUpperCase(), x, areaTop - 14);
    const cell = areaH / round.length;
    pos.push(
      round.map((slot, i) => {
        const y = areaTop + cell * i + cell / 2 - slotH / 2;
        // caixa do confronto
        g.fillStyle = "rgba(8,5,3,0.55)";
        roundRect(g, x, y, colW, slotH, 14);
        g.fill();
        g.strokeStyle = "rgba(255,226,184,0.12)";
        g.stroke();
        const line = (seat: typeof slot.a, row: number, games: number | null) => {
          const yy = y + 12 + row * 32;
          const won = !!slot.winner && seat?.playerId === slot.winner;
          if (won) {
            g.fillStyle = "rgba(235,198,116,0.14)";
            roundRect(g, x + 6, yy - 2, colW - 12, 30, 8);
            g.fill();
            g.fillStyle = "#ebc674";
            g.fillRect(x + 6, yy - 2, 3, 30);
          }
          g.fillStyle = "#9c8a74";
          g.font = '600 13px "Instrument Sans Variable", system-ui, sans-serif';
          g.fillText(seat ? String(seat.seed) : "", x + 18, yy + 19);
          g.fillStyle = seat ? (won ? "#f2e8d5" : "#cdbb9f") : "#9c8a74";
          g.font = `${won ? 600 : 500} 17px "Instrument Sans Variable", system-ui, sans-serif`;
          const label = seat ? (names.get(seat.playerId) ?? "?") : slot.bye ? "Folga" : "A definir";
          g.fillText(fit(g, label, colW - 90), x + 44, yy + 19);
          if (games !== null) {
            g.fillStyle = won ? "#f5dca0" : "#9c8a74";
            g.font = '700 17px "Instrument Sans Variable", system-ui, sans-serif';
            g.textAlign = "right";
            g.fillText(String(games), x + colW - 16, yy + 19);
            g.textAlign = "left";
          }
        };
        line(slot.a, 0, slot.result ? slot.result.score.a : null);
        line(slot.b, 1, slot.result ? slot.result.score.b : null);
        return { x, y: y + slotH / 2 };
      }),
    );
  });
  // ligações entre as fases
  g.strokeStyle = "rgba(255,226,184,0.2)";
  g.lineWidth = 1.5;
  for (let r = 1; r < pos.length; r++) {
    pos[r].forEach((p, i) => {
      const a = pos[r - 1][2 * i];
      const b = pos[r - 1][2 * i + 1];
      const mid = p.x - gap / 2;
      g.beginPath();
      g.moveTo(a.x + colW, a.y);
      g.lineTo(mid, a.y);
      g.lineTo(mid, b.y);
      g.lineTo(b.x + colW, b.y);
      g.moveTo(mid, p.y);
      g.lineTo(p.x, p.y);
      g.stroke();
    });
  }
  // campeão
  const champ = champion(t);
  const lastX = pad + view.rounds.length * (colW + gap);
  const cy = areaTop + areaH / 2;
  g.fillStyle = "#ebc674";
  g.font = '600 14px "Instrument Sans Variable", system-ui, sans-serif';
  g.fillText("CAMPEÃO", lastX, cy - 24);
  g.fillStyle = champ ? "#f2e8d5" : "#9c8a74";
  g.font = '600 34px "Grenze Variable", Georgia, serif';
  g.fillText(fit(g, champ ? (names.get(champ) ?? "?") : "A definir", 240), lastX, cy + 14);
  g.fillStyle = "#9c8a74";
  g.font = '500 13px "Instrument Sans Variable", system-ui, sans-serif';
  g.fillText("Deck Scanner · torneio", lastX, height - pad / 2);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

function fit(g: CanvasRenderingContext2D, text: string, max: number) {
  if (g.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && g.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s}…`;
}

function Row({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cream/6 py-4 last:border-b-0">
      <div className="min-w-0">
        <p className="text-headline font-semibold text-cream">{title}</p>
        <p className="text-footnote text-cream-faint">{text}</p>
      </div>
      <div className="flex gap-2">{children}</div>
    </div>
  );
}

/** Tudo o que sai do torneio: textos para colar no grupo, CSV para planilha e a imagem da chave. */
export default function ExportSheet({ t, onClose }: { t: Tournament; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const r = currentRound(t);
  const canShare = typeof navigator !== "undefined" && !!navigator.share;
  const base = slug(t.name);
  const texts = [
    r && { title: `Mesas da rodada ${r.number}`, text: "Quem joga com quem, mesa por mesa.", body: pairingsText(t, r.number) },
    t.rounds.length > 0 && { title: "Classificação", text: "Pontos, V–D–E e desempates.", body: standingsText(t) },
    (t.playoff || t.finishedAt) && { title: "Resultado final", text: "Campeão, mata-mata e classificação.", body: finalText(t) },
  ].filter(Boolean) as { title: string; text: string; body: string }[];

  async function image(action: "share" | "download") {
    setBusy(true);
    try {
      const blob = await bracketImage(t);
      if (!blob) return;
      const file = new File([blob], `${base}-bracket.png`, { type: "image/png" });
      if (action === "share") await share(t.name, "", file);
      else download(file.name, blob);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Compartilhar e exportar" description="Texto pronto para o WhatsApp, planilha e a imagem do bracket." width="md">
      <div>
        {texts.map((x) => (
          <Row key={x.title} title={x.title} text={x.text}>
            <Button size="sm" icon={<Copy className="size-4" />} onClick={() => void copy(x.body, `${x.title} copiada`)}>
              Copiar
            </Button>
            {canShare && <Button size="sm" variant="ghost" icon={<Share2 className="size-4" />} onClick={() => void share(t.name, x.body)} aria-label={`Compartilhar ${x.title}`} />}
          </Row>
        ))}
        {t.rounds.length > 0 && (
          <Row title="Planilha (CSV)" text="Classificação completa e todas as partidas.">
            <Button size="sm" icon={<Download className="size-4" />} onClick={() => download(`${base}-classificacao.csv`, new Blob([standingsCsv(t)], { type: "text/csv" }))}>
              Classificação
            </Button>
            <Button size="sm" icon={<Download className="size-4" />} onClick={() => download(`${base}-partidas.csv`, new Blob([matchesCsv(t)], { type: "text/csv" }))}>
              Partidas
            </Button>
          </Row>
        )}
        {t.playoff && (
          <Row title="Imagem do bracket" text="PNG em alta, com o campeão.">
            <Button size="sm" busy={busy} icon={<ImageIcon className="size-4" />} onClick={() => void image("download")}>
              Baixar
            </Button>
            {canShare && <Button size="sm" variant="ghost" icon={<Share2 className="size-4" />} onClick={() => void image("share")} aria-label="Compartilhar a imagem do bracket" />}
          </Row>
        )}
        {!texts.length && <p className="py-6 text-center text-subhead text-cream-faint">Assim que a primeira rodada sair, os textos e as planilhas aparecem aqui.</p>}
      </div>
    </Modal>
  );
}
