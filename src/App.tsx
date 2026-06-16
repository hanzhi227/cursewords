import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { AttemptResult, ClientActionResult, DeckMode, GameSetup, Player, PlayerView, RoomCreateResult, TeamId, TeamMessage, WordSource } from "./shared/types";
import { normalizeRoomCode } from "./shared/roomCode";
import { TEAM_IDS } from "./shared/types";
import torchUrl from "./assets/torch.svg";
import bookUrl from "./assets/spellbook.svg";
import monsterUrl from "./assets/monster.svg";
import trapUrl from "./assets/trap.svg";
import logoUrl from "./assets/logo-mark.svg";
import doorUrl from "./assets/room-door.svg";

const DungeonBoard = lazy(() => import("./components/DungeonBoard").then((module) => ({ default: module.DungeonBoard })));

type ConnectionMode = "home" | "connecting" | "connected";
type AuthConfig = {
  passwordRequired: boolean;
};

const TEAM_LABEL: Record<TeamId, string> = {
  ember: "Ember Guild",
  frost: "Frost Order"
};

const TEAM_MOTTO: Record<TeamId, string> = {
  ember: "Fast clues. Hot guesses.",
  frost: "Cold reads. Sharp traps."
};

const PLAYER_TOKEN_PREFIX = "dwt:playerToken:";
const HOST_TOKEN_PREFIX = "dwt:hostToken:";

