import { ClipboardPaste, Layers, LogOut, Plus, Trash2, Undo2, UserPlus } from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { useResource } from "../../lib/hooks";
import { isDraft, parsePlayerList } from "../../tournament/engine.ts";
import { suggestRounds } from "../../tournament/pairing.ts";
import type { DeckRef, Player, Tournament } from "../../tournament/types.ts";
import type { Deck } from "../../lib/types";
import { IdentityPips } from "../mtg";
import { Board, Button, Confirm, cx, EmptyState, IconButton, InlineEdit, Input, Modal, Tag, Textarea } from "../ui";
import { Goblet } from "../icons";
import { newId } from "./labels";
import type { Dispatch } from "./useTournament";

/** Inscrições: adicionar um a um ou colar a lista do grupo, vincular deck e (depois do início) marcar quem saiu. */
export default function PlayersStage({ t, dispatch, onPlayer }: { t: Tournament; dispatch: Dispatch; onPlayer?: (id: string) => void }) {
  const draft = isDraft(t);
  const [name, setName] = useState("");
  const [pasting, setPasting] = useState(false);
  const [deckFor, setDeckFor] = useState<Player | null>(null);
  const [dropping, setDropping] = useState<Player | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const n = t.players.length;

  function add(e: FormEvent) {
    e.preventDefault();
    const names = parsePlayerList(name);
    if (!names.length) return;
    const ok = dispatch({ type: "addPlayers", players: names.map((nm) => ({ id: newId(), name: nm, lot: Math.random() })) });
    if (ok) setName("");
    input.current?.focus();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-4">
        {draft && (
          <Board className="p-4 sm:p-5">
            <form className="flex flex-wrap gap-2" onSubmit={add}>
              <label htmlFor="novo-jogador" className="sr-only">
                Nome do jogador
              </label>
              <Input ref={input} id="novo-jogador" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do jogador" autoComplete="off" enterKeyHint="done" className="min-w-0 flex-1 basis-60" />
              <Button type="submit" variant="primary" icon={<UserPlus className="size-4" />} disabled={!name.trim()}>
                Inscrever
              </Button>
              <Button icon={<ClipboardPaste className="size-4" />} onClick={() => setPasting(true)}>
                Colar lista
              </Button>
            </form>
          </Board>
        )}

        {n === 0 ? (
          <Board>
            <EmptyState art={<Goblet size={44} />} title="Mesa vazia por enquanto">
              Inscreva quem vai jogar: um nome por vez ou cole a lista do grupo, um nome por linha.
            </EmptyState>
          </Board>
        ) : (
          <ol className="glass divide-y divide-mist/6 overflow-hidden">
            {t.players.map((p, i) => (
              <li key={p.id} className={cx("flex min-h-16 items-center gap-3 px-3 py-2 sm:px-4", p.droppedAfter !== null && "opacity-70")}>
                <span className="tabular w-7 shrink-0 text-center text-footnote font-semibold text-mist-faint">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-headline font-semibold text-mist">
                    {onPlayer && !draft ? (
                      <button type="button" className="max-w-full truncate text-left hover:text-arcane-100" onClick={() => onPlayer(p.id)}>
                        {p.name}
                      </button>
                    ) : (
                      <InlineEdit label="Nome do jogador" value={p.name} placeholder="Sem nome" onSave={async (v) => void dispatch({ type: "updatePlayer", id: p.id, name: v })} />
                    )}
                  </p>
                  <button type="button" onClick={() => setDeckFor(p)} className="mt-0.5 flex max-w-full items-center gap-2 rounded-xs text-footnote text-mist-faint hover:text-arcane-200">
                    {p.deck ? (
                      <>
                        {p.deck.identity?.length ? <IdentityPips colors={p.deck.identity} size={13} /> : <Layers className="size-3.5 shrink-0" />}
                        <span className="truncate">{p.deck.name}</span>
                      </>
                    ) : (
                      <>
                        <Plus className="size-3.5 shrink-0" /> Deck
                      </>
                    )}
                  </button>
                </div>
                {p.droppedAfter !== null && <Tag tone="bad">{p.droppedAfter === 0 ? "Saiu antes de jogar" : `Saiu após a rodada ${p.droppedAfter}`}</Tag>}
                {draft ? (
                  <IconButton label={`Tirar ${p.name} da lista`} onClick={() => dispatch({ type: "removePlayer", id: p.id }, { undo: `${p.name} saiu da lista` })}>
                    <Trash2 className="size-[18px]" />
                  </IconButton>
                ) : !t.playoff && p.droppedAfter === null ? (
                  <Button size="sm" variant="ghost" icon={<LogOut className="size-4" />} onClick={() => setDropping(p)}>
                    Saiu
                  </Button>
                ) : !t.playoff && t.rounds.length <= (p.droppedAfter ?? 0) ? (
                  <Button size="sm" variant="ghost" icon={<Undo2 className="size-4" />} onClick={() => dispatch({ type: "undrop", player: p.id }, { undo: `${p.name} voltou ao torneio` })}>
                    Voltou
                  </Button>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </div>

      <aside className="space-y-4">
        <Board className="p-5">
          <p className="eyebrow">Inscritos</p>
          <p className="tabular mt-1 text-display font-semibold text-mist">{n}</p>
          {t.structure.kind === "swiss" && n >= 2 && (
            <p className="mt-2 text-subhead text-mist-dim">
              {t.structure.rounds ? `${t.structure.rounds} rodadas definidas` : `${suggestRounds(n, t.structure.cut)} rodadas sugeridas`} para {n} jogadores
              {t.structure.cut !== null ? `, depois Top ${t.structure.cut}` : ""}.
            </p>
          )}
          {n % 2 === 1 && t.structure.kind !== "single-elimination" && <p className="mt-2 text-footnote text-mist-faint">Número ímpar: a cada rodada alguém folga (vale vitória por 2 a 0), nunca a mesma pessoa duas vezes.</p>}
        </Board>
        {!draft && <p className="px-1 text-footnote text-mist-faint">Depois do início, a lista fica fechada. Quem for embora é marcado como “saiu”: não joga mais, mas os jogos dele continuam valendo no desempate dos outros.</p>}
      </aside>

      {pasting && <PasteList onClose={() => setPasting(false)} onAdd={(names) => dispatch({ type: "addPlayers", players: names.map((nm) => ({ id: newId(), name: nm, lot: Math.random() })) }, { undo: `${names.length} ${names.length === 1 ? "jogador inscrito" : "jogadores inscritos"}` })} />}
      {deckFor && <DeckPicker player={deckFor} onClose={() => setDeckFor(null)} onPick={(deck) => (dispatch({ type: "updatePlayer", id: deckFor.id, deck }), setDeckFor(null))} />}
      <Confirm
        open={!!dropping}
        title={dropping ? `${dropping.name} saiu do torneio?` : ""}
        confirmLabel="Marcar saída"
        danger
        onConfirm={() => {
          if (dropping) dispatch({ type: "drop", player: dropping.id }, { undo: `${dropping.name} saiu do torneio` });
          setDropping(null);
        }}
        onClose={() => setDropping(null)}
      >
        <p>Ele não entra nos próximos emparelhamentos nem no corte. As partidas que já jogou continuam valendo no desempate de quem jogou com ele.</p>
        <p className="text-footnote text-mist-faint">Se a mesa dele desta rodada ainda não tem placar, o oponente fica de folga (vitória por 2 a 0).</p>
      </Confirm>
    </div>
  );
}

function PasteList({ onClose, onAdd }: { onClose: () => void; onAdd: (names: string[]) => unknown }) {
  const [text, setText] = useState("");
  const names = parsePlayerList(text);
  const lines = text.split(/\r?\n|;/).filter((l) => l.trim()).length;
  return (
    <Modal
      open
      onClose={onClose}
      title="Colar a lista"
      description="Um nome por linha. Numeração, marcadores e repetidos saem sozinhos."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            disabled={!names.length}
            onClick={() => {
              onAdd(names);
              onClose();
            }}
          >
            {names.length ? `Inscrever ${names.length}` : "Inscrever"}
          </Button>
        </>
      }
    >
      <Textarea autoFocus rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={"1. Ana Beatriz\n2. Bruno Castro\n3. Carla Menezes"} aria-label="Lista de jogadores" />
      <p className="mt-2 text-footnote text-mist-faint">{names.length ? `${names.length} ${names.length === 1 ? "nome" : "nomes"}${lines > names.length ? ` · ${lines - names.length} repetido${lines - names.length > 1 ? "s" : ""} ou vazio${lines - names.length > 1 ? "s" : ""} ignorado${lines - names.length > 1 ? "s" : ""}` : ""}` : "Cole do WhatsApp, planilha ou bloco de notas."}</p>
    </Modal>
  );
}

/** Deck do jogador: um da estante (com cores e arte) ou só o nome do arquétipo. */
function DeckPicker({ player, onClose, onPick }: { player: Player; onClose: () => void; onPick: (deck: DeckRef | null) => void }) {
  const decks = useResource(() => api.decks(), []);
  const [free, setFree] = useState(player.deck && !player.deck.id ? player.deck.name : "");
  const [q, setQ] = useState("");
  const list = useMemo(() => (decks.data ?? []).filter((d) => !q || d.name.toLocaleLowerCase("pt-BR").includes(q.toLocaleLowerCase("pt-BR"))), [decks.data, q]);
  const fromDeck = (d: Deck): DeckRef => ({ id: d.id, name: d.name, identity: d.identity ?? [], art: d.cover?.image_normal?.replace("/normal/", "/art_crop/") ?? null });
  return (
    <Modal open onClose={onClose} title={`Deck de ${player.name}`} description="Escolha um deck da estante ou escreva o arquétipo.">
      <div className="space-y-5">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (free.trim()) onPick({ id: null, name: free.trim().slice(0, 60) });
          }}
        >
          <Input value={free} onChange={(e) => setFree(e.target.value)} placeholder="Ex.: Mono-Red Burn" aria-label="Arquétipo" className="min-w-0 flex-1" />
          <Button type="submit" variant="primary" disabled={!free.trim()}>
            Usar
          </Button>
        </form>
        <div>
          <p className="eyebrow mb-2">Da estante</p>
          {decks.loading ? (
            <p className="text-footnote text-mist-faint">Buscando os decks…</p>
          ) : decks.data?.length ? (
            <>
              {decks.data.length > 6 && <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar decks" aria-label="Filtrar decks" className="mb-2" />}
              <ul className="well max-h-72 divide-y divide-mist/6 overflow-y-auto">
                {list.map((d) => (
                  <li key={d.id}>
                    <button type="button" onClick={() => onPick(fromDeck(d))} className={cx("flex min-h-14 w-full items-center gap-3 px-4 text-left hover:bg-mist/5", player.deck?.id === d.id && "bg-arcane-300/10")}>
                      <IdentityPips colors={d.identity} size={15} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-serif text-headline font-semibold text-mist">{d.name}</span>
                        <span className="block truncate text-footnote text-mist-faint">{d.format_name ?? d.format_id}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-footnote text-mist-faint">Nenhum deck salvo ainda. Use o nome do arquétipo acima.</p>
          )}
        </div>
        {player.deck && (
          <Button variant="ghost" onClick={() => onPick(null)}>
            Tirar o deck
          </Button>
        )}
      </div>
    </Modal>
  );
}
