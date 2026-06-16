import { deckForMode } from "./decks";
import { ROOMS } from "./rooms";
import {
  TEAM_IDS,
  type AttemptResult,
  type AttemptSummary,
  type GamePhase,
  type GameSettings,
  type GameSetup,
  type Player,
  type PlayerView,
  type PublicGameState,
  type PublicRoundState,
  type TeamId,
  type TeamMessage,
  type TeamState
} from "../shared/types";

interface InternalRoundState {
  index: number;
  targetWords: Record<TeamId, string>;
  trapsForTeam: Record<TeamId, string[]>;
  draftTrapsForTeam: Record<TeamId, string[]>;
  teamMessages: Record<TeamId, TeamMessage[]>;
  trapLimitForTeam: Record<TeamId, number>;
  trapSubmittedByTeam: Record<TeamId, boolean>;
  turnReadyByTeam: Record<TeamId, boolean>;
  clueGivers: Partial<Record<TeamId, string>>;
  activeTeam?: TeamId;
  nextTeam?: TeamId;
  deadline?: number;
  startedAt?: number;
  attempts: Partial<Record<TeamId, AttemptSummary>>;
}

interface InternalState {
  id: string;
  phase: GamePhase;
  settings: GameSettings;
  players: Player[];
  teams: Record<TeamId, TeamState>;
  round?: InternalRoundState;
  lobbyReadyByPlayer: Record<string, boolean>;
  log: string[];
  usedWords: string[];
  customWords: string[];
  messageCounter: number;
}

const DEFAULT_SETTINGS: GameSettings = {
  deckMode: "mixed",
  wordSource: "built-in",
  timeLimitSec: 60,
  maxRounds: 8,
  customWordCount: 0
};

export class GameEngine {
  private state: InternalState;

  constructor(settings: GameSetup = {}) {
    this.state = this.createInitialState(settings);
  }

  joinPlayer(socketId: string, rawName?: string, isHost = false) {
    const existing = this.state.players.find((player) => player.id === socketId);
    if (existing) {
      existing.connected = true;
      existing.name = cleanName(rawName) || existing.name;
      existing.isHost = existing.isHost || isHost;
      return { playerId: existing.id };
    }

    const player: Player = {
      id: socketId,
      name: cleanName(rawName) || `Wanderer ${this.state.players.length + 1}`,
      isHost,
      connected: true,
      joinedAt: Date.now()
    };
    this.state.players.push(player);
    this.log(`${player.name} entered the tavern.`);
    return { playerId: player.id };
  }

  disconnectPlayer(playerId: string) {
    const player = this.requirePlayer(playerId);
    if (this.state.phase === "lobby") {
      this.state.players = this.state.players.filter((candidate) => candidate.id !== playerId);
      delete this.state.lobbyReadyByPlayer[playerId];
      this.log(`${player.name} left the lobby.`);
      return;
    }

    player.connected = false;
    this.state.lobbyReadyByPlayer[playerId] = false;
    this.log(`${player.name} disconnected.`);
  }

  setName(playerId: string, rawName: string) {
    const player = this.requirePlayer(playerId);
    const name = cleanName(rawName);
    if (!name) throw new Error("Name cannot be empty.");
    player.name = name;
  }

  chooseTeam(playerId: string, rawTeam: unknown) {
    if (this.state.phase !== "lobby") throw new Error("Teams are locked after the game starts.");
    const player = this.requirePlayer(playerId);
    const team = parseTeam(rawTeam);
    player.team = team;
    this.state.lobbyReadyByPlayer[player.id] = false;
    this.log(`${player.name} joined ${this.state.teams[team].name}.`);
  }

  setLobbyReady(playerId: string, ready: boolean) {
    if (this.state.phase !== "lobby") throw new Error("Ready checks are only active in the lobby.");
    const player = this.requirePlayer(playerId);
    this.requireTeam(player);
    this.state.lobbyReadyByPlayer[player.id] = Boolean(ready);
  }

