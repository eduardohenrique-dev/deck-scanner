/**
 * Modelo do torneio. Regra: grava-se só o que aconteceu (jogadores, emparelhamentos, placares, seeds);
 * classificação, desempates, quem avança no bracket e o campeão são sempre recalculados.
 */
export type ID = string;

export type Structure =
  | { kind: "swiss"; rounds: number; cut: number | null } // cut = X livre (top X); null = só suíço
  | { kind: "round-robin"; cut: number | null }
  | { kind: "single-elimination" }; // eliminação dupla fica para uma segunda fase

export type Points = { win: number; draw: number; loss: number };

export type Settings = {
  bestOf: 1 | 3;
  playoffBestOf: 1 | 3;
  points: Points;
  /** minutos por rodada; null = sem relógio */
  roundMinutes: number | null;
  /** como montar o bracket: pela classificação (no mata-mata direto, a ordem da lista) ou sorteado */
  seeding: "standings" | "random";
};

/** Deck do jogador: um da coleção (id) ou só o nome do arquétipo. */
export type DeckRef = { id: string | null; name: string; identity?: string[]; art?: string | null };

export type Player = {
  id: ID;
  name: string;
  deck: DeckRef | null;
  /** saiu depois desta rodada (1, 2…); os jogos dele seguem valendo no desempate de quem jogou com ele */
  droppedAfter: number | null;
  /** sorteio fixo para o empate total: a ordem não "pisca" entre um cálculo e outro */
  lot: number;
};

/** Placar em games: vencidos por A, vencidos por B e empatados. */
export type Score = { a: number; b: number; draws: number };

export type Match = {
  id: ID;
  /** null na folga (bye) */
  table: number | null;
  a: ID;
  /** null = bye */
  b: ID | null;
  result: Score | null;
  /** emparelhado à mão (troca feita pelo organizador) */
  manual?: boolean;
  at?: string | null;
};

export type Timer = { startedAt: string | null; pausedAt: string | null; pausedMs: number };

export type Round = { number: number; matches: Match[]; timer: Timer };

/** Placar do mata-mata com quem jogou (se um vencedor anterior mudar, o placar velho deixa de valer). */
export type BracketResult = { score: Score; a: ID; b: ID; at?: string | null };

export type Playoff = {
  cut: number;
  seeding: "standings" | "random";
  /** classificados na ordem de seed (seeds[0] é o seed 1), congelados no corte */
  seeds: ID[];
  /** placar por posição na chave ("rodada:partida"); guarda quem jogou para invalidar placar velho */
  results: Record<string, BracketResult>;
  drawnAt: string;
};

export type Tournament = {
  schema: 1;
  id: ID;
  name: string;
  /** AAAA-MM-DD */
  date: string;
  gameFormat: string;
  notes: string;
  structure: Structure;
  settings: Settings;
  /** semente dos sorteios */
  seed: number;
  players: Player[];
  rounds: Round[];
  playoff: Playoff | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

// ------------------------------------------------------------------ calculados (nunca gravados)
export type Standing = {
  rank: number;
  playerId: ID;
  points: number;
  wins: number;
  losses: number;
  draws: number;
  byes: number;
  matchesPlayed: number;
  /** percentuais já com o piso de 1/3 da MTR */
  mwp: number;
  omw: number;
  gwp: number;
  ogw: number;
  dropped: boolean;
};

export type Seat = { playerId: ID; seed: number };

export type BracketSlot = {
  key: string;
  round: number;
  index: number;
  a: Seat | null;
  b: Seat | null;
  /** um lado vazio porque o corte não é potência de 2: o outro avança direto */
  bye: boolean;
  result: BracketResult | null;
  winner: ID | null;
  /** havia placar gravado, mas com outros jogadores (um resultado anterior mudou) */
  stale: boolean;
};

export type BracketView = { size: number; rounds: BracketSlot[][]; champion: ID | null };

export type StageId = "setup" | "players" | "rounds" | "cut" | "bracket" | "champion";

export type Status = "draft" | "running" | "finished";

export type Summary = {
  status: Status;
  stage: StageId;
  players: number;
  round: number;
  rounds: number;
  champion: string | null;
  leader: string | null;
};
