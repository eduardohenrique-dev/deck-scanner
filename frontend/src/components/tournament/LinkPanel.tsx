import { Check, Copy, ExternalLink, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type TournamentAccounts } from "../../lib/api";
import { Link } from "../../lib/router";
import { isDraft } from "../../tournament/engine.ts";
import type { Tournament } from "../../tournament/types.ts";
import { Board, Button, cx } from "../ui";

/** Quem da lista tem conta e Telegram ligado; recarrega quando a lista muda. */
export function useAccounts(t: Tournament): TournamentAccounts | null {
  const [data, setData] = useState<TournamentAccounts | null>(null);
  const key = t.players.map((p) => `${p.id}:${p.userId ?? ""}`).join(",");
  useEffect(() => {
    let cancelled = false;
    api
      .tournamentAccounts(t.id)
      .then((d) => !cancelled && setData(d))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [t.id, key]);
  return data;
}

/** Link público do torneio (inscrição antes de começar; relógio e mesas depois) e o estado dos avisos. */
export default function LinkPanel({ t, onResend }: { t: Tournament; onResend?: () => void }) {
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const accounts = useAccounts(t);
  useEffect(() => {
    api
      .shareTournament(t.id)
      .then((r) => setToken(r.token))
      .catch(() => undefined);
  }, [t.id]);
  const url = token ? `${location.origin}/t/${token}` : null;
  const draft = isDraft(t);
  const withAccount = t.players.filter((p) => accounts?.players[p.id]?.account).length;
  const withTelegram = t.players.filter((p) => accounts?.players[p.id]?.telegram).length;

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* sem permissão de área de transferência: o link continua visível para copiar à mão */
    }
  }

  return (
    <Board className="space-y-4 p-5">
      <div>
        <p className="eyebrow">{draft ? "Inscrição pelo link" : "Relógio e mesas ao vivo"}</p>
        <p className="mt-1 text-footnote text-mist-dim">
          {draft
            ? "Mande no grupo: cada jogador entra com a própria conta e cai direto na lista. Depois do início, o mesmo link mostra o relógio e as mesas."
            : "Qualquer um abre sem login. Cada jogador vê a própria mesa destacada."}
        </p>
      </div>
      <div className="well flex items-center gap-2 py-1 pr-1 pl-3">
        <span className="tabular min-w-0 flex-1 truncate text-footnote text-mist-dim">{url ?? "gerando o link…"}</span>
        <Button size="sm" variant="ghost" icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />} onClick={copy} disabled={!url}>
          {copied ? "Copiado" : "Copiar"}
        </Button>
        {url && (
          <a className="btn btn-ghost btn-sm btn-icon" href={url} target="_blank" rel="noopener" aria-label="Abrir o link">
            <ExternalLink className="size-4" />
          </a>
        )}
      </div>

      <div className="space-y-1.5 border-t border-line pt-4">
        <p className="eyebrow">Avisos no Telegram</p>
        {!accounts ? (
          <p className="text-footnote text-mist-faint">Carregando…</p>
        ) : !accounts.enabled ? (
          <p className="text-footnote text-mist-faint">O robô do Telegram ainda não foi configurado neste servidor.</p>
        ) : (
          <ul className="space-y-1 text-footnote text-mist-dim">
            <li className={cx(!accounts.group && "text-ember-300")}>
              {accounts.group ? `Grupo: ${accounts.group.title ?? "conectado"}` : "Nenhum grupo conectado."}{" "}
              {!accounts.group && (
                <Link to="/conta" className="font-semibold underline underline-offset-2">
                  Conectar
                </Link>
              )}
            </li>
            <li>
              {withTelegram} de {t.players.length} recebem no privado
              {withAccount > withTelegram ? ` (${withAccount - withTelegram} com conta, sem Telegram ligado)` : ""}.
            </li>
            <li className="text-mist-faint">A cada rodada gerada, o aviso sai sozinho.</li>
          </ul>
        )}
        {accounts?.enabled && onResend && !draft && (
          <Button size="sm" variant="secondary" icon={<Send className="size-4" />} onClick={onResend} className="mt-2">
            Reenviar o aviso desta rodada
          </Button>
        )}
      </div>
    </Board>
  );
}