  startGame(playerId: string, setup: GameSetup = {}) {
    this.requireHost(playerId);
    if (this.state.phase !== "lobby") throw new Error("The dungeon has already started.");
    this.applySetup(setup);
    this.ensureDeckReady();
    this.ensureReadyToStart();
    this.state.teams.ember.progress = 0;
    this.state.teams.ember.score = 0;
    this.state.teams.ember.clueRotation = 0;
    this.state.teams.frost.progress = 0;
    this.state.teams.frost.score = 0;
    this.state.teams.frost.clueRotation = 0;
    this.state.usedWords = [];
    this.state.round = this.createRound(1);
    this.state.phase = "trap-writing";
    this.log("The gate slams shut. Round 1 begins.");
  }

  submitTraps(playerId: string, traps: string[]) {
    const player = this.requirePlayer(playerId);
    const team = this.requireTeam(player);
    const round = this.requireRound();
    if (this.state.phase !== "trap-writing") throw new Error("Trap writing is not active.");

    const targetTeam = otherTeam(team);
    const sourceTraps = traps.length > 0 ? traps : round.draftTrapsForTeam[targetTeam];
    const cleaned = this.setTrapDraftForTeam(team, targetTeam, sourceTraps);

    round.trapsForTeam[targetTeam] = cleaned;
    round.trapSubmittedByTeam[team] = true;
    this.log(`${this.state.teams[team].name} sealed ${cleaned.length} traps.`);

    if (round.trapSubmittedByTeam.ember && round.trapSubmittedByTeam.frost) {
      round.nextTeam = this.firstTeamForRound(round.index);
      this.state.phase = "between-turns";
      this.log("Both spellbooks are locked. The first clue-giver approaches.");
    }
  }

  setTrapDraft(playerId: string, traps: string[]) {
    const player = this.requirePlayer(playerId);
    const team = this.requireTeam(player);
    this.requireRound();
    if (this.state.phase !== "trap-writing") throw new Error("Trap writing is not active.");

    const targetTeam = otherTeam(team);
    this.setTrapDraftForTeam(team, targetTeam, traps, false);
  }

  sendTeamMessage(playerId: string, rawText: unknown) {
    const player = this.requirePlayer(playerId);
    const team = this.requireTeam(player);
    const round = this.requireRound();
    if (this.state.phase !== "trap-writing") throw new Error("Team chat is only active while writing traps.");

    const text = cleanMessage(rawText);
    if (!text) throw new Error("Message cannot be empty.");

    this.state.messageCounter += 1;
    const message: TeamMessage = {
      id: `${round.index}-${team}-${this.state.messageCounter}`,
      playerId: player.id,
      playerName: player.name,
      team,
      text,
      sentAt: Date.now()
    };
    round.teamMessages[team] = [...round.teamMessages[team], message].slice(-50);
  }

  setTurnReady(playerId: string, ready: boolean) {
    const player = this.requirePlayer(playerId);
    const team = this.requireTeam(player);
    const round = this.requireRound();
    if (this.state.phase !== "between-turns") throw new Error("Turn ready checks are only active between turns.");
    round.turnReadyByTeam[team] = Boolean(ready);
  }

  beginClue(playerId: string, rawTeam: unknown) {
    this.requireHost(playerId);
    const round = this.requireRound();
    const team = parseTeam(rawTeam);
    if (this.state.phase !== "between-turns") throw new Error("No team is waiting to begin a clue attempt.");
    if (team !== round.nextTeam) throw new Error("That team is not next.");
    round.turnReadyByTeam = { ember: false, frost: false };
    round.activeTeam = team;
    round.nextTeam = undefined;
    round.startedAt = Date.now();
    round.deadline = round.startedAt + this.state.settings.timeLimitSec * 1000;
    this.state.phase = "clue";
    this.log(`${this.state.teams[team].name} lights the clue torch.`);
  }