export default function App() {
  const [name, setName] = useState(() => localStorage.getItem("dwt:name") || "");
  const [playPassword, setPlayPassword] = useState(() => localStorage.getItem("dwt:playPassword") || "");
  const [passwordDraft, setPasswordDraft] = useState("");
  const [passwordRequired, setPasswordRequired] = useState<boolean | null>(null);
  const [roomCode, setRoomCode] = useState("");
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>("home");
  const [roomInfo, setRoomInfo] = useState<RoomCreateResult | null>(null);
  const [view, setView] = useState<PlayerView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [customWordsText, setCustomWordsText] = useState(() => localStorage.getItem("dwt:customWords") || "");
  const [wordSource, setWordSource] = useState<WordSource>(() => parseStoredWordSource(localStorage.getItem("dwt:wordSource")));
  const [deckMode, setDeckMode] = useState<DeckMode>(() => parseStoredDeckMode(localStorage.getItem("dwt:deckMode")));
  const socketRef = useRef<Socket | null>(null);
  const roomInfoRef = useRef(roomInfo);
  const nameRef = useRef(name);
  const joinedRoomRef = useRef(false);
  const joiningRoomRef = useRef(false);
  const rejoinCurrentRoomRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    roomInfoRef.current = roomInfo;
  }, [roomInfo]);

  useEffect(() => {
    nameRef.current = name;
  }, [name]);

  useEffect(() => {
    localStorage.setItem("dwt:name", name);
  }, [name]);

  useEffect(() => {
    fetch("/auth-config")
      .then((response) => {
        if (!response.ok) throw new Error("Could not check password settings.");
        return response.json() as Promise<AuthConfig>;
      })
      .then((config) => setPasswordRequired(Boolean(config.passwordRequired)))
      .catch(() => {
        setPasswordRequired(true);
        setNotice("Could not check the play password gate.");
      });
  }, []);

  useEffect(() => {
    if (playPassword) {
      localStorage.setItem("dwt:playPassword", playPassword);
      return;
    }
    localStorage.removeItem("dwt:playPassword");
  }, [playPassword]);

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

  async function rejoinCurrentRoom() {
    const socket = socketRef.current;
    const info = roomInfoRef.current;
    if (!socket?.connected || !info?.roomCode || joiningRoomRef.current) return;

    const normalized = normalizeRoomCode(info.roomCode);
    const playerToken = getStoredPlayerToken(normalized);
    if (!playerToken) return;

    const hostToken = info.hostToken || getStoredHostToken(normalized);

    try {
      await emitJoinRoom(socket, normalized, nameRef.current, playerToken, hostToken);
      setNotice(null);
    } catch (error) {
      joinedRoomRef.current = false;
      socket.disconnect();
      socketRef.current = null;
      setConnectionMode("home");
      setView(null);
      setRoomInfo(null);
      setNotice(errorMessage(error));
    }
  }

  rejoinCurrentRoomRef.current = rejoinCurrentRoom;

  function bindSocket(socket: Socket) {
    socket.on("view", (nextView: PlayerView) => setView(nextView));
    socket.on("notice", (message: string) => setNotice(message));
    socket.on("connect", () => {
      if (!joinedRoomRef.current || joiningRoomRef.current) return;
      void rejoinCurrentRoomRef.current();
    });
    socket.on("connect_error", (error) => {
      if (error.message.toLowerCase().includes("password")) {
        lockPlayPassword(error.message);
        return;
      }
      if (joinedRoomRef.current) {
        setNotice("Connection lost. Reconnecting...");
        return;
      }
      setConnectionMode("home");
      setNotice(error.message);
    });
    socket.on("disconnect", (reason) => {
      if (reason === "io client disconnect") return;
      setNotice("Connection lost. Reconnecting...");
    });
    socket.io.on("reconnect_failed", () => {
      if (!joinedRoomRef.current) return;
      joinedRoomRef.current = false;
      setConnectionMode("home");
      setView(null);
      setRoomInfo(null);
      setNotice("Could not reconnect to the dungeon.");
    });
  }

  function connectSocket() {
    socketRef.current?.disconnect();
    const socket = io({
      auth: playPassword ? { playPassword } : {},
      transports: ["websocket", "polling"],
      reconnectionAttempts: 8,
      reconnectionDelay: 600
    });
    socketRef.current = socket;
    bindSocket(socket);
    return socket;
  }

  async function waitForSocket(socket: Socket) {
    if (socket.connected) return;
    await new Promise<void>((resolve, reject) => {
      const onConnect = () => {
        socket.off("connect_error", onError);
        resolve();
      };
      const onError = (error: Error) => {
        socket.off("connect", onConnect);
        reject(error);
      };
      socket.once("connect", onConnect);
      socket.once("connect_error", onError);
    });
  }

  async function createRoom() {
    if (passwordRequired && !playPassword) {
      setNotice("Enter the play password first.");
      return;
    }

    setConnectionMode("connecting");
    joiningRoomRef.current = true;
    try {
      const playerToken = createPlayerToken();
      const socket = connectSocket();
      await waitForSocket(socket);

      const info = await new Promise<RoomCreateResult>((resolve, reject) => {
        socket.emit("createRoom", { name: name || undefined, playerToken }, (result: RoomCreateResult | ClientActionResult) => {
          if ("roomCode" in result && result.roomCode) {
            resolve(result);
            return;
          }
          reject(new Error("error" in result ? result.error ?? "Could not create room." : "Could not create room."));
        });
      });

      storePlayerToken(info.roomCode, playerToken);
      storeHostToken(info.roomCode, info.hostToken);
      setRoomInfo(info);
      joinedRoomRef.current = true;
      setConnectionMode("connected");
    } catch (error) {
      joinedRoomRef.current = false;
      socketRef.current?.disconnect();
      socketRef.current = null;
      setConnectionMode("home");
      setNotice(errorMessage(error));
    } finally {
      joiningRoomRef.current = false;
    }
  }

  async function joinRoom() {
    if (passwordRequired && !playPassword) {
      setNotice("Enter the play password first.");
      return;
    }

    const normalized = normalizeRoomCode(roomCode);
    if (!normalized) {
      setNotice("Enter the 6-character room code from the host.");
      return;
    }

    setConnectionMode("connecting");
    joiningRoomRef.current = true;
    try {
      const playerToken = getStoredPlayerToken(normalized) ?? createPlayerToken();
      const hostToken = getStoredHostToken(normalized);
      const socket = connectSocket();
      await waitForSocket(socket);

      await emitJoinRoom(socket, normalized, name, playerToken, hostToken);

      storePlayerToken(normalized, playerToken);
      setRoomInfo({ roomCode: normalized, hostToken: hostToken ?? "" });
      joinedRoomRef.current = true;
      setConnectionMode("connected");
    } catch (error) {
      joinedRoomRef.current = false;
      socketRef.current?.disconnect();
      socketRef.current = null;
      setConnectionMode("home");
      setNotice(errorMessage(error));
    } finally {
      joiningRoomRef.current = false;
    }
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
    joinedRoomRef.current = false;
    socketRef.current?.disconnect();
    socketRef.current = null;
    setView(null);
    setRoomInfo(null);
    setConnectionMode("home");
  }

  function unlockPlayPassword() {
    const password = passwordDraft.trim();
    if (!password) {
      setNotice("Enter the play password.");
      return;
    }
    setPlayPassword(password);
    setPasswordDraft("");
    setNotice(null);
  }

  function lockPlayPassword(message: string) {
    joinedRoomRef.current = false;
    socketRef.current?.disconnect();
    socketRef.current = null;
    setView(null);
    setRoomInfo(null);
    setConnectionMode("home");
    setPlayPassword("");
    setPasswordDraft("");
    setNotice(message);
  }

  if (passwordRequired === null || (passwordRequired && !playPassword)) {
    return (
      <Shell notice={notice} clearNotice={() => setNotice(null)}>
        <PasswordGate
          password={passwordDraft}
          setPassword={setPasswordDraft}
          unlock={unlockPlayPassword}
          checking={passwordRequired === null}
        />
      </Shell>
    );
  }

  if (connectionMode !== "connected" || !view) {
    return (
      <Shell notice={notice} clearNotice={() => setNotice(null)}>
        <HomeScreen
          name={name}
          setName={setName}
          roomCode={roomCode}
          setRoomCode={setRoomCode}
          connectionMode={connectionMode}
          createRoom={createRoom}
          joinRoom={joinRoom}
        />
      </Shell>
    );
  }

  return (
    <Shell notice={notice} clearNotice={() => setNotice(null)}>
      <GameScreen
        view={view}
        roomInfo={roomInfo}
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

function PasswordGate(props: {
  password: string;
  setPassword: (password: string) => void;
  unlock: () => void;
  checking: boolean;
}) {
  return (
    <main className="password-screen">
      <section className="password-card">
        <img className="logo-mark" src={logoUrl} alt="Cursewords mark" />
        <p className="eyebrow">Private playtest</p>
        <h1>Cursewords</h1>
        <p className="hero-copy">Enter the shared play password to create or join a dungeon.</p>
        <label className="field password-field">
          Play password
          <input
            value={props.password}
            disabled={props.checking}
            onChange={(event) => props.setPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") props.unlock();
            }}
            placeholder={props.checking ? "Checking gate..." : "Shared password"}
            type="password"
          />
        </label>
        <button className="primary-button password-button" disabled={props.checking} onClick={props.unlock} type="button">
          {props.checking ? "Checking..." : "Unlock"}
        </button>
      </section>
    </main>
  );
}

