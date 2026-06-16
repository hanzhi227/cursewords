import { randomBytes } from "crypto";
import type { Server as SocketServer, Socket } from "socket.io";
import { GameEngine } from "../src/game/engine";
import { normalizeRoomCode } from "../src/shared/roomCode";
import type { ClientActionResult, GameSetup, RoomCreateResult } from "../src/shared/types";

type Ack<T = ClientActionResult> = (result: T) => void;
type RoomManagerOptions = {
  playPassword?: string;
};
type JoinPayload = {
  name?: string;
  hostToken?: string;
  playerToken?: string;
};

const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 6;
const MAX_ROOMS = 200;
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;
const AUTH_ERROR = "Invalid play password.";

export class GameRoom {
  readonly code: string;
  readonly hostToken: string;
  readonly engine = new GameEngine();
  private timer: NodeJS.Timeout | null = null;
  private emptyTimer: NodeJS.Timeout | null = null;
  private activeSocketsByPlayer = new Map<string, Set<string>>();

  constructor(code: string, hostToken: string) {
    this.code = code;
    this.hostToken = hostToken;
  }

  isHostToken(token?: string) {
    return Boolean(token && token === this.hostToken);
  }

  joinSocket(socket: Socket, io: SocketServer, options: JoinPayload) {
    this.cancelEmptyTimer();
    const isHost = this.isHostToken(options.hostToken);
    const result = this.engine.joinPlayer(options.playerToken || socket.id, options.name, isHost);
    const previousPlayerId = socket.data.playerId as string | undefined;
    if (previousPlayerId && previousPlayerId !== result.playerId && this.detachSocket(previousPlayerId, socket.id)) {
      this.engine.disconnectPlayer(previousPlayerId);
    }
    socket.data.playerId = result.playerId;
    socket.data.roomCode = this.code;
    this.attachSocket(result.playerId, socket.id);
    socket.join(this.code);
    this.emitViews(io);
    return result;
  }

  bindSocket(socket: Socket, io: SocketServer, onEmpty?: (code: string) => void) {
    socket.on("join", (payload: JoinPayload | undefined, ack?: Ack) => {
      try {
        this.joinSocket(socket, io, {
          name: payload?.name,
          hostToken: payload?.hostToken,
          playerToken: payload?.playerToken
        });
        ack?.({ ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not join room.";
        ack?.({ ok: false, error: message });
        socket.emit("notice", message);
      }
    });

    socket.on("setName", (payload: { name: string }, ack?: Ack) => {
      this.safeAction(socket, ack, io, (playerId) => this.engine.setName(playerId, typeof payload?.name === "string" ? payload.name : ""));
    });

    socket.on("chooseTeam", (payload: { team: unknown }, ack?: Ack) => {
      this.safeAction(socket, ack, io, (playerId) => this.engine.chooseTeam(playerId, payload.team));
    });

    socket.on("setLobbyReady", (payload: { ready?: boolean } | undefined, ack?: Ack) => {
      this.safeAction(socket, ack, io, (playerId) => this.engine.setLobbyReady(playerId, Boolean(payload?.ready)));
    });

    socket.on("startGame", (payload: { settings?: GameSetup } | undefined, ack?: Ack) => {
      this.safeAction(socket, ack, io, (playerId) => this.engine.startGame(playerId, payload?.settings ?? {}));
    });

    socket.on("submitTraps", (payload: { traps: string[] }, ack?: Ack) => {
      this.safeAction(socket, ack, io, (playerId) => this.engine.submitTraps(playerId, Array.isArray(payload?.traps) ? payload.traps : []));
    });

    socket.on("setTrapDraft", (payload: { traps: string[] }, ack?: Ack) => {
      this.safeAction(socket, ack, io, (playerId) => this.engine.setTrapDraft(playerId, Array.isArray(payload?.traps) ? payload.traps : []));
    });

    socket.on("sendTeamMessage", (payload: { text?: unknown } | undefined, ack?: Ack) => {
      this.safeAction(socket, ack, io, (playerId) => this.engine.sendTeamMessage(playerId, payload?.text));
    });

    socket.on("setTurnReady", (payload: { ready?: boolean } | undefined, ack?: Ack) => {
      this.safeAction(socket, ack, io, (playerId) => this.engine.setTurnReady(playerId, Boolean(payload?.ready)));
    });

    socket.on("beginClue", (payload: { team: unknown }, ack?: Ack) => {
      this.safeAction(socket, ack, io, (playerId) => this.engine.beginClue(playerId, payload.team));
    });

    socket.on("resolveAttempt", (payload: { result: unknown; trap?: string }, ack?: Ack) => {
      this.safeAction(socket, ack, io, (playerId) => this.engine.resolveAttempt(playerId, payload.result, payload.trap));
    });

    socket.on("nextRound", (_payload: unknown, ack?: Ack) => {
      this.safeAction(socket, ack, io, (playerId) => this.engine.nextRound(playerId));
    });

    socket.on("resetGame", (_payload: unknown, ack?: Ack) => {
      this.safeAction(socket, ack, io, (playerId) => this.engine.resetGame(playerId));
    });

    socket.on("disconnect", () => {
      const playerId = socket.data.playerId as string | undefined;
      if (playerId && this.detachSocket(playerId, socket.id)) this.engine.disconnectPlayer(playerId);
      this.emitViews(io);
      this.scheduleDestroyWhenEmpty(onEmpty);
    });
  }

  private safeAction(socket: Socket, ack: Ack | undefined, io: SocketServer, action: (playerId: string) => void) {
    try {
      const playerId = socket.data.playerId as string | undefined;
      if (!playerId) throw new Error("Join the game first.");
      action(playerId);
      ack?.({ ok: true });
      this.syncTimer(io);
      this.emitViews(io);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown action failure.";
      ack?.({ ok: false, error: message });
      socket.emit("notice", message);
    }
  }

  emitViews(io: SocketServer) {
    const room = io.sockets.adapter.rooms.get(this.code);
    if (!room) return;

    for (const socketId of room) {
      const socket = io.sockets.sockets.get(socketId);
      if (!socket) continue;
      const playerId = socket.data.playerId as string | undefined;
      if (playerId) socket.emit("view", this.engine.getView(playerId));
    }
  }

  private syncTimer(io: SocketServer) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;

    const deadline = this.engine.activeDeadline();
    if (!deadline) return;

    const delay = Math.max(0, deadline - Date.now() + 100);
    this.timer = setTimeout(() => {
      try {
        this.engine.autoTimeUp();
        this.emitViews(io);
      } finally {
        this.syncTimer(io);
      }
    }, delay);
  }

  destroy() {
    if (this.timer) clearTimeout(this.timer);
    this.cancelEmptyTimer();
    this.timer = null;
    this.activeSocketsByPlayer.clear();
  }

  private scheduleDestroyWhenEmpty(onEmpty?: (code: string) => void) {
    if (!onEmpty || this.emptyTimer || this.hasConnectedPlayers()) return;
    this.emptyTimer = setTimeout(() => {
      this.emptyTimer = null;
      if (!this.hasConnectedPlayers()) onEmpty(this.code);
    }, EMPTY_ROOM_TTL_MS);
  }

  private cancelEmptyTimer() {
    if (this.emptyTimer) clearTimeout(this.emptyTimer);
    this.emptyTimer = null;
  }

  private attachSocket(playerId: string, socketId: string) {
    const socketIds = this.activeSocketsByPlayer.get(playerId) ?? new Set<string>();
    socketIds.add(socketId);
    this.activeSocketsByPlayer.set(playerId, socketIds);
  }

  private detachSocket(playerId: string, socketId: string) {
    const socketIds = this.activeSocketsByPlayer.get(playerId);
    if (!socketIds) return true;
    socketIds.delete(socketId);
    if (socketIds.size > 0) return false;
    this.activeSocketsByPlayer.delete(playerId);
    return true;
  }

  private hasConnectedPlayers() {
    return this.engine.snapshot().players.some((player) => player.connected);
  }
}

export class RoomManager {
  private rooms = new Map<string, GameRoom>();
  private playPassword?: string;