  resolveAttempt(playerId: string, rawResult: unknown, rawTrap?: string) {
    const result = parseAttemptResult(rawResult);
    const player = this.requirePlayer(playerId);
    const round = this.requireRound();
    if (this.state.phase !== "clue" || !round.activeTeam) throw new Error("There is no active clue attempt.");

    const activeTeam = round.activeTeam;
    const playerTeam = player.team;
    const isOpponentTrapCall = result === "trap" && playerTeam === otherTeam(activeTeam);
    const isActiveTeamCorrect = result === "correct" && playerTeam === activeTeam;
    const canResolve = player.isHost || isOpponentTrapCall || isActiveTeamCorrect;
    if (!canResolve) throw new Error("You cannot resolve this attempt.");

    this.finishAttempt(activeTeam, result, cleanTrap(rawTrap));
  }

  autoTimeUp() {
    const round = this.requireRound();
    if (this.state.phase !== "clue" || !round.activeTeam) return;
    if ((round.deadline ?? Infinity) > Date.now()) return;
    this.finishAttempt(round.activeTeam, "timeout");
  }

  nextRound(playerId: string) {
    this.requireHost(playerId);
    const round = this.requireRound();
    if (this.state.phase !== "round-summary") throw new Error("The current round is not complete.");

    const nextIndex = round.index + 1;
    if (nextIndex > this.state.settings.maxRounds) {
      this.state.phase = "game-over";
      this.log("The final scroll is spent. The delve is over.");
      return;
    }

    this.state.round = this.createRound(nextIndex);
    this.state.phase = "trap-writing";
    this.log(`Round ${nextIndex} begins deeper in the dungeon.`);
  }

  resetGame(playerId: string) {
    this.requireHost(playerId);
    const players = this.state.players.map((player) => ({
      ...player,
      team: player.team,
      connected: player.connected
    }));
    this.state = this.createInitialState({
      ...this.state.settings,
      customWords: this.state.customWords
    });
    this.state.players = players;
    this.log("The host reset the dungeon.");
  }

  activeDeadline() {
    const round = this.state.round;
    if (this.state.phase !== "clue" || !round?.deadline) return undefined;
    return round.deadline;
  }

  getView(playerId: string): PlayerView {
    const player = this.requirePlayer(playerId);
    return {
      state: this.publicState(),
      private: this.privateView(player),
      serverTime: Date.now()
    };
  }

  snapshot() {
    return this.publicState();
  }

  private finishAttempt(team: TeamId, result: AttemptResult, trap?: string) {
    const round = this.requireRound();
    if (round.attempts[team]) throw new Error("This team already resolved its attempt.");

    round.attempts[team] = {
      team,
      result,
      trap,
      resolvedAt: Date.now()
    };

    round.activeTeam = undefined;
    round.deadline = undefined;
    round.startedAt = undefined;

    if (result === "correct") {
      this.state.teams[team].progress = Math.min(ROOMS.length, this.state.teams[team].progress + 1);
      this.state.teams[team].score += 1;
      this.log(`${this.state.teams[team].name} solved the word and advanced.`);
    } else if (result === "trap") {
      this.log(`${this.state.teams[team].name} sprung ${trap ? `"${trap}"` : "a trap"}.`);
    } else {
      this.log(`${this.state.teams[team].name}'s torch burned out.`);
    }

    const waitingTeam = TEAM_IDS.find((teamId) => !round.attempts[teamId]);
    if (waitingTeam) {
      round.nextTeam = waitingTeam;
      round.turnReadyByTeam = { ember: false, frost: false };
      this.state.phase = "between-turns";
      return;
    }

    round.nextTeam = undefined;
    const winners = TEAM_IDS.filter((teamId) => this.state.teams[teamId].progress >= ROOMS.length);
    this.state.phase = winners.length > 0 ? "game-over" : "round-summary";
  }

