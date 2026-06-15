import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { AttemptResult, ClientActionResult, DeckMode, GameSetup, HostStartResult, Player, PlayerView, TeamId, UpdateStatus, WordSource } from "./shared/types";
import { TEAM_IDS } from "./shared/types";
import torchUrl from "./assets/torch.svg";
import bookUrl from "./assets/spellbook.svg";
import monsterUrl from "./assets/monster.svg";
import trapUrl from "./assets/trap.svg";
import logoUrl from "./assets/logo-mark.svg";
import doorUrl from "./assets/room-door.svg";
import { DungeonBoard } from "./components/DungeonBoard";

type ConnectionMode = "home" | "connecting" | "connected";

interface UpdateActions {
  check: () => void;
  download: () => void;
  install: () => void;
}

const TEAM_LABEL: Record<TeamId, string> = {
  ember: "Ember Guild",
  frost: "Frost Order"
};

const TEAM_MOTTO: Record<TeamId, string> = {
  ember: "Fast clues. Hot guesses.",
  frost: "Cold reads. Sharp traps."
};

export default function App() {
  const [name, setName] = useState(() => localStorage.getItem("dwt:name") || "");
  const [joinAddress, setJoinAddress] = useState("");
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>("home");
  const [hostInfo, setHostInfo] = useState<HostStartResult | null>(null);
  const [view, setView] = useState<PlayerView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [customWordsText, setCustomWordsText] = useState(() => localStorage.getItem("dwt:customWords") || "");
  const [wordSource, setWordSource] = useState<WordSource>(() => parseStoredWordSource(localStorage.getItem("dwt:wordSource")));
  const [deckMode, setDeckMode] = useState<DeckMode>(() => parseStoredDeckMode(localStorage.getItem("dwt:deckMode")));
  const socketRef = useRef<Socket | null>(null);
  const updateCheckStartedRef = useRef(false);

  useEffect(() => {
    localStorage.setItem("dwt:name", name);
  }, [name]);

  useEffect(() => {
    localStorage.setItem("dwt:customWords", customWordsText);
  }, [customWordsText]);

  useEffect(() => {
    localStorage.setItem("dwt:wordSource", wordSource);
  }, [wordSource]);

  useEffect(() => {
    localStorage.setItem("dwt:deckMode", deckMode);
  }, [deckMode]);

  useEffect(() => {
    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  useEffect(() => {
    const updates = window.cursewords?.updates;
    if (!updates) return;

    let active = true;
    updates.getStatus().then((status) => {
      if (active) setUpdateStatus(status);
    }).catch(() => undefined);
    const unsubscribe = updates.onStatus((status) => setUpdateStatus(status));

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const canCheckForUpdates = connectionMode !== "connected" || view?.state.phase === "lobby" || view?.state.phase === "game-over";

  useEffect(() => {
    const updates = window.cursewords?.updates;
    if (!updates || !canCheckForUpdates || updateCheckStartedRef.current) return;
    updateCheckStartedRef.current = true;
    updates.check().then((status) => setUpdateStatus(status)).catch((error) => setNotice(errorMessage(error)));
  }, [canCheckForUpdates]);

  async function hostGame() {
    if (!window.cursewords) {
      setNotice("Host mode requires the desktop executable.");
      return;
    }
    setConnectionMode("connecting");
    try {
      const info = await window.cursewords.startHost();
      setHostInfo(info);
      connectTo(`http://127.0.0.1:${info.port}`, info.hostToken);
    } catch (error) {
      setConnectionMode("home");
      setNotice(errorMessage(error));
    }
  }

  function joinGame() {
    const normalized = normalizeAddress(joinAddress);
    if (!normalized) {
      setNotice("Enter the host address shown on the host screen, for example 192.168.1.20:4949.");
      return;
    }
    setConnectionMode("connecting");
    connectTo(normalized);
  }

  function connectTo(endpoint: string, hostToken?: string) {
    socketRef.current?.disconnect();
    const socket = io(endpoint, {
      transports: ["websocket", "polling"],
      reconnectionAttempts: 8,
      reconnectionDelay: 600
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      socket.emit("join", { name: name || undefined, hostToken }, (result: ClientActionResult) => {
        if (!result.ok) setNotice(result.error ?? "Could not join game.");
      });
      setConnectionMode("connected");
    });
    socket.on("view", (nextView: PlayerView) => setView(nextView));
    socket.on("notice", (message: string) => setNotice(message));
    socket.on("connect_error", (error) => {
      setConnectionMode("home");
      setNotice(error.message);
    });
    socket.on("disconnect", () => {
      setNotice("Disconnected from the dungeon host.");
    });
  }

  function action(event: string, payload: unknown = {}) {
    const socket = socketRef.current;
    if (!socket?.connected) {
      setNotice("Not connected.");
      return;
    }
    socket.emit(event, payload, (result: ClientActionResult) => {
      if (!result.ok) setNotice(result.error ?? "Action failed.");
    });
  }

  function leave() {
    socketRef.current?.disconnect();
    socketRef.current = null;
    setView(null);
    setHostInfo(null);
    setConnectionMode("home");
  }

  function checkForUpdates() {
    window.cursewords?.updates.check().then((status) => setUpdateStatus(status)).catch((error) => setNotice(errorMessage(error)));
  }

  function downloadUpdate() {
    window.cursewords?.updates.download().then((status) => setUpdateStatus(status)).catch((error) => setNotice(errorMessage(error)));
  }

  function installUpdate() {
    window.cursewords?.updates.install().catch((error) => setNotice(errorMessage(error)));
  }

  const updateActions = {
    check: checkForUpdates,
    download: downloadUpdate,
    install: installUpdate
  } satisfies UpdateActions;

  if (connectionMode !== "connected" || !view) {
    return (
      <Shell notice={notice} clearNotice={() => setNotice(null)} updateStatus={updateStatus} updateActions={updateActions}>
        <HomeScreen
          name={name}
          setName={setName}
          joinAddress={joinAddress}
          setJoinAddress={setJoinAddress}
          connectionMode={connectionMode}
          hostGame={hostGame}
          joinGame={joinGame}
        />
      </Shell>
    );
  }

  return (
    <Shell notice={notice} clearNotice={() => setNotice(null)} updateStatus={updateStatus} updateActions={updateActions}>
      <GameScreen
        view={view}
        hostInfo={hostInfo}
        name={name}
        setName={setName}
        customWordsText={customWordsText}
        setCustomWordsText={setCustomWordsText}
        wordSource={wordSource}
        setWordSource={setWordSource}
        deckMode={deckMode}
        setDeckMode={setDeckMode}
        action={action}
        leave={leave}
      />
    </Shell>
  );
}

function Shell({
  children,
  notice,
  clearNotice,
  updateStatus,
  updateActions
}: {
  children: React.ReactNode;
  notice: string | null;
  clearNotice: () => void;
  updateStatus: UpdateStatus | null;
  updateActions: UpdateActions;
}) {
  return (
    <div className="app-shell">
      <div className="mist mist-a" />
      <div className="mist mist-b" />
      <div className="torch-glow torch-glow-left" />
      <div className="torch-glow torch-glow-right" />
      {children}
      <UpdateBanner status={updateStatus} actions={updateActions} />
      {notice && (
        <button className="notice" onClick={clearNotice} type="button">
          {notice}
        </button>
      )}
    </div>
  );
}

function UpdateBanner({ status, actions }: { status: UpdateStatus | null; actions: UpdateActions }) {
  if (!status || !["available", "downloading", "downloaded"].includes(status.type)) return null;

  const title = status.type === "downloaded" ? "Update ready" : status.type === "downloading" ? "Downloading update" : "Update available";
  const percent = status.percent ?? 0;

  return (
    <aside className={`update-banner ${status.type}`} role="status" aria-live="polite">
      <div>
        <strong>{title}</strong>
        <span>{status.message ?? "A Cursewords update is available."}</span>
        {status.type === "downloading" && (
          <div className="update-progress" aria-label={`Download ${percent}% complete`}>
            <i style={{ width: `${percent}%` }} />
          </div>
        )}
      </div>
      {status.type === "available" && <button className="secondary-button small" onClick={actions.download} type="button">Download</button>}
      {status.type === "downloaded" && <button className="primary-button small" onClick={actions.install} type="button">Restart</button>}
    </aside>
  );
}

function HomeScreen(props: {
  name: string;
  setName: (name: string) => void;
  joinAddress: string;
  setJoinAddress: (address: string) => void;
  connectionMode: ConnectionMode;
  hostGame: () => void;
  joinGame: () => void;
}) {
  return (
    <main className="home-screen">
      <section className="hero-card">
        <img className="logo-mark" src={logoUrl} alt="Cursewords mark" />
        <p className="eyebrow">LAN party word game</p>
        <h1>Cursewords</h1>
        <p className="hero-copy">
          Two rival adventuring teams write secret verbal traps, then race to describe dangerous words without stepping on them.
        </p>
        <div className="home-grid">
          <label className="field">
            Player name
            <input value={props.name} onChange={(event) => props.setName(event.target.value)} placeholder="Your table name" />
          </label>
          <div className="home-actions">
            <button className="primary-button" onClick={props.hostGame} disabled={props.connectionMode === "connecting"} type="button">
              Host LAN Delve
            </button>
            <div className="join-row">
              <input
                value={props.joinAddress}
                onChange={(event) => props.setJoinAddress(event.target.value)}
                placeholder="Host IP:port"
                onKeyDown={(event) => {
                  if (event.key === "Enter") props.joinGame();
                }}
              />
              <button className="secondary-button" onClick={props.joinGame} disabled={props.connectionMode === "connecting"} type="button">
                Join
              </button>
            </div>
          </div>
        </div>
      </section>
      <section className="feature-rail">
        <Feature icon={bookUrl} title="Secret Books" copy="Trap teams see the target and write forbidden words privately." />
        <Feature icon={torchUrl} title="Torch Timer" copy="The clue-giver races the flame while the other team watches for traps." />
        <Feature icon={monsterUrl} title="Dungeon Run" copy="Rooms become harder until a boss door demands the nastiest trap list." />
      </section>
    </main>
  );
}

function Feature({ icon, title, copy }: { icon: string; title: string; copy: string }) {
  return (
    <article className="feature-card">
      <img src={icon} alt="" />
      <div>
        <h3>{title}</h3>
        <p>{copy}</p>
      </div>
    </article>
  );
}

function GameScreen(props: {
  view: PlayerView;
  hostInfo: HostStartResult | null;
  name: string;
  setName: (name: string) => void;
  customWordsText: string;
  setCustomWordsText: (text: string) => void;
  wordSource: WordSource;
  setWordSource: (source: WordSource) => void;
  deckMode: DeckMode;
  setDeckMode: (mode: DeckMode) => void;
  action: (event: string, payload?: unknown) => void;
  leave: () => void;
}) {
  const { state } = props.view;
  const self = state.players.find((player) => player.id === props.view.private.playerId);

  return (
    <main className="game-screen">
      <header className="top-bar">
        <div className="brand-lockup">
          <img src={logoUrl} alt="" />
          <div>
            <strong>Cursewords</strong>
            <span>{phaseTitle(state.phase)}</span>
          </div>
        </div>
        <div className="top-actions">
          <span className="pill">{self?.name ?? "Unknown"}</span>
          <button className="ghost-button" onClick={props.leave} type="button">Leave</button>
        </div>
      </header>

      {state.phase === "lobby" ? (
        <Lobby
          view={props.view}
          hostInfo={props.hostInfo}
          name={props.name}
          setName={props.setName}
          customWordsText={props.customWordsText}
          setCustomWordsText={props.setCustomWordsText}
          wordSource={props.wordSource}
          setWordSource={props.setWordSource}
          deckMode={props.deckMode}
          setDeckMode={props.setDeckMode}
          action={props.action}
        />
      ) : (
        <div className="play-layout">
          <section className="board-column">
            <DungeonBoard view={props.view} />
          </section>
          <section className="center-column">
            <PhasePanel view={props.view} action={props.action} />
          </section>
          <aside className="right-column">
            <TeamPanel team="ember" view={props.view} action={props.action} />
            <TeamPanel team="frost" view={props.view} action={props.action} />
            <EventLog log={state.log} />
          </aside>
        </div>
      )}
    </main>
  );
}

function Lobby(props: {
  view: PlayerView;
  hostInfo: HostStartResult | null;
  name: string;
  setName: (name: string) => void;
  customWordsText: string;
  setCustomWordsText: (text: string) => void;
  wordSource: WordSource;
  setWordSource: (source: WordSource) => void;
  deckMode: DeckMode;
  setDeckMode: (mode: DeckMode) => void;
  action: (event: string, payload?: unknown) => void;
}) {
  const state = props.view.state;
  const playersByTeam = useMemo(() => groupPlayersByTeam(state.players), [state.players]);
  const setup = buildGameSetup(props.deckMode, props.wordSource, props.customWordsText);
  const canUseDeck = canStartWithCustomWords(props.wordSource, props.customWordsText);
  const startDisabled = !props.view.private.canHost || !canUseDeck;

  return (
    <section className="lobby-grid">
      <div className="lobby-card invite-card">
        <img src={doorUrl} alt="" />
        <h2>Gather the table</h2>
        <p>Everyone opens the executable, clicks Join, and enters one of the host addresses below.</p>
        <div className="address-list">
          {(props.hostInfo?.addresses ?? ["Ask the host for their address"]).map((address) => (
            <code key={address}>{address}</code>
          ))}
        </div>
        <label className="field compact">
          Your display name
          <div className="join-row">
            <input value={props.name} onChange={(event) => props.setName(event.target.value)} />
            <button className="secondary-button" onClick={() => props.action("setName", { name: props.name })} type="button">Save</button>
          </div>
        </label>
      </div>

      {TEAM_IDS.map((team) => (
        <div className={`lobby-card team-lobby ${team}`} key={team}>
          <p className="eyebrow">Team</p>
          <h2>{TEAM_LABEL[team]}</h2>
          <p>{TEAM_MOTTO[team]}</p>
          <button className="primary-button small" onClick={() => props.action("chooseTeam", { team })} type="button">
            Join {TEAM_LABEL[team]}
          </button>
          <div className="player-stack">
            {playersByTeam[team].map((player) => <PlayerBadge player={player} key={player.id} />)}
            {playersByTeam[team].length === 0 && <span className="empty-slot">No adventurers yet</span>}
          </div>
        </div>
      ))}

      <div className="lobby-card start-card">
        <img src={trapUrl} alt="" />
        <h2>Host Controls</h2>
        <p>Start when both teams have players. Real play is best with at least two per team.</p>
        <button
          className="primary-button lobby-start-button"
          disabled={startDisabled}
          onClick={() => props.action("startGame", { settings: setup })}
          type="button"
        >
          Start Dungeon
        </button>
        <CustomWordsPanel
          canHost={props.view.private.canHost}
          customWordsText={props.customWordsText}
          setCustomWordsText={props.setCustomWordsText}
          wordSource={props.wordSource}
          setWordSource={props.setWordSource}
          deckMode={props.deckMode}
          setDeckMode={props.setDeckMode}
        />
        <button
          className="primary-button lobby-start-button secondary-start"
          disabled={startDisabled}
          onClick={() => props.action("startGame", { settings: setup })}
          type="button"
        >
          Start Dungeon
        </button>
      </div>
    </section>
  );
}

function CustomWordsPanel(props: {
  canHost: boolean;
  customWordsText: string;
  setCustomWordsText: (text: string) => void;
  wordSource: WordSource;
  setWordSource: (source: WordSource) => void;
  deckMode: DeckMode;
  setDeckMode: (mode: DeckMode) => void;
}) {
  const customWords = parseCustomWords(props.customWordsText);
  return (
    <div className="custom-words-panel">
      <div className="settings-grid">
        <label className="field compact">
          Word source
          <select
            value={props.wordSource}
            disabled={!props.canHost}
            onChange={(event) => props.setWordSource(event.target.value as WordSource)}
          >
            <option value="built-in">Built-in only</option>
            <option value="combined">Built-in + custom</option>
            <option value="custom">Custom only</option>
          </select>
        </label>
        <label className="field compact">
          Built-in deck
          <select
            value={props.deckMode}
            disabled={!props.canHost || props.wordSource === "custom"}
            onChange={(event) => props.setDeckMode(event.target.value as DeckMode)}
          >
            <option value="mixed">Mixed</option>
            <option value="common">Everyday</option>
            <option value="arcane">Fantasy</option>
          </select>
        </label>
      </div>
      <label className="field compact">
        Custom words
        {props.wordSource === "built-in" ? (
          <div className="custom-word-collapsed">Switch to Built-in + custom or Custom only to paste your own word list.</div>
        ) : (
          <textarea
            className="custom-word-input"
            value={props.customWordsText}
            disabled={!props.canHost}
            onChange={(event) => props.setCustomWordsText(event.target.value)}
            placeholder={"One word or phrase per line\nPizza Planet\nLaser Sword\nGrandma's Attic"}
          />
        )}
      </label>
      <p className="custom-word-summary">
        {props.canHost ? `${customWords.length} custom words saved on this PC.` : "Only the host controls the word deck."}
        {props.wordSource === "custom" && customWords.length < 2 ? " Add at least 2 custom words for custom-only mode." : ""}
      </p>
    </div>
  );
}

function PhasePanel({ view, action }: { view: PlayerView; action: (event: string, payload?: unknown) => void }) {
  const { state } = view;
  if (!state.round) return null;

  if (state.phase === "trap-writing") return <TrapWriting view={view} action={action} />;
  if (state.phase === "between-turns") return <BetweenTurns view={view} action={action} />;
  if (state.phase === "clue") return <ClueAttempt view={view} action={action} />;
  if (state.phase === "round-summary") return <RoundSummary view={view} action={action} />;
  if (state.phase === "game-over") return <GameOver view={view} action={action} />;
  return null;
}

function TrapWriting({ view, action }: { view: PlayerView; action: (event: string, payload?: unknown) => void }) {
  const limit = view.private.visibleTrapLimit ?? 0;
  const [draft, setDraft] = useState("");
  const traps = parseTrapDraft(draft).slice(0, limit);
  const targetTeam = view.private.writingForTeam;
  const submitted = (view.private.submittedTraps?.length ?? 0) > 0;

  useEffect(() => {
    setDraft("");
  }, [view.state.round?.index, targetTeam]);

  return (
    <section className="phase-card spellbook-card">
      <img className="phase-icon" src={bookUrl} alt="" />
      <p className="eyebrow">Trap writing</p>
      {targetTeam ? (
        <>
          <h2>Rig the word for {TEAM_LABEL[targetTeam]}</h2>
          <SecretWord word={view.private.visibleTarget} label="Their target word" />
          <p className="phase-copy">Write exactly {limit} traps. If their clue-giver says one, your team can spring it.</p>
          <textarea
            value={draft}
            disabled={submitted}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={`One trap per line\n${Array.from({ length: limit }, (_, index) => `Trap ${index + 1}`).join("\n")}`}
          />
          <div className="trap-meter"><span>{traps.length}</span> / {limit} traps ready</div>
          <button
            className="primary-button"
            disabled={submitted || traps.length !== limit}
            onClick={() => action("submitTraps", { traps })}
            type="button"
          >
            Seal Trap Book
          </button>
          {submitted && <p className="success-text">Your trap book is sealed. Waiting for the other team.</p>}
        </>
      ) : (
        <>
          <h2>Choose a team to write traps.</h2>
          <p className="phase-copy">The dungeon will not reveal a target until you join a side.</p>
        </>
      )}
    </section>
  );
}

function BetweenTurns({ view, action }: { view: PlayerView; action: (event: string, payload?: unknown) => void }) {
  const nextTeam = view.state.round?.nextTeam;
  const clueGiver = nextTeam ? findPlayer(view, view.state.round?.clueGivers[nextTeam]) : undefined;
  const room = nextTeam ? view.state.rooms[Math.min(view.state.teams[nextTeam].progress, view.state.rooms.length - 1)] : undefined;
  return (
    <section className="phase-card">
      <img className="phase-icon" src={torchUrl} alt="" />
      <p className="eyebrow">Next torch</p>
      <h2>{nextTeam ? `${TEAM_LABEL[nextTeam]} prepares to clue` : "Waiting"}</h2>
      <p className="phase-copy">Clue-giver: <strong>{clueGiver?.name ?? "No connected player"}</strong></p>
      {room && <p className="curse-line">Room curse: {room.curse}</p>}
      <button className="primary-button" disabled={!view.private.canHost || !nextTeam} onClick={() => action("beginClue", { team: nextTeam })} type="button">
        Begin Clue Timer
      </button>
    </section>
  );
}

function ClueAttempt({ view, action }: { view: PlayerView; action: (event: string, payload?: unknown) => void }) {
  const round = view.state.round!;
  const activeTeam = round.activeTeam!;
  const clueGiver = findPlayer(view, round.clueGivers[activeTeam]);
  const playerTeam = view.private.team;
  const isActiveTeam = playerTeam === activeTeam;
  const isOpponent = playerTeam && playerTeam !== activeTeam;
  const [calledTrap, setCalledTrap] = useState("");

  return (
    <section className={`phase-card clue-card ${activeTeam}`}>
      <img className="phase-icon" src={torchUrl} alt="" />
      <p className="eyebrow">Clue attempt</p>
      <h2>{TEAM_LABEL[activeTeam]} is guessing</h2>
      <Timer deadline={round.deadline} serverTime={view.serverTime} />
      <p className="phase-copy">Clue-giver: <strong>{clueGiver?.name ?? "Unknown"}</strong></p>

      {view.private.isClueGiver && <SecretWord word={view.private.visibleTarget} label="Your word" urgent />}
      {isActiveTeam && !view.private.isClueGiver && (
        <div className="blind-card">
          <h3>Guess. Do not peek.</h3>
          <p>Your clue-giver sees the word. Listen for clues and shout guesses.</p>
        </div>
      )}
      {isOpponent && (
        <div className="trap-watch">
          <SecretWord word={view.private.visibleTarget} label="Target you are guarding" />
          <div className="trap-list">
            {(view.private.visibleTraps ?? []).map((trap) => <button key={trap} onClick={() => setCalledTrap(trap)} type="button">{trap}</button>)}
          </div>
          <input value={calledTrap} onChange={(event) => setCalledTrap(event.target.value)} placeholder="Called trap" />
        </div>
      )}

      <div className="resolution-row">
        <button className="primary-button" disabled={!isActiveTeam && !view.private.canHost} onClick={() => action("resolveAttempt", { result: "correct" })} type="button">
          Correct Guess
        </button>
        <button className="danger-button" disabled={!isOpponent && !view.private.canHost} onClick={() => action("resolveAttempt", { result: "trap", trap: calledTrap })} type="button">
          Trap Sprung
        </button>
        <button className="secondary-button" disabled={!view.private.canHost} onClick={() => action("resolveAttempt", { result: "timeout" })} type="button">
          Time Up
        </button>
      </div>
    </section>
  );
}

function RoundSummary({ view, action }: { view: PlayerView; action: (event: string, payload?: unknown) => void }) {
  const round = view.state.round!;
  return (
    <section className="phase-card summary-card">
      <img className="phase-icon" src={trapUrl} alt="" />
      <p className="eyebrow">Round complete</p>
      <h2>Trap books opened</h2>
      <RevealGrid view={view} />
      <div className="attempt-grid">
        {TEAM_IDS.map((team) => <AttemptResultCard key={team} team={team} attempt={round.attempts[team]} />)}
      </div>
      <button className="primary-button" disabled={!view.private.canHost} onClick={() => action("nextRound")} type="button">
        Descend to Next Room
      </button>
    </section>
  );
}

function GameOver({ view, action }: { view: PlayerView; action: (event: string, payload?: unknown) => void }) {
  const winners = TEAM_IDS.filter((team) => view.state.teams[team].progress >= view.state.rooms.length);
  const fallbackWinner = TEAM_IDS.slice().sort((a, b) => view.state.teams[b].score - view.state.teams[a].score)[0];
  const title = winners.length > 0 ? winners.map((team) => TEAM_LABEL[team]).join(" and ") : TEAM_LABEL[fallbackWinner];
  return (
    <section className="phase-card game-over-card">
      <img className="phase-icon boss" src={monsterUrl} alt="" />
      <p className="eyebrow">Dungeon cleared</p>
      <h2>{title} wins the delve</h2>
      <RevealGrid view={view} />
      <div className="score-row">
        {TEAM_IDS.map((team) => (
          <div className={`score-card ${team}`} key={team}>
            <span>{TEAM_LABEL[team]}</span>
            <strong>{view.state.teams[team].score}</strong>
            <small>rooms solved</small>
          </div>
        ))}
      </div>
      <button className="primary-button" disabled={!view.private.canHost} onClick={() => action("resetGame")} type="button">
        Reset to Lobby
      </button>
    </section>
  );
}

function RevealGrid({ view }: { view: PlayerView }) {
  const reveal = view.state.round?.reveal;
  if (!reveal) return null;
  return (
    <div className="reveal-grid">
      {TEAM_IDS.map((team) => (
        <article className={`reveal-card ${team}`} key={team}>
          <span>{TEAM_LABEL[team]}</span>
          <strong>{reveal.targetWords[team]}</strong>
          <div className="trap-chips">
            {reveal.trapsForTeam[team].map((trap) => <em key={trap}>{trap}</em>)}
          </div>
        </article>
      ))}
    </div>
  );
}

function TeamPanel({ team, view, action }: { team: TeamId; view: PlayerView; action: (event: string, payload?: unknown) => void }) {
  const members = view.state.players.filter((player) => player.team === team);
  const teamState = view.state.teams[team];
  const clueGiverId = view.state.round?.clueGivers[team];
  return (
    <section className={`panel team-panel ${team}`}>
      <div className="panel-heading">
        <span>{TEAM_LABEL[team]}</span>
        <strong>{teamState.score}</strong>
      </div>
      <div className="progress-bar"><span style={{ width: `${(teamState.progress / view.state.rooms.length) * 100}%` }} /></div>
      <div className="player-stack">
        {members.map((player) => <PlayerBadge player={player} key={player.id} active={player.id === clueGiverId} />)}
        {members.length === 0 && <span className="empty-slot">No players</span>}
      </div>
      {view.state.phase === "lobby" && (
        <button className="secondary-button small" onClick={() => action("chooseTeam", { team })} type="button">Join</button>
      )}
    </section>
  );
}

function EventLog({ log }: { log: string[] }) {
  return (
    <section className="panel event-log">
      <div className="panel-heading"><span>Table Log</span></div>
      {log.length === 0 ? <p>No dungeon events yet.</p> : log.map((entry, index) => <p key={`${index}-${entry}`}>{entry}</p>)}
    </section>
  );
}

function PlayerBadge({ player, active = false }: { player: Player; active?: boolean }) {
  return (
    <div className={`player-badge ${player.connected ? "connected" : "offline"} ${active ? "active" : ""}`}>
      <span>{player.name}</span>
      {player.isHost && <em>host</em>}
      {active && <em>clue</em>}
    </div>
  );
}

function SecretWord({ word, label, urgent = false }: { word?: string; label: string; urgent?: boolean }) {
  return (
    <div className={`secret-word ${urgent ? "urgent" : ""}`}>
      <span>{label}</span>
      <strong>{word ?? "Hidden"}</strong>
    </div>
  );
}

function Timer({ deadline, serverTime }: { deadline?: number; serverTime: number }) {
  const [now, setNow] = useState(Date.now());
  const [clockOffset, setClockOffset] = useState(() => Date.now() - serverTime);

  useEffect(() => {
    setClockOffset(Date.now() - serverTime);
  }, [serverTime, deadline]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(interval);
  }, []);
  const estimatedServerNow = now - clockOffset;
  const remaining = Math.max(0, Math.ceil(((deadline ?? serverTime) - estimatedServerNow) / 1000));
  const danger = remaining <= 10;
  return (
    <div className={`timer ${danger ? "danger" : ""}`}>
      <img src={torchUrl} alt="" />
      <strong>{remaining}</strong>
      <span>seconds</span>
    </div>
  );
}

function AttemptResultCard({ team, attempt }: { team: TeamId; attempt?: { result: AttemptResult; trap?: string } }) {
  return (
    <article className={`attempt-card ${team} ${attempt?.result ?? "pending"}`}>
      <span>{TEAM_LABEL[team]}</span>
      <strong>{attempt ? resultLabel(attempt.result) : "Pending"}</strong>
      {attempt?.trap && <small>Trap: {attempt.trap}</small>}
    </article>
  );
}

function groupPlayersByTeam(players: Player[]) {
  return {
    ember: players.filter((player) => player.team === "ember"),
    frost: players.filter((player) => player.team === "frost")
  } satisfies Record<TeamId, Player[]>;
}

function findPlayer(view: PlayerView, playerId?: string) {
  return view.state.players.find((player) => player.id === playerId);
}

function normalizeAddress(address: string) {
  const trimmed = address.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return `http://${trimmed}`;
}

function parseTrapDraft(draft: string) {
  return draft
    .split(/[\n,]/g)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseCustomWords(text: string) {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const line of text.split(/\r?\n/g)) {
    const word = line.trim().replace(/\s+/g, " ").slice(0, 48);
    if (word.length < 2) continue;
    const key = word.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    words.push(word);
  }
  return words.slice(0, 300);
}

function buildGameSetup(deckMode: DeckMode, wordSource: WordSource, customWordsText: string): GameSetup {
  return {
    deckMode,
    wordSource,
    customWords: parseCustomWords(customWordsText)
  };
}

function canStartWithCustomWords(wordSource: WordSource, customWordsText: string) {
  return wordSource !== "custom" || parseCustomWords(customWordsText).length >= 2;
}

function parseStoredWordSource(value: string | null): WordSource {
  if (value === "built-in" || value === "custom" || value === "combined") return value;
  return "built-in";
}

function parseStoredDeckMode(value: string | null): DeckMode {
  if (value === "mixed" || value === "common" || value === "arcane") return value;
  return "mixed";
}

function phaseTitle(phase: string) {
  return phase.replace(/-/g, " ");
}

function resultLabel(result: AttemptResult) {
  if (result === "correct") return "Solved";
  if (result === "trap") return "Trapped";
  return "Torch Out";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected error.";
}
