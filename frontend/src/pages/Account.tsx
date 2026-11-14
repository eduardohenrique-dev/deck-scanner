import { Check, Copy, ExternalLink, Send, Unlink, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Board, Button, Field, Input, PageTitle, Skeleton, Tag } from "../components/ui";
import { api, type Me } from "../lib/api";
import { toast, toastError } from "../lib/toast";

/**
 * Conta: nome que aparece nos torneios e as ligações com o Telegram.
 * - Jogador: "Conectar Telegram" abre o robô com um código; ao apertar "Iniciar", os avisos passam a chegar no privado.
 * - Organizador: liga o grupo do campeonato mandando `/conectar <código>` dentro do grupo.
 */
export default function Account() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [waiting, setWaiting] = useState<"user" | "group" | null>(null);
  const [group, setGroup] = useState<{ command: string; add_url: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = () =>
    api
      .me()
      .then((m) => {
        setMe(m);
        setName((n) => n || m.name || "");
        return m;
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        return null;
      });

  useEffect(() => {
    void load();
  }, []);

  // enquanto espera o "Iniciar" no Telegram (ou o /conectar no grupo), confere a cada 3 s
  useEffect(() => {
    if (!waiting) return;
    const t = window.setInterval(async () => {
      const m = await load();
      if (!m) return;
      if (waiting === "user" && m.telegram.connected) {
        setWaiting(null);
        toast("Telegram conectado.");
      }
      if (waiting === "group" && m.telegram.group) {
        setWaiting(null);
        setGroup(null);
        toast("Grupo conectado.");
      }
    }, 3000);
    return () => window.clearInterval(t);
  }, [waiting]);

  async function saveName() {
    const v = name.trim();
    if (!v || v === me?.name) return;
    try {
      await api.updateMe(v);
      toast("Nome salvo.");
      void load();
    } catch (e) {
      toastError(e);
    }
  }

  async function connect() {
    // a aba abre antes da resposta: navegador de celular bloqueia janela aberta depois de um await
    const tab = window.open("about:blank", "_blank");
    try {
      const { url } = await api.telegramLink();
      if (tab) tab.location.href = url;
      else location.href = url;
      setWaiting("user");
    } catch (e) {
      tab?.close();
      toastError(e);
    }
  }

  async function groupCode() {
    try {
      setGroup(await api.telegramGroup());
      setWaiting("group");
    } catch (e) {
      toastError(e);
    }
  }

  async function copyCommand() {
    if (!group) return;
    try {
      await navigator.clipboard.writeText(group.command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* fica visível para copiar à mão */
    }
  }

  if (error) return <p className="text-body text-wine-300">{error}</p>;
  if (!me)
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-48" />
        <Skeleton className="h-40" />
      </div>
    );
  const tg = me.telegram;

  return (
    <div className="max-w-2xl space-y-6">
      <PageTitle kicker="Sua conta" title={me.name || "Conta"}>
        {me.email}
      </PageTitle>

      <Board className="space-y-4 p-5 sm:p-6">
        <p className="eyebrow">Nome nos torneios</p>
        <Field label="Como você aparece nas mesas">
          {(id) => (
            <div className="flex gap-2">
              <Input id={id} value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} onKeyDown={(e) => e.key === "Enter" && void saveName()} maxLength={60} />
              <Button onClick={saveName} disabled={!name.trim() || name.trim() === me.name}>
                Salvar
              </Button>
            </div>
          )}
        </Field>
      </Board>

      <Board className="space-y-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="eyebrow">Avisos no Telegram</p>
          {tg.connected && <Tag tone="ok">Conectado{tg.username ? ` · @${tg.username}` : ""}</Tag>}
        </div>
        {!tg.enabled ? (
          <p className="text-subhead text-mist-dim">O robô do Telegram ainda não foi configurado neste servidor.</p>
        ) : tg.connected ? (
          <>
            <p className="text-subhead text-mist-dim">
              Quando sair uma rodada de um torneio em que você está inscrito, o robô @{tg.bot} manda no seu privado a sua mesa, a sua posição e o link do relógio.
            </p>
            <Button variant="ghost" icon={<Unlink className="size-4" />} onClick={() => void api.telegramUnlink().then(load)}>
              Desconectar
            </Button>
          </>
        ) : (
          <>
            <p className="text-subhead text-mist-dim">
              Receba no privado a sua mesa e a sua posição a cada rodada. Toque no botão, o Telegram abre no robô @{tg.bot}: aperte <strong className="text-mist">Iniciar</strong> e volte aqui.
            </p>
            <Button variant="primary" icon={<Send className="size-4" />} onClick={connect} busy={waiting === "user"}>
              Conectar Telegram
            </Button>
            {waiting === "user" && <p className="text-footnote text-mist-faint">Esperando você apertar “Iniciar” no Telegram…</p>}
          </>
        )}
      </Board>

      {tg.enabled && (
        <Board className="space-y-4 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="eyebrow">Grupo do campeonato</p>
            {tg.group && <Tag tone="ok">{tg.group.title ?? "Conectado"}</Tag>}
          </div>
          <p className="text-subhead text-mist-dim">
            Para quem organiza: a cada rodada gerada, o robô posta no grupo todas as mesas e o link do relógio.
          </p>
          {group ? (
            <ol className="space-y-3 text-subhead text-mist-dim">
              <li>
                1. Adicione o robô @{tg.bot} ao grupo.{" "}
                <a href={group.add_url} target="_blank" rel="noopener" className="inline-flex items-center gap-1 font-semibold text-area-soft underline underline-offset-2">
                  Escolher o grupo <ExternalLink className="size-3.5" />
                </a>
              </li>
              <li className="space-y-2">
                <span>2. Mande esta mensagem no grupo (vale por 24 horas):</span>
                <span className="well flex items-center gap-2 py-1 pr-1 pl-3">
                  <code className="tabular min-w-0 flex-1 truncate text-mist">{group.command}</code>
                  <Button size="sm" variant="ghost" icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />} onClick={copyCommand}>
                    {copied ? "Copiado" : "Copiar"}
                  </Button>
                </span>
              </li>
              <li className="text-footnote text-mist-faint">Esperando a mensagem chegar no grupo…</li>
            </ol>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button variant={tg.group ? "secondary" : "primary"} icon={<Users className="size-4" />} onClick={groupCode}>
                {tg.group ? "Trocar de grupo" : "Conectar um grupo"}
              </Button>
              {tg.group && (
                <Button variant="ghost" icon={<Unlink className="size-4" />} onClick={() => void api.telegramGroupUnlink().then(load)}>
                  Desconectar o grupo
                </Button>
              )}
            </div>
          )}
        </Board>
      )}
    </div>
  );
}