  private createRound(index: number): InternalRoundState {
    const emberWord = this.drawWord();
    const targetWords = {
      ember: emberWord,
      frost: this.drawWord([emberWord])
    } satisfies Record<TeamId, string>;

    const clueGivers = {
      ember: this.nextClueGiver("ember"),
      frost: this.nextClueGiver("frost")
    } satisfies Partial<Record<TeamId, string>>;

    return {
      index,
      targetWords,
      trapsForTeam: { ember: [], frost: [] },
      draftTrapsForTeam: { ember: [], frost: [] },
      teamMessages: { ember: [], frost: [] },
      trapLimitForTeam: {
        ember: this.currentRoomForTeam("ember").trapCount,
        frost: this.currentRoomForTeam("frost").trapCount
      },
      trapSubmittedByTeam: { ember: false, frost: false },
      turnReadyByTeam: { ember: false, frost: false },
      clueGivers,
      attempts: {}
    };
  }

  private nextClueGiver(team: TeamId) {
    const candidates = this.state.players
      .filter((player) => player.connected && player.team === team)
      .sort((a, b) => a.joinedAt - b.joinedAt);
    if (candidates.length === 0) return undefined;
    const index = this.state.teams[team].clueRotation % candidates.length;
    this.state.teams[team].clueRotation += 1;
    return candidates[index].id;
  }

  private firstTeamForRound(roundIndex: number): TeamId {
    const emberProgress = this.state.teams.ember.progress;
    const frostProgress = this.state.teams.frost.progress;
    if (emberProgress < frostProgress) return "ember";
    if (frostProgress < emberProgress) return "frost";
    return roundIndex % 2 === 1 ? "ember" : "frost";
  }

  private drawWord(excludedWords: string[] = []) {
    const deck = deckForMode(this.state.settings.deckMode, this.state.settings.wordSource, this.state.customWords);
    const excluded = new Set(excludedWords.map((word) => word.toLocaleLowerCase()));
    let freshDeck = deck.filter((word) => !this.state.usedWords.includes(word) && !excluded.has(word.toLocaleLowerCase()));
    if (freshDeck.length === 0) {
      this.state.usedWords = [];
      freshDeck = deck.filter((word) => !excluded.has(word.toLocaleLowerCase()));
    }
    const word = freshDeck[Math.floor(Math.random() * freshDeck.length)] ?? deck[0];
    this.state.usedWords.push(word);
    return word;
  }

  private currentRoomForTeam(team: TeamId) {
    const progress = this.state.teams[team].progress;
    return ROOMS[Math.min(progress, ROOMS.length - 1)];
  }

  private publicState(): PublicGameState {
    const round = this.state.round;
    return {
      id: this.state.id,
      phase: this.state.phase,
      settings: this.state.settings,
      players: this.state.players.map((player) => ({ ...player })),
      teams: cloneTeams(this.state.teams),
      rooms: ROOMS,
      round: round ? this.publicRound(round) : undefined,
      lobbyReadyByPlayer: { ...this.state.lobbyReadyByPlayer },
      log: [...this.state.log]
    };
  }

  private publicRound(round: InternalRoundState): PublicRoundState {
    const revealed = this.state.phase === "round-summary" || this.state.phase === "game-over";
    return {
      index: round.index,
      trapLimitForTeam: { ...round.trapLimitForTeam },
      clueGivers: { ...round.clueGivers },
      trapSubmittedByTeam: { ...round.trapSubmittedByTeam },
      turnReadyByTeam: { ...round.turnReadyByTeam },
      activeTeam: round.activeTeam,
      nextTeam: round.nextTeam,
      deadline: round.deadline,
      startedAt: round.startedAt,
      attempts: cloneAttempts(round.attempts),
      reveal: revealed
        ? {
            targetWords: { ...round.targetWords },
            trapsForTeam: {
              ember: [...round.trapsForTeam.ember],
              frost: [...round.trapsForTeam.frost]
            }
          }
        : undefined
    };
  }