function Shell({
  children,
  notice,
  clearNotice
}: {
  children: React.ReactNode;
  notice: string | null;
  clearNotice: () => void;
}) {
  return (
    <div className="app-shell">
      {children}
      {notice && (
        <button className="notice" onClick={clearNotice} type="button">
          {notice}
        </button>
      )}
    </div>
  );
}

function HomeScreen(props: {
  name: string;
  setName: (name: string) => void;
  roomCode: string;
  setRoomCode: (code: string) => void;
  connectionMode: ConnectionMode;
  createRoom: () => void;
  joinRoom: () => void;
}) {
  return (
    <main className="home-screen">
      <section className="hero-card">
        <img className="logo-mark" src={logoUrl} alt="Cursewords mark" />
        <p className="eyebrow">Browser party word game</p>
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
            <button className="primary-button" onClick={props.createRoom} disabled={props.connectionMode === "connecting"} type="button">
              Create Room
            </button>
            <div className="join-row">
              <input
                value={props.roomCode}
                onChange={(event) => props.setRoomCode(event.target.value.toUpperCase())}
                placeholder="Room code"
                maxLength={6}
                onKeyDown={(event) => {
                  if (event.key === "Enter") props.joinRoom();
                }}
              />
              <button className="secondary-button" onClick={props.joinRoom} disabled={props.connectionMode === "connecting"} type="button">
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

const Feature = memo(function Feature({ icon, title, copy }: { icon: string; title: string; copy: string }) {
  return (
    <article className="feature-card">
      <img src={icon} alt="" />
      <div>
        <h3>{title}</h3>
        <p>{copy}</p>
      </div>
    </article>
  );
});

function GameScreen(props: {
  view: PlayerView;
  roomInfo: RoomCreateResult | null;
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
          roomInfo={props.roomInfo}
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
            <Suspense fallback={<section className="panel dungeon-board-panel"><p className="eyebrow">Loading board…</p></section>}>
              <DungeonBoard view={props.view} />
            </Suspense>
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
  roomInfo: RoomCreateResult | null;
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
  const customWords = useMemo(() => parseCustomWords(props.customWordsText), [props.customWordsText]);
  const setup = useMemo(
    () => buildGameSetup(props.deckMode, props.wordSource, customWords),
    [props.deckMode, props.wordSource, customWords]
  );
  const self = state.players.find((player) => player.id === props.view.private.playerId);
  const canUseDeck = canStartWithCustomWords(props.wordSource, customWords);
  const emberHasPlayers = playersByTeam.ember.some((player) => player.connected);
  const frostHasPlayers = playersByTeam.frost.some((player) => player.connected);
  const connectedTeamPlayers = state.players.filter((player) => player.connected && player.team);
  const allTeamPlayersReady = connectedTeamPlayers.length > 0 && connectedTeamPlayers.every((player) => state.lobbyReadyByPlayer[player.id]);
  const canStart = props.view.private.canHost && canUseDeck && emberHasPlayers && frostHasPlayers && allTeamPlayersReady;
  const startDisabled = !canStart;
  const selfReady = Boolean(self && state.lobbyReadyByPlayer[self.id]);
  const readyChecklistItems = useMemo(
    () => [
      { label: "Ember has players", done: emberHasPlayers },
      { label: "Frost has players", done: frostHasPlayers },
      { label: "Teamed players ready", done: allTeamPlayersReady },
      { label: "Word deck valid", done: canUseDeck },
      { label: "You are host", done: props.view.private.canHost }
    ],
    [emberHasPlayers, frostHasPlayers, allTeamPlayersReady, canUseDeck, props.view.private.canHost]
  );

  return (
    <section className="lobby-grid">
      <div className="lobby-card invite-card">
        <img src={doorUrl} alt="" />
        <h2>Gather the table</h2>
        <p>Share the room code below. Everyone opens this site, enters the code, and clicks Join.</p>
        <div className="address-list">
          <code>{props.roomInfo?.roomCode ?? "Waiting for room code"}</code>
        </div>
        <label className="field compact">
          Your display name
          <div className="join-row">
            <input value={props.name} onChange={(event) => props.setName(event.target.value)} />
            <button className="secondary-button" onClick={() => props.action("setName", { name: props.name })} type="button">Save</button>
          </div>
        </label>
        <div className={`ready-self-card ${selfReady ? "ready" : ""}`}>
          {self?.team ? (
            <>
              <div>
                <strong>{selfReady ? "You are ready" : "Ready when you are"}</strong>
                <span>{selfReady ? "The host can start once everyone is ready." : "Mark ready after joining a team."}</span>
              </div>
              <button className={selfReady ? "ghost-button" : "primary-button"} onClick={() => props.action("setLobbyReady", { ready: !selfReady })} type="button">
                {selfReady ? "Not Ready" : "Ready"}
              </button>
            </>
          ) : (
            <span>Choose a team before readying up.</span>
          )}
        </div>
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
            {playersByTeam[team].map((player) => <PlayerBadge player={player} ready={state.lobbyReadyByPlayer[player.id]} key={player.id} />)}
            {playersByTeam[team].length === 0 && <span className="empty-slot">No adventurers yet</span>}
          </div>
        </div>
      ))}

      <div className="lobby-card start-card">
        <img src={trapUrl} alt="" />
        <h2>Host Controls</h2>
        <p>Start when both teams have connected players and every teamed player is ready.</p>
        <ReadyChecklist items={readyChecklistItems} />
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
  const customWords = useMemo(() => parseCustomWords(props.customWordsText), [props.customWordsText]);
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
        {props.canHost ? `${customWords.length} custom words saved in this browser.` : "Only the host controls the word deck."}
        {props.wordSource === "custom" && customWords.length < 2 ? " Add at least 2 custom words for custom-only mode." : ""}
      </p>
    </div>
  );
}

