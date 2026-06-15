export const TEAM_IDS = ["ember", "frost"] as const;
export type TeamId = (typeof TEAM_IDS)[number];

export type GamePhase =
  | "lobby"
  | "trap-writing"
  | "between-turns"
  | "clue"
  | "round-summary"
  | "game-over";

export type AttemptResult = "correct" | "trap" | "timeout";
export type DeckMode = "mixed" | "common" | "arcane";
export type WordSource = "built-in" | "custom" | "combined";

export interface HostStartResult {
  port: number;
  hostToken: string;
  addresses: string[];
}

export interface ClientActionResult {
  ok: boolean;
  error?: string;
}

export interface Player {
  id: string;
  name: string;
  team?: TeamId;
  isHost: boolean;
  connected: boolean;
  joinedAt: number;
}

export interface TeamState {
  id: TeamId;
  name: string;
  accent: string;
  progress: number;
  score: number;
  clueRotation: number;
}

export interface RoomCard {
  id: string;
  title: string;
  subtitle: string;
  trapCount: number;
  curse: string;
}

export interface GameSettings {
  deckMode: DeckMode;
  wordSource: WordSource;
  timeLimitSec: number;
  maxRounds: number;
  customWordCount: number;
}

export interface GameSetup {
  deckMode?: DeckMode;
  wordSource?: WordSource;
  timeLimitSec?: number;
  maxRounds?: number;
  customWords?: string[];
}

export interface AttemptSummary {
  team: TeamId;
  result: AttemptResult;
  trap?: string;
  resolvedAt: number;
}

export interface PublicRoundState {
  index: number;
  trapLimitForTeam: Record<TeamId, number>;
  clueGivers: Partial<Record<TeamId, string>>;
  trapSubmittedByTeam: Record<TeamId, boolean>;
  activeTeam?: TeamId;
  nextTeam?: TeamId;
  deadline?: number;
  startedAt?: number;
  attempts: Partial<Record<TeamId, AttemptSummary>>;
  reveal?: {
    targetWords: Record<TeamId, string>;
    trapsForTeam: Record<TeamId, string[]>;
  };
}

export interface PublicGameState {
  id: string;
  phase: GamePhase;
  settings: GameSettings;
  players: Player[];
  teams: Record<TeamId, TeamState>;
  rooms: RoomCard[];
  round?: PublicRoundState;
  log: string[];
}

export interface PrivateView {
  playerId: string;
  canHost: boolean;
  team?: TeamId;
  isClueGiver: boolean;
  writingForTeam?: TeamId;
  visibleTarget?: string;
  visibleTraps?: string[];
  visibleTrapLimit?: number;
  submittedTraps?: string[];
}

export interface PlayerView {
  state: PublicGameState;
  private: PrivateView;
  serverTime: number;
}

export type UpdateStatusType =
  | "disabled"
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error";

export interface UpdateStatus {
  type: UpdateStatusType;
  updatedAt: number;
  version?: string;
  percent?: number;
  transferred?: number;
  total?: number;
  message?: string;
}