  private privateView(player: Player) {
    const round = this.state.round;
    const view = {
      playerId: player.id,
      canHost: player.isHost,
      team: player.team,
      isClueGiver: false
    } satisfies PlayerView["private"];

    if (!round || !player.team) return view;

    if (this.state.phase === "trap-writing") {
      const targetTeam = otherTeam(player.team);
      return {
        ...view,
        writingForTeam: targetTeam,
        visibleTarget: round.targetWords[targetTeam],
        visibleTrapLimit: round.trapLimitForTeam[targetTeam],
        draftTraps: [...round.draftTrapsForTeam[targetTeam]],
        submittedTraps: round.trapSubmittedByTeam[player.team] ? round.trapsForTeam[targetTeam] : [],
        teamMessages: cloneMessages(round.teamMessages[player.team])
      };
    }

    if (this.state.phase === "clue" && round.activeTeam) {
      const activeTeam = round.activeTeam;
      const isClueGiver = round.clueGivers[activeTeam] === player.id;
      if (player.team === activeTeam) {
        return {
          ...view,
          isClueGiver,
          visibleTarget: isClueGiver ? round.targetWords[activeTeam] : undefined
        };
      }

      return {
        ...view,
        visibleTarget: round.targetWords[activeTeam],
        visibleTraps: round.trapsForTeam[activeTeam],
        visibleTrapLimit: round.trapLimitForTeam[activeTeam]
      };
    }

    return view;
  }

  private setTrapDraftForTeam(team: TeamId, targetTeam: TeamId, traps: string[], requireExact = true) {
    const round = this.requireRound();
    const limit = round.trapLimitForTeam[targetTeam];
    if (round.trapSubmittedByTeam[team]) throw new Error("Your team already sealed its trap book.");

    const cleaned = normalizeTraps(traps).slice(0, limit);
    if (requireExact && cleaned.length !== limit) throw new Error(`Write exactly ${limit} trap words.`);

    round.draftTrapsForTeam[targetTeam] = cleaned;
    return cleaned;
  }

  private ensureReadyToStart() {
    for (const team of TEAM_IDS) {
      const members = this.state.players.filter((player) => player.connected && player.team === team);
      if (members.length === 0) throw new Error(`${this.state.teams[team].name} needs at least one player.`);
    }

    for (const player of this.state.players) {
      if (!player.connected || !player.team) continue;
      if (!this.state.lobbyReadyByPlayer[player.id]) throw new Error(`${player.name} is not ready.`);
    }
  }

  private requireRound() {
    if (!this.state.round) throw new Error("No round is active.");
    return this.state.round;
  }

  private requirePlayer(playerId: string) {
    const player = this.state.players.find((candidate) => candidate.id === playerId);
    if (!player) throw new Error("Unknown player.");
    return player;
  }

  private requireTeam(player: Player) {
    if (!player.team) throw new Error("Choose a team first.");
    return player.team;
  }

  private requireHost(playerId: string) {
    const player = this.requirePlayer(playerId);
    if (!player.isHost) throw new Error("Only the host can do that.");
  }

  private applySetup(setup: GameSetup) {
    const customWords = setup.customWords ? normalizeCustomWords(setup.customWords) : this.state.customWords;
    const deckMode = parseDeckMode(setup.deckMode, this.state.settings.deckMode);
    const requestedSource = parseWordSource(setup.wordSource, this.state.settings.wordSource);
    const wordSource = requestedSource === "custom" && customWords.length === 0 ? "built-in" : requestedSource;
    this.state.customWords = customWords;
    this.state.settings = {
      deckMode,
      wordSource,
      timeLimitSec: clampNumber(setup.timeLimitSec, this.state.settings.timeLimitSec, 30, 180),
      maxRounds: clampNumber(setup.maxRounds, this.state.settings.maxRounds, 1, 12),
      customWordCount: customWords.length
    };
  }

  private ensureDeckReady() {
    const deck = deckForMode(this.state.settings.deckMode, this.state.settings.wordSource, this.state.customWords);
    if (deck.length < 2) throw new Error("Add at least 2 custom words or use built-in words.");
  }

