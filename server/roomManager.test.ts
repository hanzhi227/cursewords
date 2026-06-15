import http from "http";
import { describe, expect, it, afterEach } from "vitest";
import { Server as SocketServer } from "socket.io";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import { GameRoom, RoomManager } from "./roomManager";

type TestServer = {
  httpServer: http.Server;
  io: SocketServer;
  url: string;
  close: () => Promise<void>;
};

async function startTestServer(options: { playPassword?: string } = {}) {
  const httpServer = http.createServer();
  const io = new SocketServer(httpServer, { cors: { origin: "*" } });
  const manager = new RoomManager(options);
  manager.bind(io);

  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not resolve test server port.");
  }

  return {
    httpServer,
    io,
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        io.close(() => {
          if (httpServer.listening) {
            httpServer.close(() => resolve());
            return;
          }
          resolve();
        });
      })
  } satisfies TestServer;
}

function connectClient(url: string, playPassword?: string) {
  const socket = createClient(url, {
    auth: playPassword ? { playPassword } : {},
    transports: ["websocket", "polling"],
    forceNew: true
  });

  return new Promise<ClientSocket>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out connecting to test server.")), 3000);
    socket.once("connect", () => {
      clearTimeout(timeout);
      resolve(socket);
    });
    socket.once("connect_error", (error) => {
      clearTimeout(timeout);
      socket.disconnect();
      reject(error);
    });
  });
}

function emitAck<T>(socket: ClientSocket, event: string, payload: unknown = {}) {
  return new Promise<T>((resolve) => {
    socket.emit(event, payload, resolve);
  });
}

function waitForView(socket: ClientSocket) {
  return new Promise<unknown>((resolve) => {
    socket.once("view", resolve);
  });
}

describe("GameRoom", () => {
  it("marks the creator as host when the host token matches", () => {
    const room = new GameRoom("ABCDEF", "secret-token");
    expect(room.isHostToken("secret-token")).toBe(true);
    expect(room.isHostToken("wrong-token")).toBe(false);
  });

  it("grants host privileges through joinSocket", () => {
    const room = new GameRoom("ABCDEF", "secret-token");
    const sockets = new Map<string, { emit: (event: string, payload: unknown) => void; data: Record<string, unknown>; join: (code: string) => void }>();
    const io = {
      sockets: {
        adapter: {
          rooms: new Map([["ABCDEF", new Set(["host-socket"])]])
        },
        sockets
      }
    } as unknown as SocketServer;

    const socket = {
      id: "host-socket",
      data: {},
      join(code: string) {
        sockets.set("host-socket", socket);
        io.sockets.adapter.rooms.set(code, new Set(["host-socket"]));
      },
      emit() {}
    };

    sockets.set("host-socket", socket);
    room.joinSocket(socket as never, io, { name: "Host", hostToken: "secret-token" });

    const view = room.engine.getView("host-socket");
    expect(view.private.canHost).toBe(true);
    expect(view.state.players[0]?.name).toBe("Host");
  });
});

describe("RoomManager", () => {
  let server: TestServer | null = null;

  afterEach(async () => {
    await server?.close();
    server = null;
  });

  it("creates a room and lets a second player join by code", async () => {
    server = await startTestServer();
    const host = await connectClient(server.url);
    const hostViewPromise = waitForView(host);

    const created = await emitAck<{ roomCode: string; hostToken: string }>(host, "createRoom", { name: "Host" });
    expect(created.roomCode).toMatch(/^[A-Z0-9]{6}$/);
    expect(created.hostToken.length).toBeGreaterThan(10);

    const hostView = await hostViewPromise;
    expect(hostView).toMatchObject({
      private: { canHost: true },
      state: { phase: "lobby" }
    });

    const guest = await connectClient(server.url);
    const guestViewPromise = waitForView(guest);

    const joined = await emitAck<{ ok: boolean }>(guest, "joinRoom", {
      roomCode: created.roomCode,
      name: "Guest"
    });
    expect(joined.ok).toBe(true);

    const guestView = await guestViewPromise;
    expect(guestView).toMatchObject({
      private: { canHost: false },
      state: {
        phase: "lobby",
        players: expect.arrayContaining([
          expect.objectContaining({ name: "Host", isHost: true }),
          expect.objectContaining({ name: "Guest", isHost: false })
        ])
      }
    });

    host.disconnect();
    guest.disconnect();
  });

  it("requires the configured play password before connecting", async () => {
    server = await startTestServer({ playPassword: "open-sesame" });

    await expect(connectClient(server.url)).rejects.toThrow(/password/i);
    await expect(connectClient(server.url, "wrong-password")).rejects.toThrow(/password/i);

    const host = await connectClient(server.url, "open-sesame");
    const hostViewPromise = waitForView(host);
    const created = await emitAck<{ roomCode: string; hostToken: string }>(host, "createRoom", { name: "Host" });

    expect(created.roomCode).toMatch(/^[A-Z0-9]{6}$/);
    await hostViewPromise;
    host.disconnect();
  });

  it("rejects invalid room codes", async () => {
    server = await startTestServer();
    const guest = await connectClient(server.url);

    const result = await emitAck<{ ok: boolean; error?: string }>(guest, "joinRoom", {
      roomCode: "abc",
      name: "Guest"
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/valid room code/i);
    guest.disconnect();
  });

  it("rejects joining a room that does not exist", async () => {
    server = await startTestServer();
    const guest = await connectClient(server.url);

    const result = await emitAck<{ ok: boolean; error?: string }>(guest, "joinRoom", {
      roomCode: "ZZZZZZ",
      name: "Guest"
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not found/i);
    guest.disconnect();
  });

  it("prevents the same socket from creating or joining twice", async () => {
    server = await startTestServer();
    const host = await connectClient(server.url);
    const hostViewPromise = waitForView(host);

    const created = await emitAck<{ roomCode: string; hostToken: string }>(host, "createRoom", { name: "Host" });
    await hostViewPromise;

    const secondCreate = await emitAck<{ ok?: boolean; error?: string }>(host, "createRoom", { name: "Host Again" });

    expect(secondCreate.ok).toBe(false);
    expect(secondCreate.error).toMatch(/already connected/i);

    const guest = await connectClient(server.url);
    await emitAck(guest, "joinRoom", { roomCode: created.roomCode, name: "Guest" });

    const secondJoin = await emitAck<{ ok?: boolean; error?: string }>(guest, "joinRoom", {
      roomCode: created.roomCode,
      name: "Guest Again"
    });
    expect(secondJoin.ok).toBe(false);
    expect(secondJoin.error).toMatch(/already connected/i);

    host.disconnect();
    guest.disconnect();
  });
});