  constructor(options: RoomManagerOptions = {}) {
    this.playPassword = cleanPassword(options.playPassword);
  }

  bind(io: SocketServer) {
    if (this.playPassword) {
      io.use((socket, next) => {
        const password = socket.handshake.auth?.playPassword;
        if (typeof password === "string" && password === this.playPassword) {
          next();
          return;
        }
        next(new Error(AUTH_ERROR));
      });
    }

    io.on("connection", (socket) => {
      socket.on("createRoom", (payload: { name?: string; playerToken?: string } | undefined, ack?: Ack<RoomCreateResult | ClientActionResult>) => {
        try {
          this.assertSocketAvailable(socket);
          const room = this.allocateRoom();
          room.bindSocket(socket, io, (code) => this.destroyRoom(code));
          socket.data.boundRoom = room.code;
          room.joinSocket(socket, io, { name: payload?.name, hostToken: room.hostToken, playerToken: payload?.playerToken });

          const result: RoomCreateResult = {
            roomCode: room.code,
            hostToken: room.hostToken
          };
          ack?.(result);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not create room.";
          ack?.({ ok: false, error: message });
        }
      });

      socket.on("joinRoom", (payload: { roomCode?: string; name?: string; hostToken?: string; playerToken?: string } | undefined, ack?: Ack) => {
        try {
          this.assertSocketAvailable(socket);
          const roomCode = normalizeRoomCode(payload?.roomCode);
          if (!roomCode) throw new Error("Enter a valid room code.");

          const room = this.rooms.get(roomCode);
          if (!room) throw new Error("Room not found. Check the code and try again.");

          room.bindSocket(socket, io, (code) => this.destroyRoom(code));
          socket.data.boundRoom = room.code;
          room.joinSocket(socket, io, {
            name: payload?.name,
            hostToken: payload?.hostToken,
            playerToken: payload?.playerToken
          });
          ack?.({ ok: true });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not join room.";
          ack?.({ ok: false, error: message });
          socket.emit("notice", message);
        }
      });
    });
  }

  private assertSocketAvailable(socket: Socket) {
    if (socket.data.boundRoom) throw new Error("Already connected to a room.");
  }

  private allocateRoom(): GameRoom {
    if (this.rooms.size >= MAX_ROOMS) {
      throw new Error("Server is full. Try again in a moment.");
    }

    let code = "";
    for (let attempt = 0; attempt < 12; attempt += 1) {
      code = generateRoomCode();
      if (!this.rooms.has(code)) break;
      code = "";
    }
    if (!code) throw new Error("Could not allocate a room code.");

    const room = new GameRoom(code, randomBytes(18).toString("hex"));
    this.rooms.set(code, room);
    return room;
  }

  private destroyRoom(code: string) {
    const room = this.rooms.get(code);
    if (!room) return;
    room.destroy();
    this.rooms.delete(code);
  }
}

function generateRoomCode() {
  const bytes = randomBytes(ROOM_CODE_LENGTH);
  let code = "";
  for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
    code += ROOM_CODE_CHARS[bytes[index] % ROOM_CODE_CHARS.length];
  }
  return code;
}

function cleanPassword(password?: string) {
  const cleaned = password?.trim();
  return cleaned || undefined;
}