const ReadyChecklist = memo(function ReadyChecklist({ items }: { items: { label: string; done: boolean }[] }) {
  return (
    <div className="ready-checklist">
      {items.map((item) => (
        <div className={`ready-check ${item.done ? "done" : "pending"}`} key={item.label}>
          <span>{item.done ? "Ready" : "Waiting"}</span>
          <strong>{item.label}</strong>
        </div>
      ))}
    </div>
  );
});

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
  const targetTeam = view.private.writingForTeam;
  const playerTeam = view.private.team;
  const submitted = Boolean(playerTeam && view.state.round?.trapSubmittedByTeam[playerTeam]);
  const traps = submitted ? view.private.submittedTraps ?? view.private.draftTraps ?? [] : view.private.draftTraps ?? [];
  const [newTrap, setNewTrap] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState("");

  useEffect(() => {
    setNewTrap("");
    setEditingIndex(null);
    setEditingValue("");
  }, [view.state.round?.index, targetTeam]);

  function updateDraft(nextTraps: string[]) {
    if (submitted) return;
    action("setTrapDraft", { traps: nextTraps });
  }

  function addTrap() {
    const trap = cleanTrapInput(newTrap);
    if (!trap || traps.length >= limit) return;
    updateDraft([...traps, trap]);
    setNewTrap("");
  }

  function startEdit(index: number) {
    setEditingIndex(index);
    setEditingValue(traps[index] ?? "");
  }

  function saveEdit(index: number) {
    const trap = cleanTrapInput(editingValue);
    if (!trap) return;
    updateDraft(traps.map((existing, trapIndex) => (trapIndex === index ? trap : existing)));
    setEditingIndex(null);
    setEditingValue("");
  }

  function cancelEdit() {
    setEditingIndex(null);
    setEditingValue("");
  }

  function removeTrap(index: number) {
    updateDraft(traps.filter((_trap, trapIndex) => trapIndex !== index));
    if (editingIndex === index) cancelEdit();
  }

  return (
    <section className="phase-card spellbook-card">
      <img className="phase-icon" src={bookUrl} alt="" />
      <p className="eyebrow">Team traps</p>
      {targetTeam ? (
        <>
          <h2>Team Traps for {TEAM_LABEL[targetTeam]}</h2>
          <SecretWord word={view.private.visibleTarget} label="Their target word" />
          <p className="phase-copy">Build exactly {limit} shared traps with your team. Everyone on your team can add, edit, and remove traps before the book is sealed.</p>
          <div className="shared-trap-list">
            {traps.map((trap, index) => (
              <div className="shared-trap-row" key={`${index}-${trap}`}>
                {editingIndex === index && !submitted ? (
                  <>
                    <input
                      value={editingValue}
                      onChange={(event) => setEditingValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") saveEdit(index);
                        if (event.key === "Escape") cancelEdit();
                      }}
                    />
                    <button className="secondary-button small" disabled={!cleanTrapInput(editingValue)} onClick={() => saveEdit(index)} type="button">Save</button>
                    <button className="ghost-button small" onClick={cancelEdit} type="button">Cancel</button>
                  </>
                ) : (
                  <>
                    <strong>{trap}</strong>
                    {!submitted && (
                      <div className="trap-row-actions">
                        <button className="secondary-button small" onClick={() => startEdit(index)} type="button">Edit</button>
                        <button className="danger-button small" onClick={() => removeTrap(index)} type="button">Remove</button>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
            {traps.length === 0 && <p className="empty-slot">No traps drafted yet. Add the first one for your team.</p>}
          </div>
          {!submitted && (
            <div className="add-trap-row">
              <input
                value={newTrap}
                disabled={traps.length >= limit}
                onChange={(event) => setNewTrap(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") addTrap();
                }}
                placeholder={traps.length >= limit ? "Trap limit reached" : "Add a trap word"}
              />
              <button className="secondary-button" disabled={traps.length >= limit || !cleanTrapInput(newTrap)} onClick={addTrap} type="button">Add Trap</button>
            </div>
          )}
          <div className="trap-meter"><span>{traps.length}</span> / {limit} shared traps ready</div>
          <TeamChat messages={view.private.teamMessages ?? []} playerId={view.private.playerId} action={action} />
          <button
            className="primary-button"
            disabled={submitted || traps.length !== limit}
            onClick={() => action("submitTraps")}
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

function TeamChat({ messages, playerId, action }: { messages: TeamMessage[]; playerId: string; action: (event: string, payload?: unknown) => void }) {
  const [draft, setDraft] = useState("");
  const [incomingIds, setIncomingIds] = useState<Set<string>>(() => new Set());
  const [panelPulse, setPanelPulse] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const lastSeenIdRef = useRef<string | undefined>(undefined);
  const initializedRef = useRef(false);
  const text = cleanMessageInput(draft);

  useEffect(() => {
    const log = logRef.current;
    if (!log) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    log.scrollTo({ top: log.scrollHeight, behavior: reducedMotion ? "auto" : "smooth" });

    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) {
      lastSeenIdRef.current = undefined;
      initializedRef.current = true;
      return;
    }

    if (!initializedRef.current) {
      initializedRef.current = true;
      lastSeenIdRef.current = lastMessage.id;
      return;
    }

    if (lastMessage.id === lastSeenIdRef.current) return;

    const previousIndex = lastSeenIdRef.current
      ? messages.findIndex((message) => message.id === lastSeenIdRef.current)
      : -1;
    const freshMessages = previousIndex >= 0 ? messages.slice(previousIndex + 1) : [lastMessage];
    const fromOthers = freshMessages.filter((message) => message.playerId !== playerId);

    lastSeenIdRef.current = lastMessage.id;

    if (fromOthers.length === 0) return;

    playTeamChatNotification();
    setIncomingIds(new Set(fromOthers.map((message) => message.id)));
    setPanelPulse(true);

    const timer = window.setTimeout(() => {
      setIncomingIds(new Set());
      setPanelPulse(false);
    }, 700);

    return () => window.clearTimeout(timer);
  }, [messages, playerId]);

  function send() {
    if (!text) return;
    action("sendTeamMessage", { text });
    setDraft("");
  }

  return (
    <section className={`team-chat-panel${panelPulse ? " has-new-message" : ""}`}>
      <div className="team-chat-heading">
        <strong>Team Chat</strong>
        <span>Private during trap writing</span>
      </div>
      <div className="team-chat-log" ref={logRef}>
        {messages.map((message) => (
          <p className={incomingIds.has(message.id) ? "is-new" : undefined} key={message.id}>
            <strong>{message.playerName}</strong>
            <span>{message.text}</span>
          </p>
        ))}
        {messages.length === 0 && <p className="empty-slot">No team messages yet.</p>}
      </div>
      <div className="team-chat-compose">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") send();
          }}
          maxLength={160}
          placeholder="Message your team"
        />
        <button className="secondary-button" disabled={!text} onClick={send} type="button">Send</button>
      </div>
    </section>
  );
}

function BetweenTurns({ view, action }: { view: PlayerView; action: (event: string, payload?: unknown) => void }) {
  const round = view.state.round;
  const nextTeam = round?.nextTeam;
  const clueGiver = nextTeam ? findPlayer(view, round?.clueGivers[nextTeam]) : undefined;
  const room = nextTeam ? view.state.rooms[Math.min(view.state.teams[nextTeam].progress, view.state.rooms.length - 1)] : undefined;
  const turnReady = round?.turnReadyByTeam ?? { ember: false, frost: false };
  const playerTeam = view.private.team;
  const playerReady = playerTeam ? turnReady[playerTeam] : false;
  const bothReady = turnReady.ember && turnReady.frost;
  return (
    <section className="phase-card">
      <img className="phase-icon" src={torchUrl} alt="" />
      <p className="eyebrow">Next torch</p>
      <h2>{nextTeam ? `${TEAM_LABEL[nextTeam]} prepares to clue` : "Waiting"}</h2>
      <p className="phase-copy">Clue-giver: <strong>{clueGiver?.name ?? "No connected player"}</strong></p>
      {room && <p className="curse-line">Room curse: {room.curse}</p>}
      <div className="turn-ready-panel">
        <div className="turn-ready-grid">
          {TEAM_IDS.map((team) => (
            <div className={`turn-ready-card ${turnReady[team] ? "ready" : "pending"}`} key={team}>
              <span>{TEAM_LABEL[team]}</span>
              <strong>{turnReady[team] ? "Ready" : "Waiting"}</strong>
            </div>
          ))}
        </div>
        {playerTeam && (
          <button className={playerReady ? "ghost-button" : "secondary-button"} onClick={() => action("setTurnReady", { ready: !playerReady })} type="button">
            {playerReady ? "Not Ready" : "Ready for Clue"}
          </button>
        )}
        {!bothReady && view.private.canHost && <p>Host override is available if the table is ready out loud.</p>}
      </div>
      <button className="primary-button" disabled={!view.private.canHost || !nextTeam} onClick={() => action("beginClue", { team: nextTeam })} type="button">
        {bothReady ? "Begin Clue Timer" : "Begin Anyway"}
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

const TeamPanel = memo(function TeamPanel({ team, view, action }: { team: TeamId; view: PlayerView; action: (event: string, payload?: unknown) => void }) {
  const members = view.state.players.filter((player) => player.team === team);
  const teamState = view.state.teams[team];
  const clueGiverId = view.state.round?.clueGivers[team];
  const progressPercent = (teamState.progress / view.state.rooms.length) * 100;
  const progressStyle = useMemo(() => ({ width: `${progressPercent}%` }), [progressPercent]);
  return (
    <section className={`panel team-panel ${team}`}>
      <div className="panel-heading">
        <span>{TEAM_LABEL[team]}</span>
        <strong>{teamState.score}</strong>
      </div>
      <div className="progress-bar"><span style={progressStyle} /></div>
      <div className="player-stack">
        {members.map((player) => <PlayerBadge player={player} key={player.id} active={player.id === clueGiverId} />)}
        {members.length === 0 && <span className="empty-slot">No players</span>}
      </div>
      {view.state.phase === "lobby" && (
        <button className="secondary-button small" onClick={() => action("chooseTeam", { team })} type="button">Join</button>
      )}
    </section>
  );
});

const EventLog = memo(function EventLog({ log }: { log: string[] }) {
  return (
    <section className="panel event-log">
      <div className="panel-heading"><span>Table Log</span></div>
      {log.length === 0 ? <p>No dungeon events yet.</p> : log.map((entry, index) => <p key={`${index}-${entry}`}>{entry}</p>)}
    </section>
  );
});

const PlayerBadge = memo(function PlayerBadge({ player, active = false, ready }: { player: Player; active?: boolean; ready?: boolean }) {
  return (
    <div className={`player-badge ${player.connected ? "connected" : "offline"} ${active ? "active" : ""}`}>
      <span>{player.name}</span>
      {player.isHost && <em>host</em>}
      {active && <em>clue</em>}
      {ready !== undefined && <em className={ready ? "ready" : "pending"}>{ready ? "ready" : "not ready"}</em>}
    </div>
  );
});

const SecretWord = memo(function SecretWord({ word, label, urgent = false }: { word?: string; label: string; urgent?: boolean }) {
  return (
    <div className={`secret-word ${urgent ? "urgent" : ""}`}>
      <span>{label}</span>
      <strong>{word ?? "Hidden"}</strong>
    </div>
  );
});

function Timer({ deadline, serverTime }: { deadline?: number; serverTime: number }) {
  const [now, setNow] = useState(Date.now());
  const [clockOffset, setClockOffset] = useState(() => Date.now() - serverTime);

  useEffect(() => {
    setClockOffset(Date.now() - serverTime);
  }, [serverTime, deadline]);

  const estimatedServerNow = now - clockOffset;
  const remaining = Math.max(0, Math.ceil(((deadline ?? serverTime) - estimatedServerNow) / 1000));

  useEffect(() => {
    if (!deadline) return;

    const getRemaining = () =>
      Math.max(0, Math.ceil((deadline - (Date.now() - clockOffset)) / 1000));

    if (getRemaining() <= 0) return;

    const tick = () => setNow(Date.now());
    const msUntilNextSecond = 1000 - (Date.now() % 1000);
    let intervalId: ReturnType<typeof window.setInterval>;

    const timeoutId = window.setTimeout(() => {
      tick();
      if (getRemaining() <= 0) return;
      intervalId = window.setInterval(() => {
        tick();
        if (getRemaining() <= 0 && intervalId) {
          window.clearInterval(intervalId);
        }
      }, 1000);
    }, msUntilNextSecond);

    return () => {
      window.clearTimeout(timeoutId);
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [deadline, clockOffset]);

  const danger = remaining <= 10;
  return (
    <div className={`timer ${danger ? "danger" : ""}`}>
      <img src={torchUrl} alt="" />
      <strong>{remaining}</strong>
      <span>seconds</span>
    </div>
  );
}

const AttemptResultCard = memo(function AttemptResultCard({ team, attempt }: { team: TeamId; attempt?: { result: AttemptResult; trap?: string } }) {
  return (
    <article className={`attempt-card ${team} ${attempt?.result ?? "pending"}`}>
      <span>{TEAM_LABEL[team]}</span>
      <strong>{attempt ? resultLabel(attempt.result) : "Pending"}</strong>
      {attempt?.trap && <small>Trap: {attempt.trap}</small>}
    </article>
  );
});

function groupPlayersByTeam(players: Player[]) {
  return {
    ember: players.filter((player) => player.team === "ember"),
    frost: players.filter((player) => player.team === "frost")
  } satisfies Record<TeamId, Player[]>;
}

function findPlayer(view: PlayerView, playerId?: string) {
  return view.state.players.find((player) => player.id === playerId);
}

function cleanTrapInput(trap: string) {
  return trap.trim().replace(/\s+/g, " ").slice(0, 40);
}

function cleanMessageInput(message: string) {
  return message.trim().replace(/\s+/g, " ").slice(0, 160);
}

let teamChatAudioContext: AudioContext | undefined;

function playTeamChatNotification() {
  try {
    teamChatAudioContext ??= new AudioContext();
    const ctx = teamChatAudioContext;
    if (ctx.state === "suspended") void ctx.resume();

    const now = ctx.currentTime;
    const playTone = (frequency: number, start: number, duration: number) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.07, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(start + duration);
    };

    playTone(784, now, 0.11);
    playTone(988, now + 0.07, 0.14);
  } catch {
    // Audio unavailable in this environment.
  }
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

function buildGameSetup(deckMode: DeckMode, wordSource: WordSource, customWords: string[]): GameSetup {
  return {
    deckMode,
    wordSource,
    customWords
  };
}

function canStartWithCustomWords(wordSource: WordSource, customWords: string[]) {
  return wordSource !== "custom" || customWords.length >= 2;
}

function parseStoredWordSource(value: string | null): WordSource {
  if (value === "built-in" || value === "custom" || value === "combined") return value;
  return "built-in";
}

function parseStoredDeckMode(value: string | null): DeckMode {
  if (value === "mixed" || value === "common" || value === "arcane") return value;
  return "mixed";
}

function emitJoinRoom(socket: Socket, roomCode: string, playerName: string, playerToken: string, hostToken?: string) {
  return new Promise<void>((resolve, reject) => {
    socket.emit(
      "joinRoom",
      {
        roomCode,
        name: playerName || undefined,
        playerToken,
        hostToken: hostToken || undefined
      },
      (result: ClientActionResult) => {
        if (result.ok) {
          resolve();
          return;
        }
        reject(new Error(result.error ?? "Could not join room."));
      }
    );
  });
}

function playerTokenStorageKey(roomCode: string) {
  return `${PLAYER_TOKEN_PREFIX}${normalizeRoomCode(roomCode)}`;
}

function hostTokenStorageKey(roomCode: string) {
  return `${HOST_TOKEN_PREFIX}${normalizeRoomCode(roomCode)}`;
}

function getStoredPlayerToken(roomCode: string) {
  try {
    return localStorage.getItem(playerTokenStorageKey(roomCode)) || undefined;
  } catch {
    return undefined;
  }
}

function storePlayerToken(roomCode: string, playerToken: string) {
  try {
    localStorage.setItem(playerTokenStorageKey(roomCode), playerToken);
  } catch {
    // Reconnect still works for the current socket even when storage is unavailable.
  }
}

function getStoredHostToken(roomCode: string) {
  try {
    return localStorage.getItem(hostTokenStorageKey(roomCode)) || undefined;
  } catch {
    return undefined;
  }
}

function storeHostToken(roomCode: string, hostToken: string) {
  try {
    localStorage.setItem(hostTokenStorageKey(roomCode), hostToken);
  } catch {
    // Host reclaim on reconnect still works while the current session is alive.
  }
}

function createPlayerToken() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
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