  private createInitialState(settings: GameSetup): InternalState {
    const customWords = normalizeCustomWords(settings.customWords ?? []);
    const deckMode = parseDeckMode(settings.deckMode, DEFAULT_SETTINGS.deckMode);
    const requestedSource = parseWordSource(settings.wordSource, DEFAULT_SETTINGS.wordSource);
    const wordSource = requestedSource === "custom" && customWords.length === 0 ? "built-in" : requestedSource;
    return {
      id: Math.random().toString(36).slice(2),
      phase: "lobby",
      settings: {
        deckMode,
        wordSource,
        timeLimitSec: clampNumber(settings.timeLimitSec, DEFAULT_SETTINGS.timeLimitSec, 30, 180),
        maxRounds: clampNumber(settings.maxRounds, DEFAULT_SETTINGS.maxRounds, 1, 12),
        customWordCount: customWords.length
      },
      players: [],
      teams: {
        ember: {
          id: "ember",
          name: "Ember Guild",
          accent: "#ff8a3d",
          progress: 0,
          score: 0,
          clueRotation: 0
        },
        frost: {
          id: "frost",
          name: "Frost Order",
          accent: "#66d9ff",
          progress: 0,
          score: 0,
          clueRotation: 0
        }
      },
      lobbyReadyByPlayer: {},
      log: [],
      usedWords: [],
      customWords,
      messageCounter: 0
    };
  }

  private log(message: string) {
    this.state.log = [message, ...this.state.log].slice(0, 10);
  }
}

export function otherTeam(team: TeamId): TeamId {
  return team === "ember" ? "frost" : "ember";
}

function cleanName(name?: string) {
  return (name ?? "").trim().replace(/\s+/g, " ").slice(0, 24);
}

function cleanTrap(trap?: string) {
  return (trap ?? "").trim().replace(/\s+/g, " ").slice(0, 40) || undefined;
}

function cleanMessage(message: unknown) {
  if (typeof message !== "string") return "";
  return message.trim().replace(/\s+/g, " ").slice(0, 160);
}

function normalizeTraps(traps: string[]) {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const trap of traps) {
    const value = cleanTrap(trap);
    if (!value) continue;
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(value);
  }
  return cleaned;
}

function parseTeam(team: unknown): TeamId {
  if (team === "ember" || team === "frost") return team;
  throw new Error("Unknown team.");
}

function parseAttemptResult(result: unknown): AttemptResult {
  if (result === "correct" || result === "trap" || result === "timeout") return result;
  throw new Error("Unknown attempt result.");
}

function parseDeckMode(mode: unknown, fallback: GameSettings["deckMode"]): GameSettings["deckMode"] {
  if (mode === "mixed" || mode === "common" || mode === "arcane") return mode;
  return fallback;
}

function parseWordSource(source: unknown, fallback: GameSettings["wordSource"]): GameSettings["wordSource"] {
  if (source === "built-in" || source === "custom" || source === "combined") return source;
  return fallback;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function normalizeCustomWords(words: string[]) {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const word of words) {
    const value = word.trim().replace(/\s+/g, " ").slice(0, 48);
    if (value.length < 2) continue;
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(value);
  }
  return cleaned.slice(0, 300);
}

function cloneTeams(teams: Record<TeamId, TeamState>): Record<TeamId, TeamState> {
  return {
    ember: { ...teams.ember },
    frost: { ...teams.frost }
  };
}

function cloneAttempts(attempts: Partial<Record<TeamId, AttemptSummary>>): Partial<Record<TeamId, AttemptSummary>> {
  return {
    ...(attempts.ember ? { ember: { ...attempts.ember } } : {}),
    ...(attempts.frost ? { frost: { ...attempts.frost } } : {})
  };
}

function cloneMessages(messages: TeamMessage[]) {
  return messages.map((message) => ({ ...message }));
}
