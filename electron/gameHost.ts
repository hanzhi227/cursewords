import http from "http";
import os from "os";
import { randomBytes } from "crypto";
import { Server as SocketServer } from "socket.io";
import type { Socket } from "socket.io";
import { GameEngine } from "../src/game/engine";
import type { HostStartResult, ClientActionResult, GameSetup } from "../src/shared/types";

type Ack = (result: ClientActionResult) => void;

export class GameHost {
  private server: http.Server | null = null;
  private io: SocketServer | null = null;
  private engine = new GameEngine();
  private port = 0;
  private hostToken = randomBytes(18).toString("hex");
  private timer: NodeJS.Timeout | null = null;

  async start(): Promise<HostStartResult> {
    if (this.server && this.io) return this.info();

    this.server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("Cursewords LAN host is running.");
    });

    this.io = new SocketServer(this.server, {
      cors: { origin: "*" }
    });
    this.bindSockets(this.io);

    this.port = await listenOnOpenPort(this.server, 4949, 4970);
    return this.info();
  }

  info(): HostStartResult {
    return {
      port: this.port,
      hostToken: this.hostToken,
      addresses: getLanAddresses(this.port)
    };
  }

  async stop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await new Promise<void>((resolve) => {
      this.io?.close(() => resolve());
      if (!this.io) resolve();
    });
    await new Promise<void>((resolve) => {
      this.server?.close(() => resolve());
      if (!this.server) resolve();
    });
    this.server = null;
    this.io = null;
    this.engine = new GameEngine();
    this.hostToken = randomBytes(18).toString("hex");
    this.port = 0;
  }

  private bindSockets(io: SocketServer) {
    io.on("connection", (socket) => {
      socket.on("join", (payload: { name?: string; hostToken?: string } | undefined, ack?: Ack) => {
        const isHost = payload?.hostToken === this.hostToken;
        const result = this.engine.joinPlayer(socket.id, payload?.name, isHost);
        socket.data.playerId = result.playerId;
        ack?.({ ok: true });
        this.emitViews();
      });

      socket.on("setName", (payload: { name: string }, ack?: Ack) => {
        this.safeAction(socket, ack, (playerId) => this.engine.setName(playerId, typeof payload?.name === "string" ? payload.name : ""));
      });

      socket.on("chooseTeam", (payload: { team: unknown }, ack?: Ack) => {
        this.safeAction(socket, ack, (playerId) => this.engine.chooseTeam(playerId, payload.team));
      });

      socket.on("setLobbyReady", (payload: { ready?: boolean } | undefined, ack?: Ack) => {
        this.safeAction(socket, ack, (playerId) => this.engine.setLobbyReady(playerId, Boolean(payload?.ready)));
      });

      socket.on("startGame", (payload: { settings?: GameSetup } | undefined, ack?: Ack) => {
        this.safeAction(socket, ack, (playerId) => this.engine.startGame(playerId, payload?.settings ?? {}));
      });

      socket.on("submitTraps", (payload: { traps: string[] }, ack?: Ack) => {
        this.safeAction(socket, ack, (playerId) => this.engine.submitTraps(playerId, Array.isArray(payload?.traps) ? payload.traps : []));
      });

      socket.on("setTrapDraft", (payload: { traps: string[] }, ack?: Ack) => {
        this.safeAction(socket, ack, (playerId) => this.engine.setTrapDraft(playerId, Array.isArray(payload?.traps) ? payload.traps : []));
      });

      socket.on("sendTeamMessage", (payload: { text?: unknown } | undefined, ack?: Ack) => {
        this.safeAction(socket, ack, (playerId) => this.engine.sendTeamMessage(playerId, payload?.text));
      });

      socket.on("setTurnReady", (payload: { ready?: boolean } | undefined, ack?: Ack) => {
        this.safeAction(socket, ack, (playerId) => this.engine.setTurnReady(playerId, Boolean(payload?.ready)));
      });

      socket.on("beginClue", (payload: { team: unknown }, ack?: Ack) => {
        this.safeAction(socket, ack, (playerId) => this.engine.beginClue(playerId, payload.team));
      });

      socket.on("resolveAttempt", (payload: { result: unknown; trap?: string }, ack?: Ack) => {
        this.safeAction(socket, ack, (playerId) => this.engine.resolveAttempt(playerId, payload.result, payload.trap));
      });

      socket.on("nextRound", (_payload: unknown, ack?: Ack) => {
        this.safeAction(socket, ack, (playerId) => this.engine.nextRound(playerId));
      });

      socket.on("resetGame", (_payload: unknown, ack?: Ack) => {
        this.safeAction(socket, ack, (playerId) => this.engine.resetGame(playerId));
      });

      socket.on("disconnect", () => {
        const playerId = socket.data.playerId as string | undefined;
        if (playerId) this.engine.disconnectPlayer(playerId);
        this.emitViews();
      });
    });
  }

  private safeAction(socket: Socket, ack: Ack | undefined, action: (playerId: string) => void) {
    try {
      const playerId = socket.data.playerId as string | undefined;
      if (!playerId) throw new Error("Join the game first.");
      action(playerId);
      ack?.({ ok: true });
      this.syncTimer();
      this.emitViews();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown action failure.";
      ack?.({ ok: false, error: message });
      socket.emit("notice", message);
    }
  }

  private emitViews() {
    if (!this.io) return;
    for (const [, socket] of this.io.sockets.sockets) {
      const playerId = socket.data.playerId as string | undefined;
      if (playerId) socket.emit("view", this.engine.getView(playerId));
    }
  }

  private syncTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;

    const deadline = this.engine.activeDeadline();
    if (!deadline) return;

    const delay = Math.max(0, deadline - Date.now() + 100);
    this.timer = setTimeout(() => {
      try {
        this.engine.autoTimeUp();
        this.emitViews();
      } finally {
        this.syncTimer();
      }
    }, delay);
  }
}

function getLanAddresses(port: number) {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) {
        addresses.push(`${entry.address}:${port}`);
      }
    }
  }
  addresses.push(`127.0.0.1:${port}`);
  return [...new Set(addresses)];
}

function listenOnOpenPort(server: http.Server, start: number, end: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let port = start;

    const tryListen = () => {
      const onError = (error: NodeJS.ErrnoException) => {
        server.off("listening", onListening);
        if (error.code === "EADDRINUSE" && port < end) {
          port += 1;
          tryListen();
          return;
        }
        reject(error);
      };

      const onListening = () => {
        server.off("error", onError);
        resolve(port);
      };

      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, "0.0.0.0");
    };

    tryListen();
  });
}
